import { expect, it } from 'vitest';
import { bottleneckText } from './nca';

it('writes bottleneck values as NCA does', () => {
  expect(bottleneckText(0)).toBe('NN');
  expect(bottleneckText(-12.3)).toBe('NN');
  expect(bottleneckText(38.356)).toBe('38.4');
  expect(bottleneckText(100)).toBe('100.0');
  expect(bottleneckText(101)).toBe('NA');
  expect(bottleneckText(null)).toBe('NA');
});
