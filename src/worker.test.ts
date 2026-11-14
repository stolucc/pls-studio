// The calculation worker (worker.ts) on its own: each request answered with its result, progress during a
// bootstrap range with the draws' buffers transferred, and an error as a message rather than a dead worker.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { toSpec } from './model/project';
import { makeSample } from './sample';
import type { WorkerRequest, WorkerResponse } from './worker';

const posted: { message: WorkerResponse; transfer: Transferable[] }[] = [];
const scope: { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null } & Record<
  string,
  unknown
> = {
  onmessage: null,
  postMessage: (message: WorkerResponse, transfer: Transferable[] = []) =>
    posted.push({ message, transfer }),
};

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('./worker');
  vi.unstubAllGlobals();
});

const send = (req: WorkerRequest) => {
  posted.length = 0;
  scope.onmessage!({ data: req } as MessageEvent<WorkerRequest>);
  return posted.map((p) => p.message);
};

const { data, model } = makeSample(120);
const spec = toSpec(model);
const options = {
  scheme: 'path' as const,
  maxIter: 300,
  tolerance: 1e-7,
  missing: 'mean' as const,
  consistent: false,
};

describe('the calculation worker', () => {
  it('answers a PLS request with the estimates', () => {
    const out = send({ kind: 'pls', data, spec, options });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('pls');
    const r = (out[0] as Extract<WorkerResponse, { kind: 'pls' }>).result;
    expect(r.converged).toBe(true);
    expect(r.n).toBe(120);
    expect(r.constructs).toEqual(model.constructs.map((c) => c.name));
  });

  it('runs a bootstrap range: progress per sample, then the part, its draws transferred', () => {
    const out = send({
      kind: 'range',
      range: { job: 'pls', data, spec, options, seed: 7, start: 3, end: 6 },
    });
    const progress = out.filter((m) => m.kind === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toEqual({ kind: 'progress', done: 3, total: 3 });
    const last = posted.at(-1)!;
    expect(last.message.kind).toBe('range');
    const part = (last.message as Extract<WorkerResponse, { kind: 'range' }>).part;
    expect(part.start).toBe(3);
    expect(part.draws.every((d) => d.length === 3)).toBe(true);
    expect(last.transfer).toEqual(part.draws.map((d) => d.buffer));
    // The same range again: the same draws (the samples' seeds come from their indices).
    const again = send({
      kind: 'range',
      range: { job: 'pls', data, spec, options, seed: 7, start: 3, end: 6 },
    });
    const part2 = (again.at(-1) as Extract<WorkerResponse, { kind: 'range' }>).part;
    expect(part2.draws).toEqual(part.draws);
  });

  it('reports a failure as an error message', () => {
    const out = send({
      kind: 'pls',
      data: { names: [], cols: [] },
      spec,
      options,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('error');
    expect((out[0] as Extract<WorkerResponse, { kind: 'error' }>).message.length).toBeGreaterThan(
      0,
    );
  });
});
