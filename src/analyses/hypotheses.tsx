// Informative hypothesis evaluation for the CB-SEM model on the canvas: order-restricted hypotheses on labelled
// parameters ("b1 > b2 > 0", "b1 = b2") weighed by the GORICA (restriktor) and by approximate adjusted fractional
// Bayes factors (bain), instead of a chain of null-hypothesis tests.

import { labelUses } from '../model/project';
import { hypothesisErrors } from '../model/hypothesis';
import type { BainResult, GoricaResult, HypComparison, HypMethod, HypResult } from '../rengine/hypotheses';
import { c, Table, type Row } from '../components/results/Table';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { Choice, clampNum, flag, Hint, isObj, name, NumField, oneOf } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export interface HypOptions { text: string; method: HypMethod; comparison: HypComparison; standardized: boolean; fraction: number }

/** The statistically distinct methods (validation/cards.ts); 'both' runs the two. */
export const HYP_MODES = ['gorica', 'bain'] as const;
const METHODS = [['gorica', 'GORICA'], ['bain', 'Bayes factors'], ['both', 'Both']] as const;
const COMPARISONS = [['complement', 'Complement'], ['unconstrained', 'Unconstrained'], ['none', 'Each other']] as const;
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const labelsOf = (ctx: AnalysisCtx) => new Set(ctx.model ? labelUses(ctx.model).keys() : []);
const requestOf = (o: HypOptions, ctx: AnalysisCtx) => ({ ...o, seed: ctx.settings.seed });

/** The GORICA table and the ratios of its weights. */
function GoricaTables({ g, names }: { g: GoricaResult; names: string[] }) {
  const label = (m: string) => { const i = /^H(\d+)$/.exec(m); return i ? `${m}: ${names[Number(i[1]) - 1] ?? ''}` : m === 'complement' ? 'Complement' : m === 'unconstrained' ? 'Unconstrained' : m; };
  const best = g.gorica.indexOf(Math.min(...g.gorica));
  const rows: Row[] = g.models.map((m, i) => [c(label(m)), c(g.loglik[i], undefined, 3), c(g.penalty[i], undefined, 3), { ...c(g.gorica[i], undefined, 3), bold: i === best }, { ...c(g.weights[i], undefined, 3), bold: i === best }]);
  const short = (m: string) => (m === 'complement' ? 'Complement' : m === 'unconstrained' ? 'Unconstrained' : m);
  return (
    <>
      <Table title="GORICA values and weights" file="gorica" columns={['Hypothesis', 'Log-likelihood', 'Penalty', 'GORICA', 'GORICA weight']} rows={rows}
        note={`The GORICA (Altinisik et al. 2021) is −2 × (the log-likelihood of the estimates under the hypothesis’s constraints, from their asymptotic normal distribution) + 2 × the penalty, the hypothesis’s complexity (the expected number of distinct parameters under the constraints, from chi-bar-square level probabilities). Lower is better (bold); the weights are the relative support of each hypothesis in the set. ${g.comparison === 'complement' ? 'Against its complement (every order the hypothesis rules out), a weight above .5 supports the hypothesis.' : g.comparison === 'unconstrained' ? 'The unconstrained hypothesis is a safeguard: a hypothesis that is not better than it is weak.' : 'The hypotheses are compared with each other only: the best of a set of poor hypotheses still gets the most weight.'}`} />
      {g.models.length > 1 && (
        <Table title="Ratios of the GORICA weights" file="gorica-ratios" columns={['', ...g.models.map(short)]} rows={g.models.map((m, i) => [c(short(m)), ...g.ratio[i].map((v) => c(v, undefined, 2))])}
          note="Row versus column: how many times more support the row hypothesis has than the column hypothesis (the ratio of their weights)." />
      )}
    </>
  );
}

