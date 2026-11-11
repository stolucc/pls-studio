// The desktop helper (helper/, pls-studio-helper): runs the R bridge in the
// R installed on this computer, on all its cores, instead of the browser's R.
// It listens on 127.0.0.1 only; the browser connects once (the person at the
// computer clicks Allow in the helper's dialog, or enters the helper's 6-digit
// pairing code) and then authenticates with a bearer token kept in this browser. The helper runs only the bridge's ps_* functions, from its
// own copy of the R code: the browser uses it only when that copy is the
// same as its own (bridge hash).

import { create } from 'zustand';

const HELPER_PORT = 9878;

/** Release downloads (GitHub; asset names carry no version, see .github/workflows/helper-release.yml). */
export const HELPER_RELEASES = 'https://github.com/stolucc/pls-studio/releases/latest';
const asset = (name: string) => `${HELPER_RELEASES}/download/${name}`;
export interface HelperDownload {
  label: string;
  url: string;
}
/**
 * Downloads for this computer, the likeliest first (the browser cannot tell
 * Apple Silicon from Intel Macs reliably, so a Mac gets both).
 */
export function helperDownloads(platform: string): HelperDownload[] {
  const p = platform.toLowerCase();
  if (/mac|darwin|iphone|ipad/.test(p))
    return [
      { label: 'macOS (Apple Silicon)', url: asset('PLS-Studio-Helper-arm64.dmg') },
      { label: 'macOS (Intel)', url: asset('PLS-Studio-Helper-amd64.dmg') },
    ];
  if (/win/.test(p))
    return [{ label: 'Windows', url: asset('pls-studio-helper-windows-amd64.exe') }];
  if (/linux|x11/.test(p)) return [{ label: 'Linux', url: asset('pls-studio-helper-linux-amd64') }];
  return [];
}
/** The browser's platform, for helperDownloads. */
export const browserPlatform = () => {
  const n =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & { userAgentData?: { platform?: string } })
      : null;
  return n ? n.userAgentData?.platform || n.platform || n.userAgent : '';
};
const BASE = `http://127.0.0.1:${HELPER_PORT}`;
const TOKEN_KEY = 'pls-studio.helper.token';

export type HelperState =
  | 'unknown'
  | 'checking'
  | 'absent'
  | 'unpaired'
  | 'no-r'
  | 'mismatch'
  | 'ready';
export interface HelperInfo {
  helperVersion: string;
  r: string;
  workers: number;
  rError?: string;
}
interface HelperStore {
  state: HelperState;
  info: HelperInfo | null;
  /** Installed versions of the packages the app uses (null: not installed). */
  packages: Record<string, string | null>;
  message: string;
}
export const useHelper = create<HelperStore>(() => ({
  state: 'unknown',
  info: null,
  packages: {},
  message: '',
}));

/** One request to the helper's R, and its reply (the worker's JSON line). */
export interface HelperRequest {
  id: string;
  fn: string;
  req: string;
  export: boolean;
  packages: string[];
}
export type HelperReply = {
  id?: string;
  ok: boolean;
  result?: string;
  kind?: string;
  message?: string;
  packages?: string[];
};
/**
 * Another way to reach desktop R than the helper's HTTP API: the tests' native mode (src/rengine/nativeR.ts) runs the
 * same R workers as the helper in this process. When set, every helper call goes through it and the helper counts as ready.
 */
export interface HelperTransport {
  info: HelperInfo;
  call(r: HelperRequest): Promise<HelperReply>;
  /** Every call's reply, as each finishes (any order). */
  batch(calls: HelperRequest[], onReply: (rep: HelperReply) => void): Promise<void>;
  /** Installed versions of `packages` (null: not installed). */
  packages(packages: string[]): Promise<Record<string, string | null>>;
}
let transport: HelperTransport | null = null;
export function setHelperTransport(t: HelperTransport | null) {
  transport = t;
}

/** The helper cannot be used for this call: the caller falls back to the browser's R. */
export class HelperUnavailable extends Error {}

/** The origins the helper trusts out of the box (helper/config.go): development, preview and the local server. */
const DEFAULT_HELPER_ORIGINS = [
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:4175',
  'http://127.0.0.1:4175',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
];

/**
 * The helper answers only pages from origins on its allow list, and a
 * deployment is not on it until added: the command to run once, for this
 * origin (null for the origins it trusts by default).
 */
