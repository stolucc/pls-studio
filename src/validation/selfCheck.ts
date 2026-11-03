// The browser self-check: a few examples, one per engine, run here exactly as the webR tests ran them, and their
// results' digests (digest.ts) compared with those the tests recorded (public/validation.json). It shows that
// this browser's R computes what the tests computed, rather than asking the user to trust it.

import { parseCsv } from '../engine/dataset';
import type { CbEstimator } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { exampleModel, PACKAGE_EXAMPLES, type PackageExample } from '../examples/packages';
import { type DataInfo, DEFAULT_SETTINGS, toSpec } from '../model/project';
import type { RPackage } from '../rengine/bridge';
import { digest, digestDifferences } from './digest';
import type { Evidence } from './types';

/** The examples, one per engine family, quick to run (a few seconds each). */
export const SELF_CHECK_IDS = [
  'lavaan-hs', 'mplus-ex5.25', 'seminr-corprep', 'csem-threecf', 'ltm-lsat', 'polca-carcinoma', 'lme4-sleepstudy', 'stats-dobson', 'manymome-med', 'did-mpdta',
] as const;

/** An example's dataset: from its R package, or a file shipped with the app (read by `readText`). */
export async function loadExampleData(ex: PackageExample, readText: (path: string) => Promise<string>): Promise<Dataset> {
  const { rCall } = await import('../rengine/bridge');
  let data: Dataset;
  if (ex.data.file) data = parseCsv(await readText(ex.data.file)).dataset;
  else {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[] | string> | unknown[] }>('ps_dataset',
      { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
    const levels = raw.levels && !Array.isArray(raw.levels) && Object.keys(raw.levels).length
      ? { categories: Object.fromEntries(Object.entries(raw.levels).map(([k, l]) => [k, (Array.isArray(l) ? l : [l]).map(String)])) } : {};
    data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...levels };
  }
  if (ex.computed?.length) {
    const { computeColumn } = await import('../data/compute');
    let info: DataInfo = { fileName: 'x', rows: data.cols[0]?.length ?? 0, missingCells: 0, excluded: [] };
    for (const k of ex.computed) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  }
  if (ex.labels) data = { ...data, categories: { ...(data.categories ?? {}), ...ex.labels } };
  return data;
}

/** Run one self-check example as the app runs it at the example's settings; the result object whose digest is compared. */
export async function runSelfCheck(id: string, readText: (path: string) => Promise<string>): Promise<unknown> {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`No example ${id}`);
  const data = await loadExampleData(ex, readText);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const p = ex.panel;
  if (p?.kind === 'irt') return (await import('../rengine/items')).irtR(data, p.items, p.model);
  if (p?.kind === 'lca') return (await import('../rengine/items')).lcaR(data, p.items, Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i), 10, st.seed);
  if (p?.kind === 'lmm') { const { kind: _k, ...input } = p; return (await import('../rengine/mixed')).lmmR(data, input); }
  if (p?.kind === 'regression') { const { kind: _k, ...opts } = p; return (await import('../rengine/regression')).regressionR(data, { ...opts, confidence: 0.95 }); }
  if (p?.kind === 'did') { const { kind: _k, ...opts } = p; return (await import('../rengine/did')).didR(data, { ...opts, seed: 1, confidence: 0.95 }); }
  if (p) throw new Error(`No self-check runner for ${p.kind}`);
  const model = exampleModel(ex);
  if (st.method === 'process') {
    const { processInput } = await import('../process/input');
    return (await import('../rengine/cpa')).estimateCpaR(data, processInput(model, st, data)!);
  }
  if (st.method === 'cbsem') return (await import('../rengine/lavaan')).estimateCbLavaan(data, toSpec(model), st.missing, st.estimator as CbEstimator, st.interaction);
  return (await import('../rengine/pls')).estimatePlsR(data, toSpec(model),
    { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 10 ** -st.stopExp, maxIter: st.maxIter, hocApproach: st.hocApproach }, st.plsPackage);
}

export interface SelfCheckOutcome { id: string; numbers: number; differences: { path: string; got: number | undefined; want: number }[]; error?: string; seconds: number }

/** Run every self-check example and compare with the recorded digests. */
export async function selfCheck(evidence: Evidence, readText: (path: string) => Promise<string>, progress?: (done: number, total: number, id: string) => void): Promise<SelfCheckOutcome[]> {
  const out: SelfCheckOutcome[] = [];
  const ids = SELF_CHECK_IDS.filter((id) => evidence.checks.some((c) => c.subject === 'example' && c.id === id && c.digest));
  for (const [i, id] of ids.entries()) {
    progress?.(i, ids.length, id);
    const want = evidence.checks.find((c) => c.subject === 'example' && c.id === id)!.digest!;
    const t0 = performance.now();
    try {
      const got = digest(await runSelfCheck(id, readText));
      out.push({ id, numbers: Object.keys(want).length, differences: digestDifferences(got, want), seconds: (performance.now() - t0) / 1000 });
    } catch (e) {
      out.push({ id, numbers: Object.keys(want).length, differences: [], error: e instanceof Error ? e.message : String(e), seconds: (performance.now() - t0) / 1000 });
    }
  }
  progress?.(ids.length, ids.length, '');
  return out;
}
