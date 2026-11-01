import { useMemo } from 'react';
import type { FreedParameter, InvarianceLevel, StructuralEquality } from '../engine/types';
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
  if (!data) return null;
  const matrixGroups = data.moments?.groups;
  // Covariance-matrix data carry no cases, so there is nothing to split into groups: say so instead of hiding the section.
  if (data.moments && data.cols.length === 0 && !matrixGroups) {
    return (
      <div className="section">
        <div className="section-title">Groups</div>
        <div className="hint">Multiple-group models need raw data with a grouping column, or one covariance matrix per group; this dataset is a covariance matrix (summary statistics for one sample).</div>
      </div>
    );
  }
  const structural = mg?.structural ?? [];
  const toggleStructural = (k: StructuralEquality) => mg && setMultigroup({ ...mg, structural: structural.includes(k) ? structural.filter((x) => x !== k) : [...structural, k] });
  const freed = (f: FreedParameter) => (f.kind === 'loading' ? `${name(f.construct)} → ${f.indicator} (loading)` : f.kind === 'intercept' ? `${f.indicator} (intercept)` : f.kind === 'mean' ? `${name(f.construct)} (mean / intercept)` : `${name(f.from)} → ${name(f.to)} (coefficient)`);
  return (
    <div className="section">
      <div className="section-title">Groups</div>
      {matrixGroups ? (
        <select className="select" value={mg ? 'matrices' : ''} disabled={readOnly} aria-label="Groups"
          onChange={(e) => setMultigroup(e.target.value ? { column: '', invariance: mg?.invariance ?? 'configural', free: mg?.free ?? [], ...(mg?.structural ? { structural: mg.structural } : {}) } : null)}>
          <option value="">One group (the matrices pooled)</option>
          <option value="matrices">{matrixGroups.length} groups: {matrixGroups.map((g) => `${g.label} (N = ${g.n})`).join(', ')}</option>
        </select>
      ) : (
        <select className="select" value={mg?.column ?? ''} disabled={readOnly}
          onChange={(e) => setMultigroup(e.target.value ? { column: e.target.value, invariance: mg?.invariance ?? 'configural', free: mg?.free ?? [] } : null)}>
          <option value="">One group (no grouping)</option>
          {candidates.map((c) => <option key={c} value={c}>Groups by {c}</option>)}
          {mg && !candidates.includes(mg.column) && <option value={mg.column}>Groups by {mg.column}</option>}
        </select>
      )}
      {!matrixGroups && !candidates.length && !mg && <div className="hint" style={{ marginTop: 6 }}>A grouping column is a numeric column with 2 to 20 values that is not an indicator (e.g. 1 = control, 2 = treatment).</div>}
      {mg && (
        <>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Measurement held equal across groups</label>
            <div className="segmented">
              {LEVELS.map((l) => (
                <button key={l.id} className={mg.invariance === l.id ? 'on' : ''} disabled={readOnly} title={l.hint}
                  onClick={() => setMultigroup({ ...mg, invariance: l.id })}>{l.label}</button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{LEVELS.find((l) => l.id === mg.invariance)?.hint} Compare all levels in the results’ Measurement invariance tab.</div>
          </div>
          <div className="field">
            <label>Structural model held equal across groups</label>
            <label className="check"><input type="checkbox" checked={structural.includes('regressions')} disabled={readOnly} onChange={() => toggleStructural('regressions')} /> <span>Path coefficients (a stacked model)</span></label>
            <label className="check"><input type="checkbox" checked={structural.includes('lv.variances')} disabled={readOnly} onChange={() => toggleStructural('lv.variances')} /> <span>Construct variances</span></label>
            <label className="check"><input type="checkbox" checked={structural.includes('lv.covariances')} disabled={readOnly} onChange={() => toggleStructural('lv.covariances')} /> <span>Construct covariances</span></label>
            {model.constant && <label className="check"><input type="checkbox" checked={structural.includes('means')} disabled={readOnly} onChange={() => toggleStructural('means')} /> <span>Construct means and intercepts (the arrows from the constant)</span></label>}
            <div className="hint" style={{ marginTop: 6 }}>
              {structural.includes('regressions')
                ? 'Every path coefficient is the same in every group except those freed: right-click a path to let it differ between groups (Hayduk’s stacked model). The score tests under Measurement invariance say which equality fits worst.'
                : 'With nothing held equal the structural model is estimated separately per group; compare the groups side by side in the results (All groups).'}
            </div>
          </div>
          {!model.constant && (mg.invariance === 'configural' || mg.invariance === 'metric') && (
            <div className="field">
              <label className="check"><input type="checkbox" checked={mg.meanStructure !== false} disabled={readOnly}
                onChange={(e) => { const { meanStructure: _m, ...rest } = mg; setMultigroup(e.target.checked ? rest : { ...rest, meanStructure: false }); }} />
                <span>Intercepts in every group<br /><span className="hint">lavaan estimates the indicator intercepts per group in every multiple-group model. Untick for a model of the covariances only (Mplus MODEL = NOMEANSTRUCTURE): the fit is the same, with fewer parameters.</span></span></label>
            </div>
          )}
          {mg.free.length > 0 && (
            <div className="field">
              <label>Free across groups (differs between groups)</label>
              {mg.free.map((f, i) => (
                <div className="ind" key={i}>
                  <span>{freed(f)}</span><span />
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
      {esem.rotation === 'geomin' && (
        <div className="field">
          <label htmlFor="esem-eps">Geomin ε</label>
          <select id="esem-eps" className="select" value={String(esem.epsilon ?? 0.001)} disabled={readOnly}
            onChange={(e) => { const v = Number(e.target.value); const { epsilon: _e, ...rest } = esem; setEsem(v === 0.001 ? rest : { ...rest, epsilon: v }); }}>
            <option value="0.001">0.001 (lavaan’s default; Mplus with three factors)</option>
            <option value="0.0001">0.0001 (Mplus with two factors)</option>
            <option value="0.01">0.01 (Mplus with four or more factors)</option>
          </select>
          <div className="hint">The small constant that keeps geomin’s criterion smooth; it changes the rotated loadings, and with them the factor correlations and the paths of rotated factors.</div>
        </div>
      )}
      <div className="hint">Each factor of a block loads on every indicator of the block; the factors are identified by rotation (variances 1), not by a marker (Asparouhov &amp; Muthén, 2009; lavaan efa()). Cross-loadings are in the Loadings table; the diagram draws each factor’s own indicators.</div>
    </div>
  );
}

/** CB-SEM two-level model: the cluster column and the between-level model. */
export function ClustersEditor() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setMultilevel = useStore((s) => s.setMultilevel);
  const ml = model.multilevel;
  const assigned = useMemo(() => new Set(model.constructs.flatMap((c) => c.indicators)), [model.constructs]);
  // Candidate cluster columns: not indicators, at least two distinct values.
  const candidates = useMemo(() => (data && !data.moments ? data.names.filter((n, i) => {
    if (assigned.has(n)) return false;
    const vals = new Set<number>();
    for (const v of data.cols[i]) { if (!Number.isNaN(v)) vals.add(v); if (vals.size > 1) return true; }
    return false;
  }) : []), [data, assigned]);
  if (!data || data.moments) return null;
  return (
    <div className="section">
      <div className="section-title">Clusters (two-level)</div>
      <select className="select" value={ml?.column ?? ''} disabled={readOnly}
        onChange={(e) => setMultilevel(e.target.value ? { column: e.target.value, between: ml?.between ?? 'saturated' } : null)}>
        <option value="">No clustering (one level)</option>
        {candidates.map((c) => <option key={c} value={c}>Clusters by {c}</option>)}
      </select>
      {ml && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Between clusters</label>
          <div className="segmented">
            <button className={ml.between === 'saturated' ? 'on' : ''} disabled={readOnly} onClick={() => setMultilevel({ ...ml, between: 'saturated' })}>Saturated</button>
            <button className={ml.between === 'same' ? 'on' : ''} disabled={readOnly} onClick={() => setMultilevel({ ...ml, between: 'same' })}>Same model</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {ml.between === 'saturated'
              ? 'The model is fitted to the within-cluster (co)variances; between clusters every variance and covariance is free. For clustered data when the interest is within.'
              : 'The same factors and paths also between clusters (on the cluster means; factors suffixed “(between)” in lavaan as *_b).'}
            {' '}Results: switch Within / Between in the results header (lavaan, ML or MLR).
          </div>
        </div>
      )}
    </div>
  );
}

/** CB-SEM sampling (survey) weights: a non-negative numeric column (lavaan's sampling.weights). */
export function WeightsEditor() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setWeights = useStore((s) => s.setWeights);
  const assigned = useMemo(() => new Set(model.constructs.flatMap((c) => c.indicators)), [model.constructs]);
  // Candidates: not indicators, numeric, non-negative and complete.
  const candidates = useMemo(() => (data && !data.moments ? data.names.filter((n, i) => !assigned.has(n) && !data.categories?.[n]
    && data.cols[i].length > 0 && Array.from(data.cols[i]).every((v) => Number.isFinite(v) && v >= 0)) : []), [data, assigned]);
  if (!data || data.moments) return null;
  return (
    <div className="section">
      <div className="section-title">Sampling weights</div>
      <select className="select" value={model.weights ?? ''} disabled={readOnly} onChange={(e) => setWeights(e.target.value || null)}>
        <option value="">No weights</option>
        {model.weights && !candidates.includes(model.weights) && <option value={model.weights}>{model.weights} (not usable)</option>}
        {candidates.map((c) => <option key={c} value={c}>Weighted by {c}</option>)}
      </select>
      {model.weights && <div className="hint" style={{ marginTop: 6 }}>Survey or design weights (lavaan’s sampling.weights): the estimates are weighted and the standard errors robust (design-based). ML, MLR or MLM.</div>}
    </div>
  );
}

/** CB-SEM sampling clusters of a complex design: cluster-robust standard errors (lavaan's cluster = in a single-level model). */
export function SamplingClustersEditor() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const readOnly = useStore((s) => s.cloud?.role === 'viewer');
  const setCluster = useStore((s) => s.setCluster);
  const assigned = useMemo(() => new Set(model.constructs.flatMap((c) => c.indicators)), [model.constructs]);
  // Candidates: not indicators, at least two distinct values, fewer clusters than cases.
  const candidates = useMemo(() => (data && !data.moments ? data.names.filter((n, i) => {
    if (assigned.has(n) || n === model.weights || n === model.multigroup?.column) return false;
    const k = new Set(Array.from(data.cols[i]).filter((v) => Number.isFinite(v))).size;
    return k >= 2 && k < data.cols[i].length;
  }) : []), [data, assigned, model.weights, model.multigroup?.column]);
  if (!data || data.moments || model.multilevel) return null;
  return (
    <div className="section">
      <div className="section-title">Sampling clusters</div>
      <select className="select" value={model.cluster ?? ''} disabled={readOnly} onChange={(e) => setCluster(e.target.value || null)} aria-label="Sampling clusters">
        <option value="">No clustering</option>
        {model.cluster && !candidates.includes(model.cluster) && <option value={model.cluster}>{model.cluster} (not usable)</option>}
        {candidates.map((c) => <option key={c} value={c}>Clustered by {c}</option>)}
      </select>
      <div className="hint" style={{ marginTop: 6 }}>
        {model.cluster
          ? 'Cases sampled in clusters (schools, firms, countries): the estimates are the usual ones, the standard errors robust to the clustering (lavaan’s cluster = in a single-level model, sandwich estimator), and with MLR the χ² test is scaled too. Mplus’s TYPE = COMPLEX. To model the clusters themselves, use a two-level model instead.'
          : 'For cases sampled in clusters (schools, firms, countries) without modelling the levels: cluster-robust standard errors, as Mplus’s TYPE = COMPLEX.'}
      </div>
    </div>
  );
}
