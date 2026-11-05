// The mixture model card's model language: a subset of Mplus's input for TYPE = MIXTURE (VARIABLE and ANALYSIS
// options, MODEL with %OVERALL% and class-specific parts, MODEL c:, MODEL CONSTRAINT), with Mplus's defaults, turned
// into the specification the R engine fits (rengine/R/mixture.R): the free parameters, every model quantity as a
// linear combination of them, the classes' model and the blocks of observed variables, and the rows to report.

import type { Dataset } from '../engine/types';

/** A linear combination of the free parameters (`t`: pairs index, coefficient, flattened); c null = −∞ (a log-weight of 0). */
export interface Slot { c: number | null; t: number[] }
/** prob: the slots of categories 1…k−1 are probabilities (PROBABILITY parameterization), the last one's 1 minus their sum. */
export interface MixtureClassSpec { name: string; k: number; parents: number[]; covariates: string[]; known?: { column: string; values: number[] }; slots: number[]; prob?: boolean }
export type MixtureBlockType = 'cat' | 'nominal' | 'normal' | 'censored' | 'count' | 'zip' | 'mvn';
export interface MixtureBlockSpec { type: MixtureBlockType; y: string[]; x: string[]; by: number[]; slots: number[]; levels?: number[]; side?: 'below' | 'above'; factors?: number }
/** A printed parameter: `at` the class of each latent class variable it belongs to (0: all), the value a slot or a class probability. */
export interface MixtureReportRow { lhs: string; op: string; rhs: string; at: number[]; slot?: number; prob?: [number, number, number]; fixed: boolean }
export interface MixtureSpec {
  columns: string[]; weight?: string; missing?: { column: string; values: number[] }[];
  /** group: the free probabilities of one row (optimized as logits). */
  theta: { name: string; start: number; scale: number; group?: number }[];
  slots: Slot[]; classes: MixtureClassSpec[]; loglinear: boolean; blocks: MixtureBlockSpec[]; report: MixtureReportRow[];
  starts: number; final: number; seed: number; given?: number[]; order?: number[][];
}
export interface MixtureParse { spec: MixtureSpec; classes: { name: string; k: number; known: boolean }[]; parameterization: Param13n; notes: string[] }
export type Param13n = 'logit' | 'loglinear' | 'probability';

export class MixtureSyntaxError extends Error {}
const fail = (m: string): never => { throw new MixtureSyntaxError(m); };

// ---------------------------------------------------------------------------------------------------------------
// Statements

type Cond = Record<string, number>;
interface Mod { fixed?: number; start?: number }
interface Item { key: string; cond: Cond; mod: Mod; label?: string; order: number; mentioned: true }
interface Growth { factors: string[]; outcomes: string[]; times: number[]; inflation: boolean }

const num = (s: string) => { const v = Number(s); if (s === '' || !Number.isFinite(v)) fail(`“${s}” is not a number.`); return v; };
const lc = (s: string) => s.toLowerCase();

/** Split a list of names with ranges (a-b), and modifiers (@v fixed, *v start) on an element or a range. */
function elements(text: string): { name: string; mod: Mod }[] {
  const toks = text.replace(/\s*-\s*(?=[A-Za-z_])/g, '-').split(/\s+/).filter(Boolean);
  return toks.map((t) => {
    const m = /^([^@*]+)(?:([@*])(-?[\d.]*(?:[eE][-+]?\d+)?))?$/.exec(t);
    if (!m) fail(`Cannot read “${t}”.`);
    const mod: Mod = {};
    if (m![2] === '@') mod.fixed = num(m![3]);
    else if (m![2] === '*' && m![3] !== '') mod.start = num(m![3]);
    return { name: m![1], mod };
  });
}

