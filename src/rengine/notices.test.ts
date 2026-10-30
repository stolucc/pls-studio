import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { reportRWarnings } from './notices';

describe('R warnings reach Messages from every call', () => {
  beforeEach(() => useStore.setState({ messages: [] }));
  it('logs each warning once, with the package as source; a result logged again soon after is not duplicated', () => {
    reportRWarnings({ warnings: ['Item fit (ltm::item.fit) could not be computed: singular', 'Item fit (ltm::item.fit) could not be computed: singular'], engine: { package: 'ltm', version: '1.2' } }, 'ltm');
    reportRWarnings({ warnings: 'one warning' }, 'psych');
    reportRWarnings({ value: 1 }, 'psych');
    const m = useStore.getState().messages;
    expect(m.map((x) => [x.text, x.source, x.level])).toEqual([
      ['Item fit (ltm::item.fit) could not be computed: singular', 'ltm 1.2', 'warning'],
      ['one warning', 'psych', 'warning'],
    ]);
    // setResults logs a main result's warnings too: not twice.
    useStore.getState().setResults({ cb: { warnings: ['one warning'] } as never }, 'k');
    expect(useStore.getState().messages).toHaveLength(2);
  });
});
