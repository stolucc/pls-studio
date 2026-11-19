"""Compare the torch port with the native engine's reference dump (gpu/ref/out/*.json)."""

import argparse
import glob
import json
import os
import time

import numpy as np
import torch

import plsgpu

ap = argparse.ArgumentParser()
ap.add_argument("--device", default="cpu")
ap.add_argument("--dtype", default="float64", choices=["float32", "float64"])
ap.add_argument("--only", default=None)
ap.add_argument("--bench", type=int, default=0, help="also time this many samples")
ap.add_argument("--chunk", type=int, default=2048)
args = ap.parse_args()
dtype = getattr(torch, args.dtype)

here = os.path.dirname(os.path.abspath(__file__))


class Run:
    """run_range's answer as arrays: params (keys), originals (P,), draws (samples, P)."""

    def __init__(self, out):
        self.params = [p["key"] for p in out["params"]]
        self.originals = np.array(out["originals"], dtype=np.float64)
        self.draws = np.array(out["draws"], dtype=np.float64).T
        self.estimate_iterations = 0


def run(cols, m, o, samples, seed, keep):
    return Run(
        plsgpu.run_range(
            cols, m, o, seed, 0, samples, keep_inadmissible=keep, device=args.device, dtype=dtype, chunk=args.chunk
        )
    )
for path in sorted(glob.glob(os.path.join(here, "ref", "out", "*.json"))):
    ref = json.load(open(path))
    if args.only and args.only not in ref["name"]:
        continue
    m = plsgpu.Model.from_json(ref["model"])
    o = plsgpu.Options(
        scheme=ref["options"]["scheme"],
        max_iter=ref["options"]["maxIter"],
        tolerance=ref["options"]["tolerance"],
        consistent=ref["options"]["consistent"],
        abs_rho_a=bool(ref["options"].get("absRhoA", False)),
    )
    cols = np.array(ref["cols"], dtype=np.float64).T  # (n, p)
    keep = ref["keepInadmissible"]
    B = ref["boot"]["samples"]
    t0 = time.perf_counter()
    bs = run(cols, m, o, B, ref["boot"]["seed"], keep)
    if args.device != "cpu":
        torch.mps.synchronize() if args.device == "mps" else torch.cuda.synchronize()
    ms = (time.perf_counter() - t0) * 1000

    assert bs.params == ref["boot"]["params"], (bs.params[:5], ref["boot"]["params"][:5])
    bs.estimate_iterations = 0
    orig_ref = np.array(ref["boot"]["originals"], dtype=np.float64)
    d_orig = np.nanmax(np.abs(bs.originals - orig_ref))
    draws_ref = np.array([[np.nan if v is None else v for v in col] for col in ref["boot"]["draws"]]).T  # (B, P)
    fail_ref = np.isnan(draws_ref).all(axis=1)
    fail_got = np.isnan(bs.draws).all(axis=1)
    both = ~fail_ref & ~fail_got
    d_draws = np.max(np.abs(bs.draws[both] - draws_ref[both])) if both.any() else float("nan")
    # Parameter with the largest draw discrepancy
    per_param = np.max(np.abs(bs.draws[both] - draws_ref[both]), axis=0) if both.any() else np.zeros(len(bs.params))
    worst = bs.params[int(np.argmax(per_param))]
    off = int((np.abs(bs.draws[both] - draws_ref[both]) > 1e-3).any(axis=1).sum()) if both.any() else 0
    stats = plsgpu.summarise(bs.draws, bs.originals)
    d_ci = max(
        max(abs(s["ciLow"] - r["ciLow"]), abs(s["ciHigh"] - r["ciHigh"])) for s, r in zip(stats, ref["boot"]["stats"])
    )
    print(
        f"{ref['name']:15s} "
        f"|Δorig| {d_orig:.1e}  |Δdraw| {d_draws:.1e} ({worst}; {off} draws off >1e-3)  |ΔCI| {d_ci:.1e}  "
        f"failed {int(fail_got.sum())}/{int(fail_ref.sum())} (mismatch {int((fail_ref != fail_got).sum())})  "
        f"{ms:.0f} ms vs native {ref['boot']['ms']:.0f} ms"
    )
    if args.bench:
        t0 = time.perf_counter()
        run(cols, m, o, args.bench, 1, keep)
        if args.device != "cpu":
            torch.mps.synchronize() if args.device == "mps" else torch.cuda.synchronize()
        print(f"{'':15s} bench {args.bench} samples: {(time.perf_counter() - t0) * 1000:.0f} ms")
