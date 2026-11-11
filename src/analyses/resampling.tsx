// Robust, bootstrap and permutation alternatives on the t-test, ANOVA, correlation and
// regression cards (R/robust.R): the options (parsed strictly from project files), their form
// and the tables of their results.

import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import {
  RESAMPLING_DEFAULTS,
  type BootInterval,
  type PermutationTest,
  type ResamplingEcho,
  type ResamplingOptions,
} from '../rengine/resampling';
import { clampNum, isObj, NumField } from './common';

export type { ResamplingOptions } from '../rengine/resampling';

/** The alternatives a card can offer. */
export type ResamplingKind = 'trimmed' | 'bootstrap' | 'permutation';

/** The modes with their own evidence (validation/cards.ts). */
export const RESAMPLING_MODES = ['trimmed', 'bootstrap', 'permutation'] as const;

/** The options from a project file (untrusted): null when absent or nothing is on. */
export function parseResampling(raw: unknown): ResamplingOptions | null {
  if (!isObj(raw)) return null;
  const o: ResamplingOptions = {
    trimmed: raw.trimmed === true,
    trim: clampNum(raw.trim, 0, 0.45, RESAMPLING_DEFAULTS.trim),
    bootstrap: raw.bootstrap === true,
    permutation: raw.permutation === true,
    resamples: clampNum(raw.resamples, 100, 100000, RESAMPLING_DEFAULTS.resamples, true),
  };
  return o.trimmed || o.bootstrap || o.permutation ? o : null;
}

/** The options of a card's project-file options, as a part to spread in. */
export function resamplingPart(raw: Record<string, unknown>): { resampling?: ResamplingOptions } {
  const resampling = parseResampling(raw.resampling);
  return resampling ? { resampling } : {};
}

/** Options with the alternatives set, or without the key when none is on. */
export function withResampling<T extends { resampling?: ResamplingOptions | null }>(
  o: T,
  r: ResamplingOptions,
): T {
  if (r.trimmed || r.bootstrap || r.permutation) return { ...o, resampling: r };
  const { resampling: _off, ...rest } = o;
  return rest as T;
}

/** The alternatives' part of a card's fingerprint (the seed too: the draws depend on it). */
export function resamplingFingerprint(
  o: ResamplingOptions | null | undefined,
  seed: number,
): (string | number)[] {
  if (!o) return [];
  return ['resampling', JSON.stringify(o), seed];
}

const KIND_LABEL: Record<ResamplingKind, string> = {
  trimmed: 'Trimmed means (robust)',
  bootstrap: 'Bootstrap intervals',
  permutation: 'Permutation test',
};

/** The form: a checkbox per alternative the card offers, the trimming and the resamples. */
export function ResamplingFields({
  value,
  set,
  offer,
  labels = {},
  hint,
}: {
  value: ResamplingOptions | null | undefined;
  set: (o: ResamplingOptions) => void;
  offer: ResamplingKind[];
  labels?: Partial<Record<ResamplingKind, string>>;
  hint?: string;
}) {
  const o = value ?? RESAMPLING_DEFAULTS;
  const resampled = (o.bootstrap && offer.includes('bootstrap')) || o.permutation;
  return (
    <div className="field">
      <label>Robust and resampling alternatives (two-sided)</label>
      <div className="chips">
        {offer.map((k) => (
          <label className="check" key={k}>
            <input
              type="checkbox"
              checked={o[k]}
              onChange={(e) => set({ ...o, [k]: e.target.checked })}
            />{' '}
            {labels[k] ?? KIND_LABEL[k]}
          </label>
        ))}
      </div>
      {(o.trimmed || resampled) && (
        <div className="row2">
          {o.trimmed && (
            <NumField
              id="rs-trim"
              label="Trimmed from each end"
              value={o.trim}
              lo={0}
              hi={0.45}
              step={0.05}
              onChange={(trim) => set({ ...o, trim })}
            />
          )}
          {resampled && (
            <NumField
              id="rs-resamples"
              label="Resamples"
              value={o.resamples}
              lo={100}
              hi={100000}
              step={1000}
              int
              onChange={(resamples) => set({ ...o, resamples })}
            />
          )}
        </div>
      )}
      {hint && <div className="hint">{hint}</div>}
      {resampled && (
        <div className="hint">The resamples are drawn with the project’s seed (Settings).</div>
      )}
    </div>
  );
}

