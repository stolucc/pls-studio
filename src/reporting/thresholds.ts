// The rules of thumb the app judges PLS-SEM measurement models by, in one place, each with one
// inequality, so the checklist, the higher-order check, the loading triage, the methods text and
// the result tables agree.
//
// Sources:
// - Indicator loadings of at least 0.708: the construct then explains at least half of the
//   indicator's variance (0.708² ≈ 0.50). Loadings from 0.40 to below 0.708 are kept unless their
//   removal lifts the AVE or ρC above its threshold; below 0.40 they are candidates for deletion
//   (Hair, Risher, Sarstedt & Ringle 2019; Hair et al. 2021). Older editions round the cut-off to
//   0.70 (Hair et al. 2017).
// - Internal consistency reliability (ρA, ρC) from 0.70 to 0.95; above 0.95 the items are
//   redundant (Hair et al. 2019; Dijkstra & Henseler 2015 for ρA).
// - AVE of at least 0.50 (Fornell & Larcker 1981; Hair et al. 2019).
// - HTMT: Henseler, Ringle & Sarstedt (2015) speak of a lack of discriminant validity when the
//   HTMT is above 0.85 (conceptually distinct constructs) or 0.90 (conceptually similar ones);
//   Hair et al. (2019) use the same wording. The rule, used everywhere (htmtFails): a value
//   ABOVE the threshold fails, a value at or below it passes. The same holds for the upper
//   bound of the bootstrap interval (Franke & Sarstedt 2019; Henseler et al. 2015's HTMT
//   inference compares it with 1 or the threshold); a bound exactly at the threshold has
//   probability zero, so the strict reading of their test changes nothing in practice.
//   Displayed HTMT values never contradict the verdict: a value above a threshold that would
//   round to it (0.8504 at two decimals) is shown with more decimals (htmtDigits).

/** Indicator reliability: keep at or above (Hair et al. 2019, 2021). */
export const LOADING_MIN = 0.708;
/** Below this, a candidate for deletion (Hair et al. 2017, 2021). */
export const LOADING_DELETE = 0.4;
/** ρA and ρC of at least this (Hair et al. 2019). */
export const RELIABILITY_MIN = 0.7;
/** ρA and ρC above this: redundant items (Hair et al. 2019). */
export const RELIABILITY_MAX = 0.95;
/** Convergent validity: AVE of at least this (Fornell & Larcker 1981). */
export const AVE_MIN = 0.5;
/** HTMT threshold for conceptually distinct constructs (Henseler et al. 2015). */
export const HTMT_DISTINCT = 0.85;
/** HTMT threshold for conceptually similar constructs (Henseler et al. 2015). */
export const HTMT_SIMILAR = 0.9;

/** A loading that meets indicator reliability. */
export function loadingMeets(loading: number): boolean {
  return loading >= LOADING_MIN;
}

/** A reliability (ρA or ρC) below the minimum. Not defined (NaN) is no breach. */
export function reliabilityTooLow(value: number): boolean {
  return value < RELIABILITY_MIN;
}

/** A reliability (ρA or ρC) above the maximum: redundant items. */
export function reliabilityTooHigh(value: number): boolean {
  return value > RELIABILITY_MAX;
}

/** A reliability (ρA or ρC) outside 0.70–0.95. Not defined (NaN, e.g. ρA of a Mode B block) is not outside. */
export function reliabilityOutside(value: number): boolean {
  return reliabilityTooLow(value) || reliabilityTooHigh(value);
}

/** An AVE that meets convergent validity. */
export function aveMeets(ave: number): boolean {
  return ave >= AVE_MIN;
}

/** An HTMT (or its upper bound) that indicates a lack of discriminant validity: above the threshold. */
export function htmtFails(value: number, threshold: number): boolean {
  return value > threshold;
}

/** The most decimals htmtDigits adds. */
const HTMT_MAX_DIGITS = 10;

/**
 * The decimals to show an HTMT with: `digits`, or more when the value is above a threshold
 * (0.85, 0.90) but would be displayed as the threshold itself, which reads as passing.
 * 0.8504 at two decimals is "0.8504", not "0.85"; 0.8496 stays "0.85" (at most .85 passes).
 */
export function htmtDigits(value: number, digits: number): number {
  if (!Number.isFinite(value)) return digits;
  const looksLikeThreshold = (d: number) =>
    [HTMT_DISTINCT, HTMT_SIMILAR].some(
      (t) => htmtFails(value, t) && value.toFixed(d) === t.toFixed(d),
    );
  let d = digits;
  while (d < HTMT_MAX_DIGITS && looksLikeThreshold(d)) d++;
  return d;
}

/** An HTMT as text, with htmtDigits' decimals ("—" when not finite). */
export function htmtText(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(htmtDigits(value, digits));
}

/**
 * Whether ρA applies to a construct: a block with estimated Mode A weights and two or more
 * indicators, common factor or composite.
 *
 * Dijkstra & Henseler (2015) define ρA from a block's Mode A weights and its indicator
 * correlations; it is the consistent reliability of a reflectively measured construct estimated
 * in Mode A. Hair et al. (2022, ch. 4) report it, with α and ρC, for the constructs they specify
 * as seminr Mode A composites, and seminr computes it for every Mode A block. The checklist
 * judges Mode A composites by ρC and the AVE, which equally presuppose reflective measurement, so
 * ρA is judged with them. Mode B (formative) blocks have no reliability in this sense
 * (Hair et al. 2022, ch. 5: they are assessed by convergent validity, collinearity and weights),
 * and blocks with unit or predefined weights have no estimated Mode A weights; the engines report
 * 1 for those (cSEM and seminr's convention), which is shown as n/a and not judged.
 */
export function rhoADefined(k: {
  mode: string;
  indicators: string[];
  predefinedWeights?: Record<string, number>;
}): boolean {
  return (
    k.mode === 'A' && k.indicators.length > 1 && !Object.keys(k.predefinedWeights ?? {}).length
  );
}
