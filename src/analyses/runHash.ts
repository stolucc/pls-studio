// Model versions for the run log: a run is identified by what determines its
// estimates (the model as the engines see it, the estimation settings and the
// data), so calculating an unchanged model again updates its card instead of
// adding one, and any change to one of the three starts a new version.
// Also the plain-language list of what changed between two versions.

import type { Dataset } from '../engine/types';
import { toSpec, type DataInfo, type ModelState, type Settings } from '../model/project';
import { fingerprint } from './codec';
import type { AnalysisCard, Card } from './types';

export interface RunOptions {
  label: string;
  version: number;
  /** runHash of model, estimation settings and data: the version's identity. */
  hash: string;
  model: ModelState;
  settings: Settings;
  data: RunData;
  /** The version this one was edited from, when not the one before it (opened from the log). */
  from?: number;
  /** What changed from the previous version, in words. */
  changes: string[];
}
export type RunCard = AnalysisCard & { options: RunOptions };
export const runCards = (cards: Card[]): RunCard[] => cards.filter((c): c is RunCard => c.kind === 'analysis' && c.type === 'run');
export const latestRun = (runs: RunCard[]) => runs.reduce<RunCard | null>((a, c) => (!a || c.options.version > a.options.version ? c : a), null);

/** The version last opened from the log (runs.tsx sets it): the next new version notes it came from there. */
let openedFrom: number | null = null;
export const openedFromVersion = () => openedFrom;
export const setOpenedFrom = (v: number | null) => { openedFrom = v; };

/** Settings that change the estimates (as resultsKey in the store): inference options and styles are left out. */
export const ESTIMATION_KEYS = ['method', 'estimator', 'engine', 'plsPackage', 'plsApproach', 'consistent', 'scheme', 'maxIter', 'stopExp', 'missing', 'miImputations', 'interaction', 'probe', 'hc', 'counterfactual'] as const satisfies readonly (keyof Settings)[];
/** Inference options: kept with a run and listed when they change, but not part of its identity (a bootstrap is added to the run). */
export const INFERENCE_KEYS = ['bootSamples', 'seed', 'confidence', 'bootTails', 'bootInterval'] as const satisfies readonly (keyof Settings)[];

export const estimationSettings = (s: Settings) => Object.fromEntries(ESTIMATION_KEYS.map((k) => [k, s[k]])) as Pick<Settings, (typeof ESTIMATION_KEYS)[number]>;

/** Identity of the data a run used: its columns and values, not the file name. */
export function dataFingerprint(data: Dataset | null): string {
  if (!data) return 'none';
  return fingerprint([JSON.stringify(data.names), ...(data.moments ? [JSON.stringify(data.moments)] : data.cols)]);
}

export interface RunData { fingerprint: string; name: string; rows: number }
export const runData = (data: Dataset | null, info: DataInfo | null): RunData => ({ fingerprint: dataFingerprint(data), name: info?.fileName ?? '', rows: info?.rows ?? 0 });

/** The version id of a run: model specification + estimation settings + data. */
export function runHash(model: ModelState, settings: Settings, data: RunData | Dataset | null): string {
  const fp = data && 'fingerprint' in data ? data.fingerprint : dataFingerprint(data as Dataset | null);
  return fingerprint([JSON.stringify(toSpec(model)), JSON.stringify(estimationSettings(settings)), fp]);
}

