// The Bayesian SEM card's INLAvaan engine in R (webR; or desktop R with
// PS_NATIVE_R=1) against the native check (scripts/validation/inlavaan.R, which
// found the app equal to direct INLAvaan calls): INLAvaan's ?acfa example
// (Holzinger & Swineford, unit variances) and its ?asem example as the home
// screen opens it (Political Democracy, labels a, b, c). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import { makeCovariancesExplicit, newId, toSpec, type ModelState } from '../model/project';
import { rCall } from './bridge';
import { bsemR, bsemScriptR, type BsemOptions, type BsemResult } from './bsem';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'inlavaan', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;
const dataset = async (name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'lavaan', name, na: [] },
    'lavaan',
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
};
const key = (p: { lhs: string; op: string; rhs: string }) =>
  p.op === '~~' && p.lhs > p.rhs ? `${p.rhs}~~${p.lhs}` : `${p.lhs}${p.op}${p.rhs}`;
/** Every posterior summary and fit measure as the native run recorded it (webR's arithmetic differs in the last digits). */
function same(r: BsemResult, want: { parameters: any[]; fit: Record<string, number> }) {
  expect(r.parameters).toHaveLength(want.parameters.length);
  for (const w of want.parameters) {
    const p = r.parameters.find((x) => key(x) === key(w))!;
    for (const k of ['mean', 'sd', 'median', 'low', 'high'] as const)
      expect(Math.abs(p[k]! - w[k]) / Math.max(1, Math.abs(w[k])), `${key(w)} ${k}`).toBeLessThan(
        1e-5,
      );
  }
  for (const k of ['ppp', 'dic', 'pDic', 'margLogLik', 'waic', 'looic', 'brmsea', 'bcfi'])
    expect(
      Math.abs(r.fit[k as 'dic']! - want.fit[k]) / Math.max(1, Math.abs(want.fit[k])),
      k,
    ).toBeLessThan(1e-3);
}
const O: BsemOptions = {
  engine: 'inlavaan',
  identification: 'unit',
  chains: 3,
  burnin: 500,
  sample: 1000,
};

describe('Bayesian SEM by INLAvaan', () => {
  it('?acfa: Holzinger & Swineford with unit factor variances, as natively', async () => {
    const F = (name: string, indicators: string[]) => ({
      id: newId('c'),
      name,
      type: 'factor' as const,
      mode: 'A' as const,
      indicators,
      x: 0,
      y: 0,
      side: 'left' as const,
    });
    const m: ModelState = makeCovariancesExplicit({
      constructs: [
        F('visual', ['x1', 'x2', 'x3']),
        F('textual', ['x4', 'x5', 'x6']),
        F('speed', ['x7', 'x8', 'x9']),
      ],
      paths: [],
      moderations: [],
    });
    const r = await bsemR(
      await dataset('HolzingerSwineford1939'),
      toSpec(m),
      'casewise',
      O,
      1234,
      0.95,
    );
    same(r, ref.acfa);
    expect(r.engine.package).toBe('INLAvaan');
    expect(r.converged).toBe(true);
    expect(r.intervals).toBe('marginals');
    expect(r.diagnostics!.nmadMax).toBeLessThan(0.1);
    expect(r.maxRhat).toBeNull();
  }, 900_000);
  it('?asem: the home screen’s example opens the card as the help page fits it, as natively', async () => {
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'inlavaan-poldem')!;
    const { kind: _k, ...o } = ex.panel as { kind: 'bsem' } & BsemOptions;
    expect(o).toEqual({ ...O, identification: 'marker' });
    const data = await dataset('PoliticalDemocracy');
    const r = await bsemR(data, toSpec(exampleModel(ex)), 'casewise', o, 1234, 0.95);
    same(r, ref.asem);
    // (the equal loadings: labels a, b, c in 1960 and 1965)
    const a = r.parameters.filter((p) => p.label === 'a');
    expect(a).toHaveLength(2);
    expect(a[0].mean).toBe(a[1].mean);
    expect(r.fit.ppp).toBeGreaterThan(0.3);
    const script = await bsemScriptR(data, toSpec(exampleModel(ex)), 'casewise', o, 1234, 0.95);
    expect(script).toMatch(/library\(INLAvaan\)/);
    expect(script).toMatch(
      /fit <- asem\(model, data = data, auto\.cov\.y = FALSE, std\.lv = FALSE, dp = dp, nsamp = 1000, verbose = FALSE\)/,
    );
  }, 900_000);
});
