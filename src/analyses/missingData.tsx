// The missing-data card: what Mplus's TYPE = BASIC prints about missing values (R/screen.R, ps_missing). The patterns
// of missing values with their frequencies, the covariance coverage, the EM estimates of the means and covariances
// (the unrestricted model by FIML), and for repeated measures Mplus's dropout descriptives (DATA MISSING:
// TYPE = DDROPOUT; DESCRIPTIVE = y0-y5 | * z1-z5): who drops out after each occasion, dropouts and non-dropouts with
// and without intermittent missing values, and the mean and SD of each variable in each group.

import { useState } from 'react';
import { c, Table } from '../components/results/Table';
import { OrderedPicker } from '../components/OrderedPicker';
import { fmt } from '../format';
import type { DropoutGroup, DropoutVariable, MissingDataInput, MissingDataResult } from '../rengine/screen';
import { columnsFingerprint, isObj, missingColumns, name, names, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type MissingDataOptions = MissingDataInput;
type Tab = 'patterns' | 'coverage' | 'em' | 'dropout';

/** Mplus's row labels of the dropout descriptives. */
export function dropoutLabel(g: DropoutGroup, time?: number): string {
  switch (g) {
    case 'after': return `Dropouts after time ${time}`;
    case 'stayAfter': return `Non-dropouts after time ${time}`;
    case 'dropouts': return 'Total dropouts';
    case 'dropoutsNoIntermittent': return '   Dropouts no intermittent missing';
    case 'dropoutsIntermittent': return '   Dropouts intermittent missing';
    case 'nonDropouts': return 'Total non-dropouts';
    case 'nonDropoutsComplete': return '   Non-dropouts complete data';
    case 'nonDropoutsIntermittent': return '   Non-dropouts intermittent missing';
    default: return 'Total sample';
  }
}

/** The second set of variables as text: one name per occasion, * for none (Mplus's DESCRIPTIVE = … | * z1-z5). */
const setText = (d: string[]) => d.map((x) => x || '*').join(' ');
const readSet = (s: string) => s.split(/[\s,]+/).filter(Boolean).map((x) => (x === '*' ? '' : x));

function MissingDataForm({ options: o, set, ctx, disabled }: OptionsProps<MissingDataOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>What Mplus’s TYPE = BASIC prints about missing values: the patterns and their frequencies, the covariance coverage and the EM estimates of the means and covariances (the unrestricted model by FIML). With repeated measures, Mplus’s dropout descriptives (DATA MISSING: TYPE = DDROPOUT): a case drops out at occasion t when it is observed at t − 1 and missing from t on.</p>
      <OrderedPicker label="Variables" columns={columns} value={o.vars} onChange={(vars) => set({ ...o, vars })} />
      <OrderedPicker label="Repeated measures, in time order (dropout; optional)" columns={columns} value={o.measures} onChange={(measures) => set({ ...o, measures, descriptive: measures.length ? o.descriptive.slice(0, measures.length) : [] })} />
      {o.measures.length > 0 && (
        <div className="field">
          <label htmlFor="md-desc">Further variables by occasion (optional; one per occasion, * for none: Mplus DESCRIPTIVE = … | * z1-z5)</label>
          <input id="md-desc" className="input" value={setText(o.descriptive)} placeholder={o.measures.map(() => '*').join(' ')} onChange={(e) => set({ ...o, descriptive: readSet(e.target.value) })} />
        </div>
      )}
    </fieldset>
  );
}

