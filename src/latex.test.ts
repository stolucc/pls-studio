import { describe, expect, it } from 'vitest';
import { latexNumber, latexText, toLatex } from './latex';

describe('LaTeX tables', () => {
  it('escapes special characters and converts symbols', () => {
    expect(latexText('R² & 50% of $x_1 → y')).toBe('R$^2$ \\& 50\\% of \\$x\\_1 $\\rightarrow$ y');
    expect(latexText('χ² (scaled)')).toBe('$\\chi^2$ (scaled)');
    expect(latexText('ζ dem60 ↔ ζ dem65')).toBe(
      '$\\zeta$ dem60 $\\leftrightarrow$ $\\zeta$ dem65',
    );
    expect(latexText('p <0.001 ***')).toBe('p \\textless{}0.001 ***');
  });
  it('formats numbers as displayed, with a real minus', () => {
    expect(latexNumber(-0.1234, 3)).toBe('$-$0.123');
    expect(latexNumber(-0.0001, 3)).toBe('0.000');
    expect(latexNumber(NaN, 3)).toBe('---');
  });
  it('builds a booktabs table with aligned columns', () => {
    const tex = toLatex({
      title: 'Path coefficients',
      label: 'pls paths',
      columns: ['Path', 'β', 'p'],
      rows: [
        [{ v: 'A → B' }, { v: 0.5 }, { v: '0.012 *' }],
        [{ v: 'B → C' }, { v: null }, { v: null }],
      ],
      note: 'Two-tailed.',
    });
    expect(tex).toContain('\\begin{tabular}{lrl}');
    expect(tex).toContain('\\toprule\n    Path & $\\beta$ & p \\\\\n    \\midrule');
    expect(tex).toContain('A $\\rightarrow$ B & 0.500 & 0.012 * \\\\');
    expect(tex).toContain('B $\\rightarrow$ C & --- & --- \\\\\n    \\bottomrule');
    expect(tex).toContain('\\label{tab:pls-paths}');
    expect(tex).toContain('{\\footnotesize Two-tailed.\\par}');
  });
});
