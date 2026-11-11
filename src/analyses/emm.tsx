// The estimated marginal means section of the ANOVA, repeated-measures ANOVA and multilevel
// regression cards (R/emm.R, emmeans): its options (parsed strictly from project files), its
// form, its tables and the profile plot.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import type { Dataset } from '../engine/types';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { seriesColor } from '../figure/palette';
import { fmt } from '../format';
import {
  EMM_ADJUST,
  EMM_CONTRASTS,
  EMM_DF,
  type EmmAdjust,
  type EmmContrast,
  type EmmContrastRow,
  type EmmContrastType,
  type EmmOptions,
  type EmmResult,
} from '../rengine/emm';
import { ColumnSelect, isObj, name, oneOf } from './common';

export type { EmmOptions } from '../rengine/emm';

/** Modes of the section with their own evidence (validation/cards.ts). */
export const EMM_MODES = ['emmeans', 'gameshowell'] as const;

const ADJUST_NAME: Record<EmmAdjust, string> = {
  tukey: 'Tukey',
  bonferroni: 'Bonferroni',
  holm: 'Holm',
  scheffe: 'Scheffé',
  none: 'None',
};
const CONTRAST_NAME: Record<EmmContrastType, string> = {
  deviation: 'Deviation (each level against the mean of all)',
  simple: 'Simple (each level against a reference)',
  helmert: 'Helmert (each level against the mean of the later ones)',
  polynomial: 'Polynomial (linear, quadratic, …)',
  custom: 'Custom weights',
};
const DF_NAME: Record<(typeof EMM_DF)[number], string> = {
  'kenward-roger': 'Kenward–Roger',
  satterthwaite: 'Satterthwaite',
  asymptotic: 'Asymptotic (z)',
};

/** The section's options when it is switched on. */
export const emmDefaults = (factors: string[]): EmmOptions => ({
  terms: factors.slice(0, 1).map((f) => [f]),
  posthoc: [],
  adjust: ['tukey'],
  gamesHowell: false,
  simple: null,
  contrasts: [],
  plot: null,
  df: 'kenward-roger',
});

/** Every term of the factors: the main effects, then their two- and three-way interactions. */
export function emmTerms(factors: string[]): string[][] {
  const out: string[][] = factors.map((f) => [f]);
  for (let i = 0; i < factors.length; i++)
    for (let j = i + 1; j < factors.length; j++) out.push([factors[i], factors[j]]);
  for (let i = 0; i < factors.length; i++)
    for (let j = i + 1; j < factors.length; j++)
      for (let k = j + 1; k < factors.length; k++) out.push([factors[i], factors[j], factors[k]]);
  return out;
}

const SUB = { borderLeft: '2px solid #e2e8f0', paddingLeft: 8 } as const;
const termKey = (t: string[]) => t.join('\u0000');
const termLabel = (t: string[]) => t.join(' × ');

/** A list of terms from a project file: one to three distinct names each, at most 50 terms. */
function parseTerms(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  const out: string[][] = [];
  for (const t of v.slice(0, 50)) {
    if (!Array.isArray(t)) continue;
    const term = t.map((x) => name(x)).filter(Boolean);
    const distinct = new Set(term).size === term.length;
    if (term.length >= 1 && term.length <= 3 && distinct) out.push(term);
  }
  return out;
}

/** Custom weights from a project file: up to 20 rows of up to 50 finite numbers. */
function parseWeights(v: unknown): number[][] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 20)
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).slice(0, 50).map(Number).filter(Number.isFinite));
}

