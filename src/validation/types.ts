// The validation evidence the app shows (public/validation.json): what each example and each validated
// feature was compared with, by the webR tests (src/validation/record.ts), merged by
// scripts/validation/evidence.mjs. The same numbers the tests assert; nothing is typed in by hand.

/**
 * The kind of evidence (kinds, not a ranking: an example often has both published and native evidence, which
 * show different things; useEvidence.ts evidenceKinds lists them):
 * - `published`: reproduces numbers printed by other people with other software (Mplus output, a book's tables);
 * - `native`: equals the same R package run in desktop R on the same data (a reference script), or an
 *   independent computation (numerical integration, a direct call of the package in the same R);
 * - `recovery`: simulated data with known true values, recovered (methods without a reference package);
 * - `runs`: the package's documented example estimates without unexpected warnings; nothing to compare with.
 */
export type EvidenceLevel = 'published' | 'native' | 'recovery' | 'runs';
export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['published', 'native', 'recovery', 'runs'];

export interface EvidenceSource {
  /** e.g. "Mplus User's Guide, example 5.25 (output)", "desktop lavaan, scripts/validation/esem.R". */
  label: string;
  /** Examples: the kind of evidence this source gives (`Check.level` keeps one of them, for sorting; the app shows every kind). */
  level?: EvidenceLevel;
  url?: string;
  /** A reference script in the repository (scripts/validation/...). */
  script?: string;
}

/** One number compared: what the app computed against the reference, and how close it had to be. */
export interface Comparison {
  quantity: string;
  value: number | string;
  reference: number | string;
  /** Allowed absolute difference (0: exact). */
  tolerance: number;
  /** Examples: the label of the source compared with. */
  source?: string;
}

export interface Check {
  /** An example id (`subject: 'example'`) or a feature key (`subject: 'feature'`). */
  id: string;
  subject: 'example' | 'feature';
  title: string;
  /** The method family, for grouping: "CB-SEM", "PLS-SEM", "EFA", … */
  method: string;
  level: EvidenceLevel;
  sources: EvidenceSource[];
  comparisons: Comparison[];
  /** R packages that computed the result (versions are added from the webR lock when merged). */
  packages: string[];
  passed: boolean;
  /** The test that made the check (file and name). */
  test: string;
  /** Examples: a hash of the example's definition, so evidence for an example changed since is detected. */
  definition?: string;
  /** Browser self-check: the result's digest (src/validation/digest.ts) recorded with this check. */
  digest?: Record<string, number>;
  /** The analyses (cards, modes, Model-tab entries: validation/cards.ts keys) this check is evidence for. */
  cards?: string[];
  /**
   * Where the app's numbers were computed: absent, webR (the browser's R); `desktop`, the helper's desktop R (the
   * desktop-only packages, npm run validate:evidence:desktop); `fixture`, no R at all (the built-in engine, or a
   * desktop run recorded in a fixture and compared again).
   */
  runtime?: 'desktop' | 'fixture';
}

export interface Evidence {
  generated: string;
  /** When the desktop-only packages' checks (runtime `desktop`) were last recorded (npm run validate:evidence:desktop). */
  desktop?: string;
  webR: string;
  R: string;
  /** Versions of the R packages, from scripts/webr/webr-lock.json. */
  versions: Record<string, string>;
  checks: Check[];
}
