import type { ComponentType } from 'react';
import type { Dataset, PlsResult } from '../engine/types';
import type { DataInfo, Settings } from '../model/project';

/** What an analysis can read from the open project. */
export interface AnalysisCtx {
  data: Dataset | null;
  info: DataInfo | null;
  settings: Settings;
  /** The PLS-SEM results, when they are current for the model and data. */
  pls: PlsResult | null;
  projectName: string;
}

/** The last completed run of an analysis card. */
export interface CardRun {
  at: number;
  /** Fingerprint of the inputs the run used (data columns, construct scores). */
  fingerprint: string;
  /** The options it ran with (JSON), to tell when they have changed since. */
  options: string;
  /** The packed result (codec.ts); absent when too large to keep, and never sent to shared projects. */
  packed?: string;
}

export type Card =
  | { id: string; kind: 'analysis'; type: string; options: unknown; run?: CardRun }
  | { id: string; kind: 'heading' | 'note'; text: string };
export type AnalysisCard = Extract<Card, { kind: 'analysis' }>;

export type AnalysisGroup = 'Data' | 'Measurement' | 'Regression and causal inference' | 'Longitudinal' | 'Necessary conditions';

export interface OptionsProps<O> { options: O; set: (o: O) => void; ctx: AnalysisCtx; disabled: boolean }

/** One kind of analysis that lives as a card on the Analyses tab. */
// The registry holds analyses with different option and result types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AnalysisType<O = any, R = any> {
  id: string;
  title: string;
  /** One line for the Add menu. */
  sub: string;
  group: AnalysisGroup;
  defaults: (ctx: AnalysisCtx) => O;
  /** Validate options from a project file or a collaborator; null when unusable. */
  parseOptions: (raw: unknown) => O | null;
  Options: ComponentType<OptionsProps<O>>;
  /** `current`: the result still matches the options and data (actions that write into the data need it). */
  View: ComponentType<{ result: R; options: O; current: boolean }>;
  /** Why the analysis cannot run with these options and inputs; null when it can. */
  blocked: (o: O, ctx: AnalysisCtx) => string | null;
  /** Fingerprint of the inputs it reads (null when they are not available). */
  fingerprint: (o: O, ctx: AnalysisCtx) => string | null;
  run: (o: O, ctx: AnalysisCtx) => Promise<R>;
  /** The R script for this run, when there is one. */
  script?: (o: O, ctx: AnalysisCtx) => Promise<string>;
  /** Short description of the options for the card header. */
  summary: (o: O) => string;
}