const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const ci = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo === null || lo === undefined || hi === null || hi === undefined
    ? '—'
    : `[${fmt(lo)}, ${fmt(hi)}]`;

/** A permutation p-value: none of the resamples as extreme reads as below one over their number. */
export function permP(p: PermutationTest | null | undefined, resamples: number) {
  if (!p) return c(null);
  // (none of the resamples as extreme as the data: the p-value is below one over their number)
  if (p.p === 0) return c(`< ${Number((1 / resamples).toPrecision(2))}`);
  return pCell(p.p);
}

/** One row of a bootstrap table: label, estimate, SE, percentile and BCa intervals. */
export function bootRow(label: string, b: BootInterval): Row {
  return [
    c(label),
    c(b.estimate),
    c(b.se),
    c(ci(b.percLow, b.percHigh)),
    c(ci(b.bcaLow, b.bcaHigh)),
  ];
}

/** The columns of a bootstrap table. */
export const bootColumns = (conf: number, what = 'Estimate') => [
  '',
  what,
  'Bootstrap SE',
  `${pct(conf)} CI (percentile)`,
  `${pct(conf)} CI (BCa)`,
];

/** The note of a bootstrap or permutation table: resamples and seed. */
export const resampleNote = (e: ResamplingEcho, what: string) =>
  `${what}: ${e.resamples} resamples, seed ${e.seed}.`;

/** Robust and permutation ANOVA results (R's resampling block of the ANOVA card). */
export interface AnovaResampling extends ResamplingEcho {
  trim: number;
  robust:
    | {
        term: string;
        stat: number;
        df1?: number;
        df2?: number;
        p: number;
        effsize?: number;
        effsizeLow?: number;
        effsizeHigh?: number;
      }[]
    | null;
  permutation: { term: string; stat: number; p: number } | null;
}

/** The ANOVA card's robust and permutation tables. */
export function AnovaResamplingView({ r, conf }: { r: AnovaResampling; conf: number }) {
  const oneway = r.robust?.length === 1;
  return (
    <>
      {r.robust && oneway && (
        <Table
          title={`Robust one-way ANOVA on ${fmt(r.trim, 2)}-trimmed means (WRS2::t1way)`}
          file="anova-trimmed"
          columns={['Term', 'F', 'df1', 'df2', 'p', 'Effect size ξ', `${pct(conf)} CI of ξ`]}
          rows={r.robust.map(
            (x): Row => [
              c(x.term),
              c(x.stat),
              c(x.df1 ?? null, undefined, 0),
              c(x.df2 ?? null),
              pCell(x.p),
              c(x.effsize ?? null),
              c(ci(x.effsizeLow, x.effsizeHigh)),
            ],
          )}
          note={`Welch-type test of the trimmed means; ξ is WRS2’s explanatory measure of effect size (its interval a bootstrap with 100 resamples, seed ${r.seed}).`}
        />
      )}
      {r.robust && !oneway && (
        <Table
          title={`Robust two-way ANOVA on ${fmt(r.trim, 2)}-trimmed means (WRS2::t2way)`}
          file="anova-trimmed"
          columns={['Term', 'Q', 'p']}
          rows={r.robust.map((x): Row => [c(x.term), c(x.stat), pCell(x.p)])}
          note="WRS2 finds the p-values on a grid of 0.001 (Johansen’s test of the trimmed means)."
        />
      )}
      {r.permutation && (
        <Table
          title={`Permutation test: ${r.permutation.term}`}
          file="anova-permutation"
          columns={['Term', 'Statistic', 'p (Monte Carlo)']}
          rows={[
            [
              c(r.permutation.term),
              c(r.permutation.stat),
              permP({ z: r.permutation.stat, p: r.permutation.p }, r.resamples),
            ],
          ]}
          note={`${resampleNote(r, 'coin::oneway_test, the groups’ labels permuted')} The statistic is coin’s standardised (two groups) or quadratic (more) form of the group sums.`}
        />
      )}
    </>
  );
}
