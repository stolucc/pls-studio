// Measurement invariance cards (R/invariance.R): alignment optimisation for many
// groups (sirt, Asparouhov & Muthén 2014) on the diagram's factors, and moderated
// nonlinear factor analysis of binary items (mnlfa; Curran et al. 2014), and
// longitudinal invariance of a factor measured at several occasions (semTools), and
// uniform DIF by MIMIC (lavaan).

import { OrderedPicker } from '../components/OrderedPicker';
import { InvarianceTable } from '../components/results/InvarianceTable';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP } from '../format';
import { detectOccasions, type AlignedFactor, type AlignmentInput, type AlignmentResult, type InvFactor, type LongInvarianceInput, type LongInvarianceResult, type MimicDifInput, type MimicDifResult, type MimicEffect, type MnlfaInput, type MnlfaResult } from '../rengine/invariance';
import { clampNum, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, NumField, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/invariance');
const LAVAAN_MISSING = ['fiml', 'pairwise', 'twostage', 'robusttwostage'] as const;
const MISSING_NOTE: Record<string, string> = { fiml: 'FIML', pairwise: 'pairwise deletion', twostage: 'two-stage', robusttwostage: 'robust two-stage', casewise: 'casewise deletion' };
/** lavaan settings from the project: ML or MLR; FIML (and the other lavaan treatments) or casewise deletion (mean replacement and imputation do not apply). */
export function invLavaan(ctx: Pick<AnalysisCtx, 'settings'>): { estimator: 'ML' | 'MLR'; missing: AlignmentInput['missing'] } {
  const missing = (LAVAAN_MISSING as readonly string[]).includes(ctx.settings.missing) ? ctx.settings.missing : 'casewise';
  return { estimator: ctx.settings.estimator === 'MLR' ? 'MLR' : 'ML', missing };
}
const lavaanHint = (ctx: AnalysisCtx) => { const l = invLavaan(ctx); return `lavaan ${l.estimator}, ${MISSING_NOTE[l.missing] ?? l.missing} (from the Model settings).`; };

/** The diagram's factors a card can use: two or more indicators in the data, not higher-order. */
export function modelFactors(ctx: AnalysisCtx): InvFactor[] {
  const ds = rawData(ctx);
  return (ctx.model?.constructs ?? []).filter((k) => !k.components?.length && k.indicators.length >= 2 && (!ds || k.indicators.every((i) => ds.names.includes(i))))
    .map((k) => ({ name: k.name, indicators: [...k.indicators] }));
}
/** The chosen factors (all eligible ones when none is chosen). */
const chosen = (sel: string[], ctx: AnalysisCtx) => { const all = modelFactors(ctx); return sel.length ? all.filter((f) => sel.includes(f.name)) : all; };

/** Why the model's factors cannot be used (null when they can). */
function factorsBlocked(fs: InvFactor[], sel: string[], ctx: AnalysisCtx, what: string): string | null {
  if (!rawData(ctx)) return `${what} needs raw data: import a dataset (not a covariance matrix).`;
  if (!ctx.model?.constructs.length) return 'Draw a measurement model first (Model tab): the card uses its factors.';
  const gone = sel.filter((s) => !modelFactors(ctx).some((f) => f.name === s));
  if (gone.length) return `Not a factor of the diagram with two or more indicators in the data: ${gone.join(', ')}.`;
  if (!fs.length) return 'The diagram has no factor with two or more indicators in the data.';
  const inds = fs.flatMap((f) => f.indicators);
  return new Set(inds).size < inds.length ? 'An indicator belongs to two of the chosen factors: choose factors with separate indicators.' : null;
}

/** Checkboxes for the diagram's factors (none ticked: all of them). */
function FactorPicker({ value, onChange, ctx, single }: { value: string[]; onChange: (v: string[]) => void; ctx: AnalysisCtx; single?: boolean }) {
  const all = modelFactors(ctx);
  if (!all.length) return <div className="hint">Draw a measurement model on the Model tab: its factors (two or more indicators each) appear here.</div>;
  return (
    <div className="field">
      <label>{single ? 'Factor' : 'Factors (none ticked: all)'}</label>
      {all.map((f) => (
        <label key={f.name} className="check" style={{ marginBottom: 4 }}>
          <input type={single ? 'radio' : 'checkbox'} name={single ? 'inv-factor' : undefined} checked={value.includes(f.name)}
            onChange={(e) => onChange(single ? [f.name] : e.target.checked ? all.map((x) => x.name).filter((n) => n === f.name || value.includes(n)) : value.filter((n) => n !== f.name))} />
          <span>{f.name} <span className="hint">({f.indicators.join(', ')})</span></span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- alignment

export interface AlignmentOptions {
  /** Factors of the diagram by name; empty: all. */
  constructs: string[]; group: string; groupWeights: AlignmentInput['weights'];
  powerLambda: number; powerNu: number; scaleLambda: number; scaleNu: number; tolLambda: number; tolNu: number;
}
const ALIGN_DEFAULTS: Omit<AlignmentOptions, 'constructs' | 'group'> = { groupWeights: 'sqrtN', powerLambda: 0.5, powerNu: 0.5, scaleLambda: 1, scaleNu: 1, tolLambda: 0.2, tolNu: 0.4 };

export const alignmentInput = (o: AlignmentOptions, ctx: AnalysisCtx): AlignmentInput => ({
  factors: chosen(o.constructs, ctx), group: o.group, weights: o.groupWeights, power: { lambda: o.powerLambda, nu: o.powerNu }, scale: { lambda: o.scaleLambda, nu: o.scaleNu },
  tolerance: { lambda: o.tolLambda, nu: o.tolNu }, ...invLavaan(ctx),
});

function AlignmentForm({ options: o, set, ctx, disabled }: OptionsProps<AlignmentOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const inds = chosen(o.constructs, ctx).flatMap((f) => f.indicators);
  const num = (k: keyof AlignmentOptions, label: string, lo: number, hi: number, step: number) => <NumField id={`align-${k}`} label={label} value={o[k] as number} lo={lo} hi={hi} step={step} onChange={(v) => set({ ...o, [k]: v })} />;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Compares many groups without scalar invariance: the configural model is fitted in every group (factors standardised in each), then each factor’s group means and SDs are chosen so that as many loadings and intercepts as possible are nearly equal across groups (Asparouhov &amp; Muthén 2014; sirt::invariance.alignment). {lavaanHint(ctx)}</p>
      <FactorPicker value={o.constructs} onChange={(constructs) => set({ ...o, constructs })} ctx={ctx} />
      <ColumnSelect id="align-group" label="Grouping column" value={o.group} columns={d.names} exclude={inds} onChange={(group) => set({ ...o, group })} />
      <div className="row2">{num('powerLambda', 'Power, loadings', 0, 2, 0.05)}{num('powerNu', 'Power, intercepts', 0, 2, 0.05)}</div>
      <div className="row2">{num('scaleLambda', 'Scale, loadings', 0.01, 10, 0.05)}{num('scaleNu', 'Scale, intercepts', 0.01, 10, 0.05)}</div>
      <div className="hint">The loss of a difference x between two groups’ aligned parameters is |x / scale|^power: power 0.5 and scale 1 are Asparouhov &amp; Muthén’s choice (sirt’s default), favouring a few large differences over many small ones; power 2 is least squares, 0 counts the differing parameters.</div>
      <div className="row2">{num('tolLambda', 'Tolerance, loadings', 0.001, 10, 0.01)}{num('tolNu', 'Tolerance, intercepts', 0.001, 10, 0.01)}</div>
      <div className="hint">An aligned parameter within the tolerance of its joint value counts as approximately invariant (sirt::invariance_alignment_constraints; .2 and .4 as in its help page). The share of the others is the share of non-invariant parameters.</div>
      <div className="field"><label>Group weights</label>
        <div className="segmented">
          <button className={o.groupWeights === 'sqrtN' ? 'on' : ''} onClick={() => set({ ...o, groupWeights: 'sqrtN' })}>√N per group</button>
          <button className={o.groupWeights === 'equal' ? 'on' : ''} onClick={() => set({ ...o, groupWeights: 'equal' })}>Equal</button>
        </div>
        <div className="hint">√N: a pair of groups weighs √(N₁N₂) in the loss, as Asparouhov &amp; Muthén (2014); equal: sirt’s default without weights.</div>
      </div>
    </fieldset>
  );
}

const pct = (x: number) => `${fmt(x * 100, 1)}%`;
/** Aligned parameters (groups × items), the non-invariant ones (outside the tolerance) marked. */
function alignedRows(r: AlignmentResult, f: AlignedFactor, which: 'lambda' | 'nu'): Row[] {
  const m = which === 'lambda' ? f.lambdaAligned : f.nuAligned, dif = (which === 'lambda' ? f.lambdaConstraints : f.nuConstraints).dif;
  const joint = (which === 'lambda' ? f.lambdaConstraints : f.nuConstraints).joint;
  return [...r.groups.map((g, i): Row => [c(g), ...f.items.map((_, j) => (dif[i]?.[j] ? { ...c(m[i][j]), cls: 'warn', bold: true } : c(m[i][j])))]),
    [c('Joint (invariant) value', 'dim'), ...f.items.map((_, j) => c(joint[j] ?? null, 'dim'))]];
}

function AlignedFactorView({ r, f }: { r: AlignmentResult; f: AlignedFactor }) {
  const lc = f.lambdaConstraints, nc = f.nuConstraints;
  const multi = r.factors.length > 1;
  const t = (s: string) => (multi ? `${f.name}: ${s}` : s);
  return (
    <>
      <div className="stat-cards">
        {([['R², loadings', fmt(f.r2.lambda, 3)], ['R², intercepts', fmt(f.r2.nu, 3)], ['Non-invariant loadings', pct(lc.noninvariant)], ['Non-invariant intercepts', pct(nc.noninvariant)]] as const).map(([k, v]) => (
          <div className="stat-card" key={k}><div className="k">{multi ? `${f.name} · ${k}` : k}</div><div className="v">{v}</div></div>
        ))}
      </div>
      <Table title={t('Group factor means and variances (aligned)')} file={`alignment-means-${f.name}`} columns={['Group', 'N', 'Mean', 'SD', 'Variance']}
        rows={r.groups.map((g, i): Row => [c(g), c(r.n[i] ?? null, undefined, 0), c(f.mean[i] ?? null), c(f.sd[i] ?? null), c((f.sd[i] ?? NaN) ** 2)])}
        note={`The first group’s mean is 0 and ${f.fixed ? 'its SD 1' : 'the product of the SDs 1'} (sirt’s identification${f.fixed ? ' for few groups' : ' for many groups'}). The means are comparable across groups although scalar invariance is not assumed. ${f.converged ? 'The alignment converged' : 'The alignment did NOT converge: read with care'} (loss ${fmt(f.fopt, 3)}). sirt gives no standard errors for a lavaan configural fit.`} />
      <Table title={t('Effect sizes of approximate invariance')} file={`alignment-effects-${f.name}`} columns={['', 'Loadings', 'Intercepts']}
        rows={[[c('R²'), c(f.r2.lambda), c(f.r2.nu)], [c('√(1 − R²)'), c(f.sqrtU2.lambda), c(f.sqrtU2.nu)], [c('Mean correlation of aligned parameters between groups'), c(f.rbar.lambda), c(f.rbar.nu)],
          [c(`Approximately non-invariant (tolerance ${fmt(lc.tolerance, 3)} / ${fmt(nc.tolerance, 3)})`), c(pct(lc.noninvariant)), c(pct(nc.noninvariant))]]}
        note="R²: the share of the configural parameters’ variation across groups explained by the groups’ factor means and SDs (Asparouhov & Muthén 2014): 1 is exact invariance (metric for loadings, scalar for intercepts). Asparouhov & Muthén suggest that up to about 25% non-invariant parameters still give trustworthy aligned means." />
      <Table title={t('Aligned loadings')} file={`alignment-loadings-${f.name}`} columns={['Group', ...f.items]} rows={alignedRows(r, f, 'lambda')}
        note={`Each group’s loading divided by its factor SD. Bold amber: further than ${fmt(lc.tolerance, 3)} from the joint value (non-invariant).`} />
      <Table title={t('Aligned intercepts')} file={`alignment-intercepts-${f.name}`} columns={['Group', ...f.items]} rows={alignedRows(r, f, 'nu')}
        note={`Each group’s intercept minus its factor mean times the loading over the SD. Bold amber: further than ${fmt(nc.tolerance, 3)} from the joint value.`} />
      <Table title={t('Non-invariant parameters per item')} file={`alignment-items-${f.name}`} columns={['Item', 'Loadings', 'Intercepts']}
        rows={f.items.map((it, j): Row => [c(it), c(lc.unique[j] ?? null, lc.unique[j] ? 'warn' : '', 0), c(nc.unique[j] ?? null, nc.unique[j] ? 'warn' : '', 0)])}
        note={`Groups in which the item’s aligned parameter departs from the joint value (of ${r.groups.length}).`} />
    </>
  );
}

function AlignmentView({ r }: { r: AlignmentResult }) {
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>sirt {r.engine.version} on the configural fit of lavaan {r.engine.lavaan ?? ''}: χ² = {fmt(r.fit.chisq, 2)}, df = {fmt(r.fit.df, 0)}, CFI = {fmt(r.fit.cfi, 3)}, RMSEA = {fmt(r.fit.rmsea, 3)}, SRMR = {fmt(r.fit.srmr, 3)}; {r.groups.length} groups, N = {r.n.reduce((a, b) => a + b, 0)}. Power {r.power.join(' / ')}, scale {r.scale.join(' / ')}, {r.weights === 'sqrtN' ? '√N weights' : 'equal weights'}.</p>
      {r.factors.map((f) => <AlignedFactorView key={f.name} r={r} f={f} />)}
    </div>
  );
}

export const alignmentAnalysis: AnalysisType<AlignmentOptions, AlignmentResult> = {
  id: 'alignment', title: 'Alignment optimisation', sub: 'approximate invariance across many groups: aligned means and SDs (sirt; Asparouhov & Muthén 2014)', group: 'Measurement',
  defaults: () => ({ constructs: [], group: '', ...ALIGN_DEFAULTS }),
  parseOptions: (raw) => (isObj(raw) ? {
    constructs: names(raw.constructs), group: name(raw.group), groupWeights: oneOf(raw.groupWeights, ['sqrtN', 'equal'] as const, 'sqrtN'),
    powerLambda: clampNum(raw.powerLambda, 0, 2, 0.5), powerNu: clampNum(raw.powerNu, 0, 2, 0.5), scaleLambda: clampNum(raw.scaleLambda, 0.01, 10, 1), scaleNu: clampNum(raw.scaleNu, 0.01, 10, 1),
    tolLambda: clampNum(raw.tolLambda, 0.001, 10, 0.2), tolNu: clampNum(raw.tolNu, 0.001, 10, 0.4),
  } : null),
  Options: AlignmentForm,
  View: ({ result }) => <AlignmentView r={result} />,
  blocked: (o, ctx) => {
    const fs = chosen(o.constructs, ctx);
    const b = factorsBlocked(fs, o.constructs, ctx, 'Alignment');
    if (b) return b;
    if (!o.group) return 'Choose a grouping column.';
    if (fs.some((f) => f.indicators.includes(o.group))) return 'The grouping column is an indicator of a chosen factor.';
    return missingColumns(ctx, [o.group], 'Alignment');
  },
  fingerprint: (o, ctx) => { const i = alignmentInput(o, ctx); return columnsFingerprint(ctx, [...i.factors.flatMap((f) => f.indicators), o.group], [JSON.stringify(i)]); },
  run: async (o, ctx) => (await engine()).alignmentR(rawData(ctx)!, alignmentInput(o, ctx)),
  script: async (o, ctx) => (await engine()).alignmentScriptR(rawData(ctx)!, alignmentInput(o, ctx)),
  summary: (o) => `${o.constructs.length ? o.constructs.join(', ') : 'all factors'} · by ${o.group || '…'}`,
};

// ---------------------------------------------------------------- moderated nonlinear factor analysis

export type MnlfaOptions = MnlfaInput;
type MnlfaRole = 'categorical' | 'intercept' | 'slope' | 'mean' | 'sd';
const ROLES: [MnlfaRole, string, string][] = [
  ['categorical', 'Categorical', 'dummy coded, the first level the reference'], ['intercept', 'Intercepts', 'uniform DIF'], ['slope', 'Slopes', 'non-uniform DIF (2PL)'],
  ['mean', 'Mean', 'the factor mean'], ['sd', 'SD', 'the factor’s log SD'],
];

/** The options as sent: roles of covariates no longer chosen dropped, slopes only for 2PL, moderated items among the items. */
export function mnlfaInput(o: MnlfaOptions): MnlfaInput {
  const keep = (x: string[]) => x.filter((v) => o.covariates.includes(v));
  return { ...o, categorical: keep(o.categorical), intercept: keep(o.intercept), slope: o.itemType === '2PL' ? keep(o.slope) : [], mean: keep(o.mean), sd: keep(o.sd), moderated: o.moderated.filter((v) => o.items.includes(v)) };
}

function MnlfaForm({ options: o, set, ctx, disabled }: OptionsProps<MnlfaOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names;
  const toggle = (role: MnlfaRole, v: string, on: boolean) => set({ ...o, [role]: on ? [...o[role], v] : o[role].filter((x) => x !== v) });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>One factor of binary (0/1) items whose intercepts, slopes, mean and SD may depend on person covariates, continuous or categorical: differential item functioning and impact in one model (Curran et al. 2014; mnlfa, Robitzsch). mnlfa fits one factor at a time and binary items only, by maximum likelihood (EM), without standard errors: compare models by AIC and BIC.</p>
      <OrderedPicker label="Binary items (0/1)" columns={numeric.filter((n) => !o.covariates.includes(n))} value={o.items} onChange={(items) => set({ ...o, items })} />
      <div className="field"><label>Item model</label>
        <div className="segmented">
          <button className={o.itemType === '2PL' ? 'on' : ''} onClick={() => set({ ...o, itemType: '2PL' })}>2PL</button>
          <button className={o.itemType === '1PL' ? 'on' : ''} onClick={() => set({ ...o, itemType: '1PL' })}>1PL</button>
        </div>
        <div className="hint">P(x = 1) = invlogit(a θ − b). 2PL: a slope per item (loadings, moderable), the factor SD 1 where the covariates are 0; 1PL: slopes 1, the SD free.</div>
      </div>
      <OrderedPicker label="Covariates (moderators)" columns={numeric.filter((n) => !o.items.includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      {o.covariates.length > 0 && (
        <table className="grid">
          <thead><tr><th>Covariate</th>{ROLES.filter(([r]) => r !== 'slope' || o.itemType === '2PL').map(([r, l, t]) => <th key={r} title={t}>{l}</th>)}</tr></thead>
          <tbody>{o.covariates.map((v) => (
            <tr key={v}><td>{v}</td>{ROLES.filter(([r]) => r !== 'slope' || o.itemType === '2PL').map(([r, l]) => (
              <td key={r}><input type="checkbox" aria-label={`${v}: ${l}`} checked={o[r].includes(v)} onChange={(e) => toggle(r, v, e.target.checked)} /></td>
            ))}</tr>
          ))}</tbody>
        </table>
      )}
      {o.items.length > 0 && (o.intercept.length > 0 || o.slope.length > 0) && (
        <div className="field">
          <label>Moderated items (none ticked: all)</label>
          <div>{o.items.map((it) => (
            <label key={it} className="check" style={{ display: 'inline-flex', marginRight: 10 }}>
              <input type="checkbox" checked={o.moderated.includes(it)} onChange={(e) => set({ ...o, moderated: e.target.checked ? o.items.filter((x) => x === it || o.moderated.includes(x)) : o.moderated.filter((x) => x !== it) })} /><span>{it}</span>
            </label>
          ))}</div>
          <div className="hint">The other items are anchors: their intercepts and slopes do not depend on the covariates. A covariate of the mean (or SD) cannot also moderate the intercepts (or slopes) of every item.</div>
        </div>
      )}
    </fieldset>
  );
}

/** Why the roles cannot be identified (null when they can). */
export function mnlfaUnidentified(i: MnlfaInput): string | null {
  const all = !i.moderated.length || i.moderated.length === i.items.length;
  if (!all) return null;
  const a = i.intercept.find((v) => i.mean.includes(v)), b = i.slope.find((v) => i.sd.includes(v));
  if (a) return `${a} moderates the factor mean and the intercepts of every item: not identified. Leave at least one item unmoderated (an anchor).`;
  return b ? `${b} moderates the factor SD and the slopes of every item: not identified. Leave at least one item unmoderated (an anchor).` : null;
}

function MnlfaView({ r }: { r: MnlfaResult }) {
  const label = (term: string) => { if (term === '(Intercept)') return 'Intercept'; const t = r.terms.find((x) => x.term === term); return t ? (t.level === null ? t.covariate : `${t.covariate} = ${t.level}`) : term; };
  const items = [...new Set(r.items.map((p) => p.item))];
  const table = (kind: 'a' | 'b') => {
    const terms = [...new Set(r.items.filter((p) => p.kind === kind).map((p) => p.term))];
    return { terms, rows: items.map((it): Row => [c(it), ...terms.map((t) => { const p = r.items.find((x) => x.item === it && x.kind === kind && x.term === t); return p ? c(p.est, p.free ? '' : 'dim') : c(null); })]) };
  };
  const b = table('b'), a = table('a');
  const traitTerms = [...new Set(r.trait.map((t) => t.term))];
  const est = (kind: 'mu' | 'sigma', t: string) => r.trait.find((x) => x.kind === kind && x.term === t)?.est;
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['N', fmt(r.n, 0)], ['Deviance', fmt(r.fit.deviance, 2)], ['Parameters', fmt(r.fit.npar, 0)], ['AIC', fmt(r.fit.aic, 2)], ['BIC', fmt(r.fit.bic, 2)]] as const).map(([k, v]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>mnlfa {r.engine.version}, {r.itemType}, P(x = 1) = invlogit(a θ − b); {r.converged ? `converged in ${r.iterations} EM iterations` : `did NOT converge in ${r.iterations} iterations: read with care`}. Log-likelihood {fmt(r.fit.logLik, 2)}, AICc {fmt(r.fit.aicc, 2)}, CAIC {fmt(r.fit.caic, 2)}. No standard errors: compare models with and without a moderation by AIC and BIC (or a likelihood-ratio test on the deviances).</p>
      <Table title="Item intercepts (b) and their moderation" file="mnlfa-intercepts" columns={['Item', ...b.terms.map(label)]} rows={b.rows}
        note="b is the item’s threshold on the factor: higher b, harder item (fewer 1s at the same factor level). A covariate’s column: the change in b per unit of the covariate (or for the level against the reference) at the same factor level, i.e. uniform DIF. Blank: not moderated (an anchor)." />
      {(r.itemType === '2PL' || a.terms.length > 1) && (
        <Table title="Item slopes (a) and their moderation" file="mnlfa-slopes" columns={['Item', ...a.terms.map(label)]} rows={a.rows}
          note={r.itemType === '1PL' ? 'Fixed at 1 (1PL).' : 'a is the item’s discrimination (loading on the logit scale); a covariate’s column is its change per unit: non-uniform DIF.'} />
      )}
      <Table title="Factor mean and SD" file="mnlfa-trait" columns={['Term', 'Mean', 'Log SD', 'SD ratio']}
        rows={traitTerms.map((t): Row => { const s = est('sigma', t); return [c(label(t)), c(est('mu', t) ?? null), c(s ?? null), c(s === undefined ? null : Math.exp(s))]; })}
        note="Impact: the factor mean’s change per unit of a covariate (0 where all covariates are 0), and of its log SD (SD ratio = exp(log SD)), after the items’ DIF is accounted for. The intercept of the log SD is free in the 1PL only." />
    </div>
  );
}

export const mnlfaAnalysis: AnalysisType<MnlfaOptions, MnlfaResult> = {
  id: 'mnlfa', title: 'Moderated nonlinear factor analysis', sub: 'binary items whose intercepts, slopes, mean and SD depend on covariates: DIF and impact (mnlfa)', group: 'Measurement',
  defaults: () => ({ items: [], itemType: '2PL', covariates: [], categorical: [], intercept: [], slope: [], mean: [], sd: [], moderated: [] }),
  parseOptions: (raw) => (isObj(raw) ? {
    items: names(raw.items), itemType: oneOf(raw.itemType, ['2PL', '1PL'] as const, '2PL'), covariates: names(raw.covariates), categorical: names(raw.categorical),
    intercept: names(raw.intercept), slope: names(raw.slope), mean: names(raw.mean), sd: names(raw.sd), moderated: names(raw.moderated),
  } : null),
  Options: MnlfaForm,
  View: ({ result }) => <MnlfaView r={result} />,
  blocked: (o, ctx) => {
    if (o.items.length < 3) return 'Choose at least three binary items.';
    if (o.items.some((x) => o.covariates.includes(x))) return 'An item cannot also be a covariate.';
    const i = mnlfaInput(o);
    if (i.covariates.some((v) => ![i.intercept, i.slope, i.mean, i.sd].some((r) => r.includes(v)))) return 'Give every covariate a role (intercepts, slopes, mean or SD), or remove it.';
    const m = missingColumns(ctx, [...o.items, ...o.covariates], 'Moderated nonlinear factor analysis');
    if (m) return m;
    const ds = rawData(ctx)!;
    const bad = o.items.find((it) => Array.from(ds.cols[ds.names.indexOf(it)]).some((v) => !Number.isNaN(v) && v !== 0 && v !== 1));
    return bad ? `${bad} is not binary: the items must be coded 0 and 1.` : mnlfaUnidentified(i);
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...o.items, ...o.covariates], [JSON.stringify(mnlfaInput(o))]),
  run: async (o, ctx) => (await engine()).mnlfaR(rawData(ctx)!, mnlfaInput(o)),
  script: async (o, ctx) => (await engine()).mnlfaScriptR(rawData(ctx)!, mnlfaInput(o)),
  summary: (o) => `${o.items.length} items · ${o.itemType}${o.covariates.length ? ` · moderated by ${o.covariates.join(', ')}` : ''}`,
};

// ---------------------------------------------------------------- longitudinal invariance

export interface LongInvarianceOptions { factor: string; occasions: string[][]; lag: LongInvarianceInput['lag'] }
export const longInvarianceInput = (o: LongInvarianceOptions, ctx: AnalysisCtx): LongInvarianceInput => ({ factor: o.factor.trim() || 'F', occasions: o.occasions, lag: o.lag, ...invLavaan(ctx) });

function LongInvarianceForm({ options: o, set, ctx, disabled }: OptionsProps<LongInvarianceOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const used = o.occasions.flat();
  const found = detectOccasions(d.names);
  const setOcc = (k: number, v: string[]) => set({ ...o, occasions: o.occasions.map((x, j) => (j === k ? v : x)) });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>One factor measured by the same items at several occasions: the configural, metric (equal loadings), scalar (+ equal intercepts) and strict (+ equal residual variances) models, each item’s residuals correlated across occasions, built by semTools::measEq.syntax and compared like the multigroup sequence. {lavaanHint(ctx)}</p>
      <div className="field"><label htmlFor="li-factor">Factor name</label>
        <input id="li-factor" className="input" value={o.factor} maxLength={60} onChange={(e) => set({ ...o, factor: e.target.value })} />
      </div>
      <div className="table-tools">
        <button className="btn sm" disabled={!found.occasions.length} onClick={() => set({ ...o, occasions: found.occasions })}
          title={found.occasions.length ? `Columns named like item_t1, item_t2: ${found.occasions.length} occasions of ${found.occasions[0].length} items` : 'No columns named like x1_t1, x1_t2 (or x1.1, x1.2; x1_w1, x1_w2)'}>Recognise repeated items{found.occasions.length ? ` (${found.occasions.length} × ${found.occasions[0].length})` : ''}</button>
        <button className="btn sm" onClick={() => set({ ...o, occasions: [...o.occasions, []] })}>Add occasion</button>
      </div>
      {o.occasions.map((occ, k) => (
        <div key={k}>
          <OrderedPicker label={`Occasion ${k + 1}: indicators (item order as at occasion 1)`} columns={d.names.filter((n) => !used.includes(n) || occ.includes(n))} value={occ} onChange={(v) => setOcc(k, v)} />
          {o.occasions.length > 2 && <button className="btn sm ghost" onClick={() => set({ ...o, occasions: o.occasions.filter((_, j) => j !== k) })}>Remove occasion {k + 1}</button>}
        </div>
      ))}
      <div className="field"><label>Residual correlations of the same item</label>
        <div className="segmented">
          <button className={o.lag === 'all' ? 'on' : ''} onClick={() => set({ ...o, lag: 'all' })}>All occasions</button>
          <button className={o.lag === 'adjacent' ? 'on' : ''} onClick={() => set({ ...o, lag: 'adjacent' })}>Adjacent occasions</button>
        </div>
      </div>
    </fieldset>
  );
}

function LongInvarianceView({ r, o }: { r: LongInvarianceResult; o?: LongInvarianceOptions }) {
  const scalar = r.levels.find((l) => l.level === 'scalar');
  const se = (v?: number) => (v === undefined ? c('fixed', 'dim') : c(v));
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.occasions} occasions × {r.items} items, N = {r.n}; semTools {r.engine.version} (measEq.syntax), lavaan {r.engine.lavaan ?? ''}. Residuals of the same item correlated across {r.lag === 'all' ? 'all occasions' : 'adjacent occasions'}.</p>
      <InvarianceTable inv={r} title={`Longitudinal measurement invariance${o?.factor ? ` of ${o.factor}` : ''}`} file="longitudinal-invariance"
        constraints="Each model adds equality constraints across occasions to the one before (loadings; intercepts; residual variances); the factor is standardised at the first occasion, its later means and variances freed as the constraints identify them." />
      {scalar && (
        <Table title="Factor means and variances under scalar invariance" file="longitudinal-invariance-means" columns={['Occasion', 'Mean', 'SE', 'Variance', 'SE']}
          rows={scalar.factor.map((f, t): Row => [c(t + 1, undefined, 0), c(f.mean), se(f.meanSe), c(f.variance), se(f.varianceSe)])}
          note="On the scale of the first occasion (mean 0, variance 1): with equal loadings and intercepts, the later means are change in SD units of occasion 1. Read them only if scalar invariance holds (or nearly)." />
      )}
    </div>
  );
}

