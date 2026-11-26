// Monte Carlo cards of cards/model.ts: Aguirre-Urreta et al., Wolf et al. (2013), Curran et al. (1996), Hu & Bentler (1999). Each run through the card's design in R (modelHarness.ts, which says
// why these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'aguirre cards: PLS composite reliability overstates the reliability of its own composites (Table 3)',
  async () => {
    const source = {
      label:
        'Aguirre-Urreta et al. (2013), Table 3, three indicators, N = 100: PLS CR .792 / .771 / .850 against the composites’ true reliability .617 / .631 / .737 (loadings around .6), .669 / .634 against .323 / .325 (around .4)',
      level: 'published',
      url: 'https://doi.org/10.1145/2544415.2544417',
    } as const;
    const medium = await mcCardRun('aguirre-reliability-medium');
    against(source);
    const m = (key: string) => medium.row('PLS', key, 100).mean;
    near('medium: ρc of X', m('validity:cr:X'), 0.792, 0.02);
    near('medium: ρc of Z', m('validity:cr:Z'), 0.771, 0.02);
    near('medium: ρc of Y', m('validity:cr:Y'), 0.85, 0.02);
    near('medium: true reliability of X', m('reliability:X'), 0.617, 0.02);
    near('medium: true reliability of Z', m('reliability:Z'), 0.631, 0.02);
    near('medium: true reliability of Y', m('reliability:Y'), 0.737, 0.02);
    const low = await mcCardRun('aguirre-reliability-low');
    against(source);
    const l = (key: string) => low.row('PLS', key, 100).mean;
    near('low: ρc of X', l('validity:cr:X'), 0.669, 0.02);
    near('low: ρc of Z', l('validity:cr:Z'), 0.634, 0.04);
    near('low: true reliability of X', l('reliability:X'), 0.323, 0.02);
    near('low: true reliability of Z', l('reliability:Z'), 0.325, 0.02);
    // ρc passes .70 in about a third of samples for X while the composite is about .35 reliable
    near(
      'low: X failing ρc .70 at N = 500',
      low.row('PLS', 'validity:cr:X', 500).rejection!,
      0.54,
      0.06,
    );
  },
  7_200_000,
);

slowIt(
  'wolf cards: weak loadings need N near 400, the indirect effect near 180, single indicators attenuate',
  async () => {
    const source = {
      label:
        'Wolf et al. (2013): minimum N 460 for two factors with three indicators of loading .5; 180 for the mediation model with paths .40 (power for the indirect effect .61 / .83 at N = 140 / 180); single indicators of reliability .42: estimate .17, power .68 at N = 180',
      level: 'recovery',
      url: 'https://doi.org/10.1177/0013164413495237',
    } as const;
    const cfa = await mcCardRun('wolf-cfa-weak');
    against(source);
    const phi = (n: number) => cfa.row('CB-ML', 'cov:F1:F2', n);
    near('CFA: correlation estimate', phi(460).mean, 0.3, 0.01);
    expect(phi(340).rejection!, 'below .80 at 340').toBeLessThan(0.8);
    expect(phi(460).rejection!, 'above .80 at 460').toBeGreaterThan(0.8);
    near('CFA: χ² Type I error', cfa.row('CB-ML', 'fit:chisq', 400).rejection!, 0.05, 0.025);
    const mediation = await mcCardRun('wolf-mediation');
    against(source);
    const indirect = (n: number) => mediation.row('CB-ML', 'indirect:F1:F3', n);
    near('mediation: indirect effect', indirect(180).mean, 0.16, 0.008);
    expect(indirect(140).rejection!, 'indirect below .80 at 140').toBeLessThan(0.8);
    expect(indirect(180).rejection!, 'indirect above .80 at 180').toBeGreaterThan(0.8);
    near(
      'mediation: direct path power at 180',
      mediation.row('CB-ML', 'path:F1:F3', 180).rejection!,
      0.91,
      0.04,
    );
    const single = await mcCardRun('wolf-single-indicator');
    against(source);
    near('single: F1 → F2 estimate', single.row('CB-ML', 'path:F1:F2', 180).mean, 0.17, 0.015);
    near(
      'single: F1 → F2 power at 180',
      single.row('CB-ML', 'path:F1:F2', 180).rejection!,
      0.68,
      0.06,
    );
    near('single: indirect effect', single.row('CB-ML', 'indirect:F1:F3', 180).mean, 0.034, 0.01);
  },
  7_200_000,
);