export class MixtureModel {
  columns: string[];
  constructor(columns: string[]) { this.columns = columns; }
  /** A range a-b: columns between them in data order, else a numeric suffix (u1-u4, u2$1-u3$1, c2#1-c4#1). */
  expand(name: string): string[] {
    const parts = name.split('-');
    if (parts.length === 1) return [name];
    if (parts.length !== 2) fail(`Cannot read the range “${name}”.`);
    const [a, b] = parts;
    const lcCols = this.columns.map(lc);
    const ia = lcCols.indexOf(lc(a)), ib = lcCols.indexOf(lc(b));
    if (ia >= 0 && ib >= 0 && ib >= ia) return this.columns.slice(ia, ib + 1);
    const re = /^([A-Za-z_][A-Za-z_]*?)(\d+)([$#]\d+)?$/;
    const ma = re.exec(a), mb = re.exec(b);
    if (!ma || !mb || lc(ma[1]) !== lc(mb[1]) || (ma[3] ?? '') !== (mb[3] ?? '') || Number(mb[2]) < Number(ma[2])) fail(`Cannot read the range “${name}”.`);
    return Array.from({ length: Number(mb![2]) - Number(ma![2]) + 1 }, (_, i) => `${ma![1]}${Number(ma![2]) + i}${ma![3] ?? ''}`);
  }
  list(text: string) { return elements(text).flatMap((e) => this.expand(e.name).map((name) => ({ name, mod: e.mod }))); }
}

// ---------------------------------------------------------------------------------------------------------------

/** Column statistics for starting values. */
function stats(data: Dataset, col: string, missing: number[]) {
  const i = data.names.indexOf(col);
  const v = Array.from(data.cols[i]).filter((x) => Number.isFinite(x) && !missing.includes(x));
  const n = v.length, mean = v.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const levels = [...new Set(v)].sort((a, b) => a - b);
  const counts = levels.map((l) => v.filter((x) => x === l).length);
  return { n, mean, variance: variance > 0 ? variance : 1, sd: Math.sqrt(variance > 0 ? variance : 1), levels, counts, min: Math.min(...v), max: Math.max(...v) };
}
const qlogis = (p: number) => Math.log(Math.min(Math.max(p, 1e-4), 1 - 1e-4) / (1 - Math.min(Math.max(p, 1e-4), 1 - 1e-4)));

interface Combo { c: number; t: Map<number, number> }
const K0 = (c = 0): Combo => ({ c, t: new Map() });
const plus = (a: Combo, b: Combo, s = 1): Combo => { const t = new Map(a.t); b.t.forEach((v, k) => t.set(k, (t.get(k) ?? 0) + s * v)); return { c: a.c + s * b.c, t }; };
const times = (a: Combo, s: number): Combo => plus(K0(), a, s);

/**
 * Read the syntax against the data's columns and build the engine's specification. Throws MixtureSyntaxError with
 * a message for the card when the syntax cannot be read or asks for something the engine does not fit.
 */
export function buildMixture(syntax: string, data: Dataset, opt: { seed: number; starts?: number; order?: number[][]; given?: number[] }): MixtureParse {
  const notes: string[] = [];
  const cols = data.names;
  const mm = new MixtureModel(cols);
  const colOf = (name: string) => { const i = cols.findIndex((c) => lc(c) === lc(name)); return i < 0 ? null : cols[i]; };
  // --- tokens: section headers, class labels and statements
  const text = syntax.replace(/!.*$/gm, ' ');
  const pieces = text.split(/(\b(?:MODEL\s+CONSTRAINT|MODEL(?:\s+[A-Za-z_]\w*)?|VARIABLE|ANALYSIS)\s*:|%[^%]*%|;)/i);
  let section: 'decl' | 'model' | 'constraint' = 'decl', sectionVar: string | null = null, cond: Cond | null = null;
  const decls: { key: string; value: string }[] = [];
  const stmts: { text: string; cond: Cond; order: number; within: string | null }[] = [];
  const constraints: string[] = [];
  let buf = '', order = 0;
  const classNames: string[] = [];
  const flush = () => {
    const s = buf.trim(); buf = '';
    if (!s) return;
    if (section === 'decl') {
      const m = /^([A-Za-z]+)\s*(?:=|\s+IS\s+|\s+ARE\s+)\s*([\s\S]*)$/i.exec(s);
      if (!m) fail(`Cannot read “${s}”: options are written NAME = value.`);
      decls.push({ key: m![1].toUpperCase(), value: m![2].trim() });
      if (/^CLASSES$/i.test(m![1])) for (const c of m![2].matchAll(/([A-Za-z_]\w*)\s*\(\s*\d+\s*\)/g)) classNames.push(lc(c[1]));
    } else if (section === 'constraint') constraints.push(s);
    else {
      if (cond === null) fail('Begin the model with %OVERALL% or a class label such as %c#1%.');
      stmts.push({ text: s.replace(/\s+/g, ' '), cond: cond!, order: order++, within: sectionVar });
    }
  };
  for (const p of pieces) {
    if (p === undefined) continue;
    if (p === ';') { flush(); continue; }
    const head = /^(MODEL\s+CONSTRAINT|MODEL(?:\s+([A-Za-z_]\w*))?|VARIABLE|ANALYSIS)\s*:$/i.exec(p.trim());
    if (head && /[:]$/.test(p)) {
      if (buf.trim()) flush();
      if (/^MODEL\s+CONSTRAINT/i.test(head[1])) { section = 'constraint'; continue; }
      if (/^MODEL/i.test(head[1])) { section = 'model'; sectionVar = head[2] ? lc(head[2]) : null; cond = null; continue; }
      section = 'decl'; continue;
    }
    if (/^%[^%]*%$/.test(p)) {
      if (buf.trim()) flush();
      if (section !== 'model') fail(`${p} outside MODEL.`);
      const lab = p.slice(1, -1).trim();
      if (/^OVERALL$/i.test(lab)) { if (sectionVar) fail(`%OVERALL% belongs in MODEL:, not MODEL ${sectionVar}:.`); cond = {}; continue; }
      const c: Cond = {};
      for (const part of lab.split('.')) {
        const m = /^([A-Za-z_]\w*)#(\d+)$/.exec(part.trim());
        if (!m) fail(`Cannot read the class label ${p}.`);
        c[lc(m![1])] = Number(m![2]);
      }
      if (sectionVar && Object.keys(c).some((v) => v !== sectionVar)) fail(`${p}: in MODEL ${sectionVar}: the classes are those of ${sectionVar}.`);
      cond = c; continue;
    }
    buf += p;
  }
  flush();

  // --- declarations
  const classes: { name: string; k: number; known?: { column: string; values: number[] } }[] = [];
  const categorical = new Set<string>(), nominal = new Set<string>(), count = new Map<string, boolean>(), censored = new Map<string, 'below' | 'above'>();
  let weight: string | undefined, param13n: Param13n = 'logit', use: string[] | null = null;
  let startsInit: number | null = null, startsFinal: number | null = null;
  const missing: { column: string; values: number[] }[] = [];
  const known: Record<string, { column: string; values: number[] }> = {};
  const needCol = (name: string, what: string) => colOf(name) ?? fail(`${what}: ${name} is not a column of the data.`);
  for (const { key, value } of decls) {
    switch (key) {
      case 'CLASSES': {
        const re = /([A-Za-z_]\w*)\s*\(\s*(\d+)\s*\)/g;
        for (const m of value.matchAll(re)) classes.push({ name: lc(m[1]), k: Number(m[2]) });
        if (!classes.length || value.replace(re, '').trim()) fail('CLASSES: write each latent class variable with its number of classes, e.g. CLASSES = c (2).');
        break;
      }
      case 'CATEGORICAL': for (const e of mm.list(value)) categorical.add(needCol(e.name, 'CATEGORICAL')); break;
      case 'NOMINAL': for (const e of mm.list(value)) nominal.add(needCol(e.name, 'NOMINAL')); break;
      case 'COUNT': {
        for (const m of value.matchAll(/([^()]+?)(?:\(\s*([ip])\s*\)|$)/gi)) {
          if (!m[1].trim()) continue;
          for (const e of mm.list(m[1])) count.set(needCol(e.name, 'COUNT'), lc(m[2] ?? '') === 'i');
        }
        break;
      }
      case 'CENSORED': {
        for (const m of value.matchAll(/([^()]+?)\(\s*([a-z]+)\s*\)/gi)) {
          const side = lc(m[2]);
          if (side !== 'a' && side !== 'b') fail(`CENSORED = … (${m[2]}): only censoring from above (a) or below (b) is fitted (no inflation).`);
          for (const e of mm.list(m[1])) censored.set(needCol(e.name, 'CENSORED'), side === 'a' ? 'above' : 'below');
        }
        break;
      }
      case 'KNOWNCLASS': {
        const m = /^([A-Za-z_]\w*)\s*\(([^)]*)\)$/.exec(value);
        if (!m) fail('KNOWNCLASS: write e.g. KNOWNCLASS = cg (g = 0 g = 1).');
        const pairs = [...m![2].matchAll(/([A-Za-z_]\w*)\s*=\s*(-?[\d.]+)/g)];
        if (!pairs.length || new Set(pairs.map((p) => lc(p[1]))).size !== 1) fail('KNOWNCLASS: give the values of one column, e.g. (g = 0 g = 1).');
        known[lc(m![1])] = { column: needCol(pairs[0][1], 'KNOWNCLASS'), values: pairs.map((p) => num(p[2])) };
        break;
      }
      case 'FREQWEIGHT': weight = needCol(value.trim(), 'FREQWEIGHT'); break;
      case 'USEVARIABLES': case 'USEVARIABLE': case 'USEVAR': case 'USEV': use = mm.list(value).map((e) => needCol(e.name, 'USEVARIABLES')); break;
      case 'MISSING': {
        for (const m of value.matchAll(/([^()]+?)\(([^)]*)\)/g)) {
          const vals = m[2].split(/[\s,]+/).filter(Boolean).map(num);
          const names = /^\s*(ALL|\.)\s*$/i.test(m[1]) ? cols : mm.list(m[1]).map((e) => needCol(e.name, 'MISSING'));
          for (const c of names) missing.push({ column: c, values: vals });
        }
        break;
      }
      case 'PARAMETERIZATION': {
        const v = lc(value.trim());
        if (v === 'logit' || v === 'loglinear' || v === 'probability') param13n = v;
        else fail(`PARAMETERIZATION = ${value}: the card fits LOGIT, LOGLINEAR and PROBABILITY.`);
        break;
      }
      case 'STARTS': {
        const v = value.split(/\s+/).map(num);
        startsInit = v[0]; startsFinal = v[1] ?? Math.max(1, Math.round(v[0] / 4));
        break;
      }
      case 'TYPE': if (!/^MIXTURE$/i.test(value.trim())) fail(`TYPE = ${value}: the card fits TYPE = MIXTURE.`); break;
      case 'ESTIMATOR': if (!/^MLR$/i.test(value.trim())) fail(`ESTIMATOR = ${value}: the card estimates by maximum likelihood with robust (MLR) standard errors.`); break;
      case 'NAMES': case 'PROCESSORS': case 'STITERATIONS': case 'ALGORITHM': case 'STSCALE': case 'LRTSTARTS': break;
      default: fail(`${key} is not an option the card reads (CLASSES, CATEGORICAL, NOMINAL, COUNT, CENSORED, KNOWNCLASS, FREQWEIGHT, USEVARIABLES, MISSING, PARAMETERIZATION, STARTS).`);
    }
  }
  if (!classes.length) fail('Declare the latent class variable(s): CLASSES = c (2).');
  for (const c of classes) {
    if (c.k < 1 || c.k > 12) fail(`${c.name}: between 1 and 12 classes.`);
    if (known[c.name]) { if (known[c.name].values.length !== c.k) fail(`KNOWNCLASS ${c.name}: give one value per class (${c.k}).`); }
  }
  for (const k of Object.keys(known)) if (!classes.some((c) => c.name === k)) fail(`KNOWNCLASS ${k} is not in CLASSES.`);
  classes.forEach((c) => { if (known[c.name]) c.known = known[c.name]; });
  const cIdx = (name: string) => classes.findIndex((c) => c.name === lc(name));
  const isClass = (name: string) => cIdx(name.split('#')[0]) >= 0;
  const nconf = classes.reduce((a, c) => a * c.k, 1);
  if (nconf > 2000) fail(`${nconf} joint classes: too many to sum over.`);
  for (const s of stmts) for (const [v, k] of Object.entries(s.cond)) {
    const i = cIdx(v);
    if (i < 0) fail(`%${v}#${k}%: ${v} is not in CLASSES.`);
    if (k < 1 || k > classes[i].k) fail(`%${v}#${k}%: ${v} has ${classes[i].k} classes.`);
  }

