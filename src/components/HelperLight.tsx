// The helper light in the top bar: one glance tells whether the desktop helper (desktop R, GPU bootstrap) is
// connected. Green: connected; grey: not running or not paired; amber: running but unusable (no R, older than this
// site). The light opens the helper panel (connect, pairing code, download, disconnect) so pairing is reachable
// from anywhere, whichever engine is chosen. A browser paired before probes the helper once when the app starts;
// one never paired does not (no request to the loopback port, no local-network permission prompt) until asked.

import { useEffect, useRef, useState } from 'react';
import {
  helperPairedBefore,
  useHelper,
  type HelperInfo,
  type HelperState,
} from '../rengine/helper';
import { HelperStatus } from './ComputeSettings';

export type LightColour = 'green' | 'amber' | 'grey';

/** The light's colour and short text for a helper state. */
export function helperLight(state: HelperState): { colour: LightColour; text: string } {
  switch (state) {
    case 'ready':
      return { colour: 'green', text: 'Helper connected' };
    case 'checking':
    case 'unknown':
      return { colour: 'grey', text: 'Helper: checking…' };
    case 'absent':
      return { colour: 'grey', text: 'Helper not running' };
    case 'unpaired':
      return { colour: 'grey', text: 'Helper not connected' };
    case 'no-r':
      return { colour: 'amber', text: 'Helper running, R not found' };
    case 'mismatch':
      return { colour: 'amber', text: 'Helper older than this site' };
  }
}

/** The tooltip: what the connected helper offers. */
export function helperSummary(
  state: HelperState,
  info: HelperInfo | null,
  message: string,
): string {
  if (state !== 'ready' || !info) return message || helperLight(state).text;
  const r = info.r.replace(/^R version ([0-9.]+).*/, 'R $1');
  const gpu = info.gpu?.accelerators.length
    ? `GPU bootstrap: ${info.gpu.accelerators.map((a) => a.name).join(', ')}`
    : 'no GPU worker';
  return `Helper connected: ${r}, ${info.workers} R process${info.workers === 1 ? '' : 'es'}; ${gpu}.`;
}

export function HelperLight() {
  const state = useHelper((s) => s.state);
  const info = useHelper((s) => s.info);
  const message = useHelper((s) => s.message);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (helperPairedBefore())
      void import('../rengine/bridge').then(({ checkHelper }) => checkHelper(false));
  }, []);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const light = helperLight(state);
  return (
    <div className="menu helper-light" ref={ref} data-tour="helper-light">
      <button
        type="button"
        className={`btn ghost helper-light-btn ${light.colour}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={helperSummary(state, info, message)}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="helper-dot" aria-hidden="true" />
        <span className="lbl">Helper</span>
        <span className="sr-only">: {light.text}</span>
      </button>
      {open && (
        <div className="menu-pop helper-pop" role="dialog" aria-label="Desktop helper">
          <div className="helper-pop-title">{light.text}</div>
          <HelperStatus />
        </div>
      )}
    </div>
  );
}
