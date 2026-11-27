// The Troubleshoot tab of CB-SEM results: the usual reasons an estimation fails to converge or ends in an
// improper solution, checked on this model and these data before (or after) estimating. Nothing is
// refitted and nothing changes the model: each check says what it found, which variables, and what to
// try. It works without R and without a fit, so it helps most when the estimation fails outright.
//
// Sources: Chen, Bollen, Paxton, Curran & Kirby (2001) and Kline (2016, ch. 7 and 9) for the causes of
// nonconvergence and improper solutions; Wothke (1993) for sample matrices that are not positive
// definite; Bentler & Chou (1987) for cases per parameter; Enders (2010) for covariance coverage under
// missing data; Flora & Curran (2004) for sparse categories of ordinal indicators.

import { checkAdmissibility } from '../engine/admissibility';
import type { CbResult } from '../engine/cbsem';
import { symEigen } from '../engine/linalg';
import type { Dataset } from '../engine/types';
import { parameterCount } from './identification';
import { renameCovariate, renameIndicator, type ModelState, type Settings } from './project';
import { validateModel } from './validate';

/** How a check came out: a likely cause, something to look at, a note, nothing found, or not applicable. */
export type CheckStatus = 'problem' | 'check' | 'note' | 'clear' | 'skipped';

export interface TroubleCheck {
  id: string;
  /** What is checked, as a heading. */
  title: string;
  status: CheckStatus;
  /** What was found, with the numbers. */
  finding: string;
  /** The variables (or constructs) involved. */
  variables?: string[];
  /** What to try. */
  advice?: string;
  /** Works the rule comes from (author, year). */
  sources: string[];
  /** Changes the user can choose to try (nothing is applied or refitted until they do and calculate again). */
  remedies?: RemedyOption[];
}

/** A change to the model, the settings or the data that may help the estimation converge. */
export type Remedy =
  | { kind: 'rescale'; variable: string; divisor: number; name: string }
  | { kind: 'drop-indicator'; constructId: string; indicator: string }
  | { kind: 'start-simple' }
  | { kind: 'optimizer' }
  | { kind: 'variance-scaling'; constructId: string }
  | { kind: 'positive-variances' }
  | { kind: 'fiml' };

export interface RemedyOption {
  remedy: Remedy;
  /** The button's text. */
  label: string;
  /** What it changes, in one sentence. */
  detail: string;
}

type TroubleSettings = Settings;

/** Variances further apart than this slow lavaan down; from this ratio lavaan itself warns. */
export const VARIANCE_RATIO = { check: 10, problem: 1000 };
/** The smallest eigenvalue of the indicators' correlation matrix below which it counts as singular. */
const SINGULAR = 1e-8;
/** Correlations at or above this count as near-duplicate indicators, from the second as duplicates. */
export const COLLINEAR = { check: 0.95, problem: 0.999 };
/** Cases per free parameter (Bentler & Chou 1987: 5 at least, 10 better). */
export const CASES_PER_PARAMETER = { problem: 5, check: 10 };
/** The share of cases observed on both variables of a pair below which FIML has little to go on (lavaan warns below .1). */
export const MIN_COVERAGE = 0.1;
/** An indicator whose strongest correlation with the other indicators of its factor is below this barely measures it. */
export const WEAK_ITEM = 0.2;

/** The model's indicators that are columns of the data, in model order. */
export function modelIndicators(model: ModelState, data: Dataset): string[] {
  const out: string[] = [];
  for (const c of model.constructs)
    for (const i of c.indicators) if (data.names.includes(i) && !out.includes(i)) out.push(i);
  return out;
}

/** Mean and variance (n − 1) of the finite values of x, and how many there are. */
function moments(x: ArrayLike<number>): { n: number; mean: number; variance: number } {
  let n = 0,
    s = 0;
  for (let k = 0; k < x.length; k++)
    if (Number.isFinite(x[k])) {
      n++;
      s += x[k];
    }
  const mean = n ? s / n : NaN;
  let ss = 0;
  for (let k = 0; k < x.length; k++) if (Number.isFinite(x[k])) ss += (x[k] - mean) ** 2;
  return { n, mean, variance: n > 1 ? ss / (n - 1) : NaN };
}

/** The correlation of x and y over the cases observed on both, and how many cases that is. */
function pairwise(x: ArrayLike<number>, y: ArrayLike<number>): { n: number; r: number } {
  let n = 0,
    sx = 0,
    sy = 0;
  for (let k = 0; k < x.length; k++)
    if (Number.isFinite(x[k]) && Number.isFinite(y[k])) {
      n++;
      sx += x[k];
      sy += y[k];
    }
  if (n < 3) return { n, r: NaN };
  const mx = sx / n,
    my = sy / n;
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let k = 0; k < x.length; k++)
    if (Number.isFinite(x[k]) && Number.isFinite(y[k])) {
      sxy += (x[k] - mx) * (y[k] - my);
      sxx += (x[k] - mx) ** 2;
      syy += (y[k] - my) ** 2;
    }
  return { n, r: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN };
}

