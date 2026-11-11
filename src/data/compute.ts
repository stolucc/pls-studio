// Computed columns: a new variable from a formula over existing columns
// (log(income), (x1 + x2) / 2, z(score), ifelse(age >= 18, 1, 0)). A strict
// grammar evaluated here, vectorised over rows; missing values propagate.
// DataInfo.computed keeps each column's formula, so it can be edited and
// recomputed (after restoring excluded cases, for instance).

import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'col'; name: string }
  | { t: 'un'; op: '-' | '!'; e: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

/** Row-wise functions (any number of arguments where sensible) and column-wise transforms. */
export const FUNCTIONS: Record<string, { arity: [number, number]; doc: string }> = {
  log: { arity: [1, 1], doc: 'natural logarithm' },
  log10: { arity: [1, 1], doc: 'logarithm base 10' },
  log2: { arity: [1, 1], doc: 'logarithm base 2' },
  exp: { arity: [1, 1], doc: 'exponential' },
  sqrt: { arity: [1, 1], doc: 'square root' },
  abs: { arity: [1, 1], doc: 'absolute value' },
  round: { arity: [1, 2], doc: 'round(x, digits)' },
  floor: { arity: [1, 1], doc: 'round down' },
  ceiling: { arity: [1, 1], doc: 'round up' },
  min: { arity: [1, Infinity], doc: 'smallest of the values in the row' },
  max: { arity: [1, Infinity], doc: 'largest of the values in the row' },
  sum: { arity: [1, Infinity], doc: 'sum of the values in the row' },
  mean: { arity: [1, Infinity], doc: 'mean of the values in the row' },
  ifelse: { arity: [3, 3], doc: 'ifelse(condition, value if true, value if false)' },
  isna: { arity: [1, 1], doc: '1 when missing, else 0' },
  z: { arity: [1, 1], doc: 'standardised: (x − mean) / sd over the rows' },
  center: {
    arity: [1, 2],
    doc: 'mean-centred over the rows; center(x, g): within the groups of g (group-mean centring)',
  },
  rank: { arity: [1, 1], doc: 'rank over the rows (1 = smallest; ties averaged)' },
  lag: {
    arity: [1, 2],
    doc: 'lag(x, k): the value k rows earlier (default 1; missing in the first k rows), for a time series in row order',
  },
};
export const MAX_FORMULA = 500;
export const MAX_NAME = 64;

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'name'; v: string; quoted?: true }
  | { k: 'op'; v: string };

