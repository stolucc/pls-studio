// ROC analysis card: how well a predictor (a data column, or the fitted probabilities of a logistic regression)
// separates the two values of a binary outcome: the ROC curve, AUC with DeLong or bootstrap intervals, the optimal
// cut-point with sensitivity, specificity, PPV and NPV, the partial AUC, and DeLong's test comparing two curves (pROC).

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { seriesColor } from '../figure/palette';
import { fmt, pIs } from '../format';
import type { RocInput, RocPoints, RocResult } from '../rengine/roc';
import { rocColumns } from '../rengine/roc';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  flag,
  Hint,
  isObj,
  missingColumns,
  name,
  names,
  NumField,
  oneOf,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface RocOptions {
  response: string;
  /** The outcome value that marks a case; null: the higher value. */
  positive: number | null;
  source: RocInput['source'];
  predictor: string;
  predictors: string[];
  direction: RocInput['direction'];
  ciMethod: RocInput['ciMethod'];
  bootN: number;
  cutpoint: RocInput['cutpoint'];
  compare: RocInput['compare'];
  predictor2: string;
  group: string;
  pauc: boolean;
  paucFocus: 'specificity' | 'sensitivity';
  paucFrom: number;
  paucTo: number;
  paucCorrect: boolean;
}
type Result = RocResult & { input: RocInput };

/** The card's statistically distinct modes (validation/cards.ts). */
export const ROC_MODES = [
  'ci:delong',
  'ci:bootstrap',
  'source:logistic',
  'direction',
  'positive',
  'cutpoint:youden',
  'cutpoint:closest.topleft',
  'compare:paired',
  'compare:groups',
  'pauc',
  'pauc:correct',
] as const;

/** The distinct values of a column (up to `max`), with a text column's labels. */
function valuesOf(ctx: AnalysisCtx, column: string, max = 12): [number, string][] {
  const data = rawData(ctx);
  const k = data?.names.indexOf(column) ?? -1;
  if (!data || k < 0) return [];
  const seen = new Set<number>();
  for (const v of data.cols[k]) {
    if (!Number.isNaN(v)) seen.add(v);
    if (seen.size > max) return [];
  }
  const cats = data.categories?.[column];
  return [...seen]
    .sort((a, b) => a - b)
    .map((v) => [v, cats && Number.isInteger(v) && cats[v - 1] ? cats[v - 1] : String(v)]);
}

const COMPARE_HINTS: Record<RocOptions['compare'], string | undefined> = {
  none: undefined,
  paired: 'DeLong’s test for two ROC curves of the same cases (paired).',
  groups: 'DeLong’s test for the predictor’s ROC curves in two independent groups (unpaired).',
};

function RocOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<RocOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) {
    return <div className="empty-results">Import data with a binary outcome first.</div>;
  }
  const values = valuesOf(ctx, o.response);
  const taken = [o.response, o.predictor, o.predictor2, o.group].filter(Boolean);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Hint>
        How well a score separates cases from controls: the ROC curve, the area under it (AUC; 0.5
        is chance, 1 is perfect separation), the best cut-point and its sensitivity and specificity
        (pROC, Robin et al. 2011).
      </Hint>
      <div className="row2">
        <ColumnSelect
          id="roc-response"
          label="Outcome (two values)"
          value={o.response}
          columns={columns}
          exclude={taken.filter((x) => x !== o.response)}
          onChange={(response) => set({ ...o, response, positive: null })}
        />
        <div className="field">
          <label htmlFor="roc-positive">Cases are</label>
          <select
            id="roc-positive"
            className="select"
            value={o.positive === null ? '' : String(o.positive)}
            onChange={(e) =>
              set({ ...o, positive: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">The higher value</option>
            {values.map(([v, label]) => (
              <option key={v} value={String(v)}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Choice
        label="Predictor"
        value={o.source}
        onChange={(source) => set({ ...o, source })}
        options={
          [
            ['column', 'A data column'],
            ['logistic', 'Logistic regression'],
          ] as const
        }
        hint={
          o.source === 'logistic'
            ? 'The fitted probabilities of a logistic regression of the outcome on the predictors below (the model of the Regression card with a binomial family and logit link).'
            : undefined
        }
      />
      {o.source === 'column' ? (
        <div className="row2">
          <ColumnSelect
            id="roc-predictor"
            label="Predictor (score, test result)"
            value={o.predictor}
            columns={columns}
            exclude={taken.filter((x) => x !== o.predictor)}
            onChange={(predictor) => set({ ...o, predictor })}
          />
          <div className="field">
            <label htmlFor="roc-direction">Cases have</label>
            <select
              id="roc-direction"
              className="select"
              value={o.direction}
              onChange={(e) => set({ ...o, direction: e.target.value as RocOptions['direction'] })}
            >
              <option value="auto">Decided from the data (medians)</option>
              <option value="<">Higher values</option>
              <option value=">">Lower values</option>
            </select>
          </div>
        </div>
      ) : (
        <OrderedPicker
          label="Predictors of the logistic regression"
          columns={columns.filter((n) => n !== o.response && n !== o.group)}
          value={o.predictors}
          onChange={(predictors) => set({ ...o, predictors })}
        />
      )}
      <div className="row2">
        <Choice
          label="AUC interval"
          value={o.ciMethod}
          onChange={(ciMethod) => set({ ...o, ciMethod })}
          options={
            [
              ['delong', 'DeLong'],
              ['bootstrap', 'Bootstrap'],
            ] as const
          }
        />
        {o.ciMethod === 'bootstrap' && (
          <NumField
            id="roc-boot"
            label="Bootstrap samples"
            value={o.bootN}
            lo={100}
            hi={100000}
            step={100}
            int
            onChange={(bootN) => set({ ...o, bootN })}
          />
        )}
      </div>
      <Choice
        label="Best cut-point"
        value={o.cutpoint}
        onChange={(cutpoint) => set({ ...o, cutpoint })}
        options={
          [
            ['youden', 'Youden’s J'],
            ['closest.topleft', 'Closest to top-left'],
          ] as const
        }
        hint={
          o.cutpoint === 'youden'
            ? 'The threshold with the largest sensitivity + specificity − 1.'
            : 'The threshold whose point is nearest the corner of perfect separation, (1 − sensitivity)² + (1 − specificity)².'
        }
      />
      <Choice
        label="Compare with"
        value={o.compare}
        onChange={(compare) => set({ ...o, compare })}
        options={
          [
            ['none', 'Nothing'],
            ['paired', 'A second predictor'],
            ['groups', 'Two groups'],
          ] as const
        }
        hint={COMPARE_HINTS[o.compare]}
      />
      {o.compare === 'paired' && (
        <ColumnSelect
          id="roc-predictor2"
          label="Second predictor"
          value={o.predictor2}
          columns={columns}
          exclude={taken.filter((x) => x !== o.predictor2)}
          onChange={(predictor2) => set({ ...o, predictor2 })}
        />
      )}
      {o.compare === 'groups' && (
        <ColumnSelect
          id="roc-group"
          label="Grouping column (two values)"
          value={o.group}
          columns={columns}
          exclude={taken.filter((x) => x !== o.group)}
          onChange={(group) => set({ ...o, group })}
        />
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={o.pauc}
          onChange={(e) => set({ ...o, pauc: e.target.checked })}
        />{' '}
        Partial AUC
      </label>
      {o.pauc && (
        <>
          <div className="row2">
            <Choice
              label="Over a range of"
              value={o.paucFocus}
              onChange={(paucFocus) => set({ ...o, paucFocus })}
              options={
                [
                  ['specificity', 'Specificity'],
                  ['sensitivity', 'Sensitivity'],
                ] as const
              }
            />
            <NumField
              id="roc-pauc-from"
              label="From"
              value={o.paucFrom}
              lo={0}
              hi={0.99}
              step={0.05}
              onChange={(paucFrom) => set({ ...o, paucFrom })}
            />
            <NumField
              id="roc-pauc-to"
              label="To"
              value={o.paucTo}
              lo={0.01}
              hi={1}
              step={0.05}
              onChange={(paucTo) => set({ ...o, paucTo })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={o.paucCorrect}
              onChange={(e) => set({ ...o, paucCorrect: e.target.checked })}
            />{' '}
            McClish’s correction (0.5 for chance, 1 for a perfect test)
          </label>
        </>
      )}
    </fieldset>
  );
}

/** The ROC curves: the main one first, then the comparison's. */
function RocChart({ r }: { r: Result }) {
  const W = 400;
  const H = 400;
  const pad = { l: 56, r: 16, t: 14, b: 44 };
  const size = W - pad.l - pad.r;
  const sx = (v: number) => pad.l + v * size;
  const sy = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const comparison = r.comparison;
  const curves: { label: string; points: RocPoints }[] = [];
  if (comparison?.type === 'groups') {
    comparison.curves.forEach((points, i) =>
      curves.push({ label: `Group ${comparison.groups?.[i] ?? i + 1}`, points }),
    );
  } else {
    curves.push({ label: r.input.predictor || 'Fitted probability', points: r.curve });
    if (comparison) curves.push({ label: r.input.predictor2, points: comparison.curves[0] });
  }
  const path = (p: RocPoints) =>
    p.fpr.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(p.tpr[i]).toFixed(1)}`).join('');
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const best = r.best[0];
  return (
    <ChartFrame
      id="roc:curve"
      name="roc-curve"
      width={W}
      height={H}
      defaults={{
        x: '1 − specificity (false positive rate)',
        y: 'Sensitivity (true positive rate)',
      }}
      caption={
        <span className="hint">
          The diagonal is a predictor no better than chance.
          {best &&
            comparison?.type !== 'groups' &&
            ` The dot: the best cut-point (${r.cutpoint === 'youden' ? 'Youden’s J' : 'closest to the top-left corner'}), threshold ${fmt(best.threshold)}.`}
        </span>
      }
    >
      {(labels) => (
        <svg className="mc-chart data-chart" width={W} height={H} role="img" aria-label="ROC curve">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={sx(0)} x2={sx(1)} y1={sy(t)} y2={sy(t)} />
              <line className="grid-line" x1={sx(t)} x2={sx(t)} y1={sy(0)} y2={sy(1)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {fmt(t, 1)}
              </text>
              <text x={sx(t)} y={H - pad.b + 16} textAnchor="middle">
                {fmt(t, 1)}
              </text>
            </g>
          ))}
          <line className="ref-line" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} />
          {curves.map((cv, i) => (
            <path key={i} d={path(cv.points)} fill="none" stroke={seriesColor(i)} strokeWidth={2} />
          ))}
          {best && comparison?.type !== 'groups' && (
            <circle
              cx={sx(1 - best.specificity)}
              cy={sy(best.sensitivity)}
              r={5}
              fill={seriesColor(0)}
              stroke="white"
            />
          )}
          {curves.length > 1 &&
            curves.map((cv, i) => (
              <g key={`legend${i}`}>
                <line
                  x1={sx(0.55)}
                  x2={sx(0.62)}
                  y1={sy(0.2 - i * 0.07)}
                  y2={sy(0.2 - i * 0.07)}
                  stroke={seriesColor(i)}
                  strokeWidth={2}
                />
                <text x={sx(0.64)} y={sy(0.2 - i * 0.07) + 4}>
                  {cv.label}
                </text>
              </g>
            ))}
          <text x={pad.l + size / 2} y={H - 4} textAnchor="middle" className="axis-title">
            {labels.x}
          </text>
          <text
            transform={`translate(14 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
        </svg>
      )}
    </ChartFrame>
  );
}

function ComparisonTable({ r, pct }: { r: Result; pct: number }) {
  const k = r.comparison;
  if (!k) return null;
  const paired = k.type === 'paired';
  const names = paired
    ? [r.input.predictor || 'Fitted probability', r.input.predictor2]
    : (k.groups ?? [1, 2]).map((g) => `Group ${g}`);
  const stat = k.df ? `D(${fmt(k.df, 1)}) = ${fmt(k.statistic)}` : `Z = ${fmt(k.statistic)}`;
  const diff = k.ciLow !== null && k.ciHigh !== null ? `[${fmt(k.ciLow)}, ${fmt(k.ciHigh)}]` : '';
  return (
    <Table
      title={
        paired
          ? 'Comparison of two predictors (DeLong, paired)'
          : 'Comparison of two groups (DeLong, unpaired)'
      }
      file="roc-comparison"
      columns={[
        `AUC ${names[0]}`,
        `AUC ${names[1]}`,
        'Statistic',
        'p',
        `${pct}% CI of the difference`,
      ]}
      rows={[[c(k.aucs[0]), c(k.aucs[1]), c(stat), pCell(k.p), c(diff)]]}
      note="DeLong, DeLong & Clarke-Pearson (1988): the difference of the two AUCs over its standard error; a small p means the curves differ in their AUC."
    />
  );
}

function RocView({ r }: { r: Result }) {
  const pct = Math.round(r.input.confidence * 100);
  const intervalName = r.ciMethod === 'delong' ? 'DeLong' : `bootstrap, ${r.input.bootN} samples`;
  const cases = r.levels[1];
  const items: [string, string][] = [
    ['AUC', fmt(r.auc)],
    [`${pct}% CI (${intervalName})`, `[${fmt(r.aucCi.low)}, ${fmt(r.aucCi.high)}]`],
    ['Std. error (DeLong)', fmt(r.aucSe)],
    ['Cases / controls', `${r.cases} / ${r.controls}`],
  ];
  if (r.partial) items.push(['Partial AUC', fmt(r.partial.value)]);
  const directionText = r.direction === '<' ? 'higher' : 'lower';
  return (
    <div className="tables">
      <div className="stat-cards">
        {items.map(([k, v]) => (
          <div className="stat-card" key={k}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {`Cases: ${r.input.response} = ${cases}; ${directionText} predictor values mark cases (${r.n} complete rows; ${r.engine.package} ${r.engine.version}).`}
        {r.partial &&
          r.input.pauc &&
          ` Partial AUC over ${r.input.pauc.focus} ${r.input.pauc.from} to ${r.input.pauc.to}${r.input.pauc.correct ? ' (McClish-corrected)' : ''}${r.partial.ciLow !== null ? `, ${pct}% bootstrap CI [${fmt(r.partial.ciLow)}, ${fmt(r.partial.ciHigh!)}]` : ''}.`}
        {r.comparison && ` Comparison: p ${pIs(r.comparison.p)}.`}
      </p>
      <RocChart r={r} />
      <Table
        title={`Best cut-point (${r.cutpoint === 'youden' ? 'Youden’s J' : 'closest to the top-left corner'})`}
        file="roc-cutpoint"
        columns={[
          'Threshold',
          'Sensitivity',
          'Specificity',
          'PPV',
          'NPV',
          'Accuracy',
          'Youden’s J',
        ]}
        rows={r.best.map((b) => [
          c(b.threshold),
          c(b.sensitivity),
          c(b.specificity),
          c(b.ppv),
          c(b.npv),
          c(b.accuracy),
          c(b.youden),
        ])}
        note="PPV and NPV at the sample’s prevalence of cases. Several rows: thresholds that tie."
      />
      {r.logistic && (
        <Table
          title="Logistic regression"
          file="roc-logistic"
          columns={['Term', 'Estimate (log odds)', 'Std. error', 'z', 'p']}
          rows={r.logistic.map((k) => [c(k.term), c(k.est), c(k.se), c(k.z), pCell(k.p)])}
          note="The model whose fitted probabilities are the predictor of the ROC curve."
        />
      )}
      <ComparisonTable r={r} pct={pct} />
    </div>
  );
}

const DIRECTIONS = ['auto', '<', '>'] as const;

export const rocInput = (o: RocOptions, ctx: Pick<AnalysisCtx, 'settings'>): RocInput => ({
  response: o.response,
  positive: o.positive,
  source: o.source,
  predictor: o.predictor,
  predictors: o.predictors,
  direction: o.direction,
  ciMethod: o.ciMethod,
  bootN: o.bootN,
  cutpoint: o.cutpoint,
  compare: o.compare,
  predictor2: o.predictor2,
  group: o.group,
  pauc: o.pauc
    ? { focus: o.paucFocus, from: o.paucFrom, to: o.paucTo, correct: o.paucCorrect }
    : null,
  seed: ctx.settings.seed,
  confidence: ctx.settings.confidence,
});

export const rocAnalysis: AnalysisType<RocOptions, Result> = {
  id: 'roc',
  title: 'ROC analysis',
  sub: 'ROC curve, AUC with DeLong or bootstrap intervals, optimal cut-points, partial AUC, comparing two curves (pROC)',
  group: 'Basic statistics',
  defaults: () => ({
    response: '',
    positive: null,
    source: 'column',
    predictor: '',
    predictors: [],
    direction: 'auto',
    ciMethod: 'delong',
    bootN: 2000,
    cutpoint: 'youden',
    compare: 'none',
    predictor2: '',
    group: '',
    pauc: false,
    paucFocus: 'specificity',
    paucFrom: 0.8,
    paucTo: 1,
    paucCorrect: false,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const positive =
      typeof raw.positive === 'number' && Number.isFinite(raw.positive) ? raw.positive : null;
    return {
      response: name(raw.response),
      positive,
      source: oneOf(raw.source, ['column', 'logistic'] as const, 'column'),
      predictor: name(raw.predictor),
      predictors: names(raw.predictors),
      direction: oneOf(raw.direction, DIRECTIONS, 'auto'),
      ciMethod: oneOf(raw.ciMethod, ['delong', 'bootstrap'] as const, 'delong'),
      bootN: clampNum(raw.bootN, 100, 100000, 2000, true),
      cutpoint: oneOf(raw.cutpoint, ['youden', 'closest.topleft'] as const, 'youden'),
      compare: oneOf(raw.compare, ['none', 'paired', 'groups'] as const, 'none'),
      predictor2: name(raw.predictor2),
      group: name(raw.group),
      pauc: flag(raw.pauc),
      paucFocus: oneOf(raw.paucFocus, ['specificity', 'sensitivity'] as const, 'specificity'),
      paucFrom: clampNum(raw.paucFrom, 0, 0.99, 0.8),
      paucTo: clampNum(raw.paucTo, 0.01, 1, 1),
      paucCorrect: flag(raw.paucCorrect),
    };
  },
  Options: RocOptionsForm,
  View: ({ result }) => <RocView r={result} />,
  blocked: (o, ctx) => {
    if (!o.response) return 'Choose the outcome.';
    if (o.source === 'column' && !o.predictor) return 'Choose the predictor.';
    if (o.source === 'logistic' && !o.predictors.length) {
      return 'Choose the predictors of the logistic regression.';
    }
    const predictors = o.source === 'column' ? [o.predictor] : o.predictors;
    if (predictors.includes(o.response)) return 'The predictor cannot be the outcome.';
    if (o.compare === 'paired' && !o.predictor2) return 'Choose the second predictor.';
    if (o.compare === 'groups' && !o.group) return 'Choose the grouping column.';
    if (o.compare === 'groups' && [o.response, ...predictors].includes(o.group)) {
      return 'The grouping column must be another column than the outcome and the predictor.';
    }
    if (o.pauc && o.paucFrom >= o.paucTo) return 'The partial AUC range must run from low to high.';
    const missing = missingColumns(ctx, rocColumns(rocInput(o, ctx)), 'ROC analysis');
    if (missing) return missing;
    const values = valuesOf(ctx, o.response, 2);
    if (values.length !== 2) return `The outcome ${o.response} must have exactly two values.`;
    if (o.positive !== null && !values.some(([v]) => v === o.positive)) {
      return `${o.positive} is not a value of ${o.response}.`;
    }
    return null;
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, rocColumns(rocInput(o, ctx)), [
      JSON.stringify(o),
      ctx.settings.seed,
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) => {
    const input = rocInput(o, ctx);
    return { ...(await (await import('../rengine/roc')).rocR(rawData(ctx)!, input)), input };
  },
  script: async (o, ctx) =>
    (await import('../rengine/roc')).rocScriptR(rawData(ctx)!, rocInput(o, ctx)),
  summary: (o) => {
    const predictor = o.source === 'column' ? o.predictor || '…' : 'logistic regression';
    const parts = [
      `${predictor} for ${o.response || '…'}`,
      o.ciMethod === 'delong' ? 'DeLong' : 'bootstrap',
    ];
    if (o.compare === 'paired') parts.push(`vs ${o.predictor2 || '…'}`);
    if (o.compare === 'groups') parts.push(`by ${o.group || '…'}`);
    if (o.pauc) parts.push('partial AUC');
    return parts.join(' · ');
  },
};
