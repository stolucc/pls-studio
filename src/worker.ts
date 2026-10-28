/// <reference lib="webworker" />
import { runRange, type RangePart, type RangeRequest } from './engine/bootstrap';
import { estimateCb, type CbEstimator, type CbResult } from './engine/cbsem';
import { runMcTask, type McPart, type McTask } from './engine/montecarlo';
import { estimateMiiv, type MiivResult } from './engine/miiv';
import { estimatePls } from './engine/pls';
import type { Dataset, ModelSpec, PlsOptions, PlsResult } from './engine/types';

export type WorkerRequest =
  | { kind: 'pls'; data: Dataset; spec: ModelSpec; options: PlsOptions }
  | { kind: 'cb'; data: Dataset; spec: ModelSpec; options: PlsOptions; estimator: CbEstimator }
  | { kind: 'miiv'; data: Dataset; spec: ModelSpec; options: PlsOptions }
  | { kind: 'range'; range: RangeRequest }
  | { kind: 'mc'; task: McTask };

export type WorkerResponse =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'pls'; result: PlsResult }
  | { kind: 'cb'; result: CbResult }
  | { kind: 'miiv'; result: MiivResult }
  | { kind: 'range'; part: RangePart }
  | { kind: 'mc'; part: McPart }
  | { kind: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.kind) {
      case 'pls': post({ kind: 'pls', result: estimatePls(req.data, req.spec, req.options) }); break;
      case 'cb': post({ kind: 'cb', result: estimateCb(req.data, req.spec, req.options.missing, req.estimator) }); break;
      case 'miiv': post({ kind: 'miiv', result: estimateMiiv(req.data, req.spec, req.options.missing) }); break;
      case 'mc': {
        const part = runMcTask(req.task, (done, total) => post({ kind: 'progress', done, total }));
        const buffers = [part.est, part.lo, part.hi, part.sig].flatMap((g) => g.flatMap((e) => e.map((a) => a.buffer))).concat(part.proper.map((a) => a.buffer));
        post({ kind: 'mc', part }, buffers);
        break;
      }
      case 'range': {
        const part = runRange(req.range, { onProgress: (done, total) => post({ kind: 'progress', done, total }) });
        post({ kind: 'range', part }, part.draws.map((d) => d.buffer));
        break;
      }
    }
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
