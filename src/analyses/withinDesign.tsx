// The within-subject design of the repeated-measures cards (rmanova, brmanova): one factor whose levels are wide
// columns (`levels`, `factorName`), or several factors as SPSS's and JASP's "define factors": each factor a name and
// its level names (`factors`), and a wide column per combination of levels (`cells`, the first factor varying slowest).
// One-factor options keep their shape: `factors` and `cells` are present only with two or more factors.

import { OrderedPicker } from '../components/OrderedPicker';
import type { WithinFactor } from '../rengine/tests';
import { ColumnSelect, isObj, name, names } from './common';

export interface WithinDesign { levels: string[]; factorName: string; between: string; factors?: WithinFactor[]; cells?: string[] }

export const MAX_WITHIN_FACTORS = 4;
const FACTOR_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,30}$/;

/** Several within factors (two or more)? */
export const isMulti = (o: Pick<WithinDesign, 'factors'>): boolean => (o.factors?.length ?? 0) >= 2;

/** The design's columns: the cells with several factors, otherwise the levels; and the between factor. */
export const designColumns = (o: WithinDesign): string[] => [...(isMulti(o) ? o.cells ?? [] : o.levels), o.between].filter(Boolean);

/** Every combination of the factors' levels, the first factor varying slowest (the order of `cells`). */
export function cellLabels(factors: WithinFactor[]): string[][] {
  return factors.reduce<string[][]>((acc, f) => acc.flatMap((a) => f.levels.map((l) => [...a, l])), [[]]);
}

/** The design's fields from a project file: the one-factor fields as before, `factors`/`cells` only when there are two or more factors. */
export function parseWithinDesign(raw: Record<string, unknown>): WithinDesign {
  const base = { levels: names(raw.levels), factorName: name(raw.factorName, 31) || 'condition', between: name(raw.between) };
  const fs = (Array.isArray(raw.factors) ? raw.factors.slice(0, MAX_WITHIN_FACTORS) : []).filter(isObj)
    .map((f): WithinFactor => ({ name: name(f.name, 31), levels: (Array.isArray(f.levels) ? f.levels.slice(0, 50) : []).map((l) => name(l, 60)) }));
  if (fs.length < 2) return base;
  const n = cellLabels(fs).length;
  const cells = Array.isArray(raw.cells) ? raw.cells.slice(0, n).map((c) => name(c)) : [];
  return { ...base, factors: fs, cells: [...cells, ...Array<string>(Math.max(0, n - cells.length)).fill('')] };
}

/** What the design still needs (null when it is complete); `reserved`: names a factor cannot take. */
export function withinDesignBlocked(o: WithinDesign, reserved: string[] = []): string | null {
  if (!isMulti(o)) {
    if (o.levels.length < 2) return 'Choose at least two columns, one per level.';
    return o.levels.includes(o.between) ? 'The between factor cannot be one of the levels.' : null;
  }
  const fs = o.factors!;
  if (fs.length > MAX_WITHIN_FACTORS) return `At most ${MAX_WITHIN_FACTORS} within-subject factors.`;
  for (const f of fs) {
    if (!FACTOR_NAME.test(f.name) || ['subject', 'y', ...reserved].includes(f.name)) return `Factor names must start with a letter, use letters, digits, _ or . only, and not be ${['subject', 'y', ...reserved].join(' or ')}.`;
    if (f.levels.length < 2 || f.levels.some((l) => !l.trim()) || new Set(f.levels).size !== f.levels.length) return `Factor ${f.name} needs at least two levels, each with its own name.`;
  }
  if (new Set(fs.map((f) => f.name)).size !== fs.length) return 'The within-subject factors need different names.';
  const cells = o.cells ?? [];
  if (cells.length !== cellLabels(fs).length || cells.some((c) => !c)) return 'Choose a column for every cell of the design.';
  if (new Set(cells).size !== cells.length) return 'Each cell needs its own column.';
  if (cells.includes(o.between)) return 'The between factor cannot be one of the cells.';
  return null;
}

/** The fingerprint parts of the design: the one-factor parts as before (so that results stay current), the factors with several. */
export const withinFingerprint = (o: WithinDesign): string[] => (isMulti(o) ? [o.factors!.map((f) => `${f.name}=${f.levels.join(',')}`).join(';'), ...(o.cells ?? [])] : []);

