// AMOS Graphics model files (.amw): UTF-16 text in sections marked !@!xx. The
// !@!dollar section holds the analysis properties ($ml, $bootstrap=500, …), !@!at
// the names of the attributes every object has, !@!ob the objects (one value per
// attribute, in that order), !@!dbname the data file. Object types: 1 observed
// variable (rectangle), 2 unobserved variable (ellipse), 4 single-headed arrow
// (obj1 → obj2, 1-based object numbers), 8 double-headed arrow (obj1 ↔ obj2).
// A parameter value (value1) starts with a control character: \x01 a number
// (a fixed value), \x02 nothing (free); other text is a parameter label.
//
// The model is written as lavaan syntax, which parseLavaanSyntax turns into the
// diagram: an unobserved variable with a single arrow (fixed at 1) into one
// other variable and nothing coming in is that variable's error or disturbance;
// the other unobserved variables are factors measured by the observed variables
// they point at. Positions are AMOS's, in inches.

import { newId, type Correlation, type ModelState } from './project';

export interface AmosObject {
  type: number; label: string; obj1: number; obj2: number; value1: string; value2: string; x: number; y: number;
}

export interface AmosModel {
  /** lavaan syntax of the model. */
  syntax: string;
  /** Diagram positions (AMOS inches) by variable name. */
  positions: Record<string, { x: number; y: number }>;
  /** Analysis properties that map onto the app's settings. */
  settings: { estimator?: 'ML' | 'GLS' | 'ULS'; bootSamples?: number; confidence?: number; seed?: number; means: boolean; unbiasedAnalysis: boolean };
  /** The data file the model was fitted to (AMOS keeps its name, not the data). */
  dataFile: string | null;
  groups: number;
  /** Double-headed arrows between two variables that are not error terms (names): the only covariances among exogenous variables AMOS estimates. */
  covariances: [string, string][];
  warnings: string[];
}

const MAX_AMW = 5_000_000;

