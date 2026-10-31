import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime', () => ({
  withR: vi.fn(async () => { throw new Error('browser R used'); }),
  withSession: vi.fn(async () => { throw new Error('browser R used'); }),
  parallelMap: vi.fn(),
  callJson: vi.fn(), callString: vi.fn(),
}));
vi.mock('../store', () => ({ useStore: { getState: () => ({ toast: toasts }) } }));
const toasts = vi.fn();

type Handler = (path: string, init: RequestInit) => { status?: number; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } | 'down';
let handler: Handler = () => 'down';
const store = new Map<string, string>();

beforeEach(() => {
  store.clear(); toasts.mockClear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    expect(url.startsWith('http://127.0.0.1:9878/')).toBe(true);
    const r = handler(url.slice('http://127.0.0.1:9878'.length), init);
    if (r === 'down') throw new TypeError('Failed to fetch');
    return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

const TOKEN = 'a'.repeat(64);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('bridgeHash', () => {
  it('hashes the sources in file-name order, as the helper does', async () => {
    const { bridgeHash } = await import('./helper');
    expect(await bridgeHash({ pls: 'B', boot: 'A', plsx: 'C' })).toBe(sha('boot\nA\npls\nB\nplsx\nC\n'));
  });
  it('equals the hash of the helper’s embedded copy of the bridge', async () => {
    const { bridgeHash } = await import('./helper');
    const { SOURCES } = await import('./bridge');
    const dir = join(__dirname, '..', '..', 'helper', 'rsrc');
    const files = readdirSync(dir).filter((f) => f.endsWith('.R')).sort();
    const go = sha(files.map((f) => `${f.slice(0, -2)}\n${readFileSync(join(dir, f), 'utf8')}\n`).join(''));
    expect(await bridgeHash(SOURCES)).toBe(go);
  });
});

describe('probeHelper', () => {
  const sources = { common: 'x' };
  const ok = async () => (await import('./helper')).bridgeHash(sources);
  it('absent, unpaired, rejected token, no R, other bridge, ready', async () => {
    const { probeHelper, useHelper } = await import('./helper');
    handler = () => 'down';
    expect(await probeHelper(sources, ['cSEM'])).toBe('absent');
    handler = () => ({ body: { ok: true } });
    expect(await probeHelper(sources, ['cSEM'])).toBe('unpaired');
    store.set('pls-studio.helper.token', TOKEN);
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { status: 401 });
    expect(await probeHelper(sources, ['cSEM'])).toBe('unpaired');
    expect(store.has('pls-studio.helper.token')).toBe(false);
    store.set('pls-studio.helper.token', TOKEN);
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { body: { bridge: 'x', r_error: 'Rscript not found' } });
    expect(await probeHelper(sources, ['cSEM'])).toBe('no-r');
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { body: { bridge: 'other', r: 'R version 4.4.1' } });
    expect(await probeHelper(sources, ['cSEM'])).toBe('mismatch');
    const hash = await ok();
    handler = (p, init) => {
      if (p === '/health') return { body: { ok: true } };
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      if (p === '/version') return { body: { bridge: hash, r: 'R version 4.4.1 (2024-06-14)', workers: 7, helper_version: '0.1.0' } };
      return { body: { versions: { cSEM: '0.6.1', lavaan: null } } };
    };
    expect(await probeHelper(sources, ['cSEM', 'lavaan'])).toBe('ready');
    expect(useHelper.getState().packages).toEqual({ cSEM: '0.6.1', lavaan: null });
    expect(useHelper.getState().info?.workers).toBe(7);
  });
});

