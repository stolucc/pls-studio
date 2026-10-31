// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { logCurrentRun } from '../analyses/runs';
import { loadCards, useAnalyses } from '../analyses/store';
import { resultsKey, useStore } from '../store';
import { ModelVersionBadge } from './ModelVersionBadge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function render() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<ModelVersionBadge />));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}
const s = () => useStore.getState();
const calculated = () => useStore.setState((x) => ({ results: { pls: { n: 3 } as never, cb: null, miiv: null, boot: null, fitTest: null, key: resultsKey(x) } }));

beforeEach(() => { s().newProject(); useStore.setState({ cloud: null, toasts: [] }); loadCards([]); });

describe('the version badge on the canvas', () => {
  it('names the run the model matches, the version it was edited from, or that it is not calculated yet', async () => {
    expect(render()).toBe('');  // no model, no badge
    s().setData({ names: ['a1', 'b1'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5])] }, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] });
    const a = s().addConstruct(0, 0, ['a1']), b = s().addConstruct(1, 0, ['b1']);
    expect(render()).toContain('Not calculated yet');
    expect(render()).toContain('disabled=""');
    calculated();
    const id = (await logCurrentRun())!;
    let html = render();
    expect(html).toContain('class="version-badge current"');
    expect(html).toContain('Model v1</button>');
    s().addPath(a, b);
    html = render();
    expect(html).toContain('class="version-badge edited"');
    expect(html).toContain('Model v1, edited</button>');
    // Clicking goes to the card on the Analyses tab.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<ModelVersionBadge />));
    act(() => host.querySelector('button')!.click());
    expect(useAnalyses.getState().selected).toBe(id);
    expect(s().workspace).toBe('analyses');
    act(() => root.unmount());
    host.remove();
  });
});
