// Basic statistics cards (base R stats, R/tests.R): t-tests, ANOVA and ANCOVA,
// repeated-measures ANOVA, MANOVA, correlations, contingency tables, binomial
// and multinomial tests. The confidence level is the project's (Settings).

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import type {
  Alternative, AnovaInput, AnovaResult, ContingencyInput, ContingencyResult, CorrelationInput, CorrelationResult, FreqTestInput, FreqTestResult,
  HTest, ManovaInput, ManovaResult, ReliabilityInput, ReliabilityResult, RmAnovaInput, RmAnovaResult, TTestInput, TTestResult,
} from '../rengine/tests';
import { Choice, ColumnSelect, columnsFingerprint, flag, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const ALTS: readonly (readonly [Alternative, string])[] = [['two.sided', 'Two-sided'], ['greater', 'Greater'], ['less', 'Less']];
const ALT_IDS = ALTS.map(([id]) => id);
const engine = () => import('../rengine/tests');
const NoData = () => <div className="empty-results">Import raw data first.</div>;
const df = (h: HTest | null | undefined) => (h?.df === undefined || h.df === null ? '' : Array.isArray(h.df) ? h.df.map((x) => fmt(x, 2)).join(', ') : fmt(h.df, Number.isInteger(h.df) ? 0 : 2));
const ci = (lo?: number | null, hi?: number | null) => (lo === undefined || lo === null || hi === undefined || hi === null ? null : `[${fmt(lo)}, ${fmt(hi)}]`);
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const Engine = ({ e }: { e: { package: string; version: string } }) => <p className="hint" style={{ marginTop: 0 }}>Base R ({e.package} {e.version}).</p>;

// ---------------------------------------------------------------- t-tests

export type TTestOptions = Omit<TTestInput, 'confidence'>;

function TTestForm({ options: o, set, ctx, disabled }: OptionsProps<TTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const cols = d.names, numeric = cols.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Design" value={o.type} onChange={(type) => set({ ...o, type })} options={[['one', 'One sample'], ['paired', 'Paired samples'], ['independent', 'Independent samples']]} />
      {o.type === 'paired' ? (
        <div className="field">
          <label>Pairs</label>
          {o.pairs.map((p, i) => (
            <div key={i} className="row2">
              <ColumnSelect id={`tt-a${i}`} label="First" value={p[0]} columns={numeric} onChange={(a) => set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [a, q[1]] : q)) })} />
              <ColumnSelect id={`tt-b${i}`} label="Second" value={p[1]} columns={numeric} exclude={[p[0]]} onChange={(b) => set({ ...o, pairs: o.pairs.map((q, k) => (k === i ? [q[0], b] : q)) })} />
              <button className="btn sm ghost" onClick={() => set({ ...o, pairs: o.pairs.filter((_, k) => k !== i) })} aria-label={`Remove pair ${i + 1}`}>Remove</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => set({ ...o, pairs: [...o.pairs, ['', '']] })}>Add pair</button>
          <div className="hint">Each pair: two measurements of the same cases (before and after, two conditions). The test is on their differences.</div>
        </div>
      ) : (
        <OrderedPicker label="Variables" columns={numeric.filter((n) => n !== o.group)} value={o.vars} onChange={(vars) => set({ ...o, vars })} />
      )}
      {o.type === 'independent' && <ColumnSelect id="tt-g" label="Grouping variable (two groups)" value={o.group} columns={cols} exclude={o.vars} onChange={(group) => set({ ...o, group })} />}
      {o.type === 'one' && (
        <div className="field"><label htmlFor="tt-mu">Test value</label>
          <input id="tt-mu" className="input num" type="number" step="any" value={o.testValue} onChange={(e) => { const v = Number(e.target.value); set({ ...o, testValue: Number.isFinite(v) ? v : 0 }); }} /></div>
      )}
      <div className="field">
        <label>Tests</label>
        <div className="chips">
          <label className="check"><input type="checkbox" checked={o.student} onChange={(e) => set({ ...o, student: e.target.checked })} /> Student</label>
          {o.type === 'independent' && <label className="check"><input type="checkbox" checked={o.welch} onChange={(e) => set({ ...o, welch: e.target.checked })} /> Welch</label>}
          <label className="check"><input type="checkbox" checked={o.rank} onChange={(e) => set({ ...o, rank: e.target.checked })} /> {o.type === 'independent' ? 'Mann–Whitney' : 'Wilcoxon signed-rank'}</label>
        </div>
        <div className="hint">Welch does not assume equal variances. The rank tests use the normal approximation (with a continuity correction, R’s exact = FALSE).</div>
      </div>
      <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={ALTS}
        hint={o.type === 'independent' ? 'Greater: the first group’s mean is larger.' : o.type === 'paired' ? 'Greater: the first measurement is larger.' : 'Greater: the mean exceeds the test value.'} />
    </fieldset>
  );
}

function TTestView({ r }: { r: TTestResult }) {
  const tests = (['student', 'welch', 'rank'] as const).filter((k) => r.rows.some((x) => x[k]));
  const tName = { student: 'Student', welch: 'Welch', rank: r.type === 'independent' ? 'Mann–Whitney' : 'Wilcoxon' };
  const rows: Row[] = r.rows.flatMap((x) => tests.filter((k) => x[k]).map((k): Row => {
    const h = x[k]!;
    const es = k === 'rank' ? x.rankBiserial : k === 'welch' ? x.dWelch : x.d;
    return [c(x.label), c(tName[k]), c(h.stat), c(k === 'rank' ? '' : df(h)), pCell(h.p), c(es ?? null), c(k === 'rank' ? null : ci(h.ciLow, h.ciHigh))];
  }));
  const groups = r.groups ?? [];
  const desc: Row[] = r.rows.flatMap((x) => x.descriptives.map((d, i): Row => [c(r.type === 'independent' ? `${x.label} · ${groups[i] ?? i + 1}` : r.type === 'paired' ? x.variables[i] : x.label), c(d.n, undefined, 0), c(d.mean), c(d.sd ?? null), c(d.se ?? null), c(d.median)]));
  const assumptions: Row[] = r.rows.flatMap((x) => [
    ...x.shapiro.map((s, i): Row => [c(`${x.label}${r.type === 'independent' ? ` · ${groups[i] ?? i + 1}` : r.type === 'paired' ? ' (differences)' : ''}`), c('Shapiro–Wilk W'), c(s?.stat ?? null), pCell(s?.p ?? null)]),
    ...(x.levene ? [[c(x.label), c(`Levene F(${x.levene.df1}, ${x.levene.df2})`), c(x.levene.stat), pCell(x.levene.p)] as Row] : []),
  ]);
  const diffName = r.type === 'one' ? `Mean − ${fmt(r.testValue)}` : r.type === 'paired' ? 'Mean difference' : `${groups[0] ?? 'Group 1'} − ${groups[1] ?? 'group 2'}`;
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table title={`${r.type === 'one' ? 'One-sample' : r.type === 'paired' ? 'Paired-samples' : 'Independent-samples'} t-test${r.alternative !== 'two.sided' ? ` (one-sided: ${r.alternative})` : ''}`} file="ttest"
        columns={['Variable', 'Test', 'Statistic', 'df', 'p', 'Effect size', `${pct(r.confidence)} CI of ${diffName.toLowerCase()}`]} rows={rows}
        note="Effect size: Cohen’s d for the t-tests (Student: pooled SD; Welch: the average of the two variances; paired: the SD of the differences), the rank-biserial correlation for the rank tests. Statistic: t, or W (V for the signed-rank test)." />
      <Table title="Descriptives" file="ttest-descriptives" columns={['Variable', 'N', 'Mean', 'SD', 'SE', 'Median']} rows={desc} />
      <Table title="Assumption checks" file="ttest-assumptions" columns={['Variable', 'Test', 'Statistic', 'p']} rows={assumptions}
        note="Shapiro–Wilk: a small p speaks against normality (needs 3 to 5,000 values). Levene (median-centred, Brown–Forsythe): a small p speaks against equal variances; then prefer Welch." />
    </div>
  );
}

