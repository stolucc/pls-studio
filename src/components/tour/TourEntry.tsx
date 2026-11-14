// Ways into the guided tour: the help menu of the top bar, the home screen's tour section, and the
// one-time invitation for a first visit.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconHelp } from '../icons';
import { useTour } from './engine';
import { startTour, TOUR } from './index';
import { dismissInvitation, loadProgress } from './progress';
import './tour.css';

/** The top bar's "?" menu: the tour (whole or a chapter) and the user guide. */
export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const completed = useTour((s) => s.completed);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  const start = (chapter?: string) => {
    setOpen(false);
    startTour(chapter);
  };
  return (
    <div className="menu help-menu" ref={ref} onKeyDown={onKeyDown} data-tour="help-menu">
      <button
        className="btn icon ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Help"
        title="Help: the guided tour and the user guide"
        onClick={() => setOpen(!open)}
      >
        <IconHelp />
      </button>
      {open && (
        <div className="menu-pop" role="menu" aria-label="Help">
          <button role="menuitem" className="menu-item" onClick={() => start()}>
            <span>
              Take the tour
              <br />
              <span className="sub">Every panel, step by step, about ten minutes</span>
            </span>
          </button>
          <a role="menuitem" className="menu-item" href="guide.html" target="_blank" rel="noopener">
            User guide
          </a>
          <div className="menu-sep" role="separator" />
          <div className="menu-group">Tour one chapter</div>
          {TOUR.map((c, i) => (
            <button key={c.id} role="menuitem" className="menu-item" onClick={() => start(c.id)}>
              <span>
                {i + 1}. {c.title}
              </span>
              {completed.includes(c.id) && (
                <span className="tour-done" aria-label="finished">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The home screen's tour section: start the whole tour, or one chapter. */
export function HomeTour() {
  const completed = useTour((s) => s.completed);
  const done = TOUR.filter((c) => completed.includes(c.id)).length;
  return (
    <section className="home-tour-section" aria-labelledby="home-tour-title">
      <h2 id="home-tour-title">Guided tour</h2>
      <div className="home-tour">
        <button className="start-card" onClick={() => startTour()} data-tour="home-tour">
          <IconHelp size={22} />
          <b>Take the tour</b>
          <span>
            What every panel does, in ten short chapters. You calculate a real model and read its
            results on the way.
            {done > 0 ? ` ${done} of ${TOUR.length} chapters finished.` : ''}
          </span>
        </button>
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            Or one chapter at a time:
          </p>
          <div className="tour-chapters">
            {TOUR.map((c, i) => (
              <button
                key={c.id}
                className="btn sm"
                onClick={() => startTour(c.id)}
                title={c.summary}
              >
                {i + 1}. {c.title}
                {completed.includes(c.id) && (
                  <span className="tour-done" aria-label="finished">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A first visit's invitation to the tour, until it is taken or dismissed. */
export function TourInvitation() {
  const [shown, setShown] = useState(() => !loadProgress().invitationDone);
  const active = useTour((s) => s.active);
  if (!shown || active) return null;
  return (
    <aside className="tour-invite" aria-label="Guided tour">
      <p>
        <b>New to PLS Studio?</b> A ten-minute guided tour shows what each panel does, with a real
        model you calculate yourself.
      </p>
      <button
        className="btn primary"
        onClick={() => {
          setShown(false);
          startTour();
        }}
      >
        Take the tour
      </button>
      <button
        className="btn ghost"
        onClick={() => {
          dismissInvitation();
          setShown(false);
        }}
      >
        Not now
      </button>
    </aside>
  );
}
