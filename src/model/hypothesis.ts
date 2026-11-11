// Informative (order-restricted) hypotheses on labelled parameters, for GORICA (restriktor) and Bayes factors (bain):
// one hypothesis per line, its constraints joined by & or ; ("b1 > b2 > 0", "b1 = b2 & b3 > 0"), each side a linear
// combination of labels and numbers (2*b1 - b2 > 0.1); abs(label) compares sizes (GORICA only, as restriktor's
// tutorial does). A strict grammar like expr.ts: the text sent to R is printed from the parsed form, never passed through.

import { nameError } from './expr';

/** One term of a side: [sign][coefficient *] label, abs(label), or a number (name absent). */
export interface HypTerm {
  sign: 1 | -1;
  coef: string;
  name?: string;
  abs?: true;
}
export interface HypConstraint {
  left: HypTerm[];
  op: '<' | '>' | '=';
  right: HypTerm[];
}
export interface Hypothesis {
  text: string;
  constraints: HypConstraint[];
}

const NUM = /^(\d+(\.\d*)?|\.\d+)/;
const MAX_LINE = 500,
  MAX_HYPOTHESES = 10;

type Tok = { k: 'num' | 'name' | 'op'; v: string };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = NUM.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) {
      out.push({ k: 'name', v: name[0] });
      i += name[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '=>' || two === '=<')
      throw new Error(
        'Write > or < (an order hypothesis does not tell ≥ from >), or = for equality.',
      );
    if (two === '==') {
      out.push({ k: 'op', v: '=' });
      i += 2;
      continue;
    }
    if ('+-*()<>='.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(
      `Unexpected “${ch}”: use parameter labels, numbers, + − *, abs( ), and > < = between them.`,
    );
  }
  return out;
}

/** A side: terms joined by + or −; a term is a number, a label or abs(label), with an optional number * before or after. */
function side(ts: Tok[]): HypTerm[] {
  if (!ts.length) throw new Error('A side of a comparison is empty.');
  const out: HypTerm[] = [];
  let p = 0;
  const isOp = (v: string) => ts[p]?.k === 'op' && ts[p].v === v;
  const atom = (): { name: string; abs?: true } | null => {
    const t = ts[p];
    if (t?.k !== 'name') return null;
    if (t.v === 'abs' && ts[p + 1]?.k === 'op' && ts[p + 1].v === '(') {
      const n = ts[p + 2];
      if (n?.k !== 'name' || !(ts[p + 3]?.k === 'op' && ts[p + 3].v === ')'))
        throw new Error('Write abs( ) around one label, as abs(b1).');
      p += 4;
      return { name: n.v, abs: true };
    }
    if (ts[p + 1]?.k === 'op' && ts[p + 1].v === '(')
      throw new Error(`Functions such as “${t.v}(…)” are not allowed; only abs(label).`);
    p++;
    return { name: t.v };
  };
  let sign: 1 | -1 = 1;
  for (;;) {
    while (isOp('+') || isOp('-')) {
      if (ts[p].v === '-') sign = sign === 1 ? -1 : 1;
      p++;
    }
    let coef = '';
    let a: { name: string; abs?: true } | null = null;
    if (ts[p]?.k === 'num') {
      coef = ts[p++].v;
      if (isOp('*')) {
        p++;
        a = atom();
        if (!a) throw new Error('A label must follow “*”.');
      }
    } else {
      a = atom();
      if (!a)
        throw new Error(
          ts[p] ? `Unexpected “${ts[p].v}”.` : 'A side of a comparison ends too early.',
        );
      if (isOp('*')) {
        p++;
        if (ts[p]?.k !== 'num')
          throw new Error('Multiply labels by numbers only (the hypothesis must be linear).');
        coef = ts[p++].v;
      }
    }
    out.push({
      sign,
      coef,
      ...(a ? { name: a.name, ...(a.abs ? { abs: true as const } : {}) } : {}),
    });
    sign = 1;
    if (p >= ts.length) return out;
    if (!(isOp('+') || isOp('-')))
      throw new Error(
        ts[p].v === '(' || ts[p].v === ')'
          ? 'Parentheses are only allowed in abs(label).'
          : ts[p].k === 'name' || ts[p].k === 'num'
            ? `“${ts[p].v}” needs an operator before it (+, −, * or a comparison).`
            : `Unexpected “${ts[p].v}”.`,
      );
  }
}

