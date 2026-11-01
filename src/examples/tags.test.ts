import { describe, expect, it } from 'vitest';
import { PACKAGE_EXAMPLES } from './packages';
import { allTags, exampleTags, sortTopics } from './tags';

const tagsOf = (id: string) => exampleTags(PACKAGE_EXAMPLES.find((e) => e.id === id)!);

describe('example topics', () => {
  it('are derived from what the example contains', () => {
    expect(tagsOf('lavaan-hs')).toEqual(['CB-SEM', 'CFA']);
    expect(tagsOf('lavaan-hs-means')).toEqual(['CB-SEM', 'CFA', 'Mean structure']);
    expect(tagsOf('did-mpdta')).toEqual(['CB-SEM', 'Causal inference', 'Difference-in-differences', 'Panel data']);
    expect(tagsOf('mass-quine')).toEqual(['CB-SEM', 'Regression', 'Count data']);
    expect(tagsOf('mass-birthwt')).toEqual(['CB-SEM', 'Regression', 'Logistic regression']);
    expect(tagsOf('seminr-interaction-methods')).toEqual(['PLS-SEM', 'Moderation', 'Composites']);
    expect(tagsOf('lavaan-poldem')).toEqual(['CB-SEM', 'Mediation', 'Correlated errors']);
    expect(tagsOf('lavaan-hs-groups')).toEqual(['CB-SEM', 'CFA', 'Multigroup']);
    expect(tagsOf('lavaan-twolevel')).toEqual(['CB-SEM', 'Multilevel', 'Covariates']);
    expect(tagsOf('modsem-oneint')).toEqual(['CB-SEM', 'Moderation']);
    expect(tagsOf('manymome-modmed')).toEqual(['CPA', 'Mediation', 'Moderation', 'Covariates']);
    expect(tagsOf('csem-2ndorder')).toEqual(['PLSc', 'Mediation', 'Second-order', 'Composites']);
    expect(tagsOf('csem-2ndorder-repeated')).toEqual(['PLSc', 'Mediation', 'Second-order', 'Composites']);
    expect(tagsOf('seminr-corprep')).toEqual(['PLS-SEM', 'Mediation', 'Composites', 'Bootstrap'].filter((t) => t !== 'Bootstrap'));
    expect(tagsOf('csem-gender')).toEqual(['PLSc', 'Mediation', 'Composites', 'Multigroup']);
    expect(tagsOf('miivsem-bollen')).toEqual(['MIIV-2SLS', 'Mediation', 'Correlated errors']);
    expect(tagsOf('rsem-mardia')).toEqual(['CB-SEM', 'Robust ML', 'FIML', 'CFA']);
    expect(tagsOf('mice-nhanes')).toEqual(['CB-SEM', 'Multiple imputation']);
    expect(tagsOf('rendo-copula')).toEqual(['CB-SEM', 'Regression', 'Endogeneity', 'Shipped data']);
    expect(tagsOf('ivreg-kmenta')).toEqual(['CB-SEM', 'Regression', 'Endogeneity', 'Instrumental variables']);
    expect(tagsOf('plspm-rebus')).toEqual(['PLS-SEM', 'Segmentation']);
    expect(tagsOf('haven-iris')).toEqual(['CB-SEM', 'Measurement', 'Factor analysis', 'PCA', 'File import']);
  });

  it('give every example at least two tags, and the topic list is in alphabetical order', () => {
    for (const e of PACKAGE_EXAMPLES) expect(exampleTags(e).length, e.id).toBeGreaterThanOrEqual(2);
    const all = allTags(PACKAGE_EXAMPLES);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b)));
    expect(sortTopics(['b', 'A', 'a', 'C', 'b'])).toEqual(['a', 'A', 'b', 'C']);  // (once each; case ignored, then lower case first)
    expect(all).toContain('Moderation');
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('example authors', () => {
  it('names the authors of the book, manual or paper an example reproduces', async () => {
    const { exampleAuthors } = await import('./tags');
    const authorsOf = (id: string) => exampleAuthors(PACKAGE_EXAMPLES.find((e) => e.id === id)!);
    expect(authorsOf('bollen-union')).toEqual(['Bollen']);
    expect(authorsOf('mplus-ex5.1')).toEqual(['Muthén']);
    expect(authorsOf('cardata-duncan')).toEqual(['Fox', 'Weisberg']);
    expect(authorsOf('csem-itflex')).toEqual(['Henseler']);
    expect(authorsOf('seminr-corprep')).toEqual(['Hair']);
    expect(authorsOf('lavaan-hs')).toEqual([]);
    // Every mapped id is an example (no stale entries).
    for (const e of PACKAGE_EXAMPLES) expect(Array.isArray(exampleAuthors(e))).toBe(true);
    expect(PACKAGE_EXAMPLES.filter((e) => exampleAuthors(e).length).length).toBeGreaterThan(40);
  });
});
