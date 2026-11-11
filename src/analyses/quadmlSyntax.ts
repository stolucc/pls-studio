// The integration card's model language: Mplus's input for models with continuous latent variables (factors, growth
// factors, random effects, XWITH products) whose outcomes are censored, counts, categorical, survival times or normal
// (VARIABLE and ANALYSIS options; MODEL with BY, |, XWITH, ON, WITH, [means, thresholds, base hazards], variances,
// @ fixed values, * starting values and (labels) for equality), read with Mplus's defaults and turned into the
// specification the R engine fits (rengine/R/quadml.R): the free parameters, every model quantity a linear
// combination of them, the normal part (a linear structural model of the latent and continuous observed variables),
// the other outcomes with their linear predictors, the integration rule, and the rows to report.

import { qlogis, qnorm } from '../engine/stats';
import type { Dataset } from '../engine/types';
import { columnStats, MixtureModel, MixtureSyntaxError } from './mixtureSyntax';

export interface QuadSlot {
  c: number;
  t: number[];
}
export type QuadOutcomeType =
  | 'cat'
  | 'count'
  | 'nb'
  | 'zip'
  | 'zinb'
  | 'censored'
  | 'cinfl'
  | 'normal'
  | 'surv';
/** A linear predictor: intercept slot, slopes on the normal part's variables [var, slot], products [var, var, slot], covariates [column, slot] (slots −1: none). */
export interface QuadLin {
  icpt: number;
  loads: number[][];
  prods: number[][];
  xs: [string, number][];
}
export interface QuadOutcome extends QuadLin {
  name: string;
  column: string;
  type: QuadOutcomeType;
  link?: 'logit' | 'probit';
  thr?: number[];
  resvar?: number;
  disp?: number;
  side?: 'below' | 'above';
  levels?: number[];
  infl?: QuadLin;
  breaks?: number[];
  hazards?: number[];
  censor?: string;
  /** Binary items with asymptotes (Mplus's 3pl, 4pl): thr holds u$1, u$2 = −logit(lower), u$3 = −logit(upper). */
  asym?: '3pl' | '4pl';
}
export interface QuadGauss {
  vars: string[];
  cols: string[];
  x: string[];
  alpha: number[];
  B: number[][];
  G: number[][];
  Psi: number[][];
}
/**
 * The integration rule. rect: Mplus's STANDARD, `points` equally spaced over ±`range` per dimension with weights
 * proportional to the normal density; Mplus's range is ±5 for 10 points or more and ±points / 2 below (7 points:
 * ±3.5), which reproduces its printed log-likelihoods (examples 6.3 and 6.7 with 7 points, 15 elsewhere).
 */
export interface QuadIntegration {
  type: 'rect' | 'gh' | 'mc';
  points: number;
  adaptive: boolean;
  range: number;
  seed: number;
}
/** Mplus's range of the rectangular rule for a number of points. */
export const mplusRange = (points: number) => Math.min(5, points / 2);
export interface QuadReportRow {
  lhs: string;
  op: string;
  rhs: string;
  slot: number;
  fixed: boolean;
}
export interface QuadSpec {
  columns: string[];
  weight?: string;
  missing?: { column: string; values: number[] }[];
  theta: { name: string; start: number }[];
  slots: QuadSlot[];
  gauss: QuadGauss;
  outcomes: QuadOutcome[];
  integration: QuadIntegration;
  report: QuadReportRow[];
  se: 'mlr' | 'ml';
  /** Normal priors (Mplus's MODEL PRIORS, label ~ N(mean, variance)) on slots: the estimates maximise the log-likelihood plus the log prior. */
  priors?: { slot: number; mean: number; variance: number }[];
}
export interface QuadParse {
  spec: QuadSpec;
  dims: number;
  notes: string[];
}

export class QuadSyntaxError extends Error {}
const fail = (m: string): never => {
  throw new QuadSyntaxError(m);
};
const lc = (s: string) => s.toLowerCase();
/** A growth factor's loading at time t: 1 on the intercept, t on the slope, t² on the quadratic. */
const growthLoading = (factorIndex: number, t: number) => {
  if (factorIndex === 0) return 1;
  if (factorIndex === 1) return t;
  return t * t;
};
/** The Mplus word for a kind of statement, for messages. */
const mplusWord = (kind: string) => {
  if (kind === '~') return 'ON';
  if (kind === '~1') return '(mean)';
  if (kind === '~~') return 'WITH';
  return 'BY';
};
const num = (s: string) => {
  const v = Number(s);
  if (s === '' || !Number.isFinite(v)) fail(`“${s}” is not a number.`);
  return v;
};

interface Mod {
  fixed?: number;
  start?: number;
  label?: string;
}
interface El {
  name: string;
  mod: Mod;
}

/** Elements of a list with ranges (a-b), modifiers (@v fixed, *v start) and labels {lab} (from a line's (label)). */
function elements(mm: MixtureModel, text: string): El[] {
  const toks = text
    .replace(/\s*-\s*(?=[A-Za-z_])/g, '-')
    .split(/\s+/)
    .filter(Boolean);
  const out: El[] = [];
  for (const t of toks) {
    const m = /^([^@*{]+)(?:([@*])(-?[\d.]*(?:[eE][-+]?\d+)?))?(?:\{([^}]*)\})?$/.exec(t);
    if (!m) fail(`Cannot read “${t}”.`);
    const mod: Mod = {};
    if (m![2] === '@') mod.fixed = num(m![3]);
    else if (m![2] === '*' && m![3] !== '') mod.start = num(m![3]);
    // (t#1-t#21: base hazards or inflations by number)
    const hr = /^([A-Za-z_]\w*)#(\d+)-([A-Za-z_]\w*)#(\d+)$/.exec(m![1]);
    const expand = (x: string) => {
      try {
        return mm.expand(x);
      } catch (e) {
        if (e instanceof MixtureSyntaxError) fail(e.message);
        throw e;
      }
    };
    const names =
      hr && lc(hr[1]) === lc(hr[3]) && Number(hr[4]) >= Number(hr[2])
        ? Array.from(
            { length: Number(hr[4]) - Number(hr[2]) + 1 },
            (_, i) => `${hr[1]}#${Number(hr[2]) + i}`,
          )
        : expand(m![1]);
    const labs = m![4] ? m![4].split(/\s+/).filter(Boolean) : [];
    names.forEach((name, i) => {
      // (a range of labels a1-a20 gives one per element)
      let label: string | undefined = labs.length ? labs[0] : undefined;
      if (labs.length === 1 && /-/.test(labs[0])) {
        const ls = expand(labs[0]);
        if (ls.length !== names.length) fail(`(${labs[0]}): give one label per parameter.`);
        label = ls[i];
      }
      out.push({ name, mod: { ...mod, ...(label ? { label: lc(label) } : {}) } });
    });
  }
  return out;
}

