// PLS-SEM assessments of the model on the canvas as analysis cards (cSEM):
// PLSpredict, blindfolding, model comparison, MICOM and multigroup analysis,
// confirmatory tetrad analysis and confirmatory composite analysis.

import { useState, type ReactNode } from 'react';
import { fmt } from '../format';
import type { ModelSpec, PlsOptions } from '../engine/types';
import { layoutCcaDiagram } from '../model/ccaDiagram';
import { toSpec, validateModel, type Settings } from '../model/project';
import { hexagonVertices } from '../geometry';
import { blindfoldTargets, type BlindfoldResult, type CcaEstimate, type CcaResult, type CompareResult, type CtaResult, type GroupsResult, type MgaApproach, type PredictResult } from '../rengine/plsx';
import { useStore } from '../store';
import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fingerprint } from './codec';
import { clampNum, columnsFingerprint, isObj, name, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

type CcaTab = 'fit' | 'diagram' | 'weights' | 'loadings' | 'vif' | 'correlations';
/** An example's assessment: which card, and its settings. */
export type AssessmentPreset = { tab: 'predict' | 'blindfold' | 'compare' | 'groups' | 'cca'; group?: string; distance?: number };

const APPROACHES: { id: MgaApproach; label: string }[] = [
  { id: 'Henseler', label: 'Henseler (bootstrap)' }, { id: 'Chin', label: 'Chin & Dibbern (permutation)' }, { id: 'Klesel', label: 'Klesel et al. (overall, dG / dL)' },
  { id: 'Sarstedt', label: 'Sarstedt et al. (bootstrap F)' }, { id: 'Keil', label: 'Keil et al. (parametric t)' }, { id: 'Nitzl', label: 'Nitzl (Welch–Satterthwaite t)' },
];

const fmtAlpha = (a: number) => Number(a.toFixed(3)).toString();

/** Shmueli et al. (2019): predictive power from the share of indicators where PLS beats the LM benchmark. */
export function predictivePower(rows: PredictResult['indicators']): string {
  if (rows.some((r) => !(r.q2 > 0))) return 'Q²predict is not above 0 for every indicator: the model lacks predictive relevance there.';
  const better = rows.filter((r) => r.rmsePls < r.rmseLm).length;
  if (better === rows.length) return 'High predictive power: PLS beats the LM benchmark (RMSE) on every indicator.';
  if (better > rows.length / 2) return 'Medium predictive power: PLS beats the LM benchmark on most indicators.';
  if (better > 0) return 'Low predictive power: PLS beats the LM benchmark on a minority of indicators.';
  return 'No predictive power beyond the LM benchmark: PLS does not beat it on any indicator.';
}

function PredictView({ r }: { r: PredictResult }) {
  return (
    <div className="tables">
      <Table title="PLSpredict" file="plspredict" columns={['Indicator', 'Construct', 'Q²predict', 'RMSE (PLS)', 'RMSE (LM)', 'MAE (PLS)', 'MAE (LM)']}
        rows={r.indicators.map((x) => [c(x.indicator), c(x.construct), { ...c(x.q2), bold: !(x.q2 > 0) }, { ...c(x.rmsePls), bold: x.rmsePls < x.rmseLm }, c(x.rmseLm), { ...c(x.maePls), bold: x.maePls < x.maeLm }, c(x.maeLm)])}
        note={<>{predictivePower(r.indicators)} {r.folds}-fold cross-validation, {r.repetitions} repetitions (averaged). Bold: PLS better than the LM benchmark (or Q²predict not above 0). Shmueli et al. (2019); cSEM’s predict.</>} />
    </div>
  );
}

function CompareView({ r }: { r: CompareResult }) {
  const names = Object.keys(r.criteria[0]?.byConstruct ?? {});
  const pick = ['BIC', 'GM', 'AIC', 'AICc', 'HQ'];
  const rows: Row[] = r.criteria.filter((k) => pick.includes(k.criterion)).flatMap((k) => {
    const alt = r.criteriaAlt.find((a) => a.criterion === k.criterion)!;
    return names.map((n) => {
      const a = k.byConstruct[n], b = alt?.byConstruct[n];
      return [c(k.criterion), c(n), { ...c(a), bold: a < b }, { ...c(b), bold: b < a }];
    });
  });
  return (
    <div className="tables">
      <Table title="Information criteria per endogenous construct" file="pls-model-selection" columns={['Criterion', 'Construct', 'This model', 'Alternative']} rows={rows}
        note="Lower is better (bold: the better model). Sharma et al. (2019, 2021) recommend BIC and GM for choosing among PLS models." />
      <Table title="CVPAT: out-of-sample prediction loss" file="pls-cvpat" columns={['Loss, this model', 'Loss, alternative', 't', 'df', 'p']}
        rows={[[c(r.cvpat.loss), c(r.cvpat.lossAlt), c(r.cvpat.statistic, undefined, 2), c(r.cvpat.df, undefined, 0), pCell(r.cvpat.p)]]}
        note="Liengaard et al. (2021): a significant difference means the model with the lower average squared prediction error predicts better." />
    </div>
  );
}

function GroupsView({ r }: { r: GroupsResult }) {
  const cons = Object.keys(r.micom.c);
  const paths = r.groups[0]?.paths ?? [];
  return (
    <div className="tables">
      <Table title="Path coefficients by group" file="pls-groups-paths" columns={['Path', ...r.groups.map((g) => `${g.group} (n = ${g.n})`)]}
        rows={paths.map((p, i) => [c(`${p.from} → ${p.to}`), ...r.groups.map((g) => c(g.paths[i]?.est ?? null))])} />
      <Table title="MICOM: measurement invariance of composites" file="pls-micom" columns={['Construct', 'c (step 2)', 'p', 'Mean diff. (step 3a)', 'p', 'Log variance ratio (3b)', 'p']}
        rows={cons.map((k) => [c(k), c(r.micom.c[k]), pCell(r.micom.cP[k] ?? null), c(r.micom.mean.statistic[k] ?? null), pCell(r.micom.mean.p[k] ?? null), c(r.micom.variance.statistic[k] ?? null), pCell(r.micom.variance.p[k] ?? null)])}
        note={`Henseler, Ringle & Sarstedt (2016). Step 1 (configural) holds by design: the same model and indicators in each group. Step 2: c should not differ from 1 (p > .05) — partial invariance, which allows comparing paths. Step 3: equal means and variances too — full invariance, which allows pooling the groups. ${r.micom.admissible} of ${r.micom.runs} permutations admissible.`} />
      {r.mga.map((a) => a.overall ? (
        <Table key={a.approach} title="Overall test (Klesel et al. 2019)" file="pls-mga-klesel" columns={['Distance', 'Statistic', 'p']}
          rows={[[c('dG (geodesic)'), c(a.overall.dG.statistic), pCell(a.overall.dG.p)], [c('dL (Euclidean)'), c(a.overall.dL.statistic), pCell(a.overall.dL.p)]]}
          note="Do the groups' model-implied indicator correlations differ at all? A small p: the groups differ somewhere in the model." />
      ) : a.comparisons?.map((cmp) => (
        <Table key={`${a.approach}-${cmp.groups}`} title={`${APPROACHES.find((x) => x.id === a.approach)?.label}${cmp.groups === 'all' ? '' : `: ${cmp.groups.replace('_', ' vs ')}`}`}
          file={`pls-mga-${a.approach.toLowerCase()}`} columns={a.approach === 'Henseler' ? ['Path', 'p'] : ['Path', 'Statistic', 'p']}
          rows={cmp.paths.map((p) => (a.approach === 'Henseler' ? [c(`${p.from} → ${p.to}`), pCell(p.p)] : [c(`${p.from} → ${p.to}`), c(p.statistic), pCell(p.p)]))}
          note={a.approach === 'Henseler' ? 'Henseler et al. (2009), bootstrap-based. Chin & Dibbern: permutation of group membership; Keil / Nitzl: parametric t tests. The path differences are in the table of path coefficients by group.' : a.approach === 'Chin' ? 'Statistic: the difference between the groups’ paths; p from permuting group membership.' : undefined} />
      )))}
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

function CtaView({ r }: { r: CtaResult }) {
  return (
    <div className="tables">
      {r.blocks.map((b) => (
        <Table key={b.construct} title={`${b.construct}: ${b.tetrads.some((t) => t.differs) ? 'evidence against a reflective model' : 'consistent with a reflective model'}`} file={`cta-${b.construct}`}
          columns={['Tetrad (indicators g, h, i, j)', 'Value', 'Std. error', 't', 'p', 'CI low (adj.)', 'CI high (adj.)']}
          rows={b.tetrads.map((t) => [c(t.tetrad), { ...c(t.est), bold: t.differs }, c(t.se), c(t.t, undefined, 2), pCell(t.p), c(t.low), c(t.high)])}
          note={`τ = σgh·σij − σgi·σhj vanishes in a reflective block. ${b.tetrads.length} non-redundant tetrads; bias-corrected bootstrap intervals (${r.samples} samples), Bonferroni-adjusted (α = ${r.alpha} / ${b.tetrads.length}). Bold: the interval excludes 0.`} />
      ))}
      <div className="hint">Gudergan, Ringle, Wende &amp; Will (2008): if any non-redundant tetrad differs from zero, a reflective (common factor) model is not supported — consider a composite model (an emergent variable) instead. PLS Studio’s implementation; no R package offers CTA-PLS.</div>
    </div>
  );
}

function BlindfoldView({ r }: { r: BlindfoldResult }) {
  return (
    <div className="tables">
      <Table title="Blindfolding: Q² (cross-validated redundancy)" file="blindfolding-q2" columns={['Construct', 'SSO', 'SSE', 'Q² (= 1 − SSE/SSO)', 'Predictive relevance']}
        rows={r.constructs.map((k) => [c(k.construct), c(k.sso, undefined, 2), c(k.sse, undefined, 2), { ...c(k.q2), bold: k.q2 > 0 }, c(k.q2 > 0.5 ? 'large' : k.q2 > 0.25 ? 'medium' : k.q2 > 0 ? 'small' : 'none')])}
        note={`Omission distance D = ${r.distance}, n = ${r.n}. Every D-th data point of a construct's (standardised) indicators is omitted in turn, replaced by the mean, and predicted from the predecessor constructs (Stone 1974; Geisser 1974; Chin 1998). Q² > 0: predictive relevance; 0.02 / 0.15 / 0.35 are sometimes used for q² effect sizes, 0 / 0.25 / 0.5 for small / medium / large Q² (Hair et al. 2019).${r.divisible ? ` n is a multiple of D; Hair et al. advise a D that does not divide n.` : ''}`} />
      <div className="hint">As semPLS’s qSquared (Monecke &amp; Leisch 2012) with mean replacement; checked against it. SmartPLS 4 dropped blindfolding: Q² mixes in-sample explanation and prediction (Shmueli et al. 2016); for out-of-sample prediction use the Prediction tab (PLSpredict) and CVPAT.</div>
    </div>
  );
}

const ciCell = (k: CcaEstimate) => ({ ...c(k.est), bold: k.low > 0 || k.high < 0 });
const excludesZero = (k: CcaEstimate) => k.low > 0 || k.high < 0;

/**
 * The composite model as estimated, drawn like Henseler (2021): hexagons formed
 * by their indicators (weights or loadings on the arrows), every pair of
 * composites correlated, no directed paths; the overall fit test below.
 */
function CcaDiagramView({ r }: { r: CcaResult }) {
  const [show, setShow] = useState<'weights' | 'loadings'>('weights');
  const constructs = useStore((s) => s.model.constructs);
  const at = new Map(constructs.map((k) => [k.name, k]));
  // Left to right as drawn on the canvas.
  const order = [...r.composites].sort((a, b) => (at.get(a)?.x ?? 0) - (at.get(b)?.x ?? 0) || (at.get(a)?.y ?? 0) - (at.get(b)?.y ?? 0));
  const list = show === 'weights' ? r.weights : r.loadings;
  const d = layoutCcaDiagram({
    composites: order.map((name) => ({ name, indicators: r.weights.filter((w) => w.construct === name).map((w) => w.indicator) })),
    value: (comp, ind) => { const k = list.find((x) => x.construct === comp && x.indicator === ind); return k ? { est: k.est, significant: excludesZero(k) } : null; },
    correlation: (a, b) => r.correlations[r.composites.indexOf(a)]?.[r.composites.indexOf(b)] ?? null,
  });
  const srmr = r.fit.find((f) => f.measure === 'SRMR');
  const label = (x: number, y: number, text: string, bold: boolean, key: string) => (
    <g key={key}>
      <rect x={x - 20} y={y - 8} width={40} height={15} rx={7.5} fill="#fff" stroke="#cbd5e1" />
      <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={bold ? 700 : 400} fill="#334155">{text}</text>
    </g>
  );
  return (
    <div>
      <div className="segmented" role="radiogroup" aria-label="Values on the indicator arrows" style={{ width: 220, marginBottom: 6 }}>
        {(['weights', 'loadings'] as const).map((k) => <button key={k} role="radio" aria-checked={show === k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'weights' ? 'Weights' : 'Loadings'}</button>)}
      </div>
      <ChartFrame id="cca:diagram" name="cca-diagram" width={d.width} height={d.height} defaults={{ x: '', y: '' }} axes={false}
        caption={<figcaption className="hint">{srmr ? `SRMR ${fmt(srmr.statistic)} (HI95 ${fmt(srmr.q95)}): ${srmr.statistic > srmr.q95 ? 'the composite model is rejected' : 'the composite model fits'}. ` : ''}Hexagons: composites formed by their indicators ({show}; bold: the {Math.round((1 - r.alpha) * 100)}% interval excludes 0). Arcs: composite correlations — the saturated structural model, all composites free to correlate. Order: top to bottom as on the canvas (left to right, then top to bottom).</figcaption>}>
        {() => (
          <svg className="mc-chart" width={d.width} height={d.height} viewBox={`0 0 ${d.width} ${d.height}`} style={{ maxWidth: '100%', height: 'auto' }} role="img" aria-label="Confirmatory composite analysis diagram">
            <defs>
              <marker id="cca-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b" /></marker>
            </defs>
            {d.arcs.map((a) => <path key={`${a.a}|${a.b}`} d={a.d} fill="none" stroke="#94a3b8" strokeWidth={1.1} markerStart="url(#cca-arrow)" markerEnd="url(#cca-arrow)" />)}
            {d.composites.map((k) => (
              <g key={k.name} transform={`translate(${k.cx} ${k.cy})`}>
                {k.geom.indicators.map((ind) => (
                  <g key={ind.name}>
                    <line x1={ind.ax} y1={ind.ay} x2={ind.ex} y2={ind.ey} stroke="#64748b" strokeWidth={1.1} markerEnd="url(#cca-arrow)" />
                    <rect x={ind.x} y={ind.y} width={ind.w} height={ind.h} rx={5} fill="#f8fafc" stroke="#94a3b8" />
                    <text x={ind.x + ind.w / 2} y={ind.y + ind.h / 2 + 4} textAnchor="middle" fontSize={11} fill="#334155">{ind.name}</text>
                  </g>
                ))}
                <polygon points={hexagonVertices(k.geom.rx, k.geom.ry).map((v) => v.join(',')).join(' ')} fill="#ede9fe" stroke="#6d28d9" strokeWidth={1.4} />
                <text x={0} y={4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#1e1b4b">{k.name}</text>
                {k.geom.indicators.map((ind, i) => k.values[i] && label((ind.ex + ind.ax) / 2, (ind.ey + ind.ay) / 2, fmt(k.values[i]!.est), k.values[i]!.significant, ind.name))}
              </g>
            ))}
            {d.arcs.map((a) => a.value !== null && label(a.lx, a.ly, fmt(a.value), false, `${a.a}|${a.b}`))}
          </svg>
        )}
      </ChartFrame>
    </div>
  );
}
function CcaView({ r }: { r: CcaResult }) {
  const conf = `${Math.round((1 - r.alpha) * 100)}%`;
  const rejected = r.fit.filter((f) => ['SRMR', 'dL', 'dG'].includes(f.measure) && f.statistic > f.q95).map((f) => f.measure);
  const tabs: [CcaTab, string][] = [['fit', 'Overall fit'], ['diagram', 'Diagram'], ['weights', 'Weights'], ['loadings', 'Loadings'], ...(r.vif.length ? [['vif', 'Collinearity (VIF)'] as [CcaTab, string]] : []), ['correlations', 'Correlations']];
  const [chosen, setChosen] = useState<CcaTab>('fit');
  const tab = tabs.some(([id]) => id === chosen) ? chosen : 'fit';
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="CCA results">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setChosen(id)}>{label}</button>
        ))}
      </div>
      <div className="tables">
      {tab === 'diagram' && <CcaDiagramView r={r} />}
      {tab === 'fit' && <Table title={`Overall fit of the composite model: ${rejected.length ? `rejected by ${rejected.join(', ')}` : 'not rejected'}`} file="cca-fit"
        columns={['Discrepancy', 'Value', 'HI95 (95% quantile)', 'HI99 (99% quantile)', 'Decision (5%)']}
        rows={r.fit.map((f) => [c(f.measure === 'dL' ? 'dULS (dL)' : f.measure), { ...c(f.statistic), bold: f.statistic > f.q95 }, c(f.q95), c(f.q99), c(f.statistic > f.q99 ? 'reject (also at 1%)' : f.statistic > f.q95 ? 'reject' : 'do not reject')])}
        note={`Bootstrap test of the saturated composite model (Beran & Srivastava 1985; ${r.admissible} of ${r.samples} samples admissible): the model fits when each discrepancy stays below its bootstrap quantile (Henseler 2021 reports SRMR, dULS and dG). H0: the model-implied indicator covariances equal the population's.`} />}
      {tab === 'weights' && <Table title="Weights" file="cca-weights" columns={['Composite', 'Indicator', 'Weight', 'Std. error', 'p', `${conf} CI low`, `${conf} CI high`]}
        rows={r.weights.map((k) => [c(k.construct), c(k.indicator), ciCell(k), c(k.se), pCell(k.p), c(k.low), c(k.high)])}
        note="Bootstrap percentile intervals; bold: the interval excludes 0. Check the sign and size of each weight against theory (Schuberth et al. 2018)." />}
      {tab === 'loadings' && <Table title="Loadings" file="cca-loadings" columns={['Composite', 'Indicator', 'Loading', 'Std. error', 'p', `${conf} CI low`, `${conf} CI high`]}
        rows={r.loadings.map((k) => [c(k.construct), c(k.indicator), ciCell(k), c(k.se), pCell(k.p), c(k.low), c(k.high)])} note="Loadings: correlations of each indicator with its composite." />}
      {tab === 'vif' && <Table title="Collinearity of the Mode B weights" file="cca-vif" columns={['Composite', 'Indicator', 'VIF']}
        rows={r.vif.map((k) => [c(k.construct), c(k.indicator), { ...c(k.vif, undefined, 2), bold: k.vif > 5 }])} note="VIF above 5 (bold) or 3 suggests collinearity that makes the weights unstable." />}
      {tab === 'correlations' && <Table title="Composite correlations" file="cca-correlations" columns={['', ...r.composites]}
        rows={r.composites.map((k, i) => [c(k), ...r.correlations[i].map((v, j) => (j <= i ? c(v) : c('')))])}
        note="The saturated structural model: all composites freely correlated. Correlations close to 1 question discriminant validity." />}
      <div className="hint">Confirmatory composite analysis (Schuberth, Henseler &amp; Dijkstra 2018; Henseler 2021): are the constructs emergent variables — composites of their indicators? Every construct is treated as a composite (Mode A or B as drawn), the weights ignore the structural paths, and the fit of the saturated model is tested. cSEM, as its ?ITFlex example.</div>
    </div>
    </>
  );
}


