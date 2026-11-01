// Built-in examples from Bollen (1989), Structural Equations with Latent
// Variables (Wiley): the worked examples whose data the book prints as
// covariance or correlation matrices. Each is fitted as the book fits it
// (LISREL: maximum likelihood with N − 1, the Wishart likelihood);
// scripts/validation/bollen1989.R writes the native-lavaan reference and the
// book's printed values that the tests compare with. Only the numbers are used.

import type { Dataset } from '../engine/types';
import { momentsOfGroups } from '../data/moments';
import { autoLayout } from '../model/layout';
import { makeCovariancesExplicit, newId, type Construct, type DataInfo, type ModelState, type Settings } from '../model/project';
import { covFromCor } from './kline';
import type { BuiltinExample } from './textbook';

const C = (name: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id: newId('c'), name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
const P = (f: { id: string }, t: { id: string }, label?: string) => ({ id: newId('p'), from: f.id, to: t.id, ...(label ? { label } : {}) });
const K = (a: { id: string }, b: { id: string }) => ({ id: newId('k'), kind: 'construct' as const, a: a.id, b: b.id });
const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
/** A full symmetric matrix from its lower triangle (with the diagonal), row by row. */
export function lowerToFull(lower: number[], p: number): number[][] {
  const S = Array.from({ length: p }, () => Array<number>(p).fill(0));
  let k = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j <= i; j++) { S[i][j] = S[j][i] = lower[k++]; }
  if (k !== lower.length) throw new Error(`Expected ${k} values, got ${lower.length}.`);
  return S;
}
const info = (fileName: string, n: number): DataInfo => ({ fileName, rows: n, missingCells: 0, excluded: [], kind: 'matrix' });
const finish = (name: string, data: Dataset, fileName: string, model: ModelState, settings: Settings): BuiltinExample => {
  const laid = { ...model, constructs: autoLayout(model) };
  // LISREL's convention, as the book: N − 1 and the matrix as given. (The Wishart likelihood is a lavaan option: R engine.)
  return { name, data, info: info(fileName, data.moments!.n), model: { ...makeCovariancesExplicit(laid), likelihood: 'wishart' }, settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' } };
};
const BOLLEN = 'Bollen (1989), Structural Equations with Latent Variables';

// ---- Kluegel et al. (1977): objective and subjective socioeconomic status of whites (ch. 4, 5 and 8; N = 432)
// y1 subjective income, y2 subjective occupational prestige, y3 subjective overall status, x1 income, x2 occupational prestige.
export const SES_NAMES = ['subjIncome', 'subjPrestige', 'subjStatus', 'income', 'prestige'];
export const SES_WHITES = lowerToFull([0.449, 0.166, 0.410, 0.226, 0.173, 0.393, 0.564, 0.259, 0.382, 4.831, 2.366, 3.840, 3.082, 13.656, 452.711], 5);
export const SES_BLACKS = lowerToFull([0.663, 0.334, 0.558, 0.301, 0.282, 0.615, 0.724, 0.420, 0.391, 4.397, 2.417, 3.357, 1.806, 7.485, 263.218], 5);
function sesConstructs(freeError: boolean) {
  const opt = freeError ? { freeError: true } : {};
  // With measurement error the latent variables differ from their indicators: named apart.
  const sInc = C(freeError ? 'Subjective income' : 'subjIncome', ['subjIncome'], opt), sPre = C(freeError ? 'Subjective prestige' : 'subjPrestige', ['subjPrestige'], opt), sSta = C('subjStatus', ['subjStatus']);
  const inc = C('income', ['income']), pre = C('prestige', ['prestige']);
  // Income and prestige are exogenous with free variances and covariance (the book estimates Φ), not fixed.x covariates.
  return { sInc, sPre, sSta, inc, pre, paths: [P(inc, sInc), P(sPre, sInc), P(pre, sPre), P(sInc, sPre), P(sInc, sSta), P(sPre, sSta)] };
}
export function makeSesExample(settings: Settings): BuiltinExample {
  const { sInc, sPre, sSta, inc, pre, paths } = sesConstructs(false);
  // Exactly identified: the three disturbances covary (Table 4.2: ψ21, ψ31, ψ32).
  const model: ModelState = { constructs: [inc, pre, sInc, sPre, sSta], paths, moderations: [], correlations: [K(sInc, sPre), K(sInc, sSta), K(sPre, sSta)] };
  return finish('Objective and subjective status (Kluegel et al. 1977)', { names: SES_NAMES, cols: [], moments: { S: SES_WHITES, n: 432 } }, `${BOLLEN}, ch. 4: covariance matrix of whites`, model, settings);
}
export function makeSesErrorExample(settings: Settings): BuiltinExample {
  const { sInc, sPre, sSta, inc, pre, paths } = sesConstructs(true);
  // Figure 5.4: the disturbances uncorrelated, and subjective income and prestige measured with error (variances estimated).
  const model: ModelState = { constructs: [inc, pre, sInc, sPre, sSta], paths, moderations: [] };
  return finish('Subjective status with measurement error (Kluegel et al. 1977)', { names: SES_NAMES, cols: [], moments: { S: SES_WHITES, n: 432 } }, `${BOLLEN}, ch. 5: covariance matrix of whites`, model, settings);
}
export function makeSesGroupsExample(settings: Settings): BuiltinExample {
  const { sInc, sPre, sSta, inc, pre, paths } = sesConstructs(true);
  // Figure 8.13 in two groups, Γ and B equal across them (the book's H_ΓB); error and disturbance variances free per group.
  const model: ModelState = {
    constructs: [inc, pre, sInc, sPre, sSta], paths, moderations: [],
    multigroup: { column: '', invariance: 'configural', structural: ['regressions'], free: [], meanStructure: false },
  };
  // (The whites' variance of prestige is 452.711 in ch. 4; Table 8.5 prints 452.77, a misprint: 452.711 as in chs. 4 and 5.)
  const data: Dataset = { names: SES_NAMES, cols: [], moments: momentsOfGroups([{ label: 'Blacks', S: SES_BLACKS, n: 368 }, { label: 'Whites', S: SES_WHITES, n: 432 }]) };
  return finish('Status of blacks and whites: equal coefficients (Kluegel et al. 1977)', data, `${BOLLEN}, ch. 8: covariance matrices of blacks and whites`, model, settings);
}

// ---- Morale and sense of belonging of female and male students, with means (ch. 8)
// Table 8.7's heading gives N = 47 and 59, the text 49 and 57; the text's Ns reproduce the chi-squares of Table 8.8.
export const MORALE_NAMES = ['morale1', 'morale2', 'morale3', 'morale4', 'belong1', 'belong2', 'belong3'];
export const MORALE_GROUPS = [
  { label: 'Females', n: 49, S: lowerToFull([4.023, -2.954, 7.223, 2.256, -2.340, 2.665, 1.808, -2.598, 1.965, 2.473, 2.756, -3.163, 2.517, 2.121, 3.969, 2.132, -1.997, 1.772, 1.455, 2.690, 4.604, 1.978, -2.614, 1.810, 1.677, 2.410, 1.835, 4.267], 7), means: [8.347, 2.163, 9.041, 8.837, 8.102, 7.980, 8.061] },
  { label: 'Males', n: 57, S: lowerToFull([4.096, -2.663, 5.446, 2.762, -2.334, 2.848, 2.917, -2.514, 2.471, 3.429, 3.553, -3.479, 2.919, 3.017, 4.707, 3.652, -3.403, 2.773, 3.420, 4.039, 6.070, 3.522, -3.142, 2.811, 3.331, 3.923, 4.146, 4.427], 7), means: [8.105, 2.018, 8.719, 8.772, 7.842, 7.579, 7.965] },
];
export function makeMoraleExample(settings: Settings): BuiltinExample {
  // The book's H_Λν: loadings and intercepts equal; the latent means of the males estimated relative to the females'.
  const morale = C('Morale', MORALE_NAMES.slice(0, 4)), belong = C('Belonging', MORALE_NAMES.slice(4));
  const model: ModelState = {
    constructs: [morale, belong], paths: [], moderations: [],
    multigroup: { column: '', invariance: 'scalar', free: [] },
  };
  const data: Dataset = { names: MORALE_NAMES, cols: [], moments: momentsOfGroups(MORALE_GROUPS.map((g) => ({ ...g, S: g.S.map((r) => [...r]), means: [...g.means] }))) };
  return finish('Morale and belonging of female and male students', data, `${BOLLEN}, ch. 8: covariance matrices and means of females and males`, model, settings);
}

// ---- Political democracy in 1960 and 1965, a two-wave CFA (ch. 7; N = 75)
// Freedom of the press, of group opposition, fairness of elections, elected legislature; the same four in 1965.
export const DEM_NAMES = ['press60', 'opposition60', 'elections60', 'legislature60', 'press65', 'opposition65', 'elections65', 'legislature65'];
export const DEM_S = covFromCor([1, 0.604, 1, 0.679, 0.451, 1, 0.693, 0.719, 0.609, 1, 0.739, 0.543, 0.576, 0.652, 1, 0.650, 0.705, 0.427, 0.659, 0.565, 1, 0.674, 0.581, 0.650, 0.680, 0.678, 0.609, 1, 0.666, 0.606, 0.530, 0.737, 0.630, 0.753, 0.712, 1],
  [2.623, 3.947, 3.281, 3.349, 2.613, 3.373, 3.286, 3.246]);
export function makeDemocracyCfaExample(settings: Settings, errors: 'correlated' | 'uncorrelated'): BuiltinExample {
  // Loadings equal over the waves (the labels l2 to l4); each indicator's errors covary over time, and those of the two indicators from one source in a year.
  const labels = (y: string) => ({ [`opposition${y}`]: 'l2', [`elections${y}`]: 'l3', [`legislature${y}`]: 'l4' });
  const d60 = C('Democracy60', DEM_NAMES.slice(0, 4), { loadingLabels: labels('60') }), d65 = C('Democracy65', DEM_NAMES.slice(4), { loadingLabels: labels('65') });
  const model: ModelState = {
    constructs: [d60, d65], paths: [], moderations: [],
    ...(errors === 'correlated' ? { correlations: [E('press60', 'press65'), E('opposition60', 'opposition65'), E('elections60', 'elections65'), E('legislature60', 'legislature65'), E('opposition60', 'legislature60'), E('opposition65', 'legislature65')] } : {}),
  };
  return finish(`Political democracy 1960 and 1965: ${errors} errors`, { names: DEM_NAMES, cols: [], moments: { S: DEM_S, n: 75 } }, `${BOLLEN}, ch. 7: correlations and standard deviations`, model, settings);
}

// ---- Cermak: perceived air quality, a one-factor CFA that fits poorly (ch. 7; N = 57)
export const AIR_NAMES = ['overall', 'clarity', 'color', 'odor'];
export const AIR_S = lowerToFull([0.331, 0.431, 1.160, 0.406, 0.847, 0.898, 0.216, 0.272, 0.312, 0.268], 4);
export function makeAirQualityExample(settings: Settings): BuiltinExample {
  const model: ModelState = { constructs: [C('Air quality', AIR_NAMES)], paths: [], moderations: [] };
  return finish('Perceived air quality: a poor fit and its modification indices', { names: AIR_NAMES, cols: [], moments: { S: AIR_S, n: 57 } }, `${BOLLEN}, ch. 7: covariance matrix`, model, settings);
}
