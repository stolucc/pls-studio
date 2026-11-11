// Validity cards (R/validity.R): common method bias — Harman's single-factor test
// (Podsakoff et al. 2003) and Kock's (2015) full-collinearity VIFs, on the PLS model
// (its indicators, its construct scores) or on chosen columns — and the content
// validity index of an item × expert rating matrix (Lynn 1986; Polit & Beck 2006;
// Polit, Beck & Owen 2007).

import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type { CmbInput, CmbResult, CviInput, CviResult } from '../rengine/validity';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  names,
  oneOf,
  rawData,
  sourceData,
  sourceFingerprint,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/validity');
const Engine = ({ e }: { e: { package: string; version: string } }) => (
  <p className="hint" style={{ marginTop: 0 }}>
    {e.package === 'stats' ? 'Base R' : e.package} {e.version}.
  </p>
);

// ---------------------------------------------------------------- common method bias

/** `source` model: Harman's test on every indicator of the diagram, the VIFs on the PLS construct scores; columns: `vars` of the data. */
export interface CmbOptions {
  type: CmbInput['type'];
  source: 'model' | 'columns';
  vars: string[];
  extraction: CmbInput['extraction'];
}
const CMB_NAME = { harman: 'Harman’s single-factor test', vif: 'Full-collinearity VIFs' } as const;
/** Kock (2015): a VIF above 3.3 signals pathological collinearity, and so common method bias. */
export const KOCK_VIF = 3.3;
/** Harman's single-factor test, or full-collinearity VIFs. */
export const CMB_TYPES = ['harman', 'vif'] as const;

/** The indicators the diagram uses, in canvas order (those in the data). */
const modelIndicators = (ctx: AnalysisCtx) => {
  const ds = rawData(ctx);
  return [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))].filter((n) =>
    ds?.names.includes(n),
  );
};
/** The columns a run reads: the data for Harman's test and chosen columns, the construct scores for the model's VIFs. */
export function cmbData(
  o: CmbOptions,
  ctx: AnalysisCtx,
): { data: ReturnType<typeof rawData>; vars: string[] } {
  if (o.source === 'columns') return { data: rawData(ctx), vars: o.vars };
  if (o.type === 'harman') return { data: rawData(ctx), vars: modelIndicators(ctx) };
  return { data: sourceData('scores', ctx), vars: ctx.pls?.constructs ?? [] };
}

function CmbForm({ options: o, set, ctx, disabled }: OptionsProps<CmbOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  const hasModel = !!ctx.model?.constructs.length;
  // Harman's test reads the diagram's indicators; the VIFs read the PLS construct scores.
  let modelSourceTitle = 'Draw a model first';
  if (hasModel)
    modelSourceTitle =
      o.type === 'harman'
        ? 'Every indicator of the diagram'
        : 'The construct scores of the current PLS-SEM results';
  const modelSourceHint = () => {
    if (o.type === 'harman') return `${modelIndicators(ctx).length} indicators of the diagram.`;
    if (ctx.pls) return `${ctx.pls.constructs.length} constructs of the current PLS-SEM results.`;
    return 'Calculate the PLS-SEM model first (Model tab).';
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Test"
        value={o.type}
        onChange={(type) => set({ ...o, type })}
        options={[
          ['harman', 'Harman’s single factor'],
          ['vif', 'Full-collinearity VIFs'],
        ]}
        hint={
          o.type === 'harman'
            ? 'An unrotated one-factor solution of all the measures: if one factor accounts for most of their variance (the usual rule: over 50%), a common method may be at work. Podsakoff et al. (2003) note the test’s weakness: it detects only gross bias and corrects nothing.'
            : 'Each variable regressed on all the others (Kock 2015). On a PLS model, every construct on every other construct, from the construct scores: a VIF above 3.3 signals pathological collinearity, and so common method bias.'
        }
      />
      <div className="field">
        <label>Variables</label>
        <div className="segmented">
          <button
            className={o.source === 'model' ? 'on' : ''}
            disabled={!hasModel}
            onClick={() => set({ ...o, source: 'model' })}
            title={modelSourceTitle}
          >
            {o.type === 'harman' ? 'The model’s indicators' : 'PLS construct scores'}
          </button>
          <button
            className={o.source === 'columns' ? 'on' : ''}
            onClick={() => set({ ...o, source: 'columns' })}
          >
            Data columns
          </button>
        </div>
      </div>
      {o.source === 'columns' ? (
        <OrderedPicker
          label={o.type === 'harman' ? 'Measures (three or more)' : 'Variables (two or more)'}
          columns={numeric}
          value={o.vars}
          onChange={(vars) => set({ ...o, vars })}
        />
      ) : (
        <div className="hint">{modelSourceHint()}</div>
      )}
      {o.type === 'harman' && (
        <Choice
          label="Extraction"
          value={o.extraction}
          onChange={(extraction) => set({ ...o, extraction })}
          options={[
            ['pca', 'Principal component (psych::principal)'],
            ['fa', 'Common factor (psych::fa, minres)'],
          ]}
          hint="Most papers report the unrotated principal component analysis; a common-factor extraction gives the first factor less variance."
        />
      )}
    </fieldset>
  );
}

