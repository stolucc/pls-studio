// Shared harness for the validation corpus (__fixtures__/validation): loading
// cases and comparing results with the reference values. Used by the built-in
// engine's tests and by the R-engine (webR) tests, which must reproduce the
// same references through the R packages.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { near, same } from '../validation/record';
import type { CbFit, CbResult } from './cbsem';
import { parseCsv, parseCsvRows } from './dataset';
import { johnsonNeyman } from './jn';
import { mcIndirect } from './mcci';
import type { IpmaResult } from './ipma';
import type { MiivResult } from './miiv';
import type { Dataset, ModelSpec, PlsResult } from './types';

const DIR = join(__dirname, '__fixtures__', 'validation');

export interface RawCase {
  name: string;
  source: string;
  kind: 'pls' | 'cb' | 'ipma' | 'mcci' | 'htmt' | 'miiv';
  matrix?: { s: string; nacov?: string; n: number };
  dataset: string;
  missingTokens?: string | null;
  options: Record<string, unknown>;
  model: {
    constructs: { name: string; type: 'factor' | 'composite'; mode: 'A' | 'B'; indicators: string | string[] }[];
    paths: { from: string; to: string }[];
    moderations?: { from: string; moderator: string; to: string }[];
    covariances?: { a: string; b: string; kind: 'construct' | 'indicator' }[];
  };
  expected: Record<string, unknown>;
  tolerance: number;
}

export const cases: RawCase[] = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const datasets = new Map<string, Dataset>();
/** Covariance-matrix datasets: S with header and row names; NACOV without header. */
function loadMatrix(m: NonNullable<RawCase['matrix']>): Dataset {
  const rows = parseCsvRows(readFileSync(join(DIR, 'data', m.s), 'utf8'), ',');
  const names = rows[0].slice(1);
  const S = rows.slice(1).map((r) => r.slice(1).map(Number));
  const nacov = m.nacov ? parseCsvRows(readFileSync(join(DIR, 'data', m.nacov), 'utf8'), ',').map((r) => r.map(Number)) : undefined;
  return { names, cols: [], moments: { S, n: m.n, nacov } };
}

export function loadData(c: RawCase): Dataset {
  if (c.matrix) return loadMatrix(c.matrix);
  const key = `${c.dataset}|${c.missingTokens ?? ''}`;
  if (!datasets.has(key)) {
    const text = readFileSync(join(DIR, 'data', `${c.dataset}.csv`), 'utf8');
    datasets.set(key, parseCsv(text, c.missingTokens ? { missingTokens: ['NA', String(c.missingTokens)] } : {}).dataset);
  }
  return datasets.get(key)!;
}
export const toSpec = (c: RawCase): ModelSpec => ({
  constructs: c.model.constructs.map((k) => ({ ...k, indicators: Array.isArray(k.indicators) ? k.indicators : [k.indicators] })),
  paths: c.model.paths ?? [],
  moderations: c.model.moderations ?? [],
  covariances: c.model.covariances ?? [],
});

/** |a − b| ≤ tol · max(1, |b|), asserted and recorded (validation/record.ts near). */
export function close(actual: number | null | undefined, expected: number, tol: number, label: string) {
  expect(actual, `${label}: missing`).not.toBeNull();
  expect(actual, `${label}: missing`).not.toBeUndefined();
  near(label, actual as number, expected, tol * Math.max(1, Math.abs(expected)));
}

// ---------------- CB-SEM ----------------

/** lavaan fitMeasures name → our CbFit key. */
export const FIT_MAP: Record<string, keyof CbFit> = {
  npar: 'npar', chisq: 'chisq', df: 'df', pvalue: 'pvalue',
  'chisq.scaled': 'chisqScaled', 'df.scaled': 'dfScaled', 'pvalue.scaled': 'pvalueScaled',
  'chisq.scaling.factor': 'scalingFactor', 'chisq.shift.parameter': 'shiftParameter',
  'baseline.chisq': 'baselineChisq', 'baseline.df': 'baselineDf', 'baseline.chisq.scaled': 'baselineChisqScaled',
  cfi: 'cfi', tli: 'tli', 'cfi.scaled': 'cfiScaled', 'tli.scaled': 'tliScaled', 'cfi.robust': 'cfiRobust', 'tli.robust': 'tliRobust',
  rmsea: 'rmsea', 'rmsea.ci.lower': 'rmseaLow', 'rmsea.ci.upper': 'rmseaHigh', 'rmsea.pvalue': 'rmseaP',
  'rmsea.scaled': 'rmseaScaled', 'rmsea.robust': 'rmseaRobust',
  srmr: 'srmr', logl: 'logl', aic: 'aic', bic: 'bic',
};

