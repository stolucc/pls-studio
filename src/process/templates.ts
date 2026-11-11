// Conditional process models (Hayes, 2022): the numbered model templates of
// PROCESS v5 as graphs of roles (X, M1…Mk, W, Z, Y). A template says which
// paths exist and which of them W, Z or W × Z moderate; equations() turns any
// such graph into the OLS equations PROCESS estimates. Our own encoding of
// the model structures, checked against PROCESS's output for every model
// (src/process/__fixtures__/reference, written by
// scripts/validation/process_reference.R).

/** Moderation of a group of paths: by W, by Z, by W and Z additively, or by W, Z and W × Z. */
export type Mods = 'W' | 'Z' | 'W+Z' | 'W*Z';

export type Structure =
  | 'moderation' // X → Y only
  | 'parallel' // X → Mi → Y
  | 'serial' // X → M1 → M2 → … → Y, every earlier variable affecting every later one
  | 'converge' // model 80: M1…Mk-1 in parallel, all affecting Mk
  | 'diverge' // model 81: M1 affecting M2…Mk, which are parallel
  | 'chains'; // model 82: X → M1 → M2 and X → M3 → M4

export interface Template {
  model: number;
  structure: Structure;
  /** Moderators of the X → M paths, M → Y paths, X → Y path and M → M paths. */
  xm?: Mods;
  my?: Mods;
  xy?: Mods;
  mm?: Mods;
  /** Only X → M1 (models 83, 86) / only Mk → Y (models 87, 90) is moderated. */
  xmFirst?: boolean;
  myLast?: boolean;
  /** Model 74: X moderates its own M → Y paths (PROCESS's XMINT option). */
  xmint?: boolean;
}

const t = (
  model: number,
  structure: Structure,
  mods: Omit<Template, 'model' | 'structure'> = {},
): Template => ({ model, structure, ...mods });
const P = 'parallel',
  S = 'serial';

/** Every model number current PROCESS accepts (models 23–27, 30–57 and 77–79 were retired). */
export const TEMPLATES: Template[] = [
  t(1, 'moderation', { xy: 'W' }),
  t(2, 'moderation', { xy: 'W+Z' }),
  t(3, 'moderation', { xy: 'W*Z' }),
  t(4, P),
  t(5, P, { xy: 'W' }),
  t(6, S),
  t(7, P, { xm: 'W' }),
  t(8, P, { xm: 'W', xy: 'W' }),
  t(9, P, { xm: 'W+Z' }),
  t(10, P, { xm: 'W+Z', xy: 'W+Z' }),
  t(11, P, { xm: 'W*Z' }),
  t(12, P, { xm: 'W*Z', xy: 'W*Z' }),
  t(13, P, { xm: 'W*Z', xy: 'W' }),
  t(14, P, { my: 'W' }),
  t(15, P, { my: 'W', xy: 'W' }),
  t(16, P, { my: 'W+Z' }),
  t(17, P, { my: 'W+Z', xy: 'W+Z' }),
  t(18, P, { my: 'W*Z' }),
  t(19, P, { my: 'W*Z', xy: 'W*Z' }),
  t(20, P, { my: 'W*Z', xy: 'W' }),
  t(21, P, { xm: 'W', my: 'Z' }),
  t(22, P, { xm: 'W', my: 'Z', xy: 'W' }),
  t(28, P, { xm: 'W', my: 'Z', xy: 'Z' }),
  t(29, P, { xm: 'W', my: 'Z', xy: 'W+Z' }),
  t(58, P, { xm: 'W', my: 'W' }),
  t(59, P, { xm: 'W', my: 'W', xy: 'W' }),
  t(60, P, { xm: 'W+Z', my: 'W' }),
  t(61, P, { xm: 'W+Z', my: 'W', xy: 'W' }),
  t(62, P, { xm: 'W+Z', my: 'W', xy: 'Z' }),
  t(63, P, { xm: 'W+Z', my: 'W', xy: 'W+Z' }),
  t(64, P, { xm: 'W', my: 'W+Z' }),
  t(65, P, { xm: 'W', my: 'W+Z', xy: 'W' }),
  t(66, P, { xm: 'W', my: 'W+Z', xy: 'Z' }),
  t(67, P, { xm: 'W', my: 'W+Z', xy: 'W+Z' }),
  t(68, P, { xm: 'W*Z', my: 'W' }),
  t(69, P, { xm: 'W*Z', my: 'W', xy: 'W*Z' }),
  t(70, P, { xm: 'W', my: 'W*Z' }),
  t(71, P, { xm: 'W', my: 'W*Z', xy: 'W*Z' }),
  t(72, P, { xm: 'W*Z', my: 'W*Z' }),
  t(73, P, { xm: 'W*Z', my: 'W*Z', xy: 'W*Z' }),
  t(74, P, { xmint: true }),
  t(75, P, { xm: 'W+Z', my: 'W+Z' }),
  t(76, P, { xm: 'W+Z', my: 'W+Z', xy: 'W+Z' }),
  t(80, 'converge'),
  t(81, 'diverge'),
  t(82, 'chains'),
  t(83, S, { xm: 'W', xmFirst: true }),
  t(84, S, { xm: 'W' }),
  t(85, S, { xm: 'W', xy: 'W' }),
  t(86, S, { xm: 'W', xy: 'W', xmFirst: true }),
  t(87, S, { my: 'W', myLast: true }),
  t(88, S, { my: 'W' }),
  t(89, S, { my: 'W', xy: 'W' }),
  t(90, S, { my: 'W', xy: 'W', myLast: true }),
  t(91, S, { mm: 'W' }),
  t(92, S, { xm: 'W', my: 'W', xy: 'W', mm: 'W' }),
];

