import { expect, it } from 'vitest';
import { splitScript } from '../components/results/ScriptView';
import { columnSummary } from './summary';

it('descriptives equal R (quantile type 7, moment skewness and excess kurtosis)', () => {
  // R: y <- c(1, 2, 3, 4, 10, 2.5); quantile(y); sd(y); m2 <- mean((y - mean(y))^2); mean((y - mean(y))^3) / m2^1.5; mean((y - mean(y))^4) / m2^2 - 3
  const s = columnSummary([1, 2, 3, 4, 10, NaN, 2.5]);
  expect(s.n).toBe(6);
  expect(s.missing).toBe(1);
  expect(s.mean).toBeCloseTo(22.5 / 6, 12);
  expect(s.sd).toBeCloseTo(3.221024681681, 10);
  expect([s.min, s.q1, s.median, s.q3, s.max]).toEqual([1, 2.125, 2.75, 3.75, 10]);
  expect(s.skew).toBeCloseTo(1.413635923637, 10);
  expect(s.kurtosis).toBeCloseTo(0.556748439541, 10);
  expect(s.distinct).toBe(6);
});

it('descriptives of an empty or constant column are NaN, not errors', () => {
  const e = columnSummary([NaN, NaN]);
  expect([e.n, e.missing, e.distinct]).toEqual([0, 2, 0]);
  expect([e.mean, e.sd, e.median, e.skew]).toEqual([NaN, NaN, NaN, NaN]);
  const k = columnSummary([3, 3, 3, 3]);
  expect([k.sd, k.skew, k.kurtosis, k.distinct]).toEqual([0, NaN, NaN, 1]);
});

it('the R script splits into header, embedded data and calculation', () => {
  const text = ['# Title', '', '# ---- Data used (model variables only) ----', 'data <- data.frame(', '  x = c(1, 2)', ')', '', '# ---- Calculation (as run by PLS Studio) ----', 'fit <- sem(model, data)', '# ---- Report ----', 'summary(fit)'].join('\n');
  const p = splitScript(text);
  expect(p.head).toEqual(['# Title', '', '# ---- Data used (model variables only) ----']);
  expect(p.data).toEqual(['data <- data.frame(', '  x = c(1, 2)', ')', '']);
  expect(p.rest[0]).toMatch(/^# ---- Calculation/);
  expect([...p.head, ...p.data, ...p.rest].join('\n')).toBe(text);
  expect(splitScript('a\nb')).toEqual({ head: [], data: [], rest: ['a', 'b'] });
});
