// Self-hosted R runtime: copies webR (from node_modules) and downloads a pinned
// set of R packages (the dependency closure of ROOTS) into public/webr, so the
// app never fetches code from third parties at runtime and results do not
// change when upstream packages do.
//
//   node scripts/webr/fetch.mjs            download exactly what webr-lock.json pins (MD5-verified)
//   node scripts/webr/fetch.mjs --update   re-resolve the closure from the live repository, rewrite the lock
//   node scripts/webr/fetch.mjs --if-missing   only when public/webr does not match the lock (prebuild)
//
// The packages are GPL-licensed; public/webr/LICENSES.md lists each with its
// licence and the CRAN source archive of the exact version shipped.

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'scripts', 'webr', 'webr-lock.json');
const OUT = join(ROOT, 'public', 'webr');
const R_VERSION = '4.6';
const REPO = `https://repo.r-wasm.org/bin/emscripten/contrib/${R_VERSION}`;
/** Packages the app calls directly. */
const ROOTS = ['lavaan', 'cSEM', 'seminr', 'MIIVsem', 'semTools', 'jsonlite'];
/** Shipped inside webR itself. */
const BASE = new Set(['R', 'base', 'compiler', 'datasets', 'graphics', 'grDevices', 'grid', 'methods', 'parallel', 'splines', 'stats', 'stats4', 'tcltk', 'tools', 'translations', 'utils', 'webr']);
/** webR runtime files needed next to the page (the JS API itself is bundled from the npm package). */
const RUNTIME = ['R.js', 'R.wasm', 'libRblas.so', 'libRlapack.so', 'webr-worker.js', 'vfs'];

/** Parse a Debian-control style PACKAGES file into stanzas. */
function parsePackages(text) {
  return text.split(/\n\s*\n/).filter((s) => s.trim()).map((stanza) => {
    const out = {};
    let key = null;
    for (const line of stanza.split('\n')) {
      if (/^\s/.test(line) && key) out[key] += ' ' + line.trim();
      else { const i = line.indexOf(':'); key = line.slice(0, i); out[key] = line.slice(i + 1).trim(); }
    }
    return out;
  });
}

const deps = (s) => ['Depends', 'Imports'].flatMap((f) => (s[f] ?? '').split(',')).map((d) => d.replace(/\(.*\)/, '').trim()).filter((d) => d && !BASE.has(d));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function resolve() {
  const index = new Map(parsePackages((await get(`${REPO}/PACKAGES`)).toString('utf8')).map((s) => [s.Package, s]));
  const want = new Map();
  const stack = [...ROOTS];
  while (stack.length) {
    const name = stack.pop();
    if (want.has(name)) continue;
    const s = index.get(name);
    if (!s) throw new Error(`Package ${name} is not in the webR repository for R ${R_VERSION}.`);
    want.set(name, s);
    stack.push(...deps(s));
  }
  return [...want.values()].sort((a, b) => a.Package.localeCompare(b.Package));
}

async function main() {
  const webrPkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'webr', 'package.json'), 'utf8'));
  let lock;
  if (process.argv.includes('--update') || !existsSync(LOCK)) {
    const stanzas = await resolve();
    // Pin the checksum of the file actually served: the repository index can lag behind rebuilt binaries.
    const packages = {};
    for (const s of stanzas) {
      const sum = md5(await get(`${REPO}/${s.Package}_${s.Version}.tgz`));
      if (sum !== s.MD5sum) console.warn(`note: ${s.Package} ${s.Version}: index MD5 ${s.MD5sum} is stale, pinning the served file ${sum}`);
      packages[s.Package] = { version: s.Version, md5: sum, license: s.License, stanza: { ...s, MD5sum: sum } };
    }
    lock = { webr: webrPkg.version, r: R_VERSION, packages };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Locked ${stanzas.length} packages.`);
  } else lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  if (lock.webr !== webrPkg.version) throw new Error(`webr-lock.json is for webR ${lock.webr} but ${webrPkg.version} is installed; run with --update.`);
  const stamp = join(OUT, '.lock-stamp');
  if (process.argv.includes('--if-missing') && existsSync(stamp) && readFileSync(stamp, 'utf8') === JSON.stringify(lock)) {
    console.log('public/webr is up to date.');
    return;
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const dist = join(ROOT, 'node_modules', 'webr', 'dist');
  for (const f of RUNTIME) cpSync(join(dist, f), join(OUT, f), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'webr', 'LICENSE.md'), join(OUT, 'WEBR-LICENSE.md'));

  const contrib = join(OUT, 'repo', 'bin', 'emscripten', 'contrib', R_VERSION);
  mkdirSync(contrib, { recursive: true });
  const entries = Object.entries(lock.packages);
  let bytes = 0;
  for (const [name, p] of entries) {
    const file = `${name}_${p.version}.tgz`;
    const buf = await get(`${REPO}/${file}`).catch((e) => { throw new Error(`${e.message}\nThe pinned version may have left the repository; run with --update.`); });
    if (md5(buf) !== p.md5) throw new Error(`${file}: MD5 mismatch (expected ${p.md5}, got ${md5(buf)}).`);
    writeFileSync(join(contrib, file), buf);
    bytes += buf.length;
    
  }
  const stanzaText = (s) => Object.entries(s).map(([k, v]) => `${k}: ${v}`).join('\n');
  const index = entries.map(([, p]) => stanzaText(p.stanza)).join('\n\n') + '\n';
  writeFileSync(join(contrib, 'PACKAGES'), index);
  writeFileSync(join(contrib, 'PACKAGES.gz'), gzipSync(index));
  writeFileSync(join(OUT, 'LICENSES.md'), [
    '# R packages shipped with PLS Studio',
    '',
    `Binaries built for webR ${lock.webr} (R ${lock.r}) by the webR project (repo.r-wasm.org). Source code of each exact version is on CRAN.`,
    '',
    '| Package | Version | Licence | Source |',
    '|---|---|---|---|',
    ...entries.map(([n, p]) => `| ${n} | ${p.version} | ${p.license} | https://cran.r-project.org/src/contrib/Archive/${n}/ (or src/contrib/${n}_${p.version}.tar.gz) |`),
    '',
  ].join('\n'));
  writeFileSync(stamp, JSON.stringify(lock));
  console.log(`\nDone: webR ${lock.webr} runtime + ${entries.length} packages (${(bytes / 1e6).toFixed(1)} MB) in public/webr.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
