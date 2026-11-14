import { useMemo, useState } from 'react';
import type { FitTestResult } from '../../engine/bootstrap';
import { binaryModeration, originalScaleCoefficients } from '../../engine/pls';
import type { BootstrapResult, BootstrapStat, Discrepancies, PlsResult } from '../../engine/types';
import { toSpec } from '../../model/project';
import { mediationPairs } from '../../reporting/mediation';
import { csvCell, downloadText, fmt, fmtP, safeFileName } from '../../format';
import { run } from '../../runner';
import { useStore } from '../../store';
import { IconDownload, IconRepeat } from '../icons';
import { QuadraticCurve, SimpleSlopes } from '../SimpleSlopes';
import { HocTab } from './HocTab';
import { IpmaTab } from './IpmaTab';
import {
  MediationNeedsBoot,
  MediationReport,
  SpecificIndirectTable,
  totalOf,
  typeCell,
} from './MediationPanel';
import { RScriptButton } from './RScriptButton';
import { SavePlsScores } from './SaveScores';
import {
  bootCells,
  bootCols,
  c,
  htmtCls,
  loadingCls,
  matrixRows,
  relCls,
  Table,
  vifCls,
  type Cell,
  type Row,
} from './Table';

/** The bridge's notes about blank HTMT cells (mixed-sign or reverse-coded items), under the tables they concern. */
const htmtNotes = (pls: PlsResult) =>
  (pls.notes ?? [])
    .filter((n) => /HTMT|reverse-coded/.test(n))
    .map((n) => ` ${n}`)
    .join('');

export const PLS_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'paths', label: 'Path coefficients' },
  { id: 'effects', label: 'Indirect & total effects' },
  { id: 'outer', label: 'Loadings & weights' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'discriminant', label: 'Discriminant validity' },
  { id: 'hoc', label: 'Higher-order constructs' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'ipma', label: 'IPMA' },
  { id: 'fit', label: 'Model fit' },
  { id: 'correlations', label: 'Correlations' },
  { id: 'bootstrap', label: 'Bootstrapping' },
] as const;
export type PlsTabId = (typeof PLS_TABS)[number]['id'];

/** The tabs a PLS result shows: the higher-order construct check only when the model has some. */
export const plsTabsFor = (pls: PlsResult | null) =>
  pls?.higherOrder?.length ? PLS_TABS : PLS_TABS.filter((t) => t.id !== 'hoc');

function useTypes() {
  const constructs = useStore((s) => s.model.constructs);
  return useMemo(() => new Map(constructs.map((k) => [k.name, k.type])), [constructs]);
}

/** The algorithm card of the overview: "PLS", "PLSc", "OrdPLS", "GSCA", ... */
function algorithmName(pls: PlsResult): string {
  if (pls.approach === 'GSCA') return 'GSCA';
  if (pls.approach === 'PCA') return 'PCA';
  if (pls.approach === 'unit') return 'Sum scores';
  return `${pls.ordinal?.length ? 'Ord' : ''}${pls.consistent ? 'PLSc' : 'PLS'}`;
}

function algorithmTitle(pls: PlsResult): string | undefined {
  if (pls.ordinal?.length)
    return `Ordinal PLS (Schuberth, Henseler & Dijkstra, 2018; cSEM): weights, loadings and paths from polychoric and polyserial correlations of the ordinal indicators ${pls.ordinal.join(', ')}. The construct scores are the weighted standardised category codes.`;
  if (pls.approach && pls.approach !== 'PLS-PM')
    return 'cSEM’s weighting approach for every construct (Weighting approach, under Calculated by)';
  return undefined;
}