/** The section's options from a project file (untrusted): null when absent or not an object. */
export function parseEmmOptions(raw: unknown): EmmOptions | null {
  if (!isObj(raw)) return null;
  const adjust = Array.isArray(raw.adjust)
    ? [...new Set(raw.adjust.filter((a): a is EmmAdjust => EMM_ADJUST.includes(a)))]
    : [];
  const contrasts: EmmContrast[] = (Array.isArray(raw.contrasts) ? raw.contrasts.slice(0, 20) : [])
    .filter(isObj)
    .map((k) => ({
      factor: name(k.factor),
      type: oneOf(k.type, EMM_CONTRASTS, 'deviation'),
      reference: oneOf(k.reference, ['first', 'last'] as const, 'first'),
      weights: parseWeights(k.weights),
    }))
    .filter((k) => k.factor);
  const simple = isObj(raw.simple)
    ? { factor: name(raw.simple.factor), by: name(raw.simple.by) }
    : null;
  const plot = isObj(raw.plot) ? { x: name(raw.plot.x), lines: name(raw.plot.lines) } : null;
  return {
    terms: parseTerms(raw.terms),
    posthoc: parseTerms(raw.posthoc),
    adjust: adjust.length ? adjust : ['tukey'],
    gamesHowell: raw.gamesHowell === true,
    simple: simple && simple.factor && simple.by ? simple : null,
    contrasts,
    plot: plot && plot.x ? plot : null,
    df: oneOf(raw.df, EMM_DF, 'kenward-roger'),
  };
}

/** Why the section cannot run with these factors (null: it can). */
export function emmBlocked(
  o: EmmOptions,
  factors: string[],
  levels?: (f: string) => number | undefined,
) {
  const known = (f: string) => factors.includes(f);
  const terms = [...o.terms, ...o.posthoc];
  if (!factors.length) return 'Marginal means need at least one factor in the model.';
  if (terms.some((t) => !t.every(known)))
    return 'A marginal means term names a factor that is not in the model.';
  const nothing =
    !o.terms.length && !o.posthoc.length && !o.simple && !o.contrasts.length && !o.plot;
  if (nothing)
    return 'Choose what the marginal means section shows: means, post hoc tests, simple effects, contrasts or a plot.';
  if (o.gamesHowell && !o.posthoc.some((t) => t.length === 1))
    return 'Games–Howell comparisons need a post hoc term with one factor.';
  if (o.simple) {
    if (!known(o.simple.factor) || !known(o.simple.by))
      return 'Choose the simple effect’s factors.';
    if (o.simple.factor === o.simple.by) return 'A simple effect needs two different factors.';
  }
  if (o.plot) {
    if (!known(o.plot.x) || (o.plot.lines && !known(o.plot.lines)))
      return 'Choose the profile plot’s factors.';
    if (o.plot.x === o.plot.lines)
      return 'The profile plot needs different factors on the axis and as lines.';
  }
  for (const k of o.contrasts) {
    if (!known(k.factor)) return 'A contrast names a factor that is not in the model.';
    if (k.type !== 'custom') continue;
    const n = levels?.(k.factor);
    if (!k.weights.length) return `Give the custom weights of ${k.factor}.`;
    for (const row of k.weights) {
      if (n !== undefined && row.length !== n)
        return `Each row of custom weights for ${k.factor} needs ${n} numbers (one per level).`;
      const sum = row.reduce((a, b) => a + b, 0);
      const size = row.reduce((a, b) => a + Math.abs(b), 0);
      if (!size || Math.abs(sum) > 1e-8 * Math.max(1, size))
        return `Each row of custom weights for ${k.factor} must sum to zero.`;
    }
  }
  return null;
}

/** The section's part of a card's fingerprint. */
export const emmFingerprint = (o: EmmOptions | null | undefined): string =>
  o ? JSON.stringify(o) : '';

/** "1 -1 0; 0 1 -1" as rows of numbers (anything that is not a number dropped). */
export const parseWeightText = (text: string): number[][] =>
  text
    .split(/[;\n]/)
    .map((row) =>
      row
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite),
    )
    .filter((row) => row.length > 0);

const weightText = (w: number[][]) => w.map((row) => row.join(' ')).join('; ');

function TermChecks({
  label,
  terms,
  value,
  onChange,
}: {
  label: string;
  terms: string[][];
  value: string[][];
  onChange: (v: string[][]) => void;
}) {
  const on = new Set(value.map(termKey));
  const toggle = (t: string[], checked: boolean) => {
    const next = checked ? [...value, t] : value.filter((x) => termKey(x) !== termKey(t));
    // (in the order of the term list, so a re-run gives the same tables in the same order)
    onChange(terms.filter((x) => next.some((y) => termKey(y) === termKey(x))));
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="chips">
        {terms.map((t) => (
          <label className="check" key={termKey(t)}>
            <input
              type="checkbox"
              checked={on.has(termKey(t))}
              onChange={(e) => toggle(t, e.target.checked)}
            />{' '}
            {termLabel(t)}
          </label>
        ))}
      </div>
    </div>
  );
}

