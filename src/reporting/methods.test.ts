import { describe, expect, it } from 'vitest';
import { bibKeys, bibtex, CITATION_KEYS, citeText, rYear } from './citations';
import { enginePackages, methodsBlocked, methodsText, render } from './methods';
import { cbInput, cbResult, cpaInput, cpaResult, plsBoot, plsInput, plsResult } from './fixtures';

const citedKeys = (latex: string) => [...latex.matchAll(/\\cite(?:p|t|alp)(?:\[[^\]]*\]\[[^\]]*\])?\{([^}]+)\}/g)].flatMap((m) => m[1].split(','));

describe('methods text', () => {
  it('PLS-SEM: describes the software, algorithm, model, missing data, bootstrap and criteria', () => {
    const r = methodsText(plsInput());
    expect(r.text).toMatchSnapshot();
    expect(r.latex).toMatchSnapshot();
    expect(r.text).toContain('cSEM (version 0.7.1; Rademaker & Schuberth, 2020) in R (version 4.5.1; R Core Team, 2025), run in the web browser through webR (version 0.5.4; Stagg & Henry, n.d.)');
    expect(r.text).toContain('5,000 bootstrap resamples');
    expect(r.text).toContain('random seed 1234');
    expect(r.text).toContain('Satisfaction (composite, Mode B, 4 indicators)');
    expect(r.text).toContain('formatively measured (Mode B)');
    expect(r.text).not.toContain('PLSpredict'); // not run
  });

  it('CB-SEM with MLR, FIML and a bootstrap', () => {
    const r = methodsText(cbInput());
    expect(r.text).toMatchSnapshot();
    expect(r.latex).toMatchSnapshot();
    expect(r.text).toContain('robust (Huber–White) standard errors');
    expect(r.text).toContain('full-information maximum likelihood (FIML; Arbuckle, 1996; Enders & Bandalos, 2001), with robust standard errors and test statistic for incomplete non-normal data (Yuan & Bentler, 2000)');
    expect(r.text).toContain('lavaan (version 0.6-19; Rosseel, 2012) in R (version 4.4.2; R Core Team, 2024), through PLS Studio'); // desktop R: no webR
    expect(r.text).toContain('bias-corrected and accelerated (BCa)');
    expect(r.text).toContain('2,000 bootstrap resamples (Efron & Tibshirani, 1993), of which 3 failed and were skipped, with two-tailed tests');
    expect(r.text).toContain('(MLR; Yuan & Bentler, 2000)');
    expect(r.text).toContain('robust CFI, TLI and RMSEA');
    expect(r.text).toContain('Hu and Bentler (1999)');
  });

  it('conditional process analysis (PROCESS model 4, HC3)', () => {
    const r = methodsText(cpaInput());
    expect(r.text).toMatchSnapshot();
    expect(r.latex).toMatchSnapshot();
    expect(r.text).toContain('model 4 of PROCESS');
    expect(r.text).toContain('HC3 heteroskedasticity-consistent standard errors');
    expect(r.text).toContain('10,000 resamples');
    expect(r.text).toContain('random seed 2024');
    expect(r.text).toContain('Efficacy (mean of 3 items)');
    expect(r.text).toContain('The data had no missing values.');
  });

  it('cites only works in the BibTeX output, each once', () => {
    for (const input of [plsInput(), cbInput(), cpaInput(), plsInput({ log: [{ type: 'plspredict', run: true }, { type: 'mga', run: true }] })]) {
      const r = methodsText(input);
      const inBib = bibKeys(r.bibtex);
      expect(new Set(inBib).size).toBe(inBib.length);
      for (const k of citedKeys(r.latex)) expect(inBib, k).toContain(k);
      expect(inBib.sort()).toEqual([...new Set(citedKeys(r.latex))].sort());
      expect(r.keys.sort()).toEqual(inBib.sort());
    }
  });

  it('puts the versions that ran into the software entries', () => {
    const r = methodsText(plsInput());
    expect(r.bibtex).toContain('note = {R package version 0.7.1}');
    expect(r.bibtex).toContain('note = {Version 4.5.1}');
    expect(r.bibtex).toContain('year = {2025}');
  });

  it('only describes what was run', () => {
    const noBoot = methodsText(plsInput({ boot: null })).text;
    expect(noBoot).not.toContain('bootstrap');
    const withPredict = methodsText(plsInput({ log: [{ type: 'plspredict', run: true }] })).text;
    expect(withPredict).toContain('PLSpredict');
    expect(methodsText(plsInput({ log: [{ type: 'plspredict', run: false }] })).text).not.toContain('PLSpredict');
    // A bootstrap without a recorded seed names none (the settings' seed may not be the one it ran with).
    expect(methodsText(plsInput({ boot: { ...plsBoot(), seed: undefined } })).text).not.toContain('seed');
    // PLSc, the built-in engine, mean replacement.
    const plsc = methodsText(plsInput({ pls: { ...plsResult({ consistent: true }), engine: undefined } as never })).text;
    expect(plsc).toContain('consistent partial least squares');
    expect(plsc).toContain('the built-in PLS-SEM engine of PLS Studio');
    expect(plsc).toContain('replaced by the indicator’s mean');
    // CB-SEM without robust indices: no robust sentence; ML has no estimator citation.
    const ml = methodsText(cbInput({ cb: cbResult({ estimator: 'ML', fit: { ...cbResult().fit, cfiRobust: undefined, tliRobust: undefined, rmseaRobust: undefined, chisqScaled: undefined } }), boot: null })).text;
    expect(ml).toContain('by maximum likelihood (ML) with');
    expect(ml).not.toContain('robust CFI');
    // Monte Carlo intervals for latent CPA scales.
    const mc = methodsText(cpaInput({ process: cpaResult({ inference: 'montecarlo', latent: ['Efficacy'], hc: 'none', engine: { package: 'lavaan::sam + manymome', version: '0.6-19 / 0.2.4' } }) })).text;
    expect(mc).toContain('Monte Carlo confidence intervals');
    expect(mc).toContain('lavaan (version 0.6-19; Rosseel, 2012) and manymome (version 0.2.4; Cheung & Cheung, 2024)');
  });

  it('says what is missing before anything is calculated', () => {
    expect(methodsBlocked(plsInput({ pls: null }))).toMatch(/Calculate the model first/);
    expect(methodsBlocked(plsInput())).toBeNull();
    expect(() => methodsText(plsInput({ pls: null }))).toThrow(/Calculate/);
  });
});

