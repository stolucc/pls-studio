// "Diagnose misfit" on the CB-SEM Model fit tab: where the model misses (the largest residual correlations),
// which fixed parameters are misspecified by the decision rule of Saris, Satorra & van der Veld (2009) rather
// than by the size of the modification index, a comparison with exploratory factor analyses around the
// model's number of factors, and the project's post hoc modifications. Opened by itself when the fit looks
// poor by the guideline cutoffs; on demand otherwise.

import { useState } from 'react';
import type { CbResult } from '../../engine/cbsem';
import { DEFAULT_EFA, type EfaDesign } from '../../model/efa';
import {
  describeModification,
  freeParameter,
  removalWarning,
  type PostHocModification,
} from '../../model/posthoc';
import type { ModelState } from '../../model/project';
import {
  DECISION_LABEL,
  judgeMis,
  poorFitIndices,
  type JudgedMi,
  type MisfitResult,
} from '../../rengine/misfit';
import { useFreshResults, useStore } from '../../store';
import { openAnalysisCard, reportedIndices } from './FitGuide';
import { c, Table, type Row } from './Table';

/**
 * The EFA card's design that compares k − 1, k and k + 1 factors for the model's measurement part (k: its
 * factors with two or more indicators): lavaan's extraction, the fit of each number of factors, geomin
 * rotation (Mplus's default for EFA); polychoric correlations when an indicator is ordinal. Null with why not.
 */
export function efaComparison(model: ModelState): { design: EfaDesign; k: number } | string {
  const factors = model.constructs.filter(
    (x) => x.type === 'factor' && !x.covariate && !x.components?.length && x.indicators.length >= 2,
  );
  if (!factors.length) return 'The model has no factor with two or more indicators to compare.';
  const vars = [...new Set(factors.flatMap((x) => x.indicators))];
  const k = factors.length;
  const top = Math.min(k + 1, vars.length - 1);
  if (top < 1 || top < k) return 'There are too few indicators for an EFA with as many factors.';
  const ordinal = vars.some((v) => model.ordered?.includes(v));
  return {
    k,
    design: {
      ...DEFAULT_EFA,
      vars,
      method: 'lavaan',
      criterion: 'fixed',
      nfactors: top,
      from: Math.max(1, k - 1),
      rotation: 'geominQ',
      correlation: ordinal ? 'polychoric' : 'pearson',
      parallel: 0,
    },
  };
}

/** A parameter in words, as the panel lists it. */
export function miParameter(m: Pick<JudgedMi, 'lhs' | 'op' | 'rhs'>): string {
  if (m.op === '=~') return `${m.lhs} → ${m.rhs} (loading)`;
  if (m.op === '~') return `${m.rhs} → ${m.lhs} (path)`;
  return `${m.lhs} ↔ ${m.rhs} (covariance)`;
}

/** |z| ≥ 1.96 amber, ≥ 2.58 red. */
function zCls(z: number | null): string {
  if (z === null) return 'dim';
  const size = Math.abs(z);
  if (size >= 2.58) return 'bad';
  if (size >= 1.96) return 'warn';
  return '';
}

function Residuals({ r }: { r: MisfitResult }) {
  return (
    <>
      {r.residuals.map((b, i) => (
        <Table
          key={i}
          title={`Largest residuals${b.group ? `: ${b.group}` : ''}`}
          file="cb-misfit-residuals"
          columns={['Pair', 'Residual correlation', 'z']}
          rows={b.pairs
            .slice(0, 10)
            .map(
              (p): Row => [c(`${p.a} ↔ ${p.b}`), c(p.r), { ...c(p.z, zCls(p.z), 2), bold: true }],
            )}
          note="Observed minus model-implied correlation (lavaan::lavResiduals, Bollen’s scaling) and its z-statistic (the standardized residual), largest |z| first. A large residual says what the model misses between two variables: a cross-loading, a correlated error or a path. Amber |z| ≥ 1.96, red ≥ 2.58; with many pairs some exceed these by chance."
        />
      ))}
      <button type="button" className="btn sm" onClick={() => void openAnalysisCard('localfit')}>
        Local fit card: every pair, normalized residuals, SRMR tests…
      </button>
    </>
  );
}