// ---------- the model, as every assessment reads it ----------

/** The PLS options from the Model settings (FIML and MI fall back to casewise deletion here). */
export const plsOptions = (s: Settings): PlsOptions => ({
  scheme: s.scheme, maxIter: s.maxIter, tolerance: 10 ** -s.stopExp,
  missing: s.missing === 'fiml' || s.missing === 'mi' ? 'casewise' : s.missing, consistent: s.consistent,
});
const samplesOf = (s: Settings, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(s.bootSamples)));

/** Why the model on the canvas cannot be assessed (null when it can). */
export function plsModelBlocked(ctx: AnalysisCtx): string | null {
  if (ctx.settings.method !== 'pls') return 'PLS-SEM assessments are for PLS-SEM models: switch the model to PLS-SEM.';
  const ds = rawData(ctx);
  if (!ds) return 'Import raw data first (not a covariance matrix).';
  if (!ctx.model?.paths.length) return 'Draw a PLS path model first (Model tab).';
  const err = validateModel(ctx.model, ds, { ...ctx.settings, method: 'pls' }).find((i) => i.level === 'error');
  return err ? `Fix the model first: ${err.message}` : null;
}

/** Fingerprint of the model, its PLS options and indicator columns, plus what else an assessment reads. */
function modelFingerprint(ctx: AnalysisCtx, extraCols: string[] = [], extra: (string | number | null)[] = []): string | null {
  if (ctx.settings.method !== 'pls' || !ctx.model) return null;
  const cols = columnsFingerprint(ctx, [...new Set(ctx.model.constructs.flatMap((k) => k.indicators)), ...extraCols]);
  return cols && fingerprint([cols, JSON.stringify(toSpec(ctx.model)), JSON.stringify(plsOptions(ctx.settings)), ...extra]);
}

