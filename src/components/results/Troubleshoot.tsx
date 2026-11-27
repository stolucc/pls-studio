// The Troubleshoot tab of CB-SEM results: the usual causes of nonconvergence and improper solutions, checked
// on the current model and data (model/troubleshoot.ts). It needs no fit, so it is there when the estimation
// fails outright. A check may offer remedies: each is a change the user chooses (undoable); nothing is refitted
// until they calculate again.

import { useMemo } from 'react';
import type { CbResult } from '../../engine/cbsem';
import type { Dataset } from '../../engine/types';
import type { ModelState, Settings } from '../../model/project';
import { computeColumn } from '../../data/compute';
import { transformData } from '../../data/pipeline';
import {
  applyRemedy,
  findings,
  rescaleMoments,
  swapRescaled,
  triedOptions,
  troubleshoot,
  type CheckStatus,
  type RemedyOption,
  type TroubleCheck,
} from '../../model/troubleshoot';
import { useFreshResults, useStore } from '../../store';
import { IconAlert, IconCheck, IconInfo } from '../icons';

const STATUS_LABEL: Record<CheckStatus, string> = {
  problem: 'Likely cause',
  check: 'Check',
  note: 'Note',
  clear: 'Nothing found',
  skipped: 'Not applicable',
};
const STATUS_CLS: Record<CheckStatus, string> = {
  problem: 'bad',
  check: 'warn',
  note: '',
  clear: 'good',
  skipped: '',
};
const ORDER: CheckStatus[] = ['problem', 'check', 'note', 'clear', 'skipped'];

/** The checks of the current model and data, and of its result when there is one (memoised: they read every indicator pair). */
export function useTroubleshoot(
  model: ModelState,
  data: Dataset | null,
  settings: Settings,
  cb: CbResult | null,
): TroubleCheck[] {
  return useMemo(() => troubleshoot(model, data, settings, cb), [model, data, settings, cb]);
}

/** Make the change a remedy describes; the user calculates again to see whether it helps. */
export function tryRemedy(option: RemedyOption) {
  const s = useStore.getState();
  const r = option.remedy;
  if (r.kind === 'rescale') {
    if (!s.data || !s.dataInfo) return;
    try {
      // (a covariance matrix: the variable rescaled in place, under its new name)
      if (!s.data.cols.length && s.data.moments) {
        s.setData(rescaleMoments(s.data, r.variable, r.divisor, r.name), s.dataInfo);
      } else {
        // (over every case, as the Compute dialog: the filter applies afterwards)
        const next = transformData(s.data, s.dataInfo, (d, i) =>
          computeColumn(d, i, r.name, `\`${r.variable}\` / ${r.divisor}`),
        );
        s.setData(next.data, next.info);
      }
    } catch (e) {
      s.toast('error', (e as Error).message);
      return;
    }
    s.commit((m) => swapRescaled(m, r.variable, r.name));
  } else {
    const out = applyRemedy(r, s.model);
    if (out.settings) s.commitWithSettings(() => out.model, out.settings);
    else s.commit(() => out.model);
  }
  s.toast(
    'success',
    `${option.label}: done. Calculate again to see whether it helps; Undo reverts it.`,
  );
}

function StatusBadge({ status }: { status: CheckStatus }) {
  const cls = STATUS_CLS[status];
  const icon =
    cls === 'good' ? (
      <IconCheck size={13} />
    ) : status === 'note' || status === 'skipped' ? (
      <IconInfo size={13} />
    ) : (
      <IconAlert size={13} />
    );
  return (
    <span className={`adm-badge ${cls}`}>
      {icon}
      {STATUS_LABEL[status]}
    </span>
  );
}

