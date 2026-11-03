import { exampleEvidence, LEVEL_TEXT, useEvidence } from '../../validation/useEvidence';

/** An example's validation level, from the test suite's record; opens what it was compared with. */
export function EvidenceBadge({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const c = exampleEvidence(useEvidence(), id);
  if (!c) return null;
  const n = c.comparisons.length;
  return (
    <button className={`chip evidence ${c.passed ? c.level : 'runs'}`} onClick={() => onOpen(id)}
      title={`${LEVEL_TEXT[c.level].hint} ${n} number${n === 1 ? '' : 's'} compared by the test suite${c.passed ? '' : ', and a check FAILED'}. Click for the details.`}>
      {c.passed ? (c.level === 'runs' ? '' : '✓ ') : '✗ '}{LEVEL_TEXT[c.level].short}
    </button>
  );
}
