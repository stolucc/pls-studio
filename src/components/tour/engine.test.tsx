// @vitest-environment happy-dom
// The guided tour's engine and card, on a small tour of its own: moving, skipping a step whose element
// is missing, "do it yourself" steps, the keyboard, focus, the contents, and what is remembered.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import {
  back,
  doItForMe,
  endTour,
  jumpToChapter,
  next,
  startTourWith,
  tourHooks,
  tourTiming,
  useTour,
} from './engine';
import { loadProgress, resetProgress } from './progress';
import { Tour } from './Tour';
import type { TourChapter } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets the engine's waits and React's updates run. */
const settle = async (ms = 40) => {
  await act(async () => {
    await sleep(ms);
  });
};

let flag = false;
let declined = false;
const chapters: TourChapter[] = [
  {
    id: 'one',
    title: 'One',
    summary: 'first',
    steps: [
      { id: 'a', title: 'Step A', body: ['About **A**.'], target: 'a' },
      { id: 'gone', title: 'Missing', body: ['Not on the page.'], target: 'not-there' },
      { id: 'b', title: 'Step B', body: () => ['About B.'], target: 'b' },
    ],
  },
  {
    id: 'two',
    title: 'Two',
    summary: 'second',
    steps: [
      {
        id: 'task',
        title: 'Your turn',
        body: ['Press the button.'],
        target: 'c',
        task: { prompt: 'Press **C**.', done: () => flag, doIt: () => (flag = true) },
      },
      {
        id: 'guarded',
        title: 'Guarded',
        body: ['Needs consent.'],
        before: () => !declined,
      },
    ],
  },
  {
    id: 'three',
    title: 'Three',
    summary: 'last',
    steps: [{ id: 'end', title: 'The end', body: ['Bye.'] }],
  },
];

let root: Root;
let host: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(async () => {
  resetProgress();
  useTour.setState({ completed: [], active: false });
  tourTiming.targetTimeout = 60;
  tourTiming.poll = 5;
  tourTiming.autoAdvance = 10;
  flag = false;
  declined = false;
  document.body.innerHTML = '';
  for (const key of ['a', 'b', 'c']) {
    const el = document.createElement('button');
    el.setAttribute('data-tour', key);
    el.textContent = key;
    document.body.appendChild(el);
  }
  opener = document.createElement('button');
  opener.textContent = 'Take the tour';
  document.body.appendChild(opener);
  opener.focus();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<Tour />));
});