const ttestCols = (o: TTestOptions) => (o.type === 'paired' ? o.pairs.flat() : [...o.vars, o.type === 'independent' ? o.group : '']).filter(Boolean);
const ttestInput = (o: TTestOptions, ctx: Pick<AnalysisCtx, 'settings'>): TTestInput => ({
  ...o, vars: o.type === 'paired' ? [] : o.vars, pairs: o.type === 'paired' ? o.pairs : [], group: o.type === 'independent' ? o.group : '', welch: o.type === 'independent' && o.welch, confidence: ctx.settings.confidence,
});
const T_NAME = { one: 'One-sample t-test', paired: 'Paired-samples t-test', independent: 'Independent-samples t-test' } as const;

export const ttestAnalysis: AnalysisType<TTestOptions, TTestResult> = {
  id: 'ttest', title: 't-tests', sub: 'one sample, paired, independent (Student, Welch, Wilcoxon, Mann–Whitney)', group: 'Basic statistics',
  entries: [
    { title: 'Independent-samples t-test', sub: 'two groups; Student, Welch, Mann–Whitney', options: (o) => ({ ...o, type: 'independent' }) },
    { title: 'Paired-samples t-test', sub: 'two measurements of the same cases; Wilcoxon signed-rank', options: (o) => ({ ...o, type: 'paired' }) },
    { title: 'One-sample t-test', sub: 'a mean against a test value; Wilcoxon signed-rank', options: (o) => ({ ...o, type: 'one' }) },
  ],
  cardTitle: (o) => T_NAME[o.type],
  defaults: () => ({ type: 'independent', vars: [], pairs: [['', '']], group: '', testValue: 0, student: true, welch: true, rank: false, alternative: 'two.sided' }),
  parseOptions: (raw) => (isObj(raw) ? {
    type: oneOf(raw.type, ['one', 'paired', 'independent'] as const, 'independent'), vars: names(raw.vars),
    pairs: (Array.isArray(raw.pairs) ? raw.pairs.slice(0, 100) : []).filter(Array.isArray).map((p) => [name(p[0]), name(p[1])] as [string, string]),
    group: name(raw.group), testValue: typeof raw.testValue === 'number' && Number.isFinite(raw.testValue) ? raw.testValue : 0,
    student: raw.student !== false, welch: flag(raw.welch), rank: flag(raw.rank), alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
  } : null),
  Options: TTestForm,
  View: ({ result }) => <TTestView r={result} />,
  blocked: (o, ctx) => {
    if (!o.student && !(o.welch && o.type === 'independent') && !o.rank) return 'Choose at least one test.';
    if (o.type === 'paired') { if (!o.pairs.length || o.pairs.some((p) => !p[0] || !p[1])) return 'Choose both variables of each pair.'; if (o.pairs.some((p) => p[0] === p[1])) return 'A pair needs two different variables.'; }
    else if (!o.vars.length) return 'Choose at least one variable.';
    if (o.type === 'independent' && !o.group) return 'Choose the grouping variable.';
    if (o.type === 'independent' && o.vars.includes(o.group)) return 'The grouping variable cannot be tested.';
    return missingColumns(ctx, ttestCols(o), 't-test');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, ttestCols(o), [o.type, o.testValue, o.alternative, String(o.student), String(o.welch), String(o.rank), ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).ttestR(rawData(ctx)!, ttestInput(o, ctx)),
  script: async (o, ctx) => (await engine()).ttestScriptR(rawData(ctx)!, ttestInput(o, ctx)),
  summary: (o) => `${T_NAME[o.type].toLowerCase()} · ${o.type === 'paired' ? o.pairs.map((p) => p.join(' − ')).join(', ') || '…' : o.vars.join(', ') || '…'}${o.type === 'independent' ? ` by ${o.group || '…'}` : ''}`,
};

// ---------------------------------------------------------------- ANOVA / ANCOVA

export type AnovaOptions = Omit<AnovaInput, 'confidence'>;

function AnovaForm({ options: o, set, ctx, disabled }: OptionsProps<AnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const cols = d.names, numeric = cols.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect id="an-y" label="Dependent variable" value={o.dependent} columns={numeric} exclude={[...o.factors, ...o.covariates]} onChange={(dependent) => set({ ...o, dependent })} />
      <OrderedPicker label="Fixed factors" columns={cols.filter((n) => n !== o.dependent && !o.covariates.includes(n))} value={o.factors} onChange={(factors) => set({ ...o, factors })}
        hint="Grouping variables: text columns, or numeric codes (each distinct value a group)." />
      <OrderedPicker label="Covariates (ANCOVA, optional)" columns={numeric.filter((n) => n !== o.dependent && !o.factors.includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <div className="row2">
        <Choice label="Sums of squares" value={o.ssType} onChange={(ssType) => set({ ...o, ssType })} options={[['III', 'Type III'], ['I', 'Type I (sequential)']]} />
        <Choice label="Model terms" value={o.interactions ? 'full' : 'main'} onChange={(v) => set({ ...o, interactions: v === 'full' })} options={[['full', 'Full factorial'], ['main', 'Main effects only']]} />
      </div>
      <div className="hint">Type III (sum-to-zero contrasts) tests each term adjusted for all others, the usual choice for unbalanced designs. With one factor and no covariates the card adds Welch’s ANOVA, Kruskal–Wallis and Tukey’s comparisons.</div>
    </fieldset>
  );
}

function AnovaView({ r, conf }: { r: AnovaResult; conf: number }) {
  const rows: Row[] = [...r.table.map((t): Row => [c(t.term), c(t.ss), c(t.df, undefined, 0), c(t.ms), c(t.f), pCell(t.p), c(t.eta2), c(t.partialEta2), c(t.omega2)]),
    [c('Residuals'), c(r.residual.ss), c(r.residual.df, undefined, 0), c(r.residual.ms), c(null), c(null), c(null), c(null), c(null)]];
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}><code>{r.formula}</code>, n = {r.n}; base R ({r.engine.package} {r.engine.version}).</p>
      <Table title={`${r.covariates.length ? 'ANCOVA' : 'ANOVA'}: ${r.dependent} (type ${r.ssType} sums of squares)`} file="anova" columns={['Term', 'Sum of squares', 'df', 'Mean square', 'F', 'p', 'η²', 'Partial η²', 'ω²']} rows={rows} />
      {(r.welch || r.kruskal) && (
        <Table title="One factor: robust and rank-based tests" file="anova-robust" columns={['Test', 'Statistic', 'df', 'p']} rows={[
          ...(r.welch ? [[c('Welch’s ANOVA (F)'), c(r.welch.stat), c(df(r.welch)), pCell(r.welch.p)] as Row] : []),
          ...(r.kruskal ? [[c('Kruskal–Wallis (χ²)'), c(r.kruskal.stat), c(df(r.kruskal)), pCell(r.kruskal.p)] as Row] : []),
        ]} note="Welch’s ANOVA does not assume equal variances; Kruskal–Wallis compares the groups’ ranks." />
      )}
      {r.tukey && <Table title="Post hoc comparisons (Tukey HSD)" file="anova-tukey" columns={['Comparison', 'Difference', `${pct(conf)} CI`, 'p (adjusted)']}
        rows={r.tukey.map((t): Row => [c(t.comparison), c(t.diff), c(ci(t.ciLow, t.ciHigh)), pCell(t.p)])} />}
      {r.pairwiseRank && r.pairwiseRank.length > 0 && <Table title="Post hoc after Kruskal–Wallis (pairwise Wilcoxon rank-sum tests)" file="anova-pairwise-rank" columns={['Comparison', 'p (Holm)']}
        rows={r.pairwiseRank.map((t): Row => [c(t.comparison), pCell(t.pHolm)])} note="Normal approximation; p-values adjusted for the number of comparisons by Holm’s method." />}
      <Table title="Descriptives by cell" file="anova-cells" columns={['Cell', 'N', 'Mean', 'SD', 'SE']} rows={r.cells.map((x): Row => [c(x.cell), c(x.n, undefined, 0), c(x.mean), c(x.sd ?? null), c(x.se ?? null)])} />
      <Table title="Assumption checks" file="anova-assumptions" columns={['Test', 'Statistic', 'p']} rows={[
        [c(`Levene F(${r.levene.df1}, ${r.levene.df2}), median-centred`), c(r.levene.stat), pCell(r.levene.p)],
        ...(r.shapiro ? [[c('Shapiro–Wilk W (residuals)'), c(r.shapiro.stat), pCell(r.shapiro.p)] as Row] : []),
      ]} />
    </div>
  );
}

