// Calls into the R bridges (src/rengine/R/*.R). Every bridge function takes a
// JSON request and returns JSON results, or (export = TRUE) the self-contained
// R script that produces them.

import analysesR from './R/analyses.R?raw';
import bootR from './R/boot.R?raw';
import commonR from './R/common.R?raw';
import cpaR from './R/cpa.R?raw';
import efaR from './R/efa.R?raw';
import endoR from './R/endo.R?raw';
import lavaanR from './R/lavaan.R?raw';
import matchR from './R/match.R?raw';
import itemsR from './R/items.R?raw';
import longitudinalR from './R/longitudinal.R?raw';
import mcR from './R/mc.R?raw';
import mixedR from './R/mixed.R?raw';
import ncaR from './R/nca.R?raw';
import plsR from './R/pls.R?raw';
import plsxR from './R/plsx.R?raw';
import rsaR from './R/rsa.R?raw';
import screenR from './R/screen.R?raw';
import networkR from './R/network.R?raw';
import segmentR from './R/segment.R?raw';
import { useCompute } from './compute';
import { helperBatch, helperCall, HelperMissingPackages, HelperUnavailable, probeHelper, useHelper } from './helper';
import { reportRWarnings } from './notices';
import { callJson, callString, parallelMap, withR, withSession } from './runtime';

export const SOURCES = { common: commonR, lavaan: lavaanR, pls: plsR, boot: bootR, analyses: analysesR, mc: mcR, cpa: cpaR, longitudinal: longitudinalR, items: itemsR, mixed: mixedR, segment: segmentR, endo: endoR, match: matchR, rsa: rsaR, plsx: plsxR, nca: ncaR, efa: efaR, screen: screenR, network: networkR };

export const R_PACKAGES = {
  lavaan: ['jsonlite', 'lavaan', 'semTools'],
  rsem: ['jsonlite', 'lavaan', 'semTools', 'rsem'],
  cSEM: ['jsonlite', 'cSEM'],
  seminr: ['jsonlite', 'seminr'],
  // Multiple imputation: mice (and lavaan.mi) only when it is chosen.
  mice: ['jsonlite', 'mice'],
  'lavaan.mi': ['jsonlite', 'lavaan', 'semTools', 'mice', 'lavaan.mi'],
  cSEMMi: ['jsonlite', 'cSEM', 'mice'],
  seminrMi: ['jsonlite', 'seminr', 'mice'],
  MIIVsem: ['jsonlite', 'lavaan', 'MIIVsem'],
  simulation: ['jsonlite', 'lavaan', 'cSEM'],
  manymome: ['jsonlite', 'manymome', 'sandwich'],
  processGlm: ['jsonlite'],
  manymomeSam: ['jsonlite', 'manymome', 'lavaan'],
  modsem: ['jsonlite', 'lavaan', 'semTools', 'modsem'],
  ltm: ['jsonlite', 'ltm'],
  poLCA: ['jsonlite', 'poLCA'],
  lme4: ['jsonlite', 'lme4', 'lmerTest'],
  lcmm: ['jsonlite', 'lcmm'],
  plspm: ['jsonlite', 'plspm'],
  ivreg: ['jsonlite', 'ivreg', 'lmtest'],
  sampleSelection: ['jsonlite', 'sampleSelection'],
  optimx: ['jsonlite', 'ivreg', 'lmtest', 'optimx', 'mvtnorm', 'corpcor'],
  MatchIt: ['jsonlite', 'MatchIt', 'optmatch', 'cobalt', 'sandwich', 'lmtest'],
  WeightIt: ['jsonlite', 'WeightIt', 'cobalt', 'marginaleffects'],
  polynomial: ['jsonlite', 'lavaan'],
  nca: ['jsonlite'],
  cta: ['jsonlite'],
  genpathmox: ['jsonlite', 'cSEM', 'genpathmox'],
  flexmix: ['jsonlite', 'cSEM', 'flexmix'],
  psych: ['jsonlite', 'psych', 'GPArotation'],
  semfindr: ['jsonlite', 'lavaan', 'semTools', 'semfindr'],
  // Reading SPSS, Stata and Excel files.
  readData: ['jsonlite', 'haven', 'readxl'],
  bootnet: ['jsonlite', 'bootnet', 'qgraph'],
  EGAnet: ['jsonlite', 'EGAnet'],
} as const;
export type RPackage = keyof typeof R_PACKAGES;

/** Every R package the bridge uses (what the helper's `setup` installs). */
const ALL_R_PACKAGES = [...new Set(Object.values(R_PACKAGES).flat())].sort();

let probed: { at: number; p: Promise<unknown> } | null = null;
/** Probe the helper (again after 30 s when it was not ready). */
export function checkHelper(force = false): Promise<unknown> {
  if (force || !probed || (useHelper.getState().state !== 'ready' && Date.now() - probed.at > 30_000)) {
    probed = { at: Date.now(), p: probeHelper(SOURCES, ALL_R_PACKAGES) };
  }
  return probed.p;
}

/**
 * The parallelism in effect. Desktop R (helper ready): automatic, its R
 * processes (cores - 1); the browser: the Parallel setting (1 = off).
 */
export async function parallelism(): Promise<{ where: 'desktop' | 'browser'; sessions: number }> {
  if (useCompute.getState().backend === 'helper') {
    await checkHelper();
    const h = useHelper.getState();
    if (h.state === 'ready' && h.info) return { where: 'desktop', sessions: Math.max(1, h.info.workers) };
  }
  return { where: 'browser', sessions: useCompute.getState().workers };
}

