import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import { constructsFromSolution, crossLoadings, DEFAULT_EFA, EFA_METHODS, EFA_ROTATIONS, kmoLabel, loadingOrder, toggleVariables, type EfaDesign } from '../model/efa';
import type { EfaResult } from '../rengine/efa';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { c, pCell, Table, type Row } from './results/Table';

export type EfaPreset = Partial<EfaDesign>;
type EfaTab = 'suitability' | 'number' | 'loadings' | 'cross' | 'correlations' | 'variance' | 'fit';
interface EfaState { open: boolean; result: EfaResult | null; preset: EfaPreset | null; tab: EfaTab; residual: boolean; setOpen: (v: boolean) => void }
export const useEfa = create<EfaState>((set) => ({ open: false, result: null, preset: null, tab: 'loadings', residual: false, setOpen: (open) => set({ open }) }));

/**
 * Many variables at once: a checkbox list with a filter, all / none (of the
 * visible ones), shift-click for a range, and the variables selected in the
 * data list.
 */
function VariablePicker({ columns, value, onChange }: { columns: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [filter, setFilter] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const fromData = useStore((s) => s.selectedVars).filter((v) => columns.includes(v));
  const q = filter.trim().toLowerCase();
  const shown = q ? columns.filter((v) => v.toLowerCase().includes(q)) : columns;
  const chosen = new Set(value);
  const keepOrder = (vs: Set<string>) => columns.filter((v) => vs.has(v));
  return (
    <div className="field">
      <label>Variables <span className="muted">({value.length} of {columns.length} chosen)</span></label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <input className="input" style={{ flex: '1 1 120px' }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter variables" />
        <button className="btn sm" onClick={() => onChange(keepOrder(new Set([...value, ...shown])))} title={q ? 'Choose all variables matching the filter' : 'Choose all variables'}>All{q ? ' shown' : ''}</button>
        <button className="btn sm ghost" onClick={() => onChange(q ? value.filter((v) => !shown.includes(v)) : [])}>None{q ? ' shown' : ''}</button>
        {fromData.length > 0 && <button className="btn sm ghost" onClick={() => onChange(keepOrder(new Set([...value, ...fromData])))} title="Add the variables selected in the data list (shift/⌘-click there)">Use selection ({fromData.length})</button>}
      </div>
      <div className="var-check-list" role="group" aria-label="Variables">
        {shown.map((v) => (
          <label key={v} className="check var-check" onClick={(e) => {
            e.preventDefault();
            onChange(toggleVariables(shown, value, v, anchor, e.shiftKey).concat(value.filter((x) => !shown.includes(x))).filter((x, i, a) => a.indexOf(x) === i));
            setAnchor(v);
          }}>
            <input type="checkbox" checked={chosen.has(v)} readOnly tabIndex={-1} />
            <span>{v}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="hint">No variable matches.</span>}
      </div>
      <div className="hint" style={{ marginTop: 4 }}>Shift-click to choose a range.</div>
    </div>
  );
}

/** Scree plot: eigenvalues, with parallel analysis's simulated ones and the eigenvalue-1 line. */
function Scree({ r }: { r: EfaResult }) {
  const W = 380, H = 230, pad = { l: 44, r: 12, t: 12, b: 36 };
  const obs = r.parallel?.observed.length ? r.parallel.observed : r.eigenvalues;
  const sim = r.parallel?.simulated ?? [];
  const n = obs.length, top = Math.max(1, ...obs, ...sim) * 1.05, bottom = Math.min(0, ...obs, ...sim);
  const sx = (i: number) => pad.l + (n === 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const sy = (v: number) => pad.t + ((top - v) / (top - bottom || 1)) * (H - pad.t - pad.b);
  const line = (v: number[]) => v.map((y, i) => `${i ? 'L' : 'M'} ${sx(i)} ${sy(y)}`).join(' ');
  const pca = r.method === 'pca';
  return (
    <ChartFrame id="efa:scree" name="scree" width={W} height={H} defaults={{ x: pca ? 'Component' : 'Factor', y: 'Eigenvalue' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Scree plot">
          <line x1={pad.l} x2={W - pad.r} y1={sy(1)} y2={sy(1)} stroke="#cbd5e1" strokeDasharray="4 3" />
          {bottom < 0 && <line x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} stroke="#e2e8f0" />}
          {sim.length > 0 && <path d={line(sim)} stroke="#d97706" strokeWidth={1.6} strokeDasharray="5 3" fill="none" />}
          <path d={line(obs)} stroke="#6d28d9" strokeWidth={1.8} fill="none" />
          {obs.map((y, i) => <circle key={i} cx={sx(i)} cy={sy(y)} r={2.8} fill="#6d28d9" />)}
          {obs.map((_, i) => (n <= 15 || i % 2 === 0) && <text key={i} x={sx(i)} y={H - pad.b + 14} textAnchor="middle">{i + 1}</text>)}
          <text x={pad.l - 6} y={sy(top / 1.05) + 4} textAnchor="end">{fmt(top / 1.05, 1)}</text>
          <text x={pad.l - 6} y={sy(1) + 4} textAnchor="end">1</text>
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function EfaView({ r, threshold }: { r: EfaResult; threshold: number }) {
  const tab = useEfa((s) => s.tab);
  const residual = useEfa((s) => s.residual);
  const pca = r.method === 'pca';
  const unit = pca ? 'component' : 'factor';
  const order = loadingOrder(r.loadings);
  const cell = (v: number) => (Math.abs(v) < threshold ? c('', 'dim') : { ...c(v), bold: Math.abs(v) >= 0.5 });
  const rows = (m: number[][], blank = true): Row[] => order.map((i) => [c(r.variables[i]), ...m[i].map((v) => (blank ? cell(v) : c(v))), c(r.communality[i]), c(r.uniqueness[i]), c(r.complexity[i], undefined, 2)]);
  const cross = crossLoadings(r.loadings, threshold);
  const clean = cross.filter((x) => x.flags.length === 0).length;
  const tabs: [EfaTab, string][] = [['suitability', 'Suitability'], ['number', `Number of ${unit}s`], ['loadings', 'Loadings'], ['cross', 'Cross-loadings'], ['correlations', 'Correlations'], ['variance', pca ? 'Components' : 'Factors'], ...(pca ? [] : [['fit', 'Fit'] as [EfaTab, string]])];
  const shown = tabs.some(([id]) => id === tab) ? tab : 'loadings';
  const flagText = { 'cross-loads': `cross-loads (≥ ${threshold})`, weak: 'weak (< .40)', close: 'close (gap < .20)' };
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Results">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={shown === id} className={shown === id ? 'on' : ''} onClick={() => useEfa.setState({ tab: id })}>
            {label}{id === 'cross' && cross.length - clean > 0 ? ` (${cross.length - clean})` : ''}
          </button>
        ))}
      </div>
      <div className="tables">
        {shown === 'suitability' && (
          <Table title={`Suitability: KMO ${fmt(r.kmo.overall)} (${kmoLabel(r.kmo.overall)})`} file="efa-suitability" columns={['Measure', 'Value', 'df', 'p']}
            rows={[[c('Kaiser–Meyer–Olkin (overall)'), c(r.kmo.overall), c(''), c('')], [c('Bartlett’s test of sphericity, χ²'), c(r.bartlett.chisq, undefined, 2), c(r.bartlett.df, undefined, 0), pCell(r.bartlett.p)],
              ...r.variables.map((v, i) => [c(`MSA ${v}`), { ...c(r.kmo.items[i]), cls: r.kmo.items[i] < 0.5 ? 'bad' : undefined }, c(''), c('')])]}
            note={`KMO ≥ .6 is usually wanted (Kaiser 1974: .9 marvelous, .8 meritorious, .7 middling, .6 mediocre, .5 miserable); per item (MSA), below .5 suggests dropping it. Bartlett’s test should reject (the correlations are not all zero).`} />
        )}
        {shown === 'number' && (
          <>
            <div className="mc-grid"><Scree r={r} /></div>
            <Table title={`How many ${unit}s`} file="efa-number" columns={['Criterion', 'Suggests']}
              rows={[
                ...(r.parallel ? [[c(`Parallel analysis (Horn 1965; ${r.parallel.iterations} samples)`), c(r.parallel.suggested ?? '–', undefined, 0)]] : []),
                [c('Velicer’s MAP (minimum average partial)'), c(r.map.suggested, undefined, 0)],
                [c('Eigenvalues > 1 (Kaiser; tends to overestimate)'), c(r.kaiser, undefined, 0)],
              ]}
              note={`Purple: eigenvalues of the ${pca ? 'correlation matrix' : 'reduced correlation matrix (factor analysis)'}${r.parallel ? '; dashed amber: the mean eigenvalues of random data of the same size (parallel analysis: keep those above it)' : ''}. Parallel analysis and MAP are the more reliable guides; then judge the solution’s interpretability.`} />
          </>
        )}
        {shown === 'loadings' && (
          <>
            <Table title={`${r.oblique ? 'Pattern matrix' : 'Loadings'}: ${r.k} ${unit}s, ${EFA_METHODS.find((m) => m.id === r.method)?.label.toLowerCase()}, ${r.rotation === 'none' ? 'unrotated' : `${EFA_ROTATIONS.find((x) => x.id === r.rotation)?.label.toLowerCase()} rotation`}`}
              file="efa-loadings" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.loadings)}
              note={`Sorted by the ${unit} each variable loads most on; loadings below ${threshold} are blank, ≥ .5 bold. h²: communality; u²: uniqueness; complexity: Hofmann’s index (1: one ${unit}). The Cross-loadings tab lists every loading.`} />
            {r.structure && <Table title={`Structure matrix (correlations of variables and ${unit}s)`} file="efa-structure" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.structure)} />}
          </>
        )}
        {shown === 'cross' && (
          <>
            <Table title={`Cross-loadings: ${clean} of ${cross.length} variables load cleanly on one ${unit}`} file="efa-cross-loadings"
              columns={['Variable', `Primary ${unit}`, 'Loading', `Second ${unit}`, 'Loading', 'Difference', 'Check']}
              rows={order.map((i) => cross[i]).map((x) => [
                c(r.variables[x.variable]), c(r.factors[x.primary]), { ...c(x.primaryLoading), bold: Math.abs(x.primaryLoading) >= 0.5 },
                c(x.secondary === null ? '–' : r.factors[x.secondary]), x.secondaryLoading === null ? c('–') : { ...c(x.secondaryLoading), bold: Math.abs(x.secondaryLoading) >= threshold },
                x.gap === null ? c('–') : c(x.gap), x.flags.length ? c(x.flags.map((f) => flagText[f]).join('; '), 'bad') : c('clean', 'good'),
              ])}
              note={`Rules of thumb (e.g. Howard 2016): a variable should load at least .40 on its ${unit}, below ${threshold} on every other, and at least .20 more on its own than on the next. Variables flagged here are candidates for removal or rewording; drop one at a time and recalculate.`} />
            <Table title="All loadings (none hidden)" file="efa-loadings-all" columns={['Variable', ...r.factors, 'h²', 'u²', 'Complexity']} rows={rows(r.loadings, false)} />
          </>
        )}
        {shown === 'correlations' && (() => {
          const m = residual ? r.residuals : r.correlations;
          const big = order.reduce((n, i, a) => n + order.slice(0, a).filter((j) => Math.abs(r.residuals[i][j]) > 0.1).length, 0);
          const pairs = (order.length * (order.length - 1)) / 2;
          // Shading by size: observed correlations in the accent colour; residuals above .10 flagged.
          const shade = (v: number) => `rgba(109, 40, 217, ${Math.min(1, Math.abs(v)) * 0.45})`;
          return (
            <>
              <div className="segmented" style={{ marginBottom: 10, maxWidth: 360 }}>
                <button className={residual ? '' : 'on'} onClick={() => useEfa.setState({ residual: false })}>Observed</button>
                <button className={residual ? 'on' : ''} onClick={() => useEfa.setState({ residual: true })}>Residual{big ? ` (${big} > .10)` : ''}</button>
              </div>
              <Table title={residual ? `Residual correlations: ${big} of ${pairs} pairs above .10` : 'Correlations between the variables'} file={residual ? 'efa-residual-correlations' : 'efa-correlations'}
                columns={['', ...order.map((i) => r.variables[i])]}
                rows={order.map((i, a) => [c(r.variables[i]), ...order.map((j, b) => (b > a ? c('') : b === a ? c(residual ? '' : '1', 'dim')
                  : residual ? (Math.abs(m[i][j]) > 0.1 ? { ...c(m[i][j], 'bad'), bold: true } : c(m[i][j], 'dim')) : { ...c(m[i][j]), bg: shade(m[i][j]) }))])}
                note={residual
                  ? `What the ${r.k}-${unit} solution leaves unexplained: observed minus model-implied correlation (ΛΦΛᵀ). Residuals above .10 (bold) point to a missing ${unit}, locally dependent items (similar wording) or a misplaced item.`
                  : `Pairwise correlations the analysis starts from, ordered as the loadings table so its blocks show; shading by size. Very high correlations (above about .8) suggest redundant items; variables correlating with nothing will not load.`} />
            </>
          );
        })()}
        {shown === 'variance' && (
          <>
            <Table title="Variance explained" file="efa-variance" columns={['', ...r.factors]}
              rows={[[c('Sum of squared loadings'), ...r.ssLoadings.map((v) => c(v))], [c('Proportion'), ...r.proportion.map((v) => c(v))], [c('Cumulative'), ...r.cumulative.map((v) => c(v))]]} />
            {r.phi && <Table title={`${pca ? 'Component' : 'Factor'} correlations`} file="efa-phi" columns={['', ...r.factors]}
              rows={r.factors.map((f, i) => [c(f), ...r.phi![i].map((v, j) => (j <= i ? c(v) : c('')))])} />}
          </>
        )}
        {shown === 'fit' && !pca && (
          <Table title="Fit of the factor model" file="efa-fit" columns={['χ²', 'df', 'p', 'RMSEA', '90% CI', 'TLI', 'BIC']}
            rows={[[c(r.fit.chisq ?? null, undefined, 2), c(r.fit.df ?? null, undefined, 0), pCell(r.fit.p ?? null), c(r.fit.rmsea ?? null),
              c(r.fit.rmseaLow != null && r.fit.rmseaHigh != null ? `${fmt(r.fit.rmseaLow)}–${fmt(r.fit.rmseaHigh)}` : '–'), c(r.fit.tli ?? null), c(r.fit.bic ?? null, undefined, 1)]]}
            note={`Likelihood-ratio test of the ${r.k}-factor model against the saturated one (psych; n = ${r.n}). RMSEA ≤ .06 and TLI ≥ .95 suggest good fit (Hu & Bentler 1999). χ² rejects easily in large samples.`} />
        )}
        <div className="hint">Calculated by psych {r.engine.version} (Revelle){r.rotation !== 'none' && r.oblique ? ' with GPArotation' : ''}.</div>
      </div>
    </>
  );
}