export const longInvarianceAnalysis: AnalysisType<LongInvarianceOptions, LongInvarianceResult> = {
  id: 'longinvariance', title: 'Longitudinal invariance', sub: 'configural → metric → scalar → strict over occasions, correlated item residuals (semTools::measEq.syntax)', group: 'Longitudinal',
  defaults: (ctx) => { const f = detectOccasions(rawData(ctx)?.names ?? []); return { factor: 'F', occasions: f.occasions.length ? f.occasions : [[], []], lag: 'all' }; },
  parseOptions: (raw) => (isObj(raw) ? {
    factor: name(raw.factor, 60), occasions: (Array.isArray(raw.occasions) ? raw.occasions.slice(0, 50) : []).map((x) => names(x)), lag: oneOf(raw.lag, ['all', 'adjacent'] as const, 'all'),
  } : null),
  Options: LongInvarianceForm,
  View: ({ result, options }) => <LongInvarianceView r={result} o={options} />,
  blocked: (o, ctx) => {
    const occ = o.occasions.filter((x) => x.length);
    if (occ.length < 2) return 'Choose the indicators at two or more occasions.';
    if (occ.length < o.occasions.length) return 'An occasion has no indicators: choose them, or remove the occasion.';
    if (occ.some((x) => x.length < 2)) return 'Each occasion needs at least two indicators.';
    if (new Set(occ.map((x) => x.length)).size > 1) return 'Every occasion needs the same number of indicators (item k of each occasion is the same item).';
    const all = occ.flat();
    if (new Set(all).size < all.length) return 'A column appears at more than one occasion.';
    return missingColumns(ctx, all, 'Longitudinal invariance');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.occasions.flat(), [JSON.stringify(longInvarianceInput(o, ctx))]),
  run: async (o, ctx) => (await engine()).longInvarianceR(rawData(ctx)!, longInvarianceInput(o, ctx)),
  script: async (o, ctx) => (await engine()).longInvarianceScriptR(rawData(ctx)!, longInvarianceInput(o, ctx)),
  summary: (o) => `${o.factor.trim() || 'F'} · ${o.occasions.length} occasions × ${o.occasions[0]?.length ?? 0} items`,
};

