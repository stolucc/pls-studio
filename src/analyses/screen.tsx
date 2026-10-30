// Data screening as analysis cards: distributions, multivariate normality and
// outliers of chosen variables (psych), and influential cases for the CB-SEM
// model on the canvas (semfindr).

import { useState } from 'react';
import type { CbEstimator } from '../engine/cbsem';
import { fmt } from '../format';
import { toSpec, validateModel } from '../model/project';
import { farOut, flaggedCases, influentialCases, mardiaVerdict, normalityLevel } from '../model/screen';
import type { InfluenceResult, ScreenResult } from '../rengine/screen';
import { useStore } from '../store';
import { confirmDialog } from '../components/Overlays';
import { VariablePicker } from '../components/VariablePicker';
import { c, pCell, Table } from '../components/results/Table';
import { fingerprint } from './codec';
import { clampNum, columnsFingerprint, isObj, missingColumns, names, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface ScreenOptions { vars: string[]; alpha: number }
type Tab = 'univariate' | 'normality' | 'outliers';

const ALPHAS = [0.001, 0.01, 0.05];
/** Remove cases from the dataset after confirmation (restorable from the data panel). */
async function exclude(rows: number[], reason: string) {
  const ok = await confirmDialog({
    title: `Exclude ${rows.length} case${rows.length === 1 ? '' : 's'}?`,
    body: `Rows ${rows.slice(0, 12).join(', ')}${rows.length > 12 ? ', …' : ''} are removed from the dataset for every analysis (${reason}). The data panel can restore them; they are kept with the project. Rows are renumbered afterwards.`,
    confirmLabel: 'Exclude', danger: true,
  });
  if (!ok) return;
  const s = useStore.getState();
  if (!s.data || !s.dataInfo) return;
  const { excludeRows } = await import('../model/rows');
  const r = excludeRows(s.data, s.dataInfo, rows, reason);
  s.setData(r.data, r.info);
  s.toast('success', `Excluded ${rows.length} case${rows.length === 1 ? '' : 's'}; recalculate to see the effect.`);
}

function Univariate({ r }: { r: ScreenResult }) {
  return (
    <Table title="Distributions" file="screening-univariate" columns={['Variable', 'n', 'Missing', 'Mean', 'SD', 'Min', 'Max', 'Skewness', 'Kurtosis']}
      rows={r.variables.map((v, i) => {
        const d = r.describe[i], lvl = normalityLevel(d.skew, d.kurtosis);
        const tone = lvl === 'severe' ? 'bad' : lvl === 'moderate' ? 'warn' : '';
        return [c(v), c(d.n, undefined, 0), c(d.missing, d.missing ? 'warn' : 'dim', 0), c(d.mean), c(d.sd), c(d.min), c(d.max), c(d.skew, tone), c(d.kurtosis, tone)];
      })}
      note="Skewness and excess kurtosis as psych::describe (type 3). |skew| > 2 or |kurtosis| > 7 is severe (red), above 1 or 3 moderate (West, Finch & Curran 1995; Kline 2016)." />
  );
}

function Normality({ r }: { r: ScreenResult }) {
  const m = r.mardia, v = mardiaVerdict(m);
  return (
    <div className="tables">
      <Table title={`Mardia’s test: ${v.normal ? 'multivariate normality not rejected' : 'multivariate normality rejected'}`} file="screening-mardia"
        columns={['', 'Statistic', 'Test', 'df', 'p']}
        rows={[
          [c('Multivariate skewness b₁,ₚ'), c(m.b1p), c(m.n < 20 ? m.smallSkew : m.skew, undefined, 2), c(m.df, undefined, 0), pCell(v.skewP)],
          [c('Multivariate kurtosis b₂,ₚ'), c(m.b2p), c(m.kurtosis, undefined, 2), c('z', 'dim'), pCell(m.pKurt)],
        ]}
        note={`${m.n} complete cases, ${m.p} variables (psych::mardia). Under normality b₂,ₚ = p(p + 2) = ${m.p * (m.p + 2)}. ${v.text}${m.n < 20 ? ' Skewness: small-sample corrected test.' : ''}`} />
    </div>
  );
}

function Outliers({ r, alpha, current }: { r: ScreenResult; alpha: number; current: boolean }) {
  const flagged = flaggedCases(r.cases, alpha);
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const save = async () => {
    if (!data || !info) return;
    const { scoreColumns } = await import('../rengine/lavaan');
    const d = scoreColumns(data, ['mahal_d2', 'mahal_p'], r.cases.rows, [r.cases.d2, r.cases.p], '');
    useStore.getState().setData(d, info);
    useStore.getState().toast('success', `Saved as data columns: ${d.names.slice(data.names.length).join(', ')}. Rows with missing values have none.`);
  };
  return (
    <div className="tables">
      <Table title={`Multivariate outliers: ${flagged.length} of ${r.cases.rows.length} cases`} file="screening-outliers" columns={['Row', 'Mahalanobis D²', 'p']}
        rows={flagged.map((x) => [c(x.row, undefined, 0), c(x.d2, 'bad', 2), pCell(x.p)])}
        note={`Cases whose Mahalanobis distance from the centroid is significant at p < ${alpha} (χ², df = ${r.df}; Tabachnick & Fidell). Inspect them before deciding: a data-entry error, a case outside the population, or a legitimate extreme response.`} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={!current} onClick={() => void save()} title="Add D² and its p for every complete case as data columns (to filter or inspect them)">Save D² and p as data columns</button>
        {flagged.length > 0 && <button className="btn danger" disabled={!current} onClick={() => void exclude(flagged.map((x) => x.row), `Mahalanobis outliers, p < ${alpha}`)}>Exclude these {flagged.length} cases…</button>}
      </div>
    </div>
  );
}


function ScreenView({ r, alpha, current }: { r: ScreenResult; alpha: number; current: boolean }) {
  const [tab, setTab] = useState<Tab>('univariate');
  const tabs: [Tab, string][] = [['univariate', 'Distributions'], ['normality', 'Multivariate normality'], ['outliers', 'Outliers']];
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Screening results">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'univariate' ? <Univariate r={r} /> : tab === 'normality' ? <Normality r={r} /> : <Outliers r={r} alpha={alpha} current={current} />}
    </>
  );
}

