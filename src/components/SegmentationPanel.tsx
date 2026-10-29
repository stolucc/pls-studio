import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import { toSpec, validateModel } from '../model/project';
import type { RebusInput, RebusModel, RebusResult } from '../rengine/segment';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { c, pCell, Table } from './results/Table';
import { OtherSegmentation } from './SegmentationMethods';
import { isCancelled } from '../cancellable';
import { useCancellable } from './useCancellable';

export type SegMethod = 'rebus' | 'pathmox' | 'fimix' | 'pos';
interface SegState {
  open: boolean; method: SegMethod; rebus: { input: RebusInput; result: RebusResult; modelKey: string } | null;
  /** Numbers of classes filled in by an example (applied when it changes). */
  preset: { from: number; to: number } | null;
  setOpen: (v: boolean) => void;
}
export const useSegmentation = create<SegState>((set) => ({ open: false, method: 'rebus', rebus: null, preset: null, setOpen: (open) => set({ open }) }));

const METHOD_LABEL: Record<SegMethod, string> = { rebus: 'REBUS-PLS', pathmox: 'PATHMOX', fimix: 'FIMIX-PLS', pos: 'PLS-POS' };
/** The method switch at the top of the panel's form. */
export function SegmentationTabs() {
  const method = useSegmentation((s) => s.method);
  return (
    <div className="segmented wrap" role="radiogroup" aria-label="Segmentation method" style={{ marginBottom: 12 }}>
      {(Object.keys(METHOD_LABEL) as SegMethod[]).map((m) => (
        <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => useSegmentation.setState({ method: m })}>{METHOD_LABEL[m]}</button>
      ))}
    </div>
  );
}

/** A data column name not yet in use: rebus_k, rebus_k_2, ... */
export function freeColumnName(names: string[], base: string): string {
  let name = base, i = 2;
  while (names.includes(name)) name = `${base}_${i++}`;
  return name;
}

/** Fusion levels of the last merges: a large jump below k classes suggests k. */
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

