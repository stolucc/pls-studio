import { useEffect, useMemo, useState } from 'react';
import { ipma, type IpmaPoint, type IpmaResult } from '../../engine/ipma';
import type { PlsResult } from '../../engine/types';
import { toSpec } from '../../model/project';
import { useStore } from '../../store';
import { c, Table } from './Table';
import { RScriptButton } from './RScriptButton';

/** Greedy vertical de-overlap of point labels (labels sit right of their point). */
export function placeLabels<T extends { name: string; x: number; y: number }>(pts: T[], lineH = 13): (T & { ly: number })[] {
  const out = [...pts].sort((a, b) => a.y - b.y).map((p) => ({ ...p, ly: p.y }));
  for (let i = 1; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const close = Math.abs(out[i].x - out[j].x) < 8 * Math.max(out[i].name.length, out[j].name.length);
      if (close && out[i].ly - out[j].ly < lineH) out[i].ly = out[j].ly + lineH;
    }
  }
  return out;
}

/** Importance (x) vs performance (y) scatter with dashed mean lines splitting the quadrants. */
function IpmaChart({ points, xLabel, yMax }: { points: IpmaPoint[]; xLabel: string; yMax: number }) {
  const W = 520, H = 320, pad = { l: 46, r: 16, t: 14, b: 40 };
  const xs = points.map((p) => p.importance);
  const xMin = Math.min(0, ...xs), xMax = Math.max(...xs, 0.01) * 1.12;
  const ys = points.map((p) => p.performance);
  const yLo = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10), yHi = Math.min(yMax, Math.ceil((Math.max(...ys) + 5) / 10) * 10);
  const sx = (v: number) => pad.l + ((v - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((yHi - v) / (yHi - yLo || 1)) * (H - pad.t - pad.b);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ticks = (lo: number, hi: number, k: number) => Array.from({ length: k + 1 }, (_, i) => lo + ((hi - lo) * i) / k);
  return (
    <svg className="ipma" width={W} height={H} role="img" aria-label="Importance-performance map">
      {ticks(yLo, yHi, 4).map((v) => (
        <g key={`y${v}`}>
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
          <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{v.toFixed(0)}</text>
        </g>
      ))}
      {ticks(xMin, xMax, 4).map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">{v.toFixed(2)}</text>
      ))}
      <line className="mean-line" x1={sx(mx)} x2={sx(mx)} y1={pad.t} y2={H - pad.b} />
      <line className="mean-line" x1={pad.l} x2={W - pad.r} y1={sy(my)} y2={sy(my)} />
      <text className="quad" x={W - pad.r - 4} y={pad.t + 12} textAnchor="end">keep up the good work</text>
      <text className="quad" x={W - pad.r - 4} y={H - pad.b - 6} textAnchor="end">priority for improvement</text>
      {placeLabels(points.map((p) => ({ name: p.name, x: sx(p.importance), y: sy(p.performance), hot: p.importance > mx && p.performance < my }))).map((p) => (
        <g key={p.name}>
          <circle cx={p.x} cy={p.y} r={6} className={p.hot ? 'dot hot' : 'dot'} />
          {p.ly !== p.y && <line className="grid-line" x1={p.x + 6} y1={p.y} x2={p.x + 9} y2={p.ly} />}
          <text x={p.x + 9} y={p.ly + 4} className="dot-label">{p.name}</text>
        </g>
      ))}
      <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{xLabel}</text>
      <text transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">Performance</text>
    </svg>
  );
}