function MissingDataView({ result: r }: { result: MissingDataResult }) {
  const [tab, setTab] = useState<Tab>('patterns');
  const tabs: [Tab, string][] = [['patterns', 'Patterns'], ['coverage', 'Coverage'], ['em', 'EM estimates'], ...(r.dropout ? [['dropout', 'Dropout'] as [Tab, string]] : [])];
  const v = r.variables;
  const lower = (M: number[][]) => M.map((row, i) => [c(v[i]), ...v.map((_, j) => (j <= i ? c(row[j]) : c('')))]);
  const pct = (n: number) => fmt((100 * n) / r.n, 1) + '%';
  const d = r.dropout;
  const pctRows = (vars: DropoutVariable[]) => vars.flatMap((x) => x.rows.map((row, i) => [c(i === 0 ? x.variable : ''), c(dropoutLabel(row.group, row.time)), c(row.n, undefined, 0), c(pct(row.n)), c(row.n ? row.mean : null), c(row.n ? row.sd : null)]));
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Missing data">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="tables">
        {tab === 'patterns' && (
          <Table title={`Missing-data patterns: ${r.patterns.length}`} file="missing-patterns" columns={['Pattern', 'Frequency', ...v]}
            rows={r.patterns.map((p, k) => [c(k + 1, undefined, 0), c(p.n, undefined, 0), ...p.observed.map((o) => c(o ? 'x' : ''))])}
            note="x = observed. In Mplus’s order: a pattern read as a binary number, a missing value 1, the first variable the most significant digit." />
        )}
        {tab === 'coverage' && <Table title="Covariance coverage" file="missing-coverage" columns={['', ...v]} rows={lower(r.coverage)} note="The proportion of cases with both values observed (Mplus: PROPORTION OF DATA PRESENT)." />}
        {tab === 'em' && (
          <>
            <Table title="EM estimates: means" file="missing-em-means" columns={['Variable', 'Mean']} rows={v.map((x, i) => [c(x), c(r.em.means[i])])}
              note={`The unrestricted (H1) model by FIML (lavaan’s EM). ${r.em.loglik !== null ? `H1 log-likelihood ${fmt(r.em.loglik, 3)}.` : r.em.singular ? 'The covariance matrix is (near) singular, e.g. with variables that are functions of the missingness: the likelihood has no finite maximum, and no log-likelihood is shown.' : ''}`} />
            <Table title="EM estimates: covariances" file="missing-em-cov" columns={['', ...v]} rows={lower(r.em.cov)} />
            <Table title="EM estimates: correlations" file="missing-em-cor" columns={['', ...v]} rows={lower(r.em.cor)} />
          </>
        )}
        {tab === 'dropout' && d && (
          <>
            <Table title="Dropouts and non-dropouts" file="missing-dropout-summary" columns={['', 'Number', '% of sample']}
              rows={[[c('Observations'), c(r.n, undefined, 0), c('100.0%')], [c('Dropouts'), c(d.dropouts, undefined, 0), c(pct(d.dropouts))],
                ...d.byTime.map((k, t) => [c(`   after time ${t}`), c(k, undefined, 0), c(pct(k))]),
                [c('Non-dropouts with complete data'), c(d.nonDropoutsComplete, undefined, 0), c(pct(d.nonDropoutsComplete))],
                [c('Non-dropouts with intermittent missing'), c(d.nonDropoutsIntermittent, undefined, 0), c(pct(d.nonDropoutsIntermittent))]]}
              note={`Repeated measures ${d.measures.join(', ')}: a dropout is observed at one occasion and missing at every later one; a non-dropout is observed at the last; intermittent missing is a missing value before that.`} />
            <Table title="The repeated measures by dropout group" file="missing-dropout-set1" columns={['Variable', 'Group', 'Observed', '% of sample', 'Mean', 'SD']} rows={pctRows(d.set1)} />
            {d.set2.length > 0 && <Table title="Further variables by dropout group" file="missing-dropout-set2" columns={['Variable', 'Group', 'Observed', '% of sample', 'Mean', 'SD']} rows={pctRows(d.set2)}
              note="Each variable at its occasion; intermittent missing among these variables." />}
          </>
        )}
      </div>
    </>
  );
}

export const missingDataAnalysis: AnalysisType<MissingDataOptions, MissingDataResult> = {
  id: 'missingdata',
  title: 'Missing data',
  sub: 'patterns, coverage, EM means and covariances, dropout (Mplus TYPE = BASIC)',
  group: 'Data',
  cardTitle: () => 'Missing data',
  defaults: () => ({ vars: [], measures: [], descriptive: [] }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const measures = names(raw.measures, 50);
    const desc = Array.isArray(raw.descriptive) ? raw.descriptive.slice(0, measures.length).map((x) => name(x)) : [];
    return { vars: names(raw.vars, 200), measures, descriptive: desc.length === measures.length ? desc : [] };
  },
  Options: MissingDataForm,
  View: ({ result }) => <MissingDataView result={result} />,
  blocked: (o, ctx) => {
    if (!o.vars.length) return 'Choose the variables.';
    if (o.measures.length === 1) return 'Dropout needs at least two repeated measures.';
    if (o.descriptive.length && o.descriptive.length !== o.measures.length) return 'Give one further variable per occasion (* for none).';
    return missingColumns(ctx, [...new Set([...o.vars, ...o.measures, ...o.descriptive.filter(Boolean)])], 'The missing-data summary');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...new Set([...o.vars, ...o.measures, ...o.descriptive.filter(Boolean)])], [o.vars.join('|'), o.measures.join('|'), o.descriptive.join('|')]),
  run: async (o, ctx) => (await import('../rengine/screen')).missingDataR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/screen')).missingDataScriptR(rawData(ctx)!, o),
  summary: (o) => `${o.vars.length} variable${o.vars.length === 1 ? '' : 's'}${o.measures.length ? ` · dropout over ${o.measures.length} occasions` : ''}`,
};