describe('pairHelper', () => {
  it('checks the code, reports a wrong one and stores the token', async () => {
    const { pairHelper } = await import('./helper');
    await expect(pairHelper('12ab56')).rejects.toThrow('6 digits');
    handler = () => ({ status: 403 });
    await expect(pairHelper('123456')).rejects.toThrow('Wrong or expired');
    handler = () => ({ body: { token: 'not-hex' } });
    await expect(pairHelper('123456')).rejects.toThrow('no valid token');
    handler = (_p, init) => { expect(JSON.parse(String(init.body))).toEqual({ code: '123456' }); return { body: { token: TOKEN } }; };
    await pairHelper(' 123456 ');
    expect(store.get('pls-studio.helper.token')).toBe(TOKEN);
  });
});

describe('helperCall', () => {
  it('returns results, and tells R errors from helper problems', async () => {
    const { helperCall, HelperMissingPackages, HelperUnavailable } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    handler = (_p, init) => { const b = JSON.parse(String(init.body)); return { body: { id: b.id, ok: true, result: `${b.fn}:${b.req}:${b.export}` } }; };
    expect(await helperCall('ps_pls', '{"a":1}', ['cSEM'], true)).toBe('ps_pls:{"a":1}:true');
    handler = () => ({ body: { ok: false, kind: 'missing_packages', packages: ['seminr'] } });
    await expect(helperCall('ps_pls', '{}', ['seminr'])).rejects.toBeInstanceOf(HelperMissingPackages);
    handler = () => ({ body: { ok: false, kind: 'helper_error', message: 'R stopped' } });
    await expect(helperCall('ps_pls', '{}', [])).rejects.toBeInstanceOf(HelperUnavailable);
    handler = () => ({ body: { ok: false, kind: 'r_error', message: 'Invalid weighting scheme in the request.' } });
    const e = await helperCall('ps_pls', '{}', []).catch((x) => x);
    expect(e).not.toBeInstanceOf(HelperUnavailable);
    expect(e.message).toBe('Invalid weighting scheme in the request.');
    handler = () => 'down';
    await expect(helperCall('ps_pls', '{}', [])).rejects.toBeInstanceOf(HelperUnavailable);
  });
});

describe('bridge routing', () => {
  const ready = async () => {
    const { bridgeHash } = await import('./helper');
    const { SOURCES } = await import('./bridge');
    const hash = await bridgeHash(SOURCES);
    store.set('pls-studio.helper.token', TOKEN);
    (await import('./compute')).useCompute.getState().set({ backend: 'helper', workers: 1 });
    return hash;
  };
  it('sends calls to desktop R when chosen and ready, and marks the results', async () => {
    const hash = await ready();
    const calls: string[] = [];
    handler = (p, init) => {
      if (p === '/health') return { body: { ok: true } };
      if (p === '/version') return { body: { bridge: hash, r: 'R version 4.4.1', workers: 3 } };
      if (p === '/packages') return { body: { versions: { cSEM: '0.6.1' } } };
      const b = JSON.parse(String(init.body));
      calls.push(b.fn);
      return { body: { ok: true, result: JSON.stringify({ n: 5, engine: { package: 'cSEM', version: '0.6.1' } }) } };
    };
    const { rCall, computeLocation } = await import('./bridge');
    const r = await rCall<{ n: number; engine: { desktop?: string } }>('ps_pls', { x: 1 }, 'cSEM');
    expect(r.n).toBe(5);
    expect(r.engine.desktop).toBe('R version 4.4.1');
    expect(calls).toEqual(['ps_pls']);
    expect(computeLocation('cSEM')).toEqual({ where: 'desktop', version: '0.6.1' });
  });
  it('falls back to the browser’s R (with a notice) when packages are missing or the helper is gone', async () => {
    const hash = await ready();
    handler = (p) => {
      if (p === '/health') return { body: { ok: true } };
      if (p === '/version') return { body: { bridge: hash, r: 'R version 4.4.1', workers: 3 } };
      if (p === '/packages') return { body: { versions: {} } };
      return { body: { ok: false, kind: 'missing_packages', packages: ['seminr'] } };
    };
    const { rCall } = await import('./bridge');
    await expect(rCall('ps_pls', {}, 'seminr')).rejects.toThrow('browser R used');
    await vi.waitFor(() => expect(toasts).toHaveBeenCalledWith('info', expect.stringContaining('pls-studio-helper setup')));
  });
  it('uses the browser’s R when the helper is not running', async () => {
    await ready();
    handler = () => 'down';
    const { rCall } = await import('./bridge');
    await expect(rCall('ps_pls', {}, 'cSEM')).rejects.toThrow('browser R used');
    await vi.waitFor(() => expect(toasts).toHaveBeenCalledWith('info', expect.stringContaining('Desktop R is not available')));
  });
});

