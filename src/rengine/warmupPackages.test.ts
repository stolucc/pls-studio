// The background warm-up's second step (bridge.ts warmUpRPackages): after starting R it loads the packages most
// examples use (cSEM for PLS, lavaan for CB-SEM) and the bridge's R code, in the main session.

import { describe, expect, it, vi } from 'vitest';

const withR = vi.fn(async (_packages: string[], _sources: unknown, fn: () => Promise<unknown>) =>
  fn(),
);
vi.mock('./runtime', () => ({
  withR,
  withSession: vi.fn(),
  callJson: vi.fn(),
  callString: vi.fn(),
  parallelMap: vi.fn(),
}));

const { R_PACKAGES, SOURCES, WARM_UP_PACKAGES, warmUpRPackages } = await import('./bridge');

describe('warmUpRPackages', () => {
  it('loads the packages of PLS (cSEM) and CB-SEM (lavaan) and the bridge code in the main session', async () => {
    await warmUpRPackages();
    expect(withR).toHaveBeenCalledTimes(1);
    const [packages, sources] = withR.mock.calls[0];
    expect(sources).toBe(SOURCES);
    for (const p of [...R_PACKAGES.cSEM, ...R_PACKAGES.lavaan]) expect(packages).toContain(p);
    expect(new Set(packages).size).toBe(packages.length);
    expect(packages).toEqual([...WARM_UP_PACKAGES]);
  });

  it('passes a failure on to the warm-up (which reports it in the R indicator, never to the user as a throw)', async () => {
    withR.mockRejectedValueOnce(new Error('offline'));
    await expect(warmUpRPackages()).rejects.toThrow('offline');
  });
});
