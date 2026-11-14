// Starting the guided tour with its content, and going back to the person's project at the end.

import { openRecent } from '../../io';
import { useStore } from '../../store';
import { startTourWith, tourHooks, type PreviousProject } from './engine';
import { TOUR } from './steps';

tourHooks.restore = async (p: PreviousProject) => {
  await openRecent(p.id);
  if (useStore.getState().projectId === p.id)
    useStore.getState().toast('success', `Back to “${p.name}”.`);
};

/** Start the tour: all of it, or one chapter by its id. */
export function startTour(chapterId?: string) {
  startTourWith(TOUR, chapterId);
}

export { TOUR } from './steps';
