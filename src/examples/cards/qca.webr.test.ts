// The examples of cards/qca.ts, each run through the fsQCA card's own run() on the example's data (loaded from the
// QCA package as the app loads it), and compared with the results the QCA package prints on its help pages
// (?minimize, ?pof: three decimals, so tolerance 5e-4; the solution terms as exact strings) and with the package
// called directly in the same R (tolerance 1e-6). Run with WEBR_TESTS=1 (PS_NATIVE_R=1 runs the card in desktop R).

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall, type RPackage } from '../../rengine/bridge';
import { qcaFormula, type QcaModel, type QcaResult, type QcaSolution } from '../../rengine/qca';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, cleanRun, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const PRINTED = 5e-4;
const EXACT = 1e-6;

async function load(pkg: string, name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: pkg, name, na: [] }, pkg as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
}

/** The example as the app opens it: its data and its card with the example's options. */
async function open(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method: 'fsQCA', packages: ['QCA'], definition: ex });
  const data = await load(ex.data.package, ex.data.name);
  const ctx: AnalysisCtx = { data, info: null, settings: exampleSettings(DEFAULT_SETTINGS, ex.settings), pls: null, projectName: ex.title };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options as never, ctx), `${id}: the card is ready to run`).toBeNull();
  return { ex, ctx, t, options, run: () => t.run(options as never, ctx, () => {}) as Promise<QcaResult>, script: () => t.script!(options as never, ctx) };
}
const sameR = <T>(code: string) => withR(['jsonlite', 'QCA'], { common: commonR }, (webR) => callJson(webR, code, null)) as Promise<T>;

type Printed = [term: string, inclS: number, PRI: number, covS: number, covU: number | null];
/** A model's terms, in QCA's order, with the parameters of fit the help page prints. */
function printedModel(what: string, m: QcaModel, terms: Printed[], sol: [number, number, number]) {
  same(`${what}: terms`, m.terms.map((t) => t.term).join(' + '), terms.map((t) => t[0]).join(' + '));
  terms.forEach(([term, inclS, pri, covS, covU], i) => {
    near(`${what}, ${term}: inclS`, m.terms[i].inclS, inclS, PRINTED);
    near(`${what}, ${term}: PRI`, m.terms[i].PRI, pri, PRINTED);
    near(`${what}, ${term}: covS`, m.terms[i].covS, covS, PRINTED);
    if (covU === null) same(`${what}, ${term}: covU`, m.terms[i].covU === null ? '-' : 'number', '-');
    else near(`${what}, ${term}: covU`, m.terms[i].covU!, covU, PRINTED);
  });
  near(`${what}: solution inclS`, m.inclS, sol[0], PRINTED);
  near(`${what}: solution PRI`, m.PRI, sol[1], PRINTED);
  near(`${what}: solution covS`, m.covS, sol[2], PRINTED);
}
const only = (s: QcaSolution | null, what: string): QcaModel => { same(`${what}: models`, s?.models.length ?? 0, 1); return s!.models[0]; };