const specOf = (ctx: AnalysisCtx) => toSpec(ctx.model!);
const Hint = ({ children }: { children: ReactNode }) => <p className="hint" style={{ marginTop: 0 }}>{children}</p>;
const modelNote = (ctx: AnalysisCtx) => `The PLS-SEM model on the canvas, ${ctx.settings.scheme} weighting${ctx.settings.consistent ? ', PLSc' : ''} (Model settings).`;
const PLS_GROUP = 'PLS-SEM model' as const;

// ---------- PLSpredict ----------

export interface PredictOptions { folds: number; repetitions: number }
export const predictAnalysis: AnalysisType<PredictOptions, PredictResult> = {
  id: 'plspredict', title: 'PLSpredict', sub: 'out-of-sample prediction: Q²predict, RMSE and MAE against a linear benchmark', group: PLS_GROUP,
  defaults: () => ({ folds: 10, repetitions: 10 }),
  parseOptions: (raw) => (isObj(raw) ? { folds: clampNum(raw.folds, 2, 50, 10, true), repetitions: clampNum(raw.repetitions, 1, 100, 10, true) } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>PLSpredict (Shmueli et al. 2016, 2019): how well does the model predict the endogenous indicators for new cases? Cross-validated predictions compared with the training means (Q²predict) and with a linear-regression benchmark (LM). {modelNote(ctx)}</Hint>
      <div className="row2">
        <div className="field"><label htmlFor="pp-folds">Folds</label><input id="pp-folds" className="input num" type="number" min={2} max={50} value={o.folds} onChange={(e) => set({ ...o, folds: clampNum(e.target.value, 2, 50, 10, true) })} /></div>
        <div className="field"><label htmlFor="pp-reps">Repetitions</label><input id="pp-reps" className="input num" type="number" min={1} max={100} value={o.repetitions} onChange={(e) => set({ ...o, repetitions: clampNum(e.target.value, 1, 100, 10, true) })} /></div>
      </div>
    </fieldset>
  ),
  View: ({ result }) => <PredictView r={result} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], [ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/plsx')).predictR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), { folds: o.folds, repetitions: o.repetitions, seed: ctx.settings.seed }),
  script: async (o, ctx) => (await import('../rengine/plsx')).predictScriptR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), { folds: o.folds, repetitions: o.repetitions, seed: ctx.settings.seed }),
  summary: (o) => `${o.folds}-fold, ${o.repetitions} repetitions`,
};

