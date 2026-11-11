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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = join(ROOT, 'scripts', 'webr', 'webr-lock.json');
const OUT_DIR = join(ROOT, 'public', 'webr');
/** Source tarballs are cached between runs (they never change for a pinned version). */
const SRC_CACHE = join(ROOT, '.webr-cache', 'src');
const CRAN = 'https://cran.r-project.org/src/contrib';
/** webR ships development builds (x.y.z.9000) of a few packages; their source is the upstream repository. */
const UPSTREAM = {
  nloptr: 'https://github.com/astamm/nloptr',
  sass: 'https://github.com/rstudio/sass',
  vroom: 'https://github.com/tidyverse/vroom',
  later: 'https://github.com/r-lib/later',
};
/**
 * Packages whose served source is a pinned snapshot of their repository, not a CRAN tarball. dynamic's CRAN release
 * 1.1.0 (2022) was archived on 2025-11-07 and no longer runs (dplyr >= 1.1 refuses its summarise() of several rows);
 * the binary in scripts/webr/vendor is built from this commit of the maintained repository (still versioned 1.1.0
 * there, no tags), and the archive below is the source of exactly that build (AGPL-3).
 */
const SNAPSHOT = {
  dynamic: {
    commit: '90aa51f7cd34d7de936dc36ff99a7b8363ed10d7',
    url: 'https://github.com/melissagwolf/dynamic/tree/90aa51f7cd34d7de936dc36ff99a7b8363ed10d7',
    source:
      'https://github.com/melissagwolf/dynamic/archive/90aa51f7cd34d7de936dc36ff99a7b8363ed10d7.tar.gz',
  },
};
/**
 * Packages the app ships patched, so that they load in webR. cubature's WebAssembly build (the webR repository's and
 * r-universe's alike) uses Emscripten's JavaScript longjmp, which webR 0.6.0's R cannot link, and GenOrd imported it
 * (dynamic imported GenOrd), so dynamic did not load in the browser. Each patch only turns one hard import into a
 * suggested package loaded on demand (requireNamespace) by the one function that uses it, with a clear error when it
 * is absent; no computation changes: GenOrd's Gaussian copula correction (contord/ordcont, df = Inf) already uses
 * mvtnorm, cubature served only pmvt.alt() (a Student's t copula with a non-integer df), and dynamic uses GenOrd in
 * likertHB2() only. The binaries in scripts/webr/vendor are built from the patched sources (`R CMD INSTALL --build`,
 * R 4.6.2, pure R); the patches are scripts/webr/vendor/<name>_<version>.patch (against SNAPSHOT's dynamic and CRAN's
 * GenOrd), and the served source (public/webr/src) is the patched source, scripts/webr/vendor/src/<name>_<version>.tar.gz,
 * with the patch beside it, as AGPL-3 and GPL-3 require of a modified version.
 */