function HarmanView({ r }: { r: CmbResult }) {
  const pctShare = r.share! * 100;
  const over = r.share! > 0.5;
  const verdict = over
    ? 'A single factor accounts for more than half of the variance: by the usual heuristic, common method variance may be substantial.'
    : 'No single factor accounts for more than half of the variance (the usual heuristic), and more than one factor emerges.';
  const extraction =
    r.extraction === 'fa'
      ? 'Unrotated common-factor (minres) extraction of one factor, psych::fa.'
      : 'Unrotated principal component analysis of one component, psych::principal, as most papers run it.';
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`Harman’s single-factor test: ${r.vars.length} measures, n = ${r.n}`}
        file="cmb-harman"
        columns={['Statistic', 'Value']}
        rows={[
          [
            c(
              `Variance accounted for by the single ${r.extraction === 'fa' ? 'factor' : 'component'} (%)`,
            ),
            c(pctShare, over ? 'bad' : 'good', 1),
          ],
          [c('Sum of squared loadings'), c(r.ssLoadings ?? null)],
          [c('Eigenvalues above 1'), c(r.kaiser ?? null, undefined, 0)],
          [c('Largest eigenvalue'), c(r.eigenvalues?.[0] ?? null)],
        ]}
        note={`${verdict} The 50% rule is a convention, not a test: Podsakoff, MacKenzie, Lee & Podsakoff (2003) and Podsakoff, MacKenzie & Podsakoff (2012) warn that the test is insensitive (a method factor rarely explains most of the variance even when it biases the estimates), that the cutoff is arbitrary, and that it corrects nothing; report it alongside a stronger check such as the full-collinearity VIFs or a marker variable. ${extraction} Complete cases.`}
      />
      <Table
        title="Eigenvalues of the correlation matrix"
        file="cmb-eigenvalues"
        columns={['Component', 'Eigenvalue', '% of variance', 'Cumulative %']}
        rows={(r.eigenvalues ?? []).map(
          (ev, i): Row => [
            c(i + 1, undefined, 0),
            c(ev),
            c(r.proportions![i] * 100, undefined, 1),
            c(r.proportions!.slice(0, i + 1).reduce((a, b) => a + b, 0) * 100, undefined, 1),
          ],
        )}
      />
      <Table
        title={`Loadings on the single ${r.extraction === 'fa' ? 'factor' : 'component'}`}
        file="cmb-loadings"
        columns={['Measure', 'Loading']}
        rows={(r.loadings ?? []).map((l): Row => [c(l.variable), c(l.loading)])}
      />
    </div>
  );
}

/** Kock's full-collinearity threshold in red, amber above 3. */
function vifClass(vif: number) {
  if (vif > KOCK_VIF) return 'bad';
  if (vif > 3) return 'warn';
  return 'good';
}

