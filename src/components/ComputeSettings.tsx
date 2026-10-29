import { useEffect, useState } from 'react';
import { MAX_WORKERS, useCompute } from '../rengine/compute';
import { browserPlatform, HELPER_RELEASES, helperDownloads, useHelper } from '../rengine/helper';

/** Choices of the parallel option: off, and up to the computer's cores (at most MAX_WORKERS). */
export function workerChoices(cores: number): number[] {
  const max = Math.max(1, Math.min(MAX_WORKERS, cores));
  return [1, 2, 4, 6, 8].filter((n) => n <= max);
}

const HELPER_DOCS = 'https://github.com/stolucc/pls-studio/blob/main/helper/README.md';

/** Download links for the helper (this computer's system first) and its guide. */
export function HelperDownloadLinks() {
  const mine = helperDownloads(browserPlatform());
  return (
    <span className="helper-downloads">
      {mine.map((d, i) => (
        <a key={d.url} className={`btn sm${i === 0 ? ' primary' : ''}`} href={d.url} rel="noreferrer">Download for {d.label}</a>
      ))}
      <a className="btn sm ghost" href={HELPER_RELEASES} target="_blank" rel="noreferrer">{mine.length ? 'Other systems' : 'Download'}</a>
      <a className="btn sm ghost" href={HELPER_DOCS} target="_blank" rel="noreferrer">Guide</a>
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
  const check = (force = true) => import('../rengine/bridge').then(({ checkHelper }) => checkHelper(force));
  useEffect(() => { void check(false); }, []);
  const run = async (how: 'connect' | 'code') => {
    setBusy(true); setError('');
    try {
      const h = await import('../rengine/helper');
      if (how === 'connect') await h.connectHelper(); else { await h.pairHelper(code); setCode(''); }
      await check();
    } catch (e) {
      setError((e as Error).message);
      if (/no tray/.test((e as Error).message)) setUseCode(true);
    } finally { setBusy(false); }
  };
  const missing = Object.entries(packages).filter(([, v]) => !v).map(([k]) => k);
  return (
    <div className="hint" style={{ marginTop: 6 }} aria-live="polite">
      {state === 'checking' && 'Looking for the helper…'}
      {state === 'absent' && (
        <>
          The helper is not running on this computer. Download it, start it (you need <a href="https://cran.r-project.org" target="_blank" rel="noreferrer">R</a>), then check again.
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <HelperDownloadLinks />
            <button className="btn sm" onClick={() => void check()}>Check again</button>
          </div>
          <div style={{ marginTop: 6 }}>First launch: macOS asks to confirm (right-click the app → Open); Windows SmartScreen: More info → Run anyway. Then install the R packages once from the helper’s menu (Install R packages…).</div>
        </>
      )}
      {state === 'unpaired' && (
        <>
          {message}
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <button className="btn sm primary" disabled={busy} onClick={() => void run('connect')}>{busy && !useCode ? 'Waiting for Allow…' : 'Connect'}</button>
            {busy && !useCode ? <span>Click Allow in the helper’s dialog.</span> : <button className="btn sm ghost" onClick={() => setUseCode(!useCode)}>{useCode ? 'Hide code' : 'Use a pairing code'}</button>}
          </div>
          {useCode && (
            <div style={{ marginTop: 6 }}>
              Run <code>pls-studio-helper pair</code> (or use the helper’s menu) and enter the code:
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input className="input num" inputMode="numeric" maxLength={6} placeholder="123456" value={code} aria-label="Pairing code"
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void run('code'); }} />
                <button className="btn sm" disabled={busy || code.length !== 6} onClick={() => void run('code')}>Pair</button>
              </div>
            </div>
          )}
          {error && <div className="issue error" role="alert" style={{ marginTop: 6 }}>{error}</div>}
        </>
      )}
      {(state === 'no-r' || state === 'mismatch') && <>{message} <button className="btn sm ghost" onClick={() => void check()}>Check again</button></>}
      {state === 'ready' && info && (
        <>
          Paired: {info.r.replace(/^R version ([0-9.]+).*/, 'R $1')} on this computer, {info.workers} R process{info.workers === 1 ? '' : 'es'}.
          {missing.length > 0 && <> Not installed there: {missing.join(', ')} (calculations needing them use the browser’s R; install them from the helper’s menu, Install R packages…, or with <code>pls-studio-helper setup</code>).</>}
          {' '}Package versions can differ from the browser’s, so results can differ slightly; the version used is shown with the results.
          {' '}<button className="btn sm ghost" onClick={() => void import('../rengine/helper').then(({ unpairHelper }) => unpairHelper())}>Disconnect</button>
        </>
      )}
    </div>
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
          <button role="radio" aria-checked={backend === 'browser'} className={backend === 'browser' ? 'on' : ''} onClick={() => useCompute.getState().set({ backend: 'browser' })}
            title="webR: R compiled for the browser, with pinned package versions. Nothing to install.">This browser</button>
          <button role="radio" aria-checked={backend === 'helper'} className={backend === 'helper' ? 'on' : ''} onClick={() => useCompute.getState().set({ backend: 'helper' })}
            title="Desktop R on this computer, through the PLS Studio helper: native speed, all packages. Your data stay on this computer.">Desktop R (helper)</button>
        </div>
        {backend === 'helper' ? <HelperStatus /> : (
          <div className="hint" style={{ marginTop: 6 }}>
            webR in this tab: nothing to install. For native speed (all cores, desktop R), get the PLS Studio Helper and choose Desktop R.
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}><HelperDownloadLinks /></div>
          </div>
        )}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label id="parallel-workers">Parallel bootstrap and simulation</label>
        <div className="segmented" role="radiogroup" aria-labelledby="parallel-workers">
          {choices.map((n) => (
            <button key={n} role="radio" aria-checked={workers === n} className={workers === n ? 'on' : ''} onClick={() => useCompute.getState().set({ workers: n })}>
              {n === 1 ? 'Off' : `${n} sessions`}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {workers === 1
            ? 'One R session: bootstrap results are exactly those of a single run of the package with your seed.'
            : `${workers} R sessions share the work${backend === 'browser' ? ' (each needs about 300 MB of memory and loads the packages once)' : ''}. Bootstrap samples are drawn in chunks of 100 with seeds seed, seed + 1, …: the results are the same for any number of sessions and equal the exported script, but differ slightly from a single run of the package. Simulation results are unchanged.`}
          {' '}Applies to cSEM and lavaan bootstraps and Monte Carlo simulation; remembered in this browser.
        </div>
      </div>
    </>
  );
}
