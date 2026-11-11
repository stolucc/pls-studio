import { ComputeSettings } from '../ComputeSettings';
import { STUDENTIZED_INNER } from '../../engine/bootstrap';
import { validateModel, type Settings } from '../../model/project';
import { useStore } from '../../store';
import { OrderedPicker } from '../OrderedPicker';
import { IconAlert } from '../icons';
import { switchMethod } from '../../methodSwitch';
import { exportRScript } from '../../io';
import { processGraph } from '../../process/fromModel';

// The sections of the model inspector (Inspector.tsx), each reading the store for what it shows.

/** A numeric setting, clamped to [min, max]. */
function NumField({
  label,
  field: key,
  min,
  max,
  step = 1,
}: {
  label: string;
  field: keyof Settings;
  min: number;
  max: number;
  step?: number;
}) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v))
            setSettings({ [key]: Math.min(max, Math.max(min, v)) } as Partial<Settings>);
        }}
      />
    </div>
  );
}

const ESTIMATORS: { id: Settings['estimator']; label: string; hint: string }[] = [
  {
    id: 'ML',
    label: 'maximum likelihood',
    hint: 'Normal-theory ML with expected-information standard errors.',
  },
  {
    id: 'MLM',
    label: 'robust, Satorra–Bentler',
    hint: 'ML estimates, robust (sandwich) standard errors and the Satorra–Bentler scaled χ². For non-normal continuous data.',
  },
  {
    id: 'MLMV',
    label: 'robust, mean- and variance-adjusted',
    hint: 'ML estimates, robust standard errors and a scaled-and-shifted χ²; better small-sample behaviour than MLM.',
  },
  {
    id: 'MLR',
    label: 'robust, Huber–White / Yuan–Bentler',
    hint: 'ML estimates, observed-information sandwich standard errors and the Yuan–Bentler scaled χ² (Mplus variant).',
  },
  {
    id: 'WLS',
    label: 'distribution-free (ADF / AGLS)',
    hint: 'Browne’s asymptotically distribution-free estimator (EQS’s AGLS, lavaan’s WLS): weights from the fourth-order moments of the data, so no normality is assumed; needs large samples (several hundred cases or more). Raw data, or a covariance matrix with its NACOV matrix.',
  },
  {
    id: 'GLS',
    label: 'generalised least squares',
    hint: 'Weights residuals by S⁻¹. Uses the unbiased covariance matrix.',
  },
  {
    id: 'WLSMV',
    label: 'robust weighted least squares (ordinal)',
    hint: 'Diagonally weighted least squares on polychoric correlations, with robust standard errors and a mean- and variance-adjusted χ² (Muthén; lavaan). The estimator for ordinal indicators (mark them with right-click → Treat as ordinal). Needs the R engine.',
  },
  {
    id: 'RML',
    label: 'robust ML, case-weighted (rsem)',
    hint: 'Yuan & Zhang’s robust ML: atypical cases are down-weighted (Huber-type weights) in the means and covariances, which are estimated by EM using every case with missing values; the model is fitted to them by ML with robust standard errors and the rescaled χ² (TRML). For outliers and heavy tails. One group of continuous indicators; needs the R engine.',
  },
  {
    id: 'ULS',
    label: 'unweighted least squares',
    hint: 'Unweighted residuals; no χ² p-value. Standard errors are not robust: prefer bootstrapping.',
  },
  {
    id: '2SLS',
    label: 'MIIV two-stage least squares',
    hint: 'Bollen’s model-implied instrumental variables: each equation estimated separately by 2SLS, robust to misspecification in other equations, with a Sargan test per equation. Variances and covariances are estimated afterwards with the coefficients held fixed (as MIIVsem’s var.cov), which gives standardised values; there is no global fit test.',
  },
];