slowIt(
  'curran cards: ML χ² rejects a correct model under severe non-normality, Satorra–Bentler does not; power against cross-loadings (Tables 3 and 4)',
  async () => {
    const source = {
      label:
        'Curran et al. (1996): Model 1, severe non-normality, N = 100 / 1,000: ML rejects 30% / 48%, Satorra–Bentler 13% / 7%; Model 3 (omitted cross-loadings), normal data, N = 100 / 200: ML 54.3% / 88.1%, SB 57.9% / 89.9%',
      level: 'published',
      url: 'https://doi.org/10.1037/1082-989X.1.1.16',
    } as const;
    const severe = await mcCardRun('curran-nonnormal');
    against(source);
    const chi = (e: string, n: number) => severe.row(e, 'fit:chisq', n).rejection!;
    near('ML rejects at N = 1,000', chi('CB-ML', 1000), 0.48, 0.07);
    near('ML rejects at N = 100', chi('CB-ML', 100), 0.3, 0.1);
    near('SB rejects at N = 100', chi('CB-MLM', 100), 0.13, 0.05);
    near('SB rejects at N = 1,000', chi('CB-MLM', 1000), 0.07, 0.04);
    const cross = await mcCardRun('curran-misspecified');
    against(source);
    const power = (e: string, n: number) => cross.row(e, 'fit:chisq', n).rejection!;
    near('ML power at N = 100', power('CB-ML', 100), 0.543, 0.07);
    near('ML power at N = 200', power('CB-ML', 200), 0.881, 0.06);
    near('SB power at N = 200', power('CB-MLM', 200), 0.899, 0.07);
    same('ML power at N = 500', power('CB-ML', 500), 1);
  },
  7_200_000,
);

slowIt(
  'hu-bentler cards: the cutoffs keep the true model; RMSEA and χ² catch the omitted cross-loading, SRMR rarely (Table 2)',
  async () => {
    const source = {
      label:
        'Hu & Bentler (1999), simple true model: rejection by SRMR > .08 6.8% / 0.3% / 0% at N ≤ 250 / 500 / ≥ 1,000 (pooled over seven distributions; under normality about 0); Complex Misspecified I: SRMR 36.5% / 10.6% / 0.9%, RMSEA > .06 91.6% / 97.7% / 99.8%',
      level: 'recovery',
      url: 'https://doi.org/10.1080/10705519909540118',
    } as const;
    const right = await mcCardRun('hu-bentler-true');
    against(source);
    for (const n of [150, 1000]) {
      same(`true: SRMR rejects at N = ${n}`, right.row('CB-ML', 'fit:srmr', n).rejection!, 0);
      same(`true: RMSEA rejects at N = ${n}`, right.row('CB-ML', 'fit:rmsea', n).rejection!, 0);
    }
    near(
      'true: χ² Type I error at N = 500',
      right.row('CB-ML', 'fit:chisq', 500).rejection!,
      0.05,
      0.035,
    );
    const wrong = await mcCardRun('hu-bentler-cross');
    against(source);
    const rejects = (key: string, n: number) => wrong.row('CB-ML', key, n).rejection!;
    near('cross: SRMR rejects at N = 150', rejects('fit:srmr', 150), 0.3, 0.12);
    same('cross: SRMR rejects at N = 1,000', rejects('fit:srmr', 1000), 0);
    expect(rejects('fit:rmsea', 150), 'RMSEA catches it at 150').toBeGreaterThan(0.7);
    expect(rejects('fit:rmsea', 1000), 'RMSEA catches it at 1,000').toBeGreaterThan(0.95);
    expect(rejects('fit:chisq', 150), 'χ² catches it').toBeGreaterThan(0.95);
  },
  7_200_000,
);
