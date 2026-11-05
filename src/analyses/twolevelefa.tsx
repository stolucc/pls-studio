// Two-level exploratory factor analysis card (Mplus TYPE = TWOLEVEL EFA): numbers of factors within and between
// clusters (or a level unrestricted), every combination fitted by lavaan, each level's standardised loadings
// geomin-rotated with delta-method standard errors (R/twolevelefa.R).

import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type { Efa2Level, LevelFactors, TwoLevelEfaInput, TwoLevelEfaResult } from '../rengine/twolevelefa';
import { ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type TwoLevelEfaOptions = TwoLevelEfaInput;

/** "1 2 U" ↔ [1, 2, 'U']: numbers of factors, U for an unrestricted level. */
export const levelText = (v: LevelFactors[]) => v.map(String).join(' ');
export function readLevels(s: string): LevelFactors[] {
  const out: LevelFactors[] = [];
  for (const t of s.split(/[\s,]+/).filter(Boolean)) {
    const v: LevelFactors | null = /^u$/i.test(t) ? 'U' : /^[1-6]$/.test(t) ? Number(t) : null;
    if (v !== null && !out.includes(v)) out.push(v);
  }
  return out;
}
const levels = (v: unknown): LevelFactors[] => (Array.isArray(v) ? readLevels(v.slice(0, 7).map((x) => String(x)).join(' ')) : []);
const label = (k: LevelFactors) => (k === 'U' ? 'unrestricted' : `${k} factor${k === 1 ? '' : 's'}`);

function Form({ options: o, set, ctx, disabled }: OptionsProps<TwoLevelEfaOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Exploratory factors of the items within clusters and between them (Mplus TYPE = TWOLEVEL EFA). Every combination of the within and between choices is fitted; U leaves a level unrestricted. Each level’s loadings are standardised and geomin-rotated (oblique), with delta-method standard errors.</p>
      <ColumnSelect id="efa2-cluster" label="Cluster" value={o.cluster} columns={columns} exclude={o.items} onChange={(cluster) => set({ ...o, cluster })} />
      <OrderedPicker label="Items" columns={columns.filter((n) => n !== o.cluster)} value={o.items} onChange={(items) => set({ ...o, items })} />
      <div className="field">
        <label htmlFor="efa2-w">Within factors (e.g. 1 2 U)</label>
        <input id="efa2-w" className="input" defaultValue={levelText(o.within)} onBlur={(e) => set({ ...o, within: readLevels(e.target.value) })} />
      </div>
      <div className="field">
        <label htmlFor="efa2-b">Between factors (e.g. 1 U)</label>
        <input id="efa2-b" className="input" defaultValue={levelText(o.between)} onBlur={(e) => set({ ...o, between: readLevels(e.target.value) })} />
      </div>
    </fieldset>
  );
}

function LevelTables({ l, title, file }: { l: Efa2Level; title: string; file: string }) {
  const k = l.factors.length;
  return (
    <>
      <Table title={`${title}: geomin-rotated loadings (standardised)`} file={`${file}-loadings`}
        columns={['Item', ...l.factors.flatMap((_f, j) => [`Factor ${j + 1}`, 'SE']), 'Residual variance', 'SE']}
        rows={l.loadings.map((x, i): Row => [c(x.item), ...x.est.flatMap((e, j) => [c(e), c(x.se[j])]), c(l.residuals[i].est), c(l.residuals[i].se)])}
        note={k > 1 ? `Rotation criterion (geomin): ${l.criterion === null ? '–' : fmt(l.criterion, 5)}.` : 'One factor: no rotation.'} />
      {l.correlations.length > 0 && <Table title={`${title}: factor correlations`} file={`${file}-correlations`} columns={['Factors', 'Correlation', 'SE']}
        rows={l.correlations.map((q): Row => [c(`${q.a} with ${q.b}`), c(q.est), c(q.se)])} />}
    </>
  );
}

function View({ result: r }: { result: TwoLevelEfaResult }) {
  return (
    <div className="tables">
      <Table title="Fit by number of factors" file="efa2-fit" columns={['Within', 'Between', 'Parameters (Mplus’s count)', 'Log-likelihood', 'χ²', 'df', 'p', 'RMSEA', 'CFI', 'AIC', 'BIC']}
        rows={r.solutions.map((s): Row => [c(label(s.within)), c(label(s.between)), c(`${s.fit.npar} (${s.fit.nparMplus})`), c(s.fit.logl, undefined, 3), c(s.fit.chisq, undefined, 3), c(s.fit.df, undefined, 0), c(s.fit.pvalue), c(s.fit.rmsea), c(s.fit.cfi), c(s.fit.aic, undefined, 3), c(s.fit.bic, undefined, 3)])}
        note={`${r.n} cases in ${r.clusters} clusters; maximum likelihood (lavaan), standard errors from the observed information. Mplus counts the parameters without an unrestricted level’s variances and covariances (in brackets).`} />
      {r.solutions.map((s, i) => (
        <div key={i}>
          {s.withinLevel && <LevelTables l={s.withinLevel} title={`${label(s.within)} within, ${label(s.between)} between — within`} file={`efa2-${i + 1}-within`} />}
          {s.betweenLevel && <LevelTables l={s.betweenLevel} title={`${label(s.within)} within, ${label(s.between)} between — between`} file={`efa2-${i + 1}-between`} />}
        </div>
      ))}
    </div>
  );
}

export const twoLevelEfaAnalysis: AnalysisType<TwoLevelEfaOptions, TwoLevelEfaResult> = {
  id: 'efa2l',
  title: 'Two-level exploratory factor analysis',
  sub: 'factors within and between clusters, geomin-rotated at each level (lavaan, GPArotation)',
  group: 'Measurement',
  defaults: () => ({ items: [], cluster: '', within: [1, 2], between: [1] }),
  parseOptions: (raw) => (isObj(raw) ? { items: names(raw.items, 30), cluster: name(raw.cluster), within: levels(raw.within), between: levels(raw.between) } : null),
  Options: Form,
  View: ({ result }) => <View result={result} />,
  blocked: (o, ctx) => {
    if (!o.cluster) return 'Choose the cluster column.';
    if (o.items.length < 3) return 'Choose at least three items.';
    if (o.items.includes(o.cluster)) return 'The cluster column cannot be an item.';
    if (!o.within.length || !o.between.length) return 'Give the numbers of factors within and between (U: unrestricted).';
    if (o.within.every((k) => k === 'U') && o.between.every((k) => k === 'U')) return 'Both levels unrestricted is the saturated model: give a number of factors for one level.';
    const p = o.items.length;
    const big = [...o.within, ...o.between].find((k) => k !== 'U' && (p - k) ** 2 < p + k);
    if (big !== undefined) return `${big} factors are too many for ${p} items.`;
    return missingColumns(ctx, [...o.items, o.cluster], 'A two-level EFA');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...o.items, o.cluster], [levelText(o.within), levelText(o.between)]),
  run: async (o, ctx) => (await import('../rengine/twolevelefa')).twoLevelEfaR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/twolevelefa')).twoLevelEfaScriptR(rawData(ctx)!, o),
  summary: (o) => (o.items.length ? `${o.items.length} items in clusters of ${o.cluster || '…'} · within ${levelText(o.within)} · between ${levelText(o.between)}` : 'not set up yet'),
};
