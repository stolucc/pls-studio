// PLS assessment in webR on cSEM's ECSI example: model selection criteria,
// MICOM's c, Klesel's dG / dL, Chin's differences and the per-group paths
// equal native cSEM (scripts/validation/plsx.R; values that do not depend on
// random draws); PLSpredict, CVPAT and permutation p-values equal cSEM called
// directly in the same session. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { categoriesOf } from '../io';
import commonR from './R/common.R?raw';
import { rCall } from './bridge';
import { compareR, groupsR, predictR, predictScriptR } from './plsx';
import { estimatePlsR } from './pls';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'plsx', 'reference.json'), 'utf8'));
const ref2 = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'plsx', 'reference2.json'), 'utf8'));
const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const comp = (name: string, ind: string[]) => ({ name, type: 'composite' as const, mode: 'B' as const, indicators: ind });
const fac = (name: string, ind: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: ind });
const P = (from: string, to: string) => ({ from, to });
const spec: ModelSpec = {
  constructs: [comp('IMAG', items('imag', 3)), comp('EXPE', items('expe', 3)), comp('QUAL', items('qual', 5)), comp('VAL', items('val', 3)), fac('SAT', items('sat', 4)), fac('LOY', items('loy', 4))],
  paths: [P('IMAG', 'EXPE'), P('EXPE', 'QUAL'), P('EXPE', 'VAL'), P('QUAL', 'VAL'), P('IMAG', 'SAT'), P('EXPE', 'SAT'), P('QUAL', 'SAT'), P('VAL', 'SAT'), P('IMAG', 'LOY'), P('SAT', 'LOY')],
};
const alt: ModelSpec = { ...spec, paths: spec.paths.filter((p) => !(p.from === 'IMAG' && p.to === 'LOY')) };
const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };
const load = async (name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'cSEM', name, na: [] }, 'cSEM');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
};
const MODEL = `EXPE ~ IMAG\\nQUAL ~ EXPE\\nVAL ~ EXPE + QUAL\\nSAT ~ IMAG + EXPE + QUAL + VAL\\nLOY ~ IMAG + SAT\\nIMAG <~ imag1 + imag2 + imag3\\nEXPE <~ expe1 + expe2 + expe3\\nQUAL <~ qual1 + qual2 + qual3 + qual4 + qual5\\nVAL <~ val1 + val2 + val3\\nSAT =~ sat1 + sat2 + sat3 + sat4\\nLOY =~ loy1 + loy2 + loy3 + loy4`;
const OPTS = '.PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300';