/** What the checks work from: the indicators' variances and correlations, and the cases behind them. */
interface Summary {
  names: string[];
  variances: number[];
  /** Correlations (pairwise complete cases for raw data). */
  R: number[][];
  /** Cases observed on both variables of each pair; null for a covariance-matrix dataset. */
  pairN: number[][] | null;
  /** Rows of the data (the matrix's N for a covariance-matrix dataset). */
  rows: number;
  /** Rows observed on every indicator. */
  complete: number;
  raw: boolean;
}

function summarise(names: string[], data: Dataset): Summary | null {
  const p = names.length;
  if (data.cols.length) {
    const cols = names.map((v) => data.cols[data.names.indexOf(v)]);
    const rows = cols[0]?.length ?? 0;
    let complete = 0;
    for (let k = 0; k < rows; k++) if (cols.every((c) => Number.isFinite(c[k]))) complete++;
    const R = names.map(() => new Array<number>(p).fill(1));
    const pairN = names.map(() => new Array<number>(p).fill(0));
    for (let i = 0; i < p; i++) {
      pairN[i][i] = moments(cols[i]).n;
      for (let j = 0; j < i; j++) {
        const { n, r } = pairwise(cols[i], cols[j]);
        R[i][j] = R[j][i] = r;
        pairN[i][j] = pairN[j][i] = n;
      }
    }
    return {
      names,
      variances: cols.map((c) => moments(c).variance),
      R,
      pairN,
      rows,
      complete,
      raw: true,
    };
  }
  const m = data.moments;
  if (!m) return null;
  const idx = names.map((v) => data.names.indexOf(v));
  const variances = idx.map((i) => m.S[i][i]);
  const R = idx.map((i, a) =>
    idx.map((j, b) => m.S[i][j] / Math.sqrt(variances[a] * variances[b])),
  );
  return { names, variances, R, pairN: null, rows: m.n, complete: m.n, raw: false };
}

const fmt = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : '—');
const list = (xs: string[], max = 6) =>
  xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', ');

function specificationCheck(
  model: ModelState,
  data: Dataset | null,
  settings: TroubleSettings,
): TroubleCheck {
  const issues = validateModel(model, data, settings);
  const sources = ['Bollen (1989)', 'Rindskopf & Rose (1988)'];
  if (!issues.length)
    return {
      id: 'identification',
      title: 'Specification and identification',
      status: 'clear',
      finding:
        'The model checks find nothing: scales of the factors, degrees of freedom, factors with two indicators, second-order factors, clusters.',
      sources,
    };
  const error = issues.some((i) => i.level === 'error');
  return {
    id: 'identification',
    title: 'Specification and identification',
    status: error ? 'problem' : 'check',
    finding: issues.map((i) => i.message).join(' '),
    variables: issues
      .map((i) => model.constructs.find((c) => c.id === i.constructId)?.name)
      .filter((n): n is string => !!n),
    sources,
  };
}

function fixedValuesCheck(model: ModelState): TroubleCheck {
  const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  const fixed: string[] = [];
  for (const c of model.constructs) {
    for (const [i, v] of Object.entries(c.fixedLoadings ?? {}))
      fixed.push(`${c.name} → ${i} = ${v}`);
    for (const [k, v] of Object.entries(c.componentLoadings ?? {}))
      fixed.push(`${c.name} → ${name(k)} = ${v}`);
  }
  for (const p of model.paths)
    if (p.fixed !== undefined) fixed.push(`${name(p.from)} → ${name(p.to)} = ${p.fixed}`);
  return {
    id: 'fixed-values',
    title: 'Values you fixed',
    status: fixed.length ? 'note' : 'clear',
    finding: fixed.length
      ? `${fixed.length} loading${fixed.length > 1 ? 's or paths are' : ' or path is'} held at a value: ${list(fixed)}. A value far from what the data suggest can keep the estimation from converging.`
      : 'No loading or path is held at a value other than a marker’s 1.',
    advice: fixed.length
      ? 'Free the fixed values one at a time, or check that each is on the scale of its variables.'
      : undefined,
    sources: ['Kline (2016)'],
  };
}

