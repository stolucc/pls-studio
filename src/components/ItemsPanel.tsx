import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { IrtModel, IrtResult, LcaResult } from '../rengine/items';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';
import { isCancelled } from '../cancellable';
import { useCancellable } from './useCancellable';

/** Inputs filled in by an example (applied when it changes). */
export type ItemsPreset = { kind: 'irt'; items: string[]; model: IrtModel } | { kind: 'lca'; items: string[]; from: number; to: number };
interface ItemsState { open: boolean; irt: IrtResult | null; lca: LcaResult | null; preset: ItemsPreset | null; setOpen: (v: boolean) => void }
export const useItems = create<ItemsState>((set) => ({ open: false, irt: null, lca: null, preset: null, setOpen: (open) => set({ open }) }));

const MODELS: { id: IrtModel; label: string; hint: string }[] = [
  { id: 'rasch', label: 'Rasch (1PL)', hint: 'Binary items; one common discrimination, item difficulties.' },
  { id: 'twopl', label: '2PL', hint: 'Binary items; each item its own difficulty and discrimination.' },
  { id: 'grm', label: 'Graded response', hint: 'Ordered categories (e.g. Likert items; Samejima): thresholds between successive categories and a discrimination per item.' },
  { id: 'gpcm', label: 'Partial credit (GPCM)', hint: 'Ordered categories (Muraki): step difficulties and a discrimination per item.' },
];
const PARAM: Record<string, string> = { Dffclt: 'Difficulty (b)', Dscrmn: 'Discrimination (a)' };
const paramName = (k: string) => PARAM[k] ?? k.replace(/^Extrmt(\d+)$/, 'Threshold $1').replace(/^Catgr\.(\d+)$/, 'Step $1');

