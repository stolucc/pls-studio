// Piecewise SEM (Shipley 2000, 2009; Lefcheck 2016): the observed-variable path model on the canvas fitted one
// equation at a time (lm / glm; lmer / glmer with a random intercept for a grouping column), tested by Shipley's
// d-separation claims and Fisher's C, with AIC, AICc and standardised coefficients (piecewiseSEM; rengine/psem.ts).

import { fmt } from '../format';
import { c, pCell, Table, type Row } from '../components/results/Table';
import {
  PSEM_FAMILIES,
  psemColumns,
  psemStructure,
  type PsemFamily,
  type PsemResult,
  type PsemStandardize,
} from '../rengine/psem';
import { Choice, ColumnSelect, columnsFingerprint, Hint, isObj, missingColumns, name, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/**
 * families: per endogenous variable (data column), its family (absent: normal); group: a column whose groups get a
 * random intercept in every equation; standardize: how non-normal outcomes' coefficients are standardised.
 */
export interface PsemOptions {
  families: Record<string, PsemFamily>;
  group?: string;
  standardize: PsemStandardize;
}

export const PSEM_STANDARDIZE: readonly (readonly [PsemStandardize, string])[] = [
  ['latent.linear', 'Latent-theoretic'],
  ['Menard.OE', 'Observation-empirical'],
];
const FAMILY_IDS = PSEM_FAMILIES.map(([id]) => id);

/** The card's statistically distinct modes (validation/cards.ts): each family, mixed models, the OE standardisation. */
export const PSEM_MODES = [...FAMILY_IDS, 'mixed', 'standardize:Menard.OE'] as const;

/** The structure of the canvas, or why there is none. */
function structureOf(ctx: AnalysisCtx) {
  return psemStructure(ctx.model);
}

/** The families of the structure's outcomes only (stale entries for variables no longer endogenous left out). */
function familiesFor(o: PsemOptions, ctx: AnalysisCtx): Record<string, PsemFamily> {
  const s = structureOf(ctx);
  if (typeof s === 'string') return {};
  const out: Record<string, PsemFamily> = {};
  for (const e of s.equations) {
    const f = o.families[e.y];
    if (f && f !== 'gaussian') out[e.y] = f;
  }
  return out;
}

function PsemOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<PsemOptions>) {
  const s = structureOf(ctx);
  const columns = rawData(ctx)?.names ?? [];
  const intro = (
    <Hint>
      Piecewise (local) estimation of the path model on the canvas: every variable with arrows into it gets its own
      regression, so each outcome can have its own distribution, and the model is tested by the independences the
      diagram implies (Shipley’s d-separation test, Fisher’s C; Lefcheck 2016). Each variable on the canvas must be one
      data column.
    </Hint>
  );
  if (typeof s === 'string') {
    return <fieldset className="card-options" disabled={disabled}>{intro}<div className="empty-results">{s}</div></fieldset>;
  }
  const used = psemColumns(s);
  const nonNormal = s.equations.some((e) => (o.families[e.y] ?? 'gaussian') !== 'gaussian');
  const setFamily = (y: string, f: PsemFamily) => {
    const families = { ...o.families };
    if (f === 'gaussian') delete families[y];
    else families[y] = f;
    set({ ...o, families });
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      {intro}
      {s.equations.map((e) => (
        <div className="field" key={e.y}>
          <label htmlFor={`psem-family-${e.y}`}>{e.y} ← {e.x.join(', ')}</label>
          <select id={`psem-family-${e.y}`} className="select" value={o.families[e.y] ?? 'gaussian'}
            onChange={(ev) => setFamily(e.y, ev.target.value as PsemFamily)}>
            {PSEM_FAMILIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
      ))}
      <ColumnSelect id="psem-group" label="Random intercept for (optional)" value={o.group ?? ''} columns={columns}
        exclude={used} optional="None: lm / glm"
        onChange={(group) => set({ ...o, group: group || undefined })} />
      <div className="hint">
        With a grouping column (e.g. site) every equation is a mixed model with a random intercept per group
        (lme4’s lmer and glmer); the tests of mixed models use Kenward–Roger degrees of freedom.
      </div>
      {nonNormal && (
        <Choice label="Standardising non-normal outcomes" value={o.standardize} options={PSEM_STANDARDIZE}
          onChange={(standardize) => set({ ...o, standardize })}
          hint={o.standardize === 'latent.linear'
            ? 'Binary outcomes: on the scale of a latent propensity (the variance of the linear predictor plus π²/3); Poisson outcomes always by the observation-empirical rule (piecewiseSEM).'
            : 'The variance of the linear predictor divided by the squared correlation of the observed and predicted values (Menard); not available for mixed models.'} />
      )}
    </fieldset>
  );
}

const claimText = (k: PsemResult['claims'][number]) => `${k.y} ⫫ ${k.x}${k.given.length ? ` | ${k.given.join(', ')}` : ''}`;

function PsemView({ r }: { r: PsemResult }) {
  const paths = r.coefs.filter((k) => !k.correlation);
  const errors = r.coefs.filter((k) => k.correlation);
  const mixed = r.r2.some((x) => x.marginal !== null);
  const stats: [string, string][] = [
    ['n', String(r.n)],
    ['Fisher’s C', fmt(r.fisherC, 3)],
    ['df', String(r.df)],
    ['p', r.p === null ? '—' : fmt(r.p, 3)],
    ['AIC', fmt(r.aic, 2)],
    ['AICc', fmt(r.aicc, 2)],
    ['Parameters (K)', String(r.k)],
  ];
  const pathRows: Row[] = paths.map((k) => [c(k.response), c(k.predictor), c(k.est), c(k.se), c(k.df, '', mixed ? 1 : 0), c(k.stat), pCell(k.p), c(k.std)]);
  const r2Rows: Row[] = r.r2.map((x) => mixed
    ? [c(x.response), c(`${x.family} (${x.link})`), c(x.method), c(x.marginal), c(x.conditional)]
    : [c(x.response), c(`${x.family} (${x.link})`), c(x.method), c(x.r2)]);
  return (
    <div className="tables">
      <div className="stat-cards">
        {stats.map(([k, v]) => <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}
      </div>
      {r.claims.length > 0
        ? <Table title="Tests of directed separation (basis set)" file="psem-dsep" columns={['Independence claim', 'df', 'Statistic', 'p']}
          rows={r.claims.map((k) => [c(claimText(k)), c(k.df, '', mixed ? 1 : 0), c(k.stat), pCell(k.p)])}
          note={`Each pair of variables the diagram leaves unconnected must be independent given the variables shown (the claim’s outcome regressed on both, by its own family; the test of the second). Fisher’s C = −2 Σ ln p over the ${r.claims.length} claims, χ² with ${r.df} df: a small p says the diagram misses a path (Shipley 2000, 2009). The statistic is the claim’s t (or z, or F for a mixed model).`} />
        : <p className="muted">The diagram leaves no pair of variables unconnected: no independence claims to test (a saturated model).</p>}
      <Table title="Path coefficients" file="psem-coefs" columns={['Response', 'Predictor', 'Estimate', 'SE', 'df', 'Statistic', 'p', 'Standardised']}
        rows={pathRows}
        note={`Each equation fitted on its own${r.group ? `, with a random intercept for ${r.group}` : ''}. Standardised: the estimate × SD(x) / SD(y), where for a non-normal outcome SD(y) is that of the ${r.standardizeType === 'latent.linear' ? 'latent-theoretic' : 'observation-empirical'} scale (piecewiseSEM ${r.engine.version}). AIC and AICc are the sums over the equations.`} />
      {errors.length > 0 && <Table title="Correlated errors" file="psem-errors" columns={['Variable', 'Variable', 'Correlation', 'df', 'Statistic', 'p']}
        rows={errors.map((k) => [c(k.response), c(k.predictor), c(k.est), c(k.df, '', 0), c(k.stat), pCell(k.p)])}
        note="The correlation of the two outcomes’ residuals; such a pair is left out of the basis set." />}
      <Table title={mixed ? 'R² (marginal and conditional)' : 'R²'} file="psem-r2" columns={mixed ? ['Response', 'Family', 'Method', 'Marginal R²', 'Conditional R²'] : ['Response', 'Family', 'Method', 'R²']}
        rows={r2Rows} note={mixed ? 'Marginal: the fixed effects; conditional: with the random intercepts (Nakagawa & Schielzeth).' : undefined} />
    </div>
  );
}

function parseFamilies(raw: unknown): Record<string, PsemFamily> {
  const out: Record<string, PsemFamily> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, 500)) {
    const key = name(k);
    const f = oneOf(v, FAMILY_IDS, 'gaussian');
    if (key && f !== 'gaussian') out[key] = f;
  }
  return out;
}

