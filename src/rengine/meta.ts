// Univariate meta-analysis (R/meta.R): metafor's rma (equal- and random-effects models, meta-regression) and rma.mv
// (three-level models), effect sizes given or computed by escalc, publication bias and influence diagnostics.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList } from './rjson';
import type { REngineInfo } from './lavaan';

/** escalc's measures (GEN: effect sizes given) with the summary data each needs. */
export const META_MEASURES = {
  GEN: { label: 'Effect sizes given', roles: ['yi'] },
  SMD: {
    label: 'Standardised mean difference (Hedges’ g)',
    roles: ['m1i', 'sd1i', 'n1i', 'm2i', 'sd2i', 'n2i'],
  },
  MD: { label: 'Mean difference', roles: ['m1i', 'sd1i', 'n1i', 'm2i', 'sd2i', 'n2i'] },
  OR: { label: 'Log odds ratio', roles: ['ai', 'bi', 'ci', 'di'] },
  RR: { label: 'Log risk ratio', roles: ['ai', 'bi', 'ci', 'di'] },
  RD: { label: 'Risk difference', roles: ['ai', 'bi', 'ci', 'di'] },
  ZCOR: { label: 'Correlation (Fisher’s z)', roles: ['ri', 'ni'] },
  PLO: { label: 'Proportion (logit)', roles: ['xi', 'ni'] },
  PR: { label: 'Proportion (raw)', roles: ['xi', 'ni'] },
} as const;
export type MetaMeasure = keyof typeof META_MEASURES;

/** What each summary-data column holds. */
export const META_ROLE_LABELS: Record<string, string> = {
  yi: 'Effect size',
  vi: 'Sampling variance',
  sei: 'Standard error',
  m1i: 'Mean, group 1',
  sd1i: 'SD, group 1',
  n1i: 'n, group 1',
  m2i: 'Mean, group 2',
  sd2i: 'SD, group 2',
  n2i: 'n, group 2',
  ai: 'Events, group 1',
  bi: 'Non-events, group 1',
  ci: 'Events, group 2',
  di: 'Non-events, group 2',
  ri: 'Correlation',
  ni: 'Sample size',
  xi: 'Events',
};

/** metafor's estimators: FE (equal effects) and the tau² estimators of random-effects models. */
export const META_METHODS = [
  ['FE', 'Equal effects (fixed)'],
  ['REML', 'REML'],
  ['ML', 'ML'],
  ['DL', 'DerSimonian–Laird'],
  ['PM', 'Paule–Mandel'],
  ['HE', 'Hedges'],
  ['SJ', 'Sidik–Jonkman'],
  ['EB', 'Empirical Bayes'],
  ['HS', 'Hunter–Schmidt'],
] as const;
export type MetaMethod = (typeof META_METHODS)[number][0];

/** Back-transformations of the pooled estimate. */
export type MetaTransf = 'none' | 'exp' | 'ztor' | 'ilogit';

/** The back-transformation a measure implies (GEN: the user's choice). */
export function measureTransf(measure: MetaMeasure, given: MetaTransf): MetaTransf {
  if (measure === 'OR' || measure === 'RR') return 'exp';
  if (measure === 'ZCOR') return 'ztor';
  if (measure === 'PLO') return 'ilogit';
  if (measure === 'GEN') return given;
  return 'none';
}

export interface MetaInput {
  measure: MetaMeasure;
  /** role → data column (escalc's argument names). */
  columns: Record<string, string>;
  /** GEN: whether the second column holds variances or standard errors. */
  varType: 'vi' | 'sei';
  method: MetaMethod;
  knha: boolean;
  transf: MetaTransf;
  moderators: string[];
  /** The moderators entered as factors. */
  categorical: string[];
  /** A three-level model: the column of the clusters the effect sizes are nested in. */
  cluster: string;
  /** The column of study labels (text columns show their text). */
  label: string;
  bias: boolean;
  influence: boolean;
  confidence: number;
}

