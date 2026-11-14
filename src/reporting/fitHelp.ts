// The hover help of the fit tables (CB-SEM's Model fit tab and PLS-SEM's Model fit tab): for each
// index, what it measures, which direction is better, the commonly cited cutoff with its source,
// and a caveat where one matters. One entry per index, with its sources as citation keys of
// reporting/citations.ts, so the text can be tested and stays in step with the fit guidance under
// the CB-SEM table (components/results/FitGuide.tsx): cutoffs are guidance, the robust indices are
// the ones to report, the scaled ones are naive, and RMSEA misleads with few df.

/** The indices that have help. */
export type FitHelpId =
  | 'chisq'
  | 'df'
  | 'p'
  | 'scalingFactor'
  | 'shiftParameter'
  | 'baselineChisq'
  | 'baselineDf'
  | 'cfi'
  | 'tli'
  | 'rmsea'
  | 'rmseaCi'
  | 'rmseaP'
  | 'scaledIncremental'
  | 'rmseaScaled'
  | 'srmr'
  | 'logl'
  | 'aic'
  | 'bic'
  | 'plsSrmr'
  | 'plsDuls'
  | 'plsDg'
  | 'plsTest';

/** The help of one fit index. */
export interface FitHelp {
  /** The index's name as the tooltip heads it. */
  title: string;
  /** What it measures, in one sentence. */
  measures: string;
  /** How to read it: which direction is better. */
  read: string;
  /** The commonly cited cutoff, naming its source; absent when there is none. */
  cutoff?: string;
  /** A caveat where one matters. */
  caveat?: string;
  /** Citation keys (reporting/citations.ts) of every work the text names. */
  sources: string[];
  /** Dynamic fit cutoffs (McNeish & Wolf 2023) exist for this index: the tooltip points to them. */
  dynamic?: boolean;
}

/** The tooltip's pointer to the dynamic fit cutoffs, for the indices that have them. */
export const DYNAMIC_TEXT =
  'Dynamic fit cutoffs, simulated for this model and sample size (McNeish & Wolf 2023), are one ' +
  'click away: “Dynamic cutoffs for this model…” under the table.';

const GUIDANCE =
  'Cutoffs are guidance, not rules: they come from simulations of a few model types and can be too strict or ' +
  'too lenient for other models, estimators and sample sizes (Marsh, Hau & Wen 2004).';

const PLS_NOT_ESTABLISHED =
  'Hair et al. (2021) caution that fit thresholds for PLS-SEM are not established and that ' +
  'PLS-SEM aims at explanation and prediction; treat fit values as rough guidance only.';

