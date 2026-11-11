// Dynamic fit index (DFI) cutoffs for the CB-SEM model on the canvas: the dynamic package
// (Wolf & McNeish; dynamicfit.app) run on the model's lavaan fit. The package simulates the
// model's own fit-index distributions, correctly specified and under graded hypothetical
// misspecifications, and reads cutoffs tailored to the model and sample size off them. The
// card picks the dynamic function that fits the model's shape (one- or multi-factor CFA,
// ordinal indicators, Likert or non-normal data, hierarchical factors, any covariance structure
// for DDDFI, the test of exact fit, equivalence testing) and shows the package's tables as it
// prints them, the model's indices against them, and the simulated distributions.

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { c, Table, type Row } from '../components/results/Table';
import type { Dataset } from '../engine/types';
import { fmt, noLeadingZero } from '../format';
import { type ModelState } from '../model/project';
import {
  DFI_ESTIMATORS,
  DFI_FUNCTIONS,
  type DfiArgs,
  type DfiEstimator,
  type DfiFn,
  type DfiResult,
  type DfiScale,
  type DfiTable,
} from '../rengine/dfi';
import { Axes, H, pad, W } from './charts';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { clampNum, isObj, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType } from './types';
import { SERIES_COLORS } from '../figure/palette';

export type DfiOptions = DfiArgs;
export const DFI_CARD_ID = 'dynamicfit';
export const DFI_TITLE = 'Dynamic fit cutoffs';
const DEFAULT_MAD = [0.038, 0.05, 0.06];

// ---------- the model's shape, and which dynamic functions fit it ----------

export interface DfiShape {
  /** First-order common factors (observed covariates and higher-order factors not counted). */
  factors: number;
  /** A higher-order (hierarchical) factor. */
  hoc: boolean;
  /** Structural paths (regressions). */
  structural: boolean;
  /** How many of the first-order factors' indicators are declared ordinal. */
  ordinal: 'none' | 'some' | 'all';
  /** Raw data (not a covariance matrix). */
  raw: boolean;
  /** Every indicator is integer-valued with 2 to 11 distinct values (Likert-type items). */
  likert: boolean;
  /** Why no dynamic function applies at all (null when the shape is fine). */
  problem: string | null;
}

export function dfiShape(model: ModelState | undefined, data: Dataset | null): DfiShape {
  const none: DfiShape = {
    factors: 0,
    hoc: false,
    structural: false,
    ordinal: 'none',
    raw: false,
    likert: false,
    problem: 'Draw a CB-SEM model first (Model tab).',
  };
  if (!model?.constructs.length) return none;
  const latent = model.constructs.filter((k) => !k.covariate);
  const first = latent.filter((k) => !k.components?.length);
  const indicators = [...new Set(first.flatMap((k) => k.indicators))];
  const ordered = new Set(model.ordered ?? []);
  const nOrd = indicators.filter((v) => ordered.has(v)).length;
  const raw = !!data && !!rawData({ data } as AnalysisCtx);
  const likert =
    raw &&
    indicators.length > 0 &&
    indicators.every((v) => {
      const col = data!.cols[data!.names.indexOf(v)];
      if (!col) return false;
      const seen = new Set<number>();
      for (const x of col) {
        if (Number.isNaN(x)) continue;
        if (!Number.isInteger(x)) return false;
        seen.add(x);
        if (seen.size > 11) return false;
      }
      return seen.size >= 2;
    });
  let problem: string | null = null;
  if (model.multigroup)
    problem =
      'Dynamic fit cutoffs are for a single group: remove the grouping (or analyse each group’s data).';
  else if (model.multilevel)
    problem = 'Dynamic fit cutoffs are not available for two-level models.';
  else if (model.constructs.some((k) => k.type === 'composite'))
    problem = 'Dynamic fit cutoffs are for common-factor models; the model has composites.';
  else if (model.moderations.length)
    problem = 'Dynamic fit cutoffs are not available with latent interactions.';
  else if (model.esem?.blocks?.length)
    problem = 'Dynamic fit cutoffs are not available for ESEM blocks.';
  else if (!first.length) problem = 'Dynamic fit cutoffs need at least one common factor.';

  let ordinal: DfiShape['ordinal'] = 'some';
  if (nOrd === 0) ordinal = 'none';
  else if (nOrd === indicators.length) ordinal = 'all';

  return {
    factors: first.length,
    hoc: latent.some((k) => !!k.components?.length),
    structural: model.paths.length > 0,
    ordinal,
    raw,
    likert,
    problem,
  };
}

export interface DfiFnInfo {
  id: DfiFn;
  /** Short label for the menu. */
  label: string;
  /** What the function does, for the hint. */
  what: string;
  defaultReps: number;
  /** The estimator the package uses inside the simulations by default. */
  defaultEstimator: string;
  /** Why the function does not fit this shape (null when it does); the sentence follows "dynamic::<fn> …". */
  fits: (s: DfiShape) => string | null;
}

const cfaOnly = (s: DfiShape) => {
  if (s.structural)
    return 'is for CFA models without structural paths; for a model with paths use DDDFI (or exactFit, equivTest).';
  if (s.hoc)
    return 'is for first-order CFA models; for a hierarchical factor model use hier1HB or hier2.';
  return null;
};
const continuous = (s: DfiShape) =>
  s.ordinal !== 'none'
    ? 'is for continuous indicators; with ordinal indicators use catOne, catHB or DDDFI.'
    : null;
const one = (s: DfiShape, other: string) =>
  s.factors !== 1
    ? `is for one-factor models; this model has ${s.factors} factors (use ${other}).`
    : null;
const multi = (s: DfiShape, other: string) =>
  s.factors < 2 ? `is for models with two or more factors (use ${other}).` : null;
