"""The torch port against the native engine's reference dump (ref/out/*.json, made by ref/dump.ts)."""

import glob
import json
import os
import subprocess
import sys

import numpy as np
import pytest
import torch

import plsgpu

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = sorted(glob.glob(os.path.join(HERE, "ref", "out", "*.json")))


def load(name):
    for path in REFS:
        if os.path.basename(path) == f"{name}.json":
            return json.load(open(path))
    pytest.skip(f"reference {name} missing: run ref/dump.ts")


def options_of(ref):
    o = ref["options"]
    return plsgpu.Options(
        scheme=o["scheme"],
        max_iter=o["maxIter"],
        tolerance=o["tolerance"],
        consistent=o["consistent"],
        abs_rho_a=bool(o.get("absRhoA", False)),
    )


def cols_of(ref):
    return np.array(ref["cols"], dtype=np.float64).T


def ref_matrix(arrays):
    return np.array([[np.nan if v is None else v for v in col] for col in arrays]).T


def range_of(ref, device="cpu", dtype=torch.float64, **extra):
    b = ref["boot"]
    return plsgpu.run_range(
        cols_of(ref),
        plsgpu.Model.from_json(ref["model"]),
        options_of(ref),
        seed=b["seed"],
        start=0,
        end=b["samples"],
        keep_inadmissible=ref["keepInadmissible"],
        jackknife=b.get("jackknife", False),
        inner_samples=b.get("innerSamples", 0),
        device=device,
        dtype=dtype,
        **extra,
    )


def test_prng_matches_native_engine():
    # sampleSeed / mulberry32 ported bit for bit: the draws of a sample agree to rounding only if its rows do.
    ref = load("modeA_path")
    out = range_of(ref)
    got = np.array(out["draws"], dtype=np.float64).T
    want = ref_matrix(ref["boot"]["draws"])
    assert np.nanmax(np.abs(got - want)) < 1e-10


@pytest.mark.parametrize("name", ["modeA_path", "modeB_path", "modeA_factor", "modeA_centroid", "plsc_path", "plsc_keep"])
def test_every_draw_and_failure_matches(name):
    ref = load(name)
    out = range_of(ref)
    assert [p["key"] for p in out["params"]] == ref["boot"]["params"]
    assert [p["group"] for p in out["params"]] == ref["boot"]["groups"]
    assert [p["label"] for p in out["params"]] == ref["boot"]["labels"]
    assert np.max(np.abs(np.array(out["originals"]) - np.array(ref["boot"]["originals"]))) < 1e-10
    got = np.array(out["draws"], dtype=np.float64).T
    want = ref_matrix(ref["boot"]["draws"])
    failed_got = np.isnan(got).all(axis=1)
    failed_want = np.isnan(want).all(axis=1)
    assert (failed_got == failed_want).all()
    both = ~failed_got
    assert np.max(np.abs(got[both] - want[both])) < 1e-7


def test_jackknife_matches():
    ref = load("modeA_bca")
    out = range_of(ref)
    got = np.array(out["jack"], dtype=np.float64)
    want = np.array(ref["boot"]["jack"], dtype=np.float64)
    assert got.shape == want.shape
    assert np.nanmax(np.abs(got - want)) < 1e-10


def test_studentized_matches():
    ref = load("modeA_stud")
    out = range_of(ref)
    got = np.array(out["studentized"], dtype=np.float64)
    want = ref_matrix(ref["boot"]["studentized"]).T
    assert got.shape == want.shape
    assert (np.isnan(got) == np.isnan(want)).all()
    # A parameter that does not vary (the loading and weight of a single item, fixed at 1) has a t of 0 / 0
    # in both engines, numerical noise that mergeBootstrap ignores: compared where the draws vary.
    draws = np.array(out["draws"], dtype=np.float64)
    varies = np.nanstd(draws, axis=1) > 1e-12
    ok = ~np.isnan(got) & varies[:, None]
    assert np.max(np.abs(got[ok] - want[ok])) < 1e-6


