// Guided measurement invariance across groups (R/invariance.R, ps_guided_invariance): the diagram's factors as a
// CFA, tested step by step: configural → (ordinal: thresholds, Wu & Estabrook 2016) → metric → scalar → (strict),
// each with fit, the difference test, ΔCFI/ΔRMSEA against published cut-offs and a plain verdict
// (guidedInvarianceLogic.ts); score tests of the failing step's constraints, parameters freed one at a time with a
// recorded justification (partial invariance), dMACS for freed continuous items and, once (partial) scalar
// invariance holds, the latent mean differences.

import { formDialog } from '../components/Overlays';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fmt, fmtP, stars } from '../format';
import {
  STEP_KIND,
  type GuidedCandidate,
  type GuidedFreed,
  type GuidedInvarianceInput,
  type GuidedInvarianceResult,
  type GuidedStep,
} from '../rengine/invariance';
import {
  ColumnSelect,
  columnsFingerprint,
  flag,
  isObj,
  missingColumns,
  name,
  names,
  oneOf,
  rawData,
} from './common';
import {
  anchorsPerFactor,
  describeCandidate,
  fitNotes,
  guidance,
  stepTitle,
  stepVerdict,
  type Verdict,
} from './guidedInvarianceLogic';
import { chosen, FactorPicker, factorsBlocked, GeneratedSyntax, invLavaan } from './invariance';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

const engine = () => import('../rengine/invariance');

/** A justification's length limits (characters, after trimming). */
export const MIN_WHY = 10;
export const MAX_WHY = 1000;
const MAX_FREED = 100;

/** A freed parameter with the user's reason for freeing it (shown with the results and in the report). */
export interface GuidedFreedOption extends GuidedFreed {
  why: string;
}

export interface GuidedInvarianceOptions {
  /** Factors of the diagram by name; empty: all. */
  constructs: string[];
  group: string;
  parameterization: 'delta' | 'theta';
  strict: boolean;
  free: GuidedFreedOption[];
}

const STEPS = ['thresholds', 'metric', 'scalar', 'strict'] as const;

/** The statistically distinct modes (validation/cards.ts): continuous items, ordinal delta or theta, binary items. */
export const GUIDED_MODES = ['continuous', 'delta', 'theta', 'binary'] as const;

/** A justification as stored: whitespace collapsed, control characters dropped; null when too short or long. */
export function cleanWhy(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // (control characters become spaces, then runs of whitespace one space)
  const text = v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < MIN_WHY || text.length > MAX_WHY) return null;
  return text;
}

/**
 * One freed parameter from a project file or a collaborator, or null when anything about it is off: the step must
 * be a constrained step, the kind the step's, a threshold a whole number from 1 to 99 (thresholds only), a factor
 * only with a loading, and a justification within the length limits.
 */
export function parseFreed(raw: unknown): GuidedFreedOption | null {
  if (!isObj(raw)) return null;
  const step = raw.step;
  if (typeof step !== 'string' || !(STEPS as readonly string[]).includes(step)) return null;
  const s = step as GuidedFreed['step'];
  const kind = STEP_KIND[s];
  if (raw.kind !== kind) return null;
  const item = name(raw.item);
  if (!item || item !== raw.item) return null;
  const why = cleanWhy(raw.why);
  if (why === null) return null;
  const out: GuidedFreedOption = { step: s, kind, item, why };
  if (kind === 'loading') {
    const factor = name(raw.factor);
    if (!factor || factor !== raw.factor) return null;
    out.factor = factor;
  } else if (raw.factor !== undefined) {
    return null;
  }
  if (kind === 'threshold') {
    const t = raw.threshold;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > 99) return null;
    out.threshold = t;
  } else if (raw.threshold !== undefined) {
    return null;
  }
  return out;
}

/** The key that tells two freed parameters apart (the same parameter cannot be freed twice). */
export const freedKey = (f: GuidedFreed) =>
  [f.kind, f.item, f.factor ?? '', f.threshold ?? ''].join('\u0001');

/** The freed parameters of a project file: malformed ones dropped, duplicates (the same parameter) dropped. */
export function parseFreedList(raw: unknown): GuidedFreedOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GuidedFreedOption[] = [];
  for (const x of raw.slice(0, MAX_FREED)) {
    const f = parseFreed(x);
    if (!f || seen.has(freedKey(f))) continue;
    seen.add(freedKey(f));
    out.push(f);
  }
  return out;
}

