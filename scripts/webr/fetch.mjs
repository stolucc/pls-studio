// Self-hosted R runtime: copies webR (from node_modules) and downloads a pinned
// set of R packages (the dependency closure of ROOTS) into public/webr, so the
// app never fetches code from third parties at runtime and results do not
// change when upstream packages do.
//
//   node scripts/webr/fetch.mjs            download exactly what webr-lock.json pins (MD5-verified)
//   node scripts/webr/fetch.mjs --update   re-resolve the closure from the live repository, rewrite the lock
//   node scripts/webr/fetch.mjs --add      keep every pinned package as it is; lock only packages new to the closure
//   node scripts/webr/fetch.mjs --if-missing   only when public/webr does not match the lock (prebuild)
//
// Many of the packages and webR itself are GPL-licensed. Serving them is
// distribution, so the source of every shipped version is served alongside
// (public/webr/src: CRAN source tarballs and the webR release source), and
// public/webr/licenses.json lists each component for the app's About dialog.
//   --no-sources   skip the source tarballs (development only; never deploy without them)

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'scripts', 'webr', 'webr-lock.json');
const OUT_DIR = join(ROOT, 'public', 'webr');
/** Source tarballs are cached between runs (they never change for a pinned version). */
const SRC_CACHE = join(ROOT, '.webr-cache', 'src');
const CRAN = 'https://cran.r-project.org/src/contrib';
/** webR ships development builds (x.y.z.9000) of a few packages; their source is the upstream repository. */
const UPSTREAM = { nloptr: 'https://github.com/astamm/nloptr', sass: 'https://github.com/rstudio/sass', vroom: 'https://github.com/tidyverse/vroom', later: 'https://github.com/r-lib/later' };
const R_VERSION = '4.6';
const REPO = `https://repo.r-wasm.org/bin/emscripten/contrib/${R_VERSION}`;
/** Packages the app calls directly. */
const ROOTS = ['fixest', 'did', 'MASS', 'nnet', 'carData', 'faraway', 'lavaan', 'cSEM', 'seminr', 'MIIVsem', 'semTools', 'manymome', 'sandwich', 'modsem', 'ltm', 'poLCA', 'lme4', 'lmerTest', 'lcmm', 'plspm', 'ivreg', 'sampleSelection', 'MatchIt', 'optmatch', 'cobalt', 'optimx', 'corpcor', 'mvtnorm', 'NCA', 'genpathmox', 'flexmix', 'jsonlite', 'psych', 'GPArotation', 'semfindr', 'mice', 'lavaan.mi', 'WeightIt', 'marginaleffects', 'rsem', 'haven', 'readxl', 'bootnet', 'qgraph', 'EGAnet'];
/**
 * Binaries kept in this repository (scripts/webr/vendor, with their PACKAGES
 * stanzas) instead of downloaded from repo.r-wasm.org. glasso and glassoFast
 * there were built (2026-05-13) before webR 0.6.0's Fortran compiler fix: glasso
 * crashes and glassoFast returns wrong results (r-wasm/webr#633). These are
 * r-universe's rebuilds of the same versions (2026-10-28), checked against
 * native R; vendored because r-universe keeps only its latest build.
 */
const VENDOR = join(ROOT, 'scripts', 'webr', 'vendor');
const vendored = () => new Map(parsePackages(readFileSync(join(VENDOR, 'PACKAGES'), 'utf8')).map((s) => [s.Package, s]));

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

/** The dependency closure of ROOTS. Packages in `pinned` keep their locked stanza (and so their dependencies). */
async function resolve(pinned = {}) {
  const index = new Map(parsePackages((await get(`${REPO}/PACKAGES`)).toString('utf8')).map((s) => [s.Package, s]));
  const own = vendored();
  const want = new Map();
  const stack = [...ROOTS];
  while (stack.length) {
    const name = stack.pop();
    if (want.has(name)) continue;
    const s = pinned[name]?.stanza ?? own.get(name) ?? index.get(name);
    if (!s) throw new Error(`Package ${name} is not in the webR repository for R ${R_VERSION}.`);
    want.set(name, s);
    stack.push(...deps(s));
  }
  return [...want.values()].sort((a, b) => a.Package.localeCompare(b.Package));
}