it('qca-lf-lipset: ?minimize’s fuzzy-set Lipset analysis (truth table, conservative, parsimonious and intermediate solutions)', async () => {
  const { run, script } = await open('qca-lf-lipset');
  const r = await run();
  against({ label: 'QCA’s ?minimize help page: truthTable(LF, SURV, incl.cut = 0.8) and its three solutions, as printed (3 decimals)', level: 'native', url: 'https://rdrr.io/cran/QCA/man/minimize.html' });
  same('cases', r.n, 18);
  same('truth table: observed configurations, in QCA’s order', r.truthTable.rows.map((row) => row.id).join(' '), '32 22 24 6 5 31 23 2 1');
  same('truth table: OUT', r.truthTable.rows.map((row) => row.out).join(''), '110000000');
  same('truth table: n', r.truthTable.rows.map((row) => row.n).join(' '), '4 2 2 1 2 1 1 2 3');
  [0.904, 0.804, 0.709, 0.529, 0.521, 0.445, 0.378, 0.278, 0.216].forEach((v, i) => near(`truth table row ${r.truthTable.rows[i].id}: incl`, r.truthTable.rows[i].incl!, v, PRINTED));
  [0.886, 0.719, 0.634, 0.228, 0.113, 0.050, 0.040, 0.000, 0.000].forEach((v, i) => near(`truth table row ${r.truthTable.rows[i].id}: PRI`, r.truthTable.rows[i].pri!, v, PRINTED));
  same('remainders', r.truthTable.remainders, 23);
  printedModel('conservative solution', only(r.solutions.complex, 'conservative solution'),
    [['DEV*URB*LIT*IND*STB', 0.904, 0.886, 0.454, 0.393], ['DEV*~URB*LIT*~IND*STB', 0.804, 0.719, 0.265, 0.204]], [0.870, 0.843, 0.658]);
  printedModel('parsimonious solution', only(r.solutions.parsimonious, 'parsimonious solution'),
    [['DEV*~IND', 0.815, 0.721, 0.284, 0.194], ['URB*STB', 0.874, 0.845, 0.520, 0.430]], [0.850, 0.819, 0.714]);
  same('parsimonious solution: simplifying assumptions', r.solutions.parsimonious!.counterfactuals, 12);
  printedModel('intermediate solution (dir.exp = c(DEV, URB, LIT, IND, STB))', only(r.solutions.intermediate, 'intermediate solution'),
    [['DEV*URB*LIT*STB', 0.901, 0.879, 0.468, 0.378], ['DEV*LIT*~IND*STB', 0.814, 0.721, 0.282, 0.191]], [0.866, 0.839, 0.660]);
  same('parsimonious solution as QCA writes it', qcaFormula(r.solutions.parsimonious!.models[0], r.outcome, r.negated), 'DEV*~IND + URB*STB -> SURV');
  // The package called directly on the help page's code, in the same R: every parameter of fit to 1e-6.
  against({ label: 'QCA::truthTable, minimize and pof called directly in the same R (?minimize, LF)', level: 'native' });
  const ref = await sameR<{ c: number[][]; cs: number[]; p: number[][]; ps: number[]; i: number[][]; is: number[]; nec: number[][]; necn: number[][] }>(
    'suppressPackageStartupMessages(library(QCA)); tt <- truthTable(LF, "SURV", incl.cut = 0.8, sort.by = "incl"); ' +
    'f <- function(m) list(unname(as.matrix(m$IC$incl.cov[, 1:4])), unname(unlist(m$IC$sol.incl.cov))); ' +
    'cc <- f(minimize(tt, details = TRUE)); pp <- f(minimize(tt, include = "?", details = TRUE)); ii <- f(minimize(tt, include = "?", dir.exp = "1,1,1,1,1", details = TRUE)$i.sol$C1P1); ' +
    'ps_json(list(c = cc[[1]], cs = cc[[2]], p = pp[[1]], ps = pp[[2]], i = ii[[1]], is = ii[[2]], nec = unname(as.matrix(pof(LF[, 1:5], LF$SURV)$incl.cov)), necn = unname(as.matrix(pof(1 - LF[, 1:5], LF$SURV)$incl.cov))))');
  const exact = (what: string, m: QcaModel, inc: number[][], sol: number[]) => {
    m.terms.forEach((t, i) => (['inclS', 'PRI', 'covS', 'covU'] as const).forEach((k, j) => near(`${what}, ${t.term}: ${k} (same R)`, t[k]!, inc[i][j], EXACT)));
    (['inclS', 'PRI', 'covS'] as const).forEach((k, j) => near(`${what}: solution ${k} (same R)`, m[k], sol[j], EXACT));
  };
  exact('conservative', r.solutions.complex!.models[0], ref.c, ref.cs);
  exact('parsimonious', r.solutions.parsimonious!.models[0], ref.p, ref.ps);
  exact('intermediate', r.solutions.intermediate!.models[0], ref.i, ref.is);
  r.necessity.forEach((k, i) => { const row = i < 5 ? ref.nec[i] : ref.necn[i - 5]; near(`necessity of ${k.condition}: inclN`, k.inclN, row[0], EXACT); near(`necessity of ${k.condition}: RoN`, k.RoN, row[1], EXACT); near(`necessity of ${k.condition}: covN`, k.covN, row[2], EXACT); });
  same('necessity rows: each condition and its negation', r.necessity.map((k) => k.condition).join(' '), 'DEV URB LIT IND STB ~DEV ~URB ~LIT ~IND ~STB');
  cleanRun(r.warnings.length);
  const s = await script();
  expect(s).toContain('truthTable(cal, outcome = outcome, conditions = conditions, incl.cut = 0.8, n.cut = 1, pri.cut = 0, sort.by = "incl", show.cases = TRUE)');
  expect(s).toContain('minimize(tt, include = "?", dir.exp = "1,1,1,1,1", details = TRUE)');
  expect(s).toContain('cal$DEV <- data$DEV  # already calibrated');
}, 900_000);

