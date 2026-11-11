import { useMemo, useSyncExternalStore } from 'react';
import { PACKAGE_EXAMPLES, type ExpectedMessage } from '../examples/packages';
import { useStore } from '../store';
import { estimationKey } from '../validation/exampleState';
import { EXAMPLES } from './HomeScreen';
import { IconInfo, IconX } from './icons';

/** What an example shows (PackageExample.shows, or a built-in example's), by its id; undefined for no example. */
export function exampleShows(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return (
    PACKAGE_EXAMPLES.find((e) => e.id === id)?.shows ?? EXAMPLES.find((e) => e.id === id)?.shows
  );
}

/** The messages an example is expected to raise (PackageExample.expectedMessages); built-in examples expect none. */
export function exampleExpectedMessages(
  id: string | null | undefined,
): ExpectedMessage[] | undefined {
  return id ? PACKAGE_EXAMPLES.find((e) => e.id === id)?.expectedMessages : undefined;
}

// The examples whose banner was hidden: remembered in this browser (a convenience only; the banner comes back
// where storage is unavailable).
const DISMISSED_KEY = 'ps.exampleBanner.dismissed';
function readDismissed(): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(DISMISSED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeDismissed(ids: string[]) {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    /* storage blocked: hidden for this session only */
  }
}
let dismissed = new Set(readDismissed());
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const changedDismissed = () => {
  version++;
  for (const l of listeners) l();
};

/** Hide the banner of an example (every place it shows), remembered in this browser. */
export function dismissExampleBanner(id: string) {
  dismissed.add(id);
  writeDismissed([...dismissed]);
  changedDismissed();
}

/** Show every example banner again. */
export function resetExampleBanners() {
  dismissed = new Set();
  writeDismissed([]);
  changedDismissed();
}

/**
 * While an example is open: what it shows, from its `shows` text, on the Model tab (floating over the diagram) and
 * on the Analyses tab (above the log). Hidden per example with its close button. Once the model, settings or data
 * change, it says that it describes the example as it opened.
 */
export function ExampleBanner({ where }: { where: 'model' | 'analyses' }) {
  const example = useStore((s) => s.example);
  const baseline = useStore((s) => s.exampleBaseline);
  const model = useStore((s) => s.model);
  const settings = useStore((s) => s.settings);
  const dataVersion = useStore((s) => s.dataVersion);
  useSyncExternalStore(subscribe, () => version);
  const text = exampleShows(example);
  const changed = useMemo(
    () => !!example && !!baseline && estimationKey(model, settings, dataVersion) !== baseline,
    [example, baseline, model, settings, dataVersion],
  );
  if (!example || !text || dismissed.has(example)) return null;
  return (
    <aside className={`example-banner ${where}`} aria-label="What this example shows">
      <IconInfo size={14} />
      <div className="example-banner-text">
        <b>What this example shows:</b> {text}
        {changed && (
          <span className="example-banner-changed">
            {' '}
            (Describes the example as it opened; the model, settings or data have changed since.)
          </span>
        )}
      </div>
      <button
        className="btn sm ghost"
        onClick={() => dismissExampleBanner(example)}
        aria-label="Hide what this example shows"
        title="Hide for this example"
      >
        <IconX size={13} />
      </button>
    </aside>
  );
}
