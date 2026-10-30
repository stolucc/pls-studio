import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './dataset';
import { estimatePls } from './pls';
import { DEFAULT_OPTIONS, type ModelSpec, type PlsResult } from './types';

const fx = (f: string) => join(__dirname, '__fixtures__', f);
const data = parseCsv(readFileSync(fx('mobi.csv'), 'utf8')).dataset;
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);

function mobiModel(qualityMode: 'A' | 'B'): ModelSpec {
  return {
    constructs: [
      { name: 'Image', mode: 'A', indicators: items('IMAG', 5) },
      { name: 'Expectation', mode: 'A', indicators: items('CUEX', 3) },
      { name: 'Quality', mode: qualityMode, indicators: items('PERQ', 7) },
      { name: 'Value', mode: 'A', indicators: items('PERV', 2) },
      { name: 'Satisfaction', mode: 'A', indicators: items('CUSA', 3) },
      { name: 'Complaints', mode: 'A', indicators: ['CUSCO'] },
      { name: 'Loyalty', mode: 'A', indicators: items('CUSL', 3) },
    ],
    paths: [
      ['Image', 'Expectation'], ['Image', 'Satisfaction'], ['Image', 'Loyalty'],
      ['Expectation', 'Quality'], ['Expectation', 'Value'], ['Expectation', 'Satisfaction'],
      ['Quality', 'Value'], ['Quality', 'Satisfaction'], ['Value', 'Satisfaction'],
      ['Satisfaction', 'Complaints'], ['Satisfaction', 'Loyalty'], ['Complaints', 'Loyalty'],
    ].map(([from, to]) => ({ from, to })),
  };
}

type Ref = Record<string, Record<string, number | string | null>>;
const TOL = 5;

function compare(res: PlsResult, ref: Record<string, Ref | number>) {
  const C = res.constructs;
  const ci = (n: string) => C.indexOf(n);
  const pc = ref.pathCoef as Ref;
  for (const f of C) for (const t of C) expect(res.pathCoef[ci(f)][ci(t)]).toBeCloseTo(pc[f][t] as number, TOL);

  res.indicators.forEach((ind, k) => {
    const c = C[ind.construct];
    expect(res.loadings[k], `loading ${ind.name}`).toBeCloseTo((ref.loadings as Ref)[ind.name][c] as number, TOL);
    expect(res.weights[k], `weight ${ind.name}`).toBeCloseTo((ref.weights as Ref)[ind.name][c] as number, TOL);
    expect(res.vifOuter[k], `vif ${ind.name}`).toBeCloseTo((ref.vifItems as Ref)[c][ind.name] as number, TOL);
  });

  const r2 = ref.rSquared as Ref;
  for (const [c, v] of Object.entries(r2.Rsq)) expect(res.rSquared[ci(c)]).toBeCloseTo(v as number, TOL);
  for (const [c, v] of Object.entries(r2.AdjRsq)) expect(res.adjRSquared[ci(c)]).toBeCloseTo(v as number, TOL);

  const rel = ref.reliability as Ref;
  C.forEach((c, j) => {
    const q = res.quality[j];
    expect(q.alpha, `alpha ${c}`).toBeCloseTo(rel[c].alpha as number, TOL);
    expect(q.rhoC, `rhoC ${c}`).toBeCloseTo(rel[c].rhoC as number, TOL);
    expect(q.ave, `AVE ${c}`).toBeCloseTo(rel[c].AVE as number, TOL);
    expect(q.rhoA, `rhoA ${c}`).toBeCloseTo(rel[c].rhoA as number, TOL);
  });

  // seminr stores HTMT in the upper triangle (row = earlier construct).
  const htmt = ref.htmt as Ref;
  for (let i = 0; i < C.length; i++) for (let j = 0; j < i; j++) {
    const v = htmt[C[i]][C[j]] !== 'NA' ? htmt[C[i]][C[j]] : htmt[C[j]][C[i]];
    expect(res.htmt[i][j], `htmt ${C[i]}-${C[j]}`).toBeCloseTo(v as number, TOL);
  }

  const fsq = ref.fSquare as Ref;
  const te = ref.totalEffects as Ref;
  const vifA = ref.vifAntecedents as Ref;
  for (const f of C) for (const t of C) {
    expect(res.totalEffects[ci(f)][ci(t)], `total ${f}->${t}`).toBeCloseTo(te[f][t] as number, TOL);
    if (res.hasPath[ci(f)][ci(t)]) {
      expect(res.fSquare[ci(f)][ci(t)], `f2 ${f}->${t}`).toBeCloseTo(fsq[f][t] as number, TOL);
      const v = vifA[t]?.[f];
      expect(res.vifInner[ci(f)][ci(t)], `vif ${f}->${t}`).toBeCloseTo(typeof v === 'number' ? v : 1, TOL);
    } else {
      expect(res.fSquare[ci(f)][ci(t)]).toBeNull();
    }
  }
}

