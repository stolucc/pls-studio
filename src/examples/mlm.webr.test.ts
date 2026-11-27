// The multilevel examples after McNeish's and Curran's work (packages.ts: nlme-hsb-*, lme4-dyestuff-*,
// nlme-growth-*), each run through its card as the app opens it and compared with the published numbers
// (Raudenbush & Bryk 2002 for High School and Beyond, Bates 2010 for Dyestuff, lavaan's growth tutorial) and with
// the same models in desktop R (lme4/lmerTest, sandwich, lavaan, nlme). The comparisons between the examples are
// the point: the fixed-effects slope is the within slope, the latent growth curve is the mixed model with a residual
// variance per occasion. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { categoriesOf } from '../io';
import { rCall, type RPackage } from '../rengine/bridge';
import { lmmR, type LmmInput, type LmmResult } from '../rengine/mixed';
import { regressionR, type RegressionInput } from '../rengine/regression';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example, near, same } from '../validation/record';
import { PACKAGE_EXAMPLES, panelPreset } from './packages';
import { exampleTestData } from './testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const exampleOf = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!;

async function open(id: string, method: string) {
  const ex = exampleOf(id);
  example(id, { title: ex.title, method, packages: [ex.package], definition: ex });
  const fromFile = exampleTestData(ex);
  const raw = fromFile
    ? null
    : await rCall<{
        names: string[];
        cols: (number | null)[][];
        levels?: Record<string, string[]>;
      }>(
        'ps_dataset',
        { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] },
        ex.data.package as RPackage,
      );
  const data: Dataset =
    fromFile ??
    ({
      names: raw!.names,
      cols: raw!.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
      ...categoriesOf(raw!.levels),
    } as Dataset);
  return { ex, data, preset: panelPreset(ex.panel!) };
}

const lmm = async (id: string) => {
  const { data, preset } = await open(id, 'Mixed model');
  return lmmR(data, preset as unknown as LmmInput);
};
const fixed = (r: LmmResult, term: string) => r.fixed.find((f) => f.term === term)!;
const variance = (r: LmmResult, group: string, a: string | null = null) =>
  r.random.find((v) => v.group === group && v.a === a && v.b === null)!.variance;

const RB = {
  label:
    'Raudenbush & Bryk (2002), Hierarchical Linear Models, the High School and Beyond analyses (printed)',
  level: 'published' as const,
};
const DESKTOP = (what: string) => ({ label: `${what} in desktop R`, level: 'native' as const });

it('HSB, the empty model: the ICC of .18 (Raudenbush & Bryk)', async () => {
  const r = await lmm('nlme-hsb-null');
  same('schools', r.clusters, 160);
  same('students', r.n, 7185);
  against(RB);
  near('grand mean', fixed(r, 'Intercept').est, 12.637, 0.0005);
  near('variance between schools', variance(r, 'School', 'Intercept'), 8.614, 0.0005);
  near('variance within schools', variance(r, 'Residual'), 39.148, 0.0005);
  near('ICC', r.icc!, 0.18, 0.0005);
}, 600_000);

it('HSB, a random intercept: the slope of SES blends within and between (lme4/lmerTest)', async () => {
  const r = await lmm('nlme-hsb-random');
  against(DESKTOP('lme4 1.1 / lmerTest, lmer(MathAch ~ SES + (1 | School), REML = TRUE)'));
  near('SES', fixed(r, 'SES').est, 2.390196, 1e-5);
  near('SE of SES', fixed(r, 'SES').se, 0.1057191, 1e-5);
  near('intercept', fixed(r, 'Intercept').est, 12.65748, 1e-5);
}, 600_000);

it('HSB, ordinary regression with cluster-robust standard errors (sandwich::vcovCL)', async () => {
  const { data, preset } = await open('nlme-hsb-cluster-robust', 'Regression');
  const r = await regressionR(data, {
    ...(preset as unknown as RegressionInput),
    confidence: 0.95,
  });
  const ses = r.coefficients.find((c) => c.term === 'SES')!;
  against(DESKTOP('lm with sandwich::vcovCL(cluster = ~School) (HC1)'));
  near('SES', ses.est, 3.18387, 1e-5);
  near('cluster-robust SE of SES', ses.se, 0.133485, 1e-5);
}, 600_000);

it('HSB, school fixed effects: the slope of SES is the within-school slope', async () => {
  const { data, preset } = await open('nlme-hsb-fixed-effects', 'Regression');
  const r = await regressionR(data, {
    ...(preset as unknown as RegressionInput),
    confidence: 0.95,
  });
  const ses = r.coefficients.find((c) => c.term === 'SES')!;
  against(DESKTOP('lm(MathAch ~ SES + factor(School))'));
  near('SES', ses.est, 2.191172, 1e-5);
  near('SE of SES', ses.se, 0.1086457, 1e-5);
  against(RB);
  near('SES (the within-school slope)', ses.est, 2.191, 0.0005);
}, 600_000);

it('HSB, within and between: the within slope equals the fixed-effects slope; the contextual model (Raudenbush & Bryk)', async () => {
  const r = await lmm('nlme-hsb-within-between');
  against(RB);
  near('within-school slope of SES', fixed(r, 'SES').est, 2.191, 0.0005);
  near('between-school slope of mean SES', fixed(r, 'SES (cluster mean)').est, 5.866, 0.0005);
  near('intercept', fixed(r, 'Intercept').est, 12.683, 0.0005);
  against(DESKTOP('lmerTest, lmer(MathAch ~ cses + mses + (1 | School), REML = TRUE)'));
  near('within-school slope of SES', fixed(r, 'SES').est, 2.191172, 1e-5);
  near('SE of the within slope', fixed(r, 'SES').se, 0.1086673, 1e-5);
  near('between-school slope', fixed(r, 'SES (cluster mean)').est, 5.866174, 1e-5);
  near('SE of the between slope', fixed(r, 'SES (cluster mean)').se, 0.3616994, 1e-5);
}, 600_000);

