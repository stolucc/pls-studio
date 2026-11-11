import { describe, expect, it } from 'vitest';
import { indicatorLabels, type LabelSource } from './diagramLabels';

const factor = { indicators: ['x1', 'x2', 'x3'], type: 'factor' as const };

describe('indicator labels', () => {
  it('CB-SEM shows the marker loading fixed to 1 before any results', () => {
    expect(indicatorLabels(factor, 'cbsem', null)).toEqual([
      { text: '1', level: 'ok', fixed: true },
      null,
      null,
    ]);
    expect(indicatorLabels({ ...factor, covariate: true }, 'cbsem', null)).toBeNull();
    expect(indicatorLabels(factor, 'pls', null)).toBeNull();
  });
  it('unstandardised: the marker reads 1, others their estimates', () => {
    const src: LabelSource = {
      indicator: (n) => ({ x1: 1, x2: 1.234, x3: 0.9 })[n] ?? null,
      fixed: (n) => n === 'x1',
      reflectiveThresholds: () => false,
    };
    expect(indicatorLabels(factor, 'cbsem', src)!.map((l) => l?.text)).toEqual([
      '1',
      '1.234',
      '0.900',
    ]);
    expect(indicatorLabels(factor, 'cbsem', src)![0]!.fixed).toBe(true);
  });
  it('standardised: the marker keeps its fixed mark; weak loadings are flagged', () => {
    const src: LabelSource = {
      indicator: (n) => ({ x1: 0.85, x2: 0.35, x3: 0.6 })[n] ?? null,
      fixed: (n) => n === 'x1',
      reflectiveThresholds: () => true,
    };
    const l = indicatorLabels(factor, 'cbsem', src)!;
    expect(l.map((x) => [x!.text, x!.level, !!x!.fixed])).toEqual([
      ['0.850', 'ok', true],
      ['0.350', 'low', false],
      ['0.600', 'mid', false],
    ]);
  });
});