/** One constraint chain ("b1 > b2 > 0") as its comparisons of neighbouring sides. */
function chain(src: string): HypConstraint[] {
  const ts = tokens(src);
  const sides: Tok[][] = [[]],
    ops: ('<' | '>' | '=')[] = [];
  for (const t of ts) {
    if (t.k === 'op' && (t.v === '<' || t.v === '>' || t.v === '=')) {
      ops.push(t.v);
      sides.push([]);
    } else sides[sides.length - 1].push(t);
  }
  if (!ops.length)
    throw new Error(
      `“${src.trim()}” compares nothing: write for example b1 > b2, b1 > 0 or b1 = b2.`,
    );
  const parsed = sides.map(side);
  const out = ops.map((op, i) => ({ left: parsed[i], op, right: parsed[i + 1] }));
  for (const c of out)
    if (![...c.left, ...c.right].some((t) => t.name))
      throw new Error(`“${src.trim()}” compares numbers only; name a parameter label.`);
  return out;
}

/** The hypotheses of the text (one per non-empty line); throws with a readable message naming the line. */
export function parseHypotheses(text: string): Hypothesis[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error('Write at least one hypothesis, for example b1 > b2 > 0.');
  if (lines.length > MAX_HYPOTHESES) throw new Error(`At most ${MAX_HYPOTHESES} hypotheses.`);
  return lines.map((line, i) => {
    try {
      if (line.length > MAX_LINE) throw new Error('The hypothesis is too long.');
      const parts = line.split(/[&;]/).map((x) => x.trim());
      if (parts.some((x) => !x))
        throw new Error('An & or ; joins two constraints: one is missing.');
      return { text: line, constraints: parts.flatMap(chain) };
    } catch (e) {
      throw new Error(`Hypothesis ${i + 1} (“${line}”): ${(e as Error).message}`, { cause: e });
    }
  });
}

/** The labels a hypothesis names. */
export const hypothesisLabels = (h: Hypothesis): string[] => [
  ...new Set(
    h.constraints.flatMap((c) => [...c.left, ...c.right]).flatMap((t) => (t.name ? [t.name] : [])),
  ),
];
export const usesAbs = (h: Hypothesis) =>
  h.constraints.some((c) => [...c.left, ...c.right].some((t) => t.abs));

const termText = (t: HypTerm, first: boolean) => {
  const body = t.name
    ? `${t.coef ? `${t.coef}*` : ''}${t.abs ? `abs(${t.name})` : t.name}`
    : t.coef;
  return first ? `${t.sign < 0 ? '-' : ''}${body}` : `${t.sign < 0 ? ' - ' : ' + '}${body}`;
};
const sideText = (s: HypTerm[]) => s.map((t, i) => termText(t, i === 0)).join('');
/** A constraint as restriktor and bain read it ("2*b1 - b2 > 0.1", "b1 = b2"). */
export const constraintText = (c: HypConstraint) =>
  `${sideText(c.left)} ${c.op} ${sideText(c.right)}`;

/** Problems with the hypotheses for a model whose labels are `labels` (empty when they can be evaluated); `bain`: no abs(). */
export function hypothesisErrors(text: string, labels: Set<string>, bain: boolean): string[] {
  let hs: Hypothesis[];
  try {
    hs = parseHypotheses(text);
  } catch (e) {
    return [(e as Error).message];
  }
  const errs: string[] = [];
  hs.forEach((h, i) => {
    for (const l of hypothesisLabels(h)) {
      const bad = nameError(l);
      if (bad) errs.push(`Hypothesis ${i + 1}: ${bad}`);
      else if (!labels.has(l))
        errs.push(
          `Hypothesis ${i + 1}: “${l}” is not a parameter label of the model (right-click a path, loading or covariance → Label…).`,
        );
    }
    if (bain && usesAbs(h))
      errs.push(
        `Hypothesis ${i + 1}: bain has no abs(); compare signed parameters, or use GORICA alone.`,
      );
  });
  return errs;
}
