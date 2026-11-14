// Plain-language explanations of the warnings lavaan raises (as the R bridge passes them on, one line
// each): what the message means, what to check and what to do. A warning that matches no pattern
// has no explanation and is shown as it is. Patterns follow lavaan 0.6–0.7's wording.

/** The explanation of one warning. */
export interface WarningExplanation {
  id: string;
  /** A short heading. */
  title: string;
  /** What the message means, in plain words. */
  meaning: string;
  /** What to look at in the results. */
  check: string[];
  /** What to do about it. */
  action: string[];
  /** How seriously to take it, in one phrase. */
  severity: 'serious' | 'check' | 'usually harmless';
  /** Works the advice comes from (author, year). */
  sources: string[];
}

interface Rule extends WarningExplanation {
  test: RegExp;
}

const ADMISSIBILITY = 'the Admissibility section on the Model fit tab';

const RULES: Rule[] = [
  {
    id: 'vcov-npd',
    test: /variance-covariance matrix of the estimated\s+parameters\s*\(vcov\)\s+does not appear to be positive\s+definite/i,
    title: 'The covariance matrix of the estimates (vcov) is not positive definite',
    meaning:
      'lavaan found an eigenvalue of the parameters’ sampling covariance matrix at or below zero. The message says “close to zero” or “smaller than zero”. A value around 1e-15 relative to the others is rounding error. A clearly negative value means the data cannot pin down some parameter: the model is empirically not identified.',
    check: [
      `The vcov row in ${ADMISSIBILITY}: it says whether the eigenvalue is rounding-level or not, and names the parameters involved.`,
      'Equality constraints and defined parameters: they can make vcov singular by construction.',
      'Standard errors that are huge or missing for the parameters named.',
    ],
    action: [
      'If the eigenvalue is rounding-level and nothing else is flagged, the warning can be ignored.',
      'Otherwise look at the parameters named: a factor with two indicators whose correlation with other factors is near zero, or a path that another parameter depends on, needs a constraint or more indicators.',
    ],
    severity: 'check',
    sources: ['Chen et al. (2001)', 'Venables & Ripley (2002)'],
  },
  {
    id: 'negative-ov',
    test: /some estimated ov variances are negative/i,
    title: 'Negative residual variance (a Heywood case)',
    meaning:
      'At least one indicator has a negative residual (error) variance. A variance cannot be negative, so the solution is improper, even though it converged and the fit may look good.',
    check: [
      `Which indicator, and whether the 95% interval of its variance includes zero: ${ADMISSIBILITY}.`,
      'Standardised loadings above 1 for the same indicator.',
      'Whether its factor has only two indicators, and the sample size.',
    ],
    action: [
      'A small negative variance whose interval includes zero can be sampling error: report it, and if you fix it at zero, say so.',
      'A negative variance clearly below zero points to a misspecified model: a missing cross-loading or error correlation, or the wrong number of factors. Revise the model on theory.',
    ],
    severity: 'serious',
    sources: ['Kolenikov & Bollen (2012)', 'Chen et al. (2001)'],
  },
  {
    id: 'negative-lv',
    test: /some estimated lv variances are negative/i,
    title: 'Negative latent variance',
    meaning:
      'A latent variable (or the disturbance of an endogenous one) has a negative variance. The solution is improper.',
    check: [
      `Which latent variable, and the 95% interval of its variance: ${ADMISSIBILITY}.`,
      'Factor correlations close to or beyond ±1 with that factor.',
    ],
    action: [
      'A disturbance variance below zero often means the predictors explain “more than all” of the factor: two of them overlap with it, or a factor is redundant. Merge or drop the redundant factor, or revise the paths.',
      'A small, non-significant negative value can be sampling error; report it.',
    ],
    severity: 'serious',
    sources: ['Chen et al. (2001)', 'Kolenikov & Bollen (2012)'],
  },
  {
    id: 'lv-npd',
    test: /covariance matrix of latent variables\s+is not positive definite/i,
    title: 'The covariance matrix of the latent variables is not positive definite',
    meaning:
      'The factors’ variances and covariances do not form a possible covariance matrix: a latent correlation is at or beyond ±1, or a combination of factors has a negative variance.',
    check: [
      `The latent correlations and the factors most involved: ${ADMISSIBILITY}.`,
      'Two factors whose indicators measure the same thing.',
    ],
    action: [
      'Fit the model with the two factors merged and compare, or return to an exploratory factor analysis with one factor fewer.',
      'Do not interpret this solution as it stands.',
    ],
    severity: 'serious',
    sources: ['Wothke (1993)', 'Chen et al. (2001)'],
  },
  {
    id: 'theta-npd',
    test: /covariance matrix of the residuals of the observed variables\s*\(theta\)\s*is not positive definite/i,
    title: 'The residual covariance matrix (θ) is not positive definite',
    meaning:
      'The error variances and error covariances of the indicators do not form a possible covariance matrix: an error correlation is beyond ±1, or an error variance is negative.',
    check: [`The residual correlations and variances flagged in ${ADMISSIBILITY}.`],
    action: [
      'Remove error covariances that theory does not require; a residual correlation beyond ±1 usually means the two indicators share more than the model allows (a missing factor).',
    ],
    severity: 'serious',
    sources: ['Wothke (1993)'],
  },
  {
    id: 'psi-npd',
    test: /covariance matrix of the residuals in the structural part of\s+the model\s*\(psi\)\s*is not positive definite/i,
    title: 'The disturbance covariance matrix (ψ) is not positive definite',
    meaning:
      'The disturbances of the latent variables (what their predictors leave unexplained) have an impossible covariance matrix: a negative disturbance variance or a disturbance correlation beyond ±1.',
    check: [`The flagged latent variances and correlations in ${ADMISSIBILITY}.`],
    action: [
      'Check for predictors that overlap almost completely with the outcome, and for disturbance covariances that theory does not require.',
    ],
    severity: 'serious',
    sources: ['Wothke (1993)', 'Chen et al. (2001)'],
  },
  {
    id: 'nonconvergence',
    // (case-sensitive NOT: lavaan's own wording; other messages say a sub-step “did not converge”)
    test: /solution has NOT been found|did NOT converge|has NOT converged/,
    title: 'The estimation did not converge',
    meaning:
      'The optimiser stopped before reaching a solution. The numbers shown are where it stopped, not estimates.',
    check: [
      'A factor without a scale (no marker indicator and no fixed variance), or an arrow in the wrong place.',
      'Variables on very different scales (variances differing by a factor of 1000 or more).',
      'Very small groups or clusters.',
    ],
    action: [
      'Do not interpret the results. Fix any specification error, rescale variables, or simplify the model and add parts back one at a time.',
    ],
    severity: 'serious',
    sources: ['Chen et al. (2001)'],
  },
  {
    id: 'gradient',
    test: /not all elements of the gradient are \(near\) zero/i,
    title: 'Convergence is doubtful (the gradient is not zero)',
    meaning:
      'The optimiser reported convergence, but the slope of the fit function is not flat at the solution, so it may not be a true minimum.',
    check: ['Variables on very different scales.', `Any improper values in ${ADMISSIBILITY}.`],
    action: [
      'Rescale variables with large variances, or tighten the convergence criteria, and check that the estimates stay the same.',
    ],
    severity: 'check',
    sources: ['Chen et al. (2001)'],
  },
  {
    id: 'sample-npd',
    test: /sample covariance matrix is not positive-?\s*definite/i,
    title: 'The sample covariance matrix is not positive definite',
    meaning:
      'The problem is in the data, not the model: the observed covariances (or polychoric correlations) cannot all hold at once.',
    check: [
      'A variable that is the sum or a copy of others (e.g. a total score next to its items).',
      'Fewer cases than variables, or pairwise deletion.',
      'Polychoric correlations from sparse tables (ordinal items with rarely used categories).',
    ],
    action: [
      'Remove redundant variables, use casewise deletion or FIML instead of pairwise deletion, or collapse rare categories.',
    ],
    severity: 'serious',
    sources: ['Wothke (1993)'],
  },
  {
    id: 'se-fail',
    test: /could not compute standard errors|information matrix\s+could not be inverted|information matrix is not positive definite/i,
    title: 'Standard errors could not be computed',
    meaning:
      'The information matrix is singular, which usually means the model is not identified: some parameter can change without changing the fit.',
    check: [
      'Factors with fewer than three indicators that do not correlate with other factors.',
      'A higher-order factor on only two first-order factors.',
      'More free parameters than variances and covariances (negative degrees of freedom).',
      'The Model tab’s issue list, which flags common identification problems.',
    ],
    action: [
      'Add indicators, fix or constrain a parameter (e.g. equal loadings), or remove a path or covariance that theory does not need.',
    ],
    severity: 'serious',
    sources: ['Bollen (1989)'],
  },
  {
    id: 'identification',
    test: /may not be identified|is not identified|not be identified/i,
    title: 'The model may not be identified',
    meaning: 'lavaan suspects that some parameters cannot be estimated uniquely from the data.',
    check: [
      'The Model tab’s issue list (indicators per factor, higher-order factors, degrees of freedom).',
      `The vcov row in ${ADMISSIBILITY}.`,
    ],
    action: ['Add indicators or constraints, or simplify the model.'],
    severity: 'serious',
    sources: ['Bollen (1989)'],
  },
  {
    id: 'start-npd',
    test: /initial model-implied matrix \(Sigma\) is not positive definite/i,
    title: 'The starting values give an impossible covariance matrix',
    meaning:
      'The values lavaan started from imply a covariance matrix that is not positive definite. The estimation may still succeed; if it does not, the starting values are the problem.',
    check: ['Fixed values or starting values you entered.', 'Whether the estimation converged.'],
    action: ['If it did not converge, remove or change the fixed and starting values.'],
    severity: 'check',
    sources: ['Wothke (1993)'],
  },
  {
    id: 'empty-cells',
    test: /empty cell\(s\) in bivariate table|two empty cells in 2x2 table/i,
    title: 'Empty cells in a two-way table of ordinal variables',
    meaning:
      'Some combinations of categories of two ordinal variables never occur. Their polychoric correlation is then poorly determined and can be pushed to ±1.',
    check: [
      `The ordinal pairs listed in ${ADMISSIBILITY}.`,
      'Categories chosen by very few respondents.',
    ],
    action: ['Collapse rarely used neighbouring categories, or collect more cases.'],
    severity: 'check',
    sources: ['Chen et al. (2001)'],
  },
  {
    id: 'polychoric-nonconvergence',
    test: /estimation polychoric correlation|estimation polyserial correlation|two-level polychoric/i,
    title: 'A polychoric (or polyserial) correlation did not converge',
    meaning:
      'For at least one pair of ordinal variables the correlation could not be estimated well, usually because of sparse or empty category combinations.',
    check: ['The pairs named in the message.', 'Rarely used categories.'],
    action: ['Collapse rare categories; check for a variable with almost no variation.'],
    severity: 'check',
    sources: ['Chen et al. (2001)'],
  },
  {
    id: 'scale',
    test: /observed variances are \(at least\) a factor 1000|observed variances are larger than 1000000/i,
    title: 'Variables on very different scales',
    meaning:
      'Some variances are at least 1000 times larger than others. This can slow or prevent convergence; it does not by itself make the estimates wrong.',
    check: ['The variances of the indicators (e.g. income in units next to 1–5 items).'],
    action: ['Rescale the large variables (e.g. income in thousands) and run again.'],
    severity: 'usually harmless',
    sources: [],
  },
  {
    id: 'empty-cases',
    test: /some cases are empty and will be ignored/i,
    title: 'Some cases have no data on any model variable',
    meaning: 'Rows in which every model variable is missing carry no information and are left out.',
    check: ['That the number of observations is what you expect.'],
    action: ['Nothing, unless many rows are affected; then check the data import.'],
    severity: 'usually harmless',
    sources: [],
  },
  {
    id: 'small-n',
    test: /small number of observations \(nobs < nvar\)/i,
    title: 'Fewer cases than variables',
    meaning:
      'With fewer cases than variables the sample covariance matrix is singular, and the estimates are very unstable.',
    check: ['The sample size per group.'],
    action: ['Collect more data, reduce the number of variables, or use parcels or composites.'],
    severity: 'serious',
    sources: ['Wothke (1993)'],
  },
  {
    id: 'zero-coverage',
    test: /pairwise combinations have zero\s+coverage/i,
    title: 'Two variables are never observed together',
    meaning:
      'Because of missing values, some pairs of variables have no case with both observed; their covariance cannot be estimated.',
    check: ['The missing-data pattern (planned missingness, separate questionnaire versions).'],
    action: ['Remove one of the variables from the model, or change the design of the analysis.'],
    severity: 'serious',
    sources: [],
  },
  {
    id: 'robust-na',
    test: /robust fit indices are currently not available for\s+categorical data/i,
    title: 'Robust fit indices unavailable',
    meaning:
      'lavaan does not compute robust CFI, TLI and RMSEA for categorical data with a non-default baseline model; they are shown as missing.',
    check: ['The scaled fit indices, which are available.'],
    action: ['Report the scaled indices and say why the robust ones are missing.'],
    severity: 'usually harmless',
    sources: [],
  },
  {
    id: 'baseline-nonconvergence',
    test: /baseline model did not converge/i,
    title: 'The baseline model did not converge',
    meaning:
      'CFI and TLI compare the model with a baseline model; that baseline did not converge, so they are not trustworthy.',
    check: ['CFI and TLI on the Model fit tab.'],
    action: ['Rely on χ², RMSEA and SRMR, and report why CFI and TLI are left out.'],
    severity: 'check',
    sources: [],
  },
  {
    id: 'optional-failed',
    test: /^.+ could not be computed: /,
    title: 'An extra statistic could not be computed',
    meaning:
      'One of the additional statistics (named at the start of the message) failed. The model estimates themselves are not affected; that statistic is simply missing.',
    check: ['Which statistic is named, and the reason given after the colon.'],
    action: ['Usually nothing. If you need that statistic, the reason tells you what to change.'],
    severity: 'usually harmless',
    sources: [],
  },
];

/** The explanation of a warning, or null when it matches no known message (show it as it is). */
export function explainWarning(text: string): WarningExplanation | null {
  const rule = RULES.find((r) => r.test.test(text));
  if (!rule) return null;
  const { test: _test, ...explanation } = rule;
  return explanation;
}

/** The ids of every explanation, for tests. */
export const WARNING_IDS = RULES.map((r) => r.id);