export function helperAllowCommand(origin: string): string | null {
  if (DEFAULT_HELPER_ORIGINS.includes(origin) || !/^https?:\/\//.test(origin)) return null;
  return `pls-studio-helper allow-origin ${origin}`;
}
/** R packages the helper's R lacks (the call falls back to the browser's R). */
export class HelperMissingPackages extends HelperUnavailable {
  constructor(public packages: string[]) {
    super(`Desktop R lacks the R package${packages.length > 1 ? 's' : ''} ${packages.join(', ')}.`);
  }
}

const getToken = () => {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const setToken = (t: string) => {
  try {
    if (t) globalThis.localStorage?.setItem(TOKEN_KEY, t);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};

let lnaRequested = false;
/**
 * fetch to the helper. Chrome's Local Network Access needs a permission (asked
 * once) and the request marked as going to the loopback address space.
 */
async function helperFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<Response> {
  if (!lnaRequested) {
    lnaRequested = true;
    try {
      await (
        navigator as unknown as {
          permissions?: { request?: (d: { name: string }) => Promise<unknown> };
        }
      ).permissions?.request?.({ name: 'local-network-access' });
    } catch {
      /* not supported */
    }
  }
  const ctl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : undefined;
  init.signal?.addEventListener('abort', () => ctl.abort());
  try {
    return await fetch(BASE + path, {
      ...init,
      signal: ctl.signal,
      targetAddressSpace: 'loopback',
    } as RequestInit);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const auth = () => ({ Authorization: `Bearer ${getToken()}` });

/** SHA-256 over the R sources in file-name order, each as "<name>\n<content>\n" (as the helper computes it). */
export async function bridgeHash(sources: Record<string, string>): Promise<string> {
  const names = Object.keys(sources).sort((a, b) => (`${a}.R` < `${b}.R` ? -1 : 1));
  const text = names.map((n) => `${n}\n${sources[n]}\n`).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check the helper: running? paired? R available? the same R bridge? Sets
 * useHelper.state; `ready` means calculations can go to it.
 */
export async function probeHelper(
  sources: Record<string, string>,
  packages: string[],
): Promise<HelperState> {
  const set = (state: HelperState, message = '', more: Partial<HelperStore> = {}) => {
    useHelper.setState({ state, message, ...more });
    return state;
  };
  if (transport)
    return set('ready', '', { info: transport.info, packages: await transport.packages(packages) });
  set('checking');
  try {
    const h = await helperFetch('/health', {}, 1500);
    if (!h.ok) return set('absent', 'The helper is not running.');
  } catch {
    return set('absent', 'The helper is not running.');
  }
  if (!getToken()) return set('unpaired', 'Connect this browser to the helper.');
  let v: Response;
  try {
    v = await helperFetch('/version', { headers: auth() }, 3000);
  } catch {
    return set('absent', 'The helper is not running.');
  }
  if (v.status === 401) {
    setToken('');
    return set(
      'unpaired',
      'The helper was paired with another browser, or its token was rotated: connect again.',
    );
  }
  if (!v.ok) return set('absent', `The helper answered ${v.status}.`);
  const raw = (await v.json()) as {
    helper_version?: string;
    bridge?: string;
    r?: string;
    workers?: number;
    r_error?: string;
  };
  const info: HelperInfo = {
    helperVersion: String(raw.helper_version ?? ''),
    r: String(raw.r ?? ''),
    workers: Number(raw.workers ?? 0),
    ...(raw.r_error ? { rError: String(raw.r_error) } : {}),
  };
  if (raw.r_error) return set('no-r', raw.r_error, { info });
  if (raw.bridge !== (await bridgeHash(sources)))
    return set(
      'mismatch',
      `This site’s R code is newer than the helper installed here (helper ${info.helperVersion || 'of unknown version'}): install the current helper, then check again.`,
      { info },
    );
  let versions: Record<string, string | null> = {};
  try {
    const p = await helperFetch(
      '/packages',
      {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ packages }),
      },
      30000,
    );
    if (p.ok)
      versions = ((await p.json()) as { versions?: Record<string, string | null> }).versions ?? {};
  } catch {
    /* versions stay unknown */
  }
  return set('ready', '', {
    info,
    packages: Object.fromEntries(packages.map((k) => [k, versions[k] ?? null])),
  });
}

/** The bearer token from a /connect or /pair answer, checked and stored. */
async function keepToken(r: Response) {
  const { token } = (await r.json()) as { token?: string };
  if (!token || !/^[0-9a-f]{64}$/.test(token)) throw new Error('The helper sent no valid token.');
  setToken(token);
}

/**
 * Connect without a code: the helper asks in a dialog on this computer
 * whether this page may use desktop R (waits up to 2 minutes for the answer).
 */
export async function connectHelper(): Promise<void> {
  let r: Response;
  try {
    r = await helperFetch('/connect', { method: 'POST' }, 130_000);
  } catch {
    throw new Error('The helper is not running, or did not answer.');
  }
  if (r.status === 409)
    throw new Error('This helper cannot show a dialog (no tray): enter a pairing code instead.');
  if (r.status === 429)
    throw new Error('Another connection is waiting for approval in the helper.');
  if (r.status === 403)
    throw new Error('Not allowed in the helper (or the origin is not trusted).');
  if (!r.ok) throw new Error(`The helper answered ${r.status}.`);
  await keepToken(r);
}

/** What the helper says about updating itself (GET /update; helpers before 0.1.9 have no such route). */
export interface HelperUpdate {
  current: string;
  latest?: string;
  available: boolean;
  reason?: string;
  error?: string;
}

/** Can the paired helper update itself to a newer release? null: this helper cannot say (too old, or not answering). */
export async function checkHelperUpdate(): Promise<HelperUpdate | null> {
  try {
    const r = await helperFetch('/update', { headers: auth() }, 15000);
    if (!r.ok) return null;
    return (await r.json()) as HelperUpdate;
  } catch {
    return null;
  }
}

/**
 * Ask the paired helper to install its latest release (it verifies the release's signature and checksum itself and
 * fetches only from its own repository) and restart; then wait for it to come back. Resolves with the version installed.
 */
export async function updateHelper(waitMs = 90_000): Promise<string> {
  let r: Response;
  try {
    r = await helperFetch('/update', { method: 'POST', headers: auth() }, 10 * 60_000);
  } catch {
    throw new Error('The helper did not answer.');
  }
  const body = (await r.json().catch(() => ({}))) as {
    to?: string;
    error?: string;
    reason?: string;
  };
  if (!r.ok) throw new Error(body.error ?? body.reason ?? `The helper answered ${r.status}.`);
  // It restarts: wait until it answers again.
  const until = Date.now() + waitMs;
  await new Promise((res) => setTimeout(res, 1500));
  while (Date.now() < until) {
    try {
      if ((await helperFetch('/health', {}, 1500)).ok) return body.to ?? '';
    } catch {
      /* restarting */
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error('The helper was updated but has not restarted: start it again.');
}

/** Pair with the code the helper shows; stores the token in this browser. */
export async function pairHelper(code: string): Promise<void> {
  if (!/^\d{6}$/.test(code.trim())) throw new Error('The pairing code has 6 digits.');
  let r: Response;
  try {
    r = await helperFetch(
      '/pair',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      },
      5000,
    );
  } catch {
    throw new Error('The helper is not running.');
  }
  if (r.status === 403) throw new Error('Wrong or expired code: generate a new one in the helper.');
  if (!r.ok) throw new Error(`The helper answered ${r.status}.`);
  await keepToken(r);
}

/** Forget the pairing in this browser (the helper keeps running). */
export function unpairHelper() {
  setToken('');
  useHelper.setState({ state: 'unpaired', message: 'Not paired.', packages: {} });
}

/** Paired with a helper that has not been found missing: worth asking before the server (R need not work for this). */
export const helperConnected = () =>
  !!getToken() &&
  useHelper.getState().state !== 'absent' &&
  useHelper.getState().state !== 'unpaired';

/**
 * A file of the Mplus User's Guide examples (e.g. chap6/ex6.19.dat), which the helper downloads from statmodel.com
 * (GET /example-data/statmodel/<path>): statmodel.com sends no CORS header, so the browser cannot read it itself.
 * Throws HelperUnavailable (the caller asks the server instead), also from helpers without the route.
 */
export async function helperExampleData(path: string): Promise<Uint8Array> {
  const r = await helperFetch(`/example-data/statmodel/${path}`, { headers: auth() }, 60_000);
  if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('text/plain'))
    throw new HelperUnavailable(`The helper answered ${r.status}.`);
  return new Uint8Array(await r.arrayBuffer());
}

const running = new Set<string>();
let seq = 0;
const newId = () => `c${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** POST to the helper, waiting and retrying while it answers 429 (rate limit). */
async function postRetrying(path: string, body: string, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await helperFetch(path, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body,
    });
    if (r.status !== 429 || i >= tries - 1) return r;
    const wait = Math.min(30, Math.max(1, Number(r.headers.get('Retry-After')) || 1));
    await new Promise((res) => setTimeout(res, wait * 1000));
  }
}

type Reply = HelperReply;
/** A reply's result, or the error it stands for. */
function resultOf(rep: Reply): string {
  if (rep.ok) return rep.result ?? '';
  if (rep.kind === 'missing_packages') throw new HelperMissingPackages(rep.packages ?? []);
  if (rep.kind === 'cancelled') throw new Error('Cancelled.');
  if (rep.kind === 'helper_error')
    throw new HelperUnavailable(rep.message ?? 'The helper could not run R.');
  throw new Error(rep.message ?? 'R error');
}

/**
 * Run a bridge function in the helper's R. Returns the function's result (JSON
 * text, or the R script when exporting). R errors throw Error; problems with
 * the helper itself throw HelperUnavailable (the caller uses the browser's R).
 */
export async function helperCall(
  fn: string,
  req: string,
  packages: string[],
  exportScript = false,
): Promise<string> {
  const id = newId();
  if (transport)
    return resultOf(await transport.call({ id, fn, req, export: exportScript, packages }));
  running.add(id);
  let r: Response;
  try {
    r = await postRetrying(
      '/call',
      JSON.stringify({ id, fn, req, export: exportScript, packages }),
    );
  } catch {
    useHelper.setState({ state: 'absent', message: 'The helper stopped.' });
    throw new HelperUnavailable('The desktop R helper is not reachable.');
  } finally {
    running.delete(id);
  }
  if (r.status === 401) {
    setToken('');
    useHelper.setState({ state: 'unpaired', message: 'Pair again.' });
    throw new HelperUnavailable('The helper no longer accepts this browser: pair again.');
  }
  if (!r.ok) throw new HelperUnavailable(`The helper answered ${r.status}.`);
  return resultOf((await r.json()) as Reply);
}

/**
 * Many calls of one bridge function in one request (/batch): the helper runs
 * them on all its R processes and streams each reply as it finishes (browsers
 * open at most six connections to a host, so separate calls would leave R
 * processes idle). Results in request order; `onDone` counts finished calls.
 * The first failure rejects (R error: Error; helper problem: HelperUnavailable).
 */
export async function helperBatch(
  fn: string,
  reqs: string[],
  packages: string[],
  onDone?: (done: number) => void,
): Promise<string[]> {
  const ids = reqs.map(() => newId());
  const index = new Map(ids.map((id, i) => [id, i]));
  if (transport) {
    const out = new Array<string>(reqs.length);
    let done = 0;
    await transport.batch(
      reqs.map((req, i) => ({ id: ids[i], fn, req, export: false, packages })),
      (rep) => {
        const i = index.get(rep.id ?? '');
        if (i === undefined) return;
        out[i] = resultOf(rep);
        done++;
        onDone?.(done);
      },
    );
    return out;
  }
  ids.forEach((id) => running.add(id));
  try {
    let r: Response;
    try {
      r = await postRetrying(
        '/batch',
        JSON.stringify({
          calls: reqs.map((req, i) => ({ id: ids[i], fn, req, export: false, packages })),
        }),
      );
    } catch {
      useHelper.setState({ state: 'absent', message: 'The helper stopped.' });
      throw new HelperUnavailable('The desktop R helper is not reachable.');
    }
    if (r.status === 401) {
      setToken('');
      useHelper.setState({ state: 'unpaired', message: 'Pair again.' });
      throw new HelperUnavailable('The helper no longer accepts this browser: connect again.');
    }
    if (!r.ok || !r.body) throw new HelperUnavailable(`The helper answered ${r.status}.`);
    const out = new Array<string>(reqs.length);
    let done = 0;
    let buf = '';
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    const take = (line: string) => {
      if (!line.trim()) return;
      const rep = JSON.parse(line) as Reply;
      const i = index.get(rep.id ?? '');
      if (i === undefined) return;
      out[i] = resultOf(rep);
      done++; // (not inside onDone?.(): without a callback its argument would not be evaluated)
      onDone?.(done);
    };
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          take(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      take(buf + decoder.decode());
    } catch (e) {
      void reader.cancel().catch(() => undefined); // (closing the stream stops the remaining calls)
      if (e instanceof TypeError)
        throw new HelperUnavailable('The connection to the helper broke off.');
      throw e;
    }
    if (done !== reqs.length)
      throw new HelperUnavailable('The helper did not answer every calculation.');
    return out;
  } finally {
    ids.forEach((id) => running.delete(id));
  }
}

/** Stop every calculation running in the helper. */
export function cancelHelperCalls() {
  for (const id of running)
    void helperFetch(`/cancel/${id}`, { method: 'POST', headers: auth() }, 3000).catch(
      () => undefined,
    );
}
