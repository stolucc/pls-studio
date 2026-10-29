import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, safeFileName } from '../format';
import type { ModelSpec, PlsOptions } from '../engine/types';
import { toSpec, validateModel } from '../model/project';
import type { CompareResult, GroupsResult, MgaApproach, PredictResult } from '../rengine/plsx';
import { useStore } from '../store';
import { IconX } from './icons';
import { c, pCell, Table, type Row } from './results/Table';

type Tab = 'predict' | 'compare' | 'groups';
interface State {
  open: boolean; tab: Tab;
  predict: PredictResult | null; compare: CompareResult | null; groups: GroupsResult | null;
  /** The alternative model for the comparison: a snapshot of an earlier diagram. */
  alternative: { spec: ModelSpec; paths: number; savedAt: number } | null;
  /** Filled in by an example (applied when it changes). */
  preset: { tab: Tab; group?: string } | null;
  setOpen: (v: boolean) => void;
}
export const usePlsAssessment = create<State>((set) => ({ open: false, tab: 'predict', predict: null, compare: null, groups: null, alternative: null, preset: null, setOpen: (open) => set({ open }) }));

const APPROACHES: { id: MgaApproach; label: string }[] = [
  { id: 'Henseler', label: 'Henseler (bootstrap)' }, { id: 'Chin', label: 'Chin & Dibbern (permutation)' }, { id: 'Klesel', label: 'Klesel et al. (overall, dG / dL)' },
  { id: 'Sarstedt', label: 'Sarstedt et al. (bootstrap F)' }, { id: 'Keil', label: 'Keil et al. (parametric t)' }, { id: 'Nitzl', label: 'Nitzl (Welch–Satterthwaite t)' },
];

/** Shmueli et al. (2019): predictive power from the share of indicators where PLS beats the LM benchmark. */
export function predictivePower(rows: PredictResult['indicators']): string {
  if (rows.some((r) => !(r.q2 > 0))) return 'Q²predict is not above 0 for every indicator: the model lacks predictive relevance there.';
  const better = rows.filter((r) => r.rmsePls < r.rmseLm).length;
  if (better === rows.length) return 'High predictive power: PLS beats the LM benchmark (RMSE) on every indicator.';
  if (better > rows.length / 2) return 'Medium predictive power: PLS beats the LM benchmark on most indicators.';
  if (better > 0) return 'Low predictive power: PLS beats the LM benchmark on a minority of indicators.';
  return 'No predictive power beyond the LM benchmark: PLS does not beat it on any indicator.';
}

function PredictView({ r }: { r: PredictResult }) {
  return (
    <div className="tables">
      <Table title="PLSpredict" file="plspredict" columns={['Indicator', 'Construct', 'Q²predict', 'RMSE (PLS)', 'RMSE (LM)', 'MAE (PLS)', 'MAE (LM)']}
        rows={r.indicators.map((x) => [c(x.indicator), c(x.construct), { ...c(x.q2), bold: !(x.q2 > 0) }, { ...c(x.rmsePls), bold: x.rmsePls < x.rmseLm }, c(x.rmseLm), { ...c(x.maePls), bold: x.maePls < x.maeLm }, c(x.maeLm)])}
        note={<>{predictivePower(r.indicators)} {r.folds}-fold cross-validation, {r.repetitions} repetitions (averaged). Bold: PLS better than the LM benchmark (or Q²predict not above 0). Shmueli et al. (2019); cSEM’s predict.</>} />
    </div>
  );
}

function CompareView({ r }: { r: CompareResult }) {
  const names = Object.keys(r.criteria[0]?.byConstruct ?? {});
  const pick = ['BIC', 'GM', 'AIC', 'AICc', 'HQ'];
  const rows: Row[] = r.criteria.filter((k) => pick.includes(k.criterion)).flatMap((k) => {
    const alt = r.criteriaAlt.find((a) => a.criterion === k.criterion)!;
    return names.map((n) => {
      const a = k.byConstruct[n], b = alt?.byConstruct[n];
      return [c(k.criterion), c(n), { ...c(a), bold: a < b }, { ...c(b), bold: b < a }];
    });
  });
  return (
    <div className="tables">
      <Table title="Information criteria per endogenous construct" file="pls-model-selection" columns={['Criterion', 'Construct', 'This model', 'Alternative']} rows={rows}
        note="Lower is better (bold: the better model). Sharma et al. (2019, 2021) recommend BIC and GM for choosing among PLS models." />
      <Table title="CVPAT: out-of-sample prediction loss" file="pls-cvpat" columns={['Loss, this model', 'Loss, alternative', 't', 'df', 'p']}
        rows={[[c(r.cvpat.loss), c(r.cvpat.lossAlt), c(r.cvpat.statistic, undefined, 2), c(r.cvpat.df, undefined, 0), pCell(r.cvpat.p)]]}
        note="Liengaard et al. (2021): a significant difference means the model with the lower average squared prediction error predicts better." />
    </div>
  );
}

