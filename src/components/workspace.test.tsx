// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyModel, resultsKey, useStore } from '../store';
import { DataWorkspace } from './DataViewer';
import { TopBar, WorkspaceTabs } from './TopBar';
import { Inspector } from './Inspector';
import { AnalysesWorkspace } from './analyses/AnalysesWorkspace';
import { addAnalysis, addText, loadCards, setTitle, useAnalyses } from '../analyses/store';

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

  it('show the estimation method and the diagram-estimates toggle on the Model tab only', () => {
    expect(render(<TopBar />)).toContain('aria-label="Estimation method"');
    for (const w of ['data', 'analyses'] as const) {
      s().setWorkspace(w);
      const html = render(<TopBar />);
      expect(html).not.toContain('aria-label="Estimation method"');
      expect(html).not.toContain('estimates on the diagram');
      expect(html).toContain('Calculate');
    }
  });

  it('mark the current tab as selected', () => {
    const html = () => render(<WorkspaceTabs />);
    expect(html()).toMatch(/id="ws-tab-model" aria-selected="true"/);
    expect(html()).toMatch(/id="ws-tab-data" aria-selected="false"/);
    expect(html()).toMatch(/id="ws-tab-analyses" aria-selected="false"[^>]*aria-controls="ws-analyses"/);
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

describe('Analyses tab', () => {
  beforeEach(() => { s().newProject(); loadCards([]); useAnalyses.setState({ results: {}, errors: {} }); });

  it('explains itself when empty', () => {
    const html = render(<AnalysesWorkspace />);
    expect(html).toContain('No analyses yet');
    expect(html).toContain('+ Add analysis');
  });

  it('shows the cards in order, with the selected card’s options', () => {
    addText('heading', 'Necessary conditions');
    const id = addAnalysis('nca', { source: 'data', x: ['x1'], y: 'x2', permutations: 100 })!;
    const html = render(<AnalysesWorkspace />);
    expect(html.indexOf('Necessary conditions</h2>')).toBeLessThan(html.indexOf('Necessary condition analysis</h3>'));
    expect(html).toContain('not run');
    expect(html).toContain('x1 → x2 · 100 permutations');
    expect(html).toContain(`id="${id}"`);
    // The outline lists both, draggable, the selected one marked.
    expect(html).toMatch(new RegExp(`<a href="#${id}" class="sel" draggable="true"`));
    expect(html).toContain('Drag the entries to reorder the cards.');
    // Selected (just added): its options are in the pane, blocked without data.
    expect(html).toContain('Import raw data first.');
    expect(html).toMatch(/NCA needs raw data/);
  });

  it('shows a renamed card’s title on the card, in the outline and in the options pane', () => {
    const id = addAnalysis('nca', { source: 'data', x: ['x1'], y: 'x2', permutations: 100 })!;
    let html = render(<AnalysesWorkspace />);
    // Before renaming: the analysis name, an empty Title field with it as placeholder, a Rename button.
    expect(html).toContain('Necessary condition analysis</h3>');
    const field = html.match(/<input id="title-card-[^"]+"[^>]*>/)?.[0] ?? '';
    expect(field).toContain('placeholder="Necessary condition analysis"');
    expect(field).toContain('value=""');
    expect(field).toContain('maxlength="80"');
    expect(html).toContain('aria-label="Rename"');
    setTitle(id, 'Ceiling check, wave 1');
    html = render(<AnalysesWorkspace />);
    expect(html).toContain('Ceiling check, wave 1</h3>');
    expect(html).not.toContain('Necessary condition analysis</h3>');
    expect(html).toMatch(new RegExp(`<a href="#${id}"[^>]*>(<span[^>]*>[^<]*</span>)*Ceiling check, wave 1</a>`));
    expect(html).toContain('<h2>Ceiling check, wave 1</h2>');
    expect(html.match(/<input id="title-card-[^"]+"[^>]*>/)?.[0]).toContain('value="Ceiling check, wave 1"');
  });

  it('renames as you type: the card and the outline follow each keystroke, before the field is left', () => {
    const id = addAnalysis('nca', { source: 'data', x: ['x1'], y: 'x2', permutations: 100 })!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<AnalysesWorkspace />));
    const input = host.querySelector<HTMLInputElement>(`#title-${id}`)!;
    const type = (text: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type('Ceiling ');
    // The field keeps the trailing space (so the next word can be typed); the store holds the tidied title.
    expect(input.value).toBe('Ceiling ');
    expect((useAnalyses.getState().cards[0] as { title?: string }).title).toBe('Ceiling');
    type('Ceiling check');
    expect(host.innerHTML).toContain('Ceiling check</h3>');
    expect(host.innerHTML).toMatch(new RegExp(`<a href="#${id}"[^>]*>(<span[^>]*>[^<]*</span>)*Ceiling check</a>`));
    type('');
    expect(host.innerHTML).toContain('Necessary condition analysis</h3>');
    act(() => root.unmount());
    host.remove();
  });

  it('shows a model run as the current model, then as an earlier version with a way to open it once the model changes', async () => {
    const st = s();
    st.setData({ names: ['a1', 'a2', 'b1'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5]), Float64Array.from([1, 3, 2])] }, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] });
    const a = st.addConstruct(0, 0, ['a1', 'a2']), b = st.addConstruct(200, 0, ['b1']);
    st.addPath(a, b);
    useStore.setState((x) => ({ results: { pls: { n: 3, converged: true, iterations: 2 } as never, cb: null, miiv: null, boot: null, fitTest: null, key: resultsKey(x) } }));
    const { logCurrentRun } = await import('../analyses/runs');
    expect(await logCurrentRun()).toBeTruthy();
    let html = render(<AnalysesWorkspace />);
    expect(html).toContain('Model v1</h3>');
    expect(html).toContain('current model</span>');
    expect(html).toContain('>Open model</button>');  // every run has it: for the current one it just goes to the Model tab
    expect(html).toMatch(/<button class="outline-open" title="Open this version of the model on the Model tab" aria-label="Open Model v1 on the Model tab">↗<\/button>/);
    // The top bar's Calculate on the Analyses tab with the run selected: opens it and calculates.
    s().setWorkspace('analyses');
    expect(render(<TopBar />)).toContain('title="Open Model v1 on the Model tab and calculate it');
    s().removePaths([s().model.paths[0].id]);
    html = render(<AnalysesWorkspace />);
    expect(html).toContain('earlier version</span>');
    expect(html).toContain('>Open model</button>');
    expect(html).toMatch(/<span class="dot earlier"/);
    // With an analysis card selected, the button runs that card.
    addAnalysis('nca', { source: 'data', x: ['a1'], y: 'b1', permutations: 0 });
    expect(render(<TopBar />)).toMatch(/title="Run the selected card: Necessary condition analysis \([^"]+\)">[^]*?Run<\/button>/);
  });

  it('marks a result whose data changed as stale, with a way to rerun it', () => {
    s().setData({ names: ['x1', 'x2'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([1, 3, 2])] }, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] });
    const opts = { source: 'data', x: ['x1'], y: 'x2', permutations: 0 };
    const id = addAnalysis('nca', opts)!;
    const options = JSON.stringify(opts);
    useAnalyses.setState((st) => ({ cards: st.cards.map((c) => (c.kind === 'analysis' ? { ...c, run: { at: 1, fingerprint: 'old', options } } : c)), results: { [id]: { y: 'x2', permutations: 0, conditions: [{ x: 'x1', n: 3, scope: [1, 3, 1, 3], ceFdh: 0.25, crFdh: 0.2, intercept: null, slope: null, accuracy: null, p: null, peers: { x: [1], y: [1] }, points: { x: [1], y: [1] }, bottleneck: [{ y: 0, ceFdh: null, crFdh: null }] }], warnings: [] } } }));
    const html = render(<AnalysesWorkspace />);
    expect(html).toContain('The data it used changed since this ran.');
    expect(html).toContain('Run again');
    s().setWorkspace('model');
    expect(render(<WorkspaceTabs />)).toMatch(/Analyses<span class="badge"[^>]*>1</);
  });
});

