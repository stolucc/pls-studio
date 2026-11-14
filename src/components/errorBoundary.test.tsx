// @vitest-environment happy-dom
// A part of the window that throws while rendering shows a short note with a
// Reload button; the rest of the app stays. The error goes to the console.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('./Canvas', () => ({
  Canvas: () => {
    throw new Error('internal diagram failure');
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, unmount: () => act(() => root.unmount()) };
}

function Broken(): never {
  throw new Error('internal failure');
}

it('shows the fallback in place of the failed part, keeps the rest and logs the error', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { host, unmount } = mount(
    <div>
      <p>Inspector still here</p>
      <ErrorBoundary area="the diagram">
        <Broken />
      </ErrorBoundary>
    </div>,
  );
  expect(host.textContent).toContain('Inspector still here');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'Something went wrong showing the diagram.',
  );
  expect(host.textContent).not.toContain('internal failure');
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toContain('Reload');
  expect(log.mock.calls.some((args) => args.some((a) => a instanceof Error))).toBe(true);
  unmount();
});

it('the top-level fallback covers the whole app', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { host, unmount } = mount(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(host.textContent).toContain('PLS Studio cannot continue');
  unmount();
});

it('in the editor, a failing diagram leaves the top bar and the Inspector', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // (the app asks the server who is signed in: answer "nobody", as without an account)
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
  const { useStore } = await import('../store');
  const { default: App } = await import('../App');
  useStore.getState().newProject();
  useStore.setState({ view: 'editor' });
  const { host, unmount } = mount(<App />);
  expect(host.textContent).toContain('Something went wrong showing the diagram.');
  expect(host.querySelector('.inspector-col')?.textContent).not.toBe('');
  expect(host.querySelector('.inspector-col [role="alert"]')).toBeNull();
  expect(host.querySelector('header, .topbar')).not.toBeNull();
  unmount();
});
