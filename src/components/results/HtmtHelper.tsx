// The Discriminant validity tab's helper for HTMT values that fail: the HTMT inference table
// (bootstrap upper bounds, on demand) and, per failing pair, a "What now?" panel with the
// values, the items that drive them and the options, each with its source.

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { sampleIndices } from '../../engine/bootstrap';
import type { PlsResult } from '../../engine/types';
import { fmt } from '../../format';
import {
  fornellLarckerPair,
  HTMT_DISTINCT,
  HTMT_SIMILAR,
  htmtDraws,
  htmtPairs,
  htmtThreshold,
  htmtVariantOf,
  htmtVerdict,
  indicatorData,
  pairDrivers,
  summariseHtmtDraws,
  type HtmtBootstrap,
  type HtmtPair,
  type HtmtVariant,
  type HtmtVerdict,
  type IndicatorData,
} from '../../measurement/htmt';
import { isSimilarPair, withSimilarPair } from '../../measurement/state';
import { toSpec } from '../../model/project';
import { resultsKey, useStore } from '../../store';
import { IconChevronDown, IconChevronUp, IconPlay, IconX } from '../icons';
import { c, Table, type Row } from './Table';
import './measurement.css';

interface BootState {
  /** The results, samples and seed the bootstrap belongs to. */
  key: string | null;
  result: HtmtBootstrap | null;
  running: { done: number; total: number } | null;
  error: string | null;
}
/** The HTMT bootstrap of the results on screen (not saved: it is recomputed on demand). */
export const useHtmtBoot = create<BootState>(() => ({
  key: null,
  result: null,
  running: null,
  error: null,
}));
let stopToken = 0;

/** Resamples per step between repaints (progress and Cancel stay responsive). */
const CHUNK = 25;

/**
 * Bootstrap the HTMT of the pairs: the rows resampled as the built-in bootstrap draws them
 * (same seed, same resamples), the HTMT recomputed in each, and the 95th percentile kept.
 */
