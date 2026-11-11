import { useEffect, useState } from 'react';
import { MAX_WORKERS, useCompute } from '../rengine/compute';
import {
  browserPlatform,
  HELPER_RELEASES,
  helperAllowCommand,
  helperDownloads,
  useHelper,
  type HelperUpdate,
} from '../rengine/helper';

/** Choices of the parallel option: off, and up to the computer's cores (at most MAX_WORKERS). */
export function workerChoices(cores: number): number[] {
  const max = Math.max(1, Math.min(MAX_WORKERS, cores));
  return [1, 2, 4, 6, 8].filter((n) => n <= max);
}

const HELPER_DOCS = 'https://github.com/stolucc/pls-studio/blob/main/helper/README.md';

/** Download links for the helper (this computer's system first) and its guide. */
function HelperDownloadLinks() {
  const mine = helperDownloads(browserPlatform());
  return (
    <span className="helper-downloads">
      {mine.map((d, i) => (
        <a
          key={d.url}
          className={`btn sm${i === 0 ? ' primary' : ''}`}
          href={d.url}
          rel="noreferrer"
        >
          Download for {d.label}
        </a>
      ))}
      <a className="btn sm ghost" href={HELPER_RELEASES} target="_blank" rel="noreferrer">
        {mine.length ? 'Other systems' : 'Download'}
      </a>
      <a className="btn sm ghost" href={HELPER_DOCS} target="_blank" rel="noreferrer">
        Guide
      </a>
    </span>
  );
}