function IrtView({ r }: { r: IrtResult }) {
  const keys = [...new Set(r.params.flatMap((p) => Object.keys(p.values)))];
  const total = r.theta.map((_, i) => r.information.reduce((s, a) => s + (a[i] ?? 0), 0));
  const W = 460, H = 240, pad = { l: 52, r: 14, t: 12, b: 40 };
  const max = Math.max(...total, 1e-9);
  const sx = (t: number) => pad.l + ((t + 4) / 8) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((max * 1.08 - v) / (max * 1.08)) * (H - pad.t - pad.b);
  const line = (vals: number[]) => r.theta.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(vals[i])}`).join(' ');
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['n', r.n, 0], ['Log-likelihood', r.logLik, 2], ['AIC', r.aic, 1], ['BIC', r.bic, 1], ['Reliability', r.reliability ?? NaN, 3]] as const).map(([k, v, d]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{Number.isFinite(v) ? fmt(v, d) : '—'}</div></div>
        ))}
      </div>
      <Table title="Item parameters" file="irt-items" columns={['Item', ...keys.map(paramName)]}
        rows={r.params.map((p) => [c(p.item), ...keys.map((k) => c(p.values[k] ?? null))])}
        note="IRT parameterisation (ltm): difficulties / thresholds on the latent trait scale (θ, mean 0, SD 1), where the probability of answering in or above a category is .5; discrimination: how sharply the item separates people near its difficulty." />
      {r.itemFit.length > 0 && (
        <Table title="Item fit" file="irt-itemfit" columns={['Item', 'χ²', 'p']} rows={r.itemFit.map((f) => [c(f.item), c(f.x2), pCell(f.p)])}
          note="Yen’s Q1 item-fit statistics (ltm::item.fit): a small p flags an item whose responses depart from the model." />
      )}
      <ChartFrame id="irt:information" name="irt-information" width={W} height={H} defaults={{ x: 'Latent trait (θ)', y: 'Information' }}>
        {(labels) => (
          <svg className="mc-chart" width={W} height={H} role="img" aria-label="Test and item information">
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
            <text x={pad.l - 6} y={sy(max) + 4} textAnchor="end">{fmt(max, 1)}</text>
            <text x={pad.l - 6} y={sy(0) + 4} textAnchor="end">0</text>
            {[-4, -2, 0, 2, 4].map((t) => <text key={t} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">{t}</text>)}
            {r.information.map((a, i) => <path key={i} d={line(a)} stroke="#a5b4fc" strokeWidth={1.2} fill="none" />)}
            <path d={line(total)} stroke="#4f46e5" strokeWidth={2.4} fill="none" />
            <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
            <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
          </svg>
        )}
      </ChartFrame>
      <div className="hint">Bold: test information (the sum); light: each item. Information is the precision of θ: the standard error is 1/√information.</div>
    </div>
  );
}

function LcaView({ r }: { r: LcaResult }) {
  const bestBic = Math.min(...r.models.map((m) => m.bic));
  const [k, setK] = useState(r.models.find((m) => m.bic === bestBic)?.k ?? r.models[0]?.k);
  const m = r.models.find((x) => x.k === k);
  return (
    <div className="tables">
      <Table title="Number of classes" file="lca-models" columns={['Classes', 'Log-likelihood', 'Parameters', 'AIC', 'BIC', 'Entropy', 'G²']}
        rows={r.models.map((x) => [{ v: String(x.k), bold: x.k === k }, c(x.llik, '', 2), c(x.npar, '', 0), c(x.aic, '', 1), c(x.bic, x.bic === bestBic ? 'good' : '', 1), c(x.entropy), c(x.gsq, '', 2)])}
        note="Lower BIC (green) is preferred (Nylund, Asparouhov & Muthén, 2007); entropy near 1 means the classes are well separated. Choose the solution to inspect below." />
      <div className="segmented" style={{ width: 'auto' }}>
        {r.models.map((x) => <button key={x.k} className={x.k === k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} class{x.k === 1 ? '' : 'es'}</button>)}
      </div>
      {m && (
        <>
          <Table title={`Class sizes (${m.k} classes)`} file="lca-shares" columns={['Class', 'Share']} rows={m.shares.map((s, i) => [c(`Class ${i + 1}`), c(s)])} />
          <Table title="Item response probabilities" file="lca-probs" columns={['Item', 'Category', ...m.shares.map((_, i) => `Class ${i + 1}`)]}
            rows={m.probs.flatMap((p) => p.categories.map((cat, j) => [c(j ? '' : p.item), c(cat), ...p.byClass.map((row) => c(row[j], row[j] > 0.7 ? 'good' : ''))]))}
            note="Probability of each answer within each class (classes numbered by size): what characterises the classes." />
        </>
      )}
    </div>
  );
}

/** Item response theory (ltm) and latent class analysis (poLCA) on the current dataset. */
export function ItemsPanel() {
  const open = useItems((s) => s.open);
  const irt = useItems((s) => s.irt);
  const lca = useItems((s) => s.lca);
  const data = useStore((s) => s.data);
  const project = useStore((s) => s.projectName);
  const seed = useStore((s) => s.settings.seed);
  const [kind, setKind] = useState<'irt' | 'lca'>('irt');
  const [items, setItems] = useState<string[]>(irt?.items ?? lca?.items ?? []);
  const [model, setModel] = useState<IrtModel>(irt?.model ?? 'grm');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(4);
  const { busy, setBusy, guard, cancel } = useCancellable();
  const preset = useItems((s) => s.preset);
  useEffect(() => {
    if (!preset) return;
    setKind(preset.kind); setItems(preset.items);
    if (preset.kind === 'irt') setModel(preset.model); else { setFrom(preset.from); setTo(preset.to); }
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useItems.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const columns = data && !data.moments ? data.names : [];
  const classes = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const fail = (e: unknown, pkg: string) => isCancelled(e) ? Promise.resolve() : import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `${pkg}: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const m = await import('../rengine/items');
      if (kind === 'irt') {
        const r = await guard(m.irtR(data!, items, model));
        r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `ltm ${r.engine.version}`));
        useItems.setState({ irt: r });
      } else {
        const r = await guard(m.lcaR(data!, items, classes, 10, seed));
        r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `poLCA ${r.engine.version}`));
        useItems.setState({ lca: r });
      }
    } catch (e) { await fail(e, kind === 'irt' ? 'ltm' : 'poLCA'); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const m = await import('../rengine/items');
      const text = kind === 'irt' ? await m.irtScriptR(data!, items, model) : await m.lcaScriptR(data!, items, classes, 10, seed);
      downloadText(`${safeFileName(project)}-${kind === 'irt' ? 'ltm' : 'poLCA'}.R`, text, 'text/x-r-source');
    } catch (e) { await fail(e, kind === 'irt' ? 'ltm' : 'poLCA'); }
  };
  const ready = items.length >= 2 && (kind === 'irt' || (classes.length > 0 && to <= 10));
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Item analysis">
      <div className="sim">
        <header className="sim-head">
          <div><b>Item analysis</b><span className="muted">{kind === 'irt' ? 'item response theory · ltm' : 'latent class analysis · poLCA'}</span></div>
          <button className="btn icon ghost" onClick={() => useItems.getState().setOpen(false)} aria-label="Close"><IconX /></button>
        </header>
        {!columns.length ? <div className="empty-results">Import raw item responses first.</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <div className="segmented" style={{ marginBottom: 12 }}>
                <button className={kind === 'irt' ? 'on' : ''} onClick={() => setKind('irt')}>Item response theory</button>
                <button className={kind === 'lca' ? 'on' : ''} onClick={() => setKind('lca')}>Latent classes</button>
              </div>
              <OrderedPicker label="Items" columns={columns} value={items} onChange={setItems} />
              {kind === 'irt' ? (
                <div className="field">
                  <label>Model</label>
                  <select className="select" value={model} onChange={(e) => setModel(e.target.value as IrtModel)}>
                    {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <div className="hint">{MODELS.find((m) => m.id === model)?.hint} Unidimensional, marginal maximum likelihood.</div>
                </div>
              ) : (
                <div className="field">
                  <label>Numbers of classes to compare</label>
                  <div className="row2">
                    <input className="input num" type="number" min={1} max={10} value={from} onChange={(e) => setFrom(Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)))} />
                    <input className="input num" type="number" min={1} max={10} value={to} onChange={(e) => setTo(Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)))} />
                  </div>
                  <div className="hint">Categorical items (each value a category). Each solution is estimated from 10 random starts (seed from the Model settings), keeping the best, to avoid local maxima.</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
                {busy && <button className="btn" onClick={cancel}>Cancel</button>}
                <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {kind === 'irt' && irt && <IrtView r={irt} />}
              {kind === 'lca' && lca && <LcaView key={lca.models.map((m) => m.k).join()} r={lca} />}
              {!(kind === 'irt' ? irt : lca) && <div className="empty-results">Choose the items and press Estimate.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
