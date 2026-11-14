import type { EvidenceLevel } from '../../validation/types';
import { LEVEL_TEXT } from '../../validation/useEvidence';

/** A kind of evidence as a badge, its meaning in the tooltip (with how many numbers were compared for it, when given). */
export function LevelChip({ level, compared }: { level: EvidenceLevel; compared?: number }) {
  const count =
    compared === undefined ? '' : ` ${compared} number${compared === 1 ? '' : 's'} compared.`;
  return (
    <span
      className={`chip evidence ${level}`}
      title={`${LEVEL_TEXT[level].long}. ${LEVEL_TEXT[level].hint}${count}`}
    >
      {level === 'runs' ? '' : '✓ '}
      {LEVEL_TEXT[level].short}
    </span>
  );
}
