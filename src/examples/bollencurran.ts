// Built-in examples from Bollen & Curran (2004), "Autoregressive latent
// trajectory (ALT) models: a synthesis of two traditions", Sociological Methods
// & Research 32: the artificial five-wave covariance matrix of their
// illustration (N = 500; typed from the lavaan reproduction in
// github.com/cddesja/lavaan-reproducible), drawn as diagrams: the waves are
// single-indicator constructs, the intercept and slope higher-order factors
// with loadings held at 1, 1, 1, 1, 1 and 0, 1, 2, 3, 4 (the latent curve
// model), and in the ALT model each wave also predicts the next. The matrix
// was generated from a latent curve, so both fit exactly and the
// autoregressive coefficients are nil: the point is the specification.
// Reference: native lavaan (scripts/validation/bollencurran.R).

import type { Dataset } from '../engine/types';
import {
  makeCovariancesExplicit,
  newId,
  type Construct,
  type DataInfo,
  type ModelState,
  type Settings,
} from '../model/project';
import { fromLowerTriangle, type BuiltinExample } from './textbook';

export const BC_NAMES = ['t1', 't2', 't3', 't4', 't5'];
export const BC_N = 500;
export const BC_S = fromLowerTriangle(
  BC_NAMES,
  [
    0.619, 0.453, 0.595, 0.438, 0.438, 0.587, 0.422, 0.43, 0.438, 0.595, 0.406, 0.422, 0.438, 0.453,
    0.619,
  ],
  true,
);

const C = (
  name: string,
  indicators: string[],
  x: number,
  y: number,
  side: Construct['side'],
  extra: Partial<Construct> = {},
): Construct => ({
  id: newId('c'),
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x,
  y,
  side,
  ...extra,
});
const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
const data = (): Dataset => ({
  names: BC_NAMES,
  cols: [],
  moments: { S: BC_S.map((r) => [...r]), n: BC_N },
});
const info: DataInfo = {
  fileName: 'Bollen & Curran (2004) artificial covariance matrix, five waves',
  rows: BC_N,
  missingCells: 0,
  excluded: [],
  kind: 'matrix',
};

/** The five waves as single-indicator constructs in a row, and intercept and slope factors above them with held loadings. */
function curve(
  waves: string[],
  firstLoadingOfSlope: number,
): { t: Construct[]; intercept: Construct; slope: Construct } {
  const t = waves.map((w, i) => C(w, [w], i * 260, 300, 'bottom'));
  const intercept = C('Intercept', [], 260, -120, 'top', {
    components: t.map((c) => c.id),
    componentLoadings: Object.fromEntries(t.map((c) => [c.id, 1])),
  });
  const slope = C('Slope', [], 780, -120, 'top', {
    components: t.map((c) => c.id),
    componentLoadings: Object.fromEntries(t.map((c, i) => [c.id, firstLoadingOfSlope + i])),
  });
  return { t, intercept, slope };
}

export function makeBollenCurranLcmExample(settings: Settings): BuiltinExample {
  const { t, intercept, slope } = curve(BC_NAMES, 0);
  const model: ModelState = { constructs: [...t, intercept, slope], paths: [], moderations: [] };
  return {
    name: 'Latent curve model (Bollen & Curran 2004)',
    data: data(),
    info,
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}

export function makeBollenCurranAltExample(settings: Settings): BuiltinExample {
  // The first wave predetermined: exogenous, correlated with intercept and slope; the curve runs over waves 2 to 5
  // (slope loadings 1, 2, 3, 4) and each wave predicts the next.
  const t1 = C('t1', ['t1'], 0, 300, 'bottom');
  const { t, intercept, slope } = curve(BC_NAMES.slice(1), 1);
  t.forEach((c, i) => {
    c.x = (i + 1) * 260;
  });
  const model: ModelState = {
    constructs: [t1, ...t, intercept, slope],
    paths: [P(t1, t[0]), P(t[0], t[1]), P(t[1], t[2]), P(t[2], t[3])],
    moderations: [],
  };
  // (a component with a predictor is estimated by lavaan)
  return {
    name: 'Autoregressive latent trajectory model (Bollen & Curran 2004)',
    data: data(),
    info,
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' },
  };
}
