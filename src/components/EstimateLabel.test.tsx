// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DEFAULT_FIGURE_STYLE } from '../figure/style';
import { EstimateText } from './EstimateLabel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('writes the estimate and its significance as the figure style asks', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const show = (el: React.ReactElement) => {
    act(() => root.render(el));
    return host.innerHTML;
  };
  const stars = { ...DEFAULT_FIGURE_STYLE, pFormat: 'stars' as const };
  expect(show(<EstimateText figure={stars} value={0.4468} p={0.0002} />)).toBe(
    '0.447<span class="p">***</span>',
  );
  expect(show(<EstimateText figure={stars} value={0.1} p={0.3} />)).toBe('0.100');
  expect(show(<EstimateText figure={stars} value={0.1} p={null} text="1 (fixed)" />)).toBe(
    '1 (fixed)',
  );
  act(() => root.unmount());
});
