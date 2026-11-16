// Where an analysis card calculates, above its Run button: the project's engine
// (for cards that offer the built-in one) and where R runs (this browser or
// desktop R through the helper), with one line on the helper's state. The full
// settings, helper pairing and downloads stay in the Model tab (Calculated by).

import { useEffect } from 'react';
import { useCompute } from '../../rengine/compute';
import { useHelper, type HelperInfo, type HelperState } from '../../rengine/helper';
import { useStore } from '../../store';

/** One line on the helper, for the chosen backend. */
export function helperLine(state: HelperState, info: HelperInfo | null): string {
  switch (state) {
    case 'ready':
      return info
        ? `Desktop R ${info.r} through helper ${info.helperVersion} (${info.workers} processes).`
        : 'Desktop R through the helper.';
    case 'mismatch':
      return 'The helper has older R code than this site, so R runs in this browser until it is updated (Model tab, R runs in).';
    case 'absent':
      return 'No helper found on this computer, so R runs in this browser. Get it in the Model tab (R runs in).';
    case 'unpaired':
      return 'The helper is running but not connected, so R runs in this browser. Connect it in the Model tab (R runs in).';
    case 'no-r':
      return 'The helper found no R installation, so R runs in this browser.';
    default:
      return 'Looking for the helper…';
  }
}

export function RunWhere({ engineChoice }: { engineChoice: boolean }) {
  const engine = useStore((s) => s.settings.engine);
  const setSettings = useStore((s) => s.setSettings);
  const backend = useCompute((s) => s.backend);
  const { state, info } = useHelper();
  useEffect(() => {
    if (backend !== 'helper') return;
    void import('../../rengine/bridge').then(({ checkHelper }) => checkHelper(false));
  }, [backend]);
  const usesR = !engineChoice || engine === 'r';
  return (
    <div className="run-where">
      {engineChoice && (
        <div className="field">
          <label id="run-engine">Calculated by</label>
          <div className="segmented" role="radiogroup" aria-labelledby="run-engine">
            <button
              role="radio"
              aria-checked={engine === 'r'}
              className={engine === 'r' ? 'on' : ''}
              onClick={() => setSettings({ engine: 'r' })}
            >
              R packages
            </button>
            <button
              role="radio"
              aria-checked={engine === 'builtin'}
              className={engine === 'builtin' ? 'on' : ''}
              onClick={() => setSettings({ engine: 'builtin' })}
            >
              Built-in
            </button>
          </div>
          <div className="hint">
            {engine === 'builtin'
              ? 'PLS Studio’s own implementation, in this browser (all cores).'
              : 'cSEM and lavaan.'}{' '}
            The project’s setting: the model on the Model tab uses it too.
          </div>
        </div>
      )}
      {usesR && (
        <div className="field">
          <label id="run-backend">R runs in</label>
          <div className="segmented" role="radiogroup" aria-labelledby="run-backend">
            <button
              role="radio"
              aria-checked={backend === 'browser'}
              className={backend === 'browser' ? 'on' : ''}
              onClick={() => useCompute.getState().set({ backend: 'browser' })}
              title="webR: R compiled for the browser. Nothing to install."
            >
              This browser
            </button>
            <button
              role="radio"
              aria-checked={backend === 'helper'}
              className={backend === 'helper' ? 'on' : ''}
              onClick={() => useCompute.getState().set({ backend: 'helper' })}
              title="Desktop R on this computer, through the PLS Studio helper. Your data stay on this computer."
            >
              Desktop R (helper)
            </button>
          </div>
          <div className="hint">
            {backend === 'helper'
              ? helperLine(state, info)
              : 'webR in this tab. Cards that only use the app’s own code ignore this.'}
          </div>
        </div>
      )}
    </div>
  );
}