// ---------- blindfolding ----------

export interface BlindfoldOptions { distance: number }
export const blindfoldAnalysis: AnalysisType<BlindfoldOptions, BlindfoldResult> = {
  id: 'blindfold', title: 'Blindfolding (Q²)', sub: 'Stone–Geisser Q², cross-validated redundancy', group: PLS_GROUP,
  defaults: () => ({ distance: 7 }),
  parseOptions: (raw) => (isObj(raw) ? { distance: clampNum(raw.distance, 2, 50, 7, true) } : null),
  Options: ({ options: o, set, ctx, disabled }) => {
    const targets = ctx.model ? blindfoldTargets(specOf(ctx)) : [];
    return (
      <fieldset className="card-options" disabled={disabled}>
        <Hint>Blindfolding: Stone–Geisser Q² (cross-validated redundancy) for the endogenous constructs with reflective indicators ({targets.length ? targets.join(', ') : 'none here'}). {modelNote(ctx)}</Hint>
        <div className="field"><label htmlFor="bf-d">Omission distance D (5–12 is usual)</label><input id="bf-d" className="input num" type="number" min={2} max={50} value={o.distance} onChange={(e) => set({ distance: clampNum(e.target.value, 2, 50, 7, true) })} /></div>
        <div className="hint">Superseded by PLSpredict and CVPAT for out-of-sample prediction; still asked for by some reviewers.</div>
      </fieldset>
    );
  },
  View: ({ result }) => <BlindfoldView r={result} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx) ?? (blindfoldTargets(specOf(ctx)).length ? null : 'No endogenous construct with reflective (Mode A) indicators.'),
  fingerprint: (_o, ctx) => modelFingerprint(ctx),
  run: async (o, ctx) => (await import('../rengine/plsx')).blindfoldR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), o.distance),
  script: async (o, ctx) => (await import('../rengine/plsx')).blindfoldScriptR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), o.distance),
  summary: (o) => `omission distance ${o.distance}`,
};