function scaleCheck(s: Summary): TroubleCheck {
  const sources = ['Kline (2016)'];
  const ok = s.names
    .map((v, i) => ({ v, x: s.variances[i] }))
    .filter((e) => Number.isFinite(e.x) && e.x > 0);
  if (ok.length < 2)
    return {
      id: 'scale',
      title: 'Variables on very different scales',
      status: 'skipped',
      finding: 'Fewer than two indicators with a variance.',
      sources,
    };
  const lo = ok.reduce((a, b) => (b.x < a.x ? b : a));
  const hi = ok.reduce((a, b) => (b.x > a.x ? b : a));
  const ratio = hi.x / lo.x;
  const status =
    ratio >= VARIANCE_RATIO.problem ? 'problem' : ratio > VARIANCE_RATIO.check ? 'check' : 'clear';
  return {
    id: 'scale',
    title: 'Variables on very different scales',
    status,
    finding: `The largest variance (${hi.v}, ${fmt(hi.x, 3)}) is ${fmt(ratio, 1)} times the smallest (${lo.v}, ${fmt(lo.x, 3)}).`,
    variables: status === 'clear' ? undefined : [hi.v, lo.v],
    advice:
      status === 'clear'
        ? undefined
        : 'Rescale the variables with the largest variances (divide by 10, 100, …: a linear transformation changes no standardised estimate and no fit index) on the Data tab.',
    sources,
  };
}

function constantCheck(s: Summary, data: Dataset): TroubleCheck {
  const sources = ['Kline (2016)'];
  if (!s.raw)
    return {
      id: 'constant',
      title: 'Indicators with (almost) no variance',
      status: 'skipped',
      finding:
        'A covariance-matrix dataset: the variances are checked under “Variables on very different scales”.',
      sources,
    };
  const constant: string[] = [];
  const nearly: string[] = [];
  s.names.forEach((v, i) => {
    if (!(s.variances[i] > 0)) {
      constant.push(v);
      return;
    }
    const col = data.cols[data.names.indexOf(v)];
    const counts = new Map<number, number>();
    let n = 0;
    for (const x of col)
      if (Number.isFinite(x)) {
        n++;
        counts.set(x, (counts.get(x) ?? 0) + 1);
      }
    if (Math.max(...counts.values()) >= 0.95 * n) nearly.push(v);
  });
  const status = constant.length ? 'problem' : nearly.length ? 'check' : 'clear';
  const parts = [
    constant.length ? `No variance: ${list(constant)}.` : '',
    nearly.length ? `One value in 95% or more of the cases: ${list(nearly)}.` : '',
  ].filter(Boolean);
  return {
    id: 'constant',
    title: 'Indicators with (almost) no variance',
    status,
    finding: parts.join(' ') || 'Every indicator varies.',
    variables: status === 'clear' ? undefined : [...constant, ...nearly],
    advice:
      status === 'clear'
        ? undefined
        : 'Drop the indicator, or check whether a filter or missing-value code left it constant.',
    sources,
  };
}

function collinearityCheck(s: Summary): TroubleCheck {
  const sources = ['Wothke (1993)', 'Kline (2016)'];
  const keep = s.names.map((_, i) => i).filter((i) => s.variances[i] > 0);
  const pairs: { a: string; b: string; r: number }[] = [];
  for (const i of keep)
    for (const j of keep)
      if (j < i && Math.abs(s.R[i][j]) >= COLLINEAR.check)
        pairs.push({ a: s.names[j], b: s.names[i], r: s.R[i][j] });
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  // (the smallest eigenvalue of the correlations, and the indicators that carry it)
  const R = keep.map((i) => keep.map((j) => s.R[i][j]));
  const finite = R.every((row) => row.every(Number.isFinite));
  let singular: string[] | null = null;
  let minEigen = NaN;
  if (finite && R.length > 1) {
    const { values, vectors } = symEigen(R);
    const k = values.indexOf(Math.min(...values));
    minEigen = values[k];
    if (minEigen < SINGULAR) {
      const loads = keep.map((i, a) => ({ v: s.names[i], w: Math.abs(vectors[a][k]) }));
      const top = Math.max(...loads.map((l) => l.w));
      singular = loads.filter((l) => l.w >= top / 3).map((l) => l.v);
    }
  }
  const tooFew = s.complete <= keep.length;
  const duplicate = pairs.some((p) => Math.abs(p.r) >= COLLINEAR.problem);
  const status = singular || duplicate ? 'problem' : pairs.length ? 'check' : 'clear';
  const parts: string[] = [];
  if (singular)
    parts.push(
      `The indicators’ correlation matrix is not positive definite (smallest eigenvalue ${minEigen.toExponential(1)}): ${list(singular)} are linearly dependent${tooFew ? `, and there are fewer complete cases (${s.complete}) than indicators (${keep.length})` : ''}.`,
    );
  if (pairs.length)
    parts.push(
      `Correlations of ${COLLINEAR.check} or more: ${list(pairs.map((p) => `${p.a}–${p.b} (${fmt(p.r, 3)})`))}.`,
    );
  if (!finite)
    parts.push('Some pairs of indicators have too few cases in common for a correlation.');
  return {
    id: 'collinearity',
    title: 'Collinear or duplicated indicators',
    status: !finite && status === 'clear' ? 'check' : status,
    finding:
      parts.join(' ') ||
      `No two indicators correlate ${COLLINEAR.check} or more; the correlation matrix is positive definite (smallest eigenvalue ${fmt(minEigen, 3)}).`,
    variables:
      singular ?? (pairs.length ? [...new Set(pairs.flatMap((p) => [p.a, p.b]))] : undefined),
    advice:
      status === 'clear'
        ? undefined
        : 'Look for an indicator entered twice, a sum or mean score next to its own items, or items that are rewordings of each other; keep one of each set. With pairwise deletion the matrix can be non-positive-definite from the missing data alone: use FIML instead.',
    sources,
  };
}

