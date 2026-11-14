// PLS-SEM through cSEM or seminr (in webR). The model is translated and
// estimated by R/pls.R; this module builds the request and turns the
// package's output into the app's PlsResult, so every view works unchanged.

import type { Dataset, MissingTreatment, ModelSpec, PlsOptions, PlsResult } from '../engine/types';
import type { REngineInfo } from './lavaan';
import { expandCategorical } from '../engine/categorical';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';

export type PlsPackage = 'cSEM' | 'seminr';

export interface PlsRequest {
  kind: 'pls';
  package: PlsPackage;
  missing: MissingTreatment;
  options: {
    scheme: PlsOptions['scheme'];
    consistent: boolean;
    tolerance: number;
    maxIter: number;
    approach: 'PLS-PM' | 'GSCA' | 'PCA' | 'unit';
    hocApproach: 'two_stage' | 'embedded' | 'repeated';
  };
  data: { names: string[]; cols: (number | null)[][] };
  model: ModelSpec;
}

export function plsRequest(
  data0: Dataset,
  spec0: ModelSpec,
  options: PlsOptions,
  pkg: PlsPackage,
): PlsRequest {
  if (spec0.copulas?.length)
    throw new Error(
      'This runs through the R packages, which have no Gaussian copula term: remove the copulas from the paths first.',
    );
  if (spec0.constructs.some((c) => c.predefinedWeights))
    throw new Error(
      'This runs through the R packages, which this app calls without pre-defined weights: estimate the weights first.',
    );
  // (CB-SEM's lavaan weights its own requests; cSEM and seminr take no sampling weights: weighted PLS is the built-in engine's.)
  if (spec0.weights)
    throw new Error(
      'This runs through the R packages, which take no sampling weights (weighted PLS is the built-in engine’s): clear the sampling weights first.',
    );
  if (spec0.threeWay?.length)
    throw new Error(
      'This runs through the R packages, which this app calls for two-way interactions only: remove the moderated moderation first.',
    );
  if (data0.moments && data0.cols.length === 0)
    throw new Error('PLS needs raw data; this dataset is a covariance matrix.');
  // Categorical exogenous constructs travel as their dummy columns, a Mode B composite.
  const { data, spec } = expandCategorical(data0, spec0);
  const used = new Set(spec.constructs.flatMap((c) => c.indicators));
  return {
    kind: 'pls',
    package: pkg,
    missing: options.missing,
    ...(options.missing === 'mi' && options.mi ? { mi: options.mi } : {}),
    options: {
      scheme: options.scheme,
      consistent: !!options.consistent,
      tolerance: options.tolerance,
      maxIter: options.maxIter,
      approach: options.approach ?? 'PLS-PM',
      hocApproach: options.hocApproach ?? 'two_stage',
    },
    data: rColumns(data, used),
    model: spec,
  };
}

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);
// (every vector through rList: R sends a one-element vector as a scalar, e.g. the names of a one-construct model)
const nums = (v: unknown) => rList<unknown>(v).map(num);
const mat = (m: unknown) => rList<unknown>(m).map(nums);
const nmat = (m: unknown) =>
  rList<unknown>(m).map((r) => rList<unknown>(r).map((v) => (typeof v === 'number' ? v : null)));
const objects = (v: unknown) => rList<any>(v);

export type PlsResultR = PlsResult & { engine: REngineInfo; warnings: string[] };

/** Shape ps_pls()'s JSON into a PlsResult (null → NaN for numbers; null kept where the type allows). */
export function parsePlsOutput(raw: Record<string, any>): PlsResultR {
  const disc = (d: any) => ({ srmr: num(d?.srmr), dULS: num(d?.dULS), dG: num(d?.dG) });
  return {
    n: raw.n,
    iterations: raw.iterations,
    converged: !!raw.converged,
    constructs: rStrings(raw.constructs),
    indicators: objects(raw.indicators),
    weights: nums(raw.weights),
    loadings: nums(raw.loadings),
    pathCoef: mat(raw.pathCoef),
    hasPath: rList<unknown>(raw.hasPath).map((r) => rList<boolean>(r)),
    totalEffects: mat(raw.totalEffects),
    indirectEffects: mat(raw.indirectEffects),
    rSquared: rList<unknown>(raw.rSquared).map((v) => (typeof v === 'number' ? v : null)),
    adjRSquared: rList<unknown>(raw.adjRSquared).map((v) => (typeof v === 'number' ? v : null)),
    constructCor: mat(raw.constructCor),
    quality: objects(raw.quality).map((q) => ({
      alpha: num(q.alpha),
      rhoC: num(q.rhoC),
      rhoA: num(q.rhoA),
      ave: num(q.ave),
    })),
    ...(raw.redundancy && !Array.isArray(raw.redundancy)
      ? { redundancy: raw.redundancy as Record<string, number> }
      : {}),
    htmt: nmat(raw.htmt),
    htmt2: nmat(raw.htmt2),
    fit: { estimated: disc(raw.fit?.estimated), saturated: disc(raw.fit?.saturated) },
    consistent: !!raw.consistent,
    types: rStrings(raw.types) as PlsResult['types'],
    moderations: objects(raw.moderations),
    ...(['PLS-PM', 'GSCA', 'PCA', 'unit'].includes(raw.approach) ? { approach: raw.approach } : {}),
    ...(['two_stage', 'embedded', 'repeated'].includes(raw.hocApproach)
      ? { hocApproach: raw.hocApproach }
      : {}),
    fSquare: nmat(raw.fSquare),
    vifInner: nmat(raw.vifInner),
    vifOuter: nums(raw.vifOuter),
    scores: rList<unknown>(raw.scores).map((c) => Float64Array.from(nums(c))),
    droppedRows: raw.droppedRows ?? 0,
    warnings: rStrings(raw.warnings),
    notes: rStrings(raw.notes),
    engine: raw.engine,
    ...(typeof raw.imputations === 'number' ? { imputations: raw.imputations } : {}),
    ...(raw.imputationMethod === 'mice' || raw.imputationMethod === 'micenorm'
      ? { imputationMethod: raw.imputationMethod }
      : {}),
    ...(Array.isArray(raw.ordinal) && raw.ordinal.length ? { ordinal: rStrings(raw.ordinal) } : {}),
    ...(Array.isArray(raw.higherOrder) && raw.higherOrder.length
      ? {
          higherOrder: (raw.higherOrder as any[]).map((h) => ({
            construct: Number(h.construct),
            component: Number(h.component),
            loading: num(h.loading),
            weight: num(h.weight),
          })),
        }
      : {}),
  };
}

/** The R packages: the PLS package, with mice for multiple imputation. */
export const plsPackages = (pkg: PlsPackage, options: Pick<PlsOptions, 'missing'>) => {
  if (options.missing !== 'mi') return pkg;
  return pkg === 'cSEM' ? 'cSEMMi' : 'seminrMi';
};

export async function estimatePlsR(
  data: Dataset,
  spec: ModelSpec,
  options: PlsOptions,
  pkg: PlsPackage,
): Promise<PlsResultR> {
  return parsePlsOutput(
    await rCall<Record<string, any>>(
      'ps_pls',
      plsRequest(data, spec, options, pkg),
      plsPackages(pkg, options),
    ),
  );
}

/** The self-contained R script (data embedded) that estimatePlsR runs. */
export function plsScriptR(
  data: Dataset,
  spec: ModelSpec,
  options: PlsOptions,
  pkg: PlsPackage,
): Promise<string> {
  return rScript('ps_pls', plsRequest(data, spec, options, pkg), plsPackages(pkg, options));
}
