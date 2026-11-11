// Built-in examples from Kline (2023), Principles and Practice of Structural
// Equation Modeling, 5th ed. (Guilford): the detailed examples whose data are
// correlation matrices with standard deviations (and means), as in his
// companion files (guilford.com/add/kline). Each reproduces the output printed
// there (scripts/validation/kline.R writes the reference the webR test uses).

import type { Dataset } from '../engine/types';
import { autoLayout } from '../model/layout';
import {
  makeCovariancesExplicit,
  newId,
  type Construct,
  type DataInfo,
  type ModelState,
  type Settings,
} from '../model/project';
import { momentsOfGroups } from '../data/moments';
import type { BuiltinExample } from './textbook';

/** lavaan's getCov + cor2cov: a full covariance matrix from a lower triangle of correlations (with the diagonal) and standard deviations. */
export function covFromCor(lowerWithDiagonal: number[], sds: number[]): number[][] {
  const p = sds.length;
  const R = Array.from({ length: p }, () => Array<number>(p).fill(0));
  let k = 0;
  for (let i = 0; i < p; i++)
    for (let j = 0; j <= i; j++) {
      R[i][j] = R[j][i] = lowerWithDiagonal[k++];
    }
  if (k !== lowerWithDiagonal.length)
    throw new Error(`Expected ${k} correlations, got ${lowerWithDiagonal.length}.`);
  return R.map((row, i) => row.map((r, j) => r * sds[i] * sds[j]));
}

