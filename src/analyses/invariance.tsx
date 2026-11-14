// Measurement invariance cards (R/invariance.R): alignment optimisation for many
// groups (sirt, Asparouhov & Muthén 2014) on the diagram's factors, and moderated
// nonlinear factor analysis of binary items (mnlfa; Curran et al. 2014), and
// longitudinal invariance of a factor measured at several occasions (semTools),
// uniform DIF by MIMIC (lavaan), local SEM: the canvas model's parameters as
// curves along a continuous moderator (sirt::lsem.estimate; Hildebrandt et al. 2016),
// and effect sizes of non-invariance between the canvas model's groups (dMACS).

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { IconCopy } from '../components/icons';
import { OrderedPicker } from '../components/OrderedPicker';
import { InvarianceTable } from '../components/results/InvarianceTable';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { seriesColor } from '../figure/palette';
import { fmt, fmtP } from '../format';
import {
  detectOccasions,
  type AlignedFactor,
  type AlignmentInput,
  type AlignmentResult,
  type DmacsInput,
  type DmacsItem,
  type DmacsResult,
  type InvFactor,
  type LongInvarianceInput,
  type LongInvarianceResult,
  type LsemInput,
  type LsemParam,
  type LsemResult,
  type MimicDifInput,
  type MimicDifResult,
  type MimicEffect,
  type MnlfaInput,
  type MnlfaResult,
} from '../rengine/invariance';
import { Axes, H, pad, W } from './charts';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { fingerprint } from './codec';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  flag,
  isObj,
  missingColumns,
  name,
  names,
  NumField,
  oneOf,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/invariance');
const LAVAAN_MISSING = ['fiml', 'pairwise', 'twostage', 'robusttwostage'] as const;
const MISSING_NOTE: Record<string, string> = {
  fiml: 'FIML',
  pairwise: 'pairwise deletion',
  twostage: 'two-stage',
  robusttwostage: 'robust two-stage',
  casewise: 'casewise deletion',
};
/** lavaan settings from the project: ML or MLR; FIML (and the other lavaan treatments) or casewise deletion (mean replacement and imputation do not apply). */
export function invLavaan(ctx: Pick<AnalysisCtx, 'settings'>): {
  estimator: 'ML' | 'MLR';
  missing: AlignmentInput['missing'];
} {
  const missing = (LAVAAN_MISSING as readonly string[]).includes(ctx.settings.missing)
    ? ctx.settings.missing
    : 'casewise';
  return { estimator: ctx.settings.estimator === 'MLR' ? 'MLR' : 'ML', missing };
}
const lavaanHint = (ctx: AnalysisCtx) => {
  const l = invLavaan(ctx);
  return `lavaan ${l.estimator}, ${MISSING_NOTE[l.missing] ?? l.missing} (from the Model settings).`;
};

/** The diagram's factors a card can use: two or more indicators in the data, not higher-order. */
export function modelFactors(ctx: AnalysisCtx): InvFactor[] {
  const ds = rawData(ctx);
  return (ctx.model?.constructs ?? [])
    .filter(
      (k) =>
        !k.components?.length &&
        k.indicators.length >= 2 &&
        (!ds || k.indicators.every((i) => ds.names.includes(i))),
    )
    .map((k) => ({ name: k.name, indicators: [...k.indicators] }));
}
/** The chosen factors (all eligible ones when none is chosen). */
export const chosen = (sel: string[], ctx: AnalysisCtx) => {
  const all = modelFactors(ctx);
  return sel.length ? all.filter((f) => sel.includes(f.name)) : all;
};

/** Why the model's factors cannot be used (null when they can). */
export function factorsBlocked(
  fs: InvFactor[],
  sel: string[],
  ctx: AnalysisCtx,
  what: string,
): string | null {
  if (!rawData(ctx)) return `${what} needs raw data: import a dataset (not a covariance matrix).`;
  if (!ctx.model?.constructs.length)
    return 'Draw a measurement model first (Model tab): the card uses its factors.';
  const gone = sel.filter((s) => !modelFactors(ctx).some((f) => f.name === s));
  if (gone.length)
    return `Not a factor of the diagram with two or more indicators in the data: ${gone.join(', ')}.`;
  if (!fs.length) return 'The diagram has no factor with two or more indicators in the data.';
  const inds = fs.flatMap((f) => f.indicators);
  return new Set(inds).size < inds.length
    ? 'An indicator belongs to two of the chosen factors: choose factors with separate indicators.'
    : null;
}

