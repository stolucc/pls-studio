// Fuzzy-set qualitative comparative analysis as an analysis card (Ragin 2008; Pappas & Woodside 2021 for its use
// beside PLS-SEM), on data columns or on the construct scores of a PLS-SEM model, computed by the QCA package.

import type { Dataset } from '../engine/types';
import { fmt } from '../format';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { QCA_SORT_BY, qcaFormula, qcaOutcomeLabel, type QcaCalibration, type QcaExpectation, type QcaModel, type QcaResult, type QcaSolutionKind, type QcaSortBy, type QcaSpec } from '../rengine/qca';
import { fingerprint } from './codec';
import { clampNum } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export interface QcaOptions {
  source: 'data' | 'scores';
  outcome: string; conditions: string[];
  /** Analyse the negation of the outcome (~Y). */
  negate: boolean;
  /** Calibration per column (outcome and conditions); a column without an entry is taken as already calibrated. */
  calibration: Record<string, QcaCalibration>;
  nCut: number; inclCut: number; priCut: number; sortBy: QcaSortBy;
  /** Directional expectations per condition (intermediate solution); absent: no expectation. */
  dirExp: Record<string, QcaExpectation>;
  /** A text column naming the cases ('' for none). */
  labels: string;
  /** The solution drawn in the XY plot (display only). */
  plot: QcaSolutionKind;
}
export type QcaPreset = Partial<QcaOptions> & { outcome: string; conditions: string[] };

export const SOLUTION_NAMES: Record<QcaSolutionKind, string> = { complex: 'Conservative (complex) solution', parsimonious: 'Parsimonious solution', intermediate: 'Intermediate solution' };
const KINDS: QcaSolutionKind[] = ['complex', 'parsimonious', 'intermediate'];
const MAX_CONDITIONS = 12;

