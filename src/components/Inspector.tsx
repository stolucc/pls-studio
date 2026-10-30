import { useEffect, useState } from 'react';
import { ComputeSettings } from './ComputeSettings';
import { useCompute } from '../rengine/compute';
import { fmt, fmtP } from '../format';
import { endogenousIds, validateModel, type Construct, type Settings } from '../model/project';
import { useFreshResults, useStore } from '../store';
import { IconAlert, IconSwap, IconTrash, IconX, IconSide } from './icons';
import { switchMethod } from '../methodSwitch';
import { exportRScript } from '../io';
import { QuadraticCurve, SimpleSlopes } from './SimpleSlopes';
import { JohnsonNeymanPlot } from './JohnsonNeymanPlot';
import { johnsonNeyman } from '../engine/jn';
import { fixedText } from '../diagramLabels';
import { ConstraintsEditor } from './ConstraintsEditor';
import { ClustersEditor, EsemEditor, GroupsEditor, WeightsEditor } from './GroupsEditor';
import { processGraph } from '../process/fromModel';

function NameField({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const [v, setV] = useState(c.name);
  useEffect(() => setV(c.name), [c.name]);
  const commit = () => { const n = v.trim().slice(0, 100); if (n && n !== c.name) update(c.id, { name: n }); else setV(c.name); };
  return (
    <input className="input" value={v} maxLength={100} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(c.name); } }} />
  );
}