it('qca-lc-lipset-crisp: ?minimize’s crisp-set Lipset analysis (Rihoux & De Meur 2009, p. 57)', async () => {
  const { run } = await open('qca-lc-lipset-crisp');
  const r = await run();
  against({ label: 'QCA’s ?minimize help page: truthTable(LC, SURV, sort.by = "incl, n"), the conservative and parsimonious solutions, as printed', level: 'native', url: 'https://rdrr.io/cran/QCA/man/minimize.html' });
  same('truth table: configurations', r.truthTable.rows.map((row) => `${row.id}:${row.out}:${row.n}`).join(' '), '32:1:4 22:1:2 24:1:2 1:0:3 2:0:2 5:0:2 6:0:1 23:0:1 31:0:1');
  printedModel('conservative solution', only(r.solutions.complex, 'conservative solution'), [['DEV*~URB*LIT*STB', 1, 1, 0.5, 0.25], ['DEV*LIT*IND*STB', 1, 1, 0.75, 0.5]], [1, 1, 1]);
  printedModel('parsimonious solution', only(r.solutions.parsimonious, 'parsimonious solution'), [['DEV*STB', 1, 1, 1, null]], [1, 1, 1]);
  same('parsimonious solution: simplifying assumptions', r.solutions.parsimonious!.counterfactuals, 5);
  same('crisp sets recognised', r.calibration.every((k) => k.crisp && k.method === 'none') ? 'yes' : 'no', 'yes');
  same('no intermediate solution without expectations', r.solutions.intermediate === null ? 'none' : 'reported', 'none');
  cleanRun(r.warnings.length);
}, 900_000);

it('qca-lc-lipset-negated: ?minimize with the negated outcome (~SURV)', async () => {
  const { run, script } = await open('qca-lc-lipset-negated');
  const r = await run();
  against({ label: 'QCA’s ?minimize help page: truthTable(LC, ~SURV) and its conservative and parsimonious solutions, as printed', level: 'native', url: 'https://rdrr.io/cran/QCA/man/minimize.html' });
  same('the outcome is negated', r.negated ? '~SURV' : 'SURV', '~SURV');
  printedModel('conservative solution', only(r.solutions.complex, 'conservative solution'), [['~DEV*~URB*~IND', 1, 1, 0.8, 0.8], ['DEV*LIT*IND*~STB', 1, 1, 0.2, 0.2]], [1, 1, 1]);
  printedModel('parsimonious solution', only(r.solutions.parsimonious, 'parsimonious solution'), [['~DEV', 1, 1, 0.8, 0.3], ['~STB', 1, 1, 0.7, 0.2]], [1, 1, 1]);
  same('parsimonious solution as QCA writes it', qcaFormula(r.solutions.parsimonious!.models[0], r.outcome, r.negated), '~DEV + ~STB -> ~SURV');
  same('truth table: rows coded 1', r.truthTable.counts.out1, 6);
  cleanRun(r.warnings.length);
  expect(await script()).toContain('outcome <- "~SURV"');
}, 900_000);

