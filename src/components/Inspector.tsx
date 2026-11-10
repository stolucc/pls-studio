import { useCompute } from '../rengine/compute';
import { fmt, fmtP } from '../format';
import { endogenousIds, INTERACTION_METHOD_NAMES, type Construct, type InteractionMethod } from '../model/project';
import { useFreshResults, useStore } from '../store';
import { IconSwap, IconTrash, IconX } from './icons';
import { QuadraticCurve, SimpleSlopes } from './SimpleSlopes';
import { JohnsonNeymanPlot } from './JohnsonNeymanPlot';
import { johnsonNeyman } from '../engine/jn';
import { fixedText } from '../diagramLabels';
import { ConstraintsEditor } from './ConstraintsEditor';
import { ClustersEditor, EsemEditor, GroupsEditor, SamplingClustersEditor, WeightsEditor } from './GroupsEditor';
import { CbsemMeasurementSection, ConstructBasics, ConstructQuality, IndicatorsSection, ProcessVariableSection, SecondOrderSection } from './inspector/ConstructSections';
import { Bootstrapping, EngineChoice, EstimatorOptions, HocApproach, LatentInteractions, MethodChoice, MissingValues, ModelChecks, PlsAlgorithm, ProcessEngine, ProcessOptions, ZeroCovariances } from './inspector/ModelSections';