function sampleSizeCheck(model: ModelState, s: Summary, settings: TroubleSettings): TroubleCheck {
  const sources = ['Bentler & Chou (1987)', 'Kline (2016)'];
  const n = settings.missing === 'casewise' ? s.complete : s.rows;
  const count = parameterCount(model);
  const base = settings.missing === 'casewise' ? `${n} complete cases` : `${n} cases`;
  if (!count)
    return {
      id: 'sample-size',
      title: 'Cases per parameter',
      status: n <= s.names.length ? 'problem' : 'skipped',
      finding:
        n <= s.names.length
          ? `${base} for ${s.names.length} indicators: the sample covariance matrix is singular.`
          : `${base}; the free parameters of this kind of model are not counted here.`,
      sources,
    };
  const ratio = n / count.free;
  const status =
    n <= s.names.length || ratio < CASES_PER_PARAMETER.problem
      ? 'problem'
      : ratio < CASES_PER_PARAMETER.check
        ? 'check'
        : 'clear';
  return {
    id: 'sample-size',
    title: 'Cases per parameter',
    status,
    finding: `${base} for ${count.free} free parameters: ${fmt(ratio, 1)} per parameter.`,
    advice:
      status === 'clear'
        ? undefined
        : 'Small samples make nonconvergence and improper solutions much more likely, above all with few indicators per factor. Simplify the model (fewer factors, parcels, fixed or equal parameters), or collect more data.',
    sources,
  };
}

function coverageCheck(s: Summary, settings: TroubleSettings): TroubleCheck {
  const sources = ['Enders (2010)'];
  const title = 'Missing data';
  if (!s.pairN)
    return {
      id: 'coverage',
      title,
      status: 'skipped',
      finding: 'A covariance-matrix dataset.',
      sources,
    };
  const missingRows = s.rows - s.complete;
  if (!missingRows)
    return {
      id: 'coverage',
      title,
      status: 'clear',
      finding: 'No indicator has missing values.',
      sources,
    };
  if (settings.missing === 'casewise') {
    const share = s.complete / s.rows;
    return {
      id: 'coverage',
      title,
      status: share < 0.5 ? 'check' : 'clear',
      finding: `Listwise deletion keeps ${s.complete} of ${s.rows} cases (${fmt(100 * share, 0)}%).`,
      advice: share < 0.5 ? 'FIML keeps every case and their partial data.' : undefined,
      sources,
    };
  }
  let worst = { a: '', b: '', share: 1 };
  for (let i = 0; i < s.names.length; i++)
    for (let j = 0; j < i; j++) {
      const share = s.pairN[i][j] / s.rows;
      if (share < worst.share) worst = { a: s.names[j], b: s.names[i], share };
    }
  const status = worst.share < MIN_COVERAGE ? 'problem' : 'clear';
  return {
    id: 'coverage',
    title,
    status,
    finding: `${s.complete} of ${s.rows} cases are complete; the pair observed together least often is ${worst.a}–${worst.b}, in ${fmt(100 * worst.share, 0)}% of cases.`,
    variables: status === 'problem' ? [worst.a, worst.b] : undefined,
    advice:
      status === 'problem'
        ? 'Their covariance is estimated from very few cases (planned missingness, or items asked of different subgroups). Drop one of them, or constrain the model where they meet.'
        : undefined,
    sources,
  };
}

