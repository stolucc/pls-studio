// @vitest-environment happy-dom
// The descriptives card without R: option parsing of untrusted projects, what it needs before it runs, the plots it
// computes in the browser, and its result view. The statistics are checked against R in rengine/explore.webr.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { figureOf } from './figureOf';
import { DEFAULT_SETTINGS } from '../model/project';
import type { ExploreResult } from '../rengine/explore';
import {
  exploreAnalysis,
  explorePlots,
  FrequencyTables,
  NormalityTable,
  PlotsView,
  parsePercentiles,
  type ExploreCardResult,
  type ExploreOptions,
} from './explore';
import type { AnalysisCtx } from './types';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

const data = {
  names: ['y', 'g', 't', 'many'],
  cols: [
    Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, NaN, 11, 12]),
    Float64Array.from([1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]),
    Float64Array.from([1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]),
    Float64Array.from({ length: 12 }, (_, i) => i / 7),
  ],
  categories: { t: ['low', 'high'] },
};
const ctx: AnalysisCtx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};
const o = (p: Partial<ExploreOptions>): ExploreOptions => ({
  ...exploreAnalysis.defaults(ctx),
  ...p,
});

describe('descriptives card options', () => {
  it('reads percentiles from typed text: between 0 and 100, sorted, each once', () => {
    expect(parsePercentiles('90, 10; 10 5  abc 100 0 -3 99.5')).toEqual([5, 10, 90, 99.5]);
    expect(parsePercentiles('')).toEqual([]);
    expect(parsePercentiles(Array.from({ length: 30 }, (_, i) => i + 1).join(','))).toHaveLength(
      20,
    );
  });
  it('validates options from a project file', () => {
    expect(exploreAnalysis.parseOptions(null)).toBeNull();
    expect(exploreAnalysis.parseOptions('x')).toBeNull();
    expect(
      exploreAnalysis.parseOptions({
        vars: ['y', 3, 'g'],
        frequencies: 't',
        group: { evil: 1 },
        percentiles: [95, 'x', 200, 5],
        quantileType: 'system("rm")',
        normality: 'no',
        plots: false,
      }),
    ).toEqual({
      vars: ['y', 'g'],
      frequencies: [],
      group: '',
      percentiles: [5, 95],
      quantileType: 7,
      normality: true,
      plots: false,
    });
    expect(exploreAnalysis.parseOptions({ quantileType: 6 })?.quantileType).toBe(6);
  });
  it('says what it needs', () => {
    const blocked = (p: Partial<ExploreOptions>) => exploreAnalysis.blocked(o(p), ctx);
    expect(blocked({})).toMatch(/at least one variable/);
    expect(exploreAnalysis.blocked(o({ vars: ['y'] }), { ...ctx, data: null })).toMatch(/raw data/);
    expect(blocked({ vars: ['nope'] })).toMatch(/Not in the data: nope/);
    expect(blocked({ vars: ['t'] })).toMatch(/text column/);
    expect(blocked({ vars: ['y'], group: 'y' })).toMatch(/cannot also be described/);
    expect(blocked({ vars: ['y'], group: 'many' })).toBeNull();
    expect(blocked({ vars: ['y'], frequencies: ['t'], group: 'g' })).toBeNull();
    expect(blocked({ frequencies: ['t'] })).toBeNull();
  });
  it('fingerprints what changes the results', () => {
    const f = (p: Partial<ExploreOptions>) => exploreAnalysis.fingerprint(o(p), ctx);
    expect(f({ vars: ['y'] })).not.toBe(f({ vars: ['y'], quantileType: 6 }));
    expect(f({ vars: ['y'] })).not.toBe(f({ vars: ['y'], percentiles: [10] }));
    expect(f({ vars: ['y'] })).not.toBe(f({ vars: ['y'], group: 'g' }));
    expect(f({ vars: ['y'] })).toBe(f({ vars: ['y'] }));
    expect(exploreAnalysis.summary(o({ vars: ['y'], frequencies: ['t'], group: 'g' }))).toBe(
      'y, t by g',
    );
  });
});

describe('descriptives plots', () => {
  it('one set of plots per variable and group, missing values left out, R’s group names', () => {
    const plots = explorePlots(o({ vars: ['y'], group: 'g' }), data, ['first', 'second']);
    expect(plots.map((p) => p.group)).toEqual(['first', 'second']);
    expect(plots[0].hist.n).toBe(6);
    expect(plots[1].hist.n).toBe(5);
    expect(plots[1].dots).toEqual([7, 8, 9, 11, 12]);
    expect(plots[0].box?.median).toBe(3.5);
    expect(plots[0].qq?.points).toHaveLength(6);
    expect(plots[0].density.length).toBeGreaterThan(10);
    const all = explorePlots(o({ vars: ['y'] }), data);
    expect(all).toHaveLength(1);
    expect(all[0].group).toBe('All');
    expect(all[0].hist.n).toBe(11);
  });
});

