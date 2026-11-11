// Difference-in-differences against did and fixest run natively
// (scripts/validation/did.R): the ?aggte example on mpdta and the ?i example
// on base_did. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { rCall } from './bridge';
import { didR, didScriptR } from './did';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'did', 'reference.json'), 'utf8'),
);
async function data(pkg: 'did' | 'fixest', name: string) {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: pkg, name, na: [] },
    pkg,
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
}

it('staggered adoption (did, Callaway & Sant’Anna) reproduces the help-page ATT and group-time effects', async () => {
  const d = await data('did', 'mpdta');
  const input = {
    design: 'staggered' as const,
    outcome: 'lemp',
    unit: 'countyreal',
    time: 'year',
    treated: 'first.treat',
    post: '',
    firstPeriod: null,
    covariates: [],
    control: 'nevertreated' as const,
    eventStudy: true,
    seed: 1,
    confidence: 0.95,
  };
  const r = await didR(d, input);
  expect(r.design).toBe('staggered');
  expect(r.att.est).toBeCloseTo(ref.mpdta.att, 6);
  expect(r.att.se).toBeCloseTo(ref.mpdta.se, 2); // (bootstrapped)
  const col = (n: string) => d.cols[d.names.indexOf(n)];
  expect(r.units).toBe(new Set(col('countyreal')).size);
  expect(r.periods).toBe(new Set(col('year')).size);
  expect(r.treatedUnits).toBe(
    new Set(Array.from(col('countyreal')).filter((_, i) => col('first.treat')[i] > 0)).size,
  );
  for (const g of ref.mpdta.groupTime as { group: number; time: number; est: number }[]) {
    const mine = r.groupTime!.find((x) => x.group === g.group && x.time === g.time)!;
    expect(mine, `${g.group} ${g.time}`).toBeTruthy();
    expect(mine.est).toBeCloseTo(g.est, 6);
  }
  for (const e of ref.mpdta.dynamic as { rel: number; est: number }[])
    expect(r.event.find((x) => x.rel === e.rel)!.est, `e = ${e.rel}`).toBeCloseTo(e.est, 6);
  expect(r.preTrend?.p).toBeCloseTo(ref.mpdta.Wpval, 1);
  const script = await didScriptR(d, input);
  expect(script).toMatch(
    /att_gt\(yname = "lemp", tname = "year", idname = "countyreal", gname = "\w+", xformla = NULL, data = data, control_group = "nevertreated", alp = 0\.05\)/,
  ); // (first.treat under a safe name)
  expect(script).toContain('aggte(out, type = "dynamic")');
}, 900_000);

it('two-way fixed effects with an event study (fixest) reproduces the help-page coefficients', async () => {
  const d = await data('fixest', 'base_did');
  const input = {
    design: 'twfe' as const,
    outcome: 'y',
    unit: 'id',
    time: 'period',
    treated: 'treat',
    post: 'post',
    firstPeriod: 6,
    covariates: ['x1'],
    control: 'nevertreated' as const,
    eventStudy: true,
    seed: 1,
    confidence: 0.95,
  };
  const r = await didR(d, input);
  expect(r.att.est).toBeCloseTo(ref.base_did.att, 6);
  expect(r.att.se).toBeCloseTo(ref.base_did.se, 6);
  const ids = d.cols[d.names.indexOf('id')];
  expect(r.units).toBe(new Set(ids).size);
  expect(r.periods).toBe(10);
  expect(r.treatedUnits).toBe(
    new Set(Array.from(ids).filter((_, i) => d.cols[d.names.indexOf('treat')][i] === 1)).size,
  );
  for (const e of ref.base_did.event as { time: number; est: number; se: number }[]) {
    const mine = r.event.find((x) => x.time === e.time)!;
    expect(mine.est, `period ${e.time}`).toBeCloseTo(e.est, 6);
    expect(mine.se, `period ${e.time}`).toBeCloseTo(e.se, 6);
  }
  expect(r.event.find((x) => x.time === 5)).toMatchObject({ rel: -1, est: 0 });
  expect(r.preTrend).toMatchObject({ df1: 4 });
  const script = await didScriptR(d, input);
  expect(script).toContain('feols(y ~ treat:post + x1 | id + period, data = data, cluster = ~id)');
  expect(script).toContain('i(period, treat, ref)');
  // A post column under any name, without the first treated period: the reference period comes from that column.
  const renamed = { ...d, names: d.names.map((n) => (n === 'post' ? 'after' : n)) };
  const r3 = await didR(renamed, { ...input, post: 'after', firstPeriod: null });
  expect(r3.event.find((x) => x.time === 5)).toMatchObject({ rel: -1, est: 0 });
  expect(r3.event.length).toBe(10);
  expect(r3.warnings).toEqual([]);
  // Periods need not be consecutive: relative time counts observed periods, the reference is the last pre-period.
  const spaced = {
    ...d,
    cols: d.cols.map((c, i) =>
      d.names[i] === 'period' ? Float64Array.from(c, (v) => 2000 + 4 * v) : c,
    ),
  };
  const r4 = await didR(spaced, { ...input, post: '', firstPeriod: 2024 });
  expect(r4.att.est).toBeCloseTo(ref.base_did.att, 6);
  expect(r4.event.find((x) => x.time === 2020)).toMatchObject({ rel: -1, est: 0 });
  expect(r4.event.find((x) => x.time === 2024)!.rel).toBe(0);
  expect(r4.event.map((x) => x.rel).sort((a, b) => a - b)).toEqual([
    -5, -4, -3, -2, -1, 0, 1, 2, 3, 4,
  ]);
  // Confidence intervals come from fixest's own t distribution (cluster degrees of freedom), as its p values.
  const a = r.att;
  expect(a.ciHigh - a.est).toBeGreaterThan(1.96 * a.se * 0.999);
  // Without a post column the first treated period defines it.
  const r2 = await didR(d, { ...input, post: '', eventStudy: false });
  expect(r2.att.est).toBeCloseTo(ref.base_did.att, 6);
  expect(r2.event).toEqual([]);
}, 900_000);
