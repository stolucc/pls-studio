// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyModel, useStore } from '../store';
import { DataWorkspace } from './DataViewer';
import { WorkspaceTabs } from './TopBar';

const s = () => useStore.getState();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders with the store's current state (server rendering would read zustand's initial state). */
function render(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}
const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** All declarations for a selector, across the stylesheet (media blocks included). */
const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, k]) => k.trim() === sel).map(([, , body]) => body).join(';');

describe('workspace tabs', () => {
  beforeEach(() => s().newProject());

  it('start on the diagram; opening or starting a project returns there', () => {
    expect(s().workspace).toBe('model');
    s().setWorkspace('data');
    s().loadProject({ name: 'Other', model: emptyModel(), settings: s().settings, data: null, info: null });
    expect(s().workspace).toBe('model');
    s().setWorkspace('data');
    s().newProject();
    expect(s().workspace).toBe('model');
  });

  it('mark the current tab as selected', () => {
    const html = () => render(<WorkspaceTabs />);
    expect(html()).toMatch(/id="ws-tab-model" aria-selected="true"/);
    expect(html()).toMatch(/id="ws-tab-data" aria-selected="false"/);
    s().setWorkspace('data');
    expect(html()).toMatch(/id="ws-tab-data" aria-selected="true"[^>]*aria-controls="ws-data"/);
  });
});

describe('Data tab', () => {
  beforeEach(() => s().newProject());

  it('says how to get a dataset when there is none', () => {
    const html = render(<DataWorkspace />);
    expect(html).toContain('id="ws-data"');
    expect(html).toContain('No dataset yet');
  });

  it('shows the rows of the dataset, with missing values as NA', () => {
    s().setData(
      { names: ['x1', 'x2'], cols: [Float64Array.from([1, 2.5, 3]), Float64Array.from([4, Number.NaN, 6])] },
      { fileName: 'demo.csv', rows: 3, missingCells: 1, excluded: [] },
    );
    const html = render(<DataWorkspace />);
    expect(html).toContain('demo.csv · 3 rows · 2 variables');
    expect(html).toContain('<th title="x1">x1</th>');
    expect(html).toContain('<span class="na">NA</span>');
    expect(html).toContain('rows 1–3 of 3');
  });
});

describe('workspace layout', () => {
  it('keeps the Inspector between 250 and 300 px wide', () => {
    expect(css).toMatch(/--inspector-w:\s*clamp\(250px,\s*[\d.]+vw,\s*300px\)/);
    expect(rule('.workspace')).toMatch(/grid-template-columns:\s*264px minmax\(0, 1fr\) var\(--inspector-w\)/);
  });

  it('keeps top-bar controls at their size, letting the project name give way', () => {
    expect(rule('.topbar > .btn, .topbar > .sep, .topbar > .menu, .topbar > .segmented, .topbar > .example-badge')).toMatch(/flex:\s*none/);
    expect(rule('.segmented.workspace-tabs')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule('.topbar .project-name')).toMatch(/flex:\s*0 1 auto/);
  });

  it('lays the Data tab over the diagram and Inspector, which stay in their own columns', () => {
    expect(rule('.data-workspace')).toMatch(/grid-column:\s*2 \/ 4/);
    expect(rule('.workspace > .panel.left')).toMatch(/grid-area:\s*1 \/ 1/);
    expect(rule('.workspace > .center')).toMatch(/grid-area:\s*1 \/ 2/);
    expect(rule('.workspace > .inspector-col')).toMatch(/grid-area:\s*1 \/ 3/);
  });
});