function inputOf(o: PsemOptions, ctx: AnalysisCtx) {
  return { families: familiesFor(o, ctx), group: o.group, standardize: o.standardize };
}

export const psemAnalysis: AnalysisType<PsemOptions, PsemResult> = {
  id: 'psem',
  title: 'Piecewise SEM',
  sub: 'path model fitted equation by equation (lm, glm, mixed models); d-separation tests, Fisher’s C (piecewiseSEM)',
  group: 'Regression and causal inference',
  defaults: () => ({ families: {}, standardize: 'latent.linear' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: PsemOptions = {
      families: parseFamilies(raw.families),
      standardize: oneOf(raw.standardize, PSEM_STANDARDIZE.map(([id]) => id), 'latent.linear'),
    };
    const group = name(raw.group);
    if (group) o.group = group;
    return o;
  },
  Options: PsemOptionsForm,
  View: ({ result }) => <PsemView r={result} />,
  blocked: (o, ctx) => {
    const s = structureOf(ctx);
    if (typeof s === 'string') return s;
    const cols = psemColumns(s);
    if (o.group && cols.includes(o.group)) return 'The grouping column cannot be a variable of the model.';
    return missingColumns(ctx, o.group ? [...cols, o.group] : cols, 'Piecewise SEM');
  },
  fingerprint: (o, ctx) => {
    const s = structureOf(ctx);
    if (typeof s === 'string') return null;
    const cols = psemColumns(s);
    const extra = [JSON.stringify(s), JSON.stringify(familiesFor(o, ctx)), o.group ?? '', o.standardize];
    return columnsFingerprint(ctx, o.group ? [...cols, o.group] : cols, extra);
  },
  run: async (o, ctx) => {
    const s = structureOf(ctx);
    if (typeof s === 'string') throw new Error(s);
    return (await import('../rengine/psem')).psemR(rawData(ctx)!, s, inputOf(o, ctx));
  },
  script: async (o, ctx) => {
    const s = structureOf(ctx);
    if (typeof s === 'string') throw new Error(s);
    return (await import('../rengine/psem')).psemScriptR(rawData(ctx)!, s, inputOf(o, ctx));
  },
  summary: (o) => {
    const fams = Object.values(o.families);
    const kinds = [...new Set(fams)].join(', ');
    return `${kinds ? `normal and ${kinds}` : 'normal outcomes'}${o.group ? ` · random intercept for ${o.group}` : ''}`;
  },
};
