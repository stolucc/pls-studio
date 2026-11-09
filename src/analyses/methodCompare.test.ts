import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { parseCsv } from '../engine/dataset';
import { estimatePls } from '../engine/pls';
import { DEFAULT_FIGURE_STYLE, FIGURE_PRESETS } from '../figure/style';
import { toSpec, type Construct, type ModelState } from '../model/project';
import { compareMethods, methodCompareAnalysis } from './methodCompare';

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const C = (name: string, indicators: string[], x: number): Construct => ({ id: name, name, type: 'factor', mode: 'A', indicators, x, y: 0, side: 'left' });
const model: ModelState = {
  constructs: [C('EXPE', ['CUEX1', 'CUEX2', 'CUEX3'], 0), C('QUAL', ['PERQ1', 'PERQ2', 'PERQ3', 'PERQ4'], 0), C('SAT', ['CUSA1', 'CUSA2', 'CUSA3'], 500)].map((k, i) => ({ ...k, y: i === 1 ? 300 : 0 })),
  paths: [{ id: 'p', from: 'EXPE', to: 'SAT' }, { id: 'q', from: 'QUAL', to: 'SAT' }], moderations: [],
};

describe('PLS-SEM and CB-SEM compared', () => {
  const r = compareMethods(data, model, DEFAULT_FIGURE_STYLE, 'mean');
  it('reports what each engine estimates', () => {
    const pls = estimatePls(data, toSpec(model), { missing: 'mean' });
    const cb = estimateCb(data, toSpec(model), 'casewise');
    const p = r.paths.find((x) => x.from === 'QUAL')!;
    expect(p.pls).toBeCloseTo(pls.pathCoef[pls.constructs.indexOf('QUAL')][pls.constructs.indexOf('SAT')], 10);
    expect(p.cb).toBeCloseTo(cb.estimates.find((e) => e.op === '~' && e.lhs === 'SAT' && e.rhs === 'QUAL')!.std, 10);
    expect(r.loadings).toHaveLength(10);
    expect(r.r2.map((x) => x.construct)).toEqual(['SAT']);
    expect(r.r2[0].cb).toBeCloseTo(cb.r2Constructs[cb.constructs.indexOf('SAT')]!, 10);
  });
  it('draws the two diagrams differently under the PLS style', () => {
    const f = compareMethods(data, model, FIGURE_PRESETS.pls.style, 'mean').figures;
    expect(f.pls).toContain('fill="#ffff00"');
    expect(f.pls).not.toContain('#855dc2');
    expect(f.cb).toContain('stroke="#c6c800"');
    expect(f.cb).toContain('fill="#855dc2"');
  });
  it('is blocked where it does not apply', () => {
    const ctx = { data, model, settings: { missing: 'mean' }, info: null, pls: null, projectName: '' } as never;
    expect(methodCompareAnalysis.blocked({}, ctx)).toBeNull();
    const moderated = { ...model, moderations: [{ id: 'm', moderator: 'QUAL', path: 'p' }] };
    expect(methodCompareAnalysis.blocked({}, { ...(ctx as object), model: moderated } as never)).toMatch(/interaction/);
    expect(methodCompareAnalysis.blocked({}, { ...(ctx as object), model: { ...model, paths: [] } } as never)).toMatch(/path/);
  });
});
