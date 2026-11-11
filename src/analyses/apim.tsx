// The dyadic actor-partner interdependence model (APIM; Kenny, Kashy & Cook 2006) as an analysis card:
// each member's X and Y from the data (one column, or the items of a latent variable), distinguishable
// or indistinguishable dyads, actor and partner effects, k = partner / actor with its intervals, and the
// omnibus test of distinguishability (lavaan). "Draw on canvas" puts the same model on the Model tab.

import { fmt } from '../format';
import { apimModel, apimRolesError } from '../model/apim';
import type { ApimEstimate, ApimInput, ApimResult, Dyads } from '../rengine/apim';
import { OrderedPicker } from '../components/OrderedPicker';
import { confirmDialog } from '../components/Overlays';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { useStore } from '../store';
import {
  Choice,
  columnsFingerprint,
  flag,
  Hint,
  isObj,
  missingColumns,
  names,
  oneOf,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface ApimOptions {
  x1: string[];
  x2: string[];
  y1: string[];
  y2: string[];
  dyads: Dyads;
  /** Percentile bootstrap intervals (samples and seed from the Model settings). */
  bootstrap: boolean;
}

/** The statistically distinct modes (validation/cards.ts). */
export const APIM_MODES: readonly Dyads[] = ['distinguishable', 'indistinguishable'];
const DYADS = [
  ['distinguishable', 'Distinguishable'],
  ['indistinguishable', 'Indistinguishable'],
] as const;

const columnsOf = (o: ApimOptions) => [...o.x1, ...o.x2, ...o.y1, ...o.y2];

/** The request: the estimator and missing values from the Model settings (FIML, else casewise). */
export function apimInput(o: ApimOptions, ctx: Pick<AnalysisCtx, 'settings'>): ApimInput {
  const s = ctx.settings;
  const input: ApimInput = {
    x1: o.x1,
    x2: o.x2,
    y1: o.y1,
    y2: o.y2,
    dyads: o.dyads,
    estimator: s.estimator === 'MLR' ? 'MLR' : 'ML',
    missing: s.missing === 'fiml' ? 'fiml' : 'casewise',
  };
  if (o.bootstrap) {
    const samples = Math.max(50, Math.min(100000, Math.floor(s.bootSamples)));
    input.boot = { samples, seed: s.seed, level: s.confidence };
  }
  return input;
}

const EFFECT_NAMES: Record<string, string> = {
  a1: 'Actor: X1 → Y1',
  a2: 'Actor: X2 → Y2',
  p1: 'Partner: X2 → Y1',
  p2: 'Partner: X1 → Y2',
  a: 'Actor (both members)',
  p: 'Partner (both members)',
  k1: 'k1 = p1 / a1 (member 1’s Y)',
  k2: 'k2 = p2 / a2 (member 2’s Y)',
  k: 'k = p / a',
};

/** Kenny & Ledermann's (2010) reading of k: which dyadic patterns the interval leaves. */
function pattern(e: ApimEstimate): string {
  const lo = e.bootLow ?? e.low;
  const hi = e.bootHigh ?? e.high;
  if (lo === null || hi === null) return '';
  const fits = [
    [1, 'couple (k = 1)'],
    [0, 'actor-only (k = 0)'],
    [-1, 'contrast (k = −1)'],
  ] as const;
  const left = fits.filter(([v]) => lo <= v && v <= hi).map(([, name]) => name);
  return left.length ? left.join(', ') : 'none of the three';
}

function fitText(f: ApimResult['fit']) {
  const parts = [`χ²(${f.df ?? '—'}) = ${fmt(f.chisq ?? NaN, 2)}`];
  if (f.df)
    parts.push(
      `p = ${fmt(f.pvalue ?? NaN, 3)}`,
      `CFI ${fmt(f.cfi ?? NaN, 3)}`,
      `RMSEA ${fmt(f.rmsea ?? NaN, 3)}`,
    );
  return parts.join(', ');
}

function ApimView({ r }: { r: ApimResult }) {
  const pct = Math.round(r.level * 100);
  const boot = r.boot > 0;
  const estCols = [
    'Effect',
    'Estimate',
    'Std. error',
    'z',
    'p',
    `${pct}% CI`,
    ...(boot ? [`${pct}% bootstrap CI`] : []),
    'Standardised',
  ];
  const ci = (lo: number | null, hi: number | null) =>
    c(lo === null || hi === null ? null : `[${fmt(lo, 3)}, ${fmt(hi, 3)}]`);
  const effectRow = (e: ApimEstimate): Row => [
    c(EFFECT_NAMES[e.label] ?? e.label),
    c(e.est),
    c(e.se),
    c(e.z, undefined, 2),
    pCell(e.p),
    ci(e.low, e.high),
    ...(boot ? [ci(e.bootLow, e.bootHigh)] : []),
    c(e.std),
  ];
  const kRow = (e: ApimEstimate): Row => [
    c(EFFECT_NAMES[e.label] ?? e.label),
    c(e.est),
    c(e.se),
    ci(e.low, e.high),
    ...(boot ? [ci(e.bootLow, e.bootHigh)] : []),
    c(pattern(e)),
  ];
  const t = r.test;
  const measured = [
    r.latent.x ? 'X latent' : 'X observed',
    r.latent.y ? 'Y latent' : 'Y observed',
  ].join(', ');
  return (
    <div className="tables">
      <Table
        title={`Actor and partner effects (${r.dyads} dyads)`}
        file="apim-effects"
        columns={estCols}
        rows={r.effects.map(effectRow)}
        note={`N = ${r.n} dyads; ${measured}. Actor effect: a member’s X on their own Y; partner effect: the other member’s X on their Y. ${r.dyads === 'indistinguishable' ? 'Indistinguishable dyads: one actor and one partner effect, the members’ X means and variances and Y intercepts and residual variances held equal.' : 'Distinguishable dyads: each member has their own effects, means and variances.'} Latent variables are scaled by member 1’s variance (X) or residual variance (Y) of 1, the items’ loadings and intercepts equal across members (dySEM’s scriptAPIM). Model: ${fitText(r.fit)}.`}
      />
      <Table
        title="k: partner relative to actor effect"
        file="apim-k"
        columns={[
          'Ratio',
          'k',
          'Std. error',
          `${pct}% CI (delta)`,
          ...(boot ? [`${pct}% bootstrap CI`] : []),
          'Patterns in the interval',
        ]}
        rows={r.k.map(kRow)}
        note={`Kenny & Ledermann (2010): k = 1 is a couple pattern (the sum of the two X matters), k = 0 actor-only, k = −1 a contrast pattern (the difference matters). The delta-method interval assumes k is normally distributed, which a ratio rarely is${boot ? `; the percentile bootstrap interval (${r.boot} samples) does not, and is the one read for the patterns` : '; tick the bootstrap for a percentile interval'}.`}
      />
      <Table
        title="Nonindependence"
        file="apim-nonindependence"
        columns={['Correlation', 'Covariance', 'Std. error', 'p', 'Correlation (std.)']}
        rows={[
          [c('X1 ↔ X2'), c(r.xCor.est), c(r.xCor.se), pCell(r.xCor.p), c(r.xCor.std)],
          [c('Y1 ↔ Y2 (residuals)'), c(r.yCor.est), c(r.yCor.se), pCell(r.yCor.p), c(r.yCor.std)],
        ]}
        note="The members’ X correlate, and their Y residuals do too: the reason the dyad, not the person, is the unit of analysis."
      />
      <Table
        title="Test of distinguishability"
        file="apim-distinguishability"
        columns={['Model', 'χ²', 'df', 'CFI', 'RMSEA']}
        rows={[
          [
            c('Distinguishable'),
            c(r.distFit.chisq, undefined, 2),
            c(r.distFit.df, undefined, 0),
            c(r.distFit.cfi),
            c(r.distFit.rmsea),
          ],
          [
            c('Indistinguishable'),
            c(r.indistFit.chisq, undefined, 2),
            c(r.indistFit.df, undefined, 0),
            c(r.indistFit.cfi),
            c(r.indistFit.rmsea),
          ],
          [
            c('Difference (LR test)'),
            c(t.chisqDiff, undefined, 2),
            c(t.dfDiff, undefined, 0),
            c(`p = ${fmt(t.p ?? NaN, 4)}`),
            c(''),
          ],
        ]}
        note={`The omnibus test of distinguishability (Kenny et al. 2006, ch. 6): the indistinguishable model holds the members’ parameters equal. ${t.p !== null && t.p < 0.05 ? 'Significant: the members differ (by role, e.g. gender), so treat the dyads as distinguishable.' : 'Not significant: the data do not tell the members apart, and the simpler indistinguishable model is defensible.'} lavaan ${r.engine.version}.`}
      />
    </div>
  );
}

/** Replace the diagram by the APIM and switch to CB-SEM. */
async function drawApim(o: ApimOptions) {
  const st = useStore.getState();
  const why = apimRolesError(o);
  if (why) {
    st.toast('error', why);
    return;
  }
  if (st.model.constructs.length) {
    const ok = await confirmDialog({
      title: 'Replace the diagram?',
      body: 'The APIM becomes the diagram on the Model tab; the current constructs and paths are replaced (undo restores them).',
      confirmLabel: 'Replace',
    });
    if (!ok) return;
  }
  st.commit(() => apimModel(o));
  st.setSettings({ method: 'cbsem' });
  st.setWorkspace('model');
  st.toast(
    'success',
    `The ${o.dyads} APIM is on the canvas: actor and partner paths labelled, k defined, equalities as labels. Calculate for its estimates; the card adds the test of distinguishability and bootstrap intervals.`,
  );
}

function DrawApim({ o }: { o: ApimOptions }) {
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const why = apimRolesError(o);
  return (
    <button
      className="btn sm"
      disabled={readOnly || !!why}
      title={why ?? 'Draw this APIM as a CB-SEM diagram on the Model tab'}
      onClick={() => void drawApim(o)}
    >
      Draw on canvas
    </button>
  );
}

function ApimOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<ApimOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length)
    return <div className="empty-results">Import raw data with one row per dyad first.</div>;
  const used = columnsOf(o);
  const free = (own: string[]) => columns.filter((n) => own.includes(n) || !used.includes(n));
  const s = ctx.settings;
  const missing = s.missing === 'fiml' ? 'FIML' : 'casewise deletion';
  const hint =
    'One column for an observed variable, or the items of a latent variable (the same items, in the same order, for both members).';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>
        Data in dyad format: one row per dyad, each member’s scores in their own columns. Member 1
        and member 2 are, for distinguishable dyads, the roles (e.g. female and male partner); for
        indistinguishable dyads, either order.
      </Hint>
      <OrderedPicker
        label="X of member 1"
        hint={hint}
        columns={free(o.x1)}
        value={o.x1}
        onChange={(x1) => set({ ...o, x1 })}
      />
      <OrderedPicker
        label="X of member 2"
        columns={free(o.x2)}
        value={o.x2}
        onChange={(x2) => set({ ...o, x2 })}
      />
      <OrderedPicker
        label="Y of member 1"
        columns={free(o.y1)}
        value={o.y1}
        onChange={(y1) => set({ ...o, y1 })}
      />
      <OrderedPicker
        label="Y of member 2"
        columns={free(o.y2)}
        value={o.y2}
        onChange={(y2) => set({ ...o, y2 })}
      />
      <Choice
        label="Dyads"
        value={o.dyads}
        options={DYADS}
        onChange={(dyads) => set({ ...o, dyads })}
        hint="Distinguishable: the members differ by a role (gender, parent and child). Indistinguishable: they do not (same-sex couples, twins, roommates); the test of distinguishability shows which the data support."
      />
      <label className="check">
        <input
          type="checkbox"
          checked={o.bootstrap}
          onChange={(e) => set({ ...o, bootstrap: e.target.checked })}
        />
        <span>
          Percentile bootstrap intervals ({s.bootSamples} samples, seed {s.seed}, from the Model
          settings)
        </span>
      </label>
      <div className="hint">
        lavaan {s.estimator === 'MLR' ? 'MLR' : 'ML'}, {missing} (from the Model settings).
      </div>
      <DrawApim o={o} />
    </fieldset>
  );
}