/** bain's table and its Bayes factor matrix. */
function BainTables({ b, names }: { b: BainResult; names: string[] }) {
  const label = (r: string) => { const i = /^H(\d+)$/.exec(r); return i ? `${r}: ${names[Number(i[1]) - 1] ?? ''}` : r === 'Hu' ? 'Hu: unconstrained' : r === 'Hc' ? 'Hc: complement of all' : r; };
  const rows: Row[] = b.rows.map((r, i) => [c(label(r)), c(b.fit[i], undefined, 3), c(b.com[i], undefined, 3), c(b.bfu[i], undefined, 3), c(b.bfc[i], undefined, 3), c(b.pmpa[i], undefined, 3), c(b.pmpb[i], undefined, 3), c(b.pmpc[i], undefined, 3)]);
  const hs = b.rows.filter((r) => /^H\d+$/.test(r));
  return (
    <>
      <Table title="Bayes factors and posterior model probabilities (bain)" file="bain" columns={['Hypothesis', 'Fit', 'Complexity', 'BF vs unconstrained', 'BF vs complement', 'PMP a', 'PMP b (with Hu)', 'PMP c (with Hc)']} rows={rows}
        note={`Approximate adjusted fractional Bayes factors (Gu, Mulder & Hoijtink 2018), b = ${b.fraction} × the number of independent constraints / N. Fit and complexity: the posterior and prior probability (or density, for equalities) of the constraints; BF vs unconstrained = fit / complexity; BF vs complement compares the hypothesis with every order it rules out (for a hypothesis with equalities it equals the BF vs unconstrained). Posterior model probabilities with equal prior probabilities: a among the hypotheses, b with the unconstrained hypothesis Hu added, c with Hc, the complement of their union. A BF above 3 is positive, above 20 strong evidence (Kass & Raftery 1995).`} />
      {hs.length > 1 && (
        <Table title="Bayes factors between the hypotheses" file="bain-matrix" columns={['', ...hs]} rows={hs.map((r, i) => [c(r), ...(b.matrix[i] ?? []).map((v) => c(v, undefined, 3))])}
          note="Row versus column: the Bayes factor of the row hypothesis against the column hypothesis." />
      )}
    </>
  );
}

function HypView({ r }: { r: HypResult }) {
  const names = r.hypotheses;
  return (
    <div className="tables">
      <Table title={`Parameters in the hypotheses${r.standardized ? ' (standardised)' : ''}`} file="hypothesis-parameters" columns={['Label', 'Parameter', r.standardized ? 'Std. estimate' : 'Estimate', 'Std. error']}
        rows={r.estimates.map((e) => [c(e.label), c(e.what), c(e.est), c(e.se)])}
        note={`The estimates the hypotheses are evaluated on (N = ${r.n}${r.standardized ? '; standardised: lavaan’s standardizedSolution and its delta-method covariance matrix' : ''}). Parameters on different scales are compared meaningfully only standardised.`} />
      {r.gorica && <GoricaTables g={r.gorica} names={names} />}
      {r.bain && <BainTables b={r.bain} names={names} />}
      <p className="hint">{[r.gorica ? 'GORICA: restriktor::goric' : '', r.bain ? 'Bayes factors: bain::bain' : ''].filter(Boolean).join('; ')} on the lavaan fit ({r.engine.package} {r.engine.version}). The penalty and the Bayes factors are computed by simulation: the seed comes from the Model settings, so a rerun gives the same values. State hypotheses before seeing the estimates.</p>
    </div>
  );
}