/**
 * Compare a CB-SEM result with a lavaan reference case. `estimatesOnly` compares
 * parameter estimates (unstandardised and standardised) but not standard errors or fit.
 */
export function checkCbResult(c: RawCase, res: CbResult, opts: { estimatesOnly?: boolean } = {}) {
  const e = c.expected as Record<string, any>;
  const tol = c.tolerance;
  expect(res.converged, 'converged').toBe(true);
  same('N', res.n, e.n);
  for (const p of e.params) {
    const mine = res.estimates.find((x) => x.op === p.op && ((x.lhs === p.lhs && x.rhs === p.rhs) || (p.op === '~~' && x.lhs === p.rhs && x.rhs === p.lhs)));
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    expect(mine, `${label} present`).toBeDefined();
    // Differences below 0.1% of the standard error are numerically irrelevant: they occur in
    // weakly identified directions where lavaan's relative stopping rule leaves the last digits
    // undetermined (the χ² values still agree; see the fit check below).
    const slack = p.se != null ? 1e-3 * p.se : 0;
    close(mine!.est, p.est, Math.max(tol, slack / Math.max(1, Math.abs(p.est))), `est ${label}`);
    close(mine!.std, p.std, Math.max(tol, p.se != null ? (1e-3 * p.se * Math.abs(p.std)) / Math.max(1e-12, Math.abs(p.est)) : 0), `std ${label}`);
    if (p.se != null && !opts.estimatesOnly) {
      close(mine!.se, p.se, tol, `se ${label}`);
      close(mine!.z, p.z, tol * 10, `z ${label}`);
      close(mine!.p, p.p, tol * 10, `p ${label}`);
    }
  }
  if (opts.estimatesOnly) return;
  for (const [name, v] of Object.entries(e.fit as Record<string, number>)) {
    const key = FIT_MAP[name];
    expect(key, `unmapped fit measure ${name}`).toBeDefined();
    if (v === null || Number.isNaN(v)) continue;
    close(res.fit[key] as number | null | undefined, v, name.startsWith('rmsea.ci') || name.includes('pvalue') ? tol * 10 : tol, `fit ${name}`);
  }
  for (const [k, v] of Object.entries(e.r2 as Record<string, number>)) {
    const i = res.indicators.findIndex((x) => x.name === k);
    close(i >= 0 ? res.r2Indicators[i] : res.r2Constructs[res.constructs.indexOf(k)], v, tol, `R² ${k}`);
  }
  // Unstandardised indirect effects (lavaan := products of labelled paths).
  for (const ind of (e.indirectUnstd ?? []) as { from: string; to: string; est: number }[]) {
    const mine = mcIndirect(res, 1000, 1).find((x) => x.from === ind.from && x.to === ind.to);
    close(mine?.est, ind.est, tol, `indirect ${ind.from}→${ind.to}`);
  }
  // Conditional effects of a latent interaction (lavaan := defined parameters).
  if (e.conditional) {
    const jn = johnsonNeyman(res, res.moderations[0]);
    for (const ce of e.conditional) {
      close(jn.effect(ce.m), ce.est, tol, `conditional effect at m=${ce.m}`);
      close(jn.se(ce.m), ce.se, tol, `conditional SE at m=${ce.m}`);
    }
  }
}


// ---------------- PLS ----------------

