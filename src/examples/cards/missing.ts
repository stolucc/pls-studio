// Examples that open the missing-data card with its MCAR tests: misty's ?na.test examples on R's airquality data,
// checked in cards/missing.webr.test.ts against misty run natively (scripts/validation/mcar.R) and, for Jamshidian &
// Jalal's tests, against MissMech, the implementation misty ports.

import { CB } from '../define';
import type { PackageExample } from '../packages';

export const CARD_MISSING: PackageExample[] = [
  {
    id: 'misty-airquality-mcar', package: 'misty', title: 'Is it missing completely at random? Little’s MCAR test on air quality', source: 'misty, ?na.test (airquality)',
    links: [{ label: '?na.test', url: 'https://rdrr.io/cran/misty/man/na.test.html' }, { label: '?airquality', url: 'https://rdrr.io/r/datasets/airquality.html' },
      { label: 'Little (1988), JASA 83(404)', url: 'https://doi.org/10.1080/01621459.1988.10478722' }, { label: 'Jamshidian & Jalal (2010), Psychometrika 75(4)', url: 'https://doi.org/10.1007/s11336-010-9175-3' }],
    description: 'New York’s daily air quality from May to September 1973 (153 days, R’s datasets package): ozone is missing on 37 days and solar radiation on 7, in four patterns. The two examples of misty’s ?na.test: Little’s (1988) MCAR test, which compares each pattern’s means with the maximum-likelihood means and covariances of all six variables, χ²(14) = 35.15, p = .001; and Jamshidian & Jalal’s (2010) tests, which impute the data 20 times and compare the covariance matrices (Hawkins) and distributions (nonparametric Anderson-Darling) of the two patterns with at least six cases: p = .220 and p = .052 (medians over the imputations, seed 42 as on the help page). The card shows each pattern’s share of Little’s χ² besides the patterns, coverage and EM estimates. Opens its card on the Analyses tab.',
    shows: 'Little’s test rejects MCAR, χ²(14) = 35.15, p = .001: the days with missing ozone or radiation differ in their other measurements, so analyses should assume MAR (FIML or multiple imputation), not MCAR. Jamshidian & Jalal’s tests, on the two larger patterns only, do not reject at 5% (Hawkins p = .220, Anderson-Darling p = .052): they ask a different question, of equal covariances and distributions.',
    data: { package: 'datasets', name: 'airquality' }, constructs: [], paths: [], tags: ['Missing data'],
    panel: { kind: 'missingdata', vars: ['Ozone', 'Solar.R', 'Wind', 'Temp', 'Month', 'Day'], measures: [], descriptive: [], mcar: true, jamjal: true }, settings: { ...CB('ML'), seed: 42 },
  },
];