describe('workspace layout', () => {
  it('keeps the Inspector between 250 and 300 px wide', () => {
    expect(css).toMatch(/--inspector-w:\s*clamp\(250px,\s*[\d.]+vw,\s*300px\)/);
    expect(rule('.workspace')).toMatch(/grid-template-columns:\s*264px minmax\(0, 1fr\) var\(--inspector-w\)/);
  });

  it('keeps top-bar controls at their size, letting the project name give way', () => {
    expect(rule('.tb-group > .btn, .tb-group > .sep, .tb-group > .menu, .tb-group > .segmented')).toMatch(/flex:\s*none/);
    expect(rule('.topbar')).toMatch(/grid-template-columns:\s*minmax\(max-content, 1fr\) auto minmax\(max-content, 1fr\)/);
    expect(rule('.segmented.workspace-tabs')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule('.topbar .project-name')).toMatch(/flex:\s*0 1 auto/);
  });

  it('puts File, the tabs and undo/redo on the left, and the project name in the centre', () => {
    const html = render(<TopBar />);
    const left = html.slice(html.indexOf('tb-left'), html.indexOf('tb-center'));
    const at = (s: string) => left.indexOf(s);
    expect(at('file-menu')).toBeGreaterThan(0);
    expect(at('workspace-tabs')).toBeGreaterThan(at('file-menu'));
    expect(at('aria-label="Undo"')).toBeGreaterThan(at('workspace-tabs'));
    expect(at('aria-label="Redo"')).toBeGreaterThan(at('aria-label="Undo"'));
    expect(html.slice(html.indexOf('tb-center'), html.indexOf('tb-right'))).toContain('aria-label="Project name"');
    expect(html.slice(html.indexOf('tb-right'))).toContain('href="guide.html" target="_blank" rel="noopener"');
    // the Example chip or unsaved dot sits over symmetric padding, so it never shifts the name
    expect(rule('.tb-center .example-pill, .tb-center .dirty-dot')).toMatch(/position:\s*absolute/);
    expect(rule('.tb-center.has-example')).toMatch(/padding:\s*0 150px/);
  });

  it('lays the Data tab over the diagram and Inspector, which stay in their own columns', () => {
    expect(rule('.data-workspace')).toMatch(/grid-column:\s*2 \/ 4/);
    expect(rule('.workspace > .data-col')).toMatch(/grid-area:\s*1 \/ 1/);
    expect(rule('.analyses-workspace')).toMatch(/grid-column:\s*1 \/ 4/);
    expect(rule('.workspace > .center')).toMatch(/grid-area:\s*1 \/ 2/);
    expect(rule('.workspace > .inspector-col')).toMatch(/grid-area:\s*1 \/ 3/);
  });
});