/** Words that read as the logical operators: `age >= 18 and group == 2`. */
const WORD_OPS: Record<string, string> = { and: '&', or: '|', not: '!' };
const OPS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '^',
  '(',
  ')',
  ',',
  '<',
  '>',
  '&',
  '|',
  '!',
];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '`') {
      const j = src.indexOf('`', i + 1);
      if (j < 0) throw new Error('A name opened with ` is not closed.');
      out.push({ k: 'name', v: src.slice(i + 1, j), quoted: true });
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // A category of a text column, compared with == or != (no escapes: a quote ends it).
      const j = src.indexOf(ch, i + 1);
      if (j < 0) throw new Error(`A text opened with ${ch} is not closed.`);
      out.push({ k: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (name) {
      const word = WORD_OPS[name[0]];
      if (word) out.push({ k: 'op', v: word });
      else out.push({ k: 'name', v: name[0] });
      i += name[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      // (R's && and || read as & and |: a formula works on whole columns)
      let canonical = op;
      if (op === '&&') canonical = '&';
      else if (op === '||') canonical = '|';
      out.push({ k: 'op', v: canonical });
      i += op.length;
      continue;
    }
    throw new Error(`Unexpected character “${ch}” in the formula.`);
  }
  return out;
}

/** How many arguments a function takes, for an error message: "1 argument", "at least 2 arguments", "2 to 3 arguments". */
function argumentCountText([min, max]: readonly [number, number]): string {
  let count: string;
  if (min === max) count = `${min}`;
  else if (max === Infinity) count = `at least ${min}`;
  else count = `${min} to ${max}`;
  const plural = min === 1 && max === 1 ? '' : 's';
  return `${count} argument${plural}`;
}

/** Parse a formula; throws with a readable message. */
export function parseFormula(src: string): Node {
  if (src.trim() === '') throw new Error('Enter a formula.');
  if (src.length > MAX_FORMULA)
    throw new Error(`The formula is too long (at most ${MAX_FORMULA} characters).`);
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const take = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected “${v}” in the formula.`);
    p++;
  };
  const or = (): Node => {
    let a = and();
    while (isOp('|')) {
      p++;
      a = { t: 'bin', op: '|', a, b: and() };
    }
    return a;
  };
  const and = (): Node => {
    let a = cmp();
    while (isOp('&')) {
      p++;
      a = { t: 'bin', op: '&', a, b: cmp() };
    }
    return a;
  };
  const cmp = (): Node => {
    let a = add();
    while (['<', '<=', '>', '>=', '==', '!='].some(isOp)) {
      const op = peek().v as string;
      p++;
      a = { t: 'bin', op, a, b: add() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = peek().v as string;
      p++;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = peek().v as string;
      p++;
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { t: 'un', op: '-', e: unary() };
    }
    if (isOp('!')) {
      p++;
      return { t: 'un', op: '!', e: unary() };
    }
    return pow();
  };
  const pow = (): Node => {
    const a = primary();
    if (isOp('^')) {
      p++;
      return { t: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new Error('The formula ends too early.');
    if (t.k === 'num') {
      p++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'str') {
      p++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'name') {
      p++;
      if (isOp('(')) {
        const f = FUNCTIONS[t.v];
        if (!f)
          throw new Error(
            `Unknown function “${t.v}”. Available: ${Object.keys(FUNCTIONS).join(', ')}.`,
          );
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) {
            p++;
            args.push(or());
          }
        }
        take(')');
        if (args.length < f.arity[0] || args.length > f.arity[1])
          throw new Error(`${t.v}() takes ${argumentCountText(f.arity)}.`);
        return { t: 'call', fn: t.v, args };
      }
      // NA: a missing value (as in R), e.g. ifelse(x == -99, NA, x); `NA` in backticks is a column.
      if (t.v === 'NA' && !t.quoted) return { t: 'num', v: NaN };
      return { t: 'col', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = or();
      take(')');
      return e;
    }
    throw new Error(`Unexpected “${t.v}” in the formula.`);
  };
  const node = or();
  if (p < toks.length) throw new Error(`Unexpected “${toks[p].v}” after the end of the formula.`);
  return node;
}

/** The column names a formula reads. */
export function columnsIn(node: Node, out = new Set<string>()): string[] {
  if (node.t === 'col') out.add(node.name);
  else if (node.t === 'un') columnsIn(node.e, out);
  else if (node.t === 'bin') {
    columnsIn(node.a, out);
    columnsIn(node.b, out);
  } else if (node.t === 'call') node.args.forEach((a) => columnsIn(a, out));
  return [...out];
}

/** A value as a truth value (as R): missing stays missing, any non-zero is true (1), zero is false (0). */
function bool(v: number): number {
  if (Number.isNaN(v)) return NaN;
  return v !== 0 ? 1 : 0;
}

/**
 * A text column compared with a category in quotes (`country == "Ireland"`): 1 where the row's
 * category is (or for != is not) the one named, missing where the row is missing. Null when the
 * node is not such a comparison.
 */
function categoryComparison(nd: Extract<Node, { t: 'bin' }>, data: Dataset): Float64Array | null {
  if (nd.op !== '==' && nd.op !== '!=') return null;
  let column: Node = nd.a;
  let text: Node = nd.b;
  if (nd.a.t === 'str') {
    column = nd.b;
    text = nd.a;
  }
  if (text.t !== 'str') return null;
  if (column.t !== 'col' || !data.categories?.[column.name])
    throw new Error(`“${text.v}”: text in quotes can only be compared with a text column.`);
  const j = data.names.indexOf(column.name);
  if (j < 0) throw new Error(`“${column.name}” is not a column of the dataset.`);
  // Codes are 1-based positions in the column's categories; an unknown category matches no row.
  const code = data.categories[column.name].indexOf(text.v) + 1;
  const equal = nd.op === '==';
  return data.cols[j].map((v) => {
    if (Number.isNaN(v)) return NaN;
    return (v === code) === equal ? 1 : 0;
  });
}

/** Evaluate a formula over the rows of `data`; missing values give missing results. */
export function evaluate(node: Node, data: Dataset): Float64Array {
  const n = data.cols[0]?.length ?? 0;
  const col = (name: string) => {
    const j = data.names.indexOf(name);
    if (j < 0) throw new Error(`“${name}” is not a column of the dataset.`);
    if (data.categories?.[name])
      throw new Error(`“${name}” is a text column; formulas use numeric columns.`);
    return data.cols[j];
  };
  const ev = (nd: Node): Float64Array => {
    switch (nd.t) {
      case 'num':
        return new Float64Array(n).fill(nd.v);
      case 'str':
        throw new Error(
          `“${nd.v}”: text in quotes can only be compared with a text column (== or !=).`,
        );
      case 'col':
        return col(nd.name);
      case 'un': {
        const e = ev(nd.e);
        if (nd.op === '-') return e.map((v) => -v);
        return e.map((v) => {
          if (Number.isNaN(v)) return NaN;
          return v === 0 ? 1 : 0;
        });
      }
      case 'bin': {
        const category = categoryComparison(nd, data);
        if (category) return category;
        const a = ev(nd.a),
          b = ev(nd.b),
          out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const x = a[i],
            y = b[i];
          // Three-valued logic as in R: a true side decides an |, a false side an &; otherwise missing stays missing.
          if (nd.op === '|') {
            if (bool(x) === 1 || bool(y) === 1) out[i] = 1;
            else if (Number.isNaN(x) || Number.isNaN(y)) out[i] = NaN;
            else out[i] = 0;
            continue;
          }
          if (nd.op === '&') {
            if (bool(x) === 0 || bool(y) === 0) out[i] = 0;
            else if (Number.isNaN(x) || Number.isNaN(y)) out[i] = NaN;
            else out[i] = 1;
            continue;
          }
          if (Number.isNaN(x) || Number.isNaN(y)) {
            out[i] = NaN;
            continue;
          }
          switch (nd.op) {
            case '+':
              out[i] = x + y;
              break;
            case '-':
              out[i] = x - y;
              break;
            case '*':
              out[i] = x * y;
              break;
            case '/':
              out[i] = y === 0 ? NaN : x / y;
              break;
            case '^':
              out[i] = x ** y;
              break;
            case '<':
              out[i] = +(x < y);
              break;
            case '<=':
              out[i] = +(x <= y);
              break;
            case '>':
              out[i] = +(x > y);
              break;
            case '>=':
              out[i] = +(x >= y);
              break;
            case '==':
              out[i] = +(x === y);
              break;
            case '!=':
              out[i] = +(x !== y);
              break;
          }
          if (!Number.isFinite(out[i])) out[i] = NaN;
        }
        return out;
      }
      case 'call': {
        const args = nd.args.map(ev);
        const one = (f: (v: number) => number) =>
          args[0].map((v) => {
            const r = Number.isNaN(v) ? NaN : f(v);
            return Number.isFinite(r) ? r : NaN;
          });
        const across = (f: (vs: number[]) => number) => {
          const out = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            const vs = args.map((a) => a[i]);
            out[i] = vs.some(Number.isNaN) ? NaN : f(vs);
          }
          return out;
        };
        switch (nd.fn) {
          case 'log':
            return one(Math.log);
          case 'log10':
            return one(Math.log10);
          case 'log2':
            return one(Math.log2);
          case 'exp':
            return one(Math.exp);
          case 'sqrt':
            return one(Math.sqrt);
          case 'abs':
            return one(Math.abs);
          case 'floor':
            return one(Math.floor);
          case 'ceiling':
            return one(Math.ceil);
          case 'round': {
            const d = args[1] ? args[1][0] : 0;
            const k = 10 ** (Number.isFinite(d) ? Math.round(d) : 0);
            return one((v) => Math.round(v * k) / k);
          }
          case 'min':
            return across((vs) => Math.min(...vs));
          case 'max':
            return across((vs) => Math.max(...vs));
          case 'sum':
            return across((vs) => vs.reduce((s, v) => s + v, 0));
          case 'mean':
            return across((vs) => vs.reduce((s, v) => s + v, 0) / vs.length);
          case 'ifelse': {
            const [c, a, b] = args,
              out = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              if (Number.isNaN(c[i])) out[i] = NaN;
              else out[i] = c[i] !== 0 ? a[i] : b[i];
            }
            return out;
          }
          case 'isna':
            return args[0].map((v) => (Number.isNaN(v) ? 1 : 0));
          case 'z':
          case 'center': {
            if (nd.fn === 'center' && args[1]) {
              // Group-mean centring: each value less the mean of its group (rows where x or g is missing are missing).
              const x = args[0],
                g = args[1],
                sum = new Map<number, [number, number]>();
              for (let i = 0; i < n; i++)
                if (!Number.isNaN(x[i]) && !Number.isNaN(g[i])) {
                  const a = sum.get(g[i]) ?? [0, 0];
                  a[0] += x[i];
                  a[1]++;
                  sum.set(g[i], a);
                }
              return x.map((v, i) => {
                const a = sum.get(g[i]);
                return Number.isNaN(v) || !a ? NaN : v - a[0] / a[1];
              });
            }
            const x = args[0],
              ok = Array.from(x).filter((v) => !Number.isNaN(v));
            const m = ok.reduce((s, v) => s + v, 0) / ok.length;
            const sd =
              ok.length > 1
                ? Math.sqrt(ok.reduce((s, v) => s + (v - m) ** 2, 0) / (ok.length - 1))
                : NaN;
            return x.map((v) => {
              if (Number.isNaN(v)) return NaN;
              if (nd.fn === 'center') return v - m;
              return sd > 0 ? (v - m) / sd : NaN;
            });
          }
          case 'lag': {
            const k = args[1] ? args[1][0] : 1;
            if (!(Number.isInteger(k) && k >= 1 && k < 1e6))
              throw new Error('lag(x, k): k must be a whole number of rows, 1 or more.');
            const x = args[0];
            return x.map((_, i) => (i >= k ? x[i - k] : NaN));
          }
          case 'rank': {
            const x = args[0],
              idx = Array.from(x)
                .map((v, i) => [v, i] as const)
                .filter(([v]) => !Number.isNaN(v))
                .sort((a, b) => a[0] - b[0]);
            const out = new Float64Array(n).fill(NaN);
            for (let i = 0; i < idx.length; ) {
              let j = i;
              while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
              const r = (i + j) / 2 + 1;
              for (let k = i; k <= j; k++) out[idx[k][1]] = r;
              i = j + 1;
            }
            return out;
          }
        }
        throw new Error(`Unknown function “${nd.fn}”.`);
      }
    }
  };
  return ev(node);
}

/** Why `name` cannot be a new column's name (given the columns in use), or null. */
export function nameError(
  name: string,
  data: Dataset,
  info: DataInfo,
  replacing?: string,
): string | null {
  if (!name.trim()) return 'Give the new column a name.';
  if (name.length > MAX_NAME) return `The name is too long (at most ${MAX_NAME} characters).`;
  if (/[`\s]/.test(name) && !/^\S.*\S$/.test(name))
    return 'The name cannot start or end with a space.';
  if (name.includes('`')) return 'The name cannot contain a backtick.';
  if (name !== replacing && data.names.includes(name))
    return (info.computed ?? []).some((c) => c.name === name)
      ? `“${name}” is already a computed column: select it to edit its formula.`
      : `“${name}” is already a column.`;
  return null;
}

