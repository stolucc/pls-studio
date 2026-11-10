// What each webR test file validates (src/validation/setup.ts records its toBeCloseTo comparisons as
// evidence under this entry), or 'examples' (its evidence is recorded per example with verify(),
// record.ts) or 'none' (it tests plumbing: syntax, security, error messages). Every webR test file is
// listed (validation/features.test.ts), so a new one has to say which.

import type { EvidenceLevel, EvidenceSource } from './types';

export interface FeatureEntry { title: string; method: string; level: EvidenceLevel; sources: EvidenceSource[]; packages: string[] }

const script = (name: string, what: string): EvidenceSource => ({ label: `${what}, scripts/validation/${name}`, script: `scripts/validation/${name}` });
const native = (title: string, method: string, packages: string[], ...sources: EvidenceSource[]): FeatureEntry => ({ title, method, level: 'native', sources, packages });

export const FEATURES: Record<string, FeatureEntry | 'examples' | 'none'> = {
  // Examples: graded per example with verify().
  'examples/bollen': 'examples', 'examples/bollen1989': 'examples', 'examples/bollencurran': 'examples', 'examples/brown': 'examples',
  'examples/builtin': 'examples', 'examples/causal': 'examples', 'examples/cards/basic': 'examples', 'examples/eqs': 'examples', 'examples/imputation': 'examples',
  'examples/kline': 'examples', 'examples/manymome': 'examples', 'examples/mplus/ch3': 'examples', 'examples/mplus/ch4': 'examples', 'examples/mplus/ch5': 'examples', 'examples/mplus/ch5efa': 'examples', 'examples/mplus/ch6': 'examples', 'examples/mplus/ch6surv': 'examples', 'examples/mplus/ch11': 'examples', 'examples/mplus/ch7': 'examples', 'examples/mplus/ch7mix': 'examples', 'examples/mplus/ch7reg': 'examples', 'examples/mplus/ch8mix': 'examples', 'examples/mplus/ch8': 'examples', 'examples/mplus/ch9': 'examples', 'examples/mplus/ch9random': 'examples', 'examples/mplus/ch6random': 'examples', 'examples/mplus/ch3random': 'examples', 'examples/packages': 'examples',
  'examples/plsGender': 'examples', 'examples/selection': 'examples',
  'examples/cards/bayes': 'examples',
  'examples/cards/model': 'examples',
  'examples/cards/dfi': 'examples',
  'examples/cards/validity': 'examples',
  'examples/cards/scoretest': 'examples',
  'examples/cards/lcs': 'examples',
  'examples/cards/qca': 'examples',
  'examples/cards/invariance': 'examples',
  'examples/cards/missing': 'examples',
  'examples/cards/sensitivity': 'examples',
  'examples/cards/likelihood': 'examples',
  'examples/cards/items': 'examples',
  'examples/mplus/ch5irt': 'examples', 'examples/mplus/ch7irt': 'examples', 'examples/mplus/ch6glmm': 'examples', 'examples/mplus/ch10': 'examples',
  'examples/mplus/quadml': 'examples', 'examples/cards/integration': 'examples',
  'examples/mplus/ch7int': 'examples', 'examples/mplus/ch8int': 'examples', 'examples/mplus/ch10mix': 'examples',

  'examples/bifactor': native('Bifactor CFA on open data', 'CB-SEM', ['lavaan'], script('bifactor_cpb.R', 'Plain lavaan calls with the settings of the study’s own code')),

  // CB-SEM (lavaan and friends)
  'rengine/lavaan': native('CB-SEM estimation', 'CB-SEM', ['lavaan'], script('generate.R', 'desktop lavaan, the reference corpus')),
  'rengine/adf': native('Distribution-free estimation (ADF / WLS)', 'CB-SEM', ['lavaan'], script('adf.R', 'desktop lavaan')),
  'rengine/categorical': native('Ordinal indicators (WLSMV) and FIML', 'CB-SEM', ['lavaan'], script('categorical_fiml.R', 'desktop lavaan')),
  'rengine/ordinalFit': native('Sample polychoric correlations (SAMPSTAT) and bivariate fit (TECH10)', 'CB-SEM', ['lavaan'], script('ordinal_fit.R', 'desktop lavaan, psych::polychoric and a computation by hand')),
  'rengine/cbComposite': native('Composites in CB-SEM', 'CB-SEM', ['lavaan'], script('cb_composite.R', 'desktop lavaan')),
  'rengine/cbExtras': native('Bollen–Stine bootstrap, Wald tests, factor-score weights', 'CB-SEM', ['lavaan'], script('cbextras.R', 'desktop lavaan')),
  'rengine/search': native('Specification search, equivalent models, multivariate LM and Wald tests, regularised SEM', 'CB-SEM', ['lavaan', 'lslx'], script('specsearch.R', 'desktop lavaan, each model written out and fitted on its own'), script('equivalent.R', 'desktop lavaan, the equivalent alternatives written out by hand'), script('lmwald.R', 'desktop lavaan, EQS’s stepwise tests with lavTestScore (cumulative) and lavTestWald'), script('lslx.R', 'desktop lslx, its documented semi-confirmatory factor analysis')),
  'rengine/complex': native('Cluster-robust standard errors (TYPE = COMPLEX)', 'CB-SEM', ['lavaan'], script('complex.R', 'desktop lavaan')),
  'rengine/constraints': native('Equality constraints, defined parameters', 'CB-SEM', ['lavaan'], script('categorical_fiml.R', 'desktop lavaan')),
  'rengine/esem': native('Exploratory SEM and bifactor rotations', 'CB-SEM', ['lavaan'], script('esem.R', 'desktop lavaan'), script('bifactor.R', 'desktop lavaan and psych::omegaFromSem')),
  'rengine/inequality': native('Inequality constraints', 'CB-SEM', ['lavaan'], script('inequality.R', 'desktop lavaan')),
  'rengine/means': native('Mean structures', 'CB-SEM', ['lavaan'], script('means.R', 'desktop lavaan')),
  'rengine/tech4': native('Implied latent moments (TECH4)', 'CB-SEM', ['lavaan'], script('tech4.R', 'desktop lavaan, defined parameters (delta method)')),
  'rengine/mi': native('Multiple imputation', 'CB-SEM', ['lavaan', 'mice', 'lavaan.mi'], script('mi.R', 'desktop mice and lavaan.mi')),
  'rengine/missingTwoStage': native('Two-stage missing data', 'CB-SEM', ['lavaan'], script('missing_twostage.R', 'desktop lavaan')),
  'rengine/multigroup': native('Multiple groups and invariance', 'CB-SEM', ['lavaan', 'semTools'], script('multigroup.R', 'desktop lavaan')),
  'rengine/twolevel': native('Two-level SEM', 'CB-SEM', ['lavaan'], { label: 'lavaan called directly in the same R' }),
  'rengine/rsem': native('Robust ML (rsem)', 'CB-SEM', ['rsem'], script('rsem.R', 'desktop rsem')),
  'rengine/weights': native('Sampling weights', 'CB-SEM', ['lavaan'], script('weights.R', 'desktop lavaan')),
  'rengine/reliability': native('Reliability (omega, alpha)', 'CB-SEM', ['semTools'], script('reliability.R', 'desktop semTools')),
  'rengine/reliabilitySingle': native('Single indicators with known reliability', 'CB-SEM', ['lavaan'], script('reliability_single.R', 'desktop lavaan')),
  'rengine/scores': native('Factor scores, their standard errors, plausible values', 'CB-SEM', ['lavaan', 'semTools'], { label: 'lavPredict and semTools::plausibleValues called directly in the same R' }),
  'rengine/groupBoot': native('Bootstrap with groups', 'CB-SEM', ['lavaan'], { label: 'lavaan::bootstrapLavaan in the same R' }),
  'rengine/modsem': native('Latent interactions (LMS, QML)', 'CB-SEM', ['modsem'], script('modsem.R', 'desktop modsem'), { label: 'modsem called directly in the same R' }),
  'rengine/modsemBoot': native('Bootstrap of latent interactions', 'CB-SEM', ['modsem'], { label: 'resampling with modsem in the same R' }),
  'rengine/metasem': native('Meta-analytic SEM (two-stage SEM)', 'CB-SEM', ['metaSEM'], script('metasem.R', 'desktop metaSEM')),
  'rengine/semtree': native('SEM trees and forests', 'CB-SEM', ['semtree'], script('semtree.R', 'desktop semtree')),
  'rengine/power': native('Power analysis (a priori, post hoc, compromise, a parameter; RMSEA equivalence test)', 'CB-SEM', ['semPower', 'lavaan'], script('sempower.R', 'desktop semPower, dynamic::equivTest and lavaan')),
  'rengine/screen': native('Data screening (outliers, influence)', 'CB-SEM', ['semfindr'], script('screen.R', 'desktop semfindr')),
  'rengine/analyses': native('MIIV-2SLS, IPMA, model fit test', 'CB-SEM', ['MIIVsem', 'cSEM'], script('generate.R', 'desktop MIIVsem and cSEM')),

  // PLS-SEM
  'rengine/pls': native('PLS-SEM and PLSc estimation', 'PLS-SEM', ['cSEM', 'seminr'], script('generate.R', 'desktop cSEM and seminr'), script('categorical_pls.R', 'desktop cSEM')),
  'rengine/ordinalPls': native('Ordinal PLS (OrdPLS / OrdPLSc) and its bootstrap', 'PLS-SEM', ['cSEM'], script('ordinal_pls.R', 'desktop cSEM on the ?predict help page’s ordinal data')),
  'rengine/plsx': native('PLS assessment: MICOM, MGA, PLSpredict, CVPAT, CTA, blindfolding', 'PLS-SEM', ['cSEM', 'seminr'], script('plsx.R', 'desktop cSEM and seminr')),
  'rengine/hoc': native('Higher-order constructs', 'PLS-SEM', ['cSEM', 'seminr'], script('hoc-approaches.R', 'desktop cSEM and seminr')),
  'rengine/bca': native('BCa bootstrap intervals', 'PLS-SEM', ['cSEM'], { label: 'cSEM::infer in the same R' }),
  'rengine/fimix': native('FIMIX segmentation', 'PLS-SEM', ['plspm'], script('fimix.R', 'desktop R')),
  'rengine/segment': native('REBUS segmentation', 'PLS-SEM', ['plspm'], script('rebus.R', 'desktop plspm')),
  'rengine/pathmox': native('PATHMOX segmentation', 'PLS-SEM', ['genpathmox'], script('pathmox.R', 'desktop genpathmox')),
  'rengine/pos': { title: 'Prediction-oriented segmentation', method: 'PLS-SEM', level: 'recovery', sources: [{ label: 'simulated segments with known membership' }], packages: [] },
  'rengine/cta': { title: 'Confirmatory tetrad analysis', method: 'PLS-SEM', level: 'recovery', sources: [{ label: 'simulated data with known measurement models' }], packages: [] },
  'rengine/quadratic': { title: 'Quadratic effects', method: 'PLS-SEM', level: 'recovery', sources: [{ label: 'simulated data with a known curvature' }], packages: ['cSEM', 'seminr'] },
  'rengine/published': { title: 'Published PLS-SEM results', method: 'PLS-SEM', level: 'published', packages: ['seminr', 'cSEM'],
    sources: [{ label: 'Hair, Hult, Ringle, Sarstedt et al. (2021), PLS-SEM Using R, chapters 4 and 6' }, { label: 'Monecke & Leisch (2012), Journal of Statistical Software 48(3)' }] },
  'rengine/barcomb': { title: 'A published PLS-SEM study (Barcomb et al., ICSE 2019)', method: 'PLS-SEM', level: 'published', packages: ['seminr', 'plspm'], sources: [{ label: 'Barcomb et al. (2019), ICSE: the paper’s tables' }] },
  'rengine/mc': { title: 'Monte Carlo power simulation', method: 'PLS-SEM', level: 'recovery', sources: [{ label: 'the built-in simulation engine' }], packages: ['lavaan'] },

  // PROCESS
  'rengine/cpa': { title: 'PROCESS models', method: 'PROCESS', level: 'published', packages: ['lavaan'], sources: [{ label: 'Hayes’s PROCESS for R, every model', script: 'scripts/validation/process_reference.R' }] },
  'rengine/cpaCategorical': native('PROCESS with a categorical X or W', 'PROCESS', ['lavaan'], script('process_extensions.R', 'PROCESS for R')),
  'rengine/cpaGlm': native('PROCESS with a binary outcome', 'PROCESS', ['stats'], script('process_extensions.R', 'PROCESS for R')),
  'rengine/cpaSam': { title: 'Mediation with structural-after-measurement (manymome)', method: 'PROCESS', level: 'published', packages: ['manymome'], sources: [{ label: 'manymome’s SAM article: printed values' }] },

  // Other analyses
  'rengine/efa': native('Exploratory factor analysis and PCA', 'EFA', ['psych'], script('efa.R', 'desktop psych'), script('efa_polychoric.R', 'desktop psych and lavaan::lavCor')),
  'rengine/items': native('IRT and latent class analysis', 'Items', ['ltm', 'poLCA', 'mirt', 'glca'], script('items.R', 'desktop ltm and poLCA')),
  'rengine/invariance': native('Longitudinal invariance, DIF by MIMIC', 'CB-SEM', ['lavaan', 'semTools'], script('invariance_cards.R', 'desktop lavaan, the models written out by hand')),
  'rengine/longitudinal': native('Growth models, RI-CLPM', 'Longitudinal', ['lavaan'], script('longitudinal.R', 'desktop lavaan')),
  'rengine/mixed': native('Mixed models, growth mixture models', 'Longitudinal', ['lme4', 'lcmm'], script('mixed.R', 'desktop lme4 and lcmm')),
  'rengine/did': native('Difference-in-differences', 'Causal inference', ['did', 'fixest'], script('did.R', 'desktop did and fixest')),
  'rengine/match': native('Matching and weighting', 'Causal inference', ['MatchIt', 'WeightIt'], script('match.R', 'desktop MatchIt'), script('weightit.R', 'desktop WeightIt')),
  'rengine/endo': native('Endogeneity: IV, copulas, Heckman', 'Regression', ['ivreg', 'REndo', 'sampleSelection'], script('endo.R', 'desktop R')),
  'rengine/regression': native('Regression (linear, GLM, ordinal, multinomial, censored, survival)', 'Regression', ['stats', 'MASS', 'nnet', 'survival'], script('regression.R', 'desktop R')),
  'rengine/rsa': native('Response surface analysis', 'Regression', ['RSA'], script('rsa.R', 'desktop RSA')),
  'rengine/nca': native('Necessary condition analysis', 'NCA', ['NCA'], script('nca.R', 'desktop NCA')),
  'rengine/network': native('Network psychometrics and EGA', 'Networks', ['bootnet', 'EGAnet'], script('network.R', 'desktop bootnet and EGAnet')),
  'rengine/tests': native('Basic statistics: t-tests, ANOVA, correlations, contingency tables', 'Basic statistics', ['stats'], script('tests.R', 'desktop R')),
  'rengine/correlationPolychoric': native('Polychoric correlations', 'Basic statistics', ['lavaan'], script('correlation_polychoric.R', 'desktop lavaan and psych::polychoric')),
  'rengine/bayes': native('Bayesian tests', 'Bayesian', ['BayesFactor'], script('bayes.R', 'numerical integration'), script('bayes_native.R', 'desktop BayesFactor')),
  'analyses/cards': native('Analysis cards end to end', 'Analyses', [], { label: 'the native reference fixtures, through each card' }),
  'data/readFile': native('Reading SPSS, Stata and Excel files', 'Data', ['haven', 'readxl'], { label: 'R’s own iris and mtcars' }),

  // Plumbing: syntax, security, messages, chunking.
  'rengine/common': 'none', 'rengine/fixedValues': 'none', 'rengine/htmt2': 'none', 'rengine/injection': 'none', 'rengine/mplus': 'none',
  'rengine/parallel': 'none', 'validation/selfCheck': 'examples', 'rengine/quoting': 'none', 'rengine/runtime': 'none', 'rengine/zeroCovariance': 'none', 'replication/package': 'none',
};
