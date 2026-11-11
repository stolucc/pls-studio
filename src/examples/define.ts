// Building blocks for example definitions (packages.ts and the Mplus chapters in mplus/).

import type { Settings } from '../model/project';

export interface ExConstruct {
  name: string;
  type?: 'factor' | 'composite';
  mode?: 'A' | 'B';
  indicators?: string[];
  components?: string[];
  /** Observed covariate (CB-SEM fixed.x; conditional process analysis: enters every equation). */
  covariate?: boolean;
  /** Loading labels by indicator: loadings with the same label are equal. */
  labels?: Record<string, string>;
}

export const f = (
  name: string,
  indicators: string[],
  labels?: Record<string, string>,
): ExConstruct => ({ name, type: 'factor', mode: 'A', indicators, ...(labels ? { labels } : {}) });
/** A single observed variable (conditional process analysis), optionally a covariate. */
export const v = (name: string, covariate = false): ExConstruct => ({
  name,
  type: 'factor',
  mode: 'A',
  indicators: [name],
  ...(covariate ? { covariate } : {}),
});
export const c = (name: string, indicators: string[], mode: 'A' | 'B' = 'B'): ExConstruct => ({
  name,
  type: 'composite',
  mode,
  indicators,
});
export const items = (p: string, k: number, from = 1) =>
  Array.from({ length: k }, (_, i) => `${p}${i + from}`);
export const fan = (from: string[], to: string[]) =>
  from.flatMap((a) => to.map((b): [string, string] => [a, b]));
export const CB = (estimator: Settings['estimator']): Partial<Settings> => ({
  method: 'cbsem',
  estimator,
  missing: 'casewise',
});
