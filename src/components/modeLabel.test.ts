import { describe, expect, it } from 'vitest';
import { modeLabel } from './ConstructNode';

describe('mode label on PLS-SEM constructs', () => {
  const c = (type: 'factor' | 'composite', mode: 'A' | 'B', indicators = ['a1', 'a2']) => ({ type, mode, indicators });
  it('labels every PLS-SEM construct with its mode, marking unusual combinations', () => {
    expect(modeLabel('pls', c('factor', 'A'))).toMatchObject({ text: 'Mode A', unusual: false });
    expect(modeLabel('pls', c('factor', 'B'))).toMatchObject({ text: 'Mode B', unusual: true });
    expect(modeLabel('pls', c('composite', 'B'))).toMatchObject({ text: 'Mode B', unusual: false });
    expect(modeLabel('pls', c('composite', 'A'))).toMatchObject({ text: 'Mode A', unusual: true });
    expect(modeLabel('pls', c('factor', 'A'))!.title).toMatch(/correlations/);
    expect(modeLabel('pls', c('composite', 'B'))!.title).toMatch(/regression/);
    // Henseler (2021): modes are weighting algorithms, not reflective / formative measurement.
    for (const t of [modeLabel('pls', c('factor', 'A'))!.title, modeLabel('pls', c('composite', 'B'))!.title]) expect(t).not.toMatch(/reflective|formative/);
  });
  it('shows nothing outside PLS-SEM or without indicators', () => {
    expect(modeLabel('cbsem', c('factor', 'A'))).toBeNull();
    expect(modeLabel('process', c('factor', 'A'))).toBeNull();
    expect(modeLabel('pls', c('factor', 'A', []))).toBeNull();
  });
});