/** Checks: the issues validateModel finds, each selecting its construct; some offer a fix. */
export function ModelChecks() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const select = useStore((s) => s.select);
  const issues = validateModel(model, data, settings);
  const readOnlyChecks = useStore((s) => s.cloud?.role === 'viewer');
  return (
    <div className="section">
      <div className="section-title">Checks</div>
      {issues.length === 0 ? (
        <div className="hint">No problems found. Ready to calculate.</div>
      ) : (
        issues.map((iss, k) => (
          <div
            key={k}
            className={`issue ${iss.level}${iss.constructId ? ' clickable' : ''}`}
            onClick={() => iss.constructId && select('construct', iss.constructId)}
          >
            <IconAlert size={14} /> <span>{iss.message}</span>
            {iss.action === 'count-integration' && (
              <span className="issue-actions">
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void import('../../analyses/quadml').then((m) => m.openDiagramIntegration());
                  }}
                >
                  Estimate by integration
                </button>
              </span>
            )}
            {iss.action === 'exogenous-correlations' && !readOnlyChecks && (
              <span className="issue-actions">
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    useStore.getState().resolveExogenousCorrelations(true);
                  }}
                >
                  Correlate them
                </button>
                <button
                  className="btn sm ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    useStore.getState().resolveExogenousCorrelations(false);
                  }}
                >
                  Keep uncorrelated
                </button>
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** CB-SEM: covariances fixed at zero (not drawn), each freed again with a click. */
export function ZeroCovariances() {
  const model = useStore((s) => s.model);
  const deleteItems = useStore((s) => s.deleteItems);
  return (
    <div className="section">
      <div className="section-title">Covariances fixed at zero</div>
      <div className="hint" style={{ marginBottom: 6 }}>
        Not drawn: in a path diagram, no arrow means zero. Exogenous constructs otherwise covary
        freely.
      </div>
      {(model.correlations ?? [])
        .filter((k) => k.zero)
        .map((k) => {
          const nm = (id: string) => model.constructs.find((c) => c.id === id)?.name ?? id;
          return (
            <div className="ind" key={k.id}>
              <span>
                {nm(k.a)} ↔ {nm(k.b)}
              </span>
              <span />
              <button
                className="btn sm ghost always"
                onClick={() => deleteItems([], [], [], [k.id])}
                title="Let them covary freely again"
              >
                Free
              </button>
            </div>
          );
        })}
    </div>
  );
}

/** Method: PLS-SEM, CB-SEM or CPA. */
export function MethodChoice() {
  const settings = useStore((s) => s.settings);
  const pls = settings.method === 'pls';
  const proc = settings.method === 'process';
  return (
    <div className="section">
      <div className="section-title">Method</div>
      <div className="segmented">
        <button className={pls ? 'on' : ''} onClick={() => void switchMethod('pls')}>
          PLS-SEM
        </button>
        <button
          className={settings.method === 'cbsem' ? 'on' : ''}
          onClick={() => void switchMethod('cbsem')}
        >
          CB-SEM
        </button>
        <button className={proc ? 'on' : ''} onClick={() => void switchMethod('process')}>
          CPA
        </button>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {pls
          ? 'Variance-based: common factors and composites. Turn on PLSc for consistent estimates of common-factor models.'
          : proc
            ? 'Conditional process analysis (Hayes): mediation, moderation and moderated mediation with observed variables or scale means, one OLS regression per outcome, bootstrap confidence intervals for indirect effects.'
            : 'Covariance-based SEM. Common factors only; first loading of each factor fixed to 1.'}
      </div>
    </div>
  );
}

/** Conditional process analysis: calculated by manymome. */
export function ProcessEngine({ where }: { where: string }) {
  return (
    <div className="section">
      <div className="section-title">Calculated by</div>
      <div className="hint">
        manymome (Cheung &amp; Cheung, 2024), running {where}: OLS regressions (lm), the percentile
        bootstrap of indirect effects and conditional effects at moderator values. Every numbered
        model was checked against PROCESS for R on the same data. Your data never leave this
        computer.
      </div>
      <button
        className="btn sm"
        style={{ marginTop: 8 }}
        onClick={() => void exportRScript()}
        title="Download the R script for this analysis (data embedded): exactly what runs here. Open it in R or RStudio to reproduce the results."
      >
        Export R script
      </button>
    </div>
  );
}

/** PLS-SEM: the approach for second-order constructs. */
export function HocApproach() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="section">
      <div className="section-title">Second-order constructs</div>
      <div className="segmented" role="radiogroup" aria-label="Second-order approach">
        {(['two_stage', 'embedded', 'repeated'] as const).map((id) => (
          <button
            key={id}
            role="radio"
            aria-checked={settings.hocApproach === id}
            className={settings.hocApproach === id ? 'on' : ''}
            onClick={() => setSettings({ hocApproach: id })}
          >
            {id === 'two_stage'
              ? 'Two-stage'
              : id === 'embedded'
                ? 'Embedded two-stage'
                : 'Repeated indicators'}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {settings.hocApproach === 'two_stage'
          ? 'Disjoint two-stage (Sarstedt et al., 2019): the first-order constructs are estimated without the second-order construct; their scores are then its indicators. cSEM’s .approach_2ndorder = "2stage", seminr’s two_stage.'
          : settings.hocApproach === 'embedded'
            ? 'Embedded two-stage (Ringle, Sarstedt & Straub, 2012): the first stage uses the repeated indicators, so the second-order construct is in the model from the start; its dimensions’ scores are then its indicators. cSEM’s .approach_2ndorder = "mixed"; not in seminr.'
            : 'Repeated indicators (Lohmöller, 1989; Becker, Klein & Wetzels, 2012): the dimensions’ indicators also measure the second-order construct, and the dimensions predict it. Written out as on cSEM’s help page (indicators copied) and as a seminr composite of the repeated items. Antecedents of the second-order construct are absorbed by its dimensions (R² near 1): with antecedents, use a two-stage approach.'}
      </div>
    </div>
  );
}

/** Calculated by: R packages (which) or the built-in engine. */
export function EngineChoice({ where }: { where: string }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const pls = settings.method === 'pls';
  return (
    <div className="section">
      <div className="section-title">Calculated by</div>
      <div className="segmented" role="radiogroup" aria-label="Calculation engine">
        <button
          role="radio"
          aria-checked={settings.engine === 'r'}
          className={settings.engine === 'r' ? 'on' : ''}
          onClick={() => setSettings({ engine: 'r' })}
        >
          R packages
        </button>
        <button
          role="radio"
          aria-checked={settings.engine === 'builtin'}
          className={settings.engine === 'builtin' ? 'on' : ''}
          onClick={() => setSettings({ engine: 'builtin' })}
        >
          Built-in
        </button>
      </div>
      {settings.engine === 'r' && pls && (
        <div
          className="segmented"
          role="radiogroup"
          aria-label="PLS package"
          style={{ marginTop: 8 }}
        >
          {(['cSEM', 'seminr'] as const).map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={settings.plsPackage === p}
              className={settings.plsPackage === p ? 'on' : ''}
              onClick={() => setSettings({ plsPackage: p })}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      {settings.engine === 'r' && pls && settings.plsPackage === 'cSEM' && (
        <>
          <div
            className="hint"
            style={{ marginTop: 8 }}
            title="cSEM's .approach_weights: PLS path modeling uses each construct's own mode (Inspector, Outer weights); the others weight every construct the same way"
          >
            Weighting approach (all constructs, cSEM)
          </div>
          <div
            className="segmented"
            role="radiogroup"
            aria-label="Weighting approach (all constructs, cSEM)"
            style={{ marginTop: 4 }}
          >
            {(
              [
                ['PLS-PM', 'PLS-PM', 'Partial least squares path modeling'],
                [
                  'GSCA',
                  'GSCA',
                  'Generalized structured component analysis (Hwang & Takane 2004): weights from one global least-squares criterion; with PLSc on, GSCAm for common factors',
                ],
                [
                  'PCA',
                  'PCA',
                  'Principal component analysis: each construct is the first principal component of its indicators',
                ],
                [
                  'unit',
                  'Sum scores',
                  'Sum-score regression: each construct is the (standardised) sum of its indicators, then regressions among them',
                ],
              ] as const
            ).map(([id, l, tip]) => (
              <button
                key={id}
                role="radio"
                aria-checked={settings.plsApproach === id}
                className={settings.plsApproach === id ? 'on' : ''}
                onClick={() => setSettings({ plsApproach: id })}
                title={tip}
              >
                {l}
              </button>
            ))}
          </div>
        </>
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
        {settings.engine === 'r' &&
          ' The first calculation loads the packages; your data never leave this computer. Monte Carlo simulation also runs in R (lavaan::simulateData, cSEM, lavaan).'}
      </div>
      {settings.engine === 'r' && <ComputeSettings />}
      <button
        className="btn sm"
        style={{ marginTop: 8 }}
        onClick={() => void exportRScript()}
        title="Download the R script for this model (data embedded): exactly what the R engine runs. Open it in R or RStudio to reproduce the results."
      >
        Export R script
      </button>
    </div>
  );
}

/** CB-SEM: latent interactions by product indicators, LMS or QML. */
export function LatentInteractions() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="section">
      <div className="section-title">Latent interactions</div>
      <div className="segmented">
        {(
          [
            ['product', 'Product indicators'],
            ['lms', 'LMS'],
            ['qml', 'QML'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={settings.interaction === id ? 'on' : ''}
            onClick={() => setSettings({ interaction: id })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {settings.interaction === 'product'
          ? 'Products of mean-centred indicators (Marsh, Wen & Hau, 2004), estimated by lavaan with the usual fit statistics.'
          : settings.interaction === 'lms'
            ? 'Latent moderated structural equations (Klein & Moosbrugger, 2000; modsem): maximum likelihood for the latent product itself, without product indicators; usually the most efficient. Fit statistics are for the model without the interaction.'
            : 'Quasi-maximum likelihood (Klein & Muthén, 2007; modsem): close to LMS, more robust to non-normal indicators. Fit statistics are for the model without the interaction.'}
        {settings.interaction !== 'product' &&
          ' Bootstrap: cases are resampled and the model refitted with modsem, which is slow (LMS: seconds per sample); try 200 samples first.'}
      </div>
    </div>
  );
}

/** CB-SEM: the estimator and its options (information, parameterisation, WLSMV standard errors, χ² convention, baseline). */
export function EstimatorOptions() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setInformation = useStore((s) => s.setInformation);
  const setParameterization = useStore((s) => s.setParameterization);
  const setWlsmvSe = useStore((s) => s.setWlsmvSe);
  const setMimic = useStore((s) => s.setMimic);
  const setBaseline = useStore((s) => s.setBaseline);
  const setConvention = useStore((s) => s.setConvention);
  const readOnlyChecks = useStore((s) => s.cloud?.role === 'viewer');
  return (
    <div className="section">
      <div className="section-title">Estimator</div>
      <select
        className="select"
        value={settings.estimator}
        onChange={(e) => setSettings({ estimator: e.target.value as Settings['estimator'] })}
      >
        {ESTIMATORS.map((e) => (
          <option key={e.id} value={e.id}>
            {e.id} — {e.label}
          </option>
        ))}
      </select>
      <div className="hint" style={{ marginTop: 8 }}>
        {ESTIMATORS.find((e) => e.id === settings.estimator)?.hint}
      </div>
      {settings.estimator === 'ML' && (
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={model.information === 'observed'}
            disabled={readOnlyChecks}
            onChange={(e) => setInformation(e.target.checked ? 'observed' : null)}
          />
          <span>
            Standard errors from the observed information
            <br />
            <span className="hint">
              The second derivatives of the log-likelihood at the estimates (lavaan information =
              “observed”; the default of Mplus for ML) instead of lavaan’s expected information.
              Estimates and χ² are the same; standard errors differ slightly.
            </span>
          </span>
        </label>
      )}
      {(model.ordered?.length ?? 0) > 0 && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="cb-parameterization">Ordinal indicators: parameterisation</label>
          <select
            id="cb-parameterization"
            className="select"
            disabled={readOnlyChecks}
            value={model.parameterization ?? 'delta'}
            onChange={(e) => setParameterization(e.target.value === 'theta' ? 'theta' : null)}
          >
            <option value="delta">Delta (default): scale factors</option>
            <option value="theta">Theta: residual variances</option>
          </select>
          <div className="hint">
            How the latent response behind each ordinal indicator is scaled. Delta fixes its total
            variance at 1; theta fixes its residual variance at 1, so residual variances can be held
            or freed (right-click an indicator), as in Mplus PARAMETERIZATION = THETA. The fit is
            the same; the scale of the estimates differs.
          </div>
        </div>
      )}
      {settings.estimator === 'WLSMV' && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="cb-wlsmv-se">Standard errors</label>
          <select
            id="cb-wlsmv-se"
            className="select"
            disabled={readOnlyChecks}
            value={model.wlsmvSe ?? 'mplus'}
            onChange={(e) => setWlsmvSe(e.target.value === 'lavaan' ? 'lavaan' : null)}
          >
            <option value="mplus">Mplus / classic WLSMV (default)</option>
            <option value="lavaan">lavaan 0.7 (observed information in the sandwich)</option>
          </select>
          <div className="hint">
            {model.wlsmvSe === 'lavaan'
              ? 'lavaan 0.7’s default: the observed information (the Hessian) in the sandwich’s bread, and the covariance matrix of the estimates divided by N − G. Estimates and the test statistic are the same; the standard errors differ from Mplus’s, in models with covariates or exploratory rotations by up to several times.'
              : 'As Mplus and lavaan up to 0.7-1 (Muthén, du Toit & Spisic 1997): the expected information (Δ′WΔ)⁻¹ in the sandwich (information.bread = “expected”) and the covariance matrix of the estimates divided by N. Estimates and the test statistic do not change. With sampling clusters or weights lavaan’s own standard errors are kept.'}
          </div>
          <label className="check" style={{ marginTop: 8 }}>
            <input
              type="checkbox"
              checked={model.mimic === 'Mplus'}
              disabled={readOnlyChecks}
              onChange={(e) => setMimic(e.target.checked ? 'Mplus' : null)}
            />
            <span>
              Test statistic as Mplus
              <br />
              <span className="hint">
                lavaan’s mimic = “Mplus” (with gamma.vcov.mplus = FALSE): the mean- and
                variance-adjusted χ² Mplus prints, and Mplus’s handling of covariates with mixed
                continuous and ordinal outcomes; estimates can move in the third decimal. With
                groups the options mimic sets for the test statistic are written out (mimic itself
                would also hold loadings and thresholds equal in a configural model), so the groups’
                equalities stay those chosen here.
              </span>
            </span>
          </label>
        </div>
      )}
      {['ML', 'MLM', 'MLMV', 'MLR'].includes(settings.estimator) && (
        <div className="field" style={{ marginTop: 8 }}>
          <label htmlFor="cb-convention">Sample size in χ²</label>
          <select
            id="cb-convention"
            className="select"
            disabled={readOnlyChecks}
            value={
              model.likelihood === 'wishart'
                ? 'wishart'
                : model.sampleCovRescale === false
                  ? 'asGiven'
                  : 'lavaan'
            }
            onChange={(e) => setConvention(e.target.value as 'lavaan' | 'wishart' | 'asGiven')}
          >
            <option value="lavaan">N (lavaan, Mplus)</option>
            <option value="wishart">
              N − 1, Wishart likelihood (LISREL, EQS, Amos, the sem package)
            </option>
            {data?.moments && (
              <option value="asGiven">
                N, the covariance matrix as given (sample.cov.rescale = FALSE)
              </option>
            )}
          </select>
          <div className="hint">
            Programs differ in whether χ² uses N or N − 1 and whether a covariance matrix is
            rescaled to its maximum-likelihood version; choose the convention of the program whose
            results you reproduce. Estimates of coefficients and loadings are the same; χ² and
            variances differ by a factor near N / (N − 1).
          </div>
        </div>
      )}
      {settings.estimator !== '2SLS' && (
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={model.baseline === 'independence'}
            disabled={readOnlyChecks}
            onChange={(e) => setBaseline(e.target.checked ? 'independence' : null)}
          />
          <span>
            CFI and TLI against uncorrelated variables
            <br />
            <span className="hint">
              The baseline model in which every variable is uncorrelated (LISREL’s; lavaan’s when
              the syntax writes the covariances of exogenous variables out). By default the
              covariances among exogenous observed variables stay free in the baseline, as in Mplus
              and lavaan with fixed.x. Only matters with two or more exogenous observed variables.
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

/** PLS-SEM: PLSc, the inner weighting scheme and the stop criteria. */
export function PlsAlgorithm() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="section">
      <div className="section-title">PLS algorithm</div>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.consistent}
          onChange={(e) => setSettings({ consistent: e.target.checked })}
        />
        <span>
          <b>Consistent PLS (PLSc)</b>
          <br />
          <span className="hint">
            Corrects common factors for attenuation using ρA (Dijkstra &amp; Henseler, 2015).
          </span>
        </span>
      </label>
      <div className="field">
        <label>Inner weighting scheme</label>
        <div className="segmented">
          {(['path', 'factor', 'centroid'] as const).map((s) => (
            <button
              key={s}
              className={settings.scheme === s ? 'on' : ''}
              onClick={() => setSettings({ scheme: s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="row2">
        <NumField label="Max iterations" field="maxIter" min={10} max={10000} />
        <NumField label="Stop criterion 10^−x" field="stopExp" min={3} max={12} />
      </div>
    </div>
  );
}

/** Conditional process analysis: probing, counterfactual values of X, HC standard errors. */
export function ProcessOptions() {
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="section">
      <div className="field">
        <label>Probe moderators at</label>
        <div className="segmented">
          <button
            className={settings.probe === 'percentiles' ? 'on' : ''}
            onClick={() => setSettings({ probe: 'percentiles' })}
          >
            16th / 50th / 84th pct.
          </button>
          <button
            className={settings.probe === 'meansd' ? 'on' : ''}
            onClick={() => setSettings({ probe: 'meansd' })}
          >
            Mean ± 1 SD
          </button>
        </div>
      </div>
      <div className="hint">
        Percentiles are PROCESS’s default. A moderator with two values is probed at both. Missing
        values: listwise deletion, as PROCESS.
      </div>
      {processGraph(model).graph?.moderations.some(
        (m) => m.by === processGraph(model).graph!.x,
      ) && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Counterfactual effects: X from … to …</label>
          <div className="row2">
            {(['xref', 'xcf'] as const).map((k) => (
              <input
                key={k}
                className="input num"
                type="number"
                step="any"
                placeholder={k === 'xref' ? 'reference (auto)' : 'counterfactual (auto)'}
                value={settings.counterfactual?.[k] ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value);
                  const cur = settings.counterfactual;
                  if (v === null || !Number.isFinite(v)) setSettings({ counterfactual: null });
                  else
                    setSettings({
                      counterfactual: {
                        xref: k === 'xref' ? v : (cur?.xref ?? 0),
                        xcf: k === 'xcf' ? v : (cur?.xcf ?? 1),
                      },
                    });
                }}
              />
            ))}
          </div>
          <div className="hint">
            X moderates its own M → Y paths: direct and indirect effects compare these two values of
            X. Empty: a binary X’s two values, otherwise its mean and one SD above.
          </div>
        </div>
      )}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Standard errors of the regressions</label>
        <select
          className="select"
          value={settings.hc}
          onChange={(e) => setSettings({ hc: e.target.value as Settings['hc'] })}
        >
          <option value="none">OLS (assumes constant error variance)</option>
          <option value="HC0">HC0 (White)</option>
          <option value="HC1">HC1</option>
          <option value="HC2">HC2</option>
          <option value="HC3">HC3 (recommended; Long &amp; Ervin, 2000)</option>
          <option value="HC4">HC4 (Cribari-Neto)</option>
        </select>
      </div>
      <div className="hint">
        Heteroskedasticity-consistent standard errors (PROCESS’s hc option) for coefficients,
        conditional effects, F tests and Johnson–Neyman; bootstrap intervals of indirect effects do
        not use them. Latent-variable models use SAM’s standard errors instead.
      </div>
    </div>
  );
}

/** Missing values, and the multiple imputation options. */
export function MissingValues() {
  const model = useStore((s) => s.model);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="section">
      <div className="field">
        <label>Missing values</label>
        <select
          className="select"
          aria-label="Missing values"
          value={settings.missing}
          onChange={(e) => setSettings({ missing: e.target.value as typeof settings.missing })}
        >
          <option value="mean">Mean replacement</option>
          <option value="casewise">Casewise (listwise) deletion</option>
          {settings.method === 'cbsem' && (
            <option value="fiml">FIML (full-information maximum likelihood)</option>
          )}
          {settings.method === 'cbsem' && (
            <option value="twostage">Two-stage (Savalei &amp; Bentler)</option>
          )}
          {settings.method === 'cbsem' && <option value="robusttwostage">Robust two-stage</option>}
          {settings.method === 'cbsem' && <option value="pairwise">Pairwise deletion</option>}
          <option value="mi">
            Multiple imputation{settings.method === 'cbsem' ? '' : ' (mice)'}
          </option>
          {settings.method !== 'cbsem' &&
            ['fiml', 'twostage', 'robusttwostage', 'pairwise'].includes(settings.missing) && (
              <option value={settings.missing} disabled>
                {settings.missing} (CB-SEM only)
              </option>
            )}
        </select>
        {settings.method === 'cbsem' && settings.missing === 'fiml' && (
          <div className="hint" style={{ marginTop: 6 }}>
            Full-information maximum likelihood uses all observed values of every case (missing at
            random); with MLR the standard errors and test are robust.
          </div>
        )}
        {settings.method === 'cbsem' &&
          (settings.missing === 'twostage' || settings.missing === 'robusttwostage') && (
            <div className="hint" style={{ marginTop: 6 }}>
              Two-stage (Savalei &amp; Bentler 2009; lavaan missing = &quot;
              {settings.missing === 'twostage' ? 'two.stage' : 'robust.two.stage'}&quot;): the
              saturated means and covariances are estimated from all observed values (EM), then the
              model is fitted to them, with standard errors and a χ² corrected for the first stage
              {settings.missing === 'robusttwostage' ? ' and robust to non-normality' : ''}. ML,
              MLR, GLS or ULS.
            </div>
          )}
        {settings.method === 'cbsem' &&
          (settings.missing === 'fiml' ||
            settings.missing === 'twostage' ||
            settings.missing === 'robusttwostage') &&
          data &&
          !data.moments && (
            <div style={{ marginTop: 8 }}>
              <OrderedPicker
                label="Auxiliary variables (inform the missing values, not in the model)"
                columns={data.names.filter(
                  (n) => !model.constructs.some((c) => c.indicators.includes(n)),
                )}
                value={(model.auxiliary ?? []).filter((a) => data.names.includes(a))}
                onChange={(aux) =>
                  useStore.getState().commit((m) => {
                    const { auxiliary: _a, ...rest } = m;
                    return aux.length ? { ...rest, auxiliary: aux } : rest;
                  })
                }
              />
              <div className="hint">
                lavaan’s aux =: with FIML each auxiliary variable is correlated with every observed
                variable of the model and with the others (saturated correlates, Graham 2003), which
                makes missing at random more plausible without changing the model or its degrees of
                freedom; with the two-stage approach they join the first-stage EM. Continuous
                columns; no ordinal indicators or clusters.
              </div>
            </div>
          )}
        {settings.method === 'cbsem' && settings.missing === 'pairwise' && (
          <div className="hint" style={{ marginTop: 6 }}>
            Pairwise deletion (lavaan missing = &quot;pairwise&quot;): each covariance from the
            cases observed on both variables. The standard errors and χ² treat the data as complete;
            prefer the two-stage approach or FIML. ML or ULS.
          </div>
        )}
        {settings.missing === 'mi' && (
          <div className="field" style={{ marginTop: 8 }}>
            <label>Imputed data sets</label>
            <input
              className="input num"
              type="number"
              min={2}
              max={200}
              value={settings.miImputations}
              onChange={(e) =>
                setSettings({
                  miImputations: Math.max(
                    2,
                    Math.min(200, Math.round(Number(e.target.value)) || 20),
                  ),
                })
              }
            />
            {settings.method === 'cbsem' && (
              <>
                <label htmlFor="mi-method" style={{ marginTop: 8 }}>
                  Imputation
                </label>
                <select
                  id="mi-method"
                  className="select"
                  value={settings.miMethod}
                  onChange={(e) =>
                    setSettings({
                      miMethod:
                        e.target.value === 'amelia' ||
                        e.target.value === 'micenorm' ||
                        e.target.value === 'joint'
                          ? e.target.value
                          : 'mice',
                    })
                  }
                >
                  <option value="mice">mice: chained equations, predictive mean matching</option>
                  <option value="micenorm">
                    mice: Bayesian normal regression (chained equations)
                  </option>
                  <option value="joint">
                    Joint H1 imputation: multivariate normal data augmentation (as Mplus)
                  </option>
                  <option value="amelia">
                    Amelia: EM with bootstrapping (multivariate normal)
                  </option>
                </select>
                {data && !data.moments && (
                  <OrderedPicker
                    label="Auxiliary variables (inform the imputation, not in the model)"
                    columns={data.names.filter(
                      (n) => !model.constructs.some((c) => c.indicators.includes(n)),
                    )}
                    value={settings.miAuxiliary.filter((a) => data.names.includes(a))}
                    onChange={(miAuxiliary) =>
                      setSettings({
                        miAuxiliary,
                        miNominal: settings.miNominal.filter(
                          (x) =>
                            miAuxiliary.includes(x) ||
                            model.constructs.some((c) => c.indicators.includes(x)),
                        ),
                      })
                    }
                  />
                )}
                {((settings.miMethod === 'amelia' && settings.miAuxiliary.length > 0) ||
                  settings.miMethod === 'micenorm' ||
                  settings.miMethod === 'joint') && (
                  <div className="field">
                    <label>
                      {settings.miMethod === 'amelia'
                        ? 'Nominal (unordered categories; Amelia’s noms)'
                        : settings.miMethod === 'joint'
                          ? 'Categorical (ordered; imputed through latent normal responses, Mplus’s (c))'
                          : 'Categorical (imputed by logistic or multinomial regression)'}
                    </label>
                    {(settings.miMethod === 'amelia'
                      ? settings.miAuxiliary
                      : [
                          ...new Set([
                            ...model.constructs.flatMap((c) => c.indicators),
                            ...settings.miAuxiliary,
                          ]),
                        ]
                    ).map((a) => (
                      <label className="check" key={a}>
                        <input
                          type="checkbox"
                          checked={settings.miNominal.includes(a)}
                          onChange={(e) =>
                            setSettings({
                              miNominal: e.target.checked
                                ? [...settings.miNominal, a]
                                : settings.miNominal.filter((x) => x !== a),
                            })
                          }
                        />{' '}
                        <span>{a}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="hint" style={{ marginTop: 6 }}>
              {settings.method === 'cbsem' && settings.miMethod === 'amelia'
                ? 'Amelia'
                : settings.method === 'cbsem' && settings.miMethod === 'joint'
                  ? 'Data augmentation'
                  : 'mice'}{' '}
              imputes the missing values {settings.miImputations} times (
              {settings.method === 'cbsem' && settings.miMethod === 'amelia'
                ? 'EM with bootstrapping, multivariate normal'
                : settings.method === 'cbsem' && settings.miMethod === 'micenorm'
                  ? 'Bayesian normal regression, logistic for nominal columns'
                  : settings.method === 'cbsem' && settings.miMethod === 'joint'
                    ? 'draws from the unrestricted multivariate normal model, every 100 iterations after 1000'
                    : 'predictive mean matching'}
              , missing at random; seed as for bootstrapping
              {settings.miAuxiliary.length && settings.method === 'cbsem'
                ? `; with ${settings.miAuxiliary.join(', ')}`
                : ''}
              );{' '}
              {settings.method === 'cbsem'
                ? 'the model is estimated in every imputed data set and pooled by Rubin’s rules (lavaan.mi), with pooled standard errors, tests and fit.'
                : 'the model is estimated in every imputed data set and the estimates are averaged; bootstrapping pools the bootstrap standard errors by Rubin’s rules.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Bootstrapping: subsamples, seed, confidence, tails and intervals. */
export function Bootstrapping() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const pls = settings.method === 'pls';
  const proc = settings.method === 'process';
  return (
    <div className="section">
      <div className="section-title">Bootstrapping</div>
      <div className="row2">
        <NumField label="Subsamples" field="bootSamples" min={10} max={100000} step={100} />
        <NumField label="Random seed" field="seed" min={0} max={2 ** 31} />
      </div>
      <div className="field">
        <label>Confidence interval</label>
        <div className="segmented">
          {[0.9, 0.95, 0.99].map((c) => (
            <button
              key={c}
              className={settings.confidence === c ? 'on' : ''}
              onClick={() => setSettings({ confidence: c })}
            >
              {c * 100}%
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Tests</label>
        <div className="segmented">
          <button
            className={settings.bootTails !== 'one' ? 'on' : ''}
            onClick={() => setSettings({ bootTails: 'two' })}
          >
            Two-tailed
          </button>
          <button
            className={settings.bootTails === 'one' ? 'on' : ''}
            onClick={() => setSettings({ bootTails: 'one' })}
            title="For directional hypotheses: p for the direction of the estimate (half the two-tailed p), intervals from α to 1 − α"
          >
            One-tailed
          </button>
        </div>
      </div>
      <div className="field">
        <label>Intervals</label>
        <div className="segmented">
          <button
            className={
              settings.bootInterval !== 'bca' &&
              !(settings.method === 'pls' && settings.bootInterval === 'studentized')
                ? 'on'
                : ''
            }
            onClick={() => setSettings({ bootInterval: 'percentile' })}
          >
            Percentile
          </button>
          <button
            className={settings.bootInterval === 'bca' ? 'on' : ''}
            onClick={() => setSettings({ bootInterval: 'bca' })}
            title="Bias-corrected and accelerated (Efron 1987): adds a jackknife, one refit per observation"
          >
            BCa
          </button>
          {settings.method === 'pls' && (
            <button
              className={settings.bootInterval === 'studentized' ? 'on' : ''}
              onClick={() => setSettings({ bootInterval: 'studentized' })}
              title="Bootstrap-t (Efron & Tibshirani 1993): each subsample gets its own standard error from an inner bootstrap. Accurate, slow; runs in the built-in engine"
            >
              Studentized
            </button>
          )}
        </div>
      </div>
      <div className="hint">
        {settings.method === 'pls' && settings.bootInterval === 'studentized'
          ? `Studentized intervals (bootstrap-t; ${STUDENTIZED_INNER} inner samples per subsample, so about ${STUDENTIZED_INNER + 1} times as long; built-in engine)`
          : settings.bootInterval === 'bca'
            ? 'BCa intervals (bias-corrected and accelerated; the jackknife adds one refit per observation)'
            : 'Percentile intervals'}
        ; p-values from {settings.bootTails === 'one' ? 'one-tailed' : 'two-tailed'} t tests.
        {pls
          ? ' The same subsample count is used for the fit test (HI95/HI99).'
          : proc
            ? ' Indirect effects and indices of moderated mediation; direct and conditional effects use OLS standard errors, as PROCESS. At least 100 samples (5000 recommended for reporting).'
            : ' CB-SEM bootstraps standardised paths and indirect effects.'}
      </div>
    </div>
  );
}
