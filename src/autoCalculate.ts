// Recalculate by itself: shortly after the model changes, when the setting is on and the model can be estimated.

import { validateModel } from './model/project';
import { resultsKey, useStore, type State } from './store';

/** Whether a run is due for this state; `tried` is the last model it ran for, so a failure is not repeated. */
export function autoCalculateDue(s: Pick<State, 'settings' | 'model' | 'data' | 'dataVersion' | 'job' | 'results'>, tried: string | null): boolean {
  if (!s.settings.autoCalculate || s.job || !s.data || s.model.constructs.length === 0) return false;
  const key = resultsKey(s);
  if (key === tried || s.results?.key === key) return false;
  return !validateModel(s.model, s.data, s.settings).some((i) => i.level === 'error');
}

export const AUTO_CALCULATE_DELAY = 800;

/** Start watching the store; returns the function that stops. */
export function startAutoCalculate(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let tried: string | null = null;
  // Only changes that can affect a run restart the delay; whether one is due (which validates the model) is
  // checked once the delay has passed, not on every store change (selection, hover, panel state).
  const stop = useStore.subscribe((s, prev) => {
    if (s.settings === prev.settings && s.model === prev.model && s.data === prev.data && s.dataVersion === prev.dataVersion && s.job === prev.job && s.results === prev.results) return;
    if (timer) clearTimeout(timer);
    timer = null;
    if (!s.settings.autoCalculate || s.job || !s.data) return;
    timer = setTimeout(() => {
      const now = useStore.getState();
      if (!autoCalculateDue(now, tried)) return;
      tried = resultsKey(now);
      void import('./runner').then(({ run }) => run('estimate'));
    }, AUTO_CALCULATE_DELAY);
  });
  return () => { stop(); if (timer) clearTimeout(timer); };
}
