// The descriptives card (R/explore.R) against psych::describe(type = 2), base R's quantile(), shapiro.test, nortest
// and table() on the same data (scripts/validation/explore.R, desktop R 4.6.2, psych 2.6.9, nortest 1.0-4).
// Run with WEBR_TESTS=1 npx vitest run src/rengine/explore (PS_NATIVE_R=1: desktop R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import { exploreR, exploreScriptR, type ExploreInput, type ExploreStats } from './explore';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: (number | null)[][]; categories: Record<string, string[]> };
type Reference = Record<string, number | number[]>;
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'explore', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c, (v) => (v === null ? NaN : v))),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});
// Closed forms on both sides: webR's floating point differs from desktop R's by about 1e-15 here, the
// nortest p-values (series approximations) by no more; 1e-10 relative leaves room for both.
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-10 * Math.max(1, Math.abs(b)));

const BASE: ExploreInput = {
  vars: [],
  frequencies: [],
  group: '',
  percentiles: ref.probs,
  quantileType: 7,
  normality: true,
  confidence: 0.95,
};

const STATS = [
  'n',
  'missing',
  'mean',
  'sd',
  'se',
  'ciLow',
  'ciHigh',
  'median',
  'q1',
  'q3',
  'min',
  'max',
  'range',
  'skewness',
  'seSkewness',
  'kurtosis',
  'seKurtosis',
  'cv',
  'mode',
  'modes',
] as const;

function compare(label: string, s: ExploreStats, w: Reference) {
  for (const k of STATS) close(`${label}: ${k}`, s[k], w[k] as number);
  (w.percentiles as number[]).forEach((p, i) =>
    close(`${label}: percentile ${ref.probs[i]}`, s.percentiles[i], p),
  );
}

describe('descriptives', () => {
  it('distributions by group: ToothGrowth len by supp (type 7), and normality tests', async () => {
    const r = await exploreR(data(ref.toothgrowth), {
      ...BASE,
      vars: ['len'],
      frequencies: ['dose'],
      group: 'supp',
    });
    same('groups', r.groups.join(', '), 'OJ, VC');
    for (const g of ['OJ', 'VC']) {
      const s = r.stats.find((x) => x.group === g)!;
      compare(`len, ${g}`, s, ref.len[g]);
      const t = r.normality.find((x) => x.group === g)!;
      close(`${g}: Shapiro–Wilk W`, t.shapiro?.stat, ref.len[g].shapiro[0]);
      close(`${g}: Shapiro–Wilk p`, t.shapiro?.p, ref.len[g].shapiro[1]);
      close(`${g}: Lilliefors D`, t.lilliefors?.stat, ref.len[g].lilliefors[0]);
      close(`${g}: Lilliefors p`, t.lilliefors?.p, ref.len[g].lilliefors[1]);
      close(`${g}: Anderson–Darling A`, t.anderson?.stat, ref.len[g].anderson[0]);
      close(`${g}: Anderson–Darling p`, t.anderson?.p, ref.len[g].anderson[1]);
      // Frequency table of dose within the group: table(), percentages of the group's 30 rows.
      const f = r.frequencies.find((x) => x.group === g)!;
      same(`${g}: dose levels`, f.levels.join(', '), '0.5, 1.0, 2.0');
      same(`${g}: dose counts`, f.counts.join(', '), ref.doseCounts[g].join(', '));
      expect(f.cumulative[f.cumulative.length - 1]).toBeCloseTo(100, 12);
    }
  }, 600_000);

  it('missing values by group: airquality Ozone by Month', async () => {
    const r = await exploreR(data(ref.airquality), {
      ...BASE,
      vars: ['Ozone'],
      group: 'Month',
    });
    same('months', r.groups.join(', '), Object.keys(ref.ozone).join(', '));
    for (const [month, w] of Object.entries(ref.ozone)) {
      const s = r.stats.find((x) => x.group === month)!;
      compare(`Ozone, month ${month}`, s, w as Reference);
      const t = r.normality.find((x) => x.group === month)!;
      close(`month ${month}: Lilliefors p`, t.lilliefors?.p, (w as any).lilliefors[1]);
      close(`month ${month}: Anderson–Darling p`, t.anderson?.p, (w as any).anderson[1]);
    }
  }, 600_000);

  it('SPSS’s percentiles (type 6) and a frequency table without groups', async () => {
    const r = await exploreR(data(ref.toothgrowth), {
      ...BASE,
      vars: ['len'],
      quantileType: 6,
      normality: false,
    });
    compare('len, type 6', r.stats[0], ref.lenType6);
    same('engine without normality tests', r.engine.package, 'stats');
    const m = await exploreR(data(ref.airquality), {
      ...BASE,
      vars: [],
      frequencies: ['Month'],
      normality: false,
    });
    const f = m.frequencies[0];
    same('Month counts', f.counts.join(', '), ref.monthCounts.join(', '));
    same('Month total', f.total, 153);
    close('valid percent of May', f.validPercent[0], (100 * 31) / 153);
  }, 600_000);

  it('exports the script it runs, with nortest only for the normality tests', async () => {
    const input = { ...BASE, vars: ['len'], group: 'supp' };
    const script = await exploreScriptR(data(ref.toothgrowth), input);
    expect(script).toMatch(/nortest::lillie\.test/);
    expect(script).toMatch(/describe_one <- function/);
    const plain = await exploreScriptR(data(ref.toothgrowth), { ...input, normality: false });
    expect(plain).not.toMatch(/nortest/);
  }, 600_000);
});
