// The views of the mirt, glca and GLMMadaptive options: what they show for a result.

import { describe, expect, it } from 'vitest';
import { glmmAnalysis } from './glmm';
import { irtAnalysis, lcaAnalysis } from './items';

const engine = { package: 'x', version: '1' };

describe('views', () => {
  it('IRT with priors: the log-likelihood plus the log prior, asymptote thresholds; mixtures: classes and no information chart', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const base = { model: 'threepl', n: 10, items: ['u1'], params: [{ item: 'u1', values: { Dscrmn: 1, Dffclt: 0, Gussng: 0.2 } }], logLik: -100, aic: 206, bic: 210, reliability: 0.7, theta: [0], information: [[0.2]], itemFit: [], warnings: [], engine };
    const html = renderToStaticMarkup(<irtAnalysis.View result={{ ...base, logPrior: -2, npar: 3, robust: true, coefficients: [{ item: 'u1', parameter: 'threshold 2 (lower asymptote)', est: 1.386, se: 0.3 }] } as never} options={{ items: ['u1'], model: 'threepl' }} current />);
    expect(html).toContain('Log-likelihood + log prior');
    expect(html).toContain('-102.00');
    expect(html).toContain('Guessing (g)');
    expect(html).toContain('−logit(g)');
    expect(html).toContain('Robust SE');
    const mix = renderToStaticMarkup(<irtAnalysis.View result={{ ...base, model: 'mixture', classes: [0.6, 0.4], theta: [], information: [], coefficients: [{ item: 'u1', parameter: 'loading', est: 1, se: null, class: 2 }] } as never} options={{ items: ['u1'], model: 'mixture' }} current />);
    expect(mix).toContain('Latent classes');
    expect(mix).toContain('Mixture: no standard errors');
    expect(mix).not.toContain('Information');
  });

  it('multilevel LCA: the classes of clusters with their class shares', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const r = { n: 10, items: ['u1'], clusters: 4, cluster: 'school', warnings: [], engine,
      models: [{ k: 2, llik: -10, npar: 5, aic: 30, bic: 33, gsq: null, entropy: 0.8, shares: [0.6, 0.4], probs: [{ item: 'u1', categories: ['1', '2'], byClass: [[0.9, 0.1], [0.2, 0.8]] }],
        clusters: { shares: [0.7, 0.3], byCluster: [[0.8, 0.2], [0.1, 0.9]] } }] };
    const html = renderToStaticMarkup(<lcaAnalysis.View result={r as never} options={{ items: ['u1'], from: 2, to: 2, model: 'mlca', cluster: 'school' }} current />);
    expect(html).toContain('Classes of clusters (4 clusters of school)');
    expect(html).toContain('Cluster class 2');
  });

  it('LCA with auxiliary variables: classification errors, BCH distal means and tests, the covariates’ logit', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const m = { k: 2, llik: -10, npar: 5, aic: 30, bic: 33, gsq: null, entropy: 0.8, shares: [0.6, 0.4], probs: [] };
    const aux = { k: 2, method: 'ml', n: 10, D: [[0.9, 0.1], [0.2, 0.8]], counts: [6, 4],
      distal: [{ name: 'educ', n: 9, means: [4.5, 3.2], se: [0.1, 0.2], sd: [1, 1.1], chisq: 12.5, df: 1, p: 0.0004, pairs: [{ a: 1, b: 2, chisq: 12.5, p: 0.0004 }] }],
      covariates: { n: 10, logLik: -6.25, reference: 2, terms: ['Intercept', 'party'], coefs: [{ class: 1, est: [0.5, -0.4], se: [0.2, 0.1], p: [0.01, 0.0001] }], wald: [{ chisq: 6.25, df: 1, p: 0.012 }, { chisq: 16, df: 1, p: 0.0001 }] } };
    const html = renderToStaticMarkup(<lcaAnalysis.View result={{ n: 10, items: ['u1'], models: [m], warnings: [], engine, aux } as never} options={{ items: ['u1'], from: 2, to: 2 }} current />);
    expect(html).toContain('classification errors (2 classes)');
    expect(html).toContain('class 1: 6, class 2: 4');
    expect(html).toContain('educ (n = 9)');
    expect(html).toContain('Class 1 = class 2');
    expect(html).toContain('ML three-step');
    expect(html).toContain('Class 1 vs 2');
    expect(html).toContain(String(Math.exp(-0.4).toFixed(3)));
  });

  it('GLMM: fixed effects, the zero part, random effects with the zero part marked, dispersion', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const coef = { term: 'Intercept', est: 0.3, se: 0.1, z: 3, p: 0.003 };
    const r = { family: 'zinb', layout: 'wide', n: 20, clusters: 5, quadrature: 15, robust: true, fixed: [coef], zero: [{ ...coef, term: 'time' }],
      random: [{ a: 'Intercept', zeroA: false, zeroB: false, est: 0.4, se: 0.1 }, { a: 'Intercept', b: 'Intercept', zeroA: false, zeroB: true, est: -0.2, se: 0.1 }],
      logPhi: { est: 1, se: 0.2 }, logLik: -50, npar: 7, aic: 114, bic: 120, converged: true, warnings: [], engine };
    const html = renderToStaticMarkup(<glmmAnalysis.View result={r as never} options={glmmAnalysis.defaults({} as never)} current />);
    expect(html).toContain('Zero part (logit of a structural zero)');
    expect(html).toContain('Intercept ↔ Intercept (zero part) (covariance)');
    expect(html).toContain('Persons');
    expect(html).toContain('log θ');
    expect(html).toContain('15 points');
  });
});
