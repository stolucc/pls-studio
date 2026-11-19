"""Batched PLS / PLSc estimation and bootstrap on a GPU (torch: CUDA, Apple MPS or CPU).

A port of the native engine's plsCore / structural / bootstrap (src/engine/pls.ts,
src/engine/bootstrap.ts): B resamples are estimated at once as a (B, n, p) tensor.
The bootstrap indices come from the same PRNG (mulberry32 / sampleSeed), so a draw
here and in the native engine use the same rows; only floating-point arithmetic differs.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import torch

U32 = np.uint32


# ---------- PRNG (bootstrap.ts sampleSeed / sampleIndices, stats.ts mulberry32) ----------


def sample_seed(seed: int, b: np.ndarray) -> np.ndarray:
    """sampleSeed(seed, b) for a vector of sample numbers b."""
    b = b.astype(U32)
    h = np.full(b.shape, (seed ^ 0x9E3779B9) & 0xFFFFFFFF, dtype=U32)
    h = (h ^ (b + U32(0x7F4A7C15))) * U32(0x85EBCA6B)
    h ^= h >> U32(13)
    h = h * U32(0xC2B2AE35)
    h ^= h >> U32(16)
    return h


def mulberry32_matrix(seeds: np.ndarray, count: int) -> np.ndarray:
    """count draws of mulberry32 for each seed: floats in [0, 1), shape (len(seeds), count)."""
    a = seeds.astype(U32).copy()
    out = np.empty((a.shape[0], count), dtype=np.float64)
    for r in range(count):
        a = a + U32(0x6D2B79F5)
        t = a
        t = (t ^ (t >> U32(15))) * (t | U32(1))
        t = t ^ (t + ((t ^ (t >> U32(7))) * (t | U32(61))))
        out[:, r] = (t ^ (t >> U32(14))).astype(np.float64) / 4294967296.0
    return out


def sample_indices(seed: int, b: np.ndarray, n: int) -> np.ndarray:
    """Resampling rows of samples b (shape (B,)): int64 (B, n), as sampleIndices."""
    with np.errstate(over="ignore"):
        u = mulberry32_matrix(sample_seed(seed, b), n)
    return np.floor(u * n).astype(np.int64)


# ---------- model ----------


@dataclass
class Model:
    constructs: list[str]
    indicator_names: list[str]
    indicator_construct: list[int]
    blocks: list[list[int]]
    modes: list[str]
    types: list[str]
    preds: list[list[int]]
    succs: list[list[int]]
    has_path: list[list[bool]]
    dominant: list[int] = field(default_factory=list)
    predefined: list[list[float] | None] = field(default_factory=list)

    @staticmethod
    def from_json(d: dict) -> "Model":
        J = len(d["constructs"])
        return Model(
            constructs=list(d["constructs"]),
            indicator_names=list(d["indicatorNames"]),
            indicator_construct=list(d["indicatorConstruct"]),
            blocks=[list(b) for b in d["blocks"]],
            modes=list(d["modes"]),
            types=list(d["types"]),
            preds=[list(p) for p in d["preds"]],
            succs=[list(s) for s in d["succs"]],
            has_path=[list(r) for r in d["hasPath"]],
            dominant=list(d.get("dominant") or [-1] * J),
            predefined=list(d.get("predefined") or [None] * J),
        )

    @property
    def J(self) -> int:
        return len(self.constructs)

    @property
    def p(self) -> int:
        return len(self.indicator_names)

    def is_common_factor(self, j: int) -> bool:
        return (
            self.types[j] == "factor"
            and self.modes[j] == "A"
            and len(self.blocks[j]) > 1
            and self.predefined[j] is None
        )


@dataclass
class Options:
    scheme: str = "path"
    max_iter: int = 300
    tolerance: float = 1e-7
    consistent: bool = False
    abs_rho_a: bool = False


# ---------- batched estimation ----------


def _solve(A: torch.Tensor, rhs: torch.Tensor) -> torch.Tensor:
    """Batched solve A x = rhs for small, well-conditioned systems (a few predictors' correlations).
    On Apple MPS torch's solve kernel is slow for tiny matrices (~12× the inverse); the explicit inverse
    agrees to float32 rounding there, and CPU / CUDA keep the solve (exact in double)."""
    if A.device.type == "mps":
        return torch.linalg.inv(A) @ rhs
    return torch.linalg.solve(A, rhs)


def _inv(A: torch.Tensor) -> torch.Tensor:
    return torch.linalg.inv(A)


def standardize(X: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """Columns centred and scaled by the sample SD (n − 1). Returns (X, failed): failed marks a batch with a constant column."""
    n = X.shape[1]
    mean = X.mean(dim=1, keepdim=True)
    Xc = X - mean
    sd = torch.sqrt((Xc * Xc).sum(dim=1, keepdim=True) / (n - 1))
    failed = (sd <= 1e-12).any(dim=(1, 2))
    sd = torch.where(sd <= 1e-12, torch.ones_like(sd), sd)
    return Xc / sd, failed


@dataclass
class Core:
    w: torch.Tensor  # (B, p)
    scores: torch.Tensor  # (B, n, J)
    iterations: torch.Tensor  # (B,)
    converged: torch.Tensor  # (B,) bool
    failed: torch.Tensor  # (B,) bool: zero variance somewhere


class InnerWeights:
    """The inner weights E[i, j] (construct i's contribution to the proxy of j) of a scheme, from the
    construct correlations C of a batch, with no Python loop over constructs per iteration: masks pick
    the adjacent correlations (or their signs), and the path scheme's regressions of each construct on
    its predictors run as one batched solve over constructs, padded to the largest predictor set."""

    def __init__(self, m: Model, scheme: str, dev, dt):
        J = m.J
        self.scheme = scheme
        measurement_only = J > 1 and all(len(P) == 0 for P in m.preds)
        adjacent = torch.zeros(J, J, dtype=dt)
        for j in range(J):
            for nb in [*m.preds[j], *m.succs[j]]:
                adjacent[nb, j] = 1.0
        if measurement_only:
            # No structural model: every construct is adjacent to every other, path weighting becomes factorial.
            adjacent = 1 - torch.eye(J, dtype=dt)
            if scheme == "path":
                self.scheme = "factor"
        self.adjacent = adjacent.to(dev)
        self.succ = torch.zeros(J, J, dtype=dt)
        for j in range(J):
            for s_ in m.succs[j]:
                self.succ[s_, j] = 1.0
        self.succ = self.succ.to(dev)
        # The regressions: construct j on P_j, padded with the identity to kmax predictors.
        self.targets = [j for j in range(J) if m.preds[j]]
        if self.scheme == "path" and self.targets:
            kmax = max(len(m.preds[j]) for j in self.targets)
            idx = torch.zeros(len(self.targets), kmax, dtype=torch.long)
            valid = torch.zeros(len(self.targets), kmax, dtype=dt)
            for t, j in enumerate(self.targets):
                P = m.preds[j]
                idx[t, : len(P)] = torch.tensor(P)
                valid[t, : len(P)] = 1.0
            self.idx = idx.to(dev)
            self.valid = valid.to(dev)
            self.rows = self.idx.unsqueeze(2).expand(-1, -1, kmax)
            self.cols = self.idx.unsqueeze(1).expand(-1, kmax, -1)
            pair = valid.unsqueeze(2) * valid.unsqueeze(1)
            self.pair = pair.to(dev)
            self.pad = ((1 - pair) * torch.eye(kmax, dtype=dt)).to(dev)
            self.target_idx = torch.tensor(self.targets, device=dev)

    def weights(self, C: torch.Tensor) -> torch.Tensor:
        if self.scheme == "centroid":
            return torch.sign(C) * self.adjacent
        if self.scheme == "factor":
            return C * self.adjacent
        E = C * self.succ
        if not self.targets:
            return E
        B = C.shape[0]
        # A[b, t] = C[b][P_t, P_t] (identity in the padding), rhs[b, t] = C[b][P_t, j_t] (0 in the padding).
        A = C[:, self.rows, self.cols] * self.pair + self.pad
        rhs = C[:, self.idx, self.target_idx.unsqueeze(1)] * self.valid
        beta = _solve(A, rhs.unsqueeze(3)).squeeze(3) * self.valid  # (B, T, kmax)
        for t, j in enumerate(self.targets):
            k = int(self.valid[t].sum().item())
            E[:, self.idx[t, :k], j] = beta[:, t, :k]
        return E


def pls_core(X: torch.Tensor, m: Model, o: Options, w_init: torch.Tensor | None = None) -> Core:
    """plsCore on a batch: X (B, n, p) standardised."""
    B, n, p = X.shape
    J = m.J
    dev, dt = X.device, X.dtype
    M = torch.zeros(p, J, device=dev, dtype=dt)
    for j, b in enumerate(m.blocks):
        M[b, j] = 1.0
    w = w_init.clone() if w_init is not None else torch.ones(B, p, device=dev, dtype=dt)
    failed = torch.zeros(B, dtype=torch.bool, device=dev)

    # Mode B blocks: the constant inverse indicator correlation matrix of each block.
    block_inv: dict[int, torch.Tensor] = {}
    for j, b in enumerate(m.blocks):
        if m.modes[j] == "B" and len(b) >= 2 and m.predefined[j] is None:
            Xb = X[:, :, b]
            block_inv[j] = _inv(Xb.transpose(1, 2) @ Xb / (n - 1))

    def compute_scores(w: torch.Tensor):
        Y = X @ (w.unsqueeze(2) * M)  # (B, n, J)
        s = torch.sqrt((Y * Y).sum(dim=1) / (n - 1))  # (B, J)
        bad = (s <= 1e-12).any(dim=1)
        s = torch.where(s <= 1e-12, torch.ones_like(s), s)
        w = w / (s @ M.T)
        Y = Y / s.unsqueeze(1)
        return w, Y, bad

    w, Y, bad = compute_scores(w)
    failed |= bad
    inner = InnerWeights(m, o.scheme, dev, dt)
    iterations = torch.zeros(B, dtype=torch.int32, device=dev)
    converged = torch.zeros(B, dtype=torch.bool, device=dev)

    for it in range(1, o.max_iter + 1):
        active = ~converged & ~failed
        if not bool(active.any()):
            break
        C = Y.transpose(1, 2) @ Y / (n - 1)  # (B, J, J)
        E = inner.weights(C)
        Z = Y @ E  # (B, n, J): inner proxies
        sz = torch.sqrt((Z * Z).sum(dim=1) / (n - 1))
        bad = (sz <= 1e-12).any(dim=1)
        sz = torch.where(sz <= 1e-12, torch.ones_like(sz), sz)
        Z = Z / sz.unsqueeze(1)
        r = X.transpose(1, 2) @ Z / (n - 1)  # (B, p, J)
        rk = (r * M).sum(dim=2)  # (B, p): r of each indicator with its own construct's proxy
        w_new = rk.clone()
        for j, b in enumerate(m.blocks):
            given = m.predefined[j]
            if given is not None:
                w_new[:, b] = torch.tensor(given, device=dev, dtype=dt)
            elif m.modes[j] == "unit":
                w_new[:, b] = 1.0
            elif j in block_inv:
                w_new[:, b] = (block_inv[j] @ rk[:, b].unsqueeze(2)).squeeze(2)
        last = w
        w_new, Y_new, bad2 = compute_scores(w_new)
        bad |= bad2
        # Dominant indicators: each block's sign such that its dominant indicator loads positively.
        for j, k in enumerate(m.dominant):
            if k < 0:
                continue
            c = (X[:, :, k] * Y_new[:, :, j]).sum(dim=1)
            flip = torch.where(c < 0, -1.0, 1.0).to(dt)
            w_new[:, m.blocks[j]] = w_new[:, m.blocks[j]] * flip.unsqueeze(1)
            Y_new[:, :, j] = Y_new[:, :, j] * flip.unsqueeze(1)
        diff = (w_new - last).abs().sum(dim=1)
        # Converged / failed batches keep the solution they had; the others take this iteration's.
        take = active.unsqueeze(1)
        w = torch.where(take, w_new, w)
        Y = torch.where(take.unsqueeze(2), Y_new, Y)
        iterations = torch.where(active, torch.full_like(iterations, it), iterations)
        failed |= active & bad
        converged |= active & ~bad & (diff < o.tolerance)
    return Core(w=w, scores=Y, iterations=iterations, converged=converged, failed=failed)


@dataclass
class Structural:
    C: torch.Tensor  # (B, J, J)
    path_coef: torch.Tensor  # (B, J, J)
    r_squared: torch.Tensor  # (B, J), NaN for exogenous
    loadings: torch.Tensor  # (B, p)
    total_effects: torch.Tensor  # (B, J, J)
    rho_a: torch.Tensor  # (B, J)


def total_effects_of(Bm: torch.Tensor) -> torch.Tensor:
    J = Bm.shape[1]
    total = Bm.clone()
    power = Bm
    for _ in range(1, J):
        power = power @ Bm
        total = total + power
    return total


def structural(X: torch.Tensor, m: Model, core: Core, consistent: bool, abs_rho_a: bool) -> Structural:
    B, n, p = X.shape
    J = m.J
    dev, dt = X.device, X.dtype
    Y = core.scores
    raw = Y.transpose(1, 2) @ Y / (n - 1)
    cross = X.transpose(1, 2) @ Y / (n - 1)  # (B, p, J)
    own = torch.tensor(m.indicator_construct, device=dev)
    loadings = cross[:, torch.arange(p, device=dev), own]  # (B, p)
    rho_a = torch.ones(B, J, device=dev, dtype=dt)
    for j, b in enumerate(m.blocks):
        if not m.is_common_factor(j):
            continue
        Xb = X[:, :, b]
        R = Xb.transpose(1, 2) @ Xb / (n - 1)
        k = len(b)
        R_off = R * (1 - torch.eye(k, device=dev, dtype=dt))
        wb = core.w[:, b]
        num = torch.einsum("bi,bij,bj->b", wb, R_off, wb)
        ww = (wb * wb).sum(dim=1)
        den = ww * ww - (wb**4).sum(dim=1)
        c2 = num / den
        if abs_rho_a:
            c2 = c2.abs()
        rho_a[:, j] = ww * ww * c2
        if consistent:
            c = torch.sqrt(torch.clamp(c2, min=0))
            loadings[:, b] = c.unsqueeze(1) * wb
    if consistent:
        scale = torch.sqrt(rho_a.unsqueeze(2) * rho_a.unsqueeze(1))
        eye = torch.eye(J, device=dev, dtype=dt)
        C = raw / scale * (1 - eye) + eye
    else:
        C = raw
    path_coef = torch.zeros(B, J, J, device=dev, dtype=dt)
    r_squared = torch.full((B, J), float("nan"), device=dev, dtype=dt)
    for j in range(J):
        P = m.preds[j]
        if not P:
            continue
        A = C[:, P][:, :, P]
        rhs = C[:, P, j]
        beta = _solve(A, rhs.unsqueeze(2)).squeeze(2)
        path_coef[:, P, j] = beta
        r_squared[:, j] = (beta * rhs).sum(dim=1)
    return Structural(
        C=C,
        path_coef=path_coef,
        r_squared=r_squared,
        loadings=loadings,
        total_effects=total_effects_of(path_coef),
        rho_a=rho_a,
    )


def plsc_inadmissible(m: Model, st: Structural) -> tuple[torch.Tensor, torch.Tensor]:
    """(undefined, problems) per batch, as plscProblems: a non-positive ρA; ρA above 1 or a disattenuated correlation beyond ±1."""
    cf = [j for j in range(m.J) if m.is_common_factor(j)]
    B = st.C.shape[0]
    dev = st.C.device
    undefined = torch.zeros(B, dtype=torch.bool, device=dev)
    problems = torch.zeros(B, dtype=torch.bool, device=dev)
    if cf:
        r = st.rho_a[:, cf]
        undefined = ~(r > 0).all(dim=1)
        problems = (r > 1 + 1e-10).any(dim=1)
    J = m.J
    off = ~torch.eye(J, dtype=torch.bool, device=dev)
    beyond = ((st.C.abs() > 1 + 1e-10) & off).any(dim=(1, 2))
    problems = problems | (beyond & ~undefined)
    return undefined, undefined | problems


# ---------- parameters (bootstrap.ts plsParameters / pathChains) ----------

MAX_CHAINS = 500


def path_chains(has_path: list[list[bool]]) -> list[list[int]]:
    J = len(has_path)
    chains: list[list[int]] = []

    def grow(nodes: list[int]):
        last = nodes[-1]
        for to in range(J):
            if not has_path[last][to] or to in nodes:
                continue
            if len(chains) >= MAX_CHAINS:
                return
            nxt = [*nodes, to]
            if len(nxt) > 2:
                chains.append(nxt)
            grow(nxt)

    for frm in range(J):
        grow([frm])
    return chains


def parameters(m: Model, orig: Structural) -> list[tuple[str, str]]:
    """(key, kind) of every bootstrapped parameter, in the native engine's order."""
    C = m.constructs
    J = m.J
    ps: list[tuple[str, str]] = []
    for i in range(J):
        for j in range(J):
            if m.has_path[i][j]:
                ps.append((f"path:{C[i]}:{C[j]}", f"path:{i}:{j}"))
    indirect0 = (orig.total_effects - orig.path_coef)[0]
    for i in range(J):
        for j in range(J):
            if abs(float(indirect0[i, j])) > 1e-12:
                ps.append((f"total:{C[i]}:{C[j]}", f"total:{i}:{j}"))
                ps.append((f"indirect:{C[i]}:{C[j]}", f"indirect:{i}:{j}"))
    for chain in path_chains(m.has_path):
        ps.append((f"specific:{':'.join(C[j] for j in chain)}", "chain:" + ",".join(map(str, chain))))
    for k, name in enumerate(m.indicator_names):
        ps.append((f"loading:{name}", f"loading:{k}"))
        ps.append((f"weight:{name}", f"weight:{k}"))
    for j, c in enumerate(C):
        if m.preds[j]:
            ps.append((f"r2:{c}", f"r2:{j}"))
    return ps


def extract(ps: list[tuple[str, str]], st: Structural, w: torch.Tensor) -> torch.Tensor:
    """Parameter values of a batch: (B, P)."""
    cols = []
    for _, kind in ps:
        what, _, rest = kind.partition(":")
        if what == "path":
            i, j = map(int, rest.split(":"))
            cols.append(st.path_coef[:, i, j])
        elif what == "total":
            i, j = map(int, rest.split(":"))
            cols.append(st.total_effects[:, i, j])
        elif what == "indirect":
            i, j = map(int, rest.split(":"))
            cols.append(st.total_effects[:, i, j] - st.path_coef[:, i, j])
        elif what == "chain":
            chain = list(map(int, rest.split(",")))
            v = torch.ones_like(st.path_coef[:, 0, 0])
            for a, b in zip(chain, chain[1:]):
                v = v * st.path_coef[:, a, b]
            cols.append(v)
        elif what == "loading":
            cols.append(st.loadings[:, int(rest)])
        elif what == "weight":
            cols.append(w[:, int(rest)])
        elif what == "r2":
            cols.append(st.r_squared[:, int(rest)])
    return torch.stack(cols, dim=1)


# ---------- estimation of a batch ----------


def estimate_batch(X: torch.Tensor, m: Model, o: Options, keep_inadmissible: bool):
    """Estimate every batch of X (B, n, p) raw columns: (structural, core, failed)."""
    Xs, bad = standardize(X)
    core = pls_core(Xs, m, o)
    st = structural(Xs, m, core, o.consistent, o.abs_rho_a)
    failed = bad | core.failed | ~core.converged
    if o.consistent:
        undefined, problems = plsc_inadmissible(m, st)
        failed = failed | undefined if keep_inadmissible else failed | problems
    return st, core, failed


# ---------- summary (bootstrap.ts summarise, stats.ts bootQuantile) ----------


def qnorm(p: float) -> float:
    return float(torch.special.ndtri(torch.tensor(p, dtype=torch.float64)))


def boot_quantile(sorted_v: np.ndarray, p: float) -> float:
    R = len(sorted_v)
    if R == 0:
        return math.nan
    rank = (R + 1) * p
    k = int(rank)
    if k <= 0:
        return float(sorted_v[0])
    if k >= R:
        return float(sorted_v[R - 1])
    if k == rank:
        return float(sorted_v[k - 1])
    zk = qnorm(k / (R + 1))
    z_next = qnorm((k + 1) / (R + 1))
    share = (qnorm(p) - zk) / (z_next - zk)
    return float(sorted_v[k - 1] + share * (sorted_v[k] - sorted_v[k - 1]))


def summarise(draws: np.ndarray, originals: np.ndarray, confidence: float = 0.95) -> list[dict]:
    """Percentile intervals per parameter over the samples that succeeded (every parameter finite)."""
    ok = np.isfinite(draws).all(axis=1)
    kept = draws[ok]
    alpha = (1 - confidence) / 2
    out = []
    for i in range(draws.shape[1]):
        v = kept[:, i]
        srt = np.sort(v)
        mean = float(v.mean()) if len(v) else math.nan
        sd = float(v.std(ddof=1)) if len(v) > 1 else math.nan
        out.append(
            {
                "mean": mean,
                "sd": sd,
                "ciLow": boot_quantile(srt, alpha),
                "ciHigh": boot_quantile(srt, 1 - alpha),
            }
        )
    return out

# ---------- a bootstrap range as the native engine's RangePart (bootstrap.ts runRange) ----------

GROUP_OF = {
    "path": "path",
    "total": "total",
    "indirect": "indirect",
    "chain": "specific",
    "loading": "loading",
    "weight": "weight",
    "r2": "r2",
}


def param_meta(m: Model, ps: list[tuple[str, str]]) -> list[dict]:
    """{key, group, label} of every parameter, as plsParameters labels them."""
    C = m.constructs
    out = []
    for key, kind in ps:
        what, _, rest = kind.partition(":")
        if what in ("path", "total", "indirect"):
            i, j = map(int, rest.split(":"))
            label = f"{C[i]} → {C[j]}"
        elif what == "chain":
            label = " → ".join(C[j] for j in map(int, rest.split(",")))
        elif what == "loading":
            k = int(rest)
            label = f"{C[m.indicator_construct[k]]} → {m.indicator_names[k]}"
        elif what == "weight":
            k = int(rest)
            label = f"{m.indicator_names[k]} → {C[m.indicator_construct[k]]}"
        else:
            label = C[int(rest)]
        out.append({"key": key, "group": GROUP_OF[what], "label": label})
    return out


def _chunk_for(n: int, p: int, chunk: int | None, budget_bytes: int = 512 << 20) -> int:
    """Resamples per batch: the given chunk, else as many as fit the memory budget (the data tensor and its copies)."""
    if chunk:
        return max(1, chunk)
    per = n * p * 4 * 6  # the tensor, its standardised copy, scores, proxies and temporaries
    return max(1, min(4096, budget_bytes // max(per, 1)))


def _values_of(X: torch.Tensor, m: Model, o: Options, keep: bool, ps) -> torch.Tensor:
    st, core, failed = estimate_batch(X, m, o, keep)
    vals = extract(ps, st, core.w)
    return torch.where(failed.unsqueeze(1), torch.full_like(vals, float("nan")), vals)


def run_range(
    cols: np.ndarray,
    m: Model,
    o: Options,
    seed: int,
    start: int,
    end: int,
    keep_inadmissible: bool = False,
    jackknife: bool = False,
    inner_samples: int = 0,
    device: str = "cpu",
    dtype: torch.dtype = torch.float32,
    chunk: int | None = None,
    progress=None,
) -> dict:
    """Samples [start, end) of the PLS bootstrap with seed, as runRange answers: params, originals, draws
    (one array per parameter, NaN for a failed sample), the jackknife and studentized draws when asked."""
    dev = torch.device(device)
    Xraw = torch.as_tensor(np.asarray(cols, dtype=np.float64), dtype=dtype, device=dev)
    n, p = Xraw.shape
    if o.consistent and keep_inadmissible:
        o = Options(**{**o.__dict__, "abs_rho_a": True})
    if dtype == torch.float32:
        o = Options(**{**o.__dict__, "tolerance": max(o.tolerance, p * 1e-6)})
    st0, core0, failed0 = estimate_batch(Xraw.unsqueeze(0), m, o, keep_inadmissible)
    if bool(failed0[0]) and not keep_inadmissible and o.consistent:
        undefined, _ = plsc_inadmissible(m, st0)
        if bool(undefined[0]):
            raise ValueError("Consistent PLS cannot correct this model: a construct's ρA is not positive.")
    ps = parameters(m, st0)
    originals = extract(ps, st0, core0.w)[0].cpu().double().numpy()
    P = len(ps)
    count = max(0, end - start)
    draws = np.full((count, P), np.nan)
    chunk = _chunk_for(n, p, chunk)
    for s in range(0, count, chunk):
        e = min(count, s + chunk)
        idx = torch.as_tensor(sample_indices(seed, np.arange(start + s, start + e), n), device=dev)
        draws[s:e] = _values_of(Xraw[idx], m, o, keep_inadmissible, ps).cpu().double().numpy()
        if progress:
            progress(e, count)
    out = {
        "start": start,
        "params": param_meta(m, ps),
        "originals": originals.tolist(),
        "draws": draws.T.tolist(),
    }
    if inner_samples > 1:
        studentized = np.full((count, P), np.nan)
        per = max(1, chunk // inner_samples)
        for s in range(0, count, per):
            e = min(count, s + per)
            ids = np.arange(start + s, start + e)
            outer = sample_indices(seed, ids, n)  # (Bo, n)
            # Inner resamples of sample k: sampleIndices(sampleSeed(seed, k + 1), b, n) mapped through its rows.
            inner_seed = sample_seed(seed, ids + 1)
            inner = np.stack(
                [sample_indices(int(sd), np.arange(inner_samples), n) for sd in inner_seed]
            )  # (Bo, inner, n)
            rows = np.take_along_axis(outer[:, None, :], inner, axis=2).reshape(-1, n)
            vals = _values_of(Xraw[torch.as_tensor(rows, device=dev)], m, o, keep_inadmissible, ps)
            v = vals.cpu().double().numpy().reshape(e - s, inner_samples, P)
            with np.errstate(invalid="ignore"):
                ok = np.isfinite(v)
                cnt = ok.sum(axis=1)
                mean = np.nanmean(np.where(ok, v, np.nan), axis=1)
                dev2 = np.where(ok, (v - mean[:, None, :]) ** 2, 0).sum(axis=1)
                se = np.sqrt(dev2 / np.maximum(cnt - 1, 1))
                t = (draws[s:e] - originals[None, :]) / se
                good = (cnt >= 2) & (se > 0)
                studentized[s:e] = np.where(good, t, np.nan)
        out["studentized"] = studentized.T.tolist()
    if jackknife:
        loo = np.array([[r for r in range(n) if r != i] for i in range(n)], dtype=np.int64)
        jack = np.full((n, P), np.nan)
        for s in range(0, n, chunk):
            e = min(n, s + chunk)
            jack[s:e] = _values_of(
                Xraw[torch.as_tensor(loo[s:e], device=dev)], m, o, keep_inadmissible, ps
            ).cpu().double().numpy()
        out["jack"] = jack.T.tolist()
    return out
