// The home-screen examples' datasets from R packages, bundled with the app so that opening an example does not start
// R in the browser (and download the example's packages) just to read a table. For every example that loads its data
// with the bridge's ps_dataset (src/examples/packages.ts: no `file`, `packageFile` or `remote`), this script asks
// desktop R, through the helper's R worker and library (the R code the browser runs), for exactly what ps_dataset
// returns — names, columns, rows, factor levels, the example's `na` codes applied — and writes it to
//
//   public/examples/data/<package>/<name>[.na<codes>].json   one file per package / dataset / na codes
//   src/examples/bundledData.json                           the manifest: key (bundledDataKey) -> file, and the
//                                                           package versions the data were read from
//
// Files no example uses any more are removed. src/examples/bundledData.test.ts checks that the manifest covers every
// example and nothing else; src/examples/bundledData.webr.test.ts (native R) that each file equals ps_dataset's result.
//
//   node scripts/examples/bundle-data.mjs        (needs Rscript and the helper's library: pls-studio-helper setup,
//                                                 or PS_HELPER_LIBRARY)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = join(ROOT, 'public');
const DATA_DIR = join(PUBLIC, 'examples', 'data');
const MANIFEST = join(ROOT, 'src', 'examples', 'bundledData.json');
const MARK = '\x1ePSH\x1e';

/** A module of the app (TypeScript; `?raw` imports as text), loaded into this script. */
async function importApp(entry) {
  const raw = {
    name: 'raw',
    setup(b) {
      b.onResolve({ filter: /\?raw$/ }, (a) => ({
        path: join(a.resolveDir, a.path.replace(/\?raw$/, '')),
        namespace: 'raw',
      }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
        contents: readFileSync(a.path, 'utf8'),
        loader: 'text',
      }));
    },
  };
  const out = await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [raw],
    logLevel: 'warning',
    define: { 'import.meta.env': '{}' },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`
  );
}

/** The helper's R worker (helper/r/worker.R) on the bridge's sources, with the helper's library. */
function startWorker() {
  const library = process.env.PS_HELPER_LIBRARY ?? join(homedir(), '.pls-studio-helper', 'library');
  if (!existsSync(library))
    throw new Error(
      'No helper R library: run `pls-studio-helper setup`, or set PS_HELPER_LIBRARY.',
    );
  const proc = spawn(
    'Rscript',
    ['--vanilla', join(ROOT, 'helper', 'r', 'worker.R'), join(ROOT, 'src', 'rengine', 'R')],
    {
      env: { ...process.env, PS_HELPER_LIBRARY: library, R_LIBS_USER: library },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  const waiting = new Map();
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const at = line.indexOf(MARK);
      if (at < 0) continue;
      const rep = JSON.parse(line.slice(at + MARK.length));
      const key = rep.ready !== undefined ? '' : rep.id;
      waiting.get(key)?.(rep);
      waiting.delete(key);
    }
  });
  const reply = (id) => new Promise((resolve) => waiting.set(id, resolve));
  const ready = reply('');
  let next = 0;
  return {
    ready,
    call(fn, req, packages) {
      const id = `b${next++}`;
      const r = reply(id);
      proc.stdin.write(
        `${JSON.stringify({ id, fn, req: JSON.stringify(req), export: false, packages })}\n`,
      );
      return r;
    },
    stop: () => proc.stdin.end(),
  };
}

const { PACKAGE_EXAMPLES } = await importApp('src/examples/packages.ts');
const { R_LOADED, bundledDataKey, bundledDataPath } = await importApp(
  'src/examples/bundledDataKey.ts',
);
const wanted = new Map();
for (const ex of PACKAGE_EXAMPLES.filter((e) => R_LOADED(e.data)))
  wanted.set(bundledDataKey(ex.data), ex.data);

const worker = startWorker();
const started = await worker.ready;
if (!started.ready) throw new Error(started.message ?? 'R did not start.');
const datasets = {};
let bytes = 0;
for (const [key, d] of [...wanted].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const rep = await worker.call(
    'ps_dataset',
    { package: d.package, name: d.name, na: d.na ?? [] },
    [d.package],
  );
  if (!rep.ok) throw new Error(`${key}: ${rep.message ?? rep.kind} ${rep.packages ?? ''}`);
  const res = JSON.parse(rep.result);
  if (Object.keys(res).join() !== 'names,cols,n,levels')
    throw new Error(
      `${key}: unexpected result (${Object.keys(res).join(', ')}): ${res.warnings ?? ''}`,
    );
  // R's JSON as it is (re-serialising would turn R's -0 into 0).
  const file = bundledDataPath(d);
  const text = `${rep.result}\n`;
  mkdirSync(dirname(join(PUBLIC, file)), { recursive: true });
  writeFileSync(join(PUBLIC, file), text);
  bytes += text.length;
  datasets[key] = file;
}
const packages = [...new Set([...wanted.values()].map((d) => d.package))].sort();
const versions = await worker.call('ps_helper_packages', '', packages);
worker.stop();
writeFileSync(MANIFEST, `${JSON.stringify({ datasets, versions: versions.versions }, null, 2)}\n`);

// Files of datasets no example uses any more.
const keep = new Set(Object.values(datasets).map((f) => join(PUBLIC, f)));
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
for (const f of walk(DATA_DIR))
  if (!keep.has(f)) {
    rmSync(f);
    console.log(`removed ${relative(ROOT, f)}`);
  }
for (const e of readdirSync(DATA_DIR))
  if (!readdirSync(join(DATA_DIR, e)).length) rmSync(join(DATA_DIR, e), { recursive: true });
console.log(
  `${Object.keys(datasets).length} datasets of ${packages.length} packages, ${(bytes / 1024).toFixed(0)} KiB`,
);
