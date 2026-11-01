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
//   error variance fixed from an assessed reliability (Figures 4.5 to 4.7);
//   and its chapter-9 stacked model: younger and older respondents, one
//   covariance matrix each, the coefficients equal across the groups except
//   those Figure 9.1 draws heavy; and its chapter-8 revised model (Figure 8.6),
//   smoking and antismoking views causing each other.
// - Duncan, Haller & Portes (1968), peer influences on aspirations: the
//   non-recursive model of the sem documentation (reciprocal effects of the
//   respondent's and the friend's aspirations, correlated disturbances).
//
// Numbers pinned in the tests come from native lavaan on these matrices
// (scripts/validation is not needed: the matrices are the data).

import type { Dataset } from '../engine/types';
import { momentsOfGroups } from '../data/moments';
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

/**
 * The seven single-indicator concepts of the smoking model and its paths.
 * ch4: Figure 4.6; ch9: with the age -> acts path (the stacked model); revised:
 * Figure 8.6, where views also cause smoking (identified by dropping sex -> smoking and religion -> views).
 */
function haydukModel(variant: 'ch4' | 'ch9' | 'revised') {
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
  const paths = variant === 'revised'
    ? [
      P(views, smoking), P(age, smoking), P(education, smoking), P(religion, smoking),
      P(smoking, views), P(sex, views), P(age, views), P(education, views),
      P(smoking, acts), P(views, acts), P(sex, acts), P(education, acts), P(religion, acts),
    ]
    : [
      ...exogenous.map((x) => P(x, smoking)),
      P(smoking, views), ...exogenous.map((x) => P(x, views)),
      // gamma 32 (age -> antismoking acts) is fixed at zero in chapter 4; chapter 9 brings it back (the groups are age groups).
      P(smoking, acts), P(views, acts), P(sex, acts), ...(variant === 'ch9' ? [P(age, acts)] : []), P(education, acts), P(religion, acts),
    ];
  const model: ModelState = { constructs: [...exogenous, smoking, views, acts], paths, moderations: [] };
  return { model, sex, age, education, religion, smoking, views, acts };
}

export function makeHaydukExample(settings: Settings): BuiltinExample {
  const { model } = haydukModel('ch4');
  return {
    name: 'Smoking behaviour and antismoking acts (Hayduk 1987)',
    data: matrix(HAYDUK_NAMES, HAYDUK_S.map((r) => [...r]), HAYDUK_N),
    info: info('Hayduk (1987), Figure 4.5 covariance matrix', HAYDUK_N),
    // Known reliabilities are estimated by lavaan (the built-in engine does not fix error variances).
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' },
  };
}

// ---- Hayduk (1987), ch. 9, "Stacked models for multiple groups": Figure 9.2, younger (33 or younger, N = 213) and older (N = 219)
// respondents; the estimates are his Figure 9.4 (p. 285), which the webR test reproduces.
export const HAYDUK_STACKED_NAMES = ['S-current', 'S-p-strain', 'AS-views', 'AS-acts', 'Sex', 'Age', 'Education', 'R-attend', 'R-import'];
/** Younger respondents: the upper-right triangle of Figure 9.2 (covariances) and the variances of its table. */
export const HAYDUK_YOUNGER_S = fromLowerTriangle(HAYDUK_STACKED_NAMES, [
  0.251,
  0.636, 1.974,
  -0.332, -1.118, 4.088,
  -0.158, -0.401, 0.527, 1.359,
  -0.009, -0.035, 0.193, 0.091, 0.250,
  -0.151, -0.586, 0.113, 0.270, 0.042, 15.68,
  -0.304, -0.983, 0.682, 0.568, 0.053, 2.311, 5.030,
  -0.164, -0.616, 0.339, -0.179, 0.107, 0.540, 0.442, 4.171,
  -0.025, -0.178, 0.183, -0.255, 0.055, 0.849, 0.162, 2.690, 4.723,
], true);
/** Older respondents: the lower-left triangle of Figure 9.2. */
export const HAYDUK_OLDER_S = fromLowerTriangle(HAYDUK_STACKED_NAMES, [
  0.243,
  0.631, 2.046,
  -0.114, -0.306, 2.273,
  -0.016, -0.024, 0.106, 1.245,
  -0.009, -0.044, 0.099, 0.002, 0.251,
  -0.820, -2.058, -0.065, -1.602, -0.222, 173.51,
  -0.141, -0.414, 0.274, 0.125, -0.011, -10.433, 8.642,
  -0.182, -0.504, 0.404, -0.079, 0.151, 2.533, 0.261, 4.727,
  -0.096, -0.269, 0.502, 0.160, 0.225, 6.089, -0.398, 2.760, 3.853,
], true);
export const HAYDUK_STACKED_N = { younger: 213, older: 219 };

