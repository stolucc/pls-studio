// @vitest-environment happy-dom
// A table copied as tab-separated text (for pasting into a spreadsheet) has
// formulas in its cells defused, as its CSV download does; numbers stay numbers.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { c, Table } from './Table';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('defuses formulas in the copied text', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Table
        title="Items"
        file="items"
        columns={['Item', 'Value']}
        rows={[
          [c('=HYPERLINK("http://x")'), c(-0.25)],
          [c("-1+cmd|' /C calc'!A0"), c(1.5)],
        ]}
      />,
    ),
  );
  const copy = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Copy'))!;
  await act(async () => copy.click());
  const text = writeText.mock.calls[0][0] as string;
  expect(text.split('\n')).toEqual([
    'Item\tValue',
    `'=HYPERLINK("http://x")\t-0.25`,
    `'-1+cmd|' /C calc'!A0\t1.5`,
  ]);
  act(() => root.unmount());
  host.remove();
});
