// Examples that open an analysis card, by group (see packages.ts).

import type { PackageExample } from '../packages';
import { CARD_BASIC } from './basic';
import { CARD_BAYES } from './bayes';
import { CARD_MODEL } from './model';
import { CARD_LIKELIHOOD } from './likelihood';
import { CARD_ITEMS } from './items';

export const CARD_EXAMPLES: PackageExample[] = [...CARD_BASIC, ...CARD_BAYES, ...CARD_MODEL, ...CARD_LIKELIHOOD, ...CARD_ITEMS];
