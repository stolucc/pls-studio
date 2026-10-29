import { describe, expect, it } from 'vitest';
import { cancelGroup, Cancelled, isCancelled } from './cancellable';

const later = <T,>(v: T) => { let resolve!: (x: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, done: () => resolve(v) }; };

describe('cancelGroup (Cancel button of panel analyses)', () => {
  it('passes results and errors through when not cancelled', async () => {
    const g = cancelGroup();
    await expect(g.guard(Promise.resolve(42))).resolves.toBe(42);
    await expect(g.guard(Promise.reject(new Error('R error')))).rejects.toThrow('R error');
    expect(g.pending()).toBe(0);
  });

  it('rejects every pending call with Cancelled, so the result is never applied', async () => {
    const g = cancelGroup();
    const a = later('result a'), b = later('result b');
    let applied: string | null = null;
    const run = (async () => { applied = await g.guard(a.p); })();
    const other = g.guard(b.p);
    expect(g.pending()).toBe(2);
    expect(g.cancel()).toBe(2);
    await expect(run).rejects.toBeInstanceOf(Cancelled);
    await expect(other).rejects.toSatisfy(isCancelled);
    a.done(); b.done();  // R delivers afterwards: ignored
    await Promise.resolve();
    expect(applied).toBeNull();
    expect(g.pending()).toBe(0);
  });

  it('keeps working after a cancel (a new run is guarded afresh)', async () => {
    const g = cancelGroup();
    const a = later(1);
    const first = g.guard(a.p);
    g.cancel();
    await expect(first).rejects.toBeInstanceOf(Cancelled);
    await expect(g.guard(Promise.resolve(2))).resolves.toBe(2);
    expect(g.cancel()).toBe(0);
  });

  it('tells a cancel from an R error', () => {
    expect(isCancelled(new Cancelled())).toBe(true);
    expect(isCancelled(new Error('Cancelled.'))).toBe(false);
  });
});
