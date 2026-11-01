// @vitest-environment happy-dom
// A new project's empty canvas speaks for every method, and the side panels wrap
// long file and column names instead of running off the panel.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { Canvas } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // (React Flow measures its container)
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

function renderCanvas() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<ReactFlowProvider><Canvas onImport={() => {}} onSample={() => {}} /></ReactFlowProvider>));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}

describe('a new project', () => {
  it('opens on a method-neutral card for PLS-SEM, CB-SEM and CPA alike', () => {
    for (const method of ['pls', 'cbsem'] as const) {
      useStore.getState().newProject();
      useStore.getState().setSettings({ method });
      const html = renderCanvas();
      expect(html, method).toContain('Start your model');
      expect(html, method).not.toMatch(/Build a PLS|PLS path model/);
      expect(html, method).toContain('PLS-SEM, CB-SEM or conditional process analysis');
      expect(html, method).toContain('Import data');
      expect(html, method).toContain('CSV, SPSS, Stata or Excel');
    }
  });
});

describe('side panels', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, k]) => k.trim() === sel).map(([, , body]) => body).join(';');
  it('wrap long names and let their rows shrink instead of overflowing sideways', () => {
    expect(rule('.panel')).toMatch(/min-width:\s*0/);
    expect(rule('.panel-body')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.panel-body')).toMatch(/overflow-x:\s*hidden/);
    expect(rule('.panel-head')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.selection-bar')).toMatch(/flex-wrap:\s*wrap/);
    // (a grid column of 1fr cannot shrink below its content: the file name needs minmax(0, 1fr))
    expect(rule('.data-meta')).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\)/);
    expect(rule('.var .vname')).toMatch(/min-width:\s*0/);
    // The empty panel's drop zone: one column that cannot grow past the panel, and buttons (example names) that wrap.
    expect(rule('.dropzone')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.dropzone > *')).toMatch(/max-width:\s*100%/);
    expect(rule('.panel .btn')).toMatch(/white-space:\s*normal/);
    // The header's buttons stay one line each and their row wraps (Inspect, Compute…, Replace).
    expect(rule('.panel-actions')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.panel-head .btn')).toMatch(/white-space:\s*nowrap/);
  });
});