const CVF_MODELS: [string[], [number, number, number]][] = [
  [['~NATPRIDE', '~DEMOC*ETHFRACT*POLDIS', 'DEMOC*ETHFRACT*GEOCON', 'DEMOC*GEOCON*POLDIS'], [0.877, 0.777, 0.805]],
  [['~NATPRIDE', '~DEMOC*ETHFRACT*POLDIS', 'DEMOC*ETHFRACT*~POLDIS', 'DEMOC*GEOCON*POLDIS'], [0.877, 0.777, 0.805]],
  [['~NATPRIDE', 'DEMOC*ETHFRACT*GEOCON', 'DEMOC*GEOCON*POLDIS', 'ETHFRACT*GEOCON*POLDIS'], [0.879, 0.782, 0.810]],
  [['~NATPRIDE', 'DEMOC*ETHFRACT*~POLDIS', 'DEMOC*GEOCON*POLDIS', 'ETHFRACT*GEOCON*POLDIS'], [0.879, 0.782, 0.810]],
];

it('qca-cvf-protest: ?pof’s analysis of necessity and ?minimize’s parsimonious solution with four models', async () => {
  const { run } = await open('qca-cvf-protest');
  const r = await run();
  against({ label: 'QCA’s ?pof help page: pof(conds, PROTEST) and pof(1 - conds, PROTEST), as printed', level: 'native', url: 'https://rdrr.io/cran/QCA/man/pof.html' });
  const nec: Record<string, [number, number, number]> = {
    DEMOC: [0.741, 0.758, 0.713], ETHFRACT: [0.680, 0.830, 0.755], GEOCON: [0.904, 0.492, 0.624], POLDIS: [0.518, 0.878, 0.744], NATPRIDE: [0.708, 0.523, 0.539],
    '~DEMOC': [0.564, 0.736, 0.601], '~ETHFRACT': [0.661, 0.684, 0.614], '~GEOCON': [0.317, 0.873, 0.601], '~POLDIS': [0.631, 0.517, 0.493], '~NATPRIDE': [0.597, 0.952, 0.899],
  };
  same('necessity rows', r.necessity.map((k) => k.condition).join(' '), Object.keys(nec).join(' '));
  for (const k of r.necessity) { near(`necessity of ${k.condition}: inclN`, k.inclN, nec[k.condition][0], PRINTED); near(`necessity of ${k.condition}: RoN`, k.RoN, nec[k.condition][1], PRINTED); near(`necessity of ${k.condition}: covN`, k.covN, nec[k.condition][2], PRINTED); }
  against({ label: 'QCA’s ?minimize help page: truthTable(CVF, PROTEST, incl.cut = 0.8), the parsimonious solution’s four models and the conservative solution, as printed', level: 'native', url: 'https://rdrr.io/cran/QCA/man/minimize.html' });
  const p = r.solutions.parsimonious!;
  same('parsimonious solution: models (model ambiguity)', p.models.length, 4);
  same('essential prime implicants', p.essential.join(' + '), '~NATPRIDE + DEMOC*GEOCON*POLDIS');
  CVF_MODELS.forEach(([terms, sol], i) => {
    same(`M${i + 1}: terms`, p.models[i].terms.map((t) => t.term).join(' + '), terms.join(' + '));
    near(`M${i + 1}: solution inclS`, p.models[i].inclS, sol[0], PRINTED); near(`M${i + 1}: solution PRI`, p.models[i].PRI, sol[1], PRINTED); near(`M${i + 1}: solution covS`, p.models[i].covS, sol[2], PRINTED);
  });
  printedModel('parsimonious solution, M1', p.models[0], [['~NATPRIDE', 0.899, 0.807, 0.597, 0.132], ['~DEMOC*ETHFRACT*POLDIS', 0.842, 0.718, 0.299, 0.040], ['DEMOC*ETHFRACT*GEOCON', 0.935, 0.826, 0.480, 0.085], ['DEMOC*GEOCON*POLDIS', 0.906, 0.805, 0.342, 0.065]], [0.877, 0.777, 0.805]);
  printedModel('conservative solution', only(r.solutions.complex, 'conservative solution'), [
    ['DEMOC*ETHFRACT*GEOCON', 0.935, 0.826, 0.480, 0.134], ['ETHFRACT*GEOCON*POLDIS', 0.869, 0.786, 0.365, 0.109], ['DEMOC*ETHFRACT*POLDIS*~NATPRIDE', 0.964, 0.914, 0.271, 0.033],
    ['DEMOC*GEOCON*POLDIS*NATPRIDE', 0.909, 0.778, 0.300, 0.066], ['~DEMOC*~ETHFRACT*GEOCON*~POLDIS*~NATPRIDE', 0.874, 0.584, 0.269, 0.021]], [0.899, 0.808, 0.712]);
  against({ label: 'QCA::minimize called directly in the same R (?minimize, CVF): each model’s parameters of fit', level: 'native' });
  const ref = await sameR<{ sol: number[][]; nec: number[][] }>('suppressPackageStartupMessages(library(QCA)); m <- minimize(truthTable(CVF, "PROTEST", incl.cut = 0.8, sort.by = "incl, n"), include = "?", details = TRUE); ' +
    'ps_json(list(sol = lapply(m$IC$individual, function(k) unname(unlist(k$sol.incl.cov))), nec = unname(as.matrix(pof(CVF[, 1:5], CVF$PROTEST)$incl.cov))))');
  p.models.forEach((m, i) => (['inclS', 'PRI', 'covS'] as const).forEach((k, j) => near(`M${i + 1}: solution ${k} (same R)`, m[k], ref.sol[i][j], EXACT)));
  r.necessity.slice(0, 5).forEach((k, i) => near(`necessity of ${k.condition}: inclN (same R)`, k.inclN, ref.nec[i][0], EXACT));
  // The XY plot's inputs: the outcome and each model's membership (the fuzzy OR of its terms), one value per case.
  same('outcome values for the XY plot', r.outcomeValues.length, 29);
  same('solution membership per case', p.models.map((m) => m.membership.length).join(' '), '29 29 29 29');
  cleanRun(r.warnings.length);
}, 900_000);

