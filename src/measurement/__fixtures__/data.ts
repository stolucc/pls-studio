// For tests: the two documented examples of the measurement-quality references
// (scripts/validation/htmt_bootstrap.R, loading_triage.R), as the app opens them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Dataset, PlsOptions } from '../../engine/types';
import { exampleModel, PACKAGE_EXAMPLES } from '../../examples/packages';
import type { ModelState } from '../../model/project';

const ROOT = join(__dirname, '..', '..', '..');

/** A dataset bundled with the app (public/examples/data/…; null is missing). */
function bundled(file: string): Dataset {
  const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'examples', 'data', file), 'utf8')) as {
    names: string[];
    cols: (number | null)[][];
  };
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (v === null ? NaN : v))),
  };
}

/** The example's model, its Mode A constructs reflective (common factors, as the references' cSEM =~). */
function model(id: string): ModelState {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error(`No example ${id}`);
  const m = exampleModel(ex);
  return {
    ...m,
    constructs: m.constructs.map((k) => (k.mode === 'A' ? { ...k, type: 'factor' as const } : k)),
  };
}

/** seminr's mobi and the ECSI model of the "Mobile phone satisfaction" example. */
export const mobi = () => ({ data: bundled('seminr/mobi.json'), model: model('seminr-mobi') });

/** seminr's corp_rep_data (-99 missing) and the extended corporate reputation model. */
export const corpRep = () => ({
  data: bundled('seminr/corp_rep_data.na-99.json'),
  model: model('seminr-corprep'),
});

/** The references' settings: PLS, path weighting, mean replacement, tolerance 1e-10. */
export const REFERENCE_OPTIONS: PlsOptions = {
  scheme: 'path',
  consistent: false,
  missing: 'mean',
  tolerance: 1e-10,
  maxIter: 1000,
};

/** The HTMT bootstrap reference (cSEM on resamples drawn in R). */
export interface HtmtBootstrapFixture {
  cSEM: string;
  constructs: string[];
  pairs: [string, string][];
  indices: number[][];
  original: number[];
  draws: number[][];
  upper95: number[];
  seminr: string;
  originalAbsolute: number[];
  drawsAbsolute: number[][];
  upper95Absolute: number[];
}

/** The loading triage reference (seminr and cSEM without one indicator at a time). */
export interface TriageFixtureRun {
  removed: string;
  seminr: Record<string, { alpha: number; rhoC: number; rhoA: number; ave: number }>;
  cSEM: Record<string, { rhoC: number | null; ave: number | null }>;
}
export interface TriageFixture {
  seminr: string;
  cSEM: string;
  mobi: TriageFixtureRun[];
  corprep: TriageFixtureRun[];
}

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8')) as T;
}
