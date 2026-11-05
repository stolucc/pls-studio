// The analyses that live as cards on the Analyses tab.

import { matchAnalysis } from './match';
import { didAnalysis } from './did';
import { regressionAnalysis } from './regression';
import { ncaAnalysis } from './nca';
import { rsaAnalysis } from './rsa';
import { endoAnalysis } from './endo';
import { lmmAnalysis } from './lmm';
import { glmmAnalysis } from './glmm';
import { efaAnalysis } from './efa';
import { influenceAnalysis, screenAnalysis } from './screen';
import { chartAnalysis } from './charts';
import { irtAnalysis, lcaAnalysis } from './items';
import { mixtureAnalysis } from './mixture';
import { gmmAnalysis, growthAnalysis, riclpmAnalysis } from './longitudinal';
import { blindfoldAnalysis, ccaAnalysis, compareAnalysis, ctaAnalysis, groupsAnalysis, predictAnalysis } from './plsAssessment';
import { fimixAnalysis, pathmoxAnalysis, posAnalysis, rebusAnalysis } from './segmentation';
import { mcAnalysis } from './simulation';
import { bollenStineAnalysis, compareParamsAnalysis, scoreWeightsAnalysis } from './cbModel';
import { sampleSizeAnalysis } from './sampleSize';
import { egaAnalysis, networkAnalysis } from './network';
import { runAnalysis } from './runCard';
import { BASIC_TEST_TYPES } from './tests';
import { BAYES_TYPES } from './bayes';
import { bsemAnalysis } from './bsem';
import { snapshotAnalysis } from './snapshot';
import { bmvregAnalysis, customMlAnalysis } from './customml';
import { twoLevelEfaAnalysis } from './twolevelefa';
import type { AnalysisType } from './types';

export const ANALYSIS_TYPES: AnalysisType[] = [runAnalysis, snapshotAnalysis, screenAnalysis, chartAnalysis, influenceAnalysis, ...BASIC_TEST_TYPES, ...BAYES_TYPES, regressionAnalysis, customMlAnalysis, bmvregAnalysis, didAnalysis, efaAnalysis, twoLevelEfaAnalysis, irtAnalysis, lcaAnalysis, mixtureAnalysis, networkAnalysis, egaAnalysis, bollenStineAnalysis, compareParamsAnalysis, scoreWeightsAnalysis, bsemAnalysis, predictAnalysis, blindfoldAnalysis, compareAnalysis, groupsAnalysis, ctaAnalysis, ccaAnalysis, sampleSizeAnalysis, rebusAnalysis, pathmoxAnalysis, fimixAnalysis, posAnalysis, mcAnalysis, rsaAnalysis, matchAnalysis, ncaAnalysis, endoAnalysis, lmmAnalysis, glmmAnalysis, growthAnalysis, riclpmAnalysis, gmmAnalysis];

export const analysisType = (id: string): AnalysisType | undefined => ANALYSIS_TYPES.find((t) => t.id === id);
