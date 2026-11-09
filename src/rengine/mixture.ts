// The mixture model card's engine (R/mixture.R): a general finite mixture likelihood fitted by maximum likelihood
// from random starts, with robust (MLR) standard errors. The model is the specification analyses/mixtureSyntax.ts
// builds from the card's Mplus-style syntax.

import type { MixtureSpec } from '../analyses/mixtureSyntax';
import type { Dataset } from '../engine/types';
import { parallelism, rCall, rCallParallel, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

/** A printed parameter: `at` the class of each latent class variable it belongs to (0: the same in all of its classes). */
/** level: two-level models, the level Mplus prints the parameter under. */
export interface MixtureParam { lhs: string; op: string; rhs: string; at: number[]; est: number; se: number | null; fixed: boolean; level?: 'within' | 'between' }
export interface MixtureResult {
  /** Cases (the sum of the frequency weights) and data rows used (identical cases collapsed). */
  n: number; rows: number;
  logLik: number; npar: number; aic: number; bic: number;
  params: MixtureParam[];
  /** Each latent class variable's class shares (posterior). */
  classes: { name: string; k: number; shares: number[] }[];
  /** The joint classes (one class of each variable) and their shares. */
  patterns: { classes: number[]; share: number }[];
  entropy: number | null;
  /** The log-likelihoods the final-stage starts reached, best first. */
  lls: number[];
  converged: boolean;
  /** The free parameters at the maximum (to start a refit from, e.g. with the classes in another order). */
  theta: number[];
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const columns = (data: Dataset, names: string[]) => {
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => names.includes(n));
  return { names: keep.map(([n]) => n), cols: keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))) };
};
export const mixtureRequest = (data: Dataset, spec: MixtureSpec) => ({ kind: 'mixture', spec, data: columns(data, spec.columns) });

/** One run of the random starts (R: mix_phase): the start, where it ended and minus its log-likelihood. */
interface StartRun { i: number; par: number[] | number; value: number; convergence?: number }

/**
 * The random starts spread over the parallel R sessions: the short runs in chunks of starts, the best `final` continued
 * to convergence one per session, then the best finished in the main session. Every start is drawn from the same
 * seeded sequence, so the result is the same with any number of sessions (and as one session runs all three in turn).
 */
export async function mixturePhases(data: Dataset, spec: MixtureSpec, sessions: number): Promise<MixtureSpec['phase']> {
  const n = spec.starts;
  const chunks = Array.from({ length: Math.min(sessions, n) }, (_, k) => Array.from({ length: n }, (_, i) => i + 1).filter((i) => (i - 1) % Math.min(sessions, n) === k));
  const st = await rCallParallel<{ stage: StartRun[] | StartRun }>('ps_mixture', chunks.map((only) => mixtureRequest(data, { ...spec, phase: { only } })), 'stats');
  const stage = st.flatMap((r) => arr<StartRun>(r.stage)).sort((a, b) => a.value - b.value || a.i - b.i);
  const keep = stage.slice(0, Math.max(1, Math.min(spec.final, stage.length)));
  const fin = await rCallParallel<{ finals: StartRun[] | StartRun }>('ps_mixture', keep.map((s) => mixtureRequest(data, { ...spec, phase: { stage: [s], cont: true } })), 'stats');
  return { finals: fin.flatMap((r) => arr<StartRun>(r.finals)).sort((a, b) => keep.findIndex((k) => k.i === a.i) - keep.findIndex((k) => k.i === b.i)) };
}

export async function mixtureR(data: Dataset, spec: MixtureSpec): Promise<MixtureResult> {
  const p = spec.starts > 1 && !spec.given && !spec.phase ? await parallelism() : { sessions: 1 };
  if (p.sessions > 1) spec = { ...spec, phase: await mixturePhases(data, spec, p.sessions) };
  const raw = await rCall<Record<string, any>>('ps_mixture', mixtureRequest(data, spec), 'stats');
  return {
    ...raw, params: arr<any>(raw.params).map((p) => ({ ...p, rhs: p.rhs ?? '', at: arr<number>(p.at), se: typeof p.se === 'number' ? p.se : null })),
    classes: arr<any>(raw.classes).map((c) => ({ name: c.name, k: c.k, shares: arr<number>(c.shares) })),
    patterns: arr<any>(raw.patterns).map((p) => ({ classes: arr<number>(p.classes), share: p.share })),
    lls: arr<number>(raw.lls), theta: arr<number>(raw.theta), entropy: typeof raw.entropy === 'number' ? raw.entropy : null,
    warnings: rStrings(raw.warnings),
  } as MixtureResult;
}
export const mixtureScriptR = (data: Dataset, spec: MixtureSpec) => rScript('ps_mixture', mixtureRequest(data, spec), 'stats');