const anovaCols = (o: AnovaOptions) => [o.dependent, ...o.factors, ...o.covariates].filter(Boolean);
export const anovaAnalysis: AnalysisType<AnovaOptions, AnovaResult & { confidence?: number }> = {
  id: 'anova', title: 'ANOVA', sub: 'between-subjects factors, ANCOVA with covariates; type III or I', group: 'Basic statistics',
  entries: [
    { title: 'ANOVA', sub: 'one or more between-subjects factors; post hoc, Welch, Kruskal–Wallis', options: (o) => o },
    { title: 'ANCOVA', sub: 'factors and covariates', options: (o) => o },
  ],
  cardTitle: (o) => `${o.covariates.length ? 'ANCOVA' : 'ANOVA'}${o.dependent ? `: ${o.dependent}` : ''}`,
  defaults: () => ({ dependent: '', factors: [], covariates: [], ssType: 'III', interactions: true }),
  parseOptions: (raw) => (isObj(raw) ? { dependent: name(raw.dependent), factors: names(raw.factors), covariates: names(raw.covariates), ssType: oneOf(raw.ssType, ['III', 'I'] as const, 'III'), interactions: raw.interactions !== false } : null),
  Options: AnovaForm,
  View: ({ result }) => <AnovaView r={result} conf={result.confidence ?? 0.95} />,
  blocked: (o, ctx) => {
    if (!o.dependent) return 'Choose the dependent variable.';
    if (!o.factors.length) return 'Choose at least one factor.';
    if (o.factors.includes(o.dependent) || o.covariates.includes(o.dependent)) return 'The dependent variable cannot also be a factor or covariate.';
    return missingColumns(ctx, anovaCols(o), 'ANOVA');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, anovaCols(o), [o.ssType, String(o.interactions), ...o.factors, '|', ...o.covariates, ctx.settings.confidence]),
  run: async (o, ctx) => ({ ...(await (await engine()).anovaR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence })), confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).anovaScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${o.dependent || '…'} by ${o.factors.join(' × ') || '…'}${o.covariates.length ? ` + ${o.covariates.join(', ')}` : ''} · type ${o.ssType}`,
};

// ---------------------------------------------------------------- repeated measures

export type RmAnovaOptions = RmAnovaInput;

function RmForm({ options: o, set, ctx, disabled }: OptionsProps<RmAnovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field"><label htmlFor="rm-name">Within-subject factor name</label>
        <input id="rm-name" className="input" value={o.factorName} maxLength={31} onChange={(e) => set({ ...o, factorName: e.target.value })} /></div>
      <OrderedPicker label="Levels: one column per condition (wide data)" columns={numeric.filter((n) => n !== o.between)} value={o.levels} onChange={(levels) => set({ ...o, levels })} />
      <ColumnSelect id="rm-b" label="Between-subjects factor (optional)" optional="None" value={o.between} columns={d.names} exclude={o.levels} onChange={(between) => set({ ...o, between })} />
      <div className="hint">Each row is one subject measured under every condition. Rows with a missing value are left out.</div>
    </fieldset>
  );
}

function RmView({ r }: { r: RmAnovaResult }) {
  const row = (x: RmAnovaResult['within'][number]): Row => [c(x.term), c(x.ss), c(x.df, undefined, 0), c(x.ms), c(x.f ?? null), x.p === undefined || x.p === null ? c(null) : pCell(x.p), c(x.partialEta2 ?? null)];
  const cols = ['Term', 'Sum of squares', 'df', 'Mean square', 'F', 'p', 'Partial η²'];
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.levels.length} levels of {r.factorName}, {r.n} subjects; base R ({r.engine.package} {r.engine.version}).</p>
      <Table title="Within-subjects effects" file="rmanova-within" columns={cols} rows={r.within.map(row)} />
      {r.betweenTable.length > 0 && <Table title="Between-subjects effects" file="rmanova-between" columns={cols} rows={r.betweenTable.map(row)} />}
      <Table title="Sphericity" file="rmanova-sphericity" columns={['Statistic', 'Value']} rows={[
        [c('Mauchly’s W'), c(r.sphericity.w)], [c('p'), pCell(r.sphericity.p)], [c('Greenhouse–Geisser ε'), c(r.sphericity.gg)], [c('Huynh–Feldt ε'), c(r.sphericity.hf)],
      ]} note="A small p of Mauchly’s test speaks against sphericity: then read the corrected p-values below (Greenhouse–Geisser is the more conservative)." />
      <Table title="Sphericity-corrected p-values" file="rmanova-corrected" columns={['Term', 'p (uncorrected)', 'p (Greenhouse–Geisser)', 'p (Huynh–Feldt)']}
        rows={r.corrected.map((x): Row => [c(x.term), pCell(x.p), pCell(x.pGG), pCell(x.pHF)])} />
      {r.posthoc && r.posthoc.length > 0 && <Table title="Post hoc comparisons (paired t-tests)" file="rmanova-posthoc" columns={['Comparison', 'Mean difference', 't', 'df', 'p', 'p (Holm)']}
        rows={r.posthoc.map((x): Row => [c(x.comparison), c(x.diff), c(x.t), c(x.df, undefined, 0), pCell(x.p), pCell(x.pHolm)])} note="Every pair of levels, over all subjects; Holm’s adjustment for the number of comparisons." />}
      {r.friedman && <Table title="Friedman’s rank test" file="rmanova-friedman" columns={['χ²', 'df', 'p']} rows={[[c(r.friedman.stat), c(df(r.friedman)), pCell(r.friedman.p)]]} />}
      <Table title="Descriptives" file="rmanova-cells" columns={['Level', 'N', 'Mean', 'SD', 'SE']} rows={r.cells.map((x): Row => [c(x.cell), c(x.n, undefined, 0), c(x.mean), c(x.sd ?? null), c(x.se ?? null)])} />
    </div>
  );
}

const rmCols = (o: RmAnovaOptions) => [...o.levels, o.between].filter(Boolean);
export const rmAnovaAnalysis: AnalysisType<RmAnovaOptions, RmAnovaResult> = {
  id: 'rmanova', title: 'Repeated-measures ANOVA', sub: 'one within-subject factor (wide columns), optional between factor; sphericity corrections, Friedman', group: 'Basic statistics',
  cardTitle: (o) => `Repeated-measures ANOVA: ${o.factorName || '…'}`,
  defaults: () => ({ levels: [], factorName: 'condition', between: '' }),
  parseOptions: (raw) => (isObj(raw) ? { levels: names(raw.levels), factorName: name(raw.factorName, 31) || 'condition', between: name(raw.between) } : null),
  Options: RmForm,
  View: ({ result }) => <RmView r={result} />,
  blocked: (o, ctx) => {
    if (o.levels.length < 2) return 'Choose at least two columns, one per level.';
    if (!/^[A-Za-z][A-Za-z0-9_.]{0,30}$/.test(o.factorName)) return 'The factor name must start with a letter and use letters, digits, _ or . only.';
    if (o.levels.includes(o.between)) return 'The between factor cannot be one of the levels.';
    return missingColumns(ctx, rmCols(o), 'Repeated-measures ANOVA');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, rmCols(o), [o.factorName, o.between]),
  run: async (o, ctx) => (await engine()).rmAnovaR(rawData(ctx)!, o),
  script: async (o, ctx) => (await engine()).rmAnovaScriptR(rawData(ctx)!, o),
  summary: (o) => `${o.factorName}: ${o.levels.join(', ') || '…'}${o.between ? ` · between ${o.between}` : ''}`,
};

// ---------------------------------------------------------------- MANOVA

export type ManovaOptions = ManovaInput;

function ManovaForm({ options: o, set, ctx, disabled }: OptionsProps<ManovaOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Dependent variables (two or more)" columns={numeric.filter((n) => !o.factors.includes(n))} value={o.dependents} onChange={(dependents) => set({ ...o, dependents })} />
      <OrderedPicker label="Fixed factors" columns={d.names.filter((n) => !o.dependents.includes(n))} value={o.factors} onChange={(factors) => set({ ...o, factors })} />
      <Choice label="Model terms" value={o.interactions ? 'full' : 'main'} onChange={(v) => set({ ...o, interactions: v === 'full' })} options={[['full', 'Full factorial'], ['main', 'Main effects only']]} />
    </fieldset>
  );
}

const manovaCols = (o: ManovaOptions) => [...o.dependents, ...o.factors];
export const manovaAnalysis: AnalysisType<ManovaOptions, ManovaResult> = {
  id: 'manova', title: 'MANOVA', sub: 'several dependent variables; Pillai, Wilks, Hotelling–Lawley, Roy', group: 'Basic statistics',
  cardTitle: () => 'MANOVA',
  defaults: () => ({ dependents: [], factors: [], interactions: true }),
  parseOptions: (raw) => (isObj(raw) ? { dependents: names(raw.dependents), factors: names(raw.factors), interactions: raw.interactions !== false } : null),
  Options: ManovaForm,
  View: ({ result: r }) => (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.dependents.join(', ')} by {r.factors.join(', ')}, n = {r.n}; base R ({r.engine.package} {r.engine.version}).</p>
      <Table title="Multivariate tests" file="manova" columns={['Term', 'Test', 'Value', 'Approx. F', 'df1', 'df2', 'p']}
        rows={r.tests.flatMap((t) => t.rows.map((x): Row => [c(x.term), c(t.test), c(x.value), c(x.f), c(x.df1, undefined, 0), c(x.df2, undefined, 0), pCell(x.p)]))}
        note="Pillai’s trace is the most robust to unequal covariance matrices; Roy’s largest root gives an upper bound for F." />
    </div>
  ),
  blocked: (o, ctx) => {
    if (o.dependents.length < 2) return 'Choose at least two dependent variables.';
    if (!o.factors.length) return 'Choose at least one factor.';
    return missingColumns(ctx, manovaCols(o), 'MANOVA');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, manovaCols(o), [String(o.interactions), ...o.factors]),
  run: async (o, ctx) => (await engine()).manovaR(rawData(ctx)!, o),
  script: async (o, ctx) => (await engine()).manovaScriptR(rawData(ctx)!, o),
  summary: (o) => `${o.dependents.join(', ') || '…'} by ${o.factors.join(' × ') || '…'}`,
};

// ---------------------------------------------------------------- correlation

export type CorrelationOptions = Omit<CorrelationInput, 'confidence'>;
const METHOD_NAME = { pearson: 'Pearson', spearman: 'Spearman', kendall: 'Kendall', polychoric: 'Polychoric' } as const;

function CorrelationForm({ options: o, set, ctx, disabled }: OptionsProps<CorrelationOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Variables" columns={d.names.filter((n) => !d.categories?.[n])} value={o.vars} onChange={(vars) => set({ ...o, vars })} />
      <Choice label="Coefficient" value={o.method} onChange={(method) => set({ ...o, method })} options={[['pearson', 'Pearson’s r'], ['spearman', 'Spearman’s ρ'], ['kendall', 'Kendall’s τ-b'], ['polychoric', 'Polychoric']]} />
      <div className="row2">
        <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={ALTS} />
        <Choice label="Missing values" value={o.deletion} onChange={(deletion) => set({ ...o, deletion })} options={[['pairwise', 'Pairwise'], ['listwise', 'Listwise']]} />
      </div>
      <div className="hint">{o.method === 'polychoric'
        ? 'For ordinal (Likert) variables: the correlation of the continuous responses assumed to underlie the categories (lavaan’s lavCor, as CB-SEM with ordinal indicators). Variables with integer values and at most 8 categories are ordinal: polychoric between two of them (tetrachoric when both are binary), polyserial with a continuous variable, Pearson between continuous ones. Standard errors, z tests and Wald intervals; each ordinal pair is also tested for the bivariate normal model the polychoric correlation assumes.'
        : 'Each pair is tested with cor.test; Spearman and Kendall use the normal approximation (exact = FALSE), as with ties. A confidence interval is given for Pearson’s r (Fisher’s z).'}</div>
    </fieldset>
  );
}

function CorrelationView({ r }: { r: CorrelationResult }) {
  const sym = r.method === 'pearson' || r.method === 'polychoric' ? 'r' : r.method === 'spearman' ? 'ρ' : 'τ';
  const poly = r.method === 'polychoric';
  const withCi = r.method === 'pearson' || poly;
  const at = (a: string, b: string) => r.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const matrix: Row[] = r.vars.map((a, i) => [c(a), ...r.vars.map((b, j) => (j === i ? c('—') : j > i ? c(null) : (() => { const p = at(a, b)!; return { v: `${fmt(p.r)}${p.p < 0.001 ? '***' : p.p < 0.01 ? '**' : p.p < 0.05 ? '*' : ''}` }; })()))]);
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table title={`${METHOD_NAME[r.method]} correlations`} file="correlation-matrix" columns={['', ...r.vars]} rows={matrix} note="* p < .05, ** p < .01, *** p < .001." />
      <Table title="Every pair" file="correlation-pairs" columns={['Pair', ...(poly ? ['Type'] : []), sym, ...(poly ? ['SE'] : []), 'N', 'p', ...(withCi ? [`${pct(r.confidence)} CI`] : [])]}
        rows={r.pairs.map((p): Row => [c(`${p.a} – ${p.b}`), ...(poly ? [c(p.kind ?? '', 'dim')] : []), c(p.r), ...(poly ? [c(p.se ?? null)] : []), c(p.n, undefined, 0), pCell(p.p), ...(withCi ? [c(ci(p.ciLow, p.ciHigh))] : [])])}
        note={`${r.deletion === 'pairwise' ? 'Pairwise' : 'Listwise'} deletion of missing values${r.alternative !== 'two.sided' ? `; one-sided (${r.alternative})` : ''}.${poly ? ` Ordinal (integer values, at most 8 categories): ${r.ordinal?.join(', ') || 'none'}; the others are treated as continuous. z tests and Wald intervals from lavaan’s standard errors.` : ''}`} />
      {poly && !!r.normality?.length && (() => {
        const bonferroni = 0.05 / r.normality.length;
        const flag = (p: number) => (p < bonferroni ? 'bad' : p < 0.05 ? 'warn' : '');
        return (
          <Table title="Bivariate normality of the ordinal pairs" file="correlation-normality" columns={['Pair', 'Pearson X²', 'p', 'LR G²', 'p', 'df']}
            rows={r.normality.map((t): Row => [c(`${t.a} – ${t.b}`), c(t.x2), c(t.x2p, flag(t.x2p), 3), c(t.g2), c(t.g2p, flag(t.g2p), 3), c(t.df, undefined, 0)])}
            note={`A polychoric correlation assumes that the two variables’ categories cut a bivariate normal distribution. Each test compares the observed two-way table with the one that model implies (lavaan::lavTables). A rejection (amber below .05, red below the Bonferroni level for ${r.normality.length} pairs) means the correlation summarises the table less well: skewed, floor or ceiling answers, a non-linear relation, or a subgroup answering differently. In large samples the tests reject easily; compare the pairs with each other.`} />
        );
      })()}
    </div>
  );
}

export const correlationAnalysis: AnalysisType<CorrelationOptions, CorrelationResult> = {
  id: 'correlation', title: 'Correlation', sub: 'Pearson, Spearman, Kendall, polychoric with tests and intervals', group: 'Basic statistics',
  cardTitle: (o) => `${METHOD_NAME[o.method]} correlations`,
  defaults: () => ({ vars: [], method: 'pearson', alternative: 'two.sided', deletion: 'pairwise' }),
  parseOptions: (raw) => (isObj(raw) ? { vars: names(raw.vars), method: oneOf(raw.method, ['pearson', 'spearman', 'kendall', 'polychoric'] as const, 'pearson'), alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'), deletion: oneOf(raw.deletion, ['pairwise', 'listwise'] as const, 'pairwise') } : null),
  Options: CorrelationForm,
  View: ({ result }) => <CorrelationView r={result} />,
  blocked: (o, ctx) => (o.vars.length < 2 ? 'Choose at least two variables.' : missingColumns(ctx, o.vars, 'Correlation')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars, [o.method, o.alternative, o.deletion, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).correlationR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).correlationScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${METHOD_NAME[o.method]} · ${o.vars.join(', ') || '…'}`,
};

