// The Mplus User's Guide examples, by chapter.

import type { PackageExample } from '../packages';
import { MPLUS_CH3 } from './ch3';
import { MPLUS_CH4 } from './ch4';
import { MPLUS_CH5 } from './ch5';
import { MPLUS_CH5EFA } from './ch5efa';
import { MPLUS_CH5IRT } from './ch5irt';
import { MPLUS_CH6 } from './ch6';
import { MPLUS_CH6SURV } from './ch6surv';
import { MPLUS_CH6GLMM } from './ch6glmm';
import { MPLUS_CH7 } from './ch7';
import { MPLUS_CH7IRT } from './ch7irt';
import { MPLUS_CH7MIX } from './ch7mix';
import { MPLUS_CH8 } from './ch8';
import { MPLUS_CH8MIX } from './ch8mix';
import { MPLUS_CH9 } from './ch9';
import { MPLUS_CH10 } from './ch10';
import { MPLUS_CH10MIX } from './ch10mix';
import { MPLUS_CH11 } from './ch11';
import { MPLUS_QUADML } from './quadml';
import { MPLUS_DSEM } from './dsem';
import { DSEM_SHOWS } from './dsemShows';

export const MPLUS_EXAMPLES: PackageExample[] = [
  ...MPLUS_CH3,
  ...MPLUS_CH4,
  ...MPLUS_CH5,
  ...MPLUS_CH5EFA,
  ...MPLUS_CH5IRT,
  ...MPLUS_CH6,
  ...MPLUS_CH6SURV,
  ...MPLUS_CH6GLMM,
  ...MPLUS_CH7,
  ...MPLUS_CH7IRT,
  ...MPLUS_CH7MIX,
  ...MPLUS_CH8,
  ...MPLUS_CH8MIX,
  ...MPLUS_CH9,
  ...MPLUS_CH10,
  ...MPLUS_CH10MIX,
  ...MPLUS_CH11,
  ...MPLUS_QUADML,
  // (the DSEM examples' `shows` texts are kept in dsemShows.ts for now)
  ...MPLUS_DSEM.map((e) => (e.shows || !DSEM_SHOWS[e.id] ? e : { ...e, shows: DSEM_SHOWS[e.id] })),
];
