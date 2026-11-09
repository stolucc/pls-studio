// Record the webR test files' durations (seconds) from a vitest JSON report, for the order in which vitest starts them
// (src/validation/webrSequencer.ts: the slowest first) and to see which tests belong in the slow suite (WEBR_SLOW).
//
//   WEBR_TESTS=1 WEBR_SLOW=1 npx vitest run webr.test --reporter=json --outputFile=report.json
//   node scripts/webr/timings.mjs report.json

import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'report.json', 'utf8'));
const files = {};
const tests = [];
for (const f of report.testResults) {
  const name = relative(process.cwd(), f.name).split('\\').join('/');
  files[name] = Math.round((f.endTime - f.startTime) / 1000);
  for (const t of f.assertionResults) if (t.duration) tests.push([Math.round(t.duration / 1000), `${name}: ${t.fullName}`]);
}
const sorted = Object.fromEntries(Object.entries(files).sort((a, b) => b[1] - a[1]));
writeFileSync('scripts/webr/test-timings.json', `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), files: sorted }, null, 1)}\n`);
console.log(`${Object.keys(files).length} files; the slowest tests:`);
for (const [s, n] of tests.sort((a, b) => b[0] - a[0]).slice(0, 15)) console.log(`${String(s).padStart(6)} s  ${n}`);
