import { expect, it } from 'vitest';
import { isWasmCrash } from './runtime';

it('tells WebAssembly traps from ordinary R errors', () => {
  expect(isWasmCrash(new Error('memory access out of bounds'))).toBe(true);
  expect(isWasmCrash(Object.assign(new Error('unreachable executed'), { name: 'RuntimeError' }))).toBe(true);
  expect(isWasmCrash(Object.assign(new Error('x'), { name: 'RuntimeError' }))).toBe(true);
  expect(isWasmCrash(new Error('Maximum call stack size exceeded'))).toBe(true);
  // R's own errors leave the session usable.
  expect(isWasmCrash(new Error('Error in x[[5]]: subscript out of bounds'))).toBe(false);
  expect(isWasmCrash(new Error('lavaan ERROR: model did not converge'))).toBe(false);
  expect(isWasmCrash('cannot allocate vector of size 2 Gb')).toBe(false);
});
