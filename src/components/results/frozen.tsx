// Frozen results (a model snapshot or an earlier model run on the Analyses
// tab) are shown with the same result tabs as the live model. Sections that
// read the current model or data, or act on them (re-run, save scores, edit
// the model), would mix the present into the frozen results: under this
// context they are left out.

import { createContext, useContext, type ReactNode } from 'react';

export const FrozenResultContext = createContext(false);

/** Whether the results shown are frozen (a snapshot or an earlier run), not the current model's. */
export const useFrozenResult = () => useContext(FrozenResultContext);

/** Children shown only with the current model's results, not in a frozen view. */
export function LiveOnly({ children }: { children: ReactNode }) {
  return useFrozenResult() ? null : children;
}