export async function runHtmtBootstrap(
  ind: IndicatorData,
  pairs: [string, string][],
  samples: number,
  seed: number,
  key: string,
  variant: HtmtVariant,
): Promise<void> {
  const token = ++stopToken;
  const n = ind.cols[0]?.length ?? 0;
  useHtmtBoot.setState({ key, result: null, error: null, running: { done: 0, total: samples } });
  const draws: number[][] = pairs.map(() => []);
  try {
    for (let from = 0; from < samples; from += CHUNK) {
      const to = Math.min(samples, from + CHUNK);
      const rowsOf = (b: number) => sampleIndices(seed, b, n);
      const part = htmtDraws(ind, pairs, rowsOf, from, to, variant);
      part.forEach((d, i) => draws[i].push(...d));
      useHtmtBoot.setState({ running: { done: to, total: samples } });
      // Let the page repaint and Cancel run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (token !== stopToken) return;
    }
    const result = summariseHtmtDraws(ind, pairs, draws, seed, variant);
    useHtmtBoot.setState({ result, running: null });
  } catch (e) {
    if (token !== stopToken) return;
    useHtmtBoot.setState({ running: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export function cancelHtmtBootstrap() {
  stopToken++;
  useHtmtBoot.setState({ running: null });
}

const VERDICT_TEXT: Record<HtmtVerdict, string> = {
  fails: 'HTMT at or above the threshold',
  boundFails: 'Upper bound reaches the threshold',
  established: 'Established',
  unconfirmed: 'Below; not yet bootstrapped',
};
const VERDICT_CLASS: Record<HtmtVerdict, string> = {
  fails: 'bad',
  boundFails: 'bad',
  established: 'ok',
  unconfirmed: 'warn',
};

/** Why the bootstrap's HTMT may differ slightly from the table's, or null when it should not. */
function dataNote(pls: PlsResult, missing: string): string | null {
  if (pls.ordinal?.length)
    return 'The bootstrap and the item correlations below use Pearson correlations of the ordinal items; the table’s HTMT comes from the package.';
  if (missing !== 'mean' && missing !== 'casewise')
    return 'The bootstrap and the item correlations below use mean replacement for missing values, so they can differ slightly from the table’s HTMT.';
  return null;
}

export function HtmtHelper({ pls }: { pls: PlsResult }) {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const key = useStore((s) => `${resultsKey(s)}|${s.settings.bootSamples}|${s.settings.seed}`);
  const boot = useHtmtBoot();
  const [open, setOpen] = useState<string | null>(null);

  const ind = useMemo(() => {
    if (!data) return null;
    try {
      return indicatorData(data, toSpec(model), settings.missing);
    } catch {
      return null;
    }
  }, [data, model, settings.missing]);

  const idOf = useMemo(() => new Map(model.constructs.map((k) => [k.name, k.id])), [model]);
  const pairs = useMemo(
    () =>
      htmtPairs(pls).filter((p) => ind?.blocks.get(p.a)?.length && ind?.blocks.get(p.b)?.length),
    [pls, ind],
  );
  if (!pairs.length) return null;

  const similar = (p: HtmtPair) => {
    const a = idOf.get(p.a);
    const b = idOf.get(p.b);
    return !!a && !!b && isSimilarPair(model.measurement, a, b);
  };
  const current = boot.key === key ? boot.result : null;
  const upperOf = (p: HtmtPair) =>
    current?.pairs.find((x) => x.a === p.a && x.b === p.b)?.upper ?? null;
  const rows = pairs.map((p) => {
    const threshold = htmtThreshold(similar(p));
    const upper = upperOf(p);
    return { p, threshold, upper, verdict: htmtVerdict(p.htmt, upper, threshold) };
  });
  const attention = rows.filter((r) => r.verdict === 'fails' || r.verdict === 'boundFails');
  const samples = Math.max(2, Math.floor(settings.bootSamples));
  const running = boot.key === key ? boot.running : null;
  const start = () => {
    if (!ind) return;
    const list = pairs.map((p) => [p.a, p.b] as [string, string]);
    void runHtmtBootstrap(ind, list, samples, settings.seed, key, htmtVariantOf(pls));
  };
  const note = dataNote(pls, settings.missing);

  const tableRows: Row[] = rows.map((r) => [
    c(`${r.p.a} – ${r.p.b}`),
    c(r.p.htmt, r.verdict === 'fails' ? 'bad' : ''),
    c(r.upper, r.verdict === 'boundFails' ? 'bad' : ''),
    c(r.threshold, 'dim', 2),
    c(VERDICT_TEXT[r.verdict], r.verdict === 'established' ? 'good' : 'dim'),
  ]);

  return (
    <div className="mq">
      <div className="mq-head">
        <h3>HTMT inference: what now?</h3>
        {running ? (
          <>
            <div className="progress" aria-label="HTMT bootstrap progress">
              <div className="bar">
                <div
                  className="fill"
                  style={{ width: `${(100 * running.done) / running.total}%` }}
                />
              </div>
              <span className="hint">
                {running.done} of {running.total} samples
              </span>
            </div>
            <button className="btn sm" onClick={cancelHtmtBootstrap}>
              <IconX size={13} /> Cancel
            </button>
          </>
        ) : (
          <button
            className="btn sm primary"
            onClick={start}
            disabled={!ind}
            title={`Resample the rows ${samples} times (seed ${settings.seed}, the bootstrap settings) and recompute every HTMT`}
          >
            <IconPlay size={13} />{' '}
            {current ? 'Run the HTMT bootstrap again' : 'Run the HTMT bootstrap'}
          </button>
        )}
      </div>
      <p className="mq-text">
        A pair passes when its HTMT is below {fmt(HTMT_DISTINCT, 2)} ({fmt(HTMT_SIMILAR, 2)} for
        constructs you mark as conceptually similar; Henseler, Ringle &amp; Sarstedt 2015) and the
        upper bound of its one-sided 95% bootstrap interval is below that threshold too (Franke
        &amp; Sarstedt 2019).
        {current
          ? ` Bootstrap: ${current.samples - current.failed} of ${current.samples} samples, seed ${current.seed}.`
          : ''}
      </p>
      {boot.key === key && boot.error && (
        <p className="mq-text" style={{ color: 'var(--bad)' }}>
          {boot.error}
        </p>
      )}
      <Table
        title="HTMT inference"
        file="htmt-inference"
        columns={['Pair', 'HTMT', '95% upper bound', 'Threshold', 'Verdict']}
        rows={tableRows}
        note={`Upper bound: the 95th percentile of the bootstrap HTMT (one-sided 95% interval; Franke & Sarstedt 2019). Threshold 0.85, or 0.90 for pairs marked conceptually similar (Henseler et al. 2015).${note ? ` ${note}` : ''}`}
      />
      {attention.length > 0 && (
        <div className="mq-pairs">
          {attention.map((r) => {
            const id = `${r.p.a}|${r.p.b}`;
            const isOpen = open === id;
            return (
              <div className="mq-pair" key={id}>
                <div className="mq-pair-head">
                  <span className="mq-pair-name">
                    {r.p.a} and {r.p.b}
                  </span>
                  <span className={`verdict ${VERDICT_CLASS[r.verdict]}`}>
                    {VERDICT_TEXT[r.verdict]}
                  </span>
                  <button
                    className="btn sm"
                    onClick={() => setOpen(isOpen ? null : id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />} What now?
                  </button>
                </div>
                {isOpen && ind && (
                  <PairPanel
                    pls={pls}
                    ind={ind}
                    pair={r.p}
                    threshold={r.threshold}
                    upper={r.upper}
                    verdict={r.verdict}
                    onBootstrap={running ? null : start}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PairPanel({
  pls,
  ind,
  pair,
  threshold,
  upper,
  verdict,
  onBootstrap,
}: {
  pls: PlsResult;
  ind: IndicatorData;
  pair: HtmtPair;
  threshold: number;
  upper: number | null;
  verdict: HtmtVerdict;
  onBootstrap: (() => void) | null;
}) {
  const model = useStore((s) => s.model);
  const commit = useStore((s) => s.commit);
  const drivers = useMemo(() => pairDrivers(ind, pls, pair.a, pair.b), [ind, pls, pair]);
  const fl = fornellLarckerPair(pls, pair.a, pair.b);
  const idA = model.constructs.find((k) => k.name === pair.a)?.id;
  const idB = model.constructs.find((k) => k.name === pair.b)?.id;
  const similar = !!idA && !!idB && isSimilarPair(model.measurement, idA, idB);
  const setSimilar = (on: boolean) => {
    if (!idA || !idB) return;
    commit((m) => ({ ...m, measurement: withSimilarPair(m.measurement, idA, idB, on) }));
  };
  // The items that drive the value: the largest heterotrait correlations (the list is sorted).
  const top = drivers.items.slice(0, Math.min(3, drivers.items.length));
  const lowMono = drivers.items
    .filter((d) => d.mono !== null)
    .sort((x, y) => (x.mono ?? 0) - (y.mono ?? 0))
    .slice(0, 2);

  const itemRows: Row[] = drivers.items.map((d) => [
    c(d.indicator, top.includes(d) ? 'bad' : ''),
    c(d.construct),
    c(d.loading),
    c(d.crossLoading, Math.abs(d.crossLoading) >= Math.abs(d.loading) ? 'bad' : ''),
    c(d.hetero, top.includes(d) ? 'bad' : ''),
    c(d.mono),
  ]);
  const pairRows: Row[] = drivers.itemPairs.slice(0, 5).map((x) => [c(x.a), c(x.b), c(x.r)]);

  return (
    <div className="mq-pair-body">
      <label className="mq-similar">
        <input
          type="checkbox"
          checked={similar}
          onChange={(e) => setSimilar(e.target.checked)}
          disabled={!idA || !idB}
        />
        <span>
          {pair.a} and {pair.b} are conceptually similar: use the threshold 0.90 instead of 0.85
          (Henseler et al. 2015). Saved with the project.
        </span>
      </label>
      <div className="mq-facts">
        <Fact k="HTMT" v={fmt(pair.htmt)} />
        <Fact k="Threshold" v={fmt(threshold, 2)} />
        <Fact k="95% upper bound" v={upper === null ? '—' : fmt(upper)} />
        <Fact k="HTMT2" v={pair.htmt2 === null ? '—' : fmt(pair.htmt2)} />
        {fl && (
          <Fact
            k="Fornell–Larcker"
            v={fl.met ? 'met' : 'violated'}
            title={`|r| = ${fmt(Math.abs(fl.r))} against √AVE ${fmt(fl.sqrtAveA)} and ${fmt(fl.sqrtAveB)}`}
          />
        )}
      </div>
      {upper === null && (
        <div className="mq-actions">
          <span className="hint">
            No bootstrap upper bound yet. Without it, a value below the threshold is not
            established.
          </span>
          {onBootstrap && (
            <button className="btn sm" onClick={onBootstrap}>
              <IconPlay size={13} /> Run the HTMT bootstrap
            </button>
          )}
        </div>
      )}
      <ul className="mq-rules">
        <li>
          HTMT takes precedence over the Fornell–Larcker criterion when they disagree:
          Fornell–Larcker misses most discriminant-validity problems (Henseler et al. 2015; Hair et
          al. 2021).
          {fl?.met ? ' Here Fornell–Larcker is met, but that does not overrule the HTMT.' : ''}
        </li>
        <li>
          A value just below the threshold whose bootstrap upper bound reaches the threshold does
          not establish discriminant validity (Franke &amp; Sarstedt 2019).
          {verdict === 'boundFails'
            ? ` That is the case here: ${fmt(pair.htmt)} is below ${fmt(threshold, 2)}, but the upper bound is ${fmt(upper)}.`
            : ''}
        </li>
      </ul>
      <Table
        title={`Items of ${pair.a} and ${pair.b}`}
        file="htmt-items"
        columns={[
          'Indicator',
          'Construct',
          'Loading',
          'Cross-loading',
          'Mean |r|, other construct',
          'Mean |r|, own construct',
        ]}
        rows={itemRows}
        note="Cross-loading: the item's correlation with the other construct's scores. Sorted by the mean absolute correlation with the other construct's items (heterotrait): the items at the top raise the HTMT most. A low mean correlation with the item's own construct (monotrait) raises it too."
      />
      <Table
        title="Largest correlations between their items"
        file="htmt-item-pairs"
        columns={[pair.a, pair.b, 'r']}
        rows={pairRows}
      />
      <div>
        <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Options</h3>
        <ol className="mq-options">
          <li>
            <strong>Reconsider whether the constructs are distinct.</strong> If theory says they
            measure the same concept, a high HTMT is what you should expect (Henseler et al. 2015).
          </li>
          <li>
            <strong>Remove items, if content validity allows.</strong> Items that correlate highly
            with the other construct’s items or load highly on it lower discriminant validity; so do
            items that correlate weakly with their own construct’s items (Henseler et al. 2015).
            Here, look first at {top.map((d) => d.indicator).join(', ')}
            {lowMono.length
              ? `; the weakest within their own construct are ${lowMono.map((d) => d.indicator).join(', ')}`
              : ''}
            . Change the model, then calculate again.
          </li>
          <li>
            <strong>Merge the constructs</strong> into one, when theory allows it (Henseler et al.
            2015).
          </li>
          <li>
            <strong>Report HTMT inference.</strong> An upper bound below 1 shows that the constructs
            are empirically distinct (Henseler et al. 2015); the stricter test is an upper bound
            below the threshold of {fmt(threshold, 2)} (Franke &amp; Sarstedt 2019).
            {upper !== null
              ? ` Here the upper bound is ${fmt(upper)}: ${upper < 1 ? 'below 1' : 'not below 1'}, and ${upper < threshold ? 'below' : 'not below'} the threshold.`
              : ' Run the HTMT bootstrap to get it.'}
          </li>
        </ol>
      </div>
    </div>
  );
}

function Fact({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="stat-card" title={title}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