function Overview({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const project = useStore((s) => s.projectName);
  const endo = pls.constructs
    .map((name, j) => ({ name, j }))
    .filter(({ j }) => pls.rSquared[j] !== null);
  const scoresCsv = () => {
    const lines = [pls.constructs.map(csvCell).join(',')];
    for (let r = 0; r < pls.n; r++) lines.push(pls.scores.map((col) => col[r]).join(','));
    downloadText(`${safeFileName(project)}-construct-scores.csv`, lines.join('\n'), 'text/csv');
  };
  return (
    <>
      <div className="stat-cards">
        <div className="stat-card" title={algorithmTitle(pls)}>
          <div className="k">Algorithm</div>
          <div className="v">{algorithmName(pls)}</div>
        </div>
        <div className="stat-card">
          <div className="k">Observations</div>
          <div className="v">{pls.n}</div>
        </div>
        {pls.imputations && (
          <div
            className="stat-card"
            title="Estimates averaged over the imputed data sets (Rubin's point estimate)"
          >
            <div className="k">Imputed data sets</div>
            <div className="v">{pls.imputations}</div>
          </div>
        )}
        <div className="stat-card">
          <div className="k">Iterations</div>
          <div className="v">{pls.iterations}</div>
        </div>
        <div className="stat-card">
          <div className="k">Converged</div>
          <div className="v" style={{ color: pls.converged ? 'var(--good)' : 'var(--bad)' }}>
            {pls.converged ? 'Yes' : 'No'}
          </div>
        </div>
        <div
          className="stat-card"
          title={
            Number.isFinite(pls.fit.estimated.srmr)
              ? 'SRMR of the estimated model (Model fit)'
              : 'Not reported for this model (Model fit says why)'
          }
        >
          <div className="k">SRMR</div>
          <div className="v">{fmt(pls.fit.estimated.srmr)}</div>
        </div>
        <div className="stat-card">
          <div className="k">Bootstrap</div>
          <div className="v">{boot ? boot.samples : '—'}</div>
        </div>
        {pls.droppedRows > 0 && (
          <div className="stat-card">
            <div className="k">Rows dropped</div>
            <div className="v">{pls.droppedRows}</div>
          </div>
        )}
        {pls.samplingWeights && (
          <div
            className="stat-card"
            title="Weighted PLS (Becker & Ismail 2016): weighted correlations and regressions"
          >
            <div className="k">Sampling weights</div>
            <div className="v">{pls.samplingWeights}</div>
          </div>
        )}
      </div>
      <div className="tables">
        <Table
          title="Coefficient of determination"
          file="r-squared"
          columns={['Construct', 'R²', 'R² adjusted']}
          rows={endo.map(({ name, j }) => [c(name), c(pls.rSquared[j]), c(pls.adjRSquared[j])])}
          note={
            pls.consistent
              ? 'R² of the disattenuated (PLSc) model.'
              : 'Rough guide (Hair et al.): 0.75 substantial, 0.50 moderate, 0.25 weak.'
          }
        />
        <div>
          <div className="table-tools">
            <h3>Construct scores</h3>
          </div>
          <button className="btn" onClick={scoresCsv}>
            <IconDownload size={14} /> Download scores (CSV)
          </button>
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
  for (let i = 0; i < C.length; i++)
    for (let j = 0; j < C.length; j++) {
      if (!pls.hasPath[i][j]) continue;
      const f2 = pls.fSquare[i][j] ?? 0;
      const vif = pls.vifInner[i][j] ?? 1;
      const b = boot?.stats.find((s) => s.key === `path:${C[i]}:${C[j]}`);
      rows.push([
        c(`${C[i]} → ${C[j]}`),
        c(pls.pathCoef[i][j]),
        c(f2, f2 >= 0.35 ? 'good' : ''),
        c(vif, vifCls(vif)),
        ...(boot ? bootCells(b) : []),
      ]);
    }
  return (
    <Table
      title="Path coefficients"
      file="paths"
      columns={['Path', 'β', 'f²', 'VIF', ...(boot ? bootCols(boot) : [])]}
      rows={rows}
      note={
        <>
          f²: 0.02 small, 0.15 medium, 0.35 large (model re-estimated without the path). Inner VIF
          above 3 suggests collinearity.
          {!boot && ' Run bootstrapping for standard errors and p-values.'} * p&lt;.05 ** p&lt;.01
          *** p&lt;.001
        </>
      }
    />
  );
}

function Effects({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const C = pls.constructs;
  // The mediation typology (Zhao et al., 2010) from the bootstrap intervals.
  const pairs = boot
    ? mediationPairs(boot, C, (a, b) => pls.hasPath[C.indexOf(a)]?.[C.indexOf(b)] ?? false)
    : [];
  const rows = (kind: 'total' | 'indirect'): Row[] => {
    const out: Row[] = [];
    for (let i = 0; i < C.length; i++)
      for (let j = 0; j < C.length; j++) {
        const v = kind === 'total' ? pls.totalEffects[i][j] : pls.indirectEffects[i][j];
        if (i === j || Math.abs(v) < 1e-12) continue;
        const b = boot?.stats.find((s) => s.key === `${kind}:${C[i]}:${C[j]}`);
        const type = kind === 'indirect' && boot ? [typeCell(totalOf(pairs, C[i], C[j]))] : [];
        out.push([c(`${C[i]} → ${C[j]}`), c(v), ...(boot ? bootCells(b) : []), ...type]);
      }
    return out;
  };
  const ind = rows('indirect');
  return (
    <div className="tables">
      <Table
        title="Total indirect effects"
        file="indirect-effects"
        columns={[
          'Effect',
          'Estimate',
          ...(boot ? bootCols(boot) : []),
          // (the mediation type, when there is an indirect effect to classify)
          ...(boot && ind.length ? ['Type'] : []),
        ]}
        rows={ind}
        note={
          ind.length === 0
            ? 'The model has no mediated relationships.'
            : 'Sum of all indirect paths between two constructs. Type: the mediation type from the bootstrap confidence intervals (Zhao et al., 2010); see “How the type is decided” below.'
        }
      />
      {ind.length > 0 && !boot && <MediationNeedsBoot />}
      {boot && <SpecificIndirectTable pairs={pairs} boot={boot} />}
      {boot && <MediationReport pairs={pairs} boot={boot} symbol="β" />}
      <Table
        title="Total effects"
        file="total-effects"
        columns={['Effect', 'Estimate', ...(boot ? bootCols(boot) : [])]}
        rows={rows('total')}
      />
    </div>
  );
}

/** The bootstrap columns of the measurement model: p of the loading, p of the weight, the weight's CI. */
function bootSignificance(loading: BootstrapStat | undefined, weight: BootstrapStat | undefined) {
  const pc = (s: BootstrapStat | undefined) =>
    s ? c(fmtP(s.p), s.p < 0.05 ? 'good' : 'dim') : c(null);
  const weightCi = weight ? c(`[${fmt(weight.ciLow)}, ${fmt(weight.ciHigh)}]`) : c(null);
  return [pc(loading), pc(weight), weightCi];
}

const HOC_NOTE = {
  repeated:
    'Repeated indicators: the dimensions’ indicators measure the second-order construct too, and the dimensions predict it. Loading: a dimension’s correlation with the second-order construct’s scores; weight: its path coefficient. Overall fit is not reported (the copied indicators make the model-implied matrix singular).',
  embedded:
    'cSEM’s embedded two-stage approach (.approach_2ndorder = "mixed"): stage 1 uses the repeated indicators, so the second-order construct is in the model from the start; stage 2 measures it by its dimensions’ scores (corrected for attenuation when it is a common factor). Its paths and R² are stage 2’s.',
  disjoint:
    'Two-stage approach (disjoint): stage 1 estimates the first-order constructs; their scores are the indicators of the second-order construct in stage 2, which cSEM corrects for attenuation when it is a common factor. Its paths and R² are stage 2’s.',
};

function Outer({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const types = useTypes();
  const rows: Row[] = pls.indicators.map((ind, k) => {
    const cn = pls.constructs[ind.construct];
    const l = pls.loadings[k];
    const factor = types.get(cn) !== 'composite';
    const bl = boot?.stats.find((s) => s.key === `loading:${ind.name}`);
    const bw = boot?.stats.find((s) => s.key === `weight:${ind.name}`);
    return [
      c(ind.name),
      c(cn),
      c(factor ? 'factor' : 'composite', 'dim'),
      c(l, factor ? loadingCls(l) : ''),
      c(pls.weights[k]),
      c(pls.vifOuter[k], vifCls(pls.vifOuter[k])),
      ...(boot ? bootSignificance(bl, bw) : []),
    ];
  });
  // Second-order constructs (cSEM two-stage): their components play the indicators' part.
  const ho = pls.higherOrder ?? [];
  const hoRows: Row[] = ho.map((h) => {
    const hn = pls.constructs[h.construct];
    const cn = pls.constructs[h.component];
    const factor = types.get(hn) !== 'composite';
    const bl = boot?.stats.find((s) => s.key === `hoLoading:${hn}:${cn}`);
    const bw = boot?.stats.find((s) => s.key === `hoWeight:${hn}:${cn}`);
    return [
      c(cn),
      c(hn),
      c(factor ? 'factor' : 'composite', 'dim'),
      c(h.loading, factor ? loadingCls(h.loading) : ''),
      c(h.weight),
      ...(boot ? bootSignificance(bl, bw) : []),
    ];
  });
  return (
    <div className="tables">
      <Table
        title="Measurement model"
        file="outer-model"
        columns={[
          'Indicator',
          'Construct',
          'Type',
          'Loading',
          'Weight',
          'VIF',
          ...(boot ? ['p (loading)', 'p (weight)', 'Weight CI'] : []),
        ]}
        rows={rows}
        note={
          <>
            Common factors: loadings should be ≥ 0.708
            {pls.consistent ? ' (PLSc-corrected loadings λ = ĉŵ)' : ''}. Composites: interpret
            weights, their significance and VIF (&lt; 3 ideal, &gt; 5 problematic).
          </>
        }
      />
      {ho.length > 0 && (
        <Table
          title="Second-order constructs"
          file="second-order"
          columns={[
            'Component',
            'Second-order construct',
            'Type',
            'Loading',
            'Weight',
            ...(boot ? ['p (loading)', 'p (weight)', 'Weight CI'] : []),
          ]}
          rows={hoRows}
          note={
            pls.hocApproach === 'repeated' || pls.hocApproach === 'embedded'
              ? HOC_NOTE[pls.hocApproach]
              : HOC_NOTE.disjoint
          }
        />
      )}
    </div>
  );
}

function Reliability({ pls }: { pls: PlsResult }) {
  const types = useTypes();
  const rows: Row[] = pls.constructs.map((name, j) => {
    const q = pls.quality[j];
    const single = pls.indicators.filter((i) => i.construct === j).length === 1;
    if (types.get(name) === 'composite' || single) {
      return [
        c(name),
        c(single ? 'single item' : 'composite', 'dim'),
        c(null, 'dim'),
        c(null, 'dim'),
        c(null, 'dim'),
        c(null, 'dim'),
      ];
    }
    return [
      c(name),
      c('common factor', 'dim'),
      c(q.alpha, relCls(q.alpha)),
      c(q.rhoA, relCls(q.rhoA)),
      c(q.rhoC, relCls(q.rhoC)),
      c(q.ave, q.ave >= 0.5 ? 'good' : 'bad'),
    ];
  });
  const ra = Object.entries(pls.redundancy ?? {});
  return (
    <div className="tables">
      <Table
        title="Construct reliability and validity"
        file="reliability"
        columns={['Construct', 'Type', 'Cronbach’s α', 'ρA', 'ρC', 'AVE']}
        rows={rows}
        note="ρA (Dijkstra & Henseler) is the consistent reliability of a common factor. 0.70–0.95 is satisfactory. AVE ≥ 0.50 indicates convergent validity. Reliability does not apply to composites, which are defined by their weights."
      />
      {ra.length > 0 && (
        <Table
          title="Redundancy analysis"
          file="redundancy"
          columns={['Composite (Mode B)', 'Correlation']}
          rows={ra.map(([k, v]) => [c(k), c(v, v >= 0.7 ? 'good' : 'bad')])}
          note="cSEM: each Mode B composite correlated with a Mode A composite of the same indicators (Chin 1998; Hair et al. 2016); 0.70 or more is the usual threshold. With a global single item, draw a path from the composite to a single-item construct instead: its coefficient is the classic redundancy test. cSEM’s authors discourage its use for validity."
        />
      )}
    </div>
  );
}

function Discriminant({ pls }: { pls: PlsResult }) {
  const C = pls.constructs;
  const flRows: Row[] = C.map((name, i) => {
    const diag = Math.sqrt(pls.quality[i].ave);
    return [
      c(name),
      ...C.map((_, j) => {
        if (j > i) return c(null, 'dim');
        if (j === i) return { v: diag, bold: true };
        const r = pls.constructCor[i][j];
        return c(r, Math.abs(r) > diag || Math.abs(r) > Math.sqrt(pls.quality[j].ave) ? 'bad' : '');
      }),
    ];
  });
  return (
    <div className="tables">
      <Table
        title="HTMT"
        file="htmt"
        columns={['', ...C]}
        rows={matrixRows(C, (i, j) => pls.htmt[i][j], htmtCls)}
        note={`Heterotrait–monotrait ratio (Henseler, Ringle & Sarstedt 2015). Above 0.90 (0.85 for distinct concepts) indicates a problem.${htmtNotes(pls)}`}
      />
      <Table
        title="HTMT2"
        file="htmt2"
        columns={['', ...C]}
        rows={matrixRows(C, (i, j) => pls.htmt2[i][j], htmtCls)}
        note={`Geometric-mean HTMT (Roemer, Schuberth & Henseler 2021); consistent for congeneric measures.${htmtNotes(pls)}`}
      />
      <Table
        title="Fornell–Larcker criterion"
        file="fornell-larcker"
        columns={['', ...C]}
        rows={flRows}
        note="Diagonal: √AVE. Each should exceed the construct's correlations with others."
      />
    </div>
  );
}

function verdict(obs: number, hi95: number | undefined, hi99: number | undefined): Cell {
  if (hi95 === undefined || hi99 === undefined) return c('run test', 'dim');
  if (obs <= hi95) return c('fits (≤ HI95)', 'good');
  if (obs <= hi99) return c('rejected at 5%', 'bad');
  return c('rejected at 1%', 'bad');
}

const DISCREPANCY_LABEL = { srmr: 'SRMR', dULS: 'd_ULS', dG: 'd_G' } as const;

/** Why a model has no overall fit. */
function fitUnavailableReason(pls: PlsResult): string {
  if (pls.hocApproach === 'repeated')
    return 'Overall fit is not reported with repeated indicators: the copied indicators make the model-implied correlation matrix singular.';
  if (pls.hocApproach)
    return 'Overall fit is not reported for two-stage second-order models: cSEM’s discrepancies refer to one stage only.';
  if (pls.moderations.length || pls.copulas?.length) {
    const terms = pls.moderations.length ? 'interaction' : 'copula';
    return `Overall fit is not reported for models with ${terms} terms: the model-implied correlations of a nonlinear model are not defined.`;
  }
  return 'Overall fit is not available for this model (the package did not report it; see Messages).';
}

function Fit({ pls, test }: { pls: PlsResult; test: FitTestResult | null }) {
  const job = useStore((s) => s.job);
  const samples = useStore((s) => s.settings.bootSamples);
  const rows = (which: 'saturated' | 'estimated'): Row[] => {
    const obs: Discrepancies = pls.fit[which];
    return (['srmr', 'dULS', 'dG'] as const).map((k) => [
      c(DISCREPANCY_LABEL[k]),
      c(obs[k], '', 4),
      c(test ? test.hi95[which][k] : null, '', 4),
      c(test ? test.hi99[which][k] : null, '', 4),
      verdict(obs[k], test?.hi95[which][k], test?.hi99[which][k]),
    ]);
  };
  const unavailable =
    !Number.isFinite(pls.fit.estimated.srmr) && !Number.isFinite(pls.fit.saturated.srmr);
  if (unavailable) {
    return <div className="empty-results">{fitUnavailableReason(pls)}</div>;
  }
  return (
    <>
      <div className="table-tools">
        <h3>Test of overall model fit</h3>
        <button className="btn sm" onClick={() => run('fittest')} disabled={!!job}>
          <IconRepeat size={13} /> {test ? 'Re-run' : 'Run'} bootstrap test ({samples})
        </button>
        <RScriptButton what="fittest" />
      </div>
      <div className="tables">
        {(['saturated', 'estimated'] as const).map((which) => (
          <Table
            key={which}
            title={which === 'saturated' ? 'Saturated model' : 'Estimated model'}
            file={`fit-${which}`}
            columns={['Discrepancy', 'Value', 'HI95', 'HI99', 'Decision']}
            rows={rows(which)}
          />
        ))}
      </div>
      <div className="table-note">
        Discrepancies between the empirical and model-implied indicator correlation matrices
        (Dijkstra &amp; Henseler 2015). The <b>saturated</b> model freely correlates all constructs
        and tests the measurement model; the <b>estimated</b> model imposes the structural model.
        HI95/HI99 are bootstrap quantiles under the null of exact fit (data rotated to the
        model-implied matrix). Composites leave within-block correlations unrestricted; common
        factors impose λλ′. d_G uses the natural logarithm, as Dijkstra &amp; Henseler define it;
        cSEM prints it with base-10 logarithms, ln(10)² ≈ 5.30 times smaller. SRMR below 0.08 is a
        common approximate-fit heuristic.
      </div>
    </>
  );
}

function Correlations({ pls }: { pls: PlsResult }) {
  return (
    <Table
      title={pls.consistent ? 'Construct correlations (disattenuated)' : 'Construct correlations'}
      file="correlations"
      columns={['', ...pls.constructs]}
      rows={matrixRows(pls.constructs, (i, j) => pls.constructCor[i][j])}
    />
  );
}

const GROUPS: { id: BootstrapStat['group']; label: string }[] = [
  { id: 'path', label: 'Paths' },
  { id: 'indirect', label: 'Indirect' },
  { id: 'specific', label: 'Specific indirect' },
  { id: 'total', label: 'Total' },
  { id: 'loading', label: 'Loadings' },
  { id: 'weight', label: 'Weights' },
  { id: 'r2', label: 'R²' },
  { id: 'estimate', label: 'Unstandardised' },
];

/** How the bootstrap was run: subsamples, pooling over imputations, the test and the intervals. */
function bootstrapNote(boot: BootstrapResult): string {
  const engine = boot.engine ? ` Resampling by ${boot.engine.package} ${boot.engine.version}.` : '';
  if (boot.imputations)
    return (
      `${boot.samples} subsamples in each of ${boot.imputations} imputed data sets, pooled by Rubin’s rules: ` +
      'estimate = mean over the imputations; SE² = mean bootstrap variance + (1 + 1/m) × variance between imputations; ' +
      `t test with Rubin’s degrees of freedom and t-based intervals.${engine}`
    );
  const oneTailed = boot.tails === 1;
  const failed = boot.failed ? ` (${boot.failed} failed or not admissible, excluded)` : '';
  const test = oneTailed
    ? 'One-tailed t test (in the direction of the estimate)'
    : 'Two-tailed t test';
  const intervals =
    boot.interval === 'bca'
      ? 'bias-corrected and accelerated (BCa) intervals, from a jackknife'
      : 'percentile confidence intervals';
  const sided = oneTailed ? ', one-sided' : '';
  return `${boot.samples} subsamples${failed}. ${test} with df = usable samples − 1; ${intervals}${sided}.${engine}`;
}

export function BootstrapTab({ boot, std }: { boot: BootstrapResult | null; std?: boolean }) {
  const groups = GROUPS.filter((g) => boot?.stats.some((s) => s.group === g.id) ?? true);
  const [group, setGroup] = useState<BootstrapStat['group']>('path');
  if (!boot) {
    return (
      <div className="empty-results">
        No bootstrap results yet.{' '}
        <button className="btn sm" onClick={() => run('boot')}>
          <IconRepeat size={13} /> Run bootstrapping
        </button>
      </div>
    );
  }
  const stats = boot.stats.filter((s) => s.group === group);
  const groupLabel = GROUPS.find((g) => g.id === group)!.label.toLowerCase();
  const standardised = std && group !== 'estimate' ? ' (standardised)' : '';
  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div className="segmented" style={{ maxWidth: 520, flex: 1 }}>
          {groups.map((g) => (
            <button
              key={g.id}
              className={group === g.id ? 'on' : ''}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <RScriptButton what="bootstrap" />
      </div>
      <Table
        title={`Bootstrap: ${groupLabel}${standardised}`}
        file={`bootstrap-${group}`}
        columns={['Parameter', 'Original', ...bootCols(boot)]}
        rows={stats.map((s) => [c(s.label), c(s.original), ...bootCells(s)])}
        note={bootstrapNote(boot)}
      />
    </>
  );
}

/** Unstandardised and mean-centred paths: the same slopes, with and without an intercept. */
function OriginalScale({ pls }: { pls: PlsResult }) {
  const data = useStore((s) => s.data);
  const model = useStore((s) => s.model);
  const missing = useStore((s) => s.settings.missing);
  const res = useMemo(() => {
    if (!data || data.cols.length === 0) return null;
    try {
      return originalScaleCoefficients(
        data,
        toSpec(model),
        { missing },
        pls.indicators.map((x, i) => ({ name: x.name, weight: pls.weights[i] })),
      );
    } catch {
      return null;
    }
  }, [data, model, missing, pls]);
  if (!res?.length) return null;
  const rows: Row[] = res.flatMap((eq) => [
    ...eq.coefficients.map((k): Row => [c(`${k.from} → ${eq.to}`), c(k.b), c(k.b)]),
    [c(`Intercept of ${eq.to}`, 'dim'), c(eq.intercept), c(0)],
  ]);
  return (
    <div style={{ marginTop: 20 }}>
      <Table
        title="Unstandardised and mean-centred"
        file="paths-original-scale"
        columns={['Path', 'Unstandardised', 'Mean-centred']}
        rows={rows}
        note="On the indicators’ own scale: outer weights per raw unit, normalised to sum to 1 in each block (Fornell’s rescaling, as in IPMA). Centring the scores leaves the slopes as they are and takes the intercepts to 0."
      />
    </div>
  );
}

/** Moderators that are 0/1, read without standardising them (Becker et al. 2023). */
function BinaryModerators({ pls }: { pls: PlsResult }) {
  const data = useStore((s) => s.data);
  const model = useStore((s) => s.model);
  const C = pls.constructs;
  const rows: Row[] = pls.moderations.flatMap((mo): Row[] => {
    const item = model.constructs.find((k) => k.name === mo.moderator);
    const col =
      item?.indicators.length === 1
        ? data?.cols[data.names.indexOf(item.indicators[0])]
        : undefined;
    if (!col || mo.from === mo.moderator) return [];
    const j = C.indexOf(mo.to);
    const b = binaryModeration(
      pls.pathCoef[C.indexOf(mo.from)][j],
      pls.pathCoef[C.indexOf(mo.moderator)][j],
      pls.pathCoef[mo.construct][j],
      col,
    );
    return b
      ? [
          [
            c(`${mo.moderator} on ${mo.from} → ${mo.to}`),
            c(b.slopeLow),
            c(b.slopeHigh),
            c(b.difference),
            c(b.groupDifference),
          ],
        ]
      : [];
  });
  if (rows.length === 0) return null;
  return (
    <Table
      title="Binary moderators, not standardised"
      file="binary-moderators"
      columns={[
        'Moderation',
        'Slope in the lower group',
        'Slope in the higher group',
        'Difference',
        'Group difference in the outcome',
      ]}
      rows={rows}
      note="The slopes per SD of the predictor in each group of the 0/1 moderator, in SDs of the outcome, with no manual correction for its standardisation (Becker et al. 2023). The test of the difference is the interaction term’s, above."
    />
  );
}

/** Gaussian copula terms (Hult et al. 2018; Becker, Proksch & Ringle 2022 for the requirements). */
function Copulas({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  const terms = pls.copulas ?? [];
  if (terms.length === 0) return null;
  const C = pls.constructs;
  const rows: Row[] = terms.map((k) => {
    const name = C[k.construct];
    return [
      c(`${k.from} → ${k.to}`),
      c(pls.pathCoef[k.construct][C.indexOf(k.to)]),
      c(k.normality.p),
      ...(boot ? bootCells(boot.stats.find((s) => s.key === `path:${name}:${k.to}`)) : []),
    ];
  });
  const normal = terms.filter((k) => k.normality.p >= 0.05).map((k) => k.from);
  return (
    <div style={{ marginTop: 20 }}>
      <Table
        title="Endogeneity: Gaussian copulas"
        file="copulas"
        columns={[
          'Predictor → outcome',
          'γ (copula term)',
          'Normality p (Cramér–von Mises)',
          ...(boot ? bootCols(boot) : []),
        ]}
        rows={rows}
        note={
          <>
            A significant term suggests endogeneity of the predictor in that equation; the paths
            above are then the corrected estimates, and if it is not significant, estimate the model
            without the term (Hult et al. 2018; Park &amp; Gupta 2012). P* is recomputed in each
            bootstrap sample. The approach needs non-normal predictors and is unreliable in small
            samples (Becker, Proksch &amp; Ringle 2022).
            {!boot && ' Run the bootstrap to test the terms.'}
            {normal.length > 0 && (
              <>
                {' '}
                <b>{[...new Set(normal)].join(', ')}: normality is not rejected</b>, so P* is nearly
                collinear with the predictor and these results should not be relied on.
              </>
            )}
          </>
        }
      />
    </div>
  );
}

function Moderation({ pls, boot }: { pls: PlsResult; boot: BootstrapResult | null }) {
  if (pls.moderations.length === 0) {
    return (
      <div className="empty-results">
        No moderators in the model. Drag from a construct’s dot onto a path arrow to add one.
      </div>
    );
  }
  const C = pls.constructs;
  const METHOD: Record<string, string> = {
    two_stage: 'two-stage',
    orthogonal: 'orthogonalising',
    product_indicator: 'product indicators',
  };
  const methods = new Set(pls.moderations.map((mo) => mo.method ?? 'two_stage'));
  const threeRows: Row[] = (pls.threeWay ?? []).map((t) => {
    const j = C.indexOf(t.to);
    return [
      c(`${C[t.construct]} → ${t.to}`),
      c('three-way', 'dim'),
      c(pls.pathCoef[t.construct][j]),
      c(pls.fSquare[t.construct][j]),
      ...(boot
        ? bootCells(boot.stats.find((s) => s.key === `path:${C[t.construct]}:${t.to}`))
        : []),
    ];
  });
  const rows: Row[] = pls.moderations.map((mo) => {
    const j = C.indexOf(mo.to);
    const b = boot?.stats.find((s) => s.key === `path:${C[mo.construct]}:${mo.to}`);
    return [
      c(`${C[mo.construct]} → ${mo.to}`),
      c(METHOD[mo.method ?? 'two_stage'] ?? mo.method!, 'dim'),
      c(pls.pathCoef[mo.construct][j]),
      c(pls.fSquare[mo.construct][j]),
      ...(boot ? bootCells(b) : []),
    ];
  });
  return (
    <>
      <Table
        title="Interaction and quadratic effects"
        file="interactions"
        columns={['Term', 'Approach', 'β', 'f²', ...(boot ? bootCols(boot) : [])]}
        rows={[...rows, ...threeRows]}
        note={
          <>
            {methods.size === 1 && methods.has('two_stage')
              ? 'Two-stage approach (Henseler & Chin 2010): the product of the standardised construct scores of the first stage.'
              : 'Orthogonalising: products of indicators residualised on the main-effect indicators (Little, Bovaird & Widaman 2006); product indicators: every product of a predictor and a moderator indicator as the term’s indicators (Chin, Marcolin & Newsted 2003); two-stage: the product of the standardised scores (Henseler & Chin 2010).'}{' '}
            β is per unit of the (standardised) interaction term, so the slope of the predictor at
            moderator level m (in SD) is β_x + β_int·m; for a quadratic term X², the slope of X at x
            (in SD) is β_x + 2β_q·x. f²: 0.005 small, 0.01 medium, 0.025 large for interactions
            (Kenny 2018).{!boot && ' Run bootstrapping for significance.'}
          </>
        }
      />
      <BinaryModerators pls={pls} />
      <div className="tables" style={{ marginTop: 20 }}>
        {pls.moderations.map((mo) => {
          const j = C.indexOf(mo.to);
          return (
            <div key={mo.construct}>
              <div className="table-tools">
                <h3>
                  {mo.from === mo.moderator
                    ? `Quadratic effect of ${mo.from} on ${mo.to}`
                    : `${mo.moderator} moderating ${mo.from} → ${mo.to}`}
                </h3>
              </div>
              {mo.from === mo.moderator ? (
                <QuadraticCurve
                  b={pls.pathCoef[C.indexOf(mo.from)][j]}
                  bq={pls.pathCoef[mo.construct][j]}
                  from={mo.from}
                  to={mo.to}
                  width={320}
                  height={190}
                />
              ) : (
                <SimpleSlopes
                  bx={pls.pathCoef[C.indexOf(mo.from)][j]}
                  bm={pls.pathCoef[C.indexOf(mo.moderator)][j]}
                  bint={pls.pathCoef[mo.construct][j]}
                  from={mo.from}
                  moderator={mo.moderator}
                  to={mo.to}
                  width={320}
                  height={190}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PlsTab({
  tab,
  pls,
  boot,
  fitTest,
  onTab,
}: {
  tab: PlsTabId;
  pls: PlsResult;
  boot: BootstrapResult | null;
  fitTest: FitTestResult | null;
  /** Switch to another tab (the higher-order construct check links to the tables it reads). */
  onTab?: (tab: PlsTabId) => void;
}) {
  switch (tab) {
    case 'overview':
      return <Overview pls={pls} boot={boot} />;
    case 'paths':
      return (
        <>
          <Paths pls={pls} boot={boot} />
          <OriginalScale pls={pls} />
          <Copulas pls={pls} boot={boot} />
        </>
      );
    case 'effects':
      return <Effects pls={pls} boot={boot} />;
    case 'outer':
      return <Outer pls={pls} boot={boot} />;
    case 'reliability':
      return <Reliability pls={pls} />;
    case 'discriminant':
      return <Discriminant pls={pls} />;
    case 'hoc':
      return <HocTab pls={pls} boot={boot} onTab={onTab} />;
    case 'moderation':
      return <Moderation pls={pls} boot={boot} />;
    case 'ipma':
      return <IpmaTab pls={pls} />;
    case 'fit':
      return <Fit pls={pls} test={fitTest} />;
    case 'correlations':
      return <Correlations pls={pls} />;
    case 'bootstrap':
      return <BootstrapTab boot={boot} />;
  }
}
