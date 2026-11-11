// Free-format data as CSV: the Mplus User's Guide examples (an input exN.M.inp naming the variables, the missing-value
// code and the .dat file) and other whitespace-separated files. A port of scripts/validation/mplus_data.py, kept
// byte-for-byte equal to its output (convert.test.ts compares the two on every cached example). Read as Mplus reads
// free format: a stream of values, one record per len(NAMES) values whatever the line breaks; a file with one record
// per line and more columns than NAMES keeps the first len(NAMES) (the generating class, which the input leaves out).
//
// Pure, with no imports: the browser converts downloads with it, and scripts/validation/fetch_example_data.mjs (run
// by Node directly) fills the test cache with it.

/** The commands an Mplus input can have (the statements under any other label are dropped, as mplus_data.py does). */
const COMMANDS = new Set([
  'TITLE',
  'DATA',
  'VARIABLE',
  'ANALYSIS',
  'MODEL',
  'OUTPUT',
  'SAVEDATA',
  'PLOT',
  'DEFINE',
  'MONTECARLO',
  'MODEL POPULATION',
  'MODEL CONSTRAINT',
  'MODEL INDIRECT',
  'MODEL TEST',
  'MODEL PRIORS',
  'DATA WIDETOLONG',
  'DATA MISSING',
  'DATA IMPUTATION',
  'DATA TWOPART',
  'DATA SURVIVAL',
  'MODEL MISSING',
  'MODEL COVERAGE',
]);

/** A file decoded as ISO-8859-1, byte for byte (TextDecoder's "latin1" is windows-1252, which is not). */
export function latin1(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

// Python's text mode and str methods on a latin-1 string: universal newlines, str.split() (whitespace is what
// str.isspace says, \x1c-\x1f, \x85 and \xa0 included) and str.splitlines().
const universal = (s: string) => s.replace(/\r\n?/g, '\n');
const SP = '[\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0]';
const WS = new RegExp(`${SP}+`);
const pySplit = (s: string) => s.split(WS).filter((t) => t !== '');
const pyStrip = (s: string) => s.replace(new RegExp(`^${SP}+|${SP}+$`, 'g'), '');
// eslint-disable-next-line no-control-regex -- (Python counts these control characters as line breaks)
const LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c-\x1e\x85]/;
const pySplitLines = (s: string) => {
  const out = s.split(LINE_BREAK);
  if (out.length && out[out.length - 1] === '') out.pop();
  return out;
};
/** Python's float(): undefined where it raises (only finite values matter: they are compared with missing-value codes). */
function pyFloat(v: string): number | undefined {
  const d = '\\d(?:_?\\d)*';
  if (new RegExp(`^[+-]?(?:${d}(?:\\.(?:${d})?)?|\\.${d})(?:[eE][+-]?${d})?$`).test(v))
    return Number(v.replace(/_/g, ''));
  if (/^[+-]?(?:inf|infinity|nan)$/i.test(v)) return NaN;
  return undefined;
}

/** The input's statements, comments removed, keyed by command (DATA, VARIABLE, ...). */
export function mplusStatements(inp: string): Record<string, string> {
  const s = inp.replace(/\r/g, '').replace(/!.*/g, '');
  const out: Record<string, string> = {};
  let cmd: string | null = null;
  for (const part of s.split(new RegExp(`^${SP}*([A-Z ]+):`, 'gim'))) {
    if (cmd !== null) {
      out[cmd] = (out[cmd] ?? '') + part;
      cmd = null;
    } else if (COMMANDS.has(pyStrip(part).toUpperCase())) cmd = pyStrip(part).toUpperCase();
  }
  return out;
}

/** An option's value: `NAME IS|ARE|= value;`. */
export function mplusOption(block: string | undefined, name: string): string | null {
  const m = new RegExp(`\\b${name}${SP}*(?:IS|ARE|=)${SP}*([^;]*);`, 'is').exec(block ?? '');
  return m ? pyStrip(m[1]) : null;
}

