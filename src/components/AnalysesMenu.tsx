import { useSim } from '../simStore';
import { useStore } from '../store';

export interface WindowAnalysis { label: string; sub: string; open: () => void; disabled: boolean }

/**
 * The analyses that still open in their own window (until they become cards
 * on the Analyses tab), listed in its Add menu.
 */
export function useWindowAnalyses(): WindowAnalysis[] {
  const method = useStore((s) => s.settings.method);
  const hasModel = useStore((s) => s.model.constructs.length > 0);
  const item = (label: string, sub: string, open: () => void, disabled = false): WindowAnalysis => ({ label, sub, open, disabled });
  return [
    item('Monte Carlo simulation', method === 'process' ? 'for PLS-SEM and CB-SEM models' : 'power, sample size, estimators', () => useSim.getState().setOpen(true), !hasModel || method === 'process'),
  ];
}
