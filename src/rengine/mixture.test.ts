import { describe, expect, it, vi } from 'vitest';

const calls: { fn: string; reqs: unknown[] }[] = [];
vi.mock('./bridge', () => ({
  parallelism: async () => ({ where: 'browser', sessions: 3 }),
  rCallParallel: async (
    fn: string,
    reqs: { spec: { phase: { only?: number[]; stage?: { i: number }[] } } }[],
  ) => {
    calls.push({ fn, reqs });
    // stage: minus log-likelihood of start i is |i − 4| (start 4 best); continuation: the start, converged
    return reqs.map((r) =>
      r.spec.phase.only
        ? { stage: r.spec.phase.only.map((i) => ({ i, par: [i], value: Math.abs(i - 4) })) }
        : { finals: r.spec.phase.stage!.map((s) => ({ ...s, value: 0, convergence: 0 })) },
    );
  },
  rCall: async (fn: string, req: unknown) => {
    calls.push({ fn, reqs: [req] });
    return { params: [], classes: [], patterns: [], lls: [0], theta: [1], warnings: [] };
  },
  rScript: async () => '',
  rStrings: (v: unknown) => (Array.isArray(v) ? v : []),
}));

describe('mixture random starts over several R sessions', () => {
  it('runs the short runs in chunks, continues the best `final` one per session and finishes from them in one call', async () => {
    const { mixtureR } = await import('./mixture');
    const spec = {
      columns: ['y'],
      theta: [],
      slots: [],
      classes: [],
      loglinear: false,
      blocks: [],
      report: [],
      starts: 7,
      final: 2,
      seed: 1,
    };
    await mixtureR({ names: ['y'], cols: [Float64Array.from([1, 2])] } as never, spec);
    const [stage, cont, last] = calls;
    // (round robin: the same starts whatever the number of sessions, each seeded as in one session)
    expect(
      stage.reqs.map((r) => (r as { spec: { phase: { only: number[] } } }).spec.phase.only),
    ).toEqual([
      [1, 4, 7],
      [2, 5],
      [3, 6],
    ]);
    // the two best short runs (starts 4, then 3 and 5 tied: the lower index first) continued
    expect(
      cont.reqs.map(
        (r) => (r as { spec: { phase: { stage: { i: number }[] } } }).spec.phase.stage[0].i,
      ),
    ).toEqual([4, 3]);
    expect(
      (last.reqs[0] as { spec: { phase: { finals: { i: number }[] } } }).spec.phase.finals.map(
        (f) => f.i,
      ),
    ).toEqual([4, 3]);
  });
});
