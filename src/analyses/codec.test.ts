import { describe, expect, it } from 'vitest';
import { fingerprint, packResult, unpackResult } from './codec';

describe('stored results', () => {
  it('round-trip, typed arrays and non-finite numbers included', async () => {
    const value = {
      y: 'perf',
      cols: [Float64Array.from([1, NaN, Infinity, -Infinity, 2.5])],
      p: null,
      n: NaN,
      nested: [{ k: 'a', v: -Infinity }],
    };
    const packed = await packResult(value);
    expect(packed).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const back = (await unpackResult(packed!)) as typeof value;
    expect(back.y).toBe('perf');
    expect(back.cols[0]).toBeInstanceOf(Float64Array);
    expect([...back.cols[0]]).toEqual([1, NaN, Infinity, -Infinity, 2.5]);
    expect(back.p).toBeNull();
    expect(back.n).toBeNaN();
    expect(back.nested[0].v).toBe(-Infinity);
  });

  it('are compressed', async () => {
    const big = {
      rows: Array.from({ length: 5000 }, (_, i) => ({ name: `item${i % 10}`, value: i % 7 })),
    };
    const packed = (await packResult(big))!;
    expect(packed.length).toBeLessThan(JSON.stringify(big).length / 5);
  });

  it('reject malformed text and oversized output (decompression bombs)', async () => {
    await expect(unpackResult('not base64!')).rejects.toThrow('Invalid stored result');
    await expect(unpackResult(btoa('plain text, not gzip'))).rejects.toThrow();
    const bomb = (await packResult({ zeros: '0'.repeat(100_000) }))!;
    await expect(unpackResult(bomb, 10_000)).rejects.toThrow('too large');
    await expect(unpackResult(bomb)).resolves.toBeTruthy();
  });
});

describe('input fingerprints', () => {
  it('follow the values of the columns, not their identity', () => {
    const a = Float64Array.from([1, 2, 3]);
    expect(fingerprint(['data', 'x', a])).toBe(
      fingerprint(['data', 'x', Float64Array.from([1, 2, 3])]),
    );
    expect(fingerprint(['data', 'x', a])).not.toBe(
      fingerprint(['data', 'x', Float64Array.from([1, 2, 4])]),
    );
    expect(fingerprint(['data', 'x', a])).not.toBe(fingerprint(['data', 'y', a]));
    expect(fingerprint(['data', 'x', Float64Array.from([1, NaN])])).not.toBe(
      fingerprint(['data', 'x', Float64Array.from([1, 0])]),
    );
    expect(fingerprint(['a', null])).not.toBe(fingerprint(['a', 'null']));
  });
});
