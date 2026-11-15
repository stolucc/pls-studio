// @vitest-environment happy-dom
// The project's data source (raw data or a covariance matrix) is shown quietly
// in the Data panel's heading, its Type row and in Recent projects.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { dataSource } from '../model/dataSource';
import { useStore } from '../store';
import { DataPanel } from './DataPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  const pill = host.querySelector<HTMLElement>('[data-testid="data-source"]');
  const out = pill ? { text: pill.textContent, title: pill.title } : null;
  act(() => root.unmount());
  return out;
}

const raw = { fileName: 'survey.csv', rows: 301, missingCells: 0, excluded: [] };

describe('the data source', () => {
  it('names raw data or a covariance matrix, with the file and n or N', () => {
    expect(dataSource(null)).toBeNull();
    expect(dataSource(raw)).toEqual({ label: 'raw data', detail: 'survey.csv · n = 301' });
    expect(dataSource({ ...raw, fileName: 'kline.txt', rows: 155, kind: 'matrix' })).toEqual({
      label: 'covariance matrix',
      detail: 'kline.txt · N = 155',
    });
    expect(dataSource({ ...raw, kind: 'matrix', hasNacov: true })!.label).toBe(
      'covariance matrix + NACOV',
    );
  });
});

describe("the Data panel's heading", () => {
  beforeEach(() => {
    useStore.getState().newProject();
  });

  it('shows nothing without data', () => {
    expect(render(<DataPanel />)).toBeNull();
  });

  it('shows "raw data" for a dataset of cases', () => {
    useStore
      .getState()
      .setData(
        { names: ['x1', 'x2'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5])] },
        { ...raw, rows: 3 },
      );
    const pill = render(<DataPanel />)!;
    expect(pill.text).toBe(' · raw data');
    expect(pill.title).toContain('survey.csv · n = 3');
  });

  it('shows "covariance matrix" for summary statistics', () => {
    useStore.getState().setData(
      {
        names: ['x1', 'x2'],
        cols: [],
        moments: {
          S: [
            [1, 0.3],
            [0.3, 1],
          ],
          n: 100,
        },
      },
      { fileName: 'm.csv', rows: 100, missingCells: 0, excluded: [], kind: 'matrix' },
    );
    const pill = render(<DataPanel />)!;
    expect(pill.text).toBe(' · covariance matrix');
    expect(pill.title).toContain('summary statistics');
    expect(pill.title).toContain('m.csv · N = 100');
  });
});
