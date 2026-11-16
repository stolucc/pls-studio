// The fit indices a Monte Carlo simulation reports for CB-SEM (no engine code: the
// simulation card imports it).

/**
 * The approximate fit indices a simulation reports for CB-SEM, with the usual cutoffs (Hu & Bentler 1999): a
 * replication whose index misses its cutoff counts as rejecting the model. Robust estimators: the robust index.
 */
export const MC_FIT_INDICES = [
  { id: 'cfi', label: 'CFI', cutoff: 0.95, poorBelow: true },
  { id: 'tli', label: 'TLI', cutoff: 0.95, poorBelow: true },
  { id: 'rmsea', label: 'RMSEA', cutoff: 0.06, poorBelow: false },
  { id: 'srmr', label: 'SRMR', cutoff: 0.08, poorBelow: false },
] as const;

export type McFitIndex = (typeof MC_FIT_INDICES)[number];

/** Whether an index value misses its cutoff. */
export const poorFit = (index: McFitIndex, v: number) =>
  index.poorBelow ? v < index.cutoff : v > index.cutoff;

/** The cutoff as a rule, e.g. "< 0.95" (poor fit). */
export const poorFitRule = (index: McFitIndex) => `${index.poorBelow ? '<' : '>'} ${index.cutoff}`;