describe('descriptives view', () => {
  const stats = (group: string, modes: number) => ({
    variable: 'y',
    group,
    n: 6,
    missing: 0,
    mean: 3.5,
    sd: 1.87,
    se: 0.76,
    ciLow: 1.54,
    ciHigh: 5.46,
    median: 3.5,
    q1: 2.25,
    q3: 4.75,
    iqr: 2.5,
    percentiles: [1.25],
    min: 1,
    max: 6,
    range: 5,
    skewness: 0,
    seSkewness: 0.85,
    kurtosis: -1.2,
    seKurtosis: 1.74,
    cv: 0.53,
    mode: 1,
    modes,
  });
  const result: ExploreResult = {
    vars: ['y'],
    frequencyVars: ['t'],
    group: 'g',
    groups: ['first', 'second'],
    droppedRows: 2,
    quantileType: 6,
    percentiles: [5],
    confidence: 0.9,
    stats: [stats('first', 6), stats('second', 1)],
    normality: [
      {
        variable: 'y',
        group: 'first',
        n: 6,
        shapiro: { stat: 0.98, p: 0.95 },
        lilliefors: { stat: 0.1, p: 0.9 },
        anderson: null,
      },
    ],
    frequencies: [
      {
        variable: 't',
        group: 'first',
        levels: ['low', 'high'],
        counts: [3, 2],
        percent: [50, 33.3],
        validPercent: [60, 40],
        cumulative: [60, 100],
        missing: 1,
        total: 6,
      },
    ],
    warnings: [],
    engine: { package: 'nortest', version: '1.0-4' },
  };
  const full: ExploreCardResult = {
    ...result,
    plots: explorePlots(o({ vars: ['y'], group: 'g' }), data, result.groups),
  };
  it('lays out the statistics by row, one column per group, with the conventions noted', () => {
    const html = renderToStaticMarkup(
      <exploreAnalysis.View result={full} options={o({})} current />,
    );
    expect(html).toContain('y · first');
    expect(html).toContain('90% CI of the mean, lower');
    expect(html).toContain('5th percentile');
    expect(html).toContain('psych::describe(type = 2)');
    expect(html).toContain('SPSS’s weighted average (R’s quantile type 6)');
    expect(html).toContain('2 rows without a group left out');
    expect(html).toContain('Several values share the highest count');
    for (const tab of ['Descriptives', 'Frequencies', 'Normality', 'Plots'])
      expect(html).toContain(`>${tab}<`);
  });
  it('shows only the tabs it has results for', () => {
    const html = renderToStaticMarkup(
      <exploreAnalysis.View
        result={{ ...full, frequencies: [], normality: [], plots: [] }}
        options={o({})}
        current
      />,
    );
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('Descriptive statistics');
  });
  it('draws the histogram with density, the Q-Q plot and the raincloud; tables of frequencies and tests', async () => {
    const plots = renderToStaticMarkup(<PlotsView r={full} />);
    expect(plots).toContain('Histogram of y · first');
    expect(plots).toContain('Q-Q plot of y · first');
    expect(plots).toContain('Raincloud plot of y');
    expect(plots).toContain('>second<');
    // (the raincloud keys the groups' colours inside its SVG; every plot has a panel for the themes)
    const from = plots.indexOf('aria-label="Raincloud plot of y"');
    const rain = plots.slice(from, plots.indexOf('</svg>', from));
    expect(rain).toContain('aria-label="Legend"');
    expect(rain).toContain('>first</text>');
    expect(rain).toContain('>second</text>');
    expect(plots.match(/class="plot-panel"/g)).toHaveLength(3);
    const freq = renderToStaticMarkup(<FrequencyTables r={full} />);
    expect(freq).toContain('Frequencies: t · first');
    expect(freq).toContain('Missing');
    const norm = renderToStaticMarkup(<NormalityTable r={full} />);
    expect(norm).toContain('Lilliefors');
    // (ggplot2: the bars and density curve; the Q-Q points and line; the groups' violins, boxes and values)
    const hist = await figureOf(<PlotsView r={full} />, 'Histogram of', gg.file);
    expect(hist.layers.map((l) => l.geom)).toEqual(['rect', 'line']);
    expect(hist.y.title).toBe('Density');
    const qq = await figureOf(<PlotsView r={full} />, 'Q-Q plot of', gg.file);
    expect(qq.layers.map((l) => l.geom)).toEqual(['segment', 'point']);
    const cloud = await figureOf(<PlotsView r={full} />, 'Raincloud plot of', gg.file);
    expect(cloud.layers.filter((l) => l.series).map((l) => l.series)).toEqual(['first', 'second']);
    expect(cloud.layers.map((l) => l.geom).slice(0, 5)).toEqual([
      'rect',
      'segment',
      'rect',
      'segment',
      'point',
    ]);
    expect(cloud.x.limits).toEqual([0.5, 2.5]);
  });
});