/** REBUS-PLS segmentation of the current PLS model (plspm). */
export function SegmentationPanel() {
  const open = useSegmentation((s) => s.open);
  const method = useSegmentation((s) => s.method);
  const rebus = useSegmentation((s) => s.rebus);
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const [from, setFrom] = useState(rebus ? Math.min(...rebus.input.classes) : 2);
  const [to, setTo] = useState(rebus ? Math.max(...rebus.input.classes) : 4);
  const [k, setK] = useState<number | null>(null);
  const { busy, setBusy, guard, cancel } = useCancellable();
  const preset = useSegmentation((s) => s.preset);
  useEffect(() => { if (preset) { setFrom(preset.from); setTo(preset.to); setK(null); } }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useSegmentation.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => useSegmentation.getState().setOpen(false);
  if (method !== 'rebus') {
    return (
      <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Segmentation">
        <div className="sim">
          <header className="sim-head">
            <div><b>Segmentation: {METHOD_LABEL[method]}</b><span className="muted">{method === 'pathmox' ? 'genpathmox' : method === 'fimix' ? 'finite mixture of the structural regressions (flexmix)' : 'prediction-oriented segmentation'} · {settings.scheme} weighting{settings.consistent ? ', PLSc' : ''} (Model settings)</span></div>
            <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
          </header>
          <div className="sim-body long-body"><OtherSegmentation method={method} /></div>
        </div>
      </div>
    );
  }
  const modelKey = JSON.stringify([model.constructs.map((x) => [x.name, x.indicators, x.mode]), model.paths.map((p) => [p.from, p.to])]);
  const errors = data ? validateModel(model, data, { ...settings, method: 'pls' }).filter((i) => i.level === 'error') : [];
  const problem = !data || data.moments ? 'Import raw data first.'
    : !model.paths.length ? 'Draw a PLS path model (with paths) first.'
    : model.constructs.some((x) => x.mode === 'B' || x.type === 'composite') ? 'REBUS-PLS needs reflective constructs (Mode A, common factors) only.'
    : model.moderations.length ? 'REBUS-PLS works on models without interaction terms.'
    : errors[0]?.message ?? null;
  const classes = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const input: RebusInput = { classes, stopCrit: 0.005, iterMax: 100, seed: settings.seed };
  const options = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: settings.missing === 'mean' ? 'mean' as const : 'casewise' as const, consistent: false };
  const fail = (e: unknown) => isCancelled(e) ? Promise.resolve() : import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `plspm: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { rebusR } = await import('../rengine/segment');
      const result = await guard(rebusR(data!, toSpec(model), options, input));
      result.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `plspm ${result.engine.version}`));
      useSegmentation.setState({ rebus: { input, result, modelKey } });
      // GQI tends to grow with more classes: show the smallest solution first, not the highest GQI.
      setK(result.models[0].k);
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { rebusScriptR } = await import('../rengine/segment');
      downloadText(`${safeFileName(project)}-plspm-rebus.R`, await rebusScriptR(data!, toSpec(model), options, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const r = rebus?.result;
  const stale = !!rebus && rebus.modelKey !== modelKey;
  const m = r ? r.models.find((x) => x.k === k) ?? r.models[0] : null;
  // Class membership as a new data column, for group comparisons (only when no rows were dropped).
  const rows = data?.cols[0]?.length ?? 0;
  const saveColumn = () => {
    if (!data || !info || !m || m.segments.length !== rows) return;
    const name = freeColumnName(data.names, `rebus_${m.k}`);
    useStore.getState().setData({ ...data, names: [...data.names, name], cols: [...data.cols, Float64Array.from(m.segments)] }, info);
    useStore.getState().toast('success', `Class membership saved as the data column “${name}” (1 to ${m.k}).`);
  };
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Segmentation">
      <div className="sim">
        <header className="sim-head">
          <div><b>Segmentation: REBUS-PLS</b><span className="muted">plspm · {settings.scheme} weighting (from the Model settings)</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {problem ? <div className="sim-body long-body"><section className="sim-col"><SegmentationTabs /><div className="empty-results">{problem}</div></section></div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <SegmentationTabs />
              <p className="hint" style={{ marginTop: 0 }}>
                Response-based unit segmentation (Esposito Vinzi et al. 2008) looks for groups of observations whose models differ (unobserved heterogeneity).
                It starts from a Ward clustering of the global model’s residuals, then moves each observation to the class whose local model fits it best, until the classes are stable.
              </p>
              <div className="field">
                <label>Numbers of classes to compare</label>
                <div className="row2">
                  <input className="input num" type="number" min={2} max={6} value={from} onChange={(e) => setFrom(Math.max(2, Math.min(6, Math.round(Number(e.target.value)) || 2)))} />
                  <input className="input num" type="number" min={2} max={6} value={to} onChange={(e) => setTo(Math.max(2, Math.min(6, Math.round(Number(e.target.value)) || 2)))} />
                </div>
                <div className="hint">The model in the diagram, reflective constructs only. Stop when under 0.5% of observations change class (at most 100 iterations); permutation tests use the seed from the Model settings.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={busy || !classes.length} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
                {busy && <button className="btn" onClick={cancel}>Cancel</button>}
                <button className="btn" disabled={!classes.length} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {!r || !m ? <div className="empty-results">Choose the numbers of classes and press Estimate.</div> : (
                <div className="tables">
                  {stale && <div className="issue warning">The model changed since this segmentation: press Estimate again.</div>}
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
                    <button className="btn sm" disabled={m.segments.length !== rows || stale} onClick={saveColumn}
                      title={m.segments.length !== rows ? 'Rows with missing values were left out, so classes cannot be matched to rows' : 'Add the class of each observation as a data column (for multigroup analysis)'}>
                      Save classes as a data column
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
