// R runtime (webR) for calculations by the reference R packages. Loaded on
// first use from the app's own origin (public/webr: runtime + pinned package
// repository built by scripts/webr/fetch.mjs); nothing is fetched from third
// parties. One R session is shared; packages are installed on demand. Parallel
// work (bootstrap chunks) can use further sessions, each a webR in its own Worker.

import type { WebR } from 'webr';
import { cancelHelperCalls } from './helper';
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

/** One R session (a webR instance, in its own Web Worker) with its packages and sources. */
interface Session { webR: Promise<WebR> | null; installed: Set<string>; sourced: Set<string>; queue: Promise<unknown> }
const newSession = (): Session => ({ webR: null, installed: new Set(), sourced: new Set(), queue: Promise.resolve() });
// Session 0 serves every calculation; sessions 1.. are started only for parallel work (useCompute.workers).
const sessions: Session[] = [newSession()];
let options: RRuntimeOptions | null = null;

/** Interrupt the running R computations, in the browser and in the desktop helper (pending calls then reject). */
export function interruptR() {
  for (const s of sessions) void s.webR?.then((w) => w.interrupt()).catch(() => undefined);
  cancelHelperCalls();
}

/** Use a non-default runtime location (tests in Node). Must precede the first call. */
export function configureR(o: RRuntimeOptions) {
  if (sessions.some((s) => s.webR)) throw new Error('The R runtime is already started.');
  options = o;
}

function start(s: Session, index: number): Promise<WebR> {
  s.webR ??= (async () => {
    const o = options ?? browserOptions();
    // The SharedArrayBuffer channel (webR's recommended mode) lets R be interrupted, which
    // cancelling long calculations needs; it requires a cross-origin isolated page.
    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      throw new Error('The R engine needs a cross-origin isolated page (Cross-Origin-Opener-Policy: same-origin, Cross-Origin-Embedder-Policy: require-corp). Reload the page; if this persists, the server is missing these headers. Choose the built-in engine meanwhile.');
    }
    if (index === 0) useR.setState({ status: 'loading', message: 'Starting R…' });
    const { WebR, ChannelType } = await import('webr');
    const webR = new WebR({ baseUrl: o.baseUrl, repoUrl: o.repoUrl, channelType: ChannelType.SharedArrayBuffer });
    await webR.init();
    // webR limits nested R evaluation to 400 levels (R's default is 5000); cSEM's
    // resampling needs more. 5e5 is R's maximum; the C stack still guards recursion.
    await webR.evalRVoid('options(expressions = 5e5)');
    if (index === 0) useR.setState({ status: 'ready', message: '', versions: { R: webR.versionR, webR: webR.version } });
    return webR;
  })().catch((e) => {
    s.webR = null;
    if (index === 0) useR.setState({ status: 'error', message: (e as Error).message });
    throw e;
  });
  return s.webR;
}

// In Node (the webR tests), webR downloads packages with synchronous XHR, which
// uses a temporary file named after the process: two sessions downloading at
// once collide. Browsers have no such limit, so there sessions install in parallel.
let installLock: Promise<unknown> = Promise.resolve();
function installOneAtATime<T>(f: () => Promise<T>): Promise<T> {
  if (typeof window !== 'undefined') return f();
  const t = installLock.then(f);
  installLock = t.catch(() => undefined);
  return t;
}

/**
 * Run `fn` with an R session in which `packages` are installed and the given
 * R sources evaluated. Calls are serialised: R is single-threaded.
 */
export function withR<T>(packages: string[], sources: Record<string, string>, fn: (webR: WebR) => Promise<T>): Promise<T> {
  return withSession(0, packages, sources, fn);
}

/** As withR, in R session `index` (0: the main session; others run in parallel to it). */
export function withSession<T>(index: number, packages: string[], sources: Record<string, string>, fn: (webR: WebR) => Promise<T>): Promise<T> {
  while (sessions.length <= index) sessions.push(newSession());
  const s = sessions[index];
  const main = index === 0;
  const task = s.queue.then(async () => {
    const webR = await start(s, index);
    const o = options ?? browserOptions();
    const missing = packages.filter((p) => !s.installed.has(p));
    if (missing.length) {
      if (main) useR.setState({ status: 'loading', message: `Loading R packages: ${missing.join(', ')}…` });
      try {
        await installOneAtATime(() => webR.installPackages(missing, { quiet: true }));
        // installPackages only warns when a download fails; check before use.
        const absent = await notInstalled(webR, missing);
        if (absent.length) throw new Error(packageDownloadError(absent, o.repoUrl));
        const versions: Record<string, string> = {};
        for (const p of missing) {
          versions[p] = await webR.evalRString(`as.character(utils::packageVersion("${p}"))`);
          s.installed.add(p);
        }
        if (main) useR.setState((st) => ({ status: 'ready', message: '', versions: { ...st.versions, ...versions } }));
      } catch (e) {
        if (main) useR.setState({ status: 'error', message: (e as Error).message });
        throw e;
      }
    }
    for (const [name, code] of Object.entries(sources)) {
      if (s.sourced.has(name)) continue;
      await webR.evalRVoid(code);
      s.sourced.add(name);
    }
    try {
      return await fn(webR);
    } catch (e) {
      if (!isWasmCrash(e)) throw e;
      // Compiled package code crashed the WebAssembly runtime: the R session is no longer
      // usable. Discard it; the next calculation starts a fresh one.
      s.webR = null; s.installed.clear(); s.sourced.clear();
      try { webR.close(); } catch { /* already gone */ }
      if (main) useR.setState({ status: 'idle', message: '' });
      throw new Error(`${(e as Error).message}: the package's compiled code crashed in the browser's R (WebAssembly). R has been restarted for the next calculation. Check the inputs (for example that the id column identifies persons); if they are right, run the R script in desktop R.`, { cause: e });
    }
  });
  s.queue = task.catch(() => undefined);
  return task;
}

/**
 * Run `items` on up to `workers` R sessions at once (each session takes the
 * next item when it is free); results in the order of `items`. The first
 * failure rejects, and no further items are started.
 */
export async function parallelMap<I, O>(items: I[], workers: number, run: (item: I, session: number) => Promise<O>, onDone?: (done: number) => void): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0, done = 0, failed = false;
  const lane = async (session: number) => {
    while (!failed && next < items.length) {
      const i = next++;
      try { out[i] = await run(items[i], session); } catch (e) { failed = true; throw e; }
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, (_, k) => lane(k)));
  return out;
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

let observer: ((call: string, req: string) => void) | null = null;
/** Tests: see every bridge call (the injection tests replay them in desktop R). */
export function observeCalls(f: ((call: string, req: string) => void) | null) { observer = f; }

/** Evaluate `call` with the request (as JSON) bound to `req`; R returns a string. */
export function callString(webR: WebR, call: string, req: unknown): Promise<string> {
  const json = encode(req);
  observer?.(call, json);
  return webR.evalRString(call, { env: { req: json } });
}

/** As callString, for R functions that return JSON. */
export async function callJson(webR: WebR, call: string, req: unknown): Promise<unknown> {
  return JSON.parse(await callString(webR, call, req));
}
