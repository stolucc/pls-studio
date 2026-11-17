// Every simulation card drawn from a paper says what software the paper ran on.

import { describe, expect, it } from 'vitest';
import { CARD_MODEL, PAPER_SOFTWARE } from './model';

/** Simulation cards of our own, with no paper behind them. */
const OWN = ['pls-bootstrap-se'];

const mcCards = CARD_MODEL.filter((card) => card.title?.startsWith('Monte Carlo:'));

describe('the paper’s software on simulation cards', () => {
  it('names one entry for every card drawn from a paper, before the closing sentence', () => {
    expect(mcCards.length).toBeGreaterThan(50);
    for (const card of mcCards) {
      const entries = PAPER_SOFTWARE.filter(([prefix]) => card.id.startsWith(prefix));
      if (OWN.includes(card.id)) {
        expect(entries, card.id).toEqual([]);
        expect(card.description, card.id).not.toContain('The paper’s software');
        continue;
      }
      expect(entries.length, card.id).toBe(1);
      expect(card.description, card.id).toContain(
        `The paper’s software: ${entries[0]![1]}. Opens its card`,
      );
    }
  });

  it('has no entry that matches no card', () => {
    for (const [prefix] of PAPER_SOFTWARE) {
      expect(
        mcCards.some((card) => card.id.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });
});
