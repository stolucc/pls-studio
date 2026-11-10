// PLS-SEM through cSEM or seminr (in webR). The model is translated and
// estimated by R/pls.R; this module builds the request and turns the
// package's output into the app's PlsResult, so every view works unchanged.

import type { Dataset, MissingTreatment, ModelSpec, PlsOptions, PlsResult } from '../engine/types';
import type { REngineInfo } from './lavaan';
import { expandCategorical } from '../engine/categorical';
import { rCall, rScript, rStrings } from './bridge';

export type PlsPackage = 'cSEM' | 'seminr';

export interface PlsRequest {
  kind: 'pls';
  package: PlsPackage;
  missing: MissingTreatment;
  options: { scheme: PlsOptions['scheme']; consistent: boolean; tolerance: number; maxIter: number; approach: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit'; hocApproach: 'two_stage' | 'embedded' | 'repeated' };
  data: { names: string[]; cols: (number | null)[][] };
  model: ModelSpec;
}

export function plsRequest(data0: Dataset, spec0: ModelSpec, options: PlsOptions, pkg: PlsPackage): PlsRequest {
  if (spec0.copulas?.length) throw new Error('This runs through the R packages, which have no Gaussian copula term: remove the copulas from the paths first.');
  if (spec0.constructs.some((c) => c.predefinedWeights)) throw new Error('This runs through the R packages, which this app calls without pre-defined weights: estimate the weights first.');
  if (spec0.threeWay?.length) throw new Error('This runs through the R packages, which this app calls for two-way interactions only: remove the moderated moderation first.');
  if (data0.moments && data0.cols.length === 0) throw new Error('PLS needs raw data; this dataset is a covariance matrix.');
  // Categorical exogenous constructs travel as their dummy columns, a Mode B composite.
  const { data, spec } = expandCategorical(data0, spec0);
  const used = new Set(spec.constructs.flatMap((c) => c.indicators));
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => used.has(n));
  return {
    kind: 'pls', package: pkg, missing: options.missing, ...(options.missing === 'mi' && options.mi ? { mi: options.mi } : {}),
    options: { scheme: options.scheme, consistent: !!options.consistent, tolerance: options.tolerance, maxIter: options.maxIter, approach: options.approach ?? 'PLS-PM', hocApproach: options.hocApproach ?? 'two_stage' },
    data: { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) },
    model: spec,
  };
}

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
const nums = (v: unknown) => ((v ?? []) as unknown[]).map(num);
const mat = (m: unknown) => ((m ?? []) as unknown[][]).map(nums);
const nmat = (m: unknown) => ((m ?? []) as unknown[][]).map((r) => r.map((v) => (typeof v === 'number' ? v : null)));

export type PlsResultR = PlsResult & { engine: REngineInfo; warnings: string[] };

/** Shape ps_pls()'s JSON into a PlsResult (null → NaN for numbers; null kept where the type allows). */
export function parsePlsOutput(raw: Record<string, any>): PlsResultR {
  const disc = (d: any) => ({ srmr: num(d?.srmr), dULS: num(d?.dULS), dG: num(d?.dG) });
  return {
    n: raw.n, iterations: raw.iterations, converged: !!raw.converged,
    constructs: raw.constructs, indicators: raw.indicators,
    weights: nums(raw.weights), loadings: nums(raw.loadings),
    pathCoef: mat(raw.pathCoef), hasPath: raw.hasPath, totalEffects: mat(raw.totalEffects), indirectEffects: mat(raw.indirectEffects),
    rSquared: (raw.rSquared as unknown[]).map((v) => (typeof v === 'number' ? v : null)),
    adjRSquared: (raw.adjRSquared as unknown[]).map((v) => (typeof v === 'number' ? v : null)),
    constructCor: mat(raw.constructCor),
    quality: (raw.quality as any[]).map((q) => ({ alpha: num(q.alpha), rhoC: num(q.rhoC), rhoA: num(q.rhoA), ave: num(q.ave) })),
    ...(raw.redundancy && !Array.isArray(raw.redundancy) ? { redundancy: raw.redundancy as Record<string, number> } : {}),
    htmt: nmat(raw.htmt), htmt2: nmat(raw.htmt2),
    fit: { estimated: disc(raw.fit?.estimated), saturated: disc(raw.fit?.saturated) },
    consistent: !!raw.consistent, types: raw.types, moderations: raw.moderations,
    ...(['PLS-PM', 'GSCA', 'PCA', 'unit'].includes(raw.approach) ? { approach: raw.approach } : {}),
    ...(['two_stage', 'embedded', 'repeated'].includes(raw.hocApproach) ? { hocApproach: raw.hocApproach } : {}),
    fSquare: nmat(raw.fSquare), vifInner: nmat(raw.vifInner), vifOuter: nums(raw.vifOuter),
    scores: (raw.scores as unknown[]).map((c) => Float64Array.from(nums(c))),
    droppedRows: raw.droppedRows ?? 0, warnings: rStrings(raw.warnings), notes: rStrings(raw.notes), engine: raw.engine,
    ...(typeof raw.imputations === 'number' ? { imputations: raw.imputations } : {}),
    ...(Array.isArray(raw.ordinal) && raw.ordinal.length ? { ordinal: rStrings(raw.ordinal) } : {}),
    ...(Array.isArray(raw.higherOrder) && raw.higherOrder.length ? {
      higherOrder: (raw.higherOrder as any[]).map((h) => ({ construct: Number(h.construct), component: Number(h.component), loading: num(h.loading), weight: num(h.weight) })),
    } : {}),
  };
}

/** The R packages: the PLS package, with mice for multiple imputation. */
export const plsPackages = (pkg: PlsPackage, options: Pick<PlsOptions, 'missing'>) => (options.missing === 'mi' ? (pkg === 'cSEM' ? 'cSEMMi' : 'seminrMi') : pkg);

export async function estimatePlsR(data: Dataset, spec: ModelSpec, options: PlsOptions, pkg: PlsPackage): Promise<PlsResultR> {
  return parsePlsOutput(await rCall<Record<string, any>>('ps_pls', plsRequest(data, spec, options, pkg), plsPackages(pkg, options)));
}

/** The self-contained R script (data embedded) that estimatePlsR runs. */
export function plsScriptR(data: Dataset, spec: ModelSpec, options: PlsOptions, pkg: PlsPackage): Promise<string> {
  return rScript('ps_pls', plsRequest(data, spec, options, pkg), plsPackages(pkg, options));
}