/** The file's text: AMOS writes UTF-16 (little-endian, with a byte order mark). */
export function decodeAmw(bytes: Uint8Array): string {
  if (bytes.length > MAX_AMW) throw new Error('The AMOS file is too large.');
  const le = bytes[0] === 0xff && bytes[1] === 0xfe, be = bytes[0] === 0xfe && bytes[1] === 0xff;
  const text = new TextDecoder(le ? 'utf-16le' : be ? 'utf-16be' : 'utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A parameter value: { fixed } for a number, { label } for a name, {} when free. */
export function amosValue(v: string | undefined): { fixed?: number; label?: string } {
  if (!v) return {};
  const body = (v.charCodeAt(0) < 9 ? v.slice(1) : v).trim();
  if (!body) return {};
  const num = Number(body);
  return Number.isFinite(num) ? { fixed: num } : { label: body };
}

/** lavaan names: AMOS allows spaces and other characters that lavaan syntax does not. */
const ident = (s: string) => s.trim().replace(/[^A-Za-z0-9_.]+/g, '_').replace(/^([^A-Za-z.])/, 'v_$1');

export function parseAmw(text: string): AmosModel {
  const lines = text.split(/\r?\n/);
  const at = (marker: string) => lines.indexOf(marker);
  if (!lines[0]?.startsWith('!@!') || at('!@!ob') < 0 || at('!@!at') < 0) throw new Error('Not an AMOS Graphics model file (.amw).');
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };

  // The attributes, then the objects.
  const a = at('!@!at'), na = Number(lines[a + 1]);
  if (!Number.isInteger(na) || na < 5 || na > 500) throw new Error('The AMOS file’s object attributes cannot be read.');
  const attrs = lines.slice(a + 2, a + 2 + na).map((l) => l.split(',')[0]);
  const o = at('!@!ob'), n = Number(lines[o + 1]);
  if (!Number.isInteger(n) || n < 0 || n > 10_000 || o + 2 + n * na > lines.length) throw new Error('The AMOS file’s objects cannot be read.');
  const objs: AmosObject[] = [];
  for (let k = 0; k < n; k++) {
    const r = Object.fromEntries(attrs.map((name, i) => [name, lines[o + 2 + k * na + i] ?? '']));
    objs.push({ type: Number(r.o_type), label: (r.label ?? '').trim(), obj1: Number(r.obj1), obj2: Number(r.obj2), value1: r.value1 ?? '', value2: r.value2 ?? '', x: Number(r.originx), y: Number(r.originy) });
  }

  // Analysis properties.
  const d0 = at('!@!dollar'), d1 = d0 < 0 ? -1 : lines.indexOf('EndDollar', d0);
  const dollar = d0 < 0 ? [] : lines.slice(d0 + 1, d1 < 0 ? undefined : d1);
  const has = (k: string) => dollar.includes(k);
  const num = (k: string) => { const l = dollar.find((x) => x.startsWith(`${k}=`)); const v = l ? Number(l.slice(k.length + 1)) : NaN; return Number.isFinite(v) ? v : undefined; };
  const settings: AmosModel['settings'] = {
    estimator: has('$gls') ? 'GLS' : has('$uls') ? 'ULS' : has('$ml') ? 'ML' : undefined,
    means: !has('$nomeansintercepts'),
    // ($unbiased: the data's covariances are the unbiased ones; $useunbiased fits them as they are, $usebiased rescales to N first)
    unbiasedAnalysis: has('$useunbiased'),
  };
  if (has('$dobootstrap=1')) { const b = num('$bootstrap'); if (b) settings.bootSamples = b; }
  const conf = num('$confidencepc') ?? num('$confidencebc');
  if (conf && conf > 50 && conf < 100) settings.confidence = conf / 100;
  const seed = num('$seed'); if (seed !== undefined) settings.seed = seed;
  if (has('$adf') || has('$sls') || has('$bayes')) warn('The AMOS estimator (ADF, SLS or Bayesian) has no counterpart here; maximum likelihood is used.');
  const g = at('!@!ng'), groups = g >= 0 ? Number(lines[g + 1]) || 1 : 1;
  if (groups > 1) warn(`The AMOS file has ${groups} groups; the diagram is imported once. Set the groups under Groups.`);
  const db = at('!@!dbname');
  const dataFile = db >= 0 && lines[db + 1]?.trim() ? lines[db + 1].trim().replace(/(\.sav)\.sav$/i, '$1') : null;

  // Variables and arrows (1-based object numbers).
  const obj = (k: number) => objs[k - 1];
  const isVar = (x: AmosObject | undefined) => !!x && (x.type === 1 || x.type === 2);
  const paths = objs.filter((x) => x.type === 4 && isVar(obj(x.obj1)) && isVar(obj(x.obj2)));
  const covs = objs.filter((x) => x.type === 8 && isVar(obj(x.obj1)) && isVar(obj(x.obj2)));
  const skipped = objs.filter((x) => ![1, 2, 4, 8].includes(x.type)).length;
  if (skipped) warn(`${skipped} drawing object${skipped === 1 ? '' : 's'} (titles, text) left out.`);
  const name = new Map<number, string>();
  objs.forEach((x, i) => { if (isVar(x)) { if (!x.label) throw new Error(`Variable ${i + 1} of the AMOS file has no name.`); name.set(i + 1, ident(x.label)); } });
  for (const [k, v] of name) if (v !== ident(obj(k).label) || v !== obj(k).label) warn(`“${obj(k).label}” is named “${v}” here (letters, digits, _ and . only).`);
  const incoming = (k: number) => paths.filter((p) => p.obj2 === k);
  const outgoing = (k: number) => paths.filter((p) => p.obj1 === k);

  // Error and disturbance terms: unobserved, nothing coming in, one arrow out fixed at 1, into a variable.
  const errorOf = new Map<number, number>();
  objs.forEach((x, i) => {
    const k = i + 1;
    if (x.type !== 2 || incoming(k).length) return;
    const out = outgoing(k);
    if (out.length === 1 && amosValue(out[0].value1).fixed === 1 && !covs.some((c) => (c.obj1 === k || c.obj2 === k) && obj(c.obj1 === k ? c.obj2 : c.obj1).type === 1)) errorOf.set(k, out[0].obj2);
  });
  const factor = (k: number) => obj(k).type === 2 && !errorOf.has(k);
  // An error term's variance fixed at a value (other than free) is kept as a fixed residual variance.
  const term = (p: AmosObject) => { const v = amosValue(p.value1); return v.fixed !== undefined ? `${v.fixed}*` : v.label ? `${ident(v.label)}*` : ''; };

  const out: string[] = [];
  // Factors: the observed variables they point at are their indicators; a loading fixed at 1 comes first (the marker).
  const indicatorOf = new Set<number>();
  for (const [k] of name) {
    if (!factor(k)) continue;
    const loads = outgoing(k).filter((p) => obj(p.obj2).type === 1);
    if (!loads.length) continue;
    loads.sort((p, q) => Number(amosValue(q.value1).fixed === 1) - Number(amosValue(p.value1).fixed === 1));
    if (amosValue(loads[0].value1).fixed !== 1 && amosValue(obj(k).value1).fixed === undefined) warn(`${name.get(k)}: no loading is fixed at 1 and its variance is free; its first indicator is the marker here.`);
    out.push(`${name.get(k)} =~ ${loads.map((p) => `${term(p)}${name.get(p.obj2)}`).join(' + ')}`);
    for (const p of loads) indicatorOf.add(p.obj2);
  }
  // Structural paths: every other arrow between variables (not from an error term, not a loading).
  const byTarget = new Map<number, AmosObject[]>();
  for (const p of paths) {
    if (errorOf.has(p.obj1)) continue;
    if (factor(p.obj1) && obj(p.obj2).type === 1 && indicatorOf.has(p.obj2) && outgoing(p.obj1).includes(p)) continue;
    byTarget.set(p.obj2, [...(byTarget.get(p.obj2) ?? []), p]);
  }
  for (const [t, ps] of byTarget) out.push(`${name.get(t)} ~ ${ps.map((p) => `${term(p)}${name.get(p.obj1)}`).join(' + ')}`);
  // Covariances: between two error terms, of the variables they belong to (residual covariances).
  const covariances: [string, string][] = [];
  for (const c of covs) {
    const end = (k: number) => name.get(errorOf.get(k) ?? k)!;
    out.push(`${end(c.obj1)} ~~ ${term(c)}${end(c.obj2)}`);
    if (!errorOf.has(c.obj1) && !errorOf.has(c.obj2)) covariances.push([end(c.obj1), end(c.obj2)]);
  }
  // Fixed variances (of factors or error terms) other than free.
  for (const [k] of name) {
    const v = amosValue(obj(k).value1);
    if (obj(k).type !== 2 || v.fixed === undefined) continue;
    const of = errorOf.has(k) ? name.get(errorOf.get(k)!)! : name.get(k)!;
    out.push(`${of} ~~ ${v.fixed}*${of}`);
  }

  const positions: AmosModel['positions'] = {};
  for (const [k, v] of name) if (!errorOf.has(k) && Number.isFinite(obj(k).x) && Number.isFinite(obj(k).y)) positions[v] = { x: obj(k).x, y: obj(k).y };
  return { syntax: out.join('\n'), positions, settings, dataFile, groups, covariances, warnings };
}

/** Inches in AMOS's drawing to pixels on the canvas. */
const PX_PER_INCH = 110;

/**
 * The diagram built from the syntax, made AMOS's: exogenous observed variables keep
 * free variances (AMOS has no fixed.x), exogenous variables covary only where a
 * double-headed arrow is drawn (every other pair fixed at zero, as AMOS does), and
 * the constructs sit where they are in AMOS.
 */
export function amosDiagram(model: ModelState, amos: AmosModel): ModelState {
  const byName = new Map(model.constructs.map((c) => [c.name, c]));
  const constructs = model.constructs.map((c) => {
    const { covariate: _c, ...rest } = c;
    const at = amos.positions[c.name];
    return { ...rest, ...(at ? { x: Math.round(at.x * PX_PER_INCH), y: Math.round(at.y * PX_PER_INCH) } : {}) };
  });
  const pair = (a: string, b: string) => [a, b].sort().join('\u0000');
  const correlations: Correlation[] = [...(model.correlations ?? [])];
  const have = new Set(correlations.filter((k) => k.kind === 'construct').map((k) => pair(k.a, k.b)));
  for (const [a, b] of amos.covariances) {
    const ca = byName.get(a), cb = byName.get(b);
    if (!ca || !cb || have.has(pair(ca.id, cb.id))) continue;
    correlations.push({ id: newId('k'), kind: 'construct', a: ca.id, b: cb.id });
    have.add(pair(ca.id, cb.id));
  }
  const endogenous = new Set(model.paths.map((p) => p.to));
  const components = new Set(model.constructs.flatMap((c) => c.components ?? []));
  const exogenous = constructs.filter((c) => !endogenous.has(c.id) && !components.has(c.id));
  for (let i = 0; i < exogenous.length; i++) for (let j = i + 1; j < exogenous.length; j++) {
    const k = pair(exogenous[i].id, exogenous[j].id);
    if (!have.has(k)) { correlations.push({ id: newId('k'), kind: 'construct', a: exogenous[i].id, b: exogenous[j].id, zero: true }); have.add(k); }
  }
  return { ...model, constructs, correlations };
}
