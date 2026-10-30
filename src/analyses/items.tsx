// Item analysis as analysis cards: item response theory (ltm) and latent
// class analysis (poLCA).

import { useState } from 'react';
import { fmt } from '../format';
import type { IrtModel, IrtResult, LcaResult } from '../rengine/items';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { clampNum, columnsFingerprint, isObj, missingColumns, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

/** Inputs filled in by an example. */
export type ItemsPreset = { kind: 'irt'; items: string[]; model: IrtModel } | { kind: 'lca'; items: string[]; from: number; to: number };
export interface IrtOptions { items: string[]; model: IrtModel }
export interface LcaOptions { items: string[]; from: number; to: number }

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


function IrtOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<IrtOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw item responses first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Items" columns={columns} value={o.items} onChange={(items) => set({ ...o, items })} />
      <div className="field">
        <label htmlFor="irt-model">Model</label>
        <select id="irt-model" className="select" value={o.model} onChange={(e) => set({ ...o, model: e.target.value as IrtModel })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="hint">{MODELS.find((m) => m.id === o.model)?.hint} Unidimensional, marginal maximum likelihood.</div>
      </div>
    </fieldset>
  );
}

function LcaOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<LcaOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw item responses first.</div>;
  const n = (v: string) => Math.max(1, Math.min(10, Math.round(Number(v)) || 1));
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Items" columns={columns} value={o.items} onChange={(items) => set({ ...o, items })} />
      <div className="field">
        <label>Numbers of classes to compare</label>
        <div className="row2">
          <input className="input num" type="number" min={1} max={10} aria-label="From" value={o.from} onChange={(e) => set({ ...o, from: n(e.target.value) })} />
          <input className="input num" type="number" min={1} max={10} aria-label="To" value={o.to} onChange={(e) => set({ ...o, to: n(e.target.value) })} />
        </div>
        <div className="hint">Categorical items (each value a category). Each solution is estimated from 10 random starts (seed from the Model settings), keeping the best, to avoid local maxima.</div>
      </div>
    </fieldset>
  );
}

const IRT_MODELS = ['rasch', 'twopl', 'grm', 'gpcm'] as const;
const classesOf = (o: LcaOptions) => Array.from({ length: Math.max(0, o.to - o.from + 1) }, (_, i) => o.from + i);

export const irtAnalysis: AnalysisType<IrtOptions, IrtResult> = {
  id: 'irt',
  title: 'Item response theory',
  sub: 'Rasch, 2PL, graded response, partial credit (ltm)',
  group: 'Measurement',
  defaults: () => ({ items: [], model: 'grm' }),
  parseOptions: (raw) => (isObj(raw) ? { items: names(raw.items), model: oneOf(raw.model, IRT_MODELS, 'grm') } : null),
  Options: IrtOptionsForm,
  View: ({ result }) => <IrtView r={result} />,
  blocked: (o, ctx) => (o.items.length < 2 ? 'Choose at least two items.' : missingColumns(ctx, o.items, 'Item response theory')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.items),
  run: async (o, ctx) => (await import('../rengine/items')).irtR(rawData(ctx)!, o.items, o.model),
  script: async (o, ctx) => (await import('../rengine/items')).irtScriptR(rawData(ctx)!, o.items, o.model),
  summary: (o) => `${o.items.length} items · ${MODELS.find((m) => m.id === o.model)!.label}`,
};

export const lcaAnalysis: AnalysisType<LcaOptions, LcaResult> = {
  id: 'lca',
  title: 'Latent class analysis',
  sub: 'classes of respondents from categorical items (poLCA)',
  group: 'Measurement',
  defaults: () => ({ items: [], from: 1, to: 4 }),
  parseOptions: (raw) => (isObj(raw) ? { items: names(raw.items), from: clampNum(raw.from, 1, 10, 1, true), to: clampNum(raw.to, 1, 10, 4, true) } : null),
  Options: LcaOptionsForm,
  View: ({ result }) => <LcaView key={result.models.map((m) => m.k).join()} r={result} />,
  blocked: (o, ctx) => {
    if (o.items.length < 2) return 'Choose at least two items.';
    if (o.from > o.to) return 'The smallest number of classes must not exceed the largest.';
    return missingColumns(ctx, o.items, 'Latent class analysis');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.items, [ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/items')).lcaR(rawData(ctx)!, o.items, classesOf(o), 10, ctx.settings.seed),
  script: async (o, ctx) => (await import('../rengine/items')).lcaScriptR(rawData(ctx)!, o.items, classesOf(o), 10, ctx.settings.seed),
  summary: (o) => `${o.items.length} items · ${o.from === o.to ? o.from : `${o.from}–${o.to}`} classes`,
};
