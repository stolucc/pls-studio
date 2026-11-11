// The Bayesian multilevel / DSEM card's model language: Mplus's input for ESTIMATOR = BAYES with TYPE = TWOLEVEL,
// THREELEVEL or CROSSCLASSIFIED (RANDOM), or an N = 1 time series (VARIABLE: CATEGORICAL, WITHIN, BETWEEN, CLUSTER,
// LAGGED, TINTERVAL; DEFINE: CENTER … (GROUPMEAN) and new variables; MODEL with %WITHIN% and %BETWEEN [cluster]%
// parts, BY, ON, WITH, random slopes and loadings (s | y ON x, s1-s4 | f BY y1-y4), random residual variances
// (logv | y), lags (y&1, f BY … (&1)), [means], variances, @ fixed values, (labels) for equality), with Mplus's
// defaults, turned into the structural specification rengine/R/dsem.R writes a Stan program from: parameters,
// within-level variables and terms, random effects with a component per cluster level, the between-level model and
// the rows to report (named as Mplus prints them).

import { evaluate, parseFormula } from '../data/compute';
import type { Dataset } from '../engine/types';

export class DsemSyntaxError extends Error {}
const fail = (m: string): never => {
  throw new DsemSyntaxError(m);
};

/** {p} a parameter (i, j: an element of a block), {v} a fixed value, {r} a random effect. */
export type DsemCoef = { p: number; i?: number; j?: number } | { v: number } | { r: number };
/** prior: a normal prior's mean and variance (Mplus's N(0, 5) for categorical outcomes' loadings and thresholds); otherwise flat. */
/** start: the sampler's starting value (loadings 1, as Mplus starts them: the chains begin in the mode with positive loadings). */
export type DsemParam =
  | { type: 'real' | 'pos'; prior?: [number, number]; start?: number }
  | { type: 'block'; fixed: (number | null)[] };
export interface DsemNode {
  kind: 'y' | 'u' | 'f' | 'x';
  column?: string;
  int?: DsemCoef;
  thr?: DsemCoef;
  part?: number;
  resid?: DsemCoef;
}
export interface DsemSpec {
  levels: { column: string; nested?: boolean }[];
  series: { level?: number; time?: string; interval?: number };
  params: DsemParam[];
  re: { comps: ({ on: true } | null)[] }[];
  nodes: DsemNode[];
  /** p: a within-level variable; pb instead: a between-level factor (its cluster's value), loading with a random coefficient (9.26). */
  wterms: { t: number; p: number; pb?: number; lag: number; load?: boolean; c: DsemCoef }[];
  wblocks: { members: number[]; c: DsemCoef }[];
  btargets: {
    kind: 're' | 'bf' | 'z';
    level: number;
    re?: number;
    column?: string;
    mean?: DsemCoef;
  }[];
  bterms: { t: number; b?: number; x?: string; c: DsemCoef }[];
  bblocks: { members: number[]; c: DsemCoef }[];
  report: { lhs: string; op: string; rhs: string; block: string; c: DsemCoef }[];
}
export interface DsemParse {
  spec: DsemSpec;
  define: { name: string; expr: string }[];
  iterations?: number;
  notes: string[];
}

const lc = (s: string) => s.toLowerCase();
const num = (s: string) => {
  const v = Number(s);
  if (s.trim() === '' || !Number.isFinite(v)) fail(`“${s}” is not a number.`);
  return v;
};

interface Mod {
  fixed?: number;
  free?: boolean;
  start?: number;
}
interface El {
  name: string;
  mod: Mod;
  label?: string;
  lagDecl?: number;
}

/** Split the input into sections and statements (comments after ! dropped). */
function statements(src: string) {
  const text = src.replace(/!.*$/gm, '');
  const out: { section: string; text: string }[] = [];
  let section = 'VARIABLE';
  const re =
    /\b(TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL PRIORS|MODEL CONSTRAINT|MODEL|OUTPUT|SAVEDATA|PLOT|MONTECARLO)\s*:/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  const chunks: { section: string; body: string }[] = [];
  while ((m = re.exec(text))) {
    chunks.push({ section, body: text.slice(last, m.index) });
    section = m[1].toUpperCase();
    last = m.index + m[0].length;
  }
  chunks.push({ section, body: text.slice(last) });
  for (const c of chunks) {
    // %WITHIN% / %BETWEEN …% headings end a statement too
    const body = c.body.replace(/(%[^%]*%)/g, ';$1;');
    for (const s of body.split(';')) if (s.trim()) out.push({ section: c.section, text: s.trim() });
  }
  return out;
}

