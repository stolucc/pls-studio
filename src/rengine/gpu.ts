// Bootstrapping with the built-in engine on an accelerator (a GPU on this
// computer, or later a cluster node) through the helper: helper/accel.go runs
// gpusrc/plsgpu.py, a batched torch port of engine/pls.ts and
// engine/bootstrap.ts. The browser prepares what the worker needs (the
// indicator columns with missing values treated, the compiled model) and
// splits the samples into one range per accelerator; every sample's rows come
// from the same seed as in the browser, so the draws are those of the
// built-in engine up to floating-point precision (exactly, in double).

import { splitRanges, STUDENTIZED_INNER, type RangePart } from '../engine/bootstrap';
import { expandCategorical } from '../engine/categorical';
import { compileModel, extractColumns, type CompiledModel } from '../engine/pls';
import { LAVAAN_MISSING, type Dataset, type ModelSpec, type PlsOptions } from '../engine/types';
import type { Settings } from '../model/project';
import type { GpuPrecision } from './compute';
import {
  helperGpuBootstrap,
  type GpuAccelerator,
  type GpuStatus,
  type HelperState,
} from './helper';

/** The precision an accelerator must list for a request's precision (auto: any). */
const WANTED: Record<GpuPrecision, string | null> = {
  auto: null,
  single: 'float32',
  double: 'float64',
};

/** The accelerators that compute in the precision. */
export function ableAccelerators(
  gpu: GpuStatus | undefined,
  precision: GpuPrecision,
): GpuAccelerator[] {
  const want = WANTED[precision];
  return (gpu?.accelerators ?? []).filter((a) => want === null || a.precisions.includes(want));
}

/**
 * Why this bootstrap cannot run on the GPU engine (null: it can). The worker estimates PLS and PLSc with the
 * built-in engine's options on plain indicator columns: no interaction terms, copulas, sampling weights, ordinal
 * PLS or multiple imputation (those bootstraps run in the browser, as now).
 */
export function gpuUnavailable(
  spec: ModelSpec,
  settings: Pick<Settings, 'method' | 'engine' | 'missing'>,
  kind: 'estimate' | 'boot' | 'fittest',
  helper: { state: HelperState; info: { gpu?: GpuStatus } | null },
  precision: GpuPrecision,
): string | null {
  if (kind !== 'boot') return 'only bootstrapping runs there';
  if (settings.method !== 'pls') return 'it bootstraps PLS and PLSc only';
  if (settings.engine !== 'builtin')
    return 'it bootstraps for the built-in engine (Calculated by: Built-in)';
  if (spec.moderations?.length || spec.threeWay?.length) return 'the model has interaction terms';
  if (spec.copulas?.length) return 'the model has Gaussian copula terms';
  if (spec.weights) return 'the model has sampling weights';
  if (spec.ordered?.length) return 'the model has ordinal indicators';
  if (spec.constructs.some((c) => c.components?.length))
    return 'the model has higher-order constructs';
  if (LAVAAN_MISSING.includes(settings.missing) || settings.missing === 'mi')
    return 'its missing-value treatment is mean replacement or casewise deletion';
  if (helper.state !== 'ready') return 'the helper is not connected';
  // The helper store's shape (rengine/helper.ts useHelper): the gpu entry lives under info.
  const gpu = helper.info?.gpu;
  if (!gpu) return 'the helper is too old to have a GPU worker';
  if (gpu.starting) return 'the GPU worker is still starting';
  if (gpu.accelerators.length === 0)
    return gpu.error
      ? `the helper has no GPU worker (${gpu.error})`
      : 'the helper has no GPU worker';
  if (ableAccelerators(gpu, precision).length === 0)
    return `no accelerator computes in ${precision} precision (an Apple GPU computes in single precision only)`;
  return null;
}

/** The worker's request for one range (gpusrc/worker.py bootstrap): columns, compiled model and options. */
export interface GpuRequest {
  cols: number[][];
  model: CompiledModel;
  options: Pick<PlsOptions, 'scheme' | 'maxIter' | 'tolerance' | 'consistent'> & {
    absRhoA?: boolean;
  };
  seed: number;
  start: number;
  end: number;
  precision: GpuPrecision;
  keepInadmissible?: boolean;
  jackknife?: boolean;
  innerSamples?: number;
}