describe('connectHelper', () => {
  it('stores the token when allowed, and explains a refusal', async () => {
    const { connectHelper } = await import('./helper');
    handler = (p, init) => { expect(p).toBe('/connect'); expect(init.method).toBe('POST'); return { body: { token: TOKEN } }; };
    await connectHelper();
    expect(store.get('pls-studio.helper.token')).toBe(TOKEN);
    handler = () => ({ status: 403 });
    await expect(connectHelper()).rejects.toThrow('Not allowed');
    handler = () => ({ status: 409 });
    await expect(connectHelper()).rejects.toThrow('pairing code');
    handler = () => ({ status: 429 });
    await expect(connectHelper()).rejects.toThrow('waiting for approval');
    handler = () => 'down';
    await expect(connectHelper()).rejects.toThrow('not running');
  });
});

describe('helperDownloads', () => {
  it('offers this system’s download first, from the latest release', async () => {
    const { helperDownloads } = await import('./helper');
    const mac = helperDownloads('MacIntel');
    expect(mac.map((d) => d.label)).toEqual(['macOS (Apple Silicon)', 'macOS (Intel)']);
    expect(mac[0].url).toBe('https://github.com/stolucc/pls-studio/releases/latest/download/PLS-Studio-Helper-arm64.dmg');
    expect(helperDownloads('Windows')[0].url).toMatch(/pls-studio-helper-windows-amd64\.exe$/);
    expect(helperDownloads('Linux x86_64')[0].url).toMatch(/pls-studio-helper-linux-amd64$/);
    expect(helperDownloads('')).toEqual([]);
  });
  it('names exactly the assets the release workflow publishes', async () => {
    const { helperDownloads } = await import('./helper');
    const wf = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'helper-release.yml'), 'utf8');
    for (const d of ['Mac', 'Windows', 'Linux'].flatMap((p) => helperDownloads(p))) expect(wf).toContain(`dist/${d.url.split('/').pop()}`);
  });
});