export function makeHaydukStackedExample(settings: Settings): BuiltinExample {
  const h = haydukModel('ch9');
  // The heavy arrows of Figure 9.1: coefficients allowed to differ between the age groups; every other coefficient is equal.
  const heavy: [Construct, Construct][] = [
    [h.sex, h.acts], [h.age, h.smoking], [h.age, h.views], [h.age, h.acts], [h.education, h.smoking], [h.education, h.views], [h.education, h.acts], [h.smoking, h.views], [h.smoking, h.acts],
  ];
  const model: ModelState = {
    ...h.model,
    multigroup: { column: '', invariance: 'configural', structural: ['regressions'], free: heavy.map(([from, to]) => ({ kind: 'regression' as const, from: from.id, to: to.id })) },
  };
  const groups = [{ label: 'Younger', S: HAYDUK_YOUNGER_S.map((r) => [...r]), n: HAYDUK_STACKED_N.younger }, { label: 'Older', S: HAYDUK_OLDER_S.map((r) => [...r]), n: HAYDUK_STACKED_N.older }];
  const n = HAYDUK_STACKED_N.younger + HAYDUK_STACKED_N.older;
  return {
    name: 'Stacked smoking model: younger and older respondents (Hayduk 1987)',
    data: { names: HAYDUK_STACKED_NAMES, cols: [], moments: momentsOfGroups(groups) },
    info: info('Hayduk (1987), Figure 9.2 covariance matrices (younger, older)', n),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' },
  };
}

export function makeHaydukRevisedExample(settings: Settings): BuiltinExample {
  const { model } = haydukModel('revised');
  return {
    name: 'Revised smoking model: views and smoking cause each other (Hayduk 1987)',
    data: matrix(HAYDUK_NAMES, HAYDUK_S.map((r) => [...r]), HAYDUK_N),
    info: info('Hayduk (1987), Figure 4.5 covariance matrix', HAYDUK_N),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' },
  };
}

// ---- Duncan, Haller & Portes (1968): N = 329, correlation matrix (sem, ?sem; Duncan, Haller & Portes, AJS 74)
export const DHP_NAMES = ['ROccAsp', 'REdAsp', 'FOccAsp', 'FEdAsp', 'RParAsp', 'RIQ', 'RSES', 'FSES', 'FIQ', 'FParAsp'];
export const DHP_N = 329;
export const DHP_R = fromLowerTriangle(DHP_NAMES, [
  0.6247,
  0.3269, 0.3669,
  0.4216, 0.3275, 0.6404,
  0.2137, 0.2742, 0.1124, 0.0839,
  0.4105, 0.4043, 0.2903, 0.2598, 0.1839,
  0.3240, 0.4047, 0.3054, 0.2786, 0.0489, 0.2220,
  0.2930, 0.2407, 0.4105, 0.3607, 0.0186, 0.1861, 0.2707,
  0.2995, 0.2863, 0.5191, 0.5007, 0.0782, 0.3355, 0.2302, 0.2950,
  0.0760, 0.0702, 0.2784, 0.1988, 0.1147, 0.1021, 0.0931, -0.0438, 0.2087,
], false);

export function makeDhpExample(settings: Settings): BuiltinExample {
  // Six observed background variables (fixed.x), the respondent's and the friend's general aspirations as factors of
  // their occupational and educational aspirations, each influencing the other (non-recursive), disturbances correlated.
  const cov = (name: string, y: number) => C(name, [name], 0, y, 'left', { covariate: true });
  const rPar = cov('RParAsp', -500), rIq = cov('RIQ', -300), rSes = cov('RSES', -100), fSes = cov('FSES', 100), fIq = cov('FIQ', 300), fPar = cov('FParAsp', 500);
  const rGen = C('RGenAsp', ['ROccAsp', 'REdAsp'], 560, -220, 'top');
  const fGen = C('FGenAsp', ['FOccAsp', 'FEdAsp'], 560, 220, 'bottom');
  const model: ModelState = {
    constructs: [rPar, rIq, rSes, fSes, fIq, fPar, rGen, fGen],
    paths: [P(rPar, rGen), P(rIq, rGen), P(rSes, rGen), P(fSes, rGen), P(fGen, rGen), P(rSes, fGen), P(fSes, fGen), P(fIq, fGen), P(fPar, fGen), P(rGen, fGen)],
    moderations: [],
    correlations: [{ id: newId('k'), kind: 'construct', a: rGen.id, b: fGen.id }],
  };
  return {
    name: 'Peer influences on aspirations (Duncan, Haller & Portes 1968)',
    data: matrix(DHP_NAMES, DHP_R.map((r) => [...r]), DHP_N),
    info: info('Duncan, Haller & Portes (1968) correlation matrix, via the sem package', DHP_N),
    model: makeCovariancesExplicit(model),
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}
