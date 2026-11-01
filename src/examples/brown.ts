// Built-in examples from Brown (2015), Confirmatory Factor Analysis for Applied
// Research, 2nd ed. (Guilford): the examples whose data his companion site
// (sites.bu.edu/tabrown/cfabook) gives as standard deviations and correlations,
// with his Mplus syntax as the specification. Reference values come from native
// lavaan on the same matrices (scripts/validation/brown.R); maximum likelihood,
// so they equal the book's Mplus results up to the identification convention.

import type { Dataset } from '../engine/types';
import { autoLayout } from '../model/layout';
import { makeCovariancesExplicit, newId, type Construct, type DataInfo, type ModelState, type Settings } from '../model/project';
import { covFromCor } from './kline';
import type { BuiltinExample } from './textbook';

const C = (name: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({ id: newId('c'), name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...extra });
const P = (f: { id: string }, t: { id: string }, fixed?: number) => ({ id: newId('p'), from: f.id, to: t.id, ...(fixed !== undefined ? { fixed } : {}) });
const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
const matrix = (names: string[], S: number[][], n: number): Dataset => ({ names, cols: [], moments: { S, n } });
const BROWN = 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.';
const finish = (name: string, data: Dataset, source: string, model: ModelState, settings: Settings): BuiltinExample => {
  const info: DataInfo = { fileName: `${BROWN} ${source}`, rows: data.moments!.n, missingCells: 0, excluded: [], kind: 'matrix' };
  return { name, data, info, model: makeCovariancesExplicit({ ...model, constructs: autoLayout(model) }), settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false } };
};

// ---- Figure 4.1 / Table 4.1: neuroticism and extraversion, N = 250
export const NE_NAMES = ['N1', 'N2', 'N3', 'N4', 'E1', 'E2', 'E3', 'E4'];
export const NE_S = covFromCor([1, 0.767, 1, 0.731, 0.709, 1, 0.778, 0.738, 0.762, 1, -0.351, -0.302, -0.356, -0.318, 1, -0.316, -0.280, -0.300, -0.267, 0.675, 1, -0.296, -0.289, -0.297, -0.296, 0.634, 0.651, 1, -0.282, -0.254, -0.292, -0.245, 0.534, 0.593, 0.566, 1],
  [5.7, 5.6, 6.4, 5.7, 6.0, 6.2, 5.7, 5.6]);
export function makeBrownNeExample(settings: Settings): BuiltinExample {
  const model: ModelState = { constructs: [C('Neuroticism', ['N1', 'N2', 'N3', 'N4']), C('Extraversion', ['E1', 'E2', 'E3', 'E4'])], paths: [], moderations: [] };
  return finish('Neuroticism and extraversion: a two-factor CFA (Brown 2015)', matrix(NE_NAMES, NE_S, 250), 'Figure 4.1', model, settings);
}

// ---- Figure 7.1 / Table 7.2: tau-equivalent auditory indicators, N = 200
export const TAU_NAMES = ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'];
export const TAU_S = covFromCor([1, 0.661, 1, 0.630, 0.643, 1, 0.270, 0.300, 0.268, 1, 0.297, 0.265, 0.225, 0.805, 1, 0.290, 0.287, 0.248, 0.796, 0.779, 1], [2.610, 2.660, 2.590, 1.940, 2.030, 2.050]);
export function makeBrownTauExample(settings: Settings): BuiltinExample {
  // Tau equivalence: the three auditory loadings equal. With the marker's loading at 1, the other two are fixed at 1 as well
  // (Brown fixes the factor variance instead and labels the loadings equal: the same model).
  const model: ModelState = { constructs: [C('Auditory memory', ['X1', 'X2', 'X3'], { fixedLoadings: { X2: 1, X3: 1 } }), C('Visual memory', ['X4', 'X5', 'X6'])], paths: [], moderations: [] };
  return finish('Tau-equivalent indicators of auditory memory (Brown 2015)', matrix(TAU_NAMES, TAU_S, 200), 'Figure 7.1 / Table 7.2', model, settings);
}

// ---- Table 6.1 / 6.3: a correlated-uniqueness multitrait-multimethod model, N = 500
export const MTMM_NAMES = ['PARI', 'SZTI', 'SZDI', 'PARC', 'SZTC', 'SZDC', 'PARO', 'SZTO', 'SZDO'];
export const MTMM_S = covFromCor([1, 0.290, 1, 0.372, 0.478, 1, 0.587, 0.238, 0.209, 1, 0.201, 0.586, 0.126, 0.213, 1, 0.218, 0.281, 0.681, 0.195, 0.096, 1, 0.557, 0.228, 0.195, 0.664, 0.242, 0.232, 1, 0.196, 0.644, 0.146, 0.261, 0.641, 0.248, 0.383, 1, 0.219, 0.241, 0.676, 0.290, 0.168, 0.749, 0.361, 0.342, 1],
  [3.61, 3.66, 3.59, 2.94, 3.03, 2.85, 2.22, 2.42, 2.04]);
export function makeBrownMtmmExample(settings: Settings): BuiltinExample {
  // Three personality-disorder traits, each measured by an inventory (I), a clinical interview (C) and an observer rating (O);
  // the method effects are the correlated errors within each method.
  const model: ModelState = {
    constructs: [C('Paranoid', ['PARI', 'PARC', 'PARO']), C('Schizotypal', ['SZTI', 'SZTC', 'SZTO']), C('Schizoid', ['SZDI', 'SZDC', 'SZDO'])], paths: [], moderations: [],
    correlations: [E('PARI', 'SZTI'), E('PARI', 'SZDI'), E('SZTI', 'SZDI'), E('PARC', 'SZTC'), E('PARC', 'SZDC'), E('SZTC', 'SZDC'), E('PARO', 'SZTO'), E('PARO', 'SZDO'), E('SZTO', 'SZDO')],
  };
  return finish('Multitrait-multimethod: correlated uniqueness model (Brown 2015)', matrix(MTMM_NAMES, MTMM_S, 500), 'Table 6.1 / 6.3', model, settings);
}

