// Which home-screen examples read their dataset from an R package with the bridge's ps_dataset, and where the copy of
// that dataset bundled with the app lives (scripts/examples/bundle-data.mjs writes the copies; examples/bundledData.ts
// reads them). No imports: the bundling script loads this module on its own.

/** An example's data reference (PackageExample['data']). */
export interface ExampleDataRef {
  package: string;
  name: string;
  na?: number[];
  file?: string;
  packageFile?: unknown;
  remote?: unknown;
}

/** Examples whose dataset R reads from the package (not a file shipped with the app, in the package or downloaded). */
export const R_LOADED = (d: ExampleDataRef): boolean => !d.file && !d.packageFile && !d.remote;

/** The manifest's key: package, dataset and the codes read as missing ("seminr::corp_rep_data?na=-99"). */
export const bundledDataKey = (d: ExampleDataRef): string =>
  `${d.package}::${d.name}${d.na?.length ? `?na=${d.na.join(',')}` : ''}`;

/** The bundled copy's path under public/ ("examples/data/seminr/corp_rep_data.na-99.json"). */
export const bundledDataPath = (d: ExampleDataRef): string =>
  `examples/data/${d.package}/${d.name}${d.na?.length ? `.na${d.na.join('_')}` : ''}.json`;
