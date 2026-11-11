// Categorical exogenous variables in PLS-SEM (Henseler 2021; ADANCO): a
// categorical column becomes k − 1 dummy variables (the first category is the
// reference) forming a Mode B composite, so its effect is that of the group
// membership. Done on the data and the specification, so every PLS engine and
// analysis (built-in, cSEM, seminr, bootstrap) treats it alike.

import type { Dataset, ModelSpec } from './types';

/** The categories of a column: its sorted distinct values, labelled by the text categories when it has them. */
export function categoriesOf(
  data: Dataset,
  column: string,
): { values: number[]; labels: string[] } {
  const col = data.cols[data.names.indexOf(column)];
  const values = col
    ? [...new Set(Array.from(col).filter((v) => !Number.isNaN(v)))].sort((a, b) => a - b)
    : [];
  const text = data.categories?.[column];
  return {
    values,
    labels: values.map((v) =>
      text && Number.isInteger(v) && text[v - 1] !== undefined ? text[v - 1] : String(v),
    ),
  };
}

/** Dummy columns for the categorical constructs (single-indicator constructs marked categorical), and the specification using them. */
export function expandCategorical(
  data: Dataset,
  spec: ModelSpec,
): { data: Dataset; spec: ModelSpec } {
  const cat = spec.constructs.filter((c) => c.categorical && c.indicators.length === 1);
  if (!cat.length || (data.moments && data.cols.length === 0)) return { data, spec };
  const names = [...data.names],
    cols = [...data.cols];
  const dummies = new Map<string, string[]>();
  for (const c of cat) {
    const column = c.indicators[0];
    const src = data.cols[data.names.indexOf(column)];
    if (!src) continue;
    const { values, labels } = categoriesOf(data, column);
    const made: string[] = [];
    values.slice(1).forEach((v, i) => {
      let name = `${column}: ${labels[i + 1]}`,
        k = 2;
      while (names.includes(name)) name = `${column}: ${labels[i + 1]} (${k++})`;
      names.push(name);
      const dummy = (x: number) => {
        if (Number.isNaN(x)) return NaN;
        return x === v ? 1 : 0;
      };
      cols.push(Float64Array.from(src, dummy));
      made.push(name);
    });
    dummies.set(c.name, made);
  }
  return {
    data: { ...data, names, cols },
    spec: {
      ...spec,
      constructs: spec.constructs.map((c) => {
        const d = dummies.get(c.name);
        if (!d) return c;
        const { categorical: _c, dominant: _d, ...rest } = c;
        return { ...rest, indicators: d, mode: 'B' as const, type: 'composite' as const };
      }),
    },
  };
}
