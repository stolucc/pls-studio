// Model syntax in and out: lavaan syntax (and Mplus MODEL syntax, converted
// to lavaan by lavaan::mplus2lavaan.modelSyntax in R) into a diagram, and the
// diagram as an Mplus input file. What the diagram cannot hold is reported,
// not silently dropped.

import { autoLayout } from './layout';
import type { BetweenStatement, Construct, Correlation, DataInfo, DefinedParameter, IndicatorPath, MeanTerm, ModelState, Moderation, ParameterTerm, Path, Settings } from './project';
import { newId } from './project';
import type { GroupValue } from '../engine/types';
import { parseConstraint, parseInequality } from './expr';

export const MAX_SYNTAX = 20_000;

type Term = { name: string; fixed?: number; label?: string; free?: boolean; byGroup?: GroupValue[] };

/** lavaan's per-group modifier c(a, 1, NA): labels, values and NA (free), or null when it is not one. */
function groupValues(m: string): GroupValue[] | null {
  const inner = /^c\((.*)\)$/.exec(m.trim());
  if (!inner) return null;
  const out: GroupValue[] = [];
  for (const raw of inner[1].split(',')) {
    const v = raw.trim().replace(/^["']|["']$/g, '');
    if (v === 'NA') out.push(null);
    else if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) out.push(Number(v));
    else if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(v)) out.push(v);
    else return null;
  }
  return out.length >= 2 ? out : null;
}

