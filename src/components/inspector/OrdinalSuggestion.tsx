// A suggestion on the CB-SEM estimator options: indicators whose measurement
// level is set to ordinal in the Data tab but that the model does not treat as
// ordinal yet, with a button to declare them.

import { variableInfo } from '../../data/columns';
import type { DataInfo, ModelState } from '../../model/project';
import { useStore } from '../../store';

/** The model's indicators set to ordinal in the Data tab and not yet declared ordinal (or counts). */
export function ordinalSuggestions(model: ModelState, info: DataInfo | null): string[] {
  if (!info) return [];
  const declared = new Set([...(model.ordered ?? []), ...Object.keys(model.count ?? {})]);
  const indicators = [...new Set(model.constructs.flatMap((c) => c.indicators))];
  return indicators.filter((i) => !declared.has(i) && variableInfo(info, i)?.level === 'ordinal');
}

export function OrdinalSuggestion({ disabled }: { disabled: boolean }) {
  const model = useStore((s) => s.model);
  const info = useStore((s) => s.dataInfo);
  const setOrdered = useStore((s) => s.setOrdered);
  const names = ordinalSuggestions(model, info);
  if (!names.length) return null;
  return (
    <div className="hint" role="note" style={{ marginTop: 8 }}>
      Marked ordinal in the Data tab: {names.join(', ')}. Ordinal indicators are estimated with
      WLSMV through polychoric correlations.{' '}
      <button className="btn sm" disabled={disabled} onClick={() => setOrdered(names, true)}>
        Declare them ordinal
      </button>
    </div>
  );
}
