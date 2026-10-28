import { create } from 'zustand';
import type { McDesign, McSummaryRow } from './engine/montecarlo';

interface SimState {
  open: boolean;
  design: McDesign | null;
  rows: McSummaryRow[] | null;
  /** Design the rows were computed for (to flag stale results). */
  rowsFor: string | null;
  job: { done: number; total: number; workers: number } | null;
  setOpen: (v: boolean) => void;
  setDesign: (d: McDesign | null) => void;
  setRows: (rows: McSummaryRow[] | null, forDesign: string | null) => void;
  setJob: (j: SimState['job']) => void;
}

export const useSim = create<SimState>((set) => ({
  open: false,
  design: null,
  rows: null,
  rowsFor: null,
  job: null,
  setOpen: (open) => set({ open }),
  setDesign: (design) => set({ design }),
  setRows: (rows, rowsFor) => set({ rows, rowsFor }),
  setJob: (job) => set({ job }),
}));
