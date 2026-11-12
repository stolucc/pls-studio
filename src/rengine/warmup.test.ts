// Warming up R in the background (warmup.ts, runtime.ts warmUpR): once, only for R in the browser on a visible page
// that does not ask to save data, and silently — a failure shows nothing and the next calculation starts R itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created: { fail: boolean }[] = [];
let failInit = false;
vi.mock('webr', () => ({
  ChannelType: { SharedArrayBuffer: 3 },
  WebR: class {
    versionR = '4.6.2';
    version = '0.6.0';
    constructor() {
      created.push({ fail: failInit });
    }
    async init() {
      if (failInit) throw new Error('R.wasm: 404');
    }
    async evalRVoid() {}
  },
}));

const { scheduleRWarmUp, shouldWarmUp, resetWarmUp } = await import('./warmup');
const { useCompute } = await import('./compute');
const { useR } = await import('./status');

let page: { visibilityState: string; readyState: string; saveData?: boolean; isolated: boolean };
beforeEach(() => {
  page = { visibilityState: 'visible', readyState: 'complete', isolated: true };
  vi.stubGlobal('window', {
    get crossOriginIsolated() {
      return page.isolated;
    },
    addEventListener: vi.fn(),
    location: { href: 'http://localhost/' },
  });
  vi.stubGlobal('document', {
    get visibilityState() {
      return page.visibilityState;
    },
    get readyState() {
      return page.readyState;
    },
  });
  vi.stubGlobal('navigator', {
    get connection() {
      return page.saveData === undefined ? undefined : { saveData: page.saveData };
    },
  });
  useCompute.setState({ backend: 'browser' });
  resetWarmUp();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Schedule with the idle moment under the test's control. */
function schedule(engineIsR = true, start = vi.fn(async () => undefined)) {
  let idle: (() => void) | null = null;
  scheduleRWarmUp({ engineIsR: () => engineIsR, start, whenIdle: (t) => (idle = t) });
  return { start, idle: () => idle?.() };
}

describe('scheduleRWarmUp', () => {
  it('starts R once the app is idle, and only once per page', () => {
    const { start, idle } = schedule();
    expect(start).not.toHaveBeenCalled();
    idle();
    expect(start).toHaveBeenCalledTimes(1);
    const again = schedule();
    again.idle();
    expect(again.start).not.toHaveBeenCalled();
  });

  it('waits for the load event, a pause and an idle moment', () => {
    vi.useFakeTimers();
    page.readyState = 'loading';
    const start = vi.fn(async () => undefined);
    const idleCallback = vi.fn((task: () => void) => task());
    vi.stubGlobal('requestIdleCallback', idleCallback);
    scheduleRWarmUp({ engineIsR: () => true, start });
    const [event, onLoad] = (window.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(event).toBe('load');
    onLoad();
    vi.advanceTimersByTime(1999);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(idleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 10_000 });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not start R with the desktop helper, the built-in engine, data saving or a hidden page', () => {
    useCompute.setState({ backend: 'helper' });
    const helper = schedule();
    helper.idle();
    expect(helper.start).not.toHaveBeenCalled();
    useCompute.setState({ backend: 'browser' });

    resetWarmUp();
    const builtin = schedule(false);
    builtin.idle();
    expect(builtin.start).not.toHaveBeenCalled();

    for (const change of [
      () => (page.saveData = true),
      () => (page.visibilityState = 'hidden'),
      () => (page.isolated = false),
    ]) {
      page = { visibilityState: 'visible', readyState: 'complete', isolated: true };
      change();
      resetWarmUp();
      const s = schedule();
      s.idle();
      expect(s.start).not.toHaveBeenCalled();
    }
    page = { visibilityState: 'visible', readyState: 'complete', isolated: true, saveData: false };
    expect(shouldWarmUp(() => true)).toBe(true);
  });

  it('fails silently: a rejected or throwing start, or a broken idle hook, reaches no one', async () => {
    const rejected = vi.fn(() => Promise.reject(new Error('offline')));
    const { idle } = schedule(true, rejected as never);
    expect(() => idle()).not.toThrow();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledTimes(1);

    resetWarmUp();
    const throwing = schedule(
      true,
      vi.fn(() => {
        throw new Error('no worker');
      }) as never,
    );
    expect(() => throwing.idle()).not.toThrow();

    resetWarmUp();
    expect(() =>
      scheduleRWarmUp({
        engineIsR: () => true,
        whenIdle: () => {
          throw new Error('no timers');
        },
      }),
    ).not.toThrow();
  });
});

describe('warmUpR', () => {
  it('starts the main R session without telling the UI, records R’s versions, and starts it only once', async () => {
    const { warmUpR } = await import('./runtime');
    useR.setState({ status: 'idle', message: '', versions: {} });
    const statuses: string[] = [];
    const unsubscribe = useR.subscribe((s) => statuses.push(s.status));

    // A failed start: no error status, and the next start tries again.
    failInit = true;
    await expect(warmUpR()).rejects.toThrow('404');
    expect(useR.getState().status).toBe('idle');

    failInit = false;
    await warmUpR();
    await warmUpR();
    unsubscribe();
    expect(created).toHaveLength(2);
    expect(statuses.every((s) => s === 'idle')).toBe(true);
    expect(useR.getState().versions).toMatchObject({ R: '4.6.2', webR: '0.6.0' });
  });
});
