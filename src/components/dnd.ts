import type { DragEvent } from 'react';

export const VARS_MIME = 'application/x-pls-vars';

/** Read dragged variable names, keeping only names that exist in the dataset. */
export function readDraggedVars(e: DragEvent, known: string[]): string[] | null {
  const raw = e.dataTransfer.getData(VARS_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const set = new Set(known);
    const names = parsed.filter((n): n is string => typeof n === 'string' && set.has(n));
    return names.length ? names : null;
  } catch {
    return null;
  }
}
