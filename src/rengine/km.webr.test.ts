// The Kaplan–Meier card equals survival called directly in desktop R (scripts/validation/survival_km.R):
// ?survfit.formula's aml curves, ?survdiff's ovarian test, lung by sex with log-log intervals, aml as one sample.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { kmInput, parseRiskTimes } from '../analyses/km';
import { PACKAGE_EXAMPLES, panelPreset } from '../examples/packages';
import { DEFAULT_SETTINGS } from '../model/project';
import { against, example, near } from '../validation/record';
import { rCall } from './bridge';
import { kmR, kmScriptR, type KmInput, type KmResult } from './km';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type RefStratum = {
  n: number;
  events: number;
  median: number | null;
  medianLow: number | null;
  medianHigh: number | null;
  time: number[];
  surv: number[];
  lower: (number | null)[];
  upper: (number | null)[];
  riskAt: number[];
};
type RefTest = { chisq: number; df: number; p: number; observed: number[]; expected: number[] };
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'survival', 'km.json'), 'utf8'),
);

async function survivalData(name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: number[][]; levels: Record<string, string[]> }>(
    'ps_dataset',
    { package: 'survival', name, na: [] },
    'survival',
  );
  const levels = raw.levels && !Array.isArray(raw.levels) ? raw.levels : {};
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (v === null ? NaN : v))),
    ...(Object.keys(levels).length ? { categories: levels } : {}),
  };
}

const base: Omit<KmInput, 'time' | 'status' | 'group'> = {
  confidence: 0.95,
  confType: 'log',
  riskTimes: [],
};

/** Every estimate, interval and number at risk of each group against the reference. */
function expectCurves(r: KmResult, want: RefStratum[], what: string) {
  expect(r.strata.length).toBe(want.length);
  r.strata.forEach((s, j) => {
    const w = want[j];
    const at = `${what}, ${s.name}`;
    expect(s.n).toBe(w.n);
    expect(s.events).toBe(w.events);
    expect(s.median).toBe(w.median);
    expect(s.medianLow).toBe(w.medianLow);
    expect(s.medianHigh).toBe(w.medianHigh);
    expect(s.time).toEqual(w.time);
    expect(s.riskAt).toEqual(w.riskAt);
    // (products of fractions and closed-form intervals: 1e-10)
    s.surv.forEach((v, i) => expect(v, `${at}: S(${s.time[i]})`).toBeCloseTo(w.surv[i], 10));
    s.lower.forEach((v, i) => {
      if (w.lower[i] === null) expect(v).toBeNull();
      else expect(v!, `${at}: lower(${s.time[i]})`).toBeCloseTo(w.lower[i]!, 10);
    });
    s.upper.forEach((v, i) => {
      if (w.upper[i] === null) expect(v).toBeNull();
      else expect(v!, `${at}: upper(${s.time[i]})`).toBeCloseTo(w.upper[i]!, 10);
    });
  });
}

/** A survdiff test against the reference (χ² closed form: 1e-10; p: 1e-12 absolute). */
function expectTest(got: KmResult['logrank'], want: RefTest, what: string) {
  expect(got!.chisq, `${what}: χ²`).toBeCloseTo(want.chisq, 10);
  expect(got!.df).toBe(want.df);
  expect(got!.p, `${what}: p`).toBeCloseTo(want.p, 12);
  got!.expected.forEach((v, i) =>
    expect(v, `${what}: expected events ${i + 1}`).toBeCloseTo(want.expected[i], 10),
  );
  expect(got!.observed.map((v) => Math.round(v * 1e8) / 1e8)).toEqual(
    want.observed.map((v) => Math.round(v * 1e8) / 1e8),
  );
}

