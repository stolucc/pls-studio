import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BootstrapResult, BootstrapStat } from '../../engine/types';
import { mediationPairs } from '../../reporting/mediation';
import {
  MediationHelp,
  MediationNeedsBoot,
  MediationReport,
  SpecificIndirectTable,
  totalOf,
  typeCell,
} from './MediationPanel';

const stat = (key: string, group: BootstrapStat['group'], est: number, lo: number, hi: number) => ({
  key,
  group,
  label: key,
  original: est,
  mean: est,
  sd: 0.05,
  t: est / 0.05,
  p: 0.01,
  ciLow: lo,
  ciHigh: hi,
});
const boot: BootstrapResult = {
  samples: 5000,
  failed: 0,
  confidence: 0.95,
  stats: [
    stat('path:X:Y', 'path', 0.004, -0.1, 0.11),
    stat('indirect:X:Y', 'indirect', 0.2, 0.08, 0.3),
    stat('specific:X:M1:Y', 'specific', 0.21, 0.12, 0.31),
    stat('specific:X:M2:Y', 'specific', -0.01, -0.05, 0.02),
  ],
};
const pairs = mediationPairs(boot, ['X', 'M1', 'M2', 'Y'], () => true);

describe('mediation panel', () => {
  it('the Type cell of the total indirect effect', () => {
    expect(typeCell(totalOf(pairs, 'X', 'Y'))).toMatchObject({
      v: 'Indirect-only',
      cls: 'good',
    });
    expect(typeCell(totalOf(pairs, 'Y', 'X')).v).toBeNull();
  });
  it('the specific indirect effects table with a Type column', () => {
    const html = renderToStaticMarkup(<SpecificIndirectTable pairs={pairs} boot={boot} />);
    expect(html).toContain('Specific indirect effects');
    expect(html).toContain('<th>Type</th>');
    expect(html).toContain('X → M1 → Y');
    expect(html).toContain('No effect');
  });
  it('a sentence per specific effect and the total, the 1-of-2 note, copy buttons', () => {
    const html = renderToStaticMarkup(<MediationReport pairs={pairs} boot={boot} symbol="β" />);
    expect(html).toContain(
      'The indirect effect of X on Y through M1 was significant (β = .21, 95% CI [.12, .31]) and the direct effect was not',
    );
    expect(html).toContain('The total indirect effect of X on Y (through all mediators)');
    expect(html).toContain('1 of 2 specific indirect effects of X on Y is significant');
    expect(html).toContain('aria-label="Copy this sentence"');
    expect(html).toContain('How the type is decided');
  });
  it('before bootstrapping: what is missing and the bootstrap button', () => {
    const html = renderToStaticMarkup(<MediationNeedsBoot />);
    expect(html).toContain('bootstrap confidence intervals');
    expect(html).toContain('Run bootstrapping');
  });
  it('the explanation: decision tree, five types, Baron and Kenny, several mediators', () => {
    const html = renderToStaticMarkup(<MediationHelp />);
    expect(html).toContain('Decision tree');
    for (const t of ['Complementary', 'Competitive', 'Indirect-only', 'Direct-only', 'No effect'])
      expect(html).toContain(t);
    expect(html).toContain('mediation does not need a significant total effect');
    expect(html).toContain('Hayes, 2009');
    expect(html).toContain('“Only 1 of 4 specific indirect effects is significant”');
    expect(html).toContain('p-values are only approximate');
  });
  it('effects of pairs without a direct path are folded after the others', () => {
    const noDirect = mediationPairs(boot, ['X', 'M1', 'M2', 'Y'], () => false);
    expect(typeCell(noDirect[0].total).v).toBe('Indirect-only (no direct path)');
    const html = renderToStaticMarkup(<MediationReport pairs={noDirect} boot={boot} symbol="β" />);
    expect(html).toContain('<details');
    expect(html).toContain('3 indirect effects between constructs without a direct path');
  });
});