function ConstructInspector({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const removeIndicator = useStore((s) => s.removeIndicator);
  const del = useStore((s) => s.deleteItems);
  const method = useStore((s) => s.settings.method);
  const plsPackage = useStore((s) => s.settings.plsPackage);
  const constructs = useStore((s) => s.model.constructs);
  const results = useFreshResults();
  const pls = method === 'pls' ? results?.pls : null;
  const cb = method === 'cbsem' ? results?.cb : null;
  const j = pls ? pls.constructs.indexOf(c.name) : -1;
  const jc = cb ? cb.constructs.indexOf(c.name) : -1;
  const cbIdx = new Map(cb?.indicators.map((ind, k) => [ind.name, k]) ?? []);
  const q = j >= 0 ? pls!.quality[j] : null;
  const idx = new Map(pls?.indicators.map((ind, k) => [ind.name, k]) ?? []);

  return (
    <>
      <div className="section">
        <div className="field"><label>Name</label><NameField c={c} /></div>
        {method !== 'process' && <div className="field">
          <label>Construct type</label>
          <div className="segmented">
            <button className={c.type === 'factor' ? 'on' : ''} onClick={() => update(c.id, { type: 'factor', mode: 'A' })} title="Latent variable: indicators reflect the construct (ellipse)">Common factor</button>
            <button className={c.type === 'composite' ? 'on' : ''} disabled={method === 'cbsem'} onClick={() => update(c.id, { type: 'composite', mode: 'B' })}
              title={method === 'cbsem' ? 'Composites are estimated with PLS only. Switch to PLS-SEM to use them.' : 'Emergent variable: a weighted combination of its indicators (hexagon)'}>Composite</button>
          </div>
        </div>}
        {method === 'pls' && (!c.components?.length || plsPackage === 'seminr') && (
          <div className="field">
            <label>Weighting (PLS)</label>
            <div className="segmented">
              <button className={c.mode === 'A' ? 'on' : ''} onClick={() => update(c.id, { mode: 'A' })}>Mode A (correlation)</button>
              <button className={c.mode === 'B' ? 'on' : ''} onClick={() => update(c.id, { mode: 'B' })}>Mode B (regression)</button>
              <button className={c.mode === 'unit' ? 'on' : ''} onClick={() => update(c.id, { mode: 'unit' })} title="Equal weights on the standardised indicators (unit weights)">Sum scores</button>
            </div>
          </div>
        )}
        {method === 'pls' && c.indicators.length >= 2 && (
          <div className="field">
            <label>Dominant indicator</label>
            <select className="select" value={c.dominant ?? ''} onChange={(e) => update(c.id, { dominant: e.target.value || undefined })}>
              <option value="">None (sign as estimated)</option>
              {c.indicators.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <div className="hint" style={{ marginTop: 4 }}>Fixes the construct’s sign: its scores point the way this indicator does (loading positive), in the estimate and every bootstrap draw. cSEM and the built-in engine.</div>
          </div>
        )}
        <div className="field">
          <label>Indicator side</label>
          <div className="segmented">
            {(['left', 'top', 'right', 'bottom'] as const).map((s) => (
              <button key={s} className={c.side === s ? 'on' : ''} onClick={() => update(c.id, { side: s })} title={`Indicators on the ${s}`} aria-label={`Indicators on the ${s}`} aria-pressed={c.side === s}><IconSide side={s} size={20} /></button>
            ))}
          </div>
        </div>
      </div>
      {method === 'process' && (
        <div className="section">
          <div className="section-title">Conditional process analysis</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            {c.indicators.length === 0 ? 'Drop a data column on this variable, or several items of a scale.'
              : c.indicators.length === 1 ? `Observed variable ${c.indicators[0]}.`
                : c.latent ? `Latent variable measured by its ${c.indicators.length} items, corrected for measurement error.`
                  : `Scale score: the mean of its ${c.indicators.length} items (computed per case before the regressions).`}
          </div>
          {c.indicators.length === 1 && !c.covariate && (
            <div className="field">
              <label>Measurement level</label>
              <select className="select" value={c.categorical ?? ''} onChange={(e) => update(c.id, { categorical: (e.target.value || undefined) as Construct['categorical'] })}>
                <option value="">Continuous (or dichotomous)</option>
                <option value="indicator">Categorical X: indicator coding</option>
                <option value="sequential">Categorical X: sequential coding</option>
                <option value="helmert">Categorical X: Helmert coding</option>
                <option value="effect">Categorical X: effect coding</option>
              </select>
              {c.categorical && <div className="hint" style={{ marginTop: 6 }}>X with k groups becomes k − 1 codes; every effect of X is reported per code as a relative effect (Hayes &amp; Preacher, 2014), with the codes as PROCESS’s mcx option.</div>}
            </div>
          )}
          {c.indicators.length > 1 && !c.covariate && (
            <div className="field">
              <label>Scale</label>
              <div className="segmented">
                <button className={!c.latent ? 'on' : ''} onClick={() => update(c.id, { latent: false })} title="Mean of the items, then OLS regression (as PROCESS)">Mean score</button>
                <button className={c.latent ? 'on' : ''} onClick={() => update(c.id, { latent: true })}
                  title="Latent variable: structural-after-measurement estimation (lavaan::sam), free of the attenuation that measurement error causes in mean scores. Confidence intervals by Monte Carlo.">Latent variable</button>
              </div>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={!!c.covariate} onChange={(e) => update(c.id, { covariate: e.target.checked })} />
            <span><b>Covariate</b><br /><span className="hint">Enters every equation (mediators and outcome) as a control variable, as PROCESS’s cov option. A covariate has no paths of its own.</span></span>
          </label>
        </div>
      )}
      {method === 'cbsem' && (c.indicators.length === 1 || c.indicators.length === 0) && (
        <div className="section">
          <div className="section-title">CB-SEM</div>
          {c.indicators.length === 1 && (
            <label className="check">
              <input type="checkbox" checked={!!c.covariate} onChange={(e) => update(c.id, { covariate: e.target.checked })} />
              <span><b>Observed covariate</b><br /><span className="hint">Treat {c.indicators[0]} as an observed exogenous variable: its (co)variances are fixed at the sample values and it is not correlated with latent variables (lavaan’s fixed.x). Drawn as a rectangle.</span></span>
            </label>
          )}
          {c.indicators.length === 0 && (
            <>
              <div className="hint" style={{ marginBottom: 6 }}>Higher-order factor: measured by other constructs (the first is the marker).</div>
              {constructs.filter((k) => k.id !== c.id && !k.covariate).map((k) => (
                <label key={k.id} className="check" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={c.components?.includes(k.id) ?? false}
                    onChange={(e) => update(c.id, { components: e.target.checked ? [...(c.components ?? []), k.id] : (c.components ?? []).filter((x) => x !== k.id) })} />
                  {k.name}
                </label>
              ))}
            </>
          )}
        </div>
      )}
      {method === 'pls' && c.indicators.length === 0 && (
        <div className="section">
          <div className="section-title">Second-order construct</div>
          <div className="hint" style={{ marginBottom: 6 }}>
            Measured by first-order constructs (two-stage approach): their scores are its indicators in stage 2. {plsPackage === 'seminr'
              ? 'seminr weights it as chosen under Weighting.'
              : c.type === 'composite' ? 'cSEM weights a composite by Mode B.' : 'cSEM weights a common factor by Mode A and corrects it for attenuation.'} The components stay out of the structural model; connect this construct instead.
          </div>
          {constructs.filter((k) => k.id !== c.id && k.indicators.length > 0).map((k) => (
            <label key={k.id} className="check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={c.components?.includes(k.id) ?? false}
                onChange={(e) => update(c.id, { components: e.target.checked ? [...(c.components ?? []), k.id] : (c.components ?? []).filter((x) => x !== k.id) })} />
              {k.name}
            </label>
          ))}
        </div>
      )}
      <div className="section">
        <div className="section-title">{c.components?.length ? `Components (${c.components.length})` : `Indicators (${c.indicators.length})`}</div>
        {c.indicators.length === 0 && !c.components?.length && <div className="hint">Drag variables from the data panel onto this construct{method === 'cbsem' ? ', or tick components above to make it a higher-order factor' : method === 'pls' ? ', or tick components above to make it a second-order construct' : ''}.</div>}
        {c.components?.map((id) => <div key={id} className="ind"><span>{constructs.find((k) => k.id === id)?.name}</span></div>)}
        <div className="ind-list">
          {c.indicators.map((name) => {
            const k = idx.get(name);
            const kc = cbIdx.get(name);
            const v = kc !== undefined ? cb!.stdLoadings[kc]
              : k === undefined ? null : c.type === 'composite' ? pls!.weights[k] : pls!.loadings[k];
            return (
              <div className="ind" key={name}>
                <span className="vname">{name}</span>
                <span className="num muted" title={c.type === 'composite' && !cb ? 'Weight' : cb ? 'Standardised loading' : 'Loading'}>{v === null ? '' : fmt(v)}</span>
                <button className="btn icon ghost sm" style={{ width: 24, height: 24 }} onClick={() => removeIndicator(c.id, name)} aria-label={`Remove ${name}`}>
                  <IconX size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {cb && jc >= 0 && (
        <div className="section">
          <div className="section-title">Quality</div>
          <div className="kv">
            {cb.r2Constructs[jc] !== null && <><span>R²</span><span className="num">{fmt(cb.r2Constructs[jc])}</span></>}
            <span>Composite reliability</span><span className="num">{fmt(cb.reliability[jc].cr)}</span>
            <span>AVE</span><span className="num">{fmt(cb.reliability[jc].ave)}</span>
          </div>
        </div>
      )}
      {q && (
        <div className="section">
          <div className="section-title">Quality</div>
          <div className="kv">
            {j >= 0 && pls!.rSquared[j] !== null && <><span>R²</span><span className="num">{fmt(pls!.rSquared[j])}</span></>}
            {c.type === 'factor' && <>
              <span>Cronbach’s α</span><span className="num">{fmt(q.alpha)}</span>
              <span>ρA</span><span className="num">{fmt(q.rhoA)}</span>
              <span>Composite reliability ρC</span><span className="num">{fmt(q.rhoC)}</span>
              <span>AVE</span><span className="num">{fmt(q.ave)}</span>
            </>}
          </div>
        </div>
      )}
      <div className="section">
        <button className="btn danger" onClick={() => del([c.id], [])}><IconTrash size={14} /> Delete construct</button>
      </div>
    </>
  );
}

/** Interaction estimate (from the stage-2 PLS model) for one moderation, if results exist. */
function useModerationEstimate(fromName: string, modName: string, toName: string) {
  const results = useFreshResults();
  const method = useStore((s) => s.settings.method);
  const pls = method === 'pls' ? results?.pls : null;
  if (!pls) return null;
  const mo = pls.moderations.find((x) => x.from === fromName && x.moderator === modName && x.to === toName);
  if (!mo) return null;
  const C = pls.constructs;
  const j = C.indexOf(toName);
  const name = C[mo.construct];
  return {
    bint: pls.pathCoef[mo.construct][j],
    bx: pls.pathCoef[C.indexOf(fromName)][j],
    bm: pls.pathCoef[C.indexOf(modName)][j],
    f2: pls.fSquare[mo.construct][j],
    boot: results?.boot?.stats.find((s) => s.key === `path:${name}:${toName}`),
    confidence: results?.boot?.confidence,
  };
}

/** A moderated moderation (conditional process analysis): Z moderating W's moderation of X → Y. */
function ThreeWayInspector({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const del = useStore((s) => s.deleteItems);
  const results = useFreshResults();
  const t = model.threeWay?.find((x) => x.id === id);
  const mo = t && model.moderations.find((x) => x.id === t.moderation);
  const p = mo && model.paths.find((q) => q.id === mo.path);
  if (!t || !mo || !p) return null;
  const nameOf = (cid: string) => model.constructs.find((c) => c.id === cid)?.name ?? '?';
  const [x, w, z, y] = [nameOf(p.from), nameOf(mo.moderator), nameOf(t.moderator), nameOf(p.to)];
  const key = [x, w, z].sort().join('*');
  const est = results?.process?.equations.find((e) => e.outcome === y)?.coefficients.find((k) => [...k.term].sort().join('*') === key);
  return (
    <>
      <div className="section">
        <div className="path-title">{z} <span className="muted">moderates the moderation by</span> {w}</div>
        <div className="hint" style={{ marginTop: 4 }}>
          Three-way interaction {x} × {w} × {z} in the equation of {y}: how strongly {w} moderates {x} → {y} depends on {z}.
          The lower-order terms ({w}, {z}, {x} × {w}, {x} × {z}, {w} × {z}) are included automatically.
        </div>
      </div>
      {est && (
        <div className="section">
          <div className="section-title">OLS estimate</div>
          <div className="kv">
            <span>{x} × {w} × {z}</span><span className="num">{fmt(est.est)}</span>
            <span>Std. error</span><span className="num">{fmt(est.se)}</span>
            <span>p value</span><span className="num">{fmtP(est.p)}</span>
          </div>
        </div>
      )}
      <div className="section">
        <button className="btn danger" onClick={() => del([], [], [t.id])}><IconTrash size={14} /> Remove moderated moderation</button>
      </div>
    </>
  );
}

function ModerationInspector({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const del = useStore((s) => s.deleteItems);
  const mo = model.moderations.find((x) => x.id === id);
  const p = mo && model.paths.find((q) => q.id === mo.path);
  const nameOf = (cid: string) => model.constructs.find((c) => c.id === cid)?.name ?? '?';
  const fromName = p ? nameOf(p.from) : '', toName = p ? nameOf(p.to) : '', modName = mo ? nameOf(mo.moderator) : '';
  const est = useModerationEstimate(fromName, modName, toName);
  const results = useFreshResults();
  const method = useStore((s) => s.settings.method);
  const cb = method === 'cbsem' ? results?.cb : null;
  const cbMo = cb?.moderations.find((x) => x.from === fromName && x.moderator === modName && x.to === toName);
  let jn: ReturnType<typeof johnsonNeyman> | null = null;
  try { jn = cb && cbMo ? johnsonNeyman(cb, cbMo) : null; } catch { jn = null; }
  if (!mo || !p) return null;
  const quadratic = mo.moderator === p.from;
  const term = quadratic ? `${fromName}²` : `${fromName} × ${modName}`;
  return (
    <>
      <div className="section">
        {quadratic
          ? <div className="path-title">Quadratic effect <span className="muted">of</span> {fromName}</div>
          : <div className="path-title">{modName} <span className="muted">moderates</span></div>}
        <div className="hint" style={{ marginTop: 4 }}>{quadratic ? `${term} → ${toName}: the effect of ${fromName} changes with its own level.` : `${fromName} → ${toName}`}</div>
      </div>
      {jn && (
        <div className="section">
          <div className="section-title">{quadratic ? 'Latent quadratic effect (CB-SEM)' : 'Latent interaction (CB-SEM)'}</div>
          <div className="kv">
            <span>γ {term}</span><span className="num">{fmt(jn.bint)}</span>
            <span>J–N boundaries</span><span className="num">{jn.boundaries.length ? jn.boundaries.map((b) => `${(b / jn!.sdM).toFixed(2)} SD`).join(', ') : 'none'}</span>
          </div>
          <div style={{ marginTop: 12 }}><JohnsonNeymanPlot jn={jn} from={fromName} moderator={modName} to={toName} width={260} height={180} /></div>
        </div>
      )}
      {jn ? null : est ? (
        <div className="section">
          <div className="section-title">{quadratic ? 'Quadratic effect' : 'Interaction effect'}</div>
          <div className="kv">
            <span>{term}</span><span className="num">{fmt(est.bint)}</span>
            <span>f² effect size</span><span className="num">{fmt(est.f2)}</span>
            {est.boot && <><span>p value</span><span className="num">{fmtP(est.boot.p)}</span></>}
            {est.boot && <><span>{Math.round((est.confidence ?? 0.95) * 100)}% CI</span><span className="num">[{fmt(est.boot.ciLow)}, {fmt(est.boot.ciHigh)}]</span></>}
          </div>
          {!est.boot && <div className="hint" style={{ marginTop: 8 }}>Run bootstrapping to test the {quadratic ? 'quadratic effect' : 'interaction'}.</div>}
          <div style={{ marginTop: 12 }}>
            {quadratic
              ? <QuadraticCurve b={est.bx} bq={est.bint} from={fromName} to={toName} />
              : <SimpleSlopes bx={est.bx} bm={est.bm} bint={est.bint} from={fromName} moderator={modName} to={toName} />}
          </div>
        </div>
      ) : (
        <div className="section hint">{quadratic
          ? <>The squared standardised score of {fromName} predicts {toName} (two-stage approach; in CB-SEM, squared mean-centred indicators). Calculate to see the curve.</>
          : <>Two-stage approach: the product of the standardised scores of {fromName} and {modName} predicts {toName}. Calculate to see the interaction effect and simple slopes.</>}</div>
      )}
      <div className="section">
        <button className="btn danger" onClick={() => del([], [], [mo.id])}><IconTrash size={14} /> {quadratic ? 'Remove quadratic effect' : 'Remove moderation'}</button>
      </div>
    </>
  );
}

function CorrelationInspector({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const del = useStore((s) => s.deleteItems);
  const settings = useStore((s) => s.settings);
  const results = useFreshResults();
  const k = model.correlations?.find((x) => x.id === id);
  if (!k) return null;
  const nameOf = (x: string) => (k.kind === 'construct' ? model.constructs.find((c) => c.id === x)?.name ?? '?' : x);
  const a = nameOf(k.a), b = nameOf(k.b);
  const endo = endogenousIds(model);
  const disturbances = k.kind === 'construct' && endo.has(k.a) && endo.has(k.b);
  const what = k.kind === 'indicator' ? 'Correlated measurement errors (ε)' : disturbances ? 'Correlated disturbances (ζ): what both constructs share beyond their predictors' : 'Covariance of exogenous constructs';
  const est = settings.method === 'cbsem' && settings.estimator !== '2SLS'
    ? results?.cb?.estimates.find((e) => e.op === '~~' && e.lhs !== e.rhs && ((e.lhs === a && e.rhs === b) || (e.lhs === b && e.rhs === a))
      && (k.kind === 'indicator' ? e.kind === 'rescov' : e.kind !== 'rescov'))
    : undefined;
  return (
    <>
      <div className="section">
        <div className="path-title">{disturbances ? <>ζ {a} <span className="muted">↔</span> ζ {b}</> : k.kind === 'indicator' ? <>ε {a} <span className="muted">↔</span> ε {b}</> : <>{a} <span className="muted">↔</span> {b}</>}</div>
        <div className="hint" style={{ marginTop: 4 }}>{what}</div>
      </div>
      {est ? (
        <div className="section">
          <div className="section-title">Estimates</div>
          <div className="kv">
            <span>Covariance</span><span className="num">{fmt(est.est)}</span>
            <span>Std. error</span><span className="num">{fmt(est.se)}</span>
            <span>z</span><span className="num">{fmt(est.z)}</span>
            <span>p value</span><span className="num">{est.p === null ? '—' : fmtP(est.p)}</span>
            <span>Correlation</span><span className="num">{fmt(est.std)}</span>
          </div>
        </div>
      ) : (
        <div className="section hint">
          {settings.method === 'pls' ? 'Correlations are estimated in CB-SEM only; PLS-SEM ignores them.'
            : settings.estimator === '2SLS' ? 'MIIV-2SLS drops the instruments that correlated errors make invalid; the covariance itself is estimated afterwards, with the 2SLS coefficients held fixed.'
              : k.kind === 'indicator' ? 'Frees the covariance of the two measurement errors (lavaan: a ~~ b). Calculate to estimate it.'
                : disturbances ? 'Frees the covariance of the two disturbances: what both constructs share beyond their predictors. Calculate to estimate it.'
                  : 'Exogenous constructs covary freely in CB-SEM anyway; this arrow makes that visible.'}
        </div>
      )}
      <div className="section">
        <button className="btn danger" onClick={() => del([], [], [], [k.id])}><IconTrash size={14} /> Remove correlation</button>
      </div>
    </>
  );
}

function PathInspector({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const reverse = useStore((s) => s.reversePath);
  const del = useStore((s) => s.deleteItems);
  const addModeration = useStore((s) => s.addModeration);
  const addQuadratic = useStore((s) => s.addQuadratic);
  const fixParameter = useStore((s) => s.fixParameter);
  const results = useFreshResults();
  const method = useStore((s) => s.settings.method);
  const p = model.paths.find((q) => q.id === id);
  if (!p) return null;
  const from = model.constructs.find((c) => c.id === p.from)!, to = model.constructs.find((c) => c.id === p.to)!;
  const pls = method === 'pls' ? results?.pls : null;
  const cbEst = method === 'cbsem' ? results?.cb?.estimates.find((e) => e.op === '~' && e.lhs === to.name && e.rhs === from.name) : undefined;
  const procEst = method === 'process' ? results?.process?.equations.find((e) => e.outcome === to.name)?.coefficients.find((k) => k.term.length === 1 && k.term[0] === from.name) : undefined;
  const i = pls?.constructs.indexOf(from.name) ?? -1, j = pls?.constructs.indexOf(to.name) ?? -1;
  const b = results?.boot?.stats.find((s) => s.key === `path:${from.name}:${to.name}`);
  return (
    <>
      <div className="section">
        <div className="path-title">{from.name} <span className="muted">→</span> {to.name}</div>
      </div>
      {pls && i >= 0 && j >= 0 && (
        <div className="section">
          <div className="section-title">Estimates</div>
          <div className="kv">
            <span>Path coefficient β</span><span className="num">{fmt(pls.pathCoef[i][j])}</span>
            <span>f² effect size</span><span className="num">{fmt(pls.fSquare[i][j])}</span>
            <span>VIF</span><span className="num">{fmt(pls.vifInner[i][j])}</span>
            {b && <><span>Std. error</span><span className="num">{fmt(b.sd)}</span></>}
            {b && <><span>t statistic</span><span className="num">{fmt(b.t)}</span></>}
            {b && <><span>p value</span><span className="num">{fmtP(b.p)}</span></>}
            {b && <><span>{Math.round(results!.boot!.confidence * 100)}% CI</span><span className="num">[{fmt(b.ciLow)}, {fmt(b.ciHigh)}]</span></>}
          </div>
          {!b && <div className="hint" style={{ marginTop: 8 }}>Run bootstrapping for significance tests.</div>}
        </div>
      )}
      {cbEst && (
        <div className="section">
          <div className="section-title">ML estimates</div>
          <div className="kv">
            <span>Unstandardised</span><span className="num">{fmt(cbEst.est)}</span>
            <span>Std. error</span><span className="num">{fmt(cbEst.se)}</span>
            <span>z</span><span className="num">{fmt(cbEst.z)}</span>
            <span>p value</span><span className="num">{cbEst.p === null ? '—' : fmtP(cbEst.p)}</span>
            <span>Standardised β</span><span className="num">{fmt(cbEst.std)}</span>
          </div>
        </div>
      )}
      {method === 'cbsem' && (
        <div className="section">
          <div className="section-title">Coefficient</div>
          {p.fixed !== undefined ? (
            <div className="ind"><span>Fixed at {fixedText(p.fixed)} (not estimated)</span><span />
              <button className="btn sm ghost always" onClick={() => fixParameter({ kind: 'path', id: p.id }, null)}>Free</button></div>
          ) : <div className="hint">Estimated. Right-click the arrow to fix it at a value (lavaan: value*{from.name}).</div>}
        </div>
      )}
      {procEst && (
        <div className="section">
          <div className="section-title">OLS estimate</div>
          <div className="kv">
            <span>Coefficient</span><span className="num">{fmt(procEst.est)}</span>
            <span>Std. error</span><span className="num">{fmt(procEst.se)}</span>
            <span>t</span><span className="num">{fmt(procEst.t)}</span>
            <span>p value</span><span className="num">{fmtP(procEst.p)}</span>
          </div>
          {model.moderations.some((mo) => mo.path === p.id) && <div className="hint" style={{ marginTop: 8 }}>The effect of {from.name} where its moderators are 0; see the results’ conditional effects.</div>}
        </div>
      )}
      <div className="section">
        <div className="section-title">Moderators</div>
        {model.moderations.filter((mo) => mo.path === p.id).map((mo) => (
          <div className="ind" key={mo.id}>
            <span>{mo.moderator === p.from ? `${from.name}² (quadratic)` : model.constructs.find((c) => c.id === mo.moderator)?.name}</span>
            <span />
            <button className="btn icon ghost sm" style={{ width: 24, height: 24 }} onClick={() => del([], [], [mo.id])} aria-label="Remove moderator"><IconX size={13} /></button>
          </div>
        ))}
        <select className="select" value="" onChange={(e) => e.target.value && addModeration(e.target.value, p.id)} style={{ marginTop: 6 }}>
          <option value="">Add a moderator…</option>
          {model.constructs.filter((c) => c.id !== p.from && c.id !== p.to && !model.moderations.some((mo) => mo.path === p.id && mo.moderator === c.id))
            .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="hint" style={{ marginTop: 6 }}>Or drag from a construct’s dot onto this arrow.</div>
        {method === 'process' && model.moderations.some((mo) => mo.path === p.id) && (
          <div className="hint" style={{ marginTop: 6 }}>For a moderated moderation (three-way interaction), drag from a third variable onto a moderator’s arrow.</div>
        )}
        {method !== 'process' && !model.moderations.some((mo) => mo.path === p.id && mo.moderator === p.from) && (
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => addQuadratic(p.id)}
            title={`Adds ${from.name}² as a predictor of ${to.name}: a curvilinear (U-shaped or inverted-U) effect`}>
            Add quadratic effect ({from.name}²)
          </button>
        )}
      </div>
      <div className="section" style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => reverse(p.id)}><IconSwap size={14} /> Reverse</button>
        <button className="btn danger" onClick={() => del([], [p.id])}><IconTrash size={14} /> Delete</button>
      </div>
    </>
  );
}

const ESTIMATORS: { id: Settings['estimator']; label: string; hint: string }[] = [
  { id: 'ML', label: 'maximum likelihood', hint: 'Normal-theory ML with expected-information standard errors.' },
  { id: 'MLM', label: 'robust, Satorra–Bentler', hint: 'ML estimates, robust (sandwich) standard errors and the Satorra–Bentler scaled χ². For non-normal continuous data.' },
  { id: 'MLMV', label: 'robust, mean- and variance-adjusted', hint: 'ML estimates, robust standard errors and a scaled-and-shifted χ²; better small-sample behaviour than MLM.' },
  { id: 'MLR', label: 'robust, Huber–White / Yuan–Bentler', hint: 'ML estimates, observed-information sandwich standard errors and the Yuan–Bentler scaled χ² (Mplus variant).' },
  { id: 'GLS', label: 'generalised least squares', hint: 'Weights residuals by S⁻¹. Uses the unbiased covariance matrix.' },
  { id: 'WLSMV', label: 'robust weighted least squares (ordinal)', hint: 'Diagonally weighted least squares on polychoric correlations, with robust standard errors and a mean- and variance-adjusted χ² (Muthén; lavaan). The estimator for ordinal indicators (mark them with right-click → Treat as ordinal). Needs the R engine.' },
  { id: 'RML', label: 'robust ML, case-weighted (rsem)', hint: 'Yuan & Zhang’s robust ML: atypical cases are down-weighted (Huber-type weights) in the means and covariances, which are estimated by EM using every case with missing values; the model is fitted to them by ML with robust standard errors and the rescaled χ² (TRML). For outliers and heavy tails. One group of continuous indicators; needs the R engine.' },
  { id: 'ULS', label: 'unweighted least squares', hint: 'Unweighted residuals; no χ² p-value. Standard errors are not robust: prefer bootstrapping.' },
  { id: '2SLS', label: 'MIIV two-stage least squares', hint: 'Bollen’s model-implied instrumental variables: each equation estimated separately by 2SLS, robust to misspecification in other equations, with a Sargan test per equation. Variances and covariances are estimated afterwards with the coefficients held fixed (as MIIVsem’s var.cov), which gives standardised values; there is no global fit test.' },
];

function ModelInspector() {
  const model = useStore((s) => s.model);
  const deleteItems = useStore((s) => s.deleteItems);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  // Where the R packages run: the browser's R (webR) or desktop R through the helper.
  const where = useCompute((s) => s.backend) === 'helper' ? 'in desktop R (through the helper)' : 'in your browser (webR)';
  const setSettings = useStore((s) => s.setSettings);
  const select = useStore((s) => s.select);
  const issues = validateModel(model, data, settings);
  const readOnlyChecks = useStore((s) => s.cloud?.role === 'viewer');
  const pls = settings.method === 'pls';
  const proc = settings.method === 'process';
  const numField = (label: string, key: keyof Settings, min: number, max: number, step = 1) => (
    <div className="field">
      <label>{label}</label>
      <input className="input num" type="number" min={min} max={max} step={step} value={settings[key] as number}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) setSettings({ [key]: Math.min(max, Math.max(min, v)) } as Partial<Settings>);
        }} />
    </div>
  );

  return (
    <>
      <div className="section">
        <div className="section-title">Checks</div>
        {issues.length === 0
          ? <div className="hint">No problems found. Ready to calculate.</div>
          : issues.map((iss, k) => (
            <div key={k} className={`issue ${iss.level}${iss.constructId ? ' clickable' : ''}`}
              onClick={() => iss.constructId && select('construct', iss.constructId)}>
              <IconAlert size={14} /> <span>{iss.message}</span>
              {iss.action === 'exogenous-correlations' && !readOnlyChecks && (
                <span className="issue-actions">
                  <button className="btn sm" onClick={(e) => { e.stopPropagation(); useStore.getState().resolveExogenousCorrelations(true); }}>Correlate them</button>
                  <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); useStore.getState().resolveExogenousCorrelations(false); }}>Keep uncorrelated</button>
                </span>
              )}
            </div>
          ))}
      </div>
      {settings.method === 'cbsem' && <EsemEditor />}
      {settings.method === 'cbsem' && <GroupsEditor />}
      {settings.method === 'cbsem' && <ClustersEditor />}
      {settings.method === 'cbsem' && <WeightsEditor />}
      {settings.method === 'cbsem' && <ConstraintsEditor />}
      {settings.method === 'cbsem' && model.correlations?.some((k) => k.zero) && (
        <div className="section">
          <div className="section-title">Covariances fixed at zero</div>
          <div className="hint" style={{ marginBottom: 6 }}>Not drawn: in a path diagram, no arrow means zero. Exogenous constructs otherwise covary freely.</div>
          {model.correlations.filter((k) => k.zero).map((k) => {
            const nm = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
            return (
              <div className="ind" key={k.id}>
                <span>{nm(k.a)} ↔ {nm(k.b)}</span><span />
                <button className="btn sm ghost always" onClick={() => deleteItems([], [], [], [k.id])} title="Let them covary freely again">Free</button>
              </div>
            );
          })}
        </div>
      )}
      <div className="section">
        <div className="section-title">Method</div>
        <div className="segmented">
          <button className={pls ? 'on' : ''} onClick={() => void switchMethod('pls')}>PLS-SEM</button>
          <button className={settings.method === 'cbsem' ? 'on' : ''} onClick={() => void switchMethod('cbsem')}>CB-SEM</button>
          <button className={proc ? 'on' : ''} onClick={() => void switchMethod('process')}>CPA</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {pls
            ? 'Variance-based: common factors and composites. Turn on PLSc for consistent estimates of common-factor models.'
            : proc
              ? 'Conditional process analysis (Hayes): mediation, moderation and moderated mediation with observed variables or scale means, one OLS regression per outcome, bootstrap confidence intervals for indirect effects.'
              : 'Covariance-based SEM. Common factors only; first loading of each factor fixed to 1.'}
        </div>
      </div>
      {proc && (
        <div className="section">
          <div className="section-title">Calculated by</div>
          <div className="hint">
            manymome (Cheung &amp; Cheung, 2024), running {where}: OLS regressions (lm), the percentile bootstrap of indirect effects and conditional effects at moderator values.
            Every numbered model was checked against PROCESS for R on the same data. Your data never leave this computer.
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void exportRScript()}
            title="Download the R script for this analysis (data embedded): exactly what runs here. Open it in R or RStudio to reproduce the results.">
            Export R script
          </button>
        </div>
      )}
      {!proc && <div className="section">
        <div className="section-title">Calculated by</div>
        <div className="segmented" role="radiogroup" aria-label="Calculation engine">
          <button role="radio" aria-checked={settings.engine === 'r'} className={settings.engine === 'r' ? 'on' : ''} onClick={() => setSettings({ engine: 'r' })}>R packages</button>
          <button role="radio" aria-checked={settings.engine === 'builtin'} className={settings.engine === 'builtin' ? 'on' : ''} onClick={() => setSettings({ engine: 'builtin' })}>Built-in</button>
        </div>
        {settings.engine === 'r' && pls && (
          <div className="segmented" role="radiogroup" aria-label="PLS package" style={{ marginTop: 8 }}>
            {(['cSEM', 'seminr'] as const).map((p) => (
              <button key={p} role="radio" aria-checked={settings.plsPackage === p} className={settings.plsPackage === p ? 'on' : ''} onClick={() => setSettings({ plsPackage: p })}>{p}</button>
            ))}
          </div>
        )}
        {settings.engine === 'r' && pls && settings.plsPackage === 'cSEM' && (
          <div className="segmented" role="radiogroup" aria-label="Weighting approach" style={{ marginTop: 8 }}>
            {([['PLS-PM', 'PLS-PM', 'Partial least squares path modeling'],
              ['GSCA', 'GSCA', 'Generalized structured component analysis (Hwang & Takane 2004): weights from one global least-squares criterion; with PLSc on, GSCAm for common factors'],
              ['PCA', 'PCA', 'Principal component analysis: each construct is the first principal component of its indicators'],
              ['unit', 'Sum scores', 'Sum-score regression: each construct is the (standardised) sum of its indicators, then regressions among them']] as const).map(([id, l, tip]) => (
              <button key={id} role="radio" aria-checked={settings.plsApproach === id} className={settings.plsApproach === id ? 'on' : ''} onClick={() => setSettings({ plsApproach: id })} title={tip}>{l}</button>
            ))}
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          {settings.engine === 'builtin'
            ? 'PLS Studio’s own implementation, validated against the R packages. Instant, no download.'
            : pls
              ? settings.plsPackage === 'cSEM'
                ? `cSEM (Rademaker & Schuberth), running ${where}: PLS, PLSc, composites, bootstrapping, the model fit test and IPMA. Interactions use cSEM’s products of construct scores.`
                : `seminr (Ray, Danks & Calero Valdez), running ${where}: PLS, PLSc for reflective constructs, two-stage interactions. No model-fit statistics; path and factor schemes only. ${where.startsWith('in desktop') ? 'seminr bootstraps on all cores.' : 'seminr’s bootstrap needs worker processes, so bootstrap with cSEM here (or export the script).'} The fit test and IPMA use cSEM.`
              : settings.estimator === '2SLS'
                ? `MIIVsem (Fisher, Bollen, Gates & Rönkkö), running ${where}.`
                : `lavaan (Rosseel), running ${where}, including bootstrapping (bootstrapLavaan).`}
          {settings.engine === 'r' && ' The first calculation loads the packages; your data never leave this computer. Monte Carlo simulation also runs in R (lavaan::simulateData, cSEM, lavaan).'}
        </div>
        {settings.engine === 'r' && <ComputeSettings />}
        <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void exportRScript()}
          title="Download the R script for this model (data embedded): exactly what the R engine runs. Open it in R or RStudio to reproduce the results.">
          Export R script
        </button>
      </div>}
      {settings.method === 'cbsem' && model.moderations.length > 0 && (
        <div className="section">
          <div className="section-title">Latent interactions</div>
          <div className="segmented">
            {([['product', 'Product indicators'], ['lms', 'LMS'], ['qml', 'QML']] as const).map(([id, label]) => (
              <button key={id} className={settings.interaction === id ? 'on' : ''} onClick={() => setSettings({ interaction: id })}>{label}</button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {settings.interaction === 'product'
              ? 'Products of mean-centred indicators (Marsh, Wen & Hau, 2004), estimated by lavaan with the usual fit statistics.'
              : settings.interaction === 'lms'
                ? 'Latent moderated structural equations (Klein & Moosbrugger, 2000; modsem): maximum likelihood for the latent product itself, without product indicators; usually the most efficient. Fit statistics are for the model without the interaction.'
                : 'Quasi-maximum likelihood (Klein & Muthén, 2007; modsem): close to LMS, more robust to non-normal indicators. Fit statistics are for the model without the interaction.'}
            {settings.interaction !== 'product' && ' Bootstrap: cases are resampled and the model refitted with modsem, which is slow (LMS: seconds per sample); try 200 samples first.'}
          </div>
        </div>
      )}
      {settings.method === 'cbsem' && (
        <div className="section">
          <div className="section-title">Estimator</div>
          <select className="select" value={settings.estimator} onChange={(e) => setSettings({ estimator: e.target.value as Settings['estimator'] })}>
            {ESTIMATORS.map((e) => <option key={e.id} value={e.id}>{e.id} — {e.label}</option>)}
          </select>
          <div className="hint" style={{ marginTop: 8 }}>{ESTIMATORS.find((e) => e.id === settings.estimator)?.hint}</div>
        </div>
      )}
      {pls && <div className="section">
        <div className="section-title">PLS algorithm</div>
        <label className="check">
          <input type="checkbox" checked={settings.consistent} onChange={(e) => setSettings({ consistent: e.target.checked })} />
          <span><b>Consistent PLS (PLSc)</b><br /><span className="hint">Corrects common factors for attenuation using ρA (Dijkstra &amp; Henseler, 2015).</span></span>
        </label>
        <div className="field">
          <label>Inner weighting scheme</label>
          <div className="segmented">
            {(['path', 'factor', 'centroid'] as const).map((s) => (
              <button key={s} className={settings.scheme === s ? 'on' : ''} onClick={() => setSettings({ scheme: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="row2">
          {numField('Max iterations', 'maxIter', 10, 10000)}
          {numField('Stop criterion 10^−x', 'stopExp', 3, 12)}
        </div>
      </div>}
      {proc && (
        <div className="section">
          <div className="field">
            <label>Probe moderators at</label>
            <div className="segmented">
              <button className={settings.probe === 'percentiles' ? 'on' : ''} onClick={() => setSettings({ probe: 'percentiles' })}>16th / 50th / 84th pct.</button>
              <button className={settings.probe === 'meansd' ? 'on' : ''} onClick={() => setSettings({ probe: 'meansd' })}>Mean ± 1 SD</button>
            </div>
          </div>
          <div className="hint">Percentiles are PROCESS’s default. A moderator with two values is probed at both. Missing values: listwise deletion, as PROCESS.</div>
          {processGraph(model).graph?.moderations.some((m) => m.by === processGraph(model).graph!.x) && (
            <div className="field" style={{ marginTop: 10 }}>
              <label>Counterfactual effects: X from … to …</label>
              <div className="row2">
                {(['xref', 'xcf'] as const).map((k) => (
                  <input key={k} className="input num" type="number" step="any" placeholder={k === 'xref' ? 'reference (auto)' : 'counterfactual (auto)'}
                    value={settings.counterfactual?.[k] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      const cur = settings.counterfactual;
                      if (v === null || !Number.isFinite(v)) setSettings({ counterfactual: null });
                      else setSettings({ counterfactual: { xref: k === 'xref' ? v : cur?.xref ?? 0, xcf: k === 'xcf' ? v : cur?.xcf ?? 1 } });
                    }} />
                ))}
              </div>
              <div className="hint">X moderates its own M → Y paths: direct and indirect effects compare these two values of X. Empty: a binary X’s two values, otherwise its mean and one SD above.</div>
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label>Standard errors of the regressions</label>
            <select className="select" value={settings.hc} onChange={(e) => setSettings({ hc: e.target.value as Settings['hc'] })}>
              <option value="none">OLS (assumes constant error variance)</option>
              <option value="HC0">HC0 (White)</option>
              <option value="HC1">HC1</option>
              <option value="HC2">HC2</option>
              <option value="HC3">HC3 (recommended; Long &amp; Ervin, 2000)</option>
              <option value="HC4">HC4 (Cribari-Neto)</option>
            </select>
          </div>
          <div className="hint">Heteroskedasticity-consistent standard errors (PROCESS’s hc option) for coefficients, conditional effects, F tests and Johnson–Neyman; bootstrap intervals of indirect effects do not use them. Latent-variable models use SAM’s standard errors instead.</div>
        </div>
      )}
      {!proc && <div className="section">
        <div className="field">
          <label>Missing values</label>
          <div className="segmented">
            <button className={settings.missing === 'mean' ? 'on' : ''} onClick={() => setSettings({ missing: 'mean' })}>Mean replacement</button>
            <button className={settings.missing === 'casewise' ? 'on' : ''} onClick={() => setSettings({ missing: 'casewise' })}>Casewise deletion</button>
            {settings.method === 'cbsem' && (
              <button className={settings.missing === 'fiml' ? 'on' : ''} onClick={() => setSettings({ missing: 'fiml' })}
                title="Full-information maximum likelihood (lavaan missing = &quot;ml&quot;): uses every observed value, unbiased when data are missing at random. ML or MLR, R engine.">FIML</button>
            )}
            <button className={settings.missing === 'mi' ? 'on' : ''} onClick={() => setSettings({ missing: 'mi' })}
              title="Multiple imputation by chained equations (mice), the model in every imputed data set, pooled by Rubin’s rules. R engine.">Multiple imputation</button>
          </div>
          {settings.method === 'cbsem' && settings.missing === 'fiml' && <div className="hint" style={{ marginTop: 6 }}>Full-information maximum likelihood uses all observed values of every case (missing at random); with MLR the standard errors and test are robust.</div>}
          {settings.missing === 'mi' && (
            <div className="field" style={{ marginTop: 8 }}>
              <label>Imputed data sets</label>
              <input className="input num" type="number" min={2} max={200} value={settings.miImputations}
                onChange={(e) => setSettings({ miImputations: Math.max(2, Math.min(200, Math.round(Number(e.target.value)) || 20)) })} />
              <div className="hint" style={{ marginTop: 6 }}>
                mice imputes the missing values {settings.miImputations} times (predictive mean matching, missing at random; seed as for bootstrapping); {settings.method === 'cbsem'
                  ? 'the model is estimated in every imputed data set and pooled by Rubin’s rules (lavaan.mi), with pooled standard errors, tests and fit.'
                  : 'the model is estimated in every imputed data set and the estimates are averaged; bootstrapping pools the bootstrap standard errors by Rubin’s rules.'}
              </div>
            </div>
          )}
        </div>
      </div>}
      <div className="section">
        <div className="section-title">Bootstrapping</div>
        <div className="row2">
          {numField('Subsamples', 'bootSamples', 10, 100000, 100)}
          {numField('Random seed', 'seed', 0, 2 ** 31)}
        </div>
        <div className="field">
          <label>Confidence interval</label>
          <div className="segmented">
            {[0.9, 0.95, 0.99].map((c) => (
              <button key={c} className={settings.confidence === c ? 'on' : ''} onClick={() => setSettings({ confidence: c })}>{c * 100}%</button>
            ))}
          </div>
        </div>
        <div className="hint">
          Percentile intervals; p-values from two-tailed t tests.
          {pls ? ' The same subsample count is used for the fit test (HI95/HI99).' : proc ? ' Indirect effects and indices of moderated mediation; direct and conditional effects use OLS standard errors, as PROCESS. At least 100 samples (5000 recommended for reporting).' : ' CB-SEM bootstraps standardised paths and indirect effects.'}
        </div>
      </div>
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const constructs = useStore((s) => s.model.constructs);
  const model = useStore((s) => s.model);
  const single = selection.nodes.length + selection.edges.length === 1;
  const c = single && selection.nodes.length === 1 ? constructs.find((k) => k.id === selection.nodes[0]) : undefined;
  const pathId = single && selection.edges.length === 1 ? selection.edges[0] : undefined;
  const modId = selection.moderations?.length === 1 && !c && !pathId ? selection.moderations[0] : undefined;
  const corId = selection.correlations?.length === 1 && !c && !pathId && !modId ? selection.correlations[0] : undefined;
  const title = c ? 'Construct' : pathId ? 'Path' : modId ? 'Moderation' : corId ? 'Correlation' : selection.nodes.length + selection.edges.length > 1 ? 'Selection' : 'Model';
  return (
    <aside className="panel right" aria-label="Inspector">
      <div className="panel-head"><span>{title}</span></div>
      <div className="panel-body">
        {c ? <ConstructInspector key={c.id} c={c} />
          : pathId ? <PathInspector id={pathId} />
          : modId ? (model.threeWay?.some((t) => t.id === modId) ? <ThreeWayInspector id={modId} /> : <ModerationInspector id={modId} />)
          : corId ? <CorrelationInspector id={corId} />
            : title === 'Selection' ? <div className="hint">{selection.nodes.length} construct(s), {selection.edges.length} path(s) selected. Press Delete to remove them.</div>
              : <ModelInspector />}
      </div>
    </aside>
  );
}