function VifView({ r, scores }: { r: CmbResult; scores: boolean }) {
  const over = (r.rows ?? []).filter((x) => x.vif > KOCK_VIF);
  const verdict = over.length
    ? `${over.map((x) => x.variable).join(', ')} exceed${over.length === 1 ? 's' : ''} ${KOCK_VIF}: by Kock’s (2015) criterion the model shows pathological collinearity, which a common method shared by the measures can produce.`
    : `Every VIF is at most ${KOCK_VIF}: by Kock’s (2015) criterion the model is free of common method bias.`;
  const data = scores
    ? ' Construct scores of the current PLS-SEM results (standardised; the VIF does not depend on the scale).'
    : ' Complete cases.';
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`Full-collinearity VIFs: ${scores ? 'construct scores' : 'variables'}, n = ${r.n}`}
        file="cmb-vif"
        columns={[scores ? 'Construct' : 'Variable', 'R² on all the others', 'VIF']}
        rows={(r.rows ?? []).map(
          (x): Row => [c(x.variable), c(x.r2), c(x.vif, vifClass(x.vif), 3)],
        )}
        note={`${verdict} Full collinearity (Kock & Lynn 2012; Kock 2015): each ${scores ? 'construct' : 'variable'} regressed on all the others, VIF = 1 / (1 − R²); unlike the lateral (predictor-only) VIFs it also catches vertical collinearity between a dependent construct and its predictors. Kock’s threshold is 3.3 (red; amber above 3), set for the full-collinearity test; 5 and 10 are the more lenient conventions for predictors in a regression.${data}`}
      />
    </div>
  );
}