/** Mplus list notation: y1-y6 is y1 ... y6; a31-a34 is a31 ... a34; y1a-y1c is y1a y1b y1c (examples 5.9, 5.10). Lower case. */
export function expandNames(names: string): string[] {
  const out: string[] = [];
  for (const tok of pySplit(names)) {
    const m = /^([A-Za-z_]\w*?)(\d+)-([A-Za-z_]\w*?)(\d+)$/.exec(tok);
    const ml = /^([A-Za-z_]\w*?\d)([A-Za-z])-([A-Za-z_]\w*?\d)([A-Za-z])$/.exec(tok);
    if (m && m[1] === m[3]) {
      for (let i = Number(m[2]); i <= Number(m[4]); i++) out.push(`${m[1]}${i}`);
    } else if (ml && ml[1] === ml[3] && ml[2] < ml[4]) {
      for (let c = ml[2].charCodeAt(0); c <= ml[4].charCodeAt(0); c++)
        out.push(`${ml[1]}${String.fromCharCode(c)}`);
    } else out.push(tok);
  }
  return out.map((n) => n.toLowerCase());
}

/** What an Mplus input says about its data: the file (quotes removed), the column names and the missing-value codes. */
export interface MplusInput {
  file: string;
  names: string[];
  missing: number[];
}

/** The data an input reads, or null when it names no file or no variables (a Monte Carlo study, say). */
export function mplusInput(inp: string): MplusInput | null {
  const st = mplusStatements(universal(inp));
  const file = mplusOption(st.DATA, 'FILE');
  const names = mplusOption(st.VARIABLE, 'NAMES');
  if (!file || !names) return null;
  const missing: number[] = [];
  const miss = mplusOption(st.VARIABLE, 'MISSING');
  if (miss) {
    for (const m of miss.matchAll(/\(([^)]*)\)/g)) {
      for (const v of pySplit(m[1].replace(/,/g, ' ')))
        if (/^-?\d+(\.\d+)?$/.test(v)) missing.push(Number(v));
    }
    // ('*' and '.' are missing in every file, so MISSING = * or MISSING = . adds nothing)
  }
  return { file: file.replace(/^["']+|["']+$/g, ''), names: expandNames(names), missing };
}

/**
 * Free-format data as CSV: a header row, then one row per record, the values as written and missing values (`*`,
 * `.` and the codes) as empty cells. Throws when the values do not divide into records.
 */
export function freeFormatCsv(
  dat: string,
  names: string[],
  missing: number[] = [],
  what = 'The data',
): { csv: string; rows: number } {
  const text = universal(dat).replace(/\0/g, '').replace(/,/g, ' ');
  const lines = pySplitLines(text)
    .filter((l) => pyStrip(l) !== '')
    .map(pySplit);
  const widths = new Set(lines.map((l) => l.length));
  const values =
    widths.size === 1 && [...widths][0] > names.length
      ? // One record per line with trailing columns the input does not name (the generating class): dropped.
        lines.flatMap((l) => l.slice(0, names.length))
      : pySplit(text);
  if (!names.length || values.length % names.length)
    throw new Error(
      `${what}: ${values.length} values do not divide into records of ${names.length}`,
    );
  const codes = new Set(missing);
  const cell = (v: string) => {
    if (v === '*' || v === '.') return '';
    const x = pyFloat(v);
    return x !== undefined && codes.has(x) ? '' : v;
  };
  const out: string[] = [names.join(',') + '\n'];
  for (let i = 0; i < values.length; i += names.length)
    out.push(
      values
        .slice(i, i + names.length)
        .map(cell)
        .join(',') + '\n',
    );
  return { csv: out.join(''), rows: values.length / names.length };
}

/** An Mplus example's data as CSV, from its input and the data file the input names (`readDat`). Null: the input reads no data. */
export function mplusCsv(
  key: string,
  inp: string,
  readDat: (file: string) => string | null,
): { csv: string; rows: number; file: string } | null {
  const info = mplusInput(inp);
  if (!info) return null;
  const dat = readDat(info.file);
  if (dat === null) return null;
  return { ...freeFormatCsv(dat, info.names, info.missing, key), file: info.file };
}
