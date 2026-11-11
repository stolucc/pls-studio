import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { setVariableInfo } from '../data/columns';
import { DEFAULT_SETTINGS, type DataInfo } from '../model/project';
import { analysisType } from './registry';
import {
  isSplitResult,
  MAX_SPLIT_GROUPS,
  SPLIT_CARDS,
  splitGroups,
  withSplit,
  type SplitResult,
} from './split';
import type { AnalysisCtx, AnalysisType } from './types';

const data: Dataset = {
  names: ['x', 'g', 'town', 'id'],
  cols: [
    Float64Array.from([1, 2, 3, 4, 5, 6, 7]),
    Float64Array.from([2, 1, 2, 1, NaN, 2, 1]),
    Float64Array.from([1, 1, 2, 2, 1, 2, 1]),
    Float64Array.from({ length: 7 }, (_, i) => i),
  ],
  categories: { town: ['Cork', 'Kerry'] },
};
const info: DataInfo = setVariableInfo(
  { fileName: 'd.csv', rows: 7, missingCells: 1, excluded: [] },
  'g',
  { labels: [{ value: 1, label: 'control' }] },
);
const ctx: AnalysisCtx = { data, info, settings: DEFAULT_SETTINGS, pls: null, projectName: '' };

/** A minimal card: the sum of a column (fails for a group with a sum above 10). */
type O = { col: string };
const sumCard: AnalysisType<O, { sum: number }> = {
  id: 'sum',
  title: 'Sum',
  sub: '',
  group: 'Data',
  defaults: () => ({ col: 'x' }),
  parseOptions: (raw) =>
    raw && typeof raw === 'object' && typeof (raw as O).col === 'string'
      ? { col: (raw as O).col }
      : null,
  Options: () => null,
  View: ({ result }) => <p>sum {result.sum}</p>,
  blocked: (o, c) => (c.data!.cols[0].length < 3 ? `too few cases for ${o.col}` : null),
  fingerprint: (o) => o.col,
  run: async (o, c) => {
    const sum = Array.from(c.data!.cols[c.data!.names.indexOf(o.col)]).reduce((a, b) => a + b, 0);
    if (sum > 10) throw new Error('too large');
    return { sum };
  },
  script: async (o, c) => `sum(${o.col}) # ${c.data!.cols[0].length} rows`,
  summary: (o) => `sum of ${o.col}`,
};
const card = withSplit(sumCard);

describe('split by group', () => {
  it('finds the groups with their names: value labels, categories, numbers', () => {
    expect(splitGroups(data, info, 'g')).toEqual([
      { label: 'control', rows: [1, 3, 6] },
      { label: '2', rows: [0, 2, 5] },
    ]);
    expect(splitGroups(data, info, 'town').map((g) => g.label)).toEqual(['Cork', 'Kerry']);
  });

  it('keeps the split column in the options, validated', () => {
    expect(card.parseOptions({ col: 'x', splitBy: 'g' })).toEqual({ col: 'x', splitBy: 'g' });
    expect(card.parseOptions({ col: 'x', splitBy: 7 })).toEqual({ col: 'x' });
    expect(card.parseOptions({ col: 'x', splitBy: '' })).toEqual({ col: 'x' });
    expect(card.parseOptions('junk')).toBeNull();
    expect(card.summary({ col: 'x', splitBy: 'g' } as O)).toBe('sum of x · split by g');
  });

  it('is blocked by unusable columns; its fingerprint follows the groups', () => {
    const s = (splitBy: string) => ({ col: 'x', splitBy }) as O;
    expect(card.blocked(s('nope'), ctx)).toMatch(/not in the data/);
    expect(
      card.blocked(s('id'), {
        ...ctx,
        data: { ...data, cols: data.cols.map((c, k) => (k === 3 ? new Float64Array(7) : c)) },
      }),
    ).toMatch(/fewer than two/);
    const many = Float64Array.from({ length: MAX_SPLIT_GROUPS + 1 }, (_, i) => i);
    const wide: Dataset = { names: ['x', 'k'], cols: [many, many] };
    expect(card.blocked(s('k'), { ...ctx, data: wide })).toMatch(/at most 20 groups/);
    expect(card.blocked(s('g'), ctx)).toBeNull();
    expect(card.fingerprint(s('g'), ctx)).not.toBe(card.fingerprint({ col: 'x' }, ctx));
    expect(card.fingerprint({ col: 'x' }, ctx)).toBe('x');
    const relabelled = { ...ctx, info: setVariableInfo(info, 'g', { labels: null }) };
    expect(card.fingerprint(s('g'), relabelled)).not.toBe(card.fingerprint(s('g'), ctx));
  });

  it('runs once per group, a failing group keeping its message', async () => {
    const r = (await card.run(
      { col: 'x', splitBy: 'g' } as O,
      ctx,
      () => {},
    )) as unknown as SplitResult<{ sum: number }>;
    expect(isSplitResult(r)).toBe(true);
    expect(r.__split.column).toBe('g');
    expect(r.__split.groups).toEqual([
      { label: 'control', n: 3, error: 'too large' }, // 2 + 4 + 7
      { label: '2', n: 3, result: { sum: 10 } }, // 1 + 3 + 6
    ]);
    const html = renderToStaticMarkup(
      <card.View result={r as never} options={{ col: 'x' }} current />,
    );
    expect(html).toContain('g = control');
    expect(html).toContain('too large');
    expect(html).toContain('sum 10');
    // Without a split, the card is the wrapped one.
    await expect(card.run({ col: 'x' }, ctx, () => {})).rejects.toThrow('too large'); // 28
    await expect(card.run({ col: 'x', splitBy: 'town' } as O, ctx, () => {})).rejects.toThrow(
      'too large',
    );
  });

  it('writes one script section per group', async () => {
    const script = await card.script!({ col: 'x', splitBy: 'g' } as O, ctx);
    expect(script).toBe(
      '# ===== g = control (n = 3) =====\n\nsum(x) # 3 rows\n\n# ===== g = 2 (n = 3) =====\n\nsum(x) # 3 rows',
    );
  });

  it('is offered by the basic statistics cards and charts', async () => {
    for (const id of SPLIT_CARDS) {
      const t = analysisType(id)!;
      const o = t.parseOptions({ ...(t.defaults(ctx) as object), splitBy: 'town' });
      expect((o as { splitBy?: string }).splitBy, id).toBe('town');
    }
    expect(
      (analysisType('regression')!.parseOptions({ splitBy: 'town' }) as object | null) ?? {},
    ).not.toHaveProperty('splitBy');
    // A chart (computed in the browser): a histogram per town.
    const chart = analysisType('chart')!;
    const o = { ...chart.defaults(ctx), x: 'x', splitBy: 'town' };
    expect(chart.blocked(o, ctx)).toBeNull();
    const r = (await chart.run(o, ctx, () => {})) as SplitResult<{ n?: number }>;
    expect(r.__split.groups.map((g) => [g.label, g.n])).toEqual([
      ['Cork', 4],
      ['Kerry', 3],
    ]);
  });
});