/** A request as JSON (non-finite numbers as null, as the browser's R gets them). */
const toJson = (req: unknown) => JSON.stringify(req, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));

/** Bridge functions whose cSEM / seminr resampling runs on several cores of one desktop R process (results identical). */
const MULTICORE = new Set(['ps_pls_boot', 'ps_cca', 'ps_pls_groups', 'ps_influence']);

const told = new Set<string>();
/** Tell the user once per reason that a calculation ran in the browser's R instead of desktop R. */
function fallbackNotice(reason: string) {
  if (told.has(reason)) return;
  told.add(reason);
  void import('../store').then(({ useStore }) => useStore.getState().toast('info', `${reason} Calculating in the browser's R instead.`));
}

/**
 * With "Desktop R (helper)" chosen and the helper ready: the call's result
 * from the helper (JSON text or script). null: use the browser's R.
 */
async function viaHelper(fn: string, req: unknown, pkg: RPackage, exportScript: boolean): Promise<string | null> {
  if (useCompute.getState().backend !== 'helper') return null;
  await checkHelper();
  const h = useHelper.getState();
  if (h.state !== 'ready') { fallbackNotice(`Desktop R is not available (${h.message || h.state}).`); return null; }
  // cSEM / seminr resampling: all the helper's cores in this one R process (not when drawing chunks).
  const r = req as { boot?: { chunkR?: unknown } };
  const cores = MULTICORE.has(fn) && !r.boot?.chunkR ? Math.max(1, h.info?.workers ?? 1) : undefined;
  const json = toJson(cores ? { ...(req as object), cores } : req);
  try {
    return await helperCall(fn, json, [...R_PACKAGES[pkg]], exportScript);
  } catch (e) {
    if (e instanceof HelperMissingPackages) { fallbackNotice(`${e.message} Install them from the helper’s menu (Install R packages…) or with: pls-studio-helper setup.`); return null; }
    if (e instanceof HelperUnavailable) { fallbackNotice(e.message); return null; }
    throw e;
  }
}

/** A helper result, marked as calculated in desktop R (engine.desktop: its R version). */
function fromDesktop<T>(json: string): T {
  const v = JSON.parse(json) as { engine?: unknown };
  if (v && typeof v === 'object' && v.engine && typeof v.engine === 'object') (v.engine as Record<string, unknown>).desktop = useHelper.getState().info?.r ?? 'R';
  return v as T;
}

/** Every R result passes here: its warnings go to Messages (notices.ts). */
function reported<T>(r: T, pkg: RPackage): T { reportRWarnings(r, pkg); return r; }

export async function rCall<T>(fn: string, req: unknown, pkg: RPackage): Promise<T> {
  const h = await viaHelper(fn, req, pkg, false);
  if (h !== null) return reported(fromDesktop<T>(h), pkg);
  return reported(await withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `ps_call("${fn}", req)`, req)) as T, pkg);
}

/** As rCall, in R session `session` (parallel work; 0 is the main session). The helper has its own pool. */
export async function rCallOn<T>(session: number, fn: string, req: unknown, pkg: RPackage): Promise<T> {
  const h = await viaHelper(fn, req, pkg, false);
  if (h !== null) return reported(fromDesktop<T>(h), pkg);
  return reported(await withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `ps_call("${fn}", req)`, req)) as T, pkg);
}

/**
 * One call per request, results in request order. Desktop R: one streamed
 * batch over all the helper's processes. The browser (also when the helper
 * cannot be used): spread over the R sessions of the Parallel setting.
 */
export async function rCallParallel<T>(fn: string, reqs: unknown[], pkg: RPackage, onDone?: (done: number) => void): Promise<T[]> {
  const p = await parallelism();
  if (p.where === 'desktop') {
    try {
      const out = await helperBatch(fn, reqs.map(toJson), [...R_PACKAGES[pkg]], onDone);
      return out.map((r) => reported(fromDesktop<T>(r), pkg));
    } catch (e) {
      if (e instanceof HelperMissingPackages) fallbackNotice(`${e.message} Install them from the helper’s menu (Install R packages…) or with: pls-studio-helper setup.`);
      else if (e instanceof HelperUnavailable) fallbackNotice(e.message);
      else throw e;
    }
  }
  // (the browser's own setting, not the helper's process count)
  return parallelMap(reqs, useCompute.getState().workers, (req, session) =>
    withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `ps_call("${fn}", req)`, req)).then((r) => reported(r as T, pkg)), onDone);
}

export async function rScript(fn: string, req: unknown, pkg: RPackage): Promise<string> {
  const h = await viaHelper(fn, req, pkg, true);
  if (h !== null) return h;
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callString(webR, `ps_call("${fn}", req, export = TRUE)`, req));
}

/** Where the next calculation with `pkg` runs and that package's version there. */
export function computeLocation(pkg: string): { where: 'desktop' | 'browser'; version: string } {
  const h = useHelper.getState();
  if (useCompute.getState().backend === 'helper' && h.state === 'ready' && h.packages[pkg]) return { where: 'desktop', version: h.packages[pkg]! };
  return { where: 'browser', version: '' };
}

/** An R error message without R's call prefix. */
export const rMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error in [^:]*: /, '').replace(/^Error: /, '');

/**
 * R's JSON (auto_unbox) writes a one-element vector as a scalar: one warning
 * arrives as a string, not a list. Always a list of strings.
 */
export const rStrings = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === 'string');
