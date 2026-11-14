// The Admissibility section of the CB-SEM results (Model fit tab) and the explanations of lavaan's
// warnings. The section grades the solution (engine/admissibility.ts) and names the parameters
// responsible and the likely causes; each known warning opens a plain-language explanation.

import { useState } from 'react';
import type { CbResult } from '../../engine/cbsem';
import {
  checkAdmissibility,
  STATUS_LABEL,
  type Admissibility,
  type AdmissibilityStatus,
  type Severity,
} from '../../engine/admissibility';
import { explainWarning, type WarningExplanation } from '../../rengine/lavaanWarnings';
import { useEscape } from '../useEscape';
import { IconAlert, IconCheck, IconInfo } from '../icons';
import { c, Table, type Row } from './Table';

const SEVERITY_LABEL: Record<Severity, string> = {
  serious: 'Serious',
  check: 'Check',
  numerical: 'Numerical',
};
const SEVERITY_CLS: Record<Severity, string> = { serious: 'bad', check: 'warn', numerical: '' };
const STATUS_CLS: Record<AdmissibilityStatus, string> = {
  admissible: 'good',
  numerical: 'good',
  check: 'warn',
  serious: 'bad',
};

/** R code that runs the same matrix checks on a lavaan fit, for the methods appendix. */
const R_SNIPPET = [
  '# Admissibility checks on a lavaan fit (as PLS Studio runs them)',
  'eigen(lavInspect(fit, "cov.ov"))$values  # model-implied covariance matrix',
  'eigen(lavInspect(fit, "cov.lv"))$values  # covariance matrix of the latent variables',
  'eigen(lavInspect(fit, "theta"))$values   # residual covariance matrix',
  'eigen(lavInspect(fit, "vcov"))$values    # covariance matrix of the estimates',
  'parameterEstimates(fit)[, c("lhs", "op", "rhs", "est", "se", "ci.lower", "ci.upper")]',
  'lavInspect(fit, "cor.lv")                 # latent correlations',
].join('\n');

function Badge({ status }: { status: AdmissibilityStatus }) {
  const cls = STATUS_CLS[status];
  const icon = cls === 'good' ? <IconCheck size={14} /> : <IconAlert size={14} />;
  return (
    <span className={`adm-badge ${cls}`} data-testid="admissibility-badge">
      {/* (the report keeps the verdict's text, not the icon: report/extract.ts takes an svg for a chart) */}
      <span className="report-skip adm-icon">{icon}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

function findingRows(a: Admissibility, groups: boolean): Row[] {
  return a.findings.map((f) => [
    c(SEVERITY_LABEL[f.severity], SEVERITY_CLS[f.severity]),
    ...(groups ? [c(f.block ?? 'all')] : []),
    c(f.title),
    c(f.params.length ? f.params.join(', ') : null),
    c(f.detail),
  ]);
}

/** The Admissibility section: a badge, the findings with the parameters responsible, and the likely causes. */
export function AdmissibilityPanel({ cb }: { cb: CbResult }) {
  const [showCode, setShowCode] = useState(false);
  const a = checkAdmissibility(cb);
  const groups = (cb.groups?.labels.length ?? 0) > 1;
  return (
    <section className="adm-panel" aria-label="Admissibility">
      <div className="adm-head">
        <h3>Admissibility</h3>
        <Badge status={a.status} />
      </div>
      {a.findings.length === 0 ? (
        <p className="hint">
          The solution is admissible: every variance is positive, every correlation lies within ±1
          and the model matrices are positive definite. Converging alone does not guarantee this.
        </p>
      ) : (
        <>
          <Table
            title="Admissibility findings"
            file="cb-admissibility"
            columns={[
              'Severity',
              ...(groups ? ['Group / level'] : []),
              'Finding',
              'Responsible',
              'Details',
            ]}
            rows={findingRows(a, groups)}
            note="Serious: the solution is not admissible as it stands. Check: look at it; it may be sampling error. Numerical: rounding-level, usually ignorable. The estimates are not changed."
          />
          {a.causes.length > 0 && (
            <div className="adm-causes">
              <h4>Likely causes, most likely first</h4>
              <ol>
                {a.causes.map((cause) => (
                  <li key={cause.id}>
                    <strong>{cause.title}.</strong> {cause.advice}{' '}
                    <span className="hint">({cause.source})</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
      <p className="hint">
        Checked: {a.checked.join('; ')}.{' '}
        <button type="button" className="btn sm ghost" onClick={() => setShowCode((s) => !s)}>
          {showCode ? 'Hide the R code' : 'R code for these checks'}
        </button>
      </p>
      {showCode && <pre className="adm-code">{R_SNIPPET}</pre>}
    </section>
  );
}

/** The explanation of one warning in an on-theme dialog. */
function ExplanationDialog({
  text,
  explanation,
  onClose,
}: {
  text: string;
  explanation: WarningExplanation;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal warning-explain"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warning-explain-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="warning-explain-title">{explanation.title}</h3>
        <div className="hint warning-text">lavaan: “{text}”</div>
        <p>{explanation.meaning}</p>
        <h4>What to check</h4>
        <ul>
          {explanation.check.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        <h4>What to do</h4>
        <ul>
          {explanation.action.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
        <div className="hint">
          How serious: {explanation.severity}.
          {explanation.sources.length > 0 && ` Sources: ${explanation.sources.join('; ')}.`}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** A button that opens a warning's explanation; nothing for a warning without one. */
export function ExplainButton({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const explanation = explainWarning(text);
  if (!explanation) return null;
  return (
    <>
      <button
        type="button"
        className="btn sm ghost explain-btn"
        onClick={() => setOpen(true)}
        title="What this warning means and what to do"
      >
        <IconInfo size={13} /> What does this mean?
      </button>
      {open && (
        <ExplanationDialog text={text} explanation={explanation} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/** The run's warnings, each with its explanation when one is known (unknown ones verbatim). */
export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div>
      {warnings.map((w, i) => (
        <div key={i} className="issue warning">
          <span className="warning-body">
            {w}
            <ExplainButton text={w} />
          </span>
        </div>
      ))}
    </div>
  );
}
