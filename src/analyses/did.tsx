// Difference-in-differences card: a treated group before and after (two-way
// fixed effects, fixest) or staggered adoption (did), with an event-study chart.

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { fmt, fmtP } from '../format';
import type { DidInput, DidResult } from '../rengine/did';
import { Choice, clampNum, ColumnSelect, columnsFingerprint, flag, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface DidOptions { design: DidInput['design']; outcome: string; unit: string; time: string; treated: string; post: string; firstPeriod: number | null; covariates: string[]; control: DidInput['control']; eventStudy: boolean }
type Result = DidResult & { input: DidInput };

function DidOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<DidOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import panel data first (one row per unit and period).</div>;
  const taken = [o.outcome, o.unit, o.time, o.treated, o.post];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Design" value={o.design} onChange={(design) => set({ ...o, design })}
        options={[['twfe', 'Treated group, before and after'], ['staggered', 'Staggered adoption']] as const}
        hint={o.design === 'twfe' ? 'Two-way fixed effects (unit and period), standard errors clustered by unit (fixest).' : 'Callaway & Sant’Anna (2021): group-time effects, free of the forbidden comparisons of two-way fixed effects (did).'} />
      <ColumnSelect id="did-y" label="Outcome" value={o.outcome} columns={columns} exclude={taken.filter((x) => x !== o.outcome)} onChange={(outcome) => set({ ...o, outcome })} />
      <ColumnSelect id="did-id" label="Unit (person, firm, county…)" value={o.unit} columns={columns} exclude={taken.filter((x) => x !== o.unit)} onChange={(unit) => set({ ...o, unit })} />
      <ColumnSelect id="did-t" label="Time (period)" value={o.time} columns={columns} exclude={taken.filter((x) => x !== o.time)} onChange={(time) => set({ ...o, time })} />
      <ColumnSelect id="did-d" label={o.design === 'twfe' ? 'Treated group (0/1)' : 'First treated period (0 = never treated)'} value={o.treated} columns={columns} exclude={taken.filter((x) => x !== o.treated)} onChange={(treated) => set({ ...o, treated })} />
      {o.design === 'twfe' && (
        <div className="row2">
          <ColumnSelect id="did-post" label="Post period (0/1)" optional="From the first treated period" value={o.post} columns={columns} exclude={taken.filter((x) => x !== o.post)} onChange={(post) => set({ ...o, post })} />
          <div className="field"><label htmlFor="did-first">First treated period</label>
            <input id="did-first" className="input num" type="number" value={o.firstPeriod ?? ''} placeholder={o.post ? 'for the event study' : 'required'} onChange={(e) => set({ ...o, firstPeriod: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
          </div>
        </div>
      )}
      {o.design === 'staggered' && (
        <Choice label="Control group" value={o.control} onChange={(control) => set({ ...o, control })} options={[['nevertreated', 'Never treated'], ['notyettreated', 'Not yet treated']] as const}
          hint="Not yet treated uses later-treated units as controls too (more comparisons; assumes no anticipation)." />
      )}
      <OrderedPicker label="Covariates (optional)" columns={columns.filter((n) => !taken.includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <label className="check"><input type="checkbox" checked={o.eventStudy} onChange={(e) => set({ ...o, eventStudy: e.target.checked })} /> Event study (effect by period, with a pre-trend test)</label>
    </fieldset>
  );
}

function EventChart({ r }: { r: DidResult }) {
  const W = 520, H = 300, pad = { l: 56, r: 16, t: 14, b: 44 };
  const ev = r.event;
  const lo = Math.min(0, ...ev.map((e) => e.ciLow)), hi = Math.max(0, ...ev.map((e) => e.ciHigh)), m = (hi - lo || 1) * 0.08;
  const xs = ev.map((e) => e.rel);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + m - v) / (hi - lo + 2 * m)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 6 }, (_, i) => lo - m + ((hi - lo + 2 * m) * i) / 5);
  return (
    <ChartFrame id="did:event" name="did-event-study" width={W} height={H} defaults={{ x: r.design === 'twfe' ? 'Period relative to treatment' : 'Periods since treatment', y: 'Effect on the outcome' }}
      caption={<span className="hint">Points: the effect in each period relative to the last pre-treatment period (0 by construction); bars: {r.design === 'staggered' ? 'simultaneous' : ''} confidence intervals. Pre-treatment effects near zero support parallel trends.</span>}>
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="Event study">
          {ticks.map((v) => <g key={v}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} /><text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{fmt(v, 2)}</text></g>)}
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
          <line className="ref-line" x1={sx(-0.5)} x2={sx(-0.5)} y1={pad.t} y2={H - pad.b} />
          {ev.map((e) => (
            <g key={e.rel}>
              <line className="whisker" x1={sx(e.rel)} x2={sx(e.rel)} y1={sy(e.ciLow)} y2={sy(e.ciHigh)} />
              <circle className="dot" cx={sx(e.rel)} cy={sy(e.est)} r={4} style={e.rel >= 0 ? { fill: 'var(--bad)' } : undefined} />
              <text x={sx(e.rel)} y={H - pad.b + 16} textAnchor="middle">{e.rel}</text>
            </g>
          ))}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function DidView({ r }: { r: Result }) {
  const a = r.att, pct = Math.round(r.input.confidence * 100);
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['ATT', fmt(a.est)], ['Std. error', fmt(a.se)], ['p', fmtP(a.p)], [`${pct}% CI`, `[${fmt(a.ciLow)}, ${fmt(a.ciHigh)}]`], ['Units', String(r.units)], ['Periods', String(r.periods)]] as const).map(([k, v]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {r.design === 'twfe'
          ? `Average treatment effect on the treated: the treated group’s change from before to after, net of the controls’ change (two-way fixed effects, ${r.engine.package} ${r.engine.version}; ${r.treatedUnits} of ${r.units} units treated, standard errors clustered by unit).`
          : `Average treatment effect on the treated over all treated groups and post-treatment periods (Callaway & Sant’Anna 2021, ${r.engine.package} ${r.engine.version}; control group: ${r.control === 'notyettreated' ? 'not yet treated' : 'never treated'} units; ${r.treatedUnits} of ${r.units} units ever treated).`}
        {r.preTrend && <> Pre-trend test: {r.design === 'twfe' ? `F(${r.preTrend.df1}, ${r.preTrend.df2}) = ${fmt(r.preTrend.stat, 2)}` : `Wald χ² = ${fmt(r.preTrend.stat, 2)}`}, p {r.preTrend.p < 0.001 ? '< 0.001' : `= ${fmt(r.preTrend.p)}`}{r.preTrend.p < 0.05 ? ' — pre-treatment differences: parallel trends are doubtful.' : ' — no sign of differing pre-trends.'}</>}
      </p>
      {r.event.length > 0 && <EventChart r={r} />}
      {r.event.length > 0 && <Table title="Event study" file="did-event" columns={[r.design === 'twfe' ? 'Period' : 'Periods since treatment', 'Effect', 'Std. error', `${pct}% CI`]}
        rows={r.event.map((e) => [c(r.design === 'twfe' ? `${e.time} (${e.rel >= 0 ? '+' : ''}${e.rel})` : String(e.rel)), c(e.est), c(e.se), c(`[${fmt(e.ciLow)}, ${fmt(e.ciHigh)}]`)])} />}
      {r.groupTime && r.groupTime.length > 0 && <Table title="Group-time effects ATT(g, t)" file="did-group-time" columns={['Treated in', 'Period', 'ATT', 'Std. error', 'p']}
        rows={r.groupTime.map((g) => [c(String(g.group)), c(String(g.time)), c(g.est), c(g.se), pCell(2 * (1 - normalCdf(Math.abs(g.est / g.se))))])}
        note="Each cell: the effect for the units first treated in that year, in that period, against the control group. Pre-treatment cells (period before the group’s treatment) test parallel trends." />}
    </div>
  );
}

const normalCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
function erf(x: number) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

export const didInput = (o: DidOptions, ctx: Pick<AnalysisCtx, 'settings'>): DidInput => ({ ...o, seed: ctx.settings.seed, confidence: ctx.settings.confidence });
const didColumns = (o: DidOptions) => [o.outcome, o.unit, o.time, o.treated, ...(o.design === 'twfe' && o.post ? [o.post] : []), ...o.covariates].filter(Boolean);

export const didAnalysis: AnalysisType<DidOptions, Result> = {
  id: 'did',
  title: 'Difference-in-differences',
  sub: 'treatment effects from panel data: two-way fixed effects or staggered adoption (fixest, did)',
  group: 'Regression and causal inference',
  defaults: () => ({ design: 'twfe', outcome: '', unit: '', time: '', treated: '', post: '', firstPeriod: null, covariates: [], control: 'nevertreated', eventStudy: true }),
  parseOptions: (raw) => (isObj(raw) ? {
    design: oneOf(raw.design, ['twfe', 'staggered'] as const, 'twfe'), outcome: name(raw.outcome), unit: name(raw.unit), time: name(raw.time), treated: name(raw.treated), post: name(raw.post),
    firstPeriod: raw.firstPeriod === null || raw.firstPeriod === undefined || !Number.isFinite(Number(raw.firstPeriod)) ? null : clampNum(raw.firstPeriod, -1e9, 1e9, 0),
    covariates: names(raw.covariates), control: oneOf(raw.control, ['nevertreated', 'notyettreated'] as const, 'nevertreated'), eventStudy: flag(raw.eventStudy),
  } : null),
  Options: DidOptionsForm,
  View: ({ result }) => <DidView r={result} />,
  blocked: (o, ctx) => {
    if (!o.outcome || !o.unit || !o.time || !o.treated) return 'Choose the outcome, the unit, the time and the treatment columns.';
    if (new Set([o.outcome, o.unit, o.time, o.treated]).size < 4) return 'The outcome, unit, time and treatment must be different columns.';
    if (o.design === 'twfe' && !o.post && o.firstPeriod === null) return 'Give the post-period indicator, or the first treated period.';
    return missingColumns(ctx, didColumns(o), 'Difference-in-differences');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, didColumns(o), [o.design, o.firstPeriod, o.control, o.eventStudy ? 1 : 0, ctx.settings.seed, ctx.settings.confidence]),
  run: async (o, ctx) => { const input = didInput(o, ctx); return { ...(await (await import('../rengine/did')).didR(rawData(ctx)!, input)), input }; },
  script: async (o, ctx) => (await import('../rengine/did')).didScriptR(rawData(ctx)!, didInput(o, ctx)),
  summary: (o) => `${o.design === 'twfe' ? 'two-way fixed effects' : 'staggered (Callaway & Sant’Anna)'} · ${o.outcome || '…'} on ${o.treated || '…'}${o.eventStudy ? ' · event study' : ''}`,
};