  // --- model statements into items
  const items: Item[] = [];
  const factors = new Map<string, { indicators: string[]; growth?: Growth }>();
  const growths: Growth[] = [];
  const onPairs: { lhs: string; rhs: string }[] = [];
  const add = (key: string, cond: Cond, mod: Mod, label: string | undefined, ord: number) => items.push({ key, cond, mod, label, order: ord, mentioned: true });
  const ref = (name: string): string | null => {
    if (isClass(name) || factors.has(lc(name))) return lc(name);
    const h = /^(.+)#(\d+)$/.exec(name);
    if (h) { const c = colOf(h[1]); return c ? `${c}#${h[2]}` : null; }
    return colOf(name);
  };
  // Factors first (BY and |), so that names on the left of ON are known.
  for (const s of stmts) {
    const by = /^(.+?)\s+BY\s+(.+)$/i.exec(s.text);
    if (by) { for (const f of mm.list(by[1])) { if (!factors.has(lc(f.name))) factors.set(lc(f.name), { indicators: [] }); } continue; }
    const g = /^([^|[\]]+)\|([^|]+)$/.exec(s.text);
    if (g) for (const f of mm.list(g[1])) if (!factors.has(lc(f.name))) factors.set(lc(f.name), { indicators: [] });
  }
  for (const s of stmts) {
    let body = s.text, label: string | undefined;
    const lm = /\(\s*([A-Za-z_0-9]+)\s*\)\s*$/.exec(body);
    if (lm) { label = lc(lm[1]); body = body.slice(0, lm.index).trim(); }
    const cond = s.cond;
    const by = /^(.+?)\s+BY\s+(.+)$/i.exec(body);
    const growth = /^([^|[\]]+)\|([^|]+)$/.exec(body);
    const on = /^(.+?)\s+ON\s+(.+)$/i.exec(body);
    const wth = /^(.+?)\s+WITH\s+(.+)$/i.exec(body);
    if (by) {
      for (const f of mm.list(by[1])) {
        const fac = factors.get(lc(f.name))!;
        mm.list(by[2]).forEach((e, j) => {
          const y = colOf(e.name) ?? fail(`${f.name} BY ${e.name}: ${e.name} is not a column of the data.`);
          if (!fac.indicators.includes(y)) fac.indicators.push(y);
          const first = fac.indicators[0] === y;
          const mod = Object.keys(e.mod).length ? e.mod : first && j === 0 && !Object.keys(cond).length ? { fixed: 1 } : {};
          if (/\*/.test(by[2].split(/\s+/)[j] ?? '') && first) mod.fixed = undefined;
          add(`=~|${lc(f.name)}|${y}`, cond, mod, label, s.order);
        });
      }
    } else if (growth) {
      if (Object.keys(cond).length) fail('Growth factors (|) are defined in %OVERALL%.');
      const fs = mm.list(growth[1]).map((f) => lc(f.name));
      if (fs.length < 2 || fs.length > 3) fail('A growth model has an intercept and a slope (and a quadratic) factor: i s | y1@0 y2@1 …');
      const outs = mm.list(growth[2]);
      const inflation = outs.every((o) => /#1$/.test(o.name));
      const outcomes = outs.map((o) => { const base = o.name.replace(/#1$/, ''); return colOf(base) ?? fail(`${o.name} is not a column of the data.`); });
      const ts = outs.map((o) => (o.mod.fixed ?? fail(`Give each occasion its time score: ${o.name}@t.`)) as number);
      const g: Growth = { factors: fs, outcomes, times: ts, inflation };
      growths.push(g);
      fs.forEach((f) => { factors.get(f)!.growth = g; factors.get(f)!.indicators = outcomes; });
    } else if (on) {
      const lhs = mm.list(on[1]), rhs = mm.list(on[2]);
      for (const l of lhs) for (const r of rhs) {
        const ln = ref(l.name) ?? fail(`${l.name} ON …: ${l.name} is not a column, factor or latent class variable.`);
        const rn = ref(r.name) ?? fail(`… ON ${r.name}: ${r.name} is not a column, factor or latent class variable.`);
        onPairs.push({ lhs: ln, rhs: rn });
        add(`~|${ln}|${rn}`, cond, r.mod, label, s.order);
      }
    } else if (wth) {
      const lhs = mm.list(wth[1]), rhs = mm.list(wth[2]);
      for (const l of lhs) for (const r of rhs) {
        const a = ref(l.name) ?? fail(`${l.name} is not a column, factor or latent class variable.`);
        const b = ref(r.name) ?? fail(`${r.name} is not a column, factor or latent class variable.`);
        if (isClass(a) !== isClass(b)) fail(`${l.name} WITH ${r.name}: a latent class variable is associated only with another one.`);
        const [p, q] = isClass(a) && cIdx(a.split('#')[0]) > cIdx(b.split('#')[0]) ? [b, a] : [a, b];
        add(`~~|${p}|${q}`, cond, r.mod, label, s.order);
      }
    } else if (/^\[.*\]$/.test(body)) {
      for (const e of mm.list(body.slice(1, -1))) {
        const th = /^(.+)\$(\d+)$/.exec(e.name), hash = /^(.+)#(\d+)$/.exec(e.name);
        if (th) add(`$${th[2]}|${colOf(th[1]) ?? fail(`${e.name}: ${th[1]} is not a column of the data.`)}`, cond, e.mod, label, s.order);
        else if (hash && isClass(hash[1])) add(`~1|${lc(hash[1])}#${hash[2]}`, cond, e.mod, label, s.order);
        else if (hash) add(`~1|${colOf(hash[1]) ?? fail(`${e.name}: ${hash[1]} is not a column of the data.`)}#${hash[2]}`, cond, e.mod, label, s.order);
        else add(`~1|${ref(e.name) ?? fail(`[${e.name}]: not a column or factor.`)}`, cond, e.mod, label, s.order);
      }
    } else {
      for (const e of mm.list(body)) {
        const v = ref(e.name) ?? fail(`“${body}”: ${e.name} is not a column or factor.`);
        if (isClass(v)) fail(`${e.name}: a latent class variable has no variance.`);
        add(`~~|${v}|${v}`, cond, e.mod, label, s.order);
      }
    }
  }
  const prefer = (vars: string[]) => (use ? use : vars);

  // --- the variables: outcomes (DVs), covariates and factors
  const isFactor = (v: string) => factors.has(v);
  const dv = new Set<string>();
  factors.forEach((f) => f.indicators.forEach((y) => dv.add(y)));
  [categorical, nominal, new Set(count.keys()), new Set(censored.keys())].forEach((s) => s.forEach((v) => dv.add(v)));
  for (const p of onPairs) if (!isFactor(p.lhs) && !isClass(p.lhs)) dv.add(p.lhs.replace(/#\d+$/, ''));
  for (const it of items) {
    const [kind, a, b] = it.key.split('|');
    const base = (x: string) => x.replace(/#\d+$/, '');
    if (kind.startsWith('$')) dv.add(a);
    if (kind === '~1' && !isFactor(a) && !isClass(a)) dv.add(base(a));
    if (kind === '~~' && !isClass(a) && !isFactor(a)) { dv.add(a); if (b !== a && !isFactor(b)) dv.add(b); }
  }
  for (const u of prefer([])) if (!dv.has(u) && !onPairs.some((p) => p.rhs === u) && !Object.values(known).some((k) => k.column === u) && u !== weight) dv.add(u);
  const covariates = new Set<string>();
  for (const p of onPairs) if (!isFactor(p.rhs) && !isClass(p.rhs) && !dv.has(p.rhs)) covariates.add(p.rhs);
  if (!dv.size) fail('No outcome (latent class indicator) in the model.');
  const typeOf = (y: string): 'cat' | 'nominal' | 'count' | 'zip' | 'censored' | 'normal' =>
    categorical.has(y) ? 'cat' : nominal.has(y) ? 'nominal' : count.has(y) ? (count.get(y) ? 'zip' : 'count') : censored.has(y) ? 'censored' : 'normal';
  const missFor = (c: string) => missing.filter((m) => m.column === c).flatMap((m) => m.values);
  const st = new Map<string, ReturnType<typeof stats>>();
  const S = (c: string) => { if (!st.has(c)) st.set(c, stats(data, c, missFor(c))); return st.get(c)!; };
  for (const y of dv) if (S(y).n === 0) fail(`${y} has no observed values.`);
  for (const y of categorical) if (S(y).levels.length > 10) fail(`${y} has ${S(y).levels.length} categories: is it categorical?`);
  for (const y of categorical) if (S(y).levels.length < 2) fail(`${y} has a single category.`);
  for (const y of nominal) if (S(y).levels.length < 2 || S(y).levels.length > 10) fail(`${y}: a nominal outcome has 2 to 10 categories.`);
  for (const [y] of count) if (S(y).min < 0 || S(y).levels.some((l) => l !== Math.round(l))) fail(`${y}: a count is a whole number ≥ 0.`);

  // Growth factors: their outcomes' type, and checks.
  const growthType = (g: Growth) => (g.inflation ? 'inflation' : typeOf(g.outcomes[0]));
  for (const g of growths) {
    const ts = new Set(g.outcomes.map((y) => (g.inflation ? 'zip' : typeOf(y))));
    if (ts.size > 1) fail('The outcomes of a growth model are of one type.');
    if (g.inflation && g.outcomes.some((y) => typeOf(y) !== 'zip')) fail('Growth of the inflation (u#1) needs zero-inflated counts: COUNT = u1-u4 (i).');
  }
  const discreteGrowth = (f: string) => { const g = factors.get(f)?.growth; return !!g && (g.inflation || growthType(g) !== 'normal'); };

  // Class model structure: parents (ON other class variables, loglinear WITH, class-specific class regressions).
  const parents = classes.map(() => new Set<number>());
  const classCov = classes.map(() => new Set<string>());
  for (const it of items) {
    const [kind, a, b] = it.key.split('|');
    if (!isClass(a)) continue;
    const v = cIdx(a.split('#')[0]);
    if (kind === '~' && isClass(b)) parents[v].add(cIdx(b.split('#')[0]));
    else if (kind === '~') { if (!covariates.has(b)) fail(`${a} ON ${b}: a latent class variable is regressed on covariates (observed variables that are not outcomes) or other latent class variables.`); classCov[v].add(b); }
    if (kind === '~~') parents[cIdx(b.split('#')[0])].add(v);
    if (kind === '~~' && param13n !== 'loglinear') fail(`${a} WITH ${b}: associations between latent class variables need PARAMETERIZATION = LOGLINEAR.`);
    const owner = kind === '~~' ? cIdx(b.split('#')[0]) : v;
    for (const c of Object.keys(it.cond)) if (cIdx(c) !== owner) parents[owner].add(cIdx(c));
  }
  parents.forEach((ps, v) => ps.forEach((p) => { if (p >= v) fail(`${classes[v].name} depends on ${classes[p].name}: list ${classes[p].name} before ${classes[v].name} in CLASSES.`); }));
  if (param13n === 'loglinear' && classCov.some((s) => s.size)) fail('Covariates of latent class variables are not fitted with PARAMETERIZATION = LOGLINEAR.');

  // --- parameters: variation over classes, defaults, values
  const theta: MixtureSpec['theta'] = [];
  const labelTheta = new Map<string, number>();
  const newTheta = (name: string, start: number, scale: number) => { theta.push({ name, start, scale }); return theta.length - 1; };
  const byKey = new Map<string, Item[]>();
  for (const it of items) { if (!byKey.has(it.key)) byKey.set(it.key, []); byKey.get(it.key)!.push(it); }
  const single = classes.filter((c) => !c.known).length === 1 && classes.length === 1;
  const mainClass = classes.findIndex((c) => !c.known);

  interface Def { varying: boolean; fixed?: number; fixedLast?: boolean; start: (z: number, of: number) => number; scale: number; autoLabel?: string; free: boolean }
  const spread = (z: number, of: number) => (of <= 1 ? 0 : 1 - (2 * z) / (of - 1));  // +1 … −1 across classes
  const growthOf = (y: string) => growths.find((g) => g.outcomes.includes(y) && !g.inflation);
  const inflGrowthOf = (y: string) => growths.find((g) => g.outcomes.includes(y) && g.inflation);
  const defaults = (key: string): Def | null => {
    const [kind, a, b] = key.split('|');
    const base = a.replace(/#\d+$/, '');
    if (kind === '~1' && isClass(a)) return { varying: false, start: () => 0, scale: 0, free: true };
    if (kind === '~1' && isFactor(a)) {
      const f = factors.get(a)!, g = f.growth;
      if (!g) return { varying: true, fixedLast: true, start: (z, of) => spread(z, of) * S(f.indicators[0]).sd, scale: S(f.indicators[0]).sd, free: true };
      const gi = g.factors.indexOf(a), y0 = g.outcomes[0];
      if (g.inflation) return gi === 0 ? { varying: false, fixed: 0, start: () => 0, scale: 0, free: false } : { varying: false, start: () => 0, scale: 0, free: true };
      const ty = growthType(g);
      if (ty === 'cat') return { varying: true, fixedLast: gi === 0, start: (z, of) => (gi === 0 ? spread(z, of) * 1.5 : 0), scale: gi === 0 ? 1.5 : 0.5, free: true };
      if (ty === 'count' || ty === 'zip') return { varying: true, start: (z, of) => (gi === 0 ? Math.log(Math.max(S(y0).mean, 0.1)) + spread(z, of) * 0.5 : 0), scale: gi === 0 ? 0.5 : 0.2, free: true };
      const yl = g.outcomes[g.outcomes.length - 1], dt = g.times[g.times.length - 1] - g.times[0] || 1;
      return { varying: true, start: (z, of) => (gi === 0 ? S(y0).mean + spread(z, of) * S(y0).sd : gi === 1 ? (S(yl).mean - S(y0).mean) / dt + spread(z, of) * 0.5 * S(y0).sd / dt : 0), scale: gi === 0 ? S(y0).sd : S(y0).sd / dt, free: true };
    }
    if (kind === '~1') {
      if (!dv.has(base)) return null;
      if (/#\d+$/.test(a)) {
        if (nominal.has(base)) { const s = S(base), j = Number(a.split('#')[1]); return { varying: single, start: (z, of) => Math.log(s.counts[j - 1] / s.counts[s.counts.length - 1]) + spread(z, of), scale: 1.5, free: true }; }
        if (typeOf(base) === 'zip') { const ig = inflGrowthOf(base); return { varying: false, start: () => -1, scale: 0, free: true, autoLabel: ig ? `__infl_${growths.indexOf(ig)}` : undefined }; }
        return null;
      }
      if (growthOf(base) && typeOf(base) !== 'cat') return { varying: false, fixed: 0, start: () => 0, scale: 0, free: false };
      const t = typeOf(base);
      if (t === 'cat' || t === 'nominal') return null;
      if (t === 'count' || t === 'zip') return { varying: single, start: (z, of) => Math.log(Math.max(S(base).mean, 0.1)) + spread(z, of) * 0.5, scale: 0.5, free: true };
      if ([...factors.values()].some((f) => !f.growth && f.indicators.includes(base))) return { varying: false, start: () => S(base).mean, scale: 0, free: true };
      return { varying: single, start: (z, of) => S(base).mean + spread(z, of) * S(base).sd, scale: S(base).sd, free: true };
    }
    if (kind.startsWith('$')) {
      const j = Number(kind.slice(1)), s = S(a);
      if (!categorical.has(a)) return null;
      if (j < 1 || j >= s.levels.length) return null;
      const cum = s.counts.slice(0, j).reduce((x, y) => x + y, 0) / s.n;
      const g = growthOf(a);
      if (g) return { varying: false, start: () => qlogis(cum), scale: 0, free: true, autoLabel: `__thr_${growths.indexOf(g)}_${j}` };
      return { varying: single, start: (z, of) => qlogis(cum) - spread(z, of), scale: 1.5, free: true };
    }
    if (kind === '~~' && a === b) {
      if (isFactor(a)) { const f = factors.get(a)!; if (discreteGrowth(a)) return { varying: false, fixed: 0, start: () => 0, scale: 0, free: false }; return { varying: false, start: () => (f.growth ? (f.growth.factors.indexOf(a) === 0 ? 0.5 : 0.1) : 0.5) * S(f.indicators[0]).variance, scale: 0, free: true }; }
      if (!dv.has(a) || typeOf(a) === 'cat' || typeOf(a) === 'nominal' || typeOf(a) === 'count' || typeOf(a) === 'zip') return null;
      const indicator = [...factors.values()].some((f) => f.indicators.includes(a));
      return { varying: false, start: () => (indicator ? 0.5 : 1) * S(a).variance, scale: 0, free: true };
    }
    if (kind === '~~') {
      if (isClass(a)) return { varying: false, start: () => 0, scale: 0, free: true };
      if (isFactor(a) && isFactor(b) && !discreteGrowth(a) && !discreteGrowth(b) && exoFactor(a) && exoFactor(b)) return { varying: false, start: () => 0, scale: 0, free: true };
      return { varying: false, fixed: 0, start: () => 0, scale: 0, free: false };
    }
    if (kind === '=~') {
      const g = factors.get(a)?.growth;
      if (g) { const t = g.times[g.outcomes.indexOf(b)]; const gi = g.factors.indexOf(a); return { varying: false, fixed: gi === 0 ? 1 : gi === 1 ? t : t * t, start: () => 0, scale: 0, free: false }; }
      return { varying: false, start: () => 1, scale: 0, free: true };
    }
    if (kind === '~') return { varying: false, start: () => 0, scale: 0, free: true };
    return null;
  };
  const exoFactor = (f: string) => !items.some((it) => it.key.startsWith(`~|${f}|`) && isFactor(it.key.split('|')[2]));

  // The class variables a parameter varies over, and its value (a combination of theta) in each joint class.
  const varyCache = new Map<string, number[]>();
  const varyOf = (key: string): number[] => {
    if (varyCache.has(key)) return varyCache.get(key)!;
    const its = byKey.get(key) ?? [];
    const set = new Set<number>();
    for (const it of its) for (const c of Object.keys(it.cond)) set.add(cIdx(c));
    const d = defaults(key);
    // (class-specific by default with one latent class variable; with several, where a class-specific part says)
    if (d?.varying && single && mainClass >= 0) set.add(mainClass);
    const r = [...set].sort((x, y) => x - y);
    varyCache.set(key, r);
    return r;
  };
  const valCache = new Map<string, Combo>();
  const fixedRows = new Map<string, boolean>();
  /** The value of a parameter in a (partial) assignment of classes covering the variables it varies over. */
  const val = (key: string, z: Cond): Combo => {
    const vary = varyOf(key);
    const sub: Cond = {};
    for (const v of vary) { const nm = classes[v].name; if (z[nm] === undefined) fail(`Internal: ${key} needs ${nm}.`); sub[nm] = z[nm]; }
    const ck = `${key}@${JSON.stringify(sub)}`;
    if (valCache.has(ck)) return valCache.get(ck)!;
    const its = (byKey.get(key) ?? []).filter((it) => Object.entries(it.cond).every(([c, k]) => sub[c] === k));
    const it = its.sort((p, q) => Object.keys(q.cond).length - Object.keys(p.cond).length || q.order - p.order)[0];
    const d = defaults(key);
    if (!it && !d) fail(`Internal: no value for ${key}.`);
    const ord = vary.length ? vary.reduce((acc, v, i) => acc + (sub[classes[v].name] - 1) * vary.slice(0, i).reduce((m, u) => m * classes[u].k, 1), 0) : 0;
    const ofN = vary.reduce((m, v) => m * classes[v].k, 1);
    let out: Combo;
    const lastFixed = d?.fixedLast && vary.length === 1 && sub[classes[vary[0]].name] === classes[vary[0]].k;
    if (it && it.mod.fixed !== undefined) { out = K0(it.mod.fixed); fixedRows.set(ck, true); }
    else if (!it && (d!.fixed !== undefined || lastFixed)) { out = K0(lastFixed ? 0 : d!.fixed!); fixedRows.set(ck, true); }
    else {
      const label = it?.label ?? d?.autoLabel;
      const start = it?.mod.start ?? d?.start(ord, ofN) ?? 0;
      const scale = it?.mod.start !== undefined ? (d?.scale ?? 0) : d?.scale ?? 0;
      let idx: number;
      if (label) { if (!labelTheta.has(label)) labelTheta.set(label, newTheta(label, start, scale)); idx = labelTheta.get(label)!; }
      else {
        // One parameter per class-specific statement; an overall statement (or the default) is shared by the classes
        // it applies to, unless the parameter is class-specific by default.
        const own = it && Object.keys(it.cond).length ? `${key}#${it.order}` : d?.varying ? ck : key;
        const tk = `__${own}`;
        if (!labelTheta.has(tk)) labelTheta.set(tk, newTheta(`${key.replace(/\|/g, ' ')} ${JSON.stringify(sub)}`, start, scale));
        idx = labelTheta.get(tk)!;
      }
      out = { c: 0, t: new Map([[idx, 1]]) };
    }
    valCache.set(ck, out);
    return out;
  };

  // MODEL CONSTRAINT: label = linear expression of labels and numbers.
  const constrained = new Map<string, string>();
  for (const c of constraints) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(c.replace(/\s+/g, ' ').trim());
    if (!m) fail(`MODEL CONSTRAINT: cannot read “${c}” (write label = linear expression).`);
    if (/NEW\s*\(/i.test(c)) fail('MODEL CONSTRAINT: NEW parameters are not fitted by the card.');
    constrained.set(lc(m![1]), m![2]);
  }

  // --- configurations
  const ks = classes.map((c) => c.k);
  const configs = (vars: number[]): Cond[] => {
    let out: Cond[] = [{}];
    for (const v of vars) out = Array.from({ length: classes[v].k }, (_, j) => out.map((o) => ({ ...o, [classes[v].name]: j + 1 }))).flat();
    // first variable fastest
    const sorted: Cond[] = [];
    const total = vars.reduce((a, v) => a * ks[v], 1);
    for (let i = 0; i < total; i++) {
      const z: Cond = {}; let r = i;
      for (const v of vars) { z[classes[v].name] = (r % ks[v]) + 1; r = Math.floor(r / ks[v]); }
      sorted.push(z);
    }
    return vars.length ? sorted : out;
  };
  const slots: Slot[] = [];
  const slotOf = (c: Combo) => { slots.push({ c: Number.isFinite(c.c) ? c.c : null, t: [...c.t].flatMap(([k, v]) => [k, v]) }); return slots.length - 1; };
  const usedKeys = new Set<string>();
  const V = (key: string, z: Cond) => { usedKeys.add(key); return val(key, z); };
  const has = (key: string) => byKey.has(key) || defaults(key) !== null;

  // --- class model
  // "c ON x" names every logit c#m, "c2 ON c1" every pair (c2#m, c1#j), "cu WITH cy" every (cu#j, cy#m): the statements
  // apply to the per-category parameters.
  const copy = (it: Item, k2: string) => { if (!byKey.has(k2)) byKey.set(k2, []); byKey.get(k2)!.push({ ...it, key: k2 }); };
  for (const it of items) {
    const [kind, a, b] = it.key.split('|');
    if (!isClass(a)) continue;
    if (kind === '~' && !/#/.test(a)) {
      const v = cIdx(a);
      for (let m = 1; m < classes[v].k; m++) {
        if (isClass(b) && !/#/.test(b)) { const w = cIdx(b); for (let j = 1; j < classes[w].k; j++) copy(it, `~|${a}#${m}|${b}#${j}`); }
        else copy(it, `~|${a}#${m}|${b}`);
      }
    } else if (kind === '~~' && !/#/.test(a)) {
      const va = cIdx(a), vb = cIdx(b);
      for (let j = 1; j < classes[va].k; j++) for (let m = 1; m < classes[vb].k; m++) copy(it, `~~|${a}#${j}|${b}#${m}`);
    }
  }
  let rowGroups = 0;
  const classSpecs: MixtureClassSpec[] = [];
  const reportRows: MixtureReportRow[] = [];
  const atOf = (z: Cond) => classes.map((c) => z[c.name] ?? 0);
  classes.forEach((c, v) => {
    const ps = [...parents[v]].sort((a, b) => a - b);
    const xs = [...classCov[v]];
    const out: number[] = [];
    if (param13n === 'probability' && xs.length) fail('Covariates of latent class variables are not fitted with PARAMETERIZATION = PROBABILITY.');
    for (const pc of configs(ps)) {
      if (param13n === 'probability') {
        // A row of transition probabilities: all fixed (c2#1 ON c1#1@1 …) or all free (estimated as logits).
        const fixedP: (number | undefined)[] = Array.from({ length: c.k - 1 }, () => undefined);
        for (const it of items) {
          const [kind, a, b] = it.key.split('|');
          if (kind !== '~' || !/#/.test(a) || !isClass(a) || cIdx(a.split('#')[0]) !== v || !isClass(b)) continue;
          const m = Number(a.split('#')[1]), w = b.split('#')[0], j = Number(b.split('#')[1]);
          if (pc[w] !== j || !Object.entries(it.cond).every(([cv, k]) => pc[cv] === k)) continue;
          if (it.mod.fixed === undefined) fail(`${a} ON ${b}: with PARAMETERIZATION = PROBABILITY a transition probability is fixed (@), or the whole table is free (${c.name} ON ${w}).`);
          fixedP[m - 1] = it.mod.fixed;
        }
        if (fixedP.some((x) => x !== undefined)) {
          if (fixedP.some((x) => x === undefined)) fail(`${c.name}: fix every probability of a row, or none.`);
          const pr = [...(fixedP as number[]), 1 - (fixedP as number[]).reduce((t, x) => t + x, 0)];
          if (pr.some((x) => x < -1e-9 || x > 1 + 1e-9)) fail(`${c.name}: fixed probabilities lie between 0 and 1 and sum to at most 1.`);
          pr.forEach((x, m) => out.push(slotOf(K0(m < c.k - 1 ? x : 0))));
          if (ps.length) {
            const last = classes[ps[ps.length - 1]].name, rest: Cond = { ...pc }; delete rest[last];
            pr.slice(0, -1).forEach((x, m) => reportRows.push({ lhs: `${c.name}#${m + 1}`, op: '~', rhs: `${last}#${pc[last]}`, at: atOf(rest), slot: slotOf(K0(x)), fixed: true }));
          }
        } else {
          const group = rowGroups++;
          for (let m = 0; m < c.k; m++) {
            if (m === c.k - 1) { out.push(slotOf(K0())); continue; }
            const tk = `__prob_${v}_${JSON.stringify(pc)}_${m}`;
            if (!labelTheta.has(tk)) { labelTheta.set(tk, newTheta(`P(${c.name}#${m + 1} | ${JSON.stringify(pc)})`, 1 / c.k, 1)); theta[theta.length - 1].group = group; }
            const cmb: Combo = { c: 0, t: new Map([[labelTheta.get(tk)!, 1]]) };
            out.push(slotOf(cmb));
            if (!ps.length) reportRows.push({ lhs: `${c.name}#${m + 1}`, op: '~1', rhs: '', at: atOf({}), slot: slotOf(cmb), fixed: false });
            else { const last = classes[ps[ps.length - 1]].name, rest: Cond = { ...pc }; delete rest[last]; reportRows.push({ lhs: `${c.name}#${m + 1}`, op: '~', rhs: `${last}#${pc[last]}`, at: atOf(rest), slot: slotOf(cmb), fixed: false }); }
          }
        }
        continue;
      }
      for (let m = 1; m <= c.k; m++) {
        if (m === c.k) { out.push(slotOf(K0())); xs.forEach(() => out.push(slotOf(K0()))); continue; }
        let icpt = V(`~1|${c.name}#${m}`, pc);
        for (const w of ps) {
          const wn = classes[w].name, j = pc[wn];
          if (j >= classes[w].k) continue;
          const kOn = `~|${c.name}#${m}|${wn}#${j}`, kWith = `~~|${wn}#${j}|${c.name}#${m}`;
          if (byKey.has(kOn)) icpt = plus(icpt, V(kOn, pc));
          if (byKey.has(kWith)) icpt = plus(icpt, V(kWith, pc));
        }
        out.push(slotOf(icpt));
        for (const x of xs) out.push(slotOf(byKey.has(`~|${c.name}#${m}|${x}`) ? V(`~|${c.name}#${m}|${x}`, pc) : K0()));
      }
    }
    classSpecs.push({ name: c.name, k: c.k, parents: ps, covariates: xs, ...(c.known ? { known: c.known } : {}), slots: out, ...(param13n === 'probability' ? { prob: true } : {}) });
  });

  // --- blocks of observed variables
  const blocks: MixtureBlockSpec[] = [];
  const blockKeys: string[][] = [];
  const factorList = [...factors.keys()];
  const loadKey = (f: string, y: string) => `=~|${f}|${y}`;
  const loadsOf = (y: string) => factorList.filter((f) => factors.get(f)!.indicators.includes(y) && (!factors.get(f)!.growth || !factors.get(f)!.growth!.inflation));
  const inflLoadsOf = (y: string) => factorList.filter((f) => factors.get(f)!.growth?.inflation && factors.get(f)!.indicators.includes(y));
  const fixedLoad = (f: string, y: string) => { const c = val(loadKey(f, y), {}); if (c.t.size) fail(`${y}: a free loading on ${f} with a categorical or count outcome needs numerical integration.`); return c.c; };
  const xOf = (lhs: string) => [...covariates].filter((x) => byKey.has(`~|${lhs}|${x}`));
  const blockVary = (keys: string[]) => [...new Set(keys.filter(has).flatMap(varyOf))].sort((a, b) => a - b);

  const continuous = [...dv].filter((y) => typeOf(y) === 'normal' || typeOf(y) === 'censored');
  // Continuous outcomes linked by factors or covariances form a multivariate normal block.
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x)!; return x; };
  const unite = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  continuous.forEach((y) => parent.set(y, y));
  factorList.forEach((f) => parent.set(f, f));
  for (const f of factorList) { if (discreteGrowth(f)) continue; for (const y of factors.get(f)!.indicators) { if (!continuous.includes(y)) fail(`${f}: a factor with variance measured by ${y} (categorical or count) needs numerical integration.`); unite(f, y); } }
  for (const it of items) {
    const [kind, a, b] = it.key.split('|');
    if (kind === '~~' && a !== b && !isClass(a) && (it.mod.fixed === undefined || it.mod.fixed !== 0)) { if (!parent.has(a) || !parent.has(b)) fail(`${a} WITH ${b}: covariances are between continuous outcomes or factors.`); unite(a, b); }
    if (kind === '~' && parent.has(a) && parent.has(b)) unite(a, b);
    if (kind === '~' && dv.has(b) && !isClass(a)) fail(`${a} ON ${b}: regressions on outcomes (mediation) are not fitted by the card.`);
  }
  for (const f of factorList) if (!discreteGrowth(f)) for (const g of factorList) if (f < g && !discreteGrowth(g) && exoFactor(f) && exoFactor(g)) {
    const k = `~~|${f}|${g}`;
    if ((byKey.get(k) ?? byKey.get(`~~|${g}|${f}`))?.some((i) => i.mod.fixed === 0)) continue;
    unite(f, g);
  }
  const groups = new Map<string, { ys: string[]; fs: string[] }>();
  for (const x of [...continuous, ...factorList.filter((f) => !discreteGrowth(f))]) {
    const r = find(x); if (!groups.has(r)) groups.set(r, { ys: [], fs: [] });
    (isFactor(x) ? groups.get(r)!.fs : groups.get(r)!.ys).push(x);
  }
  const covKey = (a: string, b: string) => (byKey.has(`~~|${a}|${b}`) ? `~~|${a}|${b}` : byKey.has(`~~|${b}|${a}`) ? `~~|${b}|${a}` : a < b ? `~~|${a}|${b}` : `~~|${b}|${a}`);
  for (const { ys, fs } of groups.values()) {
    const ordered = [...dv].filter((y) => ys.includes(y));
    if (!ordered.length) fail(`${fs.join(', ')}: a factor without continuous indicators.`);
    const mvn = fs.length > 0 || ordered.length > 1;
    if (!mvn) {
      const y = ordered[0], xs = xOf(y), t = typeOf(y);
      const keys = [`~1|${y}`, ...xs.map((x) => `~|${y}|${x}`), `~~|${y}|${y}`];
      const by = blockVary(keys);
      const sl: number[] = [];
      for (const z of configs(by)) for (const k of keys) sl.push(slotOf(V(k, z)));
      blocks.push({ type: t === 'censored' ? 'censored' : 'normal', y: [y], x: xs, by, slots: sl, ...(t === 'censored' ? { side: censored.get(y) } : {}) });
      blockKeys.push(keys);
      continue;
    }
    if (ordered.some((y) => typeOf(y) === 'censored')) fail('A censored outcome in a factor or with covariances needs numerical integration.');
    const p = ordered.length, m = fs.length;
    const xs = [...new Set([...ordered, ...fs].flatMap(xOf))];
    const q = xs.length;
    const keys: (string | null)[] = [];
    ordered.forEach((y) => keys.push(`~1|${y}`));
    for (let j = 0; j < m; j++) for (let i = 0; i < p; i++) keys.push(factors.get(fs[j])!.indicators.includes(ordered[i]) ? loadKey(fs[j], ordered[i]) : null);
    for (let j = 0; j < q; j++) for (let i = 0; i < p; i++) keys.push(byKey.has(`~|${ordered[i]}|${xs[j]}`) ? `~|${ordered[i]}|${xs[j]}` : null);
    fs.forEach((f) => keys.push(`~1|${f}`));
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) keys.push(byKey.has(`~|${fs[i]}|${fs[j]}`) ? `~|${fs[i]}|${fs[j]}` : null);
    for (let j = 0; j < q; j++) for (let i = 0; i < m; i++) keys.push(byKey.has(`~|${fs[i]}|${xs[j]}`) ? `~|${fs[i]}|${xs[j]}` : null);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) keys.push(i === j ? `~~|${fs[i]}|${fs[i]}` : covKey(fs[i], fs[j]));
    for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) keys.push(i === j ? `~~|${ordered[i]}|${ordered[i]}` : byKey.has(covKey(ordered[i], ordered[j])) ? covKey(ordered[i], ordered[j]) : null);
    const real = keys.filter((k): k is string => !!k);
    const by = blockVary(real);
    const sl: number[] = [];
    for (const z of configs(by)) for (const k of keys) sl.push(slotOf(k ? V(k, z) : K0()));
    blocks.push({ type: 'mvn', y: ordered, x: xs, by, slots: sl, factors: m });
    blockKeys.push(real);
  }
  // Categorical, nominal and count outcomes: one block each (growth factors without variance enter as linear combinations).
  for (const y of dv) {
    const t = typeOf(y);
    if (t === 'normal' || t === 'censored') continue;
    const fsY = loadsOf(y).filter(discreteGrowth);
    for (const f of loadsOf(y)) if (!discreteGrowth(f)) fail(`${y}: a categorical or count indicator of a factor with variance needs numerical integration.`);
    const xs = [...new Set([...xOf(y), ...fsY.flatMap(xOf), ...(t === 'zip' ? [...xOf(`${y}#1`), ...inflLoadsOf(y).flatMap(xOf)] : []), ...(t === 'nominal' ? S(y).levels.slice(0, -1).flatMap((_, j) => xOf(`${y}#${j + 1}`)) : [])])];
    const usedKeysHere: string[] = [];
    const lin = (z: Cond, own: string, fsL: string[], sign: number, slopeOf = own.startsWith('~1|') ? own.slice(3) : y) => {
      // own intercept + Σ loading × factor mean, and slopes on x (own + Σ loading × factor slope).
      let c0 = own && has(own) ? V(own, z) : K0();
      if (own && has(own)) usedKeysHere.push(own);
      for (const f of fsL) { const l = fixedLoad(f, y); if (l !== 0) { c0 = plus(c0, V(`~1|${f}`, z), l); usedKeysHere.push(`~1|${f}`); } }
      const sl = xs.map((x) => {
        const base = slopeOf;
        let cx = byKey.has(`~|${base}|${x}`) ? V(`~|${base}|${x}`, z) : K0();
        if (byKey.has(`~|${base}|${x}`)) usedKeysHere.push(`~|${base}|${x}`);
        for (const f of fsL) if (byKey.has(`~|${f}|${x}`)) { cx = plus(cx, V(`~|${f}|${x}`, z), fixedLoad(f, y)); usedKeysHere.push(`~|${f}|${x}`); }
        return times(cx, sign);
      });
      return { c0, sl };
    };
    // Which class variables the block varies over: from every key it uses.
    const probe: string[] = [];
    if (t === 'cat') S(y).levels.slice(0, -1).forEach((_, j) => probe.push(`$${j + 1}|${y}`));
    if (t === 'nominal') S(y).levels.slice(0, -1).forEach((_, j) => probe.push(`~1|${y}#${j + 1}`));
    if (t === 'count' || t === 'zip') probe.push(`~1|${y}`);
    if (t === 'zip') probe.push(`~1|${y}#1`);
    fsY.forEach((f) => probe.push(`~1|${f}`));
    if (t === 'zip') inflLoadsOf(y).forEach((f) => probe.push(`~1|${f}`));
    xs.forEach((x) => { probe.push(`~|${y}|${x}`, `~|${y}#1|${x}`); fsY.forEach((f) => probe.push(`~|${f}|${x}`)); S(y).levels.forEach((_, j) => probe.push(`~|${y}#${j + 1}|${x}`)); });
    const by = blockVary(probe.filter((k) => byKey.has(k) || defaults(k)));
    const sl: number[] = [];
    for (const z of configs(by)) {
      if (t === 'cat') {
        const K = S(y).levels.length;
        const { c0, sl: xsl } = lin(z, '', fsY, 1);
        for (let j = 1; j < K; j++) sl.push(slotOf(plus(V(`$${j}|${y}`, z), c0, -1)));
        xsl.forEach((c) => sl.push(slotOf(c)));
      } else if (t === 'nominal') {
        const K = S(y).levels.length;
        for (let j = 1; j < K; j++) sl.push(slotOf(V(`~1|${y}#${j}`, z)));
        for (let j = 1; j < K; j++) for (const x of xs) sl.push(slotOf(byKey.has(`~|${y}#${j}|${x}`) ? V(`~|${y}#${j}|${x}`, z) : K0()));
      } else {
        const a = lin(z, `~1|${y}`, fsY, 1);
        sl.push(slotOf(a.c0)); a.sl.forEach((c) => sl.push(slotOf(c)));
        if (t === 'zip') { const b = lin(z, `~1|${y}#1`, inflLoadsOf(y), 1); sl.push(slotOf(b.c0)); b.sl.forEach((c) => sl.push(slotOf(c))); }
      }
    }
    blocks.push({ type: t, y: [y], x: xs, by, slots: sl, ...(t === 'cat' || t === 'nominal' ? { levels: S(y).levels } : {}) });
    blockKeys.push(usedKeysHere);
  }
  // A threshold, intercept or slope mentioned but not used (a typo, or an outcome without that parameter) is an error.
  for (const key of byKey.keys()) {
    const [kind, a] = key.split('|');
    if (isClass(a) || isClass(key.split('|')[2] ?? '')) continue;
    if (!usedKeys.has(key) && !(kind === '=~' && factors.get(a)?.growth)) {
      if (kind.startsWith('$')) fail(`${a}$${kind.slice(1)}: ${a} is not categorical with that many categories (CATEGORICAL = …).`);
      if (kind === '~1' && /#/.test(a)) fail(`${a}: not a nominal category or the inflation of a zero-inflated count (NOMINAL = …, COUNT = … (i)).`);
      if (!(kind === '~~' && isFactor(a))) fail(`${key.split('|').slice(1).join(' ').trim()} (${kind === '~' ? 'ON' : kind === '~1' ? 'mean' : kind === '~~' ? 'WITH' : 'BY'}) is not part of the model.`);
    }
  }

  // --- report: every parameter in every class it varies over
  const seen = new Set<string>();
  const nameOf = (key: string): { lhs: string; op: string; rhs: string } => {
    const [kind, a, b] = key.split('|');
    if (kind.startsWith('$')) return { lhs: a, op: '|', rhs: `t${kind.slice(1)}` };
    if (kind === '~1') return { lhs: a, op: '~1', rhs: '' };
    if (kind === '=~') return { lhs: a, op: '=~', rhs: b };
    return { lhs: a, op: kind, rhs: b };
  };
  const allKeys = [...new Set([...usedKeys, ...growths.flatMap((g) => g.factors.flatMap((f) => g.outcomes.map((y) => loadKey(f, y))))])];
  for (const key of allKeys) {
    const [kind, a] = key.split('|');
    if (param13n === 'probability' && isClass(a)) continue;
    if (kind === '~' && isClass(a) && !/#/.test(a)) continue;
    for (const z of configs(varyOf(key))) {
      const c = val(key, z);
      const id = `${key}@${JSON.stringify(z)}`;
      if (seen.has(id)) continue; seen.add(id);
      const nm = nameOf(key);
      const g = kind === '=~' ? factors.get(a)?.growth : undefined;
      reportRows.push({ ...nm, ...(g?.inflation ? { rhs: `${nm.rhs}#1` } : {}), at: atOf(z), slot: slotOf(c), fixed: c.t.size === 0 });
    }
  }
  // MODEL CONSTRAINT: replace a label's parameter by a linear combination of the others.
  if (constrained.size) {
    const subst = new Map<number, Combo>();
    for (const [lab, expr] of constrained) {
      const idx = labelTheta.get(lab) ?? fail(`MODEL CONSTRAINT: ${lab} is not a label in the model.`);
      let cmb = K0();
      const toks = expr.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) ?? fail(`MODEL CONSTRAINT: cannot read ${expr}.`);
      for (const tk of toks) {
        const m = /^([+-]?)(?:(\d*\.?\d+)\*)?([A-Za-z_]\w*|\d*\.?\d+)$/.exec(tk);
        if (!m) fail(`MODEL CONSTRAINT: ${expr} is not a linear expression of labels.`);
        const sign = m![1] === '-' ? -1 : 1, coef = m![2] ? Number(m![2]) : 1;
        if (/^[A-Za-z_]/.test(m![3])) { const j = labelTheta.get(lc(m![3])) ?? fail(`MODEL CONSTRAINT: ${m![3]} is not a label in the model.`); cmb = plus(cmb, { c: 0, t: new Map([[j, 1]]) }, sign * coef); }
        else cmb = plus(cmb, K0(Number(m![3])), sign * coef);
      }
      if (cmb.t.has(idx)) fail(`MODEL CONSTRAINT: ${lab} on both sides.`);
      subst.set(idx, cmb);
    }
    const keep = theta.map((_, i) => i).filter((i) => !subst.has(i));
    const renum = new Map(keep.map((i, j) => [i, j]));
    const rewrite = (s: Slot): Slot => {
      let c: Combo = { c: s.c ?? -Infinity, t: new Map() };
      for (let i = 0; i < s.t.length; i += 2) c = plus(c, subst.get(s.t[i]) ?? { c: 0, t: new Map([[s.t[i], 1]]) }, s.t[i + 1]);
      return { c: Number.isFinite(c.c) ? c.c : null, t: [...c.t].flatMap(([k, v]) => [renum.get(k)!, v]) };
    };
    slots.splice(0, slots.length, ...slots.map(rewrite));
    const kept = keep.map((i) => theta[i]);
    theta.splice(0, theta.length, ...kept);
  }

  const usedCols = [...new Set([...dv, ...covariates, ...Object.values(known).map((k) => k.column), ...(weight ? [weight] : [])])];
  const colOrder = cols.filter((c) => usedCols.includes(c));
  const starts = opt.starts ?? (startsInit ?? 20);
  const spec: MixtureSpec = {
    columns: colOrder, ...(weight ? { weight } : {}), ...(missing.length ? { missing } : {}),
    theta, slots, classes: classSpecs, loglinear: param13n === 'loglinear', blocks, report: reportRows,
    starts: starts === 0 ? 1 : starts, final: starts === 0 ? 1 : (startsFinal ?? Math.max(1, Math.min(4, starts))), seed: opt.seed,
    ...(opt.given ? { given: opt.given } : {}), ...(opt.order ? { order: opt.order } : {}),
  };
  if (theta.length > 400) fail(`${theta.length} free parameters: too many.`);
  void blockKeys;
  return { spec, classes: classes.map((c) => ({ name: c.name, k: c.k, known: !!c.known })), parameterization: param13n, notes };
}

const KEYWORDS = new Set(['classes', 'categorical', 'nominal', 'count', 'censored', 'knownclass', 'freqweight', 'usevariables', 'usevariable', 'usevar', 'usev', 'missing', 'parameterization',
  'starts', 'type', 'estimator', 'names', 'processors', 'stiterations', 'algorithm', 'stscale', 'lrtstarts', 'model', 'constraint', 'overall', 'by', 'on', 'with', 'is', 'are',
  'variable', 'analysis', 'mixture', 'mlr', 'logit', 'loglinear', 'probability', 'all', 'new']);
/** The data columns a syntax names (without the data: ranges by their numeric suffix), for listing an example's columns. */
export function mixtureColumns(syntax: string): string[] {
  // (MODEL CONSTRAINT is about parameter labels, not data columns: left out)
  const text = syntax.replace(/!.*$/gm, ' ').replace(/MODEL\s+CONSTRAINT\s*:[\s\S]*?(?=MODEL\s+\w+\s*:|$)/gi, ' ');
  const known = [...text.matchAll(/KNOWNCLASS\s*=\s*\w+\s*\(([^)]*)\)/gi)].flatMap((m) => [...m[1].matchAll(/([A-Za-z_]\w*)\s*=/g)].map((x) => x[1]));
  const classes = new Set([...text.matchAll(/CLASSES\s*=([^;]*);/gi)].flatMap((m) => [...m[1].matchAll(/([A-Za-z_]\w*)\s*\(/g)].map((x) => lc(x[1]))));
  const factors = new Set([...text.matchAll(/(?:^|;|%)\s*([A-Za-z_][\w\s-]*?)\s+(?:BY\b|\|)/gim)].flatMap((m) => m[1].trim().split(/\s+/).map(lc)));
  const body = text.replace(/\([^)]*\)/g, ' ').replace(/%[^%]*%/g, ' ').replace(/\s*-\s*(?=[A-Za-z_])/g, '-');
  const out: string[] = [];
  for (const tok of body.match(/[A-Za-z_][\w$#]*(?:-[A-Za-z_][\w$#]*)?/g) ?? []) {
    const parts = tok.split('-').map((x) => x.replace(/[$#]\d+$/, ''));
    if (parts.some((x) => KEYWORDS.has(lc(x)) || classes.has(lc(x)) || factors.has(lc(x)))) continue;
    if (parts.length === 2) {
      const a = /^(.*?)(\d+)$/.exec(parts[0]), b = /^(.*?)(\d+)$/.exec(parts[1]);
      if (a && b && a[1] === b[1]) { for (let i = Number(a[2]); i <= Number(b[2]); i++) out.push(`${a[1]}${i}`); continue; }
    }
    out.push(...parts);
  }
  return [...new Set([...out, ...known])];
}