describe('analyses layout', () => {
  it('keeps the Add analysis bar in view while the cards scroll', () => {
    expect(rule('.log-bar')).toContain('position: sticky');
    expect(rule('.log-bar')).toContain('top: 0');
    expect(rule('.card-log')).toContain('overflow: auto');
  });
});

describe('weighting controls', () => {
  it('the per-construct outer weights are named as such and hidden when cSEM weights every construct globally; the global control says it applies to all', () => {
    s().newProject();
    const id = s().addConstruct(0, 0, ['x1', 'x2']);
    s().select('construct', id);
    s().setSettings({ method: 'pls', engine: 'r', plsPackage: 'cSEM', plsApproach: 'PLS-PM' });
    let html = render(<Inspector />);
    expect(html).toContain('Outer weights (this construct)');
    s().setSettings({ plsApproach: 'GSCA' });
    expect(render(<Inspector />)).not.toContain('Outer weights (this construct)');
    s().setSettings({ plsPackage: 'seminr' });
    expect(render(<Inspector />)).toContain('Outer weights (this construct)');
    // The global control sits with the model's settings (nothing selected), cSEM only.
    useStore.setState({ selection: { nodes: [], edges: [] } });
    s().setSettings({ plsPackage: 'cSEM' });
    html = render(<Inspector />);
    expect(html).toContain('Weighting approach (all constructs, cSEM)');
    s().setSettings({ plsPackage: 'seminr' });
    expect(render(<Inspector />)).not.toContain('Weighting approach (all constructs');
  });
});

describe('the example pill', () => {
  it('says what clicking it does', () => {
    useStore.setState({ example: 'lavaan-hs' });
    const html = render(<TopBar />);
    expect(html).toContain('>Save example as project</button>');
    useStore.setState({ example: null });
    expect(render(<TopBar />)).not.toContain('example-pill');
  });
});

// (zustand serves its initial state to server rendering, so these render on the client, as the other tests here do)
describe('the Groups section and the invariance tab with covariance-matrix data', () => {
  it('explain that a covariance matrix has no groups instead of hiding the section or asking for a column', async () => {
    const { GroupsEditor } = await import('./GroupsEditor');
    const { CbTab } = await import('./results/CbTabs');
    useStore.getState().newProject();
    useStore.getState().setData({ names: ['x1', 'x2'], cols: [], moments: { S: [[1, 0.3], [0.3, 1]], n: 100 } }, { fileName: 'm.csv', rows: 100, missingCells: 0, excluded: [], kind: 'matrix' });
    expect(render(<GroupsEditor />)).toContain('this dataset is a covariance matrix');
    const inv = render(<CbTab tab="invariance" cb={{} as never} boot={null} />);
    expect(inv).toContain('covariance matrix (one sample, no cases)');
    expect(inv).not.toContain('Choose a grouping column');
    useStore.getState().setData({ names: ['x1', 'x2', 'g'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([3, 4, 5]), Float64Array.from([1, 2, 1])] }, { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] });
    expect(render(<GroupsEditor />)).toContain('Groups by g');
    expect(render(<CbTab tab="invariance" cb={{} as never} boot={null} />)).toContain('Choose a grouping column under Groups');
  });
});
