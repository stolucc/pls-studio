import { confirmDialog } from './components/Overlays';
import { newId, type Method, type ModelState } from './model/project';
import { useStore } from './store';

/**
 * SEM draws each moderator's main effect on the outcome as a path; conditional
 * process models imply it. The paths to add when leaving process analysis.
 */
function missingMainEffects(model: ModelState): { from: string; to: string }[] {
  const missing = model.moderations.flatMap((mo) => {
    const p = model.paths.find((q) => q.id === mo.path);
    return p &&
      mo.moderator !== p.from &&
      !model.paths.some((q) => q.from === mo.moderator && q.to === p.to)
      ? [{ from: mo.moderator, to: p.to }]
      : [];
  });
  return missing.filter(
    (e, i) => missing.findIndex((f) => f.from === e.from && f.to === e.to) === i,
  );
}

/**
 * Change the estimation method, keeping the model valid for it. CB-SEM has no
 * composites: they are converted to common factors after confirmation. PLS cannot
 * use covariance-matrix data: the switch is refused. Every check and confirmation
 * comes first; the model changes (main-effect paths when leaving process analysis,
 * the conversion) and the new method are then one step, which undo takes back
 * together.
 */
export async function switchMethod(
  target: Method,
  confirm: typeof confirmDialog = confirmDialog,
): Promise<boolean> {
  const s = useStore.getState();
  if (s.settings.method === target) return true;
  if (target === 'cbsem' && s.model.threeWay?.length) {
    s.toast(
      'error',
      'Moderated moderations (three-way interactions) are available in PLS-SEM and conditional process analysis. Remove them to switch.',
    );
    return false;
  }
  if (target === 'process') {
    if (s.data?.moments && s.data.cols.length === 0) {
      s.toast(
        'error',
        'Conditional process analysis needs raw data; the current dataset is a covariance matrix.',
      );
      return false;
    }
    const higher = s.model.constructs.filter((c) => c.components?.length);
    if (higher.length) {
      s.toast(
        'error',
        `Higher-order constructs (${higher.map((c) => c.name).join(', ')}) are CB-SEM only. Remove their components to use conditional process analysis.`,
      );
      return false;
    }
    useStore.getState().setSettings({ method: target });
    return true;
  }
  if (target !== 'cbsem' && s.data?.moments && s.data.cols.length === 0) {
    s.toast(
      'error',
      'PLS needs raw data; the current dataset is a covariance matrix. Import raw data to use PLS-SEM.',
    );
    return false;
  }
  const composites =
    target === 'cbsem' ? s.model.constructs.filter((c) => c.type === 'composite') : [];
  if (composites.length) {
    const names = composites.map((c) => `“${c.name}”`).join(', ');
    const ok = await confirm({
      title: 'CB-SEM estimates common factors only',
      body: `${names} ${composites.length === 1 ? 'is a composite' : 'are composites'}. Convert to common factor${composites.length === 1 ? '' : 's'} (reflective, Mode A) and switch to CB-SEM? Undo restores ${composites.length === 1 ? 'it' : 'them'} and the method.`,
      confirmLabel: 'Convert and switch',
    });
    if (!ok) return false;
  }
  const store = useStore.getState();
  const added = store.settings.method === 'process' ? missingMainEffects(store.model) : [];
  if (!added.length && !composites.length) {
    store.setSettings({ method: target });
    return true;
  }
  store.commitWithSettings(
    (m) => ({
      ...m,
      constructs: composites.length
        ? m.constructs.map((c) =>
            c.type === 'composite' ? { ...c, type: 'factor', mode: 'A' } : c,
          )
        : m.constructs,
      paths: [...m.paths, ...added.map((e) => ({ id: newId('p'), ...e }))],
    }),
    { method: target },
  );
  if (added.length)
    store.toast(
      'info',
      `Added ${added.length} moderator main-effect path${added.length === 1 ? '' : 's'}, which SEM draws explicitly.`,
    );
  return true;
}
