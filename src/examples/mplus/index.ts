// The Mplus User's Guide examples, by chapter.

import type { PackageExample } from '../packages';
import { MPLUS_CH3 } from './ch3';
import { MPLUS_CH5 } from './ch5';
import { MPLUS_CH6 } from './ch6';

export const MPLUS_EXAMPLES: PackageExample[] = [...MPLUS_CH3, ...MPLUS_CH5, ...MPLUS_CH6];
