// Examples that open an analysis card, by group (see packages.ts).

import type { PackageExample } from '../packages';
import { CARD_BASIC } from './basic';
import { CARD_BAYES } from './bayes';
import { CARD_MODEL } from './model';
import { CARD_LIKELIHOOD } from './likelihood';
import { CARD_ITEMS } from './items';
import { CARD_INTEGRATION } from './integration';
import { CARD_DSEM } from './dsem';
import { CARD_DFI } from './dfi';
import { CARD_VALIDITY } from './validity';
import { CARD_QCA } from './qca';
import { CARD_SCORETEST } from './scoretest';
import { CARD_LCS } from './lcs';

export const CARD_EXAMPLES: PackageExample[] = [...CARD_BASIC, ...CARD_BAYES, ...CARD_MODEL, ...CARD_LIKELIHOOD, ...CARD_ITEMS, ...CARD_INTEGRATION, ...CARD_DSEM, ...CARD_DFI, ...CARD_VALIDITY, ...CARD_QCA, ...CARD_SCORETEST, ...CARD_LCS];
