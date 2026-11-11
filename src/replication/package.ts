// A replication package: the data, an R script per chosen item (the model's
// estimation, its bootstrap, each analysis card), a script running them all,
// the PLS Studio project, optionally the HTML report, and a README with the
// exact R and package versions. Downloaded as one zip.

import { analysisType } from '../analyses/registry';
import { currentCtx, useAnalyses } from '../analyses/store';
import type { AnalysisCard } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { downloadBlob, safeFileName } from '../format';
import type { DataInfo, Method } from '../model/project';
import { serializeProject } from '../model/project';
import { useStore } from '../store';
import { makeZip, type ZipEntry } from './zip';

/** One thing the package can contain. */
export interface PackageItem {
  id: string;
  title: string;
  detail: string;
  kind: 'model' | 'bootstrap' | 'card';
  cardId?: string;
  scriptable: boolean;
}

/** What can go into the package: the model (and its bootstrap) and every analysis card. */
const METHOD_NAME: Record<Method, string> = {
  pls: 'PLS-SEM',
  cbsem: 'CB-SEM',
  process: 'conditional process analysis',
};

export function packageItems(): PackageItem[] {
  const s = useStore.getState();
  const items: PackageItem[] = [];
  const method = METHOD_NAME[s.settings.method];
  if (s.model.constructs.length) {
    items.push({
      id: 'model',
      title: `The model: ${method} estimation`,
      detail: 'the diagram on the Model tab, with the Model settings',
      kind: 'model',
      scriptable: true,
    });
    if (s.settings.method !== 'process')
      items.push({
        id: 'bootstrap',
        title: 'The model’s bootstrap',
        detail: `${s.settings.bootSamples} samples, seed ${s.settings.seed}`,
        kind: 'bootstrap',
        scriptable: true,
      });
  }
  for (const c of useAnalyses.getState().cards) {
    if (c.kind !== 'analysis') continue;
    const t = analysisType(c.type);
    if (!t || t.frozen) continue;
    items.push({
      id: c.id,
      cardId: c.id,
      kind: 'card',
      title: t.cardTitle?.(c.options as never) ?? t.title,
      detail: t.summary(c.options as never),
      scriptable: !!t.script,
    });
  }
  return items;
}

/** The dataset as CSV: numbers as they are, categories by their labels, missing values empty. */
export function datasetCsv(data: Dataset): string {
  const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  if (data.moments && data.cols.length === 0) {
    // A covariance matrix: one labelled row per variable; several groups: a first column with the group, N as a row.
    const g = data.moments.groups;
    if (g)
      return (
        [
          ['group', 'N', '', ...data.names].map(quote).join(','),
          ...g.flatMap((k) => [
            ...(k.means
              ? [[quote(k.label), String(k.n), 'mean', ...k.means.map(String)].join(',')]
              : []),
            ...data.names.map((n, i) =>
              [quote(k.label), String(k.n), quote(n), ...k.S[i].map(String)].join(','),
            ),
          ]),
        ].join('\n') + '\n'
      );
    const m = data.moments.means;
    return (
      [
        ['', ...data.names].map(quote).join(','),
        ...(m ? [['mean', ...m.map(String)].join(',')] : []),
        ...data.names.map((n, i) => [quote(n), ...data.moments!.S[i].map(String)].join(',')),
      ].join('\n') + '\n'
    );
  }
  const n = data.cols[0]?.length ?? 0;
  const cell = (k: number, r: number) => {
    const v = data.cols[k][r];
    if (Number.isNaN(v)) return '';
    const labels = data.categories?.[data.names[k]];
    return labels ? quote(labels[v - 1] ?? String(v)) : String(v);
  };
  const rows = Array.from({ length: n }, (_, r) => data.names.map((_, k) => cell(k, r)).join(','));
  return [data.names.map(quote).join(','), ...rows].join('\n') + '\n';
}

