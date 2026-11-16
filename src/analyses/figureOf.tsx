// For tests (happy-dom): the FigureSpec a chart hands to ggplot2. Renders the element, clicks the chart's ggplot2
// button and its first entry (PDF), and returns what the test file's mock of ../figure/ggplot received.

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { vi, type Mock } from 'vitest';
import type { FigureSpec } from '../figure/ggplot';
import * as format from '../format';

export async function figureOf(el: ReactElement, label: string, file: Mock): Promise<FigureSpec> {
  vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  try {
    const frame = host.querySelector(`svg[aria-label^="${label}"]`)?.closest('figure');
    if (!frame) throw new Error(`No chart labelled ${label}`);
    const button = frame.querySelector('[title^="This chart drawn by ggplot2"]');
    if (!button) throw new Error(`The chart labelled ${label} has no ggplot2 button`);
    act(() => (button as HTMLButtonElement).click());
    await act(async () => (frame.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    return file.mock.calls.at(-1)![0] as FigureSpec;
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}