/** The ordinal indicators of the chosen factors (marked on the Model tab). */
const orderedOf = (factors: { indicators: string[] }[], ctx: AnalysisCtx) => {
  const marked = new Set(ctx.model?.ordered ?? []);
  return factors.flatMap((f) => f.indicators).filter((i) => marked.has(i));
};

/** The request: WLSMV for ordinal items (casewise or pairwise deletion), else the project's ML or MLR. */
export function guidedInput(o: GuidedInvarianceOptions, ctx: AnalysisCtx): GuidedInvarianceInput {
  const factors = chosen(o.constructs, ctx);
  const ordered = orderedOf(factors, ctx);
  const ordinal = ordered.length > 0;
  const lav = invLavaan(ctx);
  const items = new Set(factors.flatMap((f) => f.indicators));
  // (the justification stays in the project: R gets the parameters only)
  const free = o.free
    .filter((f) => items.has(f.item))
    .map(({ why: _why, ...rest }) => rest)
    .filter((f) => ordinal || f.kind !== 'threshold');
  return {
    factors,
    group: o.group,
    ordered,
    estimator: ordinal ? 'WLSMV' : lav.estimator,
    missing: ordinal
      ? ctx.settings.missing === 'pairwise'
        ? 'pairwise'
        : 'casewise'
      : lav.missing,
    parameterization: ordinal ? o.parameterization : 'delta',
    strict: o.strict,
    free,
  };
}

