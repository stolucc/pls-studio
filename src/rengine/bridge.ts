// Calls into the R bridges (src/rengine/R/*.R). Every bridge function takes a
// JSON request and returns JSON results, or (export = TRUE) the self-contained
// R script that produces them.

import analysesR from './R/analyses.R?raw';
import bootR from './R/boot.R?raw';
import commonR from './R/common.R?raw';
import cpaR from './R/cpa.R?raw';
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
import segmentR from './R/segment.R?raw';
import { useCompute } from './compute';
import { callJson, callString, parallelMap, withR, withSession } from './runtime';

const SOURCES = { common: commonR, lavaan: lavaanR, pls: plsR, boot: bootR, analyses: analysesR, mc: mcR, cpa: cpaR, longitudinal: longitudinalR, items: itemsR, mixed: mixedR, segment: segmentR, endo: endoR, match: matchR, rsa: rsaR, plsx: plsxR, nca: ncaR };

export const R_PACKAGES = {
  lavaan: ['jsonlite', 'lavaan', 'semTools'],
  cSEM: ['jsonlite', 'cSEM'],
  seminr: ['jsonlite', 'seminr'],
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
  polynomial: ['jsonlite', 'lavaan'],
  nca: ['jsonlite'],
  cta: ['jsonlite'],
  genpathmox: ['jsonlite', 'cSEM', 'genpathmox'],
  flexmix: ['jsonlite', 'cSEM', 'flexmix'],
} as const;
export type RPackage = keyof typeof R_PACKAGES;

export function rCall<T>(fn: string, req: unknown, pkg: RPackage): Promise<T> {
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `${fn}(req)`, req)) as Promise<T>;
}

/** As rCall, in R session `session` (parallel work; 0 is the main session). */
export function rCallOn<T>(session: number, fn: string, req: unknown, pkg: RPackage): Promise<T> {
  return withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `${fn}(req)`, req)) as Promise<T>;
}

/**
 * One call per request, spread over the R sessions of the parallel option
 * (useCompute.workers); results in request order.
 */
export function rCallParallel<T>(fn: string, reqs: unknown[], pkg: RPackage, onDone?: (done: number) => void): Promise<T[]> {
  return parallelMap(reqs, useCompute.getState().workers, (req, session) => rCallOn<T>(session, fn, req, pkg), onDone);
}

export function rScript(fn: string, req: unknown, pkg: RPackage): Promise<string> {
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callString(webR, `${fn}(req, export = TRUE)`, req));
}

/** An R error message without R's call prefix. */
export const rMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error in [^:]*: /, '').replace(/^Error: /, '');

/**
 * R's JSON (auto_unbox) writes a one-element vector as a scalar: one warning
 * arrives as a string, not a list. Always a list of strings.
 */
export const rStrings = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).filter((x): x is string => typeof x === 'string');
