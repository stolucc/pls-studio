// A small, non-blocking indicator of R in the browser (webR) in the bottom-left corner: while R starts (the background
// warm-up after load, or a first calculation), while it loads packages, "R ready" briefly afterwards, and a short note
// when R could not load. The app stays usable throughout. Hidden when the desktop helper runs R, and when R is not
// being loaded at all (the built-in engine, or a warm-up that was skipped).
//
// Download progress is not shown: webR downloads its runtime and packages inside its Web Worker, whose requests the
// page cannot measure, so the indicator names the phase only.

import { useEffect, useRef, useState } from 'react';
import { useCompute } from '../rengine/compute';
import { useR } from '../rengine/status';
import { IconAlert, IconCheck, IconX } from './icons';

/** How long "R ready" stays, and how long it takes to fade out. */
export const READY_MS = 2500;
export const FADE_MS = 400;

export const R_EXPLANATION =
  'PLS Studio runs R in your browser (webR). The first visit downloads about 20 MB; later visits use the browser’s cache.';

/** The first sentence of an error message, without a stack trace, at most 160 characters. */
export function shortError(message: string): string {
  const firstLine = message.split('\n')[0].trim();
  const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

type Shown =
  | { kind: 'loading'; text: string }
  | { kind: 'ready' }
  | { kind: 'error'; detail: string };

export function RStatusPill() {
  const status = useR((s) => s.status);
  const message = useR((s) => s.message);
  const helper = useCompute((s) => s.backend === 'helper');
  // "R ready" only follows a loading phase this indicator showed (not, say, a status reset).
  const sawLoading = useRef(false);
  const [readyPhase, setReadyPhase] = useState<'showing' | 'fading' | 'done'>('done');
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (status === 'loading') {
      sawLoading.current = true;
      setReadyPhase('done');
      return;
    }
    if (status !== 'ready' || !sawLoading.current) return;
    sawLoading.current = false;
    setReadyPhase('showing');
    const fade = setTimeout(() => setReadyPhase('fading'), READY_MS);
    const done = setTimeout(() => setReadyPhase('done'), READY_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [status, message]);

  let shown: Shown | null = null;
  if (helper || dismissed) shown = null;
  else if (status === 'loading') shown = { kind: 'loading', text: message || 'Loading R…' };
  else if (status === 'error') shown = { kind: 'error', detail: shortError(message) };
  else if (status === 'ready' && readyPhase !== 'done') shown = { kind: 'ready' };

  // The explanation closes with the indicator.
  const visible = shown !== null;
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  return (
    // The live region is always there, so that screen readers announce what appears in it.
    <div className="r-pill-region" role="status" aria-live="polite">
      {shown && (
        <div
          className={`r-pill ${shown.kind}${shown.kind === 'ready' && readyPhase === 'fading' ? ' fading' : ''}`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="r-pill-main"
            aria-expanded={open}
            aria-controls="r-pill-about"
            onClick={() => setOpen((o) => !o)}
          >
            {shown.kind === 'loading' && <span className="r-pill-spinner" aria-hidden="true" />}
            {shown.kind === 'ready' && <IconCheck size={13} />}
            {shown.kind === 'error' && <IconAlert size={13} />}
            <span className="r-pill-text">
              {shown.kind === 'loading' && shown.text}
              {shown.kind === 'ready' && 'R ready'}
              {shown.kind === 'error' && 'R could not load'}
            </span>
          </button>
          {shown.kind === 'error' && (
            <button
              type="button"
              className="r-pill-close"
              aria-label="Dismiss"
              onClick={() => setDismissed(true)}
            >
              <IconX size={12} />
            </button>
          )}
          {open && (
            // (not announced: it is opened on purpose, and read where it is)
            <div className="r-pill-about" id="r-pill-about" aria-live="off">
              {shown.kind === 'error' && <p>{shown.detail} The next calculation tries again.</p>}
              <p>{R_EXPLANATION}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