/** R's default quantile (type 7) of a sorted array. */
export function quantile7(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
const round6 = (v: number) => Number(v.toPrecision(6));

/** Finite values of a column. */
const valuesOf = (ds: Dataset, name: string): number[] => { const k = ds.names.indexOf(name); return k < 0 ? [] : Array.from(ds.cols[k]).filter(Number.isFinite); };
/** Already in [0, 1]: a fuzzy or crisp set as it is. */
export const isCalibrated = (v: number[]) => v.length > 0 && v.every((x) => x >= 0 && x <= 1);

/** A column's starting calibration: as it is when within 0–1, else the direct method anchored at its 5th, 50th and 95th percentiles. */
export function defaultCalibration(ds: Dataset, name: string): QcaCalibration {
  const v = valuesOf(ds, name);
  if (isCalibrated(v)) return { method: 'none' };
  const s = [...v].sort((a, b) => a - b);
  return { method: 'direct', e: round6(quantile7(s, 0.05)), c: round6(quantile7(s, 0.5)), i: round6(quantile7(s, 0.95)) };
}
/** Why a column's calibration cannot be used; null when it can. */
export function calibrationProblem(ds: Dataset, name: string, k: QcaCalibration | undefined): string | null {
  const v = valuesOf(ds, name);
  if (!v.length) return `${name} has no values.`;
  if (!k || k.method === 'none') return isCalibrated(v) ? null : `${name} is not calibrated (values outside 0–1): choose the direct method and set its anchors.`;
  if (![k.e, k.c, k.i].every(Number.isFinite)) return `Set the three anchors of ${name}.`;
  if (!((k.e < k.c && k.c < k.i) || (k.e > k.c && k.c > k.i))) return `The anchors of ${name} must be in order: full non-membership, crossover, full membership.`;
  return null;
}

/** The dataset the options read: data columns, or the PLS construct scores. */
function input(o: QcaOptions, ctx: AnalysisCtx): Dataset | null {
  if (o.source === 'scores') return ctx.pls ? { names: ctx.pls.constructs, cols: ctx.pls.scores } : null;
  return ctx.data && !(ctx.data.moments && ctx.data.cols.length === 0) ? ctx.data : null;
}
const used = (o: QcaOptions) => [o.outcome, ...o.conditions].filter(Boolean);

export function qcaSpec(o: QcaOptions): QcaSpec {
  return {
    outcome: o.outcome, conditions: o.conditions, negate: o.negate,
    calibration: Object.fromEntries(used(o).map((n) => [n, o.calibration[n] ?? { method: 'none' }])),
    nCut: o.nCut, inclCut: o.inclCut, priCut: o.priCut, sortBy: o.sortBy,
    dirExp: o.conditions.map((n) => o.dirExp[n] ?? '-'),
    ...(o.labels && o.source === 'data' ? { labels: o.labels } : {}),
  };
}

// ---- The view ----

function XYPlot({ m, r }: { m: QcaModel; r: QcaResult }) {
  const W = 320, H = 300, pad = { l: 44, r: 12, t: 12, b: 40 };
  const sx = (v: number) => pad.l + v * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const n = Math.min(m.membership.length, r.outcomeValues.length);
  return (
    <ChartFrame id={`qca:${m.label}`} name={`qca-${m.label}`} width={W} height={H} defaults={{ x: 'Solution membership', y: qcaOutcomeLabel(r.outcome, r.negated) }}
      caption={<>{m.label}: consistency {fmt(m.inclS)}, coverage {fmt(m.covS)}. Points above the diagonal are consistent with sufficiency.</>}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label={`XY plot of ${qcaOutcomeLabel(r.outcome, r.negated)} against the membership in ${m.label}`}>
          <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="#cbd5e1" />
          <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="#94a3b8" strokeDasharray="4 3" />
          <line x1={sx(0.5)} y1={sy(0)} x2={sx(0.5)} y2={sy(1)} stroke="#e2e8f0" />
          <line x1={sx(0)} y1={sy(0.5)} x2={sx(1)} y2={sy(0.5)} stroke="#e2e8f0" />
          {Array.from({ length: n }, (_, i) => <circle key={i} cx={sx(m.membership[i])} cy={sy(r.outcomeValues[i])} r={3} fill="#6d28d9" opacity={0.65}><title>{r.labels?.[i] ?? `Case ${i + 1}`}: ({fmt(m.membership[i], 2)}, {fmt(r.outcomeValues[i], 2)})</title></circle>)}
          {[0, 0.5, 1].map((v) => <text key={`x${v}`} x={sx(v)} y={H - pad.b + 14} textAnchor="middle">{v}</text>)}
          {[0, 0.5, 1].map((v) => <text key={`y${v}`} x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{v}</text>)}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function SolutionTables({ s, r }: { s: QcaSolution; r: QcaResult }) {
  const many = s.models.length > 1;
  return (
    <>
      {s.models.map((m, k) => (
        <Table key={m.label} title={`${SOLUTION_NAMES[s.kind]}${many ? ` (${m.label})` : ''}: ${qcaFormula(m, r.outcome, r.negated)}`} file={`qca-${s.kind}-${m.label.replace(/\s+/g, '-')}`}
          columns={['Term', 'inclS', 'PRI', 'covS', 'covU', 'Cases']}
          rows={[...m.terms.map((t): Row => [c(t.term), c(t.inclS), c(t.PRI), c(t.covS), c(t.covU), c(t.cases)]), [{ v: m.label, bold: true }, { v: m.inclS, bold: true }, { v: m.PRI, bold: true }, { v: m.covS, bold: true }, c(null), c(null)]]}
          note={k === s.models.length - 1 ? <>
            {s.kind === 'complex' && 'Conservative solution: observed configurations only, no remainder used.'}
            {s.kind === 'parsimonious' && `Parsimonious solution: remainders used as simplifying assumptions (${s.counterfactuals} truth table rows).`}
            {s.kind === 'intermediate' && `Intermediate solution: only remainders consistent with the directional expectations (${r.conditions.map((n, i) => `${n}: ${r.expectations[i] === '1' ? 'present' : r.expectations[i] === '0' ? 'absent' : '–'}`).join(', ')}; ${s.counterfactuals} easy counterfactuals).`}
            {s.essential.length > 0 && ` Essential prime implicants: ${s.essential.join(', ')}.`}
            {many && ` Model ambiguity: QCA reports ${s.models.length} models that cover the truth table equally (Baumgartner & Thiem 2017); the solution is their disjunction, not one of them, and the choice is theoretical, not statistical.`}
            {' inclS: consistency of sufficiency; PRI: proportional reduction in inconsistency; covS: raw coverage; covU: unique coverage.'}
          </> : undefined} />
      ))}
    </>
  );
}
type QcaSolution = NonNullable<QcaResult['solutions'][QcaSolutionKind]>;

export function QcaView({ r, options: o }: { r: QcaResult; options: QcaOptions }) {
  const y = qcaOutcomeLabel(r.outcome, r.negated);
  const plot = r.solutions[o.plot] ?? r.solutions.parsimonious ?? r.solutions.complex ?? r.solutions.intermediate;
  return (
    <div className="tables">
      <Table title="Calibration" file="qca-calibration" columns={['Variable', 'Method', 'Full non-membership', 'Crossover', 'Full membership', 'Min', 'Max', 'Cases in the set (> 0.5)']}
        rows={r.calibration.map((k) => [c(k.variable), c(k.method === 'direct' ? 'Direct (logistic)' : k.crisp ? 'Crisp set as given' : 'Fuzzy set as given'), c(k.e ?? null), c(k.c ?? null), c(k.i ?? null), c(k.min, undefined, 2), c(k.max, undefined, 2), c(k.above, undefined, 0)])}
        note={`QCA::calibrate, direct method (Ragin 2008): membership 0.05 at the full non-membership anchor, 0.5 at the crossover, 0.95 at the full membership anchor (logistic). N = ${r.n} complete cases.`} />
      <Table title={`Analysis of necessity for ${y}`} file="qca-necessity" columns={['Condition', 'Consistency (inclN)', 'Relevance (RoN)', 'Coverage (covN)']}
        rows={r.necessity.map((k) => [c(k.condition), c(k.inclN, k.inclN >= 0.9 ? 'good' : undefined), c(k.RoN), c(k.covN)])}
        note="QCA::pof, relation necessity: each condition and its negation. A necessary condition usually needs consistency ≥ 0.9 and a relevance of necessity (Schneider & Wagemann 2012) that is not small; trivial conditions have high consistency and low RoN." />
      <Table title={`Truth table for ${y}`} file="qca-truth-table" columns={[...r.conditions, 'OUT', 'n', 'incl', 'PRI', 'Cases']}
        rows={r.truthTable.rows.map((row) => [...row.values.map((v) => c(v, undefined, 0)), c(row.out, row.out === '1' ? 'good' : row.out === 'C' ? 'warn' : undefined), c(row.n, undefined, 0), c(row.incl), c(row.pri), c(row.cases)])}
        note={`QCA::truthTable: configurations with at least ${r.truthTable.nCut} case${r.truthTable.nCut === 1 ? '' : 's'}; OUT = 1 when the consistency (incl) ≥ ${r.truthTable.inclCut} and PRI ≥ ${r.truthTable.priCut}${r.truthTable.counts.contradictions ? ', C a contradiction' : ''}. ${r.truthTable.counts.out1} rows coded 1, ${r.truthTable.counts.out0} coded 0; ${r.truthTable.remainders} remainders (logical configurations with no case). Sorted by ${r.truthTable.sortBy}.`} />
      {KINDS.map((k) => {
        const s = r.solutions[k];
        if (!s) return k === 'intermediate' && r.expectations.every((e) => e === '-') ? <div key={k} className="hint">Intermediate solution: give a directional expectation for at least one condition (otherwise it equals the parsimonious solution).</div>
          : <div key={k} className="hint">{SOLUTION_NAMES[k]}: QCA could not minimise this truth table (see Messages).</div>;
        return <SolutionTables key={k} s={s} r={r} />;
      })}
      {plot && (
        <>
          <div className="mc-grid">{plot.models.slice(0, 4).map((m) => <XYPlot key={m.label} m={m} r={r} />)}</div>
          <div className="hint">XY plot of {y} against the membership in the {SOLUTION_NAMES[plot.kind].toLowerCase()} (the fuzzy OR of its terms); cases below the diagonal contradict sufficiency.</div>
        </>
      )}
    </div>
  );
}

// ---- The options ----

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : null);
function parseCalibration(v: unknown): QcaCalibration | null {
  if (!v || typeof v !== 'object') return null;
  const k = v as Record<string, unknown>;
  if (k.method === 'none') return { method: 'none' };
  if (k.method === 'direct' && [k.e, k.c, k.i].every((x) => typeof x === 'number' && Number.isFinite(x))) return { method: 'direct', e: k.e as number, c: k.c as number, i: k.i as number };
  return null;
}

function Anchors({ k, set, disabled }: { k: QcaCalibration & { method: 'direct' }; set: (k: QcaCalibration) => void; disabled: boolean }) {
  const field = (key: 'e' | 'c' | 'i', label: string) => (
    <label className="inline-field" key={key}>{label} <input className="input num" type="number" step="any" value={k[key]} disabled={disabled} aria-label={label}
      onChange={(e) => set({ ...k, [key]: Number(e.target.value) })} /></label>
  );
  return <span className="qca-anchors">{field('e', 'out')}{field('c', 'cross')}{field('i', 'in')}</span>;
}

function QcaOptionsForm({ options: o, set, ctx, disabled }: { options: QcaOptions; set: (o: QcaOptions) => void; ctx: AnalysisCtx; disabled: boolean }) {
  const ds = input(o, ctx);
  const columns = ds?.names ?? [];
  const textColumns = o.source === 'data' && ds?.categories ? Object.keys(ds.categories) : [];
  /** Adding a column gives it its starting calibration; the entries of columns no longer used are kept (the user may come back). */
  const withCal = (next: QcaOptions): QcaOptions => {
    if (!ds) return next;
    const cal = { ...next.calibration };
    for (const n of used(next)) if (!cal[n] && ds.names.includes(n)) cal[n] = defaultCalibration(ds, n);
    return { ...next, calibration: cal };
  };
  const setCal = (n: string, k: QcaCalibration) => set({ ...o, calibration: { ...o.calibration, [n]: k } });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Which combinations of conditions are sufficient for the outcome, and which conditions are necessary? Cases are set memberships (calibrated 0–1); the truth table and its Boolean minimisation give the configurations (Ragin 2008). Computed by the QCA package.</p>
      <div className="field">
        <label>Variables</label>
        <div className="segmented">
          <button className={o.source === 'data' ? 'on' : ''} onClick={() => set({ ...o, source: 'data', calibration: {} })}>Data columns</button>
          <button className={o.source === 'scores' ? 'on' : ''} disabled={!ctx.pls} onClick={() => set({ ...o, source: 'scores', calibration: {}, labels: '' })} title={ctx.pls ? 'The construct scores of the current PLS-SEM results, calibrated into sets (Pappas & Woodside 2021)' : 'Calculate a PLS-SEM model first'}>PLS construct scores</button>
        </div>
      </div>
      {!ds ? <div className="empty-results">{o.source === 'scores' ? 'Calculate a PLS-SEM model first.' : 'Import raw data first.'}</div> : (
        <>
          <div className="field">
            <label htmlFor="qca-y">Outcome</label>
            <select id="qca-y" className="select" value={o.outcome} onChange={(e) => set(withCal({ ...o, outcome: e.target.value }))}>
              <option value="">Choose…</option>
              {columns.filter((n) => n === o.outcome || !o.conditions.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={o.negate} onChange={(e) => set({ ...o, negate: e.target.checked })} /> Analyse the negation of the outcome (~{o.outcome || 'Y'})</label>
          </div>
          <OrderedPicker label="Conditions" columns={columns.filter((n) => n !== o.outcome)} value={o.conditions} onChange={(conditions) => set(withCal({ ...o, conditions: conditions.slice(0, MAX_CONDITIONS) }))} />
          {textColumns.length > 0 && (
            <div className="field">
              <label htmlFor="qca-labels">Case names (optional)</label>
              <select id="qca-labels" className="select" value={o.labels} onChange={(e) => set({ ...o, labels: e.target.value })}>
                <option value="">Row numbers</option>
                {textColumns.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          {used(o).length > 0 && (
            <div className="field">
              <label>Calibration</label>
              <div className="hint">A column already between 0 and 1 is a set as it is. Otherwise the direct method (Ragin 2008) maps it with three anchors: full non-membership (0.05), crossover (0.5), full membership (0.95); the defaults are the 5th, 50th and 95th percentiles — replace them with substantive thresholds where you have them.</div>
              {used(o).filter((n) => ds.names.includes(n)).map((n) => {
                const k = o.calibration[n] ?? { method: 'none' as const };
                const problem = calibrationProblem(ds, n, k);
                return (
                  <div key={n} className="qca-row">
                    <span className="name">{n}</span>
                    <select className="select" value={k.method} aria-label={`Calibration of ${n}`} onChange={(e) => setCal(n, e.target.value === 'direct' ? (() => { const d = defaultCalibration(ds, n); return d.method === 'direct' ? d : { method: 'direct', e: 0, c: 0.5, i: 1 }; })() : { method: 'none' })}>
                      <option value="none">As it is (fuzzy or crisp)</option>
                      <option value="direct">Direct method (three anchors)</option>
                    </select>
                    {k.method === 'direct' && <Anchors k={k} set={(kk) => setCal(n, kk)} disabled={disabled} />}
                    {k.method === 'direct' && <button className="btn sm" onClick={() => setCal(n, (() => { const s = [...valuesOf(ds, n)].sort((a, b) => a - b); return { method: 'direct', e: round6(quantile7(s, 0.05)), c: round6(quantile7(s, 0.5)), i: round6(quantile7(s, 0.95)) }; })())} title="Anchors at the 5th, 50th and 95th percentiles">Percentiles</button>}
                    {problem && <span className="problem">{problem}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="field">
            <label>Truth table</label>
            <label className="inline-field">Frequency cut-off (n.cut) <input className="input num" type="number" min={1} max={1000} step={1} value={o.nCut} onChange={(e) => set({ ...o, nCut: Math.round(clampNum(Number(e.target.value), 1, 1000, 1)) })} /></label>
            <label className="inline-field">Consistency cut-off (incl.cut) <input className="input num" type="number" min={0.5} max={1} step={0.01} value={o.inclCut} onChange={(e) => set({ ...o, inclCut: clampNum(Number(e.target.value), 0.01, 1, 0.8) })} /></label>
            <label className="inline-field">PRI cut-off (pri.cut) <input className="input num" type="number" min={0} max={1} step={0.01} value={o.priCut} onChange={(e) => set({ ...o, priCut: clampNum(Number(e.target.value), 0, 1, 0) })} /></label>
            <label className="inline-field">Sort by <select className="select" value={o.sortBy} onChange={(e) => set({ ...o, sortBy: e.target.value as QcaSortBy })}>{QCA_SORT_BY.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <div className="hint">Rows with fewer cases than n.cut are remainders; a row is coded 1 when its consistency reaches incl.cut (0.8 is the usual floor, 0.75 the minimum) and its PRI reaches pri.cut (0.5 or more is recommended to avoid simultaneous subset relations).</div>
          </div>
          {o.conditions.length > 0 && (
            <div className="field">
              <label>Directional expectations (intermediate solution)</label>
              {o.conditions.map((n) => {
                const e = o.dirExp[n] ?? '-';
                const pick = (v: QcaExpectation) => set({ ...o, dirExp: { ...o.dirExp, [n]: v } });
                return (
                  <div key={n} className="qca-row">
                    <span className="name">{n}</span>
                    <div className="segmented" role="group" aria-label={`Expectation for ${n}`}>
                      <button className={e === '1' ? 'on' : ''} onClick={() => pick('1')}>present</button>
                      <button className={e === '0' ? 'on' : ''} onClick={() => pick('0')}>absent</button>
                      <button className={e === '-' ? 'on' : ''} onClick={() => pick('-')}>no expectation</button>
                    </div>
                  </div>
                );
              })}
              <div className="hint">The intermediate solution uses only the remainders consistent with these expectations (easy counterfactuals); with none, it is the parsimonious solution and is not shown.</div>
            </div>
          )}
          <div className="field">
            <label htmlFor="qca-plot">XY plot</label>
            <select id="qca-plot" className="select" value={o.plot} onChange={(e) => set({ ...o, plot: e.target.value as QcaSolutionKind })}>{KINDS.map((k) => <option key={k} value={k}>{SOLUTION_NAMES[k]}</option>)}</select>
          </div>
        </>
      )}
    </fieldset>
  );
}

export const qcaAnalysis: AnalysisType<QcaOptions, QcaResult> = {
  id: 'qca',
  fitsModel: (o) => o.source === 'scores',
  title: 'Fuzzy-set QCA',
  sub: 'fsQCA: calibration, necessity, truth table, minimisation',
  group: 'Set-theoretic methods',
  display: ['plot'],
  defaults: () => ({ source: 'data', outcome: '', conditions: [], negate: false, calibration: {}, nCut: 1, inclCut: 0.8, priCut: 0, sortBy: 'OUT, incl', dirExp: {}, labels: '', plot: 'parsimonious' }),
  parseOptions: (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const conditions = [...new Set(Array.isArray(r.conditions) ? r.conditions.slice(0, 500).map(str).filter((v): v is string => !!v) : [])];
    const calibration: Record<string, QcaCalibration> = {};
    if (r.calibration && typeof r.calibration === 'object') for (const [n, v] of Object.entries(r.calibration as Record<string, unknown>).slice(0, 500)) { const k = parseCalibration(v); if (k) calibration[n.slice(0, 200)] = k; }
    const dirExp: Record<string, QcaExpectation> = {};
    if (r.dirExp && typeof r.dirExp === 'object') for (const [n, v] of Object.entries(r.dirExp as Record<string, unknown>).slice(0, 500)) if (v === '1' || v === '0' || v === '-') dirExp[n.slice(0, 200)] = v;
    return {
      source: r.source === 'scores' ? 'scores' : 'data', outcome: str(r.outcome) ?? '', conditions, negate: r.negate === true, calibration,
      nCut: Math.round(clampNum(r.nCut, 1, 1000, 1)), inclCut: clampNum(r.inclCut, 0.01, 1, 0.8), priCut: clampNum(r.priCut, 0, 1, 0),
      sortBy: QCA_SORT_BY.includes(r.sortBy as QcaSortBy) ? (r.sortBy as QcaSortBy) : 'OUT, incl', dirExp, labels: str(r.labels) ?? '',
      plot: KINDS.includes(r.plot as QcaSolutionKind) ? (r.plot as QcaSolutionKind) : 'parsimonious',
    };
  },
  Options: QcaOptionsForm,
  View: ({ result, options }) => <QcaView r={result} options={options} />,
  blocked: (o, ctx) => {
    const ds = input(o, ctx);
    if (!ds) return o.source === 'scores' ? 'Calculate a PLS-SEM model first: the analysis runs on its construct scores.' : 'QCA needs raw data: import a dataset (not a covariance matrix).';
    if (!o.outcome) return 'Choose the outcome.';
    if (!o.conditions.length) return 'Choose at least one condition.';
    if (o.conditions.length > MAX_CONDITIONS) return `At most ${MAX_CONDITIONS} conditions (the truth table has 2^k rows).`;
    const missing = used(o).filter((n) => !ds.names.includes(n));
    if (missing.length) return `Not in the ${o.source === 'scores' ? 'construct scores' : 'data'}: ${missing.join(', ')}.`;
    if (o.conditions.includes(o.outcome)) return 'The outcome cannot also be a condition.';
    if (o.labels && o.source === 'data' && !ds.categories?.[o.labels]) return `${o.labels} is not a text column: choose another column for the case names, or row numbers.`;
    for (const n of used(o)) { const p = calibrationProblem(ds, n, o.calibration[n]); if (p) return p; }
    return null;
  },
  fingerprint: (o, ctx) => {
    const ds = input(o, ctx);
    if (!ds) return null;
    const names = [...used(o), ...(o.labels && o.source === 'data' ? [o.labels] : [])];
    const cols = names.map((n) => ds.names.indexOf(n));
    if (cols.some((k) => k < 0)) return null;
    const s = qcaSpec(o);
    return fingerprint([o.source, JSON.stringify([s.calibration, s.negate, s.nCut, s.inclCut, s.priCut, s.sortBy, s.dirExp, s.labels ?? '']), ...cols.flatMap((k) => [ds.names[k], ds.cols[k]])]);
  },
  run: async (o, ctx) => (await import('../rengine/qca')).qcaR(input(o, ctx)!, qcaSpec(o)),
  script: async (o, ctx) => (await import('../rengine/qca')).qcaScriptR(input(o, ctx)!, qcaSpec(o)),
  summary: (o) => (o.outcome ? `${o.conditions.join(', ') || '…'} → ${qcaOutcomeLabel(o.outcome, o.negate)}${o.source === 'scores' ? ' (construct scores)' : ''} · incl ≥ ${o.inclCut}, n ≥ ${o.nCut}${o.priCut ? `, PRI ≥ ${o.priCut}` : ''}` : 'not set up yet'),
};
