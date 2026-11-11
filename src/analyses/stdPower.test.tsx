// The Power (standard tests) card: options from files, the bridge input it builds (only the known quantities),
// what blocks it and its view (numbers from scripts/validation/pwr.R).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PwrResult } from '../rengine/pwr';
import { parseStdPowerOptions, stdPowerAnalysis as t, stdPowerInput } from './stdPower';

const base = t.defaults({} as never);

describe('power for standard tests: options', () => {
  it('parses and clamps options from untrusted files', () => {
    expect(parseStdPowerOptions(null)).toBeNull();
    const o = parseStdPowerOptions({
      test: 'evil',
      solve: 'x',
      alternative: 'sideways',
      alpha: 3,
      power: '0.9',
      n: -5,
      effect: 'NaN',
      k: 1e9,
    })!;
    expect(o.test).toBe('t2');
    expect(o.solve).toBe('n');
    expect(o.alternative).toBe('two.sided');
    expect(o.alpha).toBe(0.5);
    expect(o.power).toBe(0.9);
    expect(o.n).toBe(2);
    expect(o.effect).toBe(0.5);
    expect(o.k).toBe(1000);
    // A correlation stays within (−1, 1); f2's N at least u + 2.
    expect(parseStdPowerOptions({ test: 'r', effect: 4 })!.effect).toBe(0.999);
    expect(parseStdPowerOptions({ test: 'f2', u: 5, n: 3 })!.n).toBe(7);
  });

  it('sends only the known quantities: the solved one, and other tests’ fields, left out', () => {
    expect(stdPowerInput({ ...base, test: 't2', solve: 'n', effect: 0.3, power: 0.75 })).toEqual({
      test: 't2',
      solve: 'n',
      alpha: 0.05,
      alternative: 'two.sided',
      effect: 0.3,
      power: 0.75,
    });
    expect(stdPowerInput({ ...base, test: 'anova', solve: 'effect', n: 30, power: 0.9 })).toEqual({
      test: 'anova',
      solve: 'effect',
      alpha: 0.05,
      n: 30,
      power: 0.9,
      k: 3,
    });
    expect(
      stdPowerInput({ ...base, test: 'p2', solve: 'power', effectFrom: 'props', n: 80 }),
    ).toEqual({
      test: 'p2',
      solve: 'power',
      alpha: 0.05,
      alternative: 'two.sided',
      effectFrom: 'props',
      prop1: 0.5,
      prop2: 0.4,
      n: 80,
    });
    expect(stdPowerInput({ ...base, test: 'f2', solve: 'power', n: 95, u: 5 }).u).toBe(5);
  });

  it('blocks a zero effect and equal proportions', () => {
    expect(t.blocked({ ...base, effect: 0 }, {} as never)).toMatch(/zero/);
    expect(t.blocked({ ...base, effect: 0, solve: 'effect' }, {} as never)).toBeNull();
    expect(
      t.blocked({ ...base, test: 'p1', effectFrom: 'props', prop1: 0.3, prop2: 0.3 }, {} as never),
    ).toMatch(/equal/);
    expect(t.summary({ ...base, test: 'chisq', solve: 'power' })).toBe(
      'Chi-square test · Achieved power',
    );
  });
});

describe('power for standard tests: view', () => {
  const result: PwrResult = {
    test: 't2',
    solve: 'n',
    alternative: 'greater',
    alpha: 0.05,
    power: 0.75,
    effect: 0.3,
    n: 120.223201698916,
    nNeeded: 121,
    method: 'Two-sample t test power calculation',
    note: 'n is number in *each* group',
    curve: { n: [2, 100, 200, 363], power: [0.07, 0.68, 0.91, 0.99] },
    warnings: [],
    engine: { package: 'pwr', version: '1.3.0' },
  };
  it('heads with the N needed, gives the total and draws the curve', () => {
    const html = renderToStaticMarkup(<t.View result={result} options={base} current />);
    expect(html).toContain('N per group needed: 121');
    expect(html).toContain('Total N');
    expect(html).toContain('242');
    expect(html).toContain('greater (one-sided)');
    expect(html).toContain('Power curve');
    expect(html).toContain('pwr::pwr.t.test (two.sample)');
  });
  it('heads a sensitivity analysis with the detectable effect', () => {
    const html = renderToStaticMarkup(
      <t.View
        result={{ ...result, test: 'r', solve: 'effect', effect: 0.3089, n: 80, nNeeded: 80 }}
        options={base}
        current
      />,
    );
    expect(html).toContain('Smallest detectable r: 0.309 at N = 80');
    expect(html).not.toContain('Total N');
  });
});
