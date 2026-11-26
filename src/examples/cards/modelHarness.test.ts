// The session pool the Monte Carlo card tests run their chunks on (modelHarness.ts growingMap): it starts small, takes a
// session more when cores are free, keeps each lane on its own session and returns the results in order.
import { describe, expect, it } from 'vitest';
import { growingMap } from './modelHarness';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('growingMap', () => {
  it('starts on `start` sessions and grows to `max` while cores are free, results in order', async () => {
    const used = new Set<number>();
    let running = 0,
      peak = 0;
    const out = await growingMap(
      Array.from({ length: 20 }, (_, i) => i),
      async (i, session) => {
        used.add(session);
        peak = Math.max(peak, ++running);
        await tick();
        running--;
        return i * 2;
      },
      { start: 2, max: 5 },
      () => 8,
    );
    expect(out).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(5);
  });

  it('stays at `start` when the machine is busy', async () => {
    const used = new Set<number>();
    await growingMap(
      Array.from({ length: 10 }, (_, i) => i),
      async (_i, session) => {
        used.add(session);
        await tick();
      },
      { start: 2, max: 6 },
      () => 1,
    );
    expect([...used].sort()).toEqual([0, 1]);
  });

  it('rejects on the first failure and starts nothing more', async () => {
    let started = 0;
    await expect(
      growingMap(
        Array.from({ length: 10 }, (_, i) => i),
        async (i) => {
          started++;
          await tick();
          if (i === 1) throw new Error('chunk failed');
        },
        { start: 2, max: 2 },
        () => 0,
      ),
    ).rejects.toThrow('chunk failed');
    expect(started).toBeLessThan(5);
  });
});
