// Calls into the R bridges (src/rengine/R/*.R). Every bridge function takes a
// JSON request and returns JSON results, or (export = TRUE) the self-contained
// R script that produces them.

import analysesR from './R/analyses.R?raw';
import bootR from './R/boot.R?raw';
import commonR from './R/common.R?raw';
import cpaR from './R/cpa.R?raw';
import lavaanR from './R/lavaan.R?raw';
import mcR from './R/mc.R?raw';
import plsR from './R/pls.R?raw';
import { callJson, callString, withR } from './runtime';

const SOURCES = { common: commonR, lavaan: lavaanR, pls: plsR, boot: bootR, analyses: analysesR, mc: mcR, cpa: cpaR };

export const R_PACKAGES = {
  lavaan: ['jsonlite', 'lavaan', 'semTools'],
  cSEM: ['jsonlite', 'cSEM'],
  seminr: ['jsonlite', 'seminr'],
  MIIVsem: ['jsonlite', 'lavaan', 'MIIVsem'],
  simulation: ['jsonlite', 'lavaan', 'cSEM'],
  manymome: ['jsonlite', 'manymome'],
} as const;
export type RPackage = keyof typeof R_PACKAGES;

export function rCall<T>(fn: string, req: unknown, pkg: RPackage): Promise<T> {
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callJson(webR, `${fn}(req)`, req)) as Promise<T>;
}

export function rScript(fn: string, req: unknown, pkg: RPackage): Promise<string> {
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) => callString(webR, `${fn}(req, export = TRUE)`, req));
}

/** An R error message without R's call prefix. */
export const rMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error in [^:]*: /, '').replace(/^Error: /, '');