describe('parallelism with desktop R', () => {
  const readyHelper = async (workers: number, seen: Record<string, unknown>[]) => {
    const { bridgeHash } = await import('./helper');
    const { SOURCES } = await import('./bridge');
    const hash = await bridgeHash(SOURCES);
    store.set('pls-studio.helper.token', TOKEN);
    handler = (p, init) => {
      if (p === '/health') return { body: { ok: true } };
      if (p === '/version') return { body: { bridge: hash, r: 'R version 4.3.1', workers } };
      if (p === '/packages') return { body: { versions: { cSEM: '0.7.1', lavaan: '0.7-3' } } };
      const b = JSON.parse(String(init.body));
      seen.push({ fn: b.fn, req: JSON.parse(b.req) });
      return { body: { ok: true, result: '{"ok":1}' } };
    };
  };
  it('is automatic: the helper’s processes, whatever the browser setting', async () => {
    await readyHelper(13, []);
    const { useCompute } = await import('./compute');
    useCompute.getState().set({ backend: 'helper', workers: 1 });
    const { parallelism } = await import('./bridge');
    expect(await parallelism()).toEqual({ where: 'desktop', sessions: 13 });
    useCompute.getState().set({ backend: 'browser', workers: 4 });
    expect(await parallelism()).toEqual({ where: 'browser', sessions: 4 });
  });
  it('cSEM bootstraps use the cores in one process; lavaan bootstraps are chunked', async () => {
    const seen: Record<string, any>[] = [];
    await readyHelper(13, seen);
    const { useCompute } = await import('./compute');
    useCompute.getState().set({ backend: 'helper', workers: 1 });
    const { bootParallel } = await import('./analyses');
    const boot = { samples: 500, seed: 1, confidence: 0.95 };
    const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };
    expect(await bootParallel({ kind: 'plsBoot', pkg: 'cSEM', options, boot })).toBe(false);
    expect(await bootParallel({ kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot })).toBe(true);
    const { rCall } = await import('./bridge');
    await rCall('ps_pls_boot', { boot }, 'cSEM');
    await rCall('ps_cca', { samples: 99 }, 'cSEM');
    await rCall('ps_pls_boot', { boot: { ...boot, chunkR: [100], chunkSeed: [1], part: 1 } }, 'cSEM');
    await rCall('ps_pls', {}, 'cSEM');
    expect(seen.map((s) => [s.fn, s.req.cores])).toEqual([['ps_pls_boot', 13], ['ps_cca', 13], ['ps_pls_boot', undefined], ['ps_pls', undefined]]);
    // In the browser, the setting decides.
    useCompute.getState().set({ backend: 'browser', workers: 1 });
    expect(await bootParallel({ kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot })).toBe(false);
    useCompute.getState().set({ workers: 4 });
    expect(await bootParallel({ kind: 'plsBoot', pkg: 'cSEM', options, boot })).toBe(true);
    expect(await bootParallel({ kind: 'plsBoot', pkg: 'seminr', options, boot })).toBe(false);
  });
});

/** An NDJSON body delivered in pieces (lines split across chunks). */
const pieces = (text: string, size: number) => new ReadableStream<Uint8Array>({
  start(c) { const b = new TextEncoder().encode(text); for (let i = 0; i < b.length; i += size) c.enqueue(b.slice(i, i + size)); c.close(); },
});

