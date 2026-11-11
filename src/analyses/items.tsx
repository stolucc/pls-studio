// Item analysis as analysis cards: item response theory (ltm; mirt for the 3PL, 4PL and mixture models)
// and latent class analysis (poLCA; glca for multilevel latent classes).

import { useState } from 'react';
import { fmt } from '../format';
import { irtMplusBlocked } from '../rengine/irtMplus';
import { isMirt, type IrtFit, type IrtModel, type IrtResult, type LcaAux, type LcaAuxMethod, type LcaAuxResult, type LcaKind, type LcaModel, type LcaResult, type LpaStructure } from '../rengine/items';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { Choice, clampNum, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

/** Inputs filled in by an example. */
/**
 * quadrature: Gauss-Hermite points (absent: the package's default); robust: sandwich standard errors (Mplus MLR; 2PL, partial
 * credit, 3PL, 4PL). The mirt models (absent in older saved cards): priorG / priorU, normal priors [mean, SD] on the logits of
 * the lower and upper asymptotes; guessItems, the items with a guessing parameter in the 3PL (absent: all); freq, a column of
 * frequencies (each row stands for that many respondents); classes, the mixture's number of latent classes.
 */
export interface IrtOptions { items: string[]; model: IrtModel; quadrature?: number; robust?: boolean; priorG?: [number, number]; priorU?: [number, number]; guessItems?: string[]; freq?: string; classes?: number; /** 'mplus': Mplus's integration rule (2PL, 3PL, 4PL; rengine/irtMplus.ts); absent: the package's quadrature. */ integration?: 'mplus' }
/**
 * model (absent: categorical items, poLCA): see LcaKind; structure: latent profiles; times: growth, one per item (occasion); cluster and
 * clusterClasses: multilevel; aux: auxiliary variables by the three-step approach (not for multilevel classes).
 */
export interface LcaOptions { items: string[]; from: number; to: number; model?: LcaKind; structure?: LpaStructure; times?: number[]; cluster?: string; clusterClasses?: number; aux?: LcaAux }

/** How step 3 relates covariates to the classes (distal outcomes always use BCH weights). */
export const LCA_AUX_METHODS: readonly (readonly [LcaAuxMethod, string])[] = [['ml', 'ML (Vermunt)'], ['bch', 'BCH weights']];

export const LCA_KINDS: { id: LcaKind; label: string; hint: string }[] = [
  { id: 'lca', label: 'Categorical items (latent classes)', hint: 'Categorical items (each value a category), poLCA.' },
  { id: 'lpa', label: 'Continuous items (latent profiles)', hint: 'Continuous items: a mixture of normal distributions within which the items are independent unless covariances are chosen, fitted by EM in R. Cases missing an item are left out.' },
  { id: 'lcga', label: 'Ordered outcome over time (latent class growth)', hint: 'The items are one ordered categorical outcome at successive occasions: each class has its own intercept and linear slope on the logit scale, with thresholds equal over time and classes and no variation within a class (Mplus’s LCGA). A missing occasion is left out of that person’s likelihood.' },
  { id: 'mlca', label: 'Categorical items, people in clusters (multilevel)', hint: 'Classes of people whose shares differ between classes of clusters (e.g. schools): Vermunt’s nonparametric multilevel latent class model, glca. The item probabilities are the same in every class of clusters (Mplus: TYPE = TWOLEVEL MIXTURE with a between-level class variable). Each number of classes is fitted from 10 random starts.' },
];
const STRUCTURES: { id: LpaStructure; label: string }[] = [
  { id: 'EEI', label: 'Variances equal across classes, no covariances (Mplus’s default)' },
  { id: 'VVI', label: 'Class-specific variances, no covariances' },
  { id: 'EEE', label: 'Covariances, equal across classes' },
  { id: 'VVV', label: 'Class-specific covariance matrices' },
];

const MODELS: { id: IrtModel; label: string; hint: string }[] = [
  { id: 'rasch', label: 'Rasch (1PL)', hint: 'Binary items; one common discrimination, item difficulties.' },
  { id: 'twopl', label: '2PL', hint: 'Binary items; each item its own difficulty and discrimination.' },
  { id: 'grm', label: 'Graded response', hint: 'Ordered categories (e.g. Likert items; Samejima): thresholds between successive categories and a discrimination per item.' },
  { id: 'gpcm', label: 'Partial credit (GPCM)', hint: 'Ordered categories (Muraki): step difficulties and a discrimination per item.' },
  { id: 'threepl', label: '3PL (guessing)', hint: 'Binary items; a discrimination, a difficulty and a lower asymptote (guessing) per item, mirt. A normal prior on the logit of the guessing parameter keeps it estimable (Mplus’s example 5.5: mean −1.386, i.e. g = .2, SD 1).' },
  { id: 'fourpl', label: '4PL (guessing and slipping)', hint: 'Binary items; the 3PL with an upper asymptote below 1 per item, mirt. Priors on the logits of both asymptotes are usually needed.' },
  { id: 'mixture', label: '2PL mixture (latent classes)', hint: 'Binary items; latent classes of people, each with its own discriminations and difficulties (factor mean 0 and variance 1 in each class): mixture IRT, mirt. Fitted from 10 starts (seed from the Model settings), keeping the best.' },
];
const PARAM: Record<string, string> = { Dffclt: 'Difficulty (b)', Dscrmn: 'Discrimination (a)', Gussng: 'Guessing (g)', Upper: 'Upper asymptote (u)' };
const paramName = (k: string) => PARAM[k] ?? k.replace(/^Extrmt(\d+)$/, 'Threshold $1').replace(/^Catgr\.(\d+)$/, 'Step $1');

function IrtView({ r }: { r: IrtResult }) {
  const keys = [...new Set(r.params.flatMap((p) => Object.keys(p.values)))];
  const total = r.theta.map((_, i) => r.information.reduce((s, a) => s + (a[i] ?? 0), 0));
  const W = 460, H = 240, pad = { l: 52, r: 14, t: 12, b: 40 };
  const max = Math.max(...total, 1e-9);
  const sx = (t: number) => pad.l + ((t + 4) / 8) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((max * 1.08 - v) / (max * 1.08)) * (H - pad.t - pad.b);
  const line = (vals: number[]) => r.theta.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(vals[i])}`).join(' ');
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['n', r.n, 0], ['Log-likelihood', r.logLik, 2], ...(r.logPrior != null ? [['Log-likelihood + log prior', r.logLik + r.logPrior, 2] as const] : []), ...(r.npar != null ? [['Parameters', r.npar, 0] as const] : []),
          ['AIC', r.aic, 1], ['BIC', r.bic, 1], ...(r.classes ? [] : [['Reliability', r.reliability ?? NaN, 3] as const])] as const).map(([k, v, d]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{Number.isFinite(v) ? fmt(v, d) : '—'}</div></div>
        ))}
      </div>
      {r.logPrior != null && <div className="hint">With priors the estimates maximise the log-likelihood plus the log prior density ({fmt(r.logPrior, 3)} at the estimates), the value Mplus prints as its log-likelihood; AIC and BIC are from the log-likelihood alone.</div>}
      {r.classes && <Table title="Latent classes" file="irt-classes" columns={['Class', 'Share']} rows={r.classes.map((s, i) => [c(`Class ${i + 1}`), c(s)])}
        note="Classes numbered by size. Within each class the factor has mean 0 and variance 1; the classes differ in their item parameters." />}
      <Table title="Item parameters" file="irt-items" columns={['Item', ...keys.map(paramName)]}
        rows={r.params.map((p) => [c(p.item), ...keys.map((k) => c(p.values[k] ?? null))])}
        note="IRT parameterisation: difficulties / thresholds on the latent trait scale (θ, mean 0, SD 1), where the probability of answering in or above a category is .5; discrimination: how sharply the item separates people near its difficulty." />
      {r.coefficients?.length ? (
        <Table title="Loadings and thresholds (logit metric)" file="irt-logit" columns={[...(r.classes ? ['Class'] : []), 'Item', 'Parameter', 'Estimate', r.robust ? 'Robust SE' : 'SE']}
          rows={r.coefficients.map((k) => [...(r.classes ? [c(String(k.class ?? ''))] : []), c(k.item), c(k.parameter, 'dim'), c(k.est), c(k.se)])}
          note={`The same model as Mplus prints it (factor variance 1): a loading is the discrimination, a threshold (a partial credit model’s step) is minus the package’s intercept, P(u = 1) = 1 / (1 + exp(threshold − loading × θ))${r.coefficients.some((k) => k.parameter.includes('asymptote')) ? '; with asymptotes, P(u = 1) = g + (u − g) / (1 + exp(threshold − loading × θ)), where threshold 2 is −logit(g) and threshold 3 −logit(u) (Mplus’s u$2 and u$3)' : ''}. ${r.classes ? 'Mixture: no standard errors.' : r.robust ? 'Robust (sandwich) standard errors, as Mplus’s MLR.' : 'Standard errors from the inverse Hessian.'}${r.quadrature ? ` ${r.quadrature} quadrature points.` : ''}`} />
      ) : null}
      {r.itemFit.length > 0 && (
        <Table title="Item fit" file="irt-itemfit" columns={['Item', 'χ²', 'p']} rows={r.itemFit.map((f) => [c(f.item), c(f.x2), pCell(f.p)])}
          note="Yen’s Q1 item-fit statistics (ltm::item.fit): a small p flags an item whose responses depart from the model." />
      )}
      {r.information.length > 0 && <ChartFrame id="irt:information" name="irt-information" width={W} height={H} defaults={{ x: 'Latent trait (θ)', y: 'Information' }}>
        {(labels) => (
          <svg className="mc-chart" width={W} height={H} role="img" aria-label="Test and item information">
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
            <text x={pad.l - 6} y={sy(max) + 4} textAnchor="end">{fmt(max, 1)}</text>
            <text x={pad.l - 6} y={sy(0) + 4} textAnchor="end">0</text>
            {[-4, -2, 0, 2, 4].map((t) => <text key={t} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">{t}</text>)}
            {r.information.map((a, i) => <path key={i} d={line(a)} stroke="#a5b4fc" strokeWidth={1.2} fill="none" />)}
            <path d={line(total)} stroke="#4f46e5" strokeWidth={2.4} fill="none" />
            <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
            <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
          </svg>
        )}
      </ChartFrame>}
      {r.information.length > 0 && <div className="hint">Bold: test information (the sum); light: each item. Information is the precision of θ: the standard error is 1/√information.</div>}
    </div>
  );
}

function LpaTables({ m, items }: { m: LcaModel; items: string[] }) {
  const cls = m.shares.map((_, i) => `Class ${i + 1}`);
  const cov = m.cov ?? [];
  const pairs = items.flatMap((a, i) => items.slice(i + 1).map((b, j) => [a, b, i, i + 1 + j] as const)).filter(([, , i, j]) => cov.some((s) => s[i][j] !== 0));
  return (
    <>
      <Table title="Class means" file="lpa-means" columns={['Item', ...cls]} rows={items.map((it, i) => [c(it), ...m.means!.map((mu) => c(mu[i]))])}
        note="The mean of each item within each class (classes numbered by size)." />
      <Table title={pairs.length ? 'Variances and covariances within class' : 'Variances within class'} file="lpa-variances" columns={['Parameter', ...cls]}
        rows={[...items.map((it, i) => [c(it), ...cov.map((s) => c(s[i][i]))]), ...pairs.map(([a, b, i, j]) => [c(`${a} ↔ ${b}`), ...cov.map((s) => c(s[i][j]))])]} />
    </>
  );
}

function AuxTables({ a }: { a: LcaAuxResult }) {
  const cls = a.D.map((_, i) => `Class ${i + 1}`);
  const cv = a.covariates;
  return (
    <>
      <Table title={`Three-step analysis: classification errors (${a.k} classes)`} file="lca-aux-errors" columns={['Class', ...cls.map((x) => `Assigned to ${x.toLowerCase()}`)]}
        rows={a.D.map((row, i) => [c(cls[i]), ...row.map((v, j) => c(v, i === j ? 'good' : ''))])}
        note={`Step 2 assigns each of the ${a.n} cases to its most likely class (${a.counts.map((n, i) => `class ${i + 1}: ${n}`).join(', ')}); row c gives P(assigned class | class c) from the posterior probabilities (Vermunt, 2010). Step 3 corrects for these errors: BCH weights (Bolck, Croon & Hagenaars, 2004; Bakk & Vermunt, 2016) for the distal outcomes${cv ? (a.method === 'ml' ? ', maximum likelihood with the errors as known (Vermunt, 2010; Mplus’s R3STEP) for the covariates' : ' and the covariates') : ''}. Standard errors are robust (sandwich) and take the classes as estimated in step 1 as known.`} />
      {a.distal && a.distal.length > 0 && <>
        <Table title="Distal outcomes: class means (BCH)" file="lca-aux-distal" columns={['Outcome', 'Class', 'Mean', 'SE', 'SD within class']}
          rows={a.distal.flatMap((d) => d.means.map((m, i) => [c(i ? '' : `${d.name} (n = ${d.n})`), c(cls[i]), c(m), c(d.se[i]), c(d.sd[i])]))}
          note="Each class’s mean with BCH weights: the classification errors of the assigned classes undone, so the means are not pulled towards each other. Cases missing the outcome are left out of its means. A binary outcome coded 0/1 gives the class proportions." />
        <Table title="Distal outcomes: equality of the class means (Wald)" file="lca-aux-distal-tests" columns={['Outcome', 'Test', 'χ²', 'df', 'p']}
          rows={a.distal.flatMap((d) => [[c(d.name), c('All classes equal'), c(d.chisq), c(d.df, '', 0), pCell(d.p)],
            ...d.pairs.map((q) => [c(''), c(`Class ${q.a} = class ${q.b}`), c(q.chisq), c(1, '', 0), pCell(q.p)])])} />
      </>}
      {cv && <>
        <Table title={`Covariates of class membership (multinomial logit, ${a.method === 'ml' ? 'ML three-step' : 'BCH weights'})`} file="lca-aux-covariates" columns={['Class', 'Term', 'Estimate', 'SE', 'p', 'Odds ratio']}
          rows={cv.coefs.flatMap((k) => cv.terms.map((t, j) => [c(j ? '' : `Class ${k.class} vs ${cv.reference}`), c(t), c(k.est[j]), c(k.se[j]), pCell(k.p[j] ?? null), c(t === 'Intercept' ? null : Math.exp(k.est[j]))]))}
          note={`Log odds of each class against class ${cv.reference} (the reference); an odds ratio is the factor by which those odds change with one unit of the covariate. ${cv.n} cases with every covariate${a.method === 'ml' ? `; log-likelihood of step 3: ${fmt(cv.logLik, 3)}` : ''}.`} />
        <Table title="Covariates: Wald tests (all classes)" file="lca-aux-covariates-wald" columns={['Term', 'χ²', 'df', 'p']}
          rows={cv.terms.map((t, j) => [c(t), c(cv.wald[j].chisq), c(cv.wald[j].df, '', 0), pCell(cv.wald[j].p)])}
          note="Whether the term’s coefficients are 0 for every class: whether the covariate is related to class membership at all." />
      </>}
    </>
  );
}

function LcaView({ r }: { r: LcaResult }) {
  const bestBic = Math.min(...r.models.map((m) => m.bic));
  const [k, setK] = useState(r.models.find((m) => m.bic === bestBic)?.k ?? r.models[0]?.k);
  const m = r.models.find((x) => x.k === k);
  return (
    <div className="tables">
      <Table title="Number of classes" file="lca-models" columns={['Classes', 'Log-likelihood', 'Parameters', 'AIC', 'BIC', 'Entropy', 'G²']}
        rows={r.models.map((x) => [{ v: String(x.k), bold: x.k === k }, c(x.llik, '', 2), c(x.npar, '', 0), c(x.aic, '', 1), c(x.bic, x.bic === bestBic ? 'good' : '', 1), c(x.entropy), c(x.gsq ?? null, '', 2)])}
        note="Lower BIC (green) is preferred (Nylund, Asparouhov & Muthén, 2007); entropy near 1 means the classes are well separated. Choose the solution to inspect below." />
      <div className="segmented" style={{ width: 'auto' }}>
        {r.models.map((x) => <button key={x.k} className={x.k === k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} class{x.k === 1 ? '' : 'es'}</button>)}
      </div>
      {m && (
        <>
          <Table title={`Class sizes (${m.k} classes)`} file="lca-shares" columns={['Class', 'Share']} rows={m.shares.map((s, i) => [c(`Class ${i + 1}`), c(s)])} />
          {m.clusters && <Table title={`Classes of clusters (${r.clusters ?? ''} clusters of ${r.cluster ?? ''})`} file="mlca-clusters" columns={['Cluster class', 'Share', ...m.shares.map((_, i) => `Class ${i + 1}`)]}
            rows={m.clusters.shares.map((s, b) => [c(`Cluster class ${b + 1}`), c(s), ...m.clusters!.byCluster[b].map((v) => c(v))])}
            note="Each cluster belongs to one class of clusters (numbered by size), which sets the shares of the classes of people in it (the rows sum to 1); the item probabilities below are the same in every class of clusters." />}
          {m.means && <LpaTables m={m} items={r.items} />}
          {m.growth && <Table title="Growth parameters (logit scale)" file="lcga-growth" columns={['Parameter', ...m.shares.map((_, i) => `Class ${i + 1}`)]}
            rows={[[c('Intercept'), ...m.growth.intercepts.map((v) => c(v))], [c('Slope'), ...m.growth.slopes.map((v) => c(v))],
              ...m.growth.thresholds.map((t, j) => [c(`Threshold ${j + 1}`), ...m.shares.map(() => c(t))])]}
            note={`Within class, P(outcome ≤ category j) = 1 / (1 + exp(−(threshold j − intercept − slope × time)))${r.times ? `, time scores ${r.times.join(', ')}` : ''}. The last class’s intercept is fixed at 0 and the thresholds are equal over time and classes (Mplus’s parameterisation).`} />}
          {m.probs.length > 0 && <Table title={m.growth ? 'Model-implied probabilities by occasion' : 'Item response probabilities'} file="lca-probs" columns={['Item', 'Category', ...m.shares.map((_, i) => `Class ${i + 1}`)]}
            rows={m.probs.flatMap((p) => p.categories.map((cat, j) => [c(j ? '' : p.item), c(cat), ...p.byClass.map((row) => c(row[j], row[j] > 0.7 ? 'good' : ''))]))}
            note="Probability of each answer within each class (classes numbered by size): what characterises the classes." />}
        </>
      )}
      {r.aux && <AuxTables a={r.aux} />}
    </div>
  );
}


/** A normal prior [mean, SD] on a logit, or none. */
function PriorField({ id, label, value, onChange, placeholder }: { id: string; label: string; value?: [number, number]; onChange: (v?: [number, number]) => void; placeholder: [number, number] }) {
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  return (
    <div className="field">
      <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? placeholder : undefined)} /><span>{label}</span></label>
      {value && (
        <div className="row2">
          <input id={`${id}-m`} className="input num" type="number" step="any" aria-label={`${label}: mean`} defaultValue={value[0]}
            onChange={(e) => { const m = num(e.target.value); if (Number.isFinite(m)) onChange([m, value[1]]); }} />
          <input id={`${id}-s`} className="input num" type="number" step="any" min={0} aria-label={`${label}: SD`} defaultValue={value[1]}
            onChange={(e) => { const s = num(e.target.value); if (Number.isFinite(s) && s > 0) onChange([value[0], s]); }} />
        </div>
      )}
    </div>
  );
}

const ROBUST_MODELS: readonly IrtModel[] = ['twopl', 'gpcm', 'threepl', 'fourpl'];

function IrtOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<IrtOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw item responses first.</div>;
  const mirt = isMirt(o.model);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Items" columns={columns.filter((n) => n !== o.freq)} value={o.items} onChange={(items) => set({ ...o, items, ...(o.guessItems ? { guessItems: o.guessItems.filter((i) => items.includes(i)) } : {}) })} />
      <div className="field">
        <label htmlFor="irt-model">Model</label>
        <select id="irt-model" className="select" value={o.model} onChange={(e) => set({ ...o, model: e.target.value as IrtModel })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="hint">{MODELS.find((m) => m.id === o.model)?.hint} Unidimensional, marginal maximum likelihood.</div>
      </div>
      {o.model === 'mixture' && (
        <div className="field">
          <label htmlFor="irt-classes">Latent classes</label>
          <input id="irt-classes" className="input num" type="number" min={2} max={5} value={o.classes ?? 2}
            onChange={(e) => set({ ...o, classes: Math.max(2, Math.min(5, Math.round(Number(e.target.value)) || 2)) })} />
        </div>
      )}
      {o.model === 'threepl' && (
        <div className="field">
          <label>Items with a guessing parameter</label>
          {o.items.map((it) => (
            <label key={it} className="check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={!o.guessItems || o.guessItems.includes(it)}
                onChange={(e) => { const cur = o.guessItems ?? o.items; const next = e.target.checked ? [...cur, it] : cur.filter((x) => x !== it); set({ ...o, guessItems: next.length === o.items.length ? undefined : o.items.filter((x) => next.includes(x)) }); }} />
              <span>{it}</span>
            </label>
          ))}
          <div className="hint">The others are 2PL items (no lower asymptote).</div>
        </div>
      )}
      {(o.model === 'threepl' || o.model === 'fourpl') && (
        <>
          <PriorField id="irt-pg" label="Normal prior on logit(guessing): mean, SD" value={o.priorG} placeholder={[-1.386, 1]} onChange={(priorG) => set({ ...o, priorG })} />
          {o.model === 'fourpl' && <PriorField id="irt-pu" label="Normal prior on logit(upper asymptote): mean, SD" value={o.priorU} placeholder={[2, 1]} onChange={(priorU) => set({ ...o, priorU })} />}
          <div className="hint">mirt estimates the asymptotes as logits; a prior keeps them away from 0 and 1 (Mplus: MODEL PRIORS on u$2 = −logit(g) and u$3 = −logit(u), so its N(1.386, 1) is N(−1.386, 1) here).</div>
        </>
      )}
      {mirt && <ColumnSelect id="irt-freq" label="Frequencies (optional)" value={o.freq ?? ''} columns={columns} exclude={o.items} optional="None: one row per respondent"
        onChange={(freq) => set({ ...o, freq: freq || undefined })} />}
      <div className="field">
        <label htmlFor="irt-quad">Quadrature points</label>
        <input id="irt-quad" className="input num" type="number" min={5} max={mirt ? 201 : 100} placeholder={mirt ? 'mirt’s default (61)' : 'ltm’s default'} value={o.quadrature ?? ''}
          onChange={(e) => { const v = Math.round(Number(e.target.value)); set({ ...o, quadrature: e.target.value === '' || !Number.isFinite(v) ? undefined : Math.max(5, Math.min(mirt ? 201 : 100, v)) }); }} />
        <div className="hint">{mirt ? 'Points for the latent trait (mirt’s default is 61, enough for long tests).' : 'Gauss-Hermite points for the latent trait (ltm’s default is 15 to 21). Many items need more for an accurate likelihood: with 20 items some 80.'}</div>
      </div>
      {ROBUST_MODELS.includes(o.model) && (
        <label className="check"><input type="checkbox" checked={!!o.robust} onChange={(e) => set({ ...o, robust: e.target.checked || undefined })} />
          <span>Robust standard errors (sandwich; Mplus’s MLR)</span></label>
      )}
      {['twopl', 'threepl', 'fourpl'].includes(o.model) && (
        <label className="check"><input type="checkbox" checked={o.integration === 'mplus'} onChange={(e) => set({ ...o, integration: e.target.checked ? 'mplus' : undefined })} />
          <span>Mplus’s integration rule (15 rectangular points, adaptive; the integration card’s engine): the estimates and log-likelihood Mplus prints, where its rule moves them from the exact maximum</span></label>
      )}
    </fieldset>
  );
}

function LcaOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<LcaOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw item responses first.</div>;
  const n = (v: string) => Math.max(1, Math.min(10, Math.round(Number(v)) || 1));
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label htmlFor="lca-model">Model</label>
        <select id="lca-model" className="select" value={o.model ?? 'lca'} onChange={(e) => set({ ...o, model: e.target.value as LcaKind })}>
          {LCA_KINDS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <div className="hint">{LCA_KINDS.find((m) => m.id === (o.model ?? 'lca'))!.hint}</div>
      </div>
      <OrderedPicker label={o.model === 'lcga' ? 'Occasions (in time order)' : 'Items'} columns={columns} value={o.items} onChange={(items) => set({ ...o, items })} />
      {o.model === 'lpa' && (
        <div className="field">
          <label htmlFor="lca-structure">Within-class variances</label>
          <select id="lca-structure" className="select" value={o.structure ?? 'EEI'} onChange={(e) => set({ ...o, structure: e.target.value as LpaStructure })}>
            {STRUCTURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      )}
      {o.model === 'mlca' && (
        <>
          <ColumnSelect id="lca-cluster" label="Clusters (e.g. school)" value={o.cluster ?? ''} columns={columns} exclude={o.items} onChange={(cluster) => set({ ...o, cluster: cluster || undefined })} />
          <div className="field">
            <label htmlFor="lca-wclasses">Classes of clusters</label>
            <input id="lca-wclasses" className="input num" type="number" min={1} max={10} value={o.clusterClasses ?? 2} onChange={(e) => set({ ...o, clusterClasses: n(e.target.value) })} />
          </div>
        </>
      )}
      {o.model === 'lcga' && (
        <div className="field">
          <label htmlFor="lca-times">Time scores</label>
          <input id="lca-times" className="input" defaultValue={(o.times ?? []).join(', ')} placeholder={o.items.map((_, i) => i).join(', ') || '0, 1, 2, 3'}
            onChange={(e) => { const v = e.target.value.trim() ? e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) : []; if (v.every(Number.isFinite)) set({ ...o, times: v }); }} />
          <div className="hint">One per occasion; empty: 0, 1, 2, …</div>
        </div>
      )}
      <div className="field">
        <label>Numbers of classes to compare</label>
        <div className="row2">
          <input className="input num" type="number" min={1} max={10} aria-label="From" value={o.from} onChange={(e) => set({ ...o, from: n(e.target.value) })} />
          <input className="input num" type="number" min={1} max={10} aria-label="To" value={o.to} onChange={(e) => set({ ...o, to: n(e.target.value) })} />
        </div>
        <div className="hint">Each solution is estimated from 10 random starts (seed from the Model settings), keeping the best, to avoid local maxima.</div>
      </div>
      {o.model !== 'mlca' && <AuxFields o={o} set={set} columns={columns} />}
    </fieldset>
  );
}

/** The three-step analysis of auxiliary variables: distal outcomes and covariates of the classes. */
function AuxFields({ o, set, columns }: { o: LcaOptions; set: (o: LcaOptions) => void; columns: string[] }) {
  const a: LcaAux = o.aux ?? { distal: [], covariates: [], method: 'ml' };
  const put = (p: Partial<LcaAux>) => { const x = { ...a, ...p }; set({ ...o, aux: x.distal.length || x.covariates.length ? x : undefined }); };
  const free = columns.filter((n) => !o.items.includes(n));
  const num = (v: string, hi: number) => { const k = Math.round(Number(v)); return v.trim() === '' || !Number.isFinite(k) ? undefined : Math.max(1, Math.min(hi, k)); };
  return (
    <>
      <h4 style={{ margin: '12px 0 6px' }}>Auxiliary variables (three-step)</h4>
      <div className="hint">Relate the classes to other variables without letting those variables change the classes: the classes are found first, each case assigned to its most likely class, and the assignments’ classification errors corrected (Vermunt, 2010; Bakk & Vermunt, 2016).</div>
      <OrderedPicker label="Distal outcomes (class means, BCH)" columns={free.filter((n) => !a.covariates.includes(n))} value={a.distal} onChange={(distal) => put({ distal })} hint="Optional: numeric outcomes to compare between the classes." />
      <OrderedPicker label="Covariates (predict class membership)" columns={free.filter((n) => !a.distal.includes(n))} value={a.covariates} onChange={(covariates) => put({ covariates })} hint="Optional: numeric predictors of the classes (dummy-code a categorical one)." />
      {(a.distal.length > 0 || a.covariates.length > 0) && <>
        {a.covariates.length > 0 && <Choice label="Covariates’ step 3" value={a.method} options={LCA_AUX_METHODS} onChange={(method) => put({ method })}
          hint={a.method === 'ml' ? 'Maximum likelihood with the classification errors as known (Vermunt, 2010; Mplus’s R3STEP).' : 'A multinomial logit weighted by the BCH weights (Bakk & Vermunt, 2016): robust when the classes are poorly separated.'} />}
        <div className="row2">
          <div className="field">
            <label htmlFor="lca-aux-k">Classes</label>
            <input id="lca-aux-k" className="input num" type="number" min={2} max={10} placeholder="lowest BIC" value={a.classes ?? ''} onChange={(e) => put({ classes: num(e.target.value, 10) })} />
          </div>
          {a.covariates.length > 0 && <div className="field">
            <label htmlFor="lca-aux-ref">Reference class</label>
            <input id="lca-aux-ref" className="input num" type="number" min={1} max={10} placeholder="the last" value={a.reference ?? ''} onChange={(e) => put({ reference: num(e.target.value, 10) })} />
          </div>}
        </div>
        <div className="hint">The model whose classes are related (empty: the solution of two or more classes with the lowest BIC); classes are numbered by size.</div>
      </>}
    </>
  );
}

export const IRT_MODELS = ['rasch', 'twopl', 'grm', 'gpcm', 'threepl', 'fourpl', 'mixture'] as const;
const prior = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) && (v[1] as number) > 0 ? [v[0], v[1]] as [number, number] : undefined);
/** How the card's options fit the model (R's request): the mirt options only for the mirt models, robust standard errors where available. */
export const irtFit = (o: IrtOptions, seed: number): IrtFit => ({
  quadrature: o.quadrature, robust: !!o.robust && ROBUST_MODELS.includes(o.model),
  ...(isMirt(o.model) ? { priorG: o.model === 'mixture' ? undefined : o.priorG, priorU: o.model === 'fourpl' ? o.priorU : undefined, guessItems: o.model === 'threepl' ? o.guessItems : undefined, freq: o.freq } : {}),
  ...(o.model === 'mixture' ? { classes: o.classes ?? 2, nrep: 10, seed } : {}),
});
const LPA_STRUCTURES = ['EEI', 'VVI', 'EEE', 'VVV'] as const;
/** What the R side needs beyond the items and classes (absent for categorical items). */
export const lcaSpec = (o: Pick<LcaOptions, 'model' | 'structure' | 'times' | 'cluster' | 'clusterClasses' | 'aux'>) => {
  const aux = o.model !== 'mlca' && o.aux && (o.aux.distal.length || o.aux.covariates.length) ? { aux: o.aux } : {};
  return o.model === 'lpa' ? { model: 'lpa' as const, structure: o.structure ?? 'EEI', ...aux } : o.model === 'lcga' ? { model: 'lcga' as const, times: o.times?.length ? o.times : undefined, ...aux }
    : o.model === 'mlca' ? { model: 'mlca' as const, cluster: o.cluster, clusterClasses: o.clusterClasses ?? 2 } : aux;
};
/** The auxiliary variables in use (none for multilevel classes). */
const auxCols = (o: LcaOptions) => (o.model !== 'mlca' && o.aux ? [...o.aux.distal, ...o.aux.covariates] : []);
/** A saved card's auxiliary variables (untrusted). */
function parseAux(raw: unknown): LcaAux | undefined {
  if (!isObj(raw)) return undefined;
  const distal = names(raw.distal), covariates = names(raw.covariates).filter((n) => !distal.includes(n));
  if (!distal.length && !covariates.length) return undefined;
  return { distal, covariates, method: oneOf(raw.method, ['ml', 'bch'] as const, 'ml'),
    ...(raw.classes !== undefined ? { classes: clampNum(raw.classes, 1, 10, 2, true) } : {}), ...(raw.reference !== undefined ? { reference: clampNum(raw.reference, 1, 10, 1, true) } : {}) };
}
const classesOf = (o: LcaOptions) => Array.from({ length: Math.max(0, o.to - o.from + 1) }, (_, i) => o.from + i);

export const irtAnalysis: AnalysisType<IrtOptions, IrtResult> = {
  id: 'irt',
  title: 'Item response theory',
  sub: 'Rasch, 2PL, graded response, partial credit (ltm); 3PL, 4PL, mixture IRT (mirt)',
  group: 'Measurement',
  defaults: () => ({ items: [], model: 'grm' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: IrtOptions = { items: names(raw.items), model: oneOf(raw.model, IRT_MODELS, 'grm'),
      ...(typeof raw.quadrature === 'number' && Number.isInteger(raw.quadrature) && raw.quadrature >= 5 && raw.quadrature <= 201 ? { quadrature: raw.quadrature } : {}),
      ...(raw.robust === true ? { robust: true } : {}) };
    // (the mirt models' options; absent in older saved cards)
    const pg = prior(raw.priorG), pu = prior(raw.priorU);
    if (pg) o.priorG = pg;
    if (pu) o.priorU = pu;
    if (Array.isArray(raw.guessItems)) o.guessItems = names(raw.guessItems);
    if (raw.freq !== undefined && name(raw.freq)) o.freq = name(raw.freq);
    if (raw.classes !== undefined) o.classes = clampNum(raw.classes, 2, 5, 2, true);
    if (raw.integration === 'mplus') o.integration = 'mplus';
    return o;
  },
  Options: IrtOptionsForm,
  View: ({ result }) => <IrtView r={result} />,
  blocked: (o, ctx) => {
    if (o.items.length < 2) return 'Choose at least two items.';
    if (!isMirt(o.model) && (o.quadrature ?? 0) > 100) return 'Choose between 5 and 100 quadrature points for this model.';
    if (o.freq && isMirt(o.model) && o.items.includes(o.freq)) return 'The frequency column cannot be one of the items.';
    if (o.model === 'threepl' && o.guessItems && !o.guessItems.some((i) => o.items.includes(i))) return 'Choose at least one item with a guessing parameter (or use the 2PL).';
    if (o.integration === 'mplus') { const b = irtMplusBlocked(o.items, o.model, irtFit(o, 0)); if (b) return b; }
    return missingColumns(ctx, isMirt(o.model) && o.freq ? [...o.items, o.freq] : o.items, 'Item response theory');
  },
  // (the mixture's random starts depend on the seed)
  fingerprint: (o, ctx) => (isMirt(o.model) ? columnsFingerprint(ctx, o.freq ? [...o.items, o.freq] : o.items, o.model === 'mixture' ? [ctx.settings.seed] : o.integration ? [o.integration] : []) : columnsFingerprint(ctx, o.items, o.integration ? [o.integration] : [])),
  run: async (o, ctx) => (o.integration === 'mplus' ? (await import('../rengine/irtMplus')).irtMplusR(rawData(ctx)!, o.items, o.model, irtFit(o, ctx.settings.seed)) : (await import('../rengine/items')).irtR(rawData(ctx)!, o.items, o.model, irtFit(o, ctx.settings.seed))),
  script: async (o, ctx) => (o.integration === 'mplus' ? (await import('../rengine/irtMplus')).irtMplusScriptR(rawData(ctx)!, o.items, o.model, irtFit(o, ctx.settings.seed)) : (await import('../rengine/items')).irtScriptR(rawData(ctx)!, o.items, o.model, irtFit(o, ctx.settings.seed))),
  summary: (o) => `${o.items.length} items · ${MODELS.find((m) => m.id === o.model)!.label}${o.model === 'mixture' ? ` · ${o.classes ?? 2} classes` : ''}${o.priorG || o.priorU ? ' · priors' : ''}`,
};

export const lcaAnalysis: AnalysisType<LcaOptions, LcaResult> = {
  id: 'lca',
  title: 'Latent class analysis',
  sub: 'classes of respondents from categorical items (poLCA; multilevel: glca)',
  group: 'Measurement',
  defaults: () => ({ items: [], from: 1, to: 4 }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const o: LcaOptions = { items: names(raw.items), from: clampNum(raw.from, 1, 10, 1, true), to: clampNum(raw.to, 1, 10, 4, true) };
    if (raw.model === 'lpa' || raw.model === 'lcga' || raw.model === 'mlca') o.model = raw.model;
    if (raw.cluster !== undefined && name(raw.cluster)) o.cluster = name(raw.cluster);
    if (raw.clusterClasses !== undefined) o.clusterClasses = clampNum(raw.clusterClasses, 1, 10, 2, true);
    if (raw.structure !== undefined) o.structure = oneOf(raw.structure, LPA_STRUCTURES, 'EEI');
    if (Array.isArray(raw.times)) o.times = raw.times.slice(0, 500).map(Number).filter(Number.isFinite);
    const aux = parseAux(raw.aux);
    if (aux) o.aux = aux;
    return o;
  },
  Options: LcaOptionsForm,
  View: ({ result }) => <LcaView key={result.models.map((m) => m.k).join()} r={result} />,
  blocked: (o, ctx) => {
    if (o.items.length < 2) return 'Choose at least two items.';
    if (o.from > o.to) return 'The smallest number of classes must not exceed the largest.';
    if (o.model === 'lcga' && o.items.length < 3) return 'Choose at least three occasions.';
    if (o.model === 'lcga' && o.times?.length && o.times.length !== o.items.length) return 'Give one time score per occasion.';
    if (o.model === 'mlca' && !o.cluster) return 'Choose the cluster column.';
    if (o.model === 'mlca' && o.items.includes(o.cluster!)) return 'The cluster column cannot be one of the items.';
    const aux = auxCols(o);
    if (aux.some((n) => o.items.includes(n))) return 'An auxiliary variable cannot be one of the items.';
    if (o.aux && aux.length && o.aux.classes !== undefined && (o.aux.classes < Math.max(2, o.from) || o.aux.classes > o.to)) return `The three-step analysis needs one of the fitted numbers of classes (${Math.max(2, o.from)}–${o.to}).`;
    if (o.aux && aux.length && o.aux.classes === undefined && o.to < 2) return 'The three-step analysis needs solutions with two or more classes.';
    return missingColumns(ctx, o.model === 'mlca' ? [...o.items, o.cluster!] : [...o.items, ...aux], 'Latent class analysis');
  },
  fingerprint: (o, ctx) => (o.model === 'mlca' ? columnsFingerprint(ctx, [...o.items, o.cluster ?? ''], [ctx.settings.seed, 'mlca', o.cluster ?? '', o.clusterClasses ?? 2])
    : columnsFingerprint(ctx, [...o.items, ...auxCols(o)], [ctx.settings.seed, o.model ?? 'lca', o.structure ?? '', (o.times ?? []).join(),
      ...(auxCols(o).length ? [`aux:${o.aux!.distal.join(',')}|${o.aux!.covariates.join(',')}|${o.aux!.method}|${o.aux!.classes ?? ''}|${o.aux!.reference ?? ''}`] : [])])),
  run: async (o, ctx) => (await import('../rengine/items')).lcaR(rawData(ctx)!, o.items, classesOf(o), 10, ctx.settings.seed, lcaSpec(o)),
  script: async (o, ctx) => (await import('../rengine/items')).lcaScriptR(rawData(ctx)!, o.items, classesOf(o), 10, ctx.settings.seed, lcaSpec(o)),
  summary: (o) => `${o.items.length} ${o.model === 'lcga' ? 'occasions' : 'items'}${o.model === 'lpa' ? ` · profiles (${o.structure ?? 'EEI'})` : o.model === 'lcga' ? ' · growth' : o.model === 'mlca' ? ` · in ${o.clusterClasses ?? 2} classes of ${o.cluster || '…'}` : ''} · ${o.from === o.to ? o.from : `${o.from}–${o.to}`} classes${auxCols(o).length ? ' · three-step' : ''}`,
};
