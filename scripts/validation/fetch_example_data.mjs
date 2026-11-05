// The example data that PLS Studio does not distribute (no licence that allows it), downloaded from its source and
// converted as the app converts it, into the git-ignored cache the tests read (.cache/):
//
//   .cache/mplus/exN.M.csv       each Mplus User's Guide example the app has (mplusData('N.M') in src/examples),
//                                from statmodel.com: its input exN.M.inp and the .dat it names
//   .cache/mplus/src/            the downloaded .inp and .dat files (convert.test.ts compares the converter with
//                                scripts/validation/mplus_data.py on them)
//   .cache/riclpm/RICLPM.csv     and every other source in src/examples/remote/source.ts (URL_SOURCES), its download in
//                                .cache/<dir>/src/
//
// The conversion is the app's own (src/examples/remote/convert.ts), so this script is the single source of the cache.
// Reshapes (ex6.19's person-period data, ex9.16's DATA WIDETOLONG) are applied in code after loading, by the app and
// by the tests alike: they are not cached.
//
//   node scripts/validation/fetch_example_data.mjs              download what is missing; convert everything again
//   node scripts/validation/fetch_example_data.mjs --force      download everything again too
//   node scripts/validation/fetch_example_data.mjs 6.19 ex9.16  these Mplus examples too (or only, with --only)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freeFormatCsv, latin1, mplusInput } from '../../src/examples/remote/convert.ts';
import { mplusInputPath, STATMODEL_BASE, statmodelPath, URL_SOURCES } from '../../src/examples/remote/source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only');
const named = args.filter((a) => !a.startsWith('--')).map((a) => a.replace(/^ex/, ''));

/** Every Mplus example key the app's examples use: mplusData('6.19', ...) in src/examples. */
function mplusKeys() {
  const keys = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) for (const m of readFileSync(p, 'utf8').matchAll(/mplusData\(\s*'(\d{1,2}\.\d{1,2}[a-z0-9]*)'/g)) keys.add(m[1]);
    }
  };
  walk(join(ROOT, 'src', 'examples'));
  return keys;
}

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'PLS Studio test-data cache (scripts/validation/fetch_example_data.mjs)' } });
      if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3 || /HTTP (3|4)\d\d/.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** A downloaded file, kept in dir (downloaded once unless --force). */
async function raw(dir, name, url) {
  const file = join(dir, name);
  if (!force && existsSync(file)) return readFileSync(file);
  const bytes = await download(url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  return bytes;
}

/** Write the converted file when it changed (the downloads are kept, so every run converts them again: the cache follows the converter). */
function write(out, csv, msg) {
  if (existsSync(out) && readFileSync(out, 'utf8') === csv) return null;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv);
  return msg;
}

async function mplusExample(key) {
  const dir = join(CACHE, 'mplus');
  const out = join(dir, `ex${key}.csv`);
  const inpPath = statmodelPath(mplusInputPath(key));
  if (!inpPath) throw new Error(`ex${key}: not an Mplus User's Guide example name`);
  const src = join(dir, 'src');
  const inp = latin1(await raw(src, `ex${key}.inp`, STATMODEL_BASE + inpPath));
  const info = mplusInput(inp);
  if (!info) return `ex${key}: the input reads no data`;
  const datPath = statmodelPath(`chap${key.split('.')[0]}/${info.file}`);
  if (!datPath) throw new Error(`ex${key}: the input names ${info.file}, not one of the guide's data files`);
  const dat = latin1(await raw(src, info.file, STATMODEL_BASE + datPath));
  const { csv, rows } = freeFormatCsv(dat, info.names, info.missing, `ex${key}`);
  return write(out, csv, `ex${key}: ${rows} rows, ${info.names.length} columns (${info.file})`);
}

async function urlSource(r) {
  const out = join(CACHE, r.file);
  const name = r.url.split('/').pop();
  const text = latin1(await raw(join(dirname(out), 'src'), name, r.url));
  const { csv, rows } = freeFormatCsv(text, r.names, [], name);
  return write(out, csv, `${r.file}: ${rows} rows, ${r.names.length} columns (${r.url})`);
}

const keys = [...new Set([...(only ? [] : mplusKeys()), ...named])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const jobs = [...keys.map((k) => () => mplusExample(k)), ...(only ? [] : URL_SOURCES.map((r) => () => urlSource(r)))];
let failed = 0;
// A few at a time: statmodel.com is one small server.
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    try {
      const msg = await job();
      if (msg) console.log(msg);
    } catch (e) {
      failed++;
      console.error(`FAILED ${e instanceof Error ? e.message : e}`);
    }
  }
}));
console.log(`Example data: ${keys.length} Mplus examples and ${only ? 0 : URL_SOURCES.length} other sources in ${CACHE}${failed ? `; ${failed} failed` : ''}.`);
if (failed) process.exit(1);
