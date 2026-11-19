"""PLS Studio GPU worker: one JSON request per stdin line, one reply per stdout line.

Started by the helper (gpupool.go). Replies are prefixed with the reply mark so
that stray output (torch warnings) is never read as a reply.

    {"ready": true, "device": "mps", "name": "...", "torch": "2.x", "precisions": ["float32"]}
    → {"id": ..., "op": "probe"}                → {"id", "ok": true, "result": {device, name, torch}}
    → {"id": ..., "op": "bootstrap", "req": {}} → {"id", "ok": true, "result": <RangePart>}
                                                 | {"id", "ok": false, "message": "..."}
"""

from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

REPLY_MARK = "\x1ePSH\x1e"  # as the R worker (rpool.go replyMark)
MAX_SAMPLES = 200_000
MAX_CELLS = 50_000_000  # rows × indicators of one data set


def precisions_of(device: str) -> list[str]:
    """The floating-point precisions a device computes in: Apple GPUs (Metal) have no double."""
    if device == "mps":
        return ["float32"]
    if device == "cpu":
        return ["float64", "float32"]
    return ["float32", "float64"]


def pick_device(wanted: str):
    import torch

    if wanted in ("", "auto"):
        if torch.cuda.is_available():
            wanted = "cuda"
        elif torch.backends.mps.is_available():
            wanted = "mps"
        else:
            wanted = "cpu"
    if wanted == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available to torch")
        name = torch.cuda.get_device_name(0)
    elif wanted == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("Apple MPS is not available to torch")
        name = "Apple GPU (Metal)"
    elif wanted == "cpu":
        name = "CPU"
    else:
        raise RuntimeError(f"unknown device {wanted!r}")
    return wanted, name


def finite_or_null(v):
    """JSON has no NaN: nested lists and dicts with None for non-finite numbers (Go's decoder refuses NaN)."""
    if isinstance(v, dict):
        return {k: finite_or_null(x) for k, x in v.items()}
    if isinstance(v, list):
        return [finite_or_null(x) for x in v]
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def reply(obj):
    sys.stdout.write(REPLY_MARK + json.dumps(obj, separators=(",", ":"), allow_nan=False) + "\n")
    sys.stdout.flush()


def dtype_for(req: dict, device: str):
    """The request's precision ("auto", "single" or "double") on this device; auto: the device's first."""
    import torch

    wanted = str(req.get("precision", "auto") or "auto")
    allowed = precisions_of(device)
    name = {"single": "float32", "double": "float64"}.get(wanted, allowed[0])
    if wanted not in ("auto", "single", "double"):
        raise ValueError("unknown precision")
    if name not in allowed:
        raise ValueError(f"{device} has no {wanted} precision")
    return torch.float64 if name == "float64" else torch.float32, name


def bootstrap(req: dict, device: str) -> dict:
    import numpy as np
    import torch

    import plsgpu

    model = plsgpu.Model.from_json(req["model"])
    opts = req.get("options", {})
    o = plsgpu.Options(
        scheme=str(opts.get("scheme", "path")),
        max_iter=int(opts.get("maxIter", 300)),
        tolerance=float(opts.get("tolerance", 1e-7)),
        consistent=bool(opts.get("consistent", False)),
        abs_rho_a=bool(opts.get("absRhoA", False)),
    )
    if o.scheme not in ("path", "factor", "centroid"):
        raise ValueError("unknown weighting scheme")
    cols = req["cols"]
    if not cols or not isinstance(cols, list):
        raise ValueError("no data columns")
    n = len(cols[0])
    p = len(cols)
    if p != model.p or any(len(c) != n for c in cols):
        raise ValueError("the columns do not match the model")
    if n < 3:
        raise ValueError("Not enough complete observations to estimate the model.")
    if n * p > MAX_CELLS:
        raise ValueError("the data set is too large for the GPU worker")
    start, end = int(req.get("start", 0)), int(req.get("end", 0))
    if start < 0 or end < start or end - start > MAX_SAMPLES:
        raise ValueError("bad sample range")
    inner = int(req.get("innerSamples", 0) or 0)
    if inner < 0 or inner > 1000:
        raise ValueError("bad inner sample count")
    arr = np.array(cols, dtype=np.float64).T  # (n, p)
    if not np.isfinite(arr).all():
        raise ValueError("the columns hold missing values; treat them before bootstrapping")
    dtype, name = dtype_for(req, device)
    out = plsgpu.run_range(
        arr,
        model,
        o,
        seed=int(req.get("seed", 1)),
        start=start,
        end=end,
        keep_inadmissible=bool(req.get("keepInadmissible", False)),
        jackknife=bool(req.get("jackknife", False)),
        inner_samples=inner,
        device=device,
        dtype=dtype,
        chunk=int(req["chunk"]) if req.get("chunk") else None,
    )
    out["precision"] = name
    return out


def main() -> int:
    wanted = sys.argv[1] if len(sys.argv) > 1 else "auto"
    try:
        import torch

        device, name = pick_device(wanted)
        torch.set_grad_enabled(False)
        info = {"device": device, "name": name, "torch": torch.__version__, "precisions": precisions_of(device)}
    except Exception as e:  # noqa: BLE001 — reported to the helper, which shows it
        reply({"ready": False, "message": f"{type(e).__name__}: {e}"})
        return 1
    reply({"ready": True, **info})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req.get("id")
            op = req.get("op")
            if op == "probe":
                reply({"id": rid, "ok": True, "result": info})
            elif op == "bootstrap":
                result = bootstrap(req.get("req") or {}, device)
                reply({"id": rid, "ok": True, "result": finite_or_null(result)})
            else:
                reply({"id": rid, "ok": False, "message": "unknown operation"})
        except Exception as e:  # noqa: BLE001 — one bad request must not end the worker
            reply({"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "message": str(e)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
