// Segmentation of the PLS-SEM model on the canvas as analysis cards:
// REBUS-PLS (plspm), PATHMOX (genpathmox), FIMIX-PLS (flexmix) and PLS-POS.

import { useState } from 'react';
import { fmt } from '../format';
import type { PlsOptions } from '../engine/types';
import type { FimixResult, PathmoxResult, PathmoxSegment, PosResult, RebusModel, RebusResult } from '../rengine/segment';
import { useStore } from '../store';
import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table } from '../components/results/Table';
import { clampNum, flag, freeColumnName, isObj, name, rawData } from './common';
import { modelFingerprint, plsModelBlocked, specOf } from './plsAssessment';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** Move one category up or down in an ordered segmentation variable. */
export function moveCategory(order: number[], i: number, delta: -1 | 1): number[] {
  const j = i + delta;
  if (j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function Fusion({ heights }: { heights: number[] }) {
  const W = 420, H = 200, pad = { l: 48, r: 10, t: 10, b: 36 };
  const max = Math.max(...heights, 1e-9);
  const bw = (W - pad.l - pad.r) / heights.length;
  return (
    <ChartFrame id="rebus:fusion" name="rebus-fusion-levels" width={W} height={H} defaults={{ x: 'Classes below this merge', y: 'Fusion level (Ward)' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Fusion levels of the hierarchical clustering">
          <text x={pad.l - 6} y={pad.t + 8} textAnchor="end">{fmt(max, 1)}</text>
          <text x={pad.l - 6} y={H - pad.b} textAnchor="end">0</text>
          {heights.map((h, i) => {
            const bh = (h / max) * (H - pad.t - pad.b);
            return (
              <g key={i}>
                <rect x={pad.l + i * bw + 3} y={H - pad.b - bh} width={bw - 6} height={bh} fill="#6d28d9" opacity={0.75} />
                <text x={pad.l + i * bw + bw / 2} y={H - pad.b + 14} textAnchor="middle">{i + 2}</text>
              </g>
            );
          })}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function Solution({ r, m }: { r: RebusResult; m: RebusModel }) {
  const cls = m.sizes.map((_, i) => `Class ${i + 1}`);
  const global = (from: string, to: string) => r.globalPaths.find((p) => p.from === from && p.to === to)?.est ?? null;
  const ends = Object.keys(m.r2);
  return (
    <>
      <Table title={`Path coefficients, ${m.k} classes`} file={`rebus-${m.k}-paths`} columns={['Path', 'Global', ...cls]}
        rows={[...m.paths.map((p) => [c(`${p.from} → ${p.to}`), c(global(p.from, p.to)), ...p.byClass.map((v) => c(v))]),
          [c('Observations'), c(r.n, undefined, 0), ...m.sizes.map((s) => c(s, undefined, 0))],
          ...ends.map((e) => [c(`R² ${e}`), c(null), ...m.r2[e].map((v) => c(v))]),
          [c('GoF'), c(r.globalGof), ...m.gof.map((v) => c(v))]]}
        note="Class-specific (local) PLS models estimated on each class’s observations; the global model on all of them." />
      {m.tests.length > 0 && (
        <Table title="Differences between classes (permutation tests)" file={`rebus-${m.k}-tests`} columns={['Classes', 'Path', 'Difference', 'p']}
          rows={m.tests.flatMap((t) => [
            ...t.paths.map((p) => [c(`${t.classes[0]} vs ${t.classes[1]}`), c(`${p.from} → ${p.to}`), c(p.diff), pCell(p.p)]),
            [c(`${t.classes[0]} vs ${t.classes[1]}`), c('GoF'), c(t.gof.diff), pCell(t.gof.p)],
          ])}
          note="plspm’s rebus.test: absolute differences between two classes and their permutation p-values." />
      )}
      <Table title="Loadings by class" file={`rebus-${m.k}-loadings`} columns={['Indicator', ...cls]} rows={m.loadings.map((l) => [c(l.indicator), ...l.byClass.map((v) => c(v))])} />
    </>
  );
}

function PathmoxTree({ r }: { r: PathmoxResult }) {
  const kids = (n: number) => r.nodes.filter((x) => x.parent === n && x.node !== n);
  const render = (n: (typeof r.nodes)[number]) => (
    <li key={n.node}>
      <div className={`tree-node${n.terminal ? ' terminal' : ''}`}>
        <b>Node {n.node}</b> · n = {n.size} ({fmt(n.percent, 1)}%){n.variable ? <> · {n.variable}: {n.category}</> : ' · all observations'}
        {(() => { const s = r.splits.find((x) => x.node === n.node); return s ? <span className="muted"> — split by {s.variable} (F = {fmt(s.f, 2)}, p {s.p < 0.001 ? '< .001' : `= ${fmt(s.p, 3)}`})</span> : null; })()}
      </div>
      {kids(n.node).length > 0 && <ul>{kids(n.node).map(render)}</ul>}
    </li>
  );
  const root = r.nodes.find((x) => x.parent === 0) ?? r.nodes[0];
  return <ul className="pathmox-tree">{render(root)}</ul>;
}

function PathmoxView({ r }: { r: PathmoxResult }) {
  return (
    <div className="tables">
      <div><div className="table-tools"><h3>Segmentation tree</h3></div><PathmoxTree r={r} /></div>
      <Table title="Paths and R² in the terminal nodes" file="pathmox-terminal" columns={['', ...r.terminal.nodes]}
        rows={r.terminal.rows.map((x) => [c(x.name.replace('->', ' → ')), ...x.values.map((v) => c(v))])}
        note="A separate PLS model per terminal node (segment)." />
      <Table title="Splits: global tests" file="pathmox-splits" columns={['Node', 'Variable', 'Left', 'Right', 'F', 'p']}
        rows={r.splits.map((s) => [c(s.node, undefined, 0), c(s.variable), c(s.left), c(s.right), c(s.f, undefined, 2), pCell(s.p)])}
        note="Lamberti, Aluja & Sanchez (2016): at each node, the split whose two sides differ most in their inner model (F test of equal coefficients), if significant and both sides are large enough." />
      {r.splits.map((s) => (
        <Table key={s.node} title={`Node ${s.node}: which paths differ (${s.variable})`} file={`pathmox-node${s.node}`} columns={['Path', 'F', 'p']}
          rows={s.paths.map((p) => [c(p.path.replace('->', '→')), c(p.f, undefined, 2), pCell(p.p)])} />
      ))}
      <Table title="Importance of the segmentation variables" file="pathmox-importance" columns={['Variable', 'Ranking']}
        rows={r.importance.map((x) => [c(x.variable), c(x.ranking)])} />
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

/** Save a segment assignment (1-based, one per analysed row) as a data column when no rows were left out. */
function SaveSegments({ assignment, base, current }: { assignment: number[]; base: string; current: boolean }) {
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const ok = current && !!data && !!info && assignment.length === (data.cols[0]?.length ?? -1);
  return (
    <button className="btn sm" disabled={!ok} title={!current ? 'The data or the model changed since this ran: run it again first' : ok ? 'Add the segment of each observation as a data column (for multigroup analysis)' : 'Rows were left out (missing values), so segments cannot be matched to rows'}
      onClick={() => {
        const name = freeColumnName(data!.names, base);
        useStore.getState().setData({ ...data!, names: [...data!.names, name], cols: [...data!.cols, Float64Array.from(assignment)] }, info!);
        useStore.getState().toast('success', `Segments saved as the data column “${name}”.`);
      }}>Save segments as a data column</button>
  );
}

function FimixView({ r, current }: { r: FimixResult; current: boolean }) {
  const [k, setK] = useState(r.models.reduce((a, b) => (b.criteria.BIC < a.criteria.BIC ? b : a)).k);
  const m = r.models.find((x) => x.k === k) ?? r.models[0];
  const best = (key: 'AIC3' | 'CAIC' | 'BIC' | 'AIC4' | 'HQ' | 'MDL5') => r.models.reduce((a, b) => (b.criteria[key] < a.criteria[key] ? b : a)).k;
  const crit = ['AIC3', 'AIC4', 'BIC', 'CAIC', 'HQ', 'MDL5'] as const;
  const keys = [...new Set(m.segments.flatMap((g) => g.paths.map((p) => `${p.from}→${p.to}`)))];
  return (
    <div className="tables">
      <Table title="Number of segments" file="fimix-criteria" columns={['Segments', 'Log-likelihood', 'Parameters', ...crit, 'EN', 'Smallest']}
        rows={r.models.map((x) => [c(x.k, undefined, 0), c(x.criteria.logLik, undefined, 2), c(x.criteria.npar, undefined, 0),
          ...crit.map((key) => ({ ...c(x.criteria[key], undefined, 1), bold: best(key) === x.k })), c(x.criteria.EN), c(`${fmt(100 * Math.min(...x.segments.map((g) => g.share)), 1)}%`)])}
        note="Sarstedt et al. (2011): choose the number where AIC3 and CAIC agree (else BIC); bold: each criterion’s minimum. EN (normed entropy) above about 0.5 indicates well-separated segments. Segments that are very small are rarely meaningful." />
      <div className="segmented wrap" role="radiogroup" aria-label="Solution shown" style={{ alignSelf: 'flex-start' }}>
        {r.models.map((x) => <button key={x.k} role="radio" aria-checked={x.k === m.k} className={x.k === m.k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} {x.k === 1 ? 'segment' : 'segments'}</button>)}
      </div>
      <Table title={`Segment-specific paths, ${m.k} ${m.k === 1 ? 'segment' : 'segments'}`} file={`fimix-${m.k}-paths`} columns={['Path', ...m.segments.map((g) => `Segment ${g.segment} (${fmt(100 * g.share, 1)}%)`)]}
        rows={[...keys.map((key) => [c(key.replace('→', ' → ')), ...m.segments.map((g) => c(g.paths.find((p) => `${p.from}→${p.to}` === key)?.est ?? null))]),
          ...m.segments[0].r2.map((x, i) => [c(`R² ${x.construct}`), ...m.segments.map((g) => c(g.r2[i]?.r2 ?? null))])]}
        note="Regressions on the global model’s standardised construct scores, one set per segment (R² from the segment’s error variance, by modal assignment). Use them to profile the segments, then re-estimate the full model per segment (save the segments and run a multigroup analysis)." />
      <div><SaveSegments assignment={m.assignment} base={`fimix_${m.k}`} current={current} /></div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

function PosView({ r, current }: { r: PosResult; current: boolean }) {
  const ends = Object.keys(r.globalR2);
  const paths = r.segments[0]?.paths ?? [];
  return (
    <div className="tables">
      <Table title="PLS-POS solution" file="pos-summary" columns={['', 'Global model', ...r.segments.map((g) => `Segment ${g.segment} (n = ${g.size})`)]}
        rows={[...paths.map((p, i) => [c(`${p.from} → ${p.to}`), c(null), ...r.segments.map((g) => c(g.paths[i]?.est ?? null))]),
          ...ends.map((e) => [c(`R² ${e}`), c(r.globalR2[e]), ...r.segments.map((g) => c(g.r2[e] ?? null))])]}
        note={`Becker et al. (2013): segments chosen to maximise the R² of the endogenous constructs (sum over segments ${fmt(r.objective, 3)}; global model ${fmt(r.globalObjective, 3)}). ${r.moves} observations moved in the best of ${r.starts.length} starts (objectives ${r.starts.map((x) => fmt(x, 3)).join(', ')}). Similar objectives across starts suggest a stable solution.`} />
      <div><SaveSegments assignment={r.assignment} base={`pos_${r.k}`} current={current} /></div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}


function RebusView({ r, current }: { r: RebusResult; current: boolean }) {
  // GQI tends to grow with more classes: show the smallest solution first, not the highest GQI.
  const [k, setK] = useState(r.models[0]?.k);
  const m = r.models.find((x) => x.k === k) ?? r.models[0];
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const rows = data?.cols[0]?.length ?? 0;
  const saveColumn = () => {
    if (!current || !data || !info || m.segments.length !== rows) return;
    const col = freeColumnName(data.names, `rebus_${m.k}`);
    useStore.getState().setData({ ...data, names: [...data.names, col], cols: [...data.cols, Float64Array.from(m.segments)] }, info);
    useStore.getState().toast('success', `Class membership saved as the data column “${col}” (1 to ${m.k}).`);
  };
  return (
    <div className="tables">
      <Table title="Solutions" file="rebus-solutions" columns={['Classes', 'GQI', 'Class sizes', 'Iterations']}
        rows={r.models.map((x) => [{ ...c(x.k, undefined, 0), bold: x.k === m.k }, c(x.gqi), c(x.sizes.join(', ')), c(x.iterations, undefined, 0)])}
        note={`Group Quality Index: the goodness of fit (GoF) of the class models together; compare with the global model’s GoF of ${fmt(r.globalGof, 3)}. Prefer a solution that improves on it clearly, with classes that are not too small and that you can interpret.`} />
      <Fusion heights={r.fusion.slice(0, 10)} />
      <div className="hint">Ward clustering of the residuals: a bar much taller than the next one suggests that number of classes as a starting point.</div>
      <div className="segmented wrap" role="radiogroup" aria-label="Solution shown" style={{ alignSelf: 'flex-start' }}>
        {r.models.map((x) => <button key={x.k} role="radio" aria-checked={x.k === m.k} className={x.k === m.k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} classes</button>)}
      </div>
      <Solution r={r} m={m} />
      <div>
        <button className="btn sm" disabled={m.segments.length !== rows || !current} onClick={saveColumn}
          title={!current ? 'The data or the model changed since this ran: run it again first' : m.segments.length !== rows ? 'Rows with missing values were left out, so classes cannot be matched to rows' : 'Add the class of each observation as a data column (for multigroup analysis)'}>
          Save classes as a data column
        </button>
      </div>
    </div>
  );
}

// ---------- the cards ----------

const SEG_GROUP = 'PLS-SEM model' as const;
/** PLS options for segmentation: no FIML or MI, no PLSc unless stated. */
const segOptions = (ctx: AnalysisCtx, missing: PlsOptions['missing'] = 'casewise', consistent = false): PlsOptions =>
  ({ scheme: ctx.settings.scheme, maxIter: ctx.settings.maxIter, tolerance: 10 ** -ctx.settings.stopExp, missing, consistent, approach: ctx.settings.plsApproach, hocApproach: ctx.settings.hocApproach });
/** What a segmentation holds fixed although the Model settings say otherwise. */
const heldNote = (ctx: AnalysisCtx, consistentKept: boolean) => [
  ...(!consistentKept && ctx.settings.consistent ? ['standard PLS (PLSc off: the local models are composites)'] : []),
  ...(ctx.settings.missing !== 'mean' && ctx.settings.missing !== 'casewise' ? ['casewise deletion of missing values'] : []),
].join(', ');
const rebusOptions = (ctx: AnalysisCtx) => segOptions(ctx, ctx.settings.missing === 'mean' ? 'mean' : 'casewise');
const noInteractions = (ctx: AnalysisCtx, method: string) => (ctx.model?.moderations.length || ctx.model?.copulas?.length ? `${method} works on models without interaction terms.` : null);
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
const Hint = ({ text }: { text: string }) => <p className="hint" style={{ marginTop: 0 }}>{text}</p>;

export interface RebusOptions { from: number; to: number }
const rebusInput = (o: RebusOptions, ctx: AnalysisCtx) => ({ classes: range(o.from, o.to), stopCrit: 0.005, iterMax: 100, seed: ctx.settings.seed });

export const rebusAnalysis: AnalysisType<RebusOptions, RebusResult> = {
  id: 'rebus', title: 'REBUS-PLS', sub: 'classes of observations with different models (plspm)', group: SEG_GROUP,
  defaults: () => ({ from: 2, to: 4 }),
  parseOptions: (raw) => (isObj(raw) ? { from: clampNum(raw.from, 2, 6, 2, true), to: clampNum(raw.to, 2, 6, 4, true) } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text="Response-based unit segmentation (Esposito Vinzi et al. 2008) looks for groups of observations whose models differ (unobserved heterogeneity). It starts from a Ward clustering of the global model’s residuals, then moves each observation to the class whose local model fits it best, until the classes are stable." />
      <div className="field">
        <label>Numbers of classes to compare</label>
        <div className="row2">
          <input className="input num" type="number" min={2} max={6} aria-label="From" value={o.from} onChange={(e) => set({ ...o, from: clampNum(e.target.value, 2, 6, 2, true) })} />
          <input className="input num" type="number" min={2} max={6} aria-label="To" value={o.to} onChange={(e) => set({ ...o, to: clampNum(e.target.value, 2, 6, 2, true) })} />
        </div>
        <div className="hint">The model on the canvas, reflective constructs only, estimated by plspm{heldNote(ctx, false) ? ` with ${heldNote(ctx, false)}` : ''}. Stop when under 0.5% of observations change class (at most 100 iterations); permutation tests use the seed from the Model settings.</div>
      </div>
    </fieldset>
  ),
  View: ({ result, current }) => <RebusView key={result.models.map((m) => m.k).join()} r={result} current={current} />,
  blocked: (o, ctx) => plsModelBlocked(ctx)
    ?? (ctx.settings.plsApproach !== 'PLS-PM' ? 'REBUS-PLS (plspm) estimates by PLS path modeling: choose PLS-PM as the weighting approach.' : null)
    ?? (ctx.model!.constructs.some((x) => x.mode === 'B' || x.type === 'composite') ? 'REBUS-PLS needs reflective constructs (Mode A, common factors) only.' : null)
    ?? noInteractions(ctx, 'REBUS-PLS') ?? (o.from > o.to ? 'The smallest number of classes must not exceed the largest.' : null),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], [ctx.settings.seed], rebusOptions(ctx)),
  run: async (o, ctx) => (await import('../rengine/segment')).rebusR(rawData(ctx)!, specOf(ctx), rebusOptions(ctx), rebusInput(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/segment')).rebusScriptR(rawData(ctx)!, specOf(ctx), rebusOptions(ctx), rebusInput(o, ctx)),
  summary: (o) => `${o.from === o.to ? o.from : `${o.from}–${o.to}`} classes`,
};

export interface PathmoxOptions { segments: PathmoxSegment[]; alpha: number; depth: number; size: number }

/** Columns that can split the sample: not in the model, at most 20 distinct values. */
function segmentCandidates(ctx: AnalysisCtx): string[] {
  const ds = rawData(ctx);
  if (!ds) return [];
  const assigned = new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators));
  return ds.names.filter((n, i) => !assigned.has(n) && new Set(Array.from(ds.cols[i]).filter((v) => !Number.isNaN(v))).size <= 20);
}

function PathmoxOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<PathmoxOptions>) {
  const ds = rawData(ctx);
  const candidates = segmentCandidates(ctx);
  const labelsOf = (col: string) => ds?.categories?.[col] ?? [...new Set(Array.from(ds!.cols[ds!.names.indexOf(col)]).filter((v) => !Number.isNaN(v)))].sort((a, b) => a - b).map(String);
  const setSegs = (segments: PathmoxSegment[]) => set({ ...o, segments });
  const toggle = (col: string, on: boolean) => setSegs(on ? [...o.segments, { column: col, labels: labelsOf(col), ordered: false }] : o.segments.filter((s) => s.column !== col));
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text="PATHMOX (Lamberti et al. 2016) grows a tree: it splits the sample by observed categorical variables (e.g. age group, region) where the models of the two parts differ most." />
      <div className="field">
        <label>Segmentation variables (not in the model, at most 20 values)</label>
        {candidates.map((col) => {
          const seg = o.segments.find((s) => s.column === col);
          const order = seg?.order ?? seg?.labels.map((_, i) => i + 1) ?? [];
          return (
            <div key={col} className="seg-var">
              <label className="check" style={{ marginBottom: 2 }}><input type="checkbox" checked={!!seg} onChange={(e) => toggle(col, e.target.checked)} /><span>{col}</span></label>
              {seg && (
                <div className="seg-var-detail">
                  <label className="check" style={{ marginBottom: 2 }}>
                    <input type="checkbox" checked={seg.ordered} onChange={(e) => setSegs(o.segments.map((s) => (s.column === col ? { ...s, ordered: e.target.checked, order: e.target.checked ? order : undefined } : s)))} />
                    <span>Ordered (only neighbouring categories are grouped)</span>
                  </label>
                  {seg.ordered && (
                    <ol className="cat-order">
                      {order.map((code, i) => (
                        <li key={code}>{seg.labels[code - 1]}
                          <button className="btn sm ghost" aria-label="Move up" disabled={i === 0} onClick={() => setSegs(o.segments.map((s) => (s.column === col ? { ...s, order: moveCategory(order, i, -1) } : s)))}>↑</button>
                          <button className="btn sm ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => setSegs(o.segments.map((s) => (s.column === col ? { ...s, order: moveCategory(order, i, 1) } : s)))}>↓</button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!candidates.length && <div className="hint">No columns with few values outside the model.</div>}
      </div>
      <div className="row2">
        <div className="field"><label htmlFor="pm-alpha">Significance</label><input id="pm-alpha" className="input num" type="number" step={0.01} min={0.001} max={0.2} value={o.alpha} onChange={(e) => set({ ...o, alpha: clampNum(e.target.value, 0.001, 0.2, 0.05) })} /></div>
        <div className="field"><label htmlFor="pm-depth">Depth</label><input id="pm-depth" className="input num" type="number" min={1} max={6} value={o.depth} onChange={(e) => set({ ...o, depth: clampNum(e.target.value, 1, 6, 2, true) })} /></div>
      </div>
      <div className="field"><label htmlFor="pm-size">Smallest node (share of the sample)</label><input id="pm-size" className="input num" type="number" step={0.01} min={0.02} max={0.4} value={o.size} onChange={(e) => set({ ...o, size: clampNum(e.target.value, 0.02, 0.4, 0.1) })} /></div>
    </fieldset>
  );
}

function parseSegment(v: unknown): PathmoxSegment | null {
  if (!isObj(v) || !name(v.column)) return null;
  const labels = Array.isArray(v.labels) ? v.labels.slice(0, 50).map((x) => name(x)) : [];
  const order = Array.isArray(v.order) ? v.order.slice(0, 50).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= labels.length) : undefined;
  const ordered = flag(v.ordered) && !!order && order.length === labels.length && new Set(order).size === order.length;
  return { column: name(v.column), labels, ordered, ...(ordered ? { order } : {}) };
}

export const pathmoxAnalysis: AnalysisType<PathmoxOptions, PathmoxResult> = {
  id: 'pathmox', title: 'PATHMOX', sub: 'a tree of segments by observed categorical variables (genpathmox)', group: SEG_GROUP,
  defaults: () => ({ segments: [], alpha: 0.05, depth: 2, size: 0.1 }),
  parseOptions: (raw) => (isObj(raw) ? {
    segments: (Array.isArray(raw.segments) ? raw.segments.slice(0, 50) : []).map(parseSegment).filter((s): s is PathmoxSegment => !!s),
    alpha: clampNum(raw.alpha, 0.001, 0.2, 0.05), depth: clampNum(raw.depth, 1, 6, 2, true), size: clampNum(raw.size, 0.02, 0.4, 0.1),
  } : null),
  Options: PathmoxOptionsForm,
  View: ({ result }) => <PathmoxView r={result} />,
  blocked: (o, ctx) => plsModelBlocked(ctx) ?? (ctx.settings.plsApproach !== 'PLS-PM' ? 'PATHMOX (genpathmox) estimates by PLS path modeling: choose PLS-PM as the weighting approach.' : null) ?? noInteractions(ctx, 'PATHMOX') ?? (!o.segments.length ? 'Choose at least one segmentation variable.'
    : o.segments.some((s) => !segmentCandidates(ctx).includes(s.column)) ? 'A segmentation variable is no longer usable (not in the data, in the model, or more than 20 values).' : null),
  fingerprint: (o, ctx) => modelFingerprint(ctx, o.segments.map((s) => s.column), [], segOptions(ctx, 'casewise', ctx.settings.consistent)),
  run: async (o, ctx) => (await import('../rengine/segment')).pathmoxR(rawData(ctx)!, specOf(ctx), segOptions(ctx, 'casewise', ctx.settings.consistent), o),
  script: async (o, ctx) => (await import('../rengine/segment')).pathmoxScriptR(rawData(ctx)!, specOf(ctx), segOptions(ctx, 'casewise', ctx.settings.consistent), o),
  summary: (o) => (o.segments.length ? `by ${o.segments.map((s) => s.column).join(', ')} · depth ${o.depth}` : 'not set up yet'),
};

export interface FimixOptions { to: number; nrep: number; intercepts: boolean }
const fimixInput = (o: FimixOptions, ctx: AnalysisCtx) => ({ classes: range(1, o.to), nrep: o.nrep, seed: ctx.settings.seed, intercepts: o.intercepts });

export const fimixAnalysis: AnalysisType<FimixOptions, FimixResult> = {
  id: 'fimix', title: 'FIMIX-PLS', sub: 'unobserved segments with their own structural paths (flexmix)', group: SEG_GROUP,
  defaults: () => ({ to: 4, nrep: 10, intercepts: true }),
  parseOptions: (raw) => (isObj(raw) ? { to: clampNum(raw.to, 2, 8, 4, true), nrep: clampNum(raw.nrep, 1, 100, 10, true), intercepts: raw.intercepts !== false } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text="FIMIX-PLS (Hahn et al. 2002; Sarstedt et al. 2011) assumes the structural model differs between unobserved segments and estimates segment-specific paths as a finite mixture on the global model’s construct scores." />
      <div className="row2">
        <div className="field"><label htmlFor="fx-to">Segments: 1 to</label><input id="fx-to" className="input num" type="number" min={2} max={8} value={o.to} onChange={(e) => set({ ...o, to: clampNum(e.target.value, 2, 8, 2, true) })} /></div>
        <div className="field"><label htmlFor="fx-nrep">Random starts</label><input id="fx-nrep" className="input num" type="number" min={1} max={100} value={o.nrep} onChange={(e) => set({ ...o, nrep: clampNum(e.target.value, 1, 100, 10, true) })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={o.intercepts} onChange={(e) => set({ ...o, intercepts: e.target.checked })} />
        <span>Segment-specific intercepts<br /><span className="hint">Segments may also differ in their levels. Hahn et al.’s original model has none (on standardised scores); without them, segments that differ in level are hard to find.</span></span></label>
      <div className="hint">Seed {ctx.settings.seed} (Model settings); flexmix, best of the starts per number of segments. Global model: cSEM{heldNote(ctx, false) ? ` with ${heldNote(ctx, false)}` : ''}.</div>
    </fieldset>
  ),
  View: ({ result, current }) => <FimixView key={result.models.length} r={result} current={current} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx) ?? noInteractions(ctx, 'FIMIX-PLS'),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], [ctx.settings.seed], segOptions(ctx)),
  run: async (o, ctx) => (await import('../rengine/segment')).fimixR(rawData(ctx)!, specOf(ctx), segOptions(ctx), fimixInput(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/segment')).fimixScriptR(rawData(ctx)!, specOf(ctx), segOptions(ctx), fimixInput(o, ctx)),
  summary: (o) => `1–${o.to} segments · ${o.nrep} starts`,
};

export interface PosOptions { segments: number; nrep: number }

export const posAnalysis: AnalysisType<PosOptions, PosResult> = {
  id: 'pos', title: 'PLS-POS', sub: 'prediction-oriented segmentation: segments that maximise R²', group: SEG_GROUP,
  defaults: () => ({ segments: 2, nrep: 3 }),
  parseOptions: (raw) => (isObj(raw) ? { segments: clampNum(raw.segments, 2, 6, 2, true), nrep: clampNum(raw.nrep, 1, 50, 3, true) } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text="PLS-POS (Becker, Rai, Ringle & Völckner 2013) moves observations between segments as long as the explained variance of the endogenous constructs grows. It works with composites (Mode A or Mode B weights), and needs no distributional assumption. No R package implements it: PLS Studio’s implementation (in the R script) re-estimates the local models with cSEM." />
      <div className="row2">
        <div className="field"><label htmlFor="pos-k">Segments</label><input id="pos-k" className="input num" type="number" min={2} max={6} value={o.segments} onChange={(e) => set({ ...o, segments: clampNum(e.target.value, 2, 6, 2, true) })} /></div>
        <div className="field"><label htmlFor="pos-nrep">Random starts</label><input id="pos-nrep" className="input num" type="number" min={1} max={50} value={o.nrep} onChange={(e) => set({ ...o, nrep: clampNum(e.target.value, 1, 50, 3, true) })} /></div>
      </div>
      <div className="hint">Each move re-estimates two local models{heldNote(ctx, false) ? ` (${heldNote(ctx, false)})` : ''}, so this takes a while (about half a minute for 400 observations and two segments). Seed {ctx.settings.seed} (Model settings). Choose the number of segments with FIMIX-PLS first, as Becker et al. suggest.</div>
    </fieldset>
  ),
  View: ({ result, current }) => <PosView r={result} current={current} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx) ?? noInteractions(ctx, 'PLS-POS'),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], [ctx.settings.seed], segOptions(ctx)),
  run: async (o, ctx) => (await import('../rengine/segment')).posR(rawData(ctx)!, specOf(ctx), segOptions(ctx), { segments: o.segments, nrep: o.nrep, seed: ctx.settings.seed }),
  script: async (o, ctx) => (await import('../rengine/segment')).posScriptR(rawData(ctx)!, specOf(ctx), segOptions(ctx), { segments: o.segments, nrep: o.nrep, seed: ctx.settings.seed }),
  summary: (o) => `${o.segments} segments · ${o.nrep} starts`,
};

/** The card a segmentation example opens, with its settings. */
export function segmentationCard(seg: { method?: 'rebus' | 'pathmox' | 'fimix' | 'pos'; from?: number; to?: number }, segments: PathmoxSegment[]): [string, object] {
  const m = seg.method ?? 'rebus';
  return m === 'pathmox' ? ['pathmox', { segments }] : m === 'rebus' ? ['rebus', { from: seg.from ?? 2, to: seg.to ?? 4 }] : [m, {}];
}
