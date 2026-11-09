// The Dynamic fit cutoffs' place in the fit table (analyses/dfiFit.tsx fills it when it loads). A slot rather than
// an import: the fit tab is imported by the model-run and snapshot cards, which the analysis registry imports, and
// dfiFit reads the analyses store, which imports the registry; importing dfiFit from here closed that cycle and left
// the registry with undefined entries.

import type { DfiForFit } from '../../analyses/dfiFit';

export interface DfiFitSlot {
  /** A hook: the Dynamic fit cutoffs of a run current for the model on the canvas, or null. */
  use: () => DfiForFit | null;
  cell: (d: DfiForFit, index: 'χ²' | 'CFI' | 'RMSEA' | 'SRMR') => { text: string; verdict: string; ok: boolean | null } | null;
  note: (d: DfiForFit) => string;
  open: () => void;
}
export const dfiFitSlot: DfiFitSlot = { use: () => null, cell: () => null, note: () => '', open: () => {} };
export function setDfiFitSlot(s: DfiFitSlot) { Object.assign(dfiFitSlot, s); }