// ---------- model comparison ----------

/** The alternative model: the structural paths of an earlier diagram (same constructs and indicators). */
export interface CompareOptions { alternative: { paths: [string, string][]; savedAt: number } | null }

/** The alternative as a model: the diagram's constructs with the saved paths. */
export const alternativeSpec = (spec: ModelSpec, alt: NonNullable<CompareOptions['alternative']>): ModelSpec => ({ ...spec, paths: alt.paths.map(([from, to]) => ({ from, to })) });

function CompareOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<CompareOptions>) {
  const save = () => {
    if (!ctx.model) return;
    set({ alternative: { paths: specOf(ctx).paths.map((p) => [p.from, p.to]), savedAt: Date.now() } });
    useStore.getState().toast('success', 'Saved the paths as the alternative model. Now change the paths in the diagram (Model tab) and run the comparison.');
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>Compare the diagram with an alternative model (other paths, the same constructs and indicators): information criteria (Sharma et al. 2019) and CVPAT (Liengaard et al. 2021). {modelNote(ctx)}</Hint>
      <button className="btn" disabled={!ctx.model?.paths.length} onClick={save}>Save the current paths as the alternative</button>
      <div className="hint" style={{ marginTop: 6 }}>
        {o.alternative ? `Alternative saved: ${o.alternative.paths.length} paths (${new Date(o.alternative.savedAt).toLocaleString()}).` : 'No alternative saved yet: save the paths, change them in the diagram, then compare.'}
      </div>
    </fieldset>
  );
}

