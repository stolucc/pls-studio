import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerChoices } from '../components/ComputeSettings';
import { bootChunks, CHUNK_SAMPLES, clampWorkers } from './compute';
import { parallelMap } from './runtime';

describe('bootChunks', () => {
  it('splits the samples into fixed chunks with consecutive seeds', () => {
    expect(bootChunks(250, 11)).toEqual({ R: [100, 100, 50], seed: [11, 12, 13] });
    expect(bootChunks(100, 1)).toEqual({ R: [100], seed: [1] });
    expect(bootChunks(5000, 7).R).toHaveLength(5000 / CHUNK_SAMPLES);
    expect(bootChunks(5000, 7).R.reduce((a, b) => a + b, 0)).toBe(5000);
  });
  it('keeps seeds within set.seed range', () => {
    expect(bootChunks(200, 2147483646).seed).toEqual([2147483646, 0]);
  });
});

describe('compute preferences', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('clamps the number of workers', () => {
    expect(clampWorkers(0)).toBe(1);
    expect(clampWorkers(3.4)).toBe(3);
    expect(clampWorkers(99)).toBe(8);
    expect(clampWorkers(NaN)).toBe(1);
  });
  it('offers the choices the computer has cores for', () => {
    expect(workerChoices(1)).toEqual([1]);
    expect(workerChoices(4)).toEqual([1, 2, 4]);
    expect(workerChoices(32)).toEqual([1, 2, 4, 6, 8]);
  });
  it('remembers the choice in this browser and ignores bad stored values', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const { useCompute } = await import('./compute');
    expect(useCompute.getState().workers).toBe(1);
    useCompute.getState().set({ workers: 4 });
    expect(JSON.parse(store.get('pls-studio.compute')!)).toEqual({ backend: 'browser', workers: 4 });
    vi.resetModules();
    expect((await import('./compute')).useCompute.getState().workers).toBe(4);
    store.set('pls-studio.compute', '{"workers":"lots","backend":"server"}');
    vi.resetModules();
    const s = (await import('./compute')).useCompute.getState();
    expect([s.workers, s.backend]).toEqual([1, 'browser']);
  });
});

describe('parallelMap', () => {
  it('keeps the order of the items and uses at most `workers` lanes at once', async () => {
    let running = 0, peak = 0;
    const lanes = new Set<number>();
    const out = await parallelMap([5, 1, 4, 2, 3], 2, async (x, lane) => {
      lanes.add(lane); running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, x));
      running--;
      return x * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    expect([...lanes].sort()).toEqual([0, 1]);
  });
  it('rejects on the first failure and starts no further items', async () => {
    const started: number[] = [];
    await expect(parallelMap([1, 2, 3, 4], 1, async (x) => { started.push(x); if (x === 2) throw new Error('boom'); return x; })).rejects.toThrow('boom');
    expect(started).toEqual([1, 2]);
  });
  it('reports progress', async () => {
    const seen: number[] = [];
    await parallelMap([1, 2, 3], 3, async (x) => x, (d) => seen.push(d));
    expect(seen).toEqual([1, 2, 3]);
  });
});
