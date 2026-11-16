// Merge the validation evidence the webR tests wrote (PS_VALIDATION_DIR, one JSON file per test file, named after it
// with ".webr" kept: rengine__pls.json, rengine__pls.webr.json; src/validation/collector.ts evidenceFile) into
// public/validation.json, with the R and package versions from the webR lock.
//
//   npm run validate:evidence          (the webR tests, then the plain tests recorded without R, then this)
//   npm run validate:evidence:desktop  (the desktop-only packages' files in desktop R, then this with --desktop)
//   node scripts/validation/evidence.mjs <dir> [--desktop]
//
// The desktop run's checks (runtime "desktop") are kept by a later webR run, and replaced by the next desktop run.
// Checks of tests on private data (PRIVATE_DATA) are kept by a run without the data, and replaced by one with them.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Features whose tests run on data that are not in the repository (src/validation/features.ts keys), each with the
// variable that points at the data: rengine/barcomb.webr.test.ts runs only with BARCOMB_DATA=<csv>.
const PRIVATE_DATA = { 'rengine/barcomb': 'BARCOMB_DATA' };

const dir = process.argv[2] ?? '.validation';
const desktop = process.argv.includes('--desktop');
const previous = existsSync('public/validation.json')
  ? JSON.parse(readFileSync('public/validation.json', 'utf8'))
  : null;
const lock = JSON.parse(readFileSync('scripts/webr/webr-lock.json', 'utf8'));
const pkgs = lock.packages ?? lock;
const version = (name) => pkgs?.[name]?.version;

const byKey = new Map();
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const key = `${c.subject}:${c.id}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    // The same example checked in several test files: one check with every source and comparison (the app shows each kind of
    // evidence; `level` keeps one, published before native, for sorting).
    const rank = { published: 0, native: 1, 'same-r': 2, recovery: 3, runs: 4 };
    prev.level = rank[c.level] < rank[prev.level] ? c.level : prev.level;
    prev.comparisons.push(...c.comparisons);
    for (const s of c.sources)
      if (!prev.sources.some((x) => x.label === s.label)) prev.sources.push(s);
    prev.packages = [...new Set([...prev.packages, ...c.packages])];
    prev.passed = prev.passed && c.passed;
    prev.test = `${prev.test}; ${c.test}`;
    prev.digest ??= c.digest;
    prev.definition ??= c.definition;
  }
}
// The other run's checks: a webR run keeps the desktop checks; a desktop run keeps everything else.
for (const c of previous?.checks ?? []) {
  const key = `${c.subject}:${c.id}`;
  if ((c.runtime === 'desktop') !== desktop && !byKey.has(key)) byKey.set(key, c);
}
// A private-data feature this run recorded nothing for (the data were not here): its checks from before.
const privateFeature = (c) =>
  c.subject === 'feature'
    ? Object.keys(PRIVATE_DATA).find((k) => c.id.startsWith(`${k}::`))
    : undefined;
const recorded = new Set([...byKey.values()].map(privateFeature).filter(Boolean));
for (const c of previous?.checks ?? []) {
  const k = privateFeature(c);
  if (k && !recorded.has(k)) byKey.set(`${c.subject}:${c.id}`, c);
}
const kept = Object.keys(PRIVATE_DATA).filter((k) => !recorded.has(k));
if (kept.length)
  console.log(
    `Kept from before (private data not set: ${kept.map((k) => PRIVATE_DATA[k]).join(', ')}): ${kept.join(', ')}`,
  );
const checks = [...byKey.values()].sort(
  (a, b) =>
    a.method.localeCompare(b.method) ||
    a.subject.localeCompare(b.subject) ||
    a.id.localeCompare(b.id),
);
const used = [...new Set(checks.flatMap((c) => c.packages))].sort();
const today = new Date().toISOString().slice(0, 10);
// (the date of the last desktop-R run: today's when this is one, else the one kept from before)
let desktopDate = {};
if (desktop) desktopDate = { desktop: today };
else if (previous?.desktop) desktopDate = { desktop: previous.desktop };
const out = {
  generated: desktop ? (previous?.generated ?? today) : today,
  ...desktopDate,
  webR: lock.webR ?? lock.webr ?? '',
  R: lock.R ?? lock.r ?? '',
  versions: Object.fromEntries(used.map((p) => [p, version(p) ?? '']).filter(([, v]) => v)),
  checks,
};
writeFileSync('public/validation.json', `${JSON.stringify(out)}\n`);
const failed = checks.filter((c) => !c.passed);
console.log(
  `${checks.length} checks (${checks.reduce((a, c) => a + c.comparisons.length, 0)} comparisons), ${failed.length} failed → public/validation.json`,
);
if (failed.length) process.exitCode = 1;
