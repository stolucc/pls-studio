import { useEffect, useState } from 'react';
import { fmt } from '../../format';
import { indicatorNameError, type Construct } from '../../model/project';
import { useFreshResults, useStore } from '../../store';
import { ParcelButton } from '../ParcelDialog';
import { canParcel } from '../canvasMenu';
import { IconSide, IconX } from '../icons';

// The sections of the construct inspector (Inspector.tsx), each reading the store for what it shows.

function NameField({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const [v, setV] = useState(c.name);
  useEffect(() => setV(c.name), [c.name]);
  const commit = () => {
    const n = v.trim().slice(0, 100);
    if (n && n !== c.name) update(c.id, { name: n });
    else setV(c.name);
  };
  return (
    <input
      className="input"
      value={v}
      maxLength={100}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(c.name);
        }
      }}
    />
  );
}

/** An indicator by name: a model can be drawn before there is data (the names are matched with the columns on import). */
function AddIndicator({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const names = useStore((s) => s.data?.names);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const why = indicatorNameError(name, c);
    if (why) {
      setError(why);
      return;
    }
    update(c.id, { indicators: [...c.indicators, name.trim()] });
    setName('');
    setError(null);
  };
  const missing = names && name.trim() && !names.includes(name.trim());
  return (
    <div className="add-indicator">
      <div className="row2">
        <input
          className="input"
          placeholder={names ? 'Add an indicator by name' : 'Indicator name (e.g. sat1)'}
          aria-label="Indicator name"
          value={name}
          maxLength={64}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn" onClick={add} disabled={!name.trim()}>
          Add
        </button>
      </div>
      {error ? (
        <div className="hint" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      ) : !names ? (
        <div className="hint">
          No data yet: type the names of the columns you will import; they are matched by name then.
        </div>
      ) : missing ? (
        <div className="hint">
          Not a column of the current data: the model cannot be estimated until it is.
        </div>
      ) : null}
    </div>
  );
}

