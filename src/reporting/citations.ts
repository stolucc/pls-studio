// The works the generated methods text and the reviewer checklist cite: an
// author–year form for plain text and a BibTeX entry for LaTeX (\citep keys).
// Software entries carry the version that actually ran (no year is invented:
// package manuals without a fixed citation year are "n.d.").

interface Entry {
  type: string;
  fields: Record<string, string>;
}
const art = (fields: Record<string, string>, type = 'article'): Entry => ({ type, fields });
const entryText = (key: string, { type, fields }: Entry) =>
  `@${type}{${key},\n${Object.entries(fields)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(',\n')}\n}`;

/** Every work the generated texts can cite, by BibTeX key: the author–year form, and the entry (given the version that ran, for software). */
const WORKS: Record<string, { cite: string; entry: (version?: string) => Entry }> = {
  hair2019: {
    cite: 'Hair et al., 2019',
    entry: () =>
      art({
        author:
          'Hair, Joseph F. and Risher, Jeffrey J. and Sarstedt, Marko and Ringle, Christian M.',
        title: 'When to use and how to report the results of {PLS-SEM}',
        journal: 'European Business Review',
        year: '2019',
        volume: '31',
        number: '1',
        pages: '2--24',
        doi: '10.1108/EBR-11-2018-0203',
      }),
  },
  becker2023: {
    cite: 'Becker et al., 2023',
    entry: () =>
      art({
        author:
          'Becker, Jan-Michael and Cheah, Jun-Hwa and Gholamzade, Rasoul and Ringle, Christian M. and Sarstedt, Marko',
        title: "{PLS-SEM}'s most wanted guidance",
        journal: 'International Journal of Contemporary Hospitality Management',
        year: '2023',
        volume: '35',
        number: '1',
        pages: '321--346',
        doi: '10.1108/IJCHM-04-2022-0474',
      }),
  },
  becker2018: {
    cite: 'Becker et al., 2018',
    entry: () =>
      art({
        author: 'Becker, Jan-Michael and Ringle, Christian M. and Sarstedt, Marko',
        title:
          'Estimating moderating effects in {PLS-SEM} and {PLSc-SEM}: Interaction term generation*data treatment',
        journal: 'Journal of Applied Structural Equation Modeling',
        year: '2018',
        volume: '2',
        number: '2',
        pages: '1--21',
        doi: '10.47263/JASEM.2(2)01',
      }),
  },
  becker2012: {
    cite: 'Becker et al., 2012',
    entry: () =>
      art({
        author: 'Becker, Jan-Michael and Klein, Kristina and Wetzels, Martin',
        title:
          'Hierarchical latent variable models in {PLS-SEM}: Guidelines for using reflective-formative type models',
        journal: 'Long Range Planning',
        year: '2012',
        volume: '45',
        number: '5--6',
        pages: '359--394',
        doi: '10.1016/j.lrp.2012.10.001',
      }),
  },
  sarstedt2019: {
    cite: 'Sarstedt et al., 2019',
    entry: () =>
      art({
        author:
          'Sarstedt, Marko and Hair, Joseph F. and Cheah, Jun-Hwa and Becker, Jan-Michael and Ringle, Christian M.',
        title: 'How to specify, estimate, and validate higher-order constructs in {PLS-SEM}',
        journal: 'Australasian Marketing Journal',
        year: '2019',
        volume: '27',
        number: '3',
        pages: '197--211',
        doi: '10.1016/j.ausmj.2019.05.003',
      }),
  },
  ringle2012: {
    cite: 'Ringle et al., 2012',
    entry: () =>
      art({
        author: 'Ringle, Christian M. and Sarstedt, Marko and Straub, Detmar W.',
        title: 'A critical look at the use of {PLS-SEM} in {MIS Quarterly}',
        journal: 'MIS Quarterly',
        year: '2012',
        volume: '36',
        number: '1',
        pages: 'iii--xiv',
        doi: '10.2307/41410402',
      }),
  },
  cenfetelli2009: {
    cite: 'Cenfetelli & Bassellier, 2009',
    entry: () =>
      art({
        author: 'Cenfetelli, Ronald T. and Bassellier, Genevi{\\`e}ve',
        title: 'Interpretation of formative measurement in information systems research',
        journal: 'MIS Quarterly',
        year: '2009',
        volume: '33',
        number: '4',
        pages: '689--707',
        doi: '10.2307/20650323',
      }),
  },
  cheah2018: {
    cite: 'Cheah et al., 2018',
    entry: () =>
      art({
        author:
          'Cheah, Jun-Hwa and Sarstedt, Marko and Ringle, Christian M. and Ramayah, T. and Ting, Hiram',
        title:
          'Convergent validity assessment of formatively measured constructs in {PLS-SEM}: On using single-item versus multi-item measures in redundancy analyses',
        journal: 'International Journal of Contemporary Hospitality Management',
        year: '2018',
        volume: '30',
        number: '11',
        pages: '3192--3210',
        doi: '10.1108/IJCHM-10-2017-0649',
      }),
  },
  hair2021: {
    cite: 'Hair et al., 2021',
    entry: () =>
      art(
        {
          author:
            'Hair, Joseph F. and Hult, G. Tomas M. and Ringle, Christian M. and Sarstedt, Marko and Danks, Nicholas P. and Ray, Soumya',
          title:
            'Partial Least Squares Structural Equation Modeling ({PLS-SEM}) Using {R}: A Workbook',
          publisher: 'Springer',
          address: 'Cham',
          year: '2021',
          doi: '10.1007/978-3-030-80519-7',
        },
        'book',
      ),
  },
  henseler2015: {
    cite: 'Henseler et al., 2015',
    entry: () =>
      art({
        author: 'Henseler, J{\\"o}rg and Ringle, Christian M. and Sarstedt, Marko',
        title:
          'A new criterion for assessing discriminant validity in variance-based structural equation modeling',
        journal: 'Journal of the Academy of Marketing Science',
        year: '2015',
        volume: '43',
        number: '1',
        pages: '115--135',
        doi: '10.1007/s11747-014-0403-8',
      }),
  },
  henseler2014: {
    cite: 'Henseler et al., 2014',
    entry: () =>
      art({
        author:
          'Henseler, J{\\"o}rg and Dijkstra, Theo K. and Sarstedt, Marko and Ringle, Christian M. and Diamantopoulos, Adamantios and Straub, Detmar W. and Ketchen, David J. and Hair, Joseph F. and Hult, G. Tomas M. and Calantone, Roger J.',
        title:
          'Common beliefs and reality about {PLS}: Comments on {R}{\\"o}nkk{\\"o} and {E}vermann (2013)',
        journal: 'Organizational Research Methods',
        year: '2014',
        volume: '17',
        number: '2',
        pages: '182--209',
        doi: '10.1177/1094428114526928',
      }),
  },
  henseler2016: {
    cite: 'Henseler et al., 2016',
    entry: () =>
      art({
        author: 'Henseler, J{\\"o}rg and Ringle, Christian M. and Sarstedt, Marko',
        title: 'Testing measurement invariance of composites using partial least squares',
        journal: 'International Marketing Review',
        year: '2016',
        volume: '33',
        number: '3',
        pages: '405--431',
        doi: '10.1108/IMR-09-2014-0304',
      }),
  },
  dijkstra2015: {
    cite: 'Dijkstra & Henseler, 2015',
    entry: () =>
      art({
        author: 'Dijkstra, Theo K. and Henseler, J{\\"o}rg',
        title: 'Consistent partial least squares path modeling',
        journal: 'MIS Quarterly',
        year: '2015',
        volume: '39',
        number: '2',
        pages: '297--316',
        doi: '10.25300/MISQ/2015/39.2.02',
      }),
  },
  shmueli2019: {
    cite: 'Shmueli et al., 2019',
    entry: () =>
      art({
        author:
          'Shmueli, Galit and Sarstedt, Marko and Hair, Joseph F. and Cheah, Jun-Hwa and Ting, Hiram and Vaithilingam, Santha and Ringle, Christian M.',
        title: 'Predictive model assessment in {PLS-SEM}: Guidelines for using {PLSpredict}',
        journal: 'European Journal of Marketing',
        year: '2019',
        volume: '53',
        number: '11',
        pages: '2322--2347',
        doi: '10.1108/EJM-02-2019-0189',
      }),
  },
  fornell1981: {
    cite: 'Fornell & Larcker, 1981',
    entry: () =>
      art({
        author: 'Fornell, Claes and Larcker, David F.',
        title:
          'Evaluating structural equation models with unobservable variables and measurement error',
        journal: 'Journal of Marketing Research',
        year: '1981',
        volume: '18',
        number: '1',
        pages: '39--50',
        doi: '10.1177/002224378101800104',
      }),
  },
  cohen1988: {
    cite: 'Cohen, 1988',
    entry: () =>
      art(
        {
          author: 'Cohen, Jacob',
          title: 'Statistical Power Analysis for the Behavioral Sciences',
          edition: '2nd',
          publisher: 'Lawrence Erlbaum',
          address: 'Hillsdale, NJ',
          year: '1988',
        },
        'book',
      ),
  },
  hu1999: {
    cite: 'Hu & Bentler, 1999',
    entry: () =>
      art({
        author: 'Hu, Li-tze and Bentler, Peter M.',
        title:
          'Cutoff criteria for fit indexes in covariance structure analysis: Conventional criteria versus new alternatives',
        journal: 'Structural Equation Modeling',
        year: '1999',
        volume: '6',
        number: '1',
        pages: '1--55',
        doi: '10.1080/10705519909540118',
      }),
  },
  jackson2009: {
    cite: 'Jackson et al., 2009',
    entry: () =>
      art({
        author: 'Jackson, Dennis L. and Gillaspy, J. Arthur, Jr. and Purc-Stephenson, Rebecca',
        title:
          'Reporting practices in confirmatory factor analysis: An overview and some recommendations',
        journal: 'Psychological Methods',
        year: '2009',
        volume: '14',
        number: '1',
        pages: '6--23',
        doi: '10.1037/a0014694',
      }),
  },
  appelbaum2018: {
    cite: 'Appelbaum et al., 2018',
    entry: () =>
      art({
        author:
          'Appelbaum, Mark and Cooper, Harris and Kline, Rex B. and Mayo-Wilson, Evan and Nezu, Arthur M. and Rao, Stephen M.',
        title:
          'Journal article reporting standards for quantitative research in psychology: The {APA} Publications and Communications Board task force report',
        journal: 'American Psychologist',
        year: '2018',
        volume: '73',
        number: '1',
        pages: '3--25',
        doi: '10.1037/amp0000191',
      }),
  },
  yuan2000: {
    cite: 'Yuan & Bentler, 2000',
    entry: () =>
      art({
        author: 'Yuan, Ke-Hai and Bentler, Peter M.',
        title:
          'Three likelihood-based methods for mean and covariance structure analysis with nonnormal missing data',
        journal: 'Sociological Methodology',
        year: '2000',
        volume: '30',
        number: '1',
        pages: '165--200',
        doi: '10.1111/0081-1750.00078',
      }),
  },
  satorra1994: {
    cite: 'Satorra & Bentler, 1994',
    entry: () =>
      art(
        {
          author: 'Satorra, Albert and Bentler, Peter M.',
          title:
            'Corrections to test statistics and standard errors in covariance structure analysis',
          booktitle: 'Latent Variables Analysis: Applications for Developmental Research',
          editor: 'von Eye, Alexander and Clogg, Clifford C.',
          publisher: 'Sage',
          address: 'Thousand Oaks, CA',
          year: '1994',
          pages: '399--419',
        },
        'incollection',
      ),
  },
  muthen1997: {
    cite: 'Muthén et al., 1997',
    entry: () =>
      art(
        {
          author: "Muth{\\'e}n, Bengt O. and du Toit, Stephen H. C. and Spisic, Damir",
          title:
            'Robust inference using weighted least squares and quadratic estimating equations in latent variable modeling with categorical and continuous outcomes',
          institution: 'University of California, Los Angeles',
          type: 'Unpublished technical report',
          year: '1997',
        },
        'techreport',
      ),
  },
  brosseau2012: {
    cite: 'Brosseau-Liard et al., 2012',
    entry: () =>
      art({
        author: 'Brosseau-Liard, Patricia E. and Savalei, Victoria and Li, Libo',
        title:
          'An investigation of the sample performance of two nonnormality corrections for {RMSEA}',
        journal: 'Multivariate Behavioral Research',
        year: '2012',
        volume: '47',
        number: '6',
        pages: '904--930',
        doi: '10.1080/00273171.2012.715252',
      }),
  },
  brosseau2014: {
    cite: 'Brosseau-Liard & Savalei, 2014',
    entry: () =>
      art({
        author: 'Brosseau-Liard, Patricia E. and Savalei, Victoria',
        title: 'Adjusting incremental fit indices for nonnormality',
        journal: 'Multivariate Behavioral Research',
        year: '2014',
        volume: '49',
        number: '5',
        pages: '460--470',
        doi: '10.1080/00273171.2014.933697',
      }),
  },
  arbuckle1996: {
    cite: 'Arbuckle, 1996',
    entry: () =>
      art(
        {
          author: 'Arbuckle, James L.',
          title: 'Full information estimation in the presence of incomplete data',
          booktitle: 'Advanced Structural Equation Modeling: Issues and Techniques',
          editor: 'Marcoulides, George A. and Schumacker, Randall E.',
          publisher: 'Lawrence Erlbaum',
          address: 'Mahwah, NJ',
          year: '1996',
          pages: '243--277',
        },
        'incollection',
      ),
  },
  enders2001: {
    cite: 'Enders & Bandalos, 2001',
    entry: () =>
      art({
        author: 'Enders, Craig K. and Bandalos, Deborah L.',
        title:
          'The relative performance of full information maximum likelihood estimation for missing data in structural equation models',
        journal: 'Structural Equation Modeling',
        year: '2001',
        volume: '8',
        number: '3',
        pages: '430--457',
        doi: '10.1207/S15328007SEM0803_5',
      }),
  },
  savalei2009: {
    cite: 'Savalei & Bentler, 2009',
    entry: () =>
      art({
        author: 'Savalei, Victoria and Bentler, Peter M.',
        title:
          'A two-stage approach to missing data: Theory and application to auxiliary variables',
        journal: 'Structural Equation Modeling',
        year: '2009',
        volume: '16',
        number: '3',
        pages: '477--497',
        doi: '10.1080/10705510903008238',
      }),
  },
  rubin1987: {
    cite: 'Rubin, 1987',
    entry: () =>
      art(
        {
          author: 'Rubin, Donald B.',
          title: 'Multiple Imputation for Nonresponse in Surveys',
          publisher: 'Wiley',
          address: 'New York',
          year: '1987',
          doi: '10.1002/9780470316696',
        },
        'book',
      ),
  },
  vanbuuren2011: {
    cite: 'van Buuren & Groothuis-Oudshoorn, 2011',
    entry: () =>
      art({
        author: 'van Buuren, Stef and Groothuis-Oudshoorn, Karin',
        title: '{mice}: Multivariate imputation by chained equations in {R}',
        journal: 'Journal of Statistical Software',
        year: '2011',
        volume: '45',
        number: '3',
        pages: '1--67',
        doi: '10.18637/jss.v045.i03',
      }),
  },
  honaker2011: {
    cite: 'Honaker et al., 2011',
    entry: () =>
      art({
        author: 'Honaker, James and King, Gary and Blackwell, Matthew',
        title: '{Amelia II}: A program for missing data',
        journal: 'Journal of Statistical Software',
        year: '2011',
        volume: '45',
        number: '7',
        pages: '1--47',
        doi: '10.18637/jss.v045.i07',
      }),
  },
  efron1993: {
    cite: 'Efron & Tibshirani, 1993',
    entry: () =>
      art(
        {
          author: 'Efron, Bradley and Tibshirani, Robert J.',
          title: 'An Introduction to the Bootstrap',
          publisher: 'Chapman \\& Hall',
          address: 'New York',
          year: '1993',
        },
        'book',
      ),
  },
  hayes2022: {
    cite: 'Hayes, 2022',
    entry: () =>
      art(
        {
          author: 'Hayes, Andrew F.',
          title:
            'Introduction to Mediation, Moderation, and Conditional Process Analysis: A Regression-Based Approach',
          edition: '3rd',
          publisher: 'Guilford Press',
          address: 'New York',
          year: '2022',
        },
        'book',
      ),
  },
  hayes2007: {
    cite: 'Hayes & Cai, 2007',
    entry: () =>
      art({
        author: 'Hayes, Andrew F. and Cai, Li',
        title:
          'Using heteroskedasticity-consistent standard error estimators in {OLS} regression: An introduction and software implementation',
        journal: 'Behavior Research Methods',
        year: '2007',
        volume: '39',
        number: '4',
        pages: '709--722',
        doi: '10.3758/BF03192961',
      }),
  },
  long2000: {
    cite: 'Long & Ervin, 2000',
    entry: () =>
      art({
        author: 'Long, J. Scott and Ervin, Laurie H.',
        title: 'Using heteroscedasticity consistent standard errors in the linear regression model',
        journal: 'The American Statistician',
        year: '2000',
        volume: '54',
        number: '3',
        pages: '217--224',
        doi: '10.1080/00031305.2000.10474549',
      }),
  },
  preacher2012: {
    cite: 'Preacher & Selig, 2012',
    entry: () =>
      art({
        author: 'Preacher, Kristopher J. and Selig, James P.',
        title: 'Advantages of {M}onte {C}arlo confidence intervals for indirect effects',
        journal: 'Communication Methods and Measures',
        year: '2012',
        volume: '6',
        number: '2',
        pages: '77--98',
        doi: '10.1080/19312458.2012.679848',
      }),
  },
  rosseel2024: {
    cite: 'Rosseel & Loh, 2024',
    entry: () =>
      art({
        author: 'Rosseel, Yves and Loh, Wen Wei',
        title: 'A structural after measurement approach to structural equation modeling',
        journal: 'Psychological Methods',
        year: '2024',
        volume: '29',
        number: '3',
        pages: '561--588',
        doi: '10.1037/met0000503',
      }),
  },
  bollen1996: {
    cite: 'Bollen, 1996',
    entry: () =>
      art({
        author: 'Bollen, Kenneth A.',
        title:
          'An alternative two stage least squares ({2SLS}) estimator for latent variable equations',
        journal: 'Psychometrika',
        year: '1996',
        volume: '61',
        number: '1',
        pages: '109--121',
        doi: '10.1007/BF02296961',
      }),
  },
  klein2000: {
    cite: 'Klein & Moosbrugger, 2000',
    entry: () =>
      art({
        author: 'Klein, Andreas and Moosbrugger, Helfried',
        title: 'Maximum likelihood estimation of latent interaction effects with the {LMS} method',
        journal: 'Psychometrika',
        year: '2000',
        volume: '65',
        number: '4',
        pages: '457--474',
        doi: '10.1007/BF02296338',
      }),
  },
  klein2007: {
    cite: 'Klein & Muthén, 2007',
    entry: () =>
      art({
        author: "Klein, Andreas G. and Muth{\\'e}n, Bengt O.",
        title:
          'Quasi-maximum likelihood estimation of structural equation models with multiple interaction and quadratic effects',
        journal: 'Multivariate Behavioral Research',
        year: '2007',
        volume: '42',
        number: '4',
        pages: '647--673',
        doi: '10.1080/00273170701710205',
      }),
  },
  marsh2004: {
    cite: 'Marsh et al., 2004',
    entry: () =>
      art({
        author: 'Marsh, Herbert W. and Wen, Zhonglin and Hau, Kit-Tai',
        title:
          'Structural equation models of latent interactions: Evaluation of alternative estimation strategies and indicator construction',
        journal: 'Psychological Methods',
        year: '2004',
        volume: '9',
        number: '3',
        pages: '275--300',
        doi: '10.1037/1082-989X.9.3.275',
      }),
  },
  // Software
  rcore: {
    cite: 'R Core Team',
    entry: (v) =>
      art(
        {
          author: '{R Core Team}',
          title: '{R}: A Language and Environment for Statistical Computing',
          organization: 'R Foundation for Statistical Computing',
          address: 'Vienna, Austria',
          year: v ? rYear(v) : 'n.d.',
          ...(v ? { note: `Version ${v}` } : {}),
          url: 'https://www.R-project.org/',
        },
        'manual',
      ),
  },
  webr: {
    cite: 'Stagg & Henry, n.d.',
    entry: (v) =>
      art(
        {
          author: 'Stagg, George W. and Henry, Lionel',
          title: '{webR}: The statistical language {R} compiled to {WebAssembly}',
          year: 'n.d.',
          ...(v ? { note: `Version ${v}` } : {}),
          url: 'https://docs.r-wasm.org/webr/latest/',
        },
        'manual',
      ),
  },
  csem: {
    cite: 'Rademaker & Schuberth, 2020',
    entry: (v) =>
      art(
        {
          author: 'Rademaker, Manuel E. and Schuberth, Florian',
          title: '{cSEM}: Composite-Based Structural Equation Modeling',
          year: '2020',
          ...(v ? { note: `R package version ${v}` } : {}),
          url: 'https://floschuberth.github.io/cSEM/',
        },
        'manual',
      ),
  },
  seminr: {
    cite: 'Ray et al., n.d.',
    entry: (v) =>
      art(
        {
          author: "Ray, Soumya and Danks, Nicholas P. and Calero Valdez, Andr{\\'e}",
          title: '{seminr}: Building and Estimating Structural Equation Models',
          year: 'n.d.',
          ...(v ? { note: `R package version ${v}` } : {}),
          doi: '10.32614/CRAN.package.seminr',
          url: 'https://CRAN.R-project.org/package=seminr',
        },
        'manual',
      ),
  },
  rosseel2012: {
    cite: 'Rosseel, 2012',
    entry: () =>
      art({
        author: 'Rosseel, Yves',
        title: '{lavaan}: An {R} package for structural equation modeling',
        journal: 'Journal of Statistical Software',
        year: '2012',
        volume: '48',
        number: '2',
        pages: '1--36',
        doi: '10.18637/jss.v048.i02',
      }),
  },
  cheung2024: {
    cite: 'Cheung & Cheung, 2024',
    entry: () =>
      art({
        author: 'Cheung, Shu Fai and Cheung, Sing-Hang',
        title:
          '{manymome}: An {R} package for computing the indirect effects, conditional effects, and conditional indirect effects, standardized or unstandardized, and their bootstrap confidence intervals, in many (though not all) models',
        journal: 'Behavior Research Methods',
        year: '2024',
        volume: '56',
        pages: '4862--4882',
        doi: '10.3758/s13428-023-02224-z',
      }),
  },
  slupphaug2025: {
    cite: 'Slupphaug et al., 2025',
    entry: () =>
      art({
        author: 'Slupphaug, Kjell Solem and Mehmetoglu, Mehmet and Mittner, Matthias',
        title: '{modsem}: An {R} package for estimating latent interactions and quadratic effects',
        journal: 'Structural Equation Modeling: A Multidisciplinary Journal',
        year: '2025',
        volume: '32',
        number: '4',
        pages: '717--729',
        doi: '10.1080/10705511.2024.2417409',
      }),
  },
  fisher2021: {
    cite: 'Fisher et al., n.d.',
    entry: (v) =>
      art(
        {
          author:
            'Fisher, Zachary and Bollen, Kenneth and Gates, Kathleen and R{\\"o}nkk{\\"o}, Mikko',
          title:
            '{MIIVsem}: Model Implied Instrumental Variable ({MIIV}) Estimation of Structural Equation Models',
          year: 'n.d.',
          ...(v ? { note: `R package version ${v}` } : {}),
          doi: '10.32614/CRAN.package.MIIVsem',
          url: 'https://CRAN.R-project.org/package=MIIVsem',
        },
        'manual',
      ),
  },
};

/** R x.y.0 has been released each spring since 3.0 (2013): its year from the version. */
export function rYear(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return 'n.d.';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major === 4) return String(2020 + minor);
  if (major === 3) return String(2013 + minor);
  return 'n.d.';
}

export const CITATION_KEYS = Object.keys(WORKS);
export const hasWork = (key: string) => key in WORKS;

/** The author–year form of a work (R's year follows its version). */
export function citeText(key: string, version?: string): string {
  const w = WORKS[key];
  if (!w) throw new Error(`Unknown citation key ${key}`);
  return key === 'rcore' ? `R Core Team, ${version ? rYear(version) : 'n.d.'}` : w.cite;
}

/** The BibTeX file of the cited works, in the order given (software with the versions that ran). */
export function bibtex(keys: string[], versions: Record<string, string> = {}): string {
  return (
    [...new Set(keys)]
      .map((k) => {
        const w = WORKS[k];
        if (!w) throw new Error(`Unknown citation key ${k}`);
        return entryText(k, w.entry(versions[k]));
      })
      .join('\n\n') + '\n'
  );
}

/** The keys of the entries in a BibTeX text. */
export const bibKeys = (bib: string) => [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
