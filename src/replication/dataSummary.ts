// A data summary for secondary analysis (APA JARS-Quant, SEM: "report the data needed to
// reproduce the analysis"): the sample statistics lavaan fits the CB-SEM model to, as CSV files
// with the model syntax, an R script that refits the model from them, the raw-data estimates to
// check that refit against, and a README. It holds no case-level data.

import { csvCell } from '../format';
import type { DataSummaryGroup, DataSummaryResult } from '../rengine/cbExtras';
import type { ZipEntry } from './zip';

/** A number as CSV text: full precision (shortest round trip), NA when missing. */
const num = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NA';

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

/** A square matrix with its names as the header row and as the first column. */
function matrixCsv(names: string[], m: number[][]): string {
  const header = ['', ...names].map(csvCell).join(',');
  const rows = m.map((row, i) => [csvCell(names[i]), ...row.map(num)].join(','));
  return [header, ...rows].join('\n') + '\n';
}

/** Whether any group has ordinal indicators (then the statistics are polychoric). */
export const summaryIsOrdinal = (r: DataSummaryResult) =>
  r.groups.some((g) => g.ordinal.some(Boolean));

/** The file-name suffix of a group: none for a single group, -group1, -group2, ... otherwise. */
export const groupSuffix = (r: DataSummaryResult, k: number) =>
  r.groups.length > 1 ? `-group${k + 1}` : '';

function groupFiles(r: DataSummaryResult, g: DataSummaryGroup, k: number): ZipEntry[] {
  const sfx = groupSuffix(r, k);
  const descriptives = csv([
    ['variable', 'ordinal', 'n_valid', 'mean', 'sd'],
    ...g.variables.map((v, i) => [
      v,
      g.ordinal[i] ? 'yes' : 'no',
      num(g.valid[i]),
      num(g.mean[i]),
      num(g.sd[i]),
    ]),
  ]);
  const files: ZipEntry[] = [
    { path: `descriptives${sfx}.csv`, data: descriptives },
    { path: `correlations${sfx}.csv`, data: matrixCsv(g.variables, g.cor) },
  ];
  if (g.cov && g.means) {
    files.push({ path: `covariances${sfx}.csv`, data: matrixCsv(g.variables, g.cov) });
    const means = csv([['variable', 'mean'], ...g.variables.map((v, i) => [v, num(g.means![i])])]);
    files.push({ path: `means${sfx}.csv`, data: means });
  }
  if (g.thresholds) {
    const t = g.thresholds;
    const rows = t.variable.map((v, i) => [v, num(t.index[i]), num(t.value[i])]);
    files.push({
      path: `thresholds${sfx}.csv`,
      data: csv([['variable', 'threshold', 'value'], ...rows]),
    });
  }
  if (g.nacov && g.nacovNames && g.wlsV) {
    files.push({ path: `nacov${sfx}.csv`, data: matrixCsv(g.nacovNames, g.nacov) });
    files.push({ path: `wls_v${sfx}.csv`, data: matrixCsv(g.nacovNames, g.wlsV) });
  }
  return files;
}

