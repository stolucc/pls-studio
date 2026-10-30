// Network psychometrics as analysis cards: a Gaussian graphical model of chosen
// variables (bootnet's EBICglasso, Epskamp & Fried 2018; centrality by qgraph;
// case-dropping stability) and exploratory graph analysis (EGAnet; Golino &
// Epskamp 2017).

import { fmt } from '../format';
import type { EgaInput, EgaResult, NetworkInput, NetworkResult } from '../rengine/network';
import { ChartFrame } from '../components/ChartFrame';
import { VariablePicker } from '../components/VariablePicker';
import { c, Table } from '../components/results/Table';
import { clampNum, columnsFingerprint, isObj, missingColumns, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const PALETTE = ['#6d28d9', '#0f9d63', '#d97706', '#2563eb', '#db2777', '#0891b2', '#65a30d', '#b91c1c'];

/** Nodes at the layout's coordinates; edges by sign (blue positive, red negative) and strength. */
function NetworkPlot({ id, names: labels, weights, layout, groups }: { id: string; names: string[]; weights: number[][]; layout: number[][]; groups?: number[] }) {
  const W = 520, H = 420, pad = 36, r = 14;
  const xs = layout.map((p) => p[0]), ys = layout.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
  const sy = (v: number) => pad + ((y1 - v) / (y1 - y0 || 1)) * (H - 2 * pad);
  const max = Math.max(1e-9, ...weights.flatMap((row, i) => row.filter((_, j) => j > i).map(Math.abs)));
  const edges = weights.flatMap((row, i) => row.map((w, j) => ({ i, j, w })).filter((e) => e.j > e.i && Math.abs(e.w) > 1e-12));
  return (
    <ChartFrame id={id} name={id.replace(':', '-')} width={W} height={H} defaults={{ x: '', y: '' }} axes={false}>
      {() => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Network">
          {edges.sort((a, b) => Math.abs(a.w) - Math.abs(b.w)).map((e) => (
            <line key={`${e.i}-${e.j}`} x1={sx(xs[e.i])} y1={sy(ys[e.i])} x2={sx(xs[e.j])} y2={sy(ys[e.j])}
              stroke={e.w > 0 ? '#2563eb' : '#dc2626'} strokeWidth={0.5 + 5 * (Math.abs(e.w) / max)} strokeOpacity={0.25 + 0.75 * (Math.abs(e.w) / max)} strokeDasharray={e.w < 0 ? '5 3' : undefined} />
          ))}
          {labels.map((n, k) => (
            <g key={n}>
              <circle cx={sx(xs[k])} cy={sy(ys[k])} r={r} fill={groups ? PALETTE[(groups[k] - 1) % PALETTE.length] : '#eef0ff'} fillOpacity={groups ? 0.25 : 1} stroke={groups ? PALETTE[(groups[k] - 1) % PALETTE.length] : '#6366f1'} strokeWidth={1.5} />
              <text x={sx(xs[k])} y={sy(ys[k]) + 3.5} textAnchor="middle" fontSize={n.length > 5 ? 8 : 10}>{n.length > 8 ? `${n.slice(0, 7)}…` : n}</text>
            </g>
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}

const indicatorsOf = (ctx: AnalysisCtx) => {
  const cols = rawData(ctx)?.names ?? [];
  return [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))].filter((v) => cols.includes(v));
};

function VarsField({ value, set, ctx }: { value: string[]; set: (v: string[]) => void; ctx: AnalysisCtx }) {
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const ind = indicatorsOf(ctx);
  return (
    <>
      <VariablePicker columns={ds.names} value={value.filter((v) => ds.names.includes(v))} onChange={(v) => set(ds.names.filter((x) => v.includes(x)))} />
      {ind.length >= 3 && <button className="btn sm ghost" onClick={() => set(ind)}>Use the model’s indicators ({ind.length})</button>}
    </>
  );
}

// ---------- network ----------

export type NetworkOptions = Omit<NetworkInput, 'boot'> & { stability: number };

function NetworkView({ r }: { r: NetworkResult }) {
  const ce = r.centrality;
  const edges = r.weights.reduce((s, row, i) => s + row.filter((w, j) => j > i && Math.abs(w) > 1e-12).length, 0);
  const possible = (r.names.length * (r.names.length - 1)) / 2;
  return (
    <div className="tables">
      <NetworkPlot id="network:graph" names={r.names} weights={r.weights} layout={r.layout} />
      <div className="hint">Edges: partial correlations (blue positive, red dashed negative; thicker = stronger), {edges} of {possible} possible. Layout: qgraph’s spring layout (Fruchterman–Reingold).</div>
      <Table title="Centrality" file="network-centrality" columns={['Variable', 'Strength', 'Expected influence', 'Closeness', 'Betweenness']}
        rows={r.names.map((n, i) => [c(n), c(ce.strength[i]), c(ce.expectedInfluence[i]), c(ce.closeness[i], undefined, 4), c(ce.betweenness[i], undefined, 0)])}
        note="Strength: the sum of a node’s absolute edge weights; expected influence: the signed sum (Robinaugh et al. 2016). Closeness and betweenness are often unstable in psychological networks (Epskamp et al. 2018); check the stability before interpreting them. qgraph::centrality_auto." />
      <Table title="Edge weights (partial correlations)" file="network-weights" columns={['', ...r.names]}
        rows={r.names.map((n, i) => [c(n), ...r.weights[i].map((w, j) => (j >= i ? c('') : Math.abs(w) < 1e-12 ? c('·', 'dim') : c(w)))])} />
      {r.cs && (
        <Table title="Centrality stability (case-dropping bootstrap)" file="network-stability" columns={['Index', 'CS coefficient', 'Interpretation']}
          rows={Object.entries(r.cs).map(([k, v]) => [c(k), c(v, v >= 0.5 ? 'good' : v >= 0.25 ? '' : 'bad', 2), c(v >= 0.5 ? 'stable' : v >= 0.25 ? 'acceptable' : 'not stable: do not interpret')])}
          note={`CS coefficient: the largest share of cases that can be dropped while the centrality correlates at least .7 with the full sample’s (95% probability); at least .25, preferably above .5 (Epskamp, Borsboom & Fried 2018). ${r.samples} bootstrap samples, bootnet.`} />
      )}
      <div className="hint">{r.n} cases{r.nComplete < r.n ? ` (${r.nComplete} complete)` : ''}. Estimated with {r.engine.package} {r.engine.version}.</div>
    </div>
  );
}

const ESTIMATORS = [['EBICglasso', 'EBICglasso (regularised)'], ['pcor', 'Partial correlations'], ['cor', 'Correlations']] as const;

function NetworkOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<NetworkOptions>) {
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>A Gaussian graphical model: how the variables relate after controlling for all others (partial correlations), regularised so that weak edges drop out (EBICglasso; Epskamp & Fried 2018). bootnet and qgraph.</p>
      <VarsField value={o.vars} set={(vars) => set({ ...o, vars })} ctx={ctx} />
      <div className="field"><label htmlFor="net-est">Estimator</label>
        <select id="net-est" className="select" value={o.estimator} onChange={(e) => set({ ...o, estimator: e.target.value as NetworkOptions['estimator'] })}>
          {ESTIMATORS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select></div>
      <div className="row2">
        <div className="field"><label htmlFor="net-cor">Correlations</label>
          <select id="net-cor" className="select" value={o.corMethod} onChange={(e) => set({ ...o, corMethod: e.target.value as NetworkOptions['corMethod'] })}>
            <option value="cor_auto">Automatic (polychoric for ordinal)</option><option value="cor">Pearson</option><option value="spearman">Spearman</option>
          </select></div>
        {o.estimator === 'EBICglasso' && <div className="field"><label htmlFor="net-gamma">EBIC γ</label>
          <input id="net-gamma" className="input num" type="number" min={0} max={1} step={0.25} value={o.gamma} onChange={(e) => set({ ...o, gamma: clampNum(e.target.value, 0, 1, 0.5) })} /></div>}
      </div>
      <div className="field"><label>Missing values</label>
        <div className="segmented">
          <button className={o.missing === 'pairwise' ? 'on' : ''} onClick={() => set({ ...o, missing: 'pairwise' })}>Pairwise</button>
          <button className={o.missing === 'listwise' ? 'on' : ''} onClick={() => set({ ...o, missing: 'listwise' })}>Listwise</button>
        </div></div>
      <div className="field"><label htmlFor="net-boot">Stability: bootstrap samples (0: none)</label>
        <input id="net-boot" className="input num" type="number" min={0} max={5000} step={100} value={o.stability} onChange={(e) => set({ ...o, stability: clampNum(e.target.value, 0, 5000, 0, true) })} />
        <div className="hint">The case-dropping bootstrap (CS coefficient) re-estimates the network many times; seed from the Model settings.</div></div>
    </fieldset>
  );
}

const netInput = (o: NetworkOptions, ctx: AnalysisCtx): NetworkInput => {
  const { stability, ...rest } = o;
  return { ...rest, boot: { samples: stability, seed: ctx.settings.seed } };
};

export const networkAnalysis: AnalysisType<NetworkOptions, NetworkResult> = {
  id: 'network', title: 'Network analysis', sub: 'partial-correlation network, centrality, stability (bootnet, qgraph)', group: 'Networks',
  defaults: (ctx) => ({ vars: indicatorsOf(ctx), estimator: 'EBICglasso', corMethod: 'cor_auto', missing: 'pairwise', gamma: 0.5, stability: 0 }),
  parseOptions: (raw) => (isObj(raw) ? {
    vars: names(raw.vars, 2000), estimator: oneOf(raw.estimator, ['EBICglasso', 'pcor', 'cor'] as const, 'EBICglasso'),
    corMethod: oneOf(raw.corMethod, ['cor_auto', 'cor', 'spearman'] as const, 'cor_auto'), missing: oneOf(raw.missing, ['pairwise', 'listwise'] as const, 'pairwise'),
    gamma: clampNum(raw.gamma, 0, 1, 0.5), stability: clampNum(raw.stability, 0, 5000, 0, true),
  } : null),
  Options: NetworkOptionsForm,
  View: ({ result }) => <NetworkView r={result} />,
  blocked: (o, ctx) => (o.vars.length < 3 ? 'Choose at least three variables.' : missingColumns(ctx, o.vars, 'Network analysis')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars, o.stability ? [ctx.settings.seed] : []),
  run: async (o, ctx) => (await import('../rengine/network')).networkR(rawData(ctx)!, netInput(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/network')).networkScriptR(rawData(ctx)!, netInput(o, ctx)),
  summary: (o) => `${o.vars.length} variables · ${ESTIMATORS.find(([id]) => id === o.estimator)![1]}${o.stability ? ` · stability (${o.stability} samples)` : ''}`,
};

// ---------- EGA ----------

export type EgaOptions = Omit<EgaInput, 'boot'> & { stability: number };

function EgaView({ r }: { r: EgaResult }) {
  return (
    <div className="tables">
      <NetworkPlot id="ega:graph" names={r.names} weights={r.weights} layout={r.layout} groups={r.membership} />
      <div className="hint">{r.dims} dimension{r.dims === 1 ? '' : 's'} (colours): the communities of the network. Edges: partial correlations (blue positive, red dashed negative).</div>
      <Table title={`Dimensions: ${r.dims}`} file="ega-membership" columns={['Variable', 'Dimension', ...r.loadingDims.map((d) => `Loading ${d}`), ...(r.itemStability ? ['Item stability'] : [])]}
        rows={r.names.map((n, i) => [c(n), c(Number.isFinite(r.membership[i]) ? r.membership[i] : 'none', undefined, 0), ...r.loadings[i].map((l, k) => ({ ...c(l), bold: r.loadingDims[k] === String(r.membership[i]) })),
          ...(r.itemStability ? [c(r.itemStability[i], r.itemStability[i] < 0.7 ? 'bad' : '', 2)] : [])])}
        note={`Exploratory graph analysis (Golino & Epskamp 2017): variables in the same community of the network form a dimension. Network loadings (Christensen & Golino 2021; standardised): about .15 small, .25 moderate, .35 large.${r.itemStability ? ' Item stability: the share of bootstrap samples in which the variable falls in the same dimension; below .70 is unstable.' : ''}${r.tefi !== null ? ` TEFI ${fmt(r.tefi, 3)} (lower is better when comparing structures).` : ''}`} />
      {r.frequency && (
        <Table title="Number of dimensions over the bootstrap samples" file="ega-frequency" columns={['Dimensions', 'Share of samples']}
          rows={r.frequency.map((f) => [c(f.dims, undefined, 0), c(f.share, undefined, 3)])}
          note={`bootEGA, ${r.samples} samples: how often each number of dimensions was found (Christensen & Golino 2021).`} />
      )}
      <div className="hint">{r.n} cases. {r.engine.package} {r.engine.version}.</div>
    </div>
  );
}

function EgaOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<EgaOptions>) {
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>How many dimensions underlie the variables? EGA estimates the network and finds its communities (Golino &amp; Epskamp 2017); an alternative to parallel analysis and EFA. EGAnet.</p>
      <VarsField value={o.vars} set={(vars) => set({ ...o, vars })} ctx={ctx} />
      <div className="row2">
        <div className="field"><label htmlFor="ega-model">Network</label>
          <select id="ega-model" className="select" value={o.model} onChange={(e) => set({ ...o, model: e.target.value as EgaOptions['model'] })}>
            <option value="glasso">EBICglasso</option><option value="TMFG">TMFG</option>
          </select></div>
        <div className="field"><label htmlFor="ega-alg">Communities</label>
          <select id="ega-alg" className="select" value={o.algorithm} onChange={(e) => set({ ...o, algorithm: e.target.value as EgaOptions['algorithm'] })}>
            <option value="walktrap">Walktrap</option><option value="louvain">Louvain</option><option value="leiden">Leiden</option>
          </select></div>
      </div>
      <div className="field"><label htmlFor="ega-corr">Correlations</label>
        <select id="ega-corr" className="select" value={o.corr} onChange={(e) => set({ ...o, corr: e.target.value as EgaOptions['corr'] })}>
          <option value="auto">Automatic (polychoric for ordinal)</option><option value="pearson">Pearson</option><option value="spearman">Spearman</option>
        </select></div>
      <div className="field"><label htmlFor="ega-boot">Stability: bootstrap samples (0: none)</label>
        <input id="ega-boot" className="input num" type="number" min={0} max={5000} step={100} value={o.stability} onChange={(e) => set({ ...o, stability: clampNum(e.target.value, 0, 5000, 0, true) })} />
        <div className="hint">bootEGA: how often each number of dimensions, and each variable’s dimension, recurs (500 or more for reporting); seed from the Model settings.</div></div>
    </fieldset>
  );
}

const egaInput = (o: EgaOptions, ctx: AnalysisCtx): EgaInput => {
  const { stability, ...rest } = o;
  return { ...rest, boot: { samples: stability, seed: ctx.settings.seed } };
};

export const egaAnalysis: AnalysisType<EgaOptions, EgaResult> = {
  id: 'ega', title: 'Exploratory graph analysis', sub: 'number of dimensions from network communities (EGAnet)', group: 'Networks',
  defaults: (ctx) => ({ vars: indicatorsOf(ctx), model: 'glasso', algorithm: 'walktrap', corr: 'auto', stability: 0 }),
  parseOptions: (raw) => (isObj(raw) ? {
    vars: names(raw.vars, 2000), model: oneOf(raw.model, ['glasso', 'TMFG'] as const, 'glasso'), algorithm: oneOf(raw.algorithm, ['walktrap', 'louvain', 'leiden'] as const, 'walktrap'),
    corr: oneOf(raw.corr, ['auto', 'pearson', 'spearman'] as const, 'auto'), stability: clampNum(raw.stability, 0, 5000, 0, true),
  } : null),
  Options: EgaOptionsForm,
  View: ({ result }) => <EgaView r={result} />,
  blocked: (o, ctx) => (o.vars.length < 3 ? 'Choose at least three variables.' : missingColumns(ctx, o.vars, 'EGA')),
  // (community detection and the layout are seeded; the bootstrap uses the Model settings' seed)
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars, o.stability ? [ctx.settings.seed] : []),
  run: async (o, ctx) => (await import('../rengine/network')).egaR(rawData(ctx)!, egaInput(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/network')).egaScriptR(rawData(ctx)!, egaInput(o, ctx)),
  summary: (o) => `${o.vars.length} variables · ${o.model === 'glasso' ? 'EBICglasso' : 'TMFG'} + ${o.algorithm}${o.stability ? ` · bootEGA (${o.stability})` : ''}`,
};