function ConstructInspector({ c }: { c: Construct }) {
  const del = useStore((s) => s.deleteItems);
  const method = useStore((s) => s.settings.method);
  return (
    <>
      <ConstructBasics c={c} />
      {method === 'process' && <ProcessVariableSection c={c} />}
      {method === 'cbsem' && (c.indicators.length === 1 || c.indicators.length === 0) && <CbsemMeasurementSection c={c} />}
      {method === 'pls' && c.indicators.length === 0 && <SecondOrderSection c={c} />}
      <IndicatorsSection c={c} />
      <ConstructQuality c={c} />
      <div className="section">
        <Appearance c={c} />
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
  const setMethod = useStore((s) => s.setModerationMethod);
  const plsPackage = useStore((s) => s.settings.engine === 'r' ? s.settings.plsPackage : null);
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
      {method === 'pls' && !quadratic && (
        <div className="section">
          <div className="section-title">Interaction term</div>
          <div className="segmented" role="radiogroup" aria-label="Interaction term">
            {([['two_stage', 'Two-stage'], ['orthogonal', 'Orthogonalising'], ['product_indicator', 'Product indicators']] as const).map(([mid, l]) => (
              <button key={mid} role="radio" aria-checked={(mo.method ?? 'two_stage') === mid} className={(mo.method ?? 'two_stage') === mid ? 'on' : ''}
                onClick={() => setMethod(mo.id, mid === 'two_stage' ? undefined : (mid as InteractionMethod))}>{l}</button>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {!mo.method
              ? 'The product of the standardised construct scores of the first stage (Chin, Marcolin & Newsted 2003; the default of seminr and cSEM).'
              : mo.method === 'orthogonal'
                ? 'Products of the indicators, residualised on the main-effect indicators so the term is uncorrelated with them (Little, Bovaird & Widaman 2006; seminr’s interaction_term(method = orthogonal)).'
                : 'Every product of a predictor indicator and a moderator indicator as the term’s own indicators (Chin, Marcolin & Newsted 2003; seminr’s interaction_term(method = product_indicator)).'}
            {mo.method && plsPackage !== 'seminr' && <> <b>seminr only</b>: choose seminr under R packages ({INTERACTION_METHOD_NAMES[mo.method]} is not available in cSEM).</>}
          </div>
        </div>
      )}
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

/** How a construct is drawn: another shape, a colour of its own. Not part of the model. */
function Appearance({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  if (c.covariate) return null;
  return (
    <div className="field">
      <label>Drawn as</label>
      <div className="row2">
        <select className="select" aria-label="Shape" value={c.shape ?? ''} onChange={(e) => update(c.id, { shape: (e.target.value || undefined) as Construct['shape'] })}>
          <option value="">{c.type === 'composite' ? 'Hexagon' : 'Oval or circle'} (its type)</option><option value="rectangle">Rectangle</option><option value="octagon">Octagon</option>
        </select>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="color" aria-label="Colour" value={c.color ?? '#ffffff'} onChange={(e) => update(c.id, { color: e.target.value })} />
          {c.color && <button className="btn sm ghost" onClick={() => update(c.id, { color: undefined })}>Style’s colour</button>}
        </span>
      </div>
    </div>
  );
}

/** How a path is drawn. */
function PathLine({ id, line, curved }: { id: string; line?: 'dashed' | 'dotted'; curved?: boolean }) {
  const updatePath = useStore((s) => s.updatePath);
  return (
    <div className="field">
      <label>Drawn as</label>
      <div className="row2">
        <select className="select" aria-label="Line" value={line ?? ''} onChange={(e) => updatePath(id, { line: (e.target.value || undefined) as 'dashed' | 'dotted' | undefined })}>
          <option value="">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
        </select>
        <label className="check"><input type="checkbox" checked={!!curved} onChange={(e) => updatePath(id, { curved: e.target.checked || undefined })} /> <span>Curved</span></label>
      </div>
    </div>
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
        <PathLine id={p.id} line={p.line} curved={p.curved} />
        <button className="btn danger" onClick={() => del([], [p.id])}><IconTrash size={14} /> Delete</button>
      </div>
    </>
  );
}

function ModelInspector() {
  const hasHoc = useStore((s) => s.model.constructs.some((c) => !!c.components?.length));
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  // Where the R packages run: the browser's R (webR) or desktop R through the helper.
  const where = useCompute((s) => s.backend) === 'helper' ? 'in desktop R (through the helper)' : 'in your browser (webR)';
  const pls = settings.method === 'pls';
  const proc = settings.method === 'process';
  return (
    <>
      <ModelChecks />
      {settings.method === 'cbsem' && <EsemEditor />}
      {settings.method === 'cbsem' && <GroupsEditor />}
      {settings.method === 'cbsem' && <ClustersEditor />}
      {(settings.method === 'cbsem' || settings.method === 'pls') && <WeightsEditor />}
      {settings.method === 'cbsem' && <SamplingClustersEditor />}
      {settings.method === 'cbsem' && <ConstraintsEditor />}
      {settings.method === 'cbsem' && model.correlations?.some((k) => k.zero) && <ZeroCovariances />}
      <MethodChoice />
      {proc && <ProcessEngine where={where} />}
      {settings.method === 'pls' && hasHoc && <HocApproach />}
      {!proc && <EngineChoice where={where} />}
      {settings.method === 'cbsem' && model.moderations.length > 0 && <LatentInteractions />}
      {settings.method === 'cbsem' && <EstimatorOptions />}
      {pls && <PlsAlgorithm />}
      {proc && <ProcessOptions />}
      {!proc && <MissingValues />}
      <Bootstrapping />
    </>
  );
}

/** An arrow from the constant: the construct's latent mean (or an observed variable's intercept). */
function MeanInspector({ id }: { id: string }) {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const setMean = useStore((s) => s.setMean);
  const setMultigroup = useStore((s) => s.setMultigroup);
  const del = useStore((s) => s.deleteItems);
  const results = useFreshResults();
  const t = model.means?.find((x) => x.id === id);
  const c = t && model.constructs.find((k) => k.id === t.target);
  if (!t || !c) return null;
  const observed = c.covariate || (c.indicators.length === 1 && c.type !== 'factor');
  const est = results?.cb?.estimates.find((e) => (e.kind === 'mean' || e.kind === 'intercept') && e.lhs === c.name);
  const mg = model.multigroup;
  const groupLabels = data?.moments?.groups?.map((g) => g.label);
  const biasText = t.bias === undefined ? '' : Array.isArray(t.bias) ? t.bias.join(', ') : String(t.bias);
  const setBias = (text: string) => {
    const parts = text.split(',').map((x) => x.trim()).filter(Boolean).map(Number);
    if (!parts.length) { setMean(id, { bias: null }); return; }
    if (parts.some((v) => !Number.isFinite(v))) return;
    setMean(id, { bias: parts.length === 1 ? parts[0] : parts });
  };
  const meanFree = !!mg?.free.some((f) => f.kind === 'mean' && f.construct === c.id);
  const toggleMeanFree = () => mg && setMultigroup({ ...mg, free: meanFree ? mg.free.filter((f) => !(f.kind === 'mean' && f.construct === c.id)) : [...mg.free, { kind: 'mean', construct: c.id }] });
  return (
    <>
      <div className="section">
        <div className="path-title">1 <span className="muted">→</span> {c.name}</div>
        <div className="hint">{observed ? `The intercept (mean) of ${c.name}.` : `The latent mean of ${c.name}: identified by fixing the intercept of its first indicator (${c.indicators[0] ?? '—'}) at 0, so it is in that indicator’s units.`}</div>
      </div>
      {est && (
        <div className="section">
          <div className="section-title">ML estimate</div>
          <div className="kv">
            <span>Estimate</span><span className="num">{fmt(est.est)}</span>
            <span>Std. error</span><span className="num">{est.se === null ? '—' : fmt(est.se)}</span>
            <span>z</span><span className="num">{est.z === null ? '—' : fmt(est.z)}</span>
            <span>p value</span><span className="num">{est.p === null ? '—' : fmtP(est.p)}</span>
          </div>
        </div>
      )}
      <div className="section">
        <div className="section-title">Parameter</div>
        <div className="field">
          <label htmlFor="mean-fixed">Fixed value (empty: estimated)</label>
          <input id="mean-fixed" className="input num" type="number" step="any" value={t.fixed ?? ''} placeholder="free"
            onChange={(e) => setMean(id, { fixed: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="mean-label">Label (equal labels = equal values; usable in defined parameters)</label>
          <input id="mean-label" className="input" value={t.label ?? ''} maxLength={31} disabled={t.fixed !== undefined} onChange={(e) => setMean(id, { label: e.target.value.trim() || null })} />
        </div>
        {!observed && c.indicators.length > 0 && (
          <div className="field">
            <label htmlFor="mean-bias">Intercept of {c.indicators[0]} (measurement bias; empty: 0)</label>
            <input id="mean-bias" className="input" value={biasText} placeholder={groupLabels ? `0, or one per group (${groupLabels.join(', ')})` : '0'} onChange={(e) => setBias(e.target.value)} />
            <div className="hint">The marker’s intercept is fixed here instead of at 0: the indicator reads the concept plus this much (Hayduk 1987). With groups, one value or a comma-separated value per group.</div>
          </div>
        )}
        {mg?.structural?.includes('means') && (
          <label className="check"><input type="checkbox" checked={meanFree} onChange={toggleMeanFree} /><span>Differs between groups (not held equal)</span></label>
        )}
        <button className="btn sm danger" onClick={() => del([], [id])}>Remove this arrow</button>
      </div>
    </>
  );
}

/** The constant itself. */
function ConstantInspector() {
  const model = useStore((s) => s.model);
  const del = useStore((s) => s.deleteItems);
  const n = model.means?.length ?? 0;
  return (
    <div className="section">
      <div className="section-title">The constant (1)</div>
      <div className="hint">lavaan’s mean structure is on: every indicator intercept is estimated (the dashed arrows; hide them with Implied). Drag from the triangle’s handle to a construct to estimate its latent mean (or an observed variable’s intercept); {n ? `${n} arrow${n > 1 ? 's' : ''} drawn.` : 'no arrows yet.'}</div>
      <button className="btn sm danger" style={{ marginTop: 8 }} onClick={() => del(['constant'], [])}>Remove the constant{n ? ' and its arrows' : ''}</button>
    </div>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const constructs = useStore((s) => s.model.constructs);
  const model = useStore((s) => s.model);
  const single = selection.nodes.length + selection.edges.length === 1;
  const c = single && selection.nodes.length === 1 ? constructs.find((k) => k.id === selection.nodes[0]) : undefined;
  const constant = single && selection.nodes.length === 1 && selection.nodes[0] === 'constant' && !!model.constant;
  const edgeId = single && selection.edges.length === 1 ? selection.edges[0] : undefined;
  const meanId = edgeId && model.means?.some((t) => t.id === edgeId) ? edgeId : undefined;
  const pathId = edgeId && !meanId ? edgeId : undefined;
  const modId = selection.moderations?.length === 1 && !c && !pathId ? selection.moderations[0] : undefined;
  const corId = selection.correlations?.length === 1 && !c && !pathId && !modId ? selection.correlations[0] : undefined;
  const title = c ? 'Construct' : constant ? 'Constant' : meanId ? 'Mean' : pathId ? 'Path' : modId ? 'Moderation' : corId ? 'Correlation' : selection.nodes.length + selection.edges.length > 1 ? 'Selection' : 'Model';
  return (
    <aside className="panel right" aria-label="Inspector">
      <div className="panel-head"><span>{title}</span></div>
      <div className="panel-body">
        {c ? <ConstructInspector key={c.id} c={c} />
          : constant ? <ConstantInspector />
          : meanId ? <MeanInspector id={meanId} />
          : pathId ? <PathInspector id={pathId} />
          : modId ? (model.threeWay?.some((t) => t.id === modId) ? <ThreeWayInspector id={modId} /> : <ModerationInspector id={modId} />)
          : corId ? <CorrelationInspector id={corId} />
            : title === 'Selection' ? <div className="hint">{selection.nodes.length} construct(s), {selection.edges.length} path(s) selected. Press Delete to remove them.</div>
              : <ModelInspector />}
      </div>
    </aside>
  );
}
