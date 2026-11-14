// The "Higher-order constructs" tab: shown only for a model with HOCs, it names the
// type, lists the checks with their status, what not to interpret and the advice.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hocChecks } from '../../reporting/hoc';
import { hocFixture } from '../../reporting/hocFixtures';
import { HocChecksView } from './HocTab';
import { PlsTab, plsTabsFor } from './PlsTabs';

// (rendered from the checks: a server render reads the store's initial state, not the model)
function render(higher: 'reflective' | 'formative', approach: 'two_stage' | 'repeated') {
  const { model, pls } = hocFixture({ lower: 'reflective', higher, approach });
  const checks = hocChecks({ model, pls, boot: null, approach, plsPackage: 'cSEM' });
  const html = renderToStaticMarkup(<HocChecksView checks={checks} onTab={() => {}} />);
  return { html, pls };
}

describe('the higher-order constructs tab', () => {
  it('is listed only when the result has higher-order constructs', () => {
    const { pls } = hocFixture({
      lower: 'reflective',
      higher: 'reflective',
      approach: 'two_stage',
    });
    expect(plsTabsFor(pls).map((t) => t.id)).toContain('hoc');
    expect(plsTabsFor({ ...pls, higherOrder: undefined }).map((t) => t.id)).not.toContain('hoc');
    expect(plsTabsFor(null).map((t) => t.id)).not.toContain('hoc');
  });

  it('shows the type, the checks with status and source, and what not to interpret', () => {
    const { html } = render('reflective', 'repeated');
    expect(html).toContain('reflective–reflective');
    expect(html).toContain('repeated indicators approach');
    expect(html).toContain('Summary of the check of H');
    expect(html).toContain('Internal consistency of H');
    expect(html).toContain('(computed by PLS Studio)'); // from the dimensions' loadings
    expect(html).toContain('Do not interpret for H');
    expect(html).toContain('R² of H');
    expect(html).toContain('Sarstedt et al., 2019');
    expect(html).toContain('Not computed');
  });

  it('gives the advice for a formative HOC', () => {
    const { html } = render('formative', 'two_stage');
    expect(html).toContain('reflective–formative');
    expect(html).toContain('Weights that change sign');
    expect(html).toContain('A dimension that is not significant');
    expect(html).toContain('No global item for the redundancy analysis');
    expect(html).toContain('Cenfetelli &amp; Bassellier, 2009');
  });

  it('says so for a model without higher-order constructs (the store’s empty model)', () => {
    const { pls } = hocFixture({
      lower: 'reflective',
      higher: 'reflective',
      approach: 'two_stage',
    });
    const html = renderToStaticMarkup(<PlsTab tab="hoc" pls={pls} boot={null} fitTest={null} />);
    expect(html).toContain('The model has no higher-order constructs.');
  });

  it('links to the tables behind the values', () => {
    const { html } = render('reflective', 'two_stage');
    expect(html).toContain('>Reliability</button>');
    expect(html).toContain('>Discriminant validity</button>');
  });
});
