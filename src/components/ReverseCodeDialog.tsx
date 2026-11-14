// The Data tab's "Reverse-code…": choose the items (the ones selected in the variable list are
// chosen to start with), then the same scale dialog as the model editor's button
// (reverseCodeAction.ts).

import { useState } from 'react';
import { useStore } from '../store';
import { IconX } from './icons';
import { reverseCodeColumns, reversibleColumns } from './reverseCodeAction';
import { useEscape } from './useEscape';
import { VariablePicker } from './VariablePicker';

export function ReverseCodeDialog({ onClose }: { onClose: () => void }) {
  const columns = reversibleColumns();
  const reversed = useStore((s) => s.dataInfo?.reversed) ?? [];
  const [chosen, setChosen] = useState(() =>
    useStore.getState().selectedVars.filter((v) => columns.includes(v)),
  );
  useEscape(onClose);

  const next = () => {
    onClose();
    void reverseCodeColumns(chosen);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal reverse-pick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reverse-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-head">
          <h3 id="reverse-title">Reverse-code items</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="hint">
          For negatively worded items: on a 1–5 answer scale, 1 becomes 5, 2 becomes 4, and so on (x
          becomes lowest + highest − x). Choose the items; the next step asks for the answer scale.
          The values change in place; doing it again on the same scale undoes it. To keep the
          original column as well, add a computed column with reverse(x, 1, 5) instead.
        </p>
        <VariablePicker columns={columns} value={chosen} onChange={setChosen} />
        {reversed.length > 0 && (
          <p className="hint">
            Reverse-coded now: {reversed.map((r) => `${r.name} (${r.min}–${r.max})`).join(', ')}.
          </p>
        )}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={chosen.length === 0} onClick={next}>
            Next: answer scale…
          </button>
        </div>
      </div>
    </div>
  );
}
