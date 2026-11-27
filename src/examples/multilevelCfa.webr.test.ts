// Multilevel CFA and what its between-level factors mean (packages.ts: lavaan-twolevel-cfa-configural, -invariant,
// -partial): lavaan's Demo.twolevel with loadings free at each level, equal across the levels (cross-level
// invariance, Jak 2019), and equal except y6's, each opened as the app opens it (two-level lavaan syntax) and compared
// with desktop lavaan; the χ² differences between the three come from the app's own fits. Run with npm run test:webr.

import { afterAll, beforeAll, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example, near, same } from '../validation/record';
import { load } from './cards/modelHarness';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function fit(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  example(id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan'], definition: ex });
  const data = await load(ex);
  const settings = exampleSettings(DEFAULT_SETTINGS, ex.settings);
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), settings.missing, 'ML');
  const [within, between] = r.groups!.results;
  const est = (g: typeof within, lhs: string, op: string, rhs: string) =>
    g.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!.est;
  return { r, within, between, est };
}

const DESKTOP = {
  label: 'desktop lavaan 0.7-3, sem(model, data = Demo.twolevel, cluster = "cluster")',
  level: 'native' as const,
};

it('two-level CFA: configural, cross-level invariant and partially invariant loadings, and the factor ICCs', async () => {
  const conf = await fit('lavaan-twolevel-cfa-configural');
  against(DESKTOP);
  near('χ²', conf.r.fit.chisq, 12.629, 0.001);
  same('df', conf.r.fit.df, 16);
  near('within: fw2 =~ y6', conf.est(conf.within, 'fw2', '=~', 'y6'), 0.497, 0.0005);
  near('between: fb2 =~ y6', conf.est(conf.between, 'fb2', '=~', 'y6'), 0.768, 0.0005);

  const inv = await fit('lavaan-twolevel-cfa-invariant');
  against(DESKTOP);
  near('χ²', inv.r.fit.chisq, 26.194, 0.001);
  same('df', inv.r.fit.df, 20);
  for (const [lhsW, lhsB, rhs] of [
    ['fw1', 'fb1', 'y2'],
    ['fw2', 'fb2', 'y6'],
  ])
    near(
      `${rhs}: the same loading at both levels`,
      inv.est(inv.within, lhsW, '=~', rhs),
      inv.est(inv.between, lhsB, '=~', rhs),
      1e-9,
    );
  near('Δχ² against the configural model', inv.r.fit.chisq - conf.r.fit.chisq, 13.566, 0.001);

  const part = await fit('lavaan-twolevel-cfa-partial');
  against(DESKTOP);
  near('χ²', part.r.fit.chisq, 16.919, 0.001);
  same('df', part.r.fit.df, 19);
  near('Δχ² against the configural model', part.r.fit.chisq - conf.r.fit.chisq, 4.29, 0.001);
  const v = (g: typeof part.within, f: string) => part.est(g, f, '~~', f);
  near('between variance of fb1', v(part.between, 'fb1'), 0.828, 0.0005);
  near('within variance of fw1', v(part.within, 'fw1'), 1.103, 0.0005);
  near(
    'factor ICC of the first factor',
    v(part.between, 'fb1') / (v(part.between, 'fb1') + v(part.within, 'fw1')),
    0.4289,
    0.0005,
  );
  near(
    'factor ICC of the second factor',
    v(part.between, 'fb2') / (v(part.between, 'fb2') + v(part.within, 'fw2')),
    0.794,
    0.0005,
  );
}, 900_000);