it('qca-cvr-calibrate: the direct method with the ?CV anchors reproduces the package’s calibrated data and its solutions', async () => {
  const { run, script } = await open('qca-cvr-calibrate');
  const r = await run();
  against({ label: 'QCA’s CVF dataset (calibrated by its authors with the anchors ?CV documents, given to two decimals)', level: 'native', url: 'https://rdrr.io/cran/QCA/man/CV.html' });
  const cvf = await load('QCA', 'CVF');
  const protest = Array.from(cvf.cols[cvf.names.indexOf('PROTEST')]);
  same('cases', r.n, 29);
  same('calibration: direct method on every column', r.calibration.map((k) => k.method).join(''), 'directdirectdirectdirectdirectdirect');
  // (CVF holds the authors' memberships to two decimals; the direct method with their anchors is within 0.01 of every one)
  near('largest difference between the calibrated PROTEST and CVF$PROTEST (two decimals)', Math.max(...protest.map((v, i) => Math.abs(v - r.outcomeValues[i]))), 0, 0.0101);
  const p = r.solutions.parsimonious!;
  same('parsimonious solution: the four models of the CVF example', p.models.map((m) => m.terms.map((t) => t.term).join(' + ')).join(' | '), CVF_MODELS.map(([terms]) => terms.join(' + ')).join(' | '));
  CVF_MODELS.forEach(([, sol], i) => { near(`M${i + 1}: solution inclS (unrounded memberships)`, p.models[i].inclS, sol[0], 0.005); near(`M${i + 1}: solution covS (unrounded memberships)`, p.models[i].covS, sol[2], 0.005); });
  cleanRun(r.warnings.length);
  const s = await script();
  expect(s).toContain('cal$DEMOC <- calibrate(data$DEMOC, type = "fuzzy", thresholds = "e=2, c=7, i=9.5")');
  expect(s).toContain('cal$ETHFRACT <- calibrate(data$ETHFRACT, type = "fuzzy", thresholds = "e=0, c=0.495, i=0.8")');
}, 900_000);
