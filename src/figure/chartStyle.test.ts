import { describe, expect, it } from 'vitest';
import { DEFAULT_CHART_STYLE, parseChartStyle } from './chartStyle';

describe('parseChartStyle', () => {
  it('keeps valid values and replaces invalid ones', () => {
    expect(
      parseChartStyle({
        font: 'serif',
        size: 14,
        color: '#112233',
        labels: { 'jn:x:w': { x: 'Support', y: '' } },
      }),
    ).toEqual({
      font: 'serif',
      size: 14,
      color: '#112233',
      labels: { 'jn:x:w': { x: 'Support' } },
    });
    expect(
      parseChartStyle({ font: 'comic', size: 99, color: 'red; stroke:url(x)', labels: [] }),
    ).toEqual({ ...DEFAULT_CHART_STYLE, size: 24 });
    expect(parseChartStyle(undefined)).toEqual(DEFAULT_CHART_STYLE);
    expect(parseChartStyle({ labels: { a: { x: 'z'.repeat(500) } } }).labels.a.x).toHaveLength(120);
  });
});
