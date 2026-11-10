// The longitudinal invariance and MIMIC DIF cards (analyses/invariance.tsx) run as the Run button runs them, compared with
// plain lavaan models written out by hand and run natively in desktop R (scripts/validation/invariance_cards.R →
// src/engine/__fixtures__/invariance/reference.json): the cards build their models through semTools::measEq.syntax
// and per-item lavaan models, the reference without them.
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run src/rengine/invariance (or in webR without PS_NATIVE_R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { longInvarianceAnalysis } from '../analyses/invariance';
import type { AnalysisCtx } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS } from '../model/project';
import { rCall } from './bridge';
import type { LongInvarianceResult } from './invariance';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'invariance', 'reference.json'), 'utf8'));
const near = (what: string, got: number, want: number, tol: number) => expect(Math.abs(got - want), `${what}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
const same = (what: string, got: unknown, want: unknown) => expect(got, what).toEqual(want);

async function dataset(pkg: 'lavaan', name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}

it('longitudinal invariance of democracy 1960 / 1965 (PoliticalDemocracy) equals the hand-written lavaan sequence, ML and MLR', async () => {
  const data = await dataset('lavaan', 'PoliticalDemocracy');
  for (const est of ['ML', 'MLR'] as const) {
    const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: est, missing: 'casewise' }, pls: null, projectName: 'p' };
    const o = { ...longInvarianceAnalysis.defaults(ctx), factor: 'Democracy', occasions: [['y1', 'y2', 'y3', 'y4'], ['y5', 'y6', 'y7', 'y8']] };
    expect(longInvarianceAnalysis.blocked(o, ctx)).toBeNull();
    const r = await longInvarianceAnalysis.run(o, ctx, () => {}) as LongInvarianceResult;
    expect(r.warnings).toEqual([]);
    const ref = REF.cases[`longInvariance${est}`];
    same(`${est}: levels`, r.levels.map((l) => l.level).join(' '), 'configural metric scalar strict');
    same(`${est}: robust`, String(r.robust), String(est === 'MLR'));
    r.levels.forEach((l, i) => {
      near(`${est} ${l.level}: χ²`, l.chisq, ref.chisq[i], 1e-6);
      same(`${est} ${l.level}: df`, l.df, ref.df[i]);
      near(`${est} ${l.level}: CFI`, l.cfi, ref.cfi[i], 1e-7);
      near(`${est} ${l.level}: RMSEA`, l.rmsea, ref.rmsea[i], 1e-7);
      near(`${est} ${l.level}: SRMR`, l.srmr, ref.srmr[i], 1e-7);
      if (i > 0) { near(`${est} ${l.level}: Δχ²`, l.chisqDiff!, ref.chisqDiff[i - 1], 1e-6); near(`${est} ${l.level}: p`, l.p!, ref.p[i - 1], 1e-7); near(`${est} ${l.level}: ΔCFI`, l.cfiChange!, ref.cfi[i] - ref.cfi[i - 1], 1e-7); }
    });
    const sc = r.levels[2].factor;
    same(`${est}: occasion 1 fixed`, `${sc[0].mean} ${sc[0].variance} ${sc[0].meanSe ?? 'fixed'}`, '0 1 fixed');
    near(`${est}: 1965 mean under scalar invariance`, sc[1].mean, ref.scalarMean, 1e-5);
    near(`${est}: its SE`, sc[1].meanSe!, ref.scalarMeanSe, 1e-5);
    near(`${est}: 1965 variance under scalar invariance`, sc[1].variance, ref.scalarVar, 1e-5);
    const script = await longInvarianceAnalysis.script!(o, ctx);
    expect(script).toContain('measEq.syntax(configural.model = model');
    expect(script).toContain('longIndNames <- list(y1 = c("y1", "y5")');
  }
  // Adjacent occasions only: with two occasions, the same models
  const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'ML', missing: 'casewise' }, pls: null, projectName: 'p' };
  const adj = await longInvarianceAnalysis.run({ factor: 'D', occasions: [['y1', 'y2', 'y3', 'y4'], ['y5', 'y6', 'y7', 'y8']], lag: 'adjacent' }, ctx, () => {}) as LongInvarianceResult;
  near('adjacent: configural χ²', adj.levels[0].chisq, REF.cases.longInvarianceML.chisq[0], 1e-6);
}, 600_000);
