// The guided check of higher-order constructs (HOCs) in PLS-SEM: the HOC's type
// from the model (Ringle, Sarstedt & Straub 2012), and which statistics apply at
// which level for that type and the estimation approach (Becker, Klein &
// Wetzels 2012; Sarstedt, Hair, Cheah, Becker & Ringle 2019), each filled from
// the results with a status and the source's threshold. Statistics the package
// does not report at the HOC level but that follow simply from what it does
// report are computed here: the HOC's composite reliability and AVE from the
// loadings of its lower-order components (LOCs), its standardised alpha and the
// LOCs' VIFs from the correlations of the LOC scores. Anything else the results
// do not contain is marked "not computed", never estimated.

import { invert } from '../engine/linalg';
import { corStd, standardize } from '../engine/stats';
import type { BootstrapResult, BootstrapStat, PlsResult } from '../engine/types';
import type { Construct, HocApproach, ModelState } from '../model/project';
import type { CheckItem, CheckStatus } from './checklist';

/** How a block is measured, in the PLS-SEM sense of Hair et al. (Mode A reflective, Mode B formative). */
export type Measurement = 'reflective' | 'formative';
/** The LOCs of one HOC: all reflective, all formative, or some of each. */
export type LowerMeasurement = Measurement | 'mixed';

export type HocStatus = 'pass' | 'attention' | 'na' | 'notComputed';

/** The PLS results tabs a line can point to (PlsTabs.tsx ids). */
export type HocTab = 'outer' | 'reliability' | 'discriminant' | 'paths' | 'overview' | 'bootstrap';

export interface HocLine {
  id: string;
  level: 'Lower-order components' | 'Higher-order construct' | 'Structural model';
  check: string;
  /** The value(s) from the results, formatted; empty when there is none. */
  value: string;
  /** The rule, with whose rule it is. */
  threshold: string;
  status: HocStatus;
  /** What the value means and what to do. */
  detail: string;
  /** Citation keys (reporting/citations.ts). */
  sources: string[];
  /** The results tab the value comes from. */
  tab?: HocTab;
  /** Computed by PLS Studio from the package's results, not reported by the package itself. */
  computed?: boolean;
}

/** Something in the results that does not apply to the HOC and must not be interpreted. */
export interface HocIgnore {
  what: string;
  value: string;
  why: string;
  sources: string[];
  tab?: HocTab;
}

export interface HocAdvice {
  title: string;
  text: string;
  sources: string[];
}

export interface HocType {
  lower: LowerMeasurement;
  higher: Measurement;
  /** "reflective–formative" and so on. */
  label: string;
  explanation: string;
}

/** Statistics derived here from the package's results (null when they cannot be). */
export interface HocDerived {
  /** Jöreskog's ρC from the LOC–HOC loadings. */
  rhoC: number | null;
  /** AVE: the mean squared LOC–HOC loading. */
  ave: number | null;
  /** Standardised Cronbach's α of the LOC scores. */
  alpha: number | null;
  /** VIF of each LOC among the HOC's LOCs, by LOC name. */
  vif: Record<string, number>;
}

export interface HocCheck {
  name: string;
  components: string[];
  type: HocType;
  approach: HocApproach;
  derived: HocDerived;
  lines: HocLine[];
  ignore: HocIgnore[];
  advice: HocAdvice[];
}

export interface HocInput {
  model: ModelState;
  pls: PlsResult;
  boot: BootstrapResult | null;
  /** Settings.hocApproach (the result's own hocApproach wins when present). */
  approach: HocApproach;
  plsPackage: 'cSEM' | 'seminr';
}

// ---------------------------------------------------------------- type

/** A block's measurement: Mode A reflective, Mode B formative; sum scores by the construct's type. */
export function measurementOf(k: Pick<Construct, 'type' | 'mode'>): Measurement {
  if (k.mode === 'A') return 'reflective';
  if (k.mode === 'B') return 'formative';
  return k.type === 'factor' ? 'reflective' : 'formative';
}

/**
 * How the HOC itself is weighted. cSEM's two-stage approaches weight it in stage 2 by its type
 * (a common factor Mode A, a composite Mode B: pls.R); with repeated indicators, and in seminr,
 * it is weighted by its mode.
 */
export function hocMeasurement(
  k: Pick<Construct, 'type' | 'mode'>,
  approach: HocApproach,
  plsPackage: 'cSEM' | 'seminr',
): Measurement {
  if (plsPackage === 'cSEM' && approach !== 'repeated') {
    return k.type === 'factor' ? 'reflective' : 'formative';
  }
  return measurementOf(k);
}

const TYPE_EXPLANATION: Record<string, string> = {
  'reflective–reflective':
    'Reflectively measured dimensions that are themselves reflections of one general concept: the higher-order construct is what they have in common.',
  'reflective–formative':
    'Reflectively measured dimensions that together form the higher-order construct: each covers a distinct aspect of it.',
  'formative–reflective':
    'Formatively measured dimensions that reflect one general concept: different composites that tap the same higher-order construct.',
  'formative–formative':
    'Formatively measured dimensions that together form the higher-order construct: a composite of composites.',
};

