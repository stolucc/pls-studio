import { useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { PlsOptions } from '../engine/types';
import { toSpec, validateModel } from '../model/project';
import type { PathmoxResult, PathmoxSegment } from '../rengine/segment';
import { useStore } from '../store';
import { c, pCell, Table } from './results/Table';
import { SegmentationTabs, type SegMethod } from './SegmentationPanel';

interface ExtraState {
  pathmox: PathmoxResult | null;
  /** Segmentation variables chosen for PATHMOX (kept while the panel is closed). */
  segments: PathmoxSegment[];
}
export const useSegExtra = create<ExtraState>(() => ({ pathmox: null, segments: [] }));

/** Move one category up or down in an ordered segmentation variable. */
export function moveCategory(order: number[], i: number, delta: -1 | 1): number[] {
  const j = i + delta;
  if (j < 0 || j >= order.length) return order;
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
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

function PathmoxSection() {
  const data = useStore((s) => s.data);
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const result = useSegExtra((s) => s.pathmox);
  const segments = useSegExtra((s) => s.segments);
  const [alpha, setAlpha] = useState(0.05), [depth, setDepth] = useState(2), [size, setSize] = useState(0.1);
  const [busy, setBusy] = useState(false);
  const errors = data ? validateModel(model, data, { ...settings, method: 'pls' }).filter((i) => i.level === 'error') : [];
  const problem = !data || data.moments ? 'Import raw data first.' : !model.paths.length ? 'Draw a PLS path model (with paths) first.'
    : model.moderations.length ? 'PATHMOX works on models without interaction terms.' : errors[0]?.message ?? null;
  const assigned = new Set(model.constructs.flatMap((k) => k.indicators));
  const candidates = data ? data.names.filter((n) => !assigned.has(n) && new Set(Array.from(data.cols[data.names.indexOf(n)]).filter((v) => !Number.isNaN(v))).size <= 20) : [];
  const labelsOf = (col: string) => data?.categories?.[col] ?? [...new Set(Array.from(data!.cols[data!.names.indexOf(col)]).filter((v) => !Number.isNaN(v)))].sort((a, b) => a - b).map(String);
  const set = (segs: PathmoxSegment[]) => useSegExtra.setState({ segments: segs });
  const toggle = (col: string, on: boolean) => set(on ? [...segments, { column: col, labels: labelsOf(col), ordered: false }] : segments.filter((s) => s.column !== col));
  const options: PlsOptions = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: 'casewise', consistent: settings.consistent };
  const input = { segments, alpha, depth, size };
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `genpathmox: ${rMessage(e)}`));
  const run = async (script = false) => {
    setBusy(true);
    try {
      const m = await import('../rengine/segment');
      if (script) downloadText(`${safeFileName(project)}-pathmox.R`, await m.pathmoxScriptR(data!, toSpec(model), options, input), 'text/x-r-source');
      else { const r = await m.pathmoxR(data!, toSpec(model), options, input); r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `genpathmox ${r.engine.version}`)); useSegExtra.setState({ pathmox: r }); }
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="sim-col">
        <SegmentationTabs />
        {problem ? <div className="empty-results">{problem}</div> : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>PATHMOX (Lamberti et al. 2016) grows a tree: it splits the sample by observed categorical variables (e.g. age group, region) where the models of the two parts differ most.</p>
            <div className="field">
              <label>Segmentation variables (not in the model, at most 20 values)</label>
              {candidates.map((col) => {
                const seg = segments.find((s) => s.column === col);
                const order = seg?.order ?? seg?.labels.map((_, i) => i + 1) ?? [];
                return (
                  <div key={col} className="seg-var">
                    <label className="check" style={{ marginBottom: 2 }}><input type="checkbox" checked={!!seg} onChange={(e) => toggle(col, e.target.checked)} /><span>{col}</span></label>
                    {seg && (
                      <div className="seg-var-detail">
                        <label className="check" style={{ marginBottom: 2 }}>
                          <input type="checkbox" checked={seg.ordered} onChange={(e) => set(segments.map((s) => (s.column === col ? { ...s, ordered: e.target.checked, order: e.target.checked ? order : undefined } : s)))} />
                          <span>Ordered (only neighbouring categories are grouped)</span>
                        </label>
                        {seg.ordered && (
                          <ol className="cat-order">
                            {order.map((code, i) => (
                              <li key={code}>{seg.labels[code - 1]}
                                <button className="btn sm ghost" aria-label="Move up" disabled={i === 0} onClick={() => set(segments.map((s) => (s.column === col ? { ...s, order: moveCategory(order, i, -1) } : s)))}>↑</button>
                                <button className="btn sm ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => set(segments.map((s) => (s.column === col ? { ...s, order: moveCategory(order, i, 1) } : s)))}>↓</button>
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
              <div className="field"><label>Significance</label><input className="input num" type="number" step={0.01} min={0.001} max={0.2} value={alpha} onChange={(e) => setAlpha(Math.max(0.001, Math.min(0.2, Number(e.target.value) || 0.05)))} /></div>
              <div className="field"><label>Depth</label><input className="input num" type="number" min={1} max={6} value={depth} onChange={(e) => setDepth(Math.max(1, Math.min(6, Math.round(Number(e.target.value)) || 2)))} /></div>
            </div>
            <div className="field"><label>Smallest node (share of the sample)</label><input className="input num" type="number" step={0.01} min={0.02} max={0.4} value={size} onChange={(e) => setSize(Math.max(0.02, Math.min(0.4, Number(e.target.value) || 0.1)))} /></div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy || !segments.length} onClick={() => void run()}>{busy ? 'Growing the tree…' : 'Estimate'}</button>
              <button className="btn" disabled={busy || !segments.length} onClick={() => void run(true)}>R script</button>
            </div>
          </>
        )}
      </section>
      <section className="sim-col wide">{result ? <PathmoxView r={result} /> : <div className="empty-results">Choose segmentation variables and press Estimate.</div>}</section>
    </>
  );
}

export function OtherSegmentation({ method }: { method: Exclude<SegMethod, 'rebus'> }) {
  if (method === 'pathmox') return <PathmoxSection />;
  return <section className="sim-col"><SegmentationTabs /><div className="empty-results">Coming next.</div></section>;
}
