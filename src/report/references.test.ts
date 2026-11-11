// The reference list of the report: BibTeX from reporting/citations.ts as
// APA-like references (authors with initials, accents, editors, editions).

import { describe, expect, it } from 'vitest';
import { bibtex, CITATION_KEYS } from '../reporting/citations';
import { bibText, parseBibtex, referenceList } from './references';

describe('reference list', () => {
  it('reads every entry citations.ts can write', () => {
    const entries = parseBibtex(bibtex(CITATION_KEYS, { rcore: '4.5.1', lavaan: '0.6-19' }));
    expect(entries.map((e) => e.key)).toEqual(CITATION_KEYS);
    for (const e of entries) expect(e.fields.title).toBeTruthy();
  });

  it('formats journal articles, books, chapters, reports and software', () => {
    const refs = referenceList(
      bibtex(['hair2019', 'cohen1988', 'satorra1994', 'muthen1997', 'rcore'], { rcore: '4.5.1' }),
    );
    expect(refs).toEqual([
      'Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Lawrence Erlbaum.',
      'Hair, J. F., Risher, J. J., Sarstedt, M., & Ringle, C. M. (2019). When to use and how to report the results of PLS-SEM. European Business Review, 31(1), 2–24. https://doi.org/10.1108/EBR-11-2018-0203',
      'Muthén, B. O., du Toit, S. H. C., & Spisic, D. (1997). Robust inference using weighted least squares and quadratic estimating equations in latent variable modeling with categorical and continuous outcomes [Unpublished technical report]. University of California, Los Angeles.',
      'R Core Team. (2025). R: A Language and Environment for Statistical Computing (Version 4.5.1). R Foundation for Statistical Computing. https://www.R-project.org/',
      'Satorra, A., & Bentler, P. M. (1994). Corrections to test statistics and standard errors in covariance structure analysis. In von Eye, A., & Clogg, C. C. (Eds.), Latent Variables Analysis: Applications for Developmental Research (pp. 399–419). Sage.',
    ]);
  });

  it('turns BibTeX escapes into text', () => {
    expect(bibText('R{\\"o}nkk{\\"o} \\& {PLS}--SEM')).toBe('Rönkkö & PLS–SEM');
    expect(bibText("Muth{\\'e}n")).toBe('Muthén');
  });
});
