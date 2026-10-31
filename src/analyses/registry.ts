// The analyses that live as cards on the Analyses tab.

import { matchAnalysis } from './match';
import { ncaAnalysis } from './nca';
import { rsaAnalysis } from './rsa';
import { endoAnalysis } from './endo';
import { lmmAnalysis } from './lmm';
import { efaAnalysis } from './efa';
import { influenceAnalysis, screenAnalysis } from './screen';
import { irtAnalysis, lcaAnalysis } from './items';
import { gmmAnalysis, growthAnalysis, riclpmAnalysis } from './longitudinal';
import { blindfoldAnalysis, ccaAnalysis, compareAnalysis, ctaAnalysis, groupsAnalysis, predictAnalysis } from './plsAssessment';
import { fimixAnalysis, pathmoxAnalysis, posAnalysis, rebusAnalysis } from './segmentation';
import { mcAnalysis } from './simulation';
import { bollenStineAnalysis, compareParamsAnalysis, scoreWeightsAnalysis } from './cbModel';
import { sampleSizeAnalysis } from './sampleSize';
import { egaAnalysis, networkAnalysis } from './network';
import { runAnalysis } from './runs';
import { snapshotAnalysis } from './snapshot';
import type { AnalysisType } from './types';

export const ANALYSIS_TYPES: AnalysisType[] = [runAnalysis, snapshotAnalysis, screenAnalysis, influenceAnalysis, efaAnalysis, irtAnalysis, lcaAnalysis, networkAnalysis, egaAnalysis, bollenStineAnalysis, compareParamsAnalysis, scoreWeightsAnalysis, predictAnalysis, blindfoldAnalysis, compareAnalysis, groupsAnalysis, ctaAnalysis, ccaAnalysis, sampleSizeAnalysis, rebusAnalysis, pathmoxAnalysis, fimixAnalysis, posAnalysis, mcAnalysis, rsaAnalysis, matchAnalysis, ncaAnalysis, endoAnalysis, lmmAnalysis, growthAnalysis, riclpmAnalysis, gmmAnalysis];

export const analysisType = (id: string): AnalysisType | undefined => ANALYSIS_TYPES.find((t) => t.id === id);
