// Results tables as LaTeX (booktabs: \toprule, \midrule, \bottomrule).
// Symbols used in the app's tables are converted to their LaTeX equivalents;
// LaTeX's special characters are escaped.

export type LatexCell = number | string | null;

const SYMBOLS: Record<string, string> = {
  '→': '$\\rightarrow$',
  '←': '$\\leftarrow$',
  '↔': '$\\leftrightarrow$',
  '×': '$\\times$',
  '≤': '$\\leq$',
  '≥': '$\\geq$',
  '−': '$-$',
  '±': '$\\pm$',
  '…': '\\ldots{}',
  '—': '---',
  '–': '--',
  '“': '``',
  '”': "''",
  '‘': '`',
  '’': "'",
  '′': '$\\prime$',
  '²': '$^2$',
  '³': '$^3$',
  χ: '$\\chi$',
  α: '$\\alpha$',
  β: '$\\beta$',
  γ: '$\\gamma$',
  δ: '$\\delta$',
  ε: '$\\varepsilon$',
  ζ: '$\\zeta$',
  η: '$\\eta$',
  θ: '$\\theta$',
  λ: '$\\lambda$',
  μ: '$\\mu$',
  ξ: '$\\xi$',
  ρ: '$\\rho$',
  σ: '$\\sigma$',
  τ: '$\\tau$',
  φ: '$\\phi$',
  ψ: '$\\psi$',
  ω: '$\\omega$',
  Δ: '$\\Delta$',
  Σ: '$\\Sigma$',
  Ψ: '$\\Psi$',
  '∞': '$\\infty$',
  '\u00a0': '~',
};
const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
};

/** Escape text for LaTeX and convert the app's symbols. */
export function latexText(s: string): string {
  let out = '';
  for (const ch of s) out += SPECIAL[ch] ?? SYMBOLS[ch] ?? ch;
  // Adjacent math snippets merge ("$\chi$$^2$" → "$\chi^2$").
  return out.replace(/\$\$/g, '');
}

/** A number as displayed, with a proper minus sign. */
export function latexNumber(v: number, digits: number): string {
  if (Number.isNaN(v)) return '---';
  if (!Number.isFinite(v)) return v > 0 ? '$\\infty$' : '$-\\infty$';
  const s = Math.abs(v).toFixed(digits);
  return v < 0 && Number(s) !== 0 ? `$-$${s}` : s;
}

export interface LatexTable {
  title: string;
  label: string;
  columns: string[];
  /** Cells with the number of decimals to show (as in the app). */
  rows: { v: LatexCell; d?: number }[][];
  note?: string;
}

/** A complete table environment; needs \usepackage{booktabs}. */
export function toLatex(t: LatexTable): string {
  const numericCol = t.columns.map(
    (_, j) =>
      j > 0 &&
      t.rows.length > 0 &&
      t.rows.every((r) => r[j]?.v === null || typeof r[j]?.v === 'number'),
  );
  const cell = (c: { v: LatexCell; d?: number } | undefined) => {
    if (c === undefined || c.v === null) return '---';
    if (typeof c.v === 'number') return latexNumber(c.v, c.d ?? 3);
    return latexText(c.v);
  };
  const line = (cells: string[]) => `    ${cells.join(' & ')} \\\\`;
  return [
    '% Requires \\usepackage{booktabs}',
    '\\begin{table}[htbp]',
    '  \\centering',
    `  \\caption{${latexText(t.title)}}`,
    `  \\label{tab:${t.label.replace(/[^A-Za-z0-9:-]+/g, '-')}}`,
    `  \\begin{tabular}{${numericCol.map((n) => (n ? 'r' : 'l')).join('')}}`,
    '    \\toprule',
    line(t.columns.map(latexText)),
    '    \\midrule',
    ...t.rows.map((r) => line(t.columns.map((_, j) => cell(r[j])))),
    '    \\bottomrule',
    '  \\end{tabular}',
    ...(t.note ? ['  \\par\\smallskip', `  {\\footnotesize ${latexText(t.note)}\\par}`] : []),
    '\\end{table}',
    '',
  ].join('\n');
}