export function IpmaTab({ pls }: { pls: PlsResult }) {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const endogenous = pls.constructs.filter((_, j) => pls.rSquared[j] !== null && !pls.moderations.some((m) => m.construct === j));
  const [target, setTarget] = useState(endogenous[endogenous.length - 1] ?? '');
  const [level, setLevel] = useState<'constructs' | 'indicators'>('constructs');
  const [rescale, setRescale] = useState(true);
  const [bounds, setBounds] = useState<{ min: string; max: string }>({ min: '', max: '' });

  const useR = settings.engine === 'r';
  const num = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const plsOptions = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: settings.missing, consistent: settings.consistent };
  const builtin = useMemo(() => {
    if (useR || !data || !target) return null;
    try {
      return ipma(data, toSpec(model), plsOptions, { target, rescale, min: num(bounds.min), max: num(bounds.max) });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useR, data, model, settings, target, rescale, bounds]);
  // R engine: cSEM's doIPMA, recomputed shortly after the inputs settle.
  const [fromR, setFromR] = useState<IpmaResult | string | null>(null);
  useEffect(() => {
    if (!useR || !data || !target || pls.moderations.length) return;
    let live = true;
    setFromR(null);
    const t = setTimeout(() => {
      import('../../rengine/analyses').then(({ ipmaR }) => ipmaR(data, toSpec(model), plsOptions, { target, rescale, min: num(bounds.min), max: num(bounds.max) }))
        .then((r) => { if (live) setFromR(r); })
        .catch((e) => import('../../rengine/bridge').then(({ rMessage }) => { if (live) setFromR(`cSEM: ${rMessage(e)}`); }));
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useR, data, model, settings, target, rescale, bounds, pls.moderations.length]);
  const result = useR ? fromR : builtin;

  if (pls.moderations.length) return <div className="empty-results">IPMA is not defined for models with interaction terms.</div>;
  if (endogenous.length === 0) return <div className="empty-results">The model has no endogenous construct.</div>;

  const relevant = typeof result === 'object' && result
    ? (level === 'constructs'
      ? result.constructs.filter((p) => Math.abs(p.importance) > 1e-12)
      : result.indicators.filter((p) => p.construct !== target && Math.abs(p.importance) > 1e-12))
    : [];

  return (
    <>
      <div className="ipma-controls">
        {useR && <RScriptButton what={{ ipma: { target, rescale, min: num(bounds.min), max: num(bounds.max) } }} />}
        <label>Target
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {endogenous.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="segmented" style={{ width: 220 }}>
          <button className={level === 'constructs' ? 'on' : ''} onClick={() => setLevel('constructs')}>Constructs</button>
          <button className={level === 'indicators' ? 'on' : ''} onClick={() => setLevel('indicators')}>Indicators</button>
        </div>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={rescale} onChange={(e) => setRescale(e.target.checked)} /> Rescale to 0–100
        </label>
        {rescale && (
          <>
            <label>Scale min <input className="input num" style={{ width: 70 }} placeholder="observed" value={bounds.min} onChange={(e) => setBounds({ ...bounds, min: e.target.value })} /></label>
            <label>Scale max <input className="input num" style={{ width: 70 }} placeholder="observed" value={bounds.max} onChange={(e) => setBounds({ ...bounds, max: e.target.value })} /></label>
          </>
        )}
      </div>
      {typeof result === 'string' && <div className="issue error">{result}</div>}
      {useR && result === null && <div className="hint">Calculating with cSEM (doIPMA)…</div>}
      {typeof result === 'object' && result && (
        <>
          {result.negativeWeights.length > 0 && (
            <div className="issue warning">Negative weights for {result.negativeWeights.join(', ')}: performance values are hard to interpret.</div>
          )}
          <div className="tables">
            <IpmaChart points={relevant} xLabel={`Importance (total effect on ${target})`} yMax={rescale ? 100 : Infinity} />
            <Table title={`IPMA for ${target}`} file={`ipma-${level}`}
              columns={level === 'constructs' ? ['Construct', 'Importance', 'Performance'] : ['Indicator', 'Construct', 'Weight', 'Importance', 'Performance']}
              rows={level === 'constructs'
                ? [...relevant.map((p) => [c(p.name), c(p.importance), c(p.performance, '', 2)]), [c(`${target} (target)`), c(null), c(result.targetPerformance, '', 2)]]
                : relevant.map((p) => {
                  const ind = p as (typeof result.indicators)[number];
                  return [c(ind.name), c(ind.construct), c(ind.weight), c(ind.importance), c(ind.performance, '', 2)];
                })}
              note={<>Importance: unstandardised total effect on {target}{rescale ? ', per point on the 0–100 scale' : ''}. Performance: mean {rescale ? 'rescaled (0–100)' : 'raw'} score{rescale && !bounds.min && !bounds.max ? ', using the observed minimum and maximum; set the theoretical scale bounds for Likert items' : ''}. Highlighted points (high importance, low performance) are priorities for improvement (Ringle &amp; Sarstedt 2016). Validated against cSEM.</>} />
          </div>
        </>
      )}
    </>
  );
}
