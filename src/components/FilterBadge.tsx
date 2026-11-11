// The dataset filter: a badge with its condition and how many cases it keeps
// (shown on the Data panel, the Data tab and the Analyses tab), and the dialog
// that sets, changes or removes it.

import { filterError, filterSummary, setFilter } from '../data/pipeline';
import { useStore } from '../store';
import { IconPencil, IconX } from './icons';
import { formDialog } from './Overlays';

/** Ask for a filter condition and apply it (or change the current one). */
export async function editFilter() {
  const s = useStore.getState();
  const { data, dataInfo: info } = s;
  if (!data || !info) return;
  const current = info.filter?.expr ?? '';
  const values = await formDialog({
    title: current ? 'Change the data filter' : 'Filter the data',
    body:
      'Only the cases where the condition is true are analysed, by every card and the model; ' +
      'cases where it is false or missing are left out (and come back when the filter is ' +
      'removed). The condition is a formula as for computed columns: comparisons (<, >=, ==, !=), ' +
      'and, or, not, functions; a text column against a category in quotes. Computed columns ' +
      'are computed over all cases, before the filter.',
    confirmLabel: current ? 'Apply' : 'Filter',
    fields: [
      {
        label: 'Keep the cases where',
        initial: current,
        placeholder: 'e.g. age >= 18 and group == 2',
        hint: 'Examples: age >= 18, gender == "female", not isna(income), x1 > 1 or x2 > 1.',
        check: (text) => filterError(text, data),
      },
    ],
  });
  if (!values) return;
  applyFilter(values[0]);
}

/** Set or remove (null) the filter of the open dataset, with a message saying what it keeps. */
export function applyFilter(expr: string | null) {
  const s = useStore.getState();
  if (!s.data || !s.dataInfo) return;
  try {
    const r = setFilter(s.data, s.dataInfo, expr);
    s.setData(r.data, r.info);
    const f = filterSummary(r.info);
    if (f) s.toast('success', `Filter ${f.expr}: ${f.kept} of ${f.total} cases kept.`);
    else s.toast('success', 'The filter is removed: every case is analysed.');
  } catch (e) {
    s.toast('error', (e as Error).message);
  }
}

/** The filter's condition and the cases it keeps; with buttons to change or remove it. */
export function FilterBadge({ actions = true }: { actions?: boolean }) {
  const info = useStore((s) => s.dataInfo);
  const f = info ? filterSummary(info) : null;
  if (!f) return null;
  return (
    <span
      className="filter-badge"
      role="status"
      title={`Only the cases where ${f.expr} are analysed`}
    >
      <span className="filter-label">Filter</span>
      <code>{f.expr}</code>
      <span>
        {f.kept} of {f.total} cases
      </span>
      {actions && (
        <>
          <button
            className="btn icon ghost sm"
            onClick={() => void editFilter()}
            aria-label="Change the filter"
            title="Change the filter"
          >
            <IconPencil size={12} />
          </button>
          <button
            className="btn icon ghost sm"
            onClick={() => applyFilter(null)}
            aria-label="Remove the filter"
            title="Remove the filter: analyse every case"
          >
            <IconX size={12} />
          </button>
        </>
      )}
    </span>
  );
}