/** Checkboxes for the diagram's factors (none ticked: all of them). */
export function FactorPicker({
  value,
  onChange,
  ctx,
  single,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  ctx: AnalysisCtx;
  single?: boolean;
}) {
  const all = modelFactors(ctx);
  if (!all.length)
    return (
      <div className="hint">
        Draw a measurement model on the Model tab: its factors (two or more indicators each) appear
        here.
      </div>
    );
  return (
    <div className="field">
      <label>{single ? 'Factor' : 'Factors (none ticked: all)'}</label>
      {all.map((f) => (
        <label key={f.name} className="check" style={{ marginBottom: 4 }}>
          <input
            type={single ? 'radio' : 'checkbox'}
            name={single ? 'inv-factor' : undefined}
            checked={value.includes(f.name)}
            onChange={(e) => {
              if (single) onChange([f.name]);
              // (ticking keeps the factors in the model's order)
              else if (e.target.checked)
                onChange(all.map((x) => x.name).filter((n) => n === f.name || value.includes(n)));
              else onChange(value.filter((n) => n !== f.name));
            }}
          />
          <span>
            {f.name} <span className="hint">({f.indicators.join(', ')})</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- alignment

export interface AlignmentOptions {
  /** Factors of the diagram by name; empty: all. */
  constructs: string[];
  group: string;
  groupWeights: AlignmentInput['weights'];
  powerLambda: number;
  powerNu: number;
  scaleLambda: number;
  scaleNu: number;
  tolLambda: number;
  tolNu: number;
}
const ALIGN_DEFAULTS: Omit<AlignmentOptions, 'constructs' | 'group'> = {
  groupWeights: 'sqrtN',
  powerLambda: 0.5,
  powerNu: 0.5,
  scaleLambda: 1,
  scaleNu: 1,
  tolLambda: 0.2,
  tolNu: 0.4,
};

export const alignmentInput = (o: AlignmentOptions, ctx: AnalysisCtx): AlignmentInput => ({
  factors: chosen(o.constructs, ctx),
  group: o.group,
  weights: o.groupWeights,
  power: { lambda: o.powerLambda, nu: o.powerNu },
  scale: { lambda: o.scaleLambda, nu: o.scaleNu },
  tolerance: { lambda: o.tolLambda, nu: o.tolNu },
  ...invLavaan(ctx),
});

function AlignmentForm({ options: o, set, ctx, disabled }: OptionsProps<AlignmentOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const inds = chosen(o.constructs, ctx).flatMap((f) => f.indicators);
  const num = (k: keyof AlignmentOptions, label: string, lo: number, hi: number, step: number) => (
    <NumField
      id={`align-${k}`}
      label={label}
      value={o[k] as number}
      lo={lo}
      hi={hi}
      step={step}
      onChange={(v) => set({ ...o, [k]: v })}
    />
  );
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Compares many groups without scalar invariance: the configural model is fitted in every
        group (factors standardised in each), then each factor’s group means and SDs are chosen so
        that as many loadings and intercepts as possible are nearly equal across groups (Asparouhov
        &amp; Muthén 2014; sirt::invariance.alignment). {lavaanHint(ctx)}
      </p>
      <FactorPicker
        value={o.constructs}
        onChange={(constructs) => set({ ...o, constructs })}
        ctx={ctx}
      />
      <ColumnSelect
        id="align-group"
        label="Grouping column"
        value={o.group}
        columns={d.names}
        exclude={inds}
        onChange={(group) => set({ ...o, group })}
      />
      <div className="row2">
        {num('powerLambda', 'Power, loadings', 0, 2, 0.05)}
        {num('powerNu', 'Power, intercepts', 0, 2, 0.05)}
      </div>
      <div className="row2">
        {num('scaleLambda', 'Scale, loadings', 0.01, 10, 0.05)}
        {num('scaleNu', 'Scale, intercepts', 0.01, 10, 0.05)}
      </div>
      <div className="hint">
        The loss of a difference x between two groups’ aligned parameters is |x / scale|^power:
        power 0.5 and scale 1 are Asparouhov &amp; Muthén’s choice (sirt’s default), favouring a few
        large differences over many small ones; power 2 is least squares, 0 counts the differing
        parameters.
      </div>
      <div className="row2">
        {num('tolLambda', 'Tolerance, loadings', 0.001, 10, 0.01)}
        {num('tolNu', 'Tolerance, intercepts', 0.001, 10, 0.01)}
      </div>
      <div className="hint">
        An aligned parameter within the tolerance of its joint value counts as approximately
        invariant (sirt::invariance_alignment_constraints; .2 and .4 as in its help page). The share
        of the others is the share of non-invariant parameters.
      </div>
      <div className="field">
        <label>Group weights</label>
        <div className="segmented">
          <button
            className={o.groupWeights === 'sqrtN' ? 'on' : ''}
            onClick={() => set({ ...o, groupWeights: 'sqrtN' })}
          >
            √N per group
          </button>
          <button
            className={o.groupWeights === 'equal' ? 'on' : ''}
            onClick={() => set({ ...o, groupWeights: 'equal' })}
          >
            Equal
          </button>
        </div>
        <div className="hint">
          √N: a pair of groups weighs √(N₁N₂) in the loss, as Asparouhov &amp; Muthén (2014); equal:
          sirt’s default without weights.
        </div>
      </div>
    </fieldset>
  );
}

const pct = (x: number) => `${fmt(x * 100, 1)}%`;
/** Aligned parameters (groups × items), the non-invariant ones (outside the tolerance) marked. */
function alignedRows(r: AlignmentResult, f: AlignedFactor, which: 'lambda' | 'nu'): Row[] {
  const m = which === 'lambda' ? f.lambdaAligned : f.nuAligned;
  const dif = (which === 'lambda' ? f.lambdaConstraints : f.nuConstraints).dif;
  const joint = (which === 'lambda' ? f.lambdaConstraints : f.nuConstraints).joint;
  return [
    ...r.groups.map(
      (g, i): Row => [
        c(g),
        ...f.items.map((_, j) =>
          dif[i]?.[j] ? { ...c(m[i][j]), cls: 'warn', bold: true } : c(m[i][j]),
        ),
      ],
    ),
    [c('Joint (invariant) value', 'dim'), ...f.items.map((_, j) => c(joint[j] ?? null, 'dim'))],
  ];
}

/** How the alignment was identified and whether it converged. */
function alignmentNote(f: AlignedFactor): string {
  const identification = f.fixed ? 'its SD 1' : 'the product of the SDs 1';
  const groups = f.fixed ? ' for few groups' : ' for many groups';
  const converged = f.converged
    ? 'The alignment converged'
    : 'The alignment did NOT converge: read with care';
  return `The first group’s mean is 0 and ${identification} (sirt’s identification${groups}). The means are comparable across groups although scalar invariance is not assumed. ${converged} (loss ${fmt(f.fopt, 3)}). sirt gives no standard errors for a lavaan configural fit.`;
}

function AlignedFactorView({ r, f }: { r: AlignmentResult; f: AlignedFactor }) {
  const lc = f.lambdaConstraints;
  const nc = f.nuConstraints;
  const multi = r.factors.length > 1;
  const t = (s: string) => (multi ? `${f.name}: ${s}` : s);
  return (
    <>
      <div className="stat-cards">
        {(
          [
            ['R², loadings', fmt(f.r2.lambda, 3)],
            ['R², intercepts', fmt(f.r2.nu, 3)],
            ['Non-invariant loadings', pct(lc.noninvariant)],
            ['Non-invariant intercepts', pct(nc.noninvariant)],
          ] as const
        ).map(([k, v]) => (
          <div className="stat-card" key={k}>
            <div className="k">{multi ? `${f.name} · ${k}` : k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <Table
        title={t('Group factor means and variances (aligned)')}
        file={`alignment-means-${f.name}`}
        columns={['Group', 'N', 'Mean', 'SD', 'Variance']}
        rows={r.groups.map(
          (g, i): Row => [
            c(g),
            c(r.n[i] ?? null, undefined, 0),
            c(f.mean[i] ?? null),
            c(f.sd[i] ?? null),
            c((f.sd[i] ?? NaN) ** 2),
          ],
        )}
        note={alignmentNote(f)}
      />
      <Table
        title={t('Effect sizes of approximate invariance')}
        file={`alignment-effects-${f.name}`}
        columns={['', 'Loadings', 'Intercepts']}
        rows={[
          [c('R²'), c(f.r2.lambda), c(f.r2.nu)],
          [c('√(1 − R²)'), c(f.sqrtU2.lambda), c(f.sqrtU2.nu)],
          [
            c('Mean correlation of aligned parameters between groups'),
            c(f.rbar.lambda),
            c(f.rbar.nu),
          ],
          [
            c(
              `Approximately non-invariant (tolerance ${fmt(lc.tolerance, 3)} / ${fmt(nc.tolerance, 3)})`,
            ),
            c(pct(lc.noninvariant)),
            c(pct(nc.noninvariant)),
          ],
        ]}
        note="R²: the share of the configural parameters’ variation across groups explained by the groups’ factor means and SDs (Asparouhov & Muthén 2014): 1 is exact invariance (metric for loadings, scalar for intercepts). Asparouhov & Muthén suggest that up to about 25% non-invariant parameters still give trustworthy aligned means."
      />
      <Table
        title={t('Aligned loadings')}
        file={`alignment-loadings-${f.name}`}
        columns={['Group', ...f.items]}
        rows={alignedRows(r, f, 'lambda')}
        note={`Each group’s loading divided by its factor SD. Bold amber: further than ${fmt(lc.tolerance, 3)} from the joint value (non-invariant).`}
      />
      <Table
        title={t('Aligned intercepts')}
        file={`alignment-intercepts-${f.name}`}
        columns={['Group', ...f.items]}
        rows={alignedRows(r, f, 'nu')}
        note={`Each group’s intercept minus its factor mean times the loading over the SD. Bold amber: further than ${fmt(nc.tolerance, 3)} from the joint value.`}
      />
      <Table
        title={t('Non-invariant parameters per item')}
        file={`alignment-items-${f.name}`}
        columns={['Item', 'Loadings', 'Intercepts']}
        rows={f.items.map(
          (it, j): Row => [
            c(it),
            c(lc.unique[j] ?? null, lc.unique[j] ? 'warn' : '', 0),
            c(nc.unique[j] ?? null, nc.unique[j] ? 'warn' : '', 0),
          ],
        )}
        note={`Groups in which the item’s aligned parameter departs from the joint value (of ${r.groups.length}).`}
      />
    </>
  );
}

function AlignmentView({ r }: { r: AlignmentResult }) {
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        sirt {r.engine.version} on the configural fit of lavaan {r.engine.lavaan ?? ''}: χ² ={' '}
        {fmt(r.fit.chisq, 2)}, df = {fmt(r.fit.df, 0)}, CFI = {fmt(r.fit.cfi, 3)}, RMSEA ={' '}
        {fmt(r.fit.rmsea, 3)}, SRMR = {fmt(r.fit.srmr, 3)}; {r.groups.length} groups, N ={' '}
        {r.n.reduce((a, b) => a + b, 0)}. Power {r.power.join(' / ')}, scale {r.scale.join(' / ')},{' '}
        {r.weights === 'sqrtN' ? '√N weights' : 'equal weights'}.
      </p>
      {r.factors.map((f) => (
        <AlignedFactorView key={f.name} r={r} f={f} />
      ))}
    </div>
  );
}

export const alignmentAnalysis: AnalysisType<AlignmentOptions, AlignmentResult> = {
  id: 'alignment',
  title: 'Alignment optimisation',
  sub: 'approximate invariance across many groups: aligned means and SDs (sirt; Asparouhov & Muthén 2014)',
  group: 'Measurement',
  defaults: () => ({ constructs: [], group: '', ...ALIGN_DEFAULTS }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          constructs: names(raw.constructs),
          group: name(raw.group),
          groupWeights: oneOf(raw.groupWeights, ['sqrtN', 'equal'] as const, 'sqrtN'),
          powerLambda: clampNum(raw.powerLambda, 0, 2, 0.5),
          powerNu: clampNum(raw.powerNu, 0, 2, 0.5),
          scaleLambda: clampNum(raw.scaleLambda, 0.01, 10, 1),
          scaleNu: clampNum(raw.scaleNu, 0.01, 10, 1),
          tolLambda: clampNum(raw.tolLambda, 0.001, 10, 0.2),
          tolNu: clampNum(raw.tolNu, 0.001, 10, 0.4),
        }
      : null,
  Options: AlignmentForm,
  View: ({ result }) => <AlignmentView r={result} />,
  blocked: (o, ctx) => {
    const fs = chosen(o.constructs, ctx);
    const b = factorsBlocked(fs, o.constructs, ctx, 'Alignment');
    if (b) return b;
    if (!o.group) return 'Choose a grouping column.';
    if (fs.some((f) => f.indicators.includes(o.group)))
      return 'The grouping column is an indicator of a chosen factor.';
    return missingColumns(ctx, [o.group], 'Alignment');
  },
  fingerprint: (o, ctx) => {
    const i = alignmentInput(o, ctx);
    return columnsFingerprint(
      ctx,
      [...i.factors.flatMap((f) => f.indicators), o.group],
      [JSON.stringify(i)],
    );
  },
  run: async (o, ctx) => (await engine()).alignmentR(rawData(ctx)!, alignmentInput(o, ctx)),
  script: async (o, ctx) =>
    (await engine()).alignmentScriptR(rawData(ctx)!, alignmentInput(o, ctx)),
  summary: (o) =>
    `${o.constructs.length ? o.constructs.join(', ') : 'all factors'} · by ${o.group || '…'}`,
};

// ---------------------------------------------------------------- moderated nonlinear factor analysis

export type MnlfaOptions = MnlfaInput;
type MnlfaRole = 'categorical' | 'intercept' | 'slope' | 'mean' | 'sd';
const ROLES: [MnlfaRole, string, string][] = [
  ['categorical', 'Categorical', 'dummy coded, the first level the reference'],
  ['intercept', 'Intercepts', 'uniform DIF'],
  ['slope', 'Slopes', 'non-uniform DIF (2PL)'],
  ['mean', 'Mean', 'the factor mean'],
  ['sd', 'SD', 'the factor’s log SD'],
];

/** The options as sent: roles of covariates no longer chosen dropped, slopes only for 2PL, moderated items among the items. */
export function mnlfaInput(o: MnlfaOptions): MnlfaInput {
  const keep = (x: string[]) => x.filter((v) => o.covariates.includes(v));
  return {
    ...o,
    categorical: keep(o.categorical),
    intercept: keep(o.intercept),
    slope: o.itemType === '2PL' ? keep(o.slope) : [],
    mean: keep(o.mean),
    sd: keep(o.sd),
    moderated: o.moderated.filter((v) => o.items.includes(v)),
  };
}

function MnlfaForm({ options: o, set, ctx, disabled }: OptionsProps<MnlfaOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names;
  const toggle = (role: MnlfaRole, v: string, on: boolean) =>
    set({ ...o, [role]: on ? [...o[role], v] : o[role].filter((x) => x !== v) });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        One factor of binary (0/1) items whose intercepts, slopes, mean and SD may depend on person
        covariates, continuous or categorical: differential item functioning and impact in one model
        (Curran et al. 2014; mnlfa, Robitzsch). mnlfa fits one factor at a time and binary items
        only, by maximum likelihood (EM), without standard errors: compare models by AIC and BIC.
      </p>
      <OrderedPicker
        label="Binary items (0/1)"
        columns={numeric.filter((n) => !o.covariates.includes(n))}
        value={o.items}
        onChange={(items) => set({ ...o, items })}
      />
      <div className="field">
        <label>Item model</label>
        <div className="segmented">
          <button
            className={o.itemType === '2PL' ? 'on' : ''}
            onClick={() => set({ ...o, itemType: '2PL' })}
          >
            2PL
          </button>
          <button
            className={o.itemType === '1PL' ? 'on' : ''}
            onClick={() => set({ ...o, itemType: '1PL' })}
          >
            1PL
          </button>
        </div>
        <div className="hint">
          P(x = 1) = invlogit(a θ − b). 2PL: a slope per item (loadings, moderable), the factor SD 1
          where the covariates are 0; 1PL: slopes 1, the SD free.
        </div>
      </div>
      <OrderedPicker
        label="Covariates (moderators)"
        columns={numeric.filter((n) => !o.items.includes(n))}
        value={o.covariates}
        onChange={(covariates) => set({ ...o, covariates })}
      />
      {o.covariates.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Covariate</th>
              {ROLES.filter(([r]) => r !== 'slope' || o.itemType === '2PL').map(([r, l, t]) => (
                <th key={r} title={t}>
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.covariates.map((v) => (
              <tr key={v}>
                <td>{v}</td>
                {ROLES.filter(([r]) => r !== 'slope' || o.itemType === '2PL').map(([r, l]) => (
                  <td key={r}>
                    <input
                      type="checkbox"
                      aria-label={`${v}: ${l}`}
                      checked={o[r].includes(v)}
                      onChange={(e) => toggle(r, v, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {o.items.length > 0 && (o.intercept.length > 0 || o.slope.length > 0) && (
        <div className="field">
          <label>Moderated items (none ticked: all)</label>
          <div>
            {o.items.map((it) => (
              <label key={it} className="check" style={{ display: 'inline-flex', marginRight: 10 }}>
                <input
                  type="checkbox"
                  checked={o.moderated.includes(it)}
                  onChange={(e) =>
                    set({
                      ...o,
                      moderated: e.target.checked
                        ? o.items.filter((x) => x === it || o.moderated.includes(x))
                        : o.moderated.filter((x) => x !== it),
                    })
                  }
                />
                <span>{it}</span>
              </label>
            ))}
          </div>
          <div className="hint">
            The other items are anchors: their intercepts and slopes do not depend on the
            covariates. A covariate of the mean (or SD) cannot also moderate the intercepts (or
            slopes) of every item.
          </div>
        </div>
      )}
    </fieldset>
  );
}

/** Why the roles cannot be identified (null when they can). */
export function mnlfaUnidentified(i: MnlfaInput): string | null {
  const all = !i.moderated.length || i.moderated.length === i.items.length;
  if (!all) return null;
  const a = i.intercept.find((v) => i.mean.includes(v));
  const b = i.slope.find((v) => i.sd.includes(v));
  if (a)
    return `${a} moderates the factor mean and the intercepts of every item: not identified. Leave at least one item unmoderated (an anchor).`;
  return b
    ? `${b} moderates the factor SD and the slopes of every item: not identified. Leave at least one item unmoderated (an anchor).`
    : null;
}

function MnlfaView({ r }: { r: MnlfaResult }) {
  const label = (term: string) => {
    if (term === '(Intercept)') return 'Intercept';
    const t = r.terms.find((x) => x.term === term);
    if (!t) return term;
    return t.level === null ? t.covariate : `${t.covariate} = ${t.level}`;
  };
  const items = [...new Set(r.items.map((p) => p.item))];
  const table = (kind: 'a' | 'b') => {
    const terms = [...new Set(r.items.filter((p) => p.kind === kind).map((p) => p.term))];
    return {
      terms,
      rows: items.map(
        (it): Row => [
          c(it),
          ...terms.map((t) => {
            const p = r.items.find((x) => x.item === it && x.kind === kind && x.term === t);
            return p ? c(p.est, p.free ? '' : 'dim') : c(null);
          }),
        ],
      ),
    };
  };
  const b = table('b');
  const a = table('a');
  const traitTerms = [...new Set(r.trait.map((t) => t.term))];
  const est = (kind: 'mu' | 'sigma', t: string) =>
    r.trait.find((x) => x.kind === kind && x.term === t)?.est;
  return (
    <div className="tables">
      <div className="stat-cards">
        {(
          [
            ['N', fmt(r.n, 0)],
            ['Deviance', fmt(r.fit.deviance, 2)],
            ['Parameters', fmt(r.fit.npar, 0)],
            ['AIC', fmt(r.fit.aic, 2)],
            ['BIC', fmt(r.fit.bic, 2)],
          ] as const
        ).map(([k, v]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        mnlfa {r.engine.version}, {r.itemType}, P(x = 1) = invlogit(a θ − b);{' '}
        {r.converged
          ? `converged in ${r.iterations} EM iterations`
          : `did NOT converge in ${r.iterations} iterations: read with care`}
        . Log-likelihood {fmt(r.fit.logLik, 2)}, AICc {fmt(r.fit.aicc, 2)}, CAIC{' '}
        {fmt(r.fit.caic, 2)}. No standard errors: compare models with and without a moderation by
        AIC and BIC (or a likelihood-ratio test on the deviances).
      </p>
      <Table
        title="Item intercepts (b) and their moderation"
        file="mnlfa-intercepts"
        columns={['Item', ...b.terms.map(label)]}
        rows={b.rows}
        note="b is the item’s threshold on the factor: higher b, harder item (fewer 1s at the same factor level). A covariate’s column: the change in b per unit of the covariate (or for the level against the reference) at the same factor level, i.e. uniform DIF. Blank: not moderated (an anchor)."
      />
      {(r.itemType === '2PL' || a.terms.length > 1) && (
        <Table
          title="Item slopes (a) and their moderation"
          file="mnlfa-slopes"
          columns={['Item', ...a.terms.map(label)]}
          rows={a.rows}
          note={
            r.itemType === '1PL'
              ? 'Fixed at 1 (1PL).'
              : 'a is the item’s discrimination (loading on the logit scale); a covariate’s column is its change per unit: non-uniform DIF.'
          }
        />
      )}
      <Table
        title="Factor mean and SD"
        file="mnlfa-trait"
        columns={['Term', 'Mean', 'Log SD', 'SD ratio']}
        rows={traitTerms.map((t): Row => {
          const s = est('sigma', t);
          return [
            c(label(t)),
            c(est('mu', t) ?? null),
            c(s ?? null),
            c(s === undefined ? null : Math.exp(s)),
          ];
        })}
        note="Impact: the factor mean’s change per unit of a covariate (0 where all covariates are 0), and of its log SD (SD ratio = exp(log SD)), after the items’ DIF is accounted for. The intercept of the log SD is free in the 1PL only."
      />
    </div>
  );
}

export const mnlfaAnalysis: AnalysisType<MnlfaOptions, MnlfaResult> = {
  id: 'mnlfa',
  title: 'Moderated nonlinear factor analysis',
  sub: 'binary items whose intercepts, slopes, mean and SD depend on covariates: DIF and impact (mnlfa)',
  group: 'Measurement',
  defaults: () => ({
    items: [],
    itemType: '2PL',
    covariates: [],
    categorical: [],
    intercept: [],
    slope: [],
    mean: [],
    sd: [],
    moderated: [],
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          items: names(raw.items),
          itemType: oneOf(raw.itemType, ['2PL', '1PL'] as const, '2PL'),
          covariates: names(raw.covariates),
          categorical: names(raw.categorical),
          intercept: names(raw.intercept),
          slope: names(raw.slope),
          mean: names(raw.mean),
          sd: names(raw.sd),
          moderated: names(raw.moderated),
        }
      : null,
  Options: MnlfaForm,
  View: ({ result }) => <MnlfaView r={result} />,
  blocked: (o, ctx) => {
    if (o.items.length < 3) return 'Choose at least three binary items.';
    if (o.items.some((x) => o.covariates.includes(x))) return 'An item cannot also be a covariate.';
    const i = mnlfaInput(o);
    if (i.covariates.some((v) => ![i.intercept, i.slope, i.mean, i.sd].some((r) => r.includes(v))))
      return 'Give every covariate a role (intercepts, slopes, mean or SD), or remove it.';
    const m = missingColumns(
      ctx,
      [...o.items, ...o.covariates],
      'Moderated nonlinear factor analysis',
    );
    if (m) return m;
    const ds = rawData(ctx)!;
    const bad = o.items.find((it) =>
      Array.from(ds.cols[ds.names.indexOf(it)]).some((v) => !Number.isNaN(v) && v !== 0 && v !== 1),
    );
    return bad ? `${bad} is not binary: the items must be coded 0 and 1.` : mnlfaUnidentified(i);
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, [...o.items, ...o.covariates], [JSON.stringify(mnlfaInput(o))]),
  run: async (o, ctx) => (await engine()).mnlfaR(rawData(ctx)!, mnlfaInput(o)),
  script: async (o, ctx) => (await engine()).mnlfaScriptR(rawData(ctx)!, mnlfaInput(o)),
  summary: (o) =>
    `${o.items.length} items · ${o.itemType}${o.covariates.length ? ` · moderated by ${o.covariates.join(', ')}` : ''}`,
};

// ---------------------------------------------------------------- local SEM

export interface LsemOptions {
  moderator: string;
  /** Focal points: `points` from `from` to `to` (null: the moderator's minimum / maximum). */
  from: number | null;
  to: number | null;
  points: number;
  h: number;
  kernel: LsemInput['kernel'];
  bootstrap: boolean;
  bootR: number;
  permutation: boolean;
  permB: number;
}
const LSEM_KERNELS = [
  ['gaussian', 'Gaussian'],
  ['epanechnikov', 'Epanechnikov'],
  ['uniform', 'Uniform'],
] as const;
const lsemModelVars = (ctx: AnalysisCtx) =>
  new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators));
/** The moderator's observed range (null when it has no values). */
export function moderatorRange(ctx: AnalysisCtx, column: string): [number, number] | null {
  const ds = rawData(ctx);
  const k = ds ? ds.names.indexOf(column) : -1;
  if (!ds || k < 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of ds.cols[k])
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  return lo <= hi ? [lo, hi] : null;
}
/** The options as sent: the focal points' range defaulting to the moderator's, the project's seed. */
export function lsemInput(o: LsemOptions, ctx: AnalysisCtx): LsemInput {
  const r = moderatorRange(ctx, o.moderator);
  return {
    moderator: o.moderator,
    from: o.from ?? r?.[0] ?? 0,
    to: o.to ?? r?.[1] ?? 1,
    points: o.points,
    h: o.h,
    kernel: o.kernel,
    bootstrap: o.bootstrap ? o.bootR : 0,
    permutations: o.permutation ? o.permB : 0,
    seed: ctx.settings.seed,
  };
}
const optNum = (v: unknown): number | null => {
  const x = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e12 ? x : null;
};

function LsemForm({ options: o, set, ctx, disabled }: OptionsProps<LsemOptions>) {
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const range = moderatorRange(ctx, o.moderator);
  const i = lsemInput(o, ctx);
  const edge = (k: 'from' | 'to', label: string) => (
    <div className="field">
      <label htmlFor={`lsem-${k}`}>{label}</label>
      <input
        id={`lsem-${k}`}
        className="input num"
        type="number"
        value={o[k] ?? ''}
        placeholder={range ? fmt(range[k === 'from' ? 0 : 1], 3) : ''}
        onChange={(e) => set({ ...o, [k]: optNum(e.target.value) })}
      />
    </div>
  );
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Local structural equation modelling (Hildebrandt et al. 2016; sirt::lsem.estimate): the
        CB-SEM model on the canvas is fitted at focal points of a continuous moderator such as age,
        each time to all cases weighted by a kernel around the point, so loadings, intercepts,
        variances and paths become curves along the moderator. Nonparametric where moderated
        nonlinear factor analysis is parametric. Continuous indicators, one group, maximum
        likelihood.
      </p>
      <ColumnSelect
        id="lsem-mod"
        label="Moderator (continuous)"
        value={o.moderator}
        columns={ds.names}
        exclude={[...lsemModelVars(ctx)]}
        onChange={(moderator) => set({ ...o, moderator, from: null, to: null })}
      />
      <div className="row2">
        {edge('from', 'First focal point')}
        {edge('to', 'Last focal point')}
        <NumField
          id="lsem-points"
          label="Focal points"
          value={o.points}
          lo={2}
          hi={100}
          int
          fallback={15}
          onChange={(points) => set({ ...o, points })}
        />
      </div>
      <div className="hint">
        {range
          ? `${o.moderator} ranges from ${fmt(range[0], 3)} to ${fmt(range[1], 3)}; blank: that range. `
          : ''}
        {o.moderator
          ? `${i.points} focal points, every ${fmt((i.to - i.from) / Math.max(1, i.points - 1), 3)}.`
          : ''}
      </div>
      <div className="row2">
        <NumField
          id="lsem-h"
          label="Bandwidth factor h"
          value={o.h}
          lo={0.05}
          hi={20}
          step={0.1}
          fallback={1.1}
          onChange={(h) => set({ ...o, h })}
        />
      </div>
      <div className="hint">
        The kernel’s bandwidth is h × SD(moderator) × N^(−1/5) (sirt’s default h = 1.1; Hildebrandt
        et al. use about 2). Smaller h follows the data more closely, with noisier curves.
      </div>
      <Choice
        label="Kernel"
        value={o.kernel}
        options={LSEM_KERNELS}
        onChange={(kernel) => set({ ...o, kernel })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.bootstrap}
          onChange={(e) => set({ ...o, bootstrap: e.target.checked })}
        />
        <span>
          Bootstrap standard errors and intervals
          <br />
          <span className="hint">
            lsem.bootstrap: the cases resampled and the model refitted at every focal point; 95%
            intervals (estimate ± 1.96 SE) as bands on the curves.
          </span>
        </span>
      </label>
      {o.bootstrap && (
        <NumField
          id="lsem-R"
          label="Bootstrap samples"
          value={o.bootR}
          lo={10}
          hi={5000}
          int
          fallback={100}
          onChange={(bootR) => set({ ...o, bootR })}
        />
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={o.permutation}
          onChange={(e) => set({ ...o, permutation: e.target.checked })}
        />
        <span>
          Permutation test of invariance
          <br />
          <span className="hint">
            lsem.permutationTest: the moderator permuted across cases; a parameter is non-invariant
            when it varies more along the real moderator than along the permuted ones.
          </span>
        </span>
      </label>
      {o.permutation && (
        <NumField
          id="lsem-B"
          label="Permutations"
          value={o.permB}
          lo={10}
          hi={5000}
          int
          fallback={100}
          onChange={(permB) => set({ ...o, permB })}
        />
      )}
      {(o.bootstrap || o.permutation) && (
        <div className="hint">
          Each resample refits the model at all {i.points} focal points; the seed is the project’s (
          {ctx.settings.seed}).
        </div>
      )}
    </fieldset>
  );
}

type LsemKind =
  | 'loading'
  | 'path'
  | 'intercept'
  | 'mean'
  | 'residual'
  | 'variance'
  | 'covariance'
  | 'fit';
const LSEM_KINDS: [LsemKind, string][] = [
  ['loading', 'Loadings'],
  ['intercept', 'Intercepts'],
  ['residual', 'Residual variances'],
  ['variance', 'Factor variances'],
  ['mean', 'Factor means'],
  ['path', 'Paths'],
  ['covariance', 'Covariances'],
  ['fit', 'Fit'],
];
/** What a parameter is: factors are the left sides of =~. */
export function lsemKind(p: LsemParam, factors: Set<string>): LsemKind {
  if (p.op === 'fit') return 'fit';
  if (p.op === '=~') return 'loading';
  if (p.op === '~') return 'path';
  if (p.op === '~1') return factors.has(p.lhs) ? 'mean' : 'intercept';
  if (p.lhs !== p.rhs) return 'covariance';
  return factors.has(p.lhs) ? 'variance' : 'residual';
}
export const lsemLabel = (p: LsemParam) => {
  if (p.op === 'fit') return p.par.toUpperCase();
  if (p.op === '~1') return `${p.lhs} ~1`;
  return `${p.lhs} ${p.op} ${p.rhs}`;
};

function LsemChart({ r, params, kind }: { r: LsemResult; params: LsemParam[]; kind: string }) {
  const band = (p: LsemParam, i: number) =>
    p.boot ? [p.boot.lower[i], p.boot.upper[i]] : [null, null];
  const vals = params
    .flatMap((p) => p.est.flatMap((v, i) => [v, ...band(p, i)]))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const padY = (hi - lo) * 0.05 || Math.abs(hi) * 0.05 || 0.1;
  const ys: [number, number] = [lo - padY, hi + padY];
  const xs: [number, number] = [r.grid[0], r.grid[r.grid.length - 1]];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const perRow = 3;
  const legendH = Math.ceil(params.length / perRow) * 16 + 8;
  const HT = H + legendH;
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return (
    <ChartFrame
      id={`lsem:${kind}`}
      name={`lsem-${kind}`}
      width={W}
      height={HT}
      defaults={{ x: r.moderator, y: LSEM_KINDS.find(([k]) => k === kind)?.[1] ?? 'Estimate' }}
      caption={
        <span className="hint">
          Each line: the parameter estimated at the focal points of {r.moderator}
          {r.bootstrap ? `; bands: bootstrap 95% intervals (${r.bootstrap} samples)` : ''}. A flat
          line is an invariant parameter.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={HT}
          role="img"
          aria-label={`Local SEM: ${kind} along ${r.moderator}`}
        >
          <Axes xs={xs} ys={ys} xTitle={labels.x} yTitle={labels.y} />
          {params.map((p, k) => {
            const idx = r.grid.map((_, i) => i).filter((i) => fin(p.est[i]));
            const b = p.boot
              ? idx.filter((i) => fin(p.boot!.lower[i]) && fin(p.boot!.upper[i]))
              : [];
            return (
              <g key={p.par}>
                {b.length > 1 && (
                  <polygon
                    points={[
                      ...b.map((i) => `${sx(r.grid[i])},${sy(p.boot!.upper[i]!)}`),
                      ...[...b].reverse().map((i) => `${sx(r.grid[i])},${sy(p.boot!.lower[i]!)}`),
                    ].join(' ')}
                    fill={seriesColor(k)}
                    fillOpacity={0.14}
                  />
                )}
                <polyline
                  points={idx.map((i) => `${sx(r.grid[i])},${sy(p.est[i])}`).join(' ')}
                  fill="none"
                  stroke={seriesColor(k)}
                  strokeWidth={2}
                >
                  <title>{lsemLabel(p)}</title>
                </polyline>
              </g>
            );
          })}
          {params.map((p, k) => {
            const x = pad.l + (k % perRow) * ((W - pad.l - pad.r) / perRow);
            const y = H + 12 + Math.floor(k / perRow) * 16;
            return (
              <g key={`l${p.par}`}>
                <line
                  x1={x}
                  x2={x + 18}
                  y1={y - 4}
                  y2={y - 4}
                  stroke={seriesColor(k)}
                  strokeWidth={2.5}
                />
                <text x={x + 24} y={y}>
                  {lsemLabel(p)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

function LsemView({ r }: { r: LsemResult }) {
  const factors = new Set(r.params.filter((p) => p.op === '=~').map((p) => p.lhs));
  const kinds = LSEM_KINDS.filter(([k]) => r.params.some((p) => lsemKind(p, factors) === k));
  const [pick, setPick] = useState<LsemKind>(kinds[0]?.[0] ?? 'loading');
  const kind = kinds.some(([k]) => k === pick) ? pick : (kinds[0]?.[0] ?? 'loading');
  const shown = r.params.filter((p) => lsemKind(p, factors) === kind);
  const model = r.params.filter((p) => p.op !== 'fit');
  const perm = r.permutations > 0;
  // The permutation p values of a parameter's variation (blank where it has none).
  const permutationCells = (t: LsemParam['test']) => {
    if (!perm) return [];
    if (!t) return [c(null), c(null), c(null)];
    return [pCell(t.sdP), pCell(t.madP), pCell(t.linSlopeP)];
  };
  const g = (v: number) => fmt(v, 3);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        sirt {r.engine.version} with lavaan {r.engine.lavaan ?? ''}: N = {r.n}, {r.grid.length}{' '}
        focal points of {r.moderator} from {g(r.grid[0])} to {g(r.grid[r.grid.length - 1])};{' '}
        {r.kernel} kernel, h = {g(r.h)}, bandwidth {g(r.bw)}.
        {r.bootstrap ? ` Bootstrap: ${r.bootstrap} samples.` : ''}
        {perm ? ` Permutation test: ${r.permutations} permutations.` : ''}
        {r.bootstrap || perm ? ` Seed ${r.seed}.` : ''}
      </p>
      <div className="field">
        <div className="segmented">
          {kinds.map(([k, l]) => (
            <button key={k} className={k === kind ? 'on' : ''} onClick={() => setPick(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <LsemChart r={r} params={shown} kind={kind} />
      <Table
        title="Variation of the parameters along the moderator"
        file="lsem-variation"
        columns={[
          'Parameter',
          'Mean',
          'SD',
          'MAD',
          'Min',
          'Max',
          'Linear slope',
          'SD (nonlinear)',
          ...(perm ? ['p (SD)', 'p (MAD)', 'p (slope)'] : []),
        ]}
        rows={r.params
          .filter((p) => p.summary)
          .map((p): Row => {
            const s = p.summary!;
            const t = p.test;
            return [
              c(lsemLabel(p)),
              c(s.mean),
              c(s.sd),
              c(s.mad),
              c(s.min),
              c(s.max),
              c(s.linSlope),
              c(s.sdNonlin),
              ...permutationCells(t),
            ];
          })}
        note={`Over the focal points, weighted by the moderator’s density there (sirt’s parameters_summary): the mean, SD and mean absolute deviation (MAD) of each parameter’s curve, its range, the slope of a weighted linear regression on ${r.moderator} and the SD of what that line leaves.${perm ? ` p: the share of the ${r.permutations} permutations of ${r.moderator} in which the statistic was at least as large (lsem.permutationTest): a small p for the SD or MAD says the parameter is not invariant along ${r.moderator}; for the slope, that it changes linearly.` : ' Tick the permutation test for p values of this variation.'}`}
      />
      <Table
        title="Estimates at the focal points"
        file="lsem-estimates"
        columns={['Parameter', ...r.grid.map(g)]}
        rows={r.params.map((p): Row => [c(lsemLabel(p)), ...p.est.map((v) => c(v))])}
        note={`Each column: the model fitted to all cases weighted by the kernel around that value of ${r.moderator}. Effective sample sizes: ${r.neff.map((v) => fmt(v, 0)).join(', ')}.`}
      />
      {r.bootstrap > 0 && (
        <Table
          title="Bootstrap standard errors at the focal points"
          file="lsem-boot-se"
          columns={['Parameter', ...r.grid.map(g)]}
          rows={model.map((p): Row => [c(lsemLabel(p)), ...(p.boot?.se ?? []).map((v) => c(v))])}
          note={`The SD of the estimates over ${r.bootstrap} bootstrap samples (lsem.bootstrap); the bands of the chart are estimate ± 1.96 SE, as sirt computes them.`}
        />
      )}
      {perm && (
        <Table
          title="Pointwise permutation p values"
          file="lsem-pointwise"
          columns={['Parameter', ...r.grid.map(g)]}
          rows={model
            .filter((p) => p.test)
            .map(
              (p): Row => [
                c(lsemLabel(p)),
                ...p.test!.pointwise.map((v) => (v === null ? c(null) : pCell(v))),
              ],
            )}
          note={`At each focal point, how often the permuted data put the parameter as far from its mean over the focal points (lsem.permutationTest’s pointwise test): where along ${r.moderator} a parameter departs.`}
        />
      )}
      <Table
        title="Focal points"
        file="lsem-focal"
        columns={[r.moderator, 'Density weight', 'Effective N']}
        rows={r.grid.map(
          (x, i): Row => [c(x), c(r.weight[i] ?? null), c(r.neff[i] ?? null, undefined, 1)],
        )}
        note="The moderator’s estimated density at each focal point (summing to 1; it weights the summaries above) and the effective sample size of the local fit, (Σw)² / Σw²."
      />
    </div>
  );
}

export const lsemAnalysis: AnalysisType<LsemOptions, LsemResult> = {
  id: 'lsem',
  title: 'Local SEM',
  group: 'Measurement',
  fitsModel: true,
  sub: 'the model’s loadings, intercepts, variances and paths as curves along a continuous moderator, with bootstrap bands and a permutation test of invariance (sirt)',
  defaults: () => ({
    moderator: '',
    from: null,
    to: null,
    points: 15,
    h: 1.1,
    kernel: 'gaussian',
    bootstrap: false,
    bootR: 100,
    permutation: true,
    permB: 100,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          moderator: name(raw.moderator),
          from: optNum(raw.from),
          to: optNum(raw.to),
          points: clampNum(raw.points, 2, 100, 15, true),
          h: clampNum(raw.h, 0.05, 20, 1.1),
          kernel: oneOf(
            raw.kernel,
            LSEM_KERNELS.map(([k]) => k),
            'gaussian',
          ),
          bootstrap: flag(raw.bootstrap),
          bootR: clampNum(raw.bootR, 10, 5000, 100, true),
          permutation: raw.permutation === undefined ? true : flag(raw.permutation),
          permB: clampNum(raw.permB, 10, 5000, 100, true),
        }
      : null,
  Options: LsemForm,
  View: ({ result }) => <LsemView r={result} />,
  blocked: (o, ctx) => {
    const m = cbModelBlocked(ctx, 'Local SEM');
    if (m) return m;
    if (ctx.model?.multigroup)
      return 'Local SEM moderates one sample by a continuous variable: remove the grouping (Model tab).';
    if (ctx.model?.ordered?.length)
      return 'Local SEM here is for continuous indicators; the model has ordinal ones.';
    if (!['ML', 'MLR'].includes(ctx.settings.estimator))
      return 'Local SEM fits each focal point by maximum likelihood: choose ML or MLR (Model settings).';
    if (['pairwise', 'twostage', 'robusttwostage', 'mi'].includes(ctx.settings.missing))
      return 'Local SEM handles missing values by FIML, casewise deletion or mean replacement (Model settings).';
    if (!o.moderator) return 'Choose the moderator.';
    if (lsemModelVars(ctx).has(o.moderator))
      return `${o.moderator} is a variable of the model, not a moderator.`;
    const miss = missingColumns(ctx, [o.moderator], 'Local SEM');
    if (miss) return miss;
    const i = lsemInput(o, ctx);
    return i.from < i.to ? null : 'The last focal point must be above the first.';
  },
  fingerprint: (o, ctx) => {
    const m = cbFingerprint(ctx);
    const col = columnsFingerprint(ctx, [o.moderator]);
    return m && col && fingerprint([m, col, JSON.stringify(lsemInput(o, ctx))]);
  },
  run: async (o, ctx) => (await engine()).lsemR(cbCall(ctx), lsemInput(o, ctx)),
  script: async (o, ctx) => (await engine()).lsemScriptR(cbCall(ctx), lsemInput(o, ctx)),
  summary: (o) => {
    const bootstrap = o.bootstrap ? ` · bootstrap ${o.bootR}` : '';
    const permutation = o.permutation ? ` · ${o.permB} permutations` : '';
    return `along ${o.moderator || '…'} · ${o.points} focal points, h = ${o.h}${bootstrap}${permutation}`;
  },
};

// ---------------------------------------------------------------- effect sizes of non-invariance (dMACS)

export interface DmacsOptions {
  /** The reference group as the data shows it (a category name or a value); empty: the first group. */
  reference: string;
  sd: DmacsInput['sd'];
}

/** A group of the grouping column: its name as shown and its lavaan label (the code in the data). */
export interface ModelGroup {
  name: string;
  label: string;
}

/** The grouping column's groups in order of appearance (lavaan's order). */
export function modelGroups(ctx: AnalysisCtx): ModelGroup[] {
  const ds = rawData(ctx);
  const column = ctx.model?.multigroup?.column ?? '';
  const k = ds ? ds.names.indexOf(column) : -1;
  if (!ds || k < 0) return [];
  const categories = ds.categories?.[column];
  const seen = new Set<number>();
  const out: ModelGroup[] = [];
  for (const v of ds.cols[k]) {
    if (!Number.isFinite(v) || seen.has(v)) continue;
    seen.add(v);
    out.push({ label: String(v), name: categories?.[v - 1] ?? String(v) });
  }
  return out;
}

/** The options as sent: the reference group by its lavaan label (null: the first group). */
export function dmacsInput(o: DmacsOptions, ctx: AnalysisCtx): DmacsInput {
  const group = modelGroups(ctx).find((g) => g.name === o.reference);
  return { reference: group?.label ?? null, sd: o.sd };
}

const DMACS_SD = [
  ['pooled', 'Pooled'],
  ['reference', 'Reference group'],
] as const;

function DmacsForm({ options: o, set, ctx, disabled }: OptionsProps<DmacsOptions>) {
  const groups = modelGroups(ctx);
  const sdHint =
    o.sd === 'pooled'
      ? 'Each item’s pooled within-group SD of the two groups compared (Nye & Drasgow 2011).'
      : 'Each item’s SD in the reference group (as Glass’s Δ).';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        How large is the non-invariance? For each item, the expected scores implied by the reference
        and a focal group’s loadings and intercepts are compared over the focal group’s factor
        distribution (dMACS, Nye &amp; Drasgow 2011; signed dMACS and the expected bias in item and
        scale means and variances, Nye et al. 2019). Uses the multigroup CB-SEM model on the canvas
        as the Model tab fits it: configural, or partial invariance with the non-invariant loadings
        and intercepts freed (Groups); parameters held equal give no effect.
      </p>
      {groups.length > 0 && (
        <div className="field">
          <label htmlFor="dmacs-ref">Reference group</label>
          <select
            id="dmacs-ref"
            className="select"
            value={o.reference || groups[0].name}
            onChange={(e) => set({ ...o, reference: e.target.value })}
          >
            {groups.map((g) => (
              <option key={g.label} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="hint">Every other group is a focal group, compared with this one.</div>
        </div>
      )}
      <Choice
        label="Standard deviation (denominator)"
        value={o.sd}
        options={DMACS_SD}
        onChange={(sd) => set({ ...o, sd })}
        hint={sdHint}
      />
    </fieldset>
  );
}

/** dMACS from .2 is marked (read like Cohen’s d). */
const DMACS_MARK = 0.2;

function dmacsItemRow(x: DmacsItem): Row {
  const marked = x.dmacs >= DMACS_MARK;
  return [
    c(x.factor),
    c(x.item),
    c(x.lambdaRef),
    c(x.lambdaFocal),
    c(x.nuRef),
    c(x.nuFocal),
    c(x.sd),
    { ...c(x.dmacs), cls: marked ? 'warn' : '', bold: marked },
    c(x.signed),
    c(x.meanBias),
    c(x.varBias),
  ];
}

function DmacsItemTable({ r, focal, many }: { r: DmacsResult; focal: string; many: boolean }) {
  const ref = r.reference;
  const title = many ? `dMACS by item: ${focal} against ${ref}` : 'dMACS by item';
  const columns = [
    'Factor',
    'Item',
    `λ ${ref}`,
    `λ ${focal}`,
    `ν ${ref}`,
    `ν ${focal}`,
    'SD',
    'dMACS',
    'Signed dMACS',
    'Mean bias',
    'Variance bias',
  ];
  const note =
    `dMACS: the root mean square difference between the item’s expected scores under ${focal}’s ` +
    `and ${ref}’s loadings (λ) and intercepts (ν), over ${focal}’s factor distribution, in SD units; ` +
    `read it like Cohen’s d (0: invariant; amber from ${DMACS_MARK}). Signed dMACS: the mean difference ` +
    `(${focal} − ${ref}) in SD units, so that differences in opposite directions can cancel across items; ` +
    'mean bias: the same in the item’s units; variance bias: the bias in the item’s variance, ' +
    `φ(λ²_${focal} − λ²_${ref}). Integrated numerically over a normal factor with ${focal}’s ` +
    'model-implied mean and variance, as the dmacs package does.';
  return (
    <Table
      title={title}
      file={many ? `dmacs-items-${focal}` : 'dmacs-items'}
      columns={columns}
      rows={r.items.filter((x) => x.focal === focal).map(dmacsItemRow)}
      note={note}
    />
  );
}

function DmacsView({ r }: { r: DmacsResult }) {
  const focal = r.groups.filter((g) => g !== r.reference);
  const many = focal.length > 1;
  const sizes = r.groups.map((g, i) => `${r.n[i]} (${g})`).join(', ');
  const focalText = many ? `focal groups ${focal.join(', ')}` : `focal group ${focal[0]}`;
  const sdText = r.sd === 'pooled' ? 'pooled within-group SDs' : 'the reference group’s SDs';
  const scaleColumns = [
    ...(many ? ['Focal group'] : []),
    'Factor',
    'Items',
    'Factor mean (focal)',
    'Factor variance (focal)',
    'Mean bias',
    'Variance bias',
  ];
  const scaleRows = r.scales.map(
    (x): Row => [
      ...(many ? [c(x.focal)] : []),
      c(x.factor),
      c(x.items, undefined, 0),
      c(x.kappa),
      c(x.phi),
      c(x.meanBias),
      c(x.varBias),
    ],
  );
  const scaleNote =
    'The sum of each factor’s items: how much higher (positive) or lower the focal group’s mean ' +
    `and variance of that sum are than they would be with ${r.reference}’s item parameters at the same factor ` +
    'distribution (Nye & Drasgow 2011, equations 4–9). The mean bias is the items’ mean biases summed; the ' +
    'variance bias φ((Σλ_focal)² − (Σλ_reference)²).';
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        Reference group {r.reference}; {focalText}. N = {sizes}. lavaan {r.engine.version}; {sdText}
        .
      </p>
      {focal.map((f) => (
        <DmacsItemTable key={f} r={r} focal={f} many={many} />
      ))}
      <Table
        title="Expected bias in the scale scores"
        file="dmacs-scales"
        columns={scaleColumns}
        rows={scaleRows}
        note={scaleNote}
      />
    </div>
  );
}

function dmacsBlocked(o: DmacsOptions, ctx: AnalysisCtx): string | null {
  const m = cbModelBlocked(ctx, 'dMACS');
  if (m) return m;
  const mg = ctx.model?.multigroup;
  if (!mg?.column) {
    return 'dMACS compares groups: choose a grouping column under Groups (Model inspector, with nothing selected).';
  }
  if (mg.meanStructure === false)
    return 'dMACS needs the groups’ intercepts: keep the mean structure under Groups.';
  if (ctx.model?.ordered?.length)
    return 'dMACS here is for continuous indicators; the model has ordinal ones.';
  if (ctx.model?.multilevel) return 'dMACS is not available for two-level models.';
  const groups = modelGroups(ctx);
  if (groups.length < 2) return 'The grouping column has fewer than two groups.';
  if (o.reference && !groups.some((g) => g.name === o.reference))
    return `${o.reference} is not a group of ${mg.column}.`;
  return null;
}

export const dmacsAnalysis: AnalysisType<DmacsOptions, DmacsResult> = {
  id: 'dmacs',
  title: 'Effect sizes of non-invariance (dMACS)',
  group: 'Measurement',
  fitsModel: true,
  sub:
    'how large the differences in loadings and intercepts between the model’s groups are: dMACS, signed dMACS, ' +
    'bias in item and scale means and variances',
  defaults: () => ({ reference: '', sd: 'pooled' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    return {
      reference: name(raw.reference),
      sd: oneOf(raw.sd, ['pooled', 'reference'] as const, 'pooled'),
    };
  },
  Options: DmacsForm,
  View: ({ result }) => <DmacsView r={result} />,
  blocked: dmacsBlocked,
  fingerprint: (o, ctx) => {
    const m = cbFingerprint(ctx);
    return m && fingerprint([m, JSON.stringify(dmacsInput(o, ctx))]);
  },
  run: async (o, ctx) => (await engine()).dmacsR(cbCall(ctx), dmacsInput(o, ctx)),
  script: async (o, ctx) => (await engine()).dmacsScriptR(cbCall(ctx), dmacsInput(o, ctx)),
  summary: (o) => {
    const sd = o.sd === 'pooled' ? 'pooled SD' : 'reference SD';
    return `reference ${o.reference || 'the first group'} · ${sd}`;
  },
};

/** Open the Analyses tab on the dMACS card: the existing one, or a new one. */
export async function openDmacsCard() {
  const { addAnalysis, selectCard, useAnalyses } = await import('./store');
  const { useStore } = await import('../store');
  const existing = useAnalyses
    .getState()
    .cards.find((k) => k.kind === 'analysis' && k.type === 'dmacs');
  if (existing) selectCard(existing.id);
  else addAnalysis('dmacs');
  useStore.getState().setWorkspace('analyses');
}

// ---------------------------------------------------------------- longitudinal invariance

export interface LongInvarianceOptions {
  factor: string;
  occasions: string[][];
  lag: LongInvarianceInput['lag'];
}
export const longInvarianceInput = (
  o: LongInvarianceOptions,
  ctx: AnalysisCtx,
): LongInvarianceInput => ({
  factor: o.factor.trim() || 'F',
  occasions: o.occasions,
  lag: o.lag,
  ...invLavaan(ctx),
});

function LongInvarianceForm({
  options: o,
  set,
  ctx,
  disabled,
}: OptionsProps<LongInvarianceOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const used = o.occasions.flat();
  const found = detectOccasions(d.names);
  const setOcc = (k: number, v: string[]) =>
    set({ ...o, occasions: o.occasions.map((x, j) => (j === k ? v : x)) });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        One factor measured by the same items at several occasions: the configural, metric (equal
        loadings), scalar (+ equal intercepts) and strict (+ equal residual variances) models, each
        item’s residuals correlated across occasions, built by semTools::measEq.syntax and compared
        like the multigroup sequence. {lavaanHint(ctx)}
      </p>
      <div className="field">
        <label htmlFor="li-factor">Factor name</label>
        <input
          id="li-factor"
          className="input"
          value={o.factor}
          maxLength={60}
          onChange={(e) => set({ ...o, factor: e.target.value })}
        />
      </div>
      <div className="table-tools">
        <button
          className="btn sm"
          disabled={!found.occasions.length}
          onClick={() => set({ ...o, occasions: found.occasions })}
          title={
            found.occasions.length
              ? `Columns named like item_t1, item_t2: ${found.occasions.length} occasions of ${found.occasions[0].length} items`
              : 'No columns named like x1_t1, x1_t2 (or x1.1, x1.2; x1_w1, x1_w2)'
          }
        >
          Recognise repeated items
          {found.occasions.length
            ? ` (${found.occasions.length} × ${found.occasions[0].length})`
            : ''}
        </button>
        <button className="btn sm" onClick={() => set({ ...o, occasions: [...o.occasions, []] })}>
          Add occasion
        </button>
      </div>
      {o.occasions.map((occ, k) => (
        <div key={k}>
          <OrderedPicker
            label={`Occasion ${k + 1}: indicators (item order as at occasion 1)`}
            columns={d.names.filter((n) => !used.includes(n) || occ.includes(n))}
            value={occ}
            onChange={(v) => setOcc(k, v)}
          />
          {o.occasions.length > 2 && (
            <button
              className="btn sm ghost"
              onClick={() => set({ ...o, occasions: o.occasions.filter((_, j) => j !== k) })}
            >
              Remove occasion {k + 1}
            </button>
          )}
        </div>
      ))}
      <div className="field">
        <label>Residual correlations of the same item</label>
        <div className="segmented">
          <button className={o.lag === 'all' ? 'on' : ''} onClick={() => set({ ...o, lag: 'all' })}>
            All occasions
          </button>
          <button
            className={o.lag === 'adjacent' ? 'on' : ''}
            onClick={() => set({ ...o, lag: 'adjacent' })}
          >
            Adjacent occasions
          </button>
        </div>
      </div>
    </fieldset>
  );
}

/** The lavaan syntax of each level as measEq.syntax generated it: read-only, one level at a time, copyable. */
export function GeneratedSyntax({
  r,
  title = 'Generated lavaan syntax (semTools::measEq.syntax)',
}: {
  r: { levels: { level: string; syntax?: string }[] };
  title?: string;
}) {
  const levels = r.levels.filter((l) => typeof l.syntax === 'string' && l.syntax.length > 0);
  const [pick, setPick] = useState(levels[0]?.level ?? '');
  if (!levels.length) return null;
  const shown = levels.find((l) => l.level === pick) ?? levels[0];
  const text = shown.syntax!;
  const copy = async () => {
    const { useStore } = await import('../store');
    try {
      await navigator.clipboard.writeText(text);
      useStore.getState().toast('success', 'Copied.');
    } catch {
      useStore
        .getState()
        .toast('error', 'The browser did not allow copying; select the text instead.');
    }
  };
  return (
    <details className="generated-syntax">
      <summary>{title}</summary>
      <div className="table-tools">
        <div className="segmented" role="tablist" aria-label="Invariance level">
          {levels.map((l) => (
            <button
              key={l.level}
              role="tab"
              aria-selected={l.level === shown.level}
              className={l.level === shown.level ? 'on' : ''}
              onClick={() => setPick(l.level)}
            >
              {l.level}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button
          className="btn sm ghost"
          title="Copy this level's syntax"
          onClick={() => void copy()}
        >
          <IconCopy size={13} /> Copy
        </button>
      </div>
      <pre className="r-script" aria-label={`lavaan syntax of the ${shown.level} model`}>
        {text.split('\n').map((line, i) => (
          <div key={i} className={line.trimStart().startsWith('#') ? 'cm' : undefined}>
            {line || ' '}
          </div>
        ))}
      </pre>
      <p className="hint">
        Every parameter is written out, equality constraints as shared labels: lavaan(syntax, data =
        …) with the same estimator and missing-data option fits this model again (the R script of
        the card does so too).
      </p>
    </details>
  );
}

function LongInvarianceView({ r, o }: { r: LongInvarianceResult; o?: LongInvarianceOptions }) {
  const scalar = r.levels.find((l) => l.level === 'scalar');
  const se = (v?: number) => (v === undefined ? c('fixed', 'dim') : c(v));
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.occasions} occasions × {r.items} items, N = {r.n}; semTools {r.engine.version}{' '}
        (measEq.syntax), lavaan {r.engine.lavaan ?? ''}. Residuals of the same item correlated
        across {r.lag === 'all' ? 'all occasions' : 'adjacent occasions'}.
      </p>
      <InvarianceTable
        inv={r}
        title={`Longitudinal measurement invariance${o?.factor ? ` of ${o.factor}` : ''}`}
        file="longitudinal-invariance"
        constraints="Each model adds equality constraints across occasions to the one before (loadings; intercepts; residual variances); the factor is standardised at the first occasion, its later means and variances freed as the constraints identify them."
      />
      {scalar && (
        <Table
          title="Factor means and variances under scalar invariance"
          file="longitudinal-invariance-means"
          columns={['Occasion', 'Mean', 'SE', 'Variance', 'SE']}
          rows={scalar.factor.map(
            (f, t): Row => [
              c(t + 1, undefined, 0),
              c(f.mean),
              se(f.meanSe),
              c(f.variance),
              se(f.varianceSe),
            ],
          )}
          note="On the scale of the first occasion (mean 0, variance 1): with equal loadings and intercepts, the later means are change in SD units of occasion 1. Read them only if scalar invariance holds (or nearly)."
        />
      )}
      <GeneratedSyntax r={r} />
    </div>
  );
}

export const longInvarianceAnalysis: AnalysisType<LongInvarianceOptions, LongInvarianceResult> = {
  id: 'longinvariance',
  title: 'Longitudinal invariance',
  sub: 'configural → metric → scalar → strict over occasions, correlated item residuals (semTools::measEq.syntax)',
  group: 'Longitudinal',
  defaults: (ctx) => {
    const f = detectOccasions(rawData(ctx)?.names ?? []);
    return { factor: 'F', occasions: f.occasions.length ? f.occasions : [[], []], lag: 'all' };
  },
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          factor: name(raw.factor, 60),
          occasions: (Array.isArray(raw.occasions) ? raw.occasions.slice(0, 50) : []).map((x) =>
            names(x),
          ),
          lag: oneOf(raw.lag, ['all', 'adjacent'] as const, 'all'),
        }
      : null,
  Options: LongInvarianceForm,
  View: ({ result, options }) => <LongInvarianceView r={result} o={options} />,
  blocked: (o, ctx) => {
    const occ = o.occasions.filter((x) => x.length);
    if (occ.length < 2) return 'Choose the indicators at two or more occasions.';
    if (occ.length < o.occasions.length)
      return 'An occasion has no indicators: choose them, or remove the occasion.';
    if (occ.some((x) => x.length < 2)) return 'Each occasion needs at least two indicators.';
    if (new Set(occ.map((x) => x.length)).size > 1)
      return 'Every occasion needs the same number of indicators (item k of each occasion is the same item).';
    const all = occ.flat();
    if (new Set(all).size < all.length) return 'A column appears at more than one occasion.';
    return missingColumns(ctx, all, 'Longitudinal invariance');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, o.occasions.flat(), [JSON.stringify(longInvarianceInput(o, ctx))]),
  run: async (o, ctx) =>
    (await engine()).longInvarianceR(rawData(ctx)!, longInvarianceInput(o, ctx)),
  script: async (o, ctx) =>
    (await engine()).longInvarianceScriptR(rawData(ctx)!, longInvarianceInput(o, ctx)),
  summary: (o) =>
    `${o.factor.trim() || 'F'} · ${o.occasions.length} occasions × ${o.occasions[0]?.length ?? 0} items`,
};

// ---------------------------------------------------------------- DIF by MIMIC

export interface MimicDifOptions {
  construct: string;
  covariate: string;
  adjust: MimicDifInput['adjust'];
  alpha: number;
  free: boolean;
}
const ADJUST: [MimicDifInput['adjust'], string][] = [
  ['holm', 'Holm'],
  ['BH', 'Benjamini–Hochberg'],
  ['bonferroni', 'Bonferroni'],
  ['none', 'None'],
];
const mimicFactor = (o: MimicDifOptions, ctx: AnalysisCtx) =>
  modelFactors(ctx).filter((f) => f.name === o.construct);
export const mimicDifInput = (o: MimicDifOptions, ctx: AnalysisCtx): MimicDifInput => ({
  factors: mimicFactor(o, ctx),
  covariate: o.covariate,
  adjust: o.adjust,
  alpha: o.alpha,
  free: o.free,
  ...invLavaan(ctx),
});

function MimicDifForm({ options: o, set, ctx, disabled }: OptionsProps<MimicDifOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const inds = mimicFactor(o, ctx).flatMap((f) => f.indicators);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Uniform DIF by MIMIC: the factor is regressed on a covariate (a group coded 0/1, or a
        continuous one such as age), and each item’s direct effect from the covariate is tested:
        does the item differ between groups beyond what the factor difference explains? Score tests
        from the model without direct effects, and one model per item with its direct path (Wald z,
        likelihood-ratio test), corrected for the number of items. {lavaanHint(ctx)}
      </p>
      <FactorPicker
        single
        value={o.construct ? [o.construct] : []}
        onChange={(v) => set({ ...o, construct: v[0] ?? '' })}
        ctx={ctx}
      />
      <ColumnSelect
        id="mimic-cov"
        label="Covariate (binary group or continuous)"
        value={o.covariate}
        columns={d.names}
        exclude={inds}
        onChange={(covariate) => set({ ...o, covariate })}
      />
      <div className="field">
        <label>Correction of the p-values</label>
        <div className="segmented">
          {ADJUST.map(([id, l]) => (
            <button
              key={id}
              className={o.adjust === id ? 'on' : ''}
              onClick={() => set({ ...o, adjust: id })}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="hint">
          Holm and Bonferroni control the familywise error over the items; Benjamini–Hochberg the
          false discovery rate (p.adjust).
        </div>
      </div>
      <NumField
        id="mimic-alpha"
        label="Significance level"
        value={o.alpha}
        lo={0.001}
        hi={0.5}
        step={0.01}
        onChange={(alpha) => set({ ...o, alpha })}
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.free}
          onChange={(e) => set({ ...o, free: e.target.checked })}
        />
        <span>
          Free the flagged items’ direct effects in a final model
          <br />
          <span className="hint">
            The factor’s difference by the covariate, corrected for that DIF (partial invariance).
          </span>
        </span>
      </label>
    </fieldset>
  );
}

const effectRow = (label: string, e: MimicEffect): Row => [
  c(label),
  c(e.est),
  c(e.se),
  c(e.z),
  pCell(e.p),
  c(e.std),
];
function MimicDifView({ r }: { r: MimicDifResult }) {
  const fit = (f: MimicDifResult['fit']) =>
    `χ² = ${fmt(f.chisq, 2)}, df = ${fmt(f.df, 0)}, CFI = ${fmt(f.cfi, 3)}, RMSEA = ${fmt(f.rmsea, 3)}, SRMR = ${fmt(f.srmr, 3)}`;
  const adj = ADJUST.find(([id]) => id === r.adjust)?.[1] ?? r.adjust;
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.factor} regressed on {r.covariate}, N = {r.n}; lavaan {r.engine.version}. Model without
        direct effects: {fit(r.fit)}.
      </p>
      <Table
        title={`Uniform DIF: direct effects of ${r.covariate} on the items of ${r.factor}`}
        file="mimic-dif"
        columns={[
          'Item',
          'Direct effect',
          'SE',
          'z',
          'p (Wald)',
          'Standardised',
          'LR χ²',
          'p (LR)',
          `p (${adj})`,
          'Score χ²',
          'p (score)',
        ]}
        rows={r.items.map(
          (x): Row => [
            c(x.item),
            { ...c(x.est), bold: x.flagged },
            c(x.se),
            c(x.z),
            pCell(x.p),
            c(x.std),
            c(x.chisq),
            pCell(x.pLrt),
            { v: fmtP(x.pAdj), cls: x.flagged ? 'bad' : 'dim', bold: x.flagged },
            c(x.score ?? null),
            x.scoreP === undefined ? c(null) : pCell(x.scoreP),
          ],
        )}
        note={`Each row: the model with that item’s direct path from ${r.covariate} (its estimate, Wald test and likelihood-ratio test against the model without it), and the score test of the same path from the model without any (lavTestScore). Flagged (bold, red): the corrected LR p below ${fmt(r.alpha, 3)} (${adj}${r.adjust === 'none' ? ', no correction' : ''}). A positive direct effect: the item scores higher with the covariate than the factor predicts. With several DIF items the one-at-a-time tests can mislead (the others contaminate the anchor); a significant one flags the item, not the cause.${r.scoreError ? ' The score tests could not be computed for this model.' : ''}`}
      />
      <Table
        title={`${r.factor} on ${r.covariate}`}
        file="mimic-effect"
        columns={['Model', 'Estimate', 'SE', 'z', 'p', 'Standardised']}
        rows={[
          effectRow('Without direct effects', r.effect),
          ...(r.final
            ? [
                effectRow(
                  `With the flagged items’ direct effects (${r.flagged.length ? r.flagged.join(', ') : 'none flagged'})`,
                  r.final.effect,
                ),
              ]
            : []),
        ]}
        note="The factor’s difference by the covariate (impact). Freeing the flagged items’ direct effects corrects it for their DIF."
      />
      {r.final && r.final.direct.length > 0 && (
        <Table
          title="Direct effects in the final model"
          file="mimic-final"
          columns={['Item', 'Estimate', 'SE', 'z', 'p', 'Standardised']}
          rows={r.final.direct.map((x) => effectRow(x.item, x))}
          note={`Final model: ${fit(r.final.fit)}.`}
        />
      )}
    </div>
  );
}

export const mimicDifAnalysis: AnalysisType<MimicDifOptions, MimicDifResult> = {
  id: 'mimicdif',
  title: 'DIF by MIMIC',
  sub: 'uniform differential item functioning: each item’s direct effect from a covariate (lavaan)',
  group: 'Measurement',
  defaults: (ctx) => ({
    construct: modelFactors(ctx).find((f) => f.indicators.length >= 3)?.name ?? '',
    covariate: '',
    adjust: 'holm',
    alpha: 0.05,
    free: true,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          construct: name(raw.construct),
          covariate: name(raw.covariate),
          adjust: oneOf(raw.adjust, ['holm', 'BH', 'bonferroni', 'none'] as const, 'holm'),
          alpha: clampNum(raw.alpha, 0.001, 0.5, 0.05),
          free: raw.free === undefined ? true : raw.free === true,
        }
      : null,
  Options: MimicDifForm,
  View: ({ result }) => <MimicDifView r={result} />,
  blocked: (o, ctx) => {
    if (!o.construct)
      return rawData(ctx) && ctx.model?.constructs.length
        ? 'Choose a factor.'
        : factorsBlocked([], [], ctx, 'DIF by MIMIC');
    const fs = mimicFactor(o, ctx);
    const b = factorsBlocked(fs, [o.construct], ctx, 'DIF by MIMIC');
    if (b) return b;
    if (fs[0].indicators.length < 3)
      return 'DIF screening needs a factor with at least three indicators.';
    if (!o.covariate) return 'Choose a covariate.';
    if (fs[0].indicators.includes(o.covariate))
      return 'The covariate is an indicator of the factor.';
    const m = missingColumns(ctx, [o.covariate], 'DIF by MIMIC');
    if (m) return m;
    const cats = rawData(ctx)!.categories?.[o.covariate];
    return cats && cats.length > 2
      ? `${o.covariate} has ${cats.length} categories: choose a binary group or a continuous covariate (or make dummy columns).`
      : null;
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [...mimicFactor(o, ctx).flatMap((f) => f.indicators), o.covariate],
      [JSON.stringify(mimicDifInput(o, ctx))],
    ),
  run: async (o, ctx) => (await engine()).mimicDifR(rawData(ctx)!, mimicDifInput(o, ctx)),
  script: async (o, ctx) => (await engine()).mimicDifScriptR(rawData(ctx)!, mimicDifInput(o, ctx)),
  summary: (o) =>
    `${o.construct || '…'} on ${o.covariate || '…'} · ${ADJUST.find(([id]) => id === o.adjust)?.[1]}${o.free ? ' · flagged freed' : ''}`,
};
