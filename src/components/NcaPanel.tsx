import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { Dataset } from '../engine/types';
import { bottleneckText, type NcaCondition, type NcaResult } from '../rengine/nca';
import { useFreshResults, useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';

export type NcaPreset = { x: string[]; y: string; source?: 'data' | 'scores' };
interface NcaState { open: boolean; result: NcaResult | null; preset: NcaPreset | null; setOpen: (v: boolean) => void }
export const useNca = create<NcaState>((set) => ({ open: false, result: null, preset: null, setOpen: (open) => set({ open }) }));

/** Effect size labels (Dul 2016): 0–0.1 small, 0.1–0.3 medium, 0.3–0.5 large, ≥ 0.5 very large. */
export const effectLabel = (d: number) => (d < 0.1 ? 'small' : d < 0.3 ? 'medium' : d < 0.5 ? 'large' : 'very large');

function CeilingPlot({ k, y }: { k: NcaCondition; y: string }) {
  const W = 360, H = 280, pad = { l: 48, r: 12, t: 12, b: 40 };
  const [x0, x1, y0, y1] = k.scope;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((y1 - v) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const step = k.peers.x.flatMap((px, i) => (i === 0 ? [`M ${sx(x0)} ${sy(k.peers.y[0])}`, `L ${sx(px)} ${sy(k.peers.y[0])}`] : [`L ${sx(px)} ${sy(k.peers.y[i - 1])}`, `L ${sx(px)} ${sy(k.peers.y[i])}`]))
    .concat(`L ${sx(x1)} ${sy(k.peers.y[k.peers.y.length - 1])}`).join(' ');
  const cr = k.slope !== null && k.intercept !== null ? (() => {
    const a = k.intercept!, b = k.slope!;
    const xa = Math.max(x0, (y0 - a) / b), xb = Math.min(x1, (y1 - a) / b);
    return xa < xb ? [xa, xb].map((v) => [sx(v), sy(a + b * v)]) : null;
  })() : null;
  return (
    <ChartFrame id={`nca:${k.x}`} name={`nca-${k.x}`} width={W} height={H} defaults={{ x: k.x, y }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label={`Ceiling lines for ${k.x}`}>
          <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="#cbd5e1" />
          {k.points.x.map((px, i) => <circle key={i} cx={sx(px)} cy={sy(k.points.y[i])} r={2.6} fill="#64748b" opacity={0.6} />)}
          <path d={step} stroke="#6d28d9" strokeWidth={1.8} fill="none" />
          {cr && <line x1={cr[0][0]} y1={cr[0][1]} x2={cr[1][0]} y2={cr[1][1]} stroke="#d97706" strokeWidth={2} strokeDasharray="6 3" />}
          <text x={pad.l} y={H - pad.b + 14} textAnchor="middle">{fmt(x0, 1)}</text>
          <text x={W - pad.r} y={H - pad.b + 14} textAnchor="end">{fmt(x1, 1)}</text>
          <text x={pad.l - 6} y={sy(y0) + 4} textAnchor="end">{fmt(y0, 1)}</text>
          <text x={pad.l - 6} y={sy(y1) + 4} textAnchor="end">{fmt(y1, 1)}</text>
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function NcaView({ r }: { r: NcaResult }) {
  return (
    <div className="tables">
      <Table title="Necessary conditions" file="nca-effects" columns={['Condition', 'n', 'd (CE-FDH)', 'p', 'd (CR-FDH)', 'p', 'Size (CR-FDH)', 'Accuracy (CR-FDH)']}
        rows={r.conditions.map((k) => [c(k.x), c(k.n, undefined, 0), c(k.ceFdh), pCell(k.p?.ce_fdh ?? null), c(k.crFdh), pCell(k.p?.cr_fdh ?? null), c(effectLabel(k.crFdh)), c(k.accuracy === null ? null : `${fmt(k.accuracy, 1)}%`)])}
        note={`Dul (2016): X is necessary for ${r.y} in degree when there is an empty space in the upper left of the scatter. Effect size d = ceiling zone / scope (0.1 medium, 0.3 large); ${r.permutations ? `p from ${r.permutations} permutations (Dul et al. 2020; p < .05 and d ≥ 0.1 are the usual criteria)` : 'no permutation test'}. CE-FDH: step-function ceiling; CR-FDH: a regression through its corner points.`} />
      <div className="mc-grid">{r.conditions.map((k) => <CeilingPlot key={k.x} k={k} y={r.y} />)}</div>
      <div className="hint">Purple: CE-FDH ceiling; dashed amber: CR-FDH.</div>
      <Table title="Bottleneck table (CR-FDH)" file="nca-bottleneck" columns={[`${r.y} (% of range)`, ...r.conditions.map((k) => `${k.x} needed (%)`)]}
        rows={r.conditions[0].bottleneck.map((b, i) => [c(`${b.y}`), ...r.conditions.map((k) => c(bottleneckText(k.bottleneck[i].crFdh)))])}
        note="The level of each condition needed for a level of the outcome, both as a percentage of their observed range. NN: not necessary; NA: not reached in the data." />
      <Table title="Bottleneck table (CE-FDH)" file="nca-bottleneck-ce" columns={[`${r.y} (% of range)`, ...r.conditions.map((k) => `${k.x} needed (%)`)]}
        rows={r.conditions[0].bottleneck.map((b, i) => [c(`${b.y}`), ...r.conditions.map((k) => c(bottleneckText(k.bottleneck[i].ceFdh)))])} />
    </div>
  );
}

/** Necessary condition analysis on data columns or on PLS construct scores. */
export function NcaPanel() {
  const open = useNca((s) => s.open);
  const saved = useNca((s) => s.result);
  const preset = useNca((s) => s.preset);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const results = useFreshResults();
  const pls = settings.method === 'pls' ? results?.pls ?? null : null;
  const [source, setSource] = useState<'data' | 'scores'>('data');
  const [xs, setXs] = useState<string[]>([]);
  const [y, setY] = useState('');
  const [perm, setPerm] = useState(1000);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (preset) { setXs(preset.x); setY(preset.y); setSource(preset.source ?? 'data'); } }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useNca.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // Richter et al. (2020): NCA on the construct scores of a PLS-SEM model.
  const scores = useMemo<Dataset | null>(() => (pls ? { names: pls.constructs, cols: pls.scores } : null), [pls]);
  if (!open) return null;
  const close = () => useNca.getState().setOpen(false);
  const ds = source === 'scores' ? scores : data && !data.moments ? data : null;
  const columns = ds?.names ?? [];
  const ready = !!ds && !!y && xs.length > 0 && !xs.includes(y);
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `NCA: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { ncaR } = await import('../rengine/nca');
      useNca.setState({ result: await ncaR(ds!, xs, y, perm) });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { ncaScriptR } = await import('../rengine/nca');
      downloadText(`${safeFileName(project)}-nca.R`, await ncaScriptR(ds!, xs, y, perm), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Necessary condition analysis">
      <div className="sim">
        <header className="sim-head">
          <div><b>Necessary condition analysis</b><span className="muted">CE-FDH and CR-FDH ceilings, permutation test (as the NCA package)</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        <div className="sim-body long-body">
          <section className="sim-col">
            <p className="hint" style={{ marginTop: 0 }}>Is a condition necessary for the outcome — without it, no high outcome — even if it is not sufficient? NCA looks for an empty upper-left corner in the scatter (Dul 2016).</p>
            <div className="field">
              <label>Variables</label>
              <div className="segmented">
                <button className={source === 'data' ? 'on' : ''} onClick={() => setSource('data')}>Data columns</button>
                <button className={source === 'scores' ? 'on' : ''} disabled={!scores} onClick={() => setSource('scores')} title={scores ? 'The construct scores of the last PLS-SEM results (Richter et al. 2020)' : 'Calculate a PLS-SEM model first'}>PLS construct scores</button>
              </div>
            </div>
            {!ds ? <div className="empty-results">{source === 'scores' ? 'Calculate a PLS-SEM model first.' : 'Import raw data first.'}</div> : (
              <>
                <div className="field">
                  <label>Outcome (Y)</label>
                  <select className="select" value={y} onChange={(e) => setY(e.target.value)}>
                    <option value="">Choose…</option>
                    {columns.filter((n) => n === y || !xs.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <OrderedPicker label="Conditions (X)" columns={columns.filter((n) => n !== y)} value={xs} onChange={setXs} />
                <div className="field">
                  <label>Permutations (0: no test)</label>
                  <input className="input num" type="number" min={0} max={20000} value={perm} onChange={(e) => setPerm(Math.max(0, Math.min(20000, Math.round(Number(e.target.value)) || 0)))} />
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Calculating…' : 'Calculate'}</button>
              <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
            </div>
          </section>
          <section className="sim-col wide">
            {saved ? <NcaView r={saved} /> : <div className="empty-results">Choose the outcome and conditions, and press Calculate.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
