// @vitest-environment happy-dom
// Every element the guided tour points at exists: the app's panels are rendered with the tour's
// example loaded and calculated, and each step's data-tour target (and each results tab a step
// clicks) must be among them. A renamed or removed element fails here, not in front of a user.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ReactFlowProvider } from '@xyflow/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { analysisType } from '../../analyses/registry';
import { currentCtx, loadCards, useAnalyses } from '../../analyses/store';
import { bootstrapPls } from '../../engine/bootstrap';
import { estimatePls } from '../../engine/pls';
import { toSpec } from '../../model/project';
import { useR } from '../../rengine/status';
import { makeSample } from '../../sample';
import { resultsKey, useStore } from '../../store';
import { AnalysesWorkspace } from '../analyses/AnalysesWorkspace';
import { Canvas } from '../Canvas';
import { DataPanel } from '../DataPanel';
import { DataWorkspace } from '../DataViewer';
import { HomeScreen } from '../HomeScreen';
import { Inspector } from '../Inspector';
import { ResultsPanel } from '../ResultsPanel';
import { RStatusPill } from '../RStatusPill';
import { TopBar } from '../TopBar';
import { ValidationPage } from '../validation/ValidationPage';
import { TOUR, tourTargets } from './steps';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // (React Flow measures its container)
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** The tour's example, calculated and bootstrapped by the built-in engine. */
function loadCalculatedExample() {
  const s = useStore.getState();
  const { data, info, model } = makeSample();
  s.loadProject({
    name: 'Customer experience example',
    model,
    settings: { ...s.settings, method: 'pls', engine: 'r' },
    data,
    info,
    example: 'customer',
  });
  const st = useStore.getState();
  const spec = toSpec(st.model);
  const pls = estimatePls(st.data!, spec);
  const boot = bootstrapPls(st.data!, spec, {}, { samples: 20, seed: 1, confidence: 0.95 });
  st.setResults({ pls, boot }, resultsKey(st));
  const run = analysisType('run')!;
  const checklist = analysisType('checklist')!;
  loadCards([
    { id: 'card-run', kind: 'analysis', type: 'run', options: run.defaults(currentCtx()) },
    {
      id: 'card-check',
      kind: 'analysis',
      type: 'checklist',
      options: checklist.defaults(currentCtx()),
    },
  ]);
  useAnalyses.setState({ selected: 'card-check' });
}

/** Render, run `then` (clicks), and return every data-tour value on the page. */
function tourAttributes(el: React.ReactElement, then?: (host: HTMLElement) => void): Set<string> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  if (then) act(() => then(host));
  const found = new Set(
    [...host.querySelectorAll('[data-tour]')].map((e) => e.getAttribute('data-tour')!),
  );
  act(() => root.unmount());
  host.remove();
  return found;
}

const click = (host: HTMLElement, key: string) =>
  host.querySelector<HTMLElement>(`[data-tour="${key}"]`)?.click();

describe('the tour’s targets', () => {
  it('has unique step ids and 35 to 60 steps in ten chapters', () => {
    const ids = TOUR.flatMap((c) => c.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOUR.length).toBe(10);
    expect(ids.length).toBeGreaterThanOrEqual(35);
    expect(ids.length).toBeLessThanOrEqual(60);
    for (const c of TOUR) {
      expect(c.steps.length, c.id).toBeGreaterThan(0);
      for (const s of c.steps) {
        expect(s.title.length, s.id).toBeGreaterThan(3);
        if (s.task) expect(s.task.prompt, s.id).toMatch(/\*\*/);
      }
    }
  });

  it('finds every step’s element in the rendered app, with the example calculated', () => {
    const found = new Set<string>();
    const add = (set: Set<string>) => set.forEach((k) => found.add(k));

    useStore.getState().setView('home');
    add(tourAttributes(<HomeScreen />));

    loadCalculatedExample();
    useStore.getState().setSelectedVars(['SQ1']);
    useR.setState({ status: 'ready' });
    add(tourAttributes(<TopBar />));
    add(tourAttributes(<DataPanel />));
    add(
      tourAttributes(
        <ReactFlowProvider>
          <Canvas onImport={() => {}} />
        </ReactFlowProvider>,
      ),
    );
    add(tourAttributes(<Inspector />));
    add(tourAttributes(<RStatusPill />));
    add(
      tourAttributes(<ResultsPanel height={320} onResize={() => {}} />, (host) =>
        click(host, 'results-tab-fit'),
      ),
    );
    add(tourAttributes(<AnalysesWorkspace />));
    add(tourAttributes(<DataWorkspace />, (host) => click(host, 'data-tab-variables')));
    add(tourAttributes(<ValidationPage onBack={() => {}} />));

    // (where R runs shows for the R engine only: the example is rendered with engine "r")
    expect(tourTargets().filter((k) => !found.has(k))).toEqual([]);
  });

  it('names targets that are data-tour attributes in the app’s source', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        // (the tour's own content and helpers name the targets: they do not count)
        const tourContent = /tour[/\\](steps|actions|engine)\.ts$/.test(p);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\./.test(name) && !tourContent) files.push(p);
      }
    };
    walk(join(process.cwd(), 'src'));
    const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const key of tourTargets()) {
      const literal =
        source.includes(`data-tour="${key}"`) ||
        source.includes(`'${key}'`) ||
        (key.startsWith('results-tab-') && source.includes('data-tour={`results-tab-${t.id}`}'));
      expect(literal, key).toBe(true);
    }
  });
});
