// What goes into the report, and its format (kept apart from the builder so
// the dialog loads without it).

/** What goes into the report. Raw data only when asked for. */
export interface ReportOptions {
  diagram: boolean;
  modelResults: boolean;
  log: boolean;
  methods: boolean;
  software: boolean;
  /** The dataset itself (its first MAX_DATA_ROWS rows). */
  data: boolean;
}

export const DEFAULT_REPORT_OPTIONS: ReportOptions = {
  diagram: true,
  modelResults: true,
  log: true,
  methods: true,
  software: true,
  data: false,
};

/** At most this many cases of the data go into the report. */
export const MAX_DATA_ROWS = 1000;

export type ReportFormat = 'html' | 'docx';
