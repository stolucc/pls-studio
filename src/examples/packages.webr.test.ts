// Every package example: its dataset loads from the package in webR, contains
// the columns the example uses, and the package estimates the example as
// documented. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { processInput } from '../process/input';
import { miivR } from '../rengine/analyses';
import { rCall, type RPackage } from '../rengine/bridge';
import { endoR } from '../rengine/endo';
import { matchR } from '../rengine/match';
import { rsaR } from '../rengine/rsa';
import { groupsR } from '../rengine/plsx';
import { ncaR } from '../rengine/nca';
import { categoriesOf } from '../io';
import { parseCsv } from '../engine/dataset';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateCpaR } from '../rengine/cpa';
import { irtR, lcaR } from '../rengine/items';
import { estimateCbLavaan } from '../rengine/lavaan';
import { growthR } from '../rengine/longitudinal';
import { gmmR, lmmR } from '../rengine/mixed';
import { rebusR } from '../rengine/segment';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES, panelColumns, type PackageExample } from './packages';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** Documented values the estimate must reproduce. */
const CHISQ: Record<string, number> = { 'lavaan-poldem': 40.179, 'lavaan-hs': 85.306, 'lavaan-hs-groups': 164.103 };

async function load(ex: PackageExample): Promise<Dataset & { levels?: unknown }> {
  // Data shipped with the app (packages that cannot run in the browser's R).
  if (ex.data.file) return parseCsv(readFileSync(join(__dirname, '..', '..', 'public', ex.data.file), 'utf8')).dataset;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; n: number; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), levels: raw.levels, ...categoriesOf(raw.levels) };
}

describe.each(PACKAGE_EXAMPLES.map((e) => [e.id, e] as const))('package example %s in webR', (_id, ex) => {
  it('loads its data from the package and estimates', async () => {
    const data = await load(ex);
    const st = { ...DEFAULT_SETTINGS, ...ex.settings };
    if (ex.panel) {
      const p = ex.panel;
      for (const c of panelColumns(p)) expect(data.names, `${ex.id}: ${c}`).toContain(c);
      if (p.kind === 'endo') {
        const { kind: _k, ...pre } = p;
        const r = await endoR(data, { method: 'iv', outcome: '', exogenous: [], endogenous: [], instruments: [], hetRegressors: [], hmTypes: [], selection: { outcome: '', regressors: [] },
          heckmanMethod: 'ml', boot: { samples: 50, seed: 1, confidence: 0.95 }, ...pre });
        expect(r.coefficients.length).toBeGreaterThan(0);
        if (ex.id === 'ivreg-kmenta') expect(r.coefficients.find((x) => x.term === 'P')!.est).toBeCloseTo(-0.2436, 4);  // ?ivreg
      } else if (p.kind === 'nca') {
        const r = await ncaR(data, p.x, p.y, 50);
        expect(r.conditions[0].ceFdh).toBeCloseTo(0.4155, 3);  // ?nca_analysis: Individualism, CE-FDH
      } else if (p.kind === 'rsa') {
        const { kind: _k, ...pre } = p;
        const r = await rsaR(data, { outcome: '', x: '', y: '', controls: [], estimation: 'OLS', center: 'none', midpoint: 0, confidence: 0.95, ...pre });
        expect(r.surface.find((s) => s.name === 'a1')!.est).toBeCloseTo(0.5553, 3);  // RSA: a1 on motcon
      } else if (p.kind === 'match') {
        const { kind: _k, ...pre } = p;
        const r = await matchR(data, { treatment: '', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, seed: 1, confidence: 0.95, ...pre });
        expect(r.counts[1].treated).toBe(185);
      } else if (p.kind === 'lmm') {
        const { kind: _k, ...input } = p;
        const r = await lmmR(data, input);
        expect(r.fixed.find((f) => f.term === 'Days')!.est).toBeCloseTo(10.4673, 3);  // ?lmer: fixef(fm1)
        expect(r.clusters).toBe(18);
      } else if (p.kind === 'gmm') {
        const { kind: _k, ...input } = p;
        const r = await gmmR(data, input);
        expect(r.models.map((m) => m.k)).toEqual(input.classes);
        expect(r.n).toBe(100);
      } else if (p.kind === 'growth') {
        const r = await growthR(data, { ...p, estimator: 'ML', missing: st.missing });
        expect(r.fit.df).toBe(5);  // ?growth: linear growth on four occasions
      } else if (p.kind === 'irt') {
        const r = await irtR(data, p.items, p.model);
        expect(r.params.length).toBe(p.items.length);
        if (ex.id === 'ltm-lsat') expect(r.logLik).toBeCloseTo(-2466.9376, 3);  // rasch(LSAT) in native R (ltm 1.2-0)
      } else if (p.kind === 'lca') {
        const r = await lcaR(data, p.items, Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i), 10, 1);
        expect(r.models.map((m) => m.k)).toEqual(Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i));
      }
      return;
    }
    const model = exampleModel(ex);
    const spec = toSpec(model);
    for (const c of spec.constructs) for (const i of c.indicators) expect(data.names, `${ex.id}: ${i}`).toContain(i);
    for (const col of [ex.multigroup?.column, ex.multilevel?.column]) if (col) expect(data.names).toContain(col);
    if (st.method === 'process') {
      const input = processInput(model, st, data)!;
      const r = await estimateCpaR(data, { ...input, boot: { samples: 200, seed: 1 } });
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem' && st.estimator === '2SLS') {
      const r = await miivR(data, spec, st.missing);
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem') {
      const r = await estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator, st.interaction);
      expect(r.converged).toBe(true);
      if (CHISQ[ex.id] !== undefined) expect(r.fit.chisq).toBeCloseTo(CHISQ[ex.id], 2);
    } else {
      const r = await estimatePlsR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-7, maxIter: 300 }, st.plsPackage);
      expect(r.converged).toBe(true);
    }
    if (ex.assessment?.group) {
      const g = await groupsR(data, spec, { scheme: st.scheme, consistent: false, missing: 'casewise', tolerance: 1e-7, maxIter: 300 }, { group: ex.assessment.group, approaches: ['Klesel'], samples: 20, seed: 1 });
      expect(g.groups).toHaveLength(2);
    }
    if (ex.segmentation) {
      const seg = await rebusR(data, spec, { scheme: st.scheme, consistent: false, missing: 'casewise', tolerance: 1e-6, maxIter: 100 },
        { classes: [ex.segmentation.from], stopCrit: 0.005, iterMax: 100, seed: 1 });
      if (ex.id === 'plspm-rebus') expect(seg.models[0].gqi).toBeCloseTo(0.8341, 3);  // ?it.reb, nk = 2
    }
  }, 600_000);
});

it('factors arrive as codes in level order, with their levels', async () => {
  const d = await load(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs-groups')!);
  const school = d.cols[d.names.indexOf('school')];
  expect(new Set(school)).toEqual(new Set([1, 2]));
  expect((d.levels as Record<string, string[]>).school).toEqual(['Grant-White', 'Pasteur']);
}, 600_000);
