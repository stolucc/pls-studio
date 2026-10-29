import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { MatchInput, MatchMethod, MatchResult } from '../rengine/match';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';

export type MatchPreset = Partial<MatchInput>;
interface MatchState { open: boolean; result: { input: MatchInput; result: MatchResult } | null; preset: MatchPreset | null; setOpen: (v: boolean) => void }
export const useMatching = create<MatchState>((set) => ({ open: false, result: null, preset: null, setOpen: (open) => set({ open }) }));

const METHODS: { id: MatchMethod; label: string; hint: string }[] = [
  { id: 'nearest', label: 'Nearest neighbour', hint: 'Each treated case gets its closest control(s) on the propensity score (greedy). Estimates the ATT.' },
  { id: 'optimal', label: 'Optimal pair', hint: 'Pairs that minimise the total distance (optmatch). Estimates the ATT.' },
  { id: 'full', label: 'Full matching', hint: 'Every case in a matched set with at least one treated and one control case; nothing discarded (optmatch). ATT or ATE.' },
  { id: 'subclass', label: 'Subclassification', hint: 'Strata of the propensity score; cases weighted within strata. ATT or ATE.' },
  { id: 'cem', label: 'Coarsened exact', hint: 'Exact matching on coarsened covariates (bins); unmatched cases are dropped.' },
  { id: 'exact', label: 'Exact', hint: 'Only cases with identical covariate values are matched: for few, categorical covariates.' },
];