export const template = (model: number) => TEMPLATES.find((x) => x.model === model);

/** How many mediators the model takes (PROCESS's limits). */
export function mediatorRange(tp: Template): [number, number] {
  switch (tp.structure) {
    case 'moderation':
      return [0, 0];
    case 'parallel':
      return [1, 10];
    case 'serial':
      return [2, 6];
    case 'converge':
    case 'diverge':
      return [3, 6];
    case 'chains':
      return [4, 4];
  }
}

/** The moderators a template uses. */
export function moderatorsOf(tp: Template): ('W' | 'Z')[] {
  const all = [tp.xm, tp.my, tp.xy, tp.mm].filter(Boolean).join(' ');
  return (['W', 'Z'] as const).filter((m) => all.includes(m));
}

// ---------- graphs ----------

export type Edge = [from: string, to: string];

/**
 * A conditional process model as a graph of named variables. Moderations are
 * two-way (path × moderator); threeWay entries are path × W × Z, which brings
 * the two-way terms with it.
 */
export interface ProcessGraph {
  x: string;
  y: string;
  mediators: string[];
  paths: Edge[];
  moderations: { path: Edge; by: string }[];
  threeWay: { path: Edge; by: [string, string] }[];
}

export interface Roles {
  x: string;
  y: string;
  m: string[];
  w?: string;
  z?: string;
}

