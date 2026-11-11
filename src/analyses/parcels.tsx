// Parcel allocation variability (Sterba & MacCallum 2010; as semTools::parcelAllocation): the model refitted with the
// items of each parcelled construct assigned to its parcels at random, many times.

import { c, Table, type Row } from '../components/results/Table';
import {
  allocationVariability,
  parcelTargets,
  type AllocationResult,
  type Spread,
} from '../engine/parcels';
import { toSpec } from '../model/project';
import { fingerprint } from './codec';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export interface ParcelAllocationOptions {
  allocations: number;
}

const targetsOf = (ctx: AnalysisCtx) =>
  ctx.model ? parcelTargets(toSpec(ctx.model), ctx.info?.computed ?? []) : [];
const pct = (v: number) => `${Math.round(v * 100)}%`;

function View({ result: r }: { result: AllocationResult }) {
  const rows = (xs: Spread[], sig: boolean): Row[] =>
    xs.map((x) => [
      c(x.label),
      c(x.current),
      c(x.mean),
      c(x.sd),
      c(x.min),
      c(x.max),
      c(pct(x.percentile), 'dim'),
      ...(sig ? [c(x.significant === undefined ? null : pct(x.significant))] : []),
    ]);
  const cols = ['', 'Your parcels', 'Mean', 'SD', 'Min', 'Max', 'Percentile'];
  return (
    <div className="tables">
      <Table
        title="Fit over random allocations"
        file="parcel-allocation-fit"
        columns={cols}
        rows={rows(r.fit, false)}
        note={`${r.allocations} random allocations${r.failed ? ` (${r.failed} could not be estimated)` : ''}, each with the parcel sizes you chose; ML, complete cases. A wide range means the conclusions depend on which items happen to be parcelled together. Percentile: the share of allocations at or below your parcels’ value. Balanced parcels do not always fit better than random ones, and good parcel-level fit is no evidence that the item-level model fits.`}
      />
      {r.estimates.length > 0 && (
        <Table
          title="Estimates over random allocations (standardised)"
          file="parcel-allocation-estimates"
          columns={[...cols, 'Significant (p < .05)']}
          rows={rows(r.estimates, true)}
        />
      )}
    </div>
  );
}

export const parcelAllocationAnalysis: AnalysisType<ParcelAllocationOptions, AllocationResult> = {
  id: 'parcelallocation',
  title: 'Parcel allocation variability',
  sub: 'how much fit and estimates depend on which items are parcelled together',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({ allocations: 100 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          allocations: Math.min(
            1000,
            Math.max(10, Math.round(typeof raw.allocations === 'number' ? raw.allocations : 100)),
          ),
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        For the constructs measured by parcels (
        {targetsOf(ctx)
          .map((t) => t.construct)
          .join(', ') || 'none yet: Make parcels… in a construct’s panel'}
        ): their items are reassigned to the parcels at random and the model refitted, as
        semTools::parcelAllocation (Sterba &amp; MacCallum 2010). Built-in engine, ML, complete
        cases; seed from the Model settings.
      </p>
      <label className="field">
        Allocations
        <input
          className="input num"
          type="number"
          min={10}
          max={1000}
          step={10}
          value={o.allocations}
          onChange={(e) =>
            set({
              allocations: Math.min(1000, Math.max(10, Math.round(Number(e.target.value) || 100))),
            })
          }
        />
      </label>
    </fieldset>
  ),
  View,
  blocked: (_o, ctx) => {
    if (ctx.settings.method !== 'cbsem')
      return 'Parcel allocation is checked for CB-SEM models: switch to CB-SEM.';
    if (!rawData(ctx)) return 'This needs raw data: the parcels are computed from the items.';
    if (targetsOf(ctx).length === 0)
      return 'No construct is measured by parcels yet: open a construct’s panel and choose Make parcels…';
    return null;
  },
  fingerprint: (o, ctx) => {
    const t = targetsOf(ctx);
    const cols = columnsFingerprint(
      ctx,
      t.flatMap((x) => x.items),
    );
    return cols && ctx.model
      ? fingerprint([
          cols,
          JSON.stringify(toSpec(ctx.model)),
          JSON.stringify(t),
          o.allocations,
          ctx.settings.seed,
        ])
      : null;
  },
  run: async (o, ctx, progress) => {
    const spec = toSpec(ctx.model!);
    return allocationVariability(
      ctx.data!,
      spec,
      parcelTargets(spec, ctx.info?.computed ?? []),
      { allocations: o.allocations, seed: ctx.settings.seed },
      progress,
    );
  },
  summary: (o) => `${o.allocations} random allocations`,
};
