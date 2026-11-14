// The note at the top of the loadings view when an indicator may be a forgotten reverse-coding
// (measurement/negativeLoadings.ts): the question, a button that opens the Data tab's
// reverse-coding dialog for the item, and "Not reverse-coded — dismiss", kept in the project.

import type { CbResult } from '../../engine/cbsem';
import type { PlsResult } from '../../engine/types';
import {
  cbNegativeLoadingFlags,
  cbNegativeWeights,
  flagText,
  plsNegativeLoadingFlags,
  plsNegativeWeights,
  WEIGHTS_NOT_FLAGGED,
  type NegativeLoadingFlag,
} from '../../measurement/negativeLoadings';
import { withNotReversed } from '../../measurement/state';
import { useStore } from '../../store';
import { reverseCodeItems } from '../reverseCodeDialog';
import { IconRepeat, IconX } from '../icons';

/** What the success message adds: the results on screen still use the old coding. */
export const REESTIMATE_TEXT =
  'The model needs estimating again (Calculate) for the results to use the new coding.';

/** Mark the flag's indicators as not reverse-coded (saved in the project, undoable). */
function dismiss(flag: NegativeLoadingFlag) {
  useStore.getState().commit((m) => {
    let log = m.measurement;
    for (const x of flag.items) log = withNotReversed(log, x.indicator);
    return { ...m, measurement: log };
  });
}

/** The notes, given the flags and whether some formative weights are negative. */
export function NegativeLoadingNotes({
  flags,
  negativeWeights,
}: {
  flags: NegativeLoadingFlag[];
  negativeWeights: string[];
}) {
  const data = useStore((s) => s.data);
  const raw = !!data && !(data.moments && data.cols.length === 0);
  if (!flags.length && !negativeWeights.length) return null;
  return (
    // (advice on the data, not part of the report: report-skip)
    <div className="neg-loadings report-skip" style={{ marginBottom: 12 }}>
      {flags.map((flag) => {
        const names = flag.items.map((x) => x.indicator);
        const list = names.join(', ');
        return (
          <div
            key={`${flag.construct}:${list}`}
            className="issue warning"
            style={{ marginBottom: 8, display: 'block' }}
          >
            <div>{flagText(flag)}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {raw ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void reverseCodeItems(names, REESTIMATE_TEXT)}
                >
                  <IconRepeat size={13} /> Reverse-code {list}…
                </button>
              ) : (
                <span className="hint">
                  This dataset is a covariance matrix: reverse-code the item in the raw data.
                </span>
              )}
              <button type="button" className="btn sm ghost" onClick={() => dismiss(flag)}>
                <IconX size={13} /> Not reverse-coded — dismiss
              </button>
            </div>
          </div>
        );
      })}
      {negativeWeights.length > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          {WEIGHTS_NOT_FLAGGED} (Negative here: {negativeWeights.join(', ')}.)
        </p>
      )}
    </div>
  );
}

/** The notes of a PLS-SEM result's Loadings & weights tab. */
export function PlsNegativeLoadings({ pls }: { pls: PlsResult }) {
  const model = useStore((s) => s.model);
  const info = useStore((s) => s.dataInfo);
  return (
    <NegativeLoadingNotes
      flags={plsNegativeLoadingFlags(model, info, pls)}
      negativeWeights={plsNegativeWeights(model, pls)}
    />
  );
}

/** The notes of a CB-SEM result's Loadings tab. */
export function CbNegativeLoadings({ cb }: { cb: CbResult }) {
  const model = useStore((s) => s.model);
  const info = useStore((s) => s.dataInfo);
  return (
    <NegativeLoadingNotes
      flags={cbNegativeLoadingFlags(model, info, cb)}
      negativeWeights={cbNegativeWeights(cb)}
    />
  );
}
