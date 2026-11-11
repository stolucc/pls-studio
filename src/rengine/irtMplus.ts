// The IRT card with Mplus's integration rule (integration = 'mplus'): the 2PL, 3PL and 4PL models with their priors
// written in Mplus's syntax (CATEGORICAL = u1-u20 (3pl); f BY u1-u20*; f@1; [u1$2-u20$2] (g1-g20); MODEL PRIORS: …)
// and fitted by the integration card's engine (R/quadml.R) with Mplus's adaptive rectangular rule (15 points), so that
// the estimates and the log-likelihood are those Mplus prints rather than mirt's (61 fixed points: the exact maximum).

import { buildQuad } from '../analyses/quadmlSyntax';
import type { Dataset } from '../engine/types';
import type { IrtFit, IrtModel, IrtResult } from './items';
import { quadR, quadScriptR, type QuadResult } from './quadml';

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Why the card cannot use Mplus's rule (null: it can). */
export function irtMplusBlocked(items: string[], model: IrtModel, fit: IrtFit): string | null {
  if (!['twopl', 'threepl', 'fourpl'].includes(model))
    return 'Mplus’s integration rule is available for the 2PL, 3PL and 4PL models.';
  if ([...items, ...(fit.freq ? [fit.freq] : [])].some((c) => !SAFE.test(c)))
    return 'Mplus’s integration rule needs column names of letters, digits and _ (rename the columns or use the package’s quadrature).';
  return null;
}

/** The model in Mplus's syntax. Priors on the logits of the asymptotes [mean, SD] are Mplus's priors on u$2 = −logit(g) and u$3 = −logit(u). */
export function irtMplusSyntax(items: string[], model: IrtModel, fit: IrtFit): string {
  const guess =
    model === 'fourpl'
      ? items
      : model === 'threepl'
        ? items.filter((i) => !fit.guessItems || fit.guessItems.includes(i))
        : [];
  const plain = items.filter((i) => !guess.includes(i));
  const kind = model === 'fourpl' ? '4pl' : '3pl';
  const pg = fit.priorG,
    pu = model === 'fourpl' ? fit.priorU : undefined;
  return [
    ...(plain.length ? [`CATEGORICAL = ${plain.join(' ')};`] : []),
    ...(guess.length ? [`CATEGORICAL = ${guess.join(' ')} (${kind});`] : []),
    ...(fit.freq ? [`FREQWEIGHT = ${fit.freq};`] : []),
    `ANALYSIS: ESTIMATOR = ${fit.robust ? 'MLR' : 'ML'};`,
    'MODEL:',
    // (the first loading freed: the factor's variance is fixed instead)
    `f BY ${items[0]}* ${items.slice(1).join(' ')};`,
    'f@1;',
    // (one line per item: its asymptotes' labels)
    ...guess.map((i, k) => `[${i}$2] (qg${k + 1});`),
    ...(model === 'fourpl' ? guess.map((i, k) => `[${i}$3] (qu${k + 1});`) : []),
    ...(pg || pu
      ? [
          'MODEL PRIORS:',
          ...(pg && guess.length
            ? guess.map((_, k) => `qg${k + 1} ~ N(${-pg[0]}, ${pg[1] ** 2});`)
            : []),
          ...(pu ? guess.map((_, k) => `qu${k + 1} ~ N(${-pu[0]}, ${pu[1] ** 2});`) : []),
        ]
      : []),
  ].join('\n');
}

const spec = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit) =>
  buildQuad(irtMplusSyntax(items, model, fit), data).spec;
const plogis = (x: number) => 1 / (1 + Math.exp(-x));

/** The integration engine's result as the IRT card shows it (Mplus's metric and the IRT parameterisation). */
export function irtFromQuad(
  items: string[],
  model: IrtModel,
  r: QuadResult & { logPrior?: number | null },
): IrtResult {
  const get = (lhs: string, op: string, rhs: string) =>
    r.params.find((p) => p.lhs === lhs && p.op === op && p.rhs === rhs);
  const coefficients: NonNullable<IrtResult['coefficients']> = [];
  const params: IrtResult['params'] = [];
  const theta = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);
  const information: number[][] = [];
  for (const it of items) {
    const a = get('f', '=~', it),
      t1 = get(it, '|', 't1'),
      t2 = get(it, '|', 't2'),
      t3 = get(it, '|', 't3');
    if (!a || !t1) continue;
    coefficients.push(
      { item: it, parameter: 'loading', est: a.est, se: a.se },
      { item: it, parameter: 'threshold 1', est: t1.est, se: t1.se },
    );
    if (t2)
      coefficients.push({
        item: it,
        parameter: 'threshold 2 (lower asymptote)',
        est: t2.est,
        se: t2.se,
      });
    if (t3)
      coefficients.push({
        item: it,
        parameter: 'threshold 3 (upper asymptote)',
        est: t3.est,
        se: t3.se,
      });
    const g = t2 ? plogis(-t2.est) : 0,
      u = t3 ? plogis(-t3.est) : 1;
    params.push({
      item: it,
      values: {
        Dscrmn: a.est,
        Dffclt: t1.est / a.est,
        ...(t2 ? { Gussng: g } : {}),
        ...(t3 ? { Upper: u } : {}),
      },
    });
    // (item information of the 4PL: a² (P − g)² (u − P)² / ((u − g)² P (1 − P)))
    information.push(
      theta.map((th) => {
        const p = g + (u - g) * plogis(a.est * th - t1.est);
        return (a.est ** 2 * (p - g) ** 2 * (u - p) ** 2) / ((u - g) ** 2 * p * (1 - p));
      }),
    );
  }
  const lp = typeof r.logPrior === 'number' ? r.logPrior : undefined;
  const ll = r.logLik - (lp ?? 0);
  return {
    model,
    n: r.n,
    items,
    params,
    logLik: ll,
    aic: -2 * ll + 2 * r.npar,
    bic: -2 * ll + r.npar * Math.log(r.n),
    reliability: null,
    theta,
    information,
    itemFit: [],
    coefficients,
    npar: r.npar,
    ...(lp !== undefined ? { logPrior: lp } : {}),
    quadrature: r.integration.points,
    robust: r.se === 'mlr',
    integration: 'mplus',
    warnings: r.warnings,
    engine: r.engine,
  } as IrtResult;
}

export async function irtMplusR(
  data: Dataset,
  items: string[],
  model: IrtModel,
  fit: IrtFit,
): Promise<IrtResult> {
  return irtFromQuad(items, model, await quadR(data, spec(data, items, model, fit)));
}
export const irtMplusScriptR = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit) =>
  quadScriptR(data, spec(data, items, model, fit));
