// Item-level measurement models (R/items.R): item response theory (ltm; mirt for the 3PL, 4PL and
// mixture models) and latent class analysis (poLCA; glca for multilevel latent classes).

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

/** threepl, fourpl and mixture (a 2PL model in latent classes) are fitted by mirt, the others by ltm. */
export type IrtModel = 'rasch' | 'twopl' | 'grm' | 'gpcm' | 'threepl' | 'fourpl' | 'mixture';
export const MIRT_MODELS: readonly IrtModel[] = ['threepl', 'fourpl', 'mixture'];
export const isMirt = (m: IrtModel) => MIRT_MODELS.includes(m);
export interface IrtResult {
  model: IrtModel;
  n: number;
  items: string[];
  /** Per item: difficulty (Dffclt) or thresholds (Extrmt1…, Catgr.1…) and discrimination (Dscrmn). */
  params: { item: string; values: Record<string, number> }[];
  logLik: number;
  aic: number;
  bic: number;
  reliability: number | null;
  theta: number[];
  /** Item information over theta, one array per item. */
  information: number[][];
  itemFit: { item: string; x2: number; p: number }[];
  /** 2PL and partial credit: loadings and thresholds (steps) in the logit metric Mplus prints (threshold = −ltm's intercept), with standard errors (robust ones with `robust`). */
  coefficients?: {
    item: string;
    parameter: string;
    est: number;
    se: number | null;
    /** mixture: the latent class (1 = largest) */ class?: number;
  }[];
  /** mirt: free parameters; with priors, the log prior density at the estimates (Mplus prints log-likelihood + log prior). */
  npar?: number;
  logPrior?: number;
  /** Mixture: the class shares, largest first. */
  classes?: number[];
  /** Gauss-Hermite quadrature points, when chosen (absent: ltm's default). */
  quadrature?: number;
  robust?: boolean;
  /** 'mplus': fitted with Mplus's integration rule (rengine/irtMplus.ts). */
  integration?: 'mplus';
  warnings: string[];
  engine: REngineInfo;
}
/**
 * How an IRT model is fitted: quadrature points (ltm's GHk, mirt's quadpts), and robust (sandwich, Mplus MLR) standard errors
 * for the 2PL, partial credit, 3PL and 4PL models. mirt models: normal priors [mean, SD] on the logits of the lower (priorG)
 * and upper (priorU, 4PL) asymptotes; the items with a guessing parameter (3PL; absent: all); a frequency column (each row
 * stands for that many respondents); the mixture's classes, starts and seed.
 */
export interface IrtFit {
  quadrature?: number;
  robust?: boolean;
  priorG?: [number, number];
  priorU?: [number, number];
  guessItems?: string[];
  freq?: string;
  classes?: number;
  nrep?: number;
  seed?: number;
}

export interface LcaModel {
  k: number;
  llik: number;
  npar: number;
  aic: number;
  bic: number;
  gsq: number | null;
  entropy: number | null;
  /** Class proportions, largest first (classes are numbered in this order). */
  shares: number[];
  /** Categorical items: P(category | class); growth (LCGA): the model-implied probabilities at each occasion. */
  probs: { item: string; categories: string[]; byClass: number[][] }[];
  /** Latent profiles: the class means (class × item) and covariance matrices (class × item × item). */
  means?: number[][];
  cov?: number[][][];
  /** Growth (LCGA): thresholds (equal over time and classes) and each class's intercept (the last class's fixed at 0) and slope. */
  growth?: { thresholds: number[]; intercepts: number[]; slopes: number[] };
  /** Multilevel (glca): the shares of the classes of clusters (largest first) and, per cluster class, the shares of the classes of people. */
  clusters?: { shares: number[]; byCluster: number[][] };
}
export interface LcaResult {
  n: number;
  items: string[];
  models: LcaModel[];
  warnings: string[];
  engine: REngineInfo;
  times?: number[];
  structure?: LpaStructure;
  /** multilevel: the number of clusters, the cluster column and the number of cluster classes */ clusters?: number;
  cluster?: string;
  clusterClasses?: number;
  /** the three-step analysis of auxiliary variables */ aux?: LcaAuxResult;
}

/** How covariates are related to the classes in step 3: ML with the classification errors (Vermunt 2010; Mplus's R3STEP) or BCH weights. */
export type LcaAuxMethod = 'ml' | 'bch';
/**
 * Auxiliary variables of a latent class model (three-step approach): distal outcomes (class means with BCH weights) and
 * covariates of class membership (a multinomial logit), with the `classes`-class model (absent: the lowest BIC); the
 * logit's reference class (absent: the last).
 */