export const apimAnalysis: AnalysisType<ApimOptions, ApimResult> = {
  id: 'apim',
  title: 'Dyadic APIM',
  sub: 'actor–partner interdependence model: actor and partner effects, k and the test of distinguishability (lavaan)',
  group: 'CB-SEM model',
  defaults: () => ({ x1: [], x2: [], y1: [], y2: [], dyads: 'distinguishable', bootstrap: false }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    return {
      x1: names(raw.x1, 20),
      x2: names(raw.x2, 20),
      y1: names(raw.y1, 20),
      y2: names(raw.y2, 20),
      dyads: oneOf(raw.dyads, APIM_MODES, 'distinguishable'),
      bootstrap: flag(raw.bootstrap),
    };
  },
  Options: ApimOptionsForm,
  View: ({ result }) => <ApimView r={result} />,
  blocked: (o, ctx) => apimRolesError(o) ?? missingColumns(ctx, columnsOf(o), 'The APIM'),
  fingerprint: (o, ctx) => {
    const i = apimInput(o, ctx);
    return columnsFingerprint(ctx, columnsOf(o), [
      o.dyads,
      i.estimator,
      i.missing,
      JSON.stringify(i.boot ?? null),
    ]);
  },
  run: async (o, ctx) => (await import('../rengine/apim')).apimR(rawData(ctx)!, apimInput(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/apim')).apimScriptR(rawData(ctx)!, apimInput(o, ctx)),
  summary: (o) => `${o.dyads} dyads${o.bootstrap ? ', bootstrap' : ''}`,
};