describe('citations', () => {
  it('render to author–year text and natbib LaTeX', () => {
    const r = render('As ⟦t:hu1999⟧ put it ⟦hair2019,henseler2015⟧ in R ⟦version 4.4.0;|rcore⟧ 50% & more (see ⟦a:cohen1988⟧).', { rcore: '4.4.0' });
    expect(r.text).toBe('As Hu and Bentler (1999) put it (Hair et al., 2019; Henseler et al., 2015) in R (version 4.4.0; R Core Team, 2024) 50% & more (see Cohen, 1988).');
    expect(r.latex).toBe('As \\citet{hu1999} put it \\citep{hair2019,henseler2015} in R \\citep[version 4.4.0;][]{rcore} 50\\% \\& more (see \\citealp{cohen1988}).');
    expect(r.keys).toEqual(['hu1999', 'hair2019', 'henseler2015', 'rcore', 'cohen1988']);
  });

  it('has a well-formed BibTeX entry for every key', () => {
    const bib = bibtex(CITATION_KEYS);
    expect(bibKeys(bib)).toEqual(CITATION_KEYS);
    for (const k of CITATION_KEYS) expect(citeText(k)).toMatch(/\S/);
    // Balanced braces per entry.
    for (const entry of bib.split('\n\n')) expect([...entry].filter((c) => c === '{').length).toBe([...entry].filter((c) => c === '}').length);
    expect(() => bibtex(['nope'])).toThrow();
  });

  it('dates R by its version', () => {
    expect(rYear('4.5.1')).toBe('2025');
    expect(rYear('3.6.3')).toBe('2019');
    expect(rYear('x')).toBe('n.d.');
  });

  it('splits engine tags into packages', () => {
    expect(enginePackages({ package: 'lavaan::sam + manymome', version: '0.6-19 / 0.2.4' })).toEqual([{ name: 'lavaan', version: '0.6-19' }, { name: 'manymome', version: '0.2.4' }]);
    expect(enginePackages({ package: 'stats (lm, glm)', version: '4.5.1' })).toEqual([{ name: 'R', version: '4.5.1' }]);
  });
});