export function parseDsem(src: string, data: Dataset): DsemParse {
  const notes: string[] = [];
  const columns = [...data.names];
  const colOf = (n: string) => columns.find((c) => lc(c) === lc(n));
  // ---- VARIABLE, DEFINE, ANALYSIS ----
  const categorical = new Set<string>();
  const withinOnly = new Set<string>();
  const withinOf = new Map<string, string>();
  const betweenVars = new Map<string, string | null>();
  let clusters: string[] = [];
  const lagged = new Map<string, number>();
  let tinterval: { time: string; step: number } | undefined;
  let type = '';
  let iterations: number | undefined;
  const define: { name: string; expr: string }[] = [];
  const stmts = statements(src);
  /** MODEL PRIORS: normal priors (mean, variance) by label. */
  const priors = new Map<string, [number, number]>();
  const model: { level: string; text: string }[] = [];
  let level = 'within';
  const listCols = (t: string) =>
    t
      .replace(/\s*-\s*/g, '-')
      .split(/[\s,]+/)
      .filter(Boolean)
      .flatMap((x) => expandCols(x));
  const expandCols = (x: string): string[] => {
    const [a, b] = x.split('-');
    if (b === undefined) return [colOf(a) ?? a];
    const ia = columns.findIndex((c) => lc(c) === lc(a)),
      ib = columns.findIndex((c) => lc(c) === lc(b));
    if (ia >= 0 && ib >= ia) return columns.slice(ia, ib + 1);
    const ra = /^(.*?)(\d+)$/.exec(a),
      rb = /^(.*?)(\d+)$/.exec(b);
    if (!ra || !rb || lc(ra[1]) !== lc(rb[1])) return fail(`Cannot read the range “${x}”.`);
    return Array.from(
      { length: Number(rb[2]) - Number(ra[2]) + 1 },
      (_, i) => `${ra[1]}${Number(ra[2]) + i}`,
    ).map((n) => colOf(n) ?? n);
  };
  for (const s of stmts) {
    if (s.section === 'MODEL') {
      const h = /^%\s*(WITHIN|BETWEEN)(?:\s+(\S+))?\s*%$/i.exec(s.text);
      if (h) {
        // %BETWEEN% or, with several cluster variables, %BETWEEN id% names the level.
        if (lc(h[1]) === 'within') level = 'within';
        else if (h[2]) level = `between:${lc(h[2])}`;
        else level = 'between';
        continue;
      }
      if (/^%/.test(s.text)) fail(`Unknown model part “${s.text}”.`);
      model.push({ level, text: s.text });
      continue;
    }
    if (['TITLE', 'DATA', 'OUTPUT', 'SAVEDATA', 'PLOT', 'MONTECARLO'].includes(s.section)) continue;
    if (s.section === 'MODEL PRIORS') {
      // label ~ N(mean, variance), a range of labels by their numeric suffix (lam2-lam4)
      const g =
        /^([\w\s-]+?)\s*~\s*N\s*\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)$/i.exec(s.text) ??
        fail(`MODEL PRIORS: write label ~ N(mean, variance) (“${s.text}”).`);
      const v = num(g![3]);
      if (!(v > 0)) fail('MODEL PRIORS: the variance must be positive.');
      for (const t of g![1].trim().split(/\s+/)) {
        const r = /^([A-Za-z_]\w*?)(\d+)-([A-Za-z_]\w*?)(\d+)$/.exec(t);
        const labels =
          r && lc(r[1]) === lc(r[3])
            ? Array.from(
                { length: Number(r[4]) - Number(r[2]) + 1 },
                (_, i) => `${r[1]}${Number(r[2]) + i}`,
              )
            : [t];
        for (const l of labels) priors.set(lc(l), [num(g![2]), v]);
      }
      continue;
    }
    if (s.section === 'MODEL CONSTRAINT') fail(`${s.section} is not available on this card.`);
    const m = /^([A-Za-z]+)\s*(?:=|\s(?=[A-Za-z(]))\s*([\s\S]*)$/.exec(s.text);
    const key = m ? m[1].toUpperCase() : '';
    const val = m ? m[2].trim() : '';
    if (s.section === 'DEFINE' || key === 'CENTER') {
      const c = /^CENTER\s+([\s\S]+?)\s*\(\s*GROUPMEAN\s*([A-Za-z_]\w*)?\s*\)$/i.exec(s.text);
      if (c) {
        for (const x of listCols(c[1]))
          define.push({ name: x, expr: `center(${x}, ${c[2] ?? '@cluster'})` });
        continue;
      }
      const a = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(s.text);
      if (a) {
        define.push({ name: a[1], expr: a[2] });
        if (!colOf(a[1])) columns.push(a[1]);
        continue;
      }
      fail(`Cannot read the DEFINE statement “${s.text}”.`);
    }
    switch (key) {
      case 'NAMES':
      case 'USEVARIABLES':
      case 'USEV':
      case 'MISSING':
      case 'PROCESSORS':
      case 'ESTIMATOR':
      case 'FBITERATIONS':
      case 'CHAINS':
      case 'BSEED':
      case 'THIN':
      case 'POINT':
        break;
      case 'CATEGORICAL':
        for (const x of listCols(val)) categorical.add(x);
        break;
      case 'WITHIN': {
        // (cluster) before variables: their between part is on that cluster variable's level alone (cross-classified:
        // observations within subjects at each time, Mplus ex. 9.27)
        let cur: string | null = null;
        for (const tok of val
          .replace(/\(\s*/g, ' (')
          .replace(/\s*\)/g, ') ')
          .replace(/\s*-\s*/g, '-')
          .split(/\s+/)
          .filter(Boolean)) {
          const g = /^\((\w+)\)$/.exec(tok);
          if (g) {
            cur = lc(g[1]);
            continue;
          }
          for (const x of expandCols(tok)) {
            if (cur) withinOf.set(lc(x), cur);
            else withinOnly.add(x);
          }
        }
        break;
      }
      case 'BETWEEN': {
        let cur: string | null = null;
        for (const tok of val
          .replace(/\(\s*/g, ' (')
          .replace(/\s*\)/g, ') ')
          .split(/\s+/)
          .filter(Boolean)) {
          const g = /^\((\w+)\)$/.exec(tok);
          if (g) {
            cur = lc(g[1]);
            continue;
          }
          for (const x of expandCols(tok)) betweenVars.set(x, cur);
        }
        break;
      }
      case 'CLUSTER':
        clusters = val
          .split(/\s+/)
          .filter(Boolean)
          .map((x) => colOf(x) ?? fail(`The cluster variable ${x} is not a column of the data.`));
        break;
      case 'LAGGED':
        for (const g of val.matchAll(/([A-Za-z_][\w-]*)\s*\(\s*(\d+)\s*\)/g))
          for (const x of expandCols(g[1])) lagged.set(lc(x), Number(g[2]));
        break;
      case 'TINTERVAL': {
        const g = /^(\S+)\s*\(\s*([\d.]+)\s*\)$/.exec(val) ?? fail('TINTERVAL = time (step).');
        tinterval = { time: colOf(g![1]) ?? fail(`${g![1]} is not a column.`), step: num(g![2]) };
        break;
      }
      case 'TYPE':
        type = val.toUpperCase();
        break;
      case 'BITERATIONS':
      case 'BITER': {
        const g = /(\d+)/.exec(val);
        if (g) iterations = Number(g[1]);
        break;
      }
      default:
        fail(`The option ${key || s.text} is not available on this card.`);
    }
  }
  if (!model.length) fail('Write the model after MODEL:.');
  const multilevel = /TWOLEVEL|THREELEVEL|CROSSCLASSIFIED/.test(type);
  if (/MIXTURE/.test(type)) fail('TYPE = MIXTURE is not available on this card.');
  if (multilevel && !clusters.length) fail('A multilevel model needs CLUSTER =.');
  if (!multilevel && clusters.length)
    fail('CLUSTER needs TYPE = TWOLEVEL, THREELEVEL or CROSSCLASSIFIED.');
  if (clusters.length > 2) fail('At most two cluster variables.');
  const crossed = /CROSSCLASSIFIED/.test(type);
  if (clusters.length === 2 && !crossed && !/THREELEVEL/.test(type))
    fail('Two cluster variables need TYPE = THREELEVEL or CROSSCLASSIFIED.');
  if (/THREELEVEL/.test(type) && clusters.length !== 2)
    fail('TYPE = THREELEVEL needs two cluster variables (CLUSTER = level3 level2).');
  for (const d of define)
    if (d.expr.includes('@cluster'))
      d.expr = d.expr.replace(
        '@cluster',
        clusters[0] ?? fail('CENTER … (GROUPMEAN) needs CLUSTER.'),
      );
  for (const d of define) {
    // (checked here: the card computes the columns before the run)
    try {
      evaluate(
        parseFormula(d.expr),
        data.names.includes(d.name) || columns.includes(d.name) ? data : data,
      );
    } catch (e) {
      if (!define.some((o) => o !== d && d.expr.includes(o.name)))
        fail(`DEFINE ${d.name}: ${(e as Error).message}`);
    }
  }
  // Levels: Mplus lists the clusters CLUSTER = level3 level2 (three-level) or a b (crossed); the between parts are
  // named by their cluster variable. Means of random effects are estimated at the first-listed cluster's level.
  const levels = clusters.map((c, i) => ({
    column: c,
    nested: /THREELEVEL/.test(type) && i === 1,
  }));
  // order: the level of each cluster variable (index into levels)
  const levelIdx = (name: string | undefined) => {
    if (!multilevel) return -1;
    if (!name) {
      if (levels.length === 1) return 0;
      return fail('With two cluster variables, name the level: %BETWEEN cluster%.');
    }
    const i = levels.findIndex((l) => lc(l.column) === name);
    return i >= 0 ? i : fail(`%BETWEEN ${name}%: ${name} is not a cluster variable.`);
  };
  const meanLevel = 0;
  const blockName = (l: number) => {
    if (!multilevel) return '';
    if (l < 0) return 'Within Level';
    if (levels.length === 1) return 'Between Level';
    return `Between ${levels[l].column.toUpperCase()} Level`;
  };

  // ---- MODEL statements ----
  type Stmt = {
    level: number;
    kind: 'by' | 'on' | 'with' | 'mean' | 'var' | 'rlogv';
    lhs: El[];
    rhs: El[];
    random: string[];
  };
  const parsed: Stmt[] = [];
  const latentWithin = new Set<string>();
  const latentBetween = new Map<string, number>();
  const randomNames: string[] = [];
  const factorLag = new Map<string, number>();
  const declared: string[] = [];
  const addDeclared = (n: string) => {
    if (!declared.some((d) => lc(d) === lc(n))) declared.push(n);
  };
  // first pass: names of factors and random effects (for ranges like s1-s21 over declared names)
  for (const m of model) {
    const t = m.text;
    const r = /^([\s\S]+?)\|([\s\S]+)$/.exec(t);
    if (r) for (const x of r[1].trim().split(/\s+/)) addDeclared(x.replace(/[@*].*$/, ''));
    const by = /^([\s\S]*?\|)?\s*([\s\S]+?)\s+BY\s/i.exec(t);
    if (by) for (const x of by[2].trim().split(/\s+/)) addDeclared(x);
  }
  const expandNames = (x: string): string[] => {
    const [a, b] = x.split('-');
    if (b === undefined) return [colOf(a) ?? declared.find((d) => lc(d) === lc(a)) ?? a];
    const ia = declared.findIndex((d) => lc(d) === lc(a)),
      ib = declared.findIndex((d) => lc(d) === lc(b));
    // (on a between level a range runs over the between-level variables: within-level factors are left out)
    if (ia >= 0 && ib >= ia) return declared.slice(ia, ib + 1).filter((d) => !rangeSkip.has(lc(d)));
    return expandCols(x);
  };
  let rangeSkip = new Set<string>();
  /** Elements with modifiers, and labels in parentheses applying to the elements before them on the line. */
  const elements = (text: string): El[] => {
    const out: El[] = [];
    for (const line of text.split('\n')) {
      let pending: El[] = [];
      const parts = line.split(/(\([^)]*\))/);
      for (const part of parts) {
        const lab = /^\(([^)]*)\)$/.exec(part);
        if (lab) {
          const toks = lab[1].trim().split(/\s+/).filter(Boolean);
          const labels: string[] = [];
          for (const tk of toks) {
            const lg = /^&(\d+)$/.exec(tk);
            if (lg) {
              for (const e of pending) e.lagDecl = Number(lg[1]);
              continue;
            }
            const rg = /^([A-Za-z_]*?)(\d+)-\1?(\d+)$/.exec(tk);
            const rl = /^([A-Za-z_]\w*?)(\d+)-([A-Za-z_]\w*?)(\d+)$/.exec(tk);
            if (rg)
              for (let i = Number(rg[2]); i <= Number(rg[3]); i++) labels.push(`${rg[1]}${i}`);
            else if (rl && lc(rl[1]) === lc(rl[3]))
              for (let i = Number(rl[2]); i <= Number(rl[4]); i++) labels.push(`${rl[1]}${i}`);
            else labels.push(tk);
          }
          if (labels.length === 1) for (const e of pending) e.label = labels[0];
          else if (labels.length) {
            if (labels.length !== pending.length)
              fail(
                `The labels (${lab[1]}) do not match the ${pending.length} parameters before them.`,
              );
            pending.forEach((e, i) => {
              e.label = labels[i];
            });
          }
          pending = [];
          continue;
        }
        const toks = part
          .replace(/\s*-\s*(?=[A-Za-z_])/g, '-')
          .replace(/\s+([@*])/g, '$1')
          .replace(/([@*])\s+(?=[-\d.])/g, '$1')
          .split(/\s+/)
          .filter(Boolean);
        for (const tk of toks) {
          const g =
            /^([^@*]+)(?:([@*])(-?[\d.]*(?:[eE][-+]?\d+)?))?$/.exec(tk) ??
            fail(`Cannot read “${tk}”.`);
          const mod: Mod = {};
          if (g![2] === '@') mod.fixed = num(g![3]);
          else if (g![2] === '*') {
            mod.free = true;
            if (g![3]) mod.start = num(g![3]);
          }
          const names = g![1].includes('&') ? [g![1]] : expandNames(g![1]);
          const els = names.map((name, i) => ({
            name,
            mod: i === 0 || g![1].includes('-') ? mod : {},
          }));
          out.push(...els);
          pending.push(...els);
        }
      }
    }
    return out;
  };
  const withinFactors = new Set<string>();
  for (const m of model) {
    const by = m.level === 'within' ? /^([\s\S]*?\|)?\s*([\s\S]+?)\s+BY\s/i.exec(m.text) : null;
    if (by) for (const x of by[2].trim().split(/\s+/)) withinFactors.add(lc(x));
  }
  for (const m of model) {
    const l = m.level === 'within' ? -1 : levelIdx(m.level.split(':')[1]);
    rangeSkip = l < 0 ? new Set() : withinFactors;
    if (!multilevel && m.level !== 'within')
      fail('%BETWEEN% needs TYPE = TWOLEVEL, THREELEVEL or CROSSCLASSIFIED.');
    let t = m.text;
    let random: string[] = [];
    const r = /^([\s\S]+?)\|([\s\S]+)$/.exec(t);
    if (r) {
      random = r[1]
        .trim()
        .split(/\s+/)
        .flatMap((x) => expandNames(x));
      t = r[2].trim();
    }
    const mean = /^\[([\s\S]*)\]\s*(\([\s\S]*\))?$/.exec(t);
    if (mean) {
      parsed.push({
        level: l,
        kind: 'mean',
        lhs: elements(`${mean[1]} ${mean[2] ?? ''}`),
        rhs: [],
        random,
      });
      continue;
    }
    const op = /^([\s\S]+?)\s+(BY|ON|WITH)\s+([\s\S]+)$/i.exec(t);
    if (op) {
      const kind = lc(op[2]) as 'by' | 'on' | 'with';
      parsed.push({ level: l, kind, lhs: elements(op[1]), rhs: elements(op[3]), random });
      if (kind === 'by')
        for (const f of elements(op[1])) {
          if (l < 0) latentWithin.add(f.name);
          else latentBetween.set(f.name, l);
          const lg = elements(op[3]).find((e) => e.lagDecl);
          if (lg) factorLag.set(lc(f.name), lg.lagDecl!);
        }
      continue;
    }
    if (random.length) {
      parsed.push({ level: l, kind: 'rlogv', lhs: elements(t), rhs: [], random });
      continue;
    }
    parsed.push({ level: l, kind: 'var', lhs: elements(t), rhs: [], random });
  }
  for (const s of parsed)
    for (const r of s.random) {
      if (s.level >= 0 && s.kind !== 'by')
        fail('Random slopes and residual variances are declared on the within level.');
      if (!randomNames.includes(r)) randomNames.push(r);
    }

  // ---- parameters ----
  const params: DsemParam[] = [];
  const labelIdx = new Map<string, number>();
  const newParam = (type: 'real' | 'pos', label?: string): DsemCoef => {
    if (label) {
      const k = lc(label);
      if (labelIdx.has(k)) return { p: labelIdx.get(k)! };
      params.push({ type });
      labelIdx.set(k, params.length - 1);
      return { p: params.length - 1 };
    }
    params.push({ type });
    return { p: params.length - 1 };
  };
  const startAt = (c: DsemCoef, v: number) => {
    if ('p' in c && c.i === undefined) {
      const q = params[c.p];
      if (q.type !== 'block' && q.start === undefined) q.start = v;
    }
    return c;
  };
  /** All random loadings (their means start at 1). */
  const loadingRe = new Set<number>();
  // A coefficient fixed in the input, fixed by default (unless freed with *), or a new parameter.
  const coefOf = (e: El, type: 'real' | 'pos', defaultFixed?: number): DsemCoef => {
    if (e.mod.fixed !== undefined) return { v: e.mod.fixed };
    if (!e.mod.free && defaultFixed !== undefined) return { v: defaultFixed };
    return newParam(type, e.label);
  };

  // ---- within level: nodes ----
  const nodes: DsemNode[] = [];
  const nodeIdx = new Map<string, number>();
  const re: { name: string; comps: ({ on: true } | null)[]; kind: 'int' | 'slope' | 'logv' }[] = [];
  const reIdx = new Map<string, number>();
  const L = levels.length;
  const isLatentW = (n: string) => [...latentWithin].some((f) => lc(f) === lc(n));
  const isWithinOnly = (n: string) => [...withinOnly].some((b) => lc(b) === lc(n));
  const isCat = (n: string) => [...categorical].some((b) => lc(b) === lc(n));
  const node = (name: string, kind?: DsemNode['kind']): number => {
    const k = lc(name);
    if (nodeIdx.has(k)) return nodeIdx.get(k)!;
    const isF = isLatentW(name);
    const col = isF ? undefined : colOf(name);
    if (!isF && !col) fail(`${name} is not a column of the data or a factor of the within level.`);
    // Unless given: a factor (f), a categorical (u) or a continuous (y) observed variable.
    let defaultKind: DsemNode['kind'] = 'y';
    if (isF) defaultKind = 'f';
    else if (isCat(name)) defaultKind = 'u';
    nodes.push({
      kind: kind ?? defaultKind,
      ...(col ? { column: col } : {}),
    });
    nodeIdx.set(k, nodes.length - 1);
    return nodes.length - 1;
  };
  const parseLag = (name: string) => {
    const g = /^(.+)&(\d+)$/.exec(name);
    return g ? { name: g[1], lag: Number(g[2]) } : { name, lag: 0 };
  };
  const newRe = (name: string, kind: 'int' | 'slope' | 'logv') => {
    const k = lc(name);
    if (reIdx.has(k)) return reIdx.get(k)!;
    re.push({ name, kind, comps: Array.from({ length: L }, () => ({ on: true as const })) });
    reIdx.set(k, re.length - 1);
    return re.length - 1;
  };
  // random effects declared by | (named as written)
  const wterms: DsemSpec['wterms'] = [];
  /** Random effects that are a factor's first random loading: their mean is positive (one of the two mirror-image modes). */
  const firstLoading = new Set<number>();
  const reportW: { lhs: string; op: string; rhs: string; c: DsemCoef; order: number }[] = [];
  const ON_ORDER = 1,
    BY_ORDER = 0;
  const lagOK = (name: string, lag: number) => {
    if (!lag) return;
    const max = isLatentW(name) ? factorLag.get(lc(name)) : lagged.get(lc(name));
    if (!max || lag > max)
      fail(
        `${name}&${lag}: declare the lag (LAGGED = ${name}(${lag}) for a variable, (&${lag}) after the factor's BY list).`,
      );
  };
  const predictorsAt0 = new Set<number>();
  const endogenous = new Set<number>();
  const indicators = new Set<number>();
  // within statements
  const withinStmts = parsed.filter((s) => s.level < 0);
  for (const s of withinStmts) {
    if (s.kind === 'by') {
      for (const f of s.lhs) {
        const fi = node(f.name, 'f');
        if (s.random.length && s.random.length !== s.rhs.length)
          fail(`${s.random.join(' ')} | ${f.name} BY …: one random loading per indicator.`);
        s.rhs.forEach((e, i) => {
          const yi = node(e.name);
          indicators.add(yi);
          let c: DsemCoef;
          if (s.random.length) {
            c = { r: newRe(s.random[i], 'slope') };
            loadingRe.add(c.r);
            if (i === 0) firstLoading.add(c.r);
          }
          // (a factor scaled by its variance: the first loading positive, choosing one of the two mirror-image modes, as Mplus's chains do)
          else
            c = startAt(
              coefOf(e, i === 0 ? 'pos' : 'real', i === 0 && !e.mod.free ? 1 : undefined),
              e.mod.start ?? 1,
            );
          wterms.push({ t: yi, p: fi, lag: 0, load: true, c });
          if (!s.random.length)
            reportW.push({ lhs: f.name, op: '=~', rhs: e.name, c, order: BY_ORDER });
        });
      }
    } else if (s.kind === 'on') {
      for (const y of s.lhs) {
        const yi = node(y.name);
        endogenous.add(yi);
        if (s.random.length && (s.random.length !== 1 || s.rhs.length !== 1))
          fail('A random slope: s | y ON x, one slope for one predictor.');
        for (const e of s.rhs) {
          const { name, lag } = parseLag(e.name);
          lagOK(name, lag);
          const known =
            nodeIdx.has(lc(name)) ||
            isLatentW(name) ||
            parsed.some(
              (o) =>
                o.level < 0 &&
                o.kind !== 'mean' &&
                o.lhs.some((x) => lc(x.name) === lc(name)) &&
                o.kind !== 'with',
            );
          const pi = known || lag ? node(name) : node(name, 'x');
          if (!lag) predictorsAt0.add(pi);
          if (
            nodes[pi].kind === 'y' &&
            isWithinOnly(name) &&
            !endogenous.has(pi) &&
            !parsed.some(
              (o) => o.level < 0 && o.kind === 'on' && o.lhs.some((x) => lc(x.name) === lc(name)),
            )
          )
            nodes[pi].kind = 'x';
          const c: DsemCoef = s.random.length
            ? { r: newRe(s.random[0], 'slope') }
            : coefOf(e, 'real');
          wterms.push({ t: yi, p: pi, lag, c });
          if (!s.random.length)
            reportW.push({ lhs: y.name, op: '~', rhs: e.name, c, order: ON_ORDER });
        }
      }
    }
  }
  // exogenous observed predictors declared WITHIN (or not otherwise modelled) are covariates
  for (const [k, i] of nodeIdx) {
    const n = nodes[i];
    if (
      n.kind === 'y' &&
      !endogenous.has(i) &&
      !indicators.has(i) &&
      !parsed.some(
        (o) =>
          o.level < 0 &&
          (o.kind === 'var' || o.kind === 'rlogv' || o.kind === 'mean') &&
          o.lhs.some((x) => lc(x.name) === k),
      ) &&
      wterms.some((t) => t.p === i && t.lag === 0)
    ) {
      if (!isWithinOnly(n.column!) && multilevel)
        notes.push(
          `${n.column} is used as a within-level covariate (as observed, not split into within and between parts).`,
        );
      n.kind = 'x';
    }
  }
  // random residual variances: logv | y
  const logvOf = new Map<number, number>();
  for (const s of withinStmts.filter((x) => x.kind === 'rlogv')) {
    if (s.lhs.length !== 1 || s.random.length !== 1)
      fail('A random residual variance: logv | y, one for one variable.');
    const i = node(s.lhs[0].name);
    logvOf.set(i, newRe(s.random[0], 'logv'));
  }
  // random loadings on a between-level factor (s | f BY u on a between level): the indicator is a within-level outcome,
  // the loading a random effect that varies over the other cluster variable (cross-classified IRT, 9.26)
  for (const s of parsed)
    if (s.level >= 0 && s.kind === 'by' && s.random.length) {
      if (s.random.length !== s.rhs.length)
        fail('A random loading for each indicator: s1-s4 | f BY y1-y4.');
      s.rhs.forEach((e, i) => {
        node(e.name);
        const r = newRe(s.random[i], 'slope');
        loadingRe.add(r);
        if (i === 0) firstLoading.add(r);
      });
    }
  // between parts: every within outcome not declared WITHIN (two-level and up); a within factor when mentioned on a between level
  const betweenMentioned = (name: string) =>
    parsed.some((s) => s.level >= 0 && [...s.lhs, ...s.rhs].some((e) => lc(e.name) === lc(name)));
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!multilevel || n.kind === 'x') continue;
    const name = n.kind === 'f' ? [...nodeIdx].find(([, v]) => v === i)![0] : n.column!;
    if (n.kind === 'f' ? betweenMentioned(name) : !isWithinOnly(name)) {
      n.part = newRe(
        n.kind === 'f' ? [...latentWithin].find((f) => lc(f) === name)! : n.column!,
        'int',
      );
      const w = withinOf.get(lc(name));
      if (w !== undefined) {
        const lw = levels.findIndex((lv) => lc(lv.column) === w);
        if (lw < 0 || L !== 2) fail(`WITHIN = (${w}) …: ${w} is not one of two cluster variables.`);
        re[n.part].comps[1 - lw] = null;
      }
    }
  }
  const nodeName = (i: number) =>
    nodes[i].column ??
    [...latentWithin].find((f) => lc(f) === [...nodeIdx].find(([, v]) => v === i)![0])!;
  // within means, variances, thresholds
  const wMention = (kind: Stmt['kind'], name: string) => {
    let el: El | undefined;
    for (const s of withinStmts)
      if (s.kind === kind)
        for (const e of s.lhs)
          if (lc(e.name) === lc(name) || lc(e.name.replace(/\$\d+$/, '')) === lc(name)) el = e;
    return el;
  };
  const reportV: typeof reportW = [];
  const wblocks: DsemSpec['wblocks'] = [];
  // residual covariances (WITH, and Mplus's defaults: among final dependent observed variables, and among latent
  // dependent variables, with plain residual variances)
  const withPairs: [number, number, El | undefined][] = [];
  for (const s of withinStmts.filter((x) => x.kind === 'with'))
    for (const a of s.lhs)
      for (const b of s.rhs)
        if (lc(a.name) !== lc(b.name)) {
          const ia = node(a.name),
            ib = node(b.name);
          if (!withPairs.some(([x, y]) => (x === ia && y === ib) || (x === ib && y === ia)))
            withPairs.push([ia, ib, b]);
        }
  const plainVar = (i: number) =>
    !logvOf.has(i) &&
    nodes[i].kind !== 'u' &&
    wMention('var', nodeName(i))?.mod.fixed === undefined;
  const finalDep = [...endogenous].filter(
    (i) => !predictorsAt0.has(i) && !indicators.has(i) && plainVar(i),
  );
  const finalObs = finalDep.filter((i) => nodes[i].kind === 'y'),
    finalLat = finalDep.filter((i) => nodes[i].kind === 'f');
  for (const grp of [finalObs, finalLat])
    for (let a = 0; a < grp.length; a++)
      for (let b = a + 1; b < grp.length; b++)
        if (
          !withPairs.some(
            ([x, y]) => (x === grp[a] && y === grp[b]) || (x === grp[b] && y === grp[a]),
          )
        )
          withPairs.push([grp[b], grp[a], undefined]);
  // blocks: connected components of the pairs, each complete
  const comp = new Map<number, number[]>();
  for (const [a, b] of withPairs) {
    const ca = [...comp.values()].find((m) => m.includes(a)),
      cb = [...comp.values()].find((m) => m.includes(b));
    if (ca && cb && ca !== cb) {
      ca.push(...cb);
      for (const [k, v] of comp) if (v === cb) comp.delete(k);
    } else if (ca && !cb) ca.push(b);
    else if (cb && !ca) cb.push(a);
    else if (!ca && !cb) comp.set(comp.size + 100 * withPairs.length, [a, b]);
  }
  const inBlock = new Map<number, { b: number; i: number }>();
  for (const members of comp.values()) {
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++)
        if (
          !withPairs.some(
            ([x, y]) =>
              (x === members[a] && y === members[b]) || (x === members[b] && y === members[a]),
          )
        )
          fail(
            `Residual covariances among ${members.map(nodeName).join(', ')}: every pair must covary (WITH) on this card.`,
          );
    if (members.some((m) => !plainVar(m)))
      fail(
        `Residual covariances need free residual variances (${members.map(nodeName).join(', ')}).`,
      );
    params.push({ type: 'block', fixed: members.map(() => null) });
    const p = params.length - 1;
    wblocks.push({ members, c: { p } });
    members.forEach((m, i) => inBlock.set(m, { b: p, i }));
    for (const [a, b] of withPairs)
      if (members.includes(a)) {
        const ia = members.indexOf(a),
          ib = members.indexOf(b);
        reportV.push({
          lhs: nodeName(a),
          op: '~~',
          rhs: nodeName(b),
          c: { p, i: Math.max(ia, ib), j: Math.min(ia, ib) },
          order: 2,
        });
      }
  }
  const reportM: typeof reportW = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const name = nodeName(i);
    if (n.kind === 'x') continue;
    // intercepts and thresholds (single level; with a between part the mean is on the between level)
    if (n.kind === 'y' && n.part === undefined) {
      const e = wMention('mean', name);
      n.int = e ? coefOf(e, 'real') : newParam('real');
      reportM.push({ lhs: name, op: '~1', rhs: '', c: n.int, order: 3 });
    }
    if (n.kind === 'u') {
      const e = wMention('mean', `${name}$1`);
      if (n.part === undefined) {
        n.thr = e ? coefOf(e, 'real') : newParam('real');
        reportM.push({ lhs: name, op: '|', rhs: 't1', c: n.thr, order: 4 });
      }
    }
    if (n.kind === 'f' && wMention('mean', name)?.mod.fixed === undefined && wMention('mean', name))
      fail(`Within-level factor means are fixed at 0 (${name}).`);
    // residual variances
    if (logvOf.has(i)) n.resid = { r: logvOf.get(i)! };
    else if (inBlock.has(i)) {
      const { b, i: k } = inBlock.get(i)!;
      reportV.push({ lhs: name, op: '~~', rhs: name, c: { p: b, i: k, j: k }, order: 5 });
    } else if (n.kind === 'u') n.resid = { v: 1 };
    else {
      const e = wMention('var', name);
      n.resid = e ? coefOf(e, 'pos') : newParam('pos');
      reportV.push({ lhs: name, op: '~~', rhs: name, c: n.resid, order: 5 });
    }
  }
  if (inBlock.size)
    for (const b of wblocks)
      for (const m of b.members) {
        const k = inBlock.get(m)!.i;
        nodes[m].resid = undefined;
        void k;
      }

  // ---- between levels ----
  const btargets: DsemSpec['btargets'] = [];
  const bterms: DsemSpec['bterms'] = [];
  const bblocks: DsemSpec['bblocks'] = [];
  const reportB: {
    level: number;
    lhs: string;
    op: string;
    rhs: string;
    c: DsemCoef;
    order: number;
  }[] = [];
  const btIdx = new Map<string, number>(); // `${level}:${name}`
  const betweenStmts = parsed.filter((s) => s.level >= 0);
  const reByName = (n: string) => reIdx.get(lc(n));
  const bfName = (n: string, l: number) =>
    [...latentBetween].find(([f, lv]) => lc(f) === lc(n) && lv === l)?.[0];
  // which random effects have a component at each level: all, unless fixed at 0 there (variance @0 and mean @0 or not free)
  for (let l = 0; l < L; l++)
    for (let r = 0; r < re.length; r++) {
      const name = re[r].name;
      const v = betweenStmts
        .filter((s) => s.level === l && s.kind === 'var')
        .flatMap((s) => s.lhs)
        .find((e) => lc(e.name) === lc(name));
      if (v?.mod.fixed === 0) {
        re[r].comps[l] = null;
        reportB.push({ level: l, lhs: name, op: '~~', rhs: name, c: { v: 0 }, order: 5 });
      }
      // cross-classified: a random slope or log variance varies on the levels that mention it (none: the first-listed)
      const mentioned = (lv: number) =>
        betweenStmts.some(
          (s) =>
            s.level === lv &&
            [...s.lhs, ...s.rhs].some((e) => lc(e.name.replace(/&\d+$/, '')) === lc(name)),
        );
      if (
        L === 2 &&
        (re[r].kind !== 'int' || nodes.some((n) => n.part === r && n.kind === 'f')) &&
        !mentioned(l) &&
        (mentioned(1 - l) || l !== 0)
      )
        re[r].comps[l] = null;
    }
  for (let r = 0; r < re.length; r++)
    if (multilevel && re[r].comps.every((c) => !c)) {
      // no variance at any level: a fixed effect (the mean only, at the first level)
      re[r].comps[meanLevel] = { on: true };
    }
  const target = (name: string, l: number): number => {
    const key = `${l}:${lc(name)}`;
    if (btIdx.has(key)) return btIdx.get(key)!;
    const f = bfName(name, l);
    const r = reByName(name);
    if (f) btargets.push({ kind: 'bf', level: l });
    else if (r !== undefined && re[r].comps[l]) btargets.push({ kind: 're', level: l, re: r });
    else if (r !== undefined)
      return fail(`${name} has no variance on the ${levels[l].column} level (fixed at 0).`);
    else {
      const col = colOf(name);
      if (!col)
        fail(`${name} is not a random effect, factor or column on the ${levels[l].column} level.`);
      btargets.push({ kind: 'z', level: l, column: col });
    }
    btIdx.set(key, btargets.length - 1);
    return btargets.length - 1;
  };
  const bname = new Map<number, string>();
  const tname = (name: string, l: number) => {
    const i = target(name, l);
    bname.set(
      i,
      bfName(name, l) ?? (reByName(name) !== undefined ? re[reByName(name)!].name : colOf(name)!),
    );
    return i;
  };
  for (let l = 0; l < L; l++)
    for (let r = 0; r < re.length; r++) if (re[r].comps[l]) tname(re[r].name, l);
  const covariate = (name: string, l: number) => {
    const col = colOf(name);
    return (
      !!col &&
      !reByName(name) &&
      !bfName(name, l) &&
      !betweenStmts.some(
        (s) => s.level === l && s.kind === 'on' && s.lhs.some((e) => lc(e.name) === lc(name)),
      )
    );
  };
  const bPairs: [number, number][] = [];
  for (const s of betweenStmts) {
    const l = s.level;
    if (s.kind === 'by') {
      if (s.random.length) {
        for (const f of s.lhs) {
          const fi = tname(f.name, l);
          if (btargets[fi].kind !== 'bf')
            fail(`${f.name}: random loadings need a between-level factor.`);
          s.rhs.forEach((e, i) => {
            const yi = node(e.name);
            indicators.add(yi);
            wterms.push({ t: yi, p: -1, pb: fi, lag: 0, c: { r: reIdx.get(lc(s.random[i]))! } });
          });
        }
        continue;
      }
      for (const f of s.lhs) {
        const fi = tname(f.name, l);
        s.rhs.forEach((e, i) => {
          const ri =
            reByName(e.name) ??
            fail(
              `${e.name}: a between-level factor's indicators are the between parts of within-level variables or random effects.`,
            );
          const yi = tname(re[ri!].name, l);
          const c = startAt(
            coefOf(e, i === 0 ? 'pos' : 'real', i === 0 && !e.mod.free ? 1 : undefined),
            e.mod.start ?? 1,
          );
          bterms.push({ t: yi, b: fi, c });
          reportB.push({ level: l, lhs: f.name, op: '=~', rhs: re[ri!].name, c, order: 0 });
        });
      }
    } else if (s.kind === 'on') {
      for (const y of s.lhs) {
        const yi = tname(y.name, l);
        for (const e of s.rhs) {
          const c = coefOf(e, 'real');
          if (covariate(e.name, l)) bterms.push({ t: yi, x: colOf(e.name)!, c });
          else bterms.push({ t: yi, b: tname(e.name, l), c });
          reportB.push({
            level: l,
            lhs: bname.get(yi)!,
            op: '~',
            rhs: colOf(e.name) ?? e.name,
            c,
            order: 1,
          });
        }
      }
    } else if (s.kind === 'with') {
      for (const a of s.lhs)
        for (const b of s.rhs)
          if (lc(a.name) !== lc(b.name)) {
            const ia = tname(a.name, l),
              ib = tname(b.name, l);
            if (!bPairs.some(([x, y]) => (x === ia && y === ib) || (x === ib && y === ia)))
              bPairs.push([ia, ib]);
          }
    }
  }
  const bMention = (kind: Stmt['kind'], name: string, l: number) => {
    let el: El | undefined;
    for (const s of betweenStmts)
      if (s.level === l && s.kind === kind)
        for (const e of s.lhs)
          if (lc(e.name) === lc(name) || lc(e.name.replace(/\$\d+$/, '')) === lc(name)) el = e;
    return el;
  };
  for (const s of betweenStmts)
    if (s.kind === 'var' || s.kind === 'mean')
      for (const e of s.lhs) {
        const nm = e.name.replace(/\$\d+$/, '');
        if (
          !btIdx.has(`${s.level}:${lc(nm)}`) &&
          !(e.mod.fixed === 0 && reByName(nm) !== undefined)
        )
          tname(nm, s.level);
      }
  // means: random effects' at the first-listed level (thresholds of binary outcomes there too); factors 0; outcomes free
  for (let i = 0; i < btargets.length; i++) {
    const t = btargets[i];
    const name = bname.get(i)!;
    if (t.kind === 'bf') {
      const e = bMention('mean', name, t.level);
      t.mean = e ? coefOf(e, 'real', 0) : { v: 0 };
      if (e && !('v' in t.mean))
        reportB.push({ level: t.level, lhs: name, op: '~1', rhs: '', c: t.mean, order: 3 });
      continue;
    }
    if (t.kind === 'z') {
      const e = bMention('mean', name, t.level);
      t.mean = e ? coefOf(e, 'real') : newParam('real');
      reportB.push({ level: t.level, lhs: name, op: '~1', rhs: '', c: t.mean, order: 3 });
      continue;
    }
    const r = re[t.re!];
    // the mean: on the level whose [ ] frees it, else the first-listed level with a component
    const freeAt = re[t.re!].comps.findIndex(
      (c, lv) =>
        !!c &&
        betweenStmts.some(
          (s) =>
            s.level === lv &&
            s.kind === 'mean' &&
            s.lhs.some((e) => lc(e.name) === lc(name) && e.mod.fixed === undefined),
        ),
    );
    const first = freeAt >= 0 ? freeAt : re[t.re!].comps.findIndex((c) => !!c);
    const nodeOfRe = nodes.findIndex((n) => n.part === t.re);
    if (nodeOfRe >= 0 && nodes[nodeOfRe].kind === 'u') {
      t.mean = { v: 0 };
      if (t.level === first) {
        const e = bMention('mean', `${name}$1`, t.level);
        nodes[nodeOfRe].thr = e ? coefOf(e, 'real') : newParam('real');
        reportB.push({
          level: t.level,
          lhs: name,
          op: '|',
          rhs: 't1',
          c: nodes[nodeOfRe].thr!,
          order: 4,
        });
      }
      continue;
    }
    if (nodeOfRe >= 0 && nodes[nodeOfRe].kind === 'f') {
      // a within factor's between part: mean 0 unless [f] frees it
      const ef = bMention('mean', name, t.level);
      if (ef && ef.mod.fixed === undefined) {
        t.mean = coefOf(ef, 'real');
        reportB.push({ level: t.level, lhs: name, op: '~1', rhs: '', c: t.mean, order: 3 });
      } else t.mean = { v: 0 };
      continue;
    }
    const e = bMention('mean', name, t.level);
    if (e?.mod.fixed !== undefined) {
      t.mean = { v: e.mod.fixed };
      continue;
    }
    if (t.level !== first && !e) {
      t.mean = { v: 0 };
      continue;
    }
    const type = firstLoading.has(t.re!) ? 'pos' : 'real';
    t.mean = e ? coefOf(e, type) : newParam(type);
    if (loadingRe.has(t.re!)) startAt(t.mean, e?.mod.start ?? 1);
    reportB.push({ level: t.level, lhs: name, op: '~1', rhs: '', c: t.mean, order: 3 });
    void r;
  }
  // residual variances and covariances on the between levels: blocks of complete WITH sets
  const bcomp: number[][] = [];
  for (const [a, b] of bPairs) {
    const ca = bcomp.find((m) => m.includes(a)),
      cb = bcomp.find((m) => m.includes(b));
    if (ca && cb && ca !== cb) {
      ca.push(...cb);
      bcomp.splice(bcomp.indexOf(cb), 1);
    } else if (ca && !cb) ca.push(b);
    else if (cb && !ca) cb.push(a);
    else if (!ca && !cb) bcomp.push([a, b]);
  }
  const done = new Set<number>();
  for (const members of bcomp) {
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++)
        if (
          !bPairs.some(
            ([x, y]) =>
              (x === members[a] && y === members[b]) || (x === members[b] && y === members[a]),
          )
        )
          fail(
            `Between-level covariances among ${members.map((m) => bname.get(m)).join(', ')}: every pair must covary (WITH) on this card.`,
          );
    const fixed = members.map((m) => {
      const e = bMention('var', bname.get(m)!, btargets[m].level);
      return e?.mod.fixed ?? null;
    });
    if (fixed.some((v) => v === 0)) fail('A variable with a variance fixed at 0 cannot covary.');
    if (members.some((m) => btargets[m].kind === 'z'))
      fail('Between-level outcomes cannot have residual covariances on this card.');
    params.push({ type: 'block', fixed });
    const p = params.length - 1;
    bblocks.push({ members, c: { p } });
    const l = btargets[members[0]].level;
    for (const [a, b] of bPairs)
      if (members.includes(a)) {
        const ia = members.indexOf(a),
          ib = members.indexOf(b);
        reportB.push({
          level: l,
          lhs: bname.get(a)!,
          op: '~~',
          rhs: bname.get(b)!,
          c: { p, i: Math.max(ia, ib), j: Math.min(ia, ib) },
          order: 2,
        });
      }
    members.forEach((m, i) => {
      done.add(m);
      reportB.push({
        level: l,
        lhs: bname.get(m)!,
        op: '~~',
        rhs: bname.get(m)!,
        c: fixed[i] !== null ? { v: fixed[i]! } : { p, i, j: i },
        order: 5,
      });
    });
  }
  for (let i = 0; i < btargets.length; i++) {
    if (done.has(i)) continue;
    const t = btargets[i];
    const name = bname.get(i)!;
    const e = bMention('var', name, t.level);
    const c = e ? coefOf(e, 'pos') : newParam('pos');
    if ('v' in c && c.v === 0) continue;
    bblocks.push({ members: [i], c });
    reportB.push({ level: t.level, lhs: name, op: '~~', rhs: name, c, order: 5 });
  }

  // Mplus's priors for categorical outcomes: N(0, 5) for their loadings, slopes and thresholds
  const catPrior = (c: DsemCoef | undefined) => {
    if (c && 'p' in c && c.i === undefined) {
      const q = params[c.p];
      if (q.type !== 'block') q.prior = [0, 5];
    }
  };
  for (const t of wterms) if (nodes[t.t].kind === 'u') catPrior(t.c);
  for (const n of nodes) if (n.kind === 'u') catPrior(n.thr);
  for (const [l, pr] of priors) {
    const i = labelIdx.get(l);
    if (i === undefined) fail(`MODEL PRIORS: ${l} is not the label of a free parameter.`);
    const q = params[i!];
    if (q.type !== 'block') q.prior = pr;
  }
  // ---- report (Mplus's order: loadings, regressions, covariances, means/intercepts, thresholds, variances) ----
  const report: DsemSpec['report'] = [];
  const wb = blockName(-1);
  for (const x of [...reportW, ...reportV, ...reportM].sort((a, b) => a.order - b.order))
    report.push({ lhs: x.lhs, op: x.op, rhs: x.rhs, block: wb, c: x.c });
  for (let l = L - 1; l >= 0; l--)
    for (const x of reportB.filter((y) => y.level === l).sort((a, b) => a.order - b.order))
      report.push({ lhs: x.lhs, op: x.op, rhs: x.rhs, block: blockName(l), c: x.c });
  // series: lags within the first-listed cluster that is not the time classification, ordered by TINTERVAL's time
  const hasLag = wterms.some((t) => t.lag > 0);
  let seriesLevel: number | undefined;
  if (hasLag && L) {
    const candidates = levels
      .map((_lv, i) => i)
      .filter((i) => !tinterval || lc(levels[i].column) !== lc(tinterval.time));
    const subj = candidates.find((i) => !/time/i.test(levels[i].column)) ?? candidates[0];
    seriesLevel = subj;
  }
  const spec: DsemSpec = {
    levels,
    series: {
      ...(seriesLevel !== undefined ? { level: seriesLevel + 1 } : {}),
      ...(tinterval ? { time: tinterval.time, interval: tinterval.step } : {}),
    },
    params,
    re: re.map((r) => ({ comps: r.comps })),
    nodes,
    wterms,
    wblocks,
    btargets,
    bterms,
    bblocks,
    report,
  };
  return { spec, define, iterations, notes };
}

