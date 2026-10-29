import { useMemo } from 'react';
import type { InvarianceLevel } from '../engine/types';
import { useStore } from '../store';
import { IconX } from './icons';

const LEVELS: { id: InvarianceLevel; label: string; hint: string }[] = [
  { id: 'configural', label: 'Configural', hint: 'Same model in every group; all parameters free per group.' },
  { id: 'metric', label: 'Metric', hint: 'Loadings equal across groups (weak invariance): relations between factors can be compared.' },
  { id: 'scalar', label: 'Scalar', hint: 'Loadings and intercepts (thresholds for ordinal items) equal (strong invariance): latent means can be compared; they are estimated relative to the first group.' },
  { id: 'strict', label: 'Strict', hint: 'Also the indicator residual variances equal.' },
];

/**
 * CB-SEM multiple-group analysis (lavaan): the grouping column, the level of
 * measurement invariance, and the parameters freed across groups (partial
 * invariance, set by right-clicking an indicator).
 */
export function GroupsEditor() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setMultigroup = useStore((s) => s.setMultigroup);
  const mg = model.multigroup;
  const assigned = useMemo(() => new Set(model.constructs.flatMap((c) => c.indicators)), [model.constructs]);
  // Candidate grouping columns: not indicators, 2–20 distinct values.
  const candidates = useMemo(() => (data && !data.moments ? data.names.filter((n, i) => {
    if (assigned.has(n)) return false;
    const vals = new Set<number>();
    for (const v of data.cols[i]) { if (!Number.isNaN(v)) vals.add(v); if (vals.size > 20) return false; }
    return vals.size >= 2;
  }) : []), [data, assigned]);
  const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  if (!data || data.moments) return null;
  return (
    <div className="section">
      <div className="section-title">Groups</div>
      <select className="select" value={mg?.column ?? ''} disabled={readOnly}
        onChange={(e) => setMultigroup(e.target.value ? { column: e.target.value, invariance: mg?.invariance ?? 'configural', free: mg?.free ?? [] } : null)}>
        <option value="">One group (no grouping)</option>
        {candidates.map((c) => <option key={c} value={c}>Groups by {c}</option>)}
        {mg && !candidates.includes(mg.column) && <option value={mg.column}>Groups by {mg.column}</option>}
      </select>
      {!candidates.length && !mg && <div className="hint" style={{ marginTop: 6 }}>A grouping column is a numeric column with 2 to 20 values that is not an indicator (e.g. 1 = control, 2 = treatment).</div>}
      {mg && (
        <>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Held equal across groups</label>
            <div className="segmented">
              {LEVELS.map((l) => (
                <button key={l.id} className={mg.invariance === l.id ? 'on' : ''} disabled={readOnly} title={l.hint}
                  onClick={() => setMultigroup({ ...mg, invariance: l.id })}>{l.label}</button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{LEVELS.find((l) => l.id === mg.invariance)?.hint} Compare all levels in the results’ Measurement invariance tab.</div>
          </div>
          {mg.free.length > 0 && (
            <div className="field">
              <label>Free across groups (partial invariance)</label>
              {mg.free.map((f, i) => (
                <div className="ind" key={i}>
                  <span>{f.kind === 'loading' ? `${name(f.construct)} → ${f.indicator} (loading)` : `${f.indicator} (intercept)`}</span><span />
                  {!readOnly && <button className="btn icon ghost sm always" aria-label="Hold equal again" title="Hold equal across groups again"
                    onClick={() => setMultigroup({ ...mg, free: mg.free.filter((_, k) => k !== i) })}><IconX size={13} /></button>}
                </div>
              ))}
            </div>
          )}
          {mg.invariance !== 'configural' && <div className="hint">Right-click an indicator to free its loading or intercept across groups. The score tests in Measurement invariance show which equality fits worst.</div>}
        </>
      )}
    </div>
  );
}

const ROTATIONS: { id: import('../engine/types').EsemRotation; label: string }[] = [
  { id: 'geomin', label: 'Geomin (oblique; Mplus default)' },
  { id: 'oblimin', label: 'Oblimin (oblique)' },
  { id: 'quartimin', label: 'Quartimin (oblique)' },
  { id: 'varimax', label: 'Varimax (orthogonal)' },
  { id: 'target', label: 'Target (towards the drawn loadings)' },
];

/** CB-SEM exploratory SEM blocks: their factors, and the rotation. */
export function EsemEditor() {
  const model = useStore((s) => s.model);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setEsem = useStore((s) => s.setEsem);
  const esem = model.esem;
  if (!esem?.blocks.length) return null;
  const name = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="section">
      <div className="section-title">Exploratory SEM</div>
      {esem.blocks.map((b, i) => (
        <div className="ind" key={b.id}>
          <span>Block {i + 1}: {b.constructs.map(name).join(', ')}</span><span />
          {!readOnly && <button className="btn sm ghost always" title="Make these ordinary factors again"
            onClick={() => setEsem({ ...esem, blocks: esem.blocks.filter((_, k) => k !== i) })}>Dissolve</button>}
        </div>
      ))}
      <div className="field" style={{ marginTop: 8 }}>
        <label>Rotation</label>
        <select className="select" value={esem.rotation} disabled={readOnly} onChange={(e) => setEsem({ ...esem, rotation: e.target.value as typeof esem.rotation })}>
          {ROTATIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <div className="hint">Each factor of a block loads on every indicator of the block; the factors are identified by rotation (variances 1), not by a marker (Asparouhov &amp; Muthén, 2009; lavaan efa()). Cross-loadings are in the Loadings table; the diagram draws each factor’s own indicators.</div>
    </div>
  );
}