function GroupsView({ r }: { r: GroupsResult }) {
  const cons = Object.keys(r.micom.c);
  const paths = r.groups[0]?.paths ?? [];
  return (
    <div className="tables">
      <Table title="Path coefficients by group" file="pls-groups-paths" columns={['Path', ...r.groups.map((g) => `${g.group} (n = ${g.n})`)]}
        rows={paths.map((p, i) => [c(`${p.from} → ${p.to}`), ...r.groups.map((g) => c(g.paths[i]?.est ?? null))])} />
      <Table title="MICOM: measurement invariance of composites" file="pls-micom" columns={['Construct', 'c (step 2)', 'p', 'Mean diff. (step 3a)', 'p', 'Log variance ratio (3b)', 'p']}
        rows={cons.map((k) => [c(k), c(r.micom.c[k]), pCell(r.micom.cP[k] ?? null), c(r.micom.mean.statistic[k] ?? null), pCell(r.micom.mean.p[k] ?? null), c(r.micom.variance.statistic[k] ?? null), pCell(r.micom.variance.p[k] ?? null)])}
        note={`Henseler, Ringle & Sarstedt (2016). Step 1 (configural) holds by design: the same model and indicators in each group. Step 2: c should not differ from 1 (p > .05) — partial invariance, which allows comparing paths. Step 3: equal means and variances too — full invariance, which allows pooling the groups. ${r.micom.admissible} of ${r.micom.runs} permutations admissible.`} />
      {r.mga.map((a) => a.overall ? (
        <Table key={a.approach} title="Overall test (Klesel et al. 2019)" file="pls-mga-klesel" columns={['Distance', 'Statistic', 'p']}
          rows={[[c('dG (geodesic)'), c(a.overall.dG.statistic), pCell(a.overall.dG.p)], [c('dL (Euclidean)'), c(a.overall.dL.statistic), pCell(a.overall.dL.p)]]}
          note="Do the groups' model-implied indicator correlations differ at all? A small p: the groups differ somewhere in the model." />
      ) : a.comparisons?.map((cmp) => (
        <Table key={`${a.approach}-${cmp.groups}`} title={`${APPROACHES.find((x) => x.id === a.approach)?.label}${cmp.groups === 'all' ? '' : `: ${cmp.groups.replace('_', ' vs ')}`}`}
          file={`pls-mga-${a.approach.toLowerCase()}`} columns={a.approach === 'Henseler' ? ['Path', 'p'] : ['Path', 'Statistic', 'p']}
          rows={cmp.paths.map((p) => (a.approach === 'Henseler' ? [c(`${p.from} → ${p.to}`), pCell(p.p)] : [c(`${p.from} → ${p.to}`), c(p.statistic), pCell(p.p)]))}
          note={a.approach === 'Henseler' ? 'Henseler et al. (2009), bootstrap-based. Chin & Dibbern: permutation of group membership; Keil / Nitzl: parametric t tests. The path differences are in the table of path coefficients by group.' : a.approach === 'Chin' ? 'Statistic: the difference between the groups’ paths; p from permuting group membership.' : undefined} />
      )))}
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

/** PLS-SEM assessment beyond the basic results: prediction, model comparison, group comparison (cSEM). */
export function PlsAssessmentPanel() {
  const s = usePlsAssessment();
  const data = useStore((st) => st.data);
  const model = useStore((st) => st.model);
  const settings = useStore((st) => st.settings);
  const project = useStore((st) => st.projectName);
  const [folds, setFolds] = useState(10), [reps, setReps] = useState(10);
  const [group, setGroup] = useState(''), [approaches, setApproaches] = useState<MgaApproach[]>(['Henseler', 'Chin', 'Klesel']);
  const [busy, setBusy] = useState(false);
  const preset = s.preset;
  useEffect(() => { if (preset?.group) setGroup(preset.group); }, [preset]);
  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') usePlsAssessment.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.open]);
  if (!s.open) return null;
  const close = () => usePlsAssessment.getState().setOpen(false);
  const errors = data ? validateModel(model, data, { ...settings, method: 'pls' }).filter((i) => i.level === 'error') : [];
  const problem = !data || data.moments ? 'Import raw data first.' : !model.paths.length ? 'Draw a PLS path model first.' : errors[0]?.message ?? null;
  const spec = toSpec(model);
  const options: PlsOptions = { scheme: settings.scheme, maxIter: settings.maxIter, tolerance: 10 ** -settings.stopExp, missing: settings.missing === 'fiml' ? 'casewise' : settings.missing, consistent: settings.consistent };
  const assigned = new Set(model.constructs.flatMap((k) => k.indicators));
  const groupCols = (data?.names ?? []).filter((n) => !assigned.has(n) && new Set(Array.from(data!.cols[data!.names.indexOf(n)]).filter((v) => !Number.isNaN(v))).size <= 10);
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `cSEM: ${rMessage(e)}`));
  const go = async (what: Tab, script = false) => {
    setBusy(true);
    try {
      const m = await import('../rengine/plsx');
      const seed = settings.seed;
      if (what === 'predict') {
        if (script) downloadText(`${safeFileName(project)}-plspredict.R`, await m.predictScriptR(data!, spec, options, { folds, repetitions: reps, seed }), 'text/x-r-source');
        else usePlsAssessment.setState({ predict: await m.predictR(data!, spec, options, { folds, repetitions: reps, seed }) });
      } else if (what === 'compare') {
        const alt = s.alternative!.spec;
        if (script) downloadText(`${safeFileName(project)}-model-comparison.R`, await m.compareScriptR(data!, spec, alt, options, seed), 'text/x-r-source');
        else usePlsAssessment.setState({ compare: await m.compareR(data!, spec, alt, options, seed) });
      } else {
        const g = { group, approaches, samples: Math.max(20, Math.min(5000, Math.floor(settings.bootSamples))), seed };
        if (script) downloadText(`${safeFileName(project)}-micom-mga.R`, await m.groupsScriptR(data!, spec, options, g), 'text/x-r-source');
        else usePlsAssessment.setState({ groups: await m.groupsR(data!, spec, options, g) });
      }
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const saveAlternative = () => {
    usePlsAssessment.setState({ alternative: { spec, paths: spec.paths.length, savedAt: Date.now() }, compare: null });
    useStore.getState().toast('success', 'Saved as the alternative model. Now change the paths in the diagram and compare.');
  };
  const sameMeasurement = !!s.alternative && JSON.stringify(s.alternative.spec.constructs.map((k) => [k.name, [...k.indicators].sort()]).sort())
    === JSON.stringify(spec.constructs.map((k) => [k.name, [...k.indicators].sort()]).sort());
  const ready = s.tab === 'predict' ? true : s.tab === 'compare' ? sameMeasurement : !!group && approaches.length > 0;
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="PLS assessment">
      <div className="sim">
        <header className="sim-head">
          <div><b>PLS-SEM assessment</b><span className="muted">cSEM · {settings.scheme} weighting{settings.consistent ? ', PLSc' : ''} (from the Model settings)</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {problem ? <div className="empty-results">{problem}</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              <div className="segmented" style={{ marginBottom: 12 }}>
                {([['predict', 'Prediction'], ['compare', 'Model comparison'], ['groups', 'Groups']] as const).map(([id, l]) => (
                  <button key={id} className={s.tab === id ? 'on' : ''} onClick={() => usePlsAssessment.setState({ tab: id })}>{l}</button>
                ))}
              </div>
              {s.tab === 'predict' && (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>PLSpredict (Shmueli et al. 2016, 2019): how well does the model predict the endogenous indicators for new cases? Cross-validated predictions compared with the training means (Q²predict) and with a linear-regression benchmark (LM).</p>
                  <div className="row2">
                    <div className="field"><label>Folds</label><input className="input num" type="number" min={2} max={50} value={folds} onChange={(e) => setFolds(Math.max(2, Math.min(50, Math.round(Number(e.target.value)) || 10)))} /></div>
                    <div className="field"><label>Repetitions</label><input className="input num" type="number" min={1} max={100} value={reps} onChange={(e) => setReps(Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 10)))} /></div>
                  </div>
                </>
              )}
              {s.tab === 'compare' && (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>Compare the diagram with an alternative model (other paths, the same constructs and indicators): information criteria (Sharma et al. 2019) and CVPAT (Liengaard et al. 2021).</p>
                  <button className="btn" onClick={saveAlternative}>Save the current model as the alternative</button>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {s.alternative ? `Alternative saved (${s.alternative.paths} paths, ${new Date(s.alternative.savedAt).toLocaleTimeString()}).${sameMeasurement ? '' : ' Its constructs or indicators differ from the diagram’s: save it again.'}` : 'No alternative saved yet: save the model, change its paths, then compare.'}
                  </div>
                </>
              )}
              {s.tab === 'groups' && (
                <>
                  <p className="hint" style={{ marginTop: 0 }}>MICOM (is the measurement comparable across groups?) and multigroup analysis (do the paths differ?). Permutations and bootstrap samples: {Math.floor(settings.bootSamples)} (Model settings).</p>
                  <div className="field">
                    <label>Groups (a column not in the model, at most 10 values)</label>
                    <select className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                      <option value="">Choose…</option>
                      {groupCols.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Multigroup tests</label>
                    {APPROACHES.map((a) => (
                      <label key={a.id} className="check" style={{ marginBottom: 4 }}>
                        <input type="checkbox" checked={approaches.includes(a.id)} onChange={(e) => setApproaches(e.target.checked ? [...approaches, a.id] : approaches.filter((x) => x !== a.id))} />
                        <span>{a.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void go(s.tab)}>{busy ? 'Calculating…' : 'Calculate'}</button>
                <button className="btn" disabled={!ready || busy} onClick={() => void go(s.tab, true)}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {s.tab === 'predict' && (s.predict ? <PredictView r={s.predict} /> : <div className="empty-results">Press Calculate.</div>)}
              {s.tab === 'compare' && (s.compare ? <CompareView r={s.compare} /> : <div className="empty-results">Save an alternative, change the paths, and press Calculate.</div>)}
              {s.tab === 'groups' && (s.groups ? <GroupsView r={s.groups} /> : <div className="empty-results">Choose the grouping column and press Calculate.</div>)}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

