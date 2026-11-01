// Model syntax in and out: lavaan syntax (and Mplus MODEL syntax, converted
// to lavaan by lavaan::mplus2lavaan.modelSyntax in R) into a diagram, and the
// diagram as an Mplus input file. What the diagram cannot hold is reported,
// not silently dropped.

import { autoLayout } from './layout';
import type { Construct, Correlation, DataInfo, DefinedParameter, MeanTerm, ModelState, Moderation, Path, Settings } from './project';
import { newId } from './project';

export const MAX_SYNTAX = 20_000;

type Term = { name: string; fixed?: number; label?: string; free?: boolean };

/** One modifier*variable term of a lavaan formula. */
function parseTerm(raw: string, warn: (s: string) => void): Term | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split('*').map((p) => p.trim());
  const name = parts.pop()!;
  if (!/^[A-Za-z_.][A-Za-z0-9_.:]*$/.test(name)) { warn(`“${name}” is not a variable name; the term was skipped.`); return null; }
  const out: Term = { name };
  for (const m of parts) {
    if (m === '' ) continue;
    if (m === 'NA') { out.free = true; continue; }
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(m)) { out.fixed = Number(m); continue; }
    if (/^c\(/.test(m)) { const first = m.slice(2, -1).split(',')[0].trim().replace(/^["']|["']$/g, ''); warn(`Per-group values “${m}” on ${name}: only the first (${first}) is kept.`); if (/^[-+]?\d/.test(first)) out.fixed = Number(first); else if (first !== 'NA') out.label = first; continue; }
    if (/^(start|label|equal)\(/.test(m)) { if (m.startsWith('label(')) out.label = m.slice(6, -1).replace(/^["']|["']$/g, ''); else warn(`“${m}” on ${name} is not kept.`); continue; }
    if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(m)) { out.label = m; continue; }
    warn(`Modifier “${m}” on ${name} is not understood and was ignored.`);
  }
  return out;
}

/** Split lavaan syntax into formulas: newlines and semicolons separate, # and ! start comments. */
export function formulas(text: string): string[] {
  return text.split(/\r?\n|;/).map((l) => l.replace(/[#!].*$/, '').trim()).filter(Boolean);
}

export interface ParsedSyntax { model: ModelState; warnings: string[] }

/**
 * A diagram from lavaan model syntax: =~ (factors and indicators), ~
 * (paths; observed regressors become covariates, X:Z a moderation), ~~
 * (correlations between constructs or between indicators), ~1 (the
 * constant with latent means and intercepts), := (defined parameters).
 * Labels and fixed values are kept where the diagram has a place for them.
 */
export function parseLavaanSyntax(text: string): ParsedSyntax {
  if (text.length > MAX_SYNTAX) throw new Error(`The syntax is too long (at most ${MAX_SYNTAX.toLocaleString()} characters).`);
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const lines = formulas(text);
  if (!lines.length) throw new Error('No model syntax found.');
  const OPS = ['=~', '~~', '~*~', ':=', '==', '<', '>', '~', '|', '%'] as const;
  type Row = { lhs: string[]; op: string; rhs: string };
  const rows: Row[] = [];
  for (const line of lines) {
    let op: string | null = null, at = -1;
    for (const o of OPS) { const i = line.indexOf(o); if (i >= 0 && (at < 0 || i < at || (i === at && o.length > op!.length))) { op = o; at = i; } }
    if (!op) { warn(`“${line}” is not a lavaan formula and was skipped.`); continue; }
    const lhs = line.slice(0, at).split('+').map((s) => s.trim()).filter(Boolean), rhs = line.slice(at + op.length).trim();
    if (op === '~' && /^1$/.test(rhs.replace(/^.*\*/, '').trim()) && !rhs.includes('+')) rows.push({ lhs, op: '~1', rhs });
    else rows.push({ lhs, op, rhs });
  }
  // Latent variables and their indicators.
  const latent = new Map<string, { terms: Term[] }>();
  for (const r of rows) if (r.op === '=~') for (const l of r.lhs) {
    const e = latent.get(l) ?? { terms: [] };
    for (const t of r.rhs.split('+')) { const term = parseTerm(t, warn); if (term && !e.terms.some((x) => x.name === term.name)) e.terms.push(term); }
    latent.set(l, e);
  }
  const constructs: Construct[] = [];
  const byName = new Map<string, Construct>();
  const add = (c: Construct) => { constructs.push(c); byName.set(c.name, c); return c; };
  for (const [name, e] of latent) {
    const c: Construct = { id: newId('c'), name, type: 'factor', mode: 'A', indicators: e.terms.map((t) => t.name), x: 0, y: 0, side: 'left' };
    const fixed: Record<string, number> = {}, labels: Record<string, string> = {};
    e.terms.forEach((t, i) => {
      if (t.fixed !== undefined && !(i === 0 && t.fixed === 1)) fixed[t.name] = t.fixed;
      if (t.label) labels[t.name] = t.label;
      if (t.free && i === 0) warn(`${name}: a free first loading (NA*${t.name}) is not kept; the first indicator is the marker.`);
    });
    if (Object.keys(fixed).length) c.fixedLoadings = fixed;
    if (Object.keys(labels).length) c.loadingLabels = labels;
    add(c);
  }
  const indicatorOf = new Map<string, Construct>();
  for (const c of constructs) for (const i of c.indicators) indicatorOf.set(i, c);
  // Second-order factors: a factor whose indicators are factors.
  for (const c of constructs) {
    const comps = c.indicators.filter((i) => byName.has(i));
    if (comps.length) {
      if (comps.length !== c.indicators.length) warn(`${c.name} mixes factors and indicators; only the factors are kept as its components.`);
      c.components = comps.map((n) => byName.get(n)!.id);
      c.indicators = [];
    }
  }
  /** An observed variable in the structural part: a single-indicator construct (a covariate when exogenous). */
  const observed = (name: string, exogenous: boolean): Construct => {
    const have = byName.get(name);
    if (have) return have;
    const owner = indicatorOf.get(name);
    if (owner) warn(`“${name}” is an indicator of ${owner.name} and also a variable in the structural model; it was made its own observed variable.`);
    return add({ id: newId('c'), name, type: 'factor', mode: 'A', indicators: [name], x: 0, y: 0, side: 'left', ...(exogenous ? { covariate: true } : {}) });
  };
  // Regressions (first pass: outcomes exist; second: predictors, interactions).
  const paths: Path[] = [], moderations: Moderation[] = [];
  const interactions: { x: string; z: string; to: string; label?: string }[] = [];
  const regs = rows.filter((r) => r.op === '~');
  for (const r of regs) for (const l of r.lhs) observed(l, false);
  for (const r of regs) for (const l of r.lhs) {
    const to = byName.get(l)!;
    for (const t of r.rhs.split('+')) {
      const term = parseTerm(t, warn);
      if (!term) continue;
      if (term.name.includes(':')) { const [x, z] = term.name.split(':'); interactions.push({ x, z, to: l, label: term.label }); continue; }
      const from = observed(term.name, !regs.some((q) => q.lhs.includes(term.name)));
      if (from.id === to.id) { warn(`${l} ~ ${term.name}: a variable cannot predict itself.`); continue; }
      if (paths.some((p) => p.from === from.id && p.to === to.id)) continue;
      paths.push({ id: newId('p'), from: from.id, to: to.id, ...(term.fixed !== undefined ? { fixed: term.fixed } : {}), ...(term.label ? { label: term.label } : {}) });
    }
  }
  for (const it of interactions) {
    const x = observed(it.x, true), z = observed(it.z, true), to = byName.get(it.to)!;
    let p = paths.find((q) => q.from === x.id && q.to === to.id);
    if (!p) { p = { id: newId('p'), from: x.id, to: to.id }; paths.push(p); warn(`${it.to} ~ ${it.x}:${it.z}: the main effect of ${it.x} was added (a moderation needs the path it moderates).`); }
    if (!paths.some((q) => q.from === z.id && q.to === to.id)) paths.push({ id: newId('p'), from: z.id, to: to.id });
    moderations.push({ id: newId('m'), moderator: z.id, path: p.id });
    if (it.label) warn(`The label on ${it.x}:${it.z} is not kept (moderations carry no label).`);
  }
  // Covariances.
  const correlations: Correlation[] = [];
  for (const r of rows.filter((x) => x.op === '~~')) for (const l of r.lhs) for (const t of r.rhs.split('+')) {
    const term = parseTerm(t, warn);
    if (!term) continue;
    if (term.name === l) { if (term.fixed !== undefined || term.label) warn(`The variance of ${l} (${l} ~~ ${t.trim()}) is not kept; variances are estimated freely.`); continue; }
    const ca = byName.get(l), cb = byName.get(term.name), ia = indicatorOf.get(l), ib = indicatorOf.get(term.name);
    const extra = { ...(term.fixed !== undefined ? (term.fixed === 0 ? { zero: true } : { fixed: term.fixed }) : {}), ...(term.label ? { label: term.label } : {}) };
    if (ca && cb) {
      if (ca.covariate || cb.covariate) { warn(`${l} ~~ ${term.name}: covariates are fixed (fixed.x), their covariance is the sample's; not drawn.`); continue; }
      if (!correlations.some((k) => k.kind === 'construct' && ((k.a === ca.id && k.b === cb.id) || (k.a === cb.id && k.b === ca.id)))) correlations.push({ id: newId('k'), kind: 'construct', a: ca.id, b: cb.id, ...extra });
    } else if (ia && ib) {
      if (!correlations.some((k) => k.kind === 'indicator' && ((k.a === l && k.b === term.name) || (k.a === term.name && k.b === l)))) correlations.push({ id: newId('k'), kind: 'indicator', a: l, b: term.name, ...extra });
    } else warn(`${l} ~~ ${term.name}: the diagram correlates two constructs or two indicators; this pair is neither and was skipped.`);
  }
  // Means and intercepts.
  const means: MeanTerm[] = [];
  let constant = false;
  for (const r of rows.filter((x) => x.op === '~1')) for (const l of r.lhs) {
    constant = true;
    // "F ~ 1", "x ~ 0*1", "F ~ m*1": the modifiers precede the 1.
    const mods = r.rhs.replace(/\*?\s*1\s*$/, '').trim();
    const term: Term = { name: l };
    if (mods) { if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(mods)) term.fixed = Number(mods); else if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(mods) && mods !== 'NA') term.label = mods; else if (mods !== 'NA') warn(`Modifier “${mods}” on the intercept of ${l} was ignored.`); }
    const c = byName.get(l);
    if (!c) { if (term.fixed === 0) continue; if (indicatorOf.has(l)) continue; warn(`${l} ~ 1: “${l}” is not in the model; its intercept was skipped.`); continue; }
    if (term.fixed === 0 && c.indicators.length > 1) continue;
    if (!means.some((m) => m.target === c.id)) means.push({ id: newId('mt'), target: c.id, ...(term.fixed !== undefined ? { fixed: term.fixed } : term.label ? { label: term.label } : {}) });
  }
  const defined: DefinedParameter[] = rows.filter((x) => x.op === ':=').map((r) => ({ id: newId('d'), name: r.lhs[0], expr: r.rhs }));
  for (const r of rows) {
    if (r.op === '==' || r.op === '<' || r.op === '>') warn(`Constraint “${r.lhs.join(' + ')} ${r.op} ${r.rhs}” is not kept; add it under Constraints.`);
    if (r.op === '|') warn(`Thresholds (${r.lhs.join(', ')} | …) are not kept; mark the indicator as ordinal instead.`);
    if (r.op === '~*~' || r.op === '%') warn(`“${r.lhs.join(' + ')} ${r.op} ${r.rhs}” is not kept.`);
  }
  if (!constructs.length) throw new Error('The syntax defines no variables (no =~ or ~ lines).');
  const model: ModelState = {
    constructs, paths, moderations,
    ...(correlations.length ? { correlations } : {}),
    ...(constant ? { constant: { x: -220, y: 120 } } : {}),
    ...(means.length ? { means } : {}),
    ...(defined.length ? { defined } : {}),
  };
  model.constructs = autoLayout(model);
  return { model, warnings };
}

/** Whether the text is Mplus MODEL syntax rather than lavaan's. */
export const looksLikeMplus = (text: string) => !/=~|~~|~1|:=/.test(text) && /\b(BY|ON|WITH)\b/i.test(text);

const ESTIMATOR: Partial<Record<Settings['estimator'], string>> = { ML: 'ML', MLM: 'MLM', MLMV: 'MLMV', MLR: 'MLR', GLS: 'GLS', ULS: 'ULS', WLS: 'WLS', WLSMV: 'WLSMV' };

/** Mplus variable names: at most 8 characters in older versions; letters, digits and _ only. */
export function mplusName(name: string, taken: Map<string, string>): string {
  const have = taken.get(name);
  if (have) return have;
  let base = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=[0-9_])/, 'v');
  if (!base) base = 'v';
  let out = base, k = 2;
  while ([...taken.values()].includes(out)) out = `${base}_${k++}`;
  taken.set(name, out);
  return out;
}

/** A BY / ON statement: a parenthesised label applies to every parameter on its line in Mplus, so labelled terms get a line each. */
function statement(head: string, terms: string[]): string {
  if (!terms.some((t) => t.includes('('))) return `${head} ${terms.join(' ')};`;
  return `${head}\n    ${terms.join('\n    ')};`;
}

export interface MplusExport { inp: string; dat: string; warnings: string[] }

/**
 * The diagram as an Mplus input file plus the data as a headerless .dat
 * (missing values as -999): TITLE, DATA, VARIABLE, ANALYSIS, MODEL and, for
 * defined parameters, MODEL CONSTRAINT.
 */
export function toMplus(model: ModelState, settings: Settings, data: { names: string[]; cols: ArrayLike<number>[] } | null, info: DataInfo | null, project: string): MplusExport {
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const names = new Map<string, string>();
  const nm = (n: string) => mplusName(n, names);
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const lvName = (c: Construct) => (c.covariate || (c.indicators.length === 1 && !c.components?.length) ? nm(c.indicators[0]) : nm(c.name));
  const used: string[] = [];
  const mark = (n: string) => { if (!used.includes(n)) used.push(n); };
  const lines: string[] = [];
  // Measurement.
  for (const c of model.constructs) {
    if (c.components?.length) {
      lines.push(`${nm(c.name)} BY ${c.components.map((id) => lvName(byId.get(id)!)).join(' ')};`);
      continue;
    }
    if (c.covariate || c.indicators.length === 1) { mark(nm(c.indicators[0])); continue; }
    if (c.type === 'composite') warn(`${c.name} is a composite; Mplus has no composite measurement, it is written as a factor (BY).`);
    const terms = c.indicators.map((i, k) => {
      mark(nm(i));
      const f = c.fixedLoadings?.[i], l = c.loadingLabels?.[i];
      return `${nm(i)}${f !== undefined ? `@${f}` : k === 0 ? '' : '*'}${l ? ` (${l})` : ''}`;
    });
    lines.push(statement(`${nm(c.name)} BY`, terms));
  }
  for (const c of model.constructs) if (c.covariate || c.indicators.length === 1) mark(nm(c.indicators[0]));
  // Structural: one ON line per outcome, with XWITH terms for moderations.
  const outcomes = [...new Set(model.paths.map((p) => p.to))];
  const xwith: string[] = [];
  for (const to of outcomes) {
    const t = byId.get(to)!;
    const terms = model.paths.filter((p) => p.to === to).map((p) => {
      const f = byId.get(p.from)!;
      return `${lvName(f)}${p.fixed !== undefined ? `@${p.fixed}` : ''}${p.label ? ` (${p.label})` : ''}`;
    });
    for (const mo of model.moderations.filter((m) => model.paths.find((p) => p.id === m.path)?.to === to)) {
      const p = model.paths.find((q) => q.id === mo.path)!;
      const a = lvName(byId.get(p.from)!), b = lvName(byId.get(mo.moderator)!);
      const name = `${a.slice(0, 3)}x${b.slice(0, 3)}`.replace(/[^A-Za-z0-9_]/g, '_');
      xwith.push(`${name} | ${a} XWITH ${b};`);
      terms.push(name);
    }
    lines.push(statement(`${lvName(t)} ON`, terms));
  }
  // Covariances.
  for (const k of model.correlations ?? []) {
    const a = k.kind === 'construct' ? lvName(byId.get(k.a)!) : nm(k.a), b = k.kind === 'construct' ? lvName(byId.get(k.b)!) : nm(k.b);
    lines.push(`${a} WITH ${b}${k.zero ? '@0' : k.fixed !== undefined ? `@${k.fixed}` : ''}${k.label ? ` (${k.label})` : ''};`);
  }
  // Means and intercepts.
  if (model.constant) for (const m of model.means ?? []) {
    const c = byId.get(m.target);
    if (!c) continue;
    lines.push(`[${lvName(c)}${m.fixed !== undefined ? `@${m.fixed}` : ''}]${m.label ? ` (${m.label})` : ''};`);
    if (m.fixed === undefined && !c.covariate && c.indicators.length > 1) lines.push(`[${nm(c.indicators[0])}@0];`);
  }
  for (const c of model.constructs) if (c.components?.length) for (const id of c.components) { const k = byId.get(id); if (k) for (const i of k.indicators) mark(nm(i)); }
  const ordered = (model.ordered ?? []).map(nm).filter((n) => used.includes(n));
  // Without data: the observed variables only (indicators, covariates, design columns), never the factors.
  const observedNames = [...new Set([...model.constructs.flatMap((c) => c.indicators), ...[model.multigroup?.column, model.cluster, model.weights].filter((x): x is string => !!x)])];
  const dataNames = data ? data.names : observedNames;
  const allNames = dataNames.map(nm);
  const file = `${project.replace(/[^A-Za-z0-9_-]+/g, '_') || 'data'}.dat`;
  const inp: string[] = [
    `TITLE: ${project}`,
    `DATA: FILE = "${file}";${info?.kind === 'matrix' ? ' TYPE = COVARIANCE;' : ''}${info?.kind === 'matrix' ? ` NOBSERVATIONS = ${info.rows};` : ''}`,
    `VARIABLE: NAMES = ${allNames.join(' ')};`,
    `  USEVARIABLES = ${used.join(' ')};`,
    ...(info?.kind === 'matrix' ? [] : ['  MISSING = ALL (-999);']),
    ...(ordered.length ? [`  CATEGORICAL = ${ordered.join(' ')};`] : []),
    ...(model.multigroup ? [`  GROUPING = ${nm(model.multigroup.column)};`] : []),
    ...(model.cluster ? [`  CLUSTER = ${nm(model.cluster)};`] : []),
    ...(model.weights ? [`  WEIGHT = ${nm(model.weights)};`] : []),
    `ANALYSIS: ESTIMATOR = ${ESTIMATOR[settings.estimator] ?? 'ML'};${model.cluster ? ' TYPE = COMPLEX;' : ''}${xwith.length ? ' TYPE = RANDOM; ALGORITHM = INTEGRATION;' : ''}${settings.missing === 'casewise' ? ' LISTWISE = ON;' : ''}`,
    'MODEL:',
    ...xwith.map((l) => `  ${l}`),
    ...lines.map((l) => `  ${l}`),
  ];
  if (model.defined?.length) inp.push('MODEL CONSTRAINT:', `  NEW(${model.defined.map((d) => d.name).join(' ')});`, ...model.defined.map((d) => `  ${d.name} = ${d.expr};`));
  if (model.multilevel) warn('Two-level models are not written (Mplus: TYPE = TWOLEVEL with %WITHIN% and %BETWEEN% blocks); the single-level model is.');
  if (model.esem?.blocks.length) warn('ESEM blocks are not written; the factors are written as a CFA.');
  if (settings.estimator === '2SLS' || settings.estimator === 'RML') warn(`Mplus has no ${settings.estimator}; ML is written.`);
  if (model.multigroup && (model.multigroup.column)) { const g = nm(model.multigroup.column); mark(g); if (!inp[3].includes(g)) inp[3] = `${inp[3].slice(0, -1)} ${g};`; }
  for (const col of [model.cluster, model.weights]) if (col) { const n = nm(col); if (!inp[3].includes(n)) inp[3] = `${inp[3].slice(0, -1)} ${n};`; }
  inp.push('OUTPUT: STANDARDIZED;');
  const dat = data && !(info?.kind === 'matrix')
    ? Array.from({ length: data.cols[0]?.length ?? 0 }, (_, i) => data.cols.map((c) => (Number.isFinite(c[i]) ? String(c[i]) : '-999')).join(' ')).join('\n')
    : '';
  return { inp: inp.join('\n'), dat, warnings };
}