/** PLS-SEM: how this construct's outer weights are estimated (a mode, or weights given). */
function OuterWeights({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  return (
    <div className="field">
      <label title="How this construct's indicator weights are estimated (each construct has its own mode)">
        Outer weights (this construct)
      </label>
      <div className="segmented">
        <button
          className={!c.predefinedWeights && c.mode === 'A' ? 'on' : ''}
          onClick={() => update(c.id, { mode: 'A', predefinedWeights: undefined })}
        >
          Mode A (correlation)
        </button>
        <button
          className={!c.predefinedWeights && c.mode === 'B' ? 'on' : ''}
          onClick={() => update(c.id, { mode: 'B', predefinedWeights: undefined })}
        >
          Mode B (regression)
        </button>
        <button
          className={!c.predefinedWeights && c.mode === 'unit' ? 'on' : ''}
          onClick={() => update(c.id, { mode: 'unit', predefinedWeights: undefined })}
          title="Equal weights on the standardised indicators (unit weights)"
        >
          Sum scores
        </button>
        <button
          className={c.predefinedWeights ? 'on' : ''}
          onClick={() =>
            update(c.id, {
              predefinedWeights: Object.fromEntries(
                c.indicators.map((i) => [i, c.predefinedWeights?.[i] ?? 1]),
              ),
            })
          }
          title="Weights you give, not estimated; rescaled so that the score has unit variance. Runs in the built-in engine"
        >
          Pre-defined
        </button>
      </div>
      {c.predefinedWeights &&
        c.indicators.map((i) => (
          <label key={i} className="row2" style={{ alignItems: 'center', marginTop: 4 }}>
            {i}
            <input
              className="input num"
              type="number"
              step={0.1}
              value={c.predefinedWeights![i] ?? 0}
              onChange={(e) =>
                update(c.id, {
                  predefinedWeights: { ...c.predefinedWeights, [i]: Number(e.target.value) || 0 },
                })
              }
            />
          </label>
        ))}
    </div>
  );
}

/** Name, type, outer weights, categorical and dominant indicator, indicator side. */
export function ConstructBasics({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const method = useStore((s) => s.settings.method);
  const plsPackage = useStore((s) => s.settings.plsPackage);
  // cSEM's GSCA / PCA / sum-score approaches weight every construct their own way: a construct's mode then has no effect.
  const globalWeights = useStore(
    (s) =>
      s.settings.engine === 'r' &&
      s.settings.plsPackage === 'cSEM' &&
      s.settings.plsApproach !== 'PLS-PM',
  );
  return (
    <div className="section">
      <div className="field">
        <label>Name</label>
        <NameField c={c} />
      </div>
      {method !== 'process' && (
        <div className="field">
          <label>Construct type</label>
          <div className="segmented">
            <button
              className={c.type === 'factor' ? 'on' : ''}
              onClick={() => update(c.id, { type: 'factor', mode: 'A' })}
              title="Latent variable: indicators reflect the construct (ellipse)"
            >
              Common factor
            </button>
            <button
              className={c.type === 'composite' ? 'on' : ''}
              onClick={() => update(c.id, { type: 'composite', mode: 'B' })}
              title={
                method === 'cbsem'
                  ? 'Emergent variable: an exact weighted sum of its indicators, which covary freely (lavaan’s composites; hexagon)'
                  : 'Emergent variable: a weighted combination of its indicators (hexagon)'
              }
            >
              Composite
            </button>
          </div>
        </div>
      )}
      {method === 'pls' && (!c.components?.length || plsPackage === 'seminr') && !globalWeights && (
        <OuterWeights c={c} />
      )}
      {method === 'pls' && c.indicators.length === 1 && !c.components?.length && (
        <label className="check">
          <input
            type="checkbox"
            checked={!!c.categorical}
            onChange={(e) =>
              update(c.id, { categorical: e.target.checked ? 'indicator' : undefined })
            }
          />
          <span>
            <b>Categorical</b>
            <br />
            <span className="hint">
              {c.indicators[0]}’s k categories become k − 1 dummy variables (the first category is
              the reference) forming a composite (Mode B): the effect of group membership (Henseler
              2021). Exogenous only.
            </span>
          </span>
        </label>
      )}
      {method === 'pls' && c.indicators.length >= 2 && (
        <div className="field">
          <label>Dominant indicator</label>
          <select
            className="select"
            value={c.dominant ?? ''}
            onChange={(e) => update(c.id, { dominant: e.target.value || undefined })}
          >
            <option value="">None (sign as estimated)</option>
            {c.indicators.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <div className="hint" style={{ marginTop: 4 }}>
            Fixes the construct’s sign: its scores point the way this indicator does (loading
            positive), in the estimate and every bootstrap draw. cSEM and the built-in engine.
          </div>
        </div>
      )}
      <div className="field">
        <label>Indicator side</label>
        <div className="segmented">
          {(['left', 'top', 'right', 'bottom'] as const).map((s) => (
            <button
              key={s}
              className={c.side === s ? 'on' : ''}
              onClick={() => update(c.id, { side: s })}
              title={`Indicators on the ${s}`}
              aria-label={`Indicators on the ${s}`}
              aria-pressed={c.side === s}
            >
              <IconSide side={s} size={20} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Conditional process analysis: observed variable, scale score or latent variable; measurement level; covariate. */
export function ProcessVariableSection({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  return (
    <div className="section">
      <div className="section-title">Conditional process analysis</div>
      <div className="hint" style={{ marginBottom: 8 }}>
        {c.indicators.length === 0
          ? 'Drop a data column on this variable, or several items of a scale.'
          : c.indicators.length === 1
            ? `Observed variable ${c.indicators[0]}.`
            : c.latent
              ? `Latent variable measured by its ${c.indicators.length} items, corrected for measurement error.`
              : `Scale score: the mean of its ${c.indicators.length} items (computed per case before the regressions).`}
      </div>
      {c.indicators.length === 1 && !c.covariate && (
        <div className="field">
          <label>Measurement level</label>
          <select
            className="select"
            value={c.categorical ?? ''}
            onChange={(e) =>
              update(c.id, {
                categorical: (e.target.value || undefined) as Construct['categorical'],
              })
            }
          >
            <option value="">Continuous (or dichotomous)</option>
            <option value="indicator">Categorical X: indicator coding</option>
            <option value="sequential">Categorical X: sequential coding</option>
            <option value="helmert">Categorical X: Helmert coding</option>
            <option value="effect">Categorical X: effect coding</option>
          </select>
          {c.categorical && (
            <div className="hint" style={{ marginTop: 6 }}>
              X with k groups becomes k − 1 codes; every effect of X is reported per code as a
              relative effect (Hayes &amp; Preacher, 2014), with the codes as PROCESS’s mcx option.
            </div>
          )}
        </div>
      )}
      {c.indicators.length > 1 && !c.covariate && (
        <div className="field">
          <label>Scale</label>
          <div className="segmented">
            <button
              className={!c.latent ? 'on' : ''}
              onClick={() => update(c.id, { latent: false })}
              title="Mean of the items, then OLS regression (as PROCESS)"
            >
              Mean score
            </button>
            <button
              className={c.latent ? 'on' : ''}
              onClick={() => update(c.id, { latent: true })}
              title="Latent variable: structural-after-measurement estimation (lavaan::sam), free of the attenuation that measurement error causes in mean scores. Confidence intervals by Monte Carlo."
            >
              Latent variable
            </button>
          </div>
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={!!c.covariate}
          onChange={(e) => update(c.id, { covariate: e.target.checked })}
        />
        <span>
          <b>Covariate</b>
          <br />
          <span className="hint">
            Enters every equation (mediators and outcome) as a control variable, as PROCESS’s cov
            option. A covariate has no paths of its own.
          </span>
        </span>
      </label>
    </div>
  );
}

/** CB-SEM: observed covariate, known reliabilities, error variance, scaling, higher-order components. */
export function CbsemMeasurementSection({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const constructs = useStore((s) => s.model.constructs);
  return (
    <div className="section">
      <div className="section-title">CB-SEM</div>
      {c.indicators.length === 1 && (
        <label className="check">
          <input
            type="checkbox"
            checked={!!c.covariate}
            onChange={(e) => update(c.id, { covariate: e.target.checked })}
          />
          <span>
            <b>Observed covariate</b>
            <br />
            <span className="hint">
              Treat {c.indicators[0]} as an observed exogenous variable: its (co)variances are fixed
              at the sample values and it is not correlated with latent variables (lavaan’s
              fixed.x). Drawn as a rectangle.
            </span>
          </span>
        </label>
      )}
      {c.indicators.length === 1 && !c.covariate && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Reliability of {c.indicators[0]}</label>
          <input
            className="input num"
            type="number"
            min={0.01}
            max={1}
            step={0.01}
            placeholder="1 (no measurement error)"
            value={c.reliability ?? ''}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              update(c.id, { reliability: v !== undefined && Number.isFinite(v) ? v : undefined });
            }}
          />
          <div className="hint">
            A known reliability (e.g. a published α) fixes the error variance at (1 − reliability) ×
            the indicator’s variance (Bollen 1989). Empty: the error variance is 0. R engine
            (lavaan).
          </div>
        </div>
      )}
      {c.indicators.length === 1 && !c.covariate && c.reliability === undefined && (
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={!!c.freeError}
            onChange={(e) => update(c.id, { freeError: e.target.checked ? true : undefined })}
          />
          <span>
            <b>Estimate the error variance of {c.indicators[0]}</b>
            <br />
            <span className="hint">
              Instead of 0. Only when the rest of the model identifies it, e.g. two variables that
              cause each other, each with its own instrument (Bollen 1989, ch. 5). R engine
              (lavaan).
            </span>
          </span>
        </label>
      )}
      {c.indicators.length > 1 && !c.covariate && !c.components?.length && c.type === 'factor' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="factor-scale">Scale of {c.name}</label>
          <select
            id="factor-scale"
            className="select"
            value={c.scaling ?? 'marker'}
            onChange={(e) =>
              update(c.id, { scaling: e.target.value === 'variance' ? 'variance' : undefined })
            }
          >
            <option value="marker">First loading = 1 (marker indicator)</option>
            <option value="variance">Variance = 1 (every loading estimated)</option>
          </select>
          <div className="hint">
            How the factor gets its units: from its first indicator, or from a variance (a
            disturbance’s, when it is explained) fixed at 1 (lavaan NA*{c.indicators[0]} and{' '}
            {c.name} ~~ 1*{c.name}; Mplus {c.name} BY {c.indicators[0]}* …; {c.name}@1).
          </div>
        </div>
      )}
      {c.indicators.length > 1 && !c.covariate && !c.components?.length && (
        <div className="field" style={{ marginTop: 8 }}>
          <label>Known reliabilities of indicators (optional)</label>
          {c.indicators.map((ind) => (
            <div className="ind" key={ind} style={{ alignItems: 'center' }}>
              <span>{ind}</span>
              <input
                className="input num"
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                placeholder="estimated"
                aria-label={`Reliability of ${ind}`}
                style={{ width: 90 }}
                value={c.reliabilities?.[ind] ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  const next = { ...(c.reliabilities ?? {}) };
                  if (v !== undefined && Number.isFinite(v)) next[ind] = v;
                  else delete next[ind];
                  update(c.id, { reliabilities: Object.keys(next).length ? next : undefined });
                }}
              />
            </div>
          ))}
          <div className="hint">
            An indicator with a known reliability gets its error variance fixed at (1 − reliability)
            × its variance (per group with groups), as Hayduk (1987) fixes measurement error; the
            others’ error variances are estimated. R engine (lavaan).
          </div>
        </div>
      )}
      {c.indicators.length === 0 && (
        <>
          <div className="hint" style={{ marginBottom: 6 }}>
            Higher-order factor: measured by other constructs (the first is the marker).
          </div>
          {constructs
            .filter((k) => k.id !== c.id && !k.covariate)
            .map((k) => (
              <label key={k.id} className="check" style={{ marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={c.components?.includes(k.id) ?? false}
                  onChange={(e) =>
                    update(c.id, {
                      components: e.target.checked
                        ? [...(c.components ?? []), k.id]
                        : (c.components ?? []).filter((x) => x !== k.id),
                    })
                  }
                />
                {k.name}
              </label>
            ))}
        </>
      )}
    </div>
  );
}

/** PLS-SEM: a second-order construct measured by first-order constructs. */
export function SecondOrderSection({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const plsPackage = useStore((s) => s.settings.plsPackage);
  const constructs = useStore((s) => s.model.constructs);
  return (
    <div className="section">
      <div className="section-title">Second-order construct</div>
      <div className="hint" style={{ marginBottom: 6 }}>
        Measured by first-order constructs (two-stage approach): their scores are its indicators in
        stage 2.{' '}
        {plsPackage === 'seminr'
          ? 'seminr weights it as chosen under Weighting.'
          : c.type === 'composite'
            ? 'cSEM weights a composite by Mode B.'
            : 'cSEM weights a common factor by Mode A and corrects it for attenuation.'}{' '}
        The components stay out of the structural model; connect this construct instead.
      </div>
      {constructs
        .filter((k) => k.id !== c.id && k.indicators.length > 0)
        .map((k) => (
          <label key={k.id} className="check" style={{ marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={c.components?.includes(k.id) ?? false}
              onChange={(e) =>
                update(c.id, {
                  components: e.target.checked
                    ? [...(c.components ?? []), k.id]
                    : (c.components ?? []).filter((x) => x !== k.id),
                })
              }
            />
            {k.name}
          </label>
        ))}
    </div>
  );
}

/** Components or indicators, with their loadings (or weights) when there are results. */
export function IndicatorsSection({ c }: { c: Construct }) {
  const update = useStore((s) => s.updateConstruct);
  const removeIndicator = useStore((s) => s.removeIndicator);
  const method = useStore((s) => s.settings.method);
  const constructs = useStore((s) => s.model.constructs);
  const results = useFreshResults();
  const pls = method === 'pls' ? results?.pls : null;
  const cb = method === 'cbsem' ? results?.cb : null;
  const cbIdx = new Map(cb?.indicators.map((ind, k) => [ind.name, k]) ?? []);
  const idx = new Map(pls?.indicators.map((ind, k) => [ind.name, k]) ?? []);
  return (
    <div className="section">
      <div className="section-title">
        {c.components?.length
          ? `Components (${c.components.length})`
          : `Indicators (${c.indicators.length})`}
      </div>
      {c.indicators.length === 0 && !c.components?.length && (
        <div className="hint">
          Drag variables from the data panel onto this construct
          {method === 'cbsem'
            ? ', or tick components above to make it a higher-order factor'
            : method === 'pls'
              ? ', or tick components above to make it a second-order construct'
              : ''}
          .
        </div>
      )}
      {c.components?.map((id) => (
        <div key={id} className="ind" style={{ alignItems: 'center' }}>
          <span>{constructs.find((k) => k.id === id)?.name}</span>
          {method === 'cbsem' && (
            <input
              className="input num"
              type="number"
              step="any"
              placeholder={c.components![0] === id && !c.markerFree ? '1 (marker)' : 'estimated'}
              aria-label={`Loading of ${constructs.find((k) => k.id === id)?.name}`}
              style={{ width: 90 }}
              value={c.componentLoadings?.[id] ?? ''}
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                const next = { ...(c.componentLoadings ?? {}) };
                if (v !== undefined && Number.isFinite(v)) next[id] = v;
                else delete next[id];
                update(c.id, { componentLoadings: Object.keys(next).length ? next : undefined });
              }}
            />
          )}
        </div>
      ))}
      {method === 'cbsem' && !!c.components?.length && (
        <div className="hint">
          A value holds that loading (the first component sets the scale with 1 unless given a
          value). A latent curve model: intercept 1, 1, 1, … and slope 0, 1, 2, … over the waves as
          components.
        </div>
      )}
      {method === 'cbsem' && !!c.components?.length && (
        <label className="check" style={{ marginTop: 6 }}>
          <input
            type="checkbox"
            checked={!!c.markerFree}
            onChange={(e) => update(c.id, { markerFree: e.target.checked ? true : undefined })}
          />
          <span>
            Estimate the first loading too
            <br />
            <span className="hint">
              The scale then comes from a path into {c.name} held at a value (right-click the path →
              Hold at a value), e.g. a formative construct scaled by one of its causes (Brown 2015,
              Table 8.12).
            </span>
          </span>
        </label>
      )}
      <div className="ind-list">
        {c.indicators.map((name) => {
          const k = idx.get(name);
          const kc = cbIdx.get(name);
          const v =
            kc !== undefined
              ? cb!.stdLoadings[kc]
              : k === undefined
                ? null
                : c.type === 'composite'
                  ? pls!.weights[k]
                  : pls!.loadings[k];
          return (
            <div className="ind" key={name}>
              <span className="vname">{name}</span>
              <span
                className="num muted"
                title={
                  c.type === 'composite' && !cb ? 'Weight' : cb ? 'Standardised loading' : 'Loading'
                }
              >
                {v === null ? '' : fmt(v)}
              </span>
              <button
                className="btn icon ghost sm"
                style={{ width: 24, height: 24 }}
                onClick={() => removeIndicator(c.id, name)}
                aria-label={`Remove ${name}`}
              >
                <IconX size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {!c.covariate && !c.components?.length && <AddIndicator c={c} />}
      {method === 'cbsem' && canParcel(c) && (
        <div style={{ marginTop: 8 }}>
          <ParcelButton c={c} />
        </div>
      )}
    </div>
  );
}

/** Quality (R², reliability, AVE) from CB-SEM or PLS-SEM results. */
export function ConstructQuality({ c }: { c: Construct }) {
  const method = useStore((s) => s.settings.method);
  const results = useFreshResults();
  const pls = method === 'pls' ? results?.pls : null;
  const cb = method === 'cbsem' ? results?.cb : null;
  const j = pls ? pls.constructs.indexOf(c.name) : -1;
  const jc = cb ? cb.constructs.indexOf(c.name) : -1;
  const q = j >= 0 ? pls!.quality[j] : null;
  return (
    <>
      {cb && jc >= 0 && (
        <div className="section">
          <div className="section-title">Quality</div>
          <div className="kv">
            {cb.r2Constructs[jc] !== null && (
              <>
                <span>R²</span>
                <span className="num">{fmt(cb.r2Constructs[jc])}</span>
              </>
            )}
            <span>Composite reliability</span>
            <span className="num">{fmt(cb.reliability[jc].cr)}</span>
            <span>AVE</span>
            <span className="num">{fmt(cb.reliability[jc].ave)}</span>
          </div>
        </div>
      )}
      {q && (
        <div className="section">
          <div className="section-title">Quality</div>
          <div className="kv">
            {j >= 0 && pls!.rSquared[j] !== null && (
              <>
                <span>R²</span>
                <span className="num">{fmt(pls!.rSquared[j])}</span>
              </>
            )}
            {c.type === 'factor' && (
              <>
                <span>Cronbach’s α</span>
                <span className="num">{fmt(q.alpha)}</span>
                <span>ρA</span>
                <span className="num">{fmt(q.rhoA)}</span>
                <span>Composite reliability ρC</span>
                <span className="num">{fmt(q.rhoC)}</span>
                <span>AVE</span>
                <span className="num">{fmt(q.ave)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