const PATCHED = {
  dynamic: 'GenOrd moved from Imports to Suggests and loaded when likertHB2() needs it',
  GenOrd:
    'cubature moved from Imports to Suggests and loaded when pmvt.alt() (a Student’s t copula with a non-integer df) needs it',
};
const R_VERSION = '4.6';
const REPO = `https://repo.r-wasm.org/bin/emscripten/contrib/${R_VERSION}`;
/** Packages the app calls directly (and GenOrd: dynamic's suggested package, which its likertHB2() loads, kept in the closure). */
const ROOTS = [
  'fixest',
  'did',
  'MASS',
  'nnet',
  'carData',
  'faraway',
  'lavaan',
  'cSEM',
  'seminr',
  'MIIVsem',
  'semTools',
  'manymome',
  'sandwich',
  'modsem',
  'ltm',
  'poLCA',
  'lme4',
  'lmerTest',
  'lcmm',
  'plspm',
  'ivreg',
  'sampleSelection',
  'MatchIt',
  'optmatch',
  'cobalt',
  'optimx',
  'corpcor',
  'mvtnorm',
  'NCA',
  'genpathmox',
  'flexmix',
  'jsonlite',
  'psych',
  'GPArotation',
  'semfindr',
  'mice',
  'Amelia',
  'lavaan.mi',
  'WeightIt',
  'marginaleffects',
  'rsem',
  'haven',
  'readxl',
  'bootnet',
  'qgraph',
  'EGAnet',
  'BayesFactor',
  'mirt',
  'GLMMadaptive',
  'glca',
  'dynamic',
  'GenOrd',
  'QCA',
  'nonnest2',
  'INLAvaan',
  'strucchange',
  'psychotools',
  'misty',
  'mvnmle',
  'SEMsens',
  'mediation',
  'semPower',
  'sirt',
  'mnlfa',
  'lslx',
  'pscl',
  'restriktor',
  'bain',
  'piecewiseSEM',
  'Bayesrel',
  'metafor',
];
/**
 * Binaries kept in this repository (scripts/webr/vendor, with their PACKAGES
 * stanzas) instead of downloaded from repo.r-wasm.org. glasso and glassoFast
 * there were built (2026-05-13) before webR 0.6.0's Fortran compiler fix: glasso
 * crashes and glassoFast returns wrong results (r-wasm/webr#633). These are
 * r-universe's rebuilds of the same versions (2026-10-28), checked against
 * native R; vendored because r-universe keeps only its latest build.
 * deSolve (needed by hypergeo, which BayesFactor imports) is not in the webR
 * repository at all: r-universe's build of 1.42 (2026-10-19), SHA-256 as
 * published there. qs2 (imported by SimDesign, which mirt imports) is not in the
 * webR repository either: r-universe's build of 0.4.0 (2026-11-02), with the
 * RcppParallel it needs (>= 6.1.1; the webR repository has 5.1.11-2): r-universe's
 * build of 6.2.1 (2026-10-26), SHA-256 as published there. dynamic has no
 * webR or r-universe binary (archived from CRAN, see SNAPSHOT): a pure-R package,
 * built here with `R CMD INSTALL --build` (R 4.6.2) from the pinned commit with
 * the patch in PATCHED applied; GenOrd likewise, from its CRAN source with its
 * patch (the webR repository's build imports cubature, which does not load).
 * Their SHA-256s are those of the files in vendor/.
 */
const VENDOR = join(ROOT, 'scripts', 'webr', 'vendor');
const vendored = () =>
  new Map(parsePackages(readFileSync(join(VENDOR, 'PACKAGES'), 'utf8')).map((s) => [s.Package, s]));

/** Shipped inside webR itself. */
const BASE = new Set([
  'R',
  'base',
  'compiler',
  'datasets',
  'graphics',
  'grDevices',
  'grid',
  'methods',
  'parallel',
  'splines',
  'stats',
  'stats4',
  'tcltk',
  'tools',
  'translations',
  'utils',
  'webr',
]);
/** webR runtime files needed next to the page (the JS API itself is bundled from the npm package). */
const RUNTIME = ['R.js', 'R.wasm', 'libRblas.so', 'libRlapack.so', 'webr-worker.js', 'vfs'];

/** Parse a Debian-control style PACKAGES file into stanzas. */
/** How a package's build differs from the CRAN release, for the notices (an empty object when it does not). */
function buildNote(name) {
  if (UPSTREAM[name]) return { note: 'development build by webR; source: upstream repository' };
  if (SNAPSHOT[name]) {
    const patched = PATCHED[name] ? ', patched' : '';
    return {
      note: `built by PLS Studio from the repository at commit ${SNAPSHOT[name].commit} (the CRAN release is archived); source: that snapshot${patched}`,
    };
  }
  if (PATCHED[name]) return { note: 'built by PLS Studio from the CRAN source, patched' };
  return {};
}

function parsePackages(text) {
  return text
    .split(/\n\s*\n/)
    .filter((s) => s.trim())
    .map((stanza) => {
      const out = {};
      let key = null;
      for (const line of stanza.split('\n')) {
        // (a blank line, e.g. a trailing newline, is no field: read as one it became ": " in PACKAGES, which R cannot parse)
        if (!line.trim()) continue;
        if (/^\s/.test(line) && key) out[key] += ' ' + line.trim();
        else {
          const i = line.indexOf(':');
          key = line.slice(0, i);
          out[key] = line.slice(i + 1).trim();
        }
      }
      return out;
    });
}

