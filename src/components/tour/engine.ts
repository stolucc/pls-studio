// The guided tour's engine: which step is showing, moving between steps and chapters, waiting for each
// step's element to appear, and the "do it yourself" steps that move on once the action is done.
// Tour.tsx draws it; steps.ts says what it shows.

import { create } from 'zustand';
import { useAnalyses } from '../../analyses/store';
import { useStore } from '../../store';
import { dismissInvitation, loadProgress, markChapterDone } from './progress';
import type { Paragraphs, TourChapter, TourStep, TourTask } from './types';

/** The project that was open before the tour opened its example, to go back to at the end. */
export interface PreviousProject {
  id: string;
  name: string;
}

export interface TourState {
  active: boolean;
  chapters: TourChapter[];
  /** The whole tour, or one chapter (started from the contents of the help menu or the home screen). */
  mode: 'full' | 'chapter';
  chapter: number;
  step: number;
  /** 'preparing': the step's state is being set up (a tab opened, the example calculated). */
  phase: 'preparing' | 'showing';
  /** What the card says while preparing. */
  preparing: string;
  /** The spotlighted element (null: a card in the middle of the screen). */
  target: Element | null;
  /** A "do it yourself" step: still to do, being done for the person, done now, or done already. */
  task: 'todo' | 'working' | 'done' | 'already' | null;
  /** Ids of the chapters finished (also in browser storage). */
  completed: string[];
  previous: PreviousProject | null;
  /** The example project the tour opened (its steps may reopen it if the person opened another). */
  ownProject: string | null;
}

/** Timings, changeable by tests. */
export const tourTiming = {
  /** How long a step waits for its element to appear before it is skipped. */
  targetTimeout: 2500,
  /** The pause after a "do it yourself" step is done, before the next step shows. */
  autoAdvance: 900,
  /** How often a waiting step looks again. */
  poll: 50,
};

export const useTour = create<TourState>(() => ({
  active: false,
  chapters: [],
  mode: 'full',
  chapter: 0,
  step: 0,
  phase: 'preparing',
  preparing: '',
  target: null,
  task: null,
  completed: loadProgress().completed,
  previous: null,
  ownProject: null,
}));

/** Each move gets a number; work for an older move (a wait, a task's check) stops when a newer one starts. */
let token = 0;
let disarmTask: (() => void) | null = null;
/** Where the focus was when the tour started: it goes back there at the end. */
let opener: HTMLElement | null = null;

export function currentStep(s: TourState = useTour.getState()): TourStep | null {
  return s.chapters[s.chapter]?.steps[s.step] ?? null;
}

export function paragraphs(body: Paragraphs): string[] {
  return typeof body === 'function' ? body() : body;
}

/** The step's position counted over what this run of the tour covers (all chapters, or one). */
export function stepNumber(s: TourState = useTour.getState()): { n: number; of: number } {
  if (s.mode === 'chapter') {
    return { n: s.step + 1, of: s.chapters[s.chapter]?.steps.length ?? 0 };
  }
  const before = s.chapters.slice(0, s.chapter).reduce((k, c) => k + c.steps.length, 0);
  const total = s.chapters.reduce((k, c) => k + c.steps.length, 0);
  return { n: before + s.step + 1, of: total };
}

/** Whether the step showing is the last of this run of the tour. */
export function isLastStep(s: TourState = useTour.getState()): boolean {
  const chapter = s.chapters[s.chapter];
  if (!chapter || s.step < chapter.steps.length - 1) return false;
  return s.mode === 'chapter' || s.chapter === s.chapters.length - 1;
}

/** The element a step points at, when it is on the page and shown. */
export function findTarget(key: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
  if (!el || !el.isConnected || el.closest('[hidden]')) return null;
  // (an element hidden by CSS, such as the Bootstrap button under CPA, does not count)
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
  }
  return el;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTarget(key: string, my: number): Promise<HTMLElement | null> {
  const until = Date.now() + tourTiming.targetTimeout;
  for (;;) {
    const el = findTarget(key);
    if (el || my !== token) return el;
    if (Date.now() >= until) return null;
    await sleep(tourTiming.poll);
  }
}

/** The next position from (chapter, step) in direction `dir`, within what this run covers; null past an end. */
function neighbour(s: TourState, chapter: number, step: number, dir: 1 | -1) {
  let c = chapter;
  let k = step + dir;
  while (c >= 0 && c < s.chapters.length) {
    if (k >= 0 && k < s.chapters[c].steps.length) return { chapter: c, step: k };
    if (s.mode === 'chapter') return null;
    c += dir;
    if (c < 0 || c >= s.chapters.length) return null;
    k = dir === 1 ? 0 : s.chapters[c].steps.length - 1;
  }
  return null;
}

function complete(chapterId: string) {
  const { completed } = markChapterDone(chapterId);
  useTour.setState({ completed });
}

/** A task's condition; one that throws counts as not done. */
function isDone(task: TourTask): boolean {
  try {
    return task.done();
  } catch {
    return false;
  }
}

function stopTask() {
  disarmTask?.();
  disarmTask = null;
}

/** Watch a "do it yourself" step's condition and move on shortly after it holds. */
function armTask(step: TourStep, my: number) {
  const task = step.task;
  if (!task) return;
  const check = () => {
    if (my !== token) return;
    const state = useTour.getState().task;
    if (state === 'done' || state === 'already') return;
    if (!isDone(task)) return;
    useTour.setState({ task: 'done' });
    setTimeout(() => {
      if (my === token) void next();
    }, tourTiming.autoAdvance);
  };
  const unsubStore = useStore.subscribe(check);
  const unsubCards = useAnalyses.subscribe(check);
  // (some conditions are not in a store: the DOM, a panel's own state)
  const timer = setInterval(check, 400);
  disarmTask = () => {
    unsubStore();
    unsubCards();
    clearInterval(timer);
  };
}

