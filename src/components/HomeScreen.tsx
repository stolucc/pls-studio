import { useEffect, useMemo, useState } from 'react';
import { EXAMPLE_FILES_ACCEPT, loadPackageExample, loadSample, newProject, newProjectFromData, openProject, openRecent, pickFiles } from '../io';
import { EXAMPLE_PACKAGES, PACKAGE_EXAMPLES, type ExamplePackage } from '../examples/packages';
import { exampleAuthors, exampleTags, sortTopics } from '../examples/tags';
import { listRecent, recentPersistent, relativeTime, removeRecent, type RecentMeta } from '../recent';
import { useStore } from '../store';
import { confirmDialog } from './Overlays';
import { useAuth } from '../cloud/auth';
import { api } from '../cloud/api';
import { openCloudProject } from '../cloud/collab';
import { AccountMenu } from './cloud/AccountMenu';
import { AboutDialog } from './AboutDialog';
import { EvidenceBadge } from './validation/EvidenceBadge';
import { IconLogo, IconNew, IconOpen, IconTrash, IconUpload } from './icons';

export const EXAMPLES = [
  {
    id: 'customer' as const,
    authors: [] as string[],
    title: 'Customer experience survey',
    tags: ['PLS-SEM', 'Mediation', 'Missing values', 'Bootstrap'],
    links: [] as { label: string; url: string }[],
    body: 'Synthetic survey (N = 300) with service quality, price fairness, trust, satisfaction and loyalty. Raw data with a few missing values: try PLS, PLSc, bootstrapping, IPMA, moderation and the fit test.',
    shows: 'A sandbox rather than a reproduction: the data are synthetic, so there is no published answer to match. Start with the path coefficients and R² of satisfaction and loyalty under PLS, then switch to PLSc, bootstrap for confidence intervals, or open IPMA to see which drivers matter most and perform worst.',
  },
  {
    id: 'emse' as const,
    authors: ['Stol'] as string[],
    title: 'Gamification in software engineering',
    tags: ['CB-SEM', 'MLM', 'Second-order', 'Covariates', 'Mediation', 'Covariance input', 'Published study'],
    links: [{ label: 'Paper (EMSE 27:35)', url: 'https://doi.org/10.1007/s10664-021-10062-w' }, { label: 'Replication package (Zenodo)', url: 'https://doi.org/10.5281/zenodo.6322761' }],
    body: 'Stol, Schaarschmidt & Goldblit (2022), Empirical Software Engineering 27:35. The published model from the replication package’s covariance and NACOV matrices (N = 155): second-order engagement factor, covariates, robust MLM, MIIV-2SLS.',
    shows: 'The robust fit to read: the scaled χ² = 119.33 on 89 df (ML: 125.31) still rejects exact fit (p = .018), while robust CFI .974 and RMSEA .048 indicate a close fit. The engagement factor sits over its two components, and age, gender and tenure enter as observed covariates.',
  },
  {
    id: 'poldem' as const,
    authors: ['Bollen'] as string[],
    title: 'Industrialisation and political democracy',
    tags: ['CB-SEM', 'Mediation', 'Correlated errors'],
    links: [{ label: '?PoliticalDemocracy (lavaan)', url: 'https://rdrr.io/cran/lavaan/man/PoliticalDemocracy.html' }, { label: 'lavaan tutorial: SEM', url: 'https://lavaan.ugent.be/tutorial/sem.html' }],
    body: 'Bollen (1989), Structural Equations with Latent Variables: 75 developing countries, democracy measured in 1960 and 1965. The classic model with six correlated measurement errors, drawn as double-headed arrows between error terms.',
    shows: 'The fit lavaan prints for this model: χ² = 38.125 on 35 df, so the model with its six correlated errors fits these 75 countries well. Look at the paths from industrialisation to democracy in 1960 and 1965 and at the stability of democracy from one year to the next.',
  },
  {
    id: 'mimic' as const,
    authors: ['Schumacker', 'Lomax'] as string[],
    title: 'Social participation (MIMIC model)',
    tags: ['CB-SEM', 'MIMIC', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Schumacker & Lomax, A Beginner’s Guide to SEM', url: 'https://www.routledge.com/A-Beginners-Guide-to-Structural-Equation-Modeling/Whittaker-Schumacker/p/book/9780367477967' }, { label: 'Hodge & Treiman (1968)', url: 'https://doi.org/10.2307/2092317' }],
    body: 'Multiple indicators, multiple causes: income, occupation and education cause social participation, measured by church attendance, memberships and friends seen. Jöreskog & Sörbom’s LISREL example (Hodge & Treiman 1968, N = 530), the worked MIMIC example in Schumacker & Lomax; the correlation matrix and maximum likelihood with LISREL’s N − 1 (Wishart): χ² = 12.50 on 6 df. The matrix and model are those of Schumacker & Lomax (2004, ch. 13). They let SIMPLIS give social participation variance 1 and so print standardised values (church .47, memberships .74, friends .40; income .23, occupation .097, education .33; R² .26); here church attendance is the scaling indicator, an equivalent identification whose standardised estimates are the book’s.',
    shows: 'The fit is χ² = 12.50 on 6 df. In the standardised solution, memberships is the strongest indicator (.74) and education the strongest cause (.33), with occupation small (.097); the three causes together explain about a quarter of social participation (R² .26).',
  },
  {
    id: 'wheaton' as const,
    authors: [] as string[],
    title: 'Stability of alienation (Wheaton et al. 1977)',
    tags: ['CB-SEM', 'Panel model', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Wheaton, Muthén, Alwin & Summers (1977)', url: 'https://doi.org/10.2307/270754' }, { label: 'lavaan, ?getCov: the matrix and model', url: 'https://rdrr.io/cran/lavaan/man/getCov.html' }],
    body: 'Alienation (anomia, powerlessness) measured in 1967 and 1971, explained by socio-economic status (education, occupational index), N = 932. The model of lavaan’s ?getCov help example, with the errors of each item correlated across the waves: χ² = 4.735 on 4 df; 1967 → 1971 0.607 (SE 0.051), SES → 1967 −0.575, SES → 1971 −0.227. (The sem package’s ?sem and the SAS/STAT PROC CALIS manual fit a more restricted variant, with loadings held at 0.833 and equal error variances: χ² = 13.49 on 9 df.)',
    shows: 'Alienation is stable: 1967 → 1971 is 0.607 (SE 0.051), and the model fits, χ² = 4.735 on 4 df. SES lowers alienation in 1967 (−0.575) and has a smaller direct effect in 1971 (−0.227), on top of what it passes on through 1967.',
  },
  {
    id: 'thurstone' as const,
    authors: [] as string[],
    title: 'Thurstone mental tests: second-order factor',
    tags: ['CB-SEM', 'Second-order', 'CFA', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }, { label: 'SAS/STAT PROC CALIS: second-order CFA', url: 'https://go.documentation.sas.com/doc/en/statug/latest/statug_calis_examples.htm' }],
    body: 'Nine tests from Thurstone & Thurstone (1941), N = 213: verbal, word-fluency and reasoning factors, with a general ability factor at the second order, as in the SAS/STAT PROC CALIS manual and the sem package’s ?sem. A correlation matrix, maximum likelihood with N − 1 (Wishart) as these programs: χ² = 38.196 on 24 df as sem prints it.',
    shows: 'χ² = 38.196 on 24 df, as the sem package prints it. In the standardised loadings, the general factor loads strongly on all three first-order factors (verbal .822, word fluency .782, reasoning .815), so one general ability accounts for much of what the three share.',
  },
  {
    id: 'kerckhoff' as const,
    authors: [] as string[],
    title: 'Ambition and attainment (Kerckhoff 1974)',
    tags: ['CB-SEM', 'Path analysis', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }],
    body: 'The LISREL manual’s observed-variable path model: intelligence, number of siblings, father’s education and occupation explain grades, educational expectations and occupational aspirations of 737 boys. Four fixed exogenous variables, a just-identified recursive model: coefficients and R² only (as the sem package’s ?sem; standard errors with N − 1, the Wishart likelihood).',
    shows: 'A just-identified model has 0 df and χ² = 0, so read the coefficients and R², not the fit. Intelligence → grades is .526 and educational expectations → occupational aspirations .550; R² is .349 for grades, .483 for expectations and .443 for aspirations, as the LISREL manual prints.',
  },
  {
    id: 'hayduk' as const,
    authors: ['Hayduk'] as string[],
    title: 'Smoking behaviour and antismoking acts (Hayduk 1987)',
    tags: ['CB-SEM', 'Single indicators', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Chapter 4’s “real model”: sex, age, education and religious attendance explain current smoking, antismoking views and antismoking acts (N = 432). Each concept has one indicator whose error variance is fixed from an assessed reliability (1% for sex, 5% to 10% for the rest), Hayduk’s way of modelling measurement error without multiple indicators. Agrees with his LISREL estimates of Figure 4.7 within 0.002 (sex → acts 0.159 against 0.161), with χ² = 2.28 on 1 df as Figure 9.8 prints. The matrix carries all thirteen indicators of Figure 4.5, so the other religion and smoking measures can be swapped in.',
    shows: 'The fit is χ² = 2.28 on 1 df, as Hayduk prints it, and the paths agree with his Figure 4.7 within 0.002 (sex → acts 0.159 against his 0.161). Read the coefficients as effects among concepts already corrected for the measurement error each fixed error variance assumes.',
  },
  {
    id: 'hayduk-stacked' as const,
    authors: ['Hayduk'] as string[],
    title: 'Stacked smoking model: younger and older (Hayduk 1987)',
    tags: ['CB-SEM', 'Multigroup', 'Stacked model', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Chapter 9’s stacked model: the smoking model fitted to younger (N = 213) and older (N = 219) respondents at once, one covariance matrix per group (Figure 9.2), each group’s error variances fixed from its own variances. The path coefficients are held equal across the groups except the heavy arrows of Figure 9.1 (the effects of age and education, of sex on acts, and of smoking), which may differ. Every coefficient of both groups agrees with his Figure 9.4 within 0.005; χ² = 3.33 on 6 df here against the 3.35 he prints (p = .76 for the six equalities either way): his LISREL VI run read the matrices at full precision, the book prints three decimals. Groups: pick a group or All groups in the results.',
    shows: 'The equalities hold: χ² = 3.33 on 6 df (his 3.35), p = .76 either way, and every coefficient of both groups agrees with his Figure 9.4 within 0.005. Switch between the two groups to see which effects differ by age and which are shared.',
  },
  {
    id: 'hayduk-means' as const,
    authors: ['Hayduk'] as string[],
    title: 'Smoking model with means and intercepts (Hayduk 1987)',
    tags: ['CB-SEM', 'Means and intercepts', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Figure 9.8: the chapter-4 model with a mean structure, estimated from the covariance matrix and the means of Figure 4.5. Each marker’s intercept is fixed at a measurement bias he assigns (age reports 0.25 low, views 0.50 high, …), so the concept means come out corrected: age 38.70, education 8.08, attendance 2.64; the three endogenous intercepts 1.03, 4.57, −0.09; the same χ² = 2.28 on 1 df.',
    shows: 'The fit is unchanged, χ² = 2.28 on 1 df: the mean structure adds no testable constraint. Look at the concept means, corrected for the assigned biases (age 38.70, education 8.08, attendance 2.64), and at the endogenous intercepts 1.03, 4.57 and −0.09.',
  },
  {
    id: 'hayduk-stacked-means' as const,
    authors: ['Hayduk'] as string[],
    title: 'Stacked smoking model with means (Hayduk 1987)',
    tags: ['CB-SEM', 'Multigroup', 'Stacked model', 'Means and intercepts', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Figures 9.9 to 9.11: the stacked model with the means of both age groups, a second indicator for smoking (physiological strain) and for religion (importance) with loadings equal across the groups and error variances free, the marker biases of Figure 9.8 (age −0.2 for the younger, −0.3 for the older). Coefficients and the concept means and intercepts are equal across the groups except the heavy arrows and the means of age, education and religion. The loadings (2.86 and 0.68) and the intercepts and means of both groups agree with Figure 9.11 within 0.01; χ² is 55.46 on 38 df (p = .033) against the 54.97 (p = .037) he prints. The model is his program of Figure 9.10 (fixed error variances, biases and equalities checked one by one); his run read the covariances and means at seven decimals from files and analysed them as LISREL VI’s augmented moment matrix (MA = MM), where the book prints three decimals, which neither N nor N − 1 in χ² makes up.',
    shows: 'The equalities across the age groups are narrowly rejected: χ² = 55.46 on 38 df, p = .033, against his 54.97 (p = .037). The loadings of the second indicators (2.86 and 0.68) and both groups’ intercepts and means agree with his Figure 9.11 within 0.01.',
  },
  {
    id: 'kline-roth' as const,
    authors: ['Kline'] as string[],
    title: 'Exercise, hardiness and illness (Roth et al. 1989)',
    tags: ['CB-SEM', 'Path analysis', 'Mediation', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Kline’s running example (chapter 9): a path model of observed variables, exercise → fitness → illness and hardiness → stress → illness, N = 373. The paths are labelled a to d and the indirect effects ab and cd are defined parameters with delta-method standard errors. Fitted as his script does, the matrix as given (sample.cov.rescale = FALSE): reproduces his output, χ² = 11.11 on 5 df, RMSEA .057, and the variances (exercise 4422.25).',
    shows: 'The fit is χ² = 11.11 on 5 df, RMSEA .057, as Kline prints it. Look at the defined parameters: the indirect effects ab (exercise through fitness) and cd (hardiness through stress) on illness, each with its delta-method standard error.',
  },
  {
    id: 'kline-kabc' as const,
    authors: ['Kline'] as string[],
    title: 'KABC-I: sequential and simultaneous processing (Kaufman & Kaufman 1983)',
    tags: ['CB-SEM', 'CFA', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 14: the two-factor confirmatory factor analysis of eight KABC-I subtests in the 10-year-old normative sample (N = 200): hand movements, number recall and word order on sequential processing; gestalt closure, triangles, spatial memory, matrix analogies and photo series on simultaneous processing. χ² = 38.33 on 19 df, RMSEA .071.',
    shows: 'χ² = 38.33 on 19 df rejects exact fit, with RMSEA .071. Look at the loadings of the three sequential and five simultaneous subtests on their factors and at the correlation between the two processing factors.',
  },
  {
    id: 'kline-sabatelli' as const,
    authors: ['Kline'] as string[],
    title: 'A Heywood case (Sabatelli & Bartle-Haring 2003)',
    tags: ['CB-SEM', 'CFA', 'Heywood case', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 14: marital adjustment (two indicators) and family-of-origin experiences (three) in a small sample, N = 103. The ML solution has a negative error variance, a Heywood case: the fit looks fine (χ² = 4.69 on 4 df) while the solution is inadmissible. The results panel flags it.',
    shows: 'An admissibility failure behind a good fit: χ² = 4.69 on 4 df, yet one error variance is negative. Read the warning in the results panel as the main result: the solution cannot be interpreted as it stands, however good the fit looks.',
  },
  {
    id: 'kline-worland' as const,
    authors: ['Kline'] as string[],
    title: 'Achievement and classroom adjustment (Worland et al. 1984)',
    tags: ['CB-SEM', 'Structural regression', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 15, two-step modelling: cognitive ability and family risk explain achievement and classroom adjustment, four factors with eleven indicators, N = 158. The disturbances of the two outcomes are uncorrelated (undrawn). lavaan reaches Kline’s χ² = 37.32 on 39 df only after 639 iterations, with implausible coefficients (Risk → Achievement −5.5): the likelihood surface is nearly flat, which is his cue to respecify. The built-in engine stops at a local minimum (χ² = 49.7), so this example runs on the R engine.',
    shows: 'Kline’s χ² = 37.32 on 39 df is reached only after 639 iterations, with an implausible Risk → Achievement of −5.5. Read the fit together with the coefficients: a good χ² on a nearly flat likelihood does not make the solution credible, which is why Kline respecifies.',
  },
  {
    id: 'kline-romney-somatic' as const,
    authors: ['Kline'] as string[],
    title: 'Quality of life after heart surgery: psychosomatic model (Romney et al. 1992)',
    tags: ['CB-SEM', 'Path analysis', 'Model comparison', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 11, non-nested models: low morale, driven by low SES and neurological dysfunction, produces symptoms and poor relationships (N = 469). Fits poorly, χ² = 40.49 on 5 df (the matrix as given, as Kline’s script); compare the conventional medical model on the same matrix.',
    shows: 'A poor fit: χ² = 40.49 on 5 df rejects the psychosomatic model clearly. Note its information criteria on the Fit tab and compare them with the medical model on the same matrix, which fits far better.',
  },
  {
    id: 'kline-romney-medical' as const,
    authors: ['Kline'] as string[],
    title: 'Quality of life after heart surgery: medical model (Romney et al. 1992)',
    tags: ['CB-SEM', 'Path analysis', 'Model comparison', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 11: symptoms and dysfunction come first and lower SES, morale and relationships (N = 469). χ² = 3.25 on 3 df; the better of the two non-nested models, compared by their information criteria (Fit tab).',
    shows: 'The model fits, χ² = 3.25 on 3 df, against 40.49 on 5 df for the psychosomatic model. The two are not nested, so compare them by AIC and BIC on the Fit tab rather than by a χ² difference: the lower values favour this model.',
  },
  {
    id: 'kline-lynam' as const,
    authors: ['Kline'] as string[],
    title: 'Achievement and delinquency in two groups (Lynam et al. 1993)',
    tags: ['CB-SEM', 'Multigroup', 'Means and intercepts', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 12: SES, effort and verbal IQ explain achievement, and all four explain delinquency, in Black (N = 214) and White (N = 181) adolescents, one covariance matrix with means per group. Coefficients are equal across the groups except achievement → delinquency; means and intercepts are free. Reproduces his second model: χ² = 6.11 on 6 df.',
    shows: 'The model fits, χ² = 6.11 on 6 df, so the coefficients can be taken as equal across the groups except achievement → delinquency. Compare that one free path in the Black (N = 214) and White (N = 181) groups.',
  },
  {
    id: 'kline-robbins' as const,
    authors: ['Kline'] as string[],
    title: 'Institutional quality and trust: a causal loop (Robbins 2012)',
    tags: ['CB-SEM', 'Non-recursive', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 19: institutional quality (legal system, corruption) and trust cause each other across 64 countries, with information technology and monarchy as instruments and correlated disturbances. χ² = 5.90 on 5 df.',
    shows: 'The causal loop fits, χ² = 5.90 on 5 df. Look at the two reciprocal effects between institutional quality and trust and at the correlation of their disturbances; the instruments, information technology and monarchy, are what identify the loop.',
  },
  {
    id: 'kline-sauve' as const,
    authors: ['Kline'] as string[],
    title: 'Cognitive ability and insight: a partial SR model (Sauve et al.)',
    tags: ['CB-SEM', 'Known reliability', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Kline (2023), Principles and Practice of SEM, 5th ed.', url: 'https://www.guilford.com/books/Principles-and-Practice-of-Structural-Equation-Modeling/Rex-Kline/9781462551910' }, { label: 'Companion files (data, lavaan syntax, output)', url: 'https://www.guilford.com/kline' }],
    body: 'Chapter 15: six cognitive tests load on one factor (two pairs with correlated errors) and predict a single-indicator insight score (SUMD) whose reliability of .76 fixes its error variance, N = 193: Kline fixes it at .360, which is (1 − .76) × 1.225² rounded, and so does this example. χ² = 9.89 on 12 df.',
    shows: 'The model fits, χ² = 9.89 on 12 df. Look at the path from the cognitive factor to insight: because the error variance of SUMD is fixed at .360 from its reliability of .76, the path is corrected for the unreliability of the single indicator.',
  },
  {
    id: 'brown-ne' as const,
    authors: ['Brown'] as string[],
    title: 'Neuroticism and extraversion: a two-factor CFA (Brown 2015)',
    tags: ['CB-SEM', 'CFA', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 4’s first CFA: four indicators each of neuroticism and extraversion, N = 250, from the standard deviations and correlations of Figure 4.1. χ² = 13.29 on 19 df, the factors correlate about −.4. The tables of chapter 4 walk through every part of the output.',
    shows: 'The two-factor model fits well, χ² = 13.29 on 19 df, and neuroticism and extraversion correlate about −.4. Each indicator loads on its own factor; work through the loadings, residual variances and factor correlation against Brown’s chapter 4 tables.',
  },
  {
    id: 'brown-tau' as const,
    authors: ['Brown'] as string[],
    title: 'Tau-equivalent indicators of auditory memory (Brown 2015)',
    tags: ['CB-SEM', 'CFA', 'Equality constraints', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 7, Table 7.2: the three auditory-memory loadings held equal (tau equivalence; here the two non-marker loadings fixed at the marker’s 1, the same model as Brown’s equal labels with the factor variance fixed), visual memory free, N = 200. χ² = 5.66 on 10 df against 4.88 on 8 df for the free model: a difference of 0.78 on 2 df, so the constraint holds.',
    shows: 'The equality constraint holds: χ² = 5.66 on 10 df against 4.88 on 8 df for the free model, a difference of 0.78 on 2 df, far from significant. So the three auditory-memory indicators can be treated as tau-equivalent.',
  },
  {
    id: 'brown-mtmm' as const,
    authors: ['Brown'] as string[],
    title: 'Multitrait-multimethod: correlated uniqueness model (Brown 2015)',
    tags: ['CB-SEM', 'CFA', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 6, Table 6.3: paranoid, schizotypal and schizoid personality disorder each measured by an inventory, a clinical interview and an observer rating (N = 500). Three trait factors; the method effects are the correlated errors within each method. Brown fixes the factor variances at 1; here each factor is scaled by its first indicator instead, an equivalent identification: the same χ² = 14.37 on 15 df and standardised values, other unstandardised loadings and factor covariances.',
    shows: 'The model fits well, χ² = 14.37 on 15 df. Read the trait loadings for convergent validity and the correlated errors within each method for the method effects; the standardised values are Brown’s, the unstandardised ones differ because of the marker scaling.',
  },
  {
    id: 'brown-coping' as const,
    authors: ['Brown'] as string[],
    title: 'Coping: a higher-order CFA (Brown 2015)',
    tags: ['CB-SEM', 'Second-order', 'CFA', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 8, Table 8.2: problem solving, cognitive restructuring, expressing emotions and seeking social support (three items each, N = 275) under two correlated second-order factors, problem-focused and emotion-focused coping. χ² = 83.00 on 49 df, RMSEA .050.',
    shows: 'The higher-order model fits, χ² = 83.00 on 49 df, RMSEA .050. Look at the second-order loadings: problem solving and cognitive restructuring under problem-focused coping, expressing emotions and seeking support under emotion-focused coping, and the correlation between the two.',
  },
  {
    id: 'brown-reliability' as const,
    authors: ['Brown'] as string[],
    title: 'Scale reliability from a CFA (Brown 2015)',
    tags: ['CB-SEM', 'CFA', 'Reliability', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 8, Table 8.8: intrusions and avoidance, four items each with one error covariance, N = 500. Brown computes each scale’s reliability from the loadings and error variances in MODEL CONSTRAINT, against the model-implied variance of the sum: .919 and .823. The Reliability tab’s ω (semTools) divides by the observed variance of the sum instead: .920 and .823, next to coefficient alpha. χ² = 20.52 on 18 df.',
    shows: 'Open the Reliability tab: ω is .920 for intrusions and .823 for avoidance, against the .919 and .823 Brown computes from the model-implied variance, with coefficient alpha alongside. The model fits, χ² = 20.52 on 18 df.',
  },
  {
    id: 'brown-stress' as const,
    authors: ['Brown'] as string[],
    title: 'Life stress as a formative construct (Brown 2015)',
    tags: ['CB-SEM', 'Formative', 'Second-order', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Brown (2015), Confirmatory Factor Analysis for Applied Research, 2nd ed.', url: 'https://www.guilford.com/books/Confirmatory-Factor-Analysis-for-Applied-Research/Timothy-Brown/9781462515363' }, { label: 'Companion files (data and Mplus, LISREL, EQS syntax)', url: 'https://sites.bu.edu/tabrown/cfabook/' }],
    body: 'Chapter 8, Table 8.12: three observed stressors cause life stress (the first coefficient fixed at 1 to scale it), and life stress is identified by two reflective second-order indicators, satisfaction and optimism (three items each), both loadings estimated, N = 500: Brown’s Mplus input (STRESS BY SATIS* OPTIM; STRESS ON X1@1 X2 X3). The MIMIC-style identification of a formative construct. χ² = 2.17 on 22 df.',
    shows: 'The model fits, χ² = 2.17 on 22 df. Look at the three stressor coefficients forming life stress (the first fixed at 1) and at the two reflective loadings on satisfaction and optimism, which are what identify the formative construct.',
  },
  {
    id: 'bollen-curran-lcm' as const,
    authors: ['Bollen', 'Curran'] as string[],
    title: 'Latent curve model as a diagram (Bollen & Curran 2004)',
    tags: ['CB-SEM', 'Growth curve', 'Longitudinal', 'Second-order', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen & Curran (2004), Sociological Methods & Research', url: 'https://doi.org/10.1177/0049124103260222' }, { label: 'Bollen & Curran (2006), Latent Curve Models', url: 'https://www.wiley.com/en-us/Latent+Curve+Models%3A+A+Structural+Equation+Perspective-p-9780471455929' }],
    body: 'A latent curve model specified by hand: five repeated measures as single-indicator constructs, intercept and slope as higher-order factors with loadings held at 1, 1, 1, 1, 1 and 0, 1, 2, 3, 4, their variances and covariance free, one residual variance per wave. Bollen & Curran’s artificial covariance matrix (N = 500) was generated from exactly this model, so it fits perfectly: compare with the Growth curve card, which writes the same model from raw data. The lavaan reproduction it comes from (cddesja/lavaan-reproducible) also writes means for intercept and slope, without sample means (10 df); the matrix carries no means, so here the model is the covariance structure alone: the same χ² on 7 df.',
    shows: 'A perfect fit by construction: the matrix was generated from this very model, so χ² is practically zero on 7 df. Read the intercept and slope variances and their covariance, and compare with the Growth curve card, which writes the same model from raw data.',
  },
  {
    id: 'bollen-curran-alt' as const,
    authors: ['Bollen', 'Curran'] as string[],
    title: 'Autoregressive latent trajectory model (Bollen & Curran 2004)',
    tags: ['CB-SEM', 'Growth curve', 'Longitudinal', 'Autoregressive', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen & Curran (2004), Sociological Methods & Research', url: 'https://doi.org/10.1177/0049124103260222' }],
    body: 'Bollen & Curran’s synthesis of the autoregressive and the latent curve traditions: the first wave is predetermined (exogenous, correlated with intercept and slope), the curve runs over waves 2 to 5, and each wave also predicts the next. On their latent-curve-generated matrix the autoregressive coefficients come out at zero, which is the demonstration. Components with predictors are estimated by lavaan (R engine). As for the latent curve model, the means of the cited lavaan reproduction are left out (the matrix carries none): the same χ² on 1 df instead of 3.',
    shows: 'The autoregressive paths from each wave to the next come out at zero and χ² is practically zero on 1 df: on data generated by a latent curve, the trajectory explains everything and the autoregressive part adds nothing.',
  },
  {
    id: 'bollen-ses' as const,
    authors: ['Bollen'] as string[],
    title: 'Objective and subjective status (Bollen 1989, ch. 4)',
    tags: ['CB-SEM', 'Path analysis', 'Non-recursive', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'Income and occupational prestige of 432 white respondents (Kluegel et al. 1977) and how they rate their own income, prestige and overall status. Rated income and prestige affect each other, each with its own instrument; all three disturbances covary, so the model is exactly identified (χ² = 0). Reproduces Bollen’s estimates, e.g. 0.29 and 0.25 for the reciprocal effects.',
    shows: 'An exactly identified model, so χ² = 0 and the fit says nothing; read the estimates instead. The reciprocal effects of rated income and rated prestige on each other are 0.29 and 0.25, as Bollen reports.',
  },
  {
    id: 'bollen-ses-error' as const,
    authors: ['Bollen'] as string[],
    title: 'Subjective status with measurement error (Bollen 1989, ch. 5)',
    tags: ['CB-SEM', 'Path analysis', 'Non-recursive', 'Single indicators', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'The same status model with uncorrelated disturbances, now letting rated income and rated prestige carry random measurement error. The structure identifies their error variances (0.10 and 0.21), so each is a single indicator with an estimated error variance. The reciprocal effects grow to 0.33 and 0.29, as in Bollen’s table; χ² = 0.27 on 1 df.',
    shows: 'Allowing measurement error in the two ratings estimates their error variances at 0.10 and 0.21 and raises the reciprocal effects to 0.33 and 0.29, as in Bollen’s table. The model fits, χ² = 0.27 on 1 df.',
  },
  {
    id: 'bollen-ses-groups' as const,
    authors: ['Bollen'] as string[],
    title: 'Status of blacks and whites (Bollen 1989, ch. 8)',
    tags: ['CB-SEM', 'Multigroup', 'Non-recursive', 'Single indicators', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'The measurement-error status model in two groups, blacks (N = 368) and whites (N = 432), one covariance matrix each, with every path coefficient held equal across the groups. χ² = 13.80 on 8 df. Bollen prints 13.85: the matrices are printed to three decimals, which accounts for the gap.',
    shows: 'χ² = 13.80 on 8 df (Bollen: 13.85) tests whether the same coefficients hold for blacks and whites. Look at the fit before reading the shared coefficients; the small gap to Bollen comes from the three-decimal matrices.',
  },
  {
    id: 'bollen-morale' as const,
    authors: ['Bollen'] as string[],
    title: 'Morale and belonging of female and male students (Bollen 1989, ch. 8)',
    tags: ['CB-SEM', 'CFA', 'Multigroup', 'Means and intercepts', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'Four morale items and three sense-of-belonging items, one covariance matrix with means for each group. Loadings and intercepts are equal across the groups, so the males’ latent means are estimated relative to the females’. χ² = 35.31 on 36 df (Bollen: 35.37). The group sizes are those of the text, 49 and 57; the table heading’s 47 and 59 do not reproduce his χ².',
    shows: 'With loadings and intercepts equal across the groups, the model fits: χ² = 35.31 on 36 df (Bollen: 35.37). Read the males’ latent means for morale and belonging as differences from the females’, whose means are fixed as the reference.',
  },
  {
    id: 'bollen-democracy-cfa' as const,
    authors: ['Bollen'] as string[],
    title: 'Political democracy in 1960 and 1965: a two-wave CFA (Bollen 1989, ch. 7)',
    tags: ['CB-SEM', 'CFA', 'Longitudinal', 'Equality constraints', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'Four democracy indicators measured twice in 75 developing countries, from the book’s correlations and standard deviations. Each indicator loads equally in both years (labelled loadings), and no errors are correlated. χ² = 46.67 on 22 df, as Bollen’s 46.7; compare the version with correlated errors.',
    shows: 'χ² = 46.67 on 22 df, as Bollen’s 46.7: the model without correlated errors is rejected. Compare it with the version with six correlated errors, which drops χ² to 15.25 on 16 df.',
  },
  {
    id: 'bollen-democracy-cfa-errors' as const,
    authors: ['Bollen'] as string[],
    title: 'Political democracy 1960–1965 with correlated errors (Bollen 1989, ch. 7)',
    tags: ['CB-SEM', 'CFA', 'Longitudinal', 'Correlated errors', 'Equality constraints', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'The two-wave democracy CFA with six error covariances: each indicator with itself over time, and the two indicators from the same source within a year. χ² = 15.25 on 16 df. Bollen prints 15.1; the correlations are printed to three decimals.',
    shows: 'The six error covariances bring χ² down to 15.25 on 16 df (Bollen: 15.1), a good fit, from 46.67 on 22 df without them: the shared sources and the repeated indicators matter.',
  },
  {
    id: 'bollen-air' as const,
    authors: ['Bollen'] as string[],
    title: 'Perceived air quality: a poorly fitting factor (Bollen 1989, ch. 7)',
    tags: ['CB-SEM', 'CFA', 'Model comparison', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Bollen (1989), Structural Equations with Latent Variables', url: 'https://doi.org/10.1002/9781118619179' }],
    body: 'Visitors to a national park (N = 57) rate the air’s overall quality, clarity, colour and odour. A single factor fits poorly, χ² = 16.04 on 2 df (Bollen: 16.0). The modification indices point at the clarity–colour error covariance, the respecification the chapter discusses.',
    shows: 'A poor fit: χ² = 16.04 on 2 df (Bollen: 16.0) rejects a single factor for the four ratings. Open the modification indices: the largest points at the error covariance between clarity and colour, the respecification the chapter discusses.',
  },
  {
    id: 'eqs-bagozzi' as const,
    authors: ['Bentler'] as string[],
    title: 'Performance and job satisfaction of salespeople (EQS manual; Bagozzi 1980)',
    tags: ['CB-SEM', 'Structural regression', 'Covariance input', 'Textbook example'],
    links: [{ label: 'EQS 6 Structural Equations Program Manual (Bentler 2006)', url: 'https://www3.nd.edu/~kyuan/courses/sem/EQS-Manual6.pdf' }],
    body: '122 salespeople: job satisfaction depends on performance and achievement motivation, and performance on self-esteem and verbal IQ. EQS lets performance be an indicator of self-esteem with its own predictors; drawn here as a single indicator regressed on self-esteem, the same model. χ² = 15.40 on 15 df, as the manual.',
    shows: 'χ² = 15.40 on 15 df, as the EQS manual prints it, so the model fits. Look at the paths into job satisfaction from performance and achievement motivation, and into performance from self-esteem and verbal IQ.',
  },
  {
    id: 'eqs-werts' as const,
    authors: ['Bentler'] as string[],
    title: 'Two factors in two groups (EQS manual; Werts et al. 1976)',
    tags: ['CB-SEM', 'CFA', 'Multigroup', 'Equality constraints', 'Covariance input', 'Textbook example'],
    links: [{ label: 'EQS 6 Structural Equations Program Manual (Bentler 2006)', url: 'https://www3.nd.edu/~kyuan/courses/sem/EQS-Manual6.pdf' }],
    body: 'Two factors with two indicators each, in groups of 865 and 900. EQS standardises the factors and holds the loadings and the factor correlation equal across the groups; with marker indicators that is equal loadings, factor variances and covariance. χ² = 10.87 on 7 df, as the manual.',
    shows: 'χ² = 10.87 on 7 df, as the EQS manual prints it. The test is whether the same loadings, factor variances and covariance hold in both groups (N = 865 and 900); read the fit as the verdict on those equalities.',
  },
  {
    id: 'eqs-headstart' as const,
    authors: ['Bentler'] as string[],
    title: 'SES and cognitive ability of Head Start children (EQS manual)',
    tags: ['CB-SEM', 'Structural regression', 'Correlated errors', 'Covariance input', 'Textbook example'],
    links: [{ label: 'EQS 6 Structural Equations Program Manual (Bentler 2006)', url: 'https://www3.nd.edu/~kyuan/courses/sem/EQS-Manual6.pdf' }],
    body: 'Four socioeconomic indicators measure SES, which predicts a cognitive-ability factor measured by two tests, in 148 Head Start children (data from the LISREL 7 manual). Two SES errors covary. χ² = 15.66 on 7 df, as the manual; its intercepts are free, so the means do not change the fit.',
    shows: 'χ² = 15.66 on 7 df, as the EQS manual prints it. Look at the path from SES to cognitive ability and the covariance between the two SES errors; with free intercepts the means leave the fit unchanged.',
  },
  {
    id: 'eqs-headstart-groups' as const,
    authors: ['Bentler'] as string[],
    title: 'Head Start and control children with means (EQS manual)',
    tags: ['CB-SEM', 'Multigroup', 'Means and intercepts', 'Covariance input', 'Textbook example'],
    links: [{ label: 'EQS 6 Structural Equations Program Manual (Bentler 2006)', url: 'https://www3.nd.edu/~kyuan/courses/sem/EQS-Manual6.pdf' }],
    body: 'The Head Start model in Head Start (N = 148) and control (N = 155) children, each group with its means. Intercepts, loadings and the SES → ability path are equal across the groups, so the latent means of one group are estimated relative to the other. χ² = 27.45 on 23 df, as the manual.',
    shows: 'χ² = 27.45 on 23 df, as the EQS manual prints it, so the equal intercepts, loadings and SES → ability path hold. Read the latent means of one group as differences from the other: that is the comparison of Head Start and control children.',
  },
  {
    id: 'eqs-olsson' as const,
    authors: ['Bentler'] as string[],
    title: 'Training verbal ability: a pre/post design with means (EQS manual; Sörbom 1978)',
    tags: ['CB-SEM', 'Multigroup', 'Means and intercepts', 'Longitudinal', 'Covariance input', 'Textbook example'],
    links: [{ label: 'EQS 6 Structural Equations Program Manual (Bentler 2006)', url: 'https://www3.nd.edu/~kyuan/courses/sem/EQS-Manual6.pdf' }],
    body: 'Synonym and opposite tests before and after training, in controls (N = 105) and experimentals (N = 108). Post-test ability is regressed on pre-test ability; intercepts, loadings and that path are equal across the groups, and the opposites errors covary over time. χ² = 3.95 on 5 df, as the manual.',
    shows: 'The model fits, χ² = 3.95 on 5 df, as the EQS manual prints it. Compare the latent means of the two groups: with intercepts, loadings and the pre → post path equal, a post-test difference that the pre-test does not account for is the effect of training.',
  },
  {
    id: 'hayduk-revised' as const,
    authors: ['Hayduk'] as string[],
    title: 'Revised smoking model: a reciprocal effect (Hayduk 1987)',
    tags: ['CB-SEM', 'Non-recursive', 'Known reliability', 'Covariance input', 'Textbook example'],
    links: [{ label: 'Hayduk (1987), Structural Equation Modeling with LISREL', url: 'https://www.press.jhu.edu/books/title/2405/structural-equation-modeling-lisrel' }],
    body: 'Figure 8.6: antismoking views now also cause smoking, a loop with the effect of smoking on views. Identified by two exclusions, sex → smoking and religion → views (the instruments). Agrees with the LISREL estimates on the page within 0.01: smoking → views −1.25 (he prints −1.258) with a standard error of 0.83, views → smoking 0.03 with 0.065, neither estimate as much as twice its standard error: the data cannot tell the two directions apart, which is the chapter’s lesson. χ² = 3.10 on 2 df here against the 3.07 he prints (p = .21 and .22), with the paths of his Figure 8.6 exactly (sex → smoking, attendance → views and age → acts fixed at 0); the matrix is printed to three decimals, his LISREL VI run used it at full precision.',
    shows: 'The fit is χ² = 3.10 on 2 df (his 3.07), but read the standard errors: smoking → views −1.25 with SE 0.83 and views → smoking 0.03 with SE 0.065, so neither path is significant. The data cannot tell the two directions apart.',
  },
  {
    id: 'dhp' as const,
    authors: [] as string[],
    title: 'Peer influences on aspirations (Duncan, Haller & Portes 1968)',
    tags: ['CB-SEM', 'Non-recursive', 'Covariates', 'Covariance input', 'Textbook example'],
    links: [{ label: '?sem (sem package): the matrix and model', url: 'https://rdrr.io/cran/sem/man/sem.html' }, { label: 'Duncan, Haller & Portes (1968), AJS 74', url: 'https://doi.org/10.1086/224615' }],
    body: 'The classic non-recursive model: a respondent’s and a best friend’s general aspirations (each measured by occupational and educational aspiration) influence each other, with parental aspiration, intelligence and socio-economic status of both as fixed background variables and correlated disturbances. The first example of the sem package’s documentation (correlation matrix, N = 329), with its N − 1 convention (Wishart likelihood): χ² = 26.697 on 15 df as sem prints it, reciprocal effects .18 and .24.',
    shows: 'χ² = 26.697 on 15 df, as the sem package prints it. Look at the two reciprocal effects between the respondent’s and the friend’s general aspirations, .18 and .24: each friend’s aspiration raises the other’s.',
  },
];

/** Whether every word of a query occurs in one of the texts (case-insensitive). */
export function matchesQuery(query: string, texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter((t): t is string => !!t).join(' \n ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

interface CloudProject { id: string; name: string; role: 'owner' | 'editor' | 'viewer'; owner_name: string; members: number; updated_at: string }

function SharedProjects({ query }: { query: string }) {
  const auth = useAuth();
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<CloudProject[] | null>(null);
  useEffect(() => {
    if (!auth.user) { setList(null); return; }
    api.get<{ projects: CloudProject[] }>('/api/projects').then((r) => setList(r.projects)).catch(() => setList([]));
  }, [auth.user]);
  if (!auth.available) return null;
  if (!auth.user) {
    return (
      <section>
        <h2>Your projects</h2>
        <div className="start-card" style={{ cursor: 'default' }}>
          <b>Keep projects in an account</b>
          <span>Sign in and the projects you work on are saved to your account and listed here on every computer; share them with collaborators and edit together in real time. Datasets are stored encrypted on the PLS Studio server.</span>
          <button className="btn primary" style={{ marginTop: 6 }} onClick={() => auth.openDialog('signin')}>Sign in or create an account</button>
        </div>
      </section>
    );
  }
  const open = async (id: string) => {
    try { await openCloudProject(id, auth.user!); } catch (e) { toast('error', (e as Error).message); }
  };
  return (
    <section>
      <h2>Your projects</h2>
      {list === null ? <div className="hint">Loading…</div> : list.length === 0 ? (
        <div className="hint">No projects in your account yet. A project you work on while signed in is saved here as soon as it has a model or data; Share invites others to it.</div>
      ) : list.filter((p) => matchesQuery(query, [p.name, p.owner_name])).length === 0 ? (
        <div className="hint">No project of yours matches “{query}”.</div>
      ) : (
        <div className="recent-grid">
          {list.filter((p) => matchesQuery(query, [p.name, p.owner_name])).map((p) => (
            <div key={p.id} className="recent-card">
              <button className="recent-open" onClick={() => void open(p.id)} title={`Open ${p.name}`}>
                <span className="recent-name">{p.name}</span>
                <span className="recent-meta">
                  <span className="chip accent">{p.role === 'owner' ? 'Owner' : p.role === 'editor' ? 'Can edit' : 'Can view'}</span>
                  {p.members} member{p.members === 1 ? '' : 's'} · {p.role === 'owner' ? 'yours' : `by ${p.owner_name}`}
                </span>
                <span className="recent-time">edited {relativeTime(new Date(p.updated_at).getTime())}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Links to an example's original documentation, opened in a new tab. */
function SourceLinks({ links }: { links: { label: string; url: string }[] }) {
  if (!links.length) return null;
  return (
    <div className="source-links">
      {links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
    </div>
  );
}

/** Who the example comes from (the authors of the book, manual or paper it reproduces), as chips. */
export function ExampleAuthors({ authors }: { authors: string[] }) {
  if (!authors.length) return null;
  return <div className="example-tags" aria-label="Authors">{authors.map((a) => <span key={a} className="chip author">{a}</span>)}</div>;
}

/** What an example is about, as chips. */
export function ExampleTags({ tags }: { tags: string[] }) {
  return <div className="example-tags" aria-label="Topics">{tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>;
}

/** Examples from the R packages' documentation, filtered by the package, topic and author chosen at the top of the examples. */
function PackageExamples({ query, topic, pkg, onEvidence }: { query: string; topic: string; pkg: ExamplePackage | 'all'; onEvidence: (id: string) => void }) {
  const shown = PACKAGE_EXAMPLES.filter((e) => (pkg === 'all' || e.package === pkg) && (topic === 'all' || exampleTags(e).includes(topic) || exampleAuthors(e).includes(topic)) && matchesQuery(query, [e.title, e.description, e.source, e.package, ...exampleTags(e), ...exampleAuthors(e)]));
  return (
    <section className="home-examples">
      <h2>From R packages</h2>
      <p className="hint" style={{ marginTop: 0 }}>Datasets and models from each package’s own documentation. The data are loaded from the package in your browser’s R; results are calculated by that package.</p>
      {shown.length === 0 && <p className="hint">No example{pkg === 'all' ? '' : ` of ${pkg}`}{topic === 'all' ? '' : ` on ${topic}`}{query.trim() ? ` matches “${query.trim()}”` : ''}.</p>}
      <div className="example-grid">
        {shown.map((e) => (
          <div key={e.id} className="example-card">
            <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.package}</span></div>
            <ExampleTags tags={exampleTags(e)} />
            <ExampleAuthors authors={exampleAuthors(e)} />
            <p>{e.description}</p>
            {e.shows && <p className="example-shows"><b>What it shows:</b> {e.shows}</p>}
            <span className="hint">{e.source}</span>
            <SourceLinks links={e.links} />
            <div className="example-evidence"><EvidenceBadge id={e.id} onOpen={onEvidence} /></div>
            <div className="example-actions">
              <button className="btn" onClick={() => void loadPackageExample(e.id)}>Open example</button>
              {/* (data PLS Studio does not distribute: downloaded on opening, or from files the person downloaded) */}
              {e.data.remote && (
                <button className="btn ghost" title="Open the example with its data files downloaded from the source yourself (for Mplus: the example’s .inp and .dat, or the chapter’s zip)"
                  onClick={() => void pickFiles(EXAMPLE_FILES_ACCEPT).then((files) => { if (files) void loadPackageExample(e.id, { files }); })}>Import downloaded files…</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HomeScreen() {
  const projectId = useStore((s) => s.projectId);
  const currentName = useStore((s) => s.projectName);
  const hasCurrent = useStore((s) => s.model.constructs.length > 0 || s.data !== null);
  const setView = useStore((s) => s.setView);
  const [recent, setRecent] = useState<RecentMeta[] | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [about, setAbout] = useState(false);
  const openValidation = useStore((s) => s.openValidation);
  const [query, setQuery] = useState('');
  // One filter for every example, built-in and from the packages: a topic or an author, each list in alphabetical order.
  const [topic, setTopic] = useState('all');
  // The R package filter sits with the topics and authors; choosing a package shows that package's examples only.
  const [pkg, setPkg] = useState<ExamplePackage | 'all'>('all');
  const topics = useMemo(() => {
    return sortTopics([...EXAMPLES.flatMap((e) => e.tags), ...PACKAGE_EXAMPLES.flatMap((e) => exampleTags(e))]);
  }, []);
  const authors = useMemo(() => sortTopics([...EXAMPLES.flatMap((e) => e.authors), ...PACKAGE_EXAMPLES.flatMap((e) => exampleAuthors(e))]), []);
  const packages = useMemo(() => sortTopics(EXAMPLE_PACKAGES) as ExamplePackage[], []);
  const builtins = pkg !== 'all' ? [] : EXAMPLES.filter((e) => (topic === 'all' || e.tags.includes(topic) || e.authors.includes(topic)) && matchesQuery(query, [e.title, e.body, ...e.tags, ...e.authors]));

  const refresh = () => { void listRecent().then(setRecent); };
  useEffect(() => {
    refresh();
    void recentPersistent().then(setPersistent);
  }, []);

  const remove = async (r: RecentMeta) => {
    const ok = await confirmDialog({
      title: 'Remove from Recent projects?',
      body: `“${r.name}” will be removed from this browser’s list. Project files you saved are not affected.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await removeRecent(r.id);
    refresh();
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand"><span className="brand-mark"><IconLogo size={17} /></span>PLS Studio</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a className="btn ghost" href="guide.html" target="_blank" rel="noopener">User guide</a>
          <a className="btn ghost" href="architecture.html" target="_blank" rel="noopener" title="For developers: how PLS Studio is designed and how it talks to R">How it works</a>
          <button className="btn ghost" onClick={() => openValidation()} title="What every example and method is checked against, and a check of this browser">Validation</button>
          <button className="btn ghost" onClick={() => setAbout(true)}>About &amp; licences</button>
          {hasCurrent && <button className="btn primary" onClick={() => setView('editor')}>Back to “{currentName}”</button>}
          <AccountMenu />
        </div>
      </header>
      <main className="home-body">
        <section className="home-intro">
          <h1>Structural equation modelling in your browser</h1>
          <p>PLS-SEM, consistent PLS and composites, and covariance-based SEM (ML, robust, least squares, MIIV-2SLS), validated against lavaan, seminr, cSEM, plspm and MIIVsem. Data stays on your computer.</p>
        </section>

        <section className="home-start">
          <h2>Start</h2>
          <div className="start-grid">
            <button className="start-card" onClick={() => void newProject()}>
              <IconNew size={22} /><b>New project</b><span>Empty model; import data next.</span>
            </button>
            <button className="start-card" onClick={() => void newProjectFromData()}>
              <IconUpload size={22} /><b>New project from data</b><span>CSV with one column per indicator, or a labelled covariance matrix.</span>
            </button>
            <button className="start-card" onClick={() => void openProject()}>
              <IconOpen size={22} /><b>Open project file…</b><span>A .plsproj.json file saved earlier.</span>
            </button>
          </div>
        </section>

        <section className="home-search">
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects and examples"
            placeholder="Search your projects and the examples: words in the name, a topic (e.g. mediation, MIMIC, lavaan)…" />
        </section>

        <SharedProjects query={query} />

        <section className="home-recent">
          <h2>Recent projects</h2>
          {!persistent && <div className="issue warning">This browser does not allow local storage here, so recent projects are not kept between visits. Use Save to keep project files.</div>}
          {recent === null ? <div className="hint">Loading…</div> : recent.length === 0 ? (
            <div className="hint">No recent projects yet. Projects you work on are kept here automatically, in this browser only.</div>
          ) : recent.filter((r) => matchesQuery(query, [r.name, r.method, r.dataLabel])).length === 0 ? (
            <div className="hint">No recent project matches “{query}”.</div>
          ) : (
            <div className="recent-grid">
              {recent.filter((r) => matchesQuery(query, [r.name, r.method, r.dataLabel])).map((r) => (
                <div key={r.id} className={`recent-card${r.id === projectId && hasCurrent ? ' current' : ''}`}>
                  <button className="recent-open" onClick={() => void openRecent(r.id)} title={`Open ${r.name}`}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-meta">
                      <span className="chip accent">{r.method === 'cbsem' ? 'CB-SEM' : r.method === 'process' ? 'Process' : 'PLS-SEM'}</span>
                      {r.constructs} construct{r.constructs === 1 ? '' : 's'} · {r.dataLabel}
                    </span>
                    <span className="recent-time">{r.id === projectId && hasCurrent ? 'open now · ' : ''}edited {relativeTime(r.updated)}</span>
                  </button>
                  <button className="btn icon ghost sm" onClick={() => void remove(r)} aria-label={`Remove ${r.name} from recent projects`} title="Remove from list">
                    <IconTrash size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {recent && recent.length > 0 && <div className="hint" style={{ marginTop: 8 }}>Kept in this browser only. Use Save in a project to keep a file you can share or back up; sign in and a project you open is saved to your account.</div>}
        </section>

        <section className="home-examples">
          <h2>Examples</h2>
          <div className="segmented wrap topics" role="radiogroup" aria-label="Topic">
            {['all', ...topics].map((t) => (
              <button key={t} role="radio" aria-checked={topic === t} className={topic === t ? 'on' : ''} onClick={() => setTopic(t)}>{t === 'all' ? 'All topics' : t}</button>
            ))}
          </div>
          <div className="segmented wrap topics authors" role="radiogroup" aria-label="Author">
            {/* (authors share the topic filter: "Authors" is on while no author is chosen, and clears one) */}
            <button role="radio" aria-checked={!authors.includes(topic)} className={!authors.includes(topic) ? 'on' : ''} onClick={() => { if (authors.includes(topic)) setTopic('all'); }} title="Examples by any author">Authors</button>
            {authors.map((a) => (
              <button key={a} role="radio" aria-checked={topic === a} className={topic === a ? 'on' : ''} onClick={() => setTopic(topic === a ? 'all' : a)} title={`Examples from ${a}’s book, manual or paper`}>{a}</button>
            ))}
          </div>
          <div className="segmented wrap topics packages" role="radiogroup" aria-label="Package">
            <button role="radio" aria-checked={pkg === 'all'} className={pkg === 'all' ? 'on' : ''} onClick={() => setPkg('all')} title="Examples from every R package, and the built-in examples">Libraries</button>
            {packages.map((p) => (
              <button key={p} role="radio" aria-checked={pkg === p} className={pkg === p ? 'on' : ''} onClick={() => setPkg(pkg === p ? 'all' : p)} title={`Examples from the documentation of the R package ${p}`}>{p}</button>
            ))}
          </div>
          {pkg === 'all' && builtins.length === 0 && <p className="hint">No built-in example{topic === 'all' ? '' : ` on ${topic}`}{query.trim() ? ` matches “${query.trim()}”` : ''}.</p>}
          <div className="example-grid">
            {builtins.map((e) => (
              <div key={e.id} className="example-card">
                <div className="example-top"><b>{e.title}</b><span className="chip accent">{e.tags[0]}</span></div>
                <ExampleTags tags={e.tags} />
                <ExampleAuthors authors={e.authors} />
                <p>{e.body}</p>
                <p className="example-shows"><b>What it shows:</b> {e.shows}</p>
                <SourceLinks links={e.links} />
                <div className="example-evidence"><EvidenceBadge id={e.id} onOpen={openValidation} /></div>
                <button className="btn" onClick={() => void loadSample(e.id)}>Open example</button>
              </div>
            ))}
          </div>
        </section>

        <PackageExamples query={query} topic={topic} pkg={pkg} onEvidence={openValidation} />
      </main>
      {about && <AboutDialog onClose={() => setAbout(false)} />}
    </div>
  );
}
