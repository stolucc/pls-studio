// The guided "Plan sample size" flow of the Monte Carlo card: the model's expected effects, the hypotheses that
// must come out significant, the power wanted; the run searches the sample sizes (model/samplePlan.ts) and the
// view answers with the N needed, per hypothesis and jointly, and a methods paragraph. The full Monte Carlo
// settings and results stay one click away.

import { useEffect, useMemo, useState } from 'react';
import { JOINT_PARAM, type McDesign, type McSummaryRow } from '../engine/montecarlo';
import { buildPopulation, unitReliability, type PopulationSpec } from '../engine/population';
import { fmt } from '../format';
import { ESTIMATOR_CHOICES } from '../model/simulation';
import {
  coarseSizes,
  crossing,
  DEFAULT_PLAN,
  crossingText,
  defaultFocal,
  hypothesisLabel,
  hypothesisParams,
  impliedPathKeys,
  INTERACTION_ESTIMATORS,
  INTERACTION_PRESETS,
  interactionsFromModel,
  PATH_PRESETS,
  PLAN_ESTIMATORS,
  planDesign,
  planMethodsText,
  planParameters,
  planReports,
  powerPoints,
  refineSizes,
  syncPlan,
  withMainEffects,
  type PlanReport,
} from '../model/samplePlan';
import { c, Table, type Row } from '../components/results/Table';
import { emptyModel } from '../store';
import {
  InteractionBlock,
  mcAnalysis,
  McDuration,
  McOptionsForm,
  McView,
  MissingFields,
  Num,
  PowerChart,
} from './simulation';
import { fingerprint } from './codec';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const f2 = (v: number) => v.toFixed(2).replace(/^(-?)0\./, '$1.');

