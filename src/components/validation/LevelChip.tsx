import type { EvidenceLevel } from '../../validation/types';
import { LEVEL_TEXT } from '../../validation/useEvidence';

/** A kind of evidence as a badge, its meaning in the tooltip. */
export function LevelChip({ level }: { level: EvidenceLevel }) {
  return <span className={`chip evidence ${level}`} title={`${LEVEL_TEXT[level].long}. ${LEVEL_TEXT[level].hint}`}>{level === 'runs' ? '' : '✓ '}{LEVEL_TEXT[level].short}</span>;
}
