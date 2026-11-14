// The reviewer checklist's item on the mediation type (reporting/checklist.ts calls it for PLS-SEM and
// CB-SEM models with an indirect effect): done when the bootstrap gives the typology, an issue before.

import type { CheckItem } from './checklist';
import { MEDIATION_LABEL, mediationPairs, typeCounts, type MediationType } from './mediation';
import type { ReportInput } from './methods';

const ORDER: MediationType[] = [
  'complementary',
  'competitive',
  'indirect-only',
  'direct-only',
  'no-effect',
];

/** The checklist item "Mediation type reported" from the bootstrap (null without an indirect effect). */
export function mediationCheck(
  input: ReportInput,
  constructs: string[],
  hasPath: boolean[][],
  sources: string[],
): CheckItem | null {
  const { paths } = input.model;
  if (!paths.some((p) => paths.some((q) => q.from === p.to))) return null;
  const item = {
    id: 'mediationtype',
    section: 'Structural model' as const,
    label: 'Mediation type of each indirect effect reported (Zhao et al., 2010)',
    sources,
  };
  const boot = input.boot;
  if (!boot)
    return {
      ...item,
      status: 'issue',
      evidence:
        'The type is decided by bootstrap confidence intervals: run Bootstrap on the Model tab.',
      link: { kind: 'tab', label: 'Bootstrapping' },
    };
  const at = (name: string) => constructs.indexOf(name);
  const pairs = mediationPairs(boot, constructs, (a, b) => hasPath[at(a)]?.[at(b)] ?? false);
  const counts = typeCounts(pairs);
  const parts = ORDER.filter((t) => counts[t]).map(
    (t) => `${counts[t]} ${MEDIATION_LABEL[t].toLowerCase()}`,
  );
  if (!parts.length)
    return {
      ...item,
      status: 'issue',
      evidence: 'The bootstrap has no indirect effects: run Bootstrap again on the Model tab.',
      link: { kind: 'tab', label: 'Bootstrapping' },
    };
  const which = pairs.some((p) => p.specific.length)
    ? 'Specific indirect effects'
    : 'Indirect effects';
  return {
    ...item,
    status: 'done',
    evidence: `${which}: ${parts.join(', ')}. A reporting sentence for each is on the Indirect & total effects tab.`,
    link: { kind: 'tab', label: 'Indirect & total effects' },
  };
}