/** Love plot: absolute standardised mean differences before and after matching. */
function LovePlot({ b }: { b: MatchResult['balance'] }) {
  const rows = b.filter((x) => Number.isFinite(x.diffBefore));
  const W = 460, rowH = 20, pad = { l: 150, r: 16, t: 12, b: 40 };
  const H = pad.t + pad.b + rows.length * rowH;
  const max = Math.max(0.25, ...rows.flatMap((x) => [Math.abs(x.diffBefore), Math.abs(x.diffAfter)]));
  const sx = (v: number) => pad.l + (Math.abs(v) / max) * (W - pad.l - pad.r);
  return (
    <ChartFrame id="match:love" name="love-plot" width={W} height={H} defaults={{ x: 'Absolute standardised mean difference', y: '' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Love plot">
          <line className="grid-line" x1={sx(0.1)} x2={sx(0.1)} y1={pad.t} y2={H - pad.b} strokeDasharray="4 3" />
          <text x={sx(0.1)} y={H - pad.b + 14} textAnchor="middle">0.1</text>
          <text x={sx(0)} y={H - pad.b + 14} textAnchor="middle">0</text>
          <text x={sx(max)} y={H - pad.b + 14} textAnchor="end">{fmt(max, 2)}</text>
          {rows.map((x, i) => {
            const y = pad.t + i * rowH + rowH / 2;
            return (
              <g key={x.variable}>
                <text x={pad.l - 6} y={y + 4} textAnchor="end">{x.variable}</text>
                <line x1={sx(x.diffBefore)} x2={sx(x.diffAfter)} y1={y} y2={y} stroke="#cbd5e1" />
                <circle cx={sx(x.diffBefore)} cy={y} r={4} fill="none" stroke="#94a3b8" strokeWidth={1.6} />
                <circle cx={sx(x.diffAfter)} cy={y} r={4} fill="#6d28d9" />
              </g>
            );
          })}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function MatchView({ r, input }: { r: MatchResult; input: MatchInput }) {
  const level = Math.round(100 * input.confidence);
  return (
    <div className="tables">
      <Table title="Sample sizes" file="matching-counts" columns={['', 'Control', 'Treated']} rows={r.counts.map((x) => [c(x.row), c(x.control, undefined, Number.isInteger(x.control) ? 0 : 2), c(x.treated, undefined, Number.isInteger(x.treated) ? 0 : 2)])}
        note="Matched (ESS): the effective sample size after weighting. Unmatched cases are not used." />
      <LovePlot b={r.balance} />
      <div className="hint">Open circles: before matching; filled: after. Differences under 0.1 (dashed) are usually considered balanced.</div>
      <Table title="Covariate balance" file="matching-balance" columns={['Covariate', 'Type', 'Std. diff. before', 'Std. diff. after', 'Variance ratio before', 'Variance ratio after']}
        rows={r.balance.map((x) => [c(x.variable), c(x.type), c(x.diffBefore), { ...c(x.diffAfter), bold: Math.abs(x.diffAfter) >= 0.1 }, c(x.ratioBefore), c(x.ratioAfter)])}
        note="cobalt: standardised mean differences (bold: still 0.1 or more) and variance ratios (close to 1 is good) for each covariate, factor levels separately." />
      {r.effect && (
        <Table title={`Treatment effect (${r.estimand})`} file="matching-effect" columns={['Estimate', 'Std. error', 't', 'p', `${level}% CI low`, `${level}% CI high`, 'n (matched)']}
          rows={[[c(r.effect.est), c(r.effect.se), c(r.effect.t, undefined, 2), pCell(r.effect.p), c(r.effect.ciLow), c(r.effect.ciHigh), c(r.effect.n, undefined, 0)]]}
          note={`Difference in the outcome between treated and controls in the matched sample, weighted by the matching weights; ${input.replace ? 'HC3 robust standard errors (matching with replacement)' : 'standard errors clustered by matched set'} (MatchIt’s recommended approach).`} />
      )}
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

/** Propensity score matching (MatchIt) on the current dataset. */
export function MatchingPanel() {
  const open = useMatching((s) => s.open);
  const saved = useMatching((s) => s.result);
  const preset = useMatching((s) => s.preset);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const [treatment, setTreatment] = useState(saved?.input.treatment ?? '');
  const [covariates, setCovariates] = useState<string[]>(saved?.input.covariates ?? []);
  const [outcome, setOutcome] = useState(saved?.input.outcome ?? '');
  const [method, setMethod] = useState<MatchMethod>(saved?.input.method ?? 'nearest');
  const [distance, setDistance] = useState<MatchInput['distance']>(saved?.input.distance ?? 'glm');
  const [estimand, setEstimand] = useState<MatchInput['estimand']>(saved?.input.estimand ?? 'ATT');
  const [ratio, setRatio] = useState(saved?.input.ratio ?? 1);
  const [caliper, setCaliper] = useState(saved?.input.caliper != null ? String(saved.input.caliper) : '');
  const [replace, setReplace] = useState(saved?.input.replace ?? false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!preset) return;
    if (preset.treatment !== undefined) setTreatment(preset.treatment);
    if (preset.covariates) setCovariates(preset.covariates);
    if (preset.outcome !== undefined) setOutcome(preset.outcome);
    if (preset.method) setMethod(preset.method);
    if (preset.distance) setDistance(preset.distance);
    if (preset.estimand) setEstimand(preset.estimand);
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useMatching.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => useMatching.getState().setOpen(false);
  const columns = data && !data.moments ? data.names : [];
  const cal = caliper.trim() === '' ? null : Number(caliper);
  const pairs = method === 'nearest' || method === 'optimal';
  const est = pairs && estimand === 'ATE' ? 'ATT' : estimand;
  const input: MatchInput = { treatment, covariates, outcome, method, distance, estimand: est, ratio: pairs ? ratio : 1,
    caliper: method === 'nearest' ? cal : null, replace: method === 'nearest' && replace, seed: settings.seed, confidence: settings.confidence };
  const ready = !!treatment && covariates.length > 0 && (cal === null || (Number.isFinite(cal) && cal > 0));
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `MatchIt: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { matchR } = await import('../rengine/match');
      const result = await matchR(data!, input);
      result.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `MatchIt ${result.engine.version}`));
      useMatching.setState({ result: { input, result } });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { matchScriptR } = await import('../rengine/match');
      downloadText(`${safeFileName(project)}-matchit.R`, await matchScriptR(data!, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const m = METHODS.find((x) => x.id === method)!;
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Matching">
      <div className="sim">
        <header className="sim-head">
          <div><b>Propensity score matching</b><span className="muted">MatchIt · balance by cobalt</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {!columns.length ? <div className="empty-results">Import raw data first.</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <div className="field">
                <label>Treatment (two values; the higher is “treated”)</label>
                <select className="select" value={treatment} onChange={(e) => setTreatment(e.target.value)}>
                  <option value="">Choose…</option>
                  {columns.filter((n) => n === treatment || (!covariates.includes(n) && n !== outcome)).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <OrderedPicker label="Covariates (measured before treatment)" columns={columns.filter((n) => n !== treatment && n !== outcome)} value={covariates} onChange={setCovariates} />
              <div className="field">
                <label>Outcome (optional: estimates the effect)</label>
                <select className="select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">None (balance only)</option>
                  {columns.filter((n) => n === outcome || (n !== treatment && !covariates.includes(n))).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Method</label>
                <select className="select" value={method} onChange={(e) => setMethod(e.target.value as MatchMethod)}>
                  {METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <div className="hint">{m.hint}</div>
              </div>
              {method !== 'exact' && method !== 'cem' && (
                <div className="field">
                  <label>Distance</label>
                  <div className="segmented">
                    <button className={distance === 'glm' ? 'on' : ''} onClick={() => setDistance('glm')}>Propensity score (logit)</button>
                    <button className={distance === 'mahalanobis' ? 'on' : ''} disabled={method === 'subclass'} onClick={() => setDistance('mahalanobis')}>Mahalanobis</button>
                  </div>
                </div>
              )}
              <div className="field">
                <label>Estimand</label>
                <div className="segmented">
                  {(['ATT', 'ATE', 'ATC'] as const).map((x) => <button key={x} className={est === x ? 'on' : ''} disabled={pairs && x === 'ATE'} onClick={() => setEstimand(x)}>{x}</button>)}
                </div>
                <div className="hint">ATT: the effect for the treated; ATE: for everyone; ATC: for the controls.</div>
              </div>
              {pairs && (
                <div className="row2">
                  <div className="field"><label>Controls per treated</label>
                    <input className="input num" type="number" min={1} max={10} value={ratio} onChange={(e) => setRatio(Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)))} /></div>
                  {method === 'nearest' && <div className="field"><label>Caliper (SD of the distance)</label>
                    <input className="input num" placeholder="none" value={caliper} onChange={(e) => setCaliper(e.target.value)} /></div>}
                </div>
              )}
              {method === 'nearest' && (
                <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span>Match with replacement (a control can be used more than once)</span></label>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Matching…' : 'Match'}</button>
                <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {saved ? <MatchView r={saved.result} input={saved.input} /> : <div className="empty-results">Choose the treatment and covariates, and press Match.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
