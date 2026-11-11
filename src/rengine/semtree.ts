// SEM trees and forests (R/semtree.R ps_semtree): the CB-SEM model on the canvas split on covariates by semtree.
// Desktop R only (OpenMx; DESKTOP_ONLY).

import type { CbEstimator } from '../engine/cbsem';
import type { Dataset, MissingTreatment, ModelSpec } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import { cbRequest, type REngineInfo } from './lavaan';

export type CovariateType = 'numeric' | 'ordered' | 'categorical';
export interface SemTreeCovariate {
  name: string;
  type: CovariateType;
}
export interface SemTreeInput {
  covariates: SemTreeCovariate[];
  method: 'naive' | 'score' | 'fair';
  alpha: number;
  maxDepth: number;
  minN: number;
  /** A SEM forest and its variable importance (absent: the tree only). */
  forest?: { trees: number; seed: number };
}
export interface SemTreeParam {
  lhs: string;
  op: string;
  rhs: string;
  est: number;
}
export interface SemTreeNode {
  id: number;
  parent?: number;
  /** 0: the parent's rule is false (semtree's left child); 1: true. */ edge?: 0 | 1;
  n: number;
  terminal: boolean;
  rule?: { variable: string; relation: string; value: string[] };
  lr?: number;
  df?: number;
  p?: number;
  params: SemTreeParam[];
}
export interface SemTreeResult {
  nodes: SemTreeNode[];
  n: number;
  method: string;
  alpha: number;
  maxDepth: number;
  minN: number;
  covariates: SemTreeCovariate[];
  forest?: { variables: string[]; importance: (number | null)[]; trees: number; seed: number };
  warnings: string[];
  engine: REngineInfo & { openmx?: string; desktop?: string };
}
export interface SemTreeModel {
  data: Dataset;
  spec: ModelSpec;
  missing: MissingTreatment;
  estimator: CbEstimator;
}

export function semTreeRequest(m: SemTreeModel, o: SemTreeInput) {
  const at = o.covariates.map((c) => m.data.names.indexOf(c.name));
  if (at.some((k) => k < 0))
    throw new Error(
      `Not in the data: ${o.covariates
        .filter((_, i) => at[i] < 0)
        .map((c) => c.name)
        .join(', ')}.`,
    );
  const { covariates, ...tree } = o;
  return {
    ...cbRequest(m.data, m.spec, m.missing, m.estimator),
    tree,
    covariates: {
      names: covariates.map((c) => c.name),
      types: covariates.map((c) => c.type),
      cols: at.map((k) => Array.from(m.data.cols[k], (v) => (Number.isNaN(v) ? null : v))),
    },
  };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** The reply as the card reads it (R's single values and empty lists normalised). */
export function semTreeResult(r: Record<string, any>): SemTreeResult {
  const nodes = rList<Record<string, any>>(r.nodes).map(
    (x): SemTreeNode => ({
      id: Number(x.id),
      n: Number(x.n),
      terminal: !!x.terminal,
      params: rList<SemTreeParam>(x.params),
      ...(num(x.parent) !== undefined ? { parent: x.parent } : {}),
      ...(x.edge === 0 || x.edge === 1 ? { edge: x.edge } : {}),
      ...(x.rule && !Array.isArray(x.rule)
        ? {
            rule: {
              variable: String(x.rule.variable),
              relation: String(x.rule.relation),
              value: rList<string>(x.rule.value).map(String),
            },
          }
        : {}),
      ...(num(x.lr) !== undefined ? { lr: x.lr } : {}),
      ...(num(x.df) !== undefined ? { df: x.df } : {}),
      ...(num(x.p) !== undefined ? { p: x.p } : {}),
    }),
  );
  const f = r.forest && !Array.isArray(r.forest) ? r.forest : null;
  return {
    nodes,
    n: r.n,
    method: r.method,
    alpha: r.alpha,
    maxDepth: r.maxDepth,
    minN: r.minN,
    covariates: rList<SemTreeCovariate>(r.covariates),
    ...(f
      ? {
          forest: {
            variables: rList<string>(f.variables),
            importance: rList<unknown>(f.importance).map((v) => num(v) ?? null),
            trees: Number(f.trees),
            seed: Number(f.seed),
          },
        }
      : {}),
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
}

export async function semTreeR(m: SemTreeModel, o: SemTreeInput): Promise<SemTreeResult> {
  return semTreeResult(
    await rCall<Record<string, any>>('ps_semtree', semTreeRequest(m, o), 'semtree'),
  );
}
export const semTreeScriptR = (m: SemTreeModel, o: SemTreeInput) =>
  rScript('ps_semtree', semTreeRequest(m, o), 'semtree');
