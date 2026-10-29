import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSim } from '../simStore';
import { useStore } from '../store';
import { IconChevronDown } from './icons';
import { useItems } from './ItemsPanel';
import { useLong } from './LongitudinalPanel';
import { useMultilevel } from './MultilevelPanel';
import { useSegmentation } from './SegmentationPanel';
import { usePlsAssessment } from './PlsAssessmentPanel';
import { useNca } from './NcaPanel';
import { useEndogeneity } from './EndogeneityPanel';
import { useMatching } from './MatchingPanel';
import { usePolynomial } from './PolynomialPanel';

/** Analyses of the dataset beside the diagram's model, each in its own panel. */
export function AnalysesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const method = useStore((s) => s.settings.method);
  const hasModel = useStore((s) => s.model.constructs.length > 0);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', key); };
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const item = (label: string, sub: string, action: () => void, disabled = false) => (
    <button role="menuitem" className="menu-item" disabled={disabled} onClick={() => { setOpen(false); action(); }}>
      <span>{label}<br /><span className="sub">{sub}</span></span>
    </button>
  );
  return (
    <div className="menu file-menu" ref={ref} onKeyDown={onKeyDown}>
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Analyses <IconChevronDown size={13} /></button>
      {open && (
        <div className="menu-pop" role="menu" aria-label="Analyses">
          {item('Item analysis', 'IRT (ltm), latent classes (poLCA)', () => useItems.getState().setOpen(true))}
          {item('Longitudinal models', 'growth curves, RI-CLPM (lavaan), growth mixtures (lcmm)', () => useLong.getState().setOpen(true))}
          {item('Multilevel regression', 'random intercepts and slopes (lme4)', () => useMultilevel.getState().setOpen(true))}
          {item('PLS-SEM assessment', method === 'pls' ? 'PLSpredict, model comparison (BIC, CVPAT), MICOM, multigroup' : 'for PLS-SEM models', () => usePlsAssessment.getState().setOpen(true), !hasModel || method !== 'pls')}
          {item('Segmentation (REBUS-PLS)', method === 'pls' ? 'classes of observations with different models (plspm)' : 'for PLS-SEM models', () => useSegmentation.getState().setOpen(true), !hasModel || method !== 'pls')}
          {item('Endogeneity', 'instruments (2SLS), Gaussian copula, Lewbel, Heckman', () => useEndogeneity.getState().setOpen(true))}
          {item('Necessary condition analysis', 'NCA: ceilings, effect sizes, bottlenecks', () => useNca.getState().setOpen(true))}
          {item('Polynomial regression (RSA)', 'congruence / imbalance of two predictors, response surface', () => usePolynomial.getState().setOpen(true))}
          {item('Propensity score matching', 'matching, balance, treatment effect (MatchIt)', () => useMatching.getState().setOpen(true))}
          <div className="menu-sep" role="separator" />
          {item('Monte Carlo simulation', method === 'process' ? 'for PLS-SEM and CB-SEM models' : 'power, sample size, estimators', () => useSim.getState().setOpen(true), !hasModel || method === 'process')}
        </div>
      )}
    </div>
  );
}
