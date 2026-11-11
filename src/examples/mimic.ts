// CB-SEM example: the MIMIC (multiple indicators, multiple causes) model of
// social participation from Jöreskog & Sörbom's LISREL examples (data from
// Hodge & Treiman 1968, N = 530), the worked MIMIC example in Schumacker &
// Lomax, A Beginner's Guide to Structural Equation Modeling. Income,
// occupation and education cause a latent participation, measured by church
// attendance, memberships and friends seen. Published as a correlation matrix.

import type { Dataset } from '../engine/types';
import {
  makeCovariancesExplicit,
  newId,
  type DataInfo,
  type ModelState,
  type Settings,
} from '../model/project';

export const MIMIC_NAMES = [
  'income',
  'occupation',
  'education',
  'church',
  'memberships',
  'friends',
];
/** The published correlation matrix (lower triangle by rows), N = 530. */
export const MIMIC_R = [
  [1, 0.304, 0.305, 0.1, 0.284, 0.176],
  [0.304, 1, 0.344, 0.156, 0.192, 0.136],
  [0.305, 0.344, 1, 0.158, 0.324, 0.226],
  [0.1, 0.156, 0.158, 1, 0.36, 0.21],
  [0.284, 0.192, 0.324, 0.36, 1, 0.265],
  [0.176, 0.136, 0.226, 0.21, 0.265, 1],
];
export const MIMIC_N = 530;

export function makeMimicExample(settings: Settings): {
  name: string;
  data: Dataset;
  info: DataInfo;
  model: ModelState;
  settings: Settings;
} {
  const C = (
    name: string,
    indicators: string[],
    x: number,
    y: number,
    side: 'left' | 'right' | 'top' | 'bottom',
    extra = {},
  ) => ({
    id: newId('c'),
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
    x,
    y,
    side,
    ...extra,
  });
  const income = C('income', ['income'], 0, -220, 'left', { covariate: true });
  const occupation = C('occupation', ['occupation'], 0, 0, 'left', { covariate: true });
  const education = C('education', ['education'], 0, 220, 'left', { covariate: true });
  const participation = C(
    'Social participation',
    ['church', 'memberships', 'friends'],
    460,
    0,
    'right',
  );
  const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
  const model: ModelState = {
    constructs: [income, occupation, education, participation],
    paths: [P(income, participation), P(occupation, participation), P(education, participation)],
    moderations: [],
  };
  return {
    name: 'Social participation (MIMIC)',
    data: { names: MIMIC_NAMES, cols: [], moments: { S: MIMIC_R.map((r) => [...r]), n: MIMIC_N } },
    info: {
      fileName: 'Hodge & Treiman (1968) correlation matrix, via Jöreskog & Sörbom',
      rows: MIMIC_N,
      missingCells: 0,
      excluded: [],
      kind: 'matrix',
    },
    // (observed causes are fixed.x covariates: their correlations are the sample's, nothing to draw)
    model: { ...makeCovariancesExplicit(model), likelihood: 'wishart' }, // (N − 1, as LISREL)
    settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false },
  };
}
