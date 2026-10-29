// R runtime (webR) for calculations by the reference R packages. Loaded on
// first use from the app's own origin (public/webr: runtime + pinned package
// repository built by scripts/webr/fetch.mjs); nothing is fetched from third
// parties. One R session is shared; packages are installed on demand.

import type { WebR } from 'webr';
import { useR } from './status';

export { useR };

export interface RRuntimeOptions {
  /** Where R.wasm, webr-worker.js and vfs/ live. */
  baseUrl: string;
  /** Root of the package repository (contains bin/emscripten/contrib/<R>/). */
  repoUrl: string;
}

const browserOptions = (): RRuntimeOptions => {
  const root = new URL(`${import.meta.env.BASE_URL}webr/`, window.location.href).href;
  return { baseUrl: root, repoUrl: `${root}repo/` };
};

let session: Promise<WebR> | null = null;
let options: RRuntimeOptions | null = null;
const installed = new Set<string>();
const sourced = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

/** Interrupt the running R computation (the pending call then rejects). */
export function interruptR() {
  void session?.then((w) => w.interrupt()).catch(() => undefined);
}

/** Use a non-default runtime location (tests in Node). Must precede the first call. */
export function configureR(o: RRuntimeOptions) {
  if (session) throw new Error('The R runtime is already started.');
  options = o;
}

function start(): Promise<WebR> {
  session ??= (async () => {
    const o = options ?? browserOptions();
    // The SharedArrayBuffer channel (webR's recommended mode) lets R be interrupted, which
    // cancelling long calculations needs; it requires a cross-origin isolated page.
    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      throw new Error('The R engine needs a cross-origin isolated page (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp). Reload the page; if this persists, the server is missing these headers. Choose the built-in engine meanwhile.');
    }
    useR.setState({ status: 'loading', message: 'Starting R…' });
    const { WebR, ChannelType } = await import('webr');
    const webR = new WebR({ baseUrl: o.baseUrl, repoUrl: o.repoUrl, channelType: ChannelType.SharedArrayBuffer });
    await webR.init();
    // webR limits nested R evaluation to 400 levels (R's default is 5000); cSEM's
    // resampling needs more. 5e5 is R's maximum; the C stack still guards recursion.
    await webR.evalRVoid('options(expressions = 5e5)');
    useR.setState({ status: 'ready', message: '', versions: { R: webR.versionR, webR: webR.version } });
    return webR;
  })().catch((e) => {
    session = null;
    useR.setState({ status: 'error', message: (e as Error).message });
    throw e;
  });
  return session;
}

/**
 * Run `fn` with an R session in which `packages` are installed and the given
 * R sources evaluated. Calls are serialised: R is single-threaded.
 */
export function withR<T>(packages: string[], sources: Record<string, string>, fn: (webR: WebR) => Promise<T>): Promise<T> {
  const task = queue.then(async () => {
    const webR = await start();
    const o = options ?? browserOptions();
    const missing = packages.filter((p) => !installed.has(p));
    if (missing.length) {
      useR.setState({ status: 'loading', message: `Loading R packages: ${missing.join(', ')}…` });
      try {
        await webR.installPackages(missing, { quiet: true });
        // installPackages only warns when a download fails; check before use.
        const absent = await notInstalled(webR, missing);
        if (absent.length) throw new Error(packageDownloadError(absent, o.repoUrl));
        const versions: Record<string, string> = {};
        for (const p of missing) {
          versions[p] = await webR.evalRString(`as.character(utils::packageVersion("${p}"))`);
          installed.add(p);
        }
        useR.setState((s) => ({ status: 'ready', message: '', versions: { ...s.versions, ...versions } }));
      } catch (e) {
        useR.setState({ status: 'error', message: (e as Error).message });
        throw e;
      }
    }
    for (const [name, code] of Object.entries(sources)) {
      if (sourced.has(name)) continue;
      await webR.evalRVoid(code);
      sourced.add(name);
    }
    try {
      return await fn(webR);
    } catch (e) {
      if (!isWasmCrash(e)) throw e;
      // Compiled package code crashed the WebAssembly runtime: the R session is no longer
      // usable. Discard it; the next calculation starts a fresh one.
      session = null; installed.clear(); sourced.clear();
      try { webR.close(); } catch { /* already gone */ }
      useR.setState({ status: 'idle', message: '' });
      throw new Error(`${(e as Error).message}: the package's compiled code crashed in the browser's R (WebAssembly). R has been restarted for the next calculation. Check the inputs (for example that the id column identifies persons); if they are right, run the R script in desktop R.`, { cause: e });
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

/** A WebAssembly trap (not an R error): the R session cannot continue after it. */
export function isWasmCrash(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return /memory access out of bounds|unreachable executed|^RuntimeError|Aborted\(|call stack size exceeded|out of memory/i.test(m);
}

/** Packages (from `packages`) that R cannot load. Names are package names, never user input. */
async function notInstalled(webR: WebR, packages: string[]): Promise<string[]> {
  const ok = await webR.evalRRaw(`vapply(c(${packages.map((p) => JSON.stringify(p)).join(', ')}), requireNamespace, TRUE, quietly = TRUE)`, 'boolean[]');
  return packages.filter((_p, i) => !ok[i]);
}

/** The message when R packages could not be downloaded from the app's own server. */
export function packageDownloadError(packages: string[], repoUrl: string): string {
  return `Could not download the R package${packages.length > 1 ? 's' : ''} ${packages.join(', ')} from ${repoUrl}. `
    + 'The app server may have stopped or been restarted: check that it is running and reload the page.';
}

const encode = (req: unknown) => JSON.stringify(req, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));

/** Evaluate `call` with the request (as JSON) bound to `req`; R returns a string. */
export function callString(webR: WebR, call: string, req: unknown): Promise<string> {
  return webR.evalRString(call, { env: { req: encode(req) } });
}

/** As callString, for R functions that return JSON. */
export async function callJson(webR: WebR, call: string, req: unknown): Promise<unknown> {
  return JSON.parse(await callString(webR, call, req));
}
