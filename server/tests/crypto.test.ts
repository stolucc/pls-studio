import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptDataset, encryptDataset } from '../src/crypto.ts';

/** A few MB of dataset-like JSON (numbers do not compress to nothing). */
function bigDataset(rows: number): string {
  const values = Array.from({ length: rows }, () => Math.random().toFixed(6));
  return JSON.stringify({ names: ['x'], columns: [values] });
}

describe('dataset encryption', () => {
  it('round-trips and binds the ciphertext to its project', async () => {
    const master = randomBytes(32);
    const json = bigDataset(1000);
    const sealed = await encryptDataset(master, 'p1', json);
    expect(await decryptDataset(master, 'p1', sealed.ciphertext, sealed.wrappedKey)).toBe(json);
    await expect(
      decryptDataset(master, 'p2', sealed.ciphertext, sealed.wrappedKey),
    ).rejects.toThrow();
  });

  it('compresses off the event loop: timers run while a large dataset is sealed and opened', async () => {
    const master = randomBytes(32);
    const json = bigDataset(800_000); // ~7 MB
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    try {
      const sealing = encryptDataset(master, 'p1', json);
      const before = ticks;
      const sealed = await sealing;
      expect(ticks).toBeGreaterThan(before);
      const atOpen = ticks;
      const text = await decryptDataset(master, 'p1', sealed.ciphertext, sealed.wrappedKey);
      expect(text.length).toBe(json.length);
      expect(ticks).toBeGreaterThan(atOpen);
    } finally {
      clearInterval(timer);
    }
  });
});
