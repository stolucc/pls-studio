// Example data that is downloaded from its source each time the example is opened, because its licence does not let
// PLS Studio distribute it (or states none): where each comes from and how it is read. Pure, with no imports: the
// cache script (scripts/validation/fetch_example_data.mjs) reads it with Node directly.

/** A reshape applied after loading, as the example's source does it in its own software. */
export type Reshape =
  /** Discrete-time survival: one row per person and period at risk (until the event or the first missing period). */
  | { kind: 'personPeriod'; events: string[]; id: string; period: string; event: string }
  /** Mplus's DATA WIDETOLONG: each set of wide columns becomes one long column, a row per id and repetition (0, 1, ...). */
  | { kind: 'wideToLong'; wide: string[][]; long: string[]; id: string; repetition: string };

export type RemoteData =
  /** An Mplus User's Guide example (e.g. '6.19'): its input exN.M.inp and the .dat it names, from statmodel.com. */
  | { kind: 'mplus'; example: string; reshape?: Reshape }
  /** A whitespace-separated file without a header, at a pinned URL that allows cross-origin requests. */
  | { kind: 'url'; url: string; names: string[]; file: string; page: string; reshape?: Reshape };

/** The Mplus User's Guide files (statmodel.com/usersguide/...): the only paths the server and the helper pass through. */
export const STATMODEL_PATH = /^chap(\d{1,2})\/ex(\d{1,2})\.\d{1,2}[a-z0-9]*\.(dat|inp)$/;
export const STATMODEL_BASE = 'https://www.statmodel.com/usersguide/';

/** A path under statmodel.com/usersguide/ when it is one of the guide's example files (its chapter's own), else null. */
export function statmodelPath(path: string): string | null {
  const m = STATMODEL_PATH.exec(path);
  return m && m[1] === m[2] ? path : null;
}
/** An Mplus example's chapter (key '6.19' → '6'). */
export const mplusChapter = (key: string) => key.split('.')[0];
/** The input of an Mplus example, e.g. chap6/ex6.19.inp. */
export const mplusInputPath = (key: string) => `chap${mplusChapter(key)}/ex${key}.inp`;
/** The guide's page of the example: where a person can download the data themselves. */
export const mplusPage = (key: string) =>
  `https://www.statmodel.com/usersguide/chap${mplusChapter(key)}/ex${key}.html`;

/** The page to send a person to when the download fails. */
export const remotePage = (r: RemoteData) => (r.kind === 'mplus' ? mplusPage(r.example) : r.page);
/** Who the data are downloaded from, for messages. */
export const remoteHost = (r: RemoteData) =>
  r.kind === 'mplus' ? 'statmodel.com' : new URL(r.url).host;
/** The file in the test cache (.cache/) that scripts/validation/fetch_example_data.mjs writes: the converted CSV, before any reshape. */
export const remoteCacheFile = (r: RemoteData) =>
  r.kind === 'mplus' ? `mplus/ex${r.example}.csv` : r.file;

/**
 * The RI-CLPM tutorial's simulated data (Mulder & Hamaker 2021): github.com/JeroenDMulder/RI-CLPM states no licence,
 * so the file is read from the repository at a pinned commit (raw.githubusercontent.com allows cross-origin requests).
 * The tutorial reads it with read.table(..., col.names = c(x1..x5, y1..y5)).
 */
export const RICLPM_DATA: RemoteData = {
  kind: 'url',
  url: 'https://raw.githubusercontent.com/JeroenDMulder/RI-CLPM/170dd576247c63f628af56a01828bdd92e417139/data/RICLPM.dat',
  names: ['x1', 'x2', 'x3', 'x4', 'x5', 'y1', 'y2', 'y3', 'y4', 'y5'],
  file: 'riclpm/RICLPM.csv',
  page: 'https://github.com/JeroenDMulder/RI-CLPM',
};

/** Every remote source that is not an Mplus example (those the cache script finds as mplusData('...') in src/examples). */
export const URL_SOURCES: RemoteData[] = [RICLPM_DATA];