const cmbVars = (o: CmbOptions, ctx: AnalysisCtx) => cmbData(o, ctx).vars;
const cmbInput = (o: CmbOptions, ctx: AnalysisCtx): CmbInput => ({
  type: o.type,
  vars: cmbVars(o, ctx),
  extraction: o.extraction,
});
export const cmbAnalysis: AnalysisType<CmbOptions, CmbResult> = {
  id: 'cmb',
  title: 'Common method bias',
  sub: 'Harman’s single-factor test; full-collinearity VIFs (Kock 2015)',
  group: 'Measurement',
  fitsModel: (o) => o.source === 'model',
  entries: [
    {
      title: 'Harman’s single-factor test',
      sub: 'one unrotated factor of all the measures: its share of the variance (Podsakoff et al. 2003)',
      options: (o) => ({ ...o, type: 'harman' }),
    },
    {
      title: 'Full-collinearity VIFs',
      sub: 'each construct on all the others, from the PLS construct scores; Kock’s 3.3',
      options: (o) => ({ ...o, type: 'vif' }),
    },
  ],
  cardTitle: (o) => CMB_NAME[o.type],
  defaults: (ctx) => ({
    type: 'harman',
    source: ctx.model?.constructs.length ? 'model' : 'columns',
    vars: [],
    extraction: 'pca',
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          type: oneOf(raw.type, CMB_TYPES, 'harman'),
          source: oneOf(raw.source, ['model', 'columns'] as const, 'model'),
          vars: names(raw.vars),
          extraction: oneOf(raw.extraction, ['pca', 'fa'] as const, 'pca'),
        }
      : null,
  Options: CmbForm,
  View: ({ result, options }) =>
    result.type === 'harman' ? (
      <HarmanView r={result} />
    ) : (
      <VifView r={result} scores={options?.source === 'model'} />
    ),
  blocked: (o, ctx) => {
    const need = o.type === 'harman' ? 3 : 2;
    if (o.source === 'columns')
      return o.vars.length < need
        ? `Choose at least ${need} variables.`
        : missingColumns(ctx, o.vars, CMB_NAME[o.type]);
    if (!ctx.model?.constructs.length)
      return 'Draw a model first (Model tab), or choose data columns.';
    if (o.type === 'harman') {
      const m = missingColumns(ctx, [], CMB_NAME.harman);
      if (m) return m;
      return modelIndicators(ctx).length < need
        ? 'The diagram needs at least three indicators in the data.'
        : null;
    }
    if (!ctx.pls)
      return 'Calculate the PLS-SEM model first (Model tab): the VIFs are computed from its construct scores.';
    return ctx.pls.constructs.length < need ? 'The model needs at least two constructs.' : null;
  },
  fingerprint: (o, ctx) =>
    o.source === 'model' && o.type === 'vif'
      ? sourceFingerprint('scores', ctx, ctx.pls?.constructs ?? [], ['vif'])
      : columnsFingerprint(ctx, cmbVars(o, ctx), [
          o.type,
          o.source,
          o.type === 'harman' ? o.extraction : '',
          ...cmbVars(o, ctx),
        ]),
  run: async (o, ctx) => (await engine()).cmbR(cmbData(o, ctx).data!, cmbInput(o, ctx)),
  script: async (o, ctx) => (await engine()).cmbScriptR(cmbData(o, ctx).data!, cmbInput(o, ctx)),
  summary: (o) => {
    let variables = o.vars.join(', ') || '…';
    if (o.source === 'model')
      variables = o.type === 'harman' ? 'the model’s indicators' : 'construct scores';
    let extraction = '';
    if (o.type === 'harman')
      extraction = ` · ${o.extraction === 'fa' ? 'common factor' : 'principal component'}`;
    return `${CMB_NAME[o.type].toLowerCase()} · ${variables}${extraction}`;
  },
};

// ---------------------------------------------------------------- content validity index

export type CviOptions = CviInput;

/** Cicchetti & Sparrow's (1981) bands for k*, as Polit, Beck & Owen (2007) apply them. */
export const kappaBand = (k: number) => {
  if (k > 0.74) return 'excellent';
  if (k >= 0.6) return 'good';
  if (k >= 0.4) return 'fair';
  return 'poor';
};
const bandClass = { excellent: 'good', good: '', fair: 'warn', poor: 'bad' } as const;

function CviForm({ options: o, set, ctx, disabled }: OptionsProps<CviOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Experts’ ratings (one column per expert, one row per item)"
        columns={numeric.filter((n) => n !== o.item)}
        value={o.raters}
        onChange={(raters) => set({ ...o, raters })}
      />
      <div className="row2">
        <ColumnSelect
          id="cvi-item"
          label="Item names (optional)"
          optional="None: Item 1, 2, …"
          value={o.item}
          columns={d.names}
          exclude={o.raters}
          onChange={(item) => set({ ...o, item })}
        />
        <div className="field">
          <label htmlFor="cvi-th">Relevant from a rating of</label>
          <input
            id="cvi-th"
            className="input num"
            type="number"
            step="any"
            value={o.threshold}
            onChange={(e) => set({ ...o, threshold: clampNum(e.target.value, -1e6, 1e6, 3) })}
          />
        </div>
      </div>
      <div className="hint">
        Relevance on a 4-point scale (1 not relevant … 4 highly relevant): a rating of 3 or 4 counts
        as relevant (Lynn 1986). Wide format: each row is an item, each chosen column an expert.
      </div>
    </fieldset>
  );
}

/** The scale-level CVI (average): .90 or higher is excellent, .80 acceptable. */
function scviAveClass(scvi: number) {
  if (scvi >= 0.9) return 'good';
  if (scvi >= 0.8) return 'warn';
  return 'bad';
}

