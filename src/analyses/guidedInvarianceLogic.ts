// The verdicts of the guided invariance card (analyses/guidedInvariance.tsx): does each step's added set of
// equality constraints hold, and what to do next. Pure functions, unit tested (guidedInvarianceLogic.test.ts).
//
// Criteria, with their sources:
// - the χ² difference test of the step against the one before (lavTestLRT: scaled for MLR, scaled-and-shifted for
//   WLSMV), p < .05 meaning the added equalities do not hold exactly;
// - Chen (2007): with N > 300, a drop in CFI of at least .010 together with a rise in RMSEA of at least .015 or in
//   SRMR of at least .030 (loadings) / .010 (intercepts, residual variances) indicates non-invariance (Cheung &
//   Rensvold 2002 proposed the ΔCFI ≤ −.01 part). Thresholds are judged like intercepts here.
// - Chen's cut-offs come from continuous, normal data and ML. With ordinal items and WLSMV, Sass, Schmitt & Marsh
//   (2014) found that the changes in CFI and RMSEA behave differently, so the scaled Δχ² test leads there and the
//   fit-index changes are read as supporting evidence only.

import type { GuidedInvarianceResult, GuidedStep, GuidedStepName } from '../rengine/invariance';

export type Verdict = 'holds' | 'mixed' | 'fails' | 'equivalent' | 'failedToFit' | 'reference';

/** Chen's (2007) cut-offs for a step: ΔCFI, ΔRMSEA and ΔSRMR. */
export function chenCutoffs(step: GuidedStepName): { cfi: number; rmsea: number; srmr: number } {
  const srmr = step === 'metric' ? 0.03 : 0.01;
  return { cfi: -0.01, rmsea: 0.015, srmr };
}

/** Whether a step's changes in fit meet Chen's (2007) criteria for non-invariance. */
export function chenFlags(s: GuidedStep): { cfi: boolean; chen: boolean } {
  const cut = chenCutoffs(s.step);
  const cfi = s.cfiChange !== undefined && s.cfiChange <= cut.cfi;
  const rmsea = s.rmseaChange !== undefined && s.rmseaChange >= cut.rmsea;
  const srmr = s.srmrChange !== undefined && s.srmrChange >= cut.srmr;
  return { cfi, chen: cfi && (rmsea || srmr) };
}

export interface StepVerdict {
  verdict: Verdict;
  /** One or two plain sentences: why. */
  why: string;
}

const ALPHA = 0.05;

/** The verdict on one step (the configural model is the reference the others are compared with). */
export function stepVerdict(s: GuidedStep, ordinal: boolean): StepVerdict {
  if (!s.converged) {
    return {
      verdict: 'failedToFit',
      why: 'lavaan did not converge for this model, so it cannot be compared.',
    };
  }
  if (s.step === 'configural') {
    return {
      verdict: 'reference',
      why: 'The same factor structure in every group, nothing held equal. Its fit should be acceptable before any constraint is tested.',
    };
  }
  if (s.equivalent) {
    return {
      verdict: 'equivalent',
      why: 'With binary or three-category items, equal thresholds alone fit exactly as the model before. This step is not a test (Wu & Estabrook 2016).',
    };
  }
  if (s.p === undefined) {
    return {
      verdict: 'failedToFit',
      why: 'The step before did not converge, so there is no difference test.',
    };
  }
  const significant = s.p < ALPHA;
  const { cfi, chen } = chenFlags(s);
  if (ordinal) {
    // Ordinal items: the scaled Δχ² test leads (Sass, Schmitt & Marsh 2014).
    if (!significant) {
      return {
        verdict: 'holds',
        why: 'The scaled χ² difference test is not significant: the added equalities fit as well as the model before.',
      };
    }
    if (!cfi) {
      return {
        verdict: 'mixed',
        why: 'The scaled χ² difference test is significant, but CFI barely changes. With ordinal items, fit-index cut-offs are not well supported (Sass, Schmitt & Marsh 2014): look at the score tests below.',
      };
    }
    return {
      verdict: 'fails',
      why: 'The scaled χ² difference test is significant and CFI drops by .010 or more.',
    };
  }
  if (!significant && !cfi) {
    return {
      verdict: 'holds',
      why: 'The χ² difference test is not significant and CFI does not drop by .010 or more.',
    };
  }
  if (chen) {
    return {
      verdict: 'fails',
      why: 'CFI drops by .010 or more and RMSEA or SRMR rises past Chen’s (2007) cut-off.',
    };
  }
  if (significant && !cfi) {
    return {
      verdict: 'holds',
      why: 'The χ² difference test is significant, but the fit indices change less than Chen’s (2007) cut-offs. With large samples the test detects trivial differences.',
    };
  }
  return {
    verdict: 'mixed',
    why: 'CFI drops by .010 or more, but RMSEA and SRMR stay within Chen’s (2007) cut-offs. Look at the score tests below.',
  };
}

/** Whether a verdict lets the sequence go on to the next step. */
export const passes = (v: Verdict) => v === 'holds' || v === 'equivalent' || v === 'reference';