// ---- Figure 8.1 / Table 8.2: a higher-order model of coping, N = 275
export const COPING_NAMES = ['P1', 'P2', 'P3', 'C1', 'C2', 'C3', 'E1', 'E2', 'E3', 'S1', 'S2', 'S3'];
export const COPING_S = covFromCor([
  1, 0.78, 1, 0.80, 0.77, 1, 0.56, 0.51, 0.48, 1, 0.52, 0.51, 0.46, 0.78, 1, 0.59, 0.51, 0.51, 0.80, 0.79, 1, 0.16, 0.15, 0.17, 0.14, 0.18, 0.16, 1, 0.19, 0.13, 0.18, 0.14, 0.16, 0.16, 0.81, 1,
  0.12, 0.17, 0.17, 0.17, 0.20, 0.16, 0.75, 0.80, 1, 0.16, 0.13, 0.17, 0.15, 0.16, 0.18, 0.56, 0.52, 0.50, 1, 0.16, 0.14, 0.18, 0.15, 0.16, 0.18, 0.51, 0.58, 0.51, 0.81, 1, 0.16, 0.15, 0.14, 0.16, 0.16, 0.14, 0.52, 0.57, 0.52, 0.80, 0.79, 1,
], [1.40, 2.10, 1.30, 2.30, 2.40, 1.90, 2.00, 2.90, 2.30, 3.10, 2.20, 1.20]);
export function makeBrownCopingExample(settings: Settings): BuiltinExample {
  const ps = C('ProblemSolving', ['P1', 'P2', 'P3']), cr = C('CognitiveRestructuring', ['C1', 'C2', 'C3']), ee = C('ExpressEmotions', ['E1', 'E2', 'E3']), ss = C('SocialSupport', ['S1', 'S2', 'S3']);
  const pf = C('ProblemFocused', [], { components: [ps.id, cr.id] }), ef = C('EmotionFocused', [], { components: [ee.id, ss.id] });
  const model: ModelState = { constructs: [ps, cr, ee, ss, pf, ef], paths: [], moderations: [] };
  return finish('Coping: a higher-order CFA (Brown 2015)', matrix(COPING_NAMES, COPING_S, 275), 'Figure 8.1 / Table 8.2', model, settings);
}

// ---- Figure 8.4 / Table 8.8: scale reliability of intrusions and avoidance, N = 500
export const RELIABILITY_NAMES = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8'];
export const RELIABILITY_S = covFromCor([1, 0.594, 1, 0.607, 0.613, 1, 0.736, 0.765, 0.717, 1, 0.378, 0.321, 0.360, 0.414, 1, 0.314, 0.301, 0.345, 0.363, 0.732, 1, 0.310, 0.262, 0.323, 0.337, 0.665, 0.583, 1, 0.317, 0.235, 0.276, 0.302, 0.632, 0.557, 0.796, 1],
  [1.150, 1.200, 1.570, 2.820, 1.310, 1.240, 1.330, 1.290]);
export function makeBrownReliabilityExample(settings: Settings): BuiltinExample {
  const model: ModelState = { constructs: [C('Intrusions', ['Y1', 'Y2', 'Y3', 'Y4']), C('Avoidance', ['Y5', 'Y6', 'Y7', 'Y8'])], paths: [], moderations: [], correlations: [E('Y7', 'Y8')] };
  return finish('Scale reliability from a CFA: intrusions and avoidance (Brown 2015)', matrix(RELIABILITY_NAMES, RELIABILITY_S, 500), 'Figure 8.4 / Table 8.8', model, settings);
}

// ---- Figure 8.7 / Table 8.12: life stress as a formative construct, N = 500
export const STRESS_NAMES = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'X1', 'X2', 'X3'];
export const STRESS_S = covFromCor([1, 0.700, 1, 0.713, 0.636, 1, 0.079, 0.066, 0.076, 1, 0.088, 0.058, 0.070, 0.681, 1, 0.084, 0.056, 0.074, 0.712, 0.633, 1, 0.279, 0.248, 0.240, 0.177, 0.155, 0.170, 1, 0.250, 0.214, 0.222, 0.157, 0.143, 0.152, 0.373, 1, 0.280, 0.236, 0.251, 0.173, 0.178, 0.171, 0.448, 0.344, 1],
  [2.5, 2.1, 3.0, 4.1, 3.9, 4.4, 1.2, 1.0, 1.2]);
export function makeBrownStressExample(settings: Settings): BuiltinExample {
  // Three observed stressors cause the latent life stress (the first cause's coefficient fixed at 1 to scale it); life stress is
  // identified by its two reflective second-order indicators, satisfaction and optimism.
  const sat = C('Satisfaction', ['Y1', 'Y2', 'Y3']), opt = C('Optimism', ['Y4', 'Y5', 'Y6']);
  const x1 = C('X1', ['X1'], { covariate: true }), x2 = C('X2', ['X2'], { covariate: true }), x3 = C('X3', ['X3'], { covariate: true });
  const stress = C('Stress', [], { components: [sat.id, opt.id] });
  const model: ModelState = { constructs: [x1, x2, x3, stress, sat, opt], paths: [P(x1, stress, 1), P(x2, stress), P(x3, stress)], moderations: [] };
  return finish('Life stress as a formative construct (Brown 2015)', matrix(STRESS_NAMES, STRESS_S, 500), 'Figure 8.7 / Table 8.12', model, settings);
}
