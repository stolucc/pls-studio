// Guidance beside the CB-SEM fit table: which column to report, why the standard, scaled and robust
// versions differ, what lies behind CFI and TLI (the baseline model), and why some values look odd.
// The notes are pure functions of the fit (fitNotes), so they can be tested without rendering.

import type { CbFit, CbResult } from '../../engine/cbsem';
import { fmt } from '../../format';

/** One explanation shown under the fit table. */
export interface FitNote {
  id:
    | 'report-robust'
    | 'report-standard'
    | 'robust-missing'
    | 'tli-above-one'
    | 'cfi-zero'
    | 'rmsea-low-df'
    | 'scaled-difference';
  /** 'warning' is shown as a highlighted box; 'info' as plain text. */
  level: 'info' | 'warning';
  text: string;
}

/** RMSEA above this is the guideline's poor value (Hu & Bentler 1999). */
const RMSEA_CUTOFF = 0.06;
/** Few degrees of freedom: Kenny, Kaniskan & McCoach (2015) show RMSEA misleads in such models. */
const LOW_DF = 10;

/** Whether the fit has robust (Brosseau-Liard & Savalei) CFI / TLI / RMSEA. */
export function hasRobustIndices(f: CbFit): boolean {
  return f.chisqScaled !== undefined && f.cfiRobust !== undefined;
}

/** The indices to report: the robust ones when there are, the standard ones otherwise. */
export function reportedIndices(f: CbFit): { cfi: number; tli: number; rmsea: number } {
  if (hasRobustIndices(f)) {
    return { cfi: f.cfiRobust!, tli: f.tliRobust!, rmsea: f.rmseaRobust! };
  }
  return { cfi: f.cfi, tli: f.tli, rmsea: f.rmsea };
}

/** The notes that apply to this fit, in reading order. */
export function fitNotes(cb: Pick<CbResult, 'fit' | 'estimator'>): FitNote[] {
  const f = cb.fit;
  const out: FitNote[] = [];
  const scaled = f.chisqScaled !== undefined;
  const rml = cb.estimator === 'RML';
  if (hasRobustIndices(f)) {
    out.push({
      id: 'report-robust',
      level: 'info',
      text:
        'Report the second column (Robust / scaled): the scaled χ² with its df and p, and the robust CFI, TLI and RMSEA. ' +
        'The rows marked “scaled” are the naive versions: they put the scaled χ² into the usual formulas and ' +
        'estimate a different population value, so the usual cutoffs do not apply to them. lavaan’s author ' +
        'advises reporting the robust versions (Brosseau-Liard, Savalei & Li 2012; Brosseau-Liard & Savalei 2014).',
    });
  } else if (!scaled || rml) {
    out.push({
      id: 'report-standard',
      level: 'info',
      text: rml
        ? 'Report the rescaled statistic TRML and the CFI, TLI and RMSEA of the fit to the robust moments (rsem has no robust CFI, TLI or RMSEA of its own).'
        : `Report the standard column: ${cb.estimator} has no scaled or robust statistics.`,
    });
  }
  if (scaled && !rml && f.cfiRobust === undefined) {
    out.push({
      id: 'robust-missing',
      level: 'warning',
      text:
        'lavaan reports no robust CFI, TLI or RMSEA for this model (NA). It cannot compute them in some ' +
        'settings, for example with ordinal indicators and a baseline model other than the default. Report the ' +
        'scaled χ² and the SRMR, and say that the robust indices were not available; do not report the naive ' +
        'scaled indices in their place without saying so.',
    });
  }
  const shown = reportedIndices(f);
  if (shown.tli > 1) {
    out.push({
      id: 'tli-above-one',
      level: 'info',
      text:
        `TLI = ${fmt(shown.tli)} is above 1. That happens when χ² is smaller than its df: the model fits ` +
        'better than chance alone would predict. TLI has no upper bound; it is not an error. Report the value, ' +
        'or report it as 1 and say so.',
    });
  }
  if (Number.isFinite(shown.cfi) && shown.cfi <= 0) {
    out.push({
      id: 'cfi-zero',
      level: 'warning',
      text:
        'CFI = 0: the model fits no better than the baseline model, in which the variables are uncorrelated ' +
        '(χ² − df of the model is at least that of the baseline). Either the model misses most of what the ' +
        'variables share, or they barely correlate, so there is little for any model to explain. A model of one ' +
        'or two variables can show this too. Look at the baseline χ² below and at the correlations.',
    });
  }
  const df = scaled && f.dfScaled !== undefined ? f.dfScaled : f.df;
  if (shown.rmsea > RMSEA_CUTOFF && df > 0 && df < LOW_DF) {
    out.push({
      id: 'rmsea-low-df',
      level: 'warning',
      text:
        `RMSEA = ${fmt(shown.rmsea)} with only ${fmt(df, 0)} degrees of freedom. With few df the RMSEA is ` +
        'unstable and often points to poor fit when the model is acceptable, more so in small samples; ' +
        'Kenny, Kaniskan & McCoach (2015) advise against judging such models by the RMSEA. Look at the χ² test, ' +
        'the SRMR and the residuals instead.',
    });
  }
  if (scaled) {
    out.push({
      id: 'scaled-difference',
      level: 'info',
      text:
        'To compare nested models, do not subtract scaled χ² values (MLM, MLR, WLSMV and the like): their ' +
        'difference does not follow a χ² distribution, and with WLSMV it can even fall when constraints are ' +
        'added. Use the scaled difference test (Satorra & Bentler 2001; Satorra 2000 for WLSMV). The Model ' +
        'comparison (CB-SEM) card and the Measurement invariance tab run it (lavaan::lavTestLRT).',
    });
  }
  return out;
}