const likertData = (s: DfiShape) => {
  if (s.ordinal !== 'none')
    return 'treats Likert items as continuous: declare no ordinal indicators (or use catOne / catHB).';
  if (!s.raw) return 'needs raw data (the items’ response frequencies), not a covariance matrix.';
  if (!s.likert) return 'needs integer-valued Likert-type items with at most 11 categories.';
  return null;
};
const rawOnly = (s: DfiShape) => {
  if (s.ordinal !== 'none')
    return 'is for continuous indicators (MLR); with ordinal indicators use catOne, catHB or DDDFI.';
  if (!s.raw)
    return 'needs raw data (a modified Bollen–Stine bootstrap of them), not a covariance matrix.';
  return null;
};
/** For hier1HB and hier2. */
const hierarchicalOnly = (s: DfiShape) => {
  if (!s.hoc) return 'is for hierarchical (second-order) factor models; this model has none.';
  if (s.structural) return 'is for hierarchical CFA models without structural paths.';
  return continuous(s);
};

export const DFI_FN_INFO: DfiFnInfo[] = [
  {
    id: 'cfaOne',
    label: 'cfaOne — one-factor CFA',
    what: 'DFI cutoffs for a one-factor CFA: up to three levels of omitted residual correlations, scaled to the number of items (McNeish & Wolf 2023).',
    defaultReps: 500,
    defaultEstimator: 'ML',
    fits: (s) => cfaOnly(s) ?? continuous(s) ?? one(s, 'cfaHB'),
  },
  {
    id: 'cfaHB',
    label: 'cfaHB — multi-factor CFA',
    what: 'DFI cutoffs for a multi-factor CFA adapted from Hu & Bentler (1999): one level per omitted cross-loading, F − 1 levels for F factors, each with its magnitude (McNeish & Wolf 2023).',
    defaultReps: 500,
    defaultEstimator: 'ML',
    fits: (s) => cfaOnly(s) ?? continuous(s) ?? multi(s, 'cfaOne'),
  },
  {
    id: 'catOne',
    label: 'catOne — one-factor CFA, ordinal items',
    what: 'DFI cutoffs for a one-factor CFA with ordinal indicators (McNeish 2023): simulated as categorical data, fitted by WLSMV.',
    defaultReps: 250,
    defaultEstimator: 'WLSMV',
    fits: (s) =>
      cfaOnly(s) ??
      (s.ordinal !== 'all'
        ? 'is for models whose indicators are all ordinal (WLSMV); for continuous indicators use cfaOne.'
        : null) ??
      one(s, 'catHB'),
  },
  {
    id: 'catHB',
    label: 'catHB — multi-factor CFA, ordinal items',
    what: 'DFI cutoffs for a multi-factor CFA with ordinal indicators (McNeish 2023): omitted cross-loadings, categorical data, WLSMV.',
    defaultReps: 250,
    defaultEstimator: 'WLSMV',
    fits: (s) =>
      cfaOnly(s) ??
      (s.ordinal !== 'all'
        ? 'is for models whose indicators are all ordinal (WLSMV); for continuous indicators use cfaHB.'
        : null) ??
      multi(s, 'catOne'),
  },
  {
    id: 'likertOne',
    label: 'likertOne — one-factor CFA, Likert items as continuous',
    what: 'DFI cutoffs for a one-factor CFA of Likert-type items treated as continuous: the simulated items keep the data’s response categories and frequencies.',
    defaultReps: 250,
    defaultEstimator: 'ML',
    fits: (s) => cfaOnly(s) ?? likertData(s) ?? one(s, 'likertHB'),
  },
  {
    id: 'likertHB',
    label: 'likertHB — multi-factor CFA, Likert items as continuous',
    what: 'DFI cutoffs for a multi-factor CFA of Likert-type items treated as continuous (omitted cross-loadings), with the data’s response frequencies.',
    defaultReps: 250,
    defaultEstimator: 'ML',
    fits: (s) => cfaOnly(s) ?? likertData(s) ?? multi(s, 'likertOne'),
  },
  {
    id: 'nnorOne',
    label: 'nnorOne — one-factor CFA, non-normal data',
    what: 'DFI cutoffs for a one-factor CFA with continuous non-normal (possibly incomplete) data: a modified Bollen–Stine bootstrap of the data creates the hypothetical misspecified data; MLR.',
    defaultReps: 500,
    defaultEstimator: 'MLR',
    fits: (s) => cfaOnly(s) ?? rawOnly(s) ?? one(s, 'nnorHB'),
  },
  {
    id: 'nnorHB',
    label: 'nnorHB — multi-factor CFA, non-normal data',
    what: 'DFI cutoffs for a multi-factor CFA with continuous non-normal data (omitted cross-loadings), by a modified Bollen–Stine bootstrap; MLR.',
    defaultReps: 500,
    defaultEstimator: 'MLR',
    fits: (s) => cfaOnly(s) ?? rawOnly(s) ?? multi(s, 'nnorOne'),
  },
  {
    id: 'hier1HB',
    label: 'hier1HB — hierarchical factors, measurement misspecification',
    what: 'DFI cutoffs for a hierarchical (second-order) factor model with misspecification in the measurement part, adapted from Hu & Bentler (1999).',
    defaultReps: 500,
    defaultEstimator: 'ML',
    fits: hierarchicalOnly,
  },
  {
    id: 'hier2',
    label: 'hier2 — hierarchical factors, structural misspecification',
    what: 'DFI cutoffs for a hierarchical factor model with misspecification in the structural part (the first-order factors’ covariances).',
    defaultReps: 500,
    defaultEstimator: 'ML',
    fits: hierarchicalOnly,
  },
  {
    id: 'exactFit',
    label: 'exactFit — test of exact fit',
    what: 'The fit indices’ distributions when the model is exactly right (the data generated from the model as estimated): 95th and 99th percentiles of χ², SRMR and RMSEA, 5th and 1st of CFI.',
    defaultReps: 500,
    defaultEstimator: 'ML',
    fits: (s) => continuous(s),
  },
  {
    id: 'equivTest',
    label: 'equivTest — equivalence testing',
    what: 'Yuan, Chan, Marcoulides & Bentler’s (2016) T-size RMSEA and CFI and their adjusted cutoffs for this model’s df and N; no simulation.',
    defaultReps: 500,
    defaultEstimator: '',
    fits: () => null,
  },
  {
    id: 'DDDFI',
    label: 'DDDFI — direct discrepancy DFI (any covariance structure)',
    what: 'Direct discrepancy DFI (3DFI) cutoffs for arbitrary covariance structure models, structural paths included: misspecifications defined by the mean absolute discrepancy (MAD) between implied and population correlations (.038, .05, .06 recreate “close”, “fair”, “mediocre”); normal, non-normal or categorical data.',
    defaultReps: 250,
    defaultEstimator: 'ML / MLR / WLSMV by the scale',
    fits: () => null,
  },
];
export const dfiInfo = (fn: DfiFn) => DFI_FN_INFO.find((f) => f.id === fn)!;

