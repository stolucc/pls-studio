// What each webR test file validates (src/validation/setup.ts records its toBeCloseTo and near() comparisons as
// evidence under this entry), or 'examples' (its evidence is recorded per example with verify(),
// record.ts) or 'none' (it tests plumbing: syntax, security, error messages). Every webR test file is
// listed (validation/features.test.ts), so a new one has to say which; so is every plain test file that
// validate:evidence records without R (evidenceRuns.json `fixture`: the built-in engine, recorded desktop runs).
// The webR files of desktop-only packages (evidenceRuns.json `desktop`) are recorded in desktop R instead
// (npm run validate:evidence:desktop), their checks marked as such.

import type { EvidenceLevel, EvidenceSource } from './types';

export interface FeatureEntry {
  title: string;
  method: string;
  level: EvidenceLevel;
  sources: EvidenceSource[];
  packages: string[];
}

const script = (name: string, what: string): EvidenceSource => ({
  label: `${what}, scripts/validation/${name}`,
  script: `scripts/validation/${name}`,
});
const native = (
  title: string,
  method: string,
  packages: string[],
  ...sources: EvidenceSource[]
): FeatureEntry => ({ title, method, level: 'native', sources, packages });

export const FEATURES: Record<string, FeatureEntry | 'examples' | 'none'> = {
  // Examples: graded per example with verify().
  'examples/bollen': 'examples',
  'examples/bollen1989': 'examples',
  'examples/bollencurran': 'examples',
  'examples/brown': 'examples',
  'examples/builtin': 'examples',
  'examples/causal': 'examples',
  'examples/cards/basic': 'examples',
  'examples/eqs': 'examples',
  'examples/imputation': 'examples',
  'examples/kline': 'examples',
  'examples/manymome': 'examples',
  'examples/mplus/ch3': 'examples',
  'examples/mplus/ch4': 'examples',
  'examples/mplus/ch5': 'examples',
  'examples/mplus/ch5efa': 'examples',
  'examples/mplus/ch6': 'examples',
  'examples/mplus/ch6surv': 'examples',
  'examples/mplus/ch11': 'examples',
  'examples/mplus/ch7': 'examples',
  'examples/mplus/ch7mix': 'examples',
  'examples/mplus/ch7reg': 'examples',
  'examples/mplus/ch8mix': 'examples',
  'examples/mplus/ch8': 'examples',
  'examples/mplus/ch9': 'examples',
  'examples/mplus/ch9random': 'examples',
  'examples/mplus/ch6random': 'examples',
  'examples/mplus/ch3random': 'examples',
  'examples/packages': 'examples',
  'examples/plsGender': 'examples',
  'examples/selection': 'examples',
  'examples/cards/bayes': 'examples',
  'examples/cards/model': 'examples',
  'examples/cards/dfi': 'examples',
  'examples/cards/validity': 'examples',
  'examples/cards/scoretest': 'examples',
  'examples/cards/lcs': 'examples',
  'examples/cards/hypotheses': 'examples',
  'examples/cards/apim': 'examples',
  'examples/cards/qca': 'examples',
  'examples/cards/meta': 'examples',
  'examples/cards/roc': 'examples',
  'examples/cards/invariance': 'examples',
  'examples/cards/missing': 'examples',
  'examples/cards/sensitivity': 'examples',
  'examples/cards/likelihood': 'examples',
  'examples/cards/items': 'examples',
  'examples/mplus/ch5irt': 'examples',
  'examples/mplus/ch7irt': 'examples',
  'examples/mplus/ch6glmm': 'examples',
  'examples/mplus/ch10': 'examples',
  'examples/mplus/quadml': 'examples',
  'examples/cards/integration': 'examples',
  'examples/mplus/ch7int': 'examples',
  'examples/mplus/ch8int': 'examples',
  'examples/mplus/ch10mix': 'examples',

  'examples/bifactor': native(
    'Bifactor CFA on open data',
    'CB-SEM',
    ['lavaan'],
    script('bifactor_cpb.R', 'Plain lavaan calls with the settings of the study’s own code'),
  ),

  // CB-SEM (lavaan and friends)
  'rengine/lavaan': native(
    'CB-SEM estimation',
    'CB-SEM',
    ['lavaan'],
    script('generate.R', 'desktop lavaan, the reference corpus'),
  ),
  'rengine/adf': native(
    'Distribution-free estimation (ADF / WLS)',
    'CB-SEM',
    ['lavaan'],
    script('adf.R', 'desktop lavaan'),
  ),
  'rengine/categorical': native(
    'Ordinal indicators (WLSMV) and FIML',
    'CB-SEM',
    ['lavaan'],
    script('categorical_fiml.R', 'desktop lavaan'),
  ),
  'rengine/ordinalFit': native(
    'Sample polychoric correlations (SAMPSTAT) and bivariate fit (TECH10)',
    'CB-SEM',
    ['lavaan'],
    script('ordinal_fit.R', 'desktop lavaan, psych::polychoric and a computation by hand'),
  ),
  'rengine/cbComposite': native(
    'Composites in CB-SEM',
    'CB-SEM',
    ['lavaan'],
    script('cb_composite.R', 'desktop lavaan'),
  ),
  'rengine/cbDiag': native(
    'Local fit (residual z-tests, SRMR tests, Browne’s, scaled, Hayakawa and FMG tests), FIML auxiliary variables, discriminant validity (CI-CFA, χ²(cut)), model comparison (NET, LRT, Vuong, icci), EPC-based misspecification (epcEquivFit)',
    'CB-SEM',
    ['lavaan', 'semTools', 'nonnest2'],
    script(
      'cbdiag.R',
      'direct lavaan, semTools and nonnest2 calls (lavResiduals, lavTest, aux =, discriminantValidity, lavTestNET, lavTestLRT, vuongtest, icci, epcEquivFit)',
    ),
  ),
  'rengine/cbExtras': native(
    'Bollen–Stine bootstrap, Wald tests, factor-score weights',
    'CB-SEM',
    ['lavaan'],
    script('cbextras.R', 'desktop lavaan'),
  ),
  'rengine/search': native(
    'Specification search, equivalent models, multivariate LM and Wald tests, regularised SEM',
    'CB-SEM',
    ['lavaan', 'lslx'],
    script('specsearch.R', 'desktop lavaan, each model written out and fitted on its own'),
    script('equivalent.R', 'desktop lavaan, the equivalent alternatives written out by hand'),
    script(
      'lmwald.R',
      'desktop lavaan, EQS’s stepwise tests with lavTestScore (cumulative) and lavTestWald',
    ),
    script('lslx.R', 'desktop lslx, its documented semi-confirmatory factor analysis'),
  ),
  'rengine/complex': native(
    'Cluster-robust standard errors (TYPE = COMPLEX)',
    'CB-SEM',
    ['lavaan'],
    script('complex.R', 'desktop lavaan'),
  ),
  'rengine/constraints': native(
    'Equality constraints, defined parameters',
    'CB-SEM',
    ['lavaan'],
    script('categorical_fiml.R', 'desktop lavaan'),
  ),
  'rengine/esem': native(
    'Exploratory SEM and bifactor rotations',
    'CB-SEM',
    ['lavaan'],
    script('esem.R', 'desktop lavaan'),
    script('bifactor.R', 'desktop lavaan and psych::omegaFromSem'),
  ),
  'rengine/hypotheses': native(
    'Informative hypotheses: GORICA (restriktor::goric) and Bayes factors (bain)',
    'CB-SEM',
    ['lavaan', 'restriktor', 'bain'],
    script('hypotheses.R', 'direct restriktor::goric, semTools::goricaSEM and bain::bain calls'),
  ),
  'rengine/apim': native(
    'Dyadic APIM: distinguishable and indistinguishable dyads, k, test of distinguishability',
    'CB-SEM',
    ['lavaan'],
    script(
      'apim.R',
      'dySEM 1.4.1 scriptAPIM syntax and hand-written lavaan syntax (Kenny, Kashy & Cook 2006)',
    ),
  ),
  'rengine/inequality': native(
    'Inequality constraints',
    'CB-SEM',
    ['lavaan'],
    script('inequality.R', 'desktop lavaan'),
  ),
  'rengine/means': native(
    'Mean structures',
    'CB-SEM',
    ['lavaan'],
    script('means.R', 'desktop lavaan'),
  ),
  'rengine/tech4': native(
    'Implied latent moments (TECH4)',
    'CB-SEM',
    ['lavaan'],
    script('tech4.R', 'desktop lavaan, defined parameters (delta method)'),
  ),
  'rengine/mi': native(
    'Multiple imputation',
    'CB-SEM',
    ['lavaan', 'mice', 'lavaan.mi'],
    script('mi.R', 'desktop mice and lavaan.mi'),
  ),
  'rengine/missingTwoStage': native(
    'Pairwise deletion and two-stage missing data',
    'CB-SEM',
    ['lavaan'],
    script('missing_twostage.R', 'desktop lavaan'),
  ),
  'rengine/multigroup': native(
    'Multiple groups and invariance',
    'CB-SEM',
    ['lavaan', 'semTools'],
    script('multigroup.R', 'desktop lavaan'),
  ),
  'rengine/twolevel': native('Two-level SEM', 'CB-SEM', ['lavaan'], {
    label: 'lavaan called directly in the same R',
  }),
  'rengine/rsem': native('Robust ML (rsem)', 'CB-SEM', ['rsem'], script('rsem.R', 'desktop rsem')),
  'rengine/weights': native(
    'Sampling weights',
    'CB-SEM',
    ['lavaan'],
    script('weights.R', 'desktop lavaan'),
  ),
  'rengine/reliability': native(
    'Reliability (omega, alpha)',
    'CB-SEM',
    ['semTools'],
    script('reliability.R', 'desktop semTools'),
  ),
  'rengine/reliabilitySingle': native(
    'Single indicators with known reliability',
    'CB-SEM',
    ['lavaan'],
    script('reliability_single.R', 'desktop lavaan'),
  ),
  'rengine/scores': native(
    'Factor scores, their standard errors, plausible values',
    'CB-SEM',
    ['lavaan', 'semTools'],
    { label: 'lavPredict and semTools::plausibleValues called directly in the same R' },
  ),
  'rengine/groupBoot': native('Bootstrap with groups', 'CB-SEM', ['lavaan'], {
    label: 'lavaan::bootstrapLavaan in the same R',
  }),
  'rengine/modsem': native(
    'Latent interactions (LMS, QML)',
    'CB-SEM',
    ['modsem'],
    script('modsem.R', 'desktop modsem'),
    { label: 'modsem called directly in the same R' },
  ),
  'rengine/modsemBoot': native('Bootstrap of latent interactions', 'CB-SEM', ['modsem'], {
    label: 'resampling with modsem in the same R',
  }),
  'rengine/metasem': native(
    'Meta-analytic SEM (two-stage SEM)',
    'CB-SEM',
    ['metaSEM'],
    script('metasem.R', 'desktop metaSEM'),
  ),
  'rengine/semtree': native(
    'SEM trees and forests',
    'CB-SEM',
    ['semtree'],
    script('semtree.R', 'desktop semtree'),
  ),
  'rengine/plssem': native(
    'Multilevel PLS-SEM (MC-PLSc, random slopes)',
    'PLS-SEM',
    ['plssem'],
    script(
      'plssem_multilevel.R',
      'desktop plssem with the same seed (the vignette prints no numbers)',
    ),
  ),
  'rengine/power': native(
    'Power analysis (a priori, post hoc, compromise, a parameter; RMSEA equivalence test)',
    'CB-SEM',
    ['semPower', 'lavaan'],
    script('sempower.R', 'desktop semPower, dynamic::equivTest and lavaan'),
  ),
  'rengine/pwr': native(
    'Power for standard tests (t-tests, ANOVA, proportions, correlation, chi-square, regression)',
    'Basic statistics',
    ['pwr'],
    script('pwr.R', 'desktop pwr on its help pages’ examples (Cohen 1988)'),
  ),
  'rengine/screen': native(
    'Data screening (outliers, influence)',
    'CB-SEM',
    ['semfindr'],
    script('screen.R', 'desktop semfindr'),
  ),
  'rengine/explore': native(
    'Descriptives: statistics by group, frequency tables, normality tests',
    'Basic statistics',
    ['stats', 'nortest'],
    script('explore.R', 'desktop R: psych::describe(type = 2), quantile, nortest'),
  ),
  'rengine/analyses': native(
    'MIIV-2SLS, IPMA, model fit test',
    'CB-SEM',
    ['MIIVsem', 'cSEM'],
    script('generate.R', 'desktop MIIVsem and cSEM'),
  ),

  // PLS-SEM
  'rengine/pls': native(
    'PLS-SEM and PLSc estimation',
    'PLS-SEM',
    ['cSEM', 'seminr'],
    script('generate.R', 'desktop cSEM and seminr'),
    script('categorical_pls.R', 'desktop cSEM'),
  ),
  'rengine/ordinalPls': native(
    'Ordinal PLS (OrdPLS / OrdPLSc) and its bootstrap',
    'PLS-SEM',
    ['cSEM'],
    script('ordinal_pls.R', 'desktop cSEM on the ?predict help page’s ordinal data'),
  ),
  'rengine/plsx': native(
    'PLS assessment: MICOM, MGA, PLSpredict, CVPAT, CTA, blindfolding',
    'PLS-SEM',
    ['cSEM', 'seminr'],
    script('plsx.R', 'desktop cSEM and seminr'),
  ),
  'rengine/hoc': native(
    'Higher-order constructs',
    'PLS-SEM',
    ['cSEM', 'seminr'],
    script('hoc-approaches.R', 'desktop cSEM and seminr'),
  ),
  'rengine/bca': native('BCa bootstrap intervals', 'PLS-SEM', ['cSEM'], {
    label: 'cSEM::infer in the same R',
  }),
  'rengine/fimix': native(
    'FIMIX segmentation',
    'PLS-SEM',
    ['plspm'],
    script('fimix.R', 'desktop R'),
  ),
  'rengine/segment': native(
    'REBUS segmentation',
    'PLS-SEM',
    ['plspm'],
    script('rebus.R', 'desktop plspm'),
  ),
  'rengine/pathmox': native(
    'PATHMOX segmentation',
    'PLS-SEM',
    ['genpathmox'],
    script('pathmox.R', 'desktop genpathmox'),
  ),
  'rengine/pos': {
    title: 'Prediction-oriented segmentation',
    method: 'PLS-SEM',
    level: 'recovery',
    sources: [{ label: 'simulated segments with known membership' }],
    packages: [],
  },
  'rengine/cta': {
    title: 'Confirmatory tetrad analysis',
    method: 'PLS-SEM',
    level: 'recovery',
    sources: [{ label: 'simulated data with known measurement models' }],
    packages: [],
  },
  'rengine/quadratic': {
    title: 'Quadratic effects',
    method: 'PLS-SEM',
    level: 'recovery',
    sources: [{ label: 'simulated data with a known curvature' }],
    packages: ['cSEM', 'seminr'],
  },
  'rengine/published': {
    title: 'Published PLS-SEM results',
    method: 'PLS-SEM',
    level: 'published',
    packages: ['seminr', 'cSEM'],
    sources: [
      { label: 'Hair, Hult, Ringle, Sarstedt et al. (2021), PLS-SEM Using R, chapters 4 and 6' },
      { label: 'Monecke & Leisch (2012), Journal of Statistical Software 48(3)' },
    ],
  },
  'rengine/barcomb': {
    title: 'A published PLS-SEM study (Barcomb et al., ICSE 2019)',
    method: 'PLS-SEM',
    level: 'published',
    packages: ['seminr', 'plspm'],
    sources: [{ label: 'Barcomb et al. (2019), ICSE: the paper’s tables' }],
  },
  'rengine/mc': {
    title: 'Monte Carlo power simulation',
    method: 'PLS-SEM',
    level: 'recovery',
    sources: [{ label: 'the built-in simulation engine' }],
    packages: ['lavaan'],
  },

  // PROCESS
  'rengine/cpa': {
    title: 'PROCESS models',
    method: 'PROCESS',
    level: 'published',
    packages: ['lavaan'],
    sources: [
      {
        label: 'Hayes’s PROCESS for R, every model',
        script: 'scripts/validation/process_reference.R',
      },
    ],
  },
  'rengine/cpaCategorical': native(
    'PROCESS with a categorical X or W',
    'PROCESS',
    ['lavaan'],
    script('process_extensions.R', 'PROCESS for R'),
  ),
  'rengine/cpaGlm': native(
    'PROCESS with a binary outcome',
    'PROCESS',
    ['stats'],
    script('process_extensions.R', 'PROCESS for R'),
  ),
  'rengine/cpaSam': {
    title: 'Mediation with structural-after-measurement (manymome)',
    method: 'PROCESS',
    level: 'published',
    packages: ['manymome'],
    sources: [{ label: 'manymome’s SAM article: printed values' }],
  },

  // Other analyses
  'rengine/efa': native(
    'Exploratory factor analysis and PCA',
    'EFA',
    ['psych'],
    script('efa.R', 'desktop psych'),
    script('efa_polychoric.R', 'desktop psych and lavaan::lavCor'),
    script('efa_pa.R', 'desktop psych, principal axis'),
    script('efa_congruence.R', 'desktop psych, factor.congruence'),
    script('efa_schmid.R', 'desktop psych, omega'),
  ),
  'rengine/items': native(
    'IRT and latent class analysis',
    'Items',
    ['ltm', 'poLCA', 'mirt', 'glca'],
    script('items.R', 'desktop ltm and poLCA'),
  ),
  'rengine/meta': native(
    'Meta-analysis: escalc, equal- and random-effects models, meta-regression, three-level models, bias, influence',
    'Meta-analysis',
    ['metafor'],
    script(
      'meta.R',
      'desktop metafor on metadat’s dat.bcg, normand1999, molloy2014, pritz1997, konstantopoulos2011',
    ),
  ),
  'rengine/roc': native(
    'ROC analysis: AUC intervals, cut-points, partial AUC, DeLong’s paired and unpaired tests',
    'Basic statistics',
    ['pROC'],
    script('roc.R', 'desktop pROC on its aSAH data'),
  ),
  'rengine/psem': native(
    'Piecewise SEM: d-separation tests, Fisher’s C, AIC, standardised coefficients',
    'Regression',
    ['piecewiseSEM', 'lme4'],
    script('psem.R', 'desktop piecewiseSEM on its keeley and shipley data'),
  ),
  'rengine/lcaAux': native(
    'Latent classes’ auxiliary variables: three-step (classification errors, BCH, ML three-step)',
    'Items',
    ['poLCA'],
    {
      label:
        'StepMix 3.0.0 (Python), an independent implementation, on poLCA’s election data; sandwich SEs from numerical derivatives, scripts/validation/lca_aux.py',
      script: 'scripts/validation/lca_aux.py',
    },
  ),
  'rengine/invariance': native(
    'Longitudinal invariance, DIF by MIMIC',
    'CB-SEM',
    ['lavaan', 'semTools'],
    script('invariance_cards.R', 'desktop lavaan, the models written out by hand'),
  ),
  'rengine/longitudinal': native(
    'Growth models, RI-CLPM',
    'Longitudinal',
    ['lavaan'],
    script('longitudinal.R', 'desktop lavaan'),
  ),
  'rengine/mixed': native(
    'Mixed models, growth mixture models',
    'Longitudinal',
    ['lme4', 'lcmm'],
    script('mixed.R', 'desktop lme4 and lcmm'),
  ),
  'rengine/did': native(
    'Difference-in-differences',
    'Causal inference',
    ['did', 'fixest'],
    script('did.R', 'desktop did and fixest'),
  ),
  'rengine/match': native(
    'Matching and weighting',
    'Causal inference',
    ['MatchIt', 'WeightIt'],
    script('match.R', 'desktop MatchIt'),
    script('weightit.R', 'desktop WeightIt'),
  ),
  'rengine/endo': native(
    'Endogeneity: IV, copulas, Heckman',
    'Regression',
    ['ivreg', 'REndo', 'sampleSelection'],
    script('endo.R', 'desktop R'),
  ),
  'rengine/regression': native(
    'Regression (linear, GLM, ordinal, multinomial, censored, survival, zero-inflated and hurdle counts)',
    'Regression',
    ['stats', 'MASS', 'nnet', 'survival', 'pscl', 'lmtest'],
    script('regression.R', 'desktop R'),
    script('zeroinfl.R', 'desktop pscl (zeroinfl, hurdle, vuong)'),
    script('regression_links.R', 'desktop glm and MASS::polr with the other links'),
    script('durbin_watson.R', 'desktop lmtest::dwtest'),
    script(
      'regression_extras.R',
      'desktop lm, ppcor, car::vif and influence.measures (blocks, part and partial r, case diagnostics)',
    ),
  ),
  'rengine/km': native(
    'Kaplan–Meier curves, median survival, risk table, log-rank and Peto tests',
    'Regression',
    ['survival'],
    script('survival_km.R', 'desktop survival (survfit, survdiff) on its help pages’ data'),
  ),
  'rengine/pcor': native(
    'Partial and semi-partial correlations (Pearson, Spearman, Kendall)',
    'Basic statistics',
    ['ppcor'],
    script('regression_extras.R', 'desktop ppcor on its help page’s data and ?swiss'),
  ),
  'rengine/rsa': native(
    'Response surface analysis',
    'Regression',
    ['RSA'],
    script('rsa.R', 'desktop RSA'),
  ),
  'rengine/dataSummary': native(
    'Data summary for secondary analysis (JARS): refit from the statistics',
    'CB-SEM',
    ['lavaan'],
    { label: 'the package’s refit.R in desktop lavaan, against the raw-data fit' },
  ),
  'rengine/nca': native(
    'Necessary condition analysis',
    'NCA',
    ['NCA'],
    script('nca.R', 'desktop NCA'),
    script('nca-outliers.R', 'desktop NCA: nca_outliers and nca_analysis without each outlier'),
  ),
  'rengine/network': native(
    'Network psychometrics and EGA',
    'Networks',
    ['bootnet', 'EGAnet'],
    script('network.R', 'desktop bootnet and EGAnet'),
    script('network_modes.R', 'desktop bootnet (pcor, cor, Spearman) and EGAnet (TMFG)'),
  ),
  'rengine/emm': native(
    'Estimated marginal means, post hoc tests, simple effects, contrasts',
    'Basic statistics',
    ['emmeans'],
    script('emm.R', 'desktop emmeans, afex (repeated measures), rstatix (Games–Howell), lmerTest'),
  ),
  'rengine/robust': native(
    'Robust (trimmed means), bootstrap and permutation alternatives',
    'Basic statistics',
    ['WRS2', 'boot', 'coin'],
    script('robust.R', 'desktop WRS2, boot and coin with the same seed; coin’s exact p-values'),
  ),
  'rengine/tests': native(
    'Basic statistics: t-tests, ANOVA, correlations, contingency tables',
    'Basic statistics',
    ['stats', 'Bayesrel'],
    script('tests.R', 'desktop R'),
    script('bayesrel.R', 'desktop Bayesrel, same seed'),
  ),
  'rengine/effects': native(
    'Effect sizes with intervals and equivalence tests of the basic tests',
    'Basic statistics',
    ['effectsize', 'TOSTER'],
    script('effects.R', 'desktop effectsize and TOSTER'),
  ),
  'rengine/agreement': native(
    'Reliability and agreement: standard errors of measurement, multi-rater agreement',
    'Basic statistics',
    ['psych', 'irr', 'irrCAC'],
    script('agreement.R', 'desktop psych, irr and irrCAC'),
  ),
  'rengine/nonparametric': native(
    'Nonparametric tests: McNemar, Bowker, Cochran’s Q, Dunn, Conover',
    'Basic statistics',
    ['stats'],
    script('nonparametric.R', 'desktop R, DescTools, dunn.test and PMCMRplus'),
  ),
  'rengine/correlationPolychoric': native(
    'Polychoric correlations',
    'Basic statistics',
    ['lavaan'],
    script('correlation_polychoric.R', 'desktop lavaan and psych::polychoric'),
  ),
  'rengine/quadmlCount': {
    title: 'Count indicators on the canvas (numerical integration)',
    method: 'CB-SEM',
    level: 'published',
    packages: ['pscl'],
    sources: [
      {
        label:
          'Mplus User’s Guide, example 6.6 drawn on the canvas: the printed output (statmodel.com)',
        url: 'https://www.statmodel.com/ugexcerpts.shtml',
      },
      script('zeroinfl.R', 'desktop pscl::zeroinfl (the engine’s zero-inflated counts)'),
    ],
  },
  'rengine/bayes': native(
    'Bayesian tests',
    'Bayesian',
    ['BayesFactor'],
    script('bayes.R', 'numerical integration'),
    script('bayes_native.R', 'desktop BayesFactor'),
  ),
  'rengine/inlavaan': native(
    'Approximate Bayesian SEM (INLAvaan)',
    'Bayesian',
    ['INLAvaan'],
    script('inlavaan.R', 'direct INLAvaan calls in desktop R, and blavaan’s MCMC'),
  ),
  'analyses/cards': native('Analysis cards end to end', 'Analyses', [], {
    label: 'the native reference fixtures, through each card',
  }),
  'data/readFile': native('Reading SPSS, Stata and Excel files', 'Data', ['haven', 'readxl'], {
    label: 'R’s own iris and mtcars',
  }),

  'rengine/fixedValues': native('Parameters fixed at values', 'CB-SEM', ['lavaan'], {
    label: 'lavaan 0.6-16 in desktop R (the values in the test)',
  }),
  'rengine/dllLimit': 'none',
  'rengine/zeroCovariance': native('Covariances fixed at zero', 'CB-SEM', ['lavaan'], {
    label: 'lavaan 0.6-16 in desktop R (the values in the test)',
  }),
  'rengine/glmm': native(
    'Generalised linear mixed models: negative binomial and zero-inflated negative binomial',
    'Longitudinal',
    ['GLMMadaptive'],
    script('glmm.R', 'desktop GLMMadaptive on its help page’s and vignette’s simulated data'),
  ),

  // Without R (evidenceRuns.json `fixture`): the built-in engine against fixtures from the reference packages, and desktop runs recorded in fixtures.
  'engine/validation': native(
    'Built-in engine: the reference corpus (PLS, PLSc, CB-SEM, MIIV, IPMA, Monte Carlo CIs, HTMT)',
    'Built-in engine',
    [],
    script('generate.R', 'desktop lavaan, seminr, cSEM, plspm, MIIVsem and semTools'),
  ),
  'engine/cbsem': native('Built-in CB-SEM', 'Built-in engine', [], {
    label: 'lavaan 0.6 in desktop R (fixtures mobi_cb.json, small_cb.json)',
  }),
  'engine/pls': native('Built-in PLS-SEM', 'Built-in engine', [], {
    label: 'seminr 2.3.2 in desktop R (fixtures mobi_modeA.json, mobi_modeB.json)',
  }),
  'engine/plsc': native('Built-in PLSc and composite models', 'Built-in engine', [], {
    label: 'cSEM 0.5.0 in desktop R (fixtures csem_plsc_mixed.json, csem_composite.json)',
  }),
  'engine/parcels': native(
    'Parcel allocation variability',
    'CB-SEM',
    [],
    script('parcels.R', 'plain lavaan and semTools::parcelAllocation'),
  ),
  'engine/nonlinear': native(
    'Nonlinear paths and causality assessment',
    'PLS-SEM',
    [],
    script('nonlinear_paths.R', 'lm() on seminr’s construct scores; Kock’s indices by hand'),
  ),
  'engine/copula': native(
    'Gaussian copula terms',
    'Built-in engine',
    [],
    script('copula.R', 'plain seminr and nortest::cvm.test'),
  ),
  'engine/interactionMethods': native(
    'PLS interaction terms (product indicator, orthogonal, two-stage)',
    'Built-in engine',
    [],
    script('pls_interaction_methods.R', 'plain seminr'),
  ),
  'engine/plscNonlinear': native(
    'Nonlinear PLSc (interaction and quadratic terms)',
    'Built-in engine',
    [],
    script('plsc_nonlinear.R', 'plain cSEM'),
  ),
  'engine/wpls': native('Weighted PLS', 'Built-in engine', [], {
    label:
      'the unweighted algorithm on the rows repeated by their integer weights, and a weighted correlation by hand',
  }),
  'engine/studentized': native('Studentized bootstrap intervals', 'Built-in engine', [], {
    label: 'the bootstrap-t interval by hand on known draws (Davison & Hinkley 1997, §5.2)',
  }),
  'engine/nonnormal': native('Non-normal data (Fleishman, Vale–Maurelli)', 'Built-in engine', [], {
    label:
      'Fleishman’s (1978) table and high-precision solutions in desktop R (vale-maurelli.json)',
  }),
  'engine/stats': native('Distributions (t, χ²)', 'Built-in engine', [], {
    label: 'R’s pt and pchisq (tdist.json, chisq.json)',
  }),
  'engine/quadratic': {
    title: 'Quadratic effects in the built-in engine',
    method: 'Built-in engine',
    level: 'recovery',
    sources: [{ label: 'simulated data with a known curvature' }],
    packages: [],
  },
  'engine/miivVariance': native('Built-in MIIV-2SLS variances', 'Built-in engine', [], {
    label: 'MIIVsem’s var.cov = TRUE with lavaan’s standardisation, recorded through the R bridge',
  }),
  'engine/fixedValues': native(
    'Built-in CB-SEM: parameters fixed at values',
    'Built-in engine',
    [],
    { label: 'lavaan 0.6-16 in desktop R (the values in the test)' },
  ),
  'engine/zeroCovariance': native(
    'Built-in CB-SEM: covariances fixed at zero',
    'Built-in engine',
    [],
    { label: 'lavaan 0.6-16 in desktop R (the values in the test)' },
  ),
  'engine/fit': native(
    'Built-in PLS fit test',
    'Built-in engine',
    [],
    script(
      'fit_test.R',
      'cSEM::testOMF (observed discrepancies; bootstrap quantiles within Monte Carlo error)',
    ),
  ),
  'analyses/charts': native(
    'Chart statistics (quartiles, whiskers, counts, density, Q-Q plot)',
    'Analyses',
    [],
    script('charts.R', 'R’s quantile(type = 7), boxplot.stats, table, bw.nrd0, qqnorm and qqline'),
  ),
  'analyses/methodCompare': 'examples',
  'examples/mplus/bsem': 'examples',
  'examples/mplus/dsem': 'examples',

  // Plumbing: syntax, security, messages, chunking.
  'rengine/common': 'none',
  'rengine/htmt2': 'none',
  'rengine/injection': 'none',
  'rengine/mplus': 'none',
  'rengine/parallel': 'none',
  'validation/selfCheck': 'examples',
  'rengine/quoting': 'none',
  'rengine/runtime': 'none',
  'replication/package': 'none',
};
