// @vitest-environment happy-dom
// The ways into the guided tour: the home screen's tour section and first-visit invitation, and the
// top bar's help menu (the tour, one chapter, the user guide). What is remembered survives without storage.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { HomeScreen } from '../HomeScreen';
import { TopBar } from '../TopBar';
import { endTour, useTour } from './engine';
import { dismissInvitation, loadProgress, markChapterDone, resetProgress } from './progress';
import { TOUR } from './steps';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const buttonIn = (host: HTMLElement, text: string | RegExp) =>
  [...host.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? ''),
  );

beforeEach(() => {
  resetProgress();
  useTour.setState({ completed: [], active: false });
});
afterEach(() => {
  act(() => endTour());
  vi.unstubAllGlobals();
});

describe('the home screen', () => {
  it('invites a first visit to the tour, until dismissed', () => {
    let page = mount(<HomeScreen />);
    expect(page.host.querySelector('.tour-invite')?.textContent).toContain('New to PLS Studio?');
    act(() => buttonIn(page.host, 'Not now')!.click());
    expect(page.host.querySelector('.tour-invite')).toBeNull();
    expect(loadProgress().invitationDone).toBe(true);
    page.unmount();
    page = mount(<HomeScreen />);
    expect(page.host.querySelector('.tour-invite')).toBeNull();
    page.unmount();
  });

  it('offers the whole tour and each chapter, ticking finished ones', () => {
    markChapterDone('canvas');
    useTour.setState({ completed: loadProgress().completed });
    const page = mount(<HomeScreen />);
    const section = page.host.querySelector('.home-tour-section')!;
    expect(section.textContent).toContain('Take the tour');
    expect(section.textContent).toContain(`1 of ${TOUR.length} chapters finished`);
    const chapters = section.querySelectorAll('.tour-chapters button');
    expect(chapters.length).toBe(TOUR.length);
    expect(chapters[3].textContent).toContain('✓');
    expect(chapters[0].textContent).not.toContain('✓');
    page.unmount();
  });

  it('starts the tour from its card', async () => {
    const page = mount(<HomeScreen />);
    act(() => (page.host.querySelector('[data-tour="home-tour"]') as HTMLElement).click());
    expect(useTour.getState().active).toBe(true);
    expect(useTour.getState().mode).toBe('full');
    page.unmount();
  });

  it('shows the invitation each visit when storage is blocked, and Not now still holds for the visit', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    resetProgress();
    const page = mount(<HomeScreen />);
    expect(page.host.querySelector('.tour-invite')).not.toBeNull();
    act(() => buttonIn(page.host, 'Not now')!.click());
    expect(page.host.querySelector('.tour-invite')).toBeNull();
    expect(dismissInvitation().invitationDone).toBe(true);
    page.unmount();
  });
});

describe('the help menu', () => {
  it('holds the tour, a chapter at a time, and the user guide', () => {
    useStore.getState().newProject();
    useStore.getState().setView('editor');
    const page = mount(<TopBar />);
    const help = page.host.querySelector('[data-tour="help-menu"] button')!;
    expect(help.getAttribute('aria-label')).toBe('Help');
    act(() => (help as HTMLElement).click());
    const menu = page.host.querySelector('[role="menu"][aria-label="Help"]')!;
    expect(menu.textContent).toContain('Take the tour');
    const guide = menu.querySelector('a[href="guide.html"]')!;
    expect(guide.getAttribute('target')).toBe('_blank');
    expect(guide.getAttribute('rel')).toBe('noopener');
    for (const c of TOUR) expect(menu.textContent).toContain(c.title);
    act(() => buttonIn(page.host, /The Data panel/)!.click());
    expect(useTour.getState().active).toBe(true);
    expect(useTour.getState().mode).toBe('chapter');
    expect(useTour.getState().chapters[useTour.getState().chapter].id).toBe('data-panel');
    page.unmount();
  });
});
