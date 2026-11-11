// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { emptyModel, useStore } from '../store';
import { ConstraintsEditor } from './ConstraintsEditor';
import { GroupsEditor } from './GroupsEditor';

const s = () => useStore.getState();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe('held and labelled parameters in the panels', () => {
  it('lists them in Constraints, each with a button that frees it', () => {
    useStore.setState({ model: emptyModel(), past: [], future: [] });
    const f = s().addConstruct(0, 0, ['y1', 'y2', 'y3']);
    s().setHeldParameter({ kind: 'variance', target: f }, { fixed: 1 });
    s().setHeldParameter({ kind: 'intercept', target: 'y2', indicator: true }, { label: 'i2' });
    const { host, unmount } = mount(<ConstraintsEditor />);
    const name = s().model.constructs[0].name;
    expect(host.textContent).toContain(`Variance of ${name}held at 1`);
    expect(host.textContent).toContain('Intercept of y2label i2');
    act(() =>
      (
        host.querySelector(
          `button[aria-label="Estimate Variance of ${name} freely"]`,
        ) as HTMLButtonElement
      ).click(),
    );
    expect(s().model.parameters).toHaveLength(1);
    unmount();
  });

  it('offer Mplus’s free ordinal scales across groups with ordinal indicators and equal thresholds', () => {
    const col = (f: (i: number) => number) => Float64Array.from({ length: 60 }, (_, i) => f(i));
    useStore.setState({
      model: emptyModel(),
      past: [],
      future: [],
      data: {
        names: ['u1', 'u2', 'u3', 'g'],
        cols: [
          col((i) => i % 3),
          col((i) => i % 2),
          col((i) => i % 4),
          col((i) => (i < 30 ? 1 : 2)),
        ],
      },
    });
    s().addConstruct(0, 0, ['u1', 'u2', 'u3']);
    s().setMultigroup({ column: 'g', invariance: 'scalar', free: [] });
    expect(mount(<GroupsEditor />).host.textContent).not.toContain('Free the ordinal scales');
    s().setOrdered(['u1', 'u2', 'u3'], true);
    const { host, unmount } = mount(<GroupsEditor />);
    expect(host.textContent).toContain('Free the ordinal scales after the first group');
    const box = [...host.querySelectorAll('label.check')]
      .find((l) => l.textContent?.includes('Free the ordinal scales'))!
      .querySelector('input') as HTMLInputElement;
    act(() => box.click());
    expect(s().model.multigroup!.ordinalScales).toBe('free');
    unmount();
    useStore.setState({ data: null });
  });
});
