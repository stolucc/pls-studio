// The GLMM card with Mplus's integration rule (integration = 'mplus'): a growth model for counts on wide data written
// in Mplus's syntax (i s | u1@0 u2@1 …; ii si | u1#1@0 … for the zero part) and fitted by the integration card's
// engine (R/quadml.R) with Mplus's adaptive rectangular rule and its number of points, so that the estimates and the
// log-likelihood are those Mplus prints rather than the exact maximum GLMMadaptive's quadrature reaches.

import { buildQuad } from '../analyses/quadmlSyntax';
import type { Dataset } from '../engine/types';
import type { GlmmCoef, GlmmInput, GlmmResult } from './glmm';
import { quadR, quadScriptR, type QuadResult } from './quadml';

/** Why the card cannot use Mplus's rule for these options (null: it can). */
export function glmmMplusBlocked(o: GlmmInput): string | null {
  if (o.layout !== 'wide') return 'Mplus’s integration rule is available for wide data (a growth model, i s | u1@0 u2@1 …).';
  if (!['poisson', 'negbin', 'zip'].includes(o.family)) return 'Mplus’s integration rule is available for Poisson, negative binomial and zero-inflated Poisson counts.';
  if (o.slopes.some((s) => s !== 'time')) return 'With Mplus’s integration rule the random slope is that of time.';
  if (o.quadrature > 50) return 'Mplus’s rule: at most 50 points per dimension.';
  if ([...o.occasions, ...o.predictors].some((c) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c))) return 'Mplus’s integration rule needs column names of letters, digits and _ (rename the columns or use GLMMadaptive).';
  return null;
}

/** The model in Mplus's syntax (the occasions with their time scores, covariates of the growth factors). */
export function glmmMplusSyntax(o: GlmmInput): string {
  const times = o.times.length === o.occasions.length ? o.times : o.occasions.map((_, i) => i);
  const at = (suffix = '') => o.occasions.map((y, k) => `${y}${suffix}@${times[k]}`).join(' ');
  const zi = o.family === 'zip';
  const zx = o.ziPredictors.filter((x) => x !== 'time');
  return [
    `COUNT = ${o.occasions.join(' ')}${o.family === 'negbin' ? ' (nb)' : zi ? ' (i)' : ''};`,
    `ANALYSIS: ESTIMATOR = ${o.robust ? 'MLR' : 'ML'};`,
    `INTEGRATION = ${o.quadrature};`,
    'MODEL:',
    `i s | ${at()};`,
    ...(o.slopes.includes('time') ? [] : ['s@0;']),
    ...(o.predictors.length ? [`i ON ${o.predictors.join(' ')};`] : []),
    ...(zi ? [
      `ii si | ${at('#1')};`,
      ...(o.ziRandom ? [] : ['ii@0;']),
      'si@0;',
      ...(o.ziPredictors.includes('time') ? [] : ['[si@0];']),
      ...(zx.length ? [`ii ON ${zx.join(' ')};`] : []),
    ] : []),
  ].join('\n');
}

const spec = (data: Dataset, o: GlmmInput) => buildQuad(glmmMplusSyntax(o), data).spec;

const coef = (term: string, p?: { est: number; se: number | null }): GlmmCoef => {
  const se = p?.se ?? NaN, z = (p?.est ?? NaN) / se;
  return { term, est: p?.est ?? NaN, se, z, p: Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : NaN };
};
function normalCdf(x: number) {
  // (Abramowitz & Stegun 7.1.26 via erf; p-values only)
  const t = 1 / (1 + 0.3275911 * x / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + y);
}

/** The integration engine's result as the GLMM card shows it (Mplus's growth factors as the random effects). */
export function glmmFromQuad(o: GlmmInput, r: QuadResult, observations = r.n * o.occasions.length): GlmmResult {
  const get = (lhs: string, op: string, rhs = '') => r.params.find((p) => p.lhs === lhs && p.op === op && p.rhs === rhs) ?? (op === '~~' ? r.params.find((p) => p.lhs === rhs && p.op === op && p.rhs === lhs) : undefined);
  const zi = o.family === 'zip', y0 = o.occasions[0];
  const fixed = [coef('Intercept', get('i', '~1')), coef('time', get('s', '~1')), ...o.predictors.map((x) => coef(x, get('i', '~', x)))];
  const zero = zi ? [coef('Intercept', get(`${y0}#1`, '~1')), ...(o.ziPredictors.includes('time') ? [coef('time', get('si', '~1'))] : []), ...o.ziPredictors.filter((x) => x !== 'time').map((x) => coef(x, get('ii', '~', x)))] : undefined;
  const random: GlmmResult['random'] = [];
  const add = (a: string, b: string | undefined, zeroA: boolean, zeroB: boolean, p?: { est: number; se: number | null; fixed: boolean }) => { if (p && !p.fixed) random.push({ a, ...(b ? { b } : {}), zeroA, zeroB, est: p.est, se: p.se ?? NaN }); };
  add('Intercept', undefined, false, false, get('i', '~~', 'i') );
  if (o.slopes.includes('time')) { add('time', undefined, false, false, get('s', '~~', 's') ); add('Intercept', 'time', false, false, get('s', '~~', 'i') ); }
  if (zi && o.ziRandom) {
    add('Intercept', undefined, true, true, get('ii', '~~', 'ii') );
    add('Intercept', 'Intercept', false, true, get('ii', '~~', 'i') );
    if (o.slopes.includes('time')) add('time', 'Intercept', false, true, get('ii', '~~', 's') );
  }
  const disp = r.params.find((p) => p.op === 'dispersion');
  return {
    family: o.family, layout: 'wide', n: observations, clusters: r.n, quadrature: o.quadrature, robust: o.robust,
    fixed, ...(zero ? { zero } : {}), random,
    // (Mplus's dispersion α: variance μ + αμ², i.e. θ = 1/α)
    ...(disp ? { logPhi: { est: -Math.log(disp.est), se: (disp.se ?? NaN) / disp.est } } : {}),
    logLik: r.logLik, npar: r.npar, aic: r.aic, bic: r.bic, converged: r.converged, integration: 'mplus',
    warnings: r.warnings, engine: r.engine,
  } as GlmmResult;
}

export async function glmmMplusR(data: Dataset, o: GlmmInput): Promise<GlmmResult> {
  const obs = o.occasions.reduce((t, y) => t + Array.from(data.cols[data.names.indexOf(y)] ?? []).filter(Number.isFinite).length, 0);
  return glmmFromQuad(o, await quadR(data, spec(data, o)), obs);
}
export const glmmMplusScriptR = (data: Dataset, o: GlmmInput) => quadScriptR(data, spec(data, o));