describe('Kaplan–Meier (survival)', () => {
  it('aml by maintenance: survfit’s curves, medians, risk table, log-rank and Peto tests', async () => {
    const aml = await survivalData('aml');
    const input: KmInput = {
      ...base,
      time: 'time',
      status: 'status',
      group: 'x',
      riskTimes: parseRiskTimes('0, 20:20, 40, 60, 80, 100, 120, 140, 160'),
    };
    expect(input.riskTimes).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160]);
    const r = await kmR(aml, input);
    expect(r.strata.map((s) => s.name)).toEqual(['Maintained', 'Nonmaintained']);
    expectCurves(r, ref.aml.strata, 'aml');
    expectTest(r.logrank, ref.aml.logrank, 'aml log-rank');
    expectTest(r.peto, ref.aml.peto, 'aml Peto');
    const script = await kmScriptR(aml, input);
    expect(script).toContain(
      'fit <- survfit(Surv(time, .event) ~ x, data = data, conf.int = 0.95, conf.type = "log")',
    );
    expect(script).toContain('peto <- survdiff(Surv(time, .event) ~ x, data = data, rho = 1)');
  });

  it('ovarian by treatment: ?survdiff’s two-sample test (ρ = 0 and 1)', async () => {
    const ovarian = await survivalData('ovarian');
    const r = await kmR(ovarian, { ...base, time: 'futime', status: 'fustat', group: 'rx' });
    expectTest(r.logrank, ref.ovarian.logrank, 'ovarian log-rank');
    expectTest(r.peto, ref.ovarian.peto, 'ovarian Peto');
  });

  it('lung by sex with log-log intervals; 1 = censored coding gives the same curves', async () => {
    const lung = await survivalData('lung');
    const status = lung.cols[lung.names.indexOf('status')];
    const withDead: Dataset = {
      ...lung,
      names: [...lung.names, 'dead', 'censored'],
      cols: [...lung.cols, status.map((v) => v - 1), status.map((v) => 2 - v)],
    };
    const input: KmInput = {
      ...base,
      time: 'time',
      status: 'dead',
      group: 'sex',
      confType: 'log-log',
      riskTimes: [0, 250, 500, 750, 1000],
    };
    const r = await kmR(withDead, input);
    expectCurves(r, ref.lung.strata, 'lung');
    expectTest(r.logrank, ref.lung.logrank, 'lung log-rank');
    expectTest(r.peto, ref.lung.peto, 'lung Peto');
    const flipped = await kmR(withDead, { ...input, status: 'censored', statusCensored: true });
    expect(flipped.strata[0].surv).toEqual(r.strata[0].surv);
  });

  it('aml as one sample with plain 90% intervals: no tests', async () => {
    const aml = await survivalData('aml');
    const r = await kmR(aml, {
      ...base,
      time: 'time',
      status: 'status',
      group: '',
      confidence: 0.9,
      confType: 'plain',
      riskTimes: [0, 20, 40, 60, 80, 100, 120, 140, 160],
    });
    expectCurves(r, ref.amlOne.strata, 'aml (one sample)');
    expect(r.logrank).toBeNull();
    expect(r.peto).toBeNull();
  });

  it('rejects invalid requests', async () => {
    const aml = await survivalData('aml');
    await expect(
      kmR(aml, { ...base, time: 'time', status: 'status', group: '', confType: 'evil' as never }),
    ).rejects.toThrow(/confidence interval type/);
    await expect(kmR(aml, { ...base, time: 'time', status: 'x', group: '' })).rejects.toThrow(
      /numeric|0\/1/,
    );
    await expect(kmR(aml, { ...base, time: 'time', status: 'time', group: '' })).rejects.toThrow(
      /differ/,
    );
  });
});

// The home-screen example: ?survfit.formula's aml curves and the log-rank test between the groups.
it('the survival example’s card equals the help page run natively', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'survival-aml')!;
  example('survival-aml', {
    title: ex.title,
    method: 'Regression',
    packages: ['survival'],
    definition: ex,
  });
  against({
    label: 'the help page’s survfit and survdiff in desktop R, scripts/validation/survival_km.R',
    script: 'scripts/validation/survival_km.R',
    level: 'native',
  });
  const aml = await survivalData('aml');
  const { parseOptions } = (await import('../analyses/km')).kmAnalysis;
  const options = parseOptions(panelPreset(ex.panel!))!;
  const r = await kmR(aml, kmInput(options, { settings: DEFAULT_SETTINGS }));
  r.strata.forEach((s, j) => {
    near(`${s.name}: median`, s.median ?? NaN, ref.aml.strata[j].median, 0);
    s.surv.forEach((v, i) =>
      near(`${s.name}: S(${s.time[i]})`, v, ref.aml.strata[j].surv[i], 1e-10),
    );
  });
  near('log-rank χ²', r.logrank!.chisq, ref.aml.logrank.chisq, 1e-10);
  near('log-rank p', r.logrank!.p, ref.aml.logrank.p, 1e-12);
});