const SETTING_NAMES: Partial<Record<keyof Settings, string>> = {
  method: 'method', estimator: 'estimator', engine: 'engine', plsPackage: 'PLS package', plsApproach: 'weighting approach', consistent: 'PLSc', scheme: 'weighting scheme',
  maxIter: 'max. iterations', stopExp: 'stop criterion (10^-k)', missing: 'missing values', miImputations: 'imputations', interaction: 'latent interactions', probe: 'probing', hc: 'robust SEs',
  counterfactual: 'counterfactual', bootSamples: 'bootstrap subsamples', seed: 'seed', confidence: 'confidence level', bootTails: 'tests', bootInterval: 'bootstrap intervals',
};
const METHOD_NAMES: Record<string, string> = { pls: 'PLS-SEM', cbsem: 'CB-SEM', process: 'conditional process analysis' };
const show = (k: keyof Settings, v: unknown): string => {
  if (k === 'method') return METHOD_NAMES[String(v)] ?? String(v);
  if (k === 'consistent') return v ? 'on' : 'off';
  if (k === 'confidence') return `${Math.round(Number(v) * 100)}%`;
  if (k === 'bootSamples' || k === 'seed') return Number(v).toLocaleString();
  if (v === null) return 'none';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/** Settings that differ, as "estimator ML → MLM". */
export function settingChanges(a: Settings, b: Settings, keys: readonly (keyof Settings)[] = [...ESTIMATION_KEYS, ...INFERENCE_KEYS]): string[] {
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${SETTING_NAMES[k] ?? k} ${show(k, a[k])} → ${show(k, b[k])}`);
}

const nameOf = (m: ModelState) => new Map(m.constructs.map((c) => [c.id, c.name]));
const pathLabel = (m: ModelState, p: { from: string; to: string }) => { const n = nameOf(m); return `${n.get(p.from) ?? p.from} → ${n.get(p.to) ?? p.to}`; };
const diffList = (before: string[], after: string[], what: string): string[] => {
  const b = new Set(before), a = new Set(after);
  const out: string[] = [];
  const added = after.filter((x) => !b.has(x)), removed = before.filter((x) => !a.has(x));
  if (added.length) out.push(`+ ${what} ${added.join(', ')}`);
  if (removed.length) out.push(`− ${what} ${removed.join(', ')}`);
  return out;
};

/**
 * What changed from one version to the next, in words: constructs, their
 * indicators, modes and types, paths, moderations, correlations, the other
 * model fields, the settings and the data.
 */
export function describeChanges(prev: { model: ModelState; settings: Settings; data: RunData } | null, next: { model: ModelState; settings: Settings; data: RunData }): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const pm = prev.model, nm = next.model;
  out.push(...diffList(pm.constructs.map((c) => c.name), nm.constructs.map((c) => c.name), nm.constructs.length - pm.constructs.length === 1 && pm.constructs.length ? 'construct' : 'constructs'));
  for (const c of nm.constructs) {
    const p = pm.constructs.find((x) => x.id === c.id) ?? pm.constructs.find((x) => x.name === c.name);
    if (!p) continue;
    const ind = diffList(p.indicators, c.indicators, `indicators of ${c.name}:`);
    out.push(...ind.map((s) => s.replace(`indicators of ${c.name}: `, `${c.name}: `)));
    if (p.type !== c.type) out.push(`${c.name}: ${p.type} → ${c.type}`);
    if (p.mode !== c.mode) out.push(`${c.name}: Mode ${p.mode} → Mode ${c.mode}`);
    if (JSON.stringify(p.components ?? []) !== JSON.stringify(c.components ?? [])) out.push(`${c.name}: components changed`);
    if (!!p.covariate !== !!c.covariate) out.push(`${c.name}: ${c.covariate ? 'now a covariate' : 'no longer a covariate'}`);
  }
  out.push(...diffList(pm.paths.map((p) => pathLabel(pm, p)), nm.paths.map((p) => pathLabel(nm, p)), 'path'));
  const modLabel = (m: ModelState, mo: { moderator: string; path: string; method?: string }) => { const p = m.paths.find((x) => x.id === mo.path); return `${nameOf(m).get(mo.moderator) ?? mo.moderator} on ${p ? pathLabel(m, p) : mo.path}${mo.method ? ` (${mo.method === 'orthogonal' ? 'orthogonalising' : 'product indicators'})` : ''}`; };
  out.push(...diffList(pm.moderations.map((x) => modLabel(pm, x)), nm.moderations.map((x) => modLabel(nm, x)), 'moderation'));
  const corrLabel = (m: ModelState, k: { a: string; b: string; kind: string }) => (k.kind === 'construct' ? `${nameOf(m).get(k.a) ?? k.a} ↔ ${nameOf(m).get(k.b) ?? k.b}` : `${k.a} ↔ ${k.b}`);
  out.push(...diffList((pm.correlations ?? []).map((k) => corrLabel(pm, k)), (nm.correlations ?? []).map((k) => corrLabel(nm, k)), 'correlation'));
  for (const k of ['ordered', 'defined', 'waldTests', 'inequalities', 'positiveVariances', 'multigroup', 'multilevel', 'esem', 'weights', 'threeWay'] as const) {
    if (JSON.stringify(pm[k] ?? null) !== JSON.stringify(nm[k] ?? null)) out.push(`${k === 'ordered' ? 'ordered indicators' : k === 'defined' ? 'defined parameters' : k === 'waldTests' ? 'Wald tests' : k === 'threeWay' ? 'moderated moderations' : k === 'positiveVariances' ? 'variance bounds' : k === 'esem' ? 'ESEM blocks' : k === 'multigroup' ? 'groups' : k === 'multilevel' ? 'levels' : k} changed`);
  }
  if (!!pm.constant !== !!nm.constant) out.push(nm.constant ? '+ mean structure (the constant)' : '− mean structure (the constant)');
  else if (nm.constant) {
    const label = (m: ModelState, t: { target: string; fixed?: number; label?: string }) => `${nameOf(m).get(t.target) ?? t.target}${t.fixed !== undefined ? ` = ${t.fixed}` : t.label ? ` (${t.label})` : ''}`;
    out.push(...diffList((pm.means ?? []).map((t) => label(pm, t)), (nm.means ?? []).map((t) => label(nm, t)), 'mean'));
  }
  // Paths with fixed values or labels, and the like, count as model changes through the spec even when nothing above caught them.
  if (!out.length && JSON.stringify(toSpec(pm)) !== JSON.stringify(toSpec(nm))) out.push('model parameters changed');
  out.push(...settingChanges(prev.settings, next.settings));
  if (prev.data.fingerprint !== next.data.fingerprint) out.push(`data: ${prev.data.name || 'none'}${prev.data.rows ? ` (${prev.data.rows.toLocaleString()} rows)` : ''} → ${next.data.name || 'none'}${next.data.rows ? ` (${next.data.rows.toLocaleString()} rows)` : ''}`);
  return out;
}