export function checkPls(c: RawCase, res: PlsResult) {
  const e = c.expected as Record<string, any>;
  const tol = c.tolerance;
  const C = res.constructs;
  const ci = (n: string) => { const i = C.indexOf(n); expect(i, `construct ${n}`).toBeGreaterThanOrEqual(0); return i; };
  const ii = (n: string) => res.indicators.findIndex((x) => x.name === n);

  for (const p of e.paths ?? []) close(res.pathCoef[ci(p.from)][ci(p.to)], p.est, tol, `path ${p.from}→${p.to}`);
  // Paths the reference does not list must be zero in ours, i.e. no extra effects.
  const listed = new Set((e.paths ?? []).map((p: any) => `${p.from}→${p.to}`));
  C.forEach((f, i) => C.forEach((t, j) => { if (res.hasPath[i][j] && !listed.has(`${f}→${t}`)) close(res.pathCoef[i][j], 0, tol, `path ${f}→${t}`); }));

  for (const l of e.loadings ?? []) close(res.loadings[ii(l.indicator)], l.est, tol, `loading ${l.indicator}`);
  for (const w of e.weights ?? []) close(res.weights[ii(w.indicator)], w.est, tol, `weight ${w.indicator}`);
  for (const [k, v] of Object.entries(e.r2 ?? {})) close(res.rSquared[ci(k)], v as number, tol, `R² ${k}`);
  for (const key of ['alpha', 'rhoC', 'ave', 'rhoA'] as const) {
    const qk = key === 'ave' ? 'ave' : key;
    for (const [k, v] of Object.entries(e[key] ?? {})) close(res.quality[ci(k)][qk], v as number, tol, `${key} ${k}`);
  }
  for (const key of ['htmt', 'htmt2'] as const) {
    for (const h of e[key] ?? []) {
      const a = ci(h.a), b = ci(h.b);
      close(a > b ? res[key][a][b] : res[key][b][a], h.v, tol, `${key} ${h.a}-${h.b}`);
    }
  }
  for (const r of e.constructCor ?? []) close(res.constructCor[ci(r.a)][ci(r.b)], r.v, tol, `cor ${r.a}-${r.b}`);
  if (e.fit) {
    for (const which of ['estimated', 'saturated'] as const) {
      for (const d of ['srmr', 'dULS', 'dG'] as const) close(res.fit[which][d], e.fit[which][d], tol, `${which} ${d}`);
    }
  }
}


/** Compare an IPMA result with a cSEM reference case. */
export function checkIpmaResult(c: RawCase, res: IpmaResult) {
  const e = c.expected as Record<string, any>;
  close(res.targetPerformance, e.targetPerformance, c.tolerance, 'target performance');
  for (const k of e.constructs) {
    const mine = res.constructs.find((x) => x.name === k.name)!;
    close(mine.importance, k.importance, c.tolerance, `importance ${k.name}`);
    close(mine.performance, k.performance, c.tolerance, `performance ${k.name}`);
  }
  for (const k of e.indicators) {
    const mine = res.indicators.find((x) => x.name === k.name)!;
    close(mine.importance, k.importance, c.tolerance, `importance ${k.name}`);
    close(mine.performance, k.performance, c.tolerance, `performance ${k.name}`);
  }
}


interface MiivRefEq { dv: string; regressors: string | string[]; instruments: string | string[]; sigma2: number; sargan?: number | null; sarganDf?: number | null; sarganP?: number | null }
const arr = (v: string | string[]) => (Array.isArray(v) ? v : [v]);

/** Compare a MIIV-2SLS result with a MIIVsem reference case. */
export function checkMiivResult(c: RawCase, res: MiivResult) {
  const e = c.expected as { n: number; equations: MiivRefEq[]; params: { lhs: string; op: string; rhs: string; est: number; se: number; z: number; p: number }[] };
  same('N', res.n, e.n);
  expect(res.equations.length).toBe(e.equations.length);
  for (const ref of e.equations) {
    const mine = res.equations.find((q) => q.dv === ref.dv && q.regressors.join() === [...arr(ref.regressors)].join())
      ?? res.equations.find((q) => q.dv === ref.dv && [...q.regressors].sort().join() === [...arr(ref.regressors)].sort().join());
    expect(mine, `equation ${ref.dv} ~ ${arr(ref.regressors).join(' + ')}`).toBeDefined();
    expect([...mine!.instruments].sort(), `instruments of ${ref.dv}`).toEqual([...arr(ref.instruments)].sort());
    close(mine!.sigma2, ref.sigma2, c.tolerance, `σ² ${ref.dv}`);
    if (ref.sargan != null) {
      expect(mine!.sarganDf).toBe(ref.sarganDf);
      close(mine!.sargan, ref.sargan, c.tolerance, `Sargan ${ref.dv}`);
      close(mine!.sarganP, ref.sarganP!, c.tolerance * 10, `Sargan p ${ref.dv}`);
    } else expect(mine!.sargan).toBeNull();
  }
  for (const p of e.params) {
    const mine = res.estimates.find((x) => x.lhs === p.lhs && x.op === p.op && x.rhs === p.rhs);
    const label = `${p.lhs} ${p.op} ${p.rhs}`;
    expect(mine, label).toBeDefined();
    close(mine!.est, p.est, c.tolerance, `est ${label}`);
    close(mine!.se, p.se, c.tolerance, `se ${label}`);
    close(mine!.z, p.z, c.tolerance * 10, `z ${label}`);
    close(mine!.p, p.p, c.tolerance * 10, `p ${label}`);
  }
}