function GuidedForm({ options: o, set, ctx, disabled }: OptionsProps<GuidedInvarianceOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const factors = chosen(o.constructs, ctx);
  const ordered = orderedOf(factors, ctx);
  const ordinal = ordered.length > 0;
  const lav = invLavaan(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Tests step by step whether the factors measure the same thing in every group: configural,
        {ordinal ? ' equal thresholds (Wu & Estabrook 2016),' : ''} equal loadings (metric), equal
        intercepts (scalar){o.strict ? ', equal residual variances (strict)' : ''}. Each model is
        written by semTools::measEq.syntax and fitted by lavaan.{' '}
        {ordinal
          ? `${ordered.length} ordinal item(s) (marked on the Model tab): WLSMV.`
          : `lavaan ${lav.estimator} (from the Model settings).`}
      </p>
      <FactorPicker value={o.constructs} onChange={(v) => set({ ...o, constructs: v })} ctx={ctx} />
      <ColumnSelect
        id="gi-group"
        label="Grouping column"
        value={o.group}
        columns={d.names}
        exclude={factors.flatMap((f) => f.indicators)}
        onChange={(v) => set({ ...o, group: v })}
      />
      {ordinal && (
        <div className="field">
          <label>Parameterization of the ordinal items</label>
          <div className="segmented">
            <button
              className={o.parameterization === 'delta' ? 'on' : ''}
              onClick={() => set({ ...o, parameterization: 'delta' })}
            >
              Delta
            </button>
            <button
              className={o.parameterization === 'theta' ? 'on' : ''}
              onClick={() => set({ ...o, parameterization: 'theta' })}
            >
              Theta
            </button>
          </div>
          <p className="hint">
            Delta (lavaan’s default) fixes the total variance of each item’s latent response and
            frees its scale factor in later groups. Theta fixes the residual variance instead. Both
            give the same fit for configural to scalar models; only theta can test equal residual
            variances (strict invariance).
          </p>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={o.strict}
          onChange={(e) => set({ ...o, strict: e.target.checked })}
        />
        <span>Also test equal residual variances (strict invariance)</span>
      </label>
      {o.free.length > 0 && (
        <div className="field">
          <label>Freed parameters (partial invariance)</label>
          {o.free.map((f) => (
            <div key={freedKey(f)} className="hint" style={{ marginBottom: 6 }}>
              <strong>{describeCandidate(f)}</strong> from the {f.step} step: {f.why}{' '}
              <button
                className="btn sm ghost"
                title="Hold this parameter equal again"
                onClick={() =>
                  set({ ...o, free: o.free.filter((x) => freedKey(x) !== freedKey(f)) })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

const VERDICT_TEXT: Record<Verdict, [string, string]> = {
  holds: ['Holds', 'ok'],
  mixed: ['Unclear', 'warn'],
  fails: ['Does not hold', 'bad'],
  equivalent: ['Not a test', 'na'],
  failedToFit: ['Not estimated', 'bad'],
  reference: ['Baseline', 'na'],
};

const KIND_NOTE: Record<string, string> = {
  robust: 'robust',
  scaled: 'scaled',
  standard: '',
};

function stepRow(s: GuidedStep, ordinal: boolean): Row {
  const v = stepVerdict(s, ordinal).verdict;
  const d = (x: number | undefined, digits = 3) => (x === undefined ? c(null) : c(x, '', digits));
  return [
    c(stepTitle(s.step, ordinal)),
    d(s.chisq),
    d(s.df, 0),
    d(s.cfi),
    d(s.rmsea),
    d(s.srmr),
    d(s.chisqDiff),
    d(s.dfDiff, 0),
    // (a significant difference means the added equalities do not hold: a warning, not a success)
    s.p === undefined
      ? c(null)
      : { v: `${fmtP(s.p)} ${stars(s.p)}`, cls: s.p < 0.05 ? 'bad' : 'dim' },
    s.equivalent ? c(null) : d(s.cfiChange),
    s.equivalent ? c(null) : d(s.rmseaChange),
    c(VERDICT_TEXT[v][0], v === 'fails' ? 'bad' : v === 'mixed' ? 'warn' : ''),
  ];
}

/** Which difference test lavTestLRT ran, in words. */
function methodText(r: GuidedInvarianceResult): string {
  const m = r.steps.find((s) => s.method)?.method ?? '';
  if (m.includes('satorra.2000')) {
    return 'the scaled-and-shifted difference test (Satorra 2000; lavTestLRT’s method for WLSMV)';
  }
  if (m.includes('satorra.bentler.2001')) {
    return 'the scaled difference test (Satorra & Bentler 2001; lavTestLRT’s method for MLR)';
  }
  return 'the likelihood-ratio χ² difference test';
}

/** Open the justification dialog and free the parameter in the card that holds this result; then run it. */
async function freeCandidate(
  result: GuidedInvarianceResult,
  step: GuidedStep,
  cand: GuidedCandidate,
) {
  const { useAnalyses, setOptions, runCard } = await import('./store');
  const st = useAnalyses.getState();
  const id = Object.keys(st.results).find((k) => st.results[k] === result);
  const card = st.cards.find((k) => k.id === id);
  if (!id || !card || card.kind !== 'analysis') return;
  const what = describeCandidate(cand);
  const values = await formDialog({
    title: `Free ${what}`,
    body:
      'It will be estimated separately in each group from this step on. Free a parameter only for a ' +
      'substantive reason (item wording, translation, known group differences), not because the test ' +
      'says so: changes driven by the data capitalise on chance (MacCallum, Roznowski & Necowitz 1992). ' +
      'The reason is shown with the results and in the report.',
    confirmLabel: 'Free and run again',
    fields: [
      {
        label: 'Why may this parameter differ between the groups?',
        multiline: true,
        placeholder: 'e.g. The item’s wording differs in the two language versions.',
        check: (t) => (cleanWhy(t) === null ? `Write ${MIN_WHY} to ${MAX_WHY} characters.` : null),
      },
    ],
  });
  if (!values) return;
  const o = card.options as GuidedInvarianceOptions;
  const entry: GuidedFreedOption = {
    step: step.step as GuidedFreed['step'],
    kind: cand.kind,
    item: cand.item,
    ...(cand.factor !== undefined ? { factor: cand.factor } : {}),
    ...(cand.threshold !== undefined ? { threshold: cand.threshold } : {}),
    why: cleanWhy(values[0])!,
  };
  const free = [...o.free.filter((f) => freedKey(f) !== freedKey(entry)), entry];
  setOptions(id, { ...o, free });
  void runCard(id);
}

function CandidateTable({
  r,
  s,
  stuck,
}: {
  r: GuidedInvarianceResult;
  s: GuidedStep;
  stuck: boolean;
}) {
  const top = s.candidates.slice(0, 10);
  const mi = top.some((x) => x.test === 'mi');
  const title = `Score tests of the ${stepTitle(s.step, r.ordinal).toLowerCase()} constraints`;
  const note =
    'How much χ² would drop if this parameter were estimated separately in each group, largest first ' +
    '(lavaan::lavTestScore: all of the parameter’s equality constraints released at once; scaled where ' +
    'lavaan has it).' +
    (mi
      ? ' “MI”: the parameter is fixed to the same value in every group (an ordinal item’s latent ' +
        'intercept or residual variance), so its test is the modification index of freeing it in a later ' +
        'group (1 df, not scaled; with WLSMV only approximately χ²).'
      : '');
  return (
    <>
      <Table
        title={title}
        file={`guided-invariance-score-${s.step}`}
        columns={['Parameter', 'χ²', 'df', 'p', 'Test']}
        rows={top.map((x) => [
          c(describeCandidate(x)),
          c(x.x2, x.p < 0.05 ? 'warn' : ''),
          c(x.df, '', 0),
          pCell(x.p),
          c(x.test === 'mi' ? 'MI' : x.test === 'score.scaled' ? 'score (scaled)' : 'score'),
        ])}
        note={note}
      />
      {stuck && (
        <div className="table-tools">
          {top.slice(0, 3).map((x) => (
            <button
              key={`${x.item}-${x.factor ?? ''}-${x.threshold ?? ''}`}
              className="btn sm"
              title="Estimate this parameter separately in each group (partial invariance); you will be asked why"
              onClick={() => void freeCandidate(r, s, x)}
            >
              Free {describeCandidate(x)}…
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function StepVerdicts({ r, stuckAt }: { r: GuidedInvarianceResult; stuckAt: number | null }) {
  return (
    <ol className="guided-steps">
      {r.steps.map((s, i) => {
        const v = stepVerdict(s, r.ordinal);
        const [label, cls] = VERDICT_TEXT[v.verdict];
        const later = stuckAt !== null && i > stuckAt;
        return (
          <li key={s.step} style={later ? { opacity: 0.6 } : undefined}>
            <strong>{stepTitle(s.step, r.ordinal)}</strong>{' '}
            <span className={`verdict ${cls}`}>{label}</span>{' '}
            <span className="hint">
              {v.why}
              {later ? ' Read this step only once the steps before it hold.' : ''}
              {s.freed.length && s.step !== 'configural' ? ` Freed: ${s.freed.join('; ')}.` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FreedTable({ o }: { o: GuidedInvarianceOptions }) {
  if (!o.free.length) return null;
  return (
    <Table
      title="Freed parameters (partial invariance)"
      file="guided-invariance-freed"
      columns={['Parameter', 'Freed from step', 'Justification']}
      rows={o.free.map((f) => [c(describeCandidate(f)), c(f.step), c(f.why)])}
      note="Estimated separately in each group from that step on; the justification as the analyst recorded it."
    />
  );
}

function DmacsPart({ r }: { r: GuidedInvarianceResult }) {
  if (r.ordinal) {
    return (
      <p className="hint">
        Effect size of non-invariance: dMACS (Nye &amp; Drasgow 2011) is defined for continuous
        items. PLS Studio has no validated version for ordinal items, so none is shown.
      </p>
    );
  }
  if (!r.dmacs.length) return null;
  const many = r.groups.length > 2;
  return (
    <Table
      title="Effect sizes of the non-invariant items (dMACS)"
      file="guided-invariance-dmacs"
      columns={[
        ...(many ? ['Group'] : []),
        'Factor',
        'Item',
        `λ ${r.groups[0]}`,
        'λ group',
        `ν ${r.groups[0]}`,
        'ν group',
        'Pooled SD',
        'dMACS',
        'Signed dMACS',
      ]}
      rows={r.dmacs.map((x) => [
        ...(many ? [c(x.focal)] : []),
        c(x.factor),
        c(x.item),
        c(x.lambdaRef),
        c(x.lambdaFocal),
        c(x.nuRef),
        c(x.nuFocal),
        c(x.sd),
        c(x.dmacs, x.dmacs >= 0.2 ? 'warn' : ''),
        c(x.signed),
      ])}
      note={
        `For the items whose loading or intercept was freed, from the partial scalar model: the root mean ` +
        `square difference between the item’s expected scores under the group’s and ${r.groups[0]}’s ` +
        'parameters over the group’s factor distribution, in pooled-SD units (Nye & Drasgow 2011; read ' +
        'like Cohen’s d). Signed dMACS: the mean difference (group − reference). The dMACS card ' +
        'computes the same from the Model tab’s model.'
      }
    />
  );
}

function MeansPart({ r, ok, reason }: { r: GuidedInvarianceResult; ok: boolean; reason: string }) {
  if (!ok) {
    return (
      <p className="hint">
        <strong>Latent means.</strong> {reason}
      </p>
    );
  }
  const many = r.groups.length > 2;
  return (
    <>
      <Table
        title="Latent mean differences (scalar model)"
        file="guided-invariance-means"
        columns={['Factor', 'Group', 'Difference', 'SE', 'z', 'p', '95% CI', 'Variance']}
        rows={r.means.map((m) => [
          c(m.factor),
          c(m.group),
          c(m.est),
          c(m.se),
          c(m.z),
          pCell(m.p),
          c(`[${fmt(m.lo, 3)}, ${fmt(m.hi, 3)}]`),
          c(m.variance),
        ])}
        note={
          `Each factor’s mean in the group minus its mean in ${r.groups[0]}, in ${r.groups[0]}’s SD units ` +
          `(the factor has mean 0 and variance 1 in ${r.groups[0]}). z = difference / SE; the CI is ` +
          'difference ± 1.96 SE (Wald). Variance: the factor’s variance in the group.'
        }
      />
      {many && r.wald.length > 0 && (
        <Table
          title="Wald tests: equal latent means in all groups"
          file="guided-invariance-wald"
          columns={['Factor', 'χ²', 'df', 'p']}
          rows={r.wald.map((w) => [c(w.factor), c(w.x2), c(w.df, '', 0), pCell(w.p)])}
          note="lavaan::lavTestWald: all of the factor’s mean differences from the first group are 0."
        />
      )}
    </>
  );
}

function GuidedView({ r, o }: { r: GuidedInvarianceResult; o: GuidedInvarianceOptions }) {
  const freed = o.free.filter((f) => r.factors.some((k) => k.indicators.includes(f.item)));
  const anchors = anchorsPerFactor(r.factors, freed);
  const thin = anchors.filter((a) => a.anchors < 2);
  const g = guidance(r, thin.length === 0);
  const sizes = r.groups.map((x, i) => `${r.n[i]} (${x})`).join(', ');
  const kind = r.steps.find((s) => s.cfiKind)?.cfiKind ?? 'standard';
  const identification = r.ordinal
    ? `Wu & Estabrook (2016) identification (semTools ID.cat = "Wu.Estabrook.2016"), ${r.parameterization} parameterization`
    : 'factors standardised in the first group (ID.fac = "std.lv")';
  const meansReason = thin.length
    ? `Fewer than two invariant items remain on ${thin.map((a) => a.factor).join(', ')}: ` +
      'partial invariance needs at least two per factor (Byrne, Shavelson & Muthén 1989).'
    : 'Compare latent means only once scalar invariance holds, fully or partially.';
  const stuck = g.stuckAt;
  const shownCandidates = r.steps.filter((s, i) => {
    if (!s.candidates.length) return false;
    const v = stepVerdict(s, r.ordinal).verdict;
    return i === stuck || v === 'mixed' || v === 'fails';
  });
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.groups.length} groups, N = {sizes}; reference group {r.groups[0]} (the first in the
        data). {r.estimator}; {identification}. semTools {r.engine.version} (measEq.syntax), lavaan{' '}
        {r.engine.lavaan ?? ''}.
        {r.binary.length > 0 &&
          ` Binary items (${r.binary.join(', ')}): their scale is held at 1 in every group in the scalar model, because it is not identified with equal thresholds and intercepts (Wu & Estabrook 2016).`}
      </p>
      <div className="card-bar">
        <strong>Next:</strong> {g.next}
      </div>
      <StepVerdicts r={r} stuckAt={stuck} />
      <Table
        title="Measurement invariance, step by step"
        file="guided-invariance"
        columns={[
          'Model',
          'χ²',
          'df',
          `CFI${KIND_NOTE[kind] ? ` (${KIND_NOTE[kind]})` : ''}`,
          'RMSEA',
          'SRMR',
          'Δχ²',
          'Δdf',
          'p',
          'ΔCFI',
          'ΔRMSEA',
          'Verdict',
        ]}
        rows={r.steps.map((s) => stepRow(s, r.ordinal))}
        note={
          `Each model adds equality constraints across groups to the one before. Δχ²: ${methodText(r)} ` +
          'against the previous model' +
          (r.estimator === 'ML' ? '. ' : ' (not the difference of the two scaled χ² values). ') +
          'Non-invariance: ' +
          'ΔCFI ≤ −.010 with ΔRMSEA ≥ .015 or ΔSRMR ≥ .030 (loadings) / .010 (intercepts, residuals) ' +
          '(Chen 2007; Cheung & Rensvold 2002).' +
          (r.ordinal
            ? ' These cut-offs were derived for continuous data; with ordinal items and WLSMV the scaled ' +
              'Δχ² test leads, and the fit-index changes support it (Sass, Schmitt & Marsh 2014).'
            : '')
        }
      />
      {fitNotes(r).map((n) => (
        <p key={n} className="hint">
          {n}
        </p>
      ))}
      {shownCandidates.map((s) => (
        <CandidateTable key={s.step} r={r} s={s} stuck={r.steps.indexOf(s) === stuck} />
      ))}
      <FreedTable o={{ ...o, free: freed }} />
      <DmacsPart r={r} />
      <MeansPart r={r} ok={g.meansOk && r.means.length > 0} reason={meansReason} />
      <GeneratedSyntax
        r={{ levels: r.steps.map((s) => ({ level: s.step, syntax: s.syntax })) }}
        title="Generated lavaan syntax of each step (semTools::measEq.syntax)"
      />
    </div>
  );
}

function guidedBlocked(o: GuidedInvarianceOptions, ctx: AnalysisCtx): string | null {
  const fs = chosen(o.constructs, ctx);
  const b = factorsBlocked(fs, o.constructs, ctx, 'Measurement invariance');
  if (b) return b;
  if (!o.group) return 'Choose a grouping column.';
  if (fs.some((f) => f.indicators.includes(o.group)))
    return 'The grouping column is an indicator of a chosen factor.';
  const gone = missingColumns(ctx, [o.group], 'Measurement invariance');
  if (gone) return gone;
  const ordinal = orderedOf(fs, ctx).length > 0;
  if (ordinal && o.strict && o.parameterization === 'delta') {
    return 'Equal residual variances of ordinal items can be tested only with the theta parameterization.';
  }
  return null;
}

export const guidedInvarianceAnalysis: AnalysisType<
  GuidedInvarianceOptions,
  GuidedInvarianceResult
> = {
  id: 'guidedinvariance',
  title: 'Guided measurement invariance',
  group: 'Measurement',
  sub:
    'step by step across groups: configural → thresholds (ordinal) → metric → scalar → strict, with ' +
    'verdicts, partial invariance, dMACS and latent means (semTools::measEq.syntax)',
  defaults: (ctx) => ({
    constructs: [],
    group: ctx.model?.multigroup?.column ?? '',
    parameterization: 'delta',
    strict: false,
    free: [],
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          constructs: names(raw.constructs),
          group: name(raw.group),
          parameterization: oneOf(raw.parameterization, ['delta', 'theta'] as const, 'delta'),
          strict: flag(raw.strict),
          free: parseFreedList(raw.free),
        }
      : null,
  Options: GuidedForm,
  View: ({ result, options }) => <GuidedView r={result} o={options} />,
  blocked: guidedBlocked,
  fingerprint: (o, ctx) => {
    const i = guidedInput(o, ctx);
    const cols = [...i.factors.flatMap((f) => f.indicators), o.group];
    return columnsFingerprint(ctx, cols, [JSON.stringify(i)]);
  },
  run: async (o, ctx) => (await engine()).guidedInvarianceR(rawData(ctx)!, guidedInput(o, ctx)),
  script: async (o, ctx) =>
    (await engine()).guidedInvarianceScriptR(rawData(ctx)!, guidedInput(o, ctx)),
  summary: (o) => {
    const freed = o.free.length ? ` · ${o.free.length} freed` : '';
    return `${o.constructs.length ? o.constructs.join(', ') : 'all factors'} · by ${o.group || '…'}${freed}`;
  },
};
