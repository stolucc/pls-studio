// The statistics the guided higher-order construct check derives (reporting/hoc.ts)
// against the packages run natively (scripts/validation/hoc-check.R): a reflective
// HOC's ρC and AVE from its dimensions' loadings and the standardised α of the
// dimension scores against cSEM's assess() and seminr's summary() on the two-stage
// approach's stage 2; the dimensions' VIFs against cSEM's calculateVIFModeB() and
// seminr's item VIFs; with repeated indicators, α and the VIFs against cSEM on the
// dimension scores and ρC, AVE against the by-hand computation of Sarstedt et al.
// (2019) from the native correlations.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import { DEFAULT_SETTINGS, toSpec, type ModelState, type Settings } from '../model/project';
import { rCall } from '../rengine/bridge';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { near, same } from '../validation/record';
import { hocChecks } from './hoc';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'check.json'),
    'utf8',
  ),
);

// Estimates from an iterative algorithm in webR differ from desktop R's by about 1e-6
// (WebAssembly floating point); the derived statistics are closed forms of them.
const TOL = 1e-5;

async function run(id: string, overrides: Partial<Settings> = {}, edit?: (m: ModelState) => void) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: ex.data.package, name: ex.data.name, na: [] },
    ex.data.package as 'cSEM' | 'seminr',
  );
  const data = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
  const model = exampleModel(ex);
  edit?.(model);
  const st: Settings = { ...DEFAULT_SETTINGS, ...ex.settings, ...overrides };
  const pls = await estimatePlsR(
    data,
    toSpec(model),
    {
      scheme: st.scheme,
      consistent: st.consistent,
      missing: st.missing,
      tolerance: 10 ** -st.stopExp,
      maxIter: st.maxIter,
      hocApproach: st.hocApproach,
    },
    st.plsPackage,
  );
  const [check] = hocChecks({
    model,
    pls,
    boot: null,
    approach: st.hocApproach,
    plsPackage: st.plsPackage,
  });
  return { pls, check };
}

it('cSEM two-stage: the HOC’s ρC, AVE and α from its dimensions equal cSEM’s stage 2 assess()', async () => {
  const { pls, check } = await run('csem-2ndorder');
  same('HOC type', check.type.label, 'formative–reflective');
  const j = pls.constructs.indexOf('c4');
  near('ρC of c4 from the LOC loadings', check.derived.rhoC!, ref.csemTwoStage.rhoC, TOL);
  near('AVE of c4 from the LOC loadings', check.derived.ave!, ref.csemTwoStage.ave, TOL);
  near('standardised α of the LOC scores', check.derived.alpha!, ref.csemTwoStage.alpha, TOL);
  // (and the same as the package's own values in this run, which the check displays)
  expect(check.derived.rhoC!).toBeCloseTo(pls.quality[j].rhoC, 10);
  expect(check.derived.ave!).toBeCloseTo(pls.quality[j].ave, 10);
}, 600_000);

it('seminr two-stage: ρC, AVE and α from the dimensions equal seminr’s summary() reliability', async () => {
  const { check } = await run('seminr-hoc');
  same('HOC type', check.type.label, 'reflective–reflective');
  near(
    'ρC of Satisfaction from the LOC loadings',
    check.derived.rhoC!,
    ref.seminrTwoStage.rhoC,
    TOL,
  );
  near(
    'AVE of Satisfaction from the LOC loadings',
    check.derived.ave!,
    ref.seminrTwoStage.ave,
    TOL,
  );
  near('standardised α of the LOC scores', check.derived.alpha!, ref.seminrTwoStage.alpha, TOL);
}, 600_000);

it('seminr two-stage, Mode B HOC: the dimensions’ VIFs equal seminr’s item VIFs of stage 2', async () => {
  const { check } = await run('seminr-hoc', {}, (m) => {
    const s = m.constructs.find((k) => k.name === 'Satisfaction')!;
    s.mode = 'B';
  });
  same('HOC type', check.type.label, 'reflective–formative');
  for (const k of ['Image', 'Value'])
    near(`VIF of ${k}`, check.derived.vif[k], ref.seminrTwoStage.vifModeB[k], TOL);
  expect(check.lines.map((l) => l.id)).toContain('hoc-vif');
}, 600_000);

it('cSEM two-stage, composite of common factors: the dimensions’ VIFs equal calculateVIFModeB()', async () => {
  const { check } = await run('csem-yoo');
  same('HOC type', check.type.label, 'reflective–formative');
  for (const k of ['QL', 'LO', 'AA'])
    near(`VIF of ${k}`, check.derived.vif[k], ref.csemYoo.vif[k], TOL);
}, 600_000);

it('cSEM repeated indicators: ρC and AVE from the dimension–HOC correlations, α and VIFs on the dimension scores', async () => {
  const { pls, check } = await run('csem-2ndorder-repeated');
  const want = ref.csemRepeated;
  const j = pls.constructs.indexOf('c4');
  for (const k of ['c1', 'c2', 'c3']) {
    const h = pls.higherOrder!.find((x) => x.construct === j && pls.constructs[x.component] === k)!;
    near(`loading of ${k} on c4 (score correlation)`, h.loading, want.loadings[k], TOL);
    near(`VIF of ${k} (cSEM on the LOC scores)`, check.derived.vif[k], want.vif[k], TOL);
    near(`VIF of ${k} (lm on the LOC scores)`, check.derived.vif[k], want.vifByLm[k], TOL);
  }
  near('ρC of c4 from the LOC loadings', check.derived.rhoC!, want.rhoC, TOL);
  near('AVE of c4 from the LOC loadings', check.derived.ave!, want.ave, TOL);
  near(
    'standardised α of the LOC scores (cSEM calculateRhoT)',
    check.derived.alpha!,
    want.alpha,
    TOL,
  );
  // The check uses these, not the Reliability tab's values on the repeated items.
  const rel = check.lines.find((l) => l.id === 'hoc-reliability')!;
  expect(rel.computed).toBe(true);
  expect(rel.value).toContain(`ρC ${want.rhoC.toFixed(2)}`);
  expect(check.ignore.map((i) => i.what).join(' ')).toContain('Reliability tab');
}, 600_000);