function ordinalCheck(model: ModelState, data: Dataset, s: Summary): TroubleCheck {
  const sources = ['Flora & Curran (2004)'];
  const title = 'Sparse categories of ordinal indicators';
  const ordered = (model.ordered ?? []).filter((v) => s.names.includes(v));
  if (!ordered.length || !s.raw)
    return {
      id: 'ordinal',
      title,
      status: 'skipped',
      finding: s.raw ? 'No indicator is declared ordinal.' : 'A covariance-matrix dataset.',
      sources,
    };
  const col = (v: string) => data.cols[data.names.indexOf(v)];
  const rare: string[] = [];
  for (const v of ordered) {
    const counts = new Map<number, number>();
    for (const x of col(v)) if (Number.isFinite(x)) counts.set(x, (counts.get(x) ?? 0) + 1);
    if ([...counts.values()].some((c) => c < 5)) rare.push(v);
  }
  // (pairs whose two-way table has an empty cell: the polychoric correlation is then poorly determined)
  const empty: string[] = [];
  for (let i = 0; i < ordered.length; i++)
    for (let j = 0; j < i; j++) {
      const a = col(ordered[i]),
        b = col(ordered[j]);
      const seen = new Set<string>(),
        av = new Set<number>(),
        bv = new Set<number>();
      for (let k = 0; k < a.length; k++)
        if (Number.isFinite(a[k]) && Number.isFinite(b[k])) {
          seen.add(`${a[k]}|${b[k]}`);
          av.add(a[k]);
          bv.add(b[k]);
        }
      if (seen.size < av.size * bv.size) empty.push(`${ordered[j]}–${ordered[i]}`);
    }
  const status = rare.length || empty.length ? 'check' : 'clear';
  const parts = [
    rare.length ? `Categories with fewer than 5 cases: ${list(rare)}.` : '',
    empty.length
      ? `${empty.length} pair${empty.length > 1 ? 's have' : ' has'} an empty cell in their two-way table: ${list(empty)}.`
      : '',
  ].filter(Boolean);
  return {
    id: 'ordinal',
    title,
    status,
    finding:
      parts.join(' ') || 'Every category has 5 cases or more; no two-way table has an empty cell.',
    variables: rare.length ? rare : undefined,
    advice:
      status === 'clear'
        ? undefined
        : 'Collapse rare categories into their neighbours (Data tab, recode), or treat indicators with 5 or more categories as continuous (MLR).',
    sources,
  };
}

