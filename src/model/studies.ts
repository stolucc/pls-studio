// Published simulation studies as starting designs for the Monte Carlo card
// (Analyses → Add). Each says what of the study the design reproduces exactly
// and where it differs; random numbers always differ, so results agree with the
// paper up to Monte Carlo error, not digit for digit.

import type { McDesign } from '../engine/montecarlo';
import type { PopulationSpec } from '../engine/population';

export interface McStudy {
  id: string;
  /** Add-menu title. */
  title: string;
  sub: string;
  reference: string;
  design: () => McDesign;
  /** What the design takes from the study as published. */
  exact: string[];
  /** Where it differs from the study, or what the study had that the app cannot set. */
  differs: string[];
}

// Rönkkö & Evermann (2013, Organizational Research Methods 16(3), 425–448): two
// common factors with three indicators each (loadings .6, .7, .8), one path
// (β = 0 or .3), N = 100, 500 replications; PLS compared with regression on sum
// scores and ML SEM. At β = 0 the PLS estimate is bimodal and its bootstrap
// distribution differs from the sampling distribution; the measurement checks
// (CR, AVE, AVE − highest squared correlation, GoF) do not reveal
// misspecification.
const twoFactors = (beta: number): PopulationSpec => ({
  constructs: [
    { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.6, 0.7, 0.8] },
    { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.6, 0.7, 0.8] },
  ],
  paths: [{ from: 'A', to: 'B', value: beta }],
  exoCor: [],
});

const ronkkoEvermann = (beta: number, id: string): McStudy => ({
  id,
  title: `Rönkkö & Evermann (2013): β = ${beta}`,
  sub:
    beta === 0
      ? 'PLS at a null path: bimodal estimates, bootstrap tests, measurement checks'
      : 'PLS, sum scores and ML SEM at β = .3: bias, power, measurement checks',
  reference:
    'Rönkkö, M., & Evermann, J. (2013). A critical examination of common beliefs about partial least squares path modeling. Organizational Research Methods, 16(3), 425–448.',
  design: () => ({
    population: twoFactors(beta),
    estimators: [
      { id: 'PLS mode A', method: 'pls', consistent: false, mode: 'A' },
      { id: 'Sum scores', method: 'regression', dr: false },
      { id: 'CB-ML', method: 'cb', estimator: 'ML' },
    ],
    sampleSizes: [100],
    replications: 500,
    seed: 2013,
    alpha: 0.05,
    bootSamples: 500,
    mcDraws: 0,
    study: id,
  }),
  exact: [
    'Two common factors, three indicators each, loadings .6, .7 and .8',
    `One path, β = ${beta}`,
    'N = 100, 500 replications',
    'PLS mode A, regression on sum scores, ML SEM',
  ],
  differs: [
    'Bootstrap samples (500) and the inference settings are the app’s choices; the paper’s may differ.',
    'The paper’s measurement-misspecification models (other numbers of constructs, other patterns of loadings) are not reproduced: the estimated model always has the population’s constructs. Add cross-loadings or error correlations under Misspecification to study what the checks notice.',
    'AVE − highest squared correlation appears as the Fornell–Larcker margin √AVE − highest correlation (same sign, so the same decisions); SRMR is not computed for PLS.',
    'Random numbers differ from the paper’s: results agree up to Monte Carlo error.',
  ],
});

export const MC_STUDIES: McStudy[] = [
  ronkkoEvermann(0, 'ronkko-evermann-2013-null'),
  ronkkoEvermann(0.3, 'ronkko-evermann-2013-beta'),
];

export const studyOf = (id: string | undefined) => MC_STUDIES.find((s) => s.id === id);