/** A preset row: segmented small / medium / large, and the exact value. */
function EffectInput({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: number;
  presets: readonly { label: string; value: number }[];
  onChange: (v: number) => void;
}) {
  const sign = value < 0 ? -1 : 1;
  return (
    <div className="plan-effect">
      <span className="plan-effect-label" title={label}>
        {label}
      </span>
      <div className="segmented compact" role="radiogroup" aria-label={`${label}: expected effect`}>
        {presets.map((p) => {
          const on = Math.abs(Math.abs(value) - p.value) < 1e-9;
          return (
            <button
              key={p.label}
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              onClick={() => onChange(sign * p.value)}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <Num value={value} min={-0.99} max={0.99} onChange={onChange} />
    </div>
  );
}

/** The plan's design with its hypotheses limited to non-zero effects the population still has. */
export function sanitisePlan(d: McDesign): McDesign {
  if (!d.plan) return d;
  const params = planParameters(d);
  if (!params) return d;
  const ok = new Set(
    hypothesisParams(params)
      .filter((p) => Math.abs(p.value) > 1e-12)
      .map((p) => p.key),
  );
  return { ...d, plan: { ...d.plan, focal: d.plan.focal.filter((k) => ok.has(k)) } };
}

/** The plan kept in step with the model on the canvas (syncPlan). */
const synced = (d: McDesign, ctx: AnalysisCtx) =>
  syncPlan(d, ctx.model ?? emptyModel(), ctx.pls, ctx.cb ?? null, ctx.settings.method);

/** The sample sizes the duration estimate assumes: the coarse grid and three refinements. */
function expectedSizes(d: McDesign): number[] {
  if (d.plan?.search !== 'auto') return d.sampleSizes;
  const s1 = coarseSizes(d.plan.minN, d.plan.maxN);
  const mid = s1[Math.floor(s1.length / 2)];
  return [...s1, mid, mid, mid];
}

export function PlanOptionsForm(props: OptionsProps<McDesign>) {
  const { options: design, set: setDesign, ctx, disabled } = props;
  const [advanced, setAdvanced] = useState(false);
  const plan = design.plan!;
  const model = ctx.model ?? emptyModel();
  const engine = ctx.settings.engine;
  // The model changed since the card was made: the plan follows it, keeping the values set here.
  const current = synced(design, ctx);
  useEffect(() => {
    if (current !== design) setDesign(current);
  }, [current, design, setDesign]);
  const set = (patch: Partial<McDesign>) => setDesign({ ...design, ...patch });
  const setPlan = (patch: Partial<typeof plan>) => set({ plan: { ...plan, ...patch } });
  // (an interaction added here brings its constructs' main effects along)
  const setPop = (fn: (p: PopulationSpec) => PopulationSpec) =>
    set({ population: withMainEffects(fn(design.population)) });
  const skipped = useMemo(() => interactionsFromModel(model).skipped, [model]);
  const check = useMemo(() => {
    try {
      return { pop: buildPopulation(design.population), error: null as string | null };
    } catch (e) {
      return { pop: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [design.population]);
  const params = useMemo(() => planParameters(design), [design]);
  const hyps = params ? hypothesisParams(params) : [];
  const pop = design.population;
  const estimator = design.estimators[0]?.id;
  const moderated = (pop.interactions?.length ?? 0) > 0;
  // (in the model, not drawn: the canvas shows them dashed on request)
  const implied = impliedPathKeys(pop, model);
  const restart = () =>
    setDesign({
      ...planDesign(model, ctx.pls, ctx.cb ?? null, ctx.settings.method),
      plan: { ...plan, focal: [] },
    });
  if (advanced)
    return (
      <>
        <div className="table-tools" style={{ marginBottom: 8 }}>
          <span className="muted">All Monte Carlo settings</span>
          <button className="btn sm" onClick={() => setAdvanced(false)}>
            Back to the guided plan
          </button>
        </div>
        <McOptionsForm {...props} />
      </>
    );
  return (
    <fieldset className="card-options sim-options plan-options" disabled={disabled}>
      <div className="table-tools">
        <h3>1 · Model</h3>
        <button
          className="btn sm"
          onClick={restart}
          title="Start again from the model on the canvas"
        >
          Start from the model
        </button>
      </div>
      <div className="hint">
        {pop.constructs.length} constructs, {pop.paths.length} paths
        {pop.interactions?.length ? `, ${pop.interactions.length} moderation(s)` : ''}, from the
        model on the canvas. No data are needed: the simulation draws them from the effects you
        expect.
      </div>
      {skipped.map((s) => (
        <div className="issue warning" key={s.label}>
          Not simulated: {s.label}. {s.reason}
        </div>
      ))}
      {(pop.interactions?.length ?? 0) > 0 && engine !== 'r' && (
        <div className="issue warning">
          Moderation (latent interactions) is estimated by cSEM: choose the R engine.
        </div>
      )}
      {check.error && <div className="issue error">{check.error}</div>}

      <h3 style={{ marginTop: 14 }}>2 · Measurement</h3>
      <div className="hint">
        The typical standardised loading of each construct's indicators (.70 is the usual minimum;
        weaker measurement needs a larger sample).
      </div>
      {pop.constructs.map((k, ci) =>
        k.type === 'factor' ? (
          <div className="plan-effect" key={k.name}>
            <span className="plan-effect-label">
              {k.name} <span className="muted">({k.indicators.length} items)</span>
            </span>
            <div className="segmented compact" role="radiogroup" aria-label={`${k.name}: loadings`}>
              {[0.6, 0.7, 0.8].map((l) => {
                const on = (k.loadings ?? []).every((x) => Math.abs(x - l) < 1e-9);
                return (
                  <button
                    key={l}
                    role="radio"
                    aria-checked={on}
                    className={on ? 'on' : ''}
                    onClick={() =>
                      setPop((p) => ({
                        ...p,
                        constructs: p.constructs.map((x, j) =>
                          j === ci ? { ...x, loadings: x.indicators.map(() => l) } : x,
                        ),
                      }))
                    }
                  >
                    {f2(l)}
                  </button>
                );
              })}
            </div>
            {check.pop && (
              <span className="muted num" title="Reliability of the sum score">
                ρ {fmt(unitReliability(check.pop, ci))}
              </span>
            )}
          </div>
        ) : (
          <div className="plan-effect" key={k.name}>
            <span className="plan-effect-label">{k.name}</span>
            <span className="muted">composite: weights in All settings</span>
          </div>
        ),
      )}

      <h3 style={{ marginTop: 14 }}>3 · Expected effects</h3>
      <div className="hint">
        Standardised, from earlier studies or a pilot; when unsure, take the smaller value. Small,
        medium and large paths: .10, .30, .50; interactions are usually small (.05–.15).
      </div>
      {pop.paths.map((p, pi) => (
        <EffectInput
          key={`${p.from}-${p.to}`}
          label={`${p.from} → ${p.to}${implied.has(`path:${p.from}:${p.to}`) ? ' (moderator main effect)' : ''}`}
          value={p.value}
          presets={PATH_PRESETS}
          onChange={(v) =>
            setPop((pp) => ({
              ...pp,
              paths: pp.paths.map((x, i) => (i === pi ? { ...x, value: v } : x)),
            }))
          }
        />
      ))}
      {(pop.interactions ?? []).map((x, xi) => (
        <EffectInput
          key={`${x.a}-${x.b}-${x.to}`}
          label={`${x.a} × ${x.b} → ${x.to}`}
          value={x.value}
          presets={INTERACTION_PRESETS}
          onChange={(v) =>
            setPop((pp) => ({
              ...pp,
              interactions: (pp.interactions ?? []).map((y, i) =>
                i === xi ? { ...y, value: v } : y,
              ),
            }))
          }
        />
      ))}
      {pop.exoCor.map((r, ri) => (
        <div className="plan-effect" key={`${r.a}-${r.b}`}>
          <span className="plan-effect-label">
            {r.a} ↔ {r.b} <span className="muted">(correlation)</span>
          </span>
          <Num
            value={r.value}
            min={-0.99}
            max={0.99}
            onChange={(v) =>
              setPop((pp) => ({
                ...pp,
                exoCor: pp.exoCor.map((x, i) => (i === ri ? { ...x, value: v } : x)),
              }))
            }
          />
        </div>
      ))}
      {check.pop && (
        <div className="hint">
          Implied R²:{' '}
          {pop.constructs
            .map((k, i) => (check.pop!.r2[i] !== null ? `${k.name} ${fmt(check.pop!.r2[i])}` : ''))
            .filter(Boolean)
            .join(', ')}
        </div>
      )}
      <details className="plan-more">
        <summary>Add or change moderations</summary>
        <InteractionBlock pop={pop} setPop={setPop} />
      </details>

      <h3 style={{ marginTop: 14 }}>4 · Hypotheses</h3>
      <div className="hint">
        The effects that must come out significant. The plan finds the N at which each reaches the
        target power, and the N at which all of them do in the same sample.
      </div>
      <div className="plan-hyps">
        {hyps.map((p) => {
          const zero = Math.abs(p.value) < 1e-12;
          return (
            <label
              className="check"
              key={p.key}
              title={zero ? 'A zero effect is no hypothesis' : ''}
            >
              <input
                type="checkbox"
                disabled={zero}
                checked={!zero && plan.focal.includes(p.key)}
                onChange={(e) =>
                  setPlan({
                    focal: e.target.checked
                      ? [...plan.focal, p.key]
                      : plan.focal.filter((k) => k !== p.key),
                  })
                }
              />
              {hypothesisLabel(p)} <span className="muted num">({fmt(p.value)})</span>
            </label>
          );
        })}
      </div>
      {params && (
        <button className="btn sm ghost" onClick={() => setPlan({ focal: defaultFocal(params) })}>
          All direct paths
        </button>
      )}

      <h3 style={{ marginTop: 14 }}>5 · Analysis and power</h3>
      <div className="field">
        <label id="plan-est">Estimated with</label>
        <div className="segmented" role="radiogroup" aria-labelledby="plan-est">
          {PLAN_ESTIMATORS.map((id) => {
            const unable = moderated && !INTERACTION_ESTIMATORS.includes(id);
            return (
              <button
                key={id}
                role="radio"
                aria-checked={estimator === id}
                className={estimator === id ? 'on' : ''}
                disabled={unable}
                title={unable ? 'Cannot estimate the latent interactions in the simulation' : ''}
                onClick={() => set({ estimators: ESTIMATOR_CHOICES.filter((e) => e.id === id) })}
              >
                {id}
              </button>
            );
          })}
        </div>
        {moderated && (
          <div className="hint">
            With moderation the simulation estimates PLS (product indicators) or sum scores; PLSc
            and CB-SEM latent interactions are not simulated yet.
          </div>
        )}
      </div>
      <div className="row2">
        <div className="field">
          <label id="plan-target">Target power</label>
          <div className="segmented" role="radiogroup" aria-labelledby="plan-target">
            {[0.8, 0.9, 0.95].map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={plan.target === t}
                className={plan.target === t ? 'on' : ''}
                onClick={() => setPlan({ target: t })}
              >
                {f2(t)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>α</label>
          <Num
            value={design.alpha}
            step={0.01}
            min={0.001}
            max={0.2}
            width={90}
            onChange={(v) => set({ alpha: v })}
          />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Smallest N</label>
          <Num
            value={plan.minN}
            step={10}
            min={20}
            max={plan.maxN - 10}
            width={90}
            onChange={(v) => setPlan({ minN: Math.round(v) })}
          />
        </div>
        <div className="field">
          <label>Largest N</label>
          <Num
            value={plan.maxN}
            step={50}
            min={plan.minN + 10}
            max={100000}
            width={90}
            onChange={(v) => setPlan({ maxN: Math.round(v) })}
          />
        </div>
      </div>
      <div className="field">
        <label>Replications per N</label>
        <Num
          value={design.replications}
          step={100}
          min={100}
          max={100000}
          width={90}
          onChange={(v) => set({ replications: Math.round(v) })}
        />
        <div className="hint">
          500 gives power to about ±.02; use 1000 for the final plan (Muthén &amp; Muthén 2002).
        </div>
      </div>
      <MissingFields design={design} set={set} />
      <div className="hint" style={{ marginBottom: 10 }}>
        The run tries {coarseSizes(plan.minN, plan.maxN).join(', ')}, then a finer grid where power
        crosses {f2(plan.target)}.
        <McDuration design={{ ...design, sampleSizes: expectedSizes(design) }} engine={engine} />
      </div>
      <button className="btn sm ghost" onClick={() => setAdvanced(true)}>
        All simulation settings…
      </button>
    </fieldset>
  );
}

/** Two stages: the coarse grid, then sizes between those where power crosses the target. */
export async function runPlan(
  d: McDesign,
  ctx: AnalysisCtx,
  progress: (done: number, total: number) => void,
): Promise<McSummaryRow[]> {
  const { simulate } = await import('../runner');
  const engine = ctx.settings.engine;
  const design = sanitisePlan(d);
  const plan = design.plan!;
  if (plan.search === 'fixed') return simulate(design, engine, progress);
  const s1 = coarseSizes(plan.minN, plan.maxN);
  const guess = design.replications * (s1.length + 3);
  const rows1 = await simulate({ ...design, sampleSizes: s1 }, engine, (done) =>
    progress(done, guess),
  );
  const keys = [JOINT_PARAM.key, ...plan.focal];
  const s2 = refineSizes(
    design.estimators.flatMap((e) =>
      keys.map((k) => crossing(powerPoints(rows1, e.id, k), plan.target)),
    ),
    s1,
  );
  if (!s2.length) return rows1;
  const base = design.replications * s1.length,
    total = design.replications * (s1.length + s2.length);
  const rows2 = await simulate({ ...design, sampleSizes: s2 }, engine, (done) =>
    progress(base + done, total),
  );
  return [...rows1, ...rows2].sort((a, b) => a.n - b.n);
}

function ReportBlock({
  report,
  rows,
  design,
}: {
  report: PlanReport;
  rows: McSummaryRow[];
  design: McDesign;
}) {
  const plan = design.plan!;
  const [copied, setCopied] = useState(false);
  const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const rec = report.recommended;
  const what = report.joint
    ? `all ${report.hypotheses.length} hypotheses significant in the same sample`
    : 'the hypothesis significant';
  const methods = planMethodsText(design, report);
  const lines = [...report.hypotheses, ...(report.joint ? [report.joint] : [])];
  const tableRows = lines.map((h): Row => {
    const joint = h.param.kind === 'joint';
    return [
      { ...c(hypothesisLabel(h.param)), bold: joint },
      c(joint ? '' : fmt(h.param.value)),
      ...ns.map((n) => {
        const p = h.points.find((x) => x.n === n)?.power;
        return p === undefined ? c(null) : c(p, p >= plan.target ? 'good' : undefined, 2);
      }),
      { ...c(crossingText(h.crossing, plan.target)), bold: joint },
    ];
  });
  const loss = rec && rec.status !== 'notReached' ? Math.ceil(rec.n / 0.8) : null;
  return (
    <div className="plan-report">
      {rec && rec.status !== 'notReached' ? (
        <div className="plan-answer">
          <div className="plan-answer-n">{crossingText(rec, plan.target)}</div>
          <div>
            to have {what} with probability ≥ {f2(plan.target)} ({report.estimator},{' '}
            {design.replications} replications per N, α = {design.alpha}).
            {rec.status === 'atMin' &&
              ' Already reached at the smallest N tried: lower it to narrow down.'}
          </div>
          {loss && (
            <div className="hint">
              Recruit more to allow for unusable responses: with 20% loss, {rec.n} / .80 = {loss}.
            </div>
          )}
        </div>
      ) : (
        <div className="issue warning">
          {report.estimator}: {what} {rec ? crossingText(rec, plan.target) : 'not estimated'}. Raise
          the largest N, or check whether the expected effects are realistic.
        </div>
      )}
      {report.failed > 0.05 && (
        <div className="issue warning">
          {Math.round(report.failed * 100)}% of the replications failed to estimate at this N.
        </div>
      )}
      {report.improper > 0.05 && (
        <div className="issue warning">
          {Math.round(report.improper * 100)}% of the solutions were improper at this N (Wolf et al.
          2013 count these against a sample size).
        </div>
      )}
      <Table
        title={`Power by sample size (${report.estimator})`}
        file="sample-size-plan"
        columns={['Hypothesis', 'Effect', ...ns.map((n) => `N = ${n}`), `N for ${f2(plan.target)}`]}
        rows={tableRows}
        note="Joint: the share of samples in which every hypothesis is significant with the expected sign."
      />
      {ns.length > 1 && (
        <PowerChart
          rows={rows.filter((r) => r.estimator === report.estimator)}
          paramKey={report.joint ? JOINT_PARAM.key : (report.hypotheses[0]?.param.key ?? '')}
          estimators={[report.estimator]}
          metric="rejection"
          alpha={design.alpha}
        />
      )}
      <div className="plan-methods">
        <div className="table-tools">
          <b>Methods text</b>
          <button
            className="btn sm"
            onClick={() =>
              void navigator.clipboard?.writeText(methods).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p>{methods}</p>
      </div>
    </div>
  );
}

export function PlanView({ rows, design }: { rows: McSummaryRow[]; design: McDesign }) {
  // (the sizes actually run: the search adds its own)
  const ran = { ...design, sampleSizes: [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b) };
  const reports = planReports(rows, ran);
  return (
    <div className="tables">
      {reports.map((r) => (
        <ReportBlock key={r.estimator} report={r} rows={rows} design={ran} />
      ))}
      <details className="plan-more">
        <summary>All simulation results (bias, coverage, distributions)</summary>
        <McView rows={rows} design={ran} />
      </details>
    </div>
  );
}

/** The Monte Carlo card with its guided entry: options with a plan show the plan's form, run and view. */
export const mcPlanAnalysis: AnalysisType<McDesign, McSummaryRow[]> = {
  ...mcAnalysis,
  entries: [
    { title: mcAnalysis.title, sub: mcAnalysis.sub, options: (d) => d },
    {
      title: 'Plan sample size',
      sub: 'guided Monte Carlo power analysis: expected effects and hypotheses → the N needed',
      options: (d, ctx) =>
        ctx
          ? planDesign(ctx.model ?? emptyModel(), ctx.pls, ctx.cb ?? null, ctx.settings.method)
          : { ...d, plan: { ...DEFAULT_PLAN } },
    },
  ],
  cardTitle: (d) => (d.plan ? 'Plan sample size' : mcAnalysis.title),
  Options: (props) =>
    props.options.plan ? <PlanOptionsForm {...props} /> : <McOptionsForm {...props} />,
  View: ({ result, options, current }) =>
    options.plan ? (
      <PlanView rows={result} design={options} />
    ) : (
      <mcAnalysis.View result={result} options={options} current={current} />
    ),
  blocked: (raw, ctx) => {
    const d = synced(raw, ctx);
    const empty = d.population.constructs.filter((k) => !k.indicators.length).map((k) => k.name);
    if (d.plan && empty.length)
      return `${empty.join(', ')} ${empty.length > 1 ? 'have' : 'has'} no indicators: right-click it → Add indicator (Model tab).`;
    if (d.plan && !sanitisePlan(d).plan!.focal.length && d.population.constructs.length)
      return 'Choose at least one hypothesis with a non-zero expected effect (step 4).';
    return mcAnalysis.blocked(d, ctx);
  },
  run: (d, ctx, progress) =>
    d.plan ? runPlan(synced(d, ctx), ctx, progress) : mcAnalysis.run(d, ctx, progress),
  // (a plan follows the model: results from before the model changed are stale)
  fingerprint: (d, ctx) =>
    d.plan
      ? fingerprint(['mc-plan', ctx.settings.engine, JSON.stringify(synced(d, ctx))])
      : mcAnalysis.fingerprint(d, ctx),
  summary: (d) =>
    d.plan
      ? `${d.estimators.map((e) => e.id).join(', ')} · ${d.plan.focal.length} hypotheses · power ${f2(d.plan.target)} · ${d.replications} replications`
      : mcAnalysis.summary(d),
};
