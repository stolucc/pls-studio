import { expect, it } from 'vitest';
import { moveCategory } from './SegmentationMethods';

it('reorders categories of an ordered segmentation variable', () => {
  expect(moveCategory([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
  expect(moveCategory([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
  expect(moveCategory([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  expect(moveCategory([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
});
