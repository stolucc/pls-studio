// Merge the validation evidence the webR tests wrote (PS_VALIDATION_DIR, one JSON file per test file;
// src/validation/record.ts) into public/validation.json, with the R and package versions from the webR lock.
//
//   npm run validate:evidence      (runs the webR tests with PS_VALIDATION_DIR, then this)
//   node scripts/validation/evidence.mjs <dir>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.validation';
const lock = JSON.parse(readFileSync('scripts/webr/webr-lock.json', 'utf8'));
const pkgs = lock.packages ?? lock;
const version = (name) => pkgs?.[name]?.version;

const byKey = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const key = `${c.subject}:${c.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, c); continue; }
    // The same example checked in several test files: one check, the strongest level, every comparison.
    const rank = { published: 0, native: 1, recovery: 2, runs: 3 };
    prev.level = rank[c.level] < rank[prev.level] ? c.level : prev.level;
    prev.comparisons.push(...c.comparisons);
    for (const s of c.sources) if (!prev.sources.some((x) => x.label === s.label)) prev.sources.push(s);
    prev.packages = [...new Set([...prev.packages, ...c.packages])];
    prev.passed = prev.passed && c.passed;
    prev.test = `${prev.test}; ${c.test}`;
    prev.digest ??= c.digest;
    prev.definition ??= c.definition;
  }
}
const checks = [...byKey.values()].sort((a, b) => a.method.localeCompare(b.method) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
const used = [...new Set(checks.flatMap((c) => c.packages))].sort();
const out = {
  generated: new Date().toISOString().slice(0, 10),
  webR: lock.webR ?? lock.webr ?? '',
  R: lock.R ?? lock.r ?? '',
  versions: Object.fromEntries(used.map((p) => [p, version(p) ?? '']).filter(([, v]) => v)),
  checks,
};
writeFileSync('public/validation.json', `${JSON.stringify(out)}\n`);
const failed = checks.filter((c) => !c.passed);
console.log(`${checks.length} checks (${checks.reduce((a, c) => a + c.comparisons.length, 0)} comparisons), ${failed.length} failed → public/validation.json`);
if (failed.length) process.exitCode = 1;
