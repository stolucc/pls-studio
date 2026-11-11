// The analyses that live as cards on the Analyses tab.

import { matchAnalysis } from './match';
import { didAnalysis } from './did';
import { regressionAnalysis } from './regression';
import { ncaAnalysis } from './nca';
import { qcaAnalysis } from './qca';
import { rsaAnalysis } from './rsa';
import { endoAnalysis } from './endo';
import { lmmAnalysis } from './lmm';
import { glmmAnalysis } from './glmm';
import { efaAnalysis } from './efa';
import { influenceAnalysis, screenAnalysis } from './screen';
import { missingDataAnalysis } from './missingData';
import { chartAnalysis } from './charts';
import { irtAnalysis, lcaAnalysis } from './items';
import { mixtureAnalysis } from './mixture';
import { dsemAnalysis } from './dsem';
import { quadAnalysis } from './quadml';
import { gmmAnalysis, growthAnalysis, riclpmAnalysis } from './longitudinal';
import {
  blindfoldAnalysis,
  ccaAnalysis,
  compareAnalysis,
  ctaAnalysis,
  groupsAnalysis,
  predictAnalysis,
} from './plsAssessment';
import { fimixAnalysis, pathmoxAnalysis, posAnalysis, rebusAnalysis } from './segmentation';
import { mcAnalysis } from './simulation';
import { bollenStineAnalysis, compareParamsAnalysis, scoreWeightsAnalysis } from './cbModel';
import { specSearchAnalysis } from './specSearch';
import { equivalentAnalysis } from './equivalent';
import { lmWaldAnalysis } from './lmWald';
import { hypothesesAnalysis } from './hypotheses';
import { apimAnalysis } from './apim';
import { regsemAnalysis } from './regularized';
import { methodCompareAnalysis } from './methodCompare';
import { nonlinearAnalysis } from './nonlinear';
import {
  compareModelsAnalysis,
  discriminantAnalysis,
  epcAnalysis,
  localFitAnalysis,
} from './cbDiag';
import { parcelAllocationAnalysis } from './parcels';
import { dfiAnalysis } from './dfi';
import { semsensAnalysis } from './semsens';
import { medsensAnalysis } from './medsens';
import { sampleSizeAnalysis } from './sampleSize';
import { egaAnalysis, networkAnalysis } from './network';
import { runAnalysis } from './runCard';
import { BASIC_TEST_TYPES } from './tests';
import { BAYES_TYPES } from './bayes';
import { VALIDITY_TYPES } from './validity';
import { bsemAnalysis } from './bsem';
import { snapshotAnalysis } from './snapshot';
import { bmvregAnalysis, customMlAnalysis } from './customml';
import { twoLevelEfaAnalysis } from './twolevelefa';
import { REPORTING_ANALYSES } from './reporting';
import {
  alignmentAnalysis,
  dmacsAnalysis,
  longInvarianceAnalysis,
  lsemAnalysis,
  mimicDifAnalysis,
  mnlfaAnalysis,
} from './invariance';
import type { AnalysisType } from './types';

export const ANALYSIS_TYPES: AnalysisType[] = [
  runAnalysis,
  snapshotAnalysis,
  methodCompareAnalysis,
  parcelAllocationAnalysis,
  screenAnalysis,
  missingDataAnalysis,
  chartAnalysis,
  influenceAnalysis,
  ...BASIC_TEST_TYPES,
  ...BAYES_TYPES,
  regressionAnalysis,
  customMlAnalysis,
  bmvregAnalysis,
  didAnalysis,
  medsensAnalysis,
  efaAnalysis,
  twoLevelEfaAnalysis,
  ...VALIDITY_TYPES,
  scoreTestAnalysis,
  alignmentAnalysis,
  dmacsAnalysis,
  mnlfaAnalysis,
  lsemAnalysis,
  mimicDifAnalysis,
  irtAnalysis,
  lcaAnalysis,
  mixtureAnalysis,
  quadAnalysis,
  networkAnalysis,
  egaAnalysis,
  bollenStineAnalysis,
  compareParamsAnalysis,
  scoreWeightsAnalysis,
  localFitAnalysis,
  discriminantAnalysis,
  compareModelsAnalysis,
  epcAnalysis,
  specSearchAnalysis,
  equivalentAnalysis,
  lmWaldAnalysis,
  hypothesesAnalysis,
  apimAnalysis,
  regsemAnalysis,
  dfiAnalysis,
  semsensAnalysis,
  powerAnalysis,
  metaSemAnalysis,
  semTreeAnalysis,
  bsemAnalysis,
  predictAnalysis,
  blindfoldAnalysis,
  compareAnalysis,
  groupsAnalysis,
  plsMultilevelAnalysis,
  ctaAnalysis,
  ccaAnalysis,
  nonlinearAnalysis,
  sampleSizeAnalysis,
  rebusAnalysis,
  pathmoxAnalysis,
  fimixAnalysis,
  posAnalysis,
  mcAnalysis,
  rsaAnalysis,
  psemAnalysis,
  matchAnalysis,
  ncaAnalysis,
  qcaAnalysis,
  endoAnalysis,
  lmmAnalysis,
  glmmAnalysis,
  growthAnalysis,
  longInvarianceAnalysis,
  riclpmAnalysis,
  lcsAnalysis,
  gmmAnalysis,
  dsemAnalysis,
  ...REPORTING_ANALYSES,
];
import { powerAnalysis } from './power';
import { metaSemAnalysis } from './metasem';
import { semTreeAnalysis } from './semtree';
import { plsMultilevelAnalysis } from './plsMultilevel';
import { scoreTestAnalysis } from './scoretest';
import { lcsAnalysis } from './lcs';
import { psemAnalysis } from './psem';

export const analysisType = (id: string): AnalysisType | undefined =>
  ANALYSIS_TYPES.find((t) => t.id === id);