/** One modifier*variable term of a lavaan formula (`perGroup`: c(...) is kept whole, where the diagram holds values per group). */
function parseTerm(raw: string, warn: (s: string) => void, perGroup = false): Term | null {
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
    if (perGroup && groupValues(m)) { out.byGroup = groupValues(m)!; continue; }
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
  const all = formulas(text);
  if (!all.length) throw new Error('No model syntax found.');
  // Two-level syntax (level: 1 / level: 2 blocks): the within level is the diagram, the between level is kept as
  // written (ModelState.multilevel.betweenModel); defined parameters and constraints belong to the whole model.
  const LEVEL = /^level\s*:\s*(\S+)$/i;
  const levels = all.some((l) => LEVEL.test(l));
  const lines: string[] = [], betweenLines: string[] = [];
  let level = 1;
  for (const l of all) {
    const m = LEVEL.exec(l);
    if (m) {
      if (/^(1|within)$/i.test(m[1])) level = 1;
      else if (/^(2|between)$/i.test(m[1])) level = 2;
      else throw new Error(`“${l}”: two levels are supported (level: 1 and level: 2).`);
      continue;
    }
    (level === 2 && !/:=|==|[<>]/.test(l) ? betweenLines : lines).push(l);
  }
  const OPS = ['=~', '~~', '~*~', ':=', '==', '<', '>', '~', '|', '%'] as const;
  type Row = { lhs: string[]; op: string; rhs: string };
  const toRows = (src: string[]) => {
    const out: Row[] = [];
    for (const line of src) {
      let op: string | null = null, at = -1;
      for (const o of OPS) { const i = line.indexOf(o); if (i >= 0 && (at < 0 || i < at || (i === at && o.length > op!.length))) { op = o; at = i; } }
      if (!op) { warn(`“${line}” is not a lavaan formula and was skipped.`); continue; }
      const lhs = line.slice(0, at).split('+').map((s) => s.trim()).filter(Boolean), rhs = line.slice(at + op.length).trim();
      if (op === '~' && /^1$/.test(rhs.replace(/^.*\*/, '').trim()) && !rhs.includes('+')) out.push({ lhs, op: '~1', rhs });
      else out.push({ lhs, op, rhs });
    }
    return out;
  };
  const rows = toRows(lines);
  const betweenModel: BetweenStatement[] = [];
  for (const r of toRows(betweenLines)) {
    if (r.op !== '=~' && r.op !== '~' && r.op !== '~~' && r.op !== '~1') { warn(`Between level: “${r.lhs.join(' + ')} ${r.op} ${r.rhs}” is not kept.`); continue; }
    for (const l of r.lhs) {
      if (!/^[A-Za-z_.][A-Za-z0-9_.]*$/.test(l)) { warn(`Between level: “${l}” is not a variable name; the line was skipped.`); continue; }
      if (r.op === '~1') {
        const mods = r.rhs.replace(/\*?\s*1\s*$/, '').trim();
        const t: BetweenStatement['rhs'][number] = { name: '1' };
        if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(mods)) t.fixed = Number(mods); else if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(mods) && mods !== 'NA') t.label = mods; else if (mods && mods !== 'NA') warn(`Between level: modifier “${mods}” on the intercept of ${l} was ignored.`);
        betweenModel.push({ lhs: l, op: '~1', rhs: [t] });
        continue;
      }
      const terms = r.rhs.split('+').map((t) => parseTerm(t, warn)).filter((t): t is Term => !!t)
        .filter((t) => { if (t.name.includes(':')) { warn(`Between level: the interaction ${t.name} is not kept.`); return false; } return true; })
        .map((t) => ({ name: t.name, ...(t.fixed !== undefined ? { fixed: t.fixed } : {}), ...(t.label ? { label: t.label } : {}) }));
      if (terms.length) betweenModel.push({ lhs: l, op: r.op, rhs: terms });
    }
  }
  // Latent variables and their indicators.
  const latent = new Map<string, { terms: Term[] }>();
  for (const r of rows) if (r.op === '=~') for (const l of r.lhs) {
    const e = latent.get(l) ?? { terms: [] };
    for (const t of r.rhs.split('+')) {
      const term = parseTerm(t, warn);
      if (!term) continue;
      // (NA*y1 + l*y1: one loading, freed and labelled)
      const have = e.terms.find((x) => x.name === term.name);
      if (have) { if (term.free) have.free = true; if (term.label && !have.label) have.label = term.label; continue; }
      e.terms.push(term);
    }
    latent.set(l, e);
  }
  const constructs: Construct[] = [];
  const byName = new Map<string, Construct>();
  const add = (c: Construct) => { constructs.push(c); byName.set(c.name, c); return c; };
  // A factor scaled by its variance: the first loading freed (NA*) and the variance fixed at 1 (f ~~ 1*f), or at 1 in a
  // reference group (f ~~ c(NA, 1)*f: approximate invariance, Mplus ex. 5.33).
  const unitVariance = new Set(rows.filter((r) => r.op === '~~').flatMap((r) => r.lhs.filter((l) => r.rhs.split('+').some((t) => { const x = parseTerm(t, () => {}, true); return x?.name === l && ((x.fixed === 1 && !x.byGroup) || !!x.byGroup?.includes(1)); }))));
  const byVariance = new Set<string>();
  for (const [name, e] of latent) {
    const c: Construct = { id: newId('c'), name, type: 'factor', mode: 'A', indicators: e.terms.map((t) => t.name), x: 0, y: 0, side: 'left' };
    if (e.terms[0]?.free && e.terms[0].fixed === undefined && unitVariance.has(name)) { c.scaling = 'variance'; byVariance.add(name); }
    const fixed: Record<string, number> = {}, labels: Record<string, string> = {};
    e.terms.forEach((t, i) => {
      if (t.fixed !== undefined && !(i === 0 && t.fixed === 1)) fixed[t.name] = t.fixed;
      if (t.label) labels[t.name] = t.label;
      if (t.free && i === 0 && !c.scaling) warn(`${name}: a free first loading (NA*${t.name}) is not kept without its variance fixed (${name} ~~ 1*${name}); the first indicator is the marker.`);
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
      // Component loadings held at values (a latent curve of factors: i =~ 1*f1 + 1*f2 + 1*f3; s =~ 0*f1 + 1*f2 + 2*f3).
      const held = Object.entries(c.fixedLoadings ?? {}).filter(([n]) => comps.includes(n));
      if (held.length) c.componentLoadings = Object.fromEntries(held.map(([n, v]) => [byName.get(n)!.id, v]));
      delete c.fixedLoadings;
      if (Object.keys(c.loadingLabels ?? {}).some((n) => comps.includes(n))) warn(`${c.name}: labels on the loadings of its components are not kept.`);
      delete c.loadingLabels;
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
  // An indicator of a factor as an outcome (y1 ~ x1): a direct effect on the indicator, beside its loading.
  const onIndicator = (l: string) => indicatorOf.has(l) && !byName.has(l);
  const indicatorPaths: IndicatorPath[] = [];
  for (const r of regs) for (const l of r.lhs) if (!onIndicator(l)) observed(l, false);
  for (const r of regs) for (const l of r.lhs) {
    if (onIndicator(l)) {
      for (const t of r.rhs.split('+')) {
        const term = parseTerm(t, warn);
        if (!term) continue;
        if (term.name.includes(':')) { warn(`${l} ~ ${term.name}: an interaction on an indicator is not kept.`); continue; }
        const from = observed(term.name, !regs.some((q) => q.lhs.includes(term.name)));
        if (indicatorOf.get(l)!.id === from.id) { warn(`${l} ~ ${term.name}: that is the loading of ${l}; the line was skipped.`); continue; }
        if (!indicatorPaths.some((p) => p.from === from.id && p.to === l)) indicatorPaths.push({ id: newId('ip'), from: from.id, to: l, ...(term.fixed !== undefined ? { fixed: term.fixed } : {}), ...(term.label ? { label: term.label } : {}) });
      }
      continue;
    }
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
  // Observed variables that appear only in variances, covariances, intercepts or thresholds (y1 ~~ y2; u1 | t1):
  // single-indicator constructs, as lavaan takes them.
  const plainName = (x: string) => /^[A-Za-z_.][A-Za-z0-9_.]*$/.test(x);
  for (const r of rows.filter((x) => x.op === '~~' || x.op === '~1' || x.op === '|')) {
    const names = [...r.lhs, ...(r.op === '~~' ? r.rhs.split('+').map((t) => t.split('*').pop()!.trim()) : [])];
    for (const x of names) if (x && plainName(x) && !byName.has(x) && !indicatorOf.has(x)) observed(x, false);
  }
  // Variances, intercepts and thresholds held at values or labelled.
  const parameters: ParameterTerm[] = [];
  const held = (t: Term) => t.fixed !== undefined || !!t.label || !!t.byGroup?.length;
  const valueOf = (t: Term) => (t.byGroup?.length ? { byGroup: t.byGroup } : t.fixed !== undefined ? { fixed: t.fixed } : t.label ? { label: t.label } : {});
  // Ordinal variables (those with thresholds): a residual variance written out frees it (theta parameterisation).
  const withThresholds = new Set(rows.filter((x) => x.op === '|').flatMap((x) => x.lhs));
  // Covariances.
  const correlations: Correlation[] = [];
  for (const r of rows.filter((x) => x.op === '~~')) for (const l of r.lhs) for (const t of r.rhs.split('+')) {
    const term = parseTerm(t, warn, true);
    if (!term) continue;
    if (term.name === l) {
      if (!held(term)) {
        // (lavaan fixes an ordinal indicator's residual variance in the theta parameterisation; written out, it is free)
        if (indicatorOf.has(l) && (term.free || withThresholds.has(l)) && !byName.has(l)) parameters.push({ id: newId('v'), kind: 'variance', target: l, indicator: true, free: true });
        continue;
      }
      // A construct's variance (an observed variable's, when it stands for itself), or an indicator's residual variance.
      const c = byName.get(l);
      if (c?.covariate) { warn(`The variance of ${l} is not kept: an exogenous observed variable's is the sample's (fixed.x).`); continue; }
      if (c && byVariance.has(l) && term.fixed === 1 && !term.byGroup) continue;  // (the factor's scaling)
      if (c) parameters.push({ id: newId('v'), kind: 'variance', target: c.id, ...valueOf(term) });
      else if (indicatorOf.has(l)) parameters.push({ id: newId('v'), kind: 'variance', target: l, indicator: true, ...valueOf(term) });
      continue;
    }
    const ca = byName.get(l), cb = byName.get(term.name), ia = indicatorOf.get(l), ib = indicatorOf.get(term.name);
    const extra = { ...(term.byGroup?.length ? { byGroup: term.byGroup } : {}), ...(term.fixed !== undefined ? (term.fixed === 0 ? { zero: true } : { fixed: term.fixed }) : {}), ...(term.label ? { label: term.label } : {}) };
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
    const c = byName.get(l);
    // (an indicator's intercept may carry values per group: c(...))
    if (mods && !c && indicatorOf.has(l) && groupValues(mods)) term.byGroup = groupValues(mods)!;
    // (a factor's mean too: f ~ c(NA, 0)*1 holds it at 0 in a reference group only)
    else if (mods && c && groupValues(mods)) term.byGroup = groupValues(mods)!;
    else if (mods) { if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(mods)) term.fixed = Number(mods); else if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(mods) && mods !== 'NA') term.label = mods; else if (mods !== 'NA') warn(`Modifier “${mods}” on the intercept of ${l} was ignored.`); }
    if (!c) {
      // (0 on a factor's marker is the marker convention; on another indicator it is kept, e.g. a growth model's y2 ~ 0*1)
      if (term.fixed === 0 && (!indicatorOf.has(l) || constructs.some((k) => k.indicators[0] === l))) continue;
      // An indicator's intercept, labelled or held (equal intercepts: y1 ~ i*1; y2 ~ i*1); a free one is free anyway.
      if (indicatorOf.has(l)) { if (held(term) && !parameters.some((p) => p.kind === 'intercept' && p.target === l)) parameters.push({ id: newId('i'), kind: 'intercept', target: l, indicator: true, ...valueOf(term) }); continue; }
      warn(`${l} ~ 1: “${l}” is not in the model; its intercept was skipped.`); continue;
    }
    if (term.fixed === 0 && c.indicators.length > 1) continue;
    if (!means.some((m) => m.target === c.id)) means.push({ id: newId('mt'), target: c.id, ...(term.byGroup ? { byGroup: term.byGroup } : term.fixed !== undefined ? { fixed: term.fixed } : term.label ? { label: term.label } : {}) });
  }
  const defined: DefinedParameter[] = rows.filter((x) => x.op === ':=').map((r) => ({ id: newId('d'), name: r.lhs[0], expr: r.rhs }));
  // Thresholds (u1 | t*t1 + t2): the variable is ordinal; labelled or held thresholds are kept.
  const ordered: string[] = [];
  const constraintLines: string[] = [];
  for (const r of rows) {
    if (r.op === '==' || r.op === '<' || r.op === '>') {
      const line = `${r.lhs.join(' + ')} ${r.op} ${r.rhs}`;
      try { if (r.op === '==') parseConstraint(line); else parseInequality(line); constraintLines.push(line); }
      catch (x) { warn(`Constraint “${line}” is not kept: ${(x as Error).message}`); }
    }
    if (r.op === '|') for (const l of r.lhs) {
      const ind = indicatorOf.has(l) ? l : byName.get(l)?.indicators.length === 1 ? byName.get(l)!.indicators[0] : null;
      if (!ind) { warn(`Thresholds of ${l} are not kept: “${l}” is not a variable of the model.`); continue; }
      if (!ordered.includes(ind)) ordered.push(ind);
      for (const t of r.rhs.split('+')) {
        const term = parseTerm(t, warn, true);
        if (!term) continue;
        const k = /^t(\d+)$/.exec(term.name);
        if (!k) { warn(`${l} | ${t.trim()}: thresholds are named t1, t2, …; the term was skipped.`); continue; }
        if (held(term)) parameters.push({ id: newId('t'), kind: 'threshold', target: ind, indicator: true, ...(Number(k[1]) !== 1 ? { threshold: Number(k[1]) } : {}), ...valueOf(term) });
      }
    }
    // Scale factors of ordinal indicators (delta parameterisation; u2 ~*~ u2 frees one, u1 ~*~ 1*u1 holds it).
    if (r.op === '~*~') for (const l of r.lhs) for (const t of r.rhs.split('+')) {
      const term = parseTerm(t, warn, true);
      if (!term) continue;
      if (term.name !== l || !indicatorOf.has(l)) { warn(`“${l} ~*~ ${t.trim()}” is not kept: a scale factor is an indicator’s own (u1 ~*~ u1).`); continue; }
      parameters.push({ id: newId('s'), kind: 'scale', target: l, indicator: true, ...(held(term) ? valueOf(term) : { free: true as const }) });
    }
    if (r.op === '%') warn(`“${r.lhs.join(' + ')} ${r.op} ${r.rhs}” is not kept.`);
  }
  if (!constructs.length) throw new Error('The syntax defines no variables (no =~ or ~ lines).');
  const model: ModelState = {
    constructs, paths, moderations,
    ...(correlations.length ? { correlations } : {}),
    ...(constant ? { constant: { x: -220, y: 120 } } : {}),
    ...(means.length ? { means } : {}),
    ...(defined.length ? { defined } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(indicatorPaths.length ? { indicatorPaths } : {}),
    ...(ordered.length ? { ordered } : {}),
    ...(constraintLines.length ? { inequalities: constraintLines.join('\n') } : {}),
    // (the cluster column is not in the syntax: chosen under Clusters, or given by an example)
    ...(levels ? { multilevel: betweenModel.length ? { column: '', between: 'model' as const, betweenModel } : { column: '', between: 'saturated' as const } } : {}),
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
      return `${nm(i)}${f !== undefined ? `@${f}` : k === 0 && c.scaling !== 'variance' ? '' : '*'}${l ? ` (${l})` : ''}`;
    });
    lines.push(statement(`${nm(c.name)} BY`, terms));
    // (scaled by its variance: every loading free, the variance fixed at 1)
    if (c.scaling === 'variance') lines.push(`${nm(c.name)}@1;`);
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
  // Direct effects on indicators.
  for (const p of model.indicatorPaths ?? []) {
    const f = byId.get(p.from);
    if (f) lines.push(`${nm(p.to)} ON ${lvName(f)}${p.fixed !== undefined ? `@${p.fixed}` : ''}${p.label ? ` (${p.label})` : ''};`);
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
  // Held or labelled variances, intercepts and thresholds (one value for all groups; values per group are not written).
  for (const t of model.parameters ?? []) {
    if (t.byGroup?.length) continue;
    const c = t.indicator ? undefined : byId.get(t.target);
    if (!t.indicator && !c) continue;
    const v = t.indicator ? nm(t.target) : lvName(c!);
    const at = t.fixed !== undefined ? `@${t.fixed}` : '', lab = t.label && t.fixed === undefined ? ` (${t.label})` : '';
    if (t.kind === 'variance') lines.push(`${v}${at}${lab};`);
    else if (t.kind === 'scale') lines.push(`{${v}${at}}${lab};`);
    else if (t.kind === 'intercept') lines.push(`[${v}${at}]${lab};`);
    else lines.push(`[${v}$${t.threshold ?? 1}${at}]${lab};`);
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
    `ANALYSIS: ESTIMATOR = ${ESTIMATOR[settings.estimator] ?? 'ML'};${model.cluster ? ' TYPE = COMPLEX;' : ''}${xwith.length ? ' TYPE = RANDOM; ALGORITHM = INTEGRATION;' : ''}${settings.missing === 'casewise' ? ' LISTWISE = ON;' : ''}${model.parameterization === 'theta' && ordered.length ? ' PARAMETERIZATION = THETA;' : ''}`,
    'MODEL:',
    ...xwith.map((l) => `  ${l}`),
    ...lines.map((l) => `  ${l}`),
  ];
  if (model.defined?.length) inp.push('MODEL CONSTRAINT:', `  NEW(${model.defined.map((d) => d.name).join(' ')});`, ...model.defined.map((d) => `  ${d.name} = ${d.expr};`));
  if (model.multilevel) warn('Two-level models are not written (Mplus: TYPE = TWOLEVEL with %WITHIN% and %BETWEEN% blocks); the single-level model is.');
  if (model.esem?.blocks.length) warn('ESEM blocks are not written; the factors are written as a CFA.');
  if (model.parameters?.some((t) => t.byGroup?.length) || model.correlations?.some((k) => k.byGroup?.length)) warn('Values per group are not written; add them as group-specific MODEL commands (MODEL g2: …).');
  if (settings.estimator === '2SLS' || settings.estimator === 'RML') warn(`Mplus has no ${settings.estimator}; ML is written.`);
  if (model.multigroup && (model.multigroup.column)) { const g = nm(model.multigroup.column); mark(g); if (!inp[3].includes(g)) inp[3] = `${inp[3].slice(0, -1)} ${g};`; }
  for (const col of [model.cluster, model.weights]) if (col) { const n = nm(col); if (!inp[3].includes(n)) inp[3] = `${inp[3].slice(0, -1)} ${n};`; }
  inp.push('OUTPUT: STANDARDIZED;');
  const dat = data && !(info?.kind === 'matrix')
    ? Array.from({ length: data.cols[0]?.length ?? 0 }, (_, i) => data.cols.map((c) => (Number.isFinite(c[i]) ? String(c[i]) : '-999')).join(' ')).join('\n')
    : '';
  return { inp: inp.join('\n'), dat, warnings };
}