/** The HOC's type (Ringle, Sarstedt & Straub 2012): LOC measurement – HOC measurement. */
export function hocType(lowers: Measurement[], higher: Measurement): HocType {
  const allSame = lowers.every((m) => m === lowers[0]);
  const lower: LowerMeasurement = allSame && lowers.length > 0 ? lowers[0] : 'mixed';
  if (lower === 'mixed') {
    return {
      lower,
      higher,
      label: `mixed–${higher}`,
      explanation:
        'Some dimensions are measured reflectively and some formatively: assess each dimension by its own measurement, then the higher-order construct by its type.',
    };
  }
  const label = `${lower}–${higher}`;
  return { lower, higher, label, explanation: TYPE_EXPLANATION[label] };
}

// ---------------------------------------------------------------- derived statistics

/**
 * Jöreskog's composite reliability and the AVE from standardised loadings (Hair et al. 2019):
 * ρC = (Σλ)² / ((Σλ)² + Σ(1 − λ²)), AVE = Σλ² / k. cSEM's assess() and seminr's summary()
 * give the same for a block with these loadings.
 */
export function reliabilityFromLoadings(loadings: number[]): { rhoC: number; ave: number } {
  const sum = loadings.reduce((s, l) => s + l, 0);
  const squares = loadings.reduce((s, l) => s + l * l, 0);
  const errors = loadings.length - squares;
  const rhoC = (sum * sum) / (sum * sum + errors);
  const ave = squares / loadings.length;
  return { rhoC, ave };
}

/** Cronbach's α of standardised variables from their correlation matrix: k/(k − 1) · (1 − k / ΣR). */
export function standardizedAlpha(R: number[][]): number {
  const k = R.length;
  const total = R.reduce((s, row) => s + row.reduce((t, v) => t + v, 0), 0);
  return (k / (k - 1)) * (1 - k / total);
}

/** The VIF of each variable among the others: the diagonal of the inverse correlation matrix. */
export function vifFromCorrelations(R: number[][]): number[] {
  const inverse = invert(R);
  return R.map((_, i) => inverse[i][i]);
}

/** Correlations of construct scores (by index into pls.constructs). */
export function scoreCorrelations(pls: PlsResult, idx: number[]): number[][] {
  const z = idx.map((j) => standardize(pls.scores[j], pls.constructs[j]));
  return z.map((a) => z.map((b) => corStd(a, b)));
}

function derive(pls: PlsResult, hoc: number, comps: number[]): HocDerived {
  const loadings = comps.map((k) => hoEntry(pls, hoc, k)?.loading ?? NaN);
  const rel = loadings.every(Number.isFinite) ? reliabilityFromLoadings(loadings) : null;
  let alpha: number | null = null;
  const vif: Record<string, number> = {};
  const haveScores = comps.every((k) => pls.scores[k]?.length > 2);
  if (haveScores && comps.length > 1) {
    try {
      const R = scoreCorrelations(pls, comps);
      alpha = standardizedAlpha(R);
      vifFromCorrelations(R).forEach((v, i) => {
        vif[pls.constructs[comps[i]]] = v;
      });
    } catch {
      // (a constant score or perfectly collinear LOCs: left out, the line says "not computed")
    }
  }
  return { rhoC: rel?.rhoC ?? null, ave: rel?.ave ?? null, alpha, vif };
}

// ---------------------------------------------------------------- helpers

const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const list = (xs: string[]) => xs.join(', ');

function hoEntry(pls: PlsResult, hoc: number, comp: number) {
  return pls.higherOrder?.find((h) => h.construct === hoc && h.component === comp);
}

/** Significant at the bootstrap's level: the confidence interval excludes zero. */
const significant = (s: BootstrapStat) => s.ciLow > 0 || s.ciHigh < 0;
const stat = (boot: BootstrapResult | null, key: string) => boot?.stats.find((s) => s.key === key);
const pText = (s: BootstrapStat) => (s.p < 0.001 ? 'p < .001' : `p = ${f3(s.p).replace(/^0/, '')}`);

