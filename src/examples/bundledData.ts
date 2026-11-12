// The R-package datasets of the home-screen examples, bundled with the app (public/examples/data, written by
// scripts/examples/bundle-data.mjs): opening such an example reads the copy instead of starting R in the browser and
// installing the example's packages only to read a table. Each copy is exactly what the bridge's ps_dataset returns
// for the dataset (bundledData.webr.test.ts compares them in desktop R).

import manifest from './bundledData.json';
import { bundledDataKey, type ExampleDataRef } from './bundledDataKey';

/** What ps_dataset returns: numeric columns (missing as null), the number of rows, factor levels by column. */
export interface PackageDataset {
  names: string[];
  cols: (number | null)[][];
  n: number;
  levels?: Record<string, string[] | string> | unknown[];
}

const DATASETS: Record<string, string> = manifest.datasets;

/** The bundled copy of an example's dataset (its path under public/), or null when there is none. */
export function bundledDataFile(d: ExampleDataRef): string | null {
  return DATASETS[bundledDataKey(d)] ?? null;
}

/** Read a bundled copy from the app's own server. */
export async function fetchBundledDataset(file: string): Promise<PackageDataset> {
  const res = await fetch(new URL(`${import.meta.env.BASE_URL}${file}`, window.location.href));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status}).`);
  return (await res.json()) as PackageDataset;
}