/** The dynamic function the model's shape calls for. */
export function dfiDefaultFn(s: DfiShape): DfiFn {
  const cfa = !s.structural && !s.hoc;
  if (s.ordinal === 'all') {
    if (!cfa) return 'DDDFI';
    return s.factors === 1 ? 'catOne' : 'catHB';
  }
  if (s.ordinal === 'some') return 'DDDFI';
  if (s.hoc && !s.structural) return 'hier1HB';
  if (s.structural) return 'DDDFI';
  return s.factors === 1 ? 'cfaOne' : 'cfaHB';
}

const defaultScale = (s: DfiShape): DfiScale =>
  s.ordinal === 'all' && s.raw ? 'categorical' : 'normal';

/** Why the options cannot run on this shape (null when they can); the model itself was checked by cbModelBlocked. */
export function dfiBlocked(o: DfiOptions, s: DfiShape): string | null {
  if (s.problem) return s.problem;
  const why = dfiInfo(o.fn).fits(s);
  if (why) return `dynamic::${o.fn} ${why}`;
  if (o.fn === 'DDDFI' && o.scale === 'categorical' && (s.ordinal !== 'all' || !s.raw))
    return 'DDDFI on the categorical scale needs raw data with every indicator declared ordinal.';
  if (o.fn === 'DDDFI' && o.scale === 'nonnormal' && !s.raw)
    return 'DDDFI on the non-normal scale needs raw data.';
  if (o.fn === 'DDDFI' && o.scale === 'normal' && s.ordinal !== 'none')
    return 'With ordinal indicators DDDFI simulates on the categorical scale: choose it.';
  return null;
}

// ---------- reading the package's tables ----------

