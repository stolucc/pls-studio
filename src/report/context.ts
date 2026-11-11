// Rendering for the report rather than the screen: views with tabs show every
// tab in turn, each under its own heading (the report has no tab bar).

import { createContext, useContext } from 'react';

export const ReportContext = createContext(false);

/** True while a view is rendered for the report. */
export const useReportMode = () => useContext(ReportContext);