afterEach(() => {
  act(() => endTour());
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const state = () => useTour.getState();
const title = () => host.querySelector('#tour-title')?.textContent;
const key = (k: string, target: EventTarget = host.querySelector('.tour-card')!) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
const button = (label: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

describe('the tour engine', () => {
  it('starts at the first step, spotlights its element and shows the card as a dialog', async () => {
    act(() => startTourWith(chapters));
    await settle();
    expect(state().phase).toBe('showing');
    expect(state().target).toBe(document.querySelector('[data-tour="a"]'));
    const card = host.querySelector('.tour-card')!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe('tour-title');
    expect(title()).toBe('Step A');
    expect(host.querySelector('.tour-body b')?.textContent).toBe('A');
    expect(host.textContent).toContain('Step 1 of 6');
    expect(host.textContent).toContain('Chapter 1 of 3');
    // Focus moves into the card.
    expect(document.activeElement).toBe(card);
  });

  it('skips a step whose element is missing, forwards and backwards', async () => {
    act(() => startTourWith(chapters));
    await settle();
    await act(() => next());
    await settle(100);
    expect(title()).toBe('Step B');
    expect(state().step).toBe(2);
    await act(() => back());
    await settle(100);
    expect(title()).toBe('Step A');
  });

  it('moves with → and ←, Enter on the card, and ends with Esc, giving the focus back', async () => {
    act(() => startTourWith(chapters));
    await settle();
    key('ArrowRight');
    await settle(100);
    expect(title()).toBe('Step B');
    key('ArrowLeft');
    await settle(100);
    expect(title()).toBe('Step A');
    key('Enter');
    await settle(100);
    expect(title()).toBe('Step B');
    key('Escape');
    await settle();
    expect(state().active).toBe(false);
    expect(host.querySelector('.tour-card')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('leaves keys typed into a field of the app alone', async () => {
    act(() => startTourWith(chapters));
    await settle();
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('ArrowRight', input);
    key('Escape', input);
    await settle();
    expect(state().active).toBe(true);
    expect(title()).toBe('Step A');
  });

  it('keeps Tab inside the card', async () => {
    act(() => startTourWith(chapters));
    await settle();
    const card = host.querySelector('.tour-card') as HTMLElement;
    const all = [...card.querySelectorAll<HTMLElement>('button:not([disabled])')];
    all[all.length - 1].focus();
    act(() => {
      all[all.length - 1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(all[0]);
  });

  it('waits on a "do it yourself" step and moves on once it is done', async () => {
    act(() => startTourWith(chapters, 'two'));
    await settle();
    expect(title()).toBe('Your turn');
    expect(state().task).toBe('todo');
    expect(host.textContent).toContain('Press C.');
    expect(button('Do it for me')).toBeTruthy();
    // → does not skip the action; the person does it (a change in the store is noticed).
    key('ArrowRight');
    await settle();
    expect(title()).toBe('Your turn');
    flag = true;
    act(() => useStore.setState({}));
    expect(state().task).toBe('done');
    await settle(60);
    expect(title()).toBe('Guarded');
  });

  it('does it for the person with "Do it for me"', async () => {
    act(() => startTourWith(chapters, 'two'));
    await settle();
    await act(async () => {
      await doItForMe();
    });
    expect(flag).toBe(true);
    await settle(60);
    expect(title()).toBe('Guarded');
  });

  it('shows a task done before the step as done, without moving on by itself', async () => {
    flag = true;
    act(() => startTourWith(chapters, 'two'));
    await settle(60);
    expect(state().task).toBe('already');
    expect(title()).toBe('Your turn');
    expect(button('Next')).toBeTruthy();
  });

  it('stops when a step’s preparation is declined', async () => {
    declined = true;
    flag = true;
    act(() => startTourWith(chapters, 'two'));
    await settle();
    await act(() => next());
    await settle();
    expect(state().active).toBe(false);
  });

  it('jumps to a chapter from the contents, and one chapter at a time ends with it', async () => {
    act(() => startTourWith(chapters));
    await settle();
    act(() => button('Contents').click());
    const items = host.querySelectorAll('.tour-contents [role="menuitem"]');
    expect(items.length).toBe(3);
    act(() => (items[2] as HTMLElement).click());
    await settle();
    expect(title()).toBe('The end');
    expect(host.textContent).toContain('Step 6 of 6');
    expect(button('Finish')).toBeTruthy();

    act(() => endTour());
    act(() => startTourWith(chapters, 'one'));
    await settle();
    expect(state().mode).toBe('chapter');
    expect(host.textContent).toContain('Step 1 of 3');
    await act(() => jumpToChapter('three'));
    await settle();
    expect(host.textContent).toContain('Step 1 of 1');
  });

  it('remembers finished chapters', async () => {
    act(() => startTourWith(chapters));
    await settle();
    await act(() => next());
    await settle(100);
    expect(state().completed).toEqual([]);
    await act(() => next());
    await settle();
    expect(state().completed).toEqual(['one']);
    expect(loadProgress().completed).toEqual(['one']);
    expect(localStorage.getItem('pls-studio.tour.v1')).toContain('"one"');
  });

  it('works when browser storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    act(() => startTourWith(chapters));
    await settle();
    await act(() => next());
    await settle(100);
    await act(() => next());
    await settle();
    expect(title()).toBe('Your turn');
    expect(state().completed).toEqual(['one']);
    expect(loadProgress().invitationDone).toBe(true);
  });

  it('goes back to the person’s project at the end when asked', async () => {
    const restore = vi.fn();
    const before = tourHooks.restore;
    tourHooks.restore = restore;
    act(() => startTourWith(chapters, 'three'));
    await settle();
    act(() => useTour.setState({ previous: { id: 'p1', name: 'My model' } }));
    expect(button('Back to “My model”')).toBeTruthy();
    act(() => button('Back to “My model”').click());
    expect(restore).toHaveBeenCalledWith({ id: 'p1', name: 'My model' });
    expect(state().active).toBe(false);
    tourHooks.restore = before;
  });
});