export interface LcaAux {
  distal: string[];
  covariates: string[];
  method: LcaAuxMethod;
  classes?: number;
  reference?: number;
}
export interface LcaAuxResult {
  k: number;
  method: LcaAuxMethod;
  n: number;
  /** D[c][s] = P(assigned to class s | in class c), from the posterior probabilities; counts: the cases assigned to each class. */
  D: number[][];
  counts: number[];
  /** Per distal outcome: the class means (BCH), their robust standard errors, the within-class SDs, the Wald test of equal means and of each pair. */
  distal?: {
    name: string;
    n: number;
    means: number[];
    se: number[];
    sd: number[];
    chisq: number;
    df: number;
    p: number;
    pairs: { a: number; b: number; chisq: number; p: number }[];
  }[];
  /** The multinomial logit: per class other than the reference, a coefficient and robust SE per term; Wald tests per term (all its coefficients 0). */
  covariates?: {
    n: number;
    logLik: number;
    reference: number;
    terms: string[];
    coefs: { class: number; est: number[]; se: number[]; p: number[] }[];
    wald: { chisq: number; df: number; p: number }[];
  };
}

/**
 * The model of the latent class card: categorical items (poLCA), continuous items (latent profiles, a normal
 * mixture by EM) with a variance structure, or an ordered categorical outcome over occasions (latent class
 * growth, `times` the occasions' time scores).
 */
export type LcaKind = 'lca' | 'lpa' | 'lcga' | 'mlca';
/** Latent profiles: EEI variances equal across classes, no covariances (Mplus's default); VVI class-specific variances; EEE / VVV with covariances, equal / class-specific. */
export type LpaStructure = 'EEI' | 'VVI' | 'EEE' | 'VVV';
/** mlca: categorical items of people in clusters (`cluster`), with `clusterClasses` classes of clusters (glca). */
export interface LcaSpec {
  model?: LcaKind;
  structure?: LpaStructure;
  times?: number[];
  cluster?: string;
  clusterClasses?: number;
  aux?: LcaAux;
}
/** The request's three-step part and its columns (none for multilevel classes, or without auxiliary variables). */
const auxOf = (spec: LcaSpec) =>
  spec.aux && spec.model !== 'mlca' && (spec.aux.distal.length || spec.aux.covariates.length)
    ? {
        aux: {
          distal: spec.aux.distal,
          covariates: spec.aux.covariates,
          method: spec.aux.method,
          ...(spec.aux.classes ? { classes: spec.aux.classes } : {}),
          ...(spec.aux.reference ? { reference: spec.aux.reference } : {}),
        },
      }
    : {};
const auxColumns = (spec: LcaSpec) => {
  const a = auxOf(spec).aux;
  return a ? [...a.distal, ...a.covariates] : [];
};

export const irtRequest = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit = {}) =>
  isMirt(model)
    ? {
        kind: 'irt',
        model,
        items,
        ...(fit.quadrature ? { quadrature: fit.quadrature } : {}),
        ...(fit.robust && model !== 'mixture' ? { robust: true } : {}),
        ...(fit.priorG && model !== 'mixture' ? { priorG: fit.priorG } : {}),
        ...(fit.priorU && model === 'fourpl' ? { priorU: fit.priorU } : {}),
        ...(fit.guessItems?.length && model === 'threepl'
          ? { guessItems: fit.guessItems.filter((i) => items.includes(i)) }
          : {}),
        ...(fit.freq ? { freq: fit.freq } : {}),
        ...(model === 'mixture'
          ? { classes: fit.classes ?? 2, nrep: fit.nrep ?? 10, seed: fit.seed ?? 1 }
          : {}),
        data: rColumns(data, fit.freq ? [...items, fit.freq] : items),
      }
    : {
        kind: 'irt',
        model,
        items,
        ...(fit.quadrature ? { quadrature: fit.quadrature } : {}),
        ...(fit.robust ? { robust: true } : {}),
        data: rColumns(data, items),
      };
export const lcaRequest = (
  data: Dataset,
  items: string[],
  classes: number[],
  nrep: number,
  seed: number,
  spec: LcaSpec = {},
) =>
  spec.model === 'lpa'
    ? {
        kind: 'lpa',
        items,
        classes,
        nrep,
        seed,
        structure: spec.structure ?? 'EEI',
        ...auxOf(spec),
        data: rColumns(data, [...items, ...auxColumns(spec)]),
      }
    : spec.model === 'lcga'
      ? {
          kind: 'lcga',
          items,
          classes,
          nrep,
          seed,
          times: spec.times ?? items.map((_, i) => i),
          ...auxOf(spec),
          data: rColumns(data, [...items, ...auxColumns(spec)]),
        }
      : spec.model === 'mlca'
        ? {
            kind: 'mlca',
            items,
            classes,
            nrep,
            seed,
            cluster: spec.cluster ?? '',
            clusterClasses: spec.clusterClasses ?? 2,
            data: rColumns(data, [...items, spec.cluster ?? '']),
          }
        : {
            kind: 'lca',
            items,
            classes,
            nrep,
            seed,
            ...auxOf(spec),
            data: rColumns(data, [...items, ...auxColumns(spec)]),
          };
