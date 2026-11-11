// The Kaplan–Meier card: options from files, risk table times, what blocks a run, the bridge input and the view
// (numbers from scripts/validation/survival_km.R, ?survfit.formula's aml).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { KmResult } from '../rengine/km';
import { kmAnalysis as t, kmInput, parseRiskTimes } from './km';
import type { AnalysisCtx } from './types';

const data = {
  names: ['time', 'status', 'x'],
  cols: [0, 1, 2].map((k) =>
    Float64Array.from({ length: 12 }, (_, i) => (k === 1 ? i % 2 : i + k)),
  ),
};
const ctx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null } as unknown as AnalysisCtx;
const base = t.defaults(ctx);

describe('Kaplan–Meier card', () => {
  it('parses options from untrusted files', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(
      t.parseOptions({ time: 'time', status: 3, confType: 'evil', riskTimes: [50, 'x', 0, -1] }),
    ).toEqual({
      time: 'time',
      status: '',
      statusCensored: false,
      group: '',
      confType: 'log',
      riskTimes: [0, 50],
      showCi: true,
    });
  });

  it('reads risk table times as lists and ranges, with 0', () => {
    expect(parseRiskTimes('0, 12, 24')).toEqual([0, 12, 24]);
    expect(parseRiskTimes('10:12; 5')).toEqual([5, 10, 11, 12]);
    expect(parseRiskTimes('')).toEqual([]);
  });

  it('needs distinct time and status columns; sends the confidence level of the settings', () => {
    expect(t.blocked(base, ctx)).toMatch(/time and status/);
    expect(t.blocked({ ...base, time: 'time', status: 'time' }, ctx)).toMatch(/differ/);
    expect(t.blocked({ ...base, time: 'time', status: 'status', group: 'nope' }, ctx)).toMatch(
      /nope/,
    );
    expect(t.blocked({ ...base, time: 'time', status: 'status', group: 'x' }, ctx)).toBeNull();
    const input = kmInput({ ...base, time: 'time', status: 'status', statusCensored: true }, ctx);
    expect(input).toEqual({
      time: 'time',
      status: 'status',
      statusCensored: true,
      group: '',
      confidence: DEFAULT_SETTINGS.confidence,
      confType: 'log',
      riskTimes: [],
    });
    // Showing the bands is display only; the grouping is part of the fingerprint.
    expect(t.display).toEqual(['showCi']);
    const o = { ...base, time: 'time', status: 'status' };
    expect(t.fingerprint({ ...o, group: 'x' }, ctx)).not.toBe(t.fingerprint(o, ctx));
  });

  it('shows medians (not reached as such), the tests, the curves with censoring marks and the risk table', () => {
    const stratum = (name: string, median: number | null) => ({
      name,
      n: 11,
      events: 7,
      median,
      medianLow: 18,
      medianHigh: null,
      time: [9, 13, 18],
      surv: [0.909, 0.818, 0.716],
      lower: [0.754, 0.619, 0.488],
      upper: [1, 1, null],
      nRisk: [11, 10, 8],
      nEvent: [1, 1, 1],
      nCensor: [0, 1, 0],
      riskAt: [11, 7],
    });
    const result: KmResult = {
      confidence: 0.95,
      confType: 'log',
      n: 23,
      strata: [stratum('Maintained', 31), stratum('Nonmaintained', null)],
      riskTimes: [0, 20],
      logrank: { chisq: 3.396, df: 1, p: 0.0653, observed: [7, 11], expected: [10.69, 7.31] },
      peto: { chisq: 2.785, df: 1, p: 0.095, observed: [5.1, 8.2], expected: [7.3, 6] },
      warnings: [],
      engine: { package: 'survival', version: '3.8.12' },
    };
    const html = renderToStaticMarkup(<t.View result={result} options={base} current />);
    expect(html).toContain('Median survival');
    expect(html).toContain('31.00');
    expect(html).toContain('not reached');
    expect(html).toContain('Log-rank (ρ = 0)');
    expect(html).toContain('Peto &amp; Peto');
    expect(html).toContain('Kaplan–Meier curves');
    expect(html).toContain('At risk');
    expect(html).toContain('1 censored at 13.00');
    expect(html).toContain('Kaplan–Meier estimates: Nonmaintained');
  });
});