/** HTMT of two constructs (the matrix is filled below the diagonal). */
function htmtOf(pls: PlsResult, i: number, j: number): number | null {
  const v = i > j ? pls.htmt[i]?.[j] : pls.htmt[j]?.[i];
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

const H19 = 'hair2019';
const S19 = 'sarstedt2019';
const B12 = 'becker2012';
const R12 = 'ringle2012';
const H21 = 'hair2021';
const CB09 = 'cenfetelli2009';
const C18 = 'cheah2018';

// ---------------------------------------------------------------- lower-order lines

interface Ctx {
  pls: PlsResult;
  boot: BootstrapResult | null;
  approach: HocApproach;
  hoc: number;
  comps: number[];
  /** Indices of all HOCs (their HTMT under repeated indicators comes from the repeated items). */
  hocs: Set<number>;
}

const block = (pls: PlsResult, j: number) =>
  pls.indicators.map((x, i) => ({ ...x, i })).filter((x) => x.construct === j);

function reflectiveLocLines(ctx: Ctx, locs: number[]): HocLine[] {
  const { pls } = ctx;
  const out: HocLine[] = [];
  const level = 'Lower-order components' as const;
  const names = list(locs.map((j) => pls.constructs[j]));
  const stage =
    ctx.approach === 'two_stage'
      ? ' From stage 1 of the two-stage approach.'
      : ctx.approach === 'embedded'
        ? ' From stage 1 (with the repeated indicators).'
        : '';

  // Indicator loadings (Hair et al. 2019: ≥ .708; .40–.708 kept when ρC and AVE are met).
  const low = locs.flatMap((j) =>
    block(pls, j)
      .filter((x) => pls.loadings[x.i] < 0.708)
      .map((x) => {
        const q = pls.quality[j];
        const kept = pls.loadings[x.i] >= 0.4 && q.ave >= 0.5 && q.rhoC >= 0.7;
        return { text: `${x.name} ${f3(pls.loadings[x.i])}`, kept };
      }),
  );
  const allLoadings = locs.flatMap((j) => block(pls, j).map((x) => pls.loadings[x.i]));
  out.push({
    id: 'loc-loadings',
    level,
    check: `Indicator loadings of ${names}`,
    value: low.length
      ? `Below .708: ${list(low.map((x) => x.text))}`
      : `Lowest ${f3(Math.min(...allLoadings))}`,
    threshold: '≥ .708; .40–.708 can stay if ρC and AVE are met (Hair et al., 2019)',
    status: low.some((x) => !x.kept) ? 'attention' : 'pass',
    detail:
      (low.length && low.every((x) => x.kept)
        ? 'The lower loadings can stay: each is above .40 and its dimension meets the reliability and AVE thresholds.'
        : low.length
          ? 'Consider removing an indicator below .40, or below .708 where that lifts ρC or AVE above its threshold, if content validity allows.'
          : 'Every indicator loading of the reflective dimensions is at least .708.') + stage,
    sources: [H19, S19],
    tab: 'outer',
  });

  // Internal consistency and convergent validity of each LOC.
  const rel = locs.map((j) => ({ name: pls.constructs[j], ...pls.quality[j] }));
  const known = rel.filter((r) => Number.isFinite(r.rhoC));
  const badRel = known.filter(
    (r) => r.rhoC < 0.7 || r.rhoC > 0.95 || r.rhoA < 0.7 || r.rhoA > 0.95,
  );
  out.push({
    id: 'loc-reliability',
    level,
    check: `Internal consistency of ${names}`,
    value: known.map((r) => `${r.name}: ρA ${f2(r.rhoA)}, ρC ${f2(r.rhoC)}`).join('; '),
    threshold: 'ρA and ρC between .70 and .95 (Hair et al., 2019)',
    status: known.length === 0 ? 'notComputed' : badRel.length ? 'attention' : 'pass',
    detail:
      known.length === 0
        ? 'The results hold no reliabilities for these dimensions.'
        : badRel.length
          ? `Outside .70–.95: ${list(badRel.map((r) => r.name))}. Above .95 suggests redundant items.`
          : 'Each reflective dimension is internally consistent.',
    sources: [H19, 'dijkstra2015'],
    tab: 'reliability',
  });
  const badAve = known.filter((r) => r.ave < 0.5);
  out.push({
    id: 'loc-ave',
    level,
    check: `Convergent validity (AVE) of ${names}`,
    value: list(known.map((r) => `${r.name}: ${f2(r.ave)}`)),
    threshold: 'AVE ≥ .50 (Fornell & Larcker, 1981; Hair et al., 2019)',
    status: known.length === 0 ? 'notComputed' : badAve.length ? 'attention' : 'pass',
    detail: badAve.length
      ? `Below .50: ${list(badAve.map((r) => r.name))}: the dimension explains less than half of its items' variance.`
      : 'Each reflective dimension explains at least half of its items’ variance.',
    sources: ['fornell1981', H19],
    tab: 'reliability',
  });

  // HTMT: of each LOC with the other constructs, but not with its own HOC; LOCs of one HOC are
  // conceptually similar, so the .90 threshold applies between them (Henseler et al. 2015).
  const pairs: { text: string; v: number; cut: number }[] = [];
  for (const i of locs) {
    for (let j = 0; j < pls.constructs.length; j++) {
      if (j === i || j === ctx.hoc) continue;
      if (ctx.hocs.has(j) && ctx.approach !== 'two_stage') continue;
      if (locs.includes(j) && j < i) continue;
      const v = htmtOf(pls, i, j);
      if (v === null) continue;
      const cut = ctx.comps.includes(j) ? 0.9 : 0.85;
      pairs.push({ text: `${pls.constructs[i]}–${pls.constructs[j]} ${f2(v)}`, v, cut });
    }
  }
  const failing = pairs.filter((p) => p.v >= p.cut);
  out.push({
    id: 'loc-htmt',
    level,
    check: `Discriminant validity (HTMT) of ${names}`,
    value: pairs.length
      ? failing.length
        ? `At or above the threshold: ${list(failing.map((p) => p.text))}`
        : `Largest ${f2(Math.max(...pairs.map((p) => p.v)))}`
      : '',
    threshold:
      'Below .85; below .90 between dimensions of the same HOC, which are conceptually similar (Henseler et al., 2015)',
    status: pairs.length === 0 ? 'notComputed' : failing.length ? 'attention' : 'pass',
    detail:
      pairs.length === 0
        ? 'The results hold no HTMT for these dimensions (cSEM reports it for common factors only).'
        : 'The dimensions must be distinct from each other and from the other constructs; their HTMT with their own higher-order construct is not a criterion (Sarstedt et al., 2019).',
    sources: ['henseler2015', S19],
    tab: 'discriminant',
  });
  return out;
}

function formativeLocLines(ctx: Ctx, locs: number[]): HocLine[] {
  const { pls, boot } = ctx;
  const out: HocLine[] = [];
  const level = 'Lower-order components' as const;
  const names = list(locs.map((j) => pls.constructs[j]));
  const items = locs.flatMap((j) => block(pls, j));

  const vifs = items.filter((x) => Number.isFinite(pls.vifOuter[x.i]));
  const high = vifs.filter((x) => pls.vifOuter[x.i] >= 5);
  const mid = vifs.filter((x) => pls.vifOuter[x.i] >= 3 && pls.vifOuter[x.i] < 5);
  out.push({
    id: 'loc-item-vif',
    level,
    check: `Collinearity of the indicators of ${names}`,
    value: vifs.length ? `Largest VIF ${f2(Math.max(...vifs.map((x) => pls.vifOuter[x.i])))}` : '',
    threshold: 'VIF below 3 ideally; 5 or above is critical (Hair et al., 2019)',
    status: vifs.length === 0 ? 'notComputed' : high.length ? 'attention' : 'pass',
    detail:
      vifs.length === 0
        ? 'The results hold no indicator VIFs for these dimensions.'
        : high.length
          ? `At least 5: ${list(high.map((x) => `${x.name} ${f2(pls.vifOuter[x.i])}`))}.`
          : mid.length
            ? `Between 3 and 5 (possible collinearity): ${list(mid.map((x) => x.name))}.`
            : 'No collinearity problem among the formative indicators.',
    sources: [H19],
    tab: 'outer',
  });

  out.push(
    weightLine({
      id: 'loc-item-weights',
      level,
      check: `Significance and relevance of the indicator weights of ${names}`,
      boot,
      entries: items.map((x) => ({
        name: x.name,
        weight: pls.weights[x.i],
        loading: pls.loadings[x.i],
        weightStat: stat(boot, `weight:${x.name}`),
        loadingStat: stat(boot, `loading:${x.name}`),
      })),
      tab: 'outer',
    }),
  );

  out.push({
    id: 'loc-redundancy',
    level,
    check: `Convergent validity (redundancy analysis) of ${names}`,
    value: '',
    threshold: 'Path to a global single item ≥ .70 (Cheah et al., 2018; Hair et al., 2019)',
    status: 'notComputed',
    detail:
      'A redundancy analysis needs a global item for each formative dimension, which the model does not identify. If you have one, add it as a single-item construct and draw a path from the dimension to it. Without one, say so as a limitation and rest on content validity.',
    sources: [C18, H19],
  });
  return out;
}

interface WeightEntry {
  name: string;
  weight: number;
  loading: number;
  weightStat?: BootstrapStat;
  loadingStat?: BootstrapStat;
}

/**
 * Significance and relevance of formative weights (Hair et al. 2019, 2021; Cenfetelli & Bassellier
 * 2009): a significant weight is relevant; a non-significant one stays when its loading is at least
 * .50 or significant (absolute contribution); weight and loading both non-significant: consider
 * removing it, but only when content validity allows.
 */
function weightLine(a: {
  id: string;
  level: HocLine['level'];
  check: string;
  boot: BootstrapResult | null;
  entries: WeightEntry[];
  tab: HocTab;
}): HocLine {
  const base = {
    id: a.id,
    level: a.level,
    check: a.check,
    threshold:
      'Weight significant; if not, kept when the loading is ≥ .50 or significant (Hair et al., 2021; Cenfetelli & Bassellier, 2009)',
    sources: [H21, CB09, H19],
  };
  const weights = list(a.entries.map((e) => `${e.name} ${f3(e.weight)}`));
  if (!a.boot) {
    return {
      ...base,
      value: `Weights ${weights}`,
      status: 'attention',
      detail: 'Run bootstrapping (Model tab) to test the weights.',
      tab: a.tab,
    };
  }
  const missing = a.entries.filter((e) => !e.weightStat);
  if (missing.length === a.entries.length) {
    return {
      ...base,
      value: `Weights ${weights}`,
      status: 'notComputed',
      detail: 'The bootstrap results hold no intervals for these weights.',
      tab: 'bootstrap',
    };
  }
  const notSig = a.entries.filter((e) => e.weightStat && !significant(e.weightStat));
  const kept = notSig.filter(
    (e) => Math.abs(e.loading) >= 0.5 || (e.loadingStat && significant(e.loadingStat)),
  );
  const drop = notSig.filter((e) => !kept.includes(e));
  const describe = (e: WeightEntry) =>
    `${e.name} ${f3(e.weight)} (${e.weightStat ? pText(e.weightStat) : 'not bootstrapped'})`;
  const parts: string[] = [];
  if (!notSig.length) parts.push('Every weight is significant.');
  if (kept.length)
    parts.push(
      `Not significant but kept for its absolute contribution (loading ≥ .50 or significant): ${list(kept.map((e) => `${e.name} (loading ${f3(e.loading)})`))}.`,
    );
  if (drop.length)
    parts.push(
      `Weight and loading both not significant: ${list(drop.map((e) => e.name))}. Consider removing it only if content validity allows; a dimension or indicator that theory requires stays, and you report it as non-significant.`,
    );
  return {
    ...base,
    value: list(a.entries.map(describe)),
    status: drop.length ? 'attention' : 'pass',
    detail: parts.join(' '),
    tab: 'bootstrap',
  };
}

// ---------------------------------------------------------------- higher-order lines

function reflectiveHocLines(ctx: Ctx, derived: HocDerived): HocLine[] {
  const { pls, hoc, comps, approach } = ctx;
  const name = pls.constructs[hoc];
  const level = 'Higher-order construct' as const;
  const out: HocLine[] = [];
  const entries = comps.map((k) => ({
    name: pls.constructs[k],
    l: hoEntry(pls, hoc, k)?.loading ?? NaN,
  }));
  const repeated = approach === 'repeated';
  const rhoC = repeated ? derived.rhoC : pls.quality[hoc].rhoC;
  const ave = repeated ? derived.ave : pls.quality[hoc].ave;
  const rhoA = repeated ? NaN : pls.quality[hoc].rhoA;
  const alpha = repeated ? derived.alpha : pls.quality[hoc].alpha;
  const relOk = (v: number | null) => v !== null && Number.isFinite(v) && v >= 0.7 && v <= 0.95;

  const low = entries.filter((e) => e.l < 0.708);
  const keptLow =
    low.every((e) => e.l >= 0.4) && ave !== null && ave >= 0.5 && rhoC !== null && rhoC >= 0.7;
  out.push({
    id: 'hoc-loadings',
    level,
    check: `Loadings of the dimensions on ${name}`,
    value: list(entries.map((e) => `${e.name} ${f3(e.l)}`)),
    threshold:
      '≥ .708 (the LOC–HOC relationships read as loadings; Sarstedt et al., 2019; Hair et al., 2019)',
    status: low.length && !keptLow ? 'attention' : 'pass',
    detail:
      (repeated
        ? 'With repeated indicators the loading of a dimension is its correlation with the higher-order construct’s scores.'
        : 'Stage 2 measures the higher-order construct by its dimensions’ scores: these are its loadings.') +
      (low.length
        ? keptLow
          ? ' The lower loadings can stay: each is above .40 and the construct meets ρC and AVE.'
          : ` Below .708: ${list(low.map((e) => e.name))}: this dimension shares little with the others.`
        : ''),
    sources: [S19, H19],
    tab: 'outer',
  });

  out.push({
    id: 'hoc-reliability',
    level,
    check: `Internal consistency of ${name}`,
    value: [
      `ρC ${f2(rhoC ?? NaN)}`,
      ...(Number.isFinite(rhoA) ? [`ρA ${f2(rhoA)}`] : []),
      ...(alpha !== null && Number.isFinite(alpha) ? [`α ${f2(alpha)}`] : []),
    ].join(', '),
    threshold: 'ρC (and ρA) between .70 and .95 (Hair et al., 2019)',
    status:
      rhoC === null || !Number.isFinite(rhoC)
        ? 'notComputed'
        : relOk(rhoC) && (!Number.isFinite(rhoA) || relOk(rhoA))
          ? 'pass'
          : 'attention',
    detail: repeated
      ? 'Computed by PLS Studio from the dimensions’ loadings above and the correlations of their scores, as Sarstedt et al. (2019) describe for repeated indicators. The Reliability tab’s values for this construct come from the repeated indicators and do not apply. ρA is not computed: it needs weights of the dimension scores, which this approach does not estimate.'
      : 'From stage 2, where the dimensions’ scores are the construct’s indicators (the package’s own values).',
    sources: [S19, H19],
    tab: repeated ? undefined : 'reliability',
    computed: repeated,
  });

  out.push({
    id: 'hoc-ave',
    level,
    check: `Convergent validity (AVE) of ${name}`,
    value: ave === null ? '' : f2(ave),
    threshold: 'AVE ≥ .50 (Fornell & Larcker, 1981; Hair et al., 2019)',
    status:
      ave === null || !Number.isFinite(ave) ? 'notComputed' : ave >= 0.5 ? 'pass' : 'attention',
    detail: repeated
      ? 'Computed by PLS Studio as the mean squared loading of the dimensions (Sarstedt et al., 2019), not from the repeated indicators.'
      : 'From stage 2: the mean squared loading of the dimensions.',
    sources: [S19, 'fornell1981'],
    tab: repeated ? undefined : 'reliability',
    computed: repeated,
  });

  out.push(hocHtmtLine(ctx));
  return out;
}

/**
 * The HOC's discriminant validity: its HTMT with the other constructs, with the dimensions as its
 * indicators (Sarstedt et al. 2019). Only the two-stage results carry it (seminr computes it on
 * stage 2); cSEM reports stage 1's, and with repeated indicators the HTMT uses the repeated items.
 */
function hocHtmtLine(ctx: Ctx): HocLine {
  const { pls, hoc, comps, approach } = ctx;
  const name = pls.constructs[hoc];
  const others: { text: string; v: number }[] = [];
  for (let j = 0; j < pls.constructs.length; j++) {
    if (j === hoc || comps.includes(j)) continue;
    const v = htmtOf(pls, hoc, j);
    if (v !== null) others.push({ text: `${pls.constructs[j]} ${f2(v)}`, v });
  }
  const base = {
    id: 'hoc-htmt',
    level: 'Higher-order construct' as const,
    check: `Discriminant validity (HTMT) of ${name} with the other constructs`,
    threshold: 'Below .85 (.90 for conceptually similar constructs; Henseler et al., 2015)',
    sources: [S19, 'henseler2015'],
  };
  if (approach === 'two_stage' && others.length) {
    const failing = others.filter((o) => o.v >= 0.85);
    return {
      ...base,
      value: failing.length
        ? `At or above .85: ${list(failing.map((o) => o.text))}`
        : `Largest ${f2(Math.max(...others.map((o) => o.v)))}`,
      status: failing.length ? 'attention' : 'pass',
      detail:
        'From stage 2, with the dimensions’ scores as the indicators. Its HTMT with its own dimensions is not a criterion.',
      tab: 'discriminant',
    };
  }
  const why =
    approach === 'two_stage'
      ? 'The package reports the HTMT of stage 1, which does not contain the higher-order construct.'
      : 'The HTMT in the results uses the repeated indicators, not the dimensions as indicators, so it does not apply.';
  return {
    ...base,
    value: '',
    status: 'notComputed',
    detail: `${why} To assess it, estimate the model with the two-stage approach in seminr, which reports the stage 2 HTMT, or compare the construct correlations with the other constructs.`,
  };
}

function formativeHocLines(ctx: Ctx, derived: HocDerived): HocLine[] {
  const { pls, boot, hoc, comps, approach } = ctx;
  const name = pls.constructs[hoc];
  const level = 'Higher-order construct' as const;
  const out: HocLine[] = [];
  const compNames = comps.map((k) => pls.constructs[k]);

  // Collinearity among the dimensions (their scores are the formative "indicators").
  const vifs = compNames.map((n) => ({ name: n, v: derived.vif[n] }));
  const known = vifs.filter((x) => Number.isFinite(x.v));
  const high = known.filter((x) => x.v >= 5);
  const mid = known.filter((x) => x.v >= 3 && x.v < 5);
  out.push({
    id: 'hoc-vif',
    level,
    check: `Collinearity of the dimensions of ${name}`,
    value: list(known.map((x) => `${x.name} ${f2(x.v)}`)),
    threshold: 'VIF below 3 ideally; 5 or above is critical (Hair et al., 2019)',
    status: known.length < compNames.length ? 'notComputed' : high.length ? 'attention' : 'pass',
    detail:
      'Computed by PLS Studio from the correlations of the dimensions’ scores (the diagonal of their inverse). ' +
      (high.length
        ? 'High collinearity makes the weights unstable and can flip their signs; consider whether two dimensions measure the same thing.'
        : mid.length
          ? 'Between 3 and 5: possible collinearity; read the weights with care.'
          : 'No collinearity problem among the dimensions.') +
      (approach === 'repeated'
        ? ' The inner VIFs on the Path coefficients tab also include the construct’s other predictors.'
        : ''),
    sources: [H19, B12],
    computed: true,
  });

  // Weights of the dimensions: two-stage stage 2 weights, or the paths with repeated indicators.
  out.push(
    weightLine({
      id: 'hoc-weights',
      level,
      check: `Significance and relevance of the dimensions’ weights in ${name}`,
      boot,
      entries: comps.map((k) => {
        const h = hoEntry(pls, hoc, k);
        const cn = pls.constructs[k];
        const weightKey = approach === 'repeated' ? `path:${cn}:${name}` : `hoWeight:${name}:${cn}`;
        return {
          name: cn,
          weight: h?.weight ?? NaN,
          loading: h?.loading ?? NaN,
          weightStat: stat(boot, weightKey),
          loadingStat: stat(boot, `hoLoading:${name}:${cn}`),
        };
      }),
      tab: 'outer',
    }),
  );

  // Signs: a weight whose sign differs from its loading's.
  const flipped = comps
    .map((k) => ({ name: pls.constructs[k], h: hoEntry(pls, hoc, k) }))
    .filter((x) => x.h && Math.sign(x.h.weight) !== Math.sign(x.h.loading) && x.h.weight !== 0);
  out.push({
    id: 'hoc-signs',
    level,
    check: `Signs of the dimensions’ weights in ${name}`,
    value: flipped.length
      ? list(
          flipped.map((x) => `${x.name}: weight ${f3(x.h!.weight)}, loading ${f3(x.h!.loading)}`),
        )
      : 'Weights and loadings agree in sign',
    threshold: 'A weight’s sign should match its loading’s (Cenfetelli & Bassellier, 2009)',
    status: flipped.length ? 'attention' : 'pass',
    detail: flipped.length
      ? 'A weight of the opposite sign to its loading usually reflects collinearity or suppression among the dimensions, not a negative contribution. Read the loading for the dimension’s absolute contribution, check the VIFs, and do not interpret the weight’s sign on its own.'
      : 'No sign reversal between weights and loadings.',
    sources: [CB09, H21],
    tab: 'outer',
  });

  out.push(redundancyLine(ctx));
  return out;
}

/**
 * Convergent validity of a formative HOC: a redundancy analysis needs a global item, which the
 * model cannot identify. A single-item construct predicted by the HOC alone may be one: its path
 * is then the redundancy coefficient, which the author has to confirm.
 */
function redundancyLine(ctx: Ctx): HocLine {
  const { pls, hoc } = ctx;
  const name = pls.constructs[hoc];
  const candidates: { name: string; path: number }[] = [];
  for (let j = 0; j < pls.constructs.length; j++) {
    if (j === hoc || !pls.hasPath[hoc]?.[j]) continue;
    const single = block(pls, j).length === 1;
    const onlyPredictor = pls.hasPath.every((row, i) => !row[j] || i === hoc);
    if (single && onlyPredictor) {
      candidates.push({ name: pls.constructs[j], path: pls.pathCoef[hoc][j] });
    }
  }
  const paths = candidates.map((c) => `${name} → ${c.name} ${f3(c.path)}`);
  const candidateText = candidates.length
    ? ` If ${list(candidates.map((c) => c.name))} is a global measure of ${name}, its path is the redundancy coefficient: ${list(paths)}.`
    : '';
  return {
    id: 'hoc-redundancy',
    level: 'Higher-order construct',
    check: `Convergent validity (redundancy analysis) of ${name}`,
    value: '',
    threshold:
      'Path from the construct to a global single item ≥ .70 (Cheah et al., 2018; Hair et al., 2019)',
    status: 'notComputed',
    detail:
      'Not computed: the model does not say which item is a global measure of the construct.' +
      candidateText +
      ' With a global item, add it as a single-item construct and draw a path from the higher-order construct to it. Without one, the convergent validity of a formative construct cannot be tested: report this as a limitation and argue content validity from the theory behind the dimensions (Sarstedt et al., 2019; Hair et al., 2021).',
    sources: [C18, H19, S19, H21],
  };
}

function structuralLines(ctx: Ctx): HocLine[] {
  const { pls, hoc, comps, approach } = ctx;
  if (approach !== 'repeated') return [];
  const name = pls.constructs[hoc];
  const antecedents = pls.constructs
    .map((n, i) => ({ n, i }))
    .filter(({ i }) => pls.hasPath[i]?.[hoc] && !comps.includes(i));
  if (!antecedents.length) return [];
  return [
    {
      id: 'hoc-antecedents',
      level: 'Structural model',
      check: `Paths into ${name} with repeated indicators`,
      value: list(antecedents.map(({ n, i }) => `${n} → ${name} ${f3(pls.pathCoef[i][hoc])}`)),
      threshold:
        'With antecedents, use a two-stage approach (Becker et al., 2012; Ringle et al., 2012)',
      status: 'attention',
      detail:
        'With repeated indicators the dimensions explain nearly all of the higher-order construct’s variance, so paths from other constructs into it are biased towards zero. Test them with the embedded or disjoint two-stage approach (Model settings).',
      sources: [B12, R12, S19],
      tab: 'paths',
    },
  ];
}

// ---------------------------------------------------------------- not to interpret, advice

function ignoreList(ctx: Ctx, type: HocType): HocIgnore[] {
  const { pls, hoc, comps, approach } = ctx;
  const name = pls.constructs[hoc];
  const out: HocIgnore[] = [];
  const q = pls.quality[hoc];
  if (approach === 'repeated' && Number.isFinite(q.rhoC)) {
    out.push({
      what: `${name}’s α, ρA, ρC and AVE on the Reliability tab`,
      value: `ρC ${f2(q.rhoC)}, AVE ${f2(q.ave)}`,
      why:
        type.higher === 'reflective'
          ? 'Computed on the repeated indicators, as if every item measured the construct directly. Use the values computed from the dimensions’ loadings above.'
          : 'Computed on the repeated indicators; a formative construct is not assessed by internal consistency at all.',
      sources: [S19],
      tab: 'reliability',
    });
  }
  if (approach !== 'repeated' && type.higher === 'formative' && Number.isFinite(q.rhoC)) {
    out.push({
      what: `${name}’s reliability and AVE`,
      value: `ρC ${f2(q.rhoC)}, AVE ${f2(q.ave)}`,
      why: 'A formative construct need not be internally consistent: its dimensions can be uncorrelated.',
      sources: [H19, S19],
      tab: 'reliability',
    });
  }
  const r2 = pls.rSquared[hoc];
  if (approach === 'repeated' && r2 !== null) {
    out.push({
      what: `R² of ${name}`,
      value: f3(r2),
      why: 'Close to 1 by construction (with PLSc it can even exceed 1): the dimensions predict the construct and share its items. It says nothing about the model.',
      sources: [B12, R12],
      tab: 'overview',
    });
  }
  const ownHtmt = comps
    .map((k) => ({ n: pls.constructs[k], v: htmtOf(pls, hoc, k) }))
    .filter((x): x is { n: string; v: number } => x.v !== null);
  if (ownHtmt.length) {
    out.push({
      what: `HTMT of ${name} with its own dimensions`,
      value: list(ownHtmt.map((x) => `${x.n} ${f2(x.v)}`)),
      why: 'The dimensions are part of the construct, so a high value is expected and not a discriminant validity problem.',
      sources: [S19],
      tab: 'discriminant',
    });
  }
  const otherHtmt = pls.constructs.some(
    (_, j) => j !== hoc && !comps.includes(j) && htmtOf(pls, hoc, j) !== null,
  );
  if (approach !== 'two_stage' && otherHtmt) {
    out.push({
      what: `HTMT of ${name} with the other constructs`,
      value: '',
      why:
        approach === 'repeated'
          ? 'Computed on the repeated indicators, not with the dimensions as indicators.'
          : 'Computed in stage 1 on the repeated indicators, not with the dimensions as indicators.',
      sources: [S19],
      tab: 'discriminant',
    });
  }
  return out;
}

function adviceList(ctx: Ctx, type: HocType): HocAdvice[] {
  const out: HocAdvice[] = [];
  if (type.higher === 'formative') {
    out.push(
      {
        title: 'Weights that change sign',
        text: 'The dimensions’ weights are partial effects, like regression coefficients, and depend on how the dimensions correlate. With collinear dimensions a weight can turn negative, or flip when the model changes (another structural model changes the dimension scores of a two-stage estimate). Look at the loadings for each dimension’s absolute contribution and at the VIFs before reading a weight’s sign. A whole construct can also flip sign, since PLS scores are only defined up to sign: set a dominant indicator for a dimension to fix its direction (construct inspector; cSEM).',
        sources: [CB09, H21, B12],
      },
      {
        title: 'A dimension that is not significant',
        text: 'Keep it when its loading is at least .50 or significant: it still contributes in absolute terms. Only when weight and loading are both not significant is removal an option, and only if content validity survives; for a higher-order construct the dimensions usually come from theory, so most authors keep the dimension and report it as not significant.',
        sources: [CB09, H21],
      },
      {
        title: 'No global item for the redundancy analysis',
        text: 'Convergent validity of a formative construct is assessed by its path to a global single item (≥ .70). If the questionnaire has none, say so as a limitation, argue content validity from the definition of the dimensions, and plan a global item for the next study. Do not substitute reliability or AVE: they do not apply to a formative construct.',
        sources: [C18, S19, H21],
      },
    );
  }
  if (type.higher === 'reflective' && ctx.approach === 'repeated') {
    out.push({
      title: 'Reliability of a reflective higher-order construct',
      text: 'Software reports the construct’s reliability and AVE on its repeated indicators. They are not the construct’s: read its dimensions as its indicators and compute ρC and AVE from their loadings, as done above.',
      sources: [S19],
    });
  }
  return out;
}

// ---------------------------------------------------------------- entry points

/** The model's higher-order constructs (with components) that the result contains, by name. */
function hocConstructs(model: ModelState, pls: PlsResult) {
  const byId = new Map(model.constructs.map((k) => [k.id, k]));
  return model.constructs
    .filter((k) => k.components?.length)
    .map((k) => ({
      k,
      index: pls.constructs.indexOf(k.name),
      comps: (k.components ?? []).map((id) => byId.get(id)).filter((x): x is Construct => !!x),
    }))
    .filter((h) => h.index >= 0 && h.comps.every((c) => pls.constructs.includes(c.name)));
}

/** The guided check of every higher-order construct in the model (empty when there is none). */
export function hocChecks(input: HocInput): HocCheck[] {
  const { model, pls, boot, plsPackage } = input;
  if (!pls.higherOrder?.length) return [];
  const approach = pls.hocApproach ?? input.approach;
  const hocs = hocConstructs(model, pls);
  const hocSet = new Set(hocs.map((h) => h.index));
  return hocs.map((h) => {
    const comps = h.comps.map((c) => pls.constructs.indexOf(c.name));
    const lowers = h.comps.map(measurementOf);
    const type = hocType(lowers, hocMeasurement(h.k, approach, plsPackage));
    const ctx: Ctx = { pls, boot, approach, hoc: h.index, comps, hocs: hocSet };
    const derived = derive(pls, h.index, comps);
    const reflective = comps.filter((_, i) => lowers[i] === 'reflective');
    const formative = comps.filter((_, i) => lowers[i] === 'formative');
    const lines: HocLine[] = [
      ...(reflective.length ? reflectiveLocLines(ctx, reflective) : []),
      ...(formative.length ? formativeLocLines(ctx, formative) : []),
      ...(type.higher === 'reflective'
        ? reflectiveHocLines(ctx, derived)
        : formativeHocLines(ctx, derived)),
      ...structuralLines(ctx),
    ];
    return {
      name: h.k.name,
      components: h.comps.map((c) => c.name),
      type,
      approach,
      derived,
      lines,
      ignore: ignoreList(ctx, type),
      advice: adviceList(ctx, type),
    };
  });
}

/** Pairs of constructs (by index) whose HTMT is not a discriminant validity criterion: a HOC with its own LOCs, and any HOC whose HTMT comes from repeated indicators. */
export function hocHtmtExclusions(input: HocInput): (i: number, j: number) => boolean {
  const { model, pls } = input;
  const approach = pls.hocApproach ?? input.approach;
  const hocs = pls.higherOrder?.length ? hocConstructs(model, pls) : [];
  const own = new Set<string>();
  const repeatedItems = new Set<number>();
  for (const h of hocs) {
    for (const c of h.comps) {
      const k = pls.constructs.indexOf(c.name);
      own.add(`${h.index}:${k}`);
      own.add(`${k}:${h.index}`);
    }
    if (approach !== 'two_stage') repeatedItems.add(h.index);
  }
  return (i, j) => own.has(`${i}:${j}`) || repeatedItems.has(i) || repeatedItems.has(j);
}

const APPROACH_TEXT: Record<HocApproach, string> = {
  two_stage: 'two-stage',
  embedded: 'embedded two-stage',
  repeated: 'repeated indicators',
};

/** One reviewer-checklist item per HOC, summarising its guided check (reporting/checklist.ts). */
export function hocChecklistItems(input: HocInput): CheckItem[] {
  return hocChecks(input).map((h) => {
    const attention = h.lines.filter((l) => l.status === 'attention');
    const missing = h.lines.filter((l) => l.status === 'notComputed');
    let status: CheckStatus = 'done';
    if (attention.length) status = 'issue';
    else if (missing.length) status = 'author';
    const parts = [`${h.type.label} (${APPROACH_TEXT[h.approach]}).`];
    if (attention.length) parts.push(`Needs attention: ${list(attention.map((l) => l.check))}.`);
    if (missing.length)
      parts.push(`Not computed, for you to address: ${list(missing.map((l) => l.check))}.`);
    if (!attention.length && !missing.length) parts.push('Every applicable check passes.');
    return {
      id: `hoc:${h.name}`,
      section: 'Measurement model',
      label: `Higher-order construct ${h.name} validated for its type and approach`,
      status,
      evidence: parts.join(' '),
      sources: [S19, B12],
      link: { kind: 'tab', label: 'Higher-order constructs' },
    };
  });
}
