import { useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { PlsOptions } from '../engine/types';
import { toSpec, validateModel } from '../model/project';
import type { FimixResult, PathmoxResult, PathmoxSegment, PosResult } from '../rengine/segment';
import { freeColumnName } from './SegmentationPanel';
import { useStore } from '../store';
import { c, pCell, Table } from './results/Table';
import { SegmentationTabs, type SegMethod } from './SegmentationPanel';

interface ExtraState {
  pathmox: PathmoxResult | null;
  fimix: FimixResult | null;
  pos: PosResult | null;
  /** Segmentation variables chosen for PATHMOX (kept while the panel is closed). */
  segments: PathmoxSegment[];
}
export const useSegExtra = create<ExtraState>(() => ({ pathmox: null, fimix: null, pos: null, segments: [] }));

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

/** Save a segment assignment (1-based, one per analysed row) as a data column when no rows were left out. */
function SaveSegments({ assignment, base }: { assignment: number[]; base: string }) {
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const ok = !!data && !!info && assignment.length === (data.cols[0]?.length ?? -1);
  return (
    <button className="btn sm" disabled={!ok} title={ok ? 'Add the segment of each observation as a data column (for multigroup analysis)' : 'Rows were left out (missing values), so segments cannot be matched to rows'}
      onClick={() => {
        const name = freeColumnName(data!.names, base);
        useStore.getState().setData({ ...data!, names: [...data!.names, name], cols: [...data!.cols, Float64Array.from(assignment)] }, info!);
        useStore.getState().toast('success', `Segments saved as the data column “${name}”.`);
      }}>Save segments as a data column</button>
  );
}

function FimixView({ r }: { r: FimixResult }) {
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
      <div><SaveSegments assignment={m.assignment} base={`fimix_${m.k}`} /></div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

function FimixSection() {
  const data = useStore((s) => s.data);
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const result = useSegExtra((s) => s.fimix);
  const [to, setTo] = useState(4), [nrep, setNrep] = useState(10), [intercepts, setIntercepts] = useState(true);
  const [busy, setBusy] = useState(false);
  const errors = data ? validateModel(model, data, { ...settings, method: 'pls' }).filter((i) => i.level === 'error') : [];
  const problem = !data || data.moments ? 'Import raw data first.' : !model.paths.length ? 'Draw a PLS path model (with paths) first.'
    : model.moderations.length ? 'FIMIX-PLS works on models without interaction terms.' : errors[0]?.message ?? null;
  const options: PlsOptions = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: 'casewise', consistent: false };
  const input = { classes: Array.from({ length: to }, (_, i) => i + 1), nrep, seed: settings.seed, intercepts };
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `flexmix: ${rMessage(e)}`));
  const run = async (script = false) => {
    setBusy(true);
    try {
      const m = await import('../rengine/segment');
      if (script) downloadText(`${safeFileName(project)}-fimix.R`, await m.fimixScriptR(data!, toSpec(model), options, input), 'text/x-r-source');
      else { const r = await m.fimixR(data!, toSpec(model), options, input); r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `flexmix ${r.engine.version}`)); useSegExtra.setState({ fimix: r }); }
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="sim-col">
        <SegmentationTabs />
        {problem ? <div className="empty-results">{problem}</div> : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>FIMIX-PLS (Hahn et al. 2002; Sarstedt et al. 2011) assumes the structural model differs between unobserved segments and estimates segment-specific paths as a finite mixture on the global model’s construct scores.</p>
            <div className="row2">
              <div className="field"><label>Segments: 1 to</label><input className="input num" type="number" min={2} max={8} value={to} onChange={(e) => setTo(Math.max(2, Math.min(8, Math.round(Number(e.target.value)) || 2)))} /></div>
              <div className="field"><label>Random starts</label><input className="input num" type="number" min={1} max={100} value={nrep} onChange={(e) => setNrep(Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 10)))} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={intercepts} onChange={(e) => setIntercepts(e.target.checked)} />
              <span>Segment-specific intercepts<br /><span className="hint">Segments may also differ in their levels. Hahn et al.’s original model has none (on standardised scores); without them, segments that differ in level are hard to find.</span></span></label>
            <div className="hint">Seed {settings.seed} (Model settings); flexmix, best of the starts per number of segments.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
              <button className="btn" disabled={busy} onClick={() => void run(true)}>R script</button>
            </div>
          </>
        )}
      </section>
      <section className="sim-col wide">{result ? <FimixView key={result.models.length} r={result} /> : <div className="empty-results">Press Estimate.</div>}</section>
    </>
  );
}

