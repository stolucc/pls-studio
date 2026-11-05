// Ordinal indicators with WLSMV, and FIML for missing values, through lavaan
// in webR, against desktop lavaan (scripts/validation/categorical_fiml.R; WLSMV: lavaan 0.7-3 with Mplus's
// standard errors, the app's default, and lavaan's own; FIML: lavaan 0.6-16).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'categorical');
const load = (f: string) => parseCsv(readFileSync(join(DIR, f), 'utf8')).dataset;
const ref = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const items = Array.from({ length: 9 }, (_, i) => `x${i + 1}`);
const spec: ModelSpec = {
  constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
  paths: [{ from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }],
};
type Row = { lhs: string; op: string; rhs: string; est: number; se: number; std: number; stdSe?: number; lavaanSe?: number };

describe('ordinal indicators (WLSMV)', () => {
  it('matches lavaan: scaled test, loadings, thresholds', async () => {
    const r0 = ref('hs_wlsmv.json');
    const r = await estimateCbLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items }, 'casewise', 'WLSMV');
    expect(r.fit.chisqScaled!).toBeCloseTo(r0.fit['chisq.scaled'], 3);
    expect(r.fit.df).toBe(r0.fit.df);
    expect(r.fit.cfiScaled!).toBeCloseTo(r0.fit['cfi.scaled'], 4);
    for (const l of [...r0.loadings, ...r0.regressions] as Row[]) {
      const e = r.estimates.find((x) => x.lhs === l.lhs && x.op === l.op && x.rhs === l.rhs)!;
      expect(e.est, `${l.lhs} ${l.op} ${l.rhs}`).toBeCloseTo(l.est, 5);
      expect(e.std).toBeCloseTo(l.std, 5);
    }
    const th = r.estimates.filter((e) => e.kind === 'threshold');
    expect(th).toHaveLength((r0.thresholds as Row[]).length);
    for (const t of r0.thresholds as Row[]) expect(th.find((x) => x.lhs === t.lhs && x.rhs === t.rhs)!.est).toBeCloseTo(t.est, 5);
    expect(await cbScriptLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items }, 'casewise', 'WLSMV')).toContain('estimator = "WLSMV", ordered = c("x1"');
  }, 600_000);

  it('standard errors as Mplus by default (expected information in the sandwich, divided by N), lavaan 0.7’s on request', async () => {
    const r0 = ref('hs_wlsmv.json');
    const rows = [...r0.loadings, ...r0.regressions].filter((l: Row) => l.se > 0) as Row[];
    const mplus = await estimateCbLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items }, 'casewise', 'WLSMV');
    const own = await estimateCbLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items, wlsmvSe: 'lavaan' }, 'casewise', 'WLSMV');
    const find = (r: typeof mplus, l: Row) => r.estimates.find((x) => x.lhs === l.lhs && x.op === l.op && x.rhs === l.rhs)!;
    for (const l of rows) {
      expect(find(mplus, l).se!, `SE of ${l.lhs} ${l.op} ${l.rhs}`).toBeCloseTo(l.se, 6);
      expect(find(own, l).se!, `lavaan's SE of ${l.lhs} ${l.op} ${l.rhs}`).toBeCloseTo(l.lavaanSe!, 6);
      expect(find(own, l).est).toBeCloseTo(find(mplus, l).est, 10);
    }
    // (estimates and the test statistic do not depend on it)
    expect(own.fit.chisqScaled!).toBeCloseTo(mplus.fit.chisqScaled!, 8);
    const s = await cbScriptLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items }, 'casewise', 'WLSMV');
    expect(s).toContain('information.bread = "expected"');
    expect(s).toContain('fit <- mplus_se(fit)');
    const t = await cbScriptLavaan(load('hs_ordinal.csv'), { ...spec, ordered: items, wlsmvSe: 'lavaan' }, 'casewise', 'WLSMV');
    expect(t).not.toContain('information.bread');
    expect(t).not.toContain('mplus_se');
  }, 600_000);
});

describe('FIML', () => {
  it('matches lavaan: all 301 cases used, MLR', async () => {
    const r0 = ref('hs_fiml.json');
    const r = await estimateCbLavaan(load('hs_missing.csv'), spec, 'fiml', 'MLR');
    expect(r.n).toBe(301);
    expect(r.droppedRows).toBe(0);
    expect(r.fit.chisq).toBeCloseTo(r0.fit.chisq, 3);
    expect(r.fit.chisqScaled!).toBeCloseTo(r0.fit['chisq.scaled'], 3);
    for (const l of r0.loadings as Row[]) {
      const e = r.estimates.find((x) => x.lhs === l.lhs && x.op === l.op && x.rhs === l.rhs)!;
      expect(e.est).toBeCloseTo(l.est, 5);
      if (l.se > 0) expect(e.se!).toBeCloseTo(l.se, 5);
    }
    const script = await cbScriptLavaan(load('hs_missing.csv'), spec, 'fiml', 'MLR');
    expect(script).toContain('missing = "ml"');
    expect(script).not.toContain('complete.cases');
  }, 600_000);
});