export const hypothesesAnalysis: AnalysisType<HypOptions, HypResult> = {
  id: 'hypotheses', title: 'Informative hypotheses', sub: 'order-restricted hypotheses on labelled parameters (b1 > b2 > 0) by GORICA weights and Bayes factors (restriktor, bain)', group: 'CB-SEM model',
  fitsModel: true,
  defaults: (ctx) => { const l = [...labelsOf(ctx)]; return { text: l.length > 1 ? `${l[0]} > ${l[1]}` : l.length ? `${l[0]} > 0` : '', method: 'both', comparison: 'complement', standardized: false, fraction: 1 }; },
  parseOptions: (raw) => (isObj(raw) ? {
    text: name(raw.text, 5000), method: oneOf(raw.method, ['gorica', 'bain', 'both'] as const, 'both'), comparison: oneOf(raw.comparison, ['complement', 'unconstrained', 'none'] as const, 'complement'),
    standardized: flag(raw.standardized), fraction: clampNum(raw.fraction, 1, 3, 1, true),
  } : null),
  Options: ({ options: o, set, ctx, disabled }) => {
    const labels = [...labelsOf(ctx)];
    return (
      <fieldset className="card-options" disabled={disabled}>
        <Hint>{`Theory often predicts an order (“the 1965 effect is larger than the 1960 one, and both are positive”) rather than “not zero”. Write each hypothesis on its own line over the parameters’ labels, constraints joined by & (b1 > b2 > 0 & b3 = 0; linear combinations such as 2*b1 − b2 > 0.1 too, abs(b1) > abs(b2) for sizes with the GORICA). The CB-SEM model on the canvas, estimated with ${ctx.settings.estimator} (Model settings).`}</Hint>
        <div className="field">
          <label htmlFor="hyp-text">Hypotheses (one per line)</label>
          <textarea id="hyp-text" className="input" rows={Math.max(2, Math.min(8, lines(o.text).length + 1))} value={o.text} placeholder="b1 > b2 > 0" spellCheck={false} onChange={(e) => set({ ...o, text: e.target.value })} />
          <div className="hint">{labels.length ? `Labels in the model: ${labels.join(', ')}.` : 'No labelled parameters yet: right-click a path, loading or covariance → Label….'}</div>
        </div>
        <Choice label="Evaluate by" value={o.method} options={METHODS} onChange={(method) => set({ ...o, method })} />
        {o.method !== 'bain' && <Choice label="GORICA: compare with" value={o.comparison} options={COMPARISONS} onChange={(comparison) => set({ ...o, comparison })}
          hint="one hypothesis: its complement (recommended) or the unconstrained hypothesis; several: the unconstrained hypothesis or each other." />}
        <label className="check"><input type="checkbox" checked={o.standardized} onChange={(e) => set({ ...o, standardized: e.target.checked })} /><span>Standardised parameters (compare parameters on different scales)</span></label>
        {o.method !== 'gorica' && <NumField id="hyp-fraction" label="bain: fraction (b = fraction × J / N)" value={o.fraction} lo={1} hi={3} int onChange={(fraction) => set({ ...o, fraction })} />}
      </fieldset>
    );
  },
  View: ({ result }) => <HypView r={result} />,
  blocked: (o, ctx) => {
    const base = cbModelBlocked(ctx, 'Informative hypothesis evaluation', false);
    if (base) return base;
    if (ctx.settings.estimator === '2SLS') return 'Informative hypotheses need the covariance matrix of all estimates: choose an estimator other than MIIV-2SLS.';
    const labels = labelsOf(ctx);
    if (!labels.size) return 'Label the parameters the hypotheses compare: right-click a path, loading or covariance → Label….';
    const err = hypothesisErrors(o.text, labels, o.method !== 'gorica')[0];
    if (err) return err;
    const n = lines(o.text).length;
    if (o.method !== 'bain' && o.comparison === 'complement' && n > 1) return 'The comparison with the complement is for one hypothesis: with several, compare them with the unconstrained hypothesis or with each other.';
    if (o.method !== 'bain' && o.comparison === 'none' && n < 2) return 'With one hypothesis, compare it with its complement or the unconstrained hypothesis.';
    if (o.method !== 'gorica' && ctx.model?.multigroup) return 'Bayes factors (bain) are available for one group here: use the GORICA with groups.';
    return null;
  },
  fingerprint: (o, ctx) => cbFingerprint(ctx, [o.text, o.method, o.comparison, o.standardized ? 1 : 0, o.fraction, ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/hypotheses')).hypothesesR(cbCall(ctx), requestOf(o, ctx)),
  script: async (o, ctx) => (await import('../rengine/hypotheses')).hypothesesScriptR(cbCall(ctx), requestOf(o, ctx)),
  summary: (o) => `${lines(o.text).length} hypothes${lines(o.text).length === 1 ? 'is' : 'es'}, ${METHODS.find(([m]) => m === o.method)![1]}${o.standardized ? ', standardised' : ''}`,
};

