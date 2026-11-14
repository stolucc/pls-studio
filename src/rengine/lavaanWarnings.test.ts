import { describe, expect, it } from 'vitest';
import { explainWarning, WARNING_IDS } from './lavaanWarnings';

// lavaan 0.6–0.7's messages as the R bridge passes them on: one line (ps_flat), sometimes with lavaan's
// function prefix, or inside an optional statistic's "could not be computed" message.
const CASES: [string, string][] = [
  [
    'lavaan->lav_model_vcov(): The variance-covariance matrix of the estimated parameters (vcov) does not appear to be positive definite! The smallest eigenvalue (= -1.841565e-17) is smaller than zero. This may be a symptom that the model is not identified.',
    'vcov-npd',
  ],
  [
    'lavaan WARNING: The variance-covariance matrix of the estimated parameters (vcov) does not appear to be positive definite! The smallest eigenvalue (= 2.1e-13) is close to zero. This may be a symptom that the model is not identified.',
    'vcov-npd',
  ],
  ['lavaan->lav_object_post_check(): some estimated ov variances are negative', 'negative-ov'],
  ['lavaan WARNING: some estimated lv variances are negative', 'negative-lv'],
  [
    'lavaan->lav_object_post_check(): covariance matrix of latent variables is not positive definite; use lavInspect(fit, "cov.lv") to investigate.',
    'lv-npd',
  ],
  [
    'lavaan->lav_object_post_check(): the covariance matrix of the residuals of the observed variables (theta) is not positive definite ; use lavInspect(fit, "theta") to investigate.',
    'theta-npd',
  ],
  [
    'lavaan->lav_object_post_check(): the covariance matrix of the residuals in the structural part of the model (psi) is not positive definite ; use lavInspect(fit, "psi") to investigate.',
    'psi-npd',
  ],
  [
    'lavaan->lav_step11_estoptim(): the optimizer warns that a solution has NOT been found!',
    'nonconvergence',
  ],
  ['lavaan WARNING: the optimizer warns that a solution has NOT been found!', 'nonconvergence'],
  [
    'lavaan->lav_model_estimate(): the optimizer (NLMINB) claimed the model converged, but not all elements of the gradient are (near) zero; the optimizer may not have found a local solution use check.gradient = FALSE to skip this check.',
    'gradient',
  ],
  ['lavaan->lav_samp_icov(): sample covariance matrix is not positive-definite', 'sample-npd'],
  [
    'lavaan->lav_model_vcov(): Could not compute standard errors! The information matrix could not be inverted. This may be a symptom that the model is not identified.',
    'se-fail',
  ],
  [
    'lavaan->lav_data_full(): all observed variables are exogenous; model may not be identified',
    'identification',
  ],
  [
    'lavaan->lav_model_est(): initial model-implied matrix (Sigma) is not positive definite; check your model and/or starting parameters',
    'start-npd',
  ],
  ['lavaan WARNING: empty cell(s) in bivariate table of x1 x x2', 'empty-cells'],
  [
    'lavaan->lav_bvord_cor_twostep_fit(): estimation polychoric correlation did not converge for variables x1 and x2',
    'polychoric-nonconvergence',
  ],
  [
    'lavaan->lav_data_full(): some observed variances are (at least) a factor 1000 times larger than others; use varTable(fit) to investigate',
    'scale',
  ],
  ['lavaan->lav_data_full(): some cases are empty and will be ignored: 12, 40.', 'empty-cases'],
  [
    'lavaan->lav_data_full(): small number of observations (nobs < nvar) in group 1: nobs = 8 nvar = 10',
    'small-n',
  ],
  [
    'lavaan->lav_data_full(): due to missing values, some pairwise combinations have zero coverage; the corresponding covariances are not identified; use lavInspect(fit, "coverage") to investigate.',
    'zero-coverage',
  ],
  [
    'lavaan->lav_fit_cfi_lavobject(): robust fit indices are currently not available for categorical data in combination with a non-default baseline model; returning NA.',
    'robust-na',
  ],
  ['lavaan->lav_fit_check_baseline(): baseline model did not converge', 'baseline-nonconvergence'],
  [
    'HTMT (semTools::htmt) could not be computed: argument "data" is missing, with no default',
    'optional-failed',
  ],
];

describe('explainWarning', () => {
  it.each(CASES)('%s → %s', (text, id) => {
    expect(explainWarning(text)?.id).toBe(id);
  });

  it('covers every explanation with a case, and every explanation says what to check and do', () => {
    expect(new Set(CASES.map(([, id]) => id))).toEqual(new Set(WARNING_IDS));
    for (const [text] of CASES) {
      const e = explainWarning(text)!;
      expect(e.meaning.length).toBeGreaterThan(40);
      expect(e.check.length).toBeGreaterThan(0);
      expect(e.action.length).toBeGreaterThan(0);
    }
  });

  it('a sub-step that “did not converge” is not the model’s non-convergence', () => {
    expect(explainWarning('lavaan WARNING: baseline model did not converge')?.id).toBe(
      'baseline-nonconvergence',
    );
    expect(explainWarning('estimation polychoric correlation(s) did not always converge')?.id).toBe(
      'polychoric-nonconvergence',
    );
  });

  it('an unknown warning has no explanation (it is shown as it is)', () => {
    expect(explainWarning('lavaan WARNING: something new happened')).toBeNull();
    expect(explainWarning('')).toBeNull();
  });
});
