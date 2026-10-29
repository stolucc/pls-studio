import { useRef, useState } from 'react';
import { cancelGroup } from '../cancellable';
import { useStore } from '../store';

/**
 * Busy state plus cancellation for a panel's analysis: wrap each R call in
 * guard(); cancel() abandons them and interrupts R.
 */
export function useCancellable() {
  const [busy, setBusy] = useState(false);
  const group = useRef(cancelGroup());
  const cancel = () => {
    group.current.cancel();
    setBusy(false);
    void import('../rengine/runtime').then((m) => m.interruptR());
    useStore.getState().toast('info', 'Calculation cancelled.');
  };
  return { busy, setBusy, guard: group.current.guard, cancel };
}
