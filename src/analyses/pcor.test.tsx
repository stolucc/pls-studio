// The partial correlation card: options from files, what blocks a run, and its view (numbers from
// scripts/validation/regression_extras.R, ppcor's help page).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { PcorResult } from '../rengine/pcor';
import { pcorAnalysis as t } from './pcor';
import type { AnalysisCtx } from './types';

const data = {
  names: ['hl', 'disp', 'deg', 'BC'],
  cols: [0, 1, 2, 3].map((k) => Float64Array.from({ length: 10 }, (_, i) => Math.sin(i * (k + 1)))),
};
const ctx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null } as unknown as AnalysisCtx;

describe('partial correlation card', () => {
  it('parses options from untrusted files', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(t.parseOptions({ vars: ['a', 3, 'b'], controls: 'x', method: 'evil' })).toEqual({
      vars: ['a', 'b'],
      controls: [],
      method: 'pearson',
    });
  });

  it('needs two variables and controls, or three variables; no variable as its own control', () => {
    const o = t.defaults(ctx);
    expect(t.blocked({ ...o, vars: ['hl'] }, ctx)).toMatch(/two/);
    expect(t.blocked({ ...o, vars: ['hl', 'disp'] }, ctx)).toMatch(/three/);
    expect(t.blocked({ ...o, vars: ['hl', 'disp'], controls: ['hl'] }, ctx)).toMatch(/control/);
    expect(t.blocked({ ...o, vars: ['hl', 'disp'], controls: ['deg'] }, ctx)).toBeNull();
    expect(t.blocked({ ...o, vars: ['hl', 'disp', 'nope'] }, ctx)).toMatch(/nope/);
    // Which columns are controls changes the fingerprint.
    expect(t.fingerprint({ ...o, vars: ['hl', 'disp'], controls: ['deg'] }, ctx)).not.toBe(
      t.fingerprint({ ...o, vars: ['hl', 'deg'], controls: ['disp'] }, ctx),
    );
    expect(t.summary({ ...o, vars: ['hl', 'disp'], controls: ['deg'] })).toBe(
      'Pearson · hl, disp | deg',
    );
  });

  it('shows the partial matrix, the pairs and both semi-partial directions', () => {
    const test = (r: number, p: number) => ({ r, stat: r * 3, p });
    const result: PcorResult = {
      method: 'pearson',
      vars: ['hl', 'disp', 'deg'],
      controls: [],
      n: 10,
      pairs: [
        {
          a: 'hl',
          b: 'disp',
          given: ['deg'],
          n: 10,
          gp: 1,
          partial: test(-0.672, 0.068),
          semiAB: test(-0.579, 0.13),
          semiBA: test(-0.55, 0.16),
        },
        {
          a: 'hl',
          b: 'deg',
          given: ['disp'],
          n: 10,
          gp: 1,
          partial: test(-0.616, 0.1),
          semiAB: test(-0.5, 0.2),
          semiBA: test(-0.4, 0.3),
        },
        {
          a: 'disp',
          b: 'deg',
          given: ['hl'],
          n: 10,
          gp: 1,
          partial: test(-0.72, 0.04),
          semiAB: test(-0.6, 0.1),
          semiBA: test(-0.65, 0.08),
        },
      ],
      warnings: [],
      engine: { package: 'ppcor', version: '1.1' },
    };
    const html = renderToStaticMarkup(<t.View result={result} options={t.defaults(ctx)} current />);
    expect(html).toContain('Partial r');
    expect(html).toContain('each pair controlled for the other variables');
    expect(html).toContain('hl with disp (adjusted)');
    expect(html).toContain('disp with hl (adjusted)');
    expect(html).toContain('-0.672');
  });
});