/** Exploratory factor analysis and principal component analysis (psych). */
export function EfaPanel() {
  const open = useEfa((s) => s.open);
  const saved = useEfa((s) => s.result);
  const preset = useEfa((s) => s.preset);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const model = useStore((s) => s.model);
  const project = useStore((s) => s.projectName);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const design: EfaDesign = settings.efa ?? DEFAULT_EFA;
  const setDesign = (p: Partial<EfaDesign>) => useStore.getState().setSettings({ efa: { ...design, ...p } });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (preset) { useStore.getState().setSettings({ efa: { ...(useStore.getState().settings.efa ?? DEFAULT_EFA), ...preset } }); useEfa.setState({ preset: null }); } }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useEfa.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const columns = useMemo(() => (data && !data.moments ? data.names : []), [data]);
  const indicators = useMemo(() => model.constructs.flatMap((k) => k.indicators).filter((v) => columns.includes(v)), [model, columns]);
  if (!open) return null;
  const close = () => useEfa.getState().setOpen(false);
  const vars = design.vars.filter((v) => columns.includes(v));
  const maxK = Math.max(1, vars.length - 1);
  const ready = !!data && vars.length >= 3 && design.nfactors < vars.length;
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `psych: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { efaR } = await import('../rengine/efa');
      useEfa.setState({ result: await efaR(data!, { ...design, vars }, settings.seed) });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { efaScriptR } = await import('../rengine/efa');
      downloadText(`${safeFileName(project)}-efa.R`, await efaScriptR(data!, { ...design, vars }, settings.seed), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const build = () => {
    if (!saved) return;
    const s = constructsFromSolution(saved, design.threshold);
    if (!s.constructs.length) { useStore.getState().toast('error', `No loading reaches ${design.threshold}: lower the threshold.`); return; }
    useStore.getState().addFactors(s.constructs.map((k) => k.indicators), s.correlated, s.constructs.map((k) => k.name));
    useStore.getState().layout();
    useStore.getState().toast('success', `Added ${s.constructs.length} construct${s.constructs.length > 1 ? 's' : ''}, each with the variables loading most on it (≥ ${design.threshold})${s.correlated ? ', correlated (oblique solution)' : ''}.${s.left.length ? ` Left out: ${s.left.join(', ')}.` : ''} For a confirmatory factor analysis, choose CB-SEM.`);
    close();
  };
  const oblique = EFA_ROTATIONS.find((x) => x.id === design.rotation)?.oblique;
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Exploratory factor analysis">
      <div className="sim">
        <header className="sim-head">
          <div><b>Exploratory factor analysis</b><span className="muted">EFA and PCA with psych: suitability, number of factors, rotated solution</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        <div className="sim-body long-body">
          <section className="sim-col">
            {!data || data.moments ? <div className="empty-results">Import raw data first.</div> : (
              <>
                <VariablePicker columns={columns} value={vars} onChange={(v) => setDesign({ vars: columns.filter((x) => v.includes(x)), nfactors: Math.min(design.nfactors, Math.max(1, v.length - 1)) })} />
                {indicators.length >= 3 && <button className="btn sm ghost" onClick={() => setDesign({ vars: indicators })}>Use the model’s indicators ({indicators.length})</button>}
                <div className="field">
                  <label>Method</label>
                  <select className="select" value={design.method} onChange={(e) => setDesign({ method: e.target.value as EfaDesign['method'] })}>
                    {EFA_METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
                <div className="row2">
                  <div className="field"><label>{design.method === 'pca' ? 'Components' : 'Factors'}</label>
                    <input className="input num" type="number" min={1} max={maxK} value={design.nfactors} onChange={(e) => setDesign({ nfactors: Math.max(1, Math.min(maxK, Math.round(Number(e.target.value)) || 1)) })} /></div>
                  <div className="field"><label>Rotation</label>
                    <select className="select" value={design.rotation} onChange={(e) => setDesign({ rotation: e.target.value as EfaDesign['rotation'] })}>
                      {EFA_ROTATIONS.map((m) => <option key={m.id} value={m.id}>{m.label}{m.id === 'none' ? '' : m.oblique ? ' (oblique)' : ' (orthogonal)'}</option>)}
                    </select></div>
                </div>
                <div className="row2">
                  <div className="field"><label>Parallel analysis samples</label>
                    <input className="input num" type="number" min={0} max={2000} value={design.parallel} onChange={(e) => setDesign({ parallel: Math.max(0, Math.min(2000, Math.round(Number(e.target.value)) || 0)) })} /></div>
                  <div className="field"><label>Hide loadings below</label>
                    <input className="input num" type="number" min={0} max={0.95} step={0.05} value={design.threshold} onChange={(e) => setDesign({ threshold: Math.max(0, Math.min(0.95, Number(e.target.value) || 0)) })} /></div>
                </div>
                <div className="field">
                  <label>Missing values</label>
                  <div className="segmented">
                    <button className={design.missing === 'pairwise' ? 'on' : ''} onClick={() => setDesign({ missing: 'pairwise' })}>Pairwise</button>
                    <button className={design.missing === 'listwise' ? 'on' : ''} onClick={() => setDesign({ missing: 'listwise' })}>Listwise</button>
                  </div>
                </div>
                <p className="hint">{design.method === 'pca'
                  ? 'PCA summarises the variables in components that explain as much of their variance as possible; it is a data reduction, not a model of latent factors.'
                  : 'Factor analysis models common factors behind the variables (shared variance only); use it to explore a measurement structure before a CFA.'}
                  {oblique ? ' An oblique rotation lets the factors correlate, which is usual for psychological constructs.' : ''}</p>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Calculating…' : 'Calculate'}</button>
              <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              <button className="btn" disabled={!saved || readOnly} onClick={build} title="Add one construct per factor, with the variables loading most on it, to the diagram">Build model</button>
            </div>
          </section>
          <section className="sim-col wide">
            {saved ? <EfaView r={saved} threshold={design.threshold} /> : <div className="empty-results">Choose at least three variables and press Calculate.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
