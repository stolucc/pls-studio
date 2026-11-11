// The Data tab's Variables view (as SPSS's Variable View): per column its type,
// measurement level and value labels, editable.

import {
  labelsToText,
  MEASUREMENT_LEVELS,
  parseLabelsText,
  setVariableInfo,
  suggestedLevel,
  valueLabels,
  variableInfo,
  type MeasurementLevel,
} from '../data/columns';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { useStore } from '../store';
import { IconPencil } from './icons';
import { formDialog } from './Overlays';

/** Ask for a numeric column's value labels (one per line) and store them. */
export async function editValueLabels(name: string) {
  const s = useStore.getState();
  if (!s.data || !s.dataInfo) return;
  const values = await formDialog({
    title: `Value labels of ${name}`,
    body:
      'One value per line with its label, e.g. 1 = Strongly disagree. Analyses that show ' +
      'categories (contingency tables, groups of t-tests and ANOVA, binomial tests) name them by ' +
      'their labels. Leave empty to remove the labels.',
    confirmLabel: 'Save labels',
    fields: [
      {
        label: 'Labels',
        multiline: true,
        initial: labelsToText(valueLabels(s.dataInfo, name)),
        placeholder: '1 = Strongly disagree\n5 = Strongly agree',
        check: (text) => {
          try {
            parseLabelsText(text);
            return null;
          } catch (e) {
            return (e as Error).message;
          }
        },
      },
    ],
  });
  if (!values) return;
  const fresh = useStore.getState();
  if (!fresh.data || !fresh.dataInfo) return;
  const labels = parseLabelsText(values[0]);
  fresh.setData(fresh.data, setVariableInfo(fresh.dataInfo, name, { labels }));
}

/** Set a column's measurement level ('' goes back to the suggested one). */
function setLevel(name: string, level: MeasurementLevel | '') {
  const s = useStore.getState();
  if (!s.data || !s.dataInfo) return;
  s.setData(s.data, setVariableInfo(s.dataInfo, name, { level: level || null }));
}

function typeOf(data: Dataset, info: DataInfo, name: string): string {
  if (data.categories?.[name]) return `text (${data.categories[name].length} categories)`;
  if ((info.computed ?? []).some((c) => c.name === name)) return 'numeric (computed)';
  return 'numeric';
}

/** The table of variables, filtered by name. */
export function VariablesView({
  data,
  info,
  shown,
}: {
  data: Dataset;
  info: DataInfo;
  shown: (readonly [string, number])[];
}) {
  return (
    <div className="data-grid-wrap">
      <table className="data-grid variables-grid">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Type</th>
            <th>Measurement level</th>
            <th>Value labels</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(([name]) => {
            const set = variableInfo(info, name)?.level;
            const labels = valueLabels(info, name);
            const text = !!data.categories?.[name];
            return (
              <tr key={name}>
                <td className="text">{name}</td>
                <td className="text">{typeOf(data, info, name)}</td>
                <td className="text">
                  <select
                    className="select"
                    aria-label={`Measurement level of ${name}`}
                    value={set ?? ''}
                    onChange={(e) => setLevel(name, e.target.value as MeasurementLevel | '')}
                  >
                    <option value="">auto: {suggestedLevel(data, name)}</option>
                    {MEASUREMENT_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text">
                  {text ? (
                    <span className="muted">
                      {data.categories![name].map((l, k) => `${k + 1} = ${l}`).join(', ')}
                    </span>
                  ) : (
                    <span className="labels-cell">
                      <span>
                        {labels.length
                          ? labels.map((l) => `${l.value} = ${l.label}`).join(', ')
                          : '—'}
                      </span>
                      <button
                        className="btn icon ghost sm"
                        onClick={() => void editValueLabels(name)}
                        aria-label={`Edit the value labels of ${name}`}
                        title="Edit the value labels"
                      >
                        <IconPencil size={12} />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        Levels: nominal (unordered categories), ordinal (ordered categories, e.g. Likert items),
        scale (numbers). “auto” is what the values suggest; a level you set is kept with the project
        and suggests ordinal indicators for CB-SEM (Model tab, Estimator).
      </p>
    </div>
  );
}
