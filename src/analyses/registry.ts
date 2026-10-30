// The analyses that live as cards on the Analyses tab.

import { ncaAnalysis } from './nca';
import { rsaAnalysis } from './rsa';
import type { AnalysisType } from './types';

export const ANALYSIS_TYPES: AnalysisType[] = [rsaAnalysis, ncaAnalysis];

export const analysisType = (id: string): AnalysisType | undefined => ANALYSIS_TYPES.find((t) => t.id === id);