function weakItemsCheck(model: ModelState, s: Summary): TroubleCheck {
  const sources = ['Chen et al. (2001)', 'Kline (2016)'];
  const weak: string[] = [];
  const empty: string[] = [];
  for (const c of model.constructs) {
    if (c.type !== 'factor' || c.covariate) continue;
    const idx = c.indicators.map((v) => s.names.indexOf(v)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    const best = idx.map((i) =>
      Math.max(...idx.filter((j) => j !== i).map((j) => Math.abs(s.R[i][j]) || 0)),
    );
    if (best.every((b) => b < WEAK_ITEM / 2)) empty.push(c.name);
    else best.forEach((b, k) => b < WEAK_ITEM && weak.push(`${s.names[idx[k]]} (${c.name})`));
  }
  const status = empty.length ? 'problem' : weak.length ? 'check' : 'clear';
  const parts = [
    empty.length
      ? `No two indicators of ${list(empty)} correlate ${WEAK_ITEM / 2} or more: the factor is barely there.`
      : '',
    weak.length
      ? `Indicators correlating below ${WEAK_ITEM} with every other indicator of their factor: ${list(weak)}.`
      : '',
  ].filter(Boolean);
  return {
    id: 'weak-items',
    title: 'Weak indicators',
    status,
    finding:
      parts.join(' ') ||
      `Every indicator correlates ${WEAK_ITEM} or more with another of its factor.`,
    variables: status === 'clear' ? undefined : [...empty, ...weak],
    advice:
      status === 'clear'
        ? undefined
        : 'Check the item’s coding (a reverse-worded item not reversed correlates negatively but strongly; one near zero may belong to another factor). An indicator that measures nothing gives its factor no scale to estimate.',
    sources,
  };
}

function groupsCheck(model: ModelState, data: Dataset, s: Summary): TroubleCheck | null {
  const column = model.multigroup?.column;
  if (!column) return null;
  const sources = ['Kline (2016)'];
  const title = 'Group sizes';
  const g = data.cols[data.names.indexOf(column)];
  if (!g)
    return {
      id: 'groups',
      title,
      status: 'skipped',
      finding: `No column ${column} in the data.`,
      sources,
    };
  const counts = new Map<number, number>();
  for (const x of g) if (Number.isFinite(x)) counts.set(x, (counts.get(x) ?? 0) + 1);
  const label = (code: number) => data.categories?.[column]?.[code - 1] ?? String(code);
  const sizes = [...counts.entries()].map(([code, n]) => ({ group: label(code), n }));
  const p = s.names.length;
  const tiny = sizes.filter((x) => x.n <= p);
  const small = sizes.filter((x) => x.n > p && x.n < 5 * p);
  const status = tiny.length ? 'problem' : small.length ? 'check' : 'clear';
  return {
    id: 'groups',
    title,
    status,
    finding: `${sizes.length} groups: ${list(sizes.map((x) => `${x.group} (${x.n})`))}; ${p} indicators.`,
    variables: status === 'clear' ? undefined : [...tiny, ...small].map((x) => x.group),
    advice:
      status === 'clear'
        ? undefined
        : 'A group with no more cases than indicators has a singular covariance matrix and cannot be fitted on its own; a small group often gives an improper solution. Merge small groups or leave them out (Data tab, filter).',
    sources,
  };
}

/** The checks, specification first; an empty list for a model this tab does not apply to. */
export function troubleshoot(
  model: ModelState,
  data: Dataset | null,
  settings: TroubleSettings,
  cb: CbResult | null = null,
): TroubleCheck[] {
  if (settings.method !== 'cbsem' || settings.estimator === '2SLS') return [];
  const fit = cb ? [fitCheck(model, settings, cb)] : [];
  const spec = [...fit, specificationCheck(model, data, settings), fixedValuesCheck(model)];
  if (!data) return spec;
  const names = modelIndicators(model, data);
  const s = names.length ? summarise(names, data) : null;
  if (!s) return spec;
  return withRemedies(model, data, settings, s, [
    ...spec,
    scaleCheck(s),
    constantCheck(s, data),
    collinearityCheck(s),
    sampleSizeCheck(model, s, settings),
    coverageCheck(s, settings),
    ordinalCheck(model, data, s),
    weakItemsCheck(model, s),
    ...[groupsCheck(model, data, s)].filter((c): c is TroubleCheck => !!c),
  ]);
}

/**
 * The last estimation, when there is a result for this model: did it converge, and is the solution admissible? Its
 * remedies are lavaan's options; with the built-in engine the advice is to calculate with lavaan (R).
 */
function fitCheck(model: ModelState, settings: TroubleSettings, cb: CbResult): TroubleCheck {
  const lavaan = settings.engine !== 'builtin';
  const sources = ['Chen et al. (2001)', 'Kline (2016)'];
  if (!cb.converged) {
    const remedies: RemedyOption[] = [];
    if (lavaan && !model.startValues)
      remedies.push({
        remedy: { kind: 'start-simple' },
        label: 'Simpler starting values',
        detail:
          'lavaan starts from loadings of 1 and small variances (start = "simple") instead of its default estimates.',
      });
    if (lavaan && !model.optimizer)
      remedies.push({
        remedy: { kind: 'optimizer' },
        label: 'Use the BFGS optimiser',
        detail: 'lavaan minimises with BFGS (optim.method = "BFGS") instead of nlminb.',
      });
    return {
      id: 'convergence',
      title: 'Convergence',
      status: 'problem',
      finding: `The last estimation stopped after ${cb.iterations} iterations without converging: its numbers are not estimates.`,
      advice: lavaan
        ? 'Fix any likely cause below first. Changing the starting values or the optimiser helps when the model is right but the default start is far from the solution; the estimates should not depend on it.'
        : 'The built-in engine has no other starting values or optimiser: calculate with lavaan (Engine: R), which does.',
      sources,
      ...(remedies.length ? { remedies } : {}),
    };
  }
  const negative = checkAdmissibility(cb).findings.filter(
    (f) => f.kind === 'negative-variance' && f.severity !== 'numerical',
  );
  if (negative.length) {
    const params = [...new Set(negative.flatMap((f) => f.params))];
    return {
      id: 'convergence',
      title: 'Convergence',
      status: 'check',
      finding: `The estimation converged, but with a negative variance (${list(params)}): see Admissibility on the Model fit tab.`,
      variables: params,
      advice:
        'A negative variance that could be sampling error can be kept at zero or above; one clearly below zero points to a misspecified model, which a bound only hides.',
      sources: [...sources, 'Kolenikov & Bollen (2012)'],
      ...(lavaan && !model.positiveVariances
        ? {
            remedies: [
              {
                remedy: { kind: 'positive-variances' as const },
                label: 'Keep variances ≥ 0',
                detail: 'lavaan bounds every variance at zero or above (bounds = "pos.var").',
              },
            ],
          }
        : {}),
    };
  }
  return {
    id: 'convergence',
    title: 'Convergence',
    status: 'clear',
    finding: `The last estimation converged in ${cb.iterations} iterations, with no negative variance.`,
    sources,
  };
}

/** The construct an indicator belongs to (its first, for a shared indicator). */
const constructOf = (model: ModelState, indicator: string) =>
  model.constructs.find((c) => c.indicators.includes(indicator));

/** A power of ten (10 or more) that brings variance `v` near `target`, or null when none is needed. */
export function rescaleDivisor(v: number, target: number): number | null {
  const k = Math.round(Math.log10(Math.sqrt(v / target)));
  return k >= 1 ? 10 ** k : null;
}

/** The remedies of the data checks, attached to the checks that found something. */
function withRemedies(
  model: ModelState,
  data: Dataset,
  settings: TroubleSettings,
  s: Summary,
  checks: TroubleCheck[],
): TroubleCheck[] {
  const fiml: RemedyOption = {
    remedy: { kind: 'fiml' },
    label: 'Use FIML',
    detail:
      'Missing values: full-information maximum likelihood, which uses every case’s observed values.',
  };
  const add = (c: TroubleCheck, r: RemedyOption[]) =>
    r.length ? { ...c, remedies: [...(c.remedies ?? []), ...r] } : c;
  return checks.map((c) => {
    if (c.status !== 'problem' && c.status !== 'check') return c;
    switch (c.id) {
      case 'scale': {
        if (!s.raw && !data.moments) return c;
        // (each variance well above the median brought near it by a power of ten, as a new computed column)
        const ok = s.variances.filter((x) => x > 0).sort((a, b) => a - b);
        const median = ok[Math.floor(ok.length / 2)];
        const out: RemedyOption[] = [];
        s.names.forEach((v, i) => {
          const divisor = rescaleDivisor(s.variances[i], median);
          if (!divisor || !constructOf(model, v)) return;
          const name = `${v}_div${divisor}`;
          if (data.names.includes(name)) return;
          out.push({
            remedy: { kind: 'rescale', variable: v, divisor, name },
            label: `Rescale ${v} ÷${divisor}`,
            detail: s.raw
              ? `Adds the computed column ${name} = ${v} / ${divisor} (Data tab) and measures ${constructOf(model, v)!.name} by it instead of ${v}.`
              : `Adds ${name} = ${v} / ${divisor} to the covariance matrix${data.moments?.nacov ? ' and its NACOV' : ''} and measures ${constructOf(model, v)!.name} by it instead of ${v}.`,
          });
        });
        return add(c, out);
      }
      case 'collinearity': {
        const out: RemedyOption[] = [];
        // (of each duplicated pair, the second indicator)
        const keep = s.names.map((_, i) => i).filter((i) => s.variances[i] > 0);
        const dropped = new Set<string>();
        for (const i of keep)
          for (const j of keep) {
            if (j >= i || Math.abs(s.R[i][j]) < COLLINEAR.problem) continue;
            const v = s.names[i];
            const owner = constructOf(model, v);
            if (!owner || dropped.has(v)) continue;
            dropped.add(v);
            out.push({
              remedy: { kind: 'drop-indicator', constructId: owner.id, indicator: v },
              label: `Remove ${v} from ${owner.name}`,
              detail: `${v} duplicates ${s.names[j]}: it is taken out of the model (the column stays in the data).`,
            });
          }
        if (settings.missing === 'pairwise') out.push(fiml);
        return add(c, out);
      }
      case 'coverage':
        return settings.missing === 'casewise' ? add(c, [fiml]) : c;
      case 'weak-items': {
        // (a factor whose marker is weak: scaling it by its variance stops the weak item from setting its scale)
        const out: RemedyOption[] = [];
        for (const k of model.constructs) {
          if (k.type !== 'factor' || k.scaling || k.covariate) continue;
          const marker = k.indicators[0];
          if (!c.variables?.includes(`${marker} (${k.name})`) && !c.variables?.includes(k.name))
            continue;
          out.push({
            remedy: { kind: 'variance-scaling', constructId: k.id },
            label: `Scale ${k.name} by its variance`,
            detail: `${k.name}’s variance is fixed at 1 and every loading estimated, instead of the loading of ${marker} fixed at 1.`,
          });
        }
        return add(c, out);
      }
      default:
        return c;
    }
  });
}

/**
 * A covariance-matrix dataset with `name` = `variable` / `divisor` added as a new last variable, as a computed column
 * is added to raw data (so undoing the model's swap leaves a spare variable, not a broken one): its row and column of
 * every covariance matrix are the variable's divided by the divisor, its mean too, and the NACOV (column-major vech
 * of the dataset's variables, as R/lavaan.R reads it) grows to the new variables' pairs, each entry of the covariances
 * (a,b) and (c,d) divided by the divisor once for each of a, b, c and d that is the new variable.
 */
export function rescaleMoments(
  data: Dataset,
  variable: string,
  divisor: number,
  name: string,
): Dataset {
  const m = data.moments;
  const v = data.names.indexOf(variable);
  if (!m || v < 0) throw new Error(`${variable} is not a variable of this covariance matrix.`);
  if (data.names.includes(name)) throw new Error(`“${name}” is already a variable.`);
  const p = data.names.length;
  // (the new variable p is the old variable v, divided by the divisor)
  const g = (i: number) => (i === p ? v : i);
  const f = (i: number) => (i === p ? 1 / divisor : 1);
  const all = Array.from({ length: p + 1 }, (_, i) => i);
  const growS = (S: number[][]) => all.map((i) => all.map((j) => S[g(i)][g(j)] * f(i) * f(j)));
  const growMeans = (means?: number[]) => (means ? all.map((i) => means[g(i)] * f(i)) : undefined);
  // (the vech position of the pair (i, j) among p variables, column by column)
  const pos = (i: number, j: number) => {
    const lo = Math.min(i, j),
      hi = Math.max(i, j);
    return lo * p - (lo * (lo - 1)) / 2 + (hi - lo);
  };
  const pairs: { old: number; factor: number }[] = [];
  for (let j = 0; j <= p; j++)
    for (let i = j; i <= p; i++) pairs.push({ old: pos(g(i), g(j)), factor: f(i) * f(j) });
  const nacov = m.nacov
    ? pairs.map((a) => pairs.map((b) => m.nacov![a.old][b.old] * a.factor * b.factor))
    : undefined;
  const means = growMeans(m.means);
  return {
    ...data,
    names: [...data.names, name],
    moments: {
      ...m,
      S: growS(m.S),
      ...(means ? { means } : {}),
      ...(nacov ? { nacov } : {}),
      ...(m.groups
        ? {
            groups: m.groups.map((gr) => {
              const gm = growMeans(gr.means);
              return { ...gr, S: growS(gr.S), ...(gm ? { means: gm } : {}) };
            }),
          }
        : {}),
    },
  };
}

/**
 * The model measured by the rescaled column `to` instead of `from`, everywhere it names it (renameIndicator); an
 * observed covariate named after its column takes the new name too (renameCovariate).
 */
export function swapRescaled(model: ModelState, from: string, to: string): ModelState {
  const covariate = model.constructs.find((c) => c.covariate && c.indicators[0] === from);
  return covariate ? renameCovariate(model, covariate.id, to) : renameIndicator(model, from, to);
}

/** A remedy applied to the model and settings (rescaling, which adds a column, is applied by the caller with the data). */
export function applyRemedy(
  remedy: Exclude<Remedy, { kind: 'rescale' }>,
  model: ModelState,
): { model: ModelState; settings?: Partial<Settings> } {
  switch (remedy.kind) {
    case 'drop-indicator':
      return {
        model: {
          ...model,
          constructs: model.constructs.map((c) =>
            c.id === remedy.constructId
              ? { ...c, indicators: c.indicators.filter((i) => i !== remedy.indicator) }
              : c,
          ),
        },
      };
    case 'variance-scaling':
      return {
        model: {
          ...model,
          constructs: model.constructs.map((c) =>
            c.id === remedy.constructId ? { ...c, scaling: 'variance' as const } : c,
          ),
        },
      };
    case 'start-simple':
      return { model: { ...model, startValues: 'simple' } };
    case 'optimizer':
      return { model: { ...model, optimizer: 'BFGS' } };
    case 'positive-variances':
      return { model: { ...model, positiveVariances: true } };
    case 'fiml':
      return { model, settings: { missing: 'fiml' } };
  }
}

/** The estimation options a remedy switched on, each with how to switch it off again (the “Changes you tried” line). */
export function triedOptions(
  model: ModelState,
): { key: 'startValues' | 'optimizer' | 'positiveVariances'; label: string }[] {
  return [
    ...(model.startValues
      ? [{ key: 'startValues' as const, label: 'Simple starting values' }]
      : []),
    ...(model.optimizer ? [{ key: 'optimizer' as const, label: 'BFGS optimiser' }] : []),
    ...(model.positiveVariances
      ? [{ key: 'positiveVariances' as const, label: 'Variances kept ≥ 0' }]
      : []),
  ];
}

/** The checks that found something to act on (problems first). */
export function findings(checks: TroubleCheck[]): TroubleCheck[] {
  return [
    ...checks.filter((c) => c.status === 'problem'),
    ...checks.filter((c) => c.status === 'check'),
  ];
}
