// Meta-analysis card: one row per study (or per effect size, in a three-level model), effect sizes given or computed
// from summary data, an equal- or random-effects model, meta-regression, publication bias and influence diagnostics
// (metafor; rengine/meta.ts). It needs no raw case data: the studies' summaries are the data.

import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP, pIs } from '../format';
import {
  META_MEASURES,
  META_METHODS,
  META_ROLE_LABELS,
  measureTransf,
  metaColumns,
  metaRoles,
  type MetaInput,
  type MetaMeasure,
  type MetaMethod,
  type MetaResult,
  type MetaTransf,
} from '../rengine/meta';
import {
  Choice,
  ColumnSelect,
  columnsFingerprint,
  flag,
  Hint,
  isObj,
  missingColumns,
  name,
  names,
  oneOf,
  rawData,
} from './common';
import { ForestPlot, FunnelPlot } from './metaCharts';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface MetaOptions {
  measure: MetaMeasure;
  /** role → column (escalc's argument names). */
  columns: Record<string, string>;
  varType: 'vi' | 'sei';
  method: MetaMethod;
  knha: boolean;
  /** Given effect sizes (GEN): the scale they are on, for the back-transformed pooled estimate. */
  transf: MetaTransf;
  moderators: string[];
  categorical: string[];
  cluster: string;
  label: string;
  bias: boolean;
  influence: boolean;
}
type Result = MetaResult & { input: MetaInput };

const MEASURE_IDS = Object.keys(META_MEASURES) as MetaMeasure[];
const METHOD_IDS = META_METHODS.map(([id]) => id);
const TRANSFS = ['none', 'exp', 'ztor', 'ilogit'] as const;
const ROLES = Object.keys(META_ROLE_LABELS);

/** The card's statistically distinct modes (validation/cards.ts). */
export const META_MODES = [
  ...MEASURE_IDS.map((m) => `measure:${m}`),
  'measure:GEN:sei',
  ...METHOD_IDS.map((m) => `method:${m}`),
  'knha',
  'moderators',
  'categorical',
  'threelevel',
  'bias',
  'influence',
] as const;

function MetaOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<MetaOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) {
    return (
      <div className="empty-results">
        Import the studies first: one row per study, with its effect size and variance, or its
        summary data (means, SDs and ns; event counts; correlations; proportions).
      </div>
    );
  }
  const roles = metaRoles(o);
  const taken = roles.map((r) => o.columns[r] ?? '').filter(Boolean);
  const setColumn = (role: string, column: string) =>
    set({ ...o, columns: { ...o.columns, [role]: column } });
  const toggleCategorical = (m: string, on: boolean) => {
    const rest = o.categorical.filter((x) => x !== m);
    set({ ...o, categorical: on ? [...rest, m] : rest });
  };
  const twoLevel = !o.cluster;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>
        Pools the studies’ effects (metafor, Viechtbauer 2010): each row is a study, with its effect
        size and sampling variance, or the summary data the effect size is computed from (escalc).
      </Hint>
      <div className="field">
        <label htmlFor="meta-measure">Effect size</label>
        <select
          id="meta-measure"
          className="select"
          value={o.measure}
          onChange={(e) => set({ ...o, measure: e.target.value as MetaMeasure })}
        >
          {MEASURE_IDS.map((m) => (
            <option key={m} value={m}>
              {META_MEASURES[m].label}
            </option>
          ))}
        </select>
      </div>
      {o.measure === 'GEN' && (
        <Choice
          label="Precision given as"
          value={o.varType}
          onChange={(varType) => set({ ...o, varType })}
          options={
            [
              ['vi', 'Variances'],
              ['sei', 'Standard errors'],
            ] as const
          }
        />
      )}
      <div className="row2">
        {roles.map((role) => (
          <ColumnSelect
            key={role}
            id={`meta-${role}`}
            label={META_ROLE_LABELS[role]}
            value={o.columns[role] ?? ''}
            columns={columns}
            exclude={taken.filter((x) => x !== o.columns[role])}
            onChange={(v) => setColumn(role, v)}
          />
        ))}
      </div>
      {o.measure === 'GEN' && (
        <Choice
          label="The effect sizes are"
          value={o.transf}
          onChange={(transf) => set({ ...o, transf })}
          options={
            [
              ['none', 'As they are'],
              ['exp', 'Log ratios'],
              ['ztor', 'Fisher’s z'],
              ['ilogit', 'Logits'],
            ] as const
          }
          hint="Log ratios, Fisher’s z and logits are also reported back-transformed (ratio, correlation, proportion)."
        />
      )}
      <ColumnSelect
        id="meta-label"
        label="Study labels (optional)"
        value={o.label}
        columns={columns}
        optional="Row numbers"
        onChange={(label) => set({ ...o, label })}
      />
      <div className="row2">
        <div className="field">
          <label htmlFor="meta-method">Model</label>
          <select
            id="meta-method"
            className="select"
            value={o.method}
            onChange={(e) => set({ ...o, method: e.target.value as MetaMethod })}
          >
            {META_METHODS.map(([id, label]) => (
              <option key={id} value={id} disabled={!twoLevel && id !== 'REML' && id !== 'ML'}>
                {id === 'FE' ? label : `Random effects: ${label}`}
              </option>
            ))}
          </select>
        </div>
        <ColumnSelect
          id="meta-cluster"
          label="Three-level: effect sizes nested in (optional)"
          value={o.cluster}
          columns={columns}
          exclude={[...taken, ...o.moderators]}
          optional="None: one effect per study"
          onChange={(cluster) => set({ ...o, cluster })}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={o.knha}
          onChange={(e) => set({ ...o, knha: e.target.checked })}
        />{' '}
        Knapp–Hartung adjustment (t and F tests; better coverage with few studies)
      </label>
      <OrderedPicker
        label="Moderators: meta-regression (optional)"
        columns={columns.filter((n) => !taken.includes(n) && n !== o.cluster)}
        value={o.moderators}
        onChange={(moderators) => set({ ...o, moderators })}
      />
      {o.moderators.map((m) => (
        <label className="check" key={m}>
          <input
            type="checkbox"
            checked={o.categorical.includes(m)}
            onChange={(e) => toggleCategorical(m, e.target.checked)}
          />{' '}
          {m} is categorical (dummy-coded, first category as reference)
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={o.bias}
          disabled={o.moderators.length > 0 || !twoLevel}
          onChange={(e) => set({ ...o, bias: e.target.checked })}
        />{' '}
        Publication bias: Egger’s test, rank correlation, trim-and-fill, PET-PEESE
        {(o.moderators.length > 0 || !twoLevel) && ' (models without moderators, two levels)'}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={o.influence}
          disabled={!twoLevel}
          onChange={(e) => set({ ...o, influence: e.target.checked })}
        />{' '}
        Influence diagnostics: Cook’s distance, studentised residuals, leave-one-out
        {!twoLevel && ' (two-level models)'}
      </label>
    </fieldset>
  );
}

/** The interval of an estimate as text. */
const ci = (lo: number, hi: number) => `[${fmt(lo)}, ${fmt(hi)}]`;

function StatCards({ items }: { items: [string, string][] }) {
  return (
    <div className="stat-cards">
      {items.map(([k, v]) => (
        <div className="stat-card" key={k}>
          <div className="k">{k}</div>
          <div className="v">{v}</div>
        </div>
      ))}
    </div>
  );
}

/** The model as words, for the paragraph under the numbers. */
function modelText(r: MetaResult): string {
  const method = META_METHODS.find(([id]) => id === r.method)?.[1] ?? r.method;
  const model =
    r.method === 'FE' ? 'equal-effects model' : `random-effects model (τ² by ${method})`;
  const what = r.threeLevel ? `three-level ${model}` : model;
  const test = r.knha ? '; Knapp–Hartung t and F tests' : '';
  return `${r.k} effect sizes, ${what}${test} (${r.engine.package} ${r.engine.version}).`;
}

function heterogeneityRows(r: MetaResult): Row[] {
  const h = r.heterogeneity;
  const qRow: Row = [c('Q (residual heterogeneity)'), c(r.Q), c(`df = ${r.Qdf}`), pCell(r.Qp)];
  if (r.threeLevel) {
    const levels = h.levels ?? [];
    const sigma2 = h.sigma2 ?? [];
    const i2 = Array.isArray(h.I2) ? h.I2 : [];
    return [
      ...sigma2.map((s, i): Row => [c(`σ² ${levels[i] ?? i + 1}`), c(s), c(''), c('')]),
      ...i2.map(
        (v, i): Row => [c(`I² ${levels[i] ?? i + 1} (%)`), c(v, undefined, 1), c(''), c('')],
      ),
      qRow,
    ];
  }
  const bounds = (b?: { ciLow: number; ciHigh: number } | null, d?: number) =>
    b ? c(`[${fmt(b.ciLow, d)}, ${fmt(b.ciHigh, d)}]`) : c('');
  const rows: Row[] = [];
  if (r.method !== 'FE') {
    rows.push([c('τ²'), c(h.tau2 ?? null), bounds(h.ci?.tau2), c('')]);
    rows.push([c('τ'), c(Math.sqrt(h.tau2 ?? 0)), bounds(h.ci?.tau), c('')]);
  }
  rows.push([
    c('I² (%)'),
    c(typeof h.I2 === 'number' ? h.I2 : null, undefined, 1),
    bounds(h.ci?.I2, 1),
    c(''),
  ]);
  rows.push([c('H²'), c(h.H2 ?? null), bounds(h.ci?.H2), c('')]);
  if (h.R2 !== undefined && h.R2 !== null) {
    rows.push([c('R² (%, heterogeneity explained)'), c(h.R2, undefined, 1), c(''), c('')]);
  }
  rows.push(qRow);
  return rows;
}

function BiasTables({ r }: { r: MetaResult }) {
  const b = r.bias;
  if (!b) return null;
  const tf = b.trimfill;
  const statName = (x: { df: number | null }) => (x.df ? `t(${x.df})` : 'z');
  // Stanley & Doucouliagos (2014): PEESE when PET's intercept is significant (5%, two-sided).
  const peese = b.pet.estP < 0.05;
  return (
    <Table
      title="Publication bias"
      file="meta-bias"
      columns={['Test', 'Statistic', 'p', 'Limit / adjusted estimate', 'CI']}
      rows={[
        [
          c('Egger’s regression test'),
          c(`z = ${fmt(b.egger.stat)}`),
          pCell(b.egger.p),
          c(b.egger.est),
          c(ci(b.egger.ciLow, b.egger.ciHigh)),
        ],
        [
          c('Rank correlation (Kendall’s τ)'),
          c(`τ = ${fmt(b.rank.tau)}`),
          pCell(b.rank.p),
          c(''),
          c(''),
        ],
        [
          c(`Trim-and-fill (${tf.k0} added on the ${tf.side})`),
          c(''),
          pCell(tf.p),
          c(tf.est),
          c(ci(tf.ciLow, tf.ciHigh)),
        ],
        [
          c('PET (precision-effect test)'),
          c(`${statName(b.pet)} = ${fmt(b.pet.stat)}`),
          pCell(b.pet.p),
          c(b.pet.est),
          c(ci(b.pet.ciLow, b.pet.ciHigh)),
        ],
        [
          c('PEESE (with the variance)'),
          c(`${statName(b.peese)} = ${fmt(b.peese.stat)}`),
          pCell(b.peese.p),
          c(b.peese.est),
          c(ci(b.peese.ciLow, b.peese.ciHigh)),
        ],
      ]}
      note={
        'Egger’s test (metafor’s regtest: the standard error as a moderator of the model) and the rank ' +
        'correlation test small-study effects (funnel asymmetry); a small p suggests bias. Trim-and-fill ' +
        '(Duval & Tweedie) adds the studies the asymmetry suggests are missing and re-estimates. PET and ' +
        'PEESE (Stanley & Doucouliagos 2014; weighted least squares on the standard error or the variance) ' +
        `give the effect of a study with no sampling error. PET’s intercept p = ${fmtP(b.pet.estP)}: ` +
        `by the conditional rule, ${peese ? 'PEESE' : 'PET'} is the corrected estimate.`
      }
    />
  );
}

function InfluenceTables({ r }: { r: MetaResult }) {
  if (!r.influence) return null;
  return (
    <>
      <Table
        title="Influence diagnostics"
        file="meta-influence"
        columns={[
          'Study',
          'Studentised residual',
          'DFFITS',
          'Cook’s distance',
          'Cov. ratio',
          'τ² without',
          'Hat',
          'Weight (%)',
          'Influential',
        ]}
        rows={r.influence.map((s) => [
          c(s.label),
          c(s.rstudent),
          c(s.dffits),
          c(s.cook),
          c(s.covr),
          c(s.tau2del),
          c(s.hat),
          c(s.weight, undefined, 1),
          c(s.influential ? 'yes' : '', s.influential ? 'bad' : undefined),
        ])}
        note="metafor’s influence(): a study is flagged when it is influential by any of Viechtbauer & Cheung’s (2010) cut-offs (DFFITS, Cook’s distance, covariance ratio, hat value)."
      />
      {r.leaveOneOut && (
        <Table
          title="Leave-one-out"
          file="meta-leave-one-out"
          columns={['Study left out', 'Estimate', 'Std. error', 'p', 'CI', 'Q', 'τ²', 'I² (%)']}
          rows={r.leaveOneOut.map((s) => [
            c(s.label),
            c(s.est),
            c(s.se),
            pCell(s.p),
            c(ci(s.ciLow, s.ciHigh)),
            c(s.Q),
            c(s.tau2),
            c(s.I2, undefined, 1),
          ])}
          note="The model refitted without each study in turn: a large shift marks a study the result depends on."
        />
      )}
    </>
  );
}

function MetaView({ r }: { r: Result }) {
  const pct = Math.round(r.input.confidence * 100);
  const p = r.pooled;
  const back = r.pooledBack;
  const items: [string, string][] = [['Studies (k)', String(r.k)]];
  if (p) {
    items.push(['Pooled estimate', fmt(p.est)]);
    items.push([`${pct}% CI`, ci(p.ciLow, p.ciHigh)]);
    if (r.method !== 'FE') items.push([`${pct}% prediction interval`, ci(p.piLow, p.piHigh)]);
    if (back) items.push(['Back-transformed', `${fmt(back.est)} ${ci(back.ciLow, back.ciHigh)}`]);
  }
  if (!r.threeLevel && typeof r.heterogeneity.I2 === 'number') {
    items.push(['I²', `${fmt(r.heterogeneity.I2, 1)}%`]);
  }
  const moderated = r.QM !== null;
  const qmText = () => {
    if (r.QM === null) return '';
    const stat = r.QMdf.length === 2 ? `F(${r.QMdf[0]}, ${r.QMdf[1]})` : `Q_M(${r.QMdf[0]})`;
    return ` Test of the moderators: ${stat} = ${fmt(r.QM, 2)}, p ${pIs(r.QMp ?? 1)}.`;
  };
  return (
    <div className="tables">
      <StatCards items={items} />
      <p className="hint" style={{ marginTop: 0 }}>
        {modelText(r)}
        {` Heterogeneity: Q(${r.Qdf}) = ${fmt(r.Q, 2)}, p ${pIs(r.Qp)}.`}
        {qmText()}
        {back && ` Back-transformed: ${backName(r.input)}.`}
      </p>
      <ForestPlot r={r} pct={pct} />
      <Table
        title={moderated ? 'Meta-regression' : 'Model'}
        file="meta-coefficients"
        columns={['Term', 'Estimate', 'Std. error', r.knha ? 't' : 'z', 'p', `${pct}% CI`]}
        rows={r.coefs.map((k) => [
          c(k.term === 'intrcpt' ? 'Intercept' : k.term),
          c(k.est),
          c(k.se),
          c(k.stat),
          pCell(k.p),
          c(ci(k.ciLow, k.ciHigh)),
        ])}
      />
      <Table
        title="Heterogeneity"
        file="meta-heterogeneity"
        columns={['Statistic', 'Estimate', `${pct}% CI`, 'p']}
        rows={heterogeneityRows(r)}
        note={
          r.threeLevel
            ? 'Variance components of the three-level model and the share of the total variance at each level (multilevel I², Cheung 2014).'
            : 'τ²: the variance of the true effects; I²: the share of the observed variance that is heterogeneity, not sampling error; H²: total over sampling variance. Confidence intervals by the Q-profile method (confint).'
        }
      />
      {!moderated && <FunnelPlot r={r} pct={pct} />}
      <BiasTables r={r} />
      <InfluenceTables r={r} />
    </div>
  );
}

/** What the back-transformed estimate is. */
function backName(i: MetaInput): string {
  const t = measureTransf(i.measure, i.transf);
  if (t === 'exp') return 'a ratio (exp)';
  if (t === 'ztor') return 'a correlation (Fisher’s z to r)';
  if (t === 'ilogit') return 'a proportion (inverse logit)';
  return '';
}

/** "factor(alloc)2" → "alloc: random" (a text column's category), or "alloc = 2". */
export function termLabel(term: string, categories?: Record<string, string[]>): string {
  const m = /^factor\((.+)\)(.+)$/.exec(term);
  if (!m) return term;
  const [, column, level] = m;
  const cats = categories?.[column];
  const code = Number(level);
  if (cats && Number.isInteger(code) && code >= 1 && code <= cats.length) {
    return `${column}: ${cats[code - 1]}`;
  }
  return `${column} = ${level}`;
}

export const metaInput = (o: MetaOptions, ctx: Pick<AnalysisCtx, 'settings'>): MetaInput => ({
  ...o,
  confidence: ctx.settings.confidence,
});

export const metaAnalysis: AnalysisType<MetaOptions, Result> = {
  id: 'meta',
  title: 'Meta-analysis',
  sub: 'pool studies’ effect sizes: random effects, meta-regression, three-level models, forest and funnel plots, publication bias (metafor)',
  group: 'Basic statistics',
  defaults: () => ({
    measure: 'GEN',
    columns: {},
    varType: 'vi',
    method: 'REML',
    knha: false,
    transf: 'none',
    moderators: [],
    categorical: [],
    cluster: '',
    label: '',
    bias: true,
    influence: false,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const columns: Record<string, string> = {};
    if (isObj(raw.columns)) {
      for (const role of ROLES) {
        const v = name(raw.columns[role]);
        if (v) columns[role] = v;
      }
    }
    const moderators = names(raw.moderators);
    return {
      measure: oneOf(raw.measure, MEASURE_IDS, 'GEN'),
      columns,
      varType: oneOf(raw.varType, ['vi', 'sei'] as const, 'vi'),
      method: oneOf(raw.method, METHOD_IDS, 'REML'),
      knha: flag(raw.knha),
      transf: oneOf(raw.transf, TRANSFS, 'none'),
      moderators,
      categorical: names(raw.categorical).filter((m) => moderators.includes(m)),
      cluster: name(raw.cluster),
      label: name(raw.label),
      bias: flag(raw.bias),
      influence: flag(raw.influence),
    };
  },
  Options: MetaOptionsForm,
  View: ({ result }) => <MetaView r={result} />,
  blocked: (o, ctx) => {
    const roles = metaRoles(o);
    const missing = roles.filter((r) => !o.columns[r]);
    if (missing.length) {
      return `Choose the columns: ${missing.map((r) => META_ROLE_LABELS[r]).join(', ')}.`;
    }
    const used = roles.map((r) => o.columns[r]);
    if (new Set(used).size < used.length)
      return 'Each summary-data column must be a different column.';
    if (o.moderators.some((m) => used.includes(m) || m === o.cluster)) {
      return 'Moderators must be other columns than the effect sizes and the cluster.';
    }
    if (o.cluster && used.includes(o.cluster)) {
      return 'The cluster must be another column than the effect sizes.';
    }
    if (o.cluster && o.method !== 'REML' && o.method !== 'ML') {
      return 'A three-level model is estimated by REML or ML: choose one of them.';
    }
    return missingColumns(ctx, metaColumns(metaInput(o, ctx)), 'Meta-analysis');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, metaColumns(metaInput(o, ctx)), [
      JSON.stringify(o),
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) => {
    const input = metaInput(o, ctx);
    const r = await (await import('../rengine/meta')).metaR(rawData(ctx)!, input);
    const categories = rawData(ctx)?.categories;
    const coefs = r.coefs.map((k) => ({ ...k, term: termLabel(k.term, categories) }));
    return { ...r, coefs, input };
  },
  script: async (o, ctx) =>
    (await import('../rengine/meta')).metaScriptR(rawData(ctx)!, metaInput(o, ctx)),
  summary: (o) => {
    const method = o.method === 'FE' ? 'equal effects' : `random effects (${o.method})`;
    const parts = [META_MEASURES[o.measure].label, method];
    if (o.moderators.length) parts.push(`moderators: ${o.moderators.join(', ')}`);
    if (o.cluster) parts.push(`three-level by ${o.cluster}`);
    return parts.join(' · ');
  },
};