const SHOWN = 15;

function ModificationIndices({
  r,
  cb,
  model,
  ordinal,
  fresh,
}: {
  r: MisfitResult;
  cb: CbResult;
  model: ModelState;
  ordinal: boolean;
  fresh: boolean;
}) {
  const [all, setAll] = useState(false);
  const judged = judgeMis(r.mi);
  const groups = judged.some((m) => m.group);
  const rows = all ? judged : judged.slice(0, SHOWN);
  const robust = cb.fit.chisqScaled !== undefined;
  // The rows the rule calls misspecified that the canvas can draw, the largest |SEPC| first.
  const freeable = (fresh ? judged : [])
    .filter((m) => m.decision === 'M' || m.decision === 'EPC:M')
    .filter((m) => freeParameter(model, m, m.decision, 0) !== null)
    .slice(0, 5);
  const free = (m: JudgedMi) => {
    const s = useStore.getState();
    s.commit((cur) => freeParameter(cur, m, m.decision, Date.now()) ?? cur);
    s.toast(
      'info',
      `Freed ${miParameter(m)}. It is logged as a post hoc modification; estimate the model again to see the new fit. Keep it only if theory supports it.`,
    );
  };
  return (
    <>
      <Table
        title={`Modification indices by standardised expected change (${rows.length} of ${r.miCount})`}
        file="cb-misfit-sepc"
        columns={['Parameter', ...(groups ? ['Group'] : []), 'MI', 'SEPC', 'Power', 'Judgement']}
        rows={rows.map((m): Row => {
          const label = m.decision ? DECISION_LABEL[m.decision] : null;
          return [
            c(miParameter(m)),
            ...(groups ? [c(m.group ?? '')] : []),
            { ...c(m.mi, undefined, 2), bold: m.mi > 3.84 },
            c(m.sepc),
            c(m.power),
            label ? { ...c(label.text, label.cls), bold: label.cls === 'bad' } : c(null),
          ];
        })}
        note={
          'Ranked by the size of the standardised expected parameter change (SEPC, lavaan sepc.all), not by the MI: ' +
          'a large MI can come with a trivial change in a large sample. Judgement by Saris, Satorra & van der Veld ' +
          '(2009), as semTools::epcEquivFit: the power of the MI test (α = .05) to detect a change of .4 in a ' +
          'standardised loading or .1 in a correlation or path, high at > .80. Significant MI with low power: ' +
          'likely misspecified. Significant with high power: misspecified only if |SEPC| exceeds that size. ' +
          'Not significant with high power: no misspecification. Not significant with low power: inconclusive. ' +
          'Free a parameter only when theory supports it: changes driven by modification indices capitalise ' +
          'on chance (MacCallum, Roznowski & Necowitz 1992).' +
          (robust || ordinal
            ? ' With a robust or WLSMV estimator lavaan’s modification indices are the standard score tests, not ' +
              'robust ones: they ignore the non-normality (or the diagonal weights) that the scaled χ² corrects for, ' +
              'so read the MI as approximate and lean on the SEPC.'
            : '') +
          (cb.modindicesNote ? ` ${cb.modindicesNote}` : '')
        }
      />
      {judged.length > SHOWN && (
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{' '}
          <span>List all {judged.length}</span>
        </label>
      )}
      {freeable.length > 0 && (
        <div className="misfit-free">
          <div className="hint">
            Free a parameter judged misspecified (it is added to the diagram and logged as a post
            hoc modification):
          </div>
          {freeable.map((m, i) => (
            <button key={i} type="button" className="btn sm" onClick={() => free(m)}>
              Free {miParameter(m)}
              {m.group ? ` (suggested in ${m.group})` : ''}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn sm" onClick={() => void openAnalysisCard('epcequiv')}>
        EPC-based misspecification card: your own sizes of interest, intervals…
      </button>
    </>
  );
}

function EfaCompare({ model }: { model: ModelState }) {
  const x = efaComparison(model);
  if (typeof x === 'string') return <div className="hint">{x}</div>;
  const low = x.design.from ?? 1;
  const open = () => {
    void openAnalysisCard('efa', x.design, true);
    useStore
      .getState()
      .toast(
        'info',
        `Added an EFA card comparing ${low} to ${x.design.nfactors} factors on the model’s ${x.design.vars.length} indicators. Run it on the Analyses tab.`,
      );
  };
  return (
    <div>
      <button type="button" className="btn sm" onClick={open}>
        Compare with EFA at {low}–{x.design.nfactors} factors…
      </button>
      <div className="hint">
        The model has {x.k} factor{x.k === 1 ? '' : 's'}. An exploratory factor analysis of the same
        indicators with one factor fewer and one more shows whether the data suggest another number
        of factors or cross-loadings the model fixes at zero (lavaan’s EFA, with the fit of each
        number of factors).
      </div>
    </div>
  );
}

function ModificationLog({ log }: { log: readonly PostHocModification[] }) {
  if (!log.length) return null;
  return (
    <div>
      <h3>Post hoc modifications in this project ({log.length})</h3>
      <ol className="misfit-log">
        {log.map((e) => (
          <li key={e.id}>
            {describeModification(e)}
            <span className="muted"> · {new Date(e.at).toLocaleString()}</span>
          </li>
        ))}
      </ol>
      <div className="hint">
        Report each of these as a change made after seeing the data, with its justification (the
        reporting checklist lists them).
      </div>
    </div>
  );
}

/** The panel on the Model fit tab. */
export function MisfitPanel({ cb }: { cb: CbResult }) {
  const model = useStore((s) => s.model);
  // Freeing acts on the diagram: only from results of the model as it is now.
  const fresh = useFreshResults()?.cb === cb;
  return <MisfitPanelBody cb={cb} model={model} fresh={fresh} />;
}

/** The panel for this result and model; `fresh`: the result is the model's as it is now. */
export function MisfitPanelBody({
  cb,
  model,
  fresh,
}: {
  cb: CbResult;
  model: ModelState;
  fresh: boolean;
}) {
  const log = model.modifications ?? [];
  const poor = poorFitIndices({ ...reportedIndices(cb.fit), srmr: cb.fit.srmr });
  const streak = removalWarning(log);
  const r = cb.misfit;
  const ordinal = !!model.ordered?.length;
  let body;
  if (!r) {
    body = (
      <div className="hint">
        The misfit diagnostics need lavaan’s fit of a single-level model: not with multiple
        imputation, a two-level model, robust ML (rsem) or the two-stage missing-data approach, nor
        with the built-in engine.
      </div>
    );
  } else if (r.error) {
    body = <div className="hint">lavaan could not compute the diagnostics: {r.error}</div>;
  } else {
    body = (
      <>
        <Residuals r={r} />
        <ModificationIndices r={r} cb={cb} model={model} ordinal={ordinal} fresh={fresh} />
        <EfaCompare model={model} />
        {r.code.length > 0 && (
          <details>
            <summary>R code for these diagnostics (run after the model’s script)</summary>
            <pre className="r-code">{r.code.join('\n')}</pre>
          </details>
        )}
      </>
    );
  }
  return (
    // (interactive diagnostics: left out of the report, which lists the modifications in its methods text)
    <div className="misfit-panel report-skip">
      {streak && <div className="issue warning">{streak}</div>}
      <details open={poor.length > 0}>
        <summary>
          <strong>Diagnose misfit</strong>
          {poor.length > 0
            ? ` — ${poor.join(', ')} beyond the guideline cutoffs: where does the model miss?`
            : ' — where the model misses, and what to free or not'}
        </summary>
        <div className="misfit-body">
          {body}
          <ModificationLog log={log} />
        </div>
      </details>
    </div>
  );
}
