# GPU worker

Batched PLS / PLSc estimation and bootstrap in torch (CUDA, Apple MPS or CPU), a port of
the built-in engine (`src/engine/pls.ts`, `src/engine/bootstrap.ts`). All B resamples are
estimated at once as a `(B, n, p)` tensor. Bootstrap rows come from the same PRNG
(`mulberry32` / `sampleSeed`), so draw b here and in the browser use the same rows.

- `plsgpu.py` — the port: PRNG, batched core, PLSc correction and admissibility, parameters
  in the engine's order, `run_range` (a RangePart with jackknife and studentized draws).
- `worker.py` — the process the helper runs (`accel.go`): JSON lines on stdin/stdout,
  `probe` and `bootstrap` operations, precision per request (`auto`, `single`, `double`),
  bounds on request sizes, NaN sent as null.
- `test_plsgpu.py` — pytest: every draw, failure set, jackknife and studentized draw against
  the engine's reference dump; the worker protocol.
- `ref/dump.ts` — writes that reference dump (`ref/out/*.json`) with the native engine.
- `validate.py` — the same comparison by hand, with timings.

Both `.py` files are embedded in the helper binary (`accel.go`); the helper writes them to a
private temporary directory and starts `python -I worker.py <device>`.

## Develop

```bash
cd helper/gpusrc
uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python torch numpy pytest
PATH=~/.nvm/versions/node/v22.21.1/bin:$PATH B=5000 ../../node_modules/.bin/tsx ref/dump.ts
.venv/bin/python -m pytest -q
.venv/bin/python validate.py --device mps --dtype float32 --bench 100000 --chunk 10000
```

The Go test `TestLocalAccelerator_RealWorkerBootstraps` uses this venv when present.

## Validation (mobi data, n = 250, 5000 draws, seed 1)

| device / dtype | max |Δ draw| vs native | max |Δ CI| | failed draws match |
|---|---|---|---|
| CPU float64 | 6e-15 (PLSc: 2e-8) | 4e-15 (PLSc: 2e-12) | yes, all cases |
| MPS float32 | 3e-6 (PLS); PLSc: 54 of 5000 ill-conditioned draws differ > 1e-3 | 9e-7 (PLSc: 4e-4) | yes, all cases |

float32: the engine's tolerance (1e-7 on Σ|Δw|) is below float32 resolution, so float32
converges to `p · 1e-6` instead. PLSc draws whose disattenuated correlations are near ±1
amplify rounding; ask for double precision (CPU or CUDA) when PLSc draws must match exactly.
Apple GPUs compute in single precision only (Metal has no double).

## Speed (mobi, Mode A path, draws per second)

| engine | draws / s |
|---|---|
| built-in engine, one browser worker | ~1 500 |
| torch CPU float32 (M4 Pro) | ~6 000 |
| torch MPS float32 (M4 Pro, chunk 10 000) | ~23 000 |

On MPS the time goes into Metal's batched matmuls on skinny matrices (`(B, n, p) @ (B, p, J)`),
about 8 ms per 10 000 samples each; the iteration is bandwidth-bound there. CUDA's batched
GEMMs do better. For comparison, the browser engine on 13 cores reaches about 20 000 draws / s,
so on this Mac the GPU mainly frees the CPU; the gain is in cluster GPUs and bigger batches.
