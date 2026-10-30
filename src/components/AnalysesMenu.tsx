import { useSim } from '../simStore';
import { useStore } from '../store';
import { useLong } from './LongitudinalPanel';
import { useSegmentation } from './SegmentationPanel';
import { usePlsAssessment } from './PlsAssessmentPanel';

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
    item('Longitudinal models', 'growth curves, RI-CLPM (lavaan), growth mixtures (lcmm)', () => useLong.getState().setOpen(true)),
    item('PLS-SEM assessment', method === 'pls' ? 'PLSpredict, blindfolding (Q²), model comparison, MICOM / multigroup, CTA, CCA' : 'for PLS-SEM models', () => usePlsAssessment.getState().setOpen(true), !hasModel || method !== 'pls'),
    item('Segmentation (REBUS-PLS)', method === 'pls' ? 'classes of observations with different models (plspm)' : 'for PLS-SEM models', () => useSegmentation.getState().setOpen(true), !hasModel || method !== 'pls'),
    item('Monte Carlo simulation', method === 'process' ? 'for PLS-SEM and CB-SEM models' : 'power, sample size, estimators', () => useSim.getState().setOpen(true), !hasModel || method === 'process'),
  ];
}
