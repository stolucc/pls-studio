// For tests only: hashes of the app's R code (src/rengine/R), so that a run recorded in desktop R (a fixture another
// test checks without R) or a reference written by a script that sources the app's R code is known to be stale
// once the R code it ran has changed since.
//
// rCodeHash: the R code an entry point can reach. Each file is cut into its top-level definitions (`name <- ...` at
// the start of a line, with the comment lines just above it); from the entry points, every definition whose name
// appears in a reached definition's text is reached too (names written in strings count: do.call("ps_x")). Names
// built at run time (paste0("ps_", kind)) are not followed. An edit elsewhere in the bridge leaves the hash as it is.
//
// rFilesHash: the files a reference script sources, each by its MD5 (what tools::md5sum writes in R).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The repository's root, and its R bridge. */
export const ROOT = resolve(__dirname, '..', '..');
export const R_DIR = join(ROOT, 'src', 'rengine', 'R');

/** ps_call's own path: how the helper (and the native tests) call an entry point. */
const CALL_PATH = ['ps_call', 'ps_parse'];

const DEFINITION = /^([A-Za-z.][A-Za-z0-9._]*)\s*(<-|=)/;

/** The top-level definitions of the R bridge: name → its text (with the comment lines just above it). */
export function rDefinitions(dir = R_DIR): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.R'))
    .sort();
  for (const f of files) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    let name: string | null = null;
    let chunk: string[] = [];
    let comments: string[] = [];
    const close = () => {
      if (name) out.set(name, `${out.get(name) ?? ''}${chunk.join('\n')}\n`);
    };
    for (const line of lines) {
      const m = DEFINITION.exec(line);
      if (m) {
        close();
        name = m[1];
        chunk = [...comments, line];
        comments = [];
      } else if (line.startsWith('#')) {
        comments.push(line);
      } else {
        chunk.push(...comments, line);
        comments = [];
      }
    }
    chunk.push(...comments);
    close();
  }
  return out;
}

/** The names of the definitions the entry points reach (themselves and ps_call's path included), sorted. */
export function reachable(entries: string[], defs = rDefinitions()): string[] {
  const seen = new Set<string>();
  const todo = [...entries, ...CALL_PATH];
  while (todo.length) {
    const name = todo.pop()!;
    if (seen.has(name)) continue;
    const text = defs.get(name);
    if (text === undefined) continue;
    seen.add(name);
    for (const token of text.match(/[A-Za-z.][A-Za-z0-9._]*/g) ?? [])
      if (!seen.has(token) && defs.has(token)) todo.push(token);
  }
  for (const e of entries) if (!seen.has(e)) throw new Error(`${e} is not defined in ${R_DIR}`);
  return [...seen].sort();
}

/** A hash of the R code the entry points reach (16 hex digits, as definitionHash). */
export function rCodeHash(entries: string[], dir = R_DIR): string {
  const defs = rDefinitions(dir);
  const h = createHash('sha256');
  for (const name of reachable(entries, defs)) h.update(`${name}\n${defs.get(name)}\n`);
  return h.digest('hex').slice(0, 16);
}

/** The MD5 of each file (paths relative to the repository's root), as tools::md5sum gives them in R. */
export function rFilesHash(files: string[]): Record<string, string> {
  return Object.fromEntries(
    files.map((f) => [
      f,
      createHash('md5')
        .update(readFileSync(join(ROOT, f)))
        .digest('hex'),
    ]),
  );
}