const BASE_PKGS = new Set([
  'base',
  'stats',
  'utils',
  'methods',
  'graphics',
  'grDevices',
  'datasets',
  'tools',
  'parallel',
  'splines',
  'stats4',
  'grid',
  'compiler',
]);
/** The R packages a script loads (library(), requireNamespace(), pkg::). */
export function scriptPackages(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(
    /library\(\s*([A-Za-z][A-Za-z0-9.]*)\s*[,)]|requireNamespace\(\s*"([A-Za-z][A-Za-z0-9.]*)"|\b([A-Za-z][A-Za-z0-9.]*):::?[A-Za-z.]/g,
  )) {
    const p = m[1] ?? m[2] ?? m[3];
    if (p && !BASE_PKGS.has(p)) out.add(p);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Versions in the R that computes (the desktop helper's R, or the browser's webR with its pinned library). */
async function versions(
  pkgs: string[],
): Promise<{ r: string; packages: { name: string; version: string | null }[] }> {
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<{
    r: string;
    packages: { name: string; version: string | null }[] | { name: string; version: string | null };
  }>('ps_versions', { packages: pkgs }, 'versions');
  // A single package comes as an object, not a list.
  let list: { name: string; version: string | null }[] = [];
  if (Array.isArray(raw.packages)) list = raw.packages;
  else if (raw.packages) list = [raw.packages];
  // In the browser a package is installed into R's session when first used: pinned versions fill the gaps.
  const missing = list.filter((p) => !p.version);
  if (missing.length) {
    try {
      const index = await (
        await fetch(`${import.meta.env.BASE_URL}webr/repo/bin/emscripten/contrib/4.6/PACKAGES`)
      ).text();
      const pinned = new Map(
        [...index.matchAll(/^Package: (\S+)\nVersion: (\S+)/gm)].map((m) => [m[1], m[2]]),
      );
      for (const p of missing) p.version = pinned.get(p.name) ?? null;
    } catch {
      /* left unknown */
    }
  }
  return { r: raw.r, packages: list };
}

const slug = (s: string) => safeFileName(s).toLowerCase().slice(0, 40) || 'analysis';

function readme(o: {
  project: string;
  date: Date;
  data: Dataset | null;
  info: DataInfo | null;
  dataFile: string | null;
  scripts: { file: string; title: string; detail: string }[];
  /** Items left out because they need the raw data (a package sharing the covariance matrix only). */
  needRaw?: { title: string; detail: string }[];
  covarianceOnly?: boolean;
  appOnly: { title: string; detail: string }[];
  r: string;
  packages: { name: string; version: string | null }[];
  report: boolean;
  settings: string[];
}): string {
  const L: string[] = [];
  L.push(
    `# Replication package: ${o.project}`,
    '',
    `Created with PLS Studio on ${o.date.toISOString().slice(0, 10)}. Every result can be reproduced in R with the scripts below; the PLS Studio project file reopens the analyses in PLS Studio.`,
    '',
  );
  L.push('## Contents', '', '```');
  L.push(`${safeFileName(o.project)}-replication/`, '├── README.md');
  if (o.dataFile) L.push(`├── data/${o.dataFile}`);
  L.push('├── R/', ...o.scripts.map((s) => `│   ├── ${s.file}`), '│   └── run-all.R');
  if (o.report) L.push('├── report/report.html');
  L.push('└── project/project.plsproj.json', '```', '');
  if (o.data && o.info) {
    const matrix = !!o.data.moments && o.data.cols.length === 0;
    L.push('## Data', '');
    if (matrix) {
      const groups = o.data.moments?.groups;
      const matrices = groups
        ? `one covariance matrix per group (${groups.map((g) => `${g.label}: N = ${g.n}`).join(', ')}) of`
        : 'a covariance matrix of';
      const origin = o.covarianceOnly
        ? ' (computed from the raw data over the complete rows, N − 1; the raw data are not shared: the matrix and N reproduce the CB-SEM estimation exactly)'
        : ` (from ${o.info.fileName})`;
      L.push(
        `\`data/${o.dataFile}\`: ${matrices} ${o.data.names.length} variables, N = ${o.info.rows}${origin}.`,
      );
    } else
      L.push(
        `\`data/${o.dataFile}\`: ${o.info.rows} observations of ${o.data.names.length} variables (from ${o.info.fileName}); ` +
          `empty cells are missing values (${o.info.missingCells} in all). Text columns are written with their labels.`,
      );
    if (o.info.reversed?.length)
      L.push(
        '',
        `Reverse-coded in PLS Studio (x → min + max − x): ${o.info.reversed.map((r) => `${r.name} (${r.min}–${r.max})`).join(', ')}. The CSV contains the recoded values.`,
      );
    if (o.info.droppedRows?.length)
      L.push(
        '',
        `Cases excluded in PLS Studio before the analyses: ${o.info.droppedRows.reduce((n, d) => n + d.at.length, 0)} (${o.info.droppedRows.map((d) => d.reason).join('; ')}; see the project file); the CSV contains the remaining cases.`,
      );
    if (o.info.excluded.length)
      L.push(
        '',
        `Columns of the original file not imported: ${o.info.excluded.map((e) => e.name).join(', ')}.`,
      );
    L.push('');
  }
  L.push(
    '## Scripts',
    '',
    'Each script is self-contained: it holds the data it needs (as text) and runs on its own. `R/run-all.R` runs them in order. The random seeds are set in the scripts, so bootstrap and permutation results repeat exactly with the same package versions.',
    '',
  );
  o.scripts.forEach((s) => L.push(`- \`R/${s.file}\`: ${s.title} (${s.detail}).`));
  if (o.needRaw?.length) {
    L.push(
      '',
      'Not included, because they need the raw data (this package shares the covariance matrix only):',
      '',
    );
    o.needRaw.forEach((a) => L.push(`- ${a.title} (${a.detail}).`));
  }
  if (o.appOnly.length) {
    L.push(
      '',
      'Computed in PLS Studio without an R script (closed-form formulas; see the project file):',
      '',
    );
    o.appOnly.forEach((a) => L.push(`- ${a.title} (${a.detail}).`));
  }
  L.push('', '## Settings', '', ...o.settings.map((s) => `- ${s}`), '');
  L.push(
    '## Software',
    '',
    `${o.r}. R packages (install these versions to reproduce the results exactly):`,
    '',
    '| Package | Version |',
    '|---|---|',
    ...o.packages.map((p) => `| ${p.name} | ${p.version ?? 'unknown'} |`),
    '',
    'To install a specific version: `remotes::install_version("lavaan", version = "0.6-19")`.',
    '',
  );
  L.push(
    '## Licence',
    '',
    'State the licence of the data and scripts here (e.g. CC BY 4.0 for the data, MIT for the scripts), and how to cite the study.',
    '',
  );
  return L.join('\n');
}

/** Build and download the zip for the chosen items. */
/** What the package shares of the data: the dataset, its covariance matrix only (CB-SEM), or nothing. */
export type DataSharing = 'full' | 'covariance' | 'none';

export async function createPackage(
  chosen: Set<string>,
  opts: { data: boolean | DataSharing; report: boolean },
  progress: (text: string) => void = () => {},
) {
  const p = await buildPackage(chosen, opts, progress);
  downloadBlob(p.name, p.zip);
  return p;
}

/** The zip for the chosen items; report: include the HTML report (the Analyses tab must be showing). */
export async function buildPackage(
  chosen: Set<string>,
  opts: { data: boolean | DataSharing; report: boolean },
  progress: (text: string) => void = () => {},
) {
  const s = useStore.getState();
  let sharing: DataSharing;
  if (opts.data === true) sharing = 'full';
  else if (opts.data === false) sharing = 'none';
  else sharing = opts.data;
  const items = packageItems().filter((i) => chosen.has(i.id));
  const { buildRScript, covarianceOnly } = await import('../io');
  // Covariance matrix instead of the raw data: the model is refitted from it; everything that needs cases stays out.
  const cov = sharing === 'covariance' ? covarianceOnly() : null;
  let shared: { data: typeof s.data; info: typeof s.dataInfo; model: typeof s.model };
  if (cov) shared = { data: cov.data, info: cov.info, model: cov.model };
  else if (sharing === 'full') shared = { data: s.data, info: s.dataInfo, model: s.model };
  else shared = { data: null, info: null, model: s.model };
  const root = `${safeFileName(s.projectName)}-replication`;
  const files: ZipEntry[] = [];
  const scripts: { file: string; title: string; detail: string; text: string }[] = [];
  const appOnly: { title: string; detail: string }[] = [];
  const needRaw: { title: string; detail: string }[] = [];
  const ctx = currentCtx();
  let k = 0;
  for (const it of items) {
    progress(`Writing the script for ${it.title}…`);
    const num = String(++k).padStart(2, '0');
    if (cov && it.kind !== 'model') {
      needRaw.push({ title: it.title, detail: it.detail });
      k--;
      continue;
    }
    if (it.kind === 'model' || it.kind === 'bootstrap') {
      const r = await buildRScript(it.kind, cov ? { data: cov.data, model: cov.model } : {});
      scripts.push({
        file: `${num}-${it.kind === 'model' ? 'model' : 'bootstrap'}.R`,
        title: it.title,
        detail: it.detail,
        text: r.text,
      });
      continue;
    }
    const card = useAnalyses.getState().cards.find((c) => c.id === it.cardId) as AnalysisCard;
    const t = analysisType(card.type)!;
    if (!t.script) {
      appOnly.push({ title: it.title, detail: it.detail });
      k--;
      continue;
    }
    const why = t.blocked(card.options, ctx);
    if (why) throw new Error(`${it.title}: ${why}`);
    scripts.push({
      file: `${num}-${slug(it.title)}.R`,
      title: it.title,
      detail: it.detail,
      text: await t.script(card.options, ctx),
    });
  }
  for (const sc of scripts) files.push({ path: `${root}/R/${sc.file}`, data: sc.text });
  files.push({
    path: `${root}/R/run-all.R`,
    data: [
      '# Runs every script of this replication package in order (each is self-contained).',
      '# Set the working directory to this folder (the R/ folder) first, e.g. setwd("path/to/R").',
      ...scripts.map(
        (sc) =>
          `message("== ${sc.file}"); local(source("${sc.file}", echo = TRUE, max.deparse.length = Inf))`,
      ),
      '',
    ].join('\n'),
  });
  const dataFile = shared.data
    ? `${safeFileName(shared.info?.fileName.replace(/\.[A-Za-z]+$/, '') ?? 'data')}.csv`
    : null;
  if (dataFile && shared.data)
    files.push({ path: `${root}/data/${dataFile}`, data: datasetCsv(shared.data) });
  files.push({
    path: `${root}/project/project.plsproj.json`,
    data: serializeProject(
      shared.model,
      s.settings,
      shared.data,
      shared.info,
      null,
      cov ? [] : useAnalyses.getState().cards,
    ),
  });
  if (opts.report) {
    progress('Adding the report…');
    const { buildReport } = await import('../analyses/report');
    files.push({
      path: `${root}/report/report.html`,
      data: buildReport(useAnalyses.getState().cards, s.projectName),
    });
  }
  progress('Reading the R and package versions…');
  const v = await versions([...new Set(scripts.flatMap((sc) => scriptPackages(sc.text)))]);
  const st = s.settings;
  let methodSetting = 'conditional process analysis';
  if (st.method === 'pls') methodSetting = `PLS-SEM (${st.plsPackage})`;
  else if (st.method === 'cbsem') methodSetting = `CB-SEM, ${st.estimator}`;
  const settings = [
    `Method: ${methodSetting}`,
    `Missing values: ${st.missing}`,
    `Bootstrap: ${st.bootSamples} samples, seed ${st.seed}, ${Math.round(st.confidence * 100)}% ${st.bootInterval === 'bca' ? 'BCa' : 'percentile'} intervals, ${st.bootTails === 'one' ? 'one' : 'two'}-tailed tests`,
  ];
  files.unshift({
    path: `${root}/README.md`,
    data: readme({
      project: s.projectName,
      date: new Date(),
      data: shared.data,
      info: shared.info,
      dataFile,
      scripts,
      appOnly,
      needRaw,
      covarianceOnly: !!cov,
      r: v.r,
      packages: v.packages,
      report: opts.report,
      settings,
    }),
  });
  progress('Compressing…');
  const zip = await makeZip(files);
  return { name: `${root}.zip`, zip, files: files.map((f) => f.path), scripts: scripts.length };
}