/** The R script in the package: reads the statistics and refits the model with lavaan. */
export function refitScript(r: DataSummaryResult): string {
  const ordinal = summaryIsOrdinal(r);
  const head = [
    '# Refit the model from the data summary (no raw data needed): run it in the folder of these',
    '# files, e.g. Rscript refit.R. It reads the sample statistics, fits the model with lavaan and',
    '# compares the estimates with those from the raw data (estimates.csv).',
    'suppressPackageStartupMessages(library(lavaan))',
    'model <- paste(readLines("model.lav"), collapse = "\\n")',
    'groups <- read.csv("groups.csv", stringsAsFactors = FALSE, check.names = FALSE)',
    'suffix <- if (nrow(groups) > 1) paste0("-group", groups$group) else ""',
    'read_matrix <- function(file) as.matrix(read.csv(file, row.names = 1, check.names = FALSE))',
    '# One group: the statistics themselves; several: lists named by the group labels',
    'by_group <- function(x) if (length(x) == 1) x[[1]] else setNames(x, groups$label)',
    'N <- groups$n',
  ];
  const continuous = [
    '# Covariances (divisor N - 1; lavaan rescales them by (N - 1) / N) and means',
    'S_list <- lapply(suffix, function(s) read_matrix(paste0("covariances", s, ".csv")))',
    'M_list <- lapply(suffix, function(s) {',
    '  m <- read.csv(paste0("means", s, ".csv"), stringsAsFactors = FALSE, check.names = FALSE)',
    '  setNames(m$mean, m$variable)',
    '})',
    'S <- by_group(S_list)',
    'M <- by_group(M_list)',
  ];
  const categorical = [
    '# Polychoric correlations, thresholds (each with the position of its variable: th.idx),',
    '# NACOV and the weight matrix; the latent responses have means 0',
    'R_list <- lapply(suffix, function(s) read_matrix(paste0("correlations", s, ".csv")))',
    'TH_list <- lapply(seq_along(suffix), function(k) {',
    '  t <- read.csv(paste0("thresholds", suffix[k], ".csv"), stringsAsFactors = FALSE, check.names = FALSE)',
    '  th <- setNames(t$value, paste0(t$variable, "|t", t$threshold))',
    '  # (lavaan looks the positions up by name)',
    '  attr(th, "th.idx") <- setNames(match(t$variable, rownames(R_list[[k]])), names(th))',
    '  th',
    '})',
    'M_list <- lapply(R_list, function(m) setNames(rep(0, nrow(m)), rownames(m)))',
    'NACOV_list <- lapply(suffix, function(s) read_matrix(paste0("nacov", s, ".csv")))',
    'WLS_V_list <- lapply(suffix, function(s) read_matrix(paste0("wls_v", s, ".csv")))',
    'R <- by_group(R_list)',
    'TH <- by_group(TH_list)',
    'M <- by_group(M_list)',
    'NACOV <- by_group(NACOV_list)',
    'WLS_V <- by_group(WLS_V_list)',
  ];
  const check = [
    '# The estimates from the raw data, matched by parameter',
    'ref <- read.csv("estimates.csv", stringsAsFactors = FALSE, check.names = FALSE)',
    '# (an operator starting with = is written with a leading apostrophe, safe in spreadsheets)',
    'ref$op <- sub("^\'", "", ref$op)',
    'pe <- parameterEstimates(fit, ci = FALSE)',
    'if (is.null(pe$group)) pe$group <- 1',
    'key <- function(d) paste(d$lhs, d$op, d$rhs, d$group)',
    'at <- match(key(ref), key(pe))',
    'cat("Largest difference from the raw-data estimates:", max(abs(pe$est[at] - ref$est), na.rm = TRUE), "\\n")',
  ];
  return (
    [
      ...head,
      ...(ordinal ? categorical : continuous),
      r.refitCall,
      ...r.refitAfter,
      'summary(fit)',
      ...check,
    ].join('\n') + '\n'
  );
}