// ---------------------------------------------------------------- DIF by MIMIC

export interface MimicDifOptions { construct: string; covariate: string; adjust: MimicDifInput['adjust']; alpha: number; free: boolean }
const ADJUST: [MimicDifInput['adjust'], string][] = [['holm', 'Holm'], ['BH', 'Benjamini–Hochberg'], ['bonferroni', 'Bonferroni'], ['none', 'None']];
const mimicFactor = (o: MimicDifOptions, ctx: AnalysisCtx) => modelFactors(ctx).filter((f) => f.name === o.construct);
export const mimicDifInput = (o: MimicDifOptions, ctx: AnalysisCtx): MimicDifInput => ({ factors: mimicFactor(o, ctx), covariate: o.covariate, adjust: o.adjust, alpha: o.alpha, free: o.free, ...invLavaan(ctx) });

function MimicDifForm({ options: o, set, ctx, disabled }: OptionsProps<MimicDifOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const inds = mimicFactor(o, ctx).flatMap((f) => f.indicators);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Uniform DIF by MIMIC: the factor is regressed on a covariate (a group coded 0/1, or a continuous one such as age), and each item’s direct effect from the covariate is tested: does the item differ between groups beyond what the factor difference explains? Score tests from the model without direct effects, and one model per item with its direct path (Wald z, likelihood-ratio test), corrected for the number of items. {lavaanHint(ctx)}</p>
      <FactorPicker single value={o.construct ? [o.construct] : []} onChange={(v) => set({ ...o, construct: v[0] ?? '' })} ctx={ctx} />
      <ColumnSelect id="mimic-cov" label="Covariate (binary group or continuous)" value={o.covariate} columns={d.names} exclude={inds} onChange={(covariate) => set({ ...o, covariate })} />
      <div className="field"><label>Correction of the p-values</label>
        <div className="segmented">{ADJUST.map(([id, l]) => <button key={id} className={o.adjust === id ? 'on' : ''} onClick={() => set({ ...o, adjust: id })}>{l}</button>)}</div>
        <div className="hint">Holm and Bonferroni control the familywise error over the items; Benjamini–Hochberg the false discovery rate (p.adjust).</div>
      </div>
      <NumField id="mimic-alpha" label="Significance level" value={o.alpha} lo={0.001} hi={0.5} step={0.01} onChange={(alpha) => set({ ...o, alpha })} />
      <label className="check"><input type="checkbox" checked={o.free} onChange={(e) => set({ ...o, free: e.target.checked })} />
        <span>Free the flagged items’ direct effects in a final model<br /><span className="hint">The factor’s difference by the covariate, corrected for that DIF (partial invariance).</span></span></label>
    </fieldset>
  );
}

