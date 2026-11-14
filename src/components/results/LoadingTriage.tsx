// The Loadings & weights tab's loading triage for reflective (Mode A) indicators (Hair, Hult,
// Ringle & Sarstedt 2017, 2021): each indicator's verdict, the construct's AVE, ρA and ρC with
// the indicator removed (re-estimated on demand, one run per candidate, cancellable), deletion
// on the author's confirmation only, and the deleted-items log the methods text reports.

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import type { PlsResult } from '../../engine/types';
import { fmt } from '../../format';
import {
  canRemove,
  deletionReason,
  reestimationCandidates,
  removalDecision,
  triageItems,
  withoutIndicator,
  type LoadingBand,
  type TriageItem,
} from '../../measurement/loadings';
import {
  configuredEstimator,
  reestimateRemovals,
  removalKey,
  type CancellableEstimator,
  type RemovalRun,
} from '../../measurement/reestimate';
import { deletedItemText } from '../../measurement/report';
import { withDeletedItem, withoutDeletedItem } from '../../measurement/state';
import { skipOf } from '../../measurement/negativeLoadings';
import { toSpec } from '../../model/project';
import { resultsKey, useStore } from '../../store';
import { confirmDialog, textDialog } from '../Overlays';
import { IconPlay, IconTrash, IconX } from '../icons';
import { loadingCls } from './Table';
import './measurement.css';

interface TriageState {
  /** The results the runs belong to. */
  key: string | null;
  runs: Record<string, RemovalRun>;
  running: { done: number; total: number; by: string } | null;
}
/** Re-estimations of the results on screen (not saved). */
export const useTriage = create<TriageState>(() => ({ key: null, runs: {}, running: null }));
let active: { estimator: CancellableEstimator; stopped: boolean } | null = null;

const BAND_TEXT: Record<LoadingBand, string> = {
  delete: 'Below 0.40: candidate for deletion',
  consider: '0.40–0.70: delete only if AVE or ρC rises above the threshold',
  keep: '0.70 or more: keep',
};

/** The decision of a negative loading, before the deletion rules apply. */
export const NEGATIVE_FIRST =
  'Negative loading: first check whether it is a negatively worded item that needs reverse-coding ' +
  '(the note above the table). Consider deleting it only if it is not.';