function readme(r: DataSummaryResult, projectName: string, files: ZipEntry[]): string {
  const ordinal = summaryIsOrdinal(r);
  const mixed = ordinal && r.groups.some((g) => g.ordinal.some((o) => !o));
  const describe: Record<string, string> = {
    'groups.csv': 'group number, group label and N (the analysed cases) of each group.',
    descriptives:
      'each variable: whether it is ordinal, its number of valid values, mean and SD (n − 1) ' +
      'on its own scale (category codes for ordinal variables) over the analysed cases.',
    correlations: ordinal
      ? 'the correlations lavaan fits: polychoric between ordinal variables, polyserial between an ordinal ' +
        'and a continuous one, Pearson between continuous ones (a continuous variable keeps its variance ' +
        'on the diagonal). Pass as sample.cov.'
      : 'the Pearson correlation matrix.',
    covariances: 'the covariance matrix (divisor N − 1). Pass as sample.cov.',
    means: 'the means. Pass as sample.mean.',
    thresholds:
      'the thresholds of each ordinal variable (standard-normal scale). Pass as sample.th, ' +
      "with the attribute th.idx (the position of each threshold's variable, see refit.R).",
    nacov:
      'N times the asymptotic covariance matrix of the thresholds and correlations ' +
      '(lavInspect(fit, "gamma")). Pass as NACOV.',
    wls_v: `the weight matrix of the ${r.requestedEstimator} estimator (lavInspect(fit, "wls.v")). Pass as WLS.V.`,
    'model.lav': 'the lavaan model syntax.',
    'estimates.csv':
      'the estimates and standard errors from the raw data (lavaan parameterEstimates), ' +
      "to check a refit against (the operator =~ is written '=~, safe in spreadsheets).",
    'refit.R':
      'reads these files, refits the model with lavaan and compares its estimates with estimates.csv.',
  };
  const fileLines = files.map((f) => {
    const key = Object.keys(describe).find(
      (k) => f.path === k || f.path.startsWith(`${k}-`) || f.path === `${k}.csv`,
    );
    return `  ${f.path}: ${key ? describe[key] : ''}`;
  });
  const groups = r.groups.map(
    (g, k) => `  ${r.groups.length > 1 ? `group ${k + 1} (${g.label})` : 'all cases'}: N = ${g.n}`,
  );
  const renamed = r.names.lavaan
    .map((l, i) => [l, r.names.app[i]] as const)
    .filter(([l, a]) => l !== a)
    .map(([l, a]) => `  ${l} = ${a}`);
  const call = ordinal
    ? 'sem(model, sample.cov = R, sample.th = TH, sample.mean = M, sample.nobs = N, NACOV = NACOV, WLS.V = WLS_V, ...)'
    : 'sem(model, sample.cov = S, sample.mean = M, sample.nobs = N, ...)';
  const notes: string[] = [];
  if (!ordinal && r.requestedEstimator !== r.refitEstimator) {
    notes.push(
      `The model was estimated with ${r.requestedEstimator}; robust standard errors and test statistics need ` +
        'the raw data, so the refit uses ML: the same estimates and ML chi-square, ML standard errors.',
    );
  }
  if (r.missing !== 'listwise') {
    notes.push(
      `Missing values were handled by lavaan missing = "${r.missing}": the statistics are its estimates ` +
        'of the means and covariances from all cases. A refit reproduces the estimates; its standard errors ' +
        'treat the statistics as if from complete data.',
    );
  }
  if (mixed) {
    notes.push(
      'The model has both ordinal and continuous indicators. lavaan (0.7-3) does not refit such a model ' +
        'from summary statistics; the files still document the statistics it was fitted to.',
    );
  }
  return [
    `Data summary for secondary analysis: ${projectName}`,
    '',
    'The sample statistics the CB-SEM model was fitted to, so that others can reproduce the analysis',
    'without the raw data (APA JARS-Quant for structural equation modeling: report the data, or a',
    'summary from which the analysis can be reproduced). The package contains no case-level data.',
    '',
    `Estimated with lavaan ${r.engine.version} (${r.requestedEstimator}); χ²(${r.df}) = ${num(r.chisq)}.`,
    'Variables are named as in the lavaan syntax (model.lav).',
    '',
    'Groups and N:',
    ...groups,
    '',
    'Files:',
    ...fileLines,
    ...(renamed.length ? ['', 'Names in these files and in the project:', ...renamed] : []),
    '',
    'Refitting in lavaan (refit.R does all of this):',
    `  ${call}`,
    `  The exact call: ${r.refitCall.replace(/^fit <- /, '')}`,
    '  With several groups, sample.cov, sample.mean (and sample.th, NACOV, WLS.V) are lists, one',
    "  element per group, named by the group labels, and sample.nobs is the vector of the groups' N.",
    ...(notes.length ? ['', 'Notes:', ...notes.map((n) => `  - ${n}`)] : []),
    '',
  ].join('\n');
}

/** The files of the data summary package (README.txt last describes the others). */
export function dataSummaryFiles(r: DataSummaryResult, projectName: string): ZipEntry[] {
  const groups = csv([
    ['group', 'label', 'n'],
    ...r.groups.map((g, k) => [k + 1, g.label, num(g.n)]),
  ]);
  const e = r.estimates;
  const estimates = csv([
    ['lhs', 'op', 'rhs', 'group', 'est', 'se'],
    ...e.lhs.map((l, i) => [l, e.op[i], e.rhs[i], num(e.group[i]), num(e.est[i]), num(e.se[i])]),
  ]);
  const files: ZipEntry[] = [
    { path: 'groups.csv', data: groups },
    ...r.groups.flatMap((g, k) => groupFiles(r, g, k)),
    { path: 'model.lav', data: r.syntax.join('\n') + '\n' },
    { path: 'estimates.csv', data: estimates },
    { path: 'refit.R', data: refitScript(r) },
  ];
  return [...files, { path: 'README.txt', data: readme(r, projectName, files) }];
}