/** The graph of `tp` with `roles.m.length` mediators, in the names of `roles`. */
export function materialise(tp: Template, roles: Roles): ProcessGraph {
  const { x, y, m } = roles;
  const k = m.length;
  const [lo, hi] = mediatorRange(tp);
  if (k < lo || k > hi)
    throw new Error(
      `Model ${tp.model} takes ${lo === hi ? lo : `${lo} to ${hi}`} mediator${hi === 1 ? '' : 's'}.`,
    );
  const xm: Edge[] = m.map((mi) => [x, mi]);
  const my: Edge[] = m.map((mi) => [mi, y]);
  const mm: Edge[] = [];
  if (tp.structure === 'serial')
    for (let j = 1; j < k; j++) for (let i = 0; i < j; i++) mm.push([m[i], m[j]]);
  if (tp.structure === 'converge') for (let i = 0; i < k - 1; i++) mm.push([m[i], m[k - 1]]);
  if (tp.structure === 'diverge') for (let j = 1; j < k; j++) mm.push([m[0], m[j]]);
  if (tp.structure === 'chains') mm.push([m[0], m[1]], [m[2], m[3]]);
  const xy: Edge = [x, y];
  const g: ProcessGraph = {
    x,
    y,
    mediators: [...m],
    paths: [...xm, ...mm, ...my, xy],
    moderations: [],
    threeWay: [],
  };
  const role = (r: 'W' | 'Z') => {
    const name = r === 'W' ? roles.w : roles.z;
    if (!name) throw new Error(`Model ${tp.model} needs a moderator ${r}.`);
    return name;
  };
  const moderate = (paths: Edge[], mods: Mods | undefined) => {
    if (!mods) return;
    for (const p of paths) {
      if (mods === 'W*Z') g.threeWay.push({ path: p, by: [role('W'), role('Z')] });
      for (const r of mods === 'W'
        ? (['W'] as const)
        : mods === 'Z'
          ? (['Z'] as const)
          : (['W', 'Z'] as const))
        g.moderations.push({ path: p, by: role(r) });
    }
  };
  moderate(tp.xmFirst ? xm.slice(0, 1) : xm, tp.xm);
  moderate(tp.myLast ? my.slice(-1) : my, tp.my);
  moderate(mm, tp.mm);
  moderate([xy], tp.xy);
  if (tp.xmint) for (const p of my) g.moderations.push({ path: p, by: x });
  return g;
}

/** A regression term: one variable, or a product of two or three (names sorted). */
export type Term = string[];

const termKey = (t: Term) => [...t].sort().join('*');

/**
 * The OLS equation of every outcome (mediators and Y), as PROCESS sets them
 * up: the predictors, each moderator with its product with the moderated
 * predictor, the three-way blocks (W, Z, XW, XZ, WZ, XWZ), and the covariates
 * in every equation.
 */
export function equations(g: ProcessGraph, covariates: string[] = []): Map<string, Term[]> {
  const out = new Map<string, Term[]>();
  for (const outcome of [...g.mediators, g.y]) {
    const terms = new Map<string, Term>();
    const add = (...vars: string[]) => {
      const k = termKey(vars);
      if (!terms.has(k)) terms.set(k, [...vars].sort());
    };
    const into = g.paths.filter(([, to]) => to === outcome);
    for (const [from] of into) add(from);
    for (const {
      path: [from, to],
      by,
    } of g.moderations)
      if (to === outcome) {
        add(by);
        add(from, by);
      }
    for (const {
      path: [from, to],
      by: [w, z],
    } of g.threeWay) {
      if (to !== outcome) continue;
      add(w);
      add(z);
      add(from, w);
      add(from, z);
      add(w, z);
      add(from, w, z);
    }
    for (const c of covariates) add(c);
    out.set(outcome, [...terms.values()]);
  }
  return out;
}

// ---------- recognising a drawn model ----------

const canonical = (g: ProcessGraph) =>
  JSON.stringify({
    p: g.paths.map((e) => e.join('>')).sort(),
    m: g.moderations.map((mo) => `${mo.path.join('>')}|${mo.by}`).sort(),
    t: g.threeWay.map((mo) => `${mo.path.join('>')}|${[...mo.by].sort().join(',')}`).sort(),
  });

function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield [...xs];
    return;
  }
  for (let i = 0; i < xs.length; i++)
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      yield [xs[i], ...rest];
}

export interface Recognised {
  model: number;
  roles: Roles;
}

/**
 * Which PROCESS model `g` is, with the role each variable plays (mediators in
 * template order, which W and which Z), or null for a custom model. Where two
 * numbers describe the same graph the lower wins.
 */