const C = (name: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({
  id: newId('c'),
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
  ...extra,
});
const P = (f: { id: string }, t: { id: string }, label?: string) => ({
  id: newId('p'),
  from: f.id,
  to: t.id,
  ...(label ? { label } : {}),
});
const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
const matrix = (names: string[], S: number[][], n: number): Dataset => ({
  names,
  cols: [],
  moments: { S, n },
});
const info = (fileName: string, n: number): DataInfo => ({
  fileName,
  rows: n,
  missingCells: 0,
  excluded: [],
  kind: 'matrix',
});
const finish = (
  name: string,
  data: Dataset,
  fileName: string,
  model: ModelState,
  settings: Settings,
  engine?: 'r',
): BuiltinExample => {
  const laid = { ...model, constructs: autoLayout(model) };
  return {
    name,
    data,
    info: info(fileName, data.moments!.n),
    model: makeCovariancesExplicit(laid),
    settings: {
      ...settings,
      method: 'cbsem',
      estimator: 'ML',
      consistent: false,
      ...(engine ? { engine } : {}),
    },
  };
};
const KLINE = 'Kline (2023), Principles and Practice of SEM, 5th ed.';

// ---- Roth, Wiebe, Fillingim & Shay (1989): exercise, hardiness, fitness, stress and illness (ch. 9; N = 373)
export const ROTH_NAMES = ['exercise', 'hardy', 'fitness', 'stress', 'illness'];
export const ROTH_S = covFromCor(
  [1, -0.03, 1, 0.39, 0.07, 1, -0.05, -0.23, -0.13, 1, -0.08, -0.16, -0.29, 0.34, 1],
  [66.5, 38.0, 18.4, 33.5, 62.48],
);
export function makeRothExample(settings: Settings): BuiltinExample {
  // Observed variables only; exercise and hardiness exogenous with free variances and covariance (Kline: fixed.x = FALSE), not fixed.x covariates.
  const exercise = C('exercise', ['exercise']),
    hardy = C('hardy', ['hardy']),
    fitness = C('fitness', ['fitness']),
    stress = C('stress', ['stress']),
    illness = C('illness', ['illness']);
  const model: ModelState = {
    constructs: [exercise, hardy, fitness, stress, illness],
    paths: [
      P(exercise, fitness, 'a'),
      P(hardy, stress, 'c'),
      P(fitness, illness, 'b'),
      P(stress, illness, 'd'),
    ],
    moderations: [],
    // The indirect effects of exercise and hardiness on illness, as functions of the labelled paths.
    defined: [
      { id: newId('d'), name: 'ab', expr: 'a*b' },
      { id: newId('d'), name: 'cd', expr: 'c*d' },
    ],
  };
  // (labels and defined parameters are lavaan features: R engine)
  // (Kline's script: sample.cov.rescale = FALSE, the matrix fitted as given)
  return finish(
    'Exercise, hardiness and illness (Roth et al. 1989)',
    matrix(ROTH_NAMES, ROTH_S, 373),
    `${KLINE} ch. 9: Roth et al. (1989) correlations and SDs`,
    { ...model, sampleCovRescale: false },
    settings,
    'r',
  );
}

// ---- Kaufman & Kaufman (1983), KABC-I, 10-year-olds of the normative sample (ch. 14; N = 200)
export const KABC_NAMES = ['hm', 'nr', 'wo', 'gc', 'tr', 'sm', 'ma', 'ps'];
export const KABC_S = covFromCor(
  [
    1, 0.39, 1, 0.35, 0.67, 1, 0.21, 0.11, 0.16, 1, 0.32, 0.27, 0.29, 0.38, 1, 0.4, 0.29, 0.28, 0.3,
    0.47, 1, 0.39, 0.32, 0.3, 0.31, 0.42, 0.41, 1, 0.39, 0.29, 0.37, 0.42, 0.58, 0.51, 0.42, 1,
  ],
  [3.4, 2.4, 2.9, 2.7, 2.7, 4.2, 2.8, 3.0],
);
export function makeKabcExample(settings: Settings): BuiltinExample {
  const model: ModelState = {
    constructs: [
      C('Sequential', ['hm', 'nr', 'wo']),
      C('Simultaneous', ['gc', 'tr', 'sm', 'ma', 'ps']),
    ],
    paths: [],
    moderations: [],
  };
  return finish(
    'KABC-I: sequential and simultaneous processing (Kaufman & Kaufman 1983)',
    matrix(KABC_NAMES, KABC_S, 200),
    `${KLINE} ch. 14: KABC-I correlations and SDs`,
    model,
    settings,
  );
}

// ---- Sabatelli & Bartle-Haring (2003): marital adjustment and family-of-origin experiences, a Heywood case (ch. 14; N = 103)
export const SABATELLI_NAMES = ['problems', 'intimacy', 'father', 'mother', 'both'];
export const SABATELLI_S = covFromCor(
  [1, 0.74, 1, 0.265, 0.422, 1, 0.305, 0.401, 0.791, 1, 0.315, 0.351, 0.662, 0.587, 1],
  [32.936, 22.749, 13.39, 13.679, 14.382],
);
export function makeSabatelliExample(settings: Settings): BuiltinExample {
  const model: ModelState = {
    constructs: [
      C('Marital adjustment', ['problems', 'intimacy']),
      C('Family of origin', ['father', 'mother', 'both']),
    ],
    paths: [],
    moderations: [],
  };
  return finish(
    'A Heywood case: marital adjustment and family of origin (Sabatelli & Bartle-Haring 2003)',
    matrix(SABATELLI_NAMES, SABATELLI_S, 103),
    `${KLINE} ch. 14: Sabatelli & Bartle-Haring (2003) correlations and SDs`,
    model,
    settings,
  );
}

// ---- Worland et al. (1984): cognitive ability, achievement, classroom adjustment, family risk (ch. 15; N = 158)
export const WORLAND_NAMES = [
  'verbal',
  'visual',
  'memory',
  'read',
  'math',
  'spell',
  'motive',
  'harmony',
  'stable',
  'parent',
  'ses',
];
export const WORLAND_S = covFromCor(
  [
    1, 0.7, 1, 0.65, 0.6, 1, 0.55, 0.5, 0.45, 1, 0.5, 0.45, 0.4, 0.7, 1, 0.35, 0.35, 0.3, 0.55, 0.5,
    1, 0.3, 0.3, 0.3, 0.5, 0.45, 0.44, 1, 0.25, 0.2, 0.22, 0.41, 0.28, 0.34, 0.4, 1, 0.35, 0.32,
    0.32, 0.48, 0.45, 0.42, 0.6, 0.45, 1, -0.25, -0.24, -0.22, -0.21, -0.18, -0.15, -0.15, -0.12,
    -0.17, 1, -0.22, -0.26, -0.3, -0.25, -0.22, -0.18, -0.17, -0.14, -0.2, 0.42, 1,
  ],
  [13.75, 14.8, 12.6, 14.9, 15.25, 13.85, 9.5, 11.1, 8.7, 12.0, 8.5],
);
export function makeWorlandExample(settings: Settings): BuiltinExample {
  const cognitive = C('Cognitive', ['verbal', 'visual', 'memory']),
    achievement = C('Achievement', ['read', 'math', 'spell']),
    adjustment = C('Adjustment', ['motive', 'harmony', 'stable']),
    risk = C('Risk', ['parent', 'ses']);
  // The disturbances of achievement and adjustment are uncorrelated (Kline fixes that covariance at 0; here an undrawn pair).
  const model: ModelState = {
    constructs: [cognitive, risk, achievement, adjustment],
    paths: [
      P(cognitive, achievement),
      P(risk, achievement),
      P(cognitive, adjustment),
      P(risk, adjustment),
    ],
    moderations: [],
  };
  // The likelihood surface is nearly flat here (lavaan needs 639 iterations): the built-in engine stops at a local minimum
  // (chi-square 49.7 with plausible coefficients), lavaan reaches Kline's 37.32 with implausible ones. R engine, as the book.
  return finish(
    'Achievement and classroom adjustment (Worland et al. 1984)',
    matrix(WORLAND_NAMES, WORLAND_S, 158),
    `${KLINE} ch. 15: Worland et al. (1984) correlations and SDs`,
    model,
    settings,
    'r',
  );
}

// ---- Romney, Jenkins & Bynner (1992): two non-nested path models of quality of life after heart surgery (ch. 11; N = 469)
export const ROMNEY_NAMES = ['morale', 'symptoms', 'dysfunction', 'relations', 'ses'];
export const ROMNEY_S = covFromCor(
  [1, 0.53, 1, 0.15, 0.18, 1, 0.52, 0.29, -0.05, 1, 0.3, 0.34, 0.23, 0.09, 1],
  [3.75, 17.0, 19.5, 3.5, 24.7],
);
export function makeRomneyExample(
  settings: Settings,
  variant: 'somatic' | 'medical',
): BuiltinExample {
  const morale = C('morale', ['morale']),
    symptoms = C('symptoms', ['symptoms']),
    dysfunction = C('dysfunction', ['dysfunction']),
    relations = C('relations', ['relations']),
    ses = C('ses', ['ses']);
  const paths =
    variant === 'somatic'
      ? [P(ses, morale), P(dysfunction, morale), P(morale, relations), P(morale, symptoms)] // symptoms and relations: disturbances uncorrelated (undrawn)
      : [
          P(symptoms, ses),
          P(dysfunction, ses),
          P(symptoms, morale),
          P(ses, morale),
          P(dysfunction, relations),
          P(morale, relations),
        ];
  // (Kline's script: sample.cov.rescale = FALSE, the matrix fitted as given)
  const model: ModelState = {
    constructs: [morale, symptoms, dysfunction, relations, ses],
    paths,
    moderations: [],
    sampleCovRescale: false,
  };
  return finish(
    `Quality of life after heart surgery: the ${variant === 'somatic' ? 'psychosomatic' : 'conventional medical'} model (Romney et al. 1992)`,
    matrix(ROMNEY_NAMES, ROMNEY_S, 469),
    `${KLINE} ch. 11: Romney et al. (1992) correlations and SDs`,
    model,
    settings,
  );
}

// ---- Lynam, Moffitt & Stouthamer-Loeber (1993): achievement and delinquency in two groups, with means (ch. 12; N = 214 and 181)
export const LYNAM_NAMES = ['ses', 'effort', 'viq', 'achieve', 'delinq'];
export const LYNAM_GROUPS = [
  {
    label: 'Black',
    S: covFromCor(
      [1, 0.08, 1, 0.28, 0.3, 1, 0.05, 0.21, 0.5, 1, -0.11, -0.17, -0.26, -0.33, 1],
      [10.58, 1.35, 13.62, 0.79, 1.63],
    ),
    n: 214,
    means: [31.96, -0.01, 93.76, 2.51, 1.4],
  },
  {
    label: 'White',
    S: covFromCor(
      [1, 0.25, 1, 0.37, 0.4, 1, 0.27, 0.28, 0.61, 1, -0.11, -0.2, -0.31, -0.21, 1],
      [11.53, 1.32, 16.32, 0.96, 1.45],
    ),
    n: 181,
    means: [34.64, 0.05, 104.18, 2.88, 1.22],
  },
];
export function makeLynamExample(settings: Settings): BuiltinExample {
  const ses = C('ses', ['ses']),
    effort = C('effort', ['effort']),
    viq = C('viq', ['viq']),
    achieve = C('achieve', ['achieve']),
    delinq = C('delinq', ['delinq']);
  const constructs = [ses, effort, viq, achieve, delinq];
  // Kline's second model: every coefficient equal across the groups except achievement -> delinquency; means and intercepts free per group.
  const model: ModelState = {
    constructs,
    paths: [
      P(ses, achieve),
      P(effort, achieve),
      P(viq, achieve),
      P(achieve, delinq),
      P(ses, delinq),
      P(effort, delinq),
      P(viq, delinq),
    ],
    moderations: [],
    constant: { x: -400, y: 0 },
    means: constructs.map((c) => ({ id: newId('m'), target: c.id })),
    multigroup: {
      column: '',
      invariance: 'configural',
      structural: ['regressions'],
      free: [{ kind: 'regression', from: achieve.id, to: delinq.id }],
    },
  };
  const data: Dataset = {
    names: LYNAM_NAMES,
    cols: [],
    moments: momentsOfGroups(
      LYNAM_GROUPS.map((g) => ({ ...g, S: g.S.map((r) => [...r]), means: [...g.means] })),
    ),
  };
  return finish(
    'Achievement and delinquency in two groups (Lynam et al. 1993)',
    data,
    `${KLINE} ch. 12: Lynam et al. (1993) correlations, SDs and means per group`,
    model,
    settings,
    'r',
  );
}

// ---- Robbins, Pettinicchio & ... (2012): institutional quality and trust, a causal loop (ch. 19; N = 64 countries)
export const ROBBINS_NAMES = [
  'rule',
  'legal',
  'corrupt',
  'bandwidth',
  'internet',
  'trust',
  'monarchy',
];
export const ROBBINS_S = covFromCor(
  [
    1, 0.933, 1, 0.767, 0.738, 1, 0.76, 0.737, 0.614, 1, 0.82, 0.76, 0.664, 0.867, 1, 0.454, 0.466,
    0.372, 0.368, 0.375, 1, 0.469, 0.48, 0.38, 0.457, 0.351, 0.498, 1,
  ],
  [1.008, 1.931, 1.424, 2.585, 1.569, 0.138, 0.394],
);
export function makeRobbinsExample(settings: Settings): BuiltinExample {
  const infoTech = C('InfoTech', ['bandwidth', 'internet']),
    institQual = C('InstitQual', ['legal', 'corrupt']),
    trust = C('trust', ['trust']),
    monarchy = C('monarchy', ['monarchy']);
  const model: ModelState = {
    constructs: [infoTech, monarchy, institQual, trust],
    paths: [
      P(trust, institQual),
      P(infoTech, institQual),
      P(institQual, trust),
      P(monarchy, trust),
    ],
    moderations: [],
    // The disturbances of the two constructs in the loop covary; InfoTech and monarchy (exogenous) covary too.
    correlations: [{ id: newId('k'), kind: 'construct', a: institQual.id, b: trust.id }],
  };
  return finish(
    'Institutional quality and trust: a causal loop (Robbins 2012)',
    matrix(ROBBINS_NAMES, ROBBINS_S, 64),
    `${KLINE} ch. 19: Robbins (2012) correlations and SDs`,
    model,
    settings,
  );
}

// ---- Sauve et al.: cognitive ability and a single-indicator outcome with known reliability (ch. 15; N = 193)
export const SAUVE_NAMES = ['isl', 'islr', 'gml', 'gmr', 'ocl', 'cpal', 'sumd'];
export const SAUVE_S = covFromCor(
  [
    1, 0.753, 1, 0.329, 0.334, 1, 0.316, 0.307, 0.672, 1, 0.398, 0.347, 0.411, 0.451, 1, 0.43,
    0.439, 0.526, 0.532, 0.47, 1, -0.144, -0.155, -0.215, -0.108, -0.146, -0.143, 1,
  ],
  [4.713, 2.67, 1.664, 1.009, 0.116, 0.121, 1.225],
);
export function makeSauveExample(settings: Settings): BuiltinExample {
  const cognitive = C('Cognitive', ['isl', 'islr', 'gml', 'ocl', 'cpal', 'gmr']);
  // The SUMD score is a single indicator with reliability .76; Kline fixes its error variance at .360, (1 - .76) x 1.225² rounded,
  // so the reliability is the one that gives exactly .360 (0.76010 to five places).
  const sumd = C('SUMD', ['sumd'], { reliability: 1 - 0.36 / SAUVE_S[6][6] });
  const model: ModelState = {
    constructs: [cognitive, sumd],
    paths: [P(cognitive, sumd)],
    moderations: [],
    correlations: [E('isl', 'islr'), E('gml', 'gmr')],
  };
  return finish(
    'Cognitive ability and insight: a partial SR model (Sauve et al.)',
    matrix(SAUVE_NAMES, SAUVE_S, 193),
    `${KLINE} ch. 15: Sauve et al. correlations and SDs`,
    model,
    settings,
    'r',
  );
}