/** CFI and TLI from the model's and the baseline's χ² and df (the standard versions), shown as the formulas. */
function baselineText(f: CbFit): string {
  const model = `χ² = ${fmt(f.chisq, 2)} on ${fmt(f.df, 0)} df`;
  const baseline = `χ²(baseline) = ${fmt(f.baselineChisq, 2)} on ${fmt(f.baselineDf, 0)} df`;
  return (
    `CFI and TLI compare the model with a baseline (null) model in which the variables are uncorrelated: ${baseline}, against the model’s ${model}. ` +
    'CFI = 1 − max(χ² − df, 0) / max(χ²(baseline) − df(baseline), χ² − df, 0); ' +
    'TLI = (χ²(baseline)/df(baseline) − χ²/df) / (χ²(baseline)/df(baseline) − 1). ' +
    'When the baseline χ² is small (the variables barely correlate), CFI and TLI cannot be high whatever the model.'
  );
}

/** The guidance under the fit table. `onCompare` opens the Model comparison card; `onDynamic` the dynamic cutoffs. */
export function FitGuide({
  cb,
  onCompare,
  onDynamic,
}: {
  cb: Pick<CbResult, 'fit' | 'estimator'>;
  onCompare: () => void;
  onDynamic: () => void;
}) {
  const notes = fitNotes(cb);
  const report = notes.filter((n) => n.id.startsWith('report'));
  const warnings = notes.filter((n) => n.level === 'warning');
  const rest = notes.filter((n) => !n.id.startsWith('report') && n.level === 'info');
  const scaled = cb.fit.chisqScaled !== undefined;
  return (
    // (help on reading the table, not part of the report: report-skip)
    <div className="fit-guide report-skip">
      {report.map((n) => (
        <div key={n.id} className="issue good">
          {n.text}
        </div>
      ))}
      {warnings.map((n) => (
        <div key={n.id} className="issue warning">
          {n.text}
        </div>
      ))}
      <details>
        <summary>How to read these fit indices</summary>
        <div className="table-note">
          {scaled && (
            <p>
              Why the columns differ. Standard: the normal-theory statistics, which assume
              continuous, multivariate normal data. Scaled: the same formulas with the scaled χ² put
              in; this naive version corrects the test but not the index. Robust: indices corrected
              so that they estimate the same population value as the standard ones would under
              normality; these are the ones to report (Brosseau-Liard, Savalei &amp; Li 2012;
              Brosseau-Liard &amp; Savalei 2014; Savalei 2021 for ordinal data).
            </p>
          )}
          <p>{baselineText(cb.fit)}</p>
          {rest.map((n) => (
            <p key={n.id}>
              {n.text}
              {n.id === 'scaled-difference' && (
                <>
                  {' '}
                  <button type="button" className="btn sm" onClick={onCompare}>
                    Model comparison card…
                  </button>
                </>
              )}
            </p>
          ))}
          <p>
            Cutoffs are guidance, not rules. The usual ones (Hu &amp; Bentler 1999) come from
            simulations of a few model types; for other models, sample sizes or loadings they can be
            too strict or too lenient (Marsh, Hau &amp; Wen 2004). Dynamic fit cutoffs are simulated
            for this model and sample size (McNeish &amp; Wolf 2023).{' '}
            <button type="button" className="btn sm" onClick={onDynamic}>
              Dynamic cutoffs for this model…
            </button>
          </p>
        </div>
      </details>
    </div>
  );
}

/** Open (or focus) an analysis card on the Analyses tab; `fresh` adds a new card with these options. */
export async function openAnalysisCard(type: string, options?: unknown, fresh = false) {
  // (imported when used: the analyses store imports the registry, which imports the results tabs)
  const { addAnalysis, selectCard, useAnalyses } = await import('../../analyses/store');
  const { useStore } = await import('../../store');
  const existing = useAnalyses
    .getState()
    .cards.find((k) => k.kind === 'analysis' && 'type' in k && k.type === type);
  if (existing && !fresh) selectCard(existing.id);
  else addAnalysis(type, options);
  useStore.getState().setWorkspace('analyses');
}

/** Open (or focus) the Model comparison (CB-SEM) card on the Analyses tab. */
export function openComparisonCard() {
  void openAnalysisCard('cbmodels');
}