/** A printed cell as a number: ".039" → 0.039; "NONE", "--", "" and percentages → null. */
export const dfiNumber = (s: string | undefined): number | null => {
  if (!s) return null;
  const t = s.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

export interface DfiLevel {
  label: string;
  /** 'true': the correctly specified model's quantile (Level 0, "Consistent"); 'misspec': a misspecification level; 'exact': a percentile of the exact-fit distribution. */
  kind: 'true' | 'misspec' | 'exact';
  srmr: number | null;
  rmsea: number | null;
  cfi: number | null;
  chisq: number | null;
  /** DDDFI: the cutoff for the upper limit of the RMSEA 90% CI. */
  rmseaHigh: number | null;
  magnitude: string | null;
}

/** The cutoff rows of a dynamic table: the new layout (Level-k rows with Specificity / Sensitivity rows under them), the older one (Level k: 95/5 and 90/10), DDDFI's (Consistent, Close, Fair, Mediocre) and exactFit's (99th, 95th). */
export function dfiLevels(t: DfiTable | null): DfiLevel[] {
  if (!t) return [];
  const col = (name: string) => t.columns.findIndex((k) => k.trim().toLowerCase() === name);
  const iS = col('srmr'),
    iR = col('rmsea'),
    iC = col('cfi'),
    iX = col('chi-square'),
    iM = col('magnitude'),
    iH = col('90% ci');
  const out: DfiLevel[] = [];
  t.rows.forEach((name, i) => {
    const row = t.cells[i] ?? [];
    const n = name.trim();
    if (!n || /^(specificity|sensitivity)$/i.test(n)) return;
    const at = (j: number) => (j >= 0 ? dfiNumber(row[j]) : null);
    const m = /^Level[- ](\d+)(?::\s*(95\/5|90\/10))?$/i.exec(n);
    let kind: DfiLevel['kind'] = 'misspec',
      label = n;
    if (m) {
      const [, level, split] = m;
      kind = level === '0' ? 'true' : 'misspec';
      if (split) label = `Level ${level} (${split})`;
      else if (level === '0') label = 'Level 0 (correct model)';
      else label = `Level ${level}`;
    } else if (/^consistent$/i.test(n)) {
      kind = 'true';
      label = 'Consistent (correct model)';
    } else if (/^(\d+)(st|nd|rd|th):?$/i.test(n)) {
      kind = 'exact';
      label = `${n.replace(':', '')} percentile`;
    }
    out.push({
      label,
      kind,
      srmr: at(iS),
      rmsea: at(iR),
      cfi: at(iC),
      chisq: at(iX),
      rmseaHigh: at(iH),
      magnitude: iM >= 0 && row[iM]?.trim() ? row[iM].trim() : null,
    });
  });
  return out;
}

export interface DfiEmpirical {
  chisq: number | null;
  df: number | null;
  p: number | null;
  srmr: number | null;
  rmsea: number | null;
  cfi: number | null;
  rmseaHigh: number | null;
}

/**
 * The model's fit indices as the package reports them (rounded to 3 decimals). dynamic writes the row in its
 * fitmeasures() order: six values are χ², df, p, SRMR, RMSEA, CFI; seven are χ², df, p, SRMR, CFI, RMSEA and
 * the upper RMSEA limit (its column names do not all say so).
 */
export function dfiEmpirical(t: DfiTable | null): DfiEmpirical | null {
  const v = t?.cells[0]?.map(dfiNumber);
  if (!v || (v.length !== 6 && v.length !== 7)) return null;
  return v.length === 6
    ? { chisq: v[0], df: v[1], p: v[2], srmr: v[3], rmsea: v[4], cfi: v[5], rmseaHigh: null }
    : { chisq: v[0], df: v[1], p: v[2], srmr: v[3], cfi: v[4], rmsea: v[5], rmseaHigh: v[6] };
}

export type DfiIndex = 'χ²' | 'SRMR' | 'RMSEA' | 'CFI';
export interface DfiVerdict {
  index: DfiIndex;
  /** The verdict in a few words, for the fit table's column ("clears no level"); `verdict` says it with the numbers. */
  short?: string;
  /** The model's value, as the package prints it. */
  value: number | null;
  /** The cutoffs the value is held against, in the package's order. */
  cutoffs: { label: string; value: number | null }[];
  /** What the comparison says, in words. */
  verdict: string;
  /** true: good news (clears the mildest level, within exact fit, excellent or close); false: bad; null: undecided. */
  ok: boolean | null;
}

/** The numbers in an equivTest bin ("Close: .048 to .075"). */
const binNumbers = (s: string) =>
  (s.match(/-?\.\d+|-?\d+\.\d+|\b\d+\b/g) ?? []).map(Number).filter((x) => Number.isFinite(x));

function equivVerdict(index: 'RMSEA' | 'CFI', value: number | null, bins: string[]): DfiVerdict {
  // The bins are printed from excellent to poor; each names its boundary values. Lower is better for RMSEA, higher for CFI.
  const names = bins.map((b) => b.split(':')[0].trim());
  const bounds = bins.map(binNumbers);
  const cutoffs = bins.map((_, i) => ({
    label: names[i],
    value: bounds[i][bounds[i].length - 1] ?? null,
  }));
  if (value === null) return { index, value, cutoffs, verdict: 'not available', ok: null };
  let at = -1;
  const edges = [bounds[0]?.[0], bounds[1]?.[1], bounds[2]?.[1], bounds[3]?.[1]];
  if (edges.every((e) => typeof e === 'number')) {
    // The first bin whose boundary the value is on the good side of; past the last boundary, bin 4.
    const withinBound = (edge: number) => (index === 'RMSEA' ? value <= edge : value >= edge);
    const bin = (edges as number[]).findIndex(withinBound);
    at = bin < 0 ? 4 : bin;
  }
  const name = at >= 0 ? (names[at] ?? 'poor') : '';
  return {
    index,
    value,
    cutoffs,
    verdict:
      at >= 0
        ? `${name.toLowerCase()} fit by the adjusted bins (T-size ${index} ${fmt(value, 3)})`
        : 'the bins could not be read',
    ok: at < 0 ? null : at <= 1,
  };
}

/** The model's indices against the cutoffs: what each index clears. */
export function dfiVerdicts(r: DfiResult): DfiVerdict[] {
  if (r.fn === 'equivTest' && r.equiv) {
    return [
      equivVerdict('RMSEA', dfiNumber(r.equiv.rmsea), r.equiv.rmseaBins),
      equivVerdict('CFI', dfiNumber(r.equiv.cfi), r.equiv.cfiBins),
    ];
  }
  const emp = dfiEmpirical(r.fit);
  const levels = dfiLevels(r.cutoffs);
  const indices: {
    index: DfiIndex;
    key: 'chisq' | 'srmr' | 'rmsea' | 'cfi';
    higherBetter: boolean;
  }[] = [
    ...(r.fn === 'exactFit'
      ? [{ index: 'χ²' as const, key: 'chisq' as const, higherBetter: false }]
      : []),
    { index: 'SRMR', key: 'srmr', higherBetter: false },
    { index: 'RMSEA', key: 'rmsea', higherBetter: false },
    { index: 'CFI', key: 'cfi', higherBetter: true },
  ];
  return indices.flatMap(({ index, key, higherBetter }): DfiVerdict[] => {
    const rows = levels.filter((l) => l.kind !== 'true');
    const cutoffs = rows.map((l) => ({ label: l.label, value: l[key] }));
    if (!cutoffs.length || (cutoffs.every((k) => k.value === null) && r.fn !== 'DDDFI')) {
      if (r.fn === 'DDDFI' && key === 'srmr') return [];
      return [
        {
          index,
          value: emp?.[key] ?? null,
          cutoffs,
          verdict: cutoffs.length
            ? 'no cutoff: the fit-index distributions of the correct and the misspecified models overlap too much'
            : 'not reported by this function',
          ok: null,
        },
      ];
    }
    if (r.fn === 'DDDFI' && key === 'srmr') return []; // (DDDFI reports CFI and RMSEA cutoffs only)
    const value = emp?.[key] ?? null;
    if (value === null)
      return [{ index, value, cutoffs, verdict: 'the model’s value is not available', ok: null }];
    const better = (cut: number) => (higherBetter ? value >= cut : value <= cut);
    if (r.fn === 'exactFit') {
      // Percentiles of the exact-fit distribution, printed 99th then 95th.
      const p95 = cutoffs.find((k) => /95/.test(k.label))?.value ?? null;
      const p99 = cutoffs.find((k) => /99/.test(k.label))?.value ?? null;
      const within95 = p95 !== null && better(p95);
      const within99 = p99 !== null && better(p99);
      let verdict: string;
      let ok: boolean | null;
      if (within95) {
        verdict =
          'within the 95th percentile of exact fit: consistent with an exactly fitting model';
        ok = true;
      } else if (within99) {
        verdict = 'between the 95th and 99th percentiles of exact fit';
        ok = null;
      } else {
        verdict =
          'beyond the 99th percentile of exact fit: worse than an exactly fitting model gives';
        ok = false;
      }
      return [{ index, value, cutoffs, verdict, ok }];
    }
    // Misspecification levels in increasing severity: the first one the value is better than is the one it clears.
    const first = cutoffs.findIndex((k) => k.value !== null);
    const clears = cutoffs.findIndex((k) => k.value !== null && better(k.value));
    const last = cutoffs[cutoffs.length - 1];
    // Said with the numbers: which cutoffs the model's value is on the right side of, and what that means.
    const num = (x: number) => noLeadingZero(fmt(x, 3));
    const at = (k: { label: string; value: number | null }) =>
      `${k.label} ${k.value === null ? 'none' : num(k.value)}`;
    const dir = higherBetter ? 'below' : 'above';
    const derived = cutoffs.filter((k) => k.value !== null);
    if (clears < 0) {
      const verdict = `${index} ${num(value)} is ${dir} every cutoff (${derived.map(at).join(', ')}): the fit is worse than even the ${last.label} misspecification tested gives, so by this method the fit is poor`;
      return [{ index, value, cutoffs, verdict, short: 'clears no level', ok: false }];
    }
    const cleared = cutoffs[clears];
    const onGoodSide = `${index} ${num(value)} is on the good side of the ${cleared.label} cutoff (${num(cleared.value!)})`;
    const milder = cutoffs.slice(0, clears);
    if (clears === first) {
      // Milder levels before it, if any, have no cutoff.
      const underived = milder.length
        ? ` (no cutoff could be derived at ${milder.map((k) => k.label).join(', ')})`
        : '';
      const verdict = `${onGoodSide}, the mildest misspecification tested: consistent with a correctly specified model${underived}`;
      return [{ index, value, cutoffs, verdict, short: `clears ${cleared.label}`, ok: true }];
    }
    const missed = milder.filter((k) => k.value !== null);
    const verdict = `${onGoodSide} but ${dir} ${missed.map(at).join(' and ')}: the fit is between those misspecifications`;
    const short = `clears ${cleared.label}, not ${missed.map((k) => k.label).join(', ')}`;
    return [{ index, value, cutoffs, verdict, short, ok: null }];
  });
}

/** The cutoffs of a verdict in a few characters ("L1 .041 · L2 .060"; "NONE" where there is none). */
export const dfiCutoffText = (v: DfiVerdict) =>
  v.cutoffs
    .map(
      (k) =>
        `${k.label
          .replace(/^Level (\d+).*$/, 'L$1')
          .replace(/ \(correct model\)/, '')
          .replace(
            / percentile$/,
            '',
          )} ${k.value === null ? 'NONE' : noLeadingZero(fmt(k.value, 3))}`,
    )
    .join(' · ');

// ---------- the card ----------

/** The colour of a verdict: good news green, bad news red, undecided plain. */
function verdictClass(ok: boolean | null) {
  if (ok === true) return 'good';
  if (ok === false) return 'bad';
  return undefined;
}

/** How to read the verdict column for each kind of cutoff. */
function readingNote(fn: DfiFn): string {
  if (fn === 'exactFit')
    return 'An index within the 95th percentile of the exact-fit distribution is what an exactly fitting model gives 95% of the time.';
  if (fn === 'equivTest') return 'The bin the T-size value falls in.';
  return 'Levels increase in severity: an index that clears Level 1 fits better than the mildest misspecification tested; one that clears no level fits worse than the most severe.';
}

/** The model's shape in words ("one factor, structural paths, Likert-type items"). */
function describeShape(s: DfiShape): string {
  const parts = [s.factors === 1 ? 'one factor' : `${s.factors} factors`];
  if (s.hoc) parts.push('a higher-order factor');
  if (s.structural) parts.push('structural paths');
  if (s.ordinal === 'all') parts.push('ordinal indicators');
  else if (s.ordinal === 'some') parts.push('some ordinal indicators');
  if (!s.raw) parts.push('covariance-matrix input');
  else if (s.likert) parts.push('Likert-type items');
  return parts.join(', ');
}

const shapeOf = (ctx: AnalysisCtx) => dfiShape(ctx.model, ctx.data);
const CB_ESTIMATORS = new Set(['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS', 'WLS', 'WLSMV']);

function parseMad(v: unknown): number[] {
  const m = Array.isArray(v)
    ? v
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 0.5)
        .slice(0, 6)
    : [];
  return m.length ? m : [...DEFAULT_MAD];
}