/** Add (or, for a computed column, replace) a column computed from `expr`. */
export function computeColumn(
  data: Dataset,
  info: DataInfo,
  name: string,
  expr: string,
): { data: Dataset; info: DataInfo } {
  if (data.moments && data.cols.length === 0)
    throw new Error('Computed columns need raw data; this dataset is a covariance matrix.');
  const computed = [...(info.computed ?? [])];
  const existing = computed.findIndex((c) => c.name === name);
  const bad = nameError(name, data, info, existing >= 0 ? name : undefined);
  if (bad) throw new Error(bad);
  const node = parseFormula(expr);
  for (const c of columnsIn(node)) {
    if (c === name) throw new Error('A column cannot be computed from itself.');
    if (!data.names.includes(c)) throw new Error(`“${c}” is not a column of the dataset.`);
    // A computed column may use columns computed before it (they are recomputed in order).
    const k = computed.findIndex((x) => x.name === c);
    if (k >= 0 && existing >= 0 && k >= existing)
      throw new Error(
        `“${c}” is computed after “${name}”; a formula can use only columns computed before it.`,
      );
  }
  const values = evaluate(node, data);
  const j = data.names.indexOf(name);
  const names = j >= 0 ? data.names : [...data.names, name];
  const cols = j >= 0 ? data.cols.map((c, i) => (i === j ? values : c)) : [...data.cols, values];
  if (existing >= 0) computed[existing] = { name, expr: expr.trim() };
  else computed.push({ name, expr: expr.trim() });
  const next: Dataset = { ...data, names, cols };
  return { data: next, info: { ...info, computed, missingCells: countMissing(next) } };
}