const STEP_TITLE: Record<GuidedStepName, string> = {
  configural: 'Configural',
  thresholds: 'Thresholds',
  metric: 'Metric (loadings)',
  scalar: 'Scalar (intercepts)',
  strict: 'Strict (residual variances)',
};
/** A step's name for headings. Ordinal: metric adds loadings to equal thresholds, scalar the latent intercepts. */
export function stepTitle(step: GuidedStepName, ordinal: boolean): string {
  if (!ordinal) return STEP_TITLE[step];
  if (step === 'metric') return 'Metric (thresholds + loadings)';
  if (step === 'scalar') return 'Scalar (thresholds + loadings + intercepts)';
  return STEP_TITLE[step];
}

/** Partial invariance is usable for comparing means when every factor keeps at least two items with neither
 *  loading nor intercept (nor threshold) freed (Byrne, Shavelson & Muthén 1989; Steenkamp & Baumgartner 1998). */
export function anchorsPerFactor(
  factors: { name: string; indicators: string[] }[],
  freed: { item: string; kind: string }[],
): { factor: string; anchors: number }[] {
  const touched = new Set(freed.filter((f) => f.kind !== 'residual').map((f) => f.item));
  return factors.map((f) => ({
    factor: f.name,
    anchors: f.indicators.filter((i) => !touched.has(i)).length,
  }));
}

export interface Guidance {
  /** The index of the first step that does not pass (null: all pass). */
  stuckAt: number | null;
  /** The highest level that holds (its step name), or null when even the configural model did not converge. */
  reached: GuidedStepName | null;
  /** Whether the latent means may be compared: (partial) scalar invariance holds. */
  meansOk: boolean;
  /** What to do next, in plain words. */
  next: string;
}

/** The overall guidance: how far invariance holds and what to do next. */
export function guidance(
  r: Pick<GuidedInvarianceResult, 'steps' | 'ordinal'>,
  anchorsOk: boolean,
): Guidance {
  const verdicts = r.steps.map((s) => stepVerdict(s, r.ordinal).verdict);
  let stuckAt: number | null = null;
  for (let i = 0; i < verdicts.length; i++) {
    if (!passes(verdicts[i])) {
      stuckAt = i;
      break;
    }
  }
  const lastOk = stuckAt === null ? verdicts.length - 1 : stuckAt - 1;
  const reached = lastOk >= 0 ? r.steps[lastOk].step : null;
  const scalarAt = r.steps.findIndex((s) => s.step === 'scalar');
  const meansOk = scalarAt >= 0 && lastOk >= scalarAt && anchorsOk;
  let next: string;
  if (stuckAt === null) {
    next = meansOk
      ? 'Every step holds. The latent means can be compared (below).'
      : 'Every step holds, but a factor keeps fewer than two invariant items: compare its mean with care.';
  } else {
    const s = r.steps[stuckAt];
    const title = stepTitle(s.step, r.ordinal).toLowerCase();
    if (verdicts[stuckAt] === 'failedToFit') {
      next = `The ${title} model did not converge. Check the configural fit and the items’ categories in each group.`;
    } else if (s.step === 'configural') {
      next = 'Fix the configural model first.';
    } else if (s.candidates.length) {
      const c = s.candidates[0];
      next =
        `${STEP_TITLE[s.step]} invariance is in doubt. The largest score test is ${describeCandidate(c)}. ` +
        'Free it only if there is a substantive reason, then run again; or stop at the level before.';
    } else {
      next = `${STEP_TITLE[s.step]} invariance is in doubt, and there is no parameter left to free.`;
    }
    if (meansOk) next += ' Scalar invariance holds, so the latent means can still be compared.';
  }
  return { stuckAt, reached, meansOk, next };
}

/** A parameter in words: "x3’s intercept", "the loading of x2 on Visual", "threshold 2 of u3". */
export function describeCandidate(c: {
  kind: string;
  item: string;
  factor?: string;
  threshold?: number;
}): string {
  if (c.kind === 'loading') return `the loading of ${c.item}${c.factor ? ` on ${c.factor}` : ''}`;
  if (c.kind === 'threshold') return `threshold ${c.threshold ?? ''} of ${c.item}`;
  if (c.kind === 'intercept') return `the intercept of ${c.item}`;
  return `the residual variance of ${c.item}`;
}

/** Notes on the fit indices themselves: which kind is shown, and when their changes can mislead. */
export function fitNotes(r: Pick<GuidedInvarianceResult, 'steps' | 'estimator'>): string[] {
  const notes: string[] = [];
  const first = r.steps.find((s) => s.converged);
  const robustEstimator = r.estimator !== 'ML';
  if (first && robustEstimator && first.cfiKind !== 'robust') {
    notes.push(
      `lavaan gives no robust CFI and RMSEA for these models, so the ${first.cfiKind} versions are shown. ` +
        'Their changes between steps can mislead: rely on the scaled χ² difference test.',
    );
  }
  const improved = r.steps.filter(
    (s) =>
      s.step !== 'configural' &&
      !s.equivalent &&
      ((s.cfiChange ?? 0) > 1e-9 || (s.rmseaChange ?? 0) < -1e-9),
  );
  if (robustEstimator && improved.length) {
    const which = improved.map((s) => s.step).join(', ');
    notes.push(
      `CFI or RMSEA improves at ${which} although constraints were added. With scaled statistics the scaling ` +
        'changes between models, and with more degrees of freedom RMSEA can fall: these changes are not evidence of invariance on their own.',
    );
  }
  return notes;
}