export function dfiDefaults(ctx: AnalysisCtx): DfiOptions {
  const s = shapeOf(ctx);
  const fn = s.problem ? 'cfaHB' : dfiDefaultFn(s);
  return {
    fn,
    reps: dfiInfo(fn).defaultReps,
    estimator: '',
    scale: defaultScale(s),
    mad: [...DEFAULT_MAD],
  };
}

function DfiOptionsForm({
  options: o,
  set,
  ctx,
  disabled,
}: {
  options: DfiOptions;
  set: (o: DfiOptions) => void;
  ctx: AnalysisCtx;
  disabled: boolean;
}) {
  const s = shapeOf(ctx);
  const info = dfiInfo(o.fn);
  const [madText, setMadText] = useState(o.mad.join(', '));
  const suggested = s.problem ? null : dfiDefaultFn(s);
  const shapeText = s.problem || describeShape(s);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Fit index cutoffs tailored to this model and sample size (dynamic, Wolf &amp; McNeish): the
        package simulates the model’s own fit-index distributions, correctly specified and under
        graded misspecifications, and reads the cutoffs off them. The model: {shapeText}.
        {suggested && ` Suggested function: ${suggested}.`} The package draws its replications with
        fixed seeds of its own, so a run is reproducible; the simulations take from seconds to a few
        minutes in the browser (less in desktop R through the PLS Studio Helper).
      </p>
      <div className="field">
        <label htmlFor="dfi-fn">dynamic function</label>
        <select
          id="dfi-fn"
          value={o.fn}
          onChange={(e) => {
            const fn = e.target.value as DfiFn;
            set({ ...o, fn, reps: dfiInfo(fn).defaultReps, estimator: '' });
          }}
        >
          {DFI_FN_INFO.map((f) => {
            const why = f.fits(s);
            let optionNote = '';
            if (why) optionNote = ' (does not fit this model)';
            else if (f.id === suggested) optionNote = ' (suggested)';
            return (
              <option
                key={f.id}
                value={f.id}
                disabled={!!why}
                title={why ? `dynamic::${f.id} ${why}` : f.what}
              >
                {f.label}
                {optionNote}
              </option>
            );
          })}
        </select>
        <p className="hint">{info.what}</p>
      </div>
      {o.fn !== 'equivTest' && (
        <div className="field">
          <label htmlFor="dfi-reps">Replications per level</label>
          <input
            id="dfi-reps"
            type="number"
            min={10}
            max={5000}
            step={10}
            value={o.reps}
            onChange={(e) =>
              set({
                ...o,
                reps: clampNum(Number(e.target.value), 10, 5000, info.defaultReps, true),
              })
            }
          />
          <p className="hint">
            The package’s default for this function is {info.defaultReps}
            {o.fn === 'cfaOne' || o.fn === 'cfaHB' || o.fn === 'exactFit'
              ? ' (its help page asks not to change it: the Shiny app uses the same)'
              : ''}
            ; fewer are faster and less precise.
          </p>
        </div>
      )}
      {o.fn !== 'equivTest' && o.fn !== 'exactFit' && (
        <div className="field">
          <label htmlFor="dfi-est">Estimator inside the simulations</label>
          <select
            id="dfi-est"
            value={o.estimator}
            onChange={(e) => set({ ...o, estimator: e.target.value as DfiEstimator | '' })}
          >
            <option value="">The function’s default ({info.defaultEstimator})</option>
            {DFI_ESTIMATORS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          {(o.fn === 'catOne' || o.fn === 'catHB') && (
            <p className="hint">
              Categorical functions take limited-information estimators only (WLSMV, ULSMV, DWLS).
            </p>
          )}
        </div>
      )}
      {o.fn === 'DDDFI' && (
        <>
          <div className="field">
            <label htmlFor="dfi-scale">Simulated data</label>
            <select
              id="dfi-scale"
              value={o.scale}
              onChange={(e) => set({ ...o, scale: e.target.value as DfiScale })}
            >
              <option value="normal">Multivariate normal (ML)</option>
              <option value="nonnormal" disabled={!s.raw}>
                Non-normal, as the data (MLR; needs raw data)
              </option>
              <option value="categorical" disabled={!(s.raw && s.ordinal === 'all')}>
                Categorical, as the data (WLSMV; needs raw data with ordinal indicators)
              </option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="dfi-mad">Mean absolute discrepancies (MAD)</label>
            <input
              id="dfi-mad"
              type="text"
              value={madText}
              onChange={(e) => setMadText(e.target.value)}
              onBlur={() => {
                const m = parseMad(madText.split(/[\s,;]+/).map(Number));
                setMadText(m.join(', '));
                set({ ...o, mad: m });
              }}
            />
            <p className="hint">
              The misspecification levels, as the mean absolute difference between the misspecified
              population’s correlations and the model’s: the package’s .038, .05 and .06 recreate
              the traditional close, fair and mediocre benchmarks.
            </p>
          </div>
        </>
      )}
      <p className="hint">
        The CB-SEM model on the canvas, fitted by lavaan with the {ctx.settings.estimator} estimator
        (Model settings); dynamic reads N and the standardised solution from that fit.
      </p>
    </fieldset>
  );
}

