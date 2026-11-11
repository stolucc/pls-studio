// Bayesian multilevel / DSEM models (R/dsem.R ps_dsem): a Stan program written from the card's model (Mplus syntax,
// analyses/dsemSyntax.ts), sampled by rstan. Desktop R only: the bridge refuses it in the browser (DESKTOP_ONLY).

import type { Dataset } from '../engine/types';
import type { DsemSpec } from '../analyses/dsemSyntax';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import type { REngineInfo } from './lavaan';

/** parametrization: 'noncentred' samples every level's random effects standardised (the default: centred where clusters have 20 or more rows each). */
export interface DsemRunOptions {
  chains: number;
  warmup: number;
  draws: number;
  parametrization?: 'noncentred';
}
export interface DsemParameter {
  lhs: string;
  op: string;
  rhs: string;
  block: string;
  fixed: boolean;
  median: number;
  mean: number;
  sd: number;
  low: number;
  high: number;
  rhat: number | null;
  neff: number | null;
  pOne: number | null;
}
export interface DsemResult {
  chains: number;
  warmup: number;
  draws: number;
  seed: number;
  confidence: number;
  n: number;
  clusters: number[];
  series: number;
  parameters: DsemParameter[];
  maxRhat: number | null;
  minNeff: number | null;
  converged: boolean;
  divergent: number;
  npar: number;
  warnings: string[];
  engine: REngineInfo & { desktop?: string };
}

const cols = (d: Dataset) => ({
  names: d.names,
  cols: d.cols.map((c) => Array.from(c, (v) => (Number.isFinite(v) ? v : null))),
});

export const dsemRequest = (
  data: Dataset,
  spec: DsemSpec,
  o: DsemRunOptions,
  seed: number,
  confidence: number,
) => ({
  data: cols(data),
  spec,
  chains: o.chains,
  warmup: o.warmup,
  draws: o.draws,
  ...(o.parametrization ? { parametrization: o.parametrization } : {}),
  seed,
  confidence,
});

export async function dsemR(
  data: Dataset,
  spec: DsemSpec,
  o: DsemRunOptions,
  seed: number,
  confidence: number,
): Promise<DsemResult> {
  const r = await rCall<Record<string, any>>(
    'ps_dsem',
    dsemRequest(data, spec, o, seed, confidence),
    'rstan',
  );
  return {
    ...r,
    clusters: rList(r.clusters),
    parameters: rList(r.parameters),
    warnings: rStrings(r.warnings),
  } as DsemResult;
}
export const dsemScriptR = (
  data: Dataset,
  spec: DsemSpec,
  o: DsemRunOptions,
  seed: number,
  confidence: number,
) => rScript('ps_dsem', dsemRequest(data, spec, o, seed, confidence), 'rstan');