/** The cells' columns after the factors change: each combination keeps its column where it still exists. */
function remap(old: WithinFactor[], oldCells: string[], next: WithinFactor[]): string[] {
  const at = new Map(cellLabels(old).map((k, i) => [k.join('\u0000'), oldCells[i] ?? '']));
  return cellLabels(next).map((k) => at.get(k.join('\u0000')) ?? '');
}

/** The form: one factor (pick its columns), or several (name the factors and levels, then assign a column to each cell). */
export function WithinDesignForm<T extends WithinDesign>({ o, set, numeric, id }: { o: T; set: (o: T) => void; numeric: string[]; id: string }) {
  if (!isMulti(o)) {
    return (
      <>
        <div className="field"><label htmlFor={`${id}-name`}>Within-subject factor name</label>
          <input id={`${id}-name`} className="input" value={o.factorName} maxLength={31} onChange={(e) => set({ ...o, factorName: e.target.value })} /></div>
        <OrderedPicker label="Levels: one column per condition (wide data)" columns={numeric.filter((n) => n !== o.between)} value={o.levels} onChange={(levels) => set({ ...o, levels })} />
        <button className="btn sm" onClick={() => {
          const first: WithinFactor = { name: o.factorName || 'factor1', levels: o.levels.length >= 2 ? [...o.levels] : ['1', '2'] };
          const factors = [first, { name: 'factor2', levels: ['1', '2'] }];
          // (the first factor's columns stay with its levels at the second factor's first level)
          set({ ...o, factors, cells: cellLabels(factors).map((k) => (k[1] === '1' && o.levels.includes(k[0]) ? k[0] : '')) });
        }}>Add a within-subject factor</button>
        <div className="hint">Each row is one subject measured under every condition. Rows with a missing value are left out. Several within-subject factors (e.g. phase × hour): add a factor, name its levels, then choose the column of each combination.</div>
      </>
    );
  }
  const fs = o.factors!, cells = o.cells ?? [];
  const setFactors = (next: WithinFactor[]) => {
    if (next.length < 2) { set({ ...o, factors: undefined, cells: undefined, factorName: next[0]?.name ?? o.factorName, levels: [] }); return; }
    set({ ...o, factors: next, cells: remap(fs, cells, next) });
  };
  const used = new Set(cells.filter(Boolean));
  return (
    <>
      <div className="field">
        <label>Within-subject factors</label>
        {fs.map((f, i) => (
          <div key={i} className="row2">
            <div className="field"><label htmlFor={`${id}-f${i}`}>Factor {i + 1}</label>
              <input id={`${id}-f${i}`} className="input" value={f.name} maxLength={31} onChange={(e) => setFactors(fs.map((g, k) => (k === i ? { ...g, name: e.target.value } : g)))} /></div>
            <div className="field"><label htmlFor={`${id}-l${i}`}>Levels (comma-separated)</label>
              <input id={`${id}-l${i}`} className="input" value={f.levels.join(', ')} onChange={(e) => setFactors(fs.map((g, k) => (k === i ? { ...g, levels: e.target.value.split(',').map((x) => x.trim()).slice(0, 50) } : g)))} /></div>
            <button className="btn sm ghost" onClick={() => setFactors(fs.filter((_, k) => k !== i))} aria-label={`Remove factor ${f.name || i + 1}`}>Remove</button>
          </div>
        ))}
        {fs.length < MAX_WITHIN_FACTORS && <button className="btn sm" onClick={() => setFactors([...fs, { name: `factor${fs.length + 1}`, levels: ['1', '2'] }])}>Add a factor</button>}
        <div className="hint">As SPSS’s and JASP’s “define factors”: name each factor and its levels, then choose the wide column measured under each combination.</div>
      </div>
      <div className="field">
        <label>Cells: one column per combination</label>
        {cellLabels(fs).map((k, i) => (
          <ColumnSelect key={k.join('\u0000') + i} id={`${id}-c${i}`} label={k.map((l, j) => `${fs[j].name} = ${l}`).join(', ')} value={cells[i] ?? ''}
            columns={numeric.filter((n) => n !== o.between && (n === cells[i] || !used.has(n)))} onChange={(c) => set({ ...o, cells: cells.map((x, j) => (j === i ? c : x)) })} />
        ))}
      </div>
    </>
  );
}
