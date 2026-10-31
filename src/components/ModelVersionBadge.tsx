// Which version of the model is on the canvas: the run card it matches
// ("Model v3"), the version it was edited from ("Model v1, edited"), or not
// calculated yet. Clicking goes to that card on the Analyses tab.

import { useMemo } from 'react';
import { dataFingerprint, latestRun, openedFromVersion, runCards, runHash } from '../analyses/runHash';
import { selectCard, useAnalyses } from '../analyses/store';
import { useStore } from '../store';

export function ModelVersionBadge() {
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const data = useStore((s) => s.data);
  const dataVersion = useStore((s) => s.dataVersion);
  const cards = useAnalyses((s) => s.cards);
  // The data's fingerprint hashes every value: once per dataset, not per edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fp = useMemo(() => dataFingerprint(data), [dataVersion]);
  const hash = useMemo(() => runHash(model, settings, { fingerprint: fp, name: '', rows: 0 }), [model, settings, fp]);
  if (!model.constructs.length) return null;
  const runs = runCards(cards);
  const match = runs.find((c) => c.options.hash === hash);
  const from = openedFromVersion();
  const base = match ?? runs.find((c) => c.options.version === from) ?? latestRun(runs);
  const text = match ? match.options.label : base ? `${base.options.label}, edited` : 'Not calculated yet';
  const go = () => {
    if (!base) return;
    selectCard(base.id);
    useStore.getState().setWorkspace('analyses');
    requestAnimationFrame(() => document.getElementById(base.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  return (
    <button className={`version-badge ${match ? 'current' : 'edited'}`} disabled={!base} onClick={go}
      title={match ? 'This model is logged as this run on the Analyses tab: click to see it' : base ? `Changed since ${base.options.label}; Calculate logs it as a new version. Click to see ${base.options.label}` : 'Calculate logs the model as version 1 on the Analyses tab'}>
      <span className="dot" aria-hidden />{text}
    </button>
  );
}
