import { MAX_WORKERS, useCompute } from '../rengine/compute';

/** Choices of the parallel option: off, and up to the computer's cores (at most MAX_WORKERS). */
export function workerChoices(cores: number): number[] {
  const max = Math.max(1, Math.min(MAX_WORKERS, cores));
  return [1, 2, 4, 6, 8].filter((n) => n <= max);
}

/** Parallel R sessions for bootstrapping and simulation (a preference of this browser). */
export function ComputeSettings() {
  const workers = useCompute((s) => s.workers);
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  const choices = workerChoices(cores);
  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label id="parallel-workers">Parallel bootstrap and simulation</label>
      <div className="segmented" role="radiogroup" aria-labelledby="parallel-workers">
        {choices.map((n) => (
          <button key={n} role="radio" aria-checked={workers === n} className={workers === n ? 'on' : ''} onClick={() => useCompute.getState().set({ workers: n })}>
            {n === 1 ? 'Off' : `${n} sessions`}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {workers === 1
          ? 'One R session: bootstrap results are exactly those of a single run of the package with your seed.'
          : `${workers} R sessions share the work (each needs about 300 MB of memory and loads the packages once). Bootstrap samples are drawn in chunks of 100 with seeds seed, seed + 1, …: the results are the same for any number of sessions and equal the exported script, but differ slightly from a single run of the package. Simulation results are unchanged.`}
        {' '}Applies to cSEM and lavaan bootstraps and Monte Carlo simulation; remembered in this browser.
      </div>
    </div>
  );
}
