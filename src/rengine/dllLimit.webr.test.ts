// R in the browser loads at most ~100 compiled libraries per session and cannot raise that (R_MAX_NUM_DLLS stops
// WebAssembly R from starting). A session that has run many analyses must still load the next one's packages:
// the runtime then starts a fresh session (runtime.ts), instead of reporting a failed download.
import { afterAll, beforeAll, expect } from 'vitest';
import { DESKTOP_ONLY, R_PACKAGES, type RPackage } from './bridge';
import { withR } from './runtime';
import { slowIt } from './webrSlow';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt('loads the next analysis’s packages after the session has passed R’s limit of compiled libraries', async () => {
  const groups = (Object.keys(R_PACKAGES) as RPackage[]).filter((k) => !DESKTOP_ONLY.has(k)).map((k) => [...R_PACKAGES[k]]);
  let restarted = false, before = 0, after = 0;
  for (const pkgs of groups) {
    const loaded = await withR(pkgs, {}, (webR) => webR.evalRNumber('length(getLoadedDLLs())'));
    for (const p of pkgs) expect(await withR([], {}, (webR) => webR.evalRBoolean(`isNamespaceLoaded("${p}")`)), p).toBe(true);
    if (loaded < before) restarted = true;  // (fewer libraries loaded than after the previous analysis: a fresh session)
    before = loaded;
    if (restarted && ++after >= 3) break;
  }
  expect(restarted, 'a fresh session was started once the limit was reached').toBe(true);
}, 3_600_000);
