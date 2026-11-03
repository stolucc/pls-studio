// @vitest-environment happy-dom
// The validation record in the app: the dialog lists what the tests recorded, grouped and graded, with every
// comparison; the results badge of an example holds only while what is estimated is unchanged.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../../model/project';
import { estimationKey } from '../../validation/exampleState';
import { resetEvidence } from '../../validation/useEvidence';
import type { Evidence } from '../../validation/types';
import { useStore } from '../../store';
import { ValidationPage } from './ValidationPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evidence: Evidence = {
  generated: '2026-11-03', webR: '0.6.0', R: '4.6', versions: { lavaan: '0.7-3' },
  checks: [
    { id: 'mplus-ex5.25', subject: 'example', title: 'x', method: 'CB-SEM', level: 'published', packages: ['lavaan'], passed: true, test: 'examples/mplus: ex5.25',
      sources: [{ label: 'Mplus User’s Guide, example 5.25', level: 'published' }],
      comparisons: [{ quantity: 'χ²', value: 51.3531, reference: 51.353, tolerance: 0.002, source: 'Mplus User’s Guide, example 5.25' }, { quantity: 'unexpected R warnings and notes', value: 0, reference: 0, tolerance: 0 }] },
    { id: 'csem-switching', subject: 'example', title: 'y', method: 'PLS-SEM', level: 'runs', packages: ['cSEM'], passed: true, test: 'examples/packages', sources: [],
      comparisons: [{ quantity: 'unexpected R warnings and notes', value: 0, reference: 0, tolerance: 0 }] },
    { id: 'rengine/esem::bifactor', subject: 'feature', title: 'Exploratory SEM and bifactor rotations: bifactor', method: 'CB-SEM', level: 'native', packages: ['lavaan'], passed: true, test: 't',
      sources: [{ label: 'desktop lavaan', script: 'scripts/validation/bifactor.R' }], comparisons: [{ quantity: 'value 1', value: 0.5, reference: 0.5, tolerance: 5e-5 }] },
  ],
};

let host: HTMLDivElement;
beforeEach(() => {
  resetEvidence();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => evidence })));
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => { vi.unstubAllGlobals(); host.remove(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('ValidationPage', () => {
  it('summarises the record, groups the examples by method and opens one’s comparisons', async () => {
    act(() => { createRoot(host).render(<ValidationPage onBack={() => {}} focus="mplus-ex5.25" titles={{}} />); });
    await flush();
    const text = host.textContent!;
    expect(text).toContain('4 comparisons in 3 checks, all passed');
    expect(text).toContain('CB-SEM');
    expect(text).toContain('PLS-SEM');
    expect(text).toContain('Reproduces published results');
    // The focused example is open: its comparisons, the reference and what each was compared against.
    expect(text).toContain('51.3531');
    expect(text).toContain('Mplus User’s Guide, example 5.25');
    // The methods tab lists the feature checks.
    act(() => { [...host.querySelectorAll('button[role="tab"]')].find((b) => b.textContent === 'Methods')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.textContent).toContain('Exploratory SEM and bifactor rotations');
  });
});

describe('ValidationPage without a record', () => {
  it('says the record is not available (a missing file: the dev server answers with its HTML page)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), json: async () => { throw new Error('not JSON'); } })));
    act(() => { createRoot(host).render(<ValidationPage onBack={() => {}} />); });
    await flush();
    expect(host.textContent).toContain('The validation record is not available in this copy of PLS Studio yet.');
    expect(host.textContent).not.toContain('Loading the validation record');
  });
});

describe('the validation view', () => {
  it('opens at an example and goes back where it was opened from', () => {
    const s = () => useStore.getState();
    s().setView('editor');
    s().openValidation('mplus-ex5.25');
    expect([s().view, s().validationFocus, s().validationReturn]).toEqual(['validation', 'mplus-ex5.25', 'editor']);
    s().closeValidation();
    expect([s().view, s().validationFocus]).toEqual(['editor', null]);
    s().setView('home');
    s().openValidation();
    s().closeValidation();
    expect(s().view).toBe('home');
  });
  it('has a back button saying where it goes', async () => {
    let back = 0;
    act(() => { createRoot(host).render(<ValidationPage onBack={() => { back++; }} backLabel="Home" />); });
    await flush();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '← Home')!;
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(back).toBe(1);
  });
});

describe('estimationKey', () => {
  const model: ModelState = { constructs: [{ id: 'A', name: 'A', x: 0, y: 0, indicators: ['a1', 'a2'], mode: 'A', type: 'factor' } as never, { id: 'B', name: 'B', x: 100, y: 0, indicators: ['b1', 'b2'], mode: 'A', type: 'factor' } as never], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] };
  it('ignores the layout and the figure, not the model, the estimation settings or the data', () => {
    const k = estimationKey(model, DEFAULT_SETTINGS, 1);
    expect(estimationKey({ ...model, constructs: model.constructs.map((c) => ({ ...c, x: c.x + 40 })) }, { ...DEFAULT_SETTINGS, figure: { ...DEFAULT_SETTINGS.figure, fontSize: 30 } }, 1)).toBe(k);
    expect(estimationKey({ ...model, paths: [] }, DEFAULT_SETTINGS, 1)).not.toBe(k);
    expect(estimationKey(model, { ...DEFAULT_SETTINGS, consistent: !DEFAULT_SETTINGS.consistent }, 1)).not.toBe(k);
    expect(estimationKey(model, DEFAULT_SETTINGS, 2)).not.toBe(k);
  });
});