export function recognise(g: ProcessGraph): Recognised | null {
  const target = canonical(g);
  const onPaths = new Set(g.paths.flat());
  const moderators = [
    ...new Set([...g.moderations.map((m) => m.by), ...g.threeWay.flatMap((m) => m.by)]),
  ].filter((v) => !onPaths.has(v));
  if (moderators.length > 2 || g.mediators.length > 10) return null;
  const assignments: { w?: string; z?: string }[] =
    moderators.length === 0
      ? [{}]
      : moderators.length === 1
        ? [{ w: moderators[0] }, { z: moderators[0] }]
        : [
            { w: moderators[0], z: moderators[1] },
            { w: moderators[1], z: moderators[0] },
          ];
  // Factorial in the number of mediators: fine up to PROCESS's limits for structured models.
  const orders = g.mediators.length <= 6 ? [...permutations(g.mediators)] : [g.mediators];
  for (const tp of TEMPLATES) {
    const [lo, hi] = mediatorRange(tp);
    if (g.mediators.length < lo || g.mediators.length > hi) continue;
    const used = moderatorsOf(tp);
    for (const a of assignments) {
      if (
        used.length !== Object.keys(a).length ||
        !used.every((r) => a[r.toLowerCase() as 'w' | 'z'])
      )
        continue;
      for (const m of orders) {
        const roles: Roles = { x: g.x, y: g.y, m, ...a };
        if (canonical(materialise(tp, roles)) === target) return { model: tp.model, roles };
      }
    }
  }
  return null;
}

// ---------- descriptions (gallery) ----------

const STRUCTURE: Record<Structure, string> = {
  moderation: 'Moderation',
  parallel: 'Parallel mediation',
  serial: 'Serial mediation',
  converge: 'Parallel mediators feeding a final mediator',
  diverge: 'A first mediator feeding parallel mediators',
  chains: 'Two serial chains',
};

/** "W and Z" / "W, Z and W × Z" for a moderation group. */
const modsText = (m: Mods) => ({ W: 'W', Z: 'Z', 'W+Z': 'W and Z', 'W*Z': 'W, Z and W × Z' })[m];

/** Plain-language summary of a template, e.g. "Parallel mediation; W moderates X → M". */
export function describe(tp: Template): string {
  const parts: string[] = [];
  if (tp.xm)
    parts.push(
      `${modsText(tp.xm)} moderate${tp.xm === 'W' || tp.xm === 'Z' ? 's' : ''} ${tp.xmFirst ? 'X → M1' : 'X → M'}`,
    );
  if (tp.mm) parts.push(`${modsText(tp.mm)} moderates M → M`);
  if (tp.my)
    parts.push(
      `${modsText(tp.my)} moderate${tp.my === 'W' || tp.my === 'Z' ? 's' : ''} ${tp.myLast ? 'the last M → Y' : 'M → Y'}`,
    );
  if (tp.xy)
    parts.push(`${modsText(tp.xy)} moderate${tp.xy === 'W' || tp.xy === 'Z' ? 's' : ''} X → Y`);
  if (tp.xmint) parts.push('X moderates M → Y (X × M interaction)');
  return [STRUCTURE[tp.structure], ...parts].join('; ');
}

/** Gallery sections. */
export function familyOf(tp: Template): string {
  if (tp.structure === 'moderation') return 'Moderation';
  if (!tp.xm && !tp.my && !tp.xy && !tp.mm && !tp.xmint) return 'Mediation';
  if (tp.structure !== 'parallel') return 'Serial mediation with moderation';
  const all = [tp.xm, tp.my, tp.xy].filter(Boolean).join(' ');
  if (all.includes('*')) return 'Moderated mediation: three-way interactions';
  if (all.includes('Z')) return 'Moderated mediation: two moderators';
  return 'Moderated mediation: one moderator';
}
