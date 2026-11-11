import { fmt, pIs } from '../../format';
import { processJn, type At, type CpaResult } from '../../rengine/cpa';
import { JohnsonNeymanPlot } from '../JohnsonNeymanPlot';
import { RScriptButton } from './RScriptButton';
import { c, pCell, Table, type Cell, type Row } from './Table';

export const PROCESS_TABS = [
  { id: 'equations', label: 'Model & equations' },
  { id: 'effects', label: 'Direct & indirect effects' },
  { id: 'jn', label: 'Johnson–Neyman' },
] as const;
export type ProcessTabId = (typeof PROCESS_TABS)[number]['id'];

const term = (t: string[]) => (t.length ? t.join(' × ') : 'Constant');
const pathLabel = (p: string[]) => p.join(' → ');
const ciCols = (level: number) => [`${Math.round(level * 100)}% CI low`, 'CI high'];
const atCells = (mods: string[], at: At): Cell[] => mods.map((m) => c(at[m] ?? null));
/** Where the interval excludes zero. */
const sig = (lo: number, hi: number) => (lo > 0 || hi < 0 ? 'good' : 'dim');

/** The fit line under an equation: logistic, latent (SAM, no F test) or OLS. */
function equationNote(res: CpaResult, e: CpaResult['equations'][number]) {
  if (e.logistic)
    return (
      <>
        Logistic regression (Y has two values; coefficients in log-odds). −2LL ={' '}
        {fmt(e.deviance ?? NaN, 2)}, model χ²({fmt(e.df1 ?? NaN, 0)}) = {fmt(e.chisq ?? NaN, 2)}, p{' '}
        {pIs(e.p ?? NaN)}; McFadden R² = {fmt(e.mcfadden ?? NaN, 3)}, Cox &amp; Snell{' '}
        {fmt(e.coxsnell ?? NaN, 3)}, Nagelkerke {fmt(e.nagelkerke ?? NaN, 3)}. Tests are z tests.
      </>
    );
  if (e.f === null || e.p === null)
    return (
      <>
        R² = {fmt(e.r2, 3)}. Unstandardised coefficients in the latent variables’ metric (first
        item’s loading fixed to 1); a product of latent variables is SAM’s latent interaction.
      </>
    );
  return (
    <>
      R² = {fmt(e.r2, 3)}, MSE = {fmt(e.mse, 3)}, F{res.hc === 'none' ? '' : ` (${res.hc})`}(
      {fmt(e.df1 ?? NaN, 0)}, {fmt(e.df2 ?? NaN, 0)}) = {fmt(e.f, 2)}, p {pIs(e.p)}. Unstandardised
      OLS coefficients; products are of the variables as entered (not mean-centred, as PROCESS by
      default).
    </>
  );
}

/** How the direct effect's standard errors and tests were computed. */
function directEffectNote(res: CpaResult): string {
  if (res.inference === 'montecarlo')
    return 'Monte Carlo standard errors, p values and percentile intervals (manymome::do_mc).';
  if (res.binaryY)
    return 'In log-odds (logistic regression for the dichotomous Y): maximum-likelihood standard errors and z tests, as PROCESS.';
  if (res.hc === 'none') return 'OLS standard errors and t tests, as PROCESS.';
  return `${res.hc} heteroskedasticity-consistent standard errors and t tests, as PROCESS’s hc option.`;
}