const deps = (s) =>
  ['Depends', 'Imports']
    .flatMap((f) => (s[f] ?? '').split(','))
    .map((d) => d.replace(/\(.*\)/, '').trim())
    .filter((d) => d && !BASE.has(d));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** The dependency closure of ROOTS. Packages in `pinned` keep their locked stanza (and so their dependencies). */
async function resolve(pinned = {}) {
  const index = new Map(
    parsePackages((await get(`${REPO}/PACKAGES`)).toString('utf8')).map((s) => [s.Package, s]),
  );
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
  const webrPkg = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', 'webr', 'package.json'), 'utf8'),
  );
  let lock;
  const adding = process.argv.includes('--add') && existsSync(LOCK);
  if (adding || process.argv.includes('--update') || !existsSync(LOCK)) {
    const pinned = adding ? JSON.parse(readFileSync(LOCK, 'utf8')).packages : {};
    const stanzas = await resolve(pinned);
    // Pin the checksum of the file actually served: the repository index can lag behind rebuilt binaries.
    const packages = {};
    for (const s of stanzas) {
      if (pinned[s.Package]) {
        packages[s.Package] = pinned[s.Package];
        continue;
      }
      if (adding) console.log(`adding ${s.Package} ${s.Version}`);
      const isVendored = vendored().has(s.Package);
      const sum = md5(
        isVendored
          ? readFileSync(join(VENDOR, `${s.Package}_${s.Version}.tgz`))
          : await get(`${REPO}/${s.Package}_${s.Version}.tgz`),
      );
      if (!isVendored && sum !== s.MD5sum)
        console.warn(
          `note: ${s.Package} ${s.Version}: index MD5 ${s.MD5sum} is stale, pinning the served file ${sum}`,
        );
      packages[s.Package] = {
        version: s.Version,
        md5: sum,
        license: s.License,
        ...(isVendored ? { vendored: true } : {}),
        stanza: { ...s, MD5sum: sum },
      };
    }
    lock = { webr: webrPkg.version, r: R_VERSION, packages };
    writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
    console.log(`Locked ${stanzas.length} packages.`);
  } else lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  if (lock.webr !== webrPkg.version)
    throw new Error(
      `webr-lock.json is for webR ${lock.webr} but ${webrPkg.version} is installed; run with --update.`,
    );
  const withSources = !process.argv.includes('--no-sources');
  const stamp = join(OUT_DIR, '.lock-stamp');
  const stampText = JSON.stringify({ lock, withSources });
  if (
    process.argv.includes('--if-missing') &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === stampText
  ) {
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
    const buf = p.vendored
      ? readFileSync(join(VENDOR, file))
      : await get(`${REPO}/${file}`).catch((e) => {
          throw new Error(
            `${e.message}\nThe pinned version may have left the repository; run with --update.`,
          );
        });
    if (md5(buf) !== p.md5)
      throw new Error(`${file}: MD5 mismatch (expected ${p.md5}, got ${md5(buf)}).`);
    writeFileSync(join(contrib, file), buf);
    bytes += buf.length;
  }
  const stanzaText = (s) =>
    Object.entries(s)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
  const index = entries.map(([, p]) => stanzaText(p.stanza)).join('\n\n') + '\n';
  writeFileSync(join(contrib, 'PACKAGES'), index);
  writeFileSync(join(contrib, 'PACKAGES.gz'), gzipSync(index));
  writeFileSync(
    join(OUT, 'LICENSES.md'),
    [
      '# R packages shipped with PLS Studio',
      '',
      `Binaries built for webR ${lock.webr} (R ${lock.r}) by the webR project (repo.r-wasm.org); ${
        entries
          .filter(([, p]) => p.vendored)
          .map(([n]) => n)
          .join(', ') || 'none'
      } built by r-universe (cran.r-universe.dev) or, ${Object.keys(PATCHED).join(' and ')}, by PLS Studio from patched sources (see scripts/webr/fetch.mjs). Source code of each exact version is on CRAN, or served from a repository snapshot; for a patched package the served source is the modified source, with the patch (src/<package>_<version>.patch) beside it.`,
      '',
      '| Package | Version | Licence | Source |',
      '|---|---|---|---|',
      ...entries.map(
        ([n, p]) =>
          `| ${n} | ${p.version} | ${p.license} | src/${n}_${p.version}.tar.gz (${SNAPSHOT[n] ? `repository snapshot ${SNAPSHOT[n].commit.slice(0, 7)}` : 'from CRAN'}${PATCHED[n] ? `; patched by PLS Studio: ${PATCHED[n]}, see src/${n}_${p.version}.patch` : ''}) |`,
      ),
      '',
    ].join('\n'),
  );
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
        for (const u of urls) {
          buf = await get(u).catch(() => null);
          if (buf) break;
        }
        if (!buf) return null;
        writeFileSync(cached, buf);
      }
      cpSync(cached, join(srcOut, file));
      return `src/${file}`;
    };
    // (a patched package: its modified source and the patch, both kept in scripts/webr/vendor)
    const patchedSrc = (name, file) => {
      const patch = `${name}_${file.replace(`${name}_`, '').replace(/\.tar\.gz$/, '')}.patch`;
      for (const f of [join(VENDOR, 'src', file), join(VENDOR, patch)])
        if (!existsSync(f))
          throw new Error(
            `${f} is missing: the patched source of ${name} must be vendored (see PATCHED).`,
          );
      cpSync(join(VENDOR, 'src', file), join(srcOut, file));
      cpSync(join(VENDOR, patch), join(srcOut, patch));
      return `src/${file}`;
    };
    for (const [name, p] of entries) {
      const file = `${name}_${p.version}.tar.gz`;
      if (PATCHED[name]) sources[name] = patchedSrc(name, file);
      else {
        // (a snapshot's own source; otherwise CRAN, current or archived)
        const urls = SNAPSHOT[name]
          ? [SNAPSHOT[name].source]
          : [`${CRAN}/${file}`, `${CRAN}/Archive/${name}/${file}`];
        sources[name] = await fetchSrc(file, urls);
      }
      if (!sources[name]) console.warn(`warning: no CRAN source found for ${name} ${p.version}`);
    }
    sources.webr = await fetchSrc(`webr-${lock.webr}.tar.gz`, [
      `https://github.com/r-wasm/webr/archive/refs/tags/v${lock.webr}.tar.gz`,
    ]);
    if (!sources.webr) console.warn(`warning: webR ${lock.webr} source not found`);
  }
  writeFileSync(
    join(OUT, 'licenses.json'),
    JSON.stringify(
      {
        webr: {
          version: lock.webr,
          r: lock.r,
          license: 'GPL-3 (webR binaries, including R); MIT (webR JavaScript API)',
          source: sources.webr ?? null,
          url: `https://github.com/r-wasm/webr/releases/tag/v${lock.webr}`,
        },
        packages: entries.map(([name, p]) => ({
          name,
          version: p.version,
          license: p.license,
          source: sources[name] ?? null,
          url:
            UPSTREAM[name] ?? SNAPSHOT[name]?.url ?? `https://cran.r-project.org/package=${name}`,
          ...buildNote(name),
          ...(PATCHED[name]
            ? {
                patch: `src/${name}_${p.version}.patch`,
                patched: `${PATCHED[name]}, so that the package loads in webR (cubature’s WebAssembly build cannot be loaded there); no other change. The served source is the modified source.`,
              }
            : {}),
        })),
      },
      null,
      1,
    ),
  );
  writeFileSync(join(OUT, '.lock-stamp'), stampText);
  const OLD = `${FINAL}.old`;
  rmSync(OLD, { recursive: true, force: true });
  if (existsSync(FINAL)) renameSync(FINAL, OLD);
  renameSync(OUT, FINAL);
  rmSync(OLD, { recursive: true, force: true });
  console.log(
    `\nDone: webR ${lock.webr} runtime + ${entries.length} packages (${(bytes / 1e6).toFixed(1)} MB) in public/webr.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
