import { describe, expect, it } from 'vitest';
import { PACKAGE_EXAMPLES } from './packages';
import { allTags, exampleTags } from './tags';

const tagsOf = (id: string) => exampleTags(PACKAGE_EXAMPLES.find((e) => e.id === id)!);

describe('example topics', () => {
  it('are derived from what the example contains', () => {
    expect(tagsOf('lavaan-hs')).toEqual(['CB-SEM', 'CFA']);
    expect(tagsOf('lavaan-hs-means')).toEqual(['CB-SEM', 'CFA', 'Mean structure']);
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

  it('give every example at least two tags, and the topic list is ordered by frequency', () => {
    for (const e of PACKAGE_EXAMPLES) expect(exampleTags(e).length, e.id).toBeGreaterThanOrEqual(2);
    const all = allTags(PACKAGE_EXAMPLES);
    expect(all[0]).toBe('CB-SEM');
    expect(all).toContain('Moderation');
    expect(new Set(all).size).toBe(all.length);
  });
});
