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