// ---------------------------------------------------------------- contingency tables

export type ContingencyOptions = Omit<ContingencyInput, 'confidence'>;

function ContingencyForm({ options: o, set, ctx, disabled }: OptionsProps<ContingencyOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="row2">
        <ColumnSelect id="ct-r" label="Rows" value={o.rows} columns={d.names} exclude={[o.columns, o.counts]} onChange={(rows) => set({ ...o, rows })} />
        <ColumnSelect id="ct-c" label="Columns" value={o.columns} columns={d.names} exclude={[o.rows, o.counts]} onChange={(columns) => set({ ...o, columns })} />
      </div>
      <ColumnSelect id="ct-w" label="Counts (optional: one row per cell with its frequency)" optional="None: one row per case" value={o.counts} columns={d.names.filter((n) => !d.categories?.[n])} exclude={[o.rows, o.columns]} onChange={(counts) => set({ ...o, counts })} />
    </fieldset>
  );
}

function ContingencyView({ r }: { r: ContingencyResult }) {
  const pctRow = (i: number, j: number) => { const s = r.counts[i].reduce((a, b) => a + b, 0); return s ? `${fmt((100 * r.counts[i][j]) / s, 1)}%` : ''; };
  const rows: Row[] = [...r.rowLevels.map((l, i): Row => [c(l), ...r.colLevels.map((_, j): { v: string } => ({ v: `${r.counts[i][j]} (${fmt(r.expected[i][j], 1)}; ${pctRow(i, j)})` })), c(r.counts[i].reduce((a, b) => a + b, 0), undefined, 0)]),
    [c('Total'), ...r.colLevels.map((_, j) => c(r.counts.reduce((a, row) => a + row[j], 0), undefined, 0)), c(r.n, undefined, 0)]];
  const small = r.expected.flat().filter((e) => e < 5).length;
  return (
    <div className="tables">
      <Engine e={r.engine} />
      <Table title={`${r.rows} × ${r.columns}`} file="contingency-table" columns={[`${r.rows} \\ ${r.columns}`, ...r.colLevels, 'Total']} rows={rows} note="Each cell: count (expected count; row percentage)." />
      <Table title="Tests of independence" file="contingency-tests" columns={['Test', 'Value', 'df', 'p']} rows={[
        [c('Pearson χ²'), c(r.chisq.stat), c(df(r.chisq)), pCell(r.chisq.p)],
        ...(r.yates ? [[c('χ² with continuity correction'), c(r.yates.stat), c(df(r.yates)), pCell(r.yates.p)] as Row] : []),
        [c('Likelihood ratio G²'), c(r.likelihoodRatio.stat), c(r.likelihoodRatio.df, undefined, 0), pCell(r.likelihoodRatio.p)],
        ...(r.fisher ? [[c('Fisher’s exact test'), c(null), c(''), pCell(r.fisher.p)] as Row] : []),
      ]} note={small ? `${small} cell${small === 1 ? ' has' : 's have'} an expected count below 5: prefer Fisher’s exact test.` : undefined} />
      <Table title="Association" file="contingency-association" columns={['Measure', 'Value', `${pct(r.confidence)} CI`]} rows={[
        [c('Cramér’s V'), c(r.cramerV), c(null)],
        ...(r.phi !== null ? [[c('φ'), c(r.phi), c(null)] as Row] : []),
        ...(r.oddsRatio ? [[c('Odds ratio (sample)'), c(r.oddsRatio.est), c(ci(r.oddsRatio.ciLow, r.oddsRatio.ciHigh))] as Row] : []),
        ...(r.fisher?.estimate !== undefined && r.fisher?.estimate !== null ? [[c('Odds ratio (conditional ML, Fisher)'), c(r.fisher.estimate), c(ci(r.fisher.ciLow, r.fisher.ciHigh))] as Row] : []),
      ]} />
    </div>
  );
}

