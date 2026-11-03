// The built-in examples (customer survey, Stol et al. 2022, political
// democracy, MIMIC, the textbook matrices) run clean: no warning and no note from R, with every engine
// they offer. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeSample } from '../sample';
import { makeEmseExample } from './emse';
import { makeMimicExample } from './mimic';
import { makePoldemExample } from './poldem';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cbScriptLavaan } from '../rengine/lavaan';
import { against, cleanRun, example, near, same } from '../validation/record';
import { builtinDefinition } from '../validation/textbook';
import { makeDhpExample, makeHaydukExample, makeHaydukMeansExample, makeHaydukRevisedExample, makeHaydukStackedExample, makeHaydukStackedMeansExample, makeKerckhoffExample, makeThurstoneExample, makeWheatonExample } from './textbook';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** Start a built-in example's validation evidence (its id in src/io.ts). */
const evidence = (id: string, ex: Parameters<typeof builtinDefinition>[0], packages = ['lavaan'], method = 'CB-SEM') =>
  example(id, { title: id, method, packages, definition: builtinDefinition(ex) });
const clean = (r: { warnings: string[]; notes?: string[] }) => cleanRun(r.warnings.length + (r.notes?.length ?? 0));

it('customer experience: PLS with cSEM and seminr, PLSc, and CB-SEM, without a note', async () => {
  const { data, model } = makeSample();
  evidence('customer', { model, data }, ['cSEM', 'seminr', 'lavaan'], 'PLS-SEM');
  const spec = toSpec(model);
  for (const [pkg, consistent] of [['cSEM', false], ['seminr', false], ['cSEM', true]] as const) {
    const r = await estimatePlsR(data, spec, { scheme: 'path', consistent, missing: 'mean', tolerance: 1e-7, maxIter: 300 }, pkg);
    expect(r.converged, `${pkg} ${consistent}`).toBe(true);
    expect(r.warnings, `${pkg} ${consistent}`).toEqual([]);
    expect(r.notes, `${pkg} ${consistent}`).toEqual([]);
    clean(r);
  }
  const cb = await estimateCbLavaan(data, spec, 'casewise', 'ML', 'product');
  expect(cb.converged).toBe(true);
  expect(cb.warnings).toEqual([]);
  expect(cb.notes).toEqual([]);
  clean(cb);
}, 600_000);

it('Stol et al. (2022) and political democracy: CB-SEM as their sources, without a warning', async () => {
  const emse = makeEmseExample(DEFAULT_SETTINGS);
  evidence('emse', emse);
  const e = await estimateCbLavaan(emse.data, toSpec(emse.model), emse.settings.missing, 'MLM', 'product');
  expect(e.converged).toBe(true);
  expect(e.warnings).toEqual([]);
  expect(e.notes).toEqual([]);
  // Omega and alpha come from the factors' CFA (the model has observed covariates, which semTools cannot handle).
  expect(e.reliability.filter((r) => typeof r.omega === 'number' && typeof r.alpha === 'number').length).toBeGreaterThanOrEqual(3);
  clean(e);
  const pd = makePoldemExample(DEFAULT_SETTINGS);
  evidence('poldem', pd);
  const p = await estimateCbLavaan(pd.data, toSpec(pd.model), pd.settings.missing, 'ML', 'product');
  expect(p.converged).toBe(true);
  expect(p.warnings).toEqual([]);
  expect(p.notes).toEqual([]);
  clean(p);
}, 600_000);

