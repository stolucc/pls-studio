// The conditional process request for the current model and settings, shared
// by the runner and the R-script export so both run exactly the same analysis.

import type { Dataset } from '../engine/types';
import type { ModelState, Settings } from '../model/project';
import { dummies } from './categorical';
import type { CpaInput } from '../rengine/cpa';
import { processGraph } from './fromModel';

export function processInput(model: ModelState, settings: Settings, data: Dataset | null = null): CpaInput | null {
  const { graph, covariates, recognised } = processGraph(model);
  if (!graph) return null;
  // A multicategorical X: its codes, from the data column.
  const xc = model.constructs.find((c) => c.name === graph.x && c.categorical && c.indicators.length === 1);
  const col = xc && data ? data.cols[data.names.indexOf(xc.indicators[0])] : undefined;
  return {
    ...(xc && col ? { categorical: dummies(graph.x, col, xc.categorical!) } : {}),
    graph, covariates, model: recognised?.model,
    order: recognised ? [recognised.roles.w, recognised.roles.z].filter((v): v is string => !!v) : [],
    variables: model.constructs.map((c) => ({ name: c.name, indicators: c.indicators, ...(c.latent && !c.covariate && c.indicators.length > 1 ? { latent: true } : {}) })),
    // Listwise deletion, as PROCESS (mean replacement would bias regression estimates).
    missing: 'casewise',
    probe: settings.probe,
    hc: settings.hc,
    boot: { samples: Math.max(100, Math.floor(settings.bootSamples)), seed: settings.seed },
    confidence: settings.confidence,
  };
}