const ctCols = (o: ContingencyOptions) => [o.rows, o.columns, o.counts].filter(Boolean);
export const contingencyAnalysis: AnalysisType<ContingencyOptions, ContingencyResult> = {
  id: 'contingency', title: 'Contingency table', sub: 'χ², likelihood ratio, Fisher’s exact test, Cramér’s V, odds ratio', group: 'Basic statistics',
  cardTitle: (o) => `Contingency table${o.rows && o.columns ? `: ${o.rows} × ${o.columns}` : ''}`,
  defaults: () => ({ rows: '', columns: '', counts: '' }),
  parseOptions: (raw) => (isObj(raw) ? { rows: name(raw.rows), columns: name(raw.columns), counts: name(raw.counts) } : null),
  Options: ContingencyForm,
  View: ({ result }) => <ContingencyView r={result} />,
  blocked: (o, ctx) => (!o.rows || !o.columns ? 'Choose the row and the column variables.' : o.rows === o.columns ? 'Choose two different variables.' : missingColumns(ctx, ctCols(o), 'Contingency table')),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, ctCols(o), [o.rows, o.columns, o.counts, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).contingencyR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).contingencyScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${o.rows || '…'} × ${o.columns || '…'}${o.counts ? ` (counts ${o.counts})` : ''}`,
};

// ---------------------------------------------------------------- binomial and multinomial

export type FreqTestOptions = Omit<FreqTestInput, 'confidence'>;

function FreqForm({ options: o, set, ctx, disabled }: OptionsProps<FreqTestOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Test" value={o.type} onChange={(type) => set({ ...o, type })} options={[['binomial', 'Binomial test'], ['multinomial', 'Multinomial (goodness of fit)']]} />
      <ColumnSelect id="fq-x" label="Variable" value={o.variable} columns={d.names} onChange={(variable) => set({ ...o, variable })} />
      {o.type === 'binomial' ? (
        <>
          <div className="field"><label htmlFor="fq-p">Test proportion</label>
            <input id="fq-p" className="input num" type="number" min={0.001} max={0.999} step={0.01} value={o.testValue} onChange={(e) => { const v = Number(e.target.value); set({ ...o, testValue: Number.isFinite(v) ? v : 0.5 }); }} /></div>
          <Choice label="Alternative hypothesis" value={o.alternative} onChange={(alternative) => set({ ...o, alternative })} options={ALTS} />
        </>
      ) : (
        <div className="field"><label htmlFor="fq-props">Expected proportions (optional)</label>
          <input id="fq-props" className="input" placeholder="Equal: leave empty; else e.g. 1, 1, 2" value={o.proportions.join(', ')}
            onChange={(e) => set({ ...o, proportions: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x)) })} />
          <div className="hint">One positive number per category, in the order of the categories; they are rescaled to sum to 1.</div></div>
      )}
    </fieldset>
  );
}

function FreqView({ r }: { r: FreqTestResult }) {
  return (
    <div className="tables">
      <Engine e={r.engine} />
      {r.binomial ? (
        <Table title={`Binomial test: ${r.variable} (test proportion ${fmt(r.testValue ?? 0.5)})`} file="binomial" columns={['Category', 'Count', 'Total', 'Proportion', 'p', `${pct(r.confidence)} CI`]}
          rows={r.levels.map((l, i): Row => [c(l), c(r.counts[i], undefined, 0), c(r.n, undefined, 0), c(r.binomial![i].proportion), pCell(r.binomial![i].p), c(ci(r.binomial![i].ciLow, r.binomial![i].ciHigh))])}
          note={`Each category against the rest (exact test; Clopper–Pearson interval)${r.alternative !== 'two.sided' ? `, one-sided (${r.alternative})` : ''}.`} />
      ) : r.multinomial ? (
        <>
          <Table title={`Multinomial test: ${r.variable}`} file="multinomial-counts" columns={['Category', 'Observed', 'Expected']} rows={r.levels.map((l, i): Row => [c(l), c(r.counts[i], undefined, 0), c(r.multinomial!.expected[i])])} />
          <Table title="Goodness of fit" file="multinomial-test" columns={['χ²', 'df', 'p']} rows={[[c(r.multinomial.stat), c(df(r.multinomial)), pCell(r.multinomial.p)]]} />
        </>
      ) : null}
    </div>
  );
}

export const freqTestAnalysis: AnalysisType<FreqTestOptions, FreqTestResult> = {
  id: 'freqtest', title: 'Binomial and multinomial tests', sub: 'a proportion against a value; counts against expected proportions', group: 'Basic statistics',
  entries: [
    { title: 'Binomial test', sub: 'each category’s proportion against a value (exact)', options: (o) => ({ ...o, type: 'binomial' }) },
    { title: 'Multinomial test', sub: 'counts against equal or given proportions (χ²)', options: (o) => ({ ...o, type: 'multinomial' }) },
  ],
  cardTitle: (o) => `${o.type === 'binomial' ? 'Binomial' : 'Multinomial'} test${o.variable ? `: ${o.variable}` : ''}`,
  defaults: () => ({ type: 'binomial', variable: '', testValue: 0.5, proportions: [], alternative: 'two.sided' }),
  parseOptions: (raw) => (isObj(raw) ? {
    type: oneOf(raw.type, ['binomial', 'multinomial'] as const, 'binomial'), variable: name(raw.variable),
    testValue: typeof raw.testValue === 'number' && raw.testValue > 0 && raw.testValue < 1 ? raw.testValue : 0.5,
    proportions: (Array.isArray(raw.proportions) ? raw.proportions.slice(0, 200) : []).filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0),
    alternative: oneOf(raw.alternative, ALT_IDS, 'two.sided'),
  } : null),
  Options: FreqForm,
  View: ({ result }) => <FreqView r={result} />,
  blocked: (o, ctx) => {
    if (!o.variable) return 'Choose the variable.';
    if (o.type === 'binomial' && !(o.testValue > 0 && o.testValue < 1)) return 'The test proportion must be between 0 and 1.';
    if (o.type === 'multinomial' && o.proportions.some((x) => !(x > 0))) return 'Expected proportions must be positive.';
    return missingColumns(ctx, [o.variable], 'Frequency test');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.variable], [o.type, o.testValue, o.alternative, o.proportions.join(','), ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).freqTestR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).freqTestScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${o.type} · ${o.variable || '…'}${o.type === 'binomial' ? ` vs ${o.testValue}` : ''}`,
};

