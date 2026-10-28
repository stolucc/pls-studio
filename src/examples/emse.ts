// CB-SEM example: Stol, Schaarschmidt & Goldblit (2022), "Gamification in
// software engineering: the mediating role of developer engagement and job
// satisfaction", Empirical Software Engineering 27:35.
// Matrices from the replication package (doi:10.5281/zenodo.6322761), CC BY 4.0.
// Loaded lazily so the 300 KB NACOV is only fetched on demand.

import nacovCsv from './emse-sem-nacov.csv?raw';
import sCsv from './emse-sem-s.csv?raw';
import type { Dataset } from '../engine/types';
import { newId, type DataInfo, type ModelState, type Settings } from '../model/project';
import { parseCovMatrixCsv, parseNacovCsv } from './matrix';

export function makeEmseExample(settings: Settings): { name: string; data: Dataset; info: DataInfo; model: ModelState; settings: Settings } {
  const m = parseCovMatrixCsv(sCsv)!;
  const nacov = parseNacovCsv(nacovCsv, m.names.length);
  const C = (name: string, indicators: string[], x: number, y: number, side: 'left' | 'right' | 'top' | 'bottom', extra = {}) =>
    ({ id: newId('c'), name, type: 'factor' as const, mode: 'A' as const, indicators, x, y, side, ...extra });
  const desire = C('Desire to learn', ['num_want_learn_languages', 'num_want_learn_skills'], 0, 0, 'left');
  const part = C('Participation', ['num_challenges_solved', 'num_meetings_attended', 'has_chatroom_handle'], 420, 0, 'top');
  const id = C('Identification', ['ID1', 'ID2'], 700, -330, 'top');
  const hc = C('Hedonic commitment', ['HC1', 'HC2', 'HC3'], 1060, -330, 'top');
  const engag = C('Engagement', [], 880, -40, 'bottom', { components: [id.id, hc.id] });
  const js = C('Job satisfaction', ['JS1', 'JS2', 'JS4'], 1300, 120, 'right');
  const age = C('age', ['age'], 420, 330, 'bottom', { covariate: true });
  const male = C('ismale', ['ismale'], 700, 330, 'bottom', { covariate: true });
  const tenure = C('tenure_s', ['tenure_s'], 980, 330, 'bottom', { covariate: true });
  const P = (f: { id: string }, t: { id: string }) => ({ id: newId('p'), from: f.id, to: t.id });
  const model: ModelState = {
    constructs: [desire, part, id, hc, engag, js, age, male, tenure],
    paths: [
      P(desire, part), P(age, part), P(male, part), P(tenure, part),
      P(part, engag), P(age, engag), P(male, engag), P(tenure, engag),
      P(engag, js), P(part, js), P(age, js), P(male, js), P(tenure, js),
    ],
    moderations: [],
  };
  return {
    name: 'Gamification in SE (Stol et al. 2022)',
    data: { names: m.names, cols: [], moments: { S: m.S, n: 155, nacov } },
    info: { fileName: 'Stol et al. 2022 replication matrices (CC BY 4.0)', rows: 155, missingCells: 0, excluded: [], kind: 'matrix', hasNacov: true },
    model,
    settings: { ...settings, method: 'cbsem', estimator: 'MLM', consistent: false },
  };
}