function PosView({ r }: { r: PosResult }) {
  const ends = Object.keys(r.globalR2);
  const paths = r.segments[0]?.paths ?? [];
  return (
    <div className="tables">
      <Table title="PLS-POS solution" file="pos-summary" columns={['', 'Global model', ...r.segments.map((g) => `Segment ${g.segment} (n = ${g.size})`)]}
        rows={[...paths.map((p, i) => [c(`${p.from} → ${p.to}`), c(null), ...r.segments.map((g) => c(g.paths[i]?.est ?? null))]),
          ...ends.map((e) => [c(`R² ${e}`), c(r.globalR2[e]), ...r.segments.map((g) => c(g.r2[e] ?? null))])]}
        note={`Becker et al. (2013): segments chosen to maximise the R² of the endogenous constructs (sum over segments ${fmt(r.objective, 3)}; global model ${fmt(r.globalObjective, 3)}). ${r.moves} observations moved in the best of ${r.starts.length} starts (objectives ${r.starts.map((x) => fmt(x, 3)).join(', ')}). Similar objectives across starts suggest a stable solution.`} />
      <div><SaveSegments assignment={r.assignment} base={`pos_${r.k}`} /></div>
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

function PosSection() {
  const data = useStore((s) => s.data);
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const result = useSegExtra((s) => s.pos);
  const [k, setK] = useState(2), [nrep, setNrep] = useState(3);
  const [busy, setBusy] = useState(false);
  const errors = data ? validateModel(model, data, { ...settings, method: 'pls' }).filter((i) => i.level === 'error') : [];
  const problem = !data || data.moments ? 'Import raw data first.' : !model.paths.length ? 'Draw a PLS path model (with paths) first.'
    : model.moderations.length ? 'PLS-POS works on models without interaction terms.' : errors[0]?.message ?? null;
  const options: PlsOptions = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: 'casewise', consistent: false };
  const input = { segments: k, nrep, seed: settings.seed };
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `PLS-POS: ${rMessage(e)}`));
  const run = async (script = false) => {
    setBusy(true);
    try {
      const m = await import('../rengine/segment');
      if (script) downloadText(`${safeFileName(project)}-pls-pos.R`, await m.posScriptR(data!, toSpec(model), options, input), 'text/x-r-source');
      else useSegExtra.setState({ pos: await m.posR(data!, toSpec(model), options, input) });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  return (
    <>
      <section className="sim-col">
        <SegmentationTabs />
        {problem ? <div className="empty-results">{problem}</div> : (
          <>
            <p className="hint" style={{ marginTop: 0 }}>PLS-POS (Becker, Rai, Ringle & Völckner 2013) moves observations between segments as long as the explained variance of the endogenous constructs grows. It works with composites and formative constructs, and needs no distributional assumption. No R package implements it: PLS Studio’s implementation (in the R script) re-estimates the local models with cSEM.</p>
            <div className="row2">
              <div className="field"><label>Segments</label><input className="input num" type="number" min={2} max={6} value={k} onChange={(e) => setK(Math.max(2, Math.min(6, Math.round(Number(e.target.value)) || 2)))} /></div>
              <div className="field"><label>Random starts</label><input className="input num" type="number" min={1} max={50} value={nrep} onChange={(e) => setNrep(Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 3)))} /></div>
            </div>
            <div className="hint">Each move re-estimates two local models, so this takes a while (about half a minute for 400 observations and two segments). Seed {settings.seed} (Model settings). Choose the number of segments with FIMIX-PLS first, as Becker et al. suggest.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? 'Segmenting…' : 'Estimate'}</button>
              <button className="btn" disabled={busy} onClick={() => void run(true)}>R script</button>
            </div>
          </>
        )}
      </section>
      <section className="sim-col wide">{result ? <PosView r={result} /> : <div className="empty-results">Press Estimate.</div>}</section>
    </>
  );
}

export function OtherSegmentation({ method }: { method: Exclude<SegMethod, 'rebus'> }) {
  if (method === 'pathmox') return <PathmoxSection />;
  if (method === 'fimix') return <FimixSection />;
  return <PosSection />;
}
