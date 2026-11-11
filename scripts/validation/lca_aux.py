"""Reference results for the three-step analysis of latent classes' auxiliary variables (R/items.R, ps_lca_aux_body).

An independent implementation: StepMix 3.0.0 (Morin et al. 2023, Python; its corrections follow Vermunt 2010 and
Bakk et al. 2013), on src/engine/__fixtures__/lcaaux/election.csv (written by lca_aux.R): a 3-class latent class
model of the six categorical items, then with three-step estimation
  - the classification-error matrix D (stepmix.corrections.compute_bch_matrix, modal assignment),
  - the distal outcomes' class means with the BCH correction (structural 'gaussian_diag', correction='BCH'),
  - the covariates' multinomial logit with the ML correction (correction='ML') and with BCH weights (correction='BCH').
StepMix gives no analytic standard errors; the robust (sandwich) ones are computed here from numerical derivatives of
each case's contribution to the step-3 objective (central differences), not from the closed forms the app uses.
Classes are numbered by size, largest first, as the app numbers them; the logit's reference is the last class.

    python -I scripts/validation/lca_aux.py        (with stepmix==3.0.0 installed)
"""
import json, os

import numpy as np
import stepmix
from stepmix import StepMix
from stepmix.corrections import compute_bch_matrix

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
DIR = os.path.join(ROOT, 'src', 'engine', '__fixtures__', 'lcaaux')
raw = np.genfromtxt(os.path.join(DIR, 'election.csv'), delimiter=',', names=True)
ITEMS = ['MORALG', 'CARESG', 'KNOWG', 'LEADG', 'DISHONG', 'INTELG']
X = np.column_stack([raw[i] for i in ITEMS]).astype(int) - 1
Z = np.column_stack([raw['PARTY'], raw['GENDER']])
Y = np.column_stack([raw['EDUC'], raw['AGE']])
K = 3
common = dict(n_components=K, measurement='categorical', n_steps=3, n_init=20, max_iter=100000, abs_tol=1e-14, rel_tol=1e-15,
              random_state=20261111, progress_bar=0, verbose=0)
# (the logit's Newton-Raphson run to convergence: StepMix's default is one step per M-step)
strict = {'method': 'newton-raphson', 'max_iter': 1000, 'tol': 1e-12}

bch_distal = StepMix(**common, structural='gaussian_diag', correction='BCH'); bch_distal.fit(X, Y)
ml_cov = StepMix(**common, structural='covariate', correction='ML', structural_params=strict); ml_cov.fit(X, Z)
bch_cov = StepMix(**common, structural='covariate', correction='BCH', structural_params=strict); bch_cov.fit(X, Z)

# The posterior probabilities of the (same) measurement model; classes by size.
post = bch_distal.predict_proba_class(X)
order = np.argsort(-post.mean(axis=0), kind='stable')
post = post[:, order]
llik = float(bch_distal.score(X) * X.shape[0])
D, Dinv = compute_bch_matrix(post, 'modal')
s = post.argmax(axis=1)
w = np.eye(K)[s] @ Dinv
n = X.shape[0]


def perm(m):
    """A fitted model's classes in this order (its own measurement model may number them differently), and how far
    its posterior probabilities are from these."""
    p = m.predict_proba_class(X)
    pm = [int(np.argmin([np.abs(p[:, j] - post[:, c]).max() for j in range(K)])) for c in range(K)]
    return pm, float(np.abs(p[:, pm] - post).max())


def sandwich(contrib, theta):
    """Robust covariance H^-1 B H^-1 from per-case contributions contrib(theta) -> (n,): each case's score by the
    complex step (exact to rounding), the Hessian by central differences of the summed scores (step 1e-4)."""
    q = len(theta)

    def scores(th, h=1e-30):
        S = np.zeros((n, q))
        for j in range(q):
            e = np.zeros(q, dtype=complex); e[j] = 1j * h
            S[:, j] = contrib(th + e).imag / h
        return S
    S = scores(theta)
    H = np.zeros((q, q))
    for j in range(q):
        e = np.zeros(q); e[j] = 1e-4
        H[:, j] = (scores(theta + e).sum(axis=0) - scores(theta - e).sum(axis=0)) / 2e-4
    H = (H + H.T) / 2
    Hi = np.linalg.inv(-H)
    return Hi @ (S.T @ S) @ Hi, np.abs(S.sum(axis=0)).max()