async function main() {
  const webrPkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'webr', 'package.json'), 'utf8'));
  let lock;
  const adding = process.argv.includes('--add') && existsSync(LOCK);
  if (adding || process.argv.includes('--update') || !existsSync(LOCK)) {
    const pinned = adding ? JSON.parse(readFileSync(LOCK, 'utf8')).packages : {};
    const stanzas = await resolve(pinned);
    // Pin the checksum of the file actually served: the repository index can lag behind rebuilt binaries.
    const packages = {};
    for (const s of stanzas) {
      if (pinned[s.Package]) { packages[s.Package] = pinned[s.Package]; continue; }
      if (adding) console.log(`adding ${s.Package} ${s.Version}`);
      const isVendored = vendored().has(s.Package);
      const sum = md5(isVendored ? readFileSync(join(VENDOR, `${s.Package}_${s.Version}.tgz`)) : await get(`${REPO}/${s.Package}_${s.Version}.tgz`));
      if (!isVendored && sum !== s.MD5sum) console.warn(`note: ${s.Package} ${s.Version}: index MD5 ${s.MD5sum} is stale, pinning the served file ${sum}`);
      packages[s.Package] = { version: s.Version, md5: sum, license: s.License, ...(isVendored ? { vendored: true } : {}), stanza: { ...s, MD5sum: sum } };
    }
    lock = { webr: webrPkg.version, r: R_VERSION, packages };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Locked ${stanzas.length} packages.`);
  } else lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  if (lock.webr !== webrPkg.version) throw new Error(`webr-lock.json is for webR ${lock.webr} but ${webrPkg.version} is installed; run with --update.`);
  const withSources = !process.argv.includes('--no-sources');
  const stamp = join(OUT_DIR, '.lock-stamp');
  const stampText = JSON.stringify({ lock, withSources });
  if (process.argv.includes('--if-missing') && existsSync(stamp) && readFileSync(stamp, 'utf8') === stampText) {
    console.log('public/webr is up to date.');
    return;
  }

  // Build into a sibling folder and swap it in at the end, so a running app never sees a half-built runtime.
  const FINAL = OUT_DIR;
  const OUT_NEXT = `${FINAL}.next`;
  rmSync(OUT_NEXT, { recursive: true, force: true });
  mkdirSync(OUT_NEXT, { recursive: true });
  const OUT = OUT_NEXT;
  const dist = join(ROOT, 'node_modules', 'webr', 'dist');
  for (const f of RUNTIME) cpSync(join(dist, f), join(OUT, f), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'webr', 'LICENSE.md'), join(OUT, 'WEBR-LICENSE.md'));

  const contrib = join(OUT, 'repo', 'bin', 'emscripten', 'contrib', R_VERSION);
  mkdirSync(contrib, { recursive: true });
  const entries = Object.entries(lock.packages);
  let bytes = 0;
  for (const [name, p] of entries) {
    const file = `${name}_${p.version}.tgz`;
    const buf = p.vendored ? readFileSync(join(VENDOR, file))
      : await get(`${REPO}/${file}`).catch((e) => { throw new Error(`${e.message}\nThe pinned version may have left the repository; run with --update.`); });
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
    `Binaries built for webR ${lock.webr} (R ${lock.r}) by the webR project (repo.r-wasm.org); ${entries.filter(([, p]) => p.vendored).map(([n]) => n).join(', ') || 'none'} built by r-universe (cran.r-universe.dev; see scripts/webr/fetch.mjs). Source code of each exact version is on CRAN.`,
    '',
    '| Package | Version | Licence | Source |',
    '|---|---|---|---|',
    ...entries.map(([n, p]) => `| ${n} | ${p.version} | ${p.license} | src/${n}_${p.version}.tar.gz (from CRAN) |`),
    '',
  ].join('\n'));
  // Sources for GPL compliance: CRAN tarballs of the exact versions, and webR's release source.
  const sources = {};
  if (withSources) {
    mkdirSync(SRC_CACHE, { recursive: true });
    const srcOut = join(OUT, 'src');
    mkdirSync(srcOut, { recursive: true });
    const fetchSrc = async (file, urls) => {
      const cached = join(SRC_CACHE, file);
      if (!existsSync(cached)) {
        let buf = null;
        for (const u of urls) { buf = await get(u).catch(() => null); if (buf) break; }
        if (!buf) return null;
        writeFileSync(cached, buf);
      }
      cpSync(cached, join(srcOut, file));
      return `src/${file}`;
    };
    for (const [name, p] of entries) {
      const file = `${name}_${p.version}.tar.gz`;
      sources[name] = await fetchSrc(file, [`${CRAN}/${file}`, `${CRAN}/Archive/${name}/${file}`]);
      if (!sources[name]) console.warn(`warning: no CRAN source found for ${name} ${p.version}`);
    }
    sources.webr = await fetchSrc(`webr-${lock.webr}.tar.gz`, [`https://github.com/r-wasm/webr/archive/refs/tags/v${lock.webr}.tar.gz`]);
    if (!sources.webr) console.warn(`warning: webR ${lock.webr} source not found`);
  }
  writeFileSync(join(OUT, 'licenses.json'), JSON.stringify({
    webr: { version: lock.webr, r: lock.r, license: 'GPL-3 (webR binaries, including R); MIT (webR JavaScript API)', source: sources.webr ?? null, url: `https://github.com/r-wasm/webr/releases/tag/v${lock.webr}` },
    packages: entries.map(([name, p]) => ({ name, version: p.version, license: p.license, source: sources[name] ?? null, url: UPSTREAM[name] ?? `https://cran.r-project.org/package=${name}`, ...(UPSTREAM[name] ? { note: 'development build by webR; source: upstream repository' } : {}) })),
  }, null, 1));
  writeFileSync(join(OUT, '.lock-stamp'), stampText);
  const OLD = `${FINAL}.old`;
  rmSync(OLD, { recursive: true, force: true });
  if (existsSync(FINAL)) renameSync(FINAL, OLD);
  renameSync(OUT, FINAL);
  rmSync(OLD, { recursive: true, force: true });
  console.log(`\nDone: webR ${lock.webr} runtime + ${entries.length} packages (${(bytes / 1e6).toFixed(1)} MB) in public/webr.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