const effectRow = (label: string, e: MimicEffect): Row => [c(label), c(e.est), c(e.se), c(e.z), pCell(e.p), c(e.std)];
function MimicDifView({ r }: { r: MimicDifResult }) {
  const fit = (f: MimicDifResult['fit']) => `χ² = ${fmt(f.chisq, 2)}, df = ${fmt(f.df, 0)}, CFI = ${fmt(f.cfi, 3)}, RMSEA = ${fmt(f.rmsea, 3)}, SRMR = ${fmt(f.srmr, 3)}`;
  const adj = ADJUST.find(([id]) => id === r.adjust)?.[1] ?? r.adjust;
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.factor} regressed on {r.covariate}, N = {r.n}; lavaan {r.engine.version}. Model without direct effects: {fit(r.fit)}.</p>
      <Table title={`Uniform DIF: direct effects of ${r.covariate} on the items of ${r.factor}`} file="mimic-dif"
        columns={['Item', 'Direct effect', 'SE', 'z', 'p (Wald)', 'Standardised', 'LR χ²', 'p (LR)', `p (${adj})`, 'Score χ²', 'p (score)']}
        rows={r.items.map((x): Row => [c(x.item), { ...c(x.est), bold: x.flagged }, c(x.se), c(x.z), pCell(x.p), c(x.std), c(x.chisq), pCell(x.pLrt),
          { v: fmtP(x.pAdj), cls: x.flagged ? 'bad' : 'dim', bold: x.flagged }, c(x.score ?? null), x.scoreP === undefined ? c(null) : pCell(x.scoreP)])}
        note={`Each row: the model with that item’s direct path from ${r.covariate} (its estimate, Wald test and likelihood-ratio test against the model without it), and the score test of the same path from the model without any (lavTestScore). Flagged (bold, red): the corrected LR p below ${fmt(r.alpha, 3)} (${adj}${r.adjust === 'none' ? ', no correction' : ''}). A positive direct effect: the item scores higher with the covariate than the factor predicts. With several DIF items the one-at-a-time tests can mislead (the others contaminate the anchor); a significant one flags the item, not the cause.${r.scoreError ? ' The score tests could not be computed for this model.' : ''}`} />
      <Table title={`${r.factor} on ${r.covariate}`} file="mimic-effect" columns={['Model', 'Estimate', 'SE', 'z', 'p', 'Standardised']}
        rows={[effectRow('Without direct effects', r.effect), ...(r.final ? [effectRow(`With the flagged items’ direct effects (${r.flagged.length ? r.flagged.join(', ') : 'none flagged'})`, r.final.effect)] : [])]}
        note="The factor’s difference by the covariate (impact). Freeing the flagged items’ direct effects corrects it for their DIF." />
      {r.final && r.final.direct.length > 0 && (
        <Table title="Direct effects in the final model" file="mimic-final" columns={['Item', 'Estimate', 'SE', 'z', 'p', 'Standardised']}
          rows={r.final.direct.map((x) => effectRow(x.item, x))} note={`Final model: ${fit(r.final.fit)}.`} />
      )}
    </div>
  );
}