export const compareAnalysis: AnalysisType<CompareOptions, CompareResult> = {
  id: 'compare', title: 'Model comparison', sub: 'information criteria and CVPAT against an alternative model', group: PLS_GROUP,
  defaults: () => ({ alternative: null }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const a = isObj(raw.alternative) ? raw.alternative : null;
    const paths = a && Array.isArray(a.paths) ? a.paths.slice(0, 5000).filter((p): p is unknown[] => Array.isArray(p) && p.length === 2).map((p) => [name(p[0]), name(p[1])] as [string, string]).filter(([f, t]) => f && t) : [];
    return { alternative: a ? { paths, savedAt: clampNum(a.savedAt, 0, 1e15, 0) } : null };
  },
  Options: CompareOptionsForm,
  View: ({ result }) => <CompareView r={result} />,
  blocked: (o, ctx) => {
    const m = plsModelBlocked(ctx);
    if (m) return m;
    if (!o.alternative) return 'Save the current paths as the alternative, change the paths, then run.';
    const names = new Set(specOf(ctx).constructs.map((k) => k.name));
    const gone = [...new Set(o.alternative.paths.flat().filter((n) => !names.has(n)))];
    if (gone.length) return `The alternative uses constructs the diagram no longer has (${gone.join(', ')}): save it again.`;
    const now = JSON.stringify(specOf(ctx).paths.map((p) => [p.from, p.to]).sort());
    return now === JSON.stringify([...o.alternative.paths].sort()) ? 'The diagram still has the alternative’s paths: change them first.' : null;
  },
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], [ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/plsx')).compareR(rawData(ctx)!, specOf(ctx), alternativeSpec(specOf(ctx), o.alternative!), plsOptions(ctx.settings), ctx.settings.seed),
  script: async (o, ctx) => (await import('../rengine/plsx')).compareScriptR(rawData(ctx)!, specOf(ctx), alternativeSpec(specOf(ctx), o.alternative!), plsOptions(ctx.settings), ctx.settings.seed),
  summary: (o) => (o.alternative ? `diagram vs ${o.alternative.paths.length}-path alternative` : 'no alternative saved yet'),
};

