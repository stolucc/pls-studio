// A comment on the diagram: drag it like a construct; not part of the model.

import type { Node, NodeProps } from '@xyflow/react';
import { memo, useEffect, useState } from 'react';
import { useStore } from '../store';

export const NOTE_WIDTH = 190;
export type NoteFlowNode = Node<{ text: string }, 'note'>;

function NoteNodeImpl({ id, data, selected }: NodeProps<NoteFlowNode>) {
  const updateNote = useStore((s) => s.updateNote);
  // One undo step per edit: written to the model when the box loses focus.
  const [draft, setDraft] = useState(data.text);
  useEffect(() => setDraft(data.text), [data.text]);
  return (
    <div className={`note-node${selected ? ' selected' : ''}`} style={{ width: NOTE_WIDTH }}>
      <div className="note-grip" title="Drag to move; select and press Delete to remove" />
      <textarea
        className="nodrag nowheel"
        aria-label="Comment"
        rows={3}
        placeholder="Comment"
        value={draft}
        maxLength={5000}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== data.text) updateNote(id, draft);
        }}
      />
    </div>
  );
}

export const NoteNode = memo(NoteNodeImpl);