# Distal outcomes: StepMix's BCH means, and the sandwich of the BCH-weighted normal log-likelihood (class-specific
# means and log SDs) for their standard errors and Wald tests.
p_d, err_d = perm(bch_distal)
sm = bch_distal.get_parameters()['structural']
means = np.asarray(sm['means'])[p_d]
distal = []
for j, name in enumerate(['EDUC', 'AGE']):
    y = Y[:, j]
    mu = means[:, j]
    sd = np.sqrt(np.maximum((w * (y[:, None] - mu) ** 2).sum(axis=0) / w.sum(axis=0), 0))
    contrib = lambda th: (w * (-0.5 * ((y[:, None] - th[:K]) / np.exp(th[K:])) ** 2 - th[K:])).sum(axis=1)
    V, g = sandwich(contrib, np.concatenate([mu, np.log(sd)]))
    V = V[:K, :K]
    R = np.column_stack([np.eye(K - 1), -np.ones(K - 1)])
    d = R @ mu
    chisq = float(d @ np.linalg.solve(R @ V @ R.T, d))
    pairs = [[a + 1, b + 1, float((mu[a] - mu[b]) ** 2 / (V[a, a] + V[b, b] - 2 * V[a, b]))] for a in range(K) for b in range(a + 1, K)]
    distal.append({'name': name, 'means': mu.tolist(), 'se': np.sqrt(np.diag(V)).tolist(), 'sd': sd.tolist(), 'chisq': chisq, 'pairs': pairs, 'gradient': float(g)})


# Covariates: StepMix's coefficients (each class minus the reference, the last), and the sandwich of the step-3
# objective: ML, log sum_c P(c | z) D[c, s]; BCH, sum_c w_c log P(c | z).
Zf = np.column_stack([np.ones(n), Z])


def probs(b):
    B = np.zeros((Zf.shape[1], K), dtype=b.dtype); B[:, :K - 1] = b.reshape(K - 1, -1).T
    e = Zf @ B; e = np.exp(e - e.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def covariates(m, method):
    pm, err = perm(m)
    beta = np.asarray(m.get_parameters()['structural']['beta'])[pm]  # K x (1 + p)
    b = (beta[:K - 1] - beta[K - 1]).ravel()
    contrib = (lambda th: np.log((probs(th) * D[:, s].T).sum(axis=1))) if method == 'ml' else (lambda th: (w * np.log(probs(th))).sum(axis=1))
    V, g = sandwich(contrib, b)
    p1 = Zf.shape[1]
    wald = []
    for j in range(p1):
        at = [c * p1 + j for c in range(K - 1)]
        wald.append(float(b[at] @ np.linalg.solve(V[np.ix_(at, at)], b[at])))
    return {'est': b.reshape(K - 1, p1).tolist(), 'se': np.sqrt(np.diag(V)).reshape(K - 1, p1).tolist(), 'wald': wald, 'logLik': float(contrib(b).sum()),
            'gradient': float(g), 'posteriorDifference': err}


out = {'stepmix': stepmix.__version__, 'numpy': np.__version__, 'n': n, 'llik': llik, 'shares': post.mean(axis=0).tolist(), 'D': D.tolist(),
       'counts': np.bincount(s, minlength=K).tolist(), 'distal': distal, 'ml': covariates(ml_cov, 'ml'), 'bch': covariates(bch_cov, 'bch'),
       'distalPosteriorDifference': err_d}
with open(os.path.join(DIR, 'reference.json'), 'w') as f:
    json.dump(out, f, indent=1)
print(json.dumps({k: out[k] for k in ['llik', 'shares', 'counts', 'distalPosteriorDifference']}), out['ml']['posteriorDifference'], out['bch']['posteriorDifference'])
