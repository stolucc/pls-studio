// Record the validation evidence of a few test files without the full run: rerun them (and the fixture files, which
// are quick), keep every other file's records from the last run in .validation/, and merge into public/validation.json.
//
//   npm run validate:evidence:files -- src/examples/bollen1989.webr.test.ts [more files]
//
// .validation/ holds one JSON file per test file (src/validation/collector.ts evidenceFile), written by the last full
// run (npm run validate:evidence) and kept since. A named file's old records are removed before it runs, so a check it
// no longer makes cannot linger; records of test files that no longer exist are removed too. The records of the other
// files are reused as they are: an example changed since its evidence was recorded fails src/validation/evidence.test.ts
// (its definition hash), which says to run the file again.
//
// Guard: every check of the previous public/validation.json is still there afterwards, unless all the test files it
// came from were rerun. Otherwise (.validation/ missing or incomplete) the previous file is put back and this exits 1:
// run npm run validate:evidence.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = '.validation';
const OUT = 'public/validation.json';

/** The feature key of a test file, as a check's `test` field names it: examples/bollen1989 (collector.ts fileName). */
export const featureOf = (testPath) =>
  testPath
    .replace(/\\/g, '/')
    .replace(/^.*?src\//, '')
    .replace(/\.webr\.test\.tsx?$/, '')
    .replace(/\.test\.tsx?$/, '');

/** The record file of a test file (collector.ts evidenceFile). */
export const evidenceFile = (testPath) =>
  `${testPath
    .replace(/\\/g, '/')
    .replace(/^.*?src\//, '')
    .replace(/\.test\.tsx?$/, '')
    .replace(/\//g, '__')}.json`;

/** The test files a record file can have come from (examples__x.webr.json: src/examples/x.webr.test.ts or .tsx). */
export const sourcesOf = (recordFile) => {
  const base = `src/${recordFile.replace(/\.json$/, '').replace(/__/g, '/')}`;
  return [`${base}.test.ts`, `${base}.test.tsx`];
};

/** Checks of `previous` missing from `next` that no rerun test file accounts for. */
export function lostChecks(previous, next, rerunFeatures) {
  const have = new Set(next.map((c) => `${c.subject}:${c.id}`));
  return previous
    .filter((c) => !have.has(`${c.subject}:${c.id}`))
    .filter(
      (c) =>
        !String(c.test ?? '')
          .split('; ')
          .every((t) => rerunFeatures.has(t.split(': ')[0])),
    )
    .map((c) => `${c.subject} ${c.id}`);
}

function vitest(files, env) {
  const r = spawnSync('npx', ['vitest', 'run', ...files], {
    stdio: 'inherit',
    env: { ...process.env, PS_VALIDATION_DIR: DIR, ...env },
  });
  return r.status ?? 1;
}

function main() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const runs = JSON.parse(readFileSync('src/validation/evidenceRuns.json', 'utf8'));
  const fail = (msg) => {
    console.error(msg);
    process.exit(1);
  };
  if (!named.length)
    fail('Name the test files to record: npm run validate:evidence:files -- <file> ...');
  for (const f of named) if (!existsSync(f)) fail(`No such file: ${f}`);
  const desktop = named.filter((f) => runs.desktop.some((d) => f.endsWith(d)));
  if (desktop.length)
    fail(`Desktop-R files (npm run validate:evidence:desktop): ${desktop.join(', ')}`);
  if (!existsSync(DIR) || !existsSync(OUT))
    fail(`No ${DIR}/ or ${OUT} from a full run: npm run validate:evidence`);

  // Old records of the named files and the fixture files, and of test files that are gone.
  const rerun = [...new Set([...named, ...runs.fixture])];
  for (const f of rerun) rmSync(join(DIR, evidenceFile(f)), { force: true });
  for (const r of readdirSync(DIR).filter((x) => x.endsWith('.json')))
    if (!sourcesOf(r).some(existsSync)) {
      console.log(`Removed the records of a test file that is gone: ${r}`);
      rmSync(join(DIR, r));
    }

  const webr = named.filter((f) => /\.webr\.test\.tsx?$/.test(f));
  const plain = named.filter((f) => !webr.includes(f) && !runs.fixture.includes(f));
  let status = 0;
  if (webr.length) status |= vitest(webr, { WEBR_TESTS: '1', WEBR_SLOW: '1' });
  status |= vitest([...plain, ...runs.fixture], {});

  const before = readFileSync(OUT, 'utf8');
  const merged = spawnSync('node', ['scripts/validation/evidence.mjs', DIR], { stdio: 'inherit' });
  const lost = lostChecks(
    JSON.parse(before).checks,
    JSON.parse(readFileSync(OUT, 'utf8')).checks,
    new Set(rerun.map(featureOf)),
  );
  if (lost.length) {
    writeFileSync(OUT, before);
    fail(
      `${DIR}/ lacks the records of ${lost.length} check(s) (${lost.slice(0, 5).join(', ')}${lost.length > 5 ? ', …' : ''}); ${OUT} left as it was. Run npm run validate:evidence.`,
    );
  }
  process.exit(status || (merged.status ?? 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