/** Recompute every computed column in order (after the rows changed). */
export function recomputeAll(data: Dataset, info: DataInfo): { data: Dataset; info: DataInfo } {
  let out = { data, info };
  for (const c of info.computed ?? []) {
    if (!out.data.names.includes(c.name)) continue;
    try {
      out = computeColumn(out.data, out.info, c.name, c.expr);
    } catch {
      /* a column it used is gone: the values stay as they are */
    }
  }
  return out;
}

/** Drop a computed column and its formula. */
export function removeComputed(
  data: Dataset,
  info: DataInfo,
  name: string,
): { data: Dataset; info: DataInfo } {
  const j = data.names.indexOf(name);
  if (j < 0 || !(info.computed ?? []).some((c) => c.name === name))
    throw new Error(`“${name}” is not a computed column.`);
  if (info.filter && columnsIn(parseFormula(info.filter.expr)).includes(name))
    throw new Error(`“${name}” is used by the data filter; change or remove the filter first.`);
  const used = (info.computed ?? [])
    .filter((c) => c.name !== name && columnsIn(parseFormula(c.expr)).includes(name))
    .map((c) => c.name);
  if (used.length)
    throw new Error(
      `“${name}” is used by ${used.join(', ')}; remove ${used.length === 1 ? 'that column' : 'those columns'} first.`,
    );
  const next: Dataset = {
    ...data,
    names: data.names.filter((_, i) => i !== j),
    cols: data.cols.filter((_, i) => i !== j),
  };
  const computed = (info.computed ?? []).filter((c) => c.name !== name);
  // (its level and value labels go with it)
  const variables = (info.variables ?? []).filter((v) => v.name !== name);
  const { computed: _c, variables: _v, ...rest } = info;
  return {
    data: next,
    info: {
      ...rest,
      ...(computed.length ? { computed } : {}),
      ...(variables.length ? { variables } : {}),
      missingCells: countMissing(next),
    },
  };
}

const countMissing = (d: Dataset) => d.cols.reduce((s, c) => s + c.filter(Number.isNaN).length, 0);
