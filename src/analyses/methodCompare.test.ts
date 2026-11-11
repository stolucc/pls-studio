import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { parseCsv } from '../engine/dataset';
import { estimatePls } from '../engine/pls';
import { DEFAULT_FIGURE_STYLE, FIGURE_PRESETS } from '../figure/style';
import { makeCovariancesExplicit, toSpec, type Construct, type ModelState } from '../model/project';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import { exampleTestData } from '../examples/testData';
import { against, example, near, same } from '../validation/record';
import { compareMethods, methodCompareAnalysis } from './methodCompare';

const data = parseCsv(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mobi.csv'), 'utf8'),
).dataset;
const C = (name: string, indicators: string[], x: number): Construct => ({
  id: name,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x,
  y: 0,
  side: 'left',
});
const model: ModelState = {
  constructs: [
    C('EXPE', ['CUEX1', 'CUEX2', 'CUEX3'], 0),
    C('QUAL', ['PERQ1', 'PERQ2', 'PERQ3', 'PERQ4'], 0),
    C('SAT', ['CUSA1', 'CUSA2', 'CUSA3'], 500),
  ].map((k, i) => ({ ...k, y: i === 1 ? 300 : 0 })),
  paths: [
    { id: 'p', from: 'EXPE', to: 'SAT' },
    { id: 'q', from: 'QUAL', to: 'SAT' },
  ],
  moderations: [],
};

// The home screen's example against plain seminr and lavaan (scripts/validation/method_compare.R): both columns of the card.
it('compare-pls-cb: the PLS column equals seminr and the CB column lavaan’s standardised solution (native R)', () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'compare-pls-cb')!;
  example(ex.id, {
    title: ex.title,
    method: 'PLS-SEM',
    packages: ['seminr', 'lavaan'],
    definition: ex,
  });
  against({
    label:
      'plain seminr (PLS) and lavaan (ML, standardised) in desktop R, scripts/validation/method_compare.R',
    script: 'scripts/validation/method_compare.R',
    level: 'native',
  });
  const ref = JSON.parse(
    readFileSync(
      join(__dirname, '..', 'engine', '__fixtures__', 'methodcompare', 'mobi.json'),
      'utf8',
    ),
  ) as {
    pls: { paths: Record<string, number>; loadings: Record<string, number>; r2: number };
    cb: {
      paths: { lhs: string; rhs: string; std: number }[];
      loadings: { lhs: string; rhs: string; std: number }[];
      r2: number;
      n: number;
    };
  };
  const r = compareMethods(exampleTestData(ex)!, exampleModel(ex), DEFAULT_FIGURE_STYLE, 'mean');
  for (const p of r.paths) {
    near(`PLS path ${p.from} → ${p.to}`, p.pls, ref.pls.paths[p.from], 1e-6);
    near(
      `CB path ${p.from} → ${p.to} (standardised)`,
      p.cb!,
      ref.cb.paths.find((x) => x.lhs === p.to && x.rhs === p.from)!.std,
      1e-4,
    );
  }
  for (const l of r.loadings) {
    near(`PLS loading ${l.indicator}`, l.pls, ref.pls.loadings[l.indicator], 1e-6);
    near(
      `CB loading ${l.indicator} (standardised)`,
      l.cb!,
      ref.cb.loadings.find((x) => x.lhs === l.construct && x.rhs === l.indicator)!.std,
      1e-4,
    );
  }
  near('PLS R² Satisfaction', r.r2[0].pls!, ref.pls.r2, 1e-6);
  near('CB R² Satisfaction', r.r2[0].cb!, ref.cb.r2, 1e-4);
  same('N (CB-SEM)', r.n.cb, ref.cb.n);
});

describe('PLS-SEM and CB-SEM compared', () => {
  const r = compareMethods(data, model, DEFAULT_FIGURE_STYLE, 'mean');
  it('reports what each engine estimates', () => {
    const pls = estimatePls(data, toSpec(model), { missing: 'mean' });
    const cb = estimateCb(data, toSpec(makeCovariancesExplicit(model)), 'casewise'); // (the exogenous factors correlated, as lavaan's default)
    const p = r.paths.find((x) => x.from === 'QUAL')!;
    expect(p.pls).toBeCloseTo(
      pls.pathCoef[pls.constructs.indexOf('QUAL')][pls.constructs.indexOf('SAT')],
      10,
    );
    expect(p.cb).toBeCloseTo(
      cb.estimates.find((e) => e.op === '~' && e.lhs === 'SAT' && e.rhs === 'QUAL')!.std,
      10,
    );
    expect(r.loadings).toHaveLength(10);
    expect(r.r2.map((x) => x.construct)).toEqual(['SAT']);
    expect(r.r2[0].cb).toBeCloseTo(cb.r2Constructs[cb.constructs.indexOf('SAT')]!, 10);
  });
  it('keeps a pair confirmed as uncorrelated at zero in CB-SEM', () => {
    const zero: ModelState = {
      ...model,
      correlations: [{ id: 'z', kind: 'construct', a: 'EXPE', b: 'QUAL', zero: true }],
    };
    const cb = estimateCb(data, toSpec(zero), 'casewise');
    expect(
      compareMethods(data, zero, DEFAULT_FIGURE_STYLE, 'mean').paths.find((x) => x.from === 'QUAL')!
        .cb,
    ).toBeCloseTo(
      cb.estimates.find((e) => e.op === '~' && e.lhs === 'SAT' && e.rhs === 'QUAL')!.std,
      10,
    );
    expect(r.paths.find((x) => x.from === 'QUAL')!.cb).not.toBeCloseTo(
      cb.estimates.find((e) => e.op === '~' && e.lhs === 'SAT' && e.rhs === 'QUAL')!.std,
      3,
    );
  });
  it('draws the two diagrams differently under the PLS style', () => {
    const f = compareMethods(data, model, FIGURE_PRESETS.pls.style, 'mean').figures;
    expect(f.pls).toContain('fill="#ffff00"');
    expect(f.pls).not.toContain('#855dc2');
    expect(f.cb).toContain('stroke="#c6c800"');
    expect(f.cb).toContain('fill="#855dc2"');
  });
  it('is blocked where it does not apply', () => {
    const ctx = {
      data,
      model,
      settings: { missing: 'mean' },
      info: null,
      pls: null,
      projectName: '',
    } as never;
    expect(methodCompareAnalysis.blocked({}, ctx)).toBeNull();
    const moderated = { ...model, moderations: [{ id: 'm', moderator: 'QUAL', path: 'p' }] };
    expect(
      methodCompareAnalysis.blocked({}, { ...(ctx as object), model: moderated } as never),
    ).toMatch(/interaction/);
    expect(
      methodCompareAnalysis.blocked({}, {
        ...(ctx as object),
        model: { ...model, paths: [] },
      } as never),
    ).toMatch(/path/);
  });
});
