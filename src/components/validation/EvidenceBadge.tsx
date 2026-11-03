import { evidenceKinds, exampleEvidence, LEVEL_TEXT, useEvidence } from '../../validation/useEvidence';

/** An example's kinds of validation evidence, from the test suite's record, one badge each; they open what it was compared with. */
export function EvidenceBadge({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const c = exampleEvidence(useEvidence(), id);
  if (!c) return null;
  const n = c.comparisons.length;
  return (
    <span className="evidence-badges">
      {evidenceKinds(c).map((k) => (
        <button key={k} className={`chip evidence ${c.passed ? k : 'runs'}`} onClick={() => onOpen(id)}
          title={`${LEVEL_TEXT[k].long}. ${LEVEL_TEXT[k].hint} ${n} number${n === 1 ? '' : 's'} compared by the test suite in all${c.passed ? '' : ', and a check FAILED'}. Click for the details.`}>
          {c.passed ? (k === 'runs' ? '' : '✓ ') : '✗ '}{LEVEL_TEXT[k].short}
        </button>
      ))}
    </span>
  );
}
