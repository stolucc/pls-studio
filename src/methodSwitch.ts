import { confirmDialog } from './components/Overlays';
import { newId, type Method } from './model/project';
import { useStore } from './store';

/**
 * SEM draws each moderator's main effect on the outcome as a path; conditional
 * process models imply it. Add the missing paths when leaving process analysis.
 */
function addMainEffects() {
  const s = useStore.getState();
  const missing = s.model.moderations.flatMap((mo) => {
    const p = s.model.paths.find((q) => q.id === mo.path);
    return p && mo.moderator !== p.from && !s.model.paths.some((q) => q.from === mo.moderator && q.to === p.to) ? [{ from: mo.moderator, to: p.to }] : [];
  });
  const unique = missing.filter((e, i) => missing.findIndex((f) => f.from === e.from && f.to === e.to) === i);
  if (!unique.length) return;
  s.commit((m) => ({ ...m, paths: [...m.paths, ...unique.map((e) => ({ id: newId('p'), ...e }))] }));
  s.toast('info', `Added ${unique.length} moderator main-effect path${unique.length === 1 ? '' : 's'}, which SEM draws explicitly.`);
}

/**
 * Change the estimation method, keeping the model valid for it. CB-SEM has no
 * composites: they are converted to common factors after confirmation (undoable).
 * PLS cannot use covariance-matrix data or higher-order constructs: the switch is refused.
 */
export async function switchMethod(target: Method, confirm: typeof confirmDialog = confirmDialog): Promise<boolean> {
  const s = useStore.getState();
  if (s.settings.method === target) return true;
  if (s.settings.method === 'process' && s.model.threeWay?.length) {
    s.toast('error', 'Moderated moderations (three-way interactions) are available in conditional process analysis only. Remove them to switch.');
    return false;
  }
  if (target === 'process') {
    if (s.data?.moments && s.data.cols.length === 0) {
      s.toast('error', 'Conditional process analysis needs raw data; the current dataset is a covariance matrix.');
      return false;
    }
    const higher = s.model.constructs.filter((c) => c.components?.length);
    if (higher.length) {
      s.toast('error', `Higher-order constructs (${higher.map((c) => c.name).join(', ')}) are CB-SEM only. Remove their components to use conditional process analysis.`);
      return false;
    }
    useStore.getState().setSettings({ method: target });
    return true;
  }
  if (s.settings.method === 'process') addMainEffects();
  if (target === 'cbsem') {
    const composites = s.model.constructs.filter((c) => c.type === 'composite');
    if (composites.length) {
      const names = composites.map((c) => `“${c.name}”`).join(', ');
      const ok = await confirm({
        title: 'CB-SEM estimates common factors only',
        body: `${names} ${composites.length === 1 ? 'is a composite' : 'are composites'}. Convert to common factor${composites.length === 1 ? '' : 's'} (reflective, Mode A) and switch to CB-SEM? Undo restores ${composites.length === 1 ? 'it' : 'them'}.`,
        confirmLabel: 'Convert and switch',
      });
      if (!ok) return false;
      useStore.getState().commit((m) => ({
        ...m,
        constructs: m.constructs.map((c) => (c.type === 'composite' ? { ...c, type: 'factor', mode: 'A' } : c)),
      }));
    }
  } else {
    if (s.data?.moments && s.data.cols.length === 0) {
      s.toast('error', 'PLS needs raw data; the current dataset is a covariance matrix. Import raw data to use PLS-SEM.');
      return false;
    }
    const higher = s.model.constructs.filter((c) => c.components?.length);
    if (higher.length) {
      s.toast('error', `Higher-order constructs (${higher.map((c) => c.name).join(', ')}) are CB-SEM only. Remove their components to use PLS-SEM.`);
      return false;
    }
  }
  useStore.getState().setSettings({ method: target });
  return true;
}
