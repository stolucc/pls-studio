// Arithmetic over parameter labels, for defined parameters (lavaan's :=) and
// Wald-test constraints (==). A strict grammar: names, numbers, + - * / ^ and
// parentheses, nothing else (no function calls, strings or assignments). The
// text sent to R is printed from the parsed tree, never passed through.

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'neg'; e: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr };

/** A label or a defined parameter's name: a letter, then letters, digits or underscores. */
export const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const RESERVED = new Set([
  'if',
  'else',
  'repeat',
  'while',
  'function',
  'for',
  'next',
  'break',
  'TRUE',
  'FALSE',
  'NULL',
  'Inf',
  'NaN',
  'NA',
  'in',
  'T',
  'F',
]);

/** Why `name` cannot be a label or defined-parameter name, or null. */
export function nameError(name: string): string | null {
  if (!NAME_RE.test(name))
    return `“${name}” is not a valid name: start with a letter; use letters, digits and _ only (at most 31 characters).`;
  if (RESERVED.has(name)) return `“${name}” is a reserved word in R; choose another name.`;
  return null;
}

type Tok = { k: 'num'; v: number } | { k: 'name'; v: string } | { k: 'op'; v: string };

function tokens(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(src.slice(i));
    if (name) {
      out.push({ k: 'name', v: name[0] });
      i += name[0].length;
      continue;
    }
    if ('+-*/^()'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(
      `Unexpected “${ch}”: use parameter labels, numbers, + − * / ^ and parentheses.`,
    );
  }
  return out;
}

/** Parse an arithmetic expression; throws with a readable message. */
export function parseExpr(src: string): Expr {
  if (src.length > 500) throw new Error('The expression is too long.');
  const ts = tokens(src);
  let p = 0;
  const peek = () => ts[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expr = (): Expr => {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = ts[p++].v as '+' | '-';
      a = { t: 'bin', op, a, b: term() };
    }
    return a;
  };
  const term = (): Expr => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = ts[p++].v as '*' | '/';
      a = { t: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Expr => {
    if (isOp('-')) {
      p++;
      return { t: 'neg', e: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Expr => {
    const a = atom();
    if (isOp('^')) {
      p++;
      return { t: 'bin', op: '^', a, b: unary() };
    }
    return a;
  };
  const atom = (): Expr => {
    const tk = ts[p++];
    if (!tk) throw new Error('The expression ends too early.');
    if (tk.k === 'num') return { t: 'num', v: tk.v };
    if (tk.k === 'name') {
      if (isOp('('))
        throw new Error(
          `Functions such as “${tk.v}(…)” are not allowed; use labels, numbers and arithmetic.`,
        );
      return { t: 'name', v: tk.v };
    }
    if (tk.v === '(') {
      const e = expr();
      if (!isOp(')')) throw new Error('A “)” is missing.');
      p++;
      return e;
    }
    throw new Error(`Unexpected “${tk.v}”.`);
  };
  if (!ts.length) throw new Error('The expression is empty.');
  const e = expr();
  if (p < ts.length) throw new Error(`Unexpected “${(ts[p] as { v: unknown }).v}”.`);
  return e;
}

/** Names used in an expression. */
export function namesIn(e: Expr): string[] {
  const out = new Set<string>();
  const walk = (x: Expr) => {
    if (x.t === 'name') out.add(x.v);
    else if (x.t === 'neg') walk(x.e);
    else if (x.t === 'bin') {
      walk(x.a);
      walk(x.b);
    }
  };
  walk(e);
  return [...out];
}

/** The expression as R / lavaan syntax, fully parenthesised. */
export function exprToR(e: Expr): string {
  switch (e.t) {
    case 'num':
      return Number.isFinite(e.v) ? String(e.v) : '0';
    case 'name':
      return e.v;
    case 'neg':
      return `(-${exprToR(e.e)})`;
    case 'bin':
      return `(${exprToR(e.a)} ${e.op} ${exprToR(e.b)})`;
  }
}

/** A Wald-test hypothesis "left == right". */
/** An inequality constraint "left < right" or "left > right" (lavaan's < and >). */
export function parseInequality(src: string): { left: Expr; op: '<' | '>'; right: Expr } {
  const ops = [...src].filter((ch) => ch === '<' || ch === '>');
  if (ops.length !== 1 || src.includes('='))
    throw new Error(
      'Write an inequality as “expression > expression” or “expression < expression”, for example a > 0 or a < b.',
    );
  const op = ops[0] as '<' | '>';
  const [l, r] = src.split(op);
  return { left: parseExpr(l), op, right: parseExpr(r) };
}

export function parseConstraint(src: string): { left: Expr; right: Expr } {
  const parts = src.split('==');
  if (parts.length !== 2)
    throw new Error(
      'Write a hypothesis as “expression == expression”, for example a == b or a*b == 0.',
    );
  return { left: parseExpr(parts[0]), right: parseExpr(parts[1]) };
}
