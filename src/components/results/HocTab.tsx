// The "Higher-order constructs" tab of the PLS results: for each HOC its type,
// the checks that apply at each level for that type and the estimation
// approach, filled from the results (reporting/hoc.ts), what not to interpret,
// and advice on the questions that come up most.

import type { BootstrapResult, PlsResult } from '../../engine/types';
import { HOC_APPROACH_NAMES } from '../../model/project';
import { citeText } from '../../reporting/citations';
import {
  hocChecks,
  type HocCheck,
  type HocLine,
  type HocStatus,
  type HocTab as HocTabId,
} from '../../reporting/hoc';
import { useStore } from '../../store';
import { IconAlert, IconCheck, IconHelp } from '../icons';
import { c, Table, type Row } from './Table';

const STATUS_TEXT: Record<HocStatus, string> = {
  pass: 'Pass',
  attention: 'Attention',
  na: 'Not applicable',
  notComputed: 'Not computed',
};

/** The checklist styles (styles.css .checklist-item) by status. */
const STATUS_CLASS: Record<HocStatus, string> = {
  pass: 'good',
  attention: 'warn',
  na: 'dim',
  notComputed: 'dim',
};

const StatusIcon = ({ s }: { s: HocStatus }) => {
  if (s === 'pass') return <IconCheck size={15} />;
  if (s === 'attention') return <IconAlert size={15} />;
  if (s === 'notComputed') return <IconHelp size={15} />;
  return <span aria-hidden="true">–</span>;
};

/** The results tabs a line can point to, by label (as PLS_TABS names them). */
const TAB_LABEL: Record<HocTabId, string> = {
  outer: 'Loadings & weights',
  reliability: 'Reliability',
  discriminant: 'Discriminant validity',
  paths: 'Path coefficients',
  overview: 'Overview',
  bootstrap: 'Bootstrapping',
};

const LEVELS: HocLine['level'][] = [
  'Lower-order components',
  'Higher-order construct',
  'Structural model',
];

const cite = (keys: string[]) => keys.map((k) => citeText(k)).join('; ');

type OnTab = ((tab: HocTabId) => void) | undefined;

function LineItem({ line, onTab }: { line: HocLine; onTab: OnTab }) {
  const status = STATUS_TEXT[line.status];
  return (
    <li className={`checklist-item ${STATUS_CLASS[line.status]}`}>
      <span className="checklist-status" title={status} aria-label={status} role="img">
        <StatusIcon s={line.status} />
      </span>
      <div className="checklist-body">
        <div className="checklist-label">
          {line.check} <span className="checklist-tag">{status}</span>
        </div>
        {line.value && (
          <div className="hoc-value">
            {line.value}
            {line.computed && <span className="hint"> (computed by PLS Studio)</span>}
          </div>
        )}
        <div className="checklist-evidence">{line.detail}</div>
        <div className="checklist-meta">
          <span className="muted">Rule: {line.threshold}</span>
          {line.tab && onTab && (
            <button
              className="btn sm ghost"
              onClick={() => onTab(line.tab!)}
              title="Open the table this value comes from"
            >
              {TAB_LABEL[line.tab]}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The check as a table, for copying into a report or a reply to reviewers. */
function summaryRows(check: HocCheck): Row[] {
  return check.lines.map((l) => [
    c(l.level),
    c(l.check),
    c(l.value || null),
    c(l.threshold),
    c(STATUS_TEXT[l.status]),
  ]);
}

function HocSection({ check, onTab }: { check: HocCheck; onTab: OnTab }) {
  return (
    <section className="hoc-section">
      <div className="hoc-head">
        <h3>{check.name}</h3>
        <span className="hoc-type">{check.type.label}</span>
        <span className="hint">
          {HOC_APPROACH_NAMES[check.approach]} approach · dimensions {check.components.join(', ')}
        </span>
      </div>
      <p className="hoc-explain">
        {check.type.explanation} Which statistics apply depends on the type and the approach
        (Ringle, Sarstedt &amp; Straub, 2012; Becker, Klein &amp; Wetzels, 2012; Sarstedt et al.,
        2019). “Not computed” marks a statistic the results do not contain: it is never estimated
        here.
      </p>
      {LEVELS.map((level) => {
        const lines = check.lines.filter((l) => l.level === level);
        if (!lines.length) return null;
        return (
          <div key={level}>
            <h4 className="checklist-section">{level}</h4>
            <ul className="checklist-items">
              {lines.map((l) => (
                <LineItem key={l.id} line={l} onTab={onTab} />
              ))}
            </ul>
          </div>
        );
      })}
      {check.ignore.length > 0 && (
        <div>
          <h4 className="checklist-section">Do not interpret for {check.name}</h4>
          <ul className="checklist-items">
            {check.ignore.map((i) => (
              <li key={i.what} className="checklist-item dim">
                <span className="checklist-status" aria-hidden="true">
                  ×
                </span>
                <div className="checklist-body">
                  <div className="checklist-label">{i.what}</div>
                  {i.value && <div className="hoc-value">{i.value}</div>}
                  <div className="checklist-evidence">
                    {i.why} <span className="muted">({cite(i.sources)})</span>
                  </div>
                  {i.tab && onTab && (
                    <div className="checklist-meta">
                      <button className="btn sm ghost" onClick={() => onTab(i.tab!)}>
                        {TAB_LABEL[i.tab]}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {check.advice.length > 0 && (
        <div className="hoc-advice">
          <h4 className="checklist-section">Common questions</h4>
          {check.advice.map((a) => (
            <div key={a.title}>
              <h4>{a.title}</h4>
              <p>
                {a.text} <span className="hint">({cite(a.sources)})</span>
              </p>
            </div>
          ))}
        </div>
      )}
      <Table
        title={`Summary of the check of ${check.name}`}
        file={`hoc-${check.name}`}
        columns={['Level', 'Check', 'Value', 'Rule (source)', 'Status']}
        rows={summaryRows(check)}
      />
    </section>
  );
}

/** The guided check of every higher-order construct (nothing when the model has none). */
export function HocTab({
  pls,
  boot,
  onTab,
}: {
  pls: PlsResult;
  boot: BootstrapResult | null;
  onTab?: (tab: HocTabId) => void;
}) {
  const model = useStore((s) => s.model);
  const approach = useStore((s) => s.settings.hocApproach);
  const plsPackage = useStore((s) => s.settings.plsPackage);
  const checks = hocChecks({ model, pls, boot, approach, plsPackage });
  return <HocChecksView checks={checks} onTab={onTab} />;
}

/** The checks of the model's higher-order constructs, one section each. */
export function HocChecksView({ checks, onTab }: { checks: HocCheck[]; onTab?: OnTab }) {
  if (!checks.length) {
    return <div className="empty-results">The model has no higher-order constructs.</div>;
  }
  return (
    <div className="hoc-tab">
      {checks.map((h) => (
        <HocSection key={h.name} check={h} onTab={onTab} />
      ))}
    </div>
  );
}