// ---------- MICOM and multigroup analysis ----------

export interface GroupsOptions { group: string; approaches: MgaApproach[] }

/** Columns that can split the sample: not in the model, at most 10 distinct values. */
function groupColumns(ctx: AnalysisCtx): string[] {
  const ds = rawData(ctx);
  if (!ds) return [];
  const assigned = new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators));
  return ds.names.filter((n, i) => !assigned.has(n) && new Set(Array.from(ds.cols[i]).filter((v) => !Number.isNaN(v))).size <= 10);
}

export const groupsAnalysis: AnalysisType<GroupsOptions, GroupsResult> = {
  id: 'mga', title: 'MICOM and multigroup analysis', sub: 'measurement invariance of composites, then group differences in the paths', group: PLS_GROUP,
  defaults: () => ({ group: '', approaches: ['Henseler', 'Chin', 'Klesel'] }),
  parseOptions: (raw) => (isObj(raw) ? {
    group: name(raw.group),
    approaches: [...new Set((Array.isArray(raw.approaches) ? raw.approaches : []).filter((a): a is MgaApproach => APPROACHES.some((x) => x.id === a)))],
  } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>MICOM (is the measurement comparable across groups?) and multigroup analysis (do the paths differ?). Permutations and bootstrap samples: {samplesOf(ctx.settings, 20, 5000)} (Model settings). {modelNote(ctx)}</Hint>
      <div className="field">
        <label htmlFor="mga-group">Groups (a column not in the model, at most 10 values)</label>
        <select id="mga-group" className="select" value={o.group} onChange={(e) => set({ ...o, group: e.target.value })}>
          <option value="">Choose…</option>
          {[...new Set([...(o.group ? [o.group] : []), ...groupColumns(ctx)])].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Multigroup tests</label>
        {APPROACHES.map((a) => (
          <label key={a.id} className="check" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={o.approaches.includes(a.id)} onChange={(e) => set({ ...o, approaches: e.target.checked ? [...o.approaches, a.id] : o.approaches.filter((x) => x !== a.id) })} />
            <span>{a.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  ),
  View: ({ result }) => <GroupsView r={result} />,
  blocked: (o, ctx) => plsModelBlocked(ctx) ?? (!o.group ? 'Choose the grouping column.' : !groupColumns(ctx).includes(o.group) ? `${o.group} is not a grouping column here (in the model, missing, or more than 10 values).` : !o.approaches.length ? 'Choose at least one multigroup test.' : null),
  fingerprint: (o, ctx) => modelFingerprint(ctx, [o.group], [samplesOf(ctx.settings, 20, 5000), ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/plsx')).groupsR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), { group: o.group, approaches: o.approaches, samples: samplesOf(ctx.settings, 20, 5000), seed: ctx.settings.seed }),
  script: async (o, ctx) => (await import('../rengine/plsx')).groupsScriptR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), { group: o.group, approaches: o.approaches, samples: samplesOf(ctx.settings, 20, 5000), seed: ctx.settings.seed }),
  summary: (o) => (o.group ? `groups: ${o.group} · ${o.approaches.length} test${o.approaches.length === 1 ? '' : 's'}` : 'not set up yet'),
};

// ---------- CTA and CCA ----------

const ctaCfg = (s: Settings) => ({ samples: samplesOf(s, 50, 20000), seed: s.seed, alpha: 1 - s.confidence });
const ccaCfg = (s: Settings) => ({ samples: samplesOf(s, 20, 5000), seed: s.seed, alpha: 1 - s.confidence });
const ctaBlocks = (ctx: AnalysisCtx) => (ctx.model?.constructs ?? []).filter((k) => k.indicators.length >= 4).length;

export const ctaAnalysis: AnalysisType<Record<string, never>, CtaResult> = {
  id: 'cta', title: 'Confirmatory tetrad analysis', sub: 'CTA-PLS: reflective or composite measurement?', group: PLS_GROUP,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: ({ ctx }) => <Hint>Confirmatory tetrad analysis (CTA-PLS; Gudergan et al. 2008): is a block reflective (indicators caused by one common factor) or better modelled as a composite (an emergent variable)? For constructs with at least four indicators ({ctaBlocks(ctx)} here). Bootstrap samples {ctaCfg(ctx.settings).samples} and α = {fmtAlpha(1 - ctx.settings.confidence)} from the Model settings.</Hint>,
  View: ({ result }) => <CtaView r={result} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx) ?? (ctaBlocks(ctx) ? null : 'No construct has four or more indicators.'),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], Object.values(ctaCfg(ctx.settings))),
  run: async (_o, ctx) => (await import('../rengine/plsx')).ctaR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings).missing, ctaCfg(ctx.settings)),
  script: async (_o, ctx) => (await import('../rengine/plsx')).ctaScriptR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings).missing, ctaCfg(ctx.settings)),
  summary: () => 'the PLS-SEM model on the canvas',
};

