// Warming up R in the background (warmup.ts, runtime.ts warmUpR): once, right after the app renders, only for R in the
// browser on a page that does not ask to save data. Its progress goes to useR (the R status indicator); a failure is reported there, never
// thrown, and the next calculation starts R itself.

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

/** Schedule with the moment it is due under the test's control. */
function schedule(engineIsR = true, start = vi.fn(async () => undefined)) {
  let due: (() => void) | null = null;
  scheduleRWarmUp({ engineIsR: () => engineIsR, start, whenDue: (t) => (due = t) });
  return { start, idle: () => due?.() };
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

  it('starts right after the current render, without waiting for the load event or an idle moment', () => {
    vi.useFakeTimers();
    page.readyState = 'loading';
    const start = vi.fn(async () => undefined);
    scheduleRWarmUp({ engineIsR: () => true, start });
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(window.addEventListener).not.toHaveBeenCalled();
  });

  it('does not start R with the desktop helper, the built-in engine, data saving or no isolation', () => {
    useCompute.setState({ backend: 'helper' });
    const helper = schedule();
    helper.idle();
    expect(helper.start).not.toHaveBeenCalled();
    useCompute.setState({ backend: 'browser' });

    resetWarmUp();
    const builtin = schedule(false);
    builtin.idle();
    expect(builtin.start).not.toHaveBeenCalled();

    for (const change of [() => (page.saveData = true), () => (page.isolated = false)]) {
      page = { visibilityState: 'visible', readyState: 'complete', isolated: true };
      change();
      resetWarmUp();
      const s = schedule();
      s.idle();
      expect(s.start).not.toHaveBeenCalled();
    }
    page = { visibilityState: 'visible', readyState: 'complete', isolated: true, saveData: false };
    expect(shouldWarmUp(() => true)).toBe(true);
    // (a page opened in a background tab warms up too, so R is ready when the user turns to it)
    page.visibilityState = 'hidden';
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
        whenDue: () => {
          throw new Error('no timers');
        },
      }),
    ).not.toThrow();
  });
});

describe('warmUpR', () => {
  it('reports its progress in useR, records R’s versions, and starts R only once', async () => {
    const { warmUpR } = await import('./runtime');
    const { R_STARTING } = await import('./status');
    useR.setState({ status: 'idle', message: '', versions: {} });
    const seen: string[] = [];
    const unsubscribe = useR.subscribe((s) => seen.push(`${s.status}:${s.message}`));

    // A failed start: an error status with webR's message, and the next start tries again.
    failInit = true;
    await expect(warmUpR()).rejects.toThrow('404');
    expect(useR.getState()).toMatchObject({ status: 'error', message: 'R.wasm: 404' });

    failInit = false;
    await warmUpR();
    await warmUpR();
    unsubscribe();
    expect(created).toHaveLength(2);
    expect(seen).toEqual([
      `loading:${R_STARTING}`,
      'error:R.wasm: 404',
      `loading:${R_STARTING}`,
      'ready:',
    ]);
    expect(useR.getState().versions).toMatchObject({ R: '4.6.2', webR: '0.6.0' });
  });
});
