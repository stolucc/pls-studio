// The missing-data card: what Mplus's TYPE = BASIC prints about missing values (R/screen.R, ps_missing). The patterns
// of missing values with their frequencies, the covariance coverage, the EM estimates of the means and covariances
// (the unrestricted model by FIML), and for repeated measures Mplus's dropout descriptives (DATA MISSING:
// TYPE = DDROPOUT; DESCRIPTIVE = y0-y5 | * z1-z5): who drops out after each occasion, dropouts and non-dropouts with
// and without intermittent missing values, and the mean and SD of each variable in each group. Tests of whether the
// values are missing completely at random (misty::na.test): Little's (1988) χ² with each pattern's share, and
// Jamshidian & Jalal's (2010) tests of equal covariances (Hawkins) and distributions (Anderson-Darling) across patterns.

import { useState } from 'react';
import { c, pCell, Table } from '../components/results/Table';
import { OrderedPicker } from '../components/OrderedPicker';
import { fmt, pIs } from '../format';
import type {
  DropoutGroup,
  DropoutVariable,
  JamJal,
  LittleMcar,
  MissingDataInput,
  MissingDataResult,
} from '../rengine/screen';
import { columnsFingerprint, flag, isObj, missingColumns, name, names, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type MissingDataOptions = Omit<MissingDataInput, 'seed'> & {
  mcar: boolean;
  jamjal: boolean;
};
type Tab = 'patterns' | 'coverage' | 'em' | 'mcar' | 'dropout';

/** Mplus's row labels of the dropout descriptives. */
export function dropoutLabel(g: DropoutGroup, time?: number): string {
  switch (g) {
    case 'after':
      return `Dropouts after time ${time}`;
    case 'stayAfter':
      return `Non-dropouts after time ${time}`;
    case 'dropouts':
      return 'Total dropouts';
    case 'dropoutsNoIntermittent':
      return '   Dropouts no intermittent missing';
    case 'dropoutsIntermittent':
      return '   Dropouts intermittent missing';
    case 'nonDropouts':
      return 'Total non-dropouts';
    case 'nonDropoutsComplete':
      return '   Non-dropouts complete data';
    case 'nonDropoutsIntermittent':
      return '   Non-dropouts intermittent missing';
    default:
      return 'Total sample';
  }
}

/** The second set of variables as text: one name per occasion, * for none (Mplus's DESCRIPTIVE = … | * z1-z5). */
const setText = (d: string[]) => d.map((x) => x || '*').join(' ');
const readSet = (s: string) =>
  s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((x) => (x === '*' ? '' : x));

function MissingDataForm({ options: o, set, ctx, disabled }: OptionsProps<MissingDataOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        What Mplus’s TYPE = BASIC prints about missing values: the patterns and their frequencies,
        the covariance coverage and the EM estimates of the means and covariances (the unrestricted
        model by FIML). With repeated measures, Mplus’s dropout descriptives (DATA MISSING: TYPE =
        DDROPOUT): a case drops out at occasion t when it is observed at t − 1 and missing from t
        on.
      </p>
      <OrderedPicker
        label="Variables"
        columns={columns}
        value={o.vars}
        onChange={(vars) => set({ ...o, vars })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.mcar}
          onChange={(e) => set({ ...o, mcar: e.target.checked })}
        />{' '}
        Little’s MCAR test (χ², with each pattern’s share)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={o.jamjal}
          onChange={(e) => set({ ...o, jamjal: e.target.checked })}
        />{' '}
        Jamshidian &amp; Jalal’s tests (equal covariances and distributions across patterns; imputes
        with the project’s seed)
      </label>
      <OrderedPicker
        label="Repeated measures, in time order (dropout; optional)"
        columns={columns}
        value={o.measures}
        onChange={(measures) =>
          set({
            ...o,
            measures,
            descriptive: measures.length ? o.descriptive.slice(0, measures.length) : [],
          })
        }
      />
      {o.measures.length > 0 && (
        <div className="field">
          <label htmlFor="md-desc">
            Further variables by occasion (optional; one per occasion, * for none: Mplus DESCRIPTIVE
            = … | * z1-z5)
          </label>
          <input
            id="md-desc"
            className="input"
            value={setText(o.descriptive)}
            placeholder={o.measures.map(() => '*').join(' ')}
            onChange={(e) => set({ ...o, descriptive: readSet(e.target.value) })}
          />
        </div>
      )}
    </fieldset>
  );
}