/**
 * What every range shares: the indicator columns after the missing-value treatment (as preparePls draws them)
 * and the compiled model, categorical exogenous constructs expanded into their dummy composites.
 */
export function gpuModel(data: Dataset, spec0: ModelSpec, options: PlsOptions) {
  const { data: d, spec } = expandCategorical(data, spec0);
  const model = compileModel({ constructs: spec.constructs, paths: spec.paths });
  const { cols, dropped } = extractColumns(d, model, options.missing);
  return { model, cols: cols.map((c) => Array.from(c)), dropped };
}

export interface GpuBootstrapPlan {
  ranges: [number, number][];
  request: (start: number, end: number, first: boolean) => GpuRequest;
}

/** One range per accelerator (results do not depend on the split); the first range also runs the jackknife for BCa. */
export function gpuPlan(
  data: Dataset,
  spec: ModelSpec,
  options: PlsOptions,
  boot: {
    samples: number;
    seed: number;
    interval: Settings['bootInterval'];
    inadmissible: Settings['bootInadmissible'];
  },
  accelerators: number,
  precision: GpuPrecision,
): GpuBootstrapPlan {
  const { model, cols } = gpuModel(data, spec, options);
  const keep = boot.inadmissible === 'keep';
  const shared = {
    cols,
    model,
    options: {
      scheme: options.scheme,
      maxIter: options.maxIter,
      tolerance: options.tolerance,
      consistent: options.consistent,
      ...(keep ? { absRhoA: true } : {}),
    },
    seed: boot.seed,
    precision,
    ...(keep ? { keepInadmissible: true } : {}),
    ...(boot.interval === 'studentized' ? { innerSamples: STUDENTIZED_INNER } : {}),
  };
  return {
    ranges: splitRanges(boot.samples, Math.max(1, accelerators)),
    request: (start, end, first) => ({
      ...shared,
      start,
      end,
      ...(first && boot.interval === 'bca' ? { jackknife: true } : {}),
    }),
  };
}

const column = (v: unknown): Float64Array =>
  Float64Array.from(Array.isArray(v) ? v : [], (x) => (typeof x === 'number' ? x : NaN));

/** The worker's answer as the native engine's RangePart (null → NaN). */
export function gpuPart(raw: Record<string, unknown>): RangePart & { precision: string } {
  const params = Array.isArray(raw.params) ? (raw.params as RangePart['params']) : [];
  const draws = Array.isArray(raw.draws) ? raw.draws.map(column) : [];
  if (params.length === 0 || draws.length !== params.length)
    throw new Error('The GPU worker answered without the bootstrap draws.');
  return {
    start: Number(raw.start ?? 0),
    params: params.map((p) => ({ key: String(p.key), group: p.group, label: String(p.label) })),
    originals: Array.from(column(raw.originals)),
    draws,
    ...(Array.isArray(raw.jack) ? { jack: raw.jack.map(column) } : {}),
    ...(Array.isArray(raw.studentized) ? { studentized: raw.studentized.map(column) } : {}),
    precision: String(raw.precision ?? ''),
  };
}

export interface GpuBootstrapResult {
  parts: RangePart[];
  /** The precision the worker computed in ("float32" or "float64"). */
  precision: string;
}

/** Run the plan's ranges on the helper's accelerators at once. `onDone(ranges finished)` reports progress. */
export async function gpuBootstrap(
  plan: GpuBootstrapPlan,
  onDone?: (finished: number, total: number) => void,
  post: (req: GpuRequest) => Promise<Record<string, unknown>> = helperGpuBootstrap,
): Promise<GpuBootstrapResult> {
  let finished = 0;
  const parts = await Promise.all(
    plan.ranges.map(async ([start, end], i) => {
      const part = gpuPart(await post(plan.request(start, end, i === 0)));
      finished++;
      onDone?.(finished, plan.ranges.length);
      return part;
    }),
  );
  return { parts, precision: parts[0]?.precision ?? '' };
}

/** How the results name the engine: shown with the bootstrap ("Resampling by …"). */
export function gpuEngineTag(accelerator: GpuAccelerator | undefined, precision: string) {
  const device = accelerator ? accelerator.name : 'accelerator';
  const bits = precision === 'float64' ? 'double' : precision === 'float32' ? 'single' : precision;
  return { package: 'the GPU engine', version: `(${device}, ${bits} precision)` };
}