it('social participation (MIMIC): lavaan on the correlation matrix reproduces the book, without a warning', async () => {
  const ex = makeMimicExample(DEFAULT_SETTINGS);
  evidence('mimic', ex);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  expect(r.notes).toEqual([]);
  clean(r);
  against({ label: 'lavaan in desktop R on the same matrix (Wishart likelihood)', level: 'native' });
  const est = (op: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === 'Social participation' && e.rhs === rhs)!.est;
  expect(est('~', 'income'), 'Social participation ~ income').toBeCloseTo(0.108, 3); expect(est('~', 'occupation'), 'Social participation ~ occupation').toBeCloseTo(0.045, 3); expect(est('~', 'education'), 'Social participation ~ education').toBeCloseTo(0.155, 3);
  expect(est('=~', 'memberships'), 'Social participation =~ memberships').toBeCloseTo(1.579, 3); expect(est('=~', 'friends'), 'Social participation =~ friends').toBeCloseTo(0.862, 3);
  // (LISREL's convention, N − 1: the Wishart likelihood; lavaan's default N would give 12.522)
  expect(r.fit.chisq, 'χ²').toBeCloseTo(12.498, 3); same('df', r.fit.df, 6);
  against({ label: 'Schumacker & Lomax (2004), A Beginner’s Guide to SEM, ch. 13 (LISREL–SIMPLIS output)', level: 'published' });
  // Schumacker & Lomax (2004), ch. 13: Minimum Fit Function Chi-Square = 12.50 on 6 df. SIMPLIS scales social participation to
  // variance 1, so the book prints standardised values: church 0.47, member 0.74, friends 0.40; social = 0.23 income + 0.097
  // occup + 0.33 educ, R² = 0.26. The example scales by church (loading 1): the same model, its standardised estimates are the book's.
  near('χ² (book)', r.fit.chisq, 12.50, 0.005);
  const std = (op: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === 'Social participation' && e.rhs === rhs)!.std;
  for (const [op, rhs, v] of [['=~', 'church', 0.47], ['=~', 'memberships', 0.74], ['=~', 'friends', 0.40], ['~', 'income', 0.23], ['~', 'education', 0.33]] as const)
    near(`standardised ${op} ${rhs}`, std(op, rhs), v, 0.005);
  near('standardised ~ occupation', std('~', 'occupation'), 0.097, 0.0005);
  near('R² Social participation', r.r2Constructs[r.constructs.indexOf('Social participation')]!, 0.26, 0.005);
}, 600_000);

it('Wheaton, Thurstone and Kerckhoff: lavaan on the published matrices reproduces the manuals, without a warning', async () => {
  const run = async (ex: ReturnType<typeof makeWheatonExample>, id: string, source: string) => {
    evidence(id, ex);
    const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
    expect(r.converged, ex.name).toBe(true);
    expect(r.warnings, ex.name).toEqual([]);
    expect(r.notes, ex.name).toEqual([]);
    clean(r);
    against({ label: source, level: 'published' });
    return r;
  };
  const est = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, op: string, lhs: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;
  // Wheaton et al.: lavaan's ?getCov example, chi-square 4.735 on 4 df; SES -> Alienation 1967 -0.575, 1967 -> 1971 0.607.
  const w = await run(makeWheatonExample(DEFAULT_SETTINGS), 'wheaton', 'Wheaton et al. (1977) as lavaan’s ?getCov prints it');
  expect(w.fit.chisq, 'χ²').toBeCloseTo(4.735, 2); same('df', w.fit.df, 4);
  expect(est(w, '~', 'Alienation 1967', 'SES').est, 'Alienation 1967 ~ SES').toBeCloseTo(-0.575, 3);
  expect(est(w, '~', 'Alienation 1971', 'Alienation 1967').est, 'Alienation 1971 ~ Alienation 1967').toBeCloseTo(0.607, 3);
  expect(est(w, '~~', 'Anomia67', 'Anomia71').est, 'Anomia67 ~~ Anomia71').toBeCloseTo(1.623, 3);
  // Thurstone: chi-square 38.1963 on 24 df as sem prints it (N − 1: the Wishart likelihood), standardised second-order loadings .822 / .782 / .815.
  const t = await run(makeThurstoneExample(DEFAULT_SETTINGS), 'thurstone', 'SAS/STAT PROC CALIS manual, Thurstone’s nine tests (as the sem package prints it)');
  expect(t.fit.chisq, 'χ²').toBeCloseTo(38.1963, 3); same('df', t.fit.df, 24);
  expect(est(t, '=~', 'General ability', 'Verbal').std, 'standardised General ability =~ Verbal').toBeCloseTo(0.822, 3);
  expect(est(t, '=~', 'General ability', 'Reasoning').std, 'standardised General ability =~ Reasoning').toBeCloseTo(0.815, 3);
  // Kerckhoff: just identified (df 0); Grades on Intelligence .526, OccupAsp on EducExp .550.
  const k = await run(makeKerckhoffExample(DEFAULT_SETTINGS), 'kerckhoff', 'Kerckhoff (1974) in the LISREL manual (printed)');
  same('df', k.fit.df, 0);
  expect(est(k, '~', 'Grades', 'Intelligence').est, 'Grades ~ Intelligence').toBeCloseTo(0.526, 3);
  expect(est(k, '~', 'OccupAsp', 'EducExp').est, 'OccupAsp ~ EducExp').toBeCloseTo(0.550, 3);
  expect(k.r2Constructs[k.constructs.indexOf('OccupAsp')], 'R² OccupAsp').toBeCloseTo(0.443, 3);
}, 600_000);

