import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { figureCssVars, FIGURE_PRESETS, PLS_STYLE_ERROR } from './style';
import { NEGATIVE_COLOR, OTHER_COLOR, POSITIVE_COLOR, SERIES_COLORS, seriesColor } from './palette';

describe('chart series colours', () => {
  it('give series k slot k, and grey beyond the eighth instead of repeating a hue', () => {
    expect(SERIES_COLORS).toHaveLength(8);
    expect(new Set(SERIES_COLORS).size).toBe(8);
    expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
    expect(seriesColor(7)).toBe(SERIES_COLORS[7]);
    expect(seriesColor(8)).toBe(OTHER_COLOR);
    expect(POSITIVE_COLOR).not.toBe(NEGATIVE_COLOR);
  });
  it('are the only series palette in the analysis charts', () => {
    const dir = join(__dirname, '..', 'analyses');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('.test.'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\[\s*('#[0-9a-fA-F]{6}',\s*){3,}/);
    }
  });
});

it('the PLS style colours its error terms from one constant, on the canvas as in exports', () => {
  expect(figureCssVars(FIGURE_PRESETS.pls.style)['--pls-error']).toBe(PLS_STYLE_ERROR);
  expect(readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')).not.toContain(PLS_STYLE_ERROR);
});
