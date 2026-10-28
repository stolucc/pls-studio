import { confirmDialog } from './components/Overlays';
import type { Method } from './model/project';
import { useStore } from './store';

/**
 * Change the estimation method, keeping the model valid for it. CB-SEM has no
 * composites: they are converted to common factors after confirmation (undoable).
 * PLS cannot use covariance-matrix data or higher-order constructs: the switch is refused.
 */
export async function switchMethod(target: Method, confirm: typeof confirmDialog = confirmDialog): Promise<boolean> {
  const s = useStore.getState();
  if (s.settings.method === target) return true;
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