it('Hayduk (1987) smoking model: lavaan with the fixed error variances reproduces Figure 4.7, without a warning', async () => {
  const ex = makeHaydukExample(DEFAULT_SETTINGS);
  evidence('hayduk', ex);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  expect(r.notes).toEqual([]);
  clean(r);
  against({ label: 'Hayduk (1987), Structural Equation Modeling with LISREL, Figures 4.7 and 9.8 (LISREL output)', level: 'published' });
  const est = (op: string, lhs: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!.est;
  // Figure 9.8 (p. 301) prints the fit of this model: chi-square 2.28 on 1 df, p = .131.
  same('df', r.fit.df, 1);
  expect(r.fit.chisq, 'χ²').toBeCloseTo(2.283, 2);
  near('χ² (book)', r.fit.chisq, 2.28, 0.01);
  expect(r.fit.pvalue, 'p').toBeCloseTo(0.131, 3);
  // BETA and GAMMA of Figure 4.7 (LISREL printed three decimals; sex -> acts differs by two units in the last place: .159 against .161).
  expect(est('~', 'Antismoking views', 'Smoking'), 'Antismoking views ~ Smoking').toBeCloseTo(-0.879, 2);
  expect(est('~', 'Antismoking acts', 'Smoking'), 'Antismoking acts ~ Smoking').toBeCloseTo(-0.312, 3);
  expect(est('~', 'Antismoking acts', 'Antismoking views'), 'Antismoking acts ~ Antismoking views').toBeCloseTo(0.068, 3);
  expect(est('~', 'Smoking', 'Education'), 'Smoking ~ Education').toBeCloseTo(-0.037, 3);
  expect(est('~', 'Smoking', 'Strength of religion'), 'Smoking ~ Strength of religion').toBeCloseTo(-0.036, 3);
  expect(est('~', 'Antismoking views', 'Sex'), 'Antismoking views ~ Sex').toBeCloseTo(0.545, 2);
  expect(est('~', 'Antismoking views', 'Age'), 'Antismoking views ~ Age').toBeCloseTo(0.017, 3);
  expect(est('~', 'Antismoking acts', 'Sex'), 'Antismoking acts ~ Sex').toBeCloseTo(0.161, 2);
  expect(est('~', 'Antismoking acts', 'Strength of religion'), 'Antismoking acts ~ Strength of religion').toBeCloseTo(-0.068, 3);
  expect(r.estimates.some((e) => e.op === '~' && e.lhs === 'Antismoking acts' && e.rhs === 'Age')).toBe(false);
  // THETA DELTA / EPS, the fixed error variances (sex .002, age 12.345, education .691, attendance .466; smoking .025, views .166, acts .065),
  // and PHI / PSI (lavaan divides the matrix by N rather than N - 1: within 0.3% of the LISREL 234.553 and 2.736). The latent Age and its
  // indicator share a name, so both variances are "Age ~~ Age": one is the fixed 12.345, the other the estimated 234.
  const vars = (name: string) => r.estimates.filter((e) => e.op === '~~' && e.lhs === name && e.rhs === name).map((e) => e.est).sort((a, b) => a - b);
  expect(vars('Age').length).toBe(2);
  expect(vars('Age')[0]).toBeCloseTo(12.345, 2);
  expect(vars('Age')[1] / 234.553).toBeCloseTo(1, 2);
  expect(vars('Education')[0]).toBeCloseTo(0.691, 3);
  expect(vars('AS-views')).toEqual([expect.closeTo(0.166, 3)]);
  expect(vars('Antismoking views')[0] / 2.736).toBeCloseTo(1, 2);
}, 600_000);

it('Hayduk (1987) stacked model: two covariance matrices as groups, coefficients equal except the heavy arrows (native lavaan reference)', async () => {
  type Ref = { chisq: number; df: number; groups: string[]; regressions: { to: string; from: string; group: number; est: number; se: number }[]; psi: { construct: string; est: number[] }[] };
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'hayduk_stacked.json'), 'utf8')) as Ref;
  const ex = makeHaydukStackedExample(DEFAULT_SETTINGS);
  evidence('hayduk-stacked', ex);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  expect(r.notes).toEqual([]);
  clean(r);
  expect(r.groups!.labels).toEqual(['Younger', 'Older']);
  against({ label: 'desktop lavaan on the same matrices, scripts/validation/hayduk-stacked.R', script: 'scripts/validation/hayduk-stacked.R', level: 'native' });
  expect(r.fit.chisq, 'χ²').toBeCloseTo(ref.chisq, 4);
  same('df', r.fit.df, ref.df);
  expect(r.n).toBe(213);
  // Every coefficient of every group, as native lavaan on the same matrices (scripts/validation/hayduk-stacked.R; its names are the indicators').
  const concept: Record<string, string> = { Sex: 'Sex', Age: 'Age', Education: 'Education', 'R-attend': 'Strength of religion', 'S-current': 'Smoking', 'AS-views': 'Antismoking views', 'AS-acts': 'Antismoking acts' };
  for (const w of ref.regressions.map((x) => ({ ...x, to: concept[x.to], from: concept[x.from] }))) {
    const e = r.groups!.results[w.group - 1].estimates.find((x) => x.op === '~' && x.lhs === w.to && x.rhs === w.from);
    expect(e, `${w.to} ~ ${w.from} (${ref.groups[w.group - 1]})`).toBeTruthy();
    expect(e!.est, `${w.to} ~ ${w.from} (${ref.groups[w.group - 1]})`).toBeCloseTo(w.est, 5);
    expect(e!.se, `SE of ${w.to} ~ ${w.from} (${ref.groups[w.group - 1]})`).toBeCloseTo(w.se, 5);
  }
  against({ label: 'Hayduk (1987), Figure 9.4 (LISREL output)', level: 'published' });
  // Figure 9.4 (p. 285), Hayduk's LISREL output for this run: chi-square 3.35 on 6 df (p = .764), and every coefficient of
  // both groups; the six held equal are identical across his groups, which confirms the heavy arrows read from Figure 9.1.
  near('χ² (book)', r.fit.chisq, 3.35, 0.03);
  expect(r.fit.pvalue, 'p (book)').toBeCloseTo(0.764, 2);
  const book: [number, string, string, number][] = [
    [0, 'Smoking', 'Sex', -0.015], [0, 'Smoking', 'Age', 0.001], [0, 'Smoking', 'Education', -0.064], [0, 'Smoking', 'Strength of religion', -0.036],
    [0, 'Antismoking views', 'Smoking', -1.356], [0, 'Antismoking views', 'Sex', 0.485], [0, 'Antismoking views', 'Age', -0.018], [0, 'Antismoking views', 'Education', 0.059], [0, 'Antismoking views', 'Strength of religion', 0.042],
    [0, 'Antismoking acts', 'Smoking', -0.527], [0, 'Antismoking acts', 'Antismoking views', 0.061], [0, 'Antismoking acts', 'Sex', 0.307], [0, 'Antismoking acts', 'Age', 0.001], [0, 'Antismoking acts', 'Education', 0.082], [0, 'Antismoking acts', 'Strength of religion', -0.058],
    [1, 'Smoking', 'Sex', -0.015], [1, 'Smoking', 'Age', -0.006], [1, 'Smoking', 'Education', -0.025], [1, 'Smoking', 'Strength of religion', -0.036],
    [1, 'Antismoking views', 'Smoking', -0.453], [1, 'Antismoking views', 'Sex', 0.485], [1, 'Antismoking views', 'Age', -0.001], [1, 'Antismoking views', 'Education', 0.025], [1, 'Antismoking views', 'Strength of religion', 0.042],
    [1, 'Antismoking acts', 'Smoking', -0.126], [1, 'Antismoking acts', 'Antismoking views', 0.061], [1, 'Antismoking acts', 'Sex', 0.005], [1, 'Antismoking acts', 'Age', -0.009], [1, 'Antismoking acts', 'Education', 0.001], [1, 'Antismoking acts', 'Strength of religion', -0.058],
  ];
  const coefOf = (g: number, to: string, from: string) => r.groups!.results[g].estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === from)!.est;
  for (const [g, to, from, v] of book) near(`${to} ~ ${from} (${ref.groups[g]})`, coefOf(g, to, from), v, 0.005);
  // Squared multiple correlations (Figure 9.4): younger .113 .151 .149; older .069 .062 .032.
  const r2 = (g: number, k: string) => r.groups!.results[g].r2Constructs[r.constructs.indexOf(k)]!;
  // (R² as printed, two decimals)
  for (const [g, k, v] of [[0, 'Smoking', 0.113], [0, 'Antismoking views', 0.151], [0, 'Antismoking acts', 0.149], [1, 'Smoking', 0.069], [1, 'Antismoking views', 0.062], [1, 'Antismoking acts', 0.032]] as const) expect(r2(g, k), `${ref.groups[g]} R2 ${k}`).toBeCloseTo(v, 2);
  // Held equal: sex -> smoking identical in both groups; freed: smoking -> views differs.
  const coef = (g: number, to: string, from: string) => r.groups!.results[g].estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === from)!.est;
  expect(coef(0, 'Smoking', 'Sex')).toBe(coef(1, 'Smoking', 'Sex'));
  expect(coef(0, 'Antismoking views', 'Smoking')).not.toBeCloseTo(coef(1, 'Antismoking views', 'Smoking'), 1);
  // Each group's error variances come from its own matrix: age 5% of 15.68 (younger) and of 173.51 (older).
  const theta = (g: number) => r.groups!.results[g].estimates.filter((x) => x.op === '~~' && x.lhs === 'Age' && x.rhs === 'Age').map((x) => x.est).sort((a, b) => a - b)[0];
  expect(theta(0)).toBeCloseTo(0.05 * 15.68, 4);
  expect(theta(1)).toBeCloseTo(0.05 * 173.51, 4);
  // The score tests of the six equalities are there.
  expect(r.groups!.score.length).toBe(6);
  // The exported script carries both matrices and the equality constraints.
  const script = await cbScriptLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML');
  expect(script).toContain('S <- list("Younger" = S_1, "Older" = S_2)');
  expect(script).toContain('group.equal = c("regressions")');
  expect(script).toContain('group.partial = c(');
}, 600_000);

