// The guided tour on screen: a spotlight on the step's element (the rest dimmed and not clickable), and
// a card beside it with the step's text, progress, the contents and the buttons. "Do it yourself" steps
// leave the page usable and only ring their element. Keyboard: ← and → move, Enter goes on, Esc ends.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  back,
  currentStep,
  doItForMe,
  endTour,
  isLastStep,
  jumpToChapter,
  next,
  paragraphs,
  stepNumber,
  useTour,
} from './engine';
import { placeCard, spotlightBox, type Box } from './placement';
import './tour.css';

/** Below this width the card sits at the bottom of the screen, without a spotlight. */
export const NARROW = 640;

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Text with **bold** names of buttons and tabs. */
export function richText(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part));
}

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

function isTyping(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** The element's box, the window's size and the card's size, followed frame by frame. */
function useLayout(target: Element | null, card: React.RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState<{ target: Box | null; view: Box; card: Box }>({
    target: null,
    view: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    card: { x: 0, y: 0, w: 360, h: 240 },
  });
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const r = target?.getBoundingClientRect();
      const t =
        r && (r.width > 0 || r.height > 0)
          ? { x: r.left, y: r.top, w: r.width, h: r.height }
          : null;
      const view = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      const el = card.current;
      const c = { x: 0, y: 0, w: el?.offsetWidth || 360, h: el?.offsetHeight || 240 };
      setLayout((prev) =>
        sameBox(prev.target, t) && sameBox(prev.view, view) && sameBox(prev.card, c)
          ? prev
          : { target: t, view, card: c },
      );
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [target, card]);
  return layout;
}