export function LoadingTriage({ pls }: { pls: PlsResult }) {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const job = useStore((s) => s.job);
  const key = useStore((s) => resultsKey(s));
  const state = useTriage();
  const [error, setError] = useState<string | null>(null);
  const info = useStore((s) => s.dataInfo);
  const items = useMemo(() => triageItems(model, pls), [model, pls]);
  // A negative loading may be a forgotten reverse-coding: say so before the deletion rules.
  const skip = skipOf(model, info);
  const askReverse = (item: TriageItem) =>
    item.loading < 0 && !skip.reversed.has(item.indicator) && !skip.dismissed.has(item.indicator);
  const log = model.measurement?.deletedItems ?? [];
  if (!items.length && !log.length) return null;

  const runs = state.key === key ? state.runs : {};
  const running = state.key === key ? state.running : null;
  const candidates = reestimationCandidates(items);
  const pending = candidates.filter((x) => !runs[removalKey(x)]);

  const start = async () => {
    if (!data || !pending.length) return;
    setError(null);
    const estimator = configuredEstimator(data, settings, toSpec(model));
    const me = { estimator, stopped: false };
    active = me;
    const base = state.key === key ? state.runs : {};
    useTriage.setState({
      key,
      runs: base,
      running: { done: 0, total: pending.length, by: estimator.by },
    });
    try {
      const done = await reestimateRemovals(
        model,
        pending,
        estimator.estimate,
        (d, total) => {
          if (!me.stopped) useTriage.setState({ running: { done: d, total, by: estimator.by } });
        },
        () => me.stopped,
      );
      if (me.stopped) return;
      const next = { ...base };
      for (const r of done) next[removalKey(r)] = r;
      useTriage.setState({ runs: next, running: null });
      const failed = done.filter((r) => r.error);
      if (failed.length) setError(`${failed[0].indicator}: ${failed[0].error}`);
    } finally {
      if (active === me) active = null;
    }
  };
  const cancel = () => {
    if (active) {
      active.stopped = true;
      active.estimator.cancel();
      active = null;
    }
    useTriage.setState({ running: null });
  };

  const remove = async (item: TriageItem) => {
    const run = runs[removalKey(item)];
    const after = run?.after ?? null;
    const reason = deletionReason(item, after);
    // (the reason names the new values when the rule applied; otherwise say what changes)
    const change =
      after && !reason.includes('removal raised')
        ? ` AVE ${fmt(item.before.ave, 2)} → ${fmt(after.ave, 2)}, ρC ${fmt(item.before.rhoC, 2)} → ${fmt(after.rhoC, 2)}.`
        : '';
    const text = await textDialog({
      title: `Delete ${item.indicator} from ${item.construct}?`,
      body: `This removes the indicator from the model and records it in the deleted-items log, which the methods text and the reviewer checklist report. ${reason}${change} Undo restores it.`,
      confirmLabel: 'Delete indicator',
      danger: true,
      text: {
        label: 'Note on content validity (optional)',
        allowEmpty: true,
        check: (t) => (t.length > 1000 ? 'At most 1,000 characters.' : null),
      },
    });
    if (text === null) return;
    const note = text.trim();
    useStore.getState().commit((m) => {
      const without = withoutIndicator(m, item.constructId, item.indicator);
      return {
        ...without,
        measurement: withDeletedItem(m.measurement, {
          indicator: item.indicator,
          construct: item.construct,
          loading: item.loading,
          reason,
          ...(note ? { note } : {}),
          before: item.before,
          ...(after ? { after } : {}),
        }),
      };
    });
  };

  const forget = async (index: number) => {
    const entry = log[index];
    const ok = await confirmDialog({
      title: `Remove ${entry.indicator} from the deleted-items log?`,
      body: 'Do this only if the indicator is back in the model. The log entry will no longer appear in the methods text and the checklist.',
      confirmLabel: 'Remove entry',
    });
    if (!ok) return;
    useStore.getState().commit((m) => ({
      ...m,
      measurement: withoutDeletedItem(m.measurement, index),
    }));
  };

  return (
    <div className="mq">
      <div className="mq-head">
        <h3>Loading triage (reflective indicators)</h3>
        {running ? (
          <>
            <div className="progress" aria-label="Re-estimation progress">
              <div className="bar">
                <div
                  className="fill"
                  style={{ width: `${(100 * running.done) / Math.max(1, running.total)}%` }}
                />
              </div>
              <span className="hint">
                {running.done} of {running.total} runs with {running.by}
              </span>
            </div>
            <button className="btn sm" onClick={cancel}>
              <IconX size={13} /> Cancel
            </button>
          </>
        ) : (
          pending.length > 0 && (
            <button
              className="btn sm primary"
              onClick={() => void start()}
              disabled={!data || !!job}
              title={job ? 'Wait for the calculation in progress' : undefined}
            >
              <IconPlay size={13} /> Re-estimate without each indicator below 0.70 ({pending.length}{' '}
              {pending.length === 1 ? 'run' : 'runs'})
            </button>
          )
        )}
      </div>
      <p className="mq-text">
        Hair et al. (2017, 2021): a loading below 0.40 is a candidate for deletion; a loading
        between 0.40 and 0.70 is deleted only if removing it raises the construct’s AVE to 0.50 or
        its composite reliability ρC to 0.70, and content validity does not suffer; a loading of
        0.70 or more is kept. The values “if removed” come from estimating the model again without
        the indicator, with the current settings; the construct’s current value is in brackets.
        Nothing is deleted unless you confirm it.
      </p>
      {error && (
        <p className="mq-text" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      )}
      {/* (the report leaves out this table of buttons; the deleted-items log below is reported) */}
      {items.length > 0 && (
        <table className="grid mq-table report-skip">
          <thead>
            <tr>
              <th>Indicator</th>
              <th>Construct</th>
              <th>Loading</th>
              <th>Rule</th>
              <th>If removed (now)</th>
              <th>Decision</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <TriageRow
                key={removalKey(item)}
                item={item}
                run={runs[removalKey(item)]}
                askReverse={askReverse(item)}
                onDelete={() => void remove(item)}
              />
            ))}
          </tbody>
        </table>
      )}
      {log.length > 0 && (
        <div>
          <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Deleted items</h3>
          <ul className="mq-log">
            {log.map((d, i) => (
              <li key={`${d.indicator}-${i}`}>
                <span>
                  {deletedItemText(d)}. {d.reason}
                  {d.note ? ` Note: ${d.note}` : ''}
                </span>
                <button
                  className="btn sm ghost icon"
                  onClick={() => void forget(i)}
                  title="Remove this entry from the log"
                  aria-label={`Remove ${d.indicator} from the log`}
                >
                  <IconTrash size={13} />
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">
            The methods text and the reviewer checklist list these as “Items deleted”.
          </p>
        </div>
      )}
    </div>
  );
}

function TriageRow({
  item,
  run,
  askReverse,
  onDelete,
}: {
  item: TriageItem;
  run: RemovalRun | undefined;
  /** The loading is negative and the item is neither reversed nor dismissed. */
  askReverse: boolean;
  onDelete: () => void;
}) {
  const after = run?.after ?? null;
  let decision: string;
  if (askReverse) decision = NEGATIVE_FIRST;
  else if (item.band === 'keep') decision = 'Keep.';
  else if (!canRemove(item)) decision = 'Removal would leave a single indicator: keep it.';
  else if (run?.error) decision = `Not re-estimated: ${run.error}`;
  else if (item.band === 'delete') decision = 'Candidate for deletion, if content validity allows.';
  else if (after) decision = removalDecision(item.before, after).why;
  else decision = 'Re-estimate to see the effect of removing it.';
  const line = (label: string, v: number | undefined, was: number, shown = true) => {
    let cls = 'dim';
    if (v !== undefined && v > was) cls = 'good';
    return (
      <div className={`mq-if ${v === undefined ? '' : cls}`}>
        {label} {!shown ? '—' : v === undefined ? '—' : fmt(v)}{' '}
        <span className="dim">({shown ? fmt(was) : '—'})</span>
      </div>
    );
  };
  return (
    <tr>
      <td>{item.indicator}</td>
      <td>{item.construct}</td>
      <td className={`num ${loadingCls(item.loading)}`}>{fmt(item.loading)}</td>
      <td className="mq-why">{BAND_TEXT[item.band]}</td>
      <td className="num">
        {item.band === 'keep' || !canRemove(item) ? (
          <span className="dim">—</span>
        ) : (
          <>
            {line('AVE', after?.ave, item.before.ave)}
            {/* (ρA does not apply to a composite: the results report none) */}
            {line('ρA', after?.rhoA, item.before.rhoA, item.factor)}
            {line('ρC', after?.rhoC, item.before.rhoC)}
          </>
        )}
      </td>
      <td className="mq-why">{decision}</td>
      <td>
        {item.band !== 'keep' && canRemove(item) && (
          <button
            className="btn sm danger"
            onClick={onDelete}
            title={`Delete ${item.indicator} from ${item.construct} (asks first)`}
          >
            <IconTrash size={13} /> Delete…
          </button>
        )}
      </td>
    </tr>
  );
}
