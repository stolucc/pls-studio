// What a project's estimates rest on: the cases themselves (raw data) or
// summary statistics (a covariance matrix, CB-SEM only). Shown quietly next
// to the project name, in the Data panel and in Recent projects, because a
// matrix limits what can be estimated (no FIML, no bootstrap of cases, no
// PLS-SEM) and readers of the results should know which it was.

import type { DataInfo } from './project';

export interface DataSource {
  /** "raw data" or "covariance matrix" (+ NACOV). */
  label: string;
  /** The file and size: "survey.csv · n = 301" or "kline.txt · N = 155". */
  detail: string;
}

/** The data source of a project with data; null without data. */
export function dataSource(info: DataInfo | null | undefined): DataSource | null {
  if (!info) return null;
  if (info.kind === 'matrix') {
    return {
      label: info.hasNacov ? 'covariance matrix + NACOV' : 'covariance matrix',
      detail: `${info.fileName} · N = ${info.rows}`,
    };
  }
  return { label: 'raw data', detail: `${info.fileName} · n = ${info.rows}` };
}