/** The pattern's number in the Patterns table (Mplus's order). */
const patternNo = (r: MissingDataResult, observed: boolean[]) =>
  r.patterns.findIndex(
    (p) => p.observed.length === observed.length && p.observed.every((o, i) => o === observed[i]),
  ) + 1;

/** One line on Little's test, as a report would put it. */
export function littleText(l: LittleMcar): string {
  return `Little’s MCAR test: χ²(${fmt(l.df, 0)}) = ${fmt(l.chisq, 2)}, p ${pIs(l.p)}, over ${l.patterns} patterns (${l.incomplete} of ${l.n} cases incomplete)${l.p < 0.05 ? ': the values are not missing completely at random (MAR or MNAR remain; FIML or multiple imputation assume MAR).' : ': no evidence against MCAR (the test cannot show MCAR, and has little power with few cases per pattern).'}`;
}

function McarTables({ r }: { r: MissingDataResult }) {
  const l = r.little,
    j: JamJal | undefined = r.jamjal,
    v = r.variables;
  return (
    <>
      {l && (
        <Table
          title="Little’s MCAR test"
          file="missing-little"
          columns={['Cases', 'Incomplete', 'Patterns', 'χ²', 'df', 'p']}
          rows={[
            [
              c(l.n, undefined, 0),
              c(l.incomplete, undefined, 0),
              c(l.patterns, undefined, 0),
              c(l.chisq),
              c(l.df, undefined, 0),
              pCell(l.p),
            ],
          ]}
          note={`${littleText(l)} Little (1988): the means of each pattern compared with the ML estimates of the means and covariances (mvnmle ${r.engine.mvnmle ?? ''}; ${r.engine.package} ${r.engine.version}).`}
        />
      )}
      {l && (
        <Table
          title="Little’s MCAR test by pattern"
          file="missing-little-patterns"
          columns={['Pattern', 'Cases', 'Observed variables', 'Share of χ²', '% of χ²', ...v]}
          rows={l.byPattern.map((x) => [
            c(patternNo(r, x.observed) || '—', undefined, 0),
            c(x.n, undefined, 0),
            c(x.k, undefined, 0),
            c(x.d2),
            c(l.chisq > 0 ? fmt((100 * x.d2) / l.chisq, 1) + '%' : '—'),
            ...x.observed.map((o) => c(o ? 'x' : '')),
          ])}
          note="Each pattern’s share n_j (ȳ_j − μ)′ Σ_j⁻¹ (ȳ_j − μ): how far its means lie from the ML means, over its observed variables (x). The shares sum to χ²; df = Σ k_j − p. A large share points to the pattern whose cases differ."
        />
      )}
      {j &&
        ('error' in j ? (
          <p className="hint">Jamshidian &amp; Jalal’s tests could not be computed: {j.error}</p>
        ) : (
          <Table
            title="Jamshidian & Jalal’s tests of MCAR"
            file="missing-jamjal"
            columns={['Test', 'Statistic', 'df', 'p']}
            rows={[
              [
                c('Hawkins: equal covariance matrices'),
                c(j.hawkins.stat),
                c(j.hawkins.df, undefined, 0),
                pCell(j.hawkins.p),
              ],
              [
                c('Anderson-Darling: equal distributions (nonparametric)'),
                c(j.anderson.stat),
                c(''),
                pCell(j.anderson.p),
              ],
            ]}
            note={`Jamshidian & Jalal (2010; misty’s port of MissMech): ${j.n} cases in ${j.patterns} patterns of at least 6 cases (${j.patternN.join(', ')}), imputed 20 times with seed ${j.seed}. Hawkins’s test assumes normality; when it rejects but Anderson-Darling does not, the data are likely non-normal rather than not MCAR. Rejection of both: not MCAR.`}
          />
        ))}
    </>
  );
}