const indicatorsOf = (ctx: AnalysisCtx) => {
  const names = rawData(ctx)?.names ?? [];
  return [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))].filter((v) => names.includes(v));
};

function ScreenOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<ScreenOptions>) {
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const indicators = indicatorsOf(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <VariablePicker columns={ds.names} value={o.vars.filter((v) => ds.names.includes(v))} onChange={(v) => set({ ...o, vars: ds.names.filter((x) => v.includes(x)) })} />
      {indicators.length >= 2 && <button className="btn sm ghost" onClick={() => set({ ...o, vars: indicators })}>Use the model’s indicators ({indicators.length})</button>}
      <div className="field">
        <label>Outliers at</label>
        <div className="segmented" role="radiogroup" aria-label="Outlier significance level">
          {ALPHAS.map((a) => <button key={a} role="radio" aria-checked={o.alpha === a} className={o.alpha === a ? 'on' : ''} onClick={() => set({ ...o, alpha: a })}>p &lt; {a}</button>)}
        </div>
      </div>
    </fieldset>
  );
}

export const screenAnalysis: AnalysisType<ScreenOptions, ScreenResult> = {
  id: 'screen',
  title: 'Data screening',
  sub: 'distributions, Mardia’s test, multivariate outliers (psych)',
  group: 'Data',
  defaults: (ctx) => ({ vars: indicatorsOf(ctx), alpha: 0.001 }),
  parseOptions: (raw) => (isObj(raw) ? { vars: names(raw.vars, 2000), alpha: ALPHAS.includes(Number(raw.alpha)) ? Number(raw.alpha) : clampNum(raw.alpha, 1e-6, 0.1, 0.001) } : null),
  Options: ScreenOptionsForm,
  View: ({ result, options, current }) => <ScreenView r={result} alpha={options.alpha} current={current} />,
  blocked: (o, ctx) => (o.vars.length < 2 ? 'Choose at least two variables.' : missingColumns(ctx, o.vars, 'Data screening')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars),
  run: async (o, ctx) => (await import('../rengine/screen')).screenR(rawData(ctx)!, o.vars, o.alpha),
  script: async (o, ctx) => (await import('../rengine/screen')).screenScriptR(rawData(ctx)!, o.vars, o.alpha),
  summary: (o) => `${o.vars.length} variables · outliers at p < ${o.alpha}`,
};

