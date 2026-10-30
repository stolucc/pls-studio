// The analyses that live as cards on the Analyses tab.

import { matchAnalysis } from './match';
import { ncaAnalysis } from './nca';
import { rsaAnalysis } from './rsa';
import { endoAnalysis } from './endo';
import { lmmAnalysis } from './lmm';
import { efaAnalysis } from './efa';
import { influenceAnalysis, screenAnalysis } from './screen';
import { irtAnalysis, lcaAnalysis } from './items';
import type { AnalysisType } from './types';

export const ANALYSIS_TYPES: AnalysisType[] = [screenAnalysis, influenceAnalysis, efaAnalysis, irtAnalysis, lcaAnalysis, rsaAnalysis, matchAnalysis, ncaAnalysis, endoAnalysis, lmmAnalysis];

export const analysisType = (id: string): AnalysisType | undefined => ANALYSIS_TYPES.find((t) => t.id === id);