export interface MetaCoef {
  term: string;
  est: number;
  se: number;
  stat: number;
  df: number | null;
  p: number;
  ciLow: number;
  ciHigh: number;
}
export interface MetaInterval {
  est: number;
  se: number | null;
  ciLow: number;
  ciHigh: number;
  piLow: number;
  piHigh: number;
}
export interface MetaStudy {
  label: string;
  yi: number;
  vi: number;
  ciLow: number;
  ciHigh: number;
  weight: number;
}
export interface MetaRegtest {
  stat: number;
  df: number | null;
  p: number;
  /** The limit estimate (the effect as the standard error goes to zero) and its test. */
  est: number;
  estSe: number;
  estP: number;
  ciLow: number;
  ciHigh: number;
}
interface Bounds {
  est: number;
  ciLow: number;
  ciHigh: number;
}
export interface MetaResult {
  measure: MetaMeasure;
  method: MetaMethod;
  knha: boolean;
  threeLevel: boolean;
  k: number;
  studies: MetaStudy[];
  coefs: MetaCoef[];
  pooled: MetaInterval | null;
  pooledBack: MetaInterval | null;
  Q: number;
  Qdf: number;
  Qp: number;
  QM: number | null;
  QMdf: number[];
  QMp: number | null;
  heterogeneity: {
    tau2?: number;
    tau2se?: number | null;
    I2?: number | number[];
    H2?: number;
    R2?: number | null;
    ci?: { tau2: Bounds | null; tau: Bounds | null; I2: Bounds | null; H2: Bounds | null };
    sigma2?: number[];
    levels?: string[];
    clusters?: number;
  };
  fit: { logLik: number; deviance: number; AIC: number; BIC: number; AICc: number };
  bias?: {
    egger: MetaRegtest;
    rank: { tau: number; p: number };
    trimfill: {
      k0: number;
      side: string;
      est: number;
      se: number;
      p: number;
      ciLow: number;
      ciHigh: number;
      tau2: number;
      filled: { yi: number; vi: number }[];
    };
    pet: MetaRegtest;
    peese: MetaRegtest;
  };
  influence?: {
    label: string;
    rstudent: number;
    dffits: number;
    cook: number;
    covr: number;
    tau2del: number;
    QEdel: number;
    hat: number;
    weight: number;
    influential: boolean;
  }[];
  leaveOneOut?: {
    label: string;
    est: number;
    se: number;
    p: number;
    ciLow: number;
    ciHigh: number;
    Q: number;
    Qp: number;
    tau2: number;
    I2: number;
  }[];
  warnings: string[];
  engine: REngineInfo;
}

/** The roles a measure needs: its summary data, and for given effect sizes the variance or SE column. */
export function metaRoles(i: Pick<MetaInput, 'measure' | 'varType'>): string[] {
  const roles: string[] = [...META_MEASURES[i.measure].roles];
  if (i.measure === 'GEN') roles.push(i.varType);
  return roles;
}

/** Every data column the analysis reads. */
export function metaColumns(i: MetaInput): string[] {
  const roles = metaRoles(i).map((r) => i.columns[r] ?? '');
  return [...new Set([...roles, ...i.moderators, i.cluster, i.label].filter(Boolean))];
}

/** The label of each row: a text column's categories, a number as written, or nothing. */
function rowLabels(data: Dataset, column: string): string[] | undefined {
  const k = data.names.indexOf(column);
  if (!column || k < 0) return undefined;
  const cats = data.categories?.[column];
  return Array.from(data.cols[k], (v) => {
    if (Number.isNaN(v)) return '';
    if (cats && Number.isInteger(v) && v >= 1 && v <= cats.length) return cats[v - 1];
    return String(v);
  });
}

export function metaRequest(data: Dataset, i: MetaInput) {
  if (data.moments && data.cols.length === 0)
    throw new Error('Meta-analysis needs one row per study; this dataset is a covariance matrix.');
  const roles = metaRoles(i);
  const columns = Object.fromEntries(roles.map((r) => [r, i.columns[r] ?? '']));
  const used = [
    ...new Set([...Object.values(columns), ...i.moderators, i.cluster].filter(Boolean)),
  ];
  const labels = rowLabels(data, i.label);
  return {
    kind: 'meta',
    measure: i.measure,
    columns,
    varType: i.varType,
    method: i.method,
    knha: i.knha,
    transf: measureTransf(i.measure, i.transf),
    moderators: i.moderators,
    categorical: i.categorical.filter((m) => i.moderators.includes(m)),
    ...(i.cluster ? { cluster: i.cluster } : {}),
    ...(labels ? { labels } : {}),
    bias: i.bias,
    influence: i.influence,
    confidence: i.confidence,
    data: rColumns(data, used),
  };
}

export async function metaR(data: Dataset, input: MetaInput): Promise<MetaResult> {
  const raw = await rCall<Record<string, any>>('ps_meta', metaRequest(data, input), 'metafor');
  const bias = raw.bias
    ? {
        ...raw.bias,
        trimfill: { ...raw.bias.trimfill, filled: rList(raw.bias.trimfill.filled) },
      }
    : undefined;
  return {
    ...raw,
    studies: rList(raw.studies),
    coefs: rList(raw.coefs),
    pooled: raw.pooled ?? null,
    pooledBack: raw.pooledBack ?? null,
    QM: raw.QM ?? null,
    QMdf: rList(raw.QMdf),
    QMp: raw.QMp ?? null,
    heterogeneity: {
      ...raw.heterogeneity,
      ...(raw.heterogeneity.sigma2 !== undefined
        ? {
            sigma2: rList(raw.heterogeneity.sigma2),
            I2: rList(raw.heterogeneity.I2),
            levels: rList(raw.heterogeneity.levels),
          }
        : {}),
    },
    ...(bias ? { bias } : {}),
    ...(raw.influence ? { influence: rList(raw.influence) } : {}),
    ...(raw.leaveOneOut ? { leaveOneOut: rList(raw.leaveOneOut) } : {}),
    warnings: rStrings(raw.warnings),
  } as MetaResult;
}

export const metaScriptR = (data: Dataset, input: MetaInput) =>
  rScript('ps_meta', metaRequest(data, input), 'metafor');
