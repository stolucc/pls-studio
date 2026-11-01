// Built-in CB-SEM examples from the classic textbooks and manuals, each
// published as a covariance or correlation matrix (as distributed with the sem
// package's documentation, where John Fox reproduces them):
//
// - Wheaton, Muthén, Alwin & Summers (1977), stability of alienation: the
//   panel model of Bollen (1989, ch. 7) and Jöreskog & Sörbom's LISREL manual,
//   with two correlated measurement errors across the 1967 and 1971 waves.
// - Thurstone's mental tests (Thurstone & Thurstone 1941): the second-order
//   confirmatory factor analysis of the SAS/STAT PROC CALIS manual.
// - Kerckhoff (1974), ambition and attainment: the observed-variable recursive
//   path model of the LISREL manual.
// - Hayduk (1987), Structural Equation Modeling with LISREL, chapter 4: smoking
//   behaviour and antismoking acts, every concept a single indicator with its
//   error variance fixed from an assessed reliability (Figures 4.5 to 4.7).
//
// Numbers pinned in the tests come from native lavaan on these matrices
// (scripts/validation is not needed: the matrices are the data).

import type { Dataset } from '../engine/types';
import { makeCovariancesExplicit, newId, type Construct, type DataInfo, type ModelState, type Settings } from '../model/project';

export interface BuiltinExample { name: string; data: Dataset; info: DataInfo; model: ModelState; settings: Settings }

/** A full symmetric matrix from its lower triangle by rows (with or without the diagonal). */
export function fromLowerTriangle(names: string[], values: number[], diagonal: boolean): number[][] {
  const p = names.length;
  const S = names.map(() => Array<number>(p).fill(0));
  let k = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= (diagonal ? i : i - 1); j++) { S[i][j] = S[j][i] = values[k++]; }
    if (!diagonal) S[i][i] = 1;
  }
  if (k !== values.length) throw new Error(`Expected ${k} values, got ${values.length}.`);
  return S;
}

const C = (name: string, indicators: string[], x: number, y: number, side: Construct['side'], extra: Partial<Construct> = {}): Construct =>
  ({ id: newId('c'), name, type: 'factor', mode: 'A', indicators, x, y, side, ...extra });
const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
const matrix = (names: string[], S: number[][], n: number): Dataset => ({ names, cols: [], moments: { S, n } });
const info = (fileName: string, n: number): DataInfo => ({ fileName, rows: n, missingCells: 0, excluded: [], kind: 'matrix' });

// ---- Wheaton et al. (1977): N = 932, covariance matrix (sem, ?sem; SAS/STAT PROC CALIS; Bollen 1989, ch. 7)
export const WHEATON_NAMES = ['Anomia67', 'Powerless67', 'Anomia71', 'Powerless71', 'Education', 'SEI'];
export const WHEATON_N = 932;
export const WHEATON_S = fromLowerTriangle(WHEATON_NAMES, [
  11.834,
  6.947, 9.364,
  6.819, 5.091, 12.532,
  4.783, 5.028, 7.495, 9.986,
  -3.839, -3.889, -3.841, -3.625, 9.610,
  -21.899, -18.831, -21.748, -18.775, 35.522, 450.288,
], true);