describe('PLS assessment (cSEM)', () => {
  it('model comparison: criteria equal native cSEM; CVPAT equals cSEM in-session', async () => {
    const d = await load('satisfaction');
    const r = await compareR(d, spec, alt, options, 1);
    const bic = r.criteria.find((c) => c.criterion === 'BIC')!.byConstruct, bicAlt = r.criteriaAlt.find((c) => c.criterion === 'BIC')!.byConstruct;
    for (const k of Object.keys(ref.msc.BIC)) { expect(bic[k], k).toBeCloseTo(ref.msc.BIC[k], 6); expect(bicAlt[k]).toBeCloseTo(ref.mscAlt.BIC[k], 6); }
    const own = await withR(['jsonlite', 'cSEM'], { common: commonR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(cSEM))
      f1 <- csem(satisfaction, "${MODEL}", ${OPTS}); f2 <- csem(satisfaction, sub("LOY ~ IMAG + SAT", "LOY ~ SAT", "${MODEL}", fixed = TRUE), ${OPTS})
      cv <- testCVPAT(f1, f2, .seed = 1, .handle_inadmissibles = "ignore"); ps_json(list(t = cv$test_statistic, p = cv$p_value))`, null)) as { t: number; p: number };
    expect(r.cvpat.statistic).toBeCloseTo(own.t, 10);
    expect(r.cvpat.p).toBeCloseTo(own.p, 10);
  }, 900_000);

  it('PLSpredict equals cSEM predict in-session', async () => {
    const d = await load('satisfaction');
    const r = await predictR(d, spec, options, { folds: 10, repetitions: 2, seed: 3 });
    const own = await withR(['jsonlite', 'cSEM'], { common: commonR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(cSEM))
      # The model's columns as numbers, in the data's order (what the app sends).
      used <- c(paste0("imag", 1:3), paste0("expe", 1:3), paste0("qual", 1:5), paste0("val", 1:3), paste0("sat", 1:4), paste0("loy", 1:4))
      d <- as.data.frame(lapply(satisfaction[, intersect(names(satisfaction), used)], as.numeric))
      f <- csem(d, "${MODEL}", ${OPTS})
      q <- lapply(1:2, function(k) predict(f, .benchmark = "lm", .cv_folds = 10, .r = 1, .seed = 3 + k, .handle_inadmissibles = "ignore")$Prediction_metrics)
      ps_json(list(q2 = (q[[1]]$Q2_predict + q[[2]]$Q2_predict) / 2, name = q[[1]]$Name))`, null)) as { q2: number[]; name: string[] };
    own.name.forEach((n, i) => expect(r.indicators.find((x) => x.indicator === n)!.q2).toBeCloseTo(own.q2[i], 10));
    expect(r.indicators.find((x) => x.indicator === 'loy1')!.construct).toBe('LOY');
    expect(await predictScriptR(d, spec, options, { folds: 10, repetitions: 2, seed: 3 })).toContain('.r = 1, .seed = 3 + k');
  }, 900_000);

  it('MICOM and multigroup analysis: deterministic parts equal native cSEM', async () => {
    const d = await load('satisfaction_gender');
    expect(d.categories?.gender).toEqual(['female', 'male']);
    const r = await groupsR(d, spec, options, { group: 'gender', approaches: ['Klesel', 'Chin', 'Henseler'], samples: 30, seed: 1 });
    for (const [k, v] of Object.entries(ref.micomC as Record<string, number>)) expect(r.micom.c[k], k).toBeCloseTo(v, 6);
    const kl = r.mga.find((a) => a.approach === 'Klesel')!.overall!;
    expect(kl.dG.statistic).toBeCloseTo(ref.klesel.dG, 6);
    expect(kl.dL.statistic).toBeCloseTo(ref.klesel.dL, 5);
    const chin = r.mga.find((a) => a.approach === 'Chin')!.comparisons![0];
    expect(chin.groups).toBe('female_male');
    expect(chin.paths.find((p) => p.from === 'SAT' && p.to === 'LOY')!.statistic!).toBeCloseTo(ref.chin['LOY ~ SAT'], 6);
    const g = (name: string) => r.groups.find((x) => x.group === name)!.paths.find((p) => p.from === 'VAL' && p.to === 'SAT')!.est;
    expect(g('female')).toBeCloseTo(ref.groups.female.SAT_VAL, 6);
    expect(g('male')).toBeCloseTo(ref.groups.male.SAT_VAL, 6);
    expect(r.groups.map((x) => x.n)).toEqual([148, 102]);
    const hen = r.mga.find((a) => a.approach === 'Henseler')!.comparisons![0];
    expect(hen.paths).toHaveLength(10);
    expect(hen.paths.every((p) => p.p >= 0 && p.p <= 1)).toBe(true);
  }, 1_800_000);

  it('GSCA, redundancy analysis and nonlinear PLSc equal native cSEM', async () => {
    const d = await load('satisfaction');
    const path = (r: Awaited<ReturnType<typeof estimatePlsR>>, a: string, b: string) => r.pathCoef[r.constructs.indexOf(a)][r.constructs.indexOf(b)];
    const g = await estimatePlsR(d, spec, { ...options, approach: 'GSCA' }, 'cSEM');
    expect(path(g, 'VAL', 'SAT')).toBeCloseTo(ref2.gsca.SAT_VAL, 6);
    expect(path(g, 'SAT', 'LOY')).toBeCloseTo(ref2.gsca.LOY_SAT, 6);
    const pm = await estimatePlsR(d, spec, options, 'cSEM');
    for (const [k, v] of Object.entries(ref2.redundancy as Record<string, number>)) expect(pm.redundancy![k], k).toBeCloseTo(v, 6);
    const sw = await load('Switching');
    const f = (name: string, ind: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: ind });
    const swSpec: ModelSpec = { constructs: [f('INV', items('INV', 4)), f('SAT', items('SAT', 3)), f('INT', items('INT', 2))], paths: [P('INV', 'INT'), P('SAT', 'INT')], moderations: [{ from: 'INV', moderator: 'SAT', to: 'INT' }] };
    const pc = await estimatePlsR(sw, swSpec, { scheme: 'factor', consistent: true, tolerance: 1e-7, maxIter: 300, missing: 'casewise' }, 'cSEM');
    expect(path(pc, 'INV', 'INT')).toBeCloseTo(ref2.plsc.INV, 6);
    expect(path(pc, 'SAT', 'INT')).toBeCloseTo(ref2.plsc.SAT, 6);
    expect(path(pc, 'INV × SAT', 'INT')).toBeCloseTo(ref2.plsc['INV.SAT'], 6);
  }, 900_000);
});
