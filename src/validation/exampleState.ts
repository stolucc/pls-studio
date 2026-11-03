// Whether the open example is still as it opened, for the results' validation badge: what is estimated (the model's
// specification, the estimation settings, the data), not where its boxes are or how its figure looks.

import { toSpec, type ModelState, type Settings } from '../model/project';

export function estimationKey(model: ModelState, settings: Settings, dataVersion: number): string {
  const { figure: _f, charts: _c, ...estimation } = settings;
  return JSON.stringify({ spec: toSpec(model), estimation, dataVersion });
}