/** Statements of the MODEL: each with the labels of its lines attached to the elements ((label) at the end of a line). */
function modelStatements(model: string): string[] {
  const lines = model.split('\n').map((line) => {
    const m = /^(.*?)\(\s*([A-Za-z_0-9][\w\s-]*)\s*\)\s*(;?)\s*$/.exec(line);
    if (!m || !m[1].trim()) return line;
    const lab = m[2].trim().replace(/\s+/g, ' ');
    // (the label belongs to the line's last statement)
    const cut = m[1].lastIndexOf(';') + 1;
    const before = m[1].slice(0, cut);
    let body = m[1].slice(cut);
    const kw = /\b(BY|ON|WITH)\b|\|/i.exec(body);
    const head = kw ? body.slice(0, kw.index + kw[0].length) : '';
    let rest = kw ? body.slice(kw.index + kw[0].length) : body;
    rest = rest
      .replace(/\s*-\s*(?=[A-Za-z_])/g, '-')
      .replace(/([^\s[\]]+)/g, (t) => `${t}{${lab}}`);
    body = head + rest;
    return before + body + m[3];
  });
  return lines
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Read the syntax against the data's columns and build the engine's specification. Throws QuadSyntaxError with a
 * message for the card when the syntax cannot be read or asks for something the engine does not fit.
 */
export function buildQuad(
  syntax: string,
  data: Dataset,
  opt: { integration?: Partial<QuadIntegration> } = {},
): QuadParse {
  const notes: string[] = [];
  const cols = data.names;
  const mm = new MixtureModel(cols);
  const colOf = (name: string) => {
    const i = cols.findIndex((c) => lc(c) === lc(name));
    return i < 0 ? null : cols[i];
  };
  const needCol = (name: string, what: string) =>
    colOf(name) ?? fail(`${what}: ${name} is not a column of the data.`);
  let text = syntax.replace(/!.*$/gm, ' ');
  // (Mplus's other sections: the title, the data file, output and plots say nothing about the model; a data
  // transformation must be made as columns first)
  const dataTr =
    /\bDATA\s+(TWOPART|MISSING|IMPUTATION|WIDETOLONG|LONGTOWIDE|SURVIVAL|COHORT|COPATTERN)\s*:/i.exec(
      text,
    );
  if (dataTr)
    fail(
      `DATA ${dataTr[1].toUpperCase()}: make the variables it creates as computed columns (Data tab) and name them in the model.`,
    );
  text = text.replace(
    /(?:^|\n)[ \t]*(TITLE|DATA|OUTPUT|PLOT|SAVEDATA|DEFINE)[ \t]*:[\s\S]*?(?=\n[ \t]*(?:VARIABLE|ANALYSIS|MODEL(?:[ \t]+[A-Za-z]+)?|TITLE|DATA|OUTPUT|PLOT|SAVEDATA|DEFINE)[ \t]*:|$)/gi,
    (m, k: string) => {
      if (/^DEFINE$/i.test(k) && m.replace(/^\s*DEFINE\s*:/i, '').trim())
        fail('DEFINE: make the variables as computed columns (Data tab).');
      return '\n';
    },
  );
  const at = /\bMODEL\s*:/i.exec(text);
  if (!at) fail('Write the model after MODEL:.');
  if (/\bMODEL\s+(CONSTRAINT|TEST|INDIRECT)\s*:/i.test(text))
    fail('MODEL CONSTRAINT, TEST and INDIRECT are not read by the card.');
  const declText = text.slice(0, at!.index).replace(/\b(VARIABLE|ANALYSIS)\s*:/gi, ' ');
  const pri = /\bMODEL\s+PRIORS\s*:/i.exec(text);
  const modelText = text.slice(at!.index + at![0].length, pri ? pri.index : undefined);
  const priorText = pri ? text.slice(pri.index + pri[0].length) : '';

  // --- declarations
  const asymOf = new Map<string, '3pl' | '4pl'>();
  const missing: { column: string; values: number[] }[] = [];
  const categorical = new Set<string>();
  const count = new Map<string, 'p' | 'i' | 'nb' | 'nbi'>();
  const censored = new Map<string, { side: 'below' | 'above'; infl: boolean }>();
  let survival: { column: string; breaks: number[] } | null = null;
  let timecens: string | undefined;
  let weight: string | undefined;
  let link: 'logit' | 'probit' = 'logit';
  let se: 'mlr' | 'ml' = 'mlr';
  const integ: QuadIntegration = { type: 'rect', points: 15, adaptive: true, range: 5, seed: 0 };
  let pointsGiven = false;
  let mcGiven = false;
  for (const raw of declText
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = /^([A-Za-z]+)\s*(?:=|\s+IS\s+|\s+ARE\s+)\s*([\s\S]*)$/i.exec(raw);
    if (!m) fail(`Cannot read “${raw}”: options are written NAME = value.`);
    const key = m![1].toUpperCase();
    const value = m![2].trim();
    switch (key) {
      case 'CATEGORICAL': {
        for (const p of value.matchAll(/([^()]+?)(?:\(\s*([a-z0-9]+)\s*\)|$)/gi)) {
          if (!p[1].trim()) continue;
          const k = lc(p[2] ?? '');
          if (k && k !== '3pl' && k !== '4pl' && k !== '2pl')
            fail(`CATEGORICAL = … (${p[2]}): 2PL, 3PL or 4PL items.`);
          for (const e of elements(mm, p[1])) {
            const y = needCol(e.name, 'CATEGORICAL');
            categorical.add(y);
            if (k === '3pl' || k === '4pl') asymOf.set(y, k);
          }
        }
        break;
      }
      case 'COUNT': {
        for (const p of value.matchAll(/([^()]+?)(?:\(\s*([a-z]+)\s*\)|$)/gi)) {
          if (!p[1].trim()) continue;
          const k = lc(p[2] ?? 'p');
          if (!['p', 'i', 'nb', 'nbi'].includes(k))
            fail(
              `COUNT = … (${p[2]}): Poisson, zero-inflated Poisson (i), negative binomial (nb) and zero-inflated negative binomial (nbi) are fitted.`,
            );
          for (const e of elements(mm, p[1]))
            count.set(needCol(e.name, 'COUNT'), k as 'p' | 'i' | 'nb' | 'nbi');
        }
        break;
      }
      case 'CENSORED': {
        for (const p of value.matchAll(/([^()]+?)\(\s*([a-z]+)\s*\)/gi)) {
          const k = lc(p[2]);
          if (!['a', 'b', 'ai', 'bi'].includes(k))
            fail(
              `CENSORED = … (${p[2]}): censoring from above (a) or below (b), inflated (ai, bi).`,
            );
          for (const e of elements(mm, p[1]))
            censored.set(needCol(e.name, 'CENSORED'), {
              side: k[0] === 'a' ? 'above' : 'below',
              infl: k.length === 2,
            });
        }
        if (!censored.size) fail('CENSORED: give the side, e.g. CENSORED = y1-y3 (b).');
        break;
      }
      case 'SURVIVAL': {
        const p = /^([A-Za-z_]\w*)\s*\(([^)]*)\)$/.exec(value);
        if (!p)
          fail('SURVIVAL: write the time variable and its intervals, e.g. SURVIVAL = t (20*1).');
        const lens: number[] = [];
        for (const tok of p![2].trim().split(/\s+/)) {
          const r = /^(\d+)\*([\d.]+)$/.exec(tok);
          if (r) for (let i = 0; i < Number(r[1]); i++) lens.push(num(r[2]));
          else lens.push(num(tok));
        }
        if (!lens.length || lens.some((l) => l <= 0))
          fail('SURVIVAL: the intervals’ lengths are positive.');
        if (lens.length > 60) fail('SURVIVAL: at most 60 intervals.');
        const breaks = [0];
        for (const l of lens) breaks.push(breaks[breaks.length - 1] + l);
        survival = { column: needCol(p![1], 'SURVIVAL'), breaks };
        break;
      }
      case 'TIMECENSORED':
        timecens = needCol(value.replace(/\([^)]*\)/g, '').trim(), 'TIMECENSORED');
        break;
      case 'FREQWEIGHT':
        weight = needCol(value, 'FREQWEIGHT');
        break;
      case 'LINK': {
        const v = lc(value);
        if (v !== 'logit' && v !== 'probit') fail('LINK = LOGIT or PROBIT.');
        link = v as 'logit' | 'probit';
        break;
      }
      case 'ESTIMATOR': {
        const v = value.toUpperCase();
        if (v === 'ML') se = 'ml';
        else if (v === 'MLR') se = 'mlr';
        else fail(`ESTIMATOR = ${value}: the card estimates by maximum likelihood (ML or MLR).`);
        break;
      }
      case 'INTEGRATION': {
        const v = value.toUpperCase().replace(/\s+/g, '');
        const r = /^(STANDARD|GAUSSHERMITE|MONTECARLO)?(?:\((\d+)\))?$/.exec(v);
        const n = /^\d+$/.test(v) ? Number(v) : null;
        if (n !== null) {
          integ.points = n;
          pointsGiven = true;
          break;
        }
        if (!r || (!r[1] && !r[2]))
          fail(
            `INTEGRATION = ${value}: a number of points, STANDARD (n), GAUSSHERMITE (n) or MONTECARLO (n).`,
          );
        if (r![1] === 'GAUSSHERMITE') integ.type = 'gh';
        else if (r![1] === 'MONTECARLO') integ.type = 'mc';
        else integ.type = 'rect';
        if (r![2]) {
          integ.points = Number(r![2]);
          pointsGiven = true;
        }
        if (integ.type === 'mc') mcGiven = true;
        break;
      }
      case 'ADAPTIVE':
        integ.adaptive = !/^OFF$/i.test(value);
        break;
      case 'TYPE':
        if (!/^(RANDOM|GENERAL|GENERAL\s+RANDOM|RANDOM\s+GENERAL)$/i.test(value))
          fail(`TYPE = ${value}: the card fits TYPE = GENERAL or RANDOM (one group, one level).`);
        break;
      case 'ALGORITHM':
        if (!/^INTEGRATION$/i.test(value))
          fail(`ALGORITHM = ${value}: the card integrates numerically.`);
        break;
      case 'BASEHAZARD':
        if (!/^ON$/i.test(value))
          fail(
            'BASEHAZARD = OFF (a Cox model) is not fitted: the card estimates the baseline hazard (ON).',
          );
        break;
      case 'MISSING': {
        // (values that stand for a missing value, e.g. MISSING = ALL (999) or y (-9))
        for (const m of value.matchAll(/([^()]+?)\(([^)]*)\)/g)) {
          const vals = m[2]
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(num);
          const names = /^\s*(ALL|\.)\s*$/i.test(m[1])
            ? cols
            : elements(mm, m[1]).map((e) => needCol(e.name, 'MISSING'));
          for (const c of names) missing.push({ column: c, values: vals });
        }
        if (/^\s*(\.|BLANK)\s*$/i.test(value)) break;
        break;
      }
      case 'NAMES':
      case 'USEVARIABLES':
      case 'USEVARIABLE':
      case 'USEVAR':
      case 'USEV':
      case 'PROCESSORS':
      case 'CHOLESKY':
      case 'MCONVERGENCE':
      case 'LOGCRITERION':
      case 'MITERATIONS':
        break;
      default:
        fail(
          `${key} is not an option the card reads (CATEGORICAL, COUNT, CENSORED, SURVIVAL, TIMECENSORED, FREQWEIGHT, LINK, ESTIMATOR, INTEGRATION, ADAPTIVE, TYPE, ALGORITHM, BASEHAZARD).`,
        );
    }
  }
  integ.range = mplusRange(integ.points);
  if (opt.integration) Object.assign(integ, opt.integration);
  if (missing.length) {
    // (the missing-value codes, applied to a copy of the data for the starting values and checks; R applies them too)
    const cl = data.cols.map((c) => Float64Array.from(c));
    for (const m of missing) {
      const i = data.names.indexOf(m.column);
      cl[i] = cl[i].map((v) => (m.values.includes(v) ? NaN : v));
    }
    data = { ...data, cols: cl };
  }
  if (integ.points < 1 || integ.points > (integ.type === 'mc' ? 100000 : 100))
    fail('INTEGRATION: between 1 and 100 points per dimension (Monte Carlo: 100000 draws).');
  void pointsGiven;

  // --- model statements
  const stmts = modelStatements(modelText);
  const factors = new Map<string, { kind: 'by' | 'growth'; indicators: string[] }>();
  const products = new Map<string, [string, string]>();
  interface Growth {
    factors: string[];
    outcomes: string[];
    times: number[];
    inflation: boolean;
  }
  const growths: Growth[] = [];
  // pass 1: declare latent variables
  for (const s of stmts) {
    const xw = /^(.+?)\|\s*(.+?)\s+XWITH\s+(.+)$/i.exec(s);
    if (xw) {
      products.set(lc(xw[1].trim()), [lc(xw[2].trim()), lc(xw[3].trim())]);
      continue;
    }
    const by = /^(.+?)\s+BY\s+(.+)$/i.exec(s);
    if (by) {
      for (const f of elements(mm, by[1]))
        if (!colOf(f.name)) {
          if (!factors.has(lc(f.name))) factors.set(lc(f.name), { kind: 'by', indicators: [] });
        } else
          fail(`${f.name} BY …: ${f.name} is a column of the data (a factor needs a new name).`);
      continue;
    }
    const gr = /^([^|[\]]+)\|([^|]+)$/.exec(s);
    if (gr) {
      const fs = elements(mm, gr[1]).map((f) => lc(f.name));
      if (fs.length < 2 || fs.length > 3)
        fail(
          'A growth model has an intercept and a slope (and a quadratic) factor: i s | y1@0 y2@1 …',
        );
      const outs = elements(mm, gr[2]);
      const inflation = outs.every((o) => /#1$/.test(o.name));
      const outcomes = outs.map((o) => needCol(o.name.replace(/#1$/, ''), 'Growth'));
      const times = outs.map(
        (o) => (o.mod.fixed ?? fail(`Give each occasion its time score: ${o.name}@t.`)) as number,
      );
      growths.push({ factors: fs, outcomes, times, inflation });
      for (const f of fs) {
        if (colOf(f)) fail(`${f}: a growth factor needs a name that is not a column.`);
        factors.set(f, { kind: 'growth', indicators: outcomes });
      }
    }
  }
  for (const [p, [a, b]] of products)
    if (!factors.has(a) || !factors.has(b))
      fail(`${p} | ${a} XWITH ${b}: XWITH multiplies two factors.`);
  const isLatent = (v: string) => factors.has(v);
  const ref = (name: string): string | null => {
    const l = lc(name);
    if (factors.has(l) || products.has(l)) return l;
    return colOf(name);
  };

  // pass 2: parameters
  interface Item {
    kind: string;
    a: string;
    b: string;
    mod: Mod;
  }
  const items: Item[] = [];
  const add = (kind: string, a: string, b: string, mod: Mod) => items.push({ kind, a, b, mod });
  for (const s of stmts) {
    if (/XWITH/i.test(s)) continue;
    const by = /^(.+?)\s+BY\s+(.+)$/i.exec(s);
    const gr = /^([^|[\]]+)\|([^|]+)$/.exec(s);
    const on = /^(.+?)\s+ON\s+(.+)$/i.exec(s);
    const wth = /^(.+?)\s+WITH\s+(.+)$/i.exec(s);
    if (by) {
      const rhsToks = by[2].replace(/\s*-\s*(?=[A-Za-z_])/g, '-').split(/\s+/);
      for (const f of elements(mm, by[1])) {
        const fac = factors.get(lc(f.name))!;
        elements(mm, by[2]).forEach((e, j) => {
          const y =
            colOf(e.name) ?? fail(`${f.name} BY ${e.name}: ${e.name} is not a column of the data.`);
          const first = !fac.indicators.length;
          if (!fac.indicators.includes(y)) fac.indicators.push(y);
          const mod = { ...e.mod };
          // (the first indicator's loading is fixed at 1 unless freed with *)
          if (first && j === 0 && mod.fixed === undefined && !/\*/.test(rhsToks[0] ?? ''))
            mod.fixed = 1;
          add('=~', lc(f.name), y, mod);
        });
      }
    } else if (gr) {
      continue;
    } else if (on) {
      for (const l of elements(mm, on[1]))
        for (const r of elements(mm, on[2])) {
          // (u#1 ON x: the inflation of a zero-inflated count or censored-inflated outcome regressed on x)
          const infl = /^(.+)#1$/.exec(l.name);
          const ic = infl ? colOf(infl[1]) : null;
          const ln = ic
            ? `${ic}#1`
            : (ref(l.name) ??
              fail(`${l.name} ON …: ${l.name} is not a column or a latent variable.`));
          const rn =
            ref(r.name) ?? fail(`… ON ${r.name}: ${r.name} is not a column or a latent variable.`);
          if (products.has(ln)) fail(`${l.name} ON …: a product (XWITH) is not regressed.`);
          add('~', ln, rn, r.mod);
        }
    } else if (wth) {
      for (const l of elements(mm, wth[1]))
        for (const r of elements(mm, wth[2])) {
          const a = ref(l.name) ?? fail(`${l.name} is not a column or a latent variable.`);
          const b = ref(r.name) ?? fail(`${r.name} is not a column or a latent variable.`);
          add('~~', a, b, r.mod);
        }
    } else if (/^\[.*\]$/.test(s)) {
      for (const e of elements(mm, s.slice(1, -1))) {
        const th = /^(.+)\$(\d+)$/.exec(e.name);
        const hash = /^(.+)#(\d+)$/.exec(e.name);
        if (th) add(`$${th[2]}`, needCol(th[1], `[${e.name}]`), '', e.mod);
        else if (hash) add('#', needCol(hash[1], `[${e.name}]`), hash[2], e.mod);
        else
          add(
            '~1',
            ref(e.name) ?? fail(`[${e.name}]: not a column or a latent variable.`),
            '',
            e.mod,
          );
      }
    } else {
      for (const e of elements(mm, s)) {
        const v = ref(e.name) ?? fail(`“${s}”: ${e.name} is not a column or a latent variable.`);
        add('~~', v, v, e.mod);
      }
    }
  }

  // --- roles
  const typeOf = (y: string): QuadOutcomeType | 'cont' => {
    if (categorical.has(y)) return 'cat';
    if (count.has(y))
      return ({ i: 'zip', nb: 'nb', nbi: 'zinb', p: 'count' } as const)[count.get(y)!];
    if (censored.has(y)) return censored.get(y)!.infl ? 'cinfl' : 'censored';
    if (survival && survival.column === y) return 'surv';
    return 'cont';
  };
  const dv = new Set<string>();
  factors.forEach((f) => f.indicators.forEach((y) => dv.add(y)));
  for (const it of items) {
    if (it.kind === '~' && !isLatent(it.a)) dv.add(it.a.replace(/#1$/, ''));
    if ((it.kind === '~~' || it.kind === '~1') && !isLatent(it.a) && !products.has(it.a)) {
      dv.add(it.a);
      if (it.kind === '~~' && it.b !== it.a && !isLatent(it.b)) dv.add(it.b);
    }
    if (it.kind.startsWith('$') || it.kind === '#') dv.add(it.a);
  }
  [categorical, new Set(count.keys()), new Set(censored.keys())].forEach((s) =>
    s.forEach((v) => {
      if (dv.has(v) || items.some((it) => it.b === v)) dv.add(v);
    }),
  );
  if (survival) dv.add(survival.column);
  for (const y of categorical)
    if (!dv.has(y)) fail(`${y} is declared CATEGORICAL but is not in the model.`);
  const covariates = new Set<string>();
  for (const it of items)
    if (it.kind === '~' && !isLatent(it.b) && !products.has(it.b) && !dv.has(it.b))
      covariates.add(it.b);
  // Continuous outcomes regressed on a product (XWITH) are normal outcomes outside the normal part.
  const nonlinear = new Set<string>();
  for (const it of items)
    if (it.kind === '~' && products.has(it.b)) {
      if (isLatent(it.a))
        fail(`${it.a} ON ${it.b}: a latent variable regressed on a product is not fitted.`);
      if (typeOf(it.a) === 'cont') nonlinear.add(it.a);
    }
  const outType = (y: string): QuadOutcomeType | null => {
    const t = typeOf(y);
    if (t !== 'cont') return t;
    // A continuous outcome is integrated (normal) only when it enters nonlinearly; otherwise it stays Gaussian.
    return nonlinear.has(y) ? 'normal' : null;
  };
  const gaussVars = [...factors.keys(), ...cols.filter((c) => dv.has(c) && outType(c) === null)];
  const gIdx = (v: string) => gaussVars.indexOf(v);
  const outcomesList = cols.filter((c) => dv.has(c) && outType(c) !== null);
  if (!outcomesList.length && !gaussVars.some((v) => !isLatent(v)))
    fail('No outcome in the model.');
  for (const it of items) {
    if (it.kind === '~' && products.has(it.b) && outType(it.a) === null)
      fail(`${it.a} ON ${it.b}: ${it.a} must be an outcome.`);
    if (it.kind === '~' && outType(it.b) !== null && it.b !== it.a && dv.has(it.b))
      fail(
        `${it.a} ON ${it.b}: regressions on censored, count, categorical or survival outcomes are not fitted.`,
      );
    if (it.kind === '~~' && it.a !== it.b && (outType(it.a) !== null || outType(it.b) !== null))
      fail(
        `${it.a} WITH ${it.b}: covariances are between continuous variables and factors (non-normal outcomes are conditionally independent given the factors).`,
      );
  }
  for (const [y, c] of censored)
    if (!dv.has(y)) fail(`${y} is declared CENSORED but is not in the model.`);
    else void c;
  for (const y of count.keys())
    if (!dv.has(y)) fail(`${y} is declared COUNT but is not in the model.`);
  const st = new Map<string, ReturnType<typeof columnStats>>();
  const S = (c: string) => {
    if (!st.has(c)) st.set(c, columnStats(data, c));
    return st.get(c)!;
  };
  for (const y of dv) if (S(y).n === 0) fail(`${y} has no observed values.`);
  for (const y of categorical) {
    if (S(y).levels.length > 10)
      fail(`${y} has ${S(y).levels.length} categories: is it categorical?`);
    if (S(y).levels.length < 2) fail(`${y} has a single category.`);
  }
  for (const y of count.keys())
    if (S(y).min < 0 || S(y).levels.some((l) => l !== Math.round(l)))
      fail(`${y}: a count is a whole number ≥ 0.`);
  if (survival) {
    if (S(survival.column).min < 0) fail(`${survival.column}: survival times are ≥ 0.`);
  }

  // --- parameters
  const theta: QuadSpec['theta'] = [];
  const slots: QuadSlot[] = [];
  const labels = new Map<string, number>();
  const report: QuadReportRow[] = [];
  const free = (name: string, start: number, label?: string) => {
    if (label) {
      if (!labels.has(label)) {
        theta.push({ name: label, start });
        labels.set(label, theta.length - 1);
      }
      slots.push({ c: 0, t: [labels.get(label)!, 1] });
      return slots.length - 1;
    }
    theta.push({ name, start });
    slots.push({ c: 0, t: [theta.length - 1, 1] });
    return slots.length - 1;
  };
  const fixed = (v: number) => {
    slots.push({ c: v, t: [] });
    return slots.length - 1;
  };
  const used = new Set<Item>();
  const find = (kind: string, a: string, b = '') => {
    const its = items.filter(
      (it) =>
        it.kind === kind &&
        ((it.a === a && it.b === b) || (kind === '~~' && it.a === b && it.b === a)),
    );
    its.forEach((it) => used.add(it));
    if (!its.length) return null;
    // (later statements override earlier ones; modifiers combine)
    return its.reduce<Mod>(
      (m, it) => ({
        ...m,
        ...it.mod,
        ...(it.mod.fixed !== undefined ? { start: undefined } : {}),
        ...(it.mod.start !== undefined ? { fixed: undefined } : {}),
      }),
      {},
    );
  };
  /** A parameter: from its statement (fixed / start / label) or the default (null: not in the model). */
  const param = (
    row: { lhs: string; op: string; rhs: string },
    mod: Mod | null,
    def: { fixed?: number; start: number; label?: string } | null,
  ) => {
    let slot: number;
    if (mod?.fixed !== undefined) slot = fixed(mod.fixed);
    else if (mod)
      slot = free(
        `${row.lhs} ${row.op} ${row.rhs}`.trim(),
        mod.start ?? def?.start ?? 0,
        mod.label ?? (mod.start === undefined ? def?.label : undefined) ?? def?.label,
      );
    else if (!def) return -1;
    else if (def.fixed !== undefined) slot = fixed(def.fixed);
    else slot = free(`${row.lhs} ${row.op} ${row.rhs}`.trim(), def.start, def.label);
    report.push({ ...row, slot, fixed: slots[slot].t.length === 0 });
    return slot;
  };
  const growthOf = (y: string) => growths.find((g) => g.outcomes.includes(y) && !g.inflation);
  const inflGrowthOf = (y: string) => growths.find((g) => g.outcomes.includes(y) && g.inflation);
  const growthFactor = (f: string) => growths.find((g) => g.factors.includes(f));

  // normal part: means, regressions, loadings of continuous indicators, (co)variances
  const m = gaussVars.length;
  const alpha: number[] = [];
  const Bm: number[][] = [];
  const Gm: number[][] = [];
  const Psi: number[][] = [];
  const exo = (f: string) => !items.some((it) => it.kind === '~' && it.a === f);
  const zeroVar = (f: string) => {
    const md = items.filter((it) => it.kind === '~~' && it.a === f && it.b === f).pop()?.mod;
    return md?.fixed === 0;
  };
  const sdOf = (f: string) => {
    const fac = factors.get(f)!;
    const y = fac.indicators[0];
    if (!y) return 1;
    const t = typeOf(y);
    return t === 'cont' || t === 'censored' || t === 'cinfl' ? Math.sqrt(S(y).variance) : 1;
  };
  gaussVars.forEach((v) => {
    const lat = isLatent(v);
    const g = lat ? growthFactor(v) : undefined;
    // mean / intercept
    let def: { fixed?: number; start: number; label?: string };
    if (lat && g) {
      const gi = g.factors.indexOf(v);
      const y0 = g.outcomes[0];
      const yl = g.outcomes[g.outcomes.length - 1];
      const t0 = typeOf(y0);
      const dt = g.times[g.times.length - 1] - g.times[0] || 1;
      if (g.inflation || t0 === 'cat') def = gi === 0 ? { fixed: 0, start: 0 } : { start: 0 };
      else if (t0 === 'count' || t0 === 'zip' || t0 === 'nb' || t0 === 'zinb')
        def = { start: gi === 0 ? Math.log(Math.max(S(y0).mean, 0.1)) : 0 };
      else {
        // Intercept: the first outcome's mean; slope: the mean change per time unit; quadratic: 0.
        let start = 0;
        if (gi === 0) start = S(y0).mean;
        else if (gi === 1) start = (S(yl).mean - S(y0).mean) / dt;
        def = { start };
      }
    } else if (lat) def = { fixed: 0, start: 0 };
    else def = growthOf(v) ? { fixed: 0, start: 0 } : { start: S(v).mean };
    alpha.push(param({ lhs: v, op: '~1', rhs: '' }, find('~1', v), def));
  });
  gaussVars.forEach((v, i) => {
    // loadings of continuous indicators (z_v on factor f)
    for (const [f, fac] of factors)
      if (fac.indicators.includes(v)) {
        const g = growthFactor(f);
        if (g) {
          const t = g.times[g.outcomes.indexOf(v)];
          const val = growthLoading(g.factors.indexOf(f), t);
          Bm.push([
            i,
            gIdx(f),
            param({ lhs: f, op: '=~', rhs: v }, null, { fixed: val, start: val }),
          ]);
        } else
          Bm.push([
            i,
            gIdx(f),
            param({ lhs: f, op: '=~', rhs: v }, find('=~', f, v), { start: 1 }),
          ]);
      }
    for (const it of items.filter((x) => x.kind === '~' && x.a === v)) {
      if (gIdx(it.b) >= 0)
        Bm.push([
          i,
          gIdx(it.b),
          param({ lhs: v, op: '~', rhs: it.b }, find('~', v, it.b), { start: 0 }),
        ]);
      else if (covariates.has(it.b))
        Gm.push([
          i,
          [...covariates].indexOf(it.b),
          param({ lhs: v, op: '~', rhs: it.b }, find('~', v, it.b), { start: 0 }),
        ]);
    }
  });
  gaussVars.forEach((v, i) => {
    const lat = isLatent(v);
    const g = lat ? growthFactor(v) : undefined;
    let start = lat ? 0.5 * sdOf(v) ** 2 : 0.5 * S(v).variance;
    if (g && g.factors.indexOf(v) > 0) start *= 0.2;
    if (
      lat &&
      g &&
      (g.inflation || ['count', 'zip', 'nb', 'zinb', 'cat'].includes(typeOf(g.outcomes[0])))
    )
      start = g.factors.indexOf(v) === 0 ? 0.5 : 0.05;
    Psi.push([i, i, param({ lhs: v, op: '~~', rhs: v }, find('~~', v, v), { start })]);
  });
  for (let i = 0; i < m; i++)
    for (let j = i + 1; j < m; j++) {
      const a = gaussVars[i];
      const b = gaussVars[j];
      const md = find('~~', a, b);
      const both = isLatent(a) && isLatent(b) && !zeroVar(a) && !zeroVar(b) && exo(a) === exo(b);
      const s = param({ lhs: b, op: '~~', rhs: a }, md, both ? { start: 0 } : null);
      if (s >= 0) Psi.push([i, j, s]);
    }

  // the other outcomes
  const xsList = [...covariates];
  const outcomes: QuadOutcome[] = [];
  const linFor = (
    y: string,
    own: string,
    isInfl: boolean,
    defIcpt: { fixed?: number; start: number; label?: string } | null,
  ): QuadLin => {
    const icpt =
      defIcpt === null &&
      !items.some((it) => (isInfl ? it.kind === '#' && it.a === y : it.kind === '~1' && it.a === y))
        ? -1
        : param(
            { lhs: own, op: '~1', rhs: '' },
            isInfl ? find('#', y, '1') : find('~1', y),
            defIcpt,
          );
    const loads: number[][] = [];
    const prods: number[][] = [];
    const xs: [string, number][] = [];
    for (const [f, fac] of factors) {
      const g = growthFactor(f);
      if (g) {
        if (g.inflation !== isInfl || !g.outcomes.includes(y)) continue;
        const t = g.times[g.outcomes.indexOf(y)];
        const val = growthLoading(g.factors.indexOf(f), t);
        loads.push([
          gIdx(f),
          param({ lhs: f, op: '=~', rhs: own }, null, { fixed: val, start: val }),
        ]);
      } else if (!isInfl && fac.indicators.includes(y))
        loads.push([gIdx(f), param({ lhs: f, op: '=~', rhs: y }, find('=~', f, y), { start: 1 })]);
    }
    for (const it of items.filter((x) => x.kind === '~' && x.a === own)) {
      if (gIdx(it.b) >= 0)
        loads.push([
          gIdx(it.b),
          param({ lhs: own, op: '~', rhs: it.b }, find('~', own, it.b), { start: 0 }),
        ]);
      else if (products.has(it.b)) {
        const [p, q] = products.get(it.b)!;
        prods.push([
          gIdx(p),
          gIdx(q),
          param({ lhs: own, op: '~', rhs: it.b }, find('~', own, it.b), { start: 0 }),
        ]);
      } else if (covariates.has(it.b))
        xs.push([
          it.b,
          param({ lhs: own, op: '~', rhs: it.b }, find('~', own, it.b), { start: 0 }),
        ]);
    }
    return { icpt, loads, prods, xs };
  };
  for (const y of outcomesList) {
    const t = outType(y)!;
    const s = S(y);
    const g = growthOf(y);
    const ig = inflGrowthOf(y);
    const o: Partial<QuadOutcome> = { name: y, column: y, type: t };
    if (t === 'cat') {
      o.link = link;
      o.levels = s.levels;
      const lab = g ? `__thr_${growths.indexOf(g)}` : undefined;
      o.thr = s.levels.slice(0, -1).map((_, j) => {
        const cum = s.counts.slice(0, j + 1).reduce((a, b) => a + b, 0) / s.n;
        return param({ lhs: y, op: '|', rhs: `t${j + 1}` }, find(`$${j + 1}`, y), {
          start:
            link === 'probit' ? qnorm(Math.min(Math.max(cum, 1e-6), 1 - 1e-6)) : qlogis(cum, 1e-4),
          label: lab ? `${lab}_${j}` : undefined,
        });
      });
      const as = asymOf.get(y);
      if (as) {
        if (s.levels.length !== 2) fail(`${y}: 3PL and 4PL items are binary.`);
        if (link === 'probit') fail(`${y}: 3PL and 4PL items have the logit link.`);
        o.asym = as;
        // (u$2 = −logit(lower asymptote), u$3 = −logit(upper asymptote): Mplus's parameterization)
        o.thr.push(param({ lhs: y, op: '|', rhs: 't2' }, find('$2', y), { start: 1.386 }));
        if (as === '4pl')
          o.thr.push(param({ lhs: y, op: '|', rhs: 't3' }, find('$3', y), { start: -2 }));
      }
      Object.assign(o, linFor(y, y, false, null));
      o.icpt = -1;
    } else if (t === 'surv') {
      o.breaks = survival!.breaks;
      o.censor = timecens;
      // (a common starting hazard: events over the total time)
      const ti = data.names.indexOf(y);
      const ci = timecens ? data.names.indexOf(timecens) : -1;
      let ev = 0;
      let tot = 0;
      data.cols[ti].forEach((v, r) => {
        if (Number.isFinite(v)) {
          tot += v;
          if (ci < 0 || data.cols[ci][r] === 0) ev++;
        }
      });
      const h0 = Math.max(ev, 1) / Math.max(tot, 1e-6);
      o.hazards = survival!.breaks.map((_, k) =>
        param({ lhs: `${y}#${k + 1}`, op: 'hazard', rhs: '' }, find('#', y, String(k + 1)), {
          start: h0,
        }),
      );
      Object.assign(o, linFor(y, y, false, null));
      o.icpt = -1;
    } else {
      // The intercept: fixed at 0 under a growth model, else started at the (log) mean.
      let defI: { fixed?: number; start: number } = { start: s.mean };
      if (g) defI = { fixed: 0, start: 0 };
      else if (t === 'count' || t === 'zip' || t === 'nb' || t === 'zinb')
        defI = { start: Math.log(Math.max(s.mean, 0.1)) };
      Object.assign(o, linFor(y, y, false, defI));
      if (t === 'censored' || t === 'cinfl' || t === 'normal') {
        o.side = censored.get(y)?.side ?? 'below';
        o.resvar = param({ lhs: y, op: '~~', rhs: y }, find('~~', y, y), {
          start: 0.5 * s.variance,
        });
      }
      if (t === 'nb' || t === 'zinb')
        o.disp = param({ lhs: y, op: 'dispersion', rhs: '' }, null, { start: 0.5 });
      if (t === 'zip' || t === 'zinb' || t === 'cinfl') {
        const lab = ig ? `__infl_${growths.indexOf(ig)}` : undefined;
        o.infl = linFor(y, `${y}#1`, true, { start: -1, label: lab });
      }
    }
    outcomes.push(o as QuadOutcome);
  }
  // A statement the model does not use (a typo, or a parameter the outcome does not have) is an error.
  for (const it of items)
    if (!used.has(it)) {
      if (it.kind.startsWith('$'))
        fail(
          `${it.a}$${it.kind.slice(1)}: ${it.a} is not categorical with that many categories (CATEGORICAL = …).`,
        );
      if (it.kind === '#')
        fail(
          `[${it.a}#${it.b}]: not the inflation of a zero-inflated count or censored-inflated outcome, nor a base hazard of a survival time.`,
        );
      if (it.kind === '~1' && covariates.has(it.a))
        fail(`[${it.a}]: ${it.a} is a covariate (conditioned on, not modelled).`);
      if (it.kind === '~~' && covariates.has(it.a))
        fail(`${it.a}: ${it.a} is a covariate (conditioned on, not modelled).`);
      fail(`${it.a} ${mplusWord(it.kind)} ${it.b}: not a parameter of this model.`);
    }
  // MODEL PRIORS: label ~ N(mean, variance) for the parameters labelled in MODEL.
  const priors: { slot: number; mean: number; variance: number }[] = [];
  for (const st of priorText
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(.+?)\s*~\s*N\s*\(\s*(-?[\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)$/i.exec(st);
    if (!m)
      fail(
        `MODEL PRIORS: cannot read “${st}” (the card reads normal priors: label ~ N(mean, variance)).`,
      );
    const mean = num(m![2]);
    const variance = num(m![3]);
    if (!(variance > 0)) fail(`MODEL PRIORS: ${m![1]}: the variance is positive.`);
    for (const e of elements(mm, m![1])) {
      const t =
        labels.get(lc(e.name)) ?? fail(`MODEL PRIORS: ${e.name} is not a label in the model.`);
      priors.push({ slot: (slots.push({ c: 0, t: [t, 1] }), slots.length - 1), mean, variance });
    }
  }
  // Integration dimensions: the normal part's variables the other outcomes depend on (and that can be unobserved).
  // (per case: the latent variables, and the missing continuous variables, that its observed outcomes depend on)
  const refsOf = (o: QuadOutcome) => [
    ...new Set(
      [o, ...(o.infl ? [o.infl] : [])].flatMap((l) => [
        ...l.loads.map(([v]) => v),
        ...l.prods.flatMap(([a, b]) => [a, b]),
      ]),
    ),
  ];
  const outRefs = outcomes.map((o) => ({
    col: data.cols[data.names.indexOf(o.column)],
    refs: refsOf(o).filter((v) => !(isLatent(gaussVars[v]) && zeroVar(gaussVars[v]))),
  }));
  const gcol = gaussVars.map((v) => (isLatent(v) ? null : data.cols[data.names.indexOf(v)]));
  let dims = 0;
  let work = 0;
  const nrow = data.cols[0]?.length ?? 0;
  for (let r = 0; r < nrow; r++) {
    const d = new Set<number>();
    for (const o of outRefs)
      if (Number.isFinite(o.col[r]))
        for (const v of o.refs) if (!gcol[v] || !Number.isFinite(gcol[v]![r])) d.add(v);
    dims = Math.max(dims, d.size);
    // Monte Carlo draws the same points whatever the dimension; quadrature grows as points^dimensions.
    if (integ.type === 'mc') work += d.size ? integ.points : 1;
    else work += integ.points ** d.size;
  }
  if (integ.type !== 'mc' && work > 3e7)
    fail(
      `Up to ${dims} dimensions of integration with ${integ.points} points each: ${Math.round(work).toLocaleString('en')} points over the cases, too many (reduce INTEGRATION or use MONTECARLO).`,
    );
  if (integ.type === 'mc' && !mcGiven) integ.points = 250 * Math.max(1, dims);
  if (
    integ.type === 'mc' &&
    /MONTECARLO\s*$/i.test(declText.split(/INTEGRATION\s*=/i)[1]?.split(';')[0] ?? '')
  )
    integ.points = 250 * Math.max(1, dims);
  const usedCols = [
    ...new Set([
      ...outcomesList,
      ...gaussVars.filter((v) => !isLatent(v)),
      ...xsList,
      ...(timecens ? [timecens] : []),
      ...(weight ? [weight] : []),
    ]),
  ];
  const spec: QuadSpec = {
    columns: cols.filter((c) => usedCols.includes(c)),
    ...(weight ? { weight } : {}),
    theta,
    slots,
    gauss: {
      vars: gaussVars,
      cols: gaussVars.map((v) => (isLatent(v) ? '' : v)),
      x: xsList,
      alpha,
      B: Bm,
      G: Gm,
      Psi,
    },
    outcomes,
    integration: integ,
    report,
    se,
    ...(priors.length ? { priors } : {}),
    ...(missing.some((m) => usedCols.includes(m.column))
      ? { missing: missing.filter((m) => usedCols.includes(m.column)) }
      : {}),
  };
  if (theta.length > 300) fail(`${theta.length} free parameters: too many.`);
  if (!theta.length) fail('No free parameter.');
  return { spec, dims, notes };
}

const KEYWORDS = new Set([
  'by',
  'on',
  'with',
  'xwith',
  'is',
  'are',
  'model',
  'variable',
  'analysis',
  'categorical',
  'count',
  'censored',
  'survival',
  'timecensored',
  'freqweight',
  'link',
  'estimator',
  'integration',
  'adaptive',
  'type',
  'algorithm',
  'basehazard',
  'missing',
  'names',
  'usevariables',
  'usevariable',
  'usevar',
  'usev',
  'processors',
  'cholesky',
  'mconvergence',
  'logcriterion',
  'miterations',
  'random',
  'general',
  'ml',
  'mlr',
  'logit',
  'probit',
  'standard',
  'gausshermite',
  'montecarlo',
  'on',
  'off',
  'all',
]);
/** The data columns a syntax names (without the data: ranges by their numeric suffix), for listing an example's columns. */
export function quadColumns(syntax: string): string[] {
  const text = syntax.replace(/!.*$/gm, ' ');
  const latent = new Set(
    [...text.matchAll(/(?:^|;|:)\s*([A-Za-z_][\w\s-]*?)\s+(?:BY\b|\|)/gim)].flatMap((m) =>
      m[1].trim().split(/\s+/).map(lc),
    ),
  );
  const body = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*-\s*(?=[A-Za-z_])/g, '-')
    .replace(/[@*]-?[\d.]+/g, ' ');
  const out: string[] = [];
  for (const tok of body.match(/[A-Za-z_][\w$#]*(?:-[A-Za-z_][\w$#]*)?/g) ?? []) {
    const parts = tok.split('-').map((x) => x.replace(/[$#]\d+$/, ''));
    if (parts.some((x) => KEYWORDS.has(lc(x)) || latent.has(lc(x)))) continue;
    if (parts.length === 2) {
      const a = /^(.*?)(\d+)$/.exec(parts[0]);
      const b = /^(.*?)(\d+)$/.exec(parts[1]);
      if (a && b && a[1] === b[1]) {
        for (let i = Number(a[2]); i <= Number(b[2]); i++) out.push(`${a[1]}${i}`);
        continue;
      }
    }
    out.push(...parts);
  }
  return [...new Set(out)];
}
