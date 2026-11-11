// @vitest-environment happy-dom
// The report dialog: both formats, every part on by default except the raw
// data, which is only offered when there are cases and is never preselected.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReportDialog, useReportDialog } from '../components/analyses/ReportDialog';
import { useStore } from '../store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  html: string;
  /** The checkboxes: [checked, disabled]. */
  boxes: [boolean, boolean][];
}

/** The rendered dialog (zustand serves only the initial state to server rendering). */
function renderDialog(): Rendered {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<ReportDialog />));
  const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const out: Rendered = {
    html: host.innerHTML,
    boxes: inputs.map((i) => [i.checked, i.disabled]),
  };
  act(() => root.unmount());
  return out;
}

describe('report dialog', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useReportDialog.setState({ open: true });
  });

  it('offers HTML and Word and the parts of the report, the data unticked', () => {
    useStore.setState({ data: { names: ['x'], cols: [Float64Array.from([1, 2])] } });
    const { html, boxes } = renderDialog();
    for (const s of [
      'Export report',
      'HTML',
      'Word (.docx)',
      'Model diagram',
      'Model results',
      'Analysis log',
      'Methods text and references',
      'Software versions',
      'The data',
    ]) {
      expect(html).toContain(s);
    }
    expect(boxes).toHaveLength(6);
    expect(boxes.slice(0, 5).every(([checked]) => checked)).toBe(true);
    expect(boxes[5]).toEqual([false, false]);
    useReportDialog.setState({ open: false });
    expect(renderDialog().html).toBe('');
  });

  it('cannot include data when there are no cases', () => {
    const { boxes } = renderDialog();
    expect(boxes[5]).toEqual([false, true]);
  });
});