/** The data with DEFINE's columns computed (new columns appended, centred ones replaced). */
export function dsemData(data: Dataset, define: DsemParse['define']): Dataset {
  let d = data;
  for (const x of define) {
    const v = evaluate(parseFormula(x.expr), d);
    const i = d.names.findIndex((n) => lc(n) === lc(x.name));
    d =
      i >= 0
        ? { ...d, cols: d.cols.map((c, k) => (k === i ? v : c)) }
        : { ...d, names: [...d.names, x.name], cols: [...d.cols, v] };
  }
  return d;
}

const KEYWORDS = new Set([
  'by',
  'on',
  'with',
  'within',
  'between',
  'cluster',
  'categorical',
  'lagged',
  'tinterval',
  'type',
  'twolevel',
  'threelevel',
  'crossclassified',
  'random',
  'estimator',
  'bayes',
  'biterations',
  'biter',
  'fbiterations',
  'processors',
  'names',
  'usevariables',
  'usev',
  'missing',
  'are',
  'is',
  'center',
  'groupmean',
  'model',
  'define',
  'variable',
  'analysis',
  'chains',
  'bseed',
  'thin',
  'point',
  'median',
  'mean',
  'mode',
]);
/**
 * The observed data columns a syntax names (for listing an example's columns): ranges by their numeric suffix; factors
 * and random effects (declared before BY or |), DEFINE's new variables, labels and keywords left out. Mplus reads
 * names without regard to case: a name is listed once, in the data's spelling when `names` is given, else as first
 * written (the VARIABLE section comes first).
 */