function WeightsInput({
  factor,
  weights,
  onChange,
}: {
  factor: string;
  weights: number[][];
  onChange: (w: number[][]) => void;
}) {
  const [text, setText] = useState(() => weightText(weights));
  const id = `emm-w-${factor}`;
  return (
    <div className="field">
      <label htmlFor={id}>Weights for {factor} (one row per contrast, rows separated by ;)</label>
      <input
        id={id}
        className="input"
        value={text}
        placeholder="1 -1 0; 0.5 0.5 -1"
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseWeightText(e.target.value));
        }}
      />
    </div>
  );
}

/**
 * The section's form. `factors`: the model's factors; `games`: Games–Howell is offered (between-
 * subjects factors); `mixed`: the degrees of freedom method is offered (mixed models).
 */
export function EmmFields({
  value,
  factors,
  set,
  games = false,
  mixed = false,
}: {
  value: EmmOptions | null | undefined;
  factors: string[];
  set: (v: EmmOptions | null) => void;
  games?: boolean;
  mixed?: boolean;
}) {
  const o = value ?? null;
  const terms = emmTerms(factors);
  const contrastOf = (f: string) => o?.contrasts.find((k) => k.factor === f);
  const setContrast = (f: string, k: EmmContrast | null) => {
    if (!o) return;
    const rest = o.contrasts.filter((x) => x.factor !== f);
    const contrasts = k ? [...rest, k] : rest;
    // (in the order of the factors)
    contrasts.sort((a, b) => factors.indexOf(a.factor) - factors.indexOf(b.factor));
    set({ ...o, contrasts });
  };
  return (
    <div className="field">
      <label className="check">
        <input
          type="checkbox"
          checked={!!o}
          disabled={!factors.length}
          onChange={(e) => set(e.target.checked ? emmDefaults(factors) : null)}
        />{' '}
        Estimated marginal means, post hoc tests and contrasts (emmeans)
      </label>
      {!factors.length && <div className="hint">Choose a factor first.</div>}
      {o && factors.length > 0 && (
        <div style={SUB}>
          <TermChecks
            label="Marginal means of"
            terms={terms}
            value={o.terms}
            onChange={(t) => set({ ...o, terms: t })}
          />
          <TermChecks
            label="Post hoc comparisons (every pair of means) of"
            terms={terms}
            value={o.posthoc}
            onChange={(t) => set({ ...o, posthoc: t })}
          />
          <div className="field">
            <label>p-value adjustment</label>
            <div className="chips">
              {EMM_ADJUST.map((a) => (
                <label className="check" key={a}>
                  <input
                    type="checkbox"
                    checked={o.adjust.includes(a)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...o.adjust, a]
                        : o.adjust.filter((x) => x !== a);
                      const ordered = EMM_ADJUST.filter((x) => next.includes(x));
                      set({ ...o, adjust: ordered.length ? ordered : ['tukey'] });
                    }}
                  />{' '}
                  {ADJUST_NAME[a]}
                </label>
              ))}
              {games && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={o.gamesHowell}
                    onChange={(e) => set({ ...o, gamesHowell: e.target.checked })}
                  />{' '}
                  Games–Howell
                </label>
              )}
            </div>
            <div className="hint">
              Each chosen adjustment adds a p-value column; the intervals use the first. Holm
              adjusts p-values only (its intervals are Bonferroni’s).
              {games &&
                ' Games–Howell compares the groups of a one-factor post hoc term without assuming equal variances (each factor on its own, the others ignored).'}
            </div>
          </div>
          <div className="row2">
            <ColumnSelect
              id="emm-simple"
              label="Simple effects of"
              value={o.simple?.factor ?? ''}
              columns={factors}
              optional="None"
              onChange={(f) =>
                set({
                  ...o,
                  simple: f ? { factor: f, by: factors.find((x) => x !== f) ?? '' } : null,
                })
              }
            />
            {o.simple && (
              <ColumnSelect
                id="emm-simple-by"
                label="at each level of"
                value={o.simple.by}
                columns={factors.filter((f) => f !== o.simple?.factor)}
                onChange={(by) => set({ ...o, simple: { factor: o.simple!.factor, by } })}
              />
            )}
          </div>
          {factors.map((f) => {
            const k = contrastOf(f);
            const id = `emm-contrast-${f}`;
            return (
              <div key={f} className="row2">
                <div className="field">
                  <label htmlFor={id}>Planned contrasts of {f}</label>
                  <select
                    id={id}
                    className="select"
                    value={k?.type ?? ''}
                    onChange={(e) => {
                      const type = e.target.value as EmmContrastType | '';
                      if (!type) {
                        setContrast(f, null);
                        return;
                      }
                      setContrast(f, {
                        factor: f,
                        type,
                        reference: k?.reference ?? 'first',
                        weights: k?.weights ?? [],
                      });
                    }}
                  >
                    <option value="">None</option>
                    {EMM_CONTRASTS.map((t) => (
                      <option key={t} value={t}>
                        {CONTRAST_NAME[t]}
                      </option>
                    ))}
                  </select>
                </div>
                {k?.type === 'simple' && (
                  <div className="field">
                    <label htmlFor={`${id}-ref`}>Reference level</label>
                    <select
                      id={`${id}-ref`}
                      className="select"
                      value={k.reference}
                      onChange={(e) =>
                        setContrast(f, { ...k, reference: e.target.value as 'first' | 'last' })
                      }
                    >
                      <option value="first">First</option>
                      <option value="last">Last</option>
                    </select>
                  </div>
                )}
                {k?.type === 'custom' && (
                  <WeightsInput
                    factor={f}
                    weights={k.weights}
                    onChange={(weights) => setContrast(f, { ...k, weights })}
                  />
                )}
              </div>
            );
          })}
          <div className="row2">
            <ColumnSelect
              id="emm-plot-x"
              label="Profile plot: horizontal axis"
              value={o.plot?.x ?? ''}
              columns={factors}
              optional="No plot"
              onChange={(x) => set({ ...o, plot: x ? { x, lines: '' } : null })}
            />
            {o.plot && (
              <ColumnSelect
                id="emm-plot-lines"
                label="Separate lines"
                value={o.plot.lines}
                columns={factors.filter((f) => f !== o.plot?.x)}
                optional="One line"
                onChange={(lines) => set({ ...o, plot: { x: o.plot!.x, lines } })}
              />
            )}
          </div>
          {mixed && (
            <div className="field">
              <label htmlFor="emm-df">Degrees of freedom</label>
              <select
                id="emm-df"
                className="select"
                value={o.df}
                onChange={(e) => set({ ...o, df: e.target.value as EmmOptions['df'] })}
              >
                {EMM_DF.map((d) => (
                  <option key={d} value={d}>
                    {DF_NAME[d]}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="hint">
            Means at the mean of any covariates, each cell weighted equally. Planned contrasts are
            not adjusted for multiplicity.
          </div>
        </div>
      )}
    </div>
  );
}

const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const ci = (lo: number, hi: number) => `[${fmt(lo)}, ${fmt(hi)}]`;
const dfCell = (df: number | null) => (df === null ? c('∞') : c(df));

function contrastRow(r: EmmContrastRow): Row {
  return [
    c(r.contrast),
    c(r.estimate),
    c(r.se),
    dfCell(r.df),
    c(r.t),
    pCell(r.p ?? null),
    c(ci(r.lower, r.upper)),
  ];
}

/** The section's tables and the profile plot. */
export function EmmView({ e, dependent }: { e: EmmResult; dependent: string }) {
  const level = pct(e.confidence);
  const dfNote = e.df ? ` Degrees of freedom: ${DF_NAME[e.df]}.` : '';
  const source = `emmeans ${e.version}.${dfNote}`;
  return (
    <>
      {e.means.map((m) => (
        <Table
          key={`m${termKey(m.term)}`}
          title={`Estimated marginal means: ${termLabel(m.term)}`}
          file={`emm-${m.term.join('-')}`}
          columns={[...m.term, 'Mean', 'SE', 'df', `${level} CI`]}
          rows={m.rows.map(
            (r): Row => [
              ...r.levels.map((l) => c(l)),
              c(r.emmean),
              c(r.se),
              dfCell(r.df),
              c(ci(r.lower, r.upper)),
            ],
          )}
          note={source}
        />
      ))}
      {e.posthoc.map((ph) => (
        <Table
          key={`p${termKey(ph.term)}`}
          title={`Post hoc comparisons: ${termLabel(ph.term)}`}
          file={`emm-posthoc-${ph.term.join('-')}`}
          columns={[
            'Comparison',
            'Difference',
            'SE',
            'df',
            't',
            ...ph.adjust.map((a) => `p (${ADJUST_NAME[a]})`),
            `${level} CI (${ADJUST_NAME[ph.adjust[0]]})`,
          ]}
          rows={ph.rows.map(
            (r): Row => [
              c(r.contrast),
              c(r.estimate),
              c(r.se),
              dfCell(r.df),
              c(r.t),
              ...ph.adjust.map((a) => pCell(r.pAdjusted[a] ?? null)),
              c(ci(r.lower, r.upper)),
            ],
          )}
          note={`Differences of the marginal means. ${source}`}
        />
      ))}
      {e.gamesHowell.map((g) => (
        <Table
          key={`g${g.factor}`}
          title={`Post hoc comparisons: ${g.factor} (Games–Howell)`}
          file={`emm-gameshowell-${g.factor}`}
          columns={['Comparison', 'Difference', 'SE', 'df', 't', 'p (adjusted)', `${level} CI`]}
          rows={g.rows.map(contrastRow)}
          note="Welch’s t for each pair of groups; p-values and intervals from the studentized range with Welch–Satterthwaite df (Games & Howell 1976). The groups’ raw means, other factors ignored."
        />
      ))}
      {e.simple && (
        <Table
          title={`Simple effects of ${e.simple.factor} at each level of ${e.simple.by}`}
          file="emm-simple"
          columns={[e.simple.by, 'df1', 'df2', 'F', 'p']}
          rows={e.simple.rows.map(
            (r): Row => [c(r.level), c(r.df1, undefined, 0), dfCell(r.df2), c(r.f), pCell(r.p)],
          )}
          note={`Joint test of ${e.simple.factor}’s means at each level of ${e.simple.by} (emmeans, averaged over other factors). ${source}`}
        />
      )}
      {e.contrasts.map((k) => (
        <Table
          key={`c${k.factor}`}
          title={`Planned contrasts of ${k.factor}: ${CONTRAST_NAME[k.type]}`}
          file={`emm-contrasts-${k.factor}`}
          columns={['Contrast', 'Estimate', 'SE', 'df', 't', 'p', `${level} CI`]}
          rows={k.rows.map(contrastRow)}
          note={`Unadjusted. ${source}`}
        />
      ))}
      {e.plot && <ProfilePlot e={e} dependent={dependent} />}
    </>
  );
}

/** The profile plot: the marginal means of the axis factor, a line per level of the other, CI bars. */
export function ProfilePlot({ e, dependent }: { e: EmmResult; dependent: string }) {
  const p = e.plot!;
  const xs = [...new Set(p.rows.map((r) => r.x))];
  const lines = [...new Set(p.rows.map((r) => r.line))];
  const W = 520;
  const H = 320;
  const legend = p.lines ? 120 : 0;
  const pad = { l: 60, r: 16 + legend, t: 14, b: 46 };
  const lo = Math.min(...p.rows.map((r) => r.lower));
  const hi = Math.max(...p.rows.map((r) => r.upper));
  const margin = (hi - lo || 1) * 0.08;
  const y0 = lo - margin;
  const y1 = hi + margin;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  // (lines side by side at each level, so their bars do not overlap)
  const dodge = lines.length > 1 ? Math.min(12, plotW / xs.length / (2 * lines.length)) : 0;
  const sx = (x: string, k: number) =>
    pad.l + ((xs.indexOf(x) + 0.5) / xs.length) * plotW + (k - (lines.length - 1) / 2) * dodge;
  const sy = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * plotH;
  const ticks = Array.from({ length: 6 }, (_, i) => y0 + ((y1 - y0) * i) / 5);
  return (
    <ChartFrame
      id="emm-profile"
      name="profile-plot"
      width={W}
      height={H}
      defaults={{ x: p.x, y: `Marginal mean of ${dependent}` }}
      caption={
        <span className="hint">
          Estimated marginal means with {pct(e.confidence)} confidence intervals
          {p.lines ? `, one line per level of ${p.lines}` : ''}.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Profile plot"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={pad.l + plotW} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {fmt(v, 2)}
              </text>
            </g>
          ))}
          {xs.map((x) => (
            <text
              key={`x${x}`}
              x={sx(x, (lines.length - 1) / 2)}
              y={H - pad.b + 16}
              textAnchor="middle"
            >
              {x}
            </text>
          ))}
          {lines.map((line, k) => {
            const color = seriesColor(k);
            const pts = xs
              .map((x) => p.rows.find((r) => r.x === x && r.line === line))
              .filter((r): r is NonNullable<typeof r> => !!r);
            const path = pts.map((r) => `${sx(r.x, k)},${sy(r.emmean)}`).join(' ');
            return (
              <g key={`l${line}`}>
                <polyline points={path} fill="none" stroke={color} strokeWidth={2} />
                {pts.map((r) => (
                  <g key={r.x}>
                    <line
                      x1={sx(r.x, k)}
                      x2={sx(r.x, k)}
                      y1={sy(r.lower)}
                      y2={sy(r.upper)}
                      stroke={color}
                    />
                    <line
                      x1={sx(r.x, k) - 4}
                      x2={sx(r.x, k) + 4}
                      y1={sy(r.lower)}
                      y2={sy(r.lower)}
                      stroke={color}
                    />
                    <line
                      x1={sx(r.x, k) - 4}
                      x2={sx(r.x, k) + 4}
                      y1={sy(r.upper)}
                      y2={sy(r.upper)}
                      stroke={color}
                    />
                    <circle cx={sx(r.x, k)} cy={sy(r.emmean)} r={3.5} fill={color} />
                  </g>
                ))}
              </g>
            );
          })}
          {p.lines &&
            lines.map((line, k) => (
              <g key={`legend${line}`}>
                <rect
                  x={W - legend + 4}
                  y={pad.t + 4 + k * 18}
                  width={12}
                  height={12}
                  fill={seriesColor(k)}
                />
                <text x={W - legend + 22} y={pad.t + 14 + k * 18}>
                  {line}
                </text>
              </g>
            ))}
          <text x={pad.l + plotW / 2} y={H - 4} textAnchor="middle" className="axis-title">
            {labels.x}
          </text>
          <text
            transform={`translate(12 ${pad.t + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
        </svg>
      )}
    </ChartFrame>
  );
}

/** Options with the section set, or without the key when it is switched off. */
export function withEmm<T extends { emm?: EmmOptions | null }>(o: T, emm: EmmOptions | null): T {
  if (emm) return { ...o, emm };
  const { emm: _off, ...rest } = o;
  return rest as T;
}

/** The section's options of a card's project-file options, as a part to spread in. */
export function emmPart(raw: Record<string, unknown>): { emm?: EmmOptions } {
  const emm = parseEmmOptions(raw.emm);
  return emm ? { emm } : {};
}

/** The number of levels of a factor column: its categories, or its distinct values. */
export function columnLevels(d: Dataset | null, column: string): number | undefined {
  if (!d) return undefined;
  const k = d.names.indexOf(column);
  if (k < 0) return undefined;
  const values = new Set<number>();
  for (const v of d.cols[k]) if (!Number.isNaN(v)) values.add(v);
  return values.size;
}
