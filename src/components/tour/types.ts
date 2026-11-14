// The shape of the guided tour: chapters of steps, each step pointing at an element of the app by its
// data-tour attribute (src/components/tour/steps.ts holds the content, engine.ts walks through it).

/** Where the card sits beside its target. */
export type Side = 'right' | 'left' | 'bottom' | 'top';

/**
 * Paragraphs of a step. **Double asterisks** mark the names of buttons and tabs (shown bold).
 * A function is read when the step shows, for text that depends on the app's state.
 */
export type Paragraphs = string[] | (() => string[]);

/** A "do it yourself" step: the card asks for an action and moves on when it is done. */
export interface TourTask {
  /** What to do, in one short sentence (shown as the call to action). */
  prompt: string;
  /** Whether the action has been done (read from the stores). */
  done: () => boolean;
  /** "Do it for me": does the action, so that nobody gets stuck. */
  doIt: () => unknown;
}

export interface TourStep {
  /** Unique within the tour. */
  id: string;
  title: string;
  body: Paragraphs;
  /** The data-tour attribute of the element to spotlight; none for a card in the middle of the screen. */
  target?: string;
  /** The preferred side of the card (the card moves to another side when this one has no room). */
  side?: Side;
  /**
   * Puts the app in the state the step shows (a tab, a panel, results), so that every step can be reached
   * directly from the contents. Resolving `false` stops the tour (the person declined).
   */
  before?: () => unknown;
  /** Further data-tour attributes `before` uses (results tabs it clicks): the tests check they exist. */
  uses?: string[];
  task?: TourTask;
}

export interface TourChapter {
  id: string;
  title: string;
  /** One line for the contents and the home screen. */
  summary: string;
  steps: TourStep[];
}
