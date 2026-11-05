// The reshapes some examples apply after loading their data (source.ts, Reshape): the data as the example's source
// analyses them, computed from the downloaded file rather than shipped.

import type { Dataset } from '../../engine/types';
import type { Reshape } from './source';

const column = (d: Dataset, name: string) => {
  const i = d.names.indexOf(name);
  if (i < 0) throw new Error(`The data have no column ${name}.`);
  return d.cols[i];
};

/** The reshaped data: id and period (or repetition) first, then the long columns, then the others in their order. */
export function reshape(d: Dataset, r: Reshape): Dataset {
  const n = d.cols[0]?.length ?? 0;
  if (r.kind === 'personPeriod') {
    const events = r.events.map((e) => column(d, e));
    const others = d.names.filter((k) => !r.events.includes(k));
    const rows: { i: number; p: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < events.length; p++) {
        const v = events[p][i];
        if (Number.isNaN(v)) break;
        rows.push({ i, p, v });
        if (v === 1) break;
      }
    }
    const cols = [Float64Array.from(rows, (x) => x.i + 1), Float64Array.from(rows, (x) => x.p + 1), Float64Array.from(rows, (x) => x.v),
      ...others.map((k) => { const c = column(d, k); return Float64Array.from(rows, (x) => c[x.i]); })];
    return { ...d, names: [r.id, r.period, r.event, ...others], cols };
  }
  const t = r.wide[0]?.length ?? 0;
  if (r.wide.length !== r.long.length || r.wide.some((w) => w.length !== t)) throw new Error('Each long column needs a set of wide columns, all of the same length.');
  const wide = r.wide.map((w) => w.map((k) => column(d, k)));
  const used = new Set(r.wide.flat());
  const others = d.names.filter((k) => !used.has(k));
  const at = (c: Float64Array) => Float64Array.from({ length: n * t }, (_, j) => c[Math.floor(j / t)]);
  const cols = [Float64Array.from({ length: n * t }, (_, j) => Math.floor(j / t) + 1), Float64Array.from({ length: n * t }, (_, j) => j % t),
    ...wide.map((w) => Float64Array.from({ length: n * t }, (_, j) => w[j % t][Math.floor(j / t)])),
    ...others.map((k) => at(column(d, k)))];
  return { ...d, names: [r.id, r.repetition, ...r.long, ...others], cols };
}