/** The help of every index, by id. */
export const FIT_HELP: Record<FitHelpId, FitHelp> = {
  chisq: {
    title: 'χ² (model test)',
    measures:
      'Tests exact fit: whether the covariances the model implies equal those in the population.',
    read: 'Smaller is better. A χ² near its df, with p above .05, means the model is not rejected.',
    cutoff:
      'p ≥ .05, the usual significance level. Always report χ², df and p (Jackson et al. 2009).',
    caveat:
      'With large samples, trivial misfit is significant; with small samples, real misfit can pass. ' +
      'With non-normal data, use the scaled χ² of a robust estimator (Satorra & Bentler 1994).',
    sources: ['jackson2009', 'satorra1994'],
  },
  df: {
    title: 'Degrees of freedom (df)',
    measures:
      'The number of observed variances and covariances (and means) minus the number of free parameters.',
    read: 'Neither direction is better. df = 0: the model reproduces the data exactly and fit cannot be tested.',
    caveat:
      'With few df the RMSEA is often large even for a well-fitting model (Kenny, Kaniskan & McCoach 2015).',
    sources: ['kenny2015'],
  },
  p: {
    title: 'p of the χ² test',
    measures:
      'The probability of a χ² at least this large if the model fitted the population exactly.',
    read: 'Higher is better. Below .05, exact fit is rejected.',
    cutoff: 'p ≥ .05 (the conventional significance level).',
    caveat:
      'A non-significant p does not prove the model right (small samples have little power), and with ' +
      'large samples almost every model is rejected. Read it with the approximate fit indices and the residuals.',
    sources: [],
  },
  scalingFactor: {
    title: 'Scaling factor',
    measures:
      'The factor by which the robust estimator divides the normal-theory χ² to correct it for non-normal data (Satorra & Bentler 1994).',
    read: 'Not good or bad. Near 1: the data are close to normal; well above 1: heavy tails (kurtosis).',
    caveat:
      'Scaled χ² values cannot be subtracted to compare models; the scaled difference test uses this factor.',
    sources: ['satorra1994'],
  },
  shiftParameter: {
    title: 'Shift parameter',
    measures:
      'For a mean- and variance-adjusted test (such as WLSMV or MLMV), the constant added after scaling, so ' +
      'that the statistic has the mean and variance of a χ² distribution.',
    read: 'Not good or bad: part of how the scaled χ² is computed.',
    sources: [],
  },
  baselineChisq: {
    title: 'χ² of the baseline model',
    measures:
      'The χ² of the baseline (null) model, in which the variables are uncorrelated. CFI and TLI compare the model with it (Bentler 1990).',
    read: 'Not a fit index of your model. Large is usual. Small: the variables barely correlate, so CFI and TLI cannot be high whatever the model.',
    sources: ['bentler1990'],
  },
  baselineDf: {
    title: 'df of the baseline model',
    measures: 'The degrees of freedom of the baseline (null) model, which CFI and TLI use.',
    read: 'Not good or bad: an input of CFI and TLI.',
    sources: [],
  },
  cfi: {
    title: 'CFI (comparative fit index)',
    measures:
      'How much better the model fits than the baseline model of uncorrelated variables, from their χ² minus df (Bentler 1990).',
    read: 'Higher is better; it runs from 0 to 1.',
    cutoff: '≥ .95 (Hu & Bentler 1999). The older ≥ .90 is more lenient.',
    caveat:
      `When the variables barely correlate, CFI is low whatever the model. In the robust column, the robust CFI ` +
      `(Brosseau-Liard & Savalei 2014) is the one to report. ${GUIDANCE}`,
    sources: ['bentler1990', 'hu1999', 'brosseau2014', 'marsh2004rules', 'mcneish2023'],
    dynamic: true,
  },
  tli: {
    title: 'TLI (Tucker–Lewis index)',
    measures:
      'Like CFI, but compares χ²/df of the model and the baseline, so it penalises free parameters (Tucker & Lewis 1973).',
    read: 'Higher is better. It can exceed 1 when χ² is below its df; that is not an error.',
    cutoff: '≥ .95 (Hu & Bentler 1999).',
    caveat: `In the robust column, the robust TLI (Brosseau-Liard & Savalei 2014) is the one to report. ${GUIDANCE}`,
    sources: ['tucker1973', 'hu1999', 'brosseau2014', 'marsh2004rules'],
  },
  rmsea: {
    title: 'RMSEA (root mean square error of approximation)',
    measures:
      'The misfit per degree of freedom expected in the population, so simpler models are rewarded (Browne & Cudeck 1993).',
    read: 'Lower is better; it is 0 when χ² is at or below its df.',
    cutoff:
      '≤ .06 (Hu & Bentler 1999). Browne & Cudeck (1993): ≤ .05 close fit, up to .08 reasonable. ' +
      'MacCallum, Browne & Sugawara (1996): .08 to .10 mediocre, above .10 poor.',
    caveat:
      'With few df, and more so with small samples, RMSEA is often large for a well-fitting model ' +
      '(Kenny, Kaniskan & McCoach 2015). In the robust column, the robust RMSEA (Brosseau-Liard, Savalei & Li 2012) ' +
      `is the one to report. ${GUIDANCE}`,
    sources: [
      'browne1993',
      'hu1999',
      'maccallum1996',
      'kenny2015',
      'brosseau2012',
      'marsh2004rules',
      'mcneish2023',
    ],
    dynamic: true,
  },
  rmseaCi: {
    title: 'RMSEA 90% confidence interval',
    measures: 'The range in which the population RMSEA lies with 90% confidence.',
    read: 'Lower is better. A lower bound at or below .05 is consistent with close fit; an upper bound at or above .10 means poor fit cannot be ruled out.',
    cutoff:
      '.05 for close fit (Browne & Cudeck 1993) and .10 for poor fit (MacCallum, Browne & Sugawara 1996).',
    caveat: 'A wide interval means the sample says little about fit; report it with the RMSEA.',
    sources: ['browne1993', 'maccallum1996'],
  },
  rmseaP: {
    title: 'p of close fit (p-close)',
    measures:
      'Tests close fit: the probability of this result if the population RMSEA were at most .05.',
    read: 'Higher is better. Below .05, close fit is rejected.',
    cutoff: 'p ≥ .05; the test of close fit is Browne & Cudeck’s (1993).',
    caveat: 'With few df or small samples, the test has little power either way.',
    sources: ['browne1993'],
  },
  scaledIncremental: {
    title: 'CFI and TLI (scaled)',
    measures: 'The naive versions: the scaled χ² put into the usual CFI and TLI formulas.',
    read: 'Higher is better, but they estimate a different population value than the standard indices.',
    caveat:
      'The usual cutoffs do not apply to them. Report the robust CFI and TLI (the CFI and TLI rows of this ' +
      'column) instead (Brosseau-Liard & Savalei 2014).',
    sources: ['brosseau2014'],
  },
  rmseaScaled: {
    title: 'RMSEA (scaled)',
    measures: 'The naive version: the scaled χ² put into the usual RMSEA formula.',
    read: 'Lower is better, but it estimates a different population value than the standard RMSEA.',
    caveat:
      'The usual cutoffs do not apply to it. Report the robust RMSEA (the RMSEA row of this column) ' +
      'instead (Brosseau-Liard, Savalei & Li 2012).',
    sources: ['brosseau2012'],
  },
  srmr: {
    title: 'SRMR (standardised root mean square residual)',
    measures:
      'The average difference between the observed correlations and those the model implies.',
    read: 'Lower is better; 0 is perfect fit.',
    cutoff: '≤ .08 (Hu & Bentler 1999).',
    caveat:
      'SRMR has no robust version. ' +
      `Look at the largest residuals (Residuals tab) to see where the misfit is. ${GUIDANCE}`,
    sources: ['hu1999', 'marsh2004rules', 'mcneish2023'],
    dynamic: true,
  },
  logl: {
    title: 'Log-likelihood',
    measures:
      'The log-likelihood of the data under the model at the estimates (maximum likelihood).',
    read: 'Higher (closer to 0) is better, but only between models fitted to the same data and variables.',
    caveat:
      'Its size alone means nothing: it depends on the sample size and the number of variables.',
    sources: [],
  },
  aic: {
    title: 'AIC (Akaike information criterion)',
    measures:
      '−2 × log-likelihood + 2 × free parameters: fit penalised for complexity (Akaike 1974).',
    read: 'Lower is better, for comparing models fitted to the same data and variables (also non-nested ones).',
    caveat: 'There is no cutoff: only differences between models count.',
    sources: ['akaike1974'],
  },
  bic: {
    title: 'BIC (Bayesian information criterion)',
    measures:
      '−2 × log-likelihood + ln(N) × free parameters: penalises complexity more than AIC (Schwarz 1978).',
    read: 'Lower is better, for comparing models fitted to the same data and variables.',
    caveat:
      'There is no cutoff: only differences between models count. BIC favours simpler models than AIC.',
    sources: ['schwarz1978'],
  },
  plsSrmr: {
    title: 'SRMR (PLS-SEM)',
    measures:
      'The average difference between the observed indicator correlations and those the model implies.',
    read: 'Lower is better; 0 is perfect fit.',
    cutoff:
      'Below 0.08 (Henseler et al. 2014, borrowing Hu & Bentler’s 1999 CB-SEM value); for the bootstrap ' +
      'test, below its HI95 (Henseler, Hubona & Ray 2016).',
    caveat: PLS_NOT_ESTABLISHED,
    sources: ['henseler2014', 'hu1999', 'henseler2016imds', 'hair2021'],
  },
  plsDuls: {
    title: 'd_ULS (unweighted least squares discrepancy)',
    measures:
      'The squared Euclidean distance between the observed and the model-implied indicator correlation matrices (Dijkstra & Henseler 2015).',
    read: 'Lower is better; 0 is perfect fit.',
    cutoff:
      'No fixed value: it grows with the number of indicators. Judge it against the bootstrap HI95: at or ' +
      'below it, the model is not rejected at the 5% level (Dijkstra & Henseler 2015; Henseler, Hubona & Ray 2016).',
    caveat: PLS_NOT_ESTABLISHED,
    sources: ['dijkstra2015', 'henseler2016imds', 'hair2021'],
  },
  plsDg: {
    title: 'd_G (geodesic discrepancy)',
    measures:
      'A distance between the observed and the model-implied indicator correlation matrices computed from their eigenvalues (Dijkstra & Henseler 2015).',
    read: 'Lower is better; 0 is perfect fit.',
    cutoff:
      'No fixed value. Judge it against the bootstrap HI95: at or below it, the model is not rejected at the ' +
      '5% level (Dijkstra & Henseler 2015; Henseler, Hubona & Ray 2016).',
    caveat:
      'Shown with natural logarithms, as Dijkstra & Henseler define it; cSEM prints it with base-10 ' +
      `logarithms, about 5.30 times smaller. ${PLS_NOT_ESTABLISHED}`,
    sources: ['dijkstra2015', 'henseler2016imds', 'hair2021'],
  },
  plsTest: {
    title: 'Bootstrap test of exact fit (HI95, HI99)',
    measures:
      'The data are transformed so that the model holds exactly, then bootstrapped; HI95 and HI99 are the ' +
      '95% and 99% quantiles of each discrepancy under that exact fit (Dijkstra & Henseler 2015).',
    read:
      'A discrepancy at or below HI95: the model is not rejected at 5%. Above HI99: rejected at 1%. ' +
      'Henseler, Hubona & Ray (2016) suggest reporting d_ULS and d_G against their HI95.',
    caveat:
      'Like the χ² test, it rejects small misfit in large samples and can miss misfit in small ones. ' +
      PLS_NOT_ESTABLISHED,
    sources: ['dijkstra2015', 'henseler2016imds', 'hair2021'],
  },
};