/**
 * Show the step at (chapter, step), preparing the app for it first. When its element does not appear
 * (a feature this state does not show), the step is skipped in the direction of travel.
 */
async function show(chapter: number, step: number, dir: 1 | -1) {
  const my = ++token;
  stopTask();
  let at: { chapter: number; step: number } | null = { chapter, step };
  let direction = dir;
  while (at) {
    const s = useTour.getState();
    const st = s.chapters[at.chapter]?.steps[at.step];
    if (!st) break;
    useTour.setState({
      chapter: at.chapter,
      step: at.step,
      phase: 'preparing',
      preparing: '',
      target: null,
      task: null,
    });
    let ready: unknown;
    try {
      ready = await st.before?.();
    } catch (err) {
      console.error('Tour step could not be prepared', st.id, err);
    }
    if (my !== token) return;
    if (ready === false) {
      endTour();
      return;
    }
    const el = st.target ? await waitForTarget(st.target, my) : null;
    if (my !== token) return;
    if (st.target && !el) {
      // Skipped: the next step in the direction of travel (back at the very start: forwards).
      let to = neighbour(useTour.getState(), at.chapter, at.step, direction);
      if (!to && direction === -1) {
        direction = 1;
        to = neighbour(useTour.getState(), at.chapter, at.step, 1);
      }
      if (to && direction === 1 && to.chapter !== at.chapter) complete(s.chapters[at.chapter].id);
      if (!to) {
        if (direction === 1) complete(s.chapters[at.chapter].id);
        endTour();
        return;
      }
      at = to;
      continue;
    }
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    let taskState: TourState['task'] = null;
    if (st.task) {
      taskState = isDone(st.task) ? 'already' : 'todo';
    }
    useTour.setState({ phase: 'showing', target: el, task: taskState });
    if (taskState === 'todo') armTask(st, my);
    return;
  }
  endTour();
}

/** Say what the card shows while a step prepares (called from a step's `before`). */
export function preparing(text: string) {
  useTour.setState({ preparing: text });
}

/**
 * Start the tour: all of it, or one chapter. `chapters` is the tour's content (steps.ts, through
 * startTour in index.ts); tests give their own.
 */
export function startTourWith(chapters: TourChapter[], chapterId?: string) {
  if (!chapters.length) return;
  const index = chapterId ? chapters.findIndex((c) => c.id === chapterId) : 0;
  if (index < 0) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  // (a new start from inside the card keeps the original opener)
  if (!useTour.getState().active) opener = active instanceof HTMLElement ? active : null;
  const { completed } = dismissInvitation();
  useTour.setState({
    active: true,
    chapters,
    mode: chapterId ? 'chapter' : 'full',
    chapter: index,
    step: 0,
    phase: 'preparing',
    target: null,
    task: null,
    completed,
  });
  void show(index, 0, 1);
}

export async function next() {
  const s = useTour.getState();
  if (!s.active) return;
  const to = neighbour(s, s.chapter, s.step, 1);
  if (!to || to.chapter !== s.chapter) complete(s.chapters[s.chapter].id);
  if (!to) {
    endTour();
    return;
  }
  await show(to.chapter, to.step, 1);
}

export async function back() {
  const s = useTour.getState();
  if (!s.active) return;
  const to = neighbour(s, s.chapter, s.step, -1);
  if (!to) return;
  await show(to.chapter, to.step, -1);
}

/** Jump to the start of a chapter (from the card's contents). */
export async function jumpToChapter(id: string) {
  const s = useTour.getState();
  const index = s.chapters.findIndex((c) => c.id === id);
  if (!s.active || index < 0) return;
  // One chapter at a time stays so: the jump then covers the chosen chapter.
  await show(index, 0, 1);
}

/** "Do it for me" on a "do it yourself" step. */
export async function doItForMe() {
  const s = useTour.getState();
  const st = currentStep(s);
  if (!s.active || !st?.task || s.task === 'working' || s.task === 'done') return;
  const my = token;
  useTour.setState({ task: 'working' });
  try {
    await st.task.doIt();
  } catch (err) {
    useStore
      .getState()
      .toast('error', `That did not work: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (my !== token) return;
  // Done: the watcher moves on. Not done (refused, failed): the person can try again or skip the step.
  if (useTour.getState().task === 'working') {
    if (isDone(st.task)) {
      useTour.setState({ task: 'done' });
      setTimeout(() => {
        if (my === token) void next();
      }, tourTiming.autoAdvance);
    } else useTour.setState({ task: 'todo' });
  }
}

/** The tour's own hooks for the end (going back to the person's project): set by index.ts. */
export const tourHooks: { restore: (p: PreviousProject) => unknown } = {
  restore: () => undefined,
};

/**
 * End the tour. With `restore`, the project that was open before the tour opened its example
 * is reopened (it was kept in Recent projects).
 */
export function endTour(opts: { restore?: boolean } = {}) {
  token++;
  stopTask();
  const { previous, active } = useTour.getState();
  if (!active) return;
  useTour.setState({
    active: false,
    target: null,
    task: null,
    phase: 'preparing',
    previous: null,
    ownProject: null,
  });
  if (opts.restore && previous) void tourHooks.restore(previous);
  const back = opener;
  opener = null;
  if (back) setTimeout(() => back.isConnected && back.focus());
}
