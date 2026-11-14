// What the guided tour remembers in this browser: the chapters finished and whether the first-visit
// invitation was dismissed. Browser storage may be blocked (private windows, strict settings): then
// the tour still works and remembers for this visit only.

const KEY = 'pls-studio.tour.v1';

export interface TourProgress {
  /** Ids of the chapters walked through to their end. */
  completed: string[];
  /** The home screen's invitation to take the tour was dismissed (or the tour taken). */
  invitationDone: boolean;
}

/** Used when storage is unavailable, so that a choice still holds for this visit. */
let memory: TourProgress = { completed: [], invitationDone: false };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parse(text: string | null): TourProgress | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Partial<TourProgress>;
    const completed = Array.isArray(raw.completed)
      ? raw.completed.filter((x): x is string => typeof x === 'string').slice(0, 50)
      : [];
    return { completed, invitationDone: raw.invitationDone === true };
  } catch {
    return null;
  }
}

export function loadProgress(): TourProgress {
  try {
    const stored = parse(storage()?.getItem(KEY) ?? null);
    if (stored) memory = stored;
  } catch {
    // (blocked storage: keep what this visit knows)
  }
  return { ...memory, completed: [...memory.completed] };
}

function saveProgress(p: TourProgress) {
  memory = { ...p, completed: [...p.completed] };
  try {
    storage()?.setItem(KEY, JSON.stringify(memory));
  } catch {
    // (blocked or full storage: remembered for this visit only)
  }
}

/** Remember that a chapter was walked through. */
export function markChapterDone(id: string): TourProgress {
  const p = loadProgress();
  if (!p.completed.includes(id)) p.completed.push(id);
  saveProgress(p);
  return p;
}

/** Remember that the invitation needs no showing again. */
export function dismissInvitation(): TourProgress {
  const p = loadProgress();
  p.invitationDone = true;
  saveProgress(p);
  return p;
}

/** For tests: forget everything, in storage and in memory. */
export function resetProgress() {
  memory = { completed: [], invitationDone: false };
  try {
    storage()?.removeItem(KEY);
  } catch {
    // (nothing stored)
  }
}