export function dsemColumns(syntax: string, names?: string[]): string[] {
  const text = syntax.replace(/!.*$/gm, ' ');
  const lcs = (s: string) => s.toLowerCase();
  const range = (tok: string): string[] => {
    const parts = tok.split('-');
    if (parts.length !== 2) return [tok];
    const a = /^(.*?)(\d+)$/.exec(parts[0]),
      b = /^(.*?)(\d+)$/.exec(parts[1]);
    if (a && b && lcs(a[1]) === lcs(b[1]) && Number(b[2]) >= Number(a[2]))
      return Array.from(
        { length: Number(b[2]) - Number(a[2]) + 1 },
        (_, i) => `${a[1]}${Number(a[2]) + i}`,
      );
    return [];
  };
  const declared = new Set<string>();
  // (a lookahead: the | that ends "s1-s4 |" is the lead of "| f BY")
  for (const m of text.matchAll(/(?:^|;|%|\|)\s*([A-Za-z_][\w\s-]*?)\s*(?=\||\bBY\b)/gim))
    for (const x of m[1]
      .trim()
      .replace(/\s*-\s*/g, '-')
      .split(/\s+/))
      for (const n of range(x)) declared.add(lcs(n));
  const made = new Set(
    [...text.matchAll(/(?:^|;|:)\s*([A-Za-z_]\w*)\s*=(?!=)/gm)]
      .map((m) => lcs(m[1]))
      .filter((x) => !KEYWORDS.has(x)),
  );
  const body = text
    .replace(/\b(TITLE|DATA)\s*:[^;]*;/gi, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/%[^%]*%/g, ' ')
    .replace(/&\d+/g, ' ')
    .replace(/[@*]-?[\d.]*/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\s*-\s*(?=[A-Za-z_])/g, '-');
  const out = new Map<string, string>();
  for (const tok of body.match(/[A-Za-z_]\w*(?:-[A-Za-z_]\w*)?/g) ?? []) {
    const parts = tok.split('-');
    if (parts.some((x) => KEYWORDS.has(lcs(x)) || declared.has(lcs(x)) || made.has(lcs(x))))
      continue;
    for (const n of range(tok)) {
      const k = lcs(n);
      if (!out.has(k)) out.set(k, names?.find((c) => lcs(c) === k) ?? n);
    }
  }
  return [...out.values()];
}