// ---------------------------------------------------------------- reliability and agreement

export type ReliabilityOptions = Omit<ReliabilityInput, 'confidence'>;
const REL_NAME = { scale: 'Scale reliability', icc: 'Intraclass correlation', kappa: 'Cohen’s kappa', blandaltman: 'Bland–Altman agreement' } as const;
const REL_HINT = {
  scale: 'The items of one scale, scored in the same direction (reverse-code items first, in the data panel).',
  icc: 'One column per rater (or occasion), one row per subject rated.',
  kappa: 'Two raters’ category codes for the same subjects.',
  blandaltman: 'Two methods measuring the same quantity on the same subjects.',
} as const;

function ReliabilityForm({ options: o, set, ctx, disabled }: OptionsProps<ReliabilityOptions>) {
  const d = rawData(ctx);
  if (!d) return <NoData />;
  const pair = o.type === 'kappa' || o.type === 'blandaltman';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Analysis" value={o.type} onChange={(type) => set({ ...o, type, vars: type === 'kappa' || type === 'blandaltman' ? o.vars.slice(0, 2) : o.vars })}
        options={[['scale', 'Scale'], ['icc', 'ICC'], ['kappa', 'Kappa'], ['blandaltman', 'Bland–Altman']]} hint={REL_HINT[o.type]} />
      <OrderedPicker label={pair ? 'Two variables' : 'Variables'} columns={o.type === 'kappa' ? d.names : d.names.filter((n) => !d.categories?.[n])} value={o.vars}
        onChange={(vars) => set({ ...o, vars: pair ? vars.slice(-2) : vars })} />
    </fieldset>
  );
}

