// Split by group (SPSS's SPLIT FILE, JASP's split): a card that reads raw data
// can run separately for each level of a grouping column, one result section
// per group, each labelled with the group and its number of cases. withSplit
// wraps such an analysis type: the option `splitBy` (a column) is added to its
// options; without it the card is exactly the wrapped one.
//
// Cards that support it (SPLIT_CARDS): the basic statistics (t-tests, ANOVA,
// repeated-measures ANOVA, MANOVA, correlations, contingency tables, binomial
// and multinomial tests, reliability and agreement) and charts. Cards that fit
// the model, write into the data or use groups themselves do not.

import type { ComponentType } from 'react';
import type { Dataset } from '../engine/types';
import { labelOf, labelsToText, valueLabels } from '../data/columns';
import { fingerprint } from './codec';
import { ColumnSelect, isObj, name, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

/** The ids of the cards that can be split by group. */
export const SPLIT_CARDS = [
  'ttest',
  'anova',
  'rmanova',
  'manova',
  'correlation',
  'contingency',
  'freqtest',
  'reliability',
  'chart',
] as const;

/** At most this many groups (each runs the analysis once). */
export const MAX_SPLIT_GROUPS = 20;

/** One group's section of a split result. */
export interface SplitGroup<R> {
  label: string;
  n: number;
  result?: R;
  error?: string;
}

/** The result of a split card: one section per group, in the order of the column's values. */
export interface SplitResult<R> {
  __split: { column: string; groups: SplitGroup<R>[] };
}

/** Whether a result is a split result. */
export function isSplitResult(r: unknown): r is SplitResult<unknown> {
  return isObj(r) && isObj((r as Record<string, unknown>).__split);
}

/** The split column of options, if any. */
function splitOf(o: unknown): string {
  if (!isObj(o)) return '';
  const v = (o as Record<string, unknown>).splitBy;
  return typeof v === 'string' ? v : '';
}

/** The options without the split column, as the wrapped analysis expects them. */
function withoutSplit<O>(o: O): O {
  if (!isObj(o) || !('splitBy' in o)) return o;
  const { splitBy: _s, ...rest } = o as Record<string, unknown>;
  return rest as O;
}

/** The groups of a column: its distinct values (missing left out) with their names and rows. */
export function splitGroups(
  data: Dataset,
  info: AnalysisCtx['info'],
  column: string,
): { label: string; rows: number[] }[] {
  const col = data.cols[data.names.indexOf(column)];
  if (!col) return [];
  const rows = new Map<number, number[]>();
  col.forEach((v, i) => {
    if (Number.isNaN(v)) return;
    const list = rows.get(v) ?? [];
    list.push(i);
    rows.set(v, list);
  });
  const categories = data.categories?.[column];
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([v, list]) => {
      let label = labelOf(info, column, v) ?? String(v);
      if (categories) label = categories[v - 1] ?? String(v);
      return { label, rows: list };
    });
}

/** The dataset with only these rows (in order). */
export function subsetRows(data: Dataset, rows: number[]): Dataset {
  const cols = data.cols.map((c) => Float64Array.from(rows, (i) => c[i]));
  return { ...data, cols };
}

/** The context with the data of one group. */
function groupCtx(ctx: AnalysisCtx, rows: number[]): AnalysisCtx {
  const data = subsetRows(rawData(ctx)!, rows);
  const info = ctx.info ? { ...ctx.info, rows: rows.length } : null;
  return { ...ctx, data, info };
}

/** Why the data cannot be split by the column, or null when they can. */
function splitBlocked(column: string, ctx: AnalysisCtx): string | null {
  const d = rawData(ctx);
  if (!d) return 'Splitting by group needs raw data.';
  if (!d.names.includes(column)) return `Split by: “${column}” is not in the data.`;
  const groups = splitGroups(d, ctx.info, column);
  if (groups.length < 2) return `Split by: “${column}” has fewer than two groups.`;
  if (groups.length > MAX_SPLIT_GROUPS)
    return `Split by: “${column}” has ${groups.length} values; at most ${MAX_SPLIT_GROUPS} groups.`;
  return null;
}

/** One group's heading: the column, the group and its cases. */
function GroupHeading({ column, g }: { column: string; g: SplitGroup<unknown> }) {
  return (
    <h4 className="split-heading">
      {column} = {g.label} <span className="muted">(n = {g.n})</span>
    </h4>
  );
}