/** Desktop R through the helper: status, pairing and the packages its R has. */
function HelperStatus() {
  const { state, info, packages, message } = useHelper();
  const [code, setCode] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = (force = true) =>
    import('../rengine/bridge').then(({ checkHelper }) => checkHelper(force));
  useEffect(() => {
    void check(false);
  }, []);
  const run = async (how: 'connect' | 'code') => {
    setBusy(true);
    setError('');
    try {
      const h = await import('../rengine/helper');
      if (how === 'connect') await h.connectHelper();
      else {
        await h.pairHelper(code);
        setCode('');
      }
      await check();
    } catch (e) {
      setError((e as Error).message);
      if (/no tray/.test((e as Error).message)) setUseCode(true);
    } finally {
      setBusy(false);
    }
  };
  // An outdated helper that can update itself (0.1.9 and later): offer it.
  const [update, setUpdate] = useState<HelperUpdate | null>(null);
  const [updating, setUpdating] = useState('');
  useEffect(() => {
    if (state !== 'mismatch') {
      setUpdate(null);
      return;
    }
    let live = true;
    void import('../rengine/helper')
      .then((h) => h.checkHelperUpdate())
      .then((u) => {
        if (live) setUpdate(u);
      });
    return () => {
      live = false;
    };
  }, [state]);
  const runUpdate = async () => {
    setUpdating('Downloading and verifying the new helper…');
    setError('');
    try {
      const to = await (await import('../rengine/helper')).updateHelper();
      setUpdating(`Updated${to ? ` to ${to}` : ''}; checking again…`);
      await check();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUpdating('');
    }
  };
  const missing = Object.entries(packages)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  const allow = helperAllowCommand(typeof location !== 'undefined' ? location.origin : '');
  return (
    <div className="hint" style={{ marginTop: 6 }} aria-live="polite">
      {state === 'checking' && 'Looking for the helper…'}
      {state === 'absent' && (
        <>
          The helper is not running on this computer. Download it, start it (you need{' '}
          <a href="https://cran.r-project.org" target="_blank" rel="noreferrer">
            R
          </a>
          ), then check again.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <HelperDownloadLinks />
            <button className="btn sm" onClick={() => void check()}>
              Check again
            </button>
          </div>
          <div style={{ marginTop: 6 }}>
            First launch: macOS asks to confirm (right-click the app → Open); Windows SmartScreen:
            More info → Run anyway. Then install the R packages once from the helper’s menu (Install
            R packages…).
          </div>
          {allow && (
            <div style={{ marginTop: 6 }}>
              Helper running but still not found? It answers only sites it trusts, and this one must
              be allowed once, in a terminal on this computer:
              <code className="block">{allow}</code>
              (the menu-bar app holds the command at{' '}
              <code>PLS Studio Helper.app/Contents/MacOS/pls-studio-helper</code>), then restart the
              helper and check again.
            </div>
          )}
        </>
      )}
      {state === 'unpaired' && (
        <>
          {message}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <button className="btn sm primary" disabled={busy} onClick={() => void run('connect')}>
              {busy && !useCode ? 'Waiting for Allow…' : 'Connect'}
            </button>
            {busy && !useCode ? (
              <span>Click Allow in the helper’s dialog.</span>
            ) : (
              <button className="btn sm ghost" onClick={() => setUseCode(!useCode)}>
                {useCode ? 'Hide code' : 'Use a pairing code'}
              </button>
            )}
          </div>
          {useCode && (
            <div style={{ marginTop: 6 }}>
              Run <code>pls-studio-helper pair</code> (or use the helper’s menu) and enter the code:
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  className="input num"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  aria-label="Pairing code"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6) void run('code');
                  }}
                />
                <button
                  className="btn sm"
                  disabled={busy || code.length !== 6}
                  onClick={() => void run('code')}
                >
                  Pair
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="issue error" role="alert" style={{ marginTop: 6 }}>
              {error}
            </div>
          )}
        </>
      )}
      {state === 'no-r' && (
        <>
          {message}{' '}
          <button className="btn sm ghost" onClick={() => void check()}>
            Check again
          </button>
        </>
      )}
      {state === 'mismatch' && (
        <>
          {message}
          {update?.available && (
            <div style={{ marginTop: 6 }}>
              <button
                className="btn sm primary"
                disabled={!!updating}
                onClick={() => void runUpdate()}
                title="The helper downloads its latest release from GitHub, checks the release’s signature and checksum, replaces itself and restarts"
              >
                {updating || `Update helper to ${update.latest}`}
              </button>{' '}
              The helper installs its latest release itself (signature and checksum verified) and
              restarts; calculations running in it stop.
            </div>
          )}
          {error && (
            <div className="issue error" role="alert" style={{ marginTop: 6 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <HelperDownloadLinks />
            <button className="btn sm" onClick={() => void check()}>
              Check again
            </button>
          </div>
          {update && !update.available && update.reason && (
            <div style={{ marginTop: 6 }}>
              {update.latest && update.latest === update.current
                ? `The helper is the latest release (${update.current}); this site’s R code is newer than any release so far.`
                : `The helper cannot update itself: ${update.reason}.`}
            </div>
          )}
          {!allow && (
            <div style={{ marginTop: 6 }}>
              From a checkout: <code>make -C helper build</code> and restart the helper.
            </div>
          )}
        </>
      )}
      {state === 'ready' && info && (
        <>
          Paired: {info.r.replace(/^R version ([0-9.]+).*/, 'R $1')} on this computer,{' '}
          {info.workers} R process{info.workers === 1 ? '' : 'es'}.
          {missing.length > 0 && (
            <>
              {' '}
              Not installed there: {missing.join(', ')} (calculations needing them use the browser’s
              R; install them from the helper’s menu, Install R packages…, or with{' '}
              <code>pls-studio-helper setup</code>).
            </>
          )}{' '}
          Package versions can differ from the browser’s, so results can differ slightly; the
          version used is shown with the results.{' '}
          <button
            className="btn sm ghost"
            onClick={() =>
              void import('../rengine/helper').then(({ unpairHelper }) => unpairHelper())
            }
          >
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}

/** Desktop R parallelises by itself: what it does with the helper's cores. */
function ParallelDesktop() {
  const info = useHelper((s) => s.info);
  const n = info?.workers ?? 0;
  return (
    <>
      Automatic in desktop R{n ? `, on ${n} cores` : ''}: cSEM and seminr bootstraps run on all of
      them (results identical to a single run with your seed); lavaan bootstraps are drawn in chunks
      of 100 samples (seeds seed, seed + 1, …) over the helper’s R processes, with the same results
      on any computer and in the exported script; simulations spread over the processes with
      unchanged results.
    </>
  );
}

/** Where R runs (browser or desktop helper) and parallel R sessions: preferences of this browser. */
export function ComputeSettings() {
  const workers = useCompute((s) => s.workers);
  const backend = useCompute((s) => s.backend);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const choices = workerChoices(cores);
  return (
    <>
      <div className="field" style={{ marginTop: 10 }}>
        <label id="r-backend">R runs in</label>
        <div className="segmented" role="radiogroup" aria-labelledby="r-backend">
          <button
            role="radio"
            aria-checked={backend === 'browser'}
            className={backend === 'browser' ? 'on' : ''}
            onClick={() => useCompute.getState().set({ backend: 'browser' })}
            title="webR: R compiled for the browser, with pinned package versions. Nothing to install."
          >
            This browser
          </button>
          <button
            role="radio"
            aria-checked={backend === 'helper'}
            className={backend === 'helper' ? 'on' : ''}
            onClick={() => useCompute.getState().set({ backend: 'helper' })}
            title="Desktop R on this computer, through the PLS Studio helper: native speed, all packages. Your data stay on this computer."
          >
            Desktop R (helper)
          </button>
        </div>
        {backend === 'helper' ? (
          <HelperStatus />
        ) : (
          <div className="hint" style={{ marginTop: 6 }}>
            webR in this tab: nothing to install. For native speed (all cores, desktop R), get the
            PLS Studio Helper and choose Desktop R.
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              <HelperDownloadLinks />
            </div>
          </div>
        )}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label id="parallel-workers">
          Parallel bootstrap and simulation{backend === 'helper' ? ' (this browser only)' : ''}
        </label>
        <div
          className="segmented"
          role="radiogroup"
          aria-labelledby="parallel-workers"
          aria-disabled={backend === 'helper'}
        >
          {choices.map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={backend === 'browser' && workers === n}
              className={backend === 'browser' && workers === n ? 'on' : ''}
              disabled={backend === 'helper'}
              onClick={() => useCompute.getState().set({ workers: n })}
            >
              {n === 1 ? 'Off' : `${n} sessions`}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {backend === 'helper' ? (
            <ParallelDesktop />
          ) : (
            <>
              {workers === 1
                ? 'One R session: bootstrap results are exactly those of a single run of the package with your seed.'
                : `${workers} R sessions share the work (each needs about 300 MB of memory and loads the packages once). Bootstrap samples are drawn in chunks of 100 with seeds seed, seed + 1, …: the results are the same for any number of sessions and equal the exported script, but differ slightly from a single run of the package. Simulation results are unchanged.`}{' '}
              Applies to cSEM and lavaan bootstraps and Monte Carlo simulation in this browser;
              remembered here.
            </>
          )}
        </div>
      </div>
    </>
  );
}