function BlandAltman({ r }: { r: ReliabilityResult }) {
  const pts = r.points!;
  const W = 520, H = 300, pad = { l: 56, r: 16, t: 14, b: 44 };
  const lo = (a: number[]) => a.reduce((m, v) => Math.min(m, v), Infinity), hi = (a: number[]) => a.reduce((m, v) => Math.max(m, v), -Infinity);
  const x0 = lo(pts.mean), x1 = hi(pts.mean);
  const ys = [Math.min(lo(pts.diff), r.lower!), Math.max(hi(pts.diff), r.upper!)];
  const m = (ys[1] - ys[0] || 1) * 0.08;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] + m - v) / (ys[1] - ys[0] + 2 * m)) * (H - pad.t - pad.b);
  const ticks = (a: number, b: number) => Array.from({ length: 6 }, (_, i) => a + ((b - a) * i) / 5);
  return (
    <ChartFrame id="blandaltman" name="bland-altman" width={W} height={H} defaults={{ x: `Mean of ${r.vars[0]} and ${r.vars[1]}`, y: `${r.vars[0]} − ${r.vars[1]}` }}
      caption={<span className="hint">Each subject’s difference against its mean. Solid line: the mean difference (bias); dashed: the limits of agreement, bias ± 1.96 SD.</span>}>
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="Bland–Altman plot">
          {ticks(ys[0] - m, ys[1] + m).map((v) => <g key={v}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} /><text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v, 2)}</text></g>)}
          {ticks(x0, x1).map((v) => <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">{fmt(v, 2)}</text>)}
          {pts.mean.map((x, i) => <circle key={i} className="dot" cx={sx(x)} cy={sy(pts.diff[i])} r={2.5} />)}
          <line className="fit-line" x1={pad.l} x2={W - pad.r} y1={sy(r.bias!)} y2={sy(r.bias!)} />
          {[r.lower!, r.upper!].map((v) => <line key={v} className="fit-line" strokeDasharray="5 4" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />)}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

const ICC_NAME: Record<string, string> = {
  ICC1: 'ICC(1): single rater, one-way random', ICC2: 'ICC(2,1): single rater, absolute agreement (two-way random)', ICC3: 'ICC(3,1): single rater, consistency (two-way mixed)',
  ICC1k: 'ICC(1,k): mean of k raters, one-way random', ICC2k: 'ICC(2,k): mean of k raters, absolute agreement', ICC3k: 'ICC(3,k): mean of k raters, consistency',
};

function ReliabilityView({ r }: { r: ReliabilityResult }) {
  const conf = pct(r.confidence);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>n = {r.n} complete cases; {r.engine.package} {r.engine.version}.</p>
      {r.type === 'scale' && <>
        <Table title="Scale reliability" file="reliability-scale" columns={['Coefficient', 'Value']} rows={[
          [c('Cronbach’s α'), c(r.alpha ?? null)], [c('Standardised α'), c(r.stdAlpha ?? null)], [c('McDonald’s ω total (one factor)'), c(r.omegaTotal ?? null)],
          [c('Greatest lower bound (glb)'), c(r.glb ?? null)], [c('Average inter-item correlation'), c(r.averageR ?? null)],
        ]} note="α assumes equal loadings (tau-equivalence); ω total uses a one-factor model’s loadings; the glb is the largest reliability consistent with the inter-item correlations (psych’s factor-analytic estimate, glb.fa). psych::alpha, omega and glb.fa." />
        <Table title="Items" file="reliability-items" columns={['Item', 'Mean', 'SD', 'Item–rest correlation', 'α if dropped']}
          rows={(r.items ?? []).map((x): Row => [c(x.item), c(x.mean), c(x.sd), c(x.itemRest), c(x.alphaIfDropped)])} note="A negative item–rest correlation usually means the item needs reverse coding." />
      </>}
      {r.type === 'icc' && <Table title="Intraclass correlations (Shrout & Fleiss)" file="reliability-icc" columns={['Type', 'ICC', 'F', 'df1', 'df2', 'p', `${conf} CI`]}
        rows={(r.icc ?? []).map((x): Row => [c(ICC_NAME[x.type] ?? x.type), c(x.icc), c(x.f), c(x.df1, undefined, 0), c(x.df2, undefined, 0), pCell(x.p), c(ci(x.ciLow, x.ciHigh))])}
        note="Absolute agreement counts systematic differences between raters against agreement; consistency ignores them. Use the k-rater forms when the mean of the raters is what is used." />}
      {r.type === 'kappa' && <Table title={`Cohen’s kappa: ${r.vars.join(' and ')}`} file="reliability-kappa" columns={['Coefficient', 'Estimate', `${conf} CI`]} rows={[
        [c('Unweighted κ'), c(r.kappa!.est), c(ci(r.kappa!.ciLow, r.kappa!.ciHigh))],
        [c('Weighted κ (squared distances)'), c(r.weighted!.est), c(ci(r.weighted!.ciLow, r.weighted!.ciHigh))],
      ]} note="Weighted κ treats the categories as ordered: a near miss counts as partial agreement. Interval limits beyond ±1 are set to ±1 (psych::cohen.kappa)." />}
      {r.type === 'blandaltman' && <>
        <Table title={`Bland–Altman: ${r.vars[0]} − ${r.vars[1]}`} file="reliability-blandaltman" columns={['Statistic', 'Value', `${conf} CI`]} rows={[
          [c('Mean difference (bias)'), c(r.bias!), c(ci(r.biasCiLow, r.biasCiHigh))], [c('SD of the differences'), c(r.sd ?? null), c(null)],
          [c('Lower limit of agreement'), c(r.lower!), c(null)], [c('Upper limit of agreement'), c(r.upper!), c(null)],
        ]} />
        {r.points && <BlandAltman r={r} />}
      </>}
    </div>
  );
}

export const reliabilityAnalysis: AnalysisType<ReliabilityOptions, ReliabilityResult> = {
  id: 'reliability', title: 'Reliability and agreement', sub: 'α, ω, glb; ICC; Cohen’s kappa; Bland–Altman (psych)', group: 'Basic statistics',
  entries: [
    { title: 'Scale reliability', sub: 'Cronbach’s α, McDonald’s ω, greatest lower bound, item statistics', options: (o) => ({ ...o, type: 'scale' }) },
    { title: 'Intraclass correlation', sub: 'agreement of raters on a continuous rating (Shrout & Fleiss)', options: (o) => ({ ...o, type: 'icc' }) },
    { title: 'Cohen’s kappa', sub: 'agreement of two raters on categories', options: (o) => ({ ...o, type: 'kappa' }) },
    { title: 'Bland–Altman', sub: 'agreement of two measurement methods', options: (o) => ({ ...o, type: 'blandaltman' }) },
  ],
  cardTitle: (o) => REL_NAME[o.type],
  defaults: () => ({ type: 'scale', vars: [] }),
  parseOptions: (raw) => (isObj(raw) ? { type: oneOf(raw.type, ['scale', 'icc', 'kappa', 'blandaltman'] as const, 'scale'), vars: names(raw.vars) } : null),
  Options: ReliabilityForm,
  View: ({ result }) => <ReliabilityView r={result} />,
  blocked: (o, ctx) => {
    if ((o.type === 'kappa' || o.type === 'blandaltman') && o.vars.length !== 2) return 'Choose exactly two variables.';
    if (o.vars.length < 2) return 'Choose at least two variables.';
    return missingColumns(ctx, o.vars, REL_NAME[o.type]);
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars, [o.type, ctx.settings.confidence]),
  run: async (o, ctx) => (await engine()).reliabilityR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  script: async (o, ctx) => (await engine()).reliabilityScriptR(rawData(ctx)!, { ...o, confidence: ctx.settings.confidence }),
  summary: (o) => `${REL_NAME[o.type].toLowerCase()} · ${o.vars.join(', ') || '…'}`,
};

export const BASIC_TEST_TYPES = [ttestAnalysis, anovaAnalysis, rmAnovaAnalysis, manovaAnalysis, correlationAnalysis, contingencyAnalysis, freqTestAnalysis, reliabilityAnalysis];