it('non-recursive models: Duncan-Haller-Portes and Hayduk Figure 8.6 under lavaan, without a warning', async () => {
  const est = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, op: string, lhs: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;
  const dhp = makeDhpExample(DEFAULT_SETTINGS);
  evidence('dhp', dhp);
  const d = await estimateCbLavaan(dhp.data, toSpec(dhp.model), 'casewise', 'ML', 'product');
  expect(d.converged).toBe(true); expect(d.warnings).toEqual([]); expect(d.notes).toEqual([]);
  clean(d);
  against({ label: 'Duncan, Haller & Portes (1968) as the sem package’s ?sem prints it', level: 'native' });
  // (sem prints 26.697 on 15 df: N − 1, the Wishart likelihood)
  expect(d.fit.chisq, 'χ²').toBeCloseTo(26.697, 3); same('df', d.fit.df, 15);
  expect(est(d, '~', 'RGenAsp', 'FGenAsp').est, 'RGenAsp ~ FGenAsp').toBeCloseTo(0.184, 3);
  expect(est(d, '~', 'FGenAsp', 'RGenAsp').est, 'FGenAsp ~ RGenAsp').toBeCloseTo(0.235, 3);
  expect(est(d, '~~', 'RGenAsp', 'FGenAsp').est, 'RGenAsp ~~ FGenAsp').toBeCloseTo(-0.023, 3);
  // Hayduk's Figure 8.6 (LISREL): beta 12 .027, beta 21 -1.258, beta 31 -.312, beta 32 .067; gamma: smoking on age -.004, education -.040, attendance -.039;
  // views on sex .557, age .017, education .035; acts on sex .162, education .046, attendance -.068.
  const rev = makeHaydukRevisedExample(DEFAULT_SETTINGS);
  evidence('hayduk-revised', rev);
  const r = await estimateCbLavaan(rev.data, toSpec(rev.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true); expect(r.warnings).toEqual([]); expect(r.notes).toEqual([]);
  clean(r);
  expect(r.fit.chisq, 'χ² (pinned: this app’s value)').toBeCloseTo(3.104, 3);
  against({ label: 'Hayduk (1987), Figure 8.6 and p. 267 (LISREL output)', level: 'published' });
  // p. 267: "fits acceptably chi-square = 3.07 with 2 d.f. and p = .22" (lavaan 3.11).
  same('df', r.fit.df, 2);
  // (3.104 here; the 0.03 to the book is not N against N - 1, which gives 3.098: stated on the card)
  near('χ² (book)', r.fit.chisq, 3.07, 0.04);
  expect(r.fit.pvalue, 'p (book)').toBeCloseTo(0.22, 1);
  expect(est(r, '~', 'Smoking', 'Antismoking views').est, 'Smoking ~ Antismoking views').toBeCloseTo(0.027, 3);
  expect(est(r, '~', 'Antismoking views', 'Smoking').est, 'Antismoking views ~ Smoking').toBeCloseTo(-1.258, 1);
  expect(est(r, '~', 'Antismoking views', 'Smoking').se).toBeGreaterThan(0.7);  // the loop is barely determined
  expect(est(r, '~', 'Antismoking acts', 'Smoking').est, 'Antismoking acts ~ Smoking').toBeCloseTo(-0.312, 2);
  expect(est(r, '~', 'Antismoking acts', 'Antismoking views').est, 'Antismoking acts ~ Antismoking views').toBeCloseTo(0.067, 3);
  expect(est(r, '~', 'Smoking', 'Education').est, 'Smoking ~ Education').toBeCloseTo(-0.040, 3);
  expect(est(r, '~', 'Smoking', 'Strength of religion').est, 'Smoking ~ Strength of religion').toBeCloseTo(-0.039, 3);
  expect(est(r, '~', 'Antismoking views', 'Sex').est, 'Antismoking views ~ Sex').toBeCloseTo(0.557, 3);
  expect(est(r, '~', 'Antismoking acts', 'Sex').est, 'Antismoking acts ~ Sex').toBeCloseTo(0.162, 2);
  expect(est(r, '~', 'Antismoking acts', 'Strength of religion').est, 'Antismoking acts ~ Strength of religion').toBeCloseTo(-0.068, 3);
  expect(r.estimates.some((e) => e.op === '~' && e.lhs === 'Smoking' && e.rhs === 'Sex')).toBe(false);
}, 600_000);

it('Hayduk (1987) means models: Figure 9.8 from the matrix and means, Figure 9.11 stacked with two indicators, as the book', async () => {
  const est = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, op: string, lhs: string, rhs: string) => r.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!;
  // Figure 9.8 (p. 301): chi-square 2.28 on 1 df; the concept means (sex 1.491, age 38.704, education 8.081, attendance 2.641)
  // and the intercepts of the endogenous concepts (smoking 1.033, views 4.567, acts -0.092).
  const one = makeHaydukMeansExample(DEFAULT_SETTINGS);
  evidence('hayduk-means', one);
  const r = await estimateCbLavaan(one.data, toSpec(one.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true); expect(r.warnings).toEqual([]); expect(r.notes).toEqual([]);
  clean(r);
  against({ label: 'Hayduk (1987), Figure 9.8 (LISREL output)', level: 'published' });
  same('df', r.fit.df, 1); near('χ² (book)', r.fit.chisq, 2.28, 0.01);
  const mean = (k: string) => r.estimates.find((e) => e.op === '~1' && e.lhs === k && (e.kind === 'mean' || e.kind === 'intercept'))!.est;
  for (const [k, v] of [['Sex', 1.491], ['Age', 38.704], ['Education', 8.081], ['Strength of religion', 2.641], ['Smoking', 1.033], ['Antismoking views', 4.567], ['Antismoking acts', -0.092]] as const) near(`mean / intercept of ${k}`, mean(k), v, 0.01);
  expect(est(r, '~', 'Antismoking views', 'Smoking').est, 'Antismoking views ~ Smoking').toBeCloseTo(-0.879, 2);
  const script = await cbScriptLavaan(one.data, toSpec(one.model), 'casewise', 'ML');
  expect(script).toContain('sample.mean = M');
  expect(script).toMatch(/Age ~ -0\.25\*1/);
  // Figure 9.11 (p. 312): chi-square 54.97 on 38 df (p = .037); loadings 2.860 (strain) and 0.677 (importance), equal across groups;
  // intercepts equal across groups: smoking 1.113, views 5.751, acts 0.217, sex 1.491; means free: age 26.194 / 50.884,
  // education 8.341 / 7.833, religion 2.181 / 3.082; error variances of the second indicators free: .161 / .227 and 2.814 / 2.025.
  const two = makeHaydukStackedMeansExample(DEFAULT_SETTINGS);
  evidence('hayduk-stacked-means', two);
  const t = await estimateCbLavaan(two.data, toSpec(two.model), 'casewise', 'ML', 'product');
  expect(t.converged).toBe(true); expect(t.warnings).toEqual([]); expect(t.notes).toEqual([]);
  clean(t);
  expect(t.fit.chisq, 'χ² (pinned: this app’s value)').toBeCloseTo(55.462, 3);
  against({ label: 'Hayduk (1987), Figures 9.9 to 9.11 (LISREL output)', level: 'published' });
  // (55.462 here against the book's 54.97: the gap is stated on the card; N - 1 would give 55.246)
  same('df', t.fit.df, 38); near('χ² (book; the gap is stated on the card)', t.fit.chisq, 54.97, 0.5);
  expect(t.groups!.labels).toEqual(['Younger', 'Older']);
  const g = (i: number) => t.groups!.results[i];
  const at = (i: number, op: string, lhs: string, rhs: string) => g(i).estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)!.est;
  const gm = (i: number, k: string) => g(i).estimates.find((e) => e.op === '~1' && e.lhs === k && (e.kind === 'mean' || e.kind === 'intercept'))!.est;
  for (const i of [0, 1]) {
    near(`Smoking =~ S-p-strain (group ${i + 1})`, at(i, '=~', 'Smoking', 'S-p-strain'), 2.86, 0.01);
    near(`Strength of religion =~ R-import (group ${i + 1})`, at(i, '=~', 'Strength of religion', 'R-import'), 0.677, 0.005);
    for (const [k, v] of [['Smoking', 1.113], ['Antismoking views', 5.751], ['Antismoking acts', 0.217], ['Sex', 1.491]] as const) near(`intercept of ${k} (group ${i + 1})`, gm(i, k), v, 0.01);
  }
  for (const [i, k, v] of [[0, 'Age', 26.194], [1, 'Age', 50.884], [0, 'Education', 8.341], [1, 'Education', 7.833], [0, 'Strength of religion', 2.181], [1, 'Strength of religion', 3.082]] as const) near(`mean of ${k} (group ${i + 1})`, gm(i, k), v, 0.01);
  near('Antismoking views ~ Smoking (group 1)', at(0, '~', 'Antismoking views', 'Smoking'), -1.524, 0.01);
  near('Antismoking views ~ Smoking (group 2)', at(1, '~', 'Antismoking views', 'Smoking'), -0.437, 0.01);
  expect(at(0, '~', 'Smoking', 'Sex')).toBe(at(1, '~', 'Smoking', 'Sex'));
  near('Smoking ~ Sex', at(0, '~', 'Smoking', 'Sex'), -0.022, 0.002);
  const theta = (i: number, v: string) => g(i).estimates.filter((e) => e.op === '~~' && e.lhs === v && e.rhs === v).map((e) => e.est);
  near('error variance of S-p-strain (group 1)', theta(0, 'S-p-strain')[0], 0.161, 0.01);
  near('error variance of S-p-strain (group 2)', theta(1, 'S-p-strain')[0], 0.227, 0.01);
  expect(theta(0, 'S-current')[0]).toBeCloseTo(0.025, 3);  // fixed from the younger variance
  expect(theta(1, 'Age').sort((a, b) => a - b)[0]).toBeCloseTo(8.676, 2);  // fixed: 5% of 173.51
}, 900_000);

it('the source conventions reach the replication scripts: Wishart (sem, LISREL), the matrix as given (Kline), the independence baseline (MIIVsem help page)', async () => {
  const { makeRothExample } = await import('./kline');
  const script = async (ex: { data: Parameters<typeof cbScriptLavaan>[0]; model: Parameters<typeof toSpec>[0] }) => cbScriptLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML');
  expect(await script(makeThurstoneExample(DEFAULT_SETTINGS))).toContain('likelihood = "wishart"');
  const roth = await script(makeRothExample(DEFAULT_SETTINGS));
  expect(roth).toContain('sample.cov.rescale = FALSE');
  expect(roth).not.toContain('likelihood = "wishart"');
  // Kline's Roth model keeps the explicit baseline (exercise ~~ hardy free), as his lavaan output prints it.
  expect(roth).toContain('fit_baseline <- sem(baseline_model');
}, 600_000);