function Equations({ res, title, level }: { res: CpaResult; title: string; level: number }) {
  return (
    <div className="tables">
      <div className="hint">
        {title}:{' '}
        {res.inference === 'montecarlo' ? (
          <>
            latent variables ({res.latent.join(', ')}) estimated by structural-after-measurement
            (lavaan::sam, two-step standard errors), {res.equations.length} structural equation
            {res.equations.length === 1 ? '' : 's'}
          </>
        ) : (
          <>
            {res.equations.length} OLS regression{res.equations.length === 1 ? '' : 's'}
          </>
        )}
        , n = {res.n} (listwise deletion).
        {res.moderators.length > 0 && (
          <>
            {' '}
            Moderators probed at{' '}
            {res.moderators
              .map((m) => `${m.name} = ${m.values.map((v) => fmt(v, 3)).join(', ')}`)
              .join('; ')}
            .
          </>
        )}
      </div>
      {res.equations.map((e) => (
        <div key={e.outcome} className="tables">
          <Table
            title={`Outcome: ${e.outcome}`}
            file={`process-${e.outcome}`}
            columns={[
              'Term',
              'Coefficient',
              res.hc === 'none' ? 'Std. error' : `Std. error (${res.hc})`,
              res.inference === 'montecarlo' ? 'z' : 't',
              'p',
              ...ciCols(level),
            ]}
            rows={e.coefficients.map(
              (k): Row => [
                c(term(k.term)),
                c(k.est),
                c(k.se),
                c(k.t),
                pCell(k.p),
                c(k.lo),
                c(k.hi),
              ],
            )}
            note={equationNote(res, e)}
          />
          {e.interactions.length > 0 && (
            <Table
              title={`Highest-order interaction${e.interactions.length > 1 ? 's' : ''} in ${e.outcome}`}
              file={`process-interactions-${e.outcome}`}
              columns={[
                'Interaction',
                'R² change',
                res.hc === 'none' ? 'F' : `F (${res.hc})`,
                'df1',
                'df2',
                'p',
              ]}
              rows={e.interactions.map((t) => [
                c(
                  t.terms.length > 1
                    ? `Jointly: ${t.terms.map(term).join(', ')}`
                    : term(t.terms[0]),
                ),
                c(t.r2change, '', 4),
                c(t.f),
                c(t.df1, '', 0),
                c(t.df2, '', 0),
                pCell(t.p),
              ])}
              note="Unconditional tests: how much R² rises when the product term(s) enter the equation, with the F test of their coefficients (as PROCESS). Lower-order terms stay in both models."
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Effects({ res, level }: { res: CpaResult; level: number }) {
  const d = res.direct;
  const indexName = {
    mm: 'Index of moderated mediation',
    partial: 'Index of partial moderated mediation',
    mmm: 'Index of moderated moderated mediation',
    cmm: 'Conditional index of moderated mediation',
  } as const;
  return (
    <div className="tables">
      {res.counterfactual && (
        <Table
          title={`Counterfactual effects of moving X from ${fmt(res.counterfactual.xref, 3)} to ${fmt(res.counterfactual.xcf, 3)}`}
          file="process-counterfactual"
          columns={['Effect', 'Estimate', 'Boot SE', ...ciCols(level)]}
          rows={res.counterfactual.effects.map((e) => [
            c(e.label),
            { v: e.est, cls: sig(e.lo, e.hi) },
            c(e.se),
            c(e.lo),
            c(e.hi),
          ])}
          note="X moderates its own M → Y paths, so direct and indirect effects are defined counterfactually (VanderWeele, 2015; PROCESS’s xmint): the pure natural direct effect holds the mediators at the values they take at the reference value of X, the controlled direct effect at their means, and the total natural indirect effect evaluates M → Y at the counterfactual value. Percentile bootstrap intervals."
        />
      )}
      {res.coding && (
        <Table
          title={`Coding of ${res.coding.x} (${res.coding.coding})`}
          file="process-coding"
          columns={[res.coding.x, ...res.coding.names]}
          rows={res.coding.table.map((row, g) => [
            c(String(res.coding!.levels[g])),
            ...row.map((v) => c(v)),
          ])}
          note="Each code is a relative effect: indicator coding compares each group with the first; sequential with the previous group; Helmert with the mean of the later groups; effect coding with the unweighted mean of all groups."
        />
      )}
      {res.directs.map((dd) => (
        <Table
          key={dd.x}
          title={`Relative ${dd.moderators.length ? 'conditional ' : ''}direct effect of ${dd.x} on Y`}
          file={`process-direct-${dd.x}`}
          columns={[...dd.moderators, 'Effect', 'Std. error', 't', 'p', ...ciCols(level)]}
          rows={dd.rows.map((r) => [
            ...atCells(dd.moderators, r.at),
            c(r.est),
            c(r.se),
            c(r.t),
            pCell(r.p),
            c(r.lo),
            c(r.hi),
          ])}
        />
      ))}
      {d && (
        <Table
          title={
            d.moderators.length ? 'Conditional direct effect of X on Y' : 'Direct effect of X on Y'
          }
          file="process-direct"
          columns={[
            ...d.moderators,
            'Effect',
            res.inference === 'montecarlo' ? 'MC SE' : 'Std. error',
            ...(res.inference === 'montecarlo' ? [] : [res.binaryY ? 'z' : 't']),
            'p',
            ...ciCols(level),
          ]}
          rows={d.rows.map((r) => [
            ...atCells(d.moderators, r.at),
            c(r.est),
            c(r.se),
            ...(res.inference === 'montecarlo' ? [] : [c(r.t)]),
            pCell(r.p),
            c(r.lo),
            c(r.hi),
          ])}
          note={directEffectNote(res)}
        />
      )}
      {res.indirect.map((p) => (
        <Table
          key={pathLabel(p.path)}
          title={`${p.moderators.length ? 'Conditional indirect effect' : 'Indirect effect'}: ${pathLabel(p.path)}`}
          file={`process-indirect-${p.path.join('-')}`}
          columns={[
            ...p.moderators,
            'Effect',
            res.inference === 'montecarlo' ? 'MC SE' : 'Boot SE',
            ...ciCols(level),
          ]}
          rows={p.rows.map((r) => [
            ...atCells(p.moderators, r.at),
            { v: r.est, cls: sig(r.lo, r.hi) },
            c(r.se),
            c(r.lo),
            c(r.hi),
          ])}
        />
      ))}
      {res.total && (
        <Table
          title="Total indirect effect"
          file="process-total-indirect"
          columns={[
            'Effect',
            res.inference === 'montecarlo' ? 'MC SE' : 'Boot SE',
            ...ciCols(level),
          ]}
          rows={[
            [
              { v: res.total.est, cls: sig(res.total.lo, res.total.hi) },
              c(res.total.se),
              c(res.total.lo),
              c(res.total.hi),
            ],
          ]}
        />
      )}
      {res.indices.length > 0 && (
        <Table
          title="Indices of moderated mediation"
          file="process-indices"
          columns={[
            'Indirect effect',
            'Index',
            'Moderator',
            'At',
            'Value',
            res.inference === 'montecarlo' ? 'MC SE' : 'Boot SE',
            ...ciCols(level),
          ]}
          rows={res.indices.map((i) => [
            c(pathLabel(i.path)),
            c(indexName[i.kind]),
            c(i.moderator ?? '—'),
            c(
              i.at
                ? Object.entries(i.at)
                    .map(([k, v]) => `${k} = ${fmt(v, 3)}`)
                    .join(', ')
                : '—',
            ),
            { v: i.est, cls: sig(i.lo, i.hi) },
            c(i.se),
            c(i.lo),
            c(i.hi),
          ])}
          note={`A confidence interval that excludes zero (green) is evidence that the indirect effect depends on the moderator (Hayes, 2015; 2018). Indices are differences of conditional indirect effects, with percentile intervals from the same ${res.inference === 'montecarlo' ? 'Monte Carlo draws' : 'bootstrap samples'}.`}
        />
      )}
      {res.indirect.length > 0 && (
        <div className="hint">
          {res.inference === 'montecarlo' ? (
            <>
              Monte Carlo confidence intervals, {res.boot.samples} draws from the sampling
              distribution of the SAM estimates (manymome::do_mc; Preacher &amp; Selig, 2012).
              Green: the interval excludes zero.
            </>
          ) : (
            <>
              Percentile bootstrap confidence intervals, {res.boot.samples} samples
              (manymome::do_boot: cases resampled, every equation refitted). Green: the interval
              excludes zero.
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Where the Johnson–Neyman boundaries were searched, and with which standard errors. */
function jnNote(res: CpaResult, j: CpaResult['jn'][number], level: number): string {
  const alpha = +(1 - level).toFixed(3);
  const significant = `where the conditional effect of ${j.from} is just significant at α = ${alpha}`;
  if (j.latent)
    return (
      `Johnson–Neyman: values of the latent moderator ${j.moderator} (mean 0, SD ${fmt(j.sd, 3)}; searched within ±3 SD) ` +
      `${significant} (two-step SAM standard errors, z test). A latent variable has no observed cases to count.`
    );
  const errors =
    res.inference === 'montecarlo'
      ? 'two-step SAM standard errors, z test'
      : 'OLS standard errors, t with the residual df';
  const range = `observed range ${fmt(j.range[0], 2)} to ${fmt(j.range[1], 2)}`;
  return `Johnson–Neyman: values of ${j.moderator} (${range}) ${significant} (${errors}).`;
}

function JohnsonNeymanTab({ res, level }: { res: CpaResult; level: number }) {
  if (!res.jn.length)
    return (
      <div className="empty-results">
        No path is moderated by a single moderator, so there is no Johnson–Neyman region to find.
      </div>
    );
  return (
    <div className="tables">
      {res.jn.map((j) => (
        <div key={`${j.from}-${j.to}-${j.moderator}`}>
          <Table
            title={`Effect of ${j.from} on ${j.to} across ${j.moderator}`}
            file={`process-jn-${j.from}-${j.to}`}
            columns={[`${j.moderator} at the boundary`, '% of cases below', '% above']}
            rows={
              j.bounds.length
                ? j.bounds.map((b) => [c(b.value), c(b.below, '', 1), c(b.above, '', 1)])
                : [
                    [
                      c(j.latent ? 'none within ±3 SD' : 'none within the observed range', 'dim'),
                      c(null),
                      c(null),
                    ],
                  ]
            }
            note={jnNote(res, j, level)}
          />
          <JohnsonNeymanPlot
            jn={processJn(j)}
            from={j.from}
            moderator={j.moderator}
            to={j.to}
            center={j.mean}
            level={level}
            width={420}
            height={220}
          />
        </div>
      ))}
    </div>
  );
}

export function ProcessTab({
  tab,
  res,
  title,
  level,
}: {
  tab: ProcessTabId;
  res: CpaResult;
  title: string;
  level: number;
}) {
  return (
    <>
      <div className="table-tools">
        <div className="spacer" />
        <RScriptButton what="model" />
      </div>
      {tab === 'equations' ? (
        <Equations res={res} title={title} level={level} />
      ) : tab === 'effects' ? (
        <Effects res={res} level={level} />
      ) : (
        <JohnsonNeymanTab res={res} level={level} />
      )}
    </>
  );
}
