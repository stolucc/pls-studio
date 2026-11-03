import { useMemo } from 'react';
import { useStore } from '../../store';
import { estimationKey } from '../../validation/exampleState';
import { exampleEvidence, LEVEL_TEXT, useEvidence } from '../../validation/useEvidence';

/**
 * In the results of an example still as it opened (same model, settings and data): what the test suite checked
 * these results against. Gone as soon as anything that changes the estimates is edited.
 */
export function ExampleResultsBadge() {
  const example = useStore((s) => s.example), baseline = useStore((s) => s.exampleBaseline);
  const model = useStore((s) => s.model), settings = useStore((s) => s.settings), dataVersion = useStore((s) => s.dataVersion);
  const unchanged = useMemo(() => !!example && !!baseline && estimationKey(model, settings, dataVersion) === baseline, [example, baseline, model, settings, dataVersion]);
  const c = exampleEvidence(useEvidence(), example ?? '');
  if (!unchanged || !c || !c.passed) return null;
  return (
    <span className="results-evidence">
      <button className={`chip evidence ${c.level}`} onClick={() => useStore.getState().openValidation(example!)}
        title={`This example as it opened: ${LEVEL_TEXT[c.level].long.toLowerCase()}. ${LEVEL_TEXT[c.level].hint} The test suite compared ${c.comparisons.length} numbers. Edit the model, settings or data and this no longer applies.`}>
        {c.level === 'runs' ? '' : '✓ '}{LEVEL_TEXT[c.level].short}
      </button>
    </span>
  );
}
