// Model runs: every Calculate logs the model it estimated as a card on the
// Analyses tab, with the model itself, the settings, the data's identity and
// the results. Calculating an unchanged model again updates its card (a
// bootstrap joins the run); any change to the model, the estimation settings
// or the data starts a new version, whose card lists what changed. A run
// card can open its model on the Model tab again (through the undo stack).

import { engineOf } from '../components/EngineBadge';
import { choiceDialog } from '../components/Overlays';
import { renderFigureSvg } from '../figure/render';
import { figureSource } from '../figure/source';
import type { Settings } from '../model/project';
import { processGraph } from '../process/fromModel';
import { resultsKey, useStore } from '../store';
import {
  describeChanges,
  ESTIMATION_KEYS,
  INFERENCE_KEYS,
  latestRun,
  openedFromVersion,
  runCards,
  runData,
  runHash,
  setOpenedFrom,
  settingChanges,
  type RunOptions,
} from './runHash';
import { METHOD_LABEL } from './runCard';
import type { SnapshotResult } from './snapshot';
import { addAnalysis, addFrozenCard, updateFrozenCard, useAnalyses } from './store';

export { runCards, openedFromVersion, type RunCard, type RunOptions } from './runHash';
export { runAnalysis } from './runCard';

/** The version id of the model on the Model tab as it is now. */
export function currentRunHash(): string {
  const s = useStore.getState();
  return runHash(s.model, s.settings, s.data);
}

/**
 * Log the results on screen (if they are current) as a model run: a new
 * version, or the existing card of this version with the results it now has
 * (an added bootstrap, a fit test).
 */
export async function logCurrentRun(): Promise<string | null> {
  const s = useStore.getState();
  if (s.cloud?.role === 'viewer') return null;
  const r = s.results;
  if (!r || r.key !== resultsKey(s)) return null;
  const method = s.settings.method;
  const twoSls = method === 'cbsem' && s.settings.estimator === '2SLS';
  if (!(method === 'process' ? r.process : method === 'cbsem' ? (twoSls ? r.miiv : r.cb) : r.pls))
    return null;
  const hash = runHash(s.model, s.settings, s.data);
  const data = runData(s.data, s.dataInfo);
  let diagram: string | null;
  try {
    const src = figureSource();
    diagram = src ? renderFigureSvg(src(), s.settings.figure).svg : null;
  } catch {
    diagram = null;
  }
  const recognised = method === 'process' ? processGraph(s.model).recognised : null;
  const engine = engineOf(r, method, twoSls);
  const result: SnapshotResult = {
    method: twoSls ? 'miiv' : method,
    description: `${engine ?? METHOD_LABEL[method]}${data.rows ? `, ${data.rows.toLocaleString()} observations` : ''} · ${new Date().toLocaleString()}`,
    diagram,
    pls: r.pls,
    cb: r.cb,
    miiv: r.miiv,
    process: r.process ?? null,
    boot: r.boot,
    fitTest: r.fitTest,
    processTitle: recognised
      ? `PROCESS model ${recognised.model}`
      : 'Custom conditional process model',
    level: s.settings.confidence,
  };
  const runs = runCards(useAnalyses.getState().cards);
  const existing = runs.find((c) => c.options.hash === hash);
  if (existing) {
    await updateFrozenCard(existing.id, result);
    return existing.id;
  }
  const latest = latestRun(runs);
  const version = (latest?.options.version ?? 0) + 1;
  const opened = openedFromVersion();
  const base = (opened !== null ? runs.find((c) => c.options.version === opened) : null) ?? latest;
  const changes = describeChanges(base ? base.options : null, {
    model: s.model,
    settings: s.settings,
    data,
  });
  setOpenedFrom(null);
  const options: RunOptions = {
    label: `Model v${version}`,
    version,
    hash,
    model: structuredClone(s.model),
    settings: structuredClone(s.settings),
    data,
    ...(base && base !== latest ? { from: base.options.version } : {}),
    changes,
  };
  return addFrozenCard('run', options, result);
}

export type Divergence = 'keep' | 'discard';
const askDivergence = () =>
  choiceDialog({
    title: 'Keep the model on the Model tab?',
    body: 'It has changes that were not calculated, so it is not in the log yet. Keep it as a card (not run), or discard those changes.',
    choices: [
      { id: 'discard', label: 'Discard', danger: true },
      { id: 'keep', label: 'Keep as a card', primary: true },
    ],
  }) as Promise<Divergence | null>;

/**
 * Open a logged version on the Model tab: its model (through the undo stack:
 * ⌘Z returns) and its estimation and inference settings; the diagram and
 * chart styles stay. An edited-but-uncalculated working model is kept as a
 * card or discarded, as the person chooses.
 */
export async function openRun(
  id: string,
  ask: () => Promise<Divergence | null> = askDivergence,
): Promise<boolean> {
  const s = useStore.getState();
  const runs = runCards(useAnalyses.getState().cards);
  const card = runs.find((c) => c.id === id);
  if (!card || s.cloud?.role === 'viewer') return false;
  const o = card.options;
  const here = runHash(s.model, s.settings, s.data);
  if (here === o.hash) {
    s.setWorkspace('model');
    s.toast('info', `${o.label} is the model on the Model tab.`);
    return true;
  }
  if (s.model.constructs.length && !runs.some((c) => c.options.hash === here)) {
    const choice = await ask();
    if (!choice) return false;
    if (choice === 'keep') {
      const latest = latestRun(runCards(useAnalyses.getState().cards));
      const version = (latest?.options.version ?? 0) + 1;
      const data = runData(s.data, s.dataInfo);
      addAnalysis('run', {
        label: `Model v${version} (not run)`,
        version,
        hash: here,
        model: structuredClone(s.model),
        settings: structuredClone(s.settings),
        data,
        changes: describeChanges(latest ? latest.options : null, {
          model: s.model,
          settings: s.settings,
          data,
        }),
      } satisfies RunOptions);
    }
  }
  const changed = settingChanges(s.settings, o.settings);
  s.commit(() => structuredClone(o.model));
  s.setSettings(
    Object.fromEntries(
      [...ESTIMATION_KEYS, ...INFERENCE_KEYS].map((k) => [k, o.settings[k]]),
    ) as Partial<Settings>,
  );
  setOpenedFrom(o.version);
  useAnalyses.setState({ selected: id });
  s.setWorkspace('model');
  const now = runData(s.data, s.dataInfo);
  const notes = [
    changed.length ? `Settings: ${changed.join('; ')}.` : '',
    now.fingerprint !== o.data.fingerprint
      ? `It was calculated on ${o.data.name || 'other data'}${o.data.rows ? ` (${o.data.rows.toLocaleString()} rows)` : ''}, not the data open now.`
      : '',
  ].filter(Boolean);
  s.toast(
    notes.length ? 'info' : 'success',
    `${o.label} opened on the Model tab (undo returns). ${notes.join(' ')}`.trim(),
  );
  return true;
}
