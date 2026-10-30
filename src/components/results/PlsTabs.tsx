import { useMemo, useState } from 'react';
import type { FitTestResult } from '../../engine/bootstrap';
import type { BootstrapResult, BootstrapStat, Discrepancies, PlsResult } from '../../engine/types';
import { csvCell, downloadText, fmt, safeFileName } from '../../format';
import { run } from '../../runner';
import { useStore } from '../../store';
import { IconDownload, IconRepeat } from '../icons';
import { QuadraticCurve, SimpleSlopes } from '../SimpleSlopes';
import { IpmaTab } from './IpmaTab';
import { RScriptButton } from './RScriptButton';
import { SavePlsScores } from './SaveScores';
import { bootCells, bootCols, c, htmtCls, matrixRows, relCls, Table, type Cell, type Row } from './Table';

export const PLS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'paths', label: 'Path coefficients' },
  { id: 'effects', label: 'Indirect & total effects' },
  { id: 'outer', label: 'Loadings & weights' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'discriminant', label: 'Discriminant validity' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'ipma', label: 'IPMA' },
  { id: 'fit', label: 'Model fit' },
  { id: 'correlations', label: 'Correlations' },
  { id: 'bootstrap', label: 'Bootstrapping' },
] as const;
export type PlsTabId = (typeof PLS_TABS)[number]['id'];

function useTypes() {
  const constructs = useStore((s) => s.model.constructs);
  return useMemo(() => new Map(constructs.map((k) => [k.name, k.type])), [constructs]);
}