describe('helperBatch', () => {
  it('reads streamed replies in any order and returns them in request order', async () => {
    const { helperBatch } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    let sent: { calls: { id: string; fn: string; req: string; packages: string[] }[] } | null = null;
    handler = (p, init) => {
      expect(p).toBe('/batch');
      sent = JSON.parse(String(init.body));
      const lines = sent!.calls.map((c) => JSON.stringify({ id: c.id, ok: true, result: `r:${c.req}` })).reverse().join('\n') + '\n';
      return { raw: pieces(lines, 7) };
    };
    const seen: number[] = [];
    const out = await helperBatch('ps_mc', ['{"a":1}', '{"a":2}', '{"a":3}'], ['lavaan'], (d) => seen.push(d));
    expect(out).toEqual(['r:{"a":1}', 'r:{"a":2}', 'r:{"a":3}']);
    expect(seen).toEqual([1, 2, 3]);
    expect(sent!.calls.map((c) => [c.fn, c.packages])).toEqual([['ps_mc', ['lavaan']], ['ps_mc', ['lavaan']], ['ps_mc', ['lavaan']]]);
    expect(new Set(sent!.calls.map((c) => c.id)).size).toBe(3);
  });
  it('rejects on an R error, on missing packages, and when replies are missing', async () => {
    const { helperBatch, HelperMissingPackages, HelperUnavailable } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    const answer = (f: (id: string, i: number) => object) => (_p: string, init: RequestInit) => {
      const calls = JSON.parse(String(init.body)).calls as { id: string }[];
      return { raw: calls.map((c, i) => JSON.stringify(f(c.id, i))).join('\n') };
    };
    handler = answer((id, i) => (i === 1 ? { id, ok: false, kind: 'r_error', message: 'singular matrix' } : { id, ok: true, result: '1' }));
    await expect(helperBatch('ps_mc', ['{}', '{}'], [])).rejects.toThrow('singular matrix');
    handler = answer((id) => ({ id, ok: false, kind: 'missing_packages', packages: ['lavaan'] }));
    await expect(helperBatch('ps_mc', ['{}'], [])).rejects.toBeInstanceOf(HelperMissingPackages);
    handler = (_p, init) => { const c = JSON.parse(String(init.body)).calls[0]; return { raw: JSON.stringify({ id: c.id, ok: true, result: '1' }) }; };
    await expect(helperBatch('ps_mc', ['{}', '{}'], [])).rejects.toBeInstanceOf(HelperUnavailable);
  });
  it('waits and retries while the helper answers 429', async () => {
    vi.useFakeTimers();
    try {
      const { helperCall } = await import('./helper');
      store.set('pls-studio.helper.token', TOKEN);
      let n = 0;
      handler = () => (++n < 3 ? { status: 429, headers: { 'Retry-After': '1' } } : { body: { ok: true, result: 'done' } });
      const p = helperCall('ps_pls', '{}', []);
      await vi.advanceTimersByTimeAsync(2500);
      expect(await p).toBe('done');
      expect(n).toBe(3);
    } finally { vi.useRealTimers(); }
  });
  it('desktop rCallParallel sends one batch; without the helper it uses the browser', async () => {
    const { bridgeHash } = await import('./helper');
    const { SOURCES, rCallParallel } = await import('./bridge');
    const hash = await bridgeHash(SOURCES);
    store.set('pls-studio.helper.token', TOKEN);
    (await import('./compute')).useCompute.getState().set({ backend: 'helper', workers: 1 });
    const paths: string[] = [];
    handler = (p, init) => {
      paths.push(p);
      if (p === '/health') return { body: { ok: true } };
      if (p === '/version') return { body: { bridge: hash, r: 'R version 4.3.1', workers: 13 } };
      if (p === '/packages') return { body: { versions: {} } };
      const calls = JSON.parse(String(init.body)).calls as { id: string; req: string }[];
      return { raw: calls.map((c) => JSON.stringify({ id: c.id, ok: true, result: c.req })).join('\n') };
    };
    const out = await rCallParallel<{ k: number }>('ps_mc', [{ k: 1 }, { k: 2 }], 'simulation');
    expect(out.map((o) => o.k)).toEqual([1, 2]);
    expect(paths.filter((p) => p === '/batch')).toHaveLength(1);
    const { parallelMap } = await import('./runtime');
    vi.mocked(parallelMap).mockResolvedValueOnce(['browser'] as never);
    (await import('./compute')).useCompute.getState().set({ backend: 'browser', workers: 2 });
    expect(await rCallParallel('ps_mc', [{ k: 1 }], 'simulation')).toEqual(['browser']);
    expect(vi.mocked(parallelMap).mock.calls.at(-1)![1]).toBe(2);
  });
});