// ---------- the view ----------

const TRUE_COLOR = SERIES_COLORS[0],
  MISSPEC_COLOR = SERIES_COLORS[1];
const HB: Record<string, number> = { SRMR: 0.08, RMSEA: 0.06, CFI: 0.95 };

/** Overlaid histograms of the fit index under the correct and a misspecified model, with the dynamic cutoff and Hu & Bentler's. */
function DfiHistogram({
  id,
  index,
  truth,
  misspec,
  cutoff,
  title,
}: {
  id: string;
  index: string;
  truth: number[];
  misspec: number[] | null;
  cutoff: number | null;
  title: string;
}) {
  const all = [...truth, ...(misspec ?? [])].filter((v) => Number.isFinite(v));
  if (!all.length) return null;
  const lo = Math.min(...all),
    hi = Math.max(...all);
  const k = 30,
    width = (hi - lo) / k || 1e-9;
  const edges = Array.from({ length: k + 1 }, (_, i) => lo + i * width);
  const count = (v: number[]) => {
    const out = new Array(k).fill(0) as number[];
    for (const x of v) {
      if (!Number.isFinite(x)) continue;
      out[Math.min(k - 1, Math.floor((x - lo) / width))]++;
    }
    return out;
  };
  const a = count(truth),
    b = misspec ? count(misspec) : null;
  const yMax = Math.max(...a, ...(b ?? [0])) * 1.05 || 1;
  const xs: [number, number] = [
    Math.min(lo, HB[index] ?? lo, cutoff ?? lo),
    Math.max(hi, HB[index] ?? hi, cutoff ?? hi),
  ];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((yMax - v) / yMax) * (H - pad.t - pad.b);
  const hb = HB[index];
  return (
    <ChartFrame
      id={id}
      name={`dfi-${index}`}
      width={W}
      height={H}
      defaults={{ x: index, y: 'Replications' }}
      caption={
        <span className="hint">
          {title}:{' '}
          {misspec ? (
            <>
              <span style={{ color: TRUE_COLOR }}>■</span> correct model,{' '}
              <span style={{ color: MISSPEC_COLOR }}>■</span> misspecified;{' '}
            </>
          ) : null}
          dashed: dynamic cutoff{cutoff !== null ? ` ${fmt(cutoff, 3)}` : ' (none)'}
          {hb !== undefined ? `; dotted: Hu & Bentler ${hb}` : ''}.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Distribution of ${index}: ${title}`}
        >
          <Axes
            xs={xs}
            ys={[0, yMax]}
            xTitle={labels.x}
            yTitle={labels.y}
            yTick={(v) => v.toFixed(0)}
          />
          {a.map(
            (n, i) =>
              n > 0 && (
                <rect
                  key={`t${i}`}
                  x={sx(edges[i]) + 0.5}
                  y={sy(n)}
                  width={Math.max(1, sx(edges[i + 1]) - sx(edges[i]) - 1)}
                  height={sy(0) - sy(n)}
                  fill={TRUE_COLOR}
                  fillOpacity={0.55}
                />
              ),
          )}
          {b?.map(
            (n, i) =>
              n > 0 && (
                <rect
                  key={`m${i}`}
                  x={sx(edges[i]) + 0.5}
                  y={sy(n)}
                  width={Math.max(1, sx(edges[i + 1]) - sx(edges[i]) - 1)}
                  height={sy(0) - sy(n)}
                  fill={MISSPEC_COLOR}
                  fillOpacity={0.55}
                />
              ),
          )}
          {cutoff !== null && (
            <line
              x1={sx(cutoff)}
              x2={sx(cutoff)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="currentColor"
              strokeDasharray="6 4"
              strokeWidth={1.5}
            />
          )}
          {hb !== undefined && (
            <line
              x1={sx(hb)}
              x2={sx(hb)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="currentColor"
              strokeDasharray="2 3"
              strokeWidth={1.5}
            />
          )}
        </svg>
      )}
    </ChartFrame>
  );
}

function tableRows(t: DfiTable): Row[] {
  return t.rows.map((name, i) => [c(name), ...t.columns.map((_, j) => c(t.cells[i]?.[j] ?? ''))]);
}

const LEVEL_NOTE: Partial<Record<DfiFn, string>> = {
  cfaOne:
    'Levels 1 to 3 add omitted residual correlations of .3 between items, in increasing number (scaled to the number of items); Level 0 is the correctly specified model.',
  cfaHB:
    'Each level omits one more cross-loading from the data-generating model (F − 1 levels for F factors; Magnitude is the standardised size of the omitted loading, as Hu & Bentler 1999); Level 0 is the correctly specified model.',
  catOne:
    'Levels add omitted residual correlations between ordinal items; Level 0 is the correctly specified model.',
  catHB:
    'Each level omits one more cross-loading (its Magnitude given); Level 0 is the correctly specified model.',
  likertOne:
    'Levels add omitted residual correlations; the simulated items keep the data’s response categories and frequencies.',
  likertHB:
    'Each level omits one more cross-loading (its Magnitude given); the simulated items keep the data’s response categories and frequencies.',
  nnorOne:
    'Levels add omitted residual correlations; the data are resampled by a modified Bollen–Stine bootstrap, so they keep their non-normality (and missingness).',
  nnorHB:
    'Each level omits one more cross-loading (its Magnitude given); the data are resampled by a modified Bollen–Stine bootstrap, so they keep their non-normality.',
  hier1HB:
    'Misspecification in the measurement part of the hierarchical model (omitted cross-loadings, their Magnitude given): 95/5 rows are the cutoffs with 95% sensitivity and specificity, 90/10 rows those with 90%; “NONE”: the distributions overlap too much for that criterion; “--”: not needed.',
  hier2:
    'Misspecification in the structural part of the hierarchical model (the first-order factors’ covariances): 95/5 and 90/10 rows as hier1HB.',
  exactFit:
    'The data generated from the model exactly as estimated and refitted: the 99th and 95th percentiles of χ², SRMR and RMSEA (the 1st and 5th of CFI) are the values an exactly fitting model exceeds 1% and 5% of the time.',
  DDDFI:
    'Rows are misspecification levels defined by the mean absolute discrepancy (MAD) between the misspecified population’s correlations and the model-implied ones; “Sim. MAD” is the discrepancy the simulation achieved; “Consistent” is the correctly specified model. Compare the upper limit of the RMSEA 90% CI, not the point estimate, with the “90% CI” column.',
};

export function DfiView({ r }: { r: DfiResult }) {
  const verdicts = dfiVerdicts(r);
  const emp = dfiEmpirical(r.fit);
  const title = `Dynamic fit index cutoffs: dynamic::${r.fn}`;
  const design = r.fn === 'equivTest' ? 'Equivalence testing' : `${r.reps} replications per level`;
  const estimator = r.estimator ? `, simulation estimator ${r.estimator}` : '';
  const scale = r.scale && r.fn === 'DDDFI' ? `, ${r.scale} data` : '';
  const versions = `dynamic ${r.engine.version} (Wolf & McNeish), lavaan ${r.engine.lavaan ?? ''}`;
  const head = `${design}, N = ${r.n}${estimator}${scale}. ${versions}; the package's own fixed seeds.`;
  const levels = dfiLevels(r.cutoffs);
  const misspec = levels.filter((l) => l.kind === 'misspec');
  const col = (name: string) => r.data?.cols[r.data.names.indexOf(name)] ?? null;
  return (
    <div className="tables">
      {r.cutoffs && (
        <Table
          title={title}
          file={`dfi-${r.fn}-cutoffs`}
          columns={['', ...r.cutoffs.columns]}
          rows={tableRows(r.cutoffs)}
          note={
            <>
              {head} {LEVEL_NOTE[r.fn]}
              {r.fn !== 'exactFit' &&
                !/hier/.test(r.fn) &&
                ' Specificity: the share of correctly specified models the cutoff accepts (95%); Sensitivity: the share of misspecified models it rejects (95% where possible, lower where the distributions overlap; below 50% the cutoff is suppressed as “NONE”).'}{' '}
              The table as the package prints it.
            </>
          }
        />
      )}
      {r.equiv && (
        <Table
          title="Equivalence testing: T-size RMSEA and CFI (equivTest)"
          file="dfi-equivtest"
          columns={['', 'RMSEA', 'CFI']}
          rows={[
            [c('T-size value'), c(r.equiv.rmsea), c(r.equiv.cfi)],
            ...r.equiv.rmseaBins.map((b, i) => [
              c(b.split(':')[0]),
              c(b.split(':')[1]?.trim() ?? ''),
              c(r.equiv!.cfiBins[i]?.split(':')[1]?.trim() ?? ''),
            ]),
          ]}
          note={
            <>
              {head} Yuan, Chan, Marcoulides & Bentler (2016): the T-size index is the largest RMSEA
              (smallest CFI) the data cannot reject at the 5% level; the bins are the conventional
              cutoffs adjusted for this model’s df and N.
            </>
          }
        />
      )}
      {verdicts.length > 0 && (
        <Table
          title="This model against the dynamic cutoffs"
          file={`dfi-${r.fn}-verdict`}
          columns={['Index', 'Model', 'Cutoffs', 'Reading']}
          rows={verdicts.map((v) => [
            c(v.index),
            c(v.value, undefined, 3),
            c(dfiCutoffText(v)),
            {
              ...c(v.verdict, verdictClass(v.ok)),
              bold: v.ok !== null,
            },
          ])}
          note={
            <>
              The model’s indices as the package reports them (3 decimals)
              {emp?.rmseaHigh !== null && emp?.rmseaHigh !== undefined
                ? `; upper limit of the RMSEA 90% CI ${fmt(emp.rmseaHigh, 3)}`
                : ''}
              . {readingNote(r.fn)}
            </>
          }
        />
      )}
      {r.data && r.fn !== 'equivTest' && (
        <details>
          <summary>
            Distributions of the fit indices (
            {r.fn === 'exactFit'
              ? 'exact fit'
              : `${misspec.length} level${misspec.length === 1 ? '' : 's'}`}
            )
          </summary>
          <div className="charts">
            {r.fn === 'exactFit'
              ? (['chisq', 'srmr', 'rmsea', 'cfi'] as const).map((k) => {
                  const v = col(k);
                  if (!v) return null;
                  const index = k === 'chisq' ? 'χ²' : k.toUpperCase();
                  const p95 = levels.find((l) => /95/.test(l.label))?.[k] ?? null;
                  return (
                    <DfiHistogram
                      key={k}
                      id={`dfi:${r.fn}:${k}`}
                      index={index}
                      truth={v}
                      misspec={null}
                      cutoff={p95}
                      title={`${index} under exact fit (dashed: 95th percentile)`}
                    />
                  );
                })
              : misspec.map((l, li) =>
                  (['SRMR', 'RMSEA', 'CFI'] as const).map((idx) => {
                    const truth = col(`${idx}_L0`),
                      bad = col(`${idx}_L${li + 1}`);
                    if (!truth || !bad) return null;
                    const key = idx.toLowerCase() as 'srmr' | 'rmsea' | 'cfi';
                    return (
                      <DfiHistogram
                        key={`${li}-${idx}`}
                        id={`dfi:${r.fn}:${li + 1}:${idx}`}
                        index={idx}
                        truth={truth}
                        misspec={bad}
                        cutoff={l[key]}
                        title={`${idx}, ${l.label}`}
                      />
                    );
                  }),
                )}
          </div>
        </details>
      )}
      {r.printed.length > 0 && (
        <details>
          <summary>As printed by dynamic</summary>
          <pre className="r-script" style={{ whiteSpace: 'pre' }}>
            {r.printed.join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}

export const dfiAnalysis: AnalysisType<DfiOptions, DfiResult> = {
  id: DFI_CARD_ID,
  title: DFI_TITLE,
  sub: 'fit index cutoffs tailored to the model and sample size (dynamic)',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: dfiDefaults,
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          fn: oneOf(raw.fn, DFI_FUNCTIONS, 'cfaHB'),
          reps: clampNum(raw.reps, 10, 5000, 500, true),
          estimator: oneOf(raw.estimator, [...DFI_ESTIMATORS, ''] as const, ''),
          scale: oneOf(raw.scale, ['normal', 'nonnormal', 'categorical'] as const, 'normal'),
          mad: parseMad(raw.mad),
        }
      : null,
  Options: DfiOptionsForm,
  View: ({ result }) => <DfiView r={result} />,
  blocked: (o, ctx) =>
    cbModelBlocked(ctx, 'Dynamic fit cutoffs', false) ??
    (!CB_ESTIMATORS.has(ctx.settings.estimator)
      ? `Dynamic fit cutoffs are not available with the ${ctx.settings.estimator} estimator; choose ML, MLM, MLMV, MLR, GLS, ULS, WLS or WLSMV.`
      : null) ??
    (ctx.settings.missing === 'mi'
      ? 'Dynamic fit cutoffs are not available with multiple imputation; use FIML or casewise deletion.'
      : null) ??
    dfiBlocked(o, shapeOf(ctx)),
  fingerprint: (o, ctx) =>
    cbFingerprint(ctx, [o.fn, o.reps, o.estimator, o.scale, ...(o.fn === 'DDDFI' ? o.mad : [])]),
  run: async (o, ctx) => (await import('../rengine/dfi')).dfiR(cbCall(ctx), o),
  script: async (o, ctx) => (await import('../rengine/dfi')).dfiScriptR(cbCall(ctx), o),
  summary: (o) => {
    const reps = o.fn === 'equivTest' ? '' : `, ${o.reps} replications`;
    const estimator = o.estimator ? `, ${o.estimator}` : '';
    const scale = o.fn === 'DDDFI' ? `, ${o.scale} data` : '';
    return `dynamic::${o.fn}${reps}${estimator}${scale}`;
  },
};