export function makeWheatonExample(settings: Settings): BuiltinExample {
  const ses = C('SES', ['Education', 'SEI'], 0, 0, 'left');
  const a67 = C('Alienation 1967', ['Anomia67', 'Powerless67'], 470, -180, 'top');
  const a71 = C('Alienation 1971', ['Anomia71', 'Powerless71'], 470, 180, 'bottom');
  const model: ModelState = {
    constructs: [ses, a67, a71],
    paths: [P(ses, a67), P(ses, a71), P(a67, a71)],
    moderations: [],
    // The same items four years apart: their errors covary (Jöreskog & Sörbom's model D; Bollen 1989).
    correlations: [E('Anomia67', 'Anomia71'), E('Powerless67', 'Powerless71')],
  };
  return {
    name: 'Stability of alienation (Wheaton et al. 1977)',
    data: matrix(WHEATON_NAMES, WHEATON_S.map((r) => [...r]), WHEATON_N),
    info: info('Wheaton, Muthén, Alwin & Summers (1977) covariance matrix', WHEATON_N),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}

// ---- Thurstone & Thurstone (1941): N = 213, correlation matrix of nine mental tests (SAS/STAT PROC CALIS manual; sem, ?sem)
export const THURSTONE_NAMES = ['Sentences', 'Vocabulary', 'Sent.Completion', 'First.Letters', '4.Letter.Words', 'Suffixes', 'Letter.Series', 'Pedigrees', 'Letter.Group'];
export const THURSTONE_N = 213;
export const THURSTONE_R = fromLowerTriangle(THURSTONE_NAMES, [
  0.828,
  0.776, 0.779,
  0.439, 0.493, 0.46,
  0.432, 0.464, 0.425, 0.674,
  0.447, 0.489, 0.443, 0.59, 0.541,
  0.447, 0.432, 0.401, 0.381, 0.402, 0.288,
  0.541, 0.537, 0.534, 0.35, 0.367, 0.32, 0.555,
  0.38, 0.358, 0.359, 0.424, 0.446, 0.325, 0.598, 0.452,
], false);

export function makeThurstoneExample(settings: Settings): BuiltinExample {
  const verbal = C('Verbal', ['Sentences', 'Vocabulary', 'Sent.Completion'], 0, -250, 'left');
  const fluency = C('Word fluency', ['First.Letters', '4.Letter.Words', 'Suffixes'], 0, 0, 'left');
  const reasoning = C('Reasoning', ['Letter.Series', 'Pedigrees', 'Letter.Group'], 0, 250, 'left');
  // The second-order factor is measured by the three first-order factors (lavaan: General =~ Verbal + Word fluency + Reasoning).
  const general = C('General ability', [], 480, 0, 'right', { components: [verbal.id, fluency.id, reasoning.id] });
  const model: ModelState = { constructs: [verbal, fluency, reasoning, general], paths: [], moderations: [] };
  return {
    name: 'Thurstone mental tests: second-order factor',
    data: matrix(THURSTONE_NAMES, THURSTONE_R.map((r) => [...r]), THURSTONE_N),
    info: info('Thurstone & Thurstone (1941) correlation matrix', THURSTONE_N),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}

// ---- Kerckhoff (1974): N = 737, correlation matrix (LISREL manual; sem, ?sem)
export const KERCKHOFF_NAMES = ['Intelligence', 'Siblings', 'FatherEd', 'FatherOcc', 'Grades', 'EducExp', 'OccupAsp'];
export const KERCKHOFF_N = 737;
export const KERCKHOFF_R = fromLowerTriangle(KERCKHOFF_NAMES, [
  -0.100,
  0.277, -0.152,
  0.250, -0.108, 0.611,
  0.572, -0.105, 0.294, 0.248,
  0.489, -0.213, 0.446, 0.410, 0.597,
  0.335, -0.153, 0.303, 0.331, 0.478, 0.651,
], false);

export function makeKerckhoffExample(settings: Settings): BuiltinExample {
  // Observed variables only: the four background variables are fixed exogenous (fixed.x), the three outcomes single indicators without error.
  const intelligence = C('Intelligence', ['Intelligence'], 0, -330, 'left', { covariate: true });
  const siblings = C('Siblings', ['Siblings'], 0, -110, 'left', { covariate: true });
  const fatherEd = C('FatherEd', ['FatherEd'], 0, 110, 'left', { covariate: true });
  const fatherOcc = C('FatherOcc', ['FatherOcc'], 0, 330, 'left', { covariate: true });
  const grades = C('Grades', ['Grades'], 450, -220, 'top');
  const educExp = C('EducExp', ['EducExp'], 450, 220, 'bottom');
  const occupAsp = C('OccupAsp', ['OccupAsp'], 900, 0, 'right');
  const background = [intelligence, siblings, fatherEd, fatherOcc];
  const model: ModelState = {
    constructs: [...background, grades, educExp, occupAsp],
    paths: [
      ...background.map((b) => P(b, grades)),
      ...background.map((b) => P(b, educExp)), P(grades, educExp),
      ...background.map((b) => P(b, occupAsp)), P(grades, occupAsp), P(educExp, occupAsp),
    ],
    moderations: [],
  };
  return {
    name: 'Ambition and attainment (Kerckhoff 1974)',
    data: matrix(KERCKHOFF_NAMES, KERCKHOFF_R.map((r) => [...r]), KERCKHOFF_N),
    info: info('Kerckhoff (1974) correlation matrix, via the LISREL manual', KERCKHOFF_N),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}

// ---- Hayduk (1987), ch. 4, "A real model: smoking behavior and antismoking acts": N = 432 (listwise), Figure 4.5
export const HAYDUK_NAMES = ['Sex', 'Age', 'Education', 'R-attend', 'R-strength', 'R-import', 'R-God-E', 'S-current', 'S-amount', 'S-history', 'S-p-strain', 'AS-views', 'AS-acts'];
export const HAYDUK_N = 432;
/** The covariances of Figure 4.5 (all thirteen indicators; the chapter's model uses seven). */
export const HAYDUK_S = fromLowerTriangle(HAYDUK_NAMES, [
  0.250,
  0.167, 246.898,
  0.016, -7.251, 6.909,
  0.139, 7.239, 0.233, 4.657,
  -0.010, -1.232, -0.025, -0.464, 0.206,
  0.150, 8.907, -0.233, 2.922, -0.511, 4.466,
  0.088, 1.088, -0.584, 1.204, -0.116, 1.225, 2.146,
  -0.010, -0.907, -0.213, -0.188, 0.033, -0.076, -0.026, 0.247,
  -0.015, -2.003, -0.623, -0.476, 0.065, -0.190, -0.053, 0.540, 1.417,
  -0.035, -1.467, -0.248, -0.324, 0.063, -0.156, -0.045, 0.344, 0.752, 0.612,
  -0.042, -2.599, -0.667, -0.606, 0.094, -0.269, -0.067, 0.636, 1.631, 1.017, 2.016,
  0.153, 4.850, 0.375, 0.553, -0.071, 0.516, 0.401, -0.234, -0.625, -0.352, -0.745, 3.314,
  0.044, -1.366, 0.357, -0.154, 0.001, -0.069, 0.141, -0.084, -0.203, -0.085, -0.203, 0.291, 1.302,
], true);
/** Figure 4.5, "assessed proportion of error variance" of the seven indicators the model uses: reliability = 1 − proportion. */
export const HAYDUK_RELIABILITY: Record<string, number> = { Sex: 0.99, Age: 0.95, Education: 0.90, 'R-attend': 0.90, 'S-current': 0.90, 'AS-views': 0.95, 'AS-acts': 0.95 };

export function makeHaydukExample(settings: Settings): BuiltinExample {
  // Every concept has one indicator whose error variance is fixed at the assessed proportion of its variance (THETA in Figure 4.7):
  // the exogenous concepts are latent too (PHI is estimated), so they are not fixed.x covariates.
  const single = (name: string, indicator: string, x: number, y: number, side: Construct['side']) => C(name, [indicator], x, y, side, { reliability: HAYDUK_RELIABILITY[indicator] });
  const sex = single('Sex', 'Sex', 0, -330, 'left');
  const age = single('Age', 'Age', 0, -110, 'left');
  const education = single('Education', 'Education', 0, 110, 'left');
  const religion = single('Strength of religion', 'R-attend', 0, 330, 'left');
  const smoking = single('Smoking', 'S-current', 500, -270, 'top');
  const views = single('Antismoking views', 'AS-views', 500, 270, 'bottom');
  const acts = single('Antismoking acts', 'AS-acts', 1000, 0, 'right');
  const exogenous = [sex, age, education, religion];
  const model: ModelState = {
    constructs: [...exogenous, smoking, views, acts],
    paths: [
      ...exogenous.map((x) => P(x, smoking)),
      P(smoking, views), ...exogenous.map((x) => P(x, views)),
      // gamma 32 (age -> antismoking acts) is fixed at zero in the book.
      P(smoking, acts), P(views, acts), P(sex, acts), P(education, acts), P(religion, acts),
    ],
    moderations: [],
  };
  return {
    name: 'Smoking behaviour and antismoking acts (Hayduk 1987)',
    data: matrix(HAYDUK_NAMES, HAYDUK_S.map((r) => [...r]), HAYDUK_N),
    info: info('Hayduk (1987), Figure 4.5 covariance matrix', HAYDUK_N),
    // Known reliabilities are estimated by lavaan (the built-in engine does not fix error variances).
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' },
  };
}
