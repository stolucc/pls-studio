// A CB-SEM model with parameters fixed at values (lavaan's value*name), and
// lavaan 0.6-16's chi-square for it (ML, Holzinger & Swineford 1939):
//   visual =~ x1 + 0.6*x2 + x3; textual =~ x4 + x5 + x6; speed =~ 0.9*x7 + x8 + x9
//   speed ~ 0.3*visual + textual; visual ~~ 0.2*textual; x7 ~~ 0.1*x8

import type { ModelSpec } from '../types';

const f = (name: string, indicators: string[], fixedLoadings?: Record<string, number>) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators, ...(fixedLoadings ? { fixedLoadings } : {}) });
export const FIXED_SPEC: ModelSpec = {
  constructs: [f('visual', ['x1', 'x2', 'x3'], { x2: 0.6 }), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'], { x7: 0.9 })],
  paths: [{ from: 'visual', to: 'speed', fixed: 0.3 }, { from: 'textual', to: 'speed' }],
  covariances: [{ a: 'visual', b: 'textual', kind: 'construct', fixed: 0.2 }, { a: 'x7', b: 'x8', kind: 'indicator', fixed: 0.1 }],
};

export const FIXED_CHISQ = 79.940378;
export const FIXED_DF = 27;
