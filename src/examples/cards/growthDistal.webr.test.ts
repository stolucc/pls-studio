// Growth factors predicting a distal outcome, and where time is coded zero (McCormick, Curran & Hancock 2026; cards/
// model.ts: nls-growth-distal-initial, -final): log wage of the NLS Young Women 1969–1973 predicting log wage in 1988,
// with time scores 0..4 and −4..0, each run through the growth card as the app opens it and compared with desktop
// lavaan 0.7-3 (scripts/validation/growthDistal.R, the model written as growth() syntax). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { GrowthResult } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DESKTOP = {
  label: 'scripts/validation/growthDistal.R: growth(…, missing = "ml") in desktop lavaan 0.7-3',
  level: 'native' as const,
};

async function fit(id: string) {
  const { run } = await open(id, 'Longitudinal', ['lavaan']);
  const r = await run<GrowthResult>();
  const est = (op: string, rhs: string) =>
    r.estimates.find((e) => e.lhs === 'lnwage88' && e.op === op && e.rhs === rhs)!;
  return { r, est };
}

it('time coded from the first and from the last interview: the slope’s effect on the distal outcome', async () => {
  const first = await fit('nls-growth-distal-initial');
  against(DESKTOP);
  same('women', first.r.n, 3953);
  near('χ²', first.r.fit.chisq!, 121.7472223, 1e-4);
  same('df', first.r.fit.df!, 13);
  near('intercept of lnwage88', first.est('~1', '').est, 0.7694092, 1e-5);
  near('i → lnwage88', first.est('~', 'i').est, 0.7214439, 1e-5);
  near('SE of i → lnwage88', first.est('~', 'i').se!, 0.0470394, 1e-5);
  near('s → lnwage88', first.est('~', 's').est, 2.0895408, 1e-5);
  near('SE of s → lnwage88', first.est('~', 's').se!, 0.2515829, 1e-5);
  near('standardised s → lnwage88', first.est('~', 's').std, 0.3290181, 1e-5);
  near('R² of lnwage88', first.r.r2.lnwage88, 0.2034395, 1e-5);

  const last = await fit('nls-growth-distal-final');
  against(DESKTOP);
  near('χ² (the same model)', last.r.fit.chisq!, 121.7472223, 1e-4);
  near('i → lnwage88 (unchanged)', last.est('~', 'i').est, 0.7214438, 1e-5);
  near('s → lnwage88', last.est('~', 's').est, -0.7962334, 1e-5);
  near('SE of s → lnwage88', last.est('~', 's').se!, 0.3015401, 1e-5);
  near('standardised s → lnwage88', last.est('~', 's').std, -0.1253745, 1e-5);
  near(
    'slope effect at the last interview = at the first − 4 × the intercept effect',
    last.est('~', 's').est,
    first.est('~', 's').est - 4 * first.est('~', 'i').est,
    1e-4,
  );
  expect(last.r.times).toEqual([-4, -3, -2, -1, 0]);
}, 600_000);
