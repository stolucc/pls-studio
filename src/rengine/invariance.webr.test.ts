// The longitudinal invariance and MIMIC DIF cards (analyses/invariance.tsx) run as the Run button runs them, compared with
// plain lavaan models written out by hand and run natively in desktop R (scripts/validation/invariance_cards.R →
// src/engine/__fixtures__/invariance/reference.json): the cards build their models through semTools::measEq.syntax
// and per-item lavaan models, the reference without them.
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run src/rengine/invariance (or in webR without PS_NATIVE_R).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { longInvarianceAnalysis, mimicDifAnalysis } from '../analyses/invariance';
import type { AnalysisCtx } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { near as recorded, same as recordedSame } from '../validation/record';
import { rCall } from './bridge';
import { helperLibrary } from './nativeR';
import type { LongInvarianceResult, MimicDifResult } from './invariance';
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

// The syntax the card shows for each level, fitted by plain lavaan() in desktop R (Rscript), gives the card's χ² and df.
function plainLavaan(syntax: string[], estimator: 'ML' | 'MLR'): { chisq: number; df: number }[] {
  const dir = mkdtempSync(join(tmpdir(), 'ps-long-syntax-'));
  try {
    syntax.forEach((text, i) => writeFileSync(join(dir, `level${i}.lav`), text));
    const pick = estimator === 'MLR' ? 'chisq.scaled' : 'chisq';
    const script = [
      'suppressPackageStartupMessages(library(lavaan))',
      'data(PoliticalDemocracy, package = "lavaan")',
      `out <- lapply(0:${syntax.length - 1}, function(i) {`,
      '  syntax <- paste(readLines(sprintf("level%d.lav", i)), collapse = "\\n")',
      `  fit <- lavaan(syntax, data = PoliticalDemocracy, estimator = "${estimator}")`,
      `  list(chisq = unname(fitMeasures(fit, "${pick}")), df = unname(fitMeasures(fit, "df")))`,
      '})',
      'writeLines(jsonlite::toJSON(out, digits = NA, auto_unbox = TRUE), "out.json")',
    ].join('\n');
    writeFileSync(join(dir, 'fit.R'), script);
    const libs = [helperLibrary(), process.env.R_LIBS].filter(Boolean).join(':');
    execFileSync('Rscript', ['fit.R'], { cwd: dir, env: { ...process.env, R_LIBS: libs }, stdio: 'pipe' });
    return JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it('longitudinal invariance: the generated syntax shown for each level, fitted by plain lavaan, gives the card’s χ² and df', async () => {
  const data = await dataset('lavaan', 'PoliticalDemocracy');
  for (const est of ['ML', 'MLR'] as const) {
    const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const, estimator: est, missing: 'casewise' as const };
    const ctx: AnalysisCtx = { data, info: null, settings, pls: null, projectName: 'p' };
    const occasions = [['y1', 'y2', 'y3', 'y4'], ['y5', 'y6', 'y7', 'y8']];
    const o = { ...longInvarianceAnalysis.defaults(ctx), factor: 'Democracy', occasions };
    const r = await longInvarianceAnalysis.run(o, ctx, () => {}) as LongInvarianceResult;
    const syntax = r.levels.map((l) => l.syntax ?? '');
    expect(syntax[1]).toContain('lambda.1_1*y1');
    expect(syntax[2]).toContain('## INTERCEPTS:');
    const plain = plainLavaan(syntax, est);
    r.levels.forEach((l, i) => {
      // (the card's fit may run in webR: ~1e-6 from WebAssembly floating point)
      recorded(`${est} ${l.level}: χ² of the shown syntax`, plain[i].chisq, l.chisq, 1e-5);
      recordedSame(`${est} ${l.level}: df of the shown syntax`, plain[i].df, l.df);
    });
  }
}, 600_000);

it('DIF by MIMIC on Holzinger & Swineford equals the hand-written per-item lavaan models: visual on sex (ML, Holm, freed) and textual on age (MLR, BH)', async () => {
  const data = await dataset('lavaan', 'HolzingerSwineford1939');
  const fac = (name: string, indicators: string[]) => ({ id: name, name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left' });
  const model = { constructs: [fac('visual', ['x1', 'x2', 'x3', 'x9']), fac('textual', ['x4', 'x5', 'x6'])], paths: [], moderations: [] } as unknown as ModelState;
  const cases = [
    { ref: REF.cases.mimicVisualSex, est: 'ML' as const, o: { construct: 'visual', covariate: 'sex', adjust: 'holm' as const, alpha: 0.05, free: true }, items: ['x1', 'x2', 'x3', 'x9'] },
    { ref: REF.cases.mimicTextualAge, est: 'MLR' as const, o: { construct: 'textual', covariate: 'ageyr', adjust: 'BH' as const, alpha: 0.05, free: true }, items: ['x4', 'x5', 'x6'] },
  ];
  for (const { ref, est, o, items } of cases) {
    const ctx: AnalysisCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: est, missing: 'casewise' }, pls: null, projectName: 'p', model };
    expect(mimicDifAnalysis.blocked(o, ctx)).toBeNull();
    const r = await mimicDifAnalysis.run(o, ctx, () => {}) as MimicDifResult;
    expect(r.warnings).toEqual([]);
    const w = `${o.construct} on ${o.covariate}`;
    same(`${w}: items`, r.items.map((x) => x.item), items);
    near(`${w}: effect`, r.effect.est, ref.effect, 1e-7);
    near(`${w}: its SE`, r.effect.se, ref.effectSe, 1e-7);
    r.items.forEach((x, k) => {
      near(`${w} ${x.item}: direct effect`, x.est, ref.est[k], 1e-7);
      near(`${w} ${x.item}: SE`, x.se, ref.se[k], 1e-7);
      near(`${w} ${x.item}: p (Wald)`, x.p, ref.p[k], 1e-8);
      near(`${w} ${x.item}: standardised`, x.std, ref.std[k], 1e-7);
      near(`${w} ${x.item}: LR χ²`, x.chisq, ref.chisq[k], 1e-6);
      near(`${w} ${x.item}: p (LR)`, x.pLrt, ref.pLrt[k], 1e-8);
      near(`${w} ${x.item}: corrected p`, x.pAdj, ref.pAdj[k], 1e-8);
      near(`${w} ${x.item}: score χ²`, x.score!, ref.score[k], 1e-6);
      near(`${w} ${x.item}: p (score)`, x.scoreP!, ref.scoreP[k], 1e-8);
    });
    same(`${w}: flagged`, r.flagged, [...ref.flagged]);
    near(`${w}: effect in the final model`, r.final!.effect.est, ref.finalEffect, 1e-7);
    near(`${w}: its SE`, r.final!.effect.se, ref.finalEffectSe, 1e-7);
    near(`${w}: final χ²`, r.final!.fit.chisq, ref.finalChisq, 1e-6);
    expect(await mimicDifAnalysis.script!(o, ctx)).toContain(`p.adjust(direct$p_lrt, method = "${o.adjust}")`);
  }
}, 600_000);