const LCA_BRIDGE = {
  lca: ['ps_lca', 'poLCA'],
  lpa: ['ps_lpa', 'stats'],
  lcga: ['ps_lcga', 'stats'],
  mlca: ['ps_mlca', 'glca'],
} as const;
const IRT_BRIDGE = (model: IrtModel) =>
  isMirt(model) ? (['ps_mirt', 'mirt'] as const) : (['ps_irt', 'ltm'] as const);

export async function irtR(
  data: Dataset,
  items: string[],
  model: IrtModel,
  fit: IrtFit = {},
): Promise<IrtResult> {
  const [fn, pkg] = IRT_BRIDGE(model);
  const raw = await rCall<Record<string, any>>(fn, irtRequest(data, items, model, fit), pkg);
  return {
    ...raw,
    items: rList<string>(raw.items),
    params: rList<any>(raw.params),
    theta: rList<number>(raw.theta),
    ...(raw.coefficients != null ? { coefficients: rList<any>(raw.coefficients) } : {}),
    ...(raw.classes != null ? { classes: rList<number>(raw.classes) } : {}),
    quadrature: typeof raw.quadrature === 'number' ? raw.quadrature : undefined,
    robust: raw.robust === true,
    information: rList<unknown>(raw.information).map((x) => rList<number>(x)),
    itemFit: rList<any>(raw.itemFit),
    warnings: rStrings(raw.warnings),
  } as IrtResult;
}
export const irtScriptR = (data: Dataset, items: string[], model: IrtModel, fit: IrtFit = {}) =>
  rScript(IRT_BRIDGE(model)[0], irtRequest(data, items, model, fit), IRT_BRIDGE(model)[1]);

export async function lcaR(
  data: Dataset,
  items: string[],
  classes: number[],
  nrep = 10,
  seed = 1,
  spec: LcaSpec = {},
): Promise<LcaResult> {
  const [fn, pkg] = LCA_BRIDGE[spec.model ?? 'lca'];
  const raw = await rCall<Record<string, any>>(
    fn,
    lcaRequest(data, items, classes, nrep, seed, spec),
    pkg,
  );
  const num2 = (v: unknown) => rList<unknown>(v).map((x) => rList<number>(x));
  return {
    ...raw,
    items: rList<string>(raw.items),
    warnings: rStrings(raw.warnings),
    ...(raw.times != null ? { times: rList<number>(raw.times) } : {}),
    models: rList<any>(raw.models).map((m) => ({
      ...m,
      shares: rList<number>(m.shares),
      probs: rList<any>(m.probs).map((p) => ({
        item: p.item,
        categories: rStrings(p.categories),
        byClass: num2(p.byClass),
      })),
      ...(m.means != null ? { means: num2(m.means), cov: rList<unknown>(m.cov).map(num2) } : {}),
      ...(m.growth != null
        ? {
            growth: {
              thresholds: rList<number>(m.growth.thresholds),
              intercepts: rList<number>(m.growth.intercepts),
              slopes: rList<number>(m.growth.slopes),
            },
          }
        : {}),
      ...(m.clusters != null
        ? {
            clusters: {
              shares: rList<number>(m.clusters.shares),
              byCluster: num2(m.clusters.byCluster),
            },
          }
        : {}),
    })),
    ...(raw.aux != null ? { aux: auxResult(raw.aux) } : {}),
  } as LcaResult;
}
/** The three-step results as R's JSON gives them (one-element vectors arrive as scalars). */
function auxResult(a: Record<string, any>): LcaAuxResult {
  const num2 = (v: unknown) => rList<unknown>(v).map((x) => rList<number>(x));
  return {
    k: a.k,
    method: a.method,
    n: a.n,
    D: num2(a.D),
    counts: rList<number>(a.counts),
    ...(a.distal != null
      ? {
          distal: rList<any>(a.distal).map((d) => ({
            ...d,
            means: rList<number>(d.means),
            se: rList<number>(d.se),
            sd: rList<number>(d.sd),
            pairs: rList<any>(d.pairs),
          })),
        }
      : {}),
    ...(a.covariates != null
      ? {
          covariates: {
            ...a.covariates,
            terms: rStrings(a.covariates.terms),
            coefs: rList<any>(a.covariates.coefs).map((c) => ({
              class: c.class,
              est: rList<number>(c.est),
              se: rList<number>(c.se),
              p: rList<number>(c.p),
            })),
            wald: rList<any>(a.covariates.wald),
          },
        }
      : {}),
  };
}
export const lcaScriptR = (
  data: Dataset,
  items: string[],
  classes: number[],
  nrep = 10,
  seed = 1,
  spec: LcaSpec = {},
) =>
  rScript(
    LCA_BRIDGE[spec.model ?? 'lca'][0],
    lcaRequest(data, items, classes, nrep, seed, spec),
    LCA_BRIDGE[spec.model ?? 'lca'][1],
  );
