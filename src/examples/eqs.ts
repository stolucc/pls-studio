// Built-in examples from the EQS 6 Structural Equations Program Manual
// (Bentler 2006): worked examples whose input files print their data. Each is
// fitted as EQS fits it (maximum likelihood with N − 1: the Wishart likelihood),
// and reproduces the chi-square the manual prints (scripts/validation/eqs.R).
// Only the numbers are used.

import type { Dataset } from '../engine/types';
import { momentsOfGroups } from '../data/moments';
import { autoLayout } from '../model/layout';
import { makeCovariancesExplicit, newId, type Construct, type DataInfo, type ModelState, type Settings } from '../model/project';
import { lowerToFull } from './bollen1989';
import { covFromCor } from './kline';
import type { BuiltinExample } from './textbook';

const C = (name: string, indicators: string[]): Construct => ({ id: newId('c'), name, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left' });
const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
const E = (a: string, b: string) => ({ id: newId('k'), kind: 'indicator' as const, a, b });
const info = (fileName: string, n: number): DataInfo => ({ fileName, rows: n, missingCells: 0, excluded: [], kind: 'matrix' });
const finish = (name: string, data: Dataset, fileName: string, model: ModelState, settings: Settings): BuiltinExample => {
  const laid = { ...model, constructs: autoLayout(model) };
  return { name, data, info: info(fileName, data.moments!.n), model: { ...makeCovariancesExplicit(laid), likelihood: 'wishart' }, settings: { ...settings, method: 'cbsem', estimator: 'ML', consistent: false, engine: 'r' } };
};
const EQS = 'EQS 6 Structural Equations Program Manual (Bentler 2006)';

// ---- Bagozzi (1980): performance and job satisfaction of 122 salespeople (correlations and SDs)
export const BAGOZZI_NAMES = ['perform', 'satisf1', 'satisf2', 'achieve1', 'achieve2', 'esteem1', 'esteem2', 'verbalIQ'];
export const BAGOZZI_S = covFromCor([1, 0.418, 1, 0.394, 0.627, 1, 0.129, 0.202, 0.266, 1, 0.189, 0.284, 0.208, 0.365, 1, 0.544, 0.281, 0.324, 0.201, 0.161, 1, 0.507, 0.225, 0.314, 0.172, 0.174, 0.546, 1, -0.357, -0.156, -0.038, -0.199, -0.277, -0.294, -0.174, 1],
  [2.09, 3.43, 2.81, 1.95, 2.08, 2.16, 2.06, 3.65]);
export function makeBagozziExample(settings: Settings): BuiltinExample {
  // In EQS, performance (V1) is an indicator of self-esteem that also depends on verbal IQ and drives job satisfaction.
  // The same model as a diagram: performance a single indicator (no error) regressed on self-esteem and verbal IQ;
  // its disturbance is EQS's E1, and self-esteem keeps esteem1 as its marker.
  const jobSat = C('Job satisfaction', ['satisf1', 'satisf2']), achieve = C('Achievement motivation', ['achieve1', 'achieve2']), esteem = C('Self-esteem', ['esteem1', 'esteem2']);
  const perform = C('perform', ['perform']), iq = C('verbalIQ', ['verbalIQ']);
  const model: ModelState = { constructs: [iq, esteem, achieve, perform, jobSat], paths: [P(iq, perform), P(esteem, perform), P(perform, jobSat), P(achieve, jobSat)], moderations: [] };
  return finish('Performance and job satisfaction of salespeople (Bagozzi 1980)', { names: BAGOZZI_NAMES, cols: [], moments: { S: BAGOZZI_S, n: 122 } }, `${EQS}: Bagozzi (1980) correlations and SDs`, model, settings);
}

// ---- Werts, Rock, Linn & Jöreskog (1976): two factors in two groups (N = 865 and 900)
export const WERTS_NAMES = ['v1', 'v2', 'v3', 'v4'];
export const WERTS_GROUPS = [
  { label: 'Group 1', n: 865, S: lowerToFull([63.382, 70.984, 110.237, 41.710, 52.747, 60.584, 30.218, 37.489, 36.392, 32.295], 4) },
  { label: 'Group 2', n: 900, S: lowerToFull([67.898, 72.301, 107.330, 40.549, 55.347, 63.203, 28.976, 38.896, 39.261, 35.403], 4) },
];
export function makeWertsExample(settings: Settings): BuiltinExample {
  // EQS fixes the factor variances at 1 and holds loadings and the factor correlation equal across the groups.
  // With marker indicators that is: loadings, factor variances and the covariance equal (the same model).
  const model: ModelState = {
    constructs: [C('F1', ['v1', 'v2']), C('F2', ['v3', 'v4'])], paths: [], moderations: [],
    multigroup: { column: '', invariance: 'metric', structural: ['lv.variances', 'lv.covariances'], free: [], meanStructure: false },
  };
  const data: Dataset = { names: WERTS_NAMES, cols: [], moments: momentsOfGroups(WERTS_GROUPS.map((g) => ({ ...g, S: g.S.map((r) => [...r]) }))) };
  return finish('Two factors in two groups (Werts et al. 1976)', data, `${EQS}: Werts et al. (1976) covariance matrices`, model, settings);
}

// ---- Head Start (Magidson 1977, via the LISREL 7 manual): SES and cognitive ability, Head Start (N = 148) and control (N = 155) children
export const HEADSTART_NAMES = ['ses1', 'ses2', 'ses3', 'ses4', 'ability1', 'ability2'];
export const HEADSTART_GROUPS = [
  { label: 'Head Start', n: 148, S: covFromCor([1, 0.441, 1, 0.220, 0.203, 1, 0.304, 0.182, 0.377, 1, 0.274, 0.265, 0.208, 0.084, 1, 0.270, 0.122, 0.251, 0.198, 0.664, 1], [1.332, 1.281, 1.075, 2.648, 3.764, 2.677]), means: [3.520, 3.081, 2.088, 5.358, 19.672, 9.562] },
  { label: 'Control', n: 155, S: covFromCor([1, 0.484, 1, 0.224, 0.342, 1, 0.268, 0.215, 0.387, 1, 0.230, 0.215, 0.196, 0.115, 1, 0.265, 0.297, 0.234, 0.162, 0.635, 1], [1.360, 1.195, 1.193, 3.239, 3.900, 2.719]), means: [3.839, 3.290, 2.600, 6.435, 20.415, 10.070] },
];
function headStartModel(): ModelState {
  const ses = C('SES', HEADSTART_NAMES.slice(0, 4)), ability = C('Ability', HEADSTART_NAMES.slice(4));
  // The errors of the first two SES indicators covary.
  return { constructs: [ses, ability], paths: [P(ses, ability)], moderations: [], correlations: [E('ses1', 'ses2')] };
}
export function makeHeadStartExample(settings: Settings): BuiltinExample {
  // One group: EQS's intercepts are free for every variable, so the means add nothing to the fit; the covariance structure gives the same chi-square.
  const g = HEADSTART_GROUPS[0];
  return finish('SES and cognitive ability of Head Start children', { names: HEADSTART_NAMES, cols: [], moments: { S: g.S.map((r) => [...r]), n: g.n } }, `${EQS}: Head Start group, correlations and SDs`, headStartModel(), settings);
}
export function makeHeadStartGroupsExample(settings: Settings): BuiltinExample {
  // Intercepts, loadings and the SES -> ability coefficient equal across the groups; the Head Start group's latent means estimated relative to the controls'.
  const model: ModelState = { ...headStartModel(), multigroup: { column: '', invariance: 'scalar', structural: ['regressions'], free: [] } };
  const data: Dataset = { names: HEADSTART_NAMES, cols: [], moments: momentsOfGroups(HEADSTART_GROUPS.map((g) => ({ ...g, S: g.S.map((r) => [...r]), means: [...g.means] }))) };
  return finish('Head Start and control children: structured means', data, `${EQS}: Head Start and control groups, correlations, SDs and means`, model, settings);
}

// ---- Olsson (Sörbom 1978): verbal ability before and after training, controls (N = 105) and experimentals (N = 108)
export const OLSSON_NAMES = ['syn1', 'opp1', 'syn2', 'opp2'];
export const OLSSON_GROUPS = [
  { label: 'Control', n: 105, S: lowerToFull([37.626, 24.933, 34.680, 26.639, 24.236, 32.013, 23.649, 27.760, 23.565, 33.443], 4), means: [18.381, 20.229, 20.400, 21.343] },
  { label: 'Experimental', n: 108, S: lowerToFull([50.084, 42.373, 49.872, 40.760, 36.094, 51.237, 37.343, 40.396, 39.890, 53.641], 4), means: [20.556, 21.241, 25.667, 25.870] },
];
export function makeOlssonExample(settings: Settings): BuiltinExample {
  // Synonyms and opposites tests before and after; the post-test ability regressed on the pre-test ability.
  // Intercepts, loadings and the regression equal across the groups; the opposites tests' errors covary over time.
  const pre = C('Pre-test ability', ['syn1', 'opp1']), post = C('Post-test ability', ['syn2', 'opp2']);
  const model: ModelState = {
    constructs: [pre, post], paths: [P(pre, post)], moderations: [], correlations: [E('opp1', 'opp2')],
    multigroup: { column: '', invariance: 'scalar', structural: ['regressions'], free: [] },
  };
  const data: Dataset = { names: OLSSON_NAMES, cols: [], moments: momentsOfGroups(OLSSON_GROUPS.map((g) => ({ ...g, S: g.S.map((r) => [...r]), means: [...g.means] }))) };
  return finish('Training verbal ability: controls and experimentals (Olsson; Sörbom 1978)', data, `${EQS}: Olsson's covariance matrices and means`, model, settings);
}