describe('estimatePls vs seminr 2.3.2 (mobi data)', () => {
  it('matches all Mode A results', () => {
    const ref = JSON.parse(readFileSync(fx('mobi_modeA.json'), 'utf8'));
    const res = estimatePls(data, mobiModel('A'));
    expect(res.converged).toBe(true);
    expect(res.n).toBe(250);
    compare(res, ref);
  });

  it('matches results with a Mode B (formative) construct', () => {
    const ref = JSON.parse(readFileSync(fx('mobi_modeB.json'), 'utf8'));
    compare(estimatePls(data, mobiModel('B')), ref);
  });

  it('is invariant to construct order', () => {
    const spec = mobiModel('A');
    const a = estimatePls(data, spec);
    const b = estimatePls(data, { ...spec, constructs: [...spec.constructs].reverse() });
    const ia = a.constructs.indexOf('Quality'), ja = a.constructs.indexOf('Satisfaction');
    const ib = b.constructs.indexOf('Quality'), jb = b.constructs.indexOf('Satisfaction');
    expect(b.pathCoef[ib][jb]).toBeCloseTo(a.pathCoef[ia][ja], 8);
  });

  it('indirect effects equal total minus direct', () => {
    const r = estimatePls(data, mobiModel('A'));
    const i = r.constructs.indexOf('Image'), j = r.constructs.indexOf('Loyalty');
    expect(r.indirectEffects[i][j]).toBeCloseTo(r.totalEffects[i][j] - r.pathCoef[i][j], 12);
    expect(r.indirectEffects[i][j]).toBeGreaterThan(0);
  });
});

describe('sum scores per construct (unit weights) vs cSEM', () => {
  const ref = JSON.parse(readFileSync(fx('mobi_unit.json'), 'utf8')) as {
    weights: Record<string, number>; pathCoef: Record<string, Record<string, number>>; r2: Record<string, number>;
    plsc: { pathCoef: Record<string, Record<string, number>>; reliability: Record<string, number> };
  };
  const spec = mobiModel('A');
  spec.constructs = spec.constructs.map((k) => (k.name === 'Quality' || k.name === 'Loyalty' ? { ...k, mode: 'unit' as const } : k));
  const res = estimatePls(data, spec, { ...DEFAULT_OPTIONS, tolerance: 1e-10 });
  it('gives sum-score constructs equal weights and matches cSEM’s weights, paths and R²', () => {
    res.indicators.forEach((ind, k) => expect(res.weights[k], ind.name).toBeCloseTo(ref.weights[ind.name], 5));
    const q = res.indicators.flatMap((ind, k) => (res.constructs[ind.construct] === 'Quality' ? [res.weights[k]] : []));
    expect(new Set(q.map((w) => w.toFixed(12))).size).toBe(1);
    for (const [to, row] of Object.entries(ref.pathCoef)) for (const [from, b] of Object.entries(row))
      expect(res.pathCoef[res.constructs.indexOf(from)][res.constructs.indexOf(to)], `${from} → ${to}`).toBeCloseTo(b, 5);
    for (const [k, r2] of Object.entries(ref.r2)) expect(res.rSquared[res.constructs.indexOf(k)], k).toBeCloseTo(r2, 5);
  });
  it('PLSc corrects the Mode A common factors and leaves sum scores as they are, as cSEM', () => {
    const plsc = estimatePls(data, spec, { ...DEFAULT_OPTIONS, consistent: true, tolerance: 1e-10 });
    for (const [to, row] of Object.entries(ref.plsc.pathCoef)) for (const [from, b] of Object.entries(row))
      expect(plsc.pathCoef[plsc.constructs.indexOf(from)][plsc.constructs.indexOf(to)], `${from} → ${to}`).toBeCloseTo(b, 4);
    expect(ref.plsc.reliability.Quality).toBe(1);
    expect(ref.plsc.reliability.Image).toBeLessThan(1);
  });
});

describe('estimatePls edge cases', () => {
  it('reports a missing indicator by name', () => {
    const spec = mobiModel('A');
    spec.constructs[0].indicators.push('NOPE');
    expect(() => estimatePls(data, spec)).toThrow(/NOPE/);
  });

  it('reports a zero-variance indicator', () => {
    const d = { names: [...data.names, 'CONST'], cols: [...data.cols, new Float64Array(250).fill(3)] };
    const spec = mobiModel('A');
    spec.constructs[0].indicators.push('CONST');
    expect(() => estimatePls(d, spec)).toThrow(/CONST.*zero variance/);
  });

  it('mean replacement and casewise deletion handle NaN', () => {
    const cols = data.cols.map((c) => c.slice());
    cols[data.names.indexOf('IMAG1')][0] = NaN;
    cols[data.names.indexOf('CUSL2')][5] = NaN;
    const d = { names: data.names, cols };
    const mean = estimatePls(d, mobiModel('A'), { missing: 'mean' });
    expect(mean.n).toBe(250);
    const cw = estimatePls(d, mobiModel('A'), { missing: 'casewise' });
    expect(cw.n).toBe(248);
    expect(cw.droppedRows).toBe(2);
    expect(Number.isFinite(cw.pathCoef[0][1])).toBe(true);
  });

  it('factor and centroid schemes give close but valid results', () => {
    const p = estimatePls(data, mobiModel('A'), { scheme: 'path' });
    for (const scheme of ['factor', 'centroid'] as const) {
      const r = estimatePls(data, mobiModel('A'), { scheme });
      expect(r.converged).toBe(true);
      expect(Math.abs(r.pathCoef[0][1] - p.pathCoef[0][1])).toBeLessThan(0.05);
    }
  });
});