function Overview({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const project = useStore((s) => s.projectName);
  const endo = pls.constructs.map((name, j) => ({ name, j })).filter(({ j }) => pls.rSquared[j] !== null);
  const scoresCsv = () => {
    const lines = [pls.constructs.map(csvCell).join(',')];
    for (let r = 0; r < pls.n; r++) lines.push(pls.scores.map((col) => col[r]).join(','));
    downloadText(`${safeFileName(project)}-construct-scores.csv`, lines.join('\n'), 'text/csv');
  };
  return (
    <>
      <div className="stat-cards">
        <div className="stat-card"><div className="k">Algorithm</div><div className="v">{pls.consistent ? 'PLSc' : 'PLS'}</div></div>
        <div className="stat-card"><div className="k">Observations</div><div className="v">{pls.n}</div></div>
        <div className="stat-card"><div className="k">Iterations</div><div className="v">{pls.iterations}</div></div>
        <div className="stat-card"><div className="k">Converged</div><div className="v" style={{ color: pls.converged ? 'var(--good)' : 'var(--bad)' }}>{pls.converged ? 'Yes' : 'No'}</div></div>
        <div className="stat-card"><div className="k">SRMR</div><div className="v">{fmt(pls.fit.estimated.srmr)}</div></div>
        <div className="stat-card"><div className="k">Bootstrap</div><div className="v">{boot ? boot.samples : '—'}</div></div>
        {pls.droppedRows > 0 && <div className="stat-card"><div className="k">Rows dropped</div><div className="v">{pls.droppedRows}</div></div>}
      </div>
      <div className="tables">
        <Table title="Coefficient of determination" file="r-squared" columns={['Construct', 'R²', 'R² adjusted']}
          rows={endo.map(({ name, j }) => [c(name), c(pls.rSquared[j]), c(pls.adjRSquared[j])])}
          note={pls.consistent ? 'R² of the disattenuated (PLSc) model.' : 'Rough guide (Hair et al.): 0.75 substantial, 0.50 moderate, 0.25 weak.'} />
        <div>
          <div className="table-tools"><h3>Construct scores</h3></div>
          <button className="btn" onClick={scoresCsv}><IconDownload size={14} /> Download scores (CSV)</button>
          <SavePlsScores pls={pls} />
          <div className="table-note">Standardised proxy scores for each observation.</div>
        </div>
      </div>
    </>
  );
}

function Paths({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const rows: Row[] = [];
  const C = pls.constructs;
  for (let i = 0; i < C.length; i++) for (let j = 0; j < C.length; j++) {
    if (!pls.hasPath[i][j]) continue;
    const f2 = pls.fSquare[i][j] ?? 0;
    const vif = pls.vifInner[i][j] ?? 1;
    const b = boot?.stats.find((s) => s.key === `path:${C[i]}:${C[j]}`);
    rows.push([c(`${C[i]} → ${C[j]}`), c(pls.pathCoef[i][j]), c(f2, f2 >= 0.35 ? 'good' : ''), c(vif, vif > 5 ? 'bad' : vif > 3 ? 'warn' : ''), ...(boot ? bootCells(b) : [])]);
  }
  return (
    <Table title="Path coefficients" file="paths" columns={['Path', 'β', 'f²', 'VIF', ...(boot ? bootCols(boot) : [])]} rows={rows}
      note={<>f²: 0.02 small, 0.15 medium, 0.35 large (model re-estimated without the path). Inner VIF above 3 suggests collinearity.{!boot && ' Run bootstrapping for standard errors and p-values.'} * p&lt;.05 ** p&lt;.01 *** p&lt;.001</>} />
  );
}

function Effects({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const C = pls.constructs;
  const rows = (kind: 'total' | 'indirect'): Row[] => {
    const out: Row[] = [];
    for (let i = 0; i < C.length; i++) for (let j = 0; j < C.length; j++) {
      const v = kind === 'total' ? pls.totalEffects[i][j] : pls.indirectEffects[i][j];
      if (i === j || Math.abs(v) < 1e-12) continue;
      const b = boot?.stats.find((s) => s.key === `${kind}:${C[i]}:${C[j]}`);
      out.push([c(`${C[i]} → ${C[j]}`), c(v), ...(boot ? bootCells(b) : [])]);
    }
    return out;
  };
  const ind = rows('indirect');
  return (
    <div className="tables">
      <Table title="Total indirect effects" file="indirect-effects" columns={['Effect', 'Estimate', ...(boot ? bootCols(boot) : [])]} rows={ind}
        note={ind.length === 0 ? 'The model has no mediated relationships.' : 'Sum of all indirect paths between two constructs. Bootstrapped p-values test mediation.'} />
      <Table title="Total effects" file="total-effects" columns={['Effect', 'Estimate', ...(boot ? bootCols(boot) : [])]} rows={rows('total')} />
    </div>
  );
}

function Outer({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const types = useTypes();
  const rows: Row[] = pls.indicators.map((ind, k) => {
    const cn = pls.constructs[ind.construct];
    const l = pls.loadings[k];
    const factor = types.get(cn) !== 'composite';
    const bl = boot?.stats.find((s) => s.key === `loading:${ind.name}`);
    const bw = boot?.stats.find((s) => s.key === `weight:${ind.name}`);
    const pc = (s: BootstrapStat | undefined) => (s ? c(s.p < 0.001 ? '<0.001' : s.p.toFixed(3), s.p < 0.05 ? 'good' : 'dim') : c(null));
    return [
      c(ind.name), c(cn), c(factor ? 'factor' : 'composite', 'dim'),
      c(l, factor ? (Math.abs(l) >= 0.708 ? 'good' : Math.abs(l) >= 0.4 ? 'warn' : 'bad') : ''),
      c(pls.weights[k]), c(pls.vifOuter[k], pls.vifOuter[k] > 5 ? 'bad' : pls.vifOuter[k] > 3 ? 'warn' : ''),
      ...(boot ? [pc(bl), pc(bw), bw ? c(`[${fmt(bw.ciLow)}, ${fmt(bw.ciHigh)}]`) : c(null)] : []),
    ];
  });
  // Second-order constructs (cSEM two-stage): their components play the indicators' part.
  const ho = pls.higherOrder ?? [];
  const hoRows: Row[] = ho.map((h) => {
    const hn = pls.constructs[h.construct], cn = pls.constructs[h.component];
    const factor = types.get(hn) !== 'composite';
    const bl = boot?.stats.find((s) => s.key === `hoLoading:${hn}:${cn}`);
    const bw = boot?.stats.find((s) => s.key === `hoWeight:${hn}:${cn}`);
    const pc = (s: BootstrapStat | undefined) => (s ? c(s.p < 0.001 ? '<0.001' : s.p.toFixed(3), s.p < 0.05 ? 'good' : 'dim') : c(null));
    return [c(cn), c(hn), c(factor ? 'factor' : 'composite', 'dim'), c(h.loading, factor ? (Math.abs(h.loading) >= 0.708 ? 'good' : Math.abs(h.loading) >= 0.4 ? 'warn' : 'bad') : ''), c(h.weight),
      ...(boot ? [pc(bl), pc(bw), bw ? c(`[${fmt(bw.ciLow)}, ${fmt(bw.ciHigh)}]`) : c(null)] : [])];
  });
  return (
    <div className="tables">
      <Table title="Measurement model" file="outer-model"
        columns={['Indicator', 'Construct', 'Type', 'Loading', 'Weight', 'VIF', ...(boot ? ['p (loading)', 'p (weight)', 'Weight CI'] : [])]} rows={rows}
        note={<>Common factors: loadings should be ≥ 0.708{pls.consistent ? ' (PLSc-corrected loadings λ = ĉŵ)' : ''}. Composites: interpret weights, their significance and VIF (&lt; 3 ideal, &gt; 5 problematic).</>} />
      {ho.length > 0 && <Table title="Second-order constructs" file="second-order"
        columns={['Component', 'Second-order construct', 'Type', 'Loading', 'Weight', ...(boot ? ['p (loading)', 'p (weight)', 'Weight CI'] : [])]} rows={hoRows}
        note="cSEM’s two-stage approach: stage 1 estimates the first-order constructs; their scores are the indicators of the second-order construct in stage 2, which cSEM corrects for attenuation when it is a common factor. Its paths and R² are stage 2’s." />}
    </div>
  );
}

function Reliability({ pls }: { pls: PlsResult }) {
  const types = useTypes();
  const rows: Row[] = pls.constructs.map((name, j) => {
    const q = pls.quality[j];
    const single = pls.indicators.filter((i) => i.construct === j).length === 1;
    if (types.get(name) === 'composite' || single) {
      return [c(name), c(single ? 'single item' : 'composite', 'dim'), c(null, 'dim'), c(null, 'dim'), c(null, 'dim'), c(null, 'dim')];
    }
    return [c(name), c('common factor', 'dim'), c(q.alpha, relCls(q.alpha)), c(q.rhoA, relCls(q.rhoA)), c(q.rhoC, relCls(q.rhoC)), c(q.ave, q.ave >= 0.5 ? 'good' : 'bad')];
  });
  const ra = Object.entries(pls.redundancy ?? {});
  return (
    <div className="tables">
      <Table title="Construct reliability and validity" file="reliability" columns={['Construct', 'Type', 'Cronbach’s α', 'ρA', 'ρC', 'AVE']} rows={rows}
        note="ρA (Dijkstra & Henseler) is the consistent reliability of a common factor. 0.70–0.95 is satisfactory. AVE ≥ 0.50 indicates convergent validity. Reliability does not apply to composites, which are defined by their weights." />
      {ra.length > 0 && (
        <Table title="Redundancy analysis" file="redundancy" columns={['Composite (Mode B)', 'Correlation']} rows={ra.map(([k, v]) => [c(k), c(v, v >= 0.7 ? 'good' : 'bad')])}
          note="cSEM: each Mode B composite correlated with a Mode A composite of the same indicators (Chin 1998; Hair et al. 2016); 0.70 or more is the usual threshold. With a global single item, draw a path from the composite to a single-item construct instead: its coefficient is the classic redundancy test. cSEM’s authors discourage its use for validity." />
      )}
    </div>
  );
}

function Discriminant({ pls }: { pls: PlsResult }) {
  const C = pls.constructs;
  const flRows: Row[] = C.map((name, i) => {
    const diag = Math.sqrt(pls.quality[i].ave);
    return [c(name), ...C.map((_, j) => {
      if (j > i) return c(null, 'dim');
      if (j === i) return { v: diag, bold: true };
      const r = pls.constructCor[i][j];
      return c(r, Math.abs(r) > diag || Math.abs(r) > Math.sqrt(pls.quality[j].ave) ? 'bad' : '');
    })];
  });
  return (
    <div className="tables">
      <Table title="HTMT" file="htmt" columns={['', ...C]} rows={matrixRows(C, (i, j) => pls.htmt[i][j], htmtCls)}
        note="Heterotrait–monotrait ratio (Henseler, Ringle & Sarstedt 2015). Above 0.90 (0.85 for distinct concepts) indicates a problem." />
      <Table title="HTMT2" file="htmt2" columns={['', ...C]} rows={matrixRows(C, (i, j) => pls.htmt2[i][j], htmtCls)}
        note="Geometric-mean HTMT (Roemer, Schuberth & Henseler 2021); consistent for congeneric measures." />
      <Table title="Fornell–Larcker criterion" file="fornell-larcker" columns={['', ...C]} rows={flRows}
        note="Diagonal: √AVE. Each should exceed the construct's correlations with others." />
    </div>
  );
}

function verdict(obs: number, hi95: number | undefined, hi99: number | undefined): Cell {
  if (hi95 === undefined || hi99 === undefined) return c('run test', 'dim');
  if (obs <= hi95) return c('fits (≤ HI95)', 'good');
  if (obs <= hi99) return c('rejected at 5%', 'bad');
  return c('rejected at 1%', 'bad');
}

function Fit({ pls, test }: { pls: PlsResult; test: FitTestResult | null }) {
  const job = useStore((s) => s.job);
  const samples = useStore((s) => s.settings.bootSamples);
  const rows = (which: 'saturated' | 'estimated'): Row[] => {
    const obs: Discrepancies = pls.fit[which];
    return (['srmr', 'dULS', 'dG'] as const).map((k) => [
      c(k === 'srmr' ? 'SRMR' : k === 'dULS' ? 'd_ULS' : 'd_G'),
      c(obs[k], '', 4), c(test ? test.hi95[which][k] : null, '', 4), c(test ? test.hi99[which][k] : null, '', 4),
      verdict(obs[k], test?.hi95[which][k], test?.hi99[which][k]),
    ]);
  };
  return (
    <>
      <div className="table-tools">
        <h3>Test of overall model fit</h3>
        <button className="btn sm" onClick={() => run('fittest')} disabled={!!job}><IconRepeat size={13} /> {test ? 'Re-run' : 'Run'} bootstrap test ({samples})</button>
        <RScriptButton what="fittest" />
      </div>
      <div className="tables">
        {(['saturated', 'estimated'] as const).map((which) => (
          <Table key={which} title={which === 'saturated' ? 'Saturated model' : 'Estimated model'} file={`fit-${which}`}
            columns={['Discrepancy', 'Value', 'HI95', 'HI99', 'Decision']} rows={rows(which)} />
        ))}
      </div>
      <div className="table-note">
        Discrepancies between the empirical and model-implied indicator correlation matrices (Dijkstra &amp; Henseler 2015).
        The <b>saturated</b> model freely correlates all constructs and tests the measurement model; the <b>estimated</b> model
        imposes the structural model. HI95/HI99 are bootstrap quantiles under the null of exact fit (data rotated to the
        model-implied matrix). Composites leave within-block correlations unrestricted; common factors impose λλ′.
        d_G uses the natural logarithm. SRMR below 0.08 is a common approximate-fit heuristic.
      </div>
    </>
  );
}

function Correlations({ pls }: { pls: PlsResult }) {
  return (
    <Table title={pls.consistent ? 'Construct correlations (disattenuated)' : 'Construct correlations'} file="correlations"
      columns={['', ...pls.constructs]} rows={matrixRows(pls.constructs, (i, j) => pls.constructCor[i][j])} />
  );
}

const GROUPS: { id: BootstrapStat['group']; label: string }[] = [
  { id: 'path', label: 'Paths' }, { id: 'indirect', label: 'Indirect' }, { id: 'total', label: 'Total' },
  { id: 'loading', label: 'Loadings' }, { id: 'weight', label: 'Weights' }, { id: 'r2', label: 'R²' },
];

export function BootstrapTab({ boot, std }: { boot: BootstrapResult | null; std?: boolean }) {
  const groups = GROUPS.filter((g) => boot?.stats.some((s) => s.group === g.id) ?? true);
  const [group, setGroup] = useState<BootstrapStat['group']>('path');
  if (!boot) {
    return (
      <div className="empty-results">
        No bootstrap results yet. <button className="btn sm" onClick={() => run('boot')}><IconRepeat size={13} /> Run bootstrapping</button>
      </div>
    );
  }
  const stats = boot.stats.filter((s) => s.group === group);
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div className="segmented" style={{ maxWidth: 520, flex: 1 }}>
          {groups.map((g) => <button key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>)}
        </div>
        <RScriptButton what="bootstrap" />
      </div>
      <Table title={`Bootstrap: ${GROUPS.find((g) => g.id === group)!.label.toLowerCase()}${std ? ' (standardised)' : ''}`} file={`bootstrap-${group}`}
        columns={['Parameter', 'Original', ...bootCols(boot)]}
        rows={stats.map((s) => [c(s.label), c(s.original), ...bootCells(s)])}
        note={`${boot.samples} subsamples${boot.failed ? ` (${boot.failed} failed or not admissible, excluded)` : ''}. Two-tailed t test with df = usable samples − 1; percentile confidence intervals.${boot.engine ? ` Resampling by ${boot.engine.package} ${boot.engine.version}.` : ''}`} />
    </>
  );
}

function Moderation({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  if (pls.moderations.length === 0) {
    return <div className="empty-results">No moderators in the model. Drag from a construct’s dot onto a path arrow to add one.</div>;
  }
  const C = pls.constructs;
  const rows: Row[] = pls.moderations.map((mo) => {
    const j = C.indexOf(mo.to);
    const b = boot?.stats.find((s) => s.key === `path:${C[mo.construct]}:${mo.to}`);
    return [c(`${C[mo.construct]} → ${mo.to}`), c(pls.pathCoef[mo.construct][j]), c(pls.fSquare[mo.construct][j]), ...(boot ? bootCells(b) : [])];
  });
  return (
    <>
      <Table title="Interaction and quadratic effects" file="interactions" columns={['Term', 'β', 'f²', ...(boot ? bootCols(boot) : [])]} rows={rows}
        note={<>Two-stage approach (Henseler &amp; Chin 2010). β is per unit of the product of standardised scores, so the slope of the predictor at moderator level m (in SD) is β_x + β_int·m; for a quadratic term X², the slope of X at x (in SD) is β_x + 2β_q·x. f²: 0.005 small, 0.01 medium, 0.025 large for interactions (Kenny 2018).{!boot && ' Run bootstrapping for significance.'}</>} />
      <div className="tables" style={{ marginTop: 20 }}>
        {pls.moderations.map((mo) => {
          const j = C.indexOf(mo.to);
          return (
            <div key={mo.construct}>
              <div className="table-tools"><h3>{mo.from === mo.moderator ? `Quadratic effect of ${mo.from} on ${mo.to}` : `${mo.moderator} moderating ${mo.from} → ${mo.to}`}</h3></div>
              {mo.from === mo.moderator
                ? <QuadraticCurve b={pls.pathCoef[C.indexOf(mo.from)][j]} bq={pls.pathCoef[mo.construct][j]} from={mo.from} to={mo.to} width={320} height={190} />
                : <SimpleSlopes bx={pls.pathCoef[C.indexOf(mo.from)][j]} bm={pls.pathCoef[C.indexOf(mo.moderator)][j]} bint={pls.pathCoef[mo.construct][j]}
                  from={mo.from} moderator={mo.moderator} to={mo.to} width={320} height={190} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PlsTab({ tab, pls, boot, fitTest }: { tab: PlsTabId; pls: PlsResult; boot: BootstrapResult | null; fitTest: FitTestResult | null }) {
  switch (tab) {
    case 'overview': return <Overview pls={pls} boot={boot} />;
    case 'paths': return <Paths pls={pls} boot={boot} />;
    case 'effects': return <Effects pls={pls} boot={boot} />;
    case 'outer': return <Outer pls={pls} boot={boot} />;
    case 'reliability': return <Reliability pls={pls} />;
    case 'discriminant': return <Discriminant pls={pls} />;
    case 'moderation': return <Moderation pls={pls} boot={boot} />;
    case 'ipma': return <IpmaTab pls={pls} />;
    case 'fit': return <Fit pls={pls} test={fitTest} />;
    case 'correlations': return <Correlations pls={pls} />;
    case 'bootstrap': return <BootstrapTab boot={boot} />;
  }
}