/** The H1 log-likelihood, or why there is none. */
function loglikNote(em: { loglik: number | null; singular: boolean }) {
  if (em.loglik !== null) return `H1 log-likelihood ${fmt(em.loglik, 3)}.`;
  if (em.singular)
    return 'The covariance matrix is (near) singular, e.g. with variables that are functions of the missingness: the likelihood has no finite maximum, and no log-likelihood is shown.';
  return '';
}

function MissingDataView({ result: r }: { result: MissingDataResult }) {
  const [tab, setTab] = useState<Tab>('patterns');
  const tabs: [Tab, string][] = [
    ['patterns', 'Patterns'],
    ['coverage', 'Coverage'],
    ['em', 'EM estimates'],
    ...(r.little || r.jamjal ? [['mcar', 'MCAR tests'] as [Tab, string]] : []),
    ...(r.dropout ? [['dropout', 'Dropout'] as [Tab, string]] : []),
  ];
  const v = r.variables;
  const lower = (M: number[][]) =>
    M.map((row, i) => [c(v[i]), ...v.map((_, j) => (j <= i ? c(row[j]) : c('')))]);
  const pct = (n: number) => fmt((100 * n) / r.n, 1) + '%';
  const d = r.dropout;
  const pctRows = (vars: DropoutVariable[]) =>
    vars.flatMap((x) =>
      x.rows.map((row, i) => [
        c(i === 0 ? x.variable : ''),
        c(dropoutLabel(row.group, row.time)),
        c(row.n, undefined, 0),
        c(pct(row.n)),
        c(row.n ? row.mean : null),
        c(row.n ? row.sd : null),
      ]),
    );
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Missing data">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tables">
        {tab === 'patterns' && (
          <Table
            title={`Missing-data patterns: ${r.patterns.length}`}
            file="missing-patterns"
            columns={['Pattern', 'Frequency', ...v]}
            rows={r.patterns.map((p, k) => [
              c(k + 1, undefined, 0),
              c(p.n, undefined, 0),
              ...p.observed.map((o) => c(o ? 'x' : '')),
            ])}
            note="x = observed. In Mplus’s order: a pattern read as a binary number, a missing value 1, the first variable the most significant digit."
          />
        )}
        {tab === 'coverage' && (
          <Table
            title="Covariance coverage"
            file="missing-coverage"
            columns={['', ...v]}
            rows={lower(r.coverage)}
            note="The proportion of cases with both values observed (Mplus: PROPORTION OF DATA PRESENT)."
          />
        )}
        {tab === 'em' && (
          <>
            <Table
              title="EM estimates: means"
              file="missing-em-means"
              columns={['Variable', 'Mean']}
              rows={v.map((x, i) => [c(x), c(r.em.means[i])])}
              note={`The unrestricted (H1) model by FIML (lavaan’s EM). ${loglikNote(r.em)}`}
            />
            <Table
              title="EM estimates: covariances"
              file="missing-em-cov"
              columns={['', ...v]}
              rows={lower(r.em.cov)}
            />
            <Table
              title="EM estimates: correlations"
              file="missing-em-cor"
              columns={['', ...v]}
              rows={lower(r.em.cor)}
            />
          </>
        )}
        {tab === 'mcar' && <McarTables r={r} />}
        {tab === 'dropout' && d && (
          <>
            <Table
              title="Dropouts and non-dropouts"
              file="missing-dropout-summary"
              columns={['', 'Number', '% of sample']}
              rows={[
                [c('Observations'), c(r.n, undefined, 0), c('100.0%')],
                [c('Dropouts'), c(d.dropouts, undefined, 0), c(pct(d.dropouts))],
                ...d.byTime.map((k, t) => [c(`   after time ${t}`), c(k, undefined, 0), c(pct(k))]),
                [
                  c('Non-dropouts with complete data'),
                  c(d.nonDropoutsComplete, undefined, 0),
                  c(pct(d.nonDropoutsComplete)),
                ],
                [
                  c('Non-dropouts with intermittent missing'),
                  c(d.nonDropoutsIntermittent, undefined, 0),
                  c(pct(d.nonDropoutsIntermittent)),
                ],
              ]}
              note={`Repeated measures ${d.measures.join(', ')}: a dropout is observed at one occasion and missing at every later one; a non-dropout is observed at the last; intermittent missing is a missing value before that.`}
            />
            <Table
              title="The repeated measures by dropout group"
              file="missing-dropout-set1"
              columns={['Variable', 'Group', 'Observed', '% of sample', 'Mean', 'SD']}
              rows={pctRows(d.set1)}
            />
            {d.set2.length > 0 && (
              <Table
                title="Further variables by dropout group"
                file="missing-dropout-set2"
                columns={['Variable', 'Group', 'Observed', '% of sample', 'Mean', 'SD']}
                rows={pctRows(d.set2)}
                note="Each variable at its occasion; intermittent missing among these variables."
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

export const missingDataAnalysis: AnalysisType<MissingDataOptions, MissingDataResult> = {
  id: 'missingdata',
  title: 'Missing data',
  sub: 'patterns, coverage, EM means and covariances, Little’s MCAR test, dropout (Mplus TYPE = BASIC)',
  group: 'Data',
  cardTitle: () => 'Missing data',
  defaults: () => ({ vars: [], measures: [], descriptive: [], mcar: true, jamjal: false }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const measures = names(raw.measures, 50);
    const desc = Array.isArray(raw.descriptive)
      ? raw.descriptive.slice(0, measures.length).map((x) => name(x))
      : [];
    return {
      vars: names(raw.vars, 200),
      measures,
      descriptive: desc.length === measures.length ? desc : [],
      mcar: flag(raw.mcar),
      jamjal: flag(raw.jamjal),
    };
  },
  Options: MissingDataForm,
  View: ({ result }) => <MissingDataView result={result} />,
  blocked: (o, ctx) => {
    if (!o.vars.length) return 'Choose the variables.';
    if (o.measures.length === 1) return 'Dropout needs at least two repeated measures.';
    if ((o.mcar || o.jamjal) && (o.vars.length < 2 || o.vars.length > 50))
      return 'The MCAR tests take 2 to 50 variables.';
    if (o.descriptive.length && o.descriptive.length !== o.measures.length)
      return 'Give one further variable per occasion (* for none).';
    return missingColumns(
      ctx,
      [...new Set([...o.vars, ...o.measures, ...o.descriptive.filter(Boolean)])],
      'The missing-data summary',
    );
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [...new Set([...o.vars, ...o.measures, ...o.descriptive.filter(Boolean)])],
      [
        o.vars.join('|'),
        o.measures.join('|'),
        o.descriptive.join('|'),
        o.mcar ? 'mcar' : '',
        o.jamjal ? `jamjal:${ctx.settings.seed}` : '',
      ],
    ),
  run: async (o, ctx) =>
    (await import('../rengine/screen')).missingDataR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
    }),
  script: async (o, ctx) =>
    (await import('../rengine/screen')).missingDataScriptR(rawData(ctx)!, {
      ...o,
      seed: ctx.settings.seed,
    }),
  summary: (o) =>
    `${o.vars.length} variable${o.vars.length === 1 ? '' : 's'}${o.mcar ? ' · Little’s test' : ''}${o.jamjal ? ' · Jamshidian & Jalal' : ''}${o.measures.length ? ` · dropout over ${o.measures.length} occasions` : ''}`,
};