function Contents({ onClose }: { onClose: () => void }) {
  const chapters = useTour((s) => s.chapters);
  const at = useTour((s) => s.chapter);
  const completed = useTour((s) => s.completed);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-current="step"], button')?.focus();
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <div
      className="tour-contents"
      role="menu"
      aria-label="Tour chapters"
      ref={ref}
      onKeyDown={onKey}
    >
      {chapters.map((c, i) => (
        <button
          key={c.id}
          role="menuitem"
          className={`menu-item${i === at ? ' on' : ''}`}
          aria-current={i === at ? 'step' : undefined}
          onClick={() => {
            onClose();
            void jumpToChapter(c.id);
          }}
        >
          <span className="tour-contents-n">{i + 1}</span>
          <span>
            {c.title}
            <br />
            <span className="sub">{c.summary}</span>
          </span>
          {completed.includes(c.id) && (
            <span className="tour-done" aria-label="finished">
              ✓
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function TourLayer() {
  const s = useTour();
  const step = currentStep(s);
  const cardRef = useRef<HTMLDivElement>(null);
  const [contentsOpen, setContentsOpen] = useState(false);
  const layout = useLayout(s.phase === 'showing' ? s.target : null, cardRef);
  const narrow = layout.view.w < NARROW;
  const showing = s.phase === 'showing';
  const task = showing && step?.task ? s.task : null;
  const last = isLastStep(s);
  const { n, of } = stepNumber(s);
  const chapter = s.chapters[s.chapter];

  // Focus moves into the card at each step (and the contents close).
  useLayoutEffect(() => {
    setContentsOpen(false);
    if (showing) cardRef.current?.focus({ preventScroll: true });
  }, [s.chapter, s.step, showing]);

  // The keys, before the app's own shortcuts (and the validation page's Esc) see them.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const st = useTour.getState();
      if (!st.active) return;
      // A dialog over the tour (a confirmation) has the keys.
      if (document.querySelector('.modal-backdrop')) return;
      const card = cardRef.current;
      const inCard = !!card && card.contains(e.target as Node);
      if (!inCard && isTyping(e.target as Element)) return;
      const ready = st.phase === 'showing';
      const taskOpen =
        ready && !!currentStep(st)?.task && (st.task === 'todo' || st.task === 'working');
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        if (card?.querySelector('.tour-contents')) {
          stop();
          setContentsOpen(false);
          card.querySelector<HTMLButtonElement>('.tour-contents-btn')?.focus();
          return;
        }
        // An open menu of the app closes first.
        if (!inCard && document.querySelector('.menu-pop')) return;
        stop();
        endTour({ restore: true });
      } else if (e.key === 'ArrowRight') {
        if (!ready || taskOpen) return;
        stop();
        if (isLastStep(st)) endTour();
        else void next();
      } else if (e.key === 'ArrowLeft') {
        stop();
        void back();
      } else if (e.key === 'Enter') {
        // (buttons answer Enter themselves; on the card itself it means Next)
        if (e.target !== card || !ready || taskOpen) return;
        stop();
        if (isLastStep(st)) endTour();
        else void next();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Tab and Shift+Tab stay in the card.
  const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const all = [...cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!all.length) return;
    const first = all[0];
    const lastEl = all[all.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === cardRef.current)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && at === lastEl) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!step || !chapter) return null;
  const target = showing && !narrow ? layout.target : null;
  const hole = target ? spotlightBox(target, layout.view) : null;
  const placed = narrow
    ? { x: 12, y: Math.max(12, layout.view.h - layout.card.h - 12), side: 'centre' as const }
    : placeCard(hole, layout.card, layout.view, step.side);
  const paras = showing ? paragraphs(step.body) : [];
  const previous = s.previous;

  let overlay: ReactNode;
  if (task) {
    // Do it yourself: the page stays usable; a ring marks where.
    overlay = hole && (
      <div
        className="tour-ring"
        style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }}
        aria-hidden="true"
      />
    );
  } else if (hole) {
    const { x, y, w, h } = hole;
    overlay = (
      <>
        <div
          className="tour-spot"
          style={{ left: x, top: y, width: w, height: h }}
          aria-hidden="true"
        />
        {/* The dimmed rest is not clickable; the spotlighted element is. */}
        <div className="tour-block" style={{ left: 0, top: 0, right: 0, height: y }} />
        <div className="tour-block" style={{ left: 0, top: y + h, right: 0, bottom: 0 }} />
        <div className="tour-block" style={{ left: 0, top: y, width: x, height: h }} />
        <div className="tour-block" style={{ left: x + w, top: y, right: 0, height: h }} />
      </>
    );
  } else {
    overlay = (
      <div className={`tour-block tour-dim${showing ? '' : ' light'}`} style={{ inset: 0 }} />
    );
  }

  const finishButtons = previous ? (
    <>
      <button className="btn" onClick={() => endTour()}>
        Stay with the example
      </button>
      <button className="btn primary" onClick={() => endTour({ restore: true })}>
        Back to “{previous.name}”
      </button>
    </>
  ) : (
    <button className="btn primary" onClick={() => endTour()}>
      Finish
    </button>
  );

  return (
    <div className="tour-layer">
      {overlay}
      <div
        ref={cardRef}
        className={`tour-card${narrow ? ' narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        style={{ left: placed.x, top: placed.y }}
        data-side={placed.side}
        onKeyDown={onCardKey}
      >
        <div className="tour-top">
          <span className="tour-chapter">
            Chapter {s.chapter + 1} of {s.chapters.length} · {chapter.title}
          </span>
          <div className="tour-contents-wrap">
            <button
              className="btn sm ghost tour-contents-btn"
              aria-haspopup="menu"
              aria-expanded={contentsOpen}
              onClick={() => setContentsOpen(!contentsOpen)}
            >
              Contents
            </button>
          </div>
        </div>
        {/* (in the card's flow, so that a short card grows to show the whole list) */}
        {contentsOpen && <Contents onClose={() => setContentsOpen(false)} />}
        <h2 id="tour-title">{step.title}</h2>
        <div id="tour-body" className="tour-body">
          {showing ? (
            paras.map((p, i) => <p key={i}>{richText(p)}</p>)
          ) : (
            <p className="tour-preparing">
              <span className="tour-spinner" aria-hidden="true" />
              {s.preparing || 'Getting this step ready…'}
            </p>
          )}
        </div>
        {task && step.task && (
          <div className={`tour-task ${task}`} aria-live="polite">
            {task === 'todo' && <span>{richText(step.task.prompt)}</span>}
            {task === 'working' && <span>Working on it…</span>}
            {task === 'done' && <span>✓ Done. On to the next step…</span>}
            {task === 'already' && <span>✓ Already done: go on when you are ready.</span>}
          </div>
        )}
        <div className="tour-progress">
          <span>
            Step {n} of {of}
          </span>
          <div
            className="tour-bar"
            role="progressbar"
            aria-label="Tour progress"
            aria-valuemin={1}
            aria-valuemax={of}
            aria-valuenow={n}
          >
            <div style={{ width: `${(100 * n) / Math.max(1, of)}%` }} />
          </div>
        </div>
        <div className="tour-actions">
          {!last && (
            <button
              className="btn ghost tour-skip"
              onClick={() => endTour({ restore: true })}
              title="End the tour (Esc)"
            >
              Skip tour
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => void back()} disabled={n === 1}>
            Back
          </button>
          {last && showing ? (
            finishButtons
          ) : task === 'todo' || task === 'working' ? (
            <>
              <button
                className="btn ghost"
                onClick={() => void next()}
                title="Go on without doing it"
              >
                Skip step
              </button>
              <button
                className="btn primary"
                onClick={() => void doItForMe()}
                disabled={task === 'working'}
              >
                Do it for me
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={() => void next()} disabled={!showing}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The tour, while it runs (rendered once per view by App). */
export function Tour() {
  const active = useTour((s) => s.active);
  return active ? <TourLayer /> : null;
}
