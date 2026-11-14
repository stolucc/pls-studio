// Re-estimating the model without one indicator at a time, through the same estimation path
// as the Model tab's Calculate: the R package chosen (cSEM or seminr) or the built-in engine,
// with the current settings. One run per candidate, on demand, cancellable.

import type { Dataset, ModelSpec, PlsOptions, PlsResult } from '../engine/types';
import { toSpec, type ModelState, type Settings } from '../model/project';
import { withoutIndicator, type TriageItem } from './loadings';
import type { QualitySnapshot } from './state';

/** Estimates a model (one PLS run). */
export type Estimator = (spec: ModelSpec) => Promise<PlsResult>;

/** The PLS options of the Model tab's settings (as runner.ts builds them). */
export function plsOptionsOf(settings: Settings): PlsOptions {
  return {
    scheme: settings.scheme,
    maxIter: settings.maxIter,
    tolerance: 10 ** -settings.stopExp,
    missing: settings.missing,
    consistent: settings.consistent,
    approach: settings.plsApproach,
    hocApproach: settings.hocApproach,
    mi: { m: settings.miImputations, seed: settings.seed },
  };
}

/**
 * Whether Calculate estimates this model in R: the R engine is chosen and the model has no term
 * only the built-in engine estimates (copulas, three-way interactions, sampling weights,
 * pre-defined weights; runner.ts).
 */
export function usesR(spec: ModelSpec, settings: Settings): boolean {
  const builtInTerms = !!(
    spec.copulas?.length ||
    spec.threeWay?.length ||
    spec.weights ||
    spec.constructs.some((c) => c.predefinedWeights)
  );
  return settings.engine === 'r' && !builtInTerms;
}

/** The construct's AVE, ρA and ρC in a result, or null when it is not there. */
export function qualityOf(pls: PlsResult, construct: string): QualitySnapshot | null {
  const j = pls.constructs.indexOf(construct);
  if (j < 0) return null;
  const q = pls.quality[j];
  return { ave: q.ave, rhoA: q.rhoA, rhoC: q.rhoC };
}

/** The outcome of one re-estimation. */
export interface RemovalRun {
  constructId: string;
  indicator: string;
  after: QualitySnapshot | null;
  error?: string;
}

export const removalKey = (x: { constructId: string; indicator: string }) =>
  `${x.constructId}\u0000${x.indicator}`;

/**
 * Re-estimate the model once per item, each time without that item. `progress(done, total)`
 * after each run; `stopped()` is checked between runs (the caller also interrupts the run in
 * progress). A run that fails is reported with its message; the others go on.
 */
export async function reestimateRemovals(
  model: ModelState,
  items: TriageItem[],
  estimate: Estimator,
  progress: (done: number, total: number) => void = () => {},
  stopped: () => boolean = () => false,
): Promise<RemovalRun[]> {
  const out: RemovalRun[] = [];
  progress(0, items.length);
  for (const item of items) {
    if (stopped()) break;
    const spec = toSpec(withoutIndicator(model, item.constructId, item.indicator));
    try {
      const pls = await estimate(spec);
      out.push({
        constructId: item.constructId,
        indicator: item.indicator,
        after: qualityOf(pls, item.construct),
      });
    } catch (e) {
      if (stopped()) break;
      out.push({
        constructId: item.constructId,
        indicator: item.indicator,
        after: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    progress(out.length, items.length);
  }
  return out;
}

/** An estimator with a way to stop the run in progress. */
export interface CancellableEstimator {
  estimate: Estimator;
  cancel: () => void;
  /** 'cSEM', 'seminr' or 'built-in engine', for the progress label. */
  by: string;
}

/**
 * The estimator Calculate would use for these settings: the R package (rCall, so desktop R when
 * the helper runs, webR otherwise) or the built-in engine in a worker.
 */
export function configuredEstimator(
  data: Dataset,
  settings: Settings,
  spec: ModelSpec,
): CancellableEstimator {
  const options = plsOptionsOf(settings);
  if (usesR(spec, settings)) {
    return {
      by: settings.plsPackage,
      estimate: async (s) => {
        const { estimatePlsR } = await import('../rengine/pls');
        return estimatePlsR(data, s, options, settings.plsPackage);
      },
      cancel: () => {
        void import('../rengine/runtime').then((m) => m.interruptR());
      },
    };
  }
  let worker: Worker | null = null;
  let reject: ((e: Error) => void) | null = null;
  return {
    by: 'built-in engine',
    estimate: (s) =>
      new Promise<PlsResult>((resolve, fail) => {
        worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
        reject = fail;
        const done = () => {
          worker?.terminate();
          worker = null;
          reject = null;
        };
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data as { kind: string; result?: PlsResult; message?: string };
          if (msg.kind === 'progress') return;
          done();
          if (msg.kind === 'pls' && msg.result) resolve(msg.result);
          else fail(new Error(msg.message ?? 'The estimation failed.'));
        };
        worker.onerror = (e) => {
          done();
          fail(new Error(e.message));
        };
        worker.postMessage({ kind: 'pls', data, spec: s, options });
      }),
    cancel: () => {
      worker?.terminate();
      worker = null;
      reject?.(new Error('Cancelled.'));
      reject = null;
    },
  };
}
