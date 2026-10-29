// The conditional process request for the current model and settings, shared
// by the runner and the R-script export so both run exactly the same analysis.

import type { Dataset } from '../engine/types';
import type { ModelState, Settings } from '../model/project';
import { dummies } from './categorical';
import type { CpaInput } from '../rengine/cpa';
import { processGraph } from './fromModel';

/** Values of X compared by counterfactual effects: a binary X's two values, else its mean and one SD above. */
export function defaultCounterfactual(col: Float64Array | undefined): { xref: number; xcf: number } | null {
  if (!col) return null;
  const v = [...col].filter((x) => !Number.isNaN(x));
  if (!v.length) return null;
  const u = [...new Set(v)].sort((a, b) => a - b);
  if (u.length === 2) return { xref: u[0], xcf: u[1] };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1));
  return { xref: mean, xcf: mean + sd };
}

export function processInput(model: ModelState, settings: Settings, data: Dataset | null = null): CpaInput | null {
  const { graph, covariates, recognised } = processGraph(model);
  if (!graph) return null;
  // A multicategorical X: its codes, from the data column.
  const xc = model.constructs.find((c) => c.name === graph.x && c.categorical && c.indicators.length === 1);
  const col = xc && data ? data.cols[data.names.indexOf(xc.indicators[0])] : undefined;
  const columnOf = (name: string) => {
    const c = model.constructs.find((k) => k.name === name && k.indicators.length === 1 && !k.latent);
    return c && data && !data.moments ? data.cols[data.names.indexOf(c.indicators[0])] : undefined;
  };
  // A dichotomous Y is analysed by logistic regression, as PROCESS does.
  const ycol = columnOf(graph.y);
  const binaryY = !!ycol && new Set([...ycol].filter((v) => !Number.isNaN(v))).size === 2;
  // X moderating its own M → Y paths (model 74): counterfactual effects.
  const xmint = graph.moderations.some((m) => m.by === graph.x && m.path[1] === graph.y && graph.mediators.includes(m.path[0]));
  const counterfactual = xmint ? settings.counterfactual ?? defaultCounterfactual(columnOf(graph.x)) : null;
  return {
    ...(binaryY ? { binaryY } : {}),
    ...(counterfactual ? { counterfactual } : {}),
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