export const ccaAnalysis: AnalysisType<Record<string, never>, CcaResult> = {
  id: 'cca', title: 'Confirmatory composite analysis', sub: 'CCA: overall fit of the composite model, weights, loadings, VIF', group: PLS_GROUP,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: ({ ctx }) => <Hint>Confirmatory composite analysis (Schuberth, Henseler &amp; Dijkstra 2018): do the composites — every construct formed from its indicators, Mode A or B as drawn — fit the data? Bootstrap test of overall fit (SRMR, dULS, dG) and the weights, loadings and VIFs. Bootstrap samples {ccaCfg(ctx.settings).samples} and {Math.round(ctx.settings.confidence * 100)}% intervals from the Model settings.</Hint>,
  View: ({ result }) => <CcaView r={result} />,
  blocked: (_o, ctx) => plsModelBlocked(ctx),
  fingerprint: (_o, ctx) => modelFingerprint(ctx, [], Object.values(ccaCfg(ctx.settings))),
  run: async (_o, ctx) => (await import('../rengine/plsx')).ccaR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), ccaCfg(ctx.settings)),
  script: async (_o, ctx) => (await import('../rengine/plsx')).ccaScriptR(rawData(ctx)!, specOf(ctx), plsOptions(ctx.settings), ccaCfg(ctx.settings)),
  summary: () => 'the PLS-SEM model on the canvas',
};

/** The card an example's assessment opens, with its settings. */
export function assessmentCard(p: AssessmentPreset): [string, object] {
  const id = { predict: 'plspredict', blindfold: 'blindfold', compare: 'compare', groups: 'mga', cca: 'cca' }[p.tab];
  return [id, { ...(p.group ? { group: p.group } : {}), ...(p.distance ? { distance: p.distance } : {}) }];
}