def test_chunking_does_not_change_results():
    ref = load("modeA_path")
    whole = np.array(range_of(ref)["draws"])
    pieces = np.array(range_of(ref, chunk=7)["draws"])
    assert np.array_equal(whole, pieces, equal_nan=True)


def test_float32_stays_close_and_converges():
    ref = load("modeA_path")
    out = range_of(ref, dtype=torch.float32)
    got = np.array(out["draws"], dtype=np.float64).T
    want = ref_matrix(ref["boot"]["draws"])
    assert not np.isnan(got).any()
    assert np.max(np.abs(got - want)) < 1e-4


@pytest.mark.skipif(not torch.backends.mps.is_available(), reason="no Apple GPU")
def test_mps_matches_within_float32():
    ref = load("modeA_path")
    out = range_of(ref, device="mps", dtype=torch.float32)
    got = np.array(out["draws"], dtype=np.float64).T
    want = ref_matrix(ref["boot"]["draws"])
    assert not np.isnan(got).any()
    assert np.max(np.abs(got - want)) < 1e-4


# ---------- the worker protocol ----------


class Worker:
    def __init__(self, device="cpu"):
        self.proc = subprocess.Popen(
            [sys.executable, "-I", os.path.join(HERE, "worker.py"), device],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
            cwd=HERE,
        )
        self.ready = self.read()

    def read(self):
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("worker ended")
            if line.startswith("\x1ePSH\x1e"):
                return json.loads(line[len("\x1ePSH\x1e") :])

    def ask(self, obj):
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()
        return self.read()

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=30)


@pytest.fixture(scope="module")
def worker():
    w = Worker()
    yield w
    w.close()


def test_worker_starts_and_probes(worker):
    assert worker.ready["ready"] is True
    assert worker.ready["device"] == "cpu"
    assert worker.ready["precisions"] == ["float64", "float32"]
    assert worker.ask({"id": "a", "op": "probe"})["result"]["torch"] == torch.__version__


def test_worker_bootstraps_a_range_as_a_range_part(worker):
    ref = load("plsc_path")
    req = {
        "cols": ref["cols"],
        "model": ref["model"],
        "options": ref["options"],
        "seed": 1,
        "start": 0,
        "end": 150,
    }
    rep = worker.ask({"id": "b", "op": "bootstrap", "req": req})
    assert rep["ok"], rep
    r = rep["result"]
    assert r["start"] == 0 and r["precision"] == "float64"
    single = worker.ask({"id": "b2", "op": "bootstrap", "req": {**req, "end": 5, "precision": "single"}})
    assert single["result"]["precision"] == "float32"
    assert [p["key"] for p in r["params"]] == ref["boot"]["params"]
    assert len(r["draws"]) == len(r["params"]) and len(r["draws"][0]) == 150
    # NaN travels as null: the failed (inadmissible) draws of this PLSc bootstrap.
    want = ref_matrix(ref["boot"]["draws"])[:150]
    nulls = [i for i, v in enumerate(r["draws"][0]) if v is None]
    assert nulls == list(np.flatnonzero(np.isnan(want[:, 0])))


def test_worker_refuses_bad_requests_and_survives(worker):
    ref = load("modeA_path")
    bad = worker.ask({"id": "c", "op": "bootstrap", "req": {"cols": [[1, 2, 3]], "model": ref["model"]}})
    assert bad["ok"] is False and "columns" in bad["message"]
    assert worker.ask({"id": "d", "op": "nope"})["message"] == "unknown operation"
    huge = {"cols": ref["cols"], "model": ref["model"], "start": 0, "end": 10**7}
    assert "range" in worker.ask({"id": "e", "op": "bootstrap", "req": huge})["message"]
    assert "precision" in worker.ask({"id": "e2", "op": "bootstrap", "req": {**huge, "end": 2, "precision": "half"}})["message"]
    assert worker.ask({"id": "f", "op": "probe"})["ok"] is True


def test_worker_reports_a_missing_device():
    w = Worker("cuda") if not torch.cuda.is_available() else Worker("nonsense")
    assert w.ready["ready"] is False and w.ready["message"]
    w.proc.wait(timeout=30)
