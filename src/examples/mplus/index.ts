// The Mplus User's Guide examples, by chapter.

import type { PackageExample } from '../packages';
import { MPLUS_CH3 } from './ch3';
import { MPLUS_CH4 } from './ch4';
import { MPLUS_CH5 } from './ch5';
import { MPLUS_CH5EFA } from './ch5efa';
import { MPLUS_CH6 } from './ch6';
import { MPLUS_CH6SURV } from './ch6surv';
import { MPLUS_CH7 } from './ch7';
import { MPLUS_CH8 } from './ch8';
import { MPLUS_CH9 } from './ch9';
import { MPLUS_CH10 } from './ch10';
import { MPLUS_CH11 } from './ch11';

export const MPLUS_EXAMPLES: PackageExample[] = [
  ...MPLUS_CH3, ...MPLUS_CH4, ...MPLUS_CH5, ...MPLUS_CH5EFA, ...MPLUS_CH6, ...MPLUS_CH6SURV, ...MPLUS_CH7, ...MPLUS_CH8, ...MPLUS_CH9, ...MPLUS_CH10, ...MPLUS_CH11,
];