function CviView({ r }: { r: CviResult }) {
  const N = r.experts.length;
  const icviRule = N <= 5 ? 1 : 0.78;
  const low = r.items.filter((x) => x.icvi < icviRule);
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table
        title={`Scale-level CVI: ${r.nItems} items, ${N} experts`}
        file="cvi-scale"
        columns={['Index', 'Value']}
        rows={[
          [c('S-CVI/Ave (mean of the I-CVIs)'), c(r.scviAve, scviAveClass(r.scviAve), 2)],
          [
            c('S-CVI/UA (items every expert found relevant)'),
            c(r.scviUA, r.scviUA >= 0.8 ? 'good' : 'bad', 2),
          ],
          [
            c('Mean proportion relevant per expert'),
            c(
              r.expertProportions.reduce((a, e) => a + e.proportion, 0) /
                Math.max(1, r.expertProportions.length),
              undefined,
              2,
            ),
          ],
        ]}
        note="S-CVI/Ave is the mean I-CVI (equivalently the mean of the experts’ proportions); S-CVI/UA counts items on which every expert agreed. Polit & Beck (2006) recommend S-CVI/Ave of .90 or higher (S-CVI/UA .80) and advise stating which was computed, as the two can differ widely."
      />
      <Table
        title="Item-level CVI and modified kappa"
        file="cvi-items"
        columns={['Item', 'Experts', 'Relevant', 'I-CVI', 'pc', 'k*', 'Evaluation']}
        rows={r.items.map((x): Row => {
          const b = kappaBand(x.kappa);
          return [
            c(x.item),
            c(x.n, undefined, 0),
            c(x.agree, undefined, 0),
            c(x.icvi, x.icvi < icviRule ? 'warn' : '', 2),
            c(x.pc, undefined, 2),
            c(x.kappa, bandClass[b], 2),
            c(b, bandClass[b]),
          ];
        })}
        note={`I-CVI: the proportion of experts rating the item relevant (a rating of ${fmt(r.threshold, Number.isInteger(r.threshold) ? 0 : 2)} or higher). pc = N! / [A! (N − A)!] × .5ᴺ is the probability that A of N experts agree by chance; k* = (I-CVI − pc) / (1 − pc) is the item’s agreement beyond chance (Polit, Beck & Owen 2007), evaluated with Cicchetti & Sparrow’s (1981) bands: above .74 excellent, .60–.74 good, .40–.59 fair, below .40 poor. Lynn (1986): with five or fewer experts every expert should agree (I-CVI 1.00); with six or more an I-CVI of .78 or higher is acceptable${low.length ? ` (amber: ${low.map((x) => x.item).join(', ')})` : ''}. Polit, Beck & Owen note that any I-CVI of .78 or higher with three or more experts is excellent by k* as well.`}
      />
      <Table
        title="Experts"
        file="cvi-experts"
        columns={['Expert', 'Items rated', 'Proportion relevant']}
        rows={r.expertProportions.map(
          (e): Row => [c(e.expert), c(e.rated, undefined, 0), c(e.proportion, undefined, 2)],
        )}
      />
    </div>
  );
}

const cviCols = (o: CviOptions) => [o.item, ...o.raters].filter(Boolean);
export const cviAnalysis: AnalysisType<CviOptions, CviResult> = {
  id: 'cvi',
  title: 'Content validity index',
  sub: 'I-CVI, S-CVI/Ave, S-CVI/UA and the modified kappa of expert relevance ratings',
  group: 'Measurement',
  cardTitle: () => 'Content validity index',
  defaults: () => ({ raters: [], item: '', threshold: 3 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          raters: names(raw.experts ?? raw.raters),
          item: name(raw.item),
          threshold: clampNum(raw.threshold, -1e6, 1e6, 3),
        }
      : null,
  Options: CviForm,
  View: ({ result }) => <CviView r={result} />,
  blocked: (o, ctx) => {
    if (o.raters.length < 2) return 'Choose at least two experts’ columns.';
    if (o.raters.includes(o.item)) return 'The item column cannot be an expert’s ratings.';
    return missingColumns(ctx, cviCols(o), 'The content validity index');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, cviCols(o), [o.threshold, o.item, ...o.raters]),
  run: async (o, ctx) => (await engine()).cviR(rawData(ctx)!, o),
  script: async (o, ctx) => (await engine()).cviScriptR(rawData(ctx)!, o),
  summary: (o) =>
    `${o.raters.length ? `${o.raters.length} experts: ${o.raters.join(', ')}` : '…'} · relevant from ${o.threshold}`,
};

export const VALIDITY_TYPES = [cmbAnalysis, cviAnalysis];