/** The CB-SEM fit table's row labels (components/results/CbTabs.tsx FitBody) and their help. */
export const CB_FIT_ROWS: Record<string, FitHelpId> = {
  'χ²': 'chisq',
  df: 'df',
  p: 'p',
  'Scaling factor': 'scalingFactor',
  'Shift parameter': 'shiftParameter',
  'χ² (baseline)': 'baselineChisq',
  'df (baseline)': 'baselineDf',
  CFI: 'cfi',
  TLI: 'tli',
  RMSEA: 'rmsea',
  'RMSEA 90% CI': 'rmseaCi',
  'p (RMSEA ≤ .05)': 'rmseaP',
  'CFI / TLI (scaled)': 'scaledIncremental',
  'RMSEA (scaled)': 'rmseaScaled',
  SRMR: 'srmr',
  'Log-likelihood': 'logl',
  AIC: 'aic',
  BIC: 'bic',
};

/** The rows of the CB-SEM fit table that describe the run, not the fit: no help. */
export const CB_RUN_ROWS = [
  'Estimator',
  'Observations',
  'Imputed data sets',
  'Free parameters',
  'Iterations',
];

/** The PLS-SEM fit tables' row labels (components/results/PlsTabs.tsx Fit) and their help. */
export const PLS_FIT_ROWS: Record<string, FitHelpId> = {
  SRMR: 'plsSrmr',
  d_ULS: 'plsDuls',
  d_G: 'plsDg',
};