function CheckItem({ check }: { check: TroubleCheck }) {
  return (
    <li className={`trouble-check ${check.status}`} data-testid={`trouble-${check.id}`}>
      <div className="trouble-head">
        <StatusBadge status={check.status} />
        <strong>{check.title}</strong>
      </div>
      <p>{check.finding}</p>
      {check.variables?.length ? (
        <div className="trouble-vars">
          {check.variables.map((v) => (
            <span key={v} className="chip">
              {v}
            </span>
          ))}
        </div>
      ) : null}
      {check.advice && (
        <p>
          <span className="trouble-label">What to try:</span> {check.advice}
        </p>
      )}
      {check.remedies?.length ? (
        <div className="trouble-remedies">
          <span className="trouble-label">Try:</span>
          {check.remedies.map((o) => (
            <button
              key={o.label}
              type="button"
              className="btn sm"
              title={o.detail}
              onClick={() => tryRemedy(o)}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="hint">Source: {check.sources.join('; ')}.</div>
    </li>
  );
}

/** The opening line: whether the last fit converged and what the checks found. */
function summary(cb: CbResult | null, found: TroubleCheck[]): string {
  const problems = found.filter((c) => c.status === 'problem').length;
  const checks = found.length - problems;
  const what = found.length
    ? `${problems ? `${problems} likely cause${problems > 1 ? 's' : ''}` : ''}${problems && checks ? ' and ' : ''}${checks ? `${checks} thing${checks > 1 ? 's' : ''} to check` : ''}`
    : 'nothing to act on';
  const fit = !cb
    ? 'There is no result for this model yet (or the estimation failed): the checks below need none.'
    : cb.converged
      ? 'The last estimation converged; these checks also explain improper solutions (Admissibility, Model fit tab).'
      : `The last estimation did not converge in ${cb.iterations} iterations: the checks below look for the usual causes.`;
  return `${fit} Found: ${what}.`;
}

export function TroubleshootView() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  // (a result of an earlier model or settings would say nothing about this one)
  const cb = useFreshResults()?.cb ?? null;
  const checks = useTroubleshoot(model, data, settings, cb);
  const tried = triedOptions(model);
  const commit = useStore((s) => s.commit);
  if (!checks.length)
    return (
      <div className="empty-results">
        Troubleshooting covers CB-SEM estimated by lavaan or the built-in engine.
      </div>
    );
  const sorted = ORDER.flatMap((st) => checks.filter((c) => c.status === st));
  // (the checks that found nothing, folded so that a failing model shows what matters)
  const shown = sorted.filter((c) => c.status !== 'clear' && c.status !== 'skipped');
  const quiet = sorted.filter((c) => c.status === 'clear' || c.status === 'skipped');
  return (
    <div className="trouble">
      <div className="table-tools">
        <h3>Troubleshoot</h3>
      </div>
      <p className="hint">{summary(cb, findings(checks))}</p>
      {tried.length > 0 && (
        <div className="trouble-tried" data-testid="trouble-tried">
          <span className="trouble-label">Changes you tried:</span>
          {tried.map((t) => (
            <span key={t.key} className="chip">
              {t.label}
              <button
                type="button"
                className="btn sm ghost"
                aria-label={`Turn off: ${t.label}`}
                title="Turn this off again (then calculate)"
                onClick={() =>
                  commit((m) => {
                    const { [t.key]: _off, ...rest } = m;
                    return rest;
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
          <span className="hint">
            {cb
              ? cb.converged
                ? 'The last estimation, with these, converged.'
                : 'The last estimation, with these, did not converge.'
              : 'Calculate to see whether they help.'}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="trouble-list">
          {shown.map((c) => (
            <CheckItem key={c.id} check={c} />
          ))}
        </ul>
      )}
      {quiet.length > 0 && (
        <details className="trouble-quiet" data-testid="trouble-quiet">
          <summary>
            {quiet.length} check{quiet.length > 1 ? 's' : ''} found nothing:{' '}
            {quiet.map((c) => c.title.toLowerCase()).join(', ')}
          </summary>
          <ul className="trouble-list">
            {quiet.map((c) => (
              <CheckItem key={c.id} check={c} />
            ))}
          </ul>
        </details>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        The checks read the model and the data only: nothing is estimated, and nothing changes until
        you choose a remedy (Undo reverts it). They follow Chen et al. (2001) and Kline (2016) on
        the common causes of nonconvergence and improper solutions; a check that finds nothing does
        not prove the model will converge.
      </div>
    </div>
  );
}