describe('helper client edge cases', () => {
  it('helperCall: 401 un-pairs, other statuses and kinds map to the right errors', async () => {
    const { helperCall, useHelper, HelperUnavailable, HelperMissingPackages } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    handler = () => ({ status: 401 });
    await expect(helperCall('ps_pls', '{}', [])).rejects.toBeInstanceOf(HelperUnavailable);
    expect(store.has('pls-studio.helper.token')).toBe(false);
    expect(useHelper.getState().state).toBe('unpaired');
    store.set('pls-studio.helper.token', TOKEN);
    handler = () => ({ status: 500 });
    await expect(helperCall('ps_pls', '{}', [])).rejects.toThrow('The helper answered 500.');
    handler = () => ({ body: { ok: false, kind: 'cancelled' } });
    const c = await helperCall('ps_pls', '{}', []).catch((e) => e);
    expect(c).not.toBeInstanceOf(HelperUnavailable);
    expect(c.message).toBe('Cancelled.');
    handler = () => ({ body: { ok: false, kind: 'helper_error' } });
    await expect(helperCall('ps_pls', '{}', [])).rejects.toThrow('The helper could not run R.');
    handler = () => ({ body: { ok: false, kind: 'r_error' } });
    await expect(helperCall('ps_pls', '{}', [])).rejects.toThrow('R error');
    handler = () => ({ body: { ok: false, kind: 'missing_packages' } });
    const m = await helperCall('ps_pls', '{}', []).catch((e) => e);
    expect(m).toBeInstanceOf(HelperMissingPackages);
    expect(m.packages).toEqual([]);
    expect(new HelperMissingPackages(['a']).message).toBe('Desktop R lacks the R package a.');
    expect(new HelperMissingPackages(['a', 'b']).message).toBe('Desktop R lacks the R packages a, b.');
    handler = () => ({ body: { ok: true } });
    expect(await helperCall('ps_pls', '{}', [])).toBe('');
  });
  it('sends the call with the token and gives every call its own id', async () => {
    const { helperCall } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    const ids: string[] = [];
    handler = (p, init) => {
      expect(p).toBe('/call');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      const b = JSON.parse(String(init.body));
      ids.push(b.id);
      expect(b).toMatchObject({ fn: 'ps_x', req: '{"a":1}', export: false, packages: ['cSEM'] });
      return { body: { ok: true, result: 'r' } };
    };
    await helperCall('ps_x', '{"a":1}', ['cSEM']);
    await helperCall('ps_x', '{"a":1}', ['cSEM']);
    expect(new Set(ids).size).toBe(2);
  });
  it('cancelHelperCalls cancels the calls that are still running, and only those', async () => {
    const { helperCall, cancelHelperCalls } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    const cancelled: string[] = [];
    let release!: () => void;
    let callId = '';
    handler = (p, init) => {
      if (p.startsWith('/cancel/')) { cancelled.push(p.slice('/cancel/'.length)); expect(init.method).toBe('POST'); return { status: 204 }; }
      callId = JSON.parse(String(init.body)).id;
      return { body: { ok: true, result: 'x' } };
    };
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce((url, init) => new Promise((res) => { release = () => res(original(url as string, init)); }));
    const p = helperCall('ps_slow', '{}', []);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    cancelHelperCalls();
    await vi.waitFor(() => expect(cancelled).toHaveLength(1));
    release();
    await p;
    expect(cancelled[0]).toMatch(/^c[0-9a-z]+-[0-9a-z]+$/);
    expect(callId).toBe(cancelled[0]);
    cancelHelperCalls();
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelled).toHaveLength(1);
  });
  it('unpairHelper forgets the token', async () => {
    const { unpairHelper, useHelper } = await import('./helper');
    store.set('pls-studio.helper.token', TOKEN);
    useHelper.setState({ state: 'ready', packages: { cSEM: '0.7.1' } });
    unpairHelper();
    expect(store.has('pls-studio.helper.token')).toBe(false);
    expect(useHelper.getState()).toMatchObject({ state: 'unpaired', message: 'Not paired.', packages: {} });
  });
  it('probe: helper errors, version details, and an unanswered package query', async () => {
    const { probeHelper, useHelper, bridgeHash } = await import('./helper');
    const sources = { common: 'x' };
    handler = () => ({ status: 503 });
    expect(await probeHelper(sources, [])).toBe('absent');
    expect(useHelper.getState().message).toBe('The helper is not running.');
    store.set('pls-studio.helper.token', TOKEN);
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { status: 500 });
    expect(await probeHelper(sources, [])).toBe('absent');
    expect(useHelper.getState().message).toBe('The helper answered 500.');
    handler = (p) => (p === '/health' ? { body: { ok: true } } : 'down');
    expect(await probeHelper(sources, [])).toBe('absent');
    const hash = await bridgeHash(sources);
    handler = (p, init) => {
      if (p === '/health') return { body: { ok: true } };
      if (p === '/version') return { body: { bridge: hash } };
      expect(p).toBe('/packages');
      expect(init.method).toBe('POST');
      expect(JSON.parse(String(init.body))).toEqual({ packages: ['cSEM'] });
      return { status: 500 };
    };
    expect(await probeHelper(sources, ['cSEM'])).toBe('ready');
    expect(useHelper.getState()).toMatchObject({ message: '', packages: { cSEM: null }, info: { helperVersion: '', r: '', workers: 0 } });
    expect(useHelper.getState().info).not.toHaveProperty('rError');
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { body: { bridge: 'other', helper_version: '0.1.3', r: 'R 4.5', workers: 3 } });
    expect(await probeHelper(sources, [])).toBe('mismatch');
    expect(useHelper.getState().info).toEqual({ helperVersion: '0.1.3', r: 'R 4.5', workers: 3 });
    expect(useHelper.getState().message).toMatch(/another version of PLS Studio/);
    handler = (p) => (p === '/health' ? { body: { ok: true } } : { body: { bridge: hash, r_error: 'no R' } });
    expect(await probeHelper(sources, [])).toBe('no-r');
    expect(useHelper.getState().info).toMatchObject({ rError: 'no R' });
  });
  it('pairing: strict code and token formats, and helper errors', async () => {
    const { pairHelper } = await import('./helper');
    await expect(pairHelper('1234567')).rejects.toThrow('6 digits');
    await expect(pairHelper('x123456')).rejects.toThrow('6 digits');
    handler = () => ({ body: { token: `x${TOKEN}` } });
    await expect(pairHelper('123456')).rejects.toThrow('no valid token');
    handler = () => ({ body: { token: `${TOKEN}x` } });
    await expect(pairHelper('123456')).rejects.toThrow('no valid token');
    handler = () => ({ status: 500 });
    await expect(pairHelper('123456')).rejects.toThrow('The helper answered 500.');
    handler = () => 'down';
    await expect(pairHelper('123456')).rejects.toThrow('The helper is not running.');
    handler = (_p, init) => { expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json'); return { body: { token: TOKEN } }; };
    await pairHelper('123456');
  });
  it('asks for Local Network Access once, and marks requests as loopback', async () => {
    const request = vi.fn(async () => ({}));
    vi.stubGlobal('navigator', { permissions: { request } });
    const { pairHelper } = await import('./helper');
    handler = () => ({ body: { token: TOKEN } });
    await pairHelper('123456');
    await pairHelper('123456');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ name: 'local-network-access' });
    expect(vi.mocked(fetch).mock.calls.at(-1)![1]).toMatchObject({ targetAddressSpace: 'loopback' });
  });
  it('downloads name each system', async () => {
    const { helperDownloads } = await import('./helper');
    expect(helperDownloads('Win32')).toEqual([{ label: 'Windows', url: expect.stringMatching(/windows-amd64\.exe$/) }]);
    expect(helperDownloads('Linux')).toEqual([{ label: 'Linux', url: expect.stringMatching(/linux-amd64$/) }]);
    expect(helperDownloads('Mac')[1]).toEqual({ label: 'macOS (Intel)', url: expect.stringMatching(/amd64\.dmg$/) });
  });
});

describe('helperAllowCommand', () => {
  it('names the command that lets the helper answer this deployment, and nothing for the origins it trusts by default', async () => {
    const { helperAllowCommand } = await import('./helper');
    expect(helperAllowCommand('https://pls.flowtex.click')).toBe('pls-studio-helper allow-origin https://pls.flowtex.click');
    expect(helperAllowCommand('http://localhost:5175')).toBeNull();
    expect(helperAllowCommand('http://127.0.0.1:8787')).toBeNull();
    expect(helperAllowCommand('')).toBeNull();
  });
});