export const mimicDifAnalysis: AnalysisType<MimicDifOptions, MimicDifResult> = {
  id: 'mimicdif', title: 'DIF by MIMIC', sub: 'uniform differential item functioning: each item’s direct effect from a covariate (lavaan)', group: 'Measurement',
  defaults: (ctx) => ({ construct: modelFactors(ctx).find((f) => f.indicators.length >= 3)?.name ?? '', covariate: '', adjust: 'holm', alpha: 0.05, free: true }),
  parseOptions: (raw) => (isObj(raw) ? {
    construct: name(raw.construct), covariate: name(raw.covariate), adjust: oneOf(raw.adjust, ['holm', 'BH', 'bonferroni', 'none'] as const, 'holm'),
    alpha: clampNum(raw.alpha, 0.001, 0.5, 0.05), free: raw.free === undefined ? true : raw.free === true,
  } : null),
  Options: MimicDifForm,
  View: ({ result }) => <MimicDifView r={result} />,
  blocked: (o, ctx) => {
    if (!o.construct) return rawData(ctx) && ctx.model?.constructs.length ? 'Choose a factor.' : factorsBlocked([], [], ctx, 'DIF by MIMIC');
    const fs = mimicFactor(o, ctx);
    const b = factorsBlocked(fs, [o.construct], ctx, 'DIF by MIMIC');
    if (b) return b;
    if (fs[0].indicators.length < 3) return 'DIF screening needs a factor with at least three indicators.';
    if (!o.covariate) return 'Choose a covariate.';
    if (fs[0].indicators.includes(o.covariate)) return 'The covariate is an indicator of the factor.';
    const m = missingColumns(ctx, [o.covariate], 'DIF by MIMIC');
    if (m) return m;
    const cats = rawData(ctx)!.categories?.[o.covariate];
    return cats && cats.length > 2 ? `${o.covariate} has ${cats.length} categories: choose a binary group or a continuous covariate (or make dummy columns).` : null;
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...mimicFactor(o, ctx).flatMap((f) => f.indicators), o.covariate], [JSON.stringify(mimicDifInput(o, ctx))]),
  run: async (o, ctx) => (await engine()).mimicDifR(rawData(ctx)!, mimicDifInput(o, ctx)),
  script: async (o, ctx) => (await engine()).mimicDifScriptR(rawData(ctx)!, mimicDifInput(o, ctx)),
  summary: (o) => `${o.construct || '…'} on ${o.covariate || '…'} · ${ADJUST.find(([id]) => id === o.adjust)?.[1]}${o.free ? ' · flagged freed' : ''}`,
};
