import type { CbEstimator } from '../engine/cbsem';
import { clampStrict, isObj } from '../parse';
import type { McDesign, McEstimator } from '../engine/montecarlo';
import type { PopulationSpec } from '../engine/population';
import type { CbResult } from '../engine/cbsem';
import type { PlsResult } from '../engine/types';
import type { ModelState } from './project';

export const ESTIMATOR_CHOICES: McEstimator[] = [
  { id: 'PLS', method: 'pls', consistent: false },
  { id: 'PLSc', method: 'pls', consistent: true },
  ...(['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS'] as CbEstimator[]).map(
    (e): McEstimator => ({ id: `CB-${e}`, method: 'cb', estimator: e }),
  ),
];

/**
 * Population for the current model: values from fresh estimates when
 * available (PLSc / CB standardised values are consistent for common factors),
 * otherwise neutral defaults (loadings .75, weights equal, paths .3).
 */
export function populationFromModel(
  model: ModelState,
  pls: PlsResult | null,
  cb: CbResult | null,
): PopulationSpec {
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  const constructs = model.constructs.map((c) => {
    const base = { name: c.name, type: c.type, indicators: c.indicators };
    if (c.type === 'factor') {
      const loadings = c.indicators.map((ind) => {
        const kc = cb ? cb.indicators.findIndex((x) => x.name === ind) : -1;
        if (cb && kc >= 0) return clampLoading(cb.stdLoadings[kc]);
        const kp = pls ? pls.indicators.findIndex((x) => x.name === ind) : -1;
        return pls && kp >= 0 ? clampLoading(pls.loadings[kp]) : 0.75;
      });
      return { ...base, loadings };
    }
    const weights = c.indicators.map((ind) => {
      const kp = pls ? pls.indicators.findIndex((x) => x.name === ind) : -1;
      return pls && kp >= 0 ? round(pls.weights[kp]) : 1;
    });
    return { ...base, weights, withinCor: 0.5 };
  });
  const paths = model.paths.map((p) => {
    const f = name.get(p.from)!,
      t = name.get(p.to)!;
    let value = 0.3;
    if (cb) {
      const i = cb.constructs.indexOf(f),
        j = cb.constructs.indexOf(t);
      if (i >= 0 && j >= 0) value = cb.stdPaths[i][j];
    } else if (pls) {
      const i = pls.constructs.indexOf(f),
        j = pls.constructs.indexOf(t);
      if (i >= 0 && j >= 0) value = pls.pathCoef[i][j];
    }
    return { from: f, to: t, value: round(value) };
  });
  const exo = model.constructs
    .filter((c) => !model.paths.some((p) => p.to === c.id))
    .map((c) => c.name);
  const exoCor: PopulationSpec['exoCor'] = [];
  for (let a = 0; a < exo.length; a++)
    for (let b = a + 1; b < exo.length; b++) {
      let value = 0.3;
      const src = cb ?? pls;
      if (src) {
        const C = src.constructs,
          i = C.indexOf(exo[a]),
          j = C.indexOf(exo[b]);
        const m = cb ? cb.lvCor : pls!.constructCor;
        if (i >= 0 && j >= 0) value = round(m[i][j]);
      }
      exoCor.push({ a: exo[a], b: exo[b], value });
    }
  return { constructs, paths, exoCor, skew: 0, kurtosis: 0 };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const clampLoading = (v: number) => round(Math.max(-0.95, Math.min(0.95, v)));

export const defaultDesign = (population: PopulationSpec): McDesign => ({
  population,
  estimators: ESTIMATOR_CHOICES.filter(
    (e) => e.id === 'PLS' || e.id === 'PLSc' || e.id === 'CB-ML',
  ),
  sampleSizes: [100, 200, 300, 500],
  replications: 200,
  seed: 2026,
  alpha: 0.05,
  bootSamples: 200,
  mcDraws: 1000,
});

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');

/** Validate an untrusted design from a project file; null if unusable. */
export function parseDesign(raw: unknown): McDesign | null {
  if (!isObj(raw) || !isObj(raw.population)) return null;
  const p = raw.population;
  if (!Array.isArray(p.constructs) || !Array.isArray(p.paths) || p.constructs.length > 500)
    return null;
  const nums = (a: unknown, lo: number, hi: number) =>
    Array.isArray(a) ? a.slice(0, 1000).map((v) => clampStrict(v, lo, hi, 0)) : undefined;
  const population: PopulationSpec = {
    constructs: p.constructs.filter(isObj).map((c) => ({
      name: str(c.name),
      type: c.type === 'composite' ? 'composite' : 'factor',
      indicators: Array.isArray(c.indicators) ? c.indicators.slice(0, 1000).map(str) : [],
      loadings: nums(c.loadings, -0.999, 0.999),
      weights: nums(c.weights, -100, 100),
      withinCor: c.withinCor === undefined ? undefined : clampStrict(c.withinCor, -0.99, 0.99, 0.5),
      ...(c.skew !== undefined ? { skew: clampStrict(c.skew, -5, 5, 0) } : {}),
      ...(c.kurtosis !== undefined ? { kurtosis: clampStrict(c.kurtosis, -1.2, 60, 0) } : {}),
    })),
    paths: p.paths
      .filter(isObj)
      .slice(0, 5000)
      .map((x) => ({
        from: str(x.from),
        to: str(x.to),
        value: clampStrict(x.value, -0.999, 0.999, 0),
      })),
    exoCor: Array.isArray(p.exoCor)
      ? p.exoCor
          .filter(isObj)
          .slice(0, 5000)
          .map((x) => ({ a: str(x.a), b: str(x.b), value: clampStrict(x.value, -0.999, 0.999, 0) }))
      : [],
    skew: clampStrict(p.skew, -5, 5, 0),
    kurtosis: clampStrict(p.kurtosis, -1.2, 60, 0),
  };
  const ids = Array.isArray(raw.estimators) ? raw.estimators.filter(isObj).map((e) => e.id) : [];
  const estimators = ESTIMATOR_CHOICES.filter((e) => ids.includes(e.id));
  const sizes = Array.isArray(raw.sampleSizes)
    ? raw.sampleSizes
        .map((v) => Math.round(clampStrict(v, 10, 100000, 0)))
        .filter((v) => v >= 10)
        .slice(0, 20)
    : [];
  return {
    population,
    estimators: estimators.length ? estimators : ESTIMATOR_CHOICES.slice(0, 1),
    sampleSizes: sizes.length ? sizes : [100, 200],
    replications: Math.round(clampStrict(raw.replications, 2, 100000, 200)),
    seed: Math.round(clampStrict(raw.seed, 0, 2 ** 31, 2026)),
    alpha: clampStrict(raw.alpha, 0.001, 0.2, 0.05),
    bootSamples: Math.round(clampStrict(raw.bootSamples, 0, 10000, 200)),
    mcDraws: Math.round(clampStrict(raw.mcDraws, 0, 1000000, 1000)),
  };
}
