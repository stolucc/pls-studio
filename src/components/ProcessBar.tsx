import { useMemo } from 'react';
import { isSlotName } from '../process/canvas';
import { processGraph } from '../process/fromModel';
import { describe, mediatorRange, template } from '../process/templates';
import { useStore } from '../store';

/**
 * What the drawn conditional process model is: a numbered PROCESS model (with
 * each variable's role and mediator count controls), a custom model, or what
 * still keeps it from being a process model.
 */
export function ProcessBar({ onTemplates }: { onTemplates: () => void }) {
  const model = useStore((s) => s.model);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const info = useMemo(() => processGraph(model), [model]);
  const found = info.recognised;
  const tp = found ? template(found.model) : undefined;
  const [lo, hi] = tp ? mediatorRange(tp) : [0, 0];
  const k = found?.roles.m.length ?? 0;
  const set = (n: number) => useStore.getState().setMediatorCount(n);
  // An unfilled slot is named by its role: show the role alone.
  const role = (r: string, v: string | undefined) => v && <span className="role"><b>{r}</b>{isSlotName(v) ? '' : ` ${v}`}</span>;
  return (
    <div className="process-bar" role="status">
      {tp && found ? (
        <>
          <span className="chip accent model-chip" title={`PROCESS model ${tp.model}: ${describe(tp)}`}>Model {tp.model}</span>
          {role('X', found.roles.x)}
          {found.roles.m.map((m, i) => <span key={m}>{role(found.roles.m.length > 1 ? `M${i + 1}` : 'M', m)}</span>)}
          {role('W', found.roles.w)}
          {role('Z', found.roles.z)}
          {role('Y', found.roles.y)}
          {info.covariates.length > 0 && <span className="role"><b>Cov</b> {info.covariates.join(', ')}</span>}
          {hi > lo && !readOnly && (
            <span className="med-count" title="Number of mediators">
              <button className="btn sm ghost" onClick={() => set(k - 1)} disabled={k <= lo} aria-label="Remove a mediator">−</button>
              {k} mediator{k === 1 ? '' : 's'}
              <button className="btn sm ghost" onClick={() => set(k + 1)} disabled={k >= hi} aria-label="Add a mediator">+</button>
            </span>
          )}
        </>
      ) : info.graph ? (
        <>
          <span className="chip model-chip">Custom model</span>
          <span className="hint">X {info.graph.x} → Y {info.graph.y}{info.graph.mediators.length ? `, ${info.graph.mediators.length} mediator${info.graph.mediators.length === 1 ? '' : 's'}` : ''}. Not one of PROCESS’s numbered models; estimated the same way.</span>
        </>
      ) : (
        <span className="hint">{info.errors[0]?.message}</span>
      )}
      {!readOnly && <button className="btn sm ghost" onClick={onTemplates}>Templates…</button>}
    </div>
  );
}
