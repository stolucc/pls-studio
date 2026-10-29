// Test data with a known quadratic effect (shared by the engine and webR tests).

import { mulberry32 } from '../stats';

/** ξ ~ N(0,1); η = 0.4ξ + 0.3(ξ² − 1) + ζ; three indicators each, loadings 0.8. */
export function simulateQuadratic(n: number, seed: number) {
  const u = mulberry32(seed);
  const z = () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
  const names = ['x1', 'x2', 'x3', 'y1', 'y2', 'y3'];
  const cols = names.map(() => new Float64Array(n));
  for (let r = 0; r < n; r++) {
    const xi = z();
    const eta = 0.4 * xi + 0.3 * (xi * xi - 1) + Math.sqrt(0.66) * z();
    for (let i = 0; i < 3; i++) {
      cols[i][r] = 0.8 * xi + 0.6 * z();
      cols[3 + i][r] = 0.8 * eta + 0.6 * z();
    }
  }
  return { names, cols };
}
