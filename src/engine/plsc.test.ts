import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './dataset';
import { estimatePls } from './pls';
import type { ConstructType, ModelSpec, PlsResult } from './types';

const fx = (f: string) => join(__dirname, '__fixtures__', f);
const data = parseCsv(readFileSync(fx('mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);

/** cSEM defaults: common factors Mode A, composites Mode B. */
function model(types: Record<string, ConstructType>): ModelSpec {
  const c = (name: string, indicators: string[]) => ({
    name,
    indicators,
    type: types[name],
    mode: types[name] === 'composite' ? ('B' as const) : ('A' as const),
  });
  return {
    constructs: [
      c('Image', items('IMAG', 5)),
      c('Expectation', items('CUEX', 3)),
      c('Quality', items('PERQ', 7)),
      c('Value', items('PERV', 2)),
      c('Satisfaction', items('CUSA', 3)),
      c('Loyalty', items('CUSL', 3)),
    ],
    paths: [
      ['Image', 'Expectation'],
      ['Expectation', 'Quality'],
      ['Expectation', 'Value'],
      ['Quality', 'Value'],
      ['Image', 'Satisfaction'],
      ['Expectation', 'Satisfaction'],
      ['Quality', 'Satisfaction'],
      ['Value', 'Satisfaction'],
      ['Image', 'Loyalty'],
      ['Satisfaction', 'Loyalty'],
    ].map(([from, to]) => ({ from, to })),
  };
}
const all = (t: ConstructType) =>
  Object.fromEntries(
    ['Image', 'Expectation', 'Quality', 'Value', 'Satisfaction', 'Loyalty'].map((n) => [n, t]),
  );

type Ref = Record<string, Record<string, number>>;
const LN10_SQ = Math.LN10 ** 2;
const TOL = 5;

function compare(res: PlsResult, ref: Record<string, unknown>) {
  const C = res.constructs;
  const paths = ref.paths as Ref; // rows = dependent
  for (const t of C)
    for (const f of C) {
      expect(res.pathCoef[C.indexOf(f)][C.indexOf(t)], `${f} -> ${t}`).toBeCloseTo(
        paths[t][f],
        TOL,
      );
    }
  res.indicators.forEach((ind, k) => {
    expect(res.loadings[k], `loading ${ind.name}`).toBeCloseTo(
      (ref.loadings as Record<string, number>)[ind.name],
      TOL,
    );
    expect(res.weights[k], `weight ${ind.name}`).toBeCloseTo(
      (ref.weights as Record<string, number>)[ind.name],
      TOL,
    );
  });
  const cc = ref.constructCor as Ref;
  for (const a of C)
    for (const b of C)
      expect(res.constructCor[C.indexOf(a)][C.indexOf(b)], `cor ${a}-${b}`).toBeCloseTo(
        cc[a][b],
        TOL,
      );
  for (const [c, v] of Object.entries(ref.r2 as Record<string, number>))
    expect(res.rSquared[C.indexOf(c)], `R2 ${c}`).toBeCloseTo(v, TOL);
  for (const [c, v] of Object.entries(ref.rhoA as Record<string, number>))
    expect(res.quality[C.indexOf(c)].rhoA, `rhoA ${c}`).toBeCloseTo(v, TOL);

  const f = ref.fit as Record<string, number>;
  expect(res.fit.estimated.srmr).toBeCloseTo(f.srmr, 6);
  expect(res.fit.estimated.dULS).toBeCloseTo(f.dL, 5);
  // cSEM uses log10 in d_G; we follow Dijkstra & Henseler (2015) with the natural log.
  expect(res.fit.estimated.dG / LN10_SQ).toBeCloseTo(f.dG_log10, 6);
  expect(res.fit.saturated.srmr).toBeCloseTo(f.srmr_sat, 6);
  expect(res.fit.saturated.dULS).toBeCloseTo(f.dL_sat, 5);
  expect(res.fit.saturated.dG / LN10_SQ).toBeCloseTo(f.dG_log10_sat, 6);
}

describe('consistent PLS and composite models vs cSEM 0.5.0', () => {
  it('PLSc with common factors and a Mode B composite', () => {
    const ref = JSON.parse(readFileSync(fx('csem_plsc_mixed.json'), 'utf8'));
    const res = estimatePls(data, model({ ...all('factor'), Quality: 'composite' }), {
      consistent: true,
      tolerance: 1e-12,
      maxIter: 1000,
    });
    expect(res.consistent).toBe(true);
    compare(res, ref);

    // HTMT and HTMT2 on common factors (cSEM stores the lower triangle).
    for (const key of ['htmt', 'htmt2'] as const) {
      const h = ref[key] as Ref;
      const names = Object.keys(h);
      for (let i = 0; i < names.length; i++)
        for (let j = 0; j < i; j++) {
          const a = res.constructs.indexOf(names[i]),
            b = res.constructs.indexOf(names[j]);
          const mine = a > b ? res[key][a][b] : res[key][b][a];
          expect(mine, `${key} ${names[i]}-${names[j]}`).toBeCloseTo(h[names[i]][names[j]], TOL);
        }
    }
  });

  it('pure composite model (confirmatory composite analysis setting)', () => {
    const ref = JSON.parse(readFileSync(fx('csem_composite.json'), 'utf8'));
    const res = estimatePls(data, model(all('composite')), {
      consistent: true,
      tolerance: 1e-12,
      maxIter: 1000,
    });
    compare(res, ref);
    // PLSc leaves composites untouched: identical to traditional PLS.
    const plain = estimatePls(data, model(all('composite')), { tolerance: 1e-12, maxIter: 1000 });
    plain.pathCoef.forEach((row, i) =>
      row.forEach((v, j) => expect(res.pathCoef[i][j]).toBeCloseTo(v, 10)),
    );
  });

  it('PLSc raises the path between two reliable-but-attenuated factors', () => {
    const spec = model(all('factor'));
    const plain = estimatePls(data, spec);
    const plsc = estimatePls(data, spec, { consistent: true });
    const i = plain.constructs.indexOf('Satisfaction'),
      j = plain.constructs.indexOf('Loyalty');
    expect(plsc.pathCoef[i][j]).toBeGreaterThan(plain.pathCoef[i][j]);
    expect(plsc.constructCor[i][i]).toBe(1);
  });
});