it('NLS Young Women, within and between persons: time-varying hours and age split at each woman’s mean (Curran & Bauer 2011)', async () => {
  const r = await lmm('nls-within-between');
  same('interviews', r.n, 28443);
  same('women', r.clusters, 4709);
  against(
    DESKTOP(
      'lmerTest, lmer(ln_wage ~ hours_w + age_w + hours_cm + age_cm + (1 | idcode), REML = TRUE), complete cases',
    ),
  );
  const REF: [string, number, number][] = [
    ['Intercept', 0.6577411732, 0.0410956758],
    ['hours', 0.0007343915, 0.0002398285],
    ['age', 0.0181932138, 0.000348828],
    ['hours (cluster mean)', 0.0094799663, 0.0007486128],
    ['age (cluster mean)', 0.0227016192, 0.0010698844],
  ];
  for (const [term, est, se] of REF) {
    near(term, fixed(r, term).est, est, 1e-6);
    near(`SE of ${term}`, fixed(r, term).se, se, 1e-6);
  }
  near('variance between women', variance(r, 'idcode', 'Intercept'), 0.12375122, 1e-6);
  near('residual variance', variance(r, 'Residual'), 0.09248757, 1e-6);
  against(DESKTOP('fixest 0.14, feols(ln_wage ~ hours + age | idcode): the within (fixed-effects) slopes'));
  near('within slope of hours', fixed(r, 'hours').est, 0.0007343915, 1e-9);
  near('within slope of age', fixed(r, 'age').est, 0.0181932138, 1e-9);
}, 600_000);

it('Dyestuff, six batches: REML against ML, Satterthwaite degrees of freedom (Bates 2010)', async () => {
  const bates = {
    label: 'Bates (2010), lme4: Mixed-effects modeling with R, ch. 1 (printed)',
    level: 'published' as const,
  };
  const reml = await lmm('lme4-dyestuff-reml');
  same('batches', reml.clusters, 6);
  against(bates);
  near('SD between batches (REML)', Math.sqrt(variance(reml, 'Batch', 'Intercept')), 42.0, 0.005);
  near('residual SD (REML)', Math.sqrt(variance(reml, 'Residual')), 49.51, 0.005);
  near('mean yield', fixed(reml, 'Intercept').est, 1527.5, 0.005);
  against(DESKTOP('lmerTest, lmer(Yield ~ 1 + (1 | Batch), REML = TRUE)'));
  near('SE of the mean (REML)', fixed(reml, 'Intercept').se, 19.38341, 1e-4);
  near('Satterthwaite df (REML)', fixed(reml, 'Intercept').df!, 5, 1e-4);
  const ml = await lmm('lme4-dyestuff-ml');
  example('lme4-dyestuff-ml', {
    title: exampleOf('lme4-dyestuff-ml').title,
    method: 'Mixed model',
    packages: ['lme4'],
    definition: exampleOf('lme4-dyestuff-ml'),
  });
  against(bates);
  near('SD between batches (ML)', Math.sqrt(variance(ml, 'Batch', 'Intercept')), 37.26, 0.005);
  near('residual SD (ML)', Math.sqrt(variance(ml, 'Residual')), 49.51, 0.005);
  against(DESKTOP('lmerTest, lmer(Yield ~ 1 + (1 | Batch), REML = FALSE)'));
  near('SE of the mean (ML)', fixed(ml, 'Intercept').se, 17.69455, 1e-4);
  // (ML understates the between-batch variance with few clusters: the point of the pair)
  expect(variance(ml, 'Batch', 'Intercept')).toBeLessThan(variance(reml, 'Batch', 'Intercept'));
}, 600_000);

it('growth as a mixed model: equal residual variances = the latent curve with equal residuals; one per occasion = lavaan’s growth model', async () => {
  const equal = await lmm('nlme-growth-equal');
  against(DESKTOP('lavaan::growth with the residual variances held equal'));
  near('log-likelihood', equal.logLik, -2755.857, 0.001);
  near('mean intercept', fixed(equal, 'Intercept').est, 0.6171568, 1e-4);
  near('mean slope', fixed(equal, 'time').est, 1.0051928, 1e-4);
  const occasion = await lmm('nlme-growth-occasion');
  example('nlme-growth-occasion', {
    title: exampleOf('nlme-growth-occasion').title,
    method: 'Mixed model',
    packages: ['nlme'],
    definition: exampleOf('nlme-growth-occasion'),
  });
  against(DESKTOP('lavaan::growth, the tutorial’s linear growth model'));
  near('log-likelihood', occasion.logLik, -2755.052, 0.001);
  near('mean intercept (i ~ 1)', fixed(occasion, 'Intercept').est, 0.615, 0.0005);
  near('mean slope (s ~ 1)', fixed(occasion, 'time').est, 1.006, 0.0005);
  near('intercept variance (i ~~ i)', variance(occasion, 'Person', 'Intercept'), 1.932, 0.0005);
  near('slope variance (s ~~ s)', variance(occasion, 'Person', 'time'), 0.587, 0.0005);
  const residuals = occasion.random.filter((v) => v.group === 'Residual').map((v) => v.variance);
  [0.595, 0.676, 0.635, 0.508].forEach((v, k) =>
    near(`residual variance of t${k + 1}`, residuals[k], v, 0.0005),
  );
}, 600_000);