// ---------- influential cases (the CB-SEM model on the canvas) ----------

function InfluenceView({ inf, current }: { inf: InfluenceResult; current: boolean }) {
  const top = influentialCases(inf, 15);
  const at = (row: number) => inf.rows.indexOf(row);
  const far = top.filter((x) => x.flagged);
  return (
    <div className="tables">
      {far.length > 0 && (
        <div><button className="btn danger" disabled={!current} onClick={() => void exclude(far.map((x) => x.row), 'influential cases, generalized Cook’s distance far out')}>
          Exclude the {far.length} far-out case{far.length === 1 ? '' : 's'}…</button></div>
      )}
      <Table title="Most influential cases" file="screening-influence" columns={['Row', 'Generalized Cook’s distance', 'Mahalanobis', 'Δχ²', 'ΔCFI', 'ΔRMSEA']}
        rows={top.map((x) => [c(x.row, undefined, 0), c(x.gcd, x.flagged ? 'bad' : ''), c(inf.md[at(x.row)], undefined, 2), c(inf.chisq[at(x.row)]), c(inf.cfi[at(x.row)]), c(inf.rmsea[at(x.row)])])}
        note={`Generalized Cook’s distance (Pek & MacCallum 2011): how far the parameter estimates move without the case. It has no conventional cutoff; red: far out from the other cases (above Q3 + 3 IQR = ${fmt(farOut(inf.gcd))}). Δ: fit with the case minus without it. ${inf.engine.package} ${inf.engine.version}.`} />
    </div>
  );
}

const modelIndicators = (ctx: AnalysisCtx) => [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))];

export const influenceAnalysis: AnalysisType<Record<string, never>, InfluenceResult> = {
  id: 'influence',
  title: 'Influential cases',
  sub: 'case influence on the CB-SEM model: generalized Cook’s distance (semfindr)',
  group: 'Data',
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: () => <p className="hint" style={{ marginTop: 0 }}>Influence of each case on the CB-SEM model on the canvas: the model is refitted without each case in turn (semfindr; n refits, so this takes a while). It uses the model, estimator and missing-data setting as they are when you run it.</p>,
  View: ({ result, current }) => <InfluenceView inf={result} current={current} />,
  blocked: (_o, ctx) => {
    if (ctx.settings.method !== 'cbsem') return 'Influential cases are computed for CB-SEM models: switch the model to CB-SEM (Model tab).';
    if ((ctx.settings.engine ?? 'r') !== 'r') return 'Influential cases need the R engine (Model settings).';
    if (!rawData(ctx)) return 'Influential cases need raw data: import a dataset (not a covariance matrix).';
    if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
    const err = validateModel(ctx.model, rawData(ctx)!, ctx.settings).find((i) => i.level === 'error');
    return err ? `Fix the model first: ${err.message}` : null;
  },
  fingerprint: (_o, ctx) => {
    if (ctx.settings.method !== 'cbsem' || !ctx.model || !rawData(ctx)) return null;
    const cols = columnsFingerprint(ctx, modelIndicators(ctx));
    return cols && fingerprint([cols, JSON.stringify(toSpec(ctx.model)), ctx.settings.estimator, ctx.settings.missing]);
  },
  run: async (_o, ctx) => (await import('../rengine/screen')).influenceR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, ctx.settings.estimator as CbEstimator),
  script: async (_o, ctx) => (await import('../rengine/screen')).influenceScriptR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, ctx.settings.estimator as CbEstimator),
  summary: () => 'the CB-SEM model on the canvas',
};