/** An analysis type that can also run separately for each group of a column. */
export function withSplit<O, R>(t: AnalysisType<O, R>): AnalysisType<O, R> {
  const Options: ComponentType<OptionsProps<O>> = (props) => {
    const d = rawData(props.ctx);
    const split = splitOf(props.options);
    const setSplit = (splitBy: string) => {
      const base = withoutSplit(props.options) as Record<string, unknown>;
      props.set((splitBy ? { ...base, splitBy } : base) as O);
    };
    return (
      <>
        <t.Options {...props} />
        {d && (
          <fieldset className="card-options" disabled={props.disabled}>
            <ColumnSelect
              id={`split-${t.id}`}
              label="Split by (optional): run separately for each group"
              optional="No split: all cases together"
              value={split}
              columns={d.names}
              onChange={setSplit}
            />
          </fieldset>
        )}
      </>
    );
  };

  const View: AnalysisType<O, R>['View'] = ({ result, options, current }) => {
    if (!isSplitResult(result))
      return <t.View result={result} options={options} current={current} />;
    const { column, groups } = (result as unknown as SplitResult<R>).__split;
    return (
      <div className="split-result">
        {groups.map((g) => (
          <section key={g.label} className="split-section" aria-label={`${column} = ${g.label}`}>
            <GroupHeading column={column} g={g} />
            {g.result !== undefined ? (
              <t.View result={g.result} options={withoutSplit(options)} current={current} />
            ) : (
              <div className="card-bar bad">{g.error ?? 'No result.'}</div>
            )}
          </section>
        ))}
      </div>
    );
  };

  return {
    ...t,
    parseOptions: (raw) => {
      const base = t.parseOptions(raw);
      if (base === null || !isObj(raw)) return base;
      const splitBy = name((raw as Record<string, unknown>).splitBy);
      return splitBy ? ({ ...base, splitBy } as O) : base;
    },
    Options,
    View,
    summary: (o) => {
      const base = t.summary(withoutSplit(o));
      const split = splitOf(o);
      return split ? `${base} · split by ${split}` : base;
    },
    blocked: (o, ctx) => {
      const split = splitOf(o);
      const own = t.blocked(withoutSplit(o), ctx);
      if (own || !split) return own;
      return splitBlocked(split, ctx);
    },
    fingerprint: (o, ctx) => {
      const own = t.fingerprint(withoutSplit(o), ctx);
      const split = splitOf(o);
      if (own === null || !split) return own;
      const d = rawData(ctx);
      const k = d ? d.names.indexOf(split) : -1;
      if (!d || k < 0) return null;
      return fingerprint([
        own,
        'split',
        split,
        d.cols[k],
        labelsToText(valueLabels(ctx.info, split)),
      ]);
    },
    run: async (o, ctx, progress) => {
      const split = splitOf(o);
      const plain = withoutSplit(o);
      if (!split) return t.run(plain, ctx, progress);
      const groups: SplitGroup<R>[] = [];
      const parts = splitGroups(rawData(ctx)!, ctx.info, split);
      for (const [k, part] of parts.entries()) {
        progress(k, parts.length);
        const sub = groupCtx(ctx, part.rows);
        const g: SplitGroup<R> = { label: part.label, n: part.rows.length };
        // A group too small for the analysis gets its message; the others still run.
        const why = t.blocked(plain, sub);
        if (why) g.error = why;
        else {
          try {
            g.result = await t.run(plain, sub, () => {});
          } catch (e) {
            g.error = e instanceof Error ? e.message : String(e);
          }
        }
        groups.push(g);
      }
      progress(parts.length, parts.length);
      if (groups.every((g) => g.error)) throw new Error(groups[0].error);
      const result: SplitResult<R> = { __split: { column: split, groups } };
      return result as unknown as R;
    },
    ...(t.script
      ? {
          script: async (o: O, ctx: AnalysisCtx) => {
            const split = splitOf(o);
            const plain = withoutSplit(o);
            if (!split) return t.script!(plain, ctx);
            const texts: string[] = [];
            for (const part of splitGroups(rawData(ctx)!, ctx.info, split)) {
              const heading = `# ===== ${split} = ${part.label} (n = ${part.rows.length}) =====`;
              const sub = groupCtx(ctx, part.rows);
              if (t.blocked(plain, sub)) continue;
              texts.push(`${heading.replace(/\n/g, ' ')}\n\n${await t.script!(plain, sub)}`);
            }
            return texts.join('\n\n');
          },
        }
      : {}),
  };
}
