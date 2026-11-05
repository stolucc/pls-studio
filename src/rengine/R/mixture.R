# A general finite mixture likelihood (Mplus's TYPE = MIXTURE), written out in base R: one or more
# categorical latent variables (with covariates, on each other, loglinear associations, known
# classes), and, within the joint classes, blocks of observed variables of several types:
# ordered categorical (logit thresholds), nominal, normal and censored-normal regressions, Poisson
# and zero-inflated Poisson counts, and multivariate normal blocks with a factor/structural model
# (factor mixtures, growth mixtures, latent profiles). The joint classes are enumerated (a latent
# transition or hidden Markov model's likelihood summed over all class sequences, which is what the
# forward algorithm computes). The model arrives as a specification (analyses/mixtureSyntax.ts,
# from Mplus-style syntax): the free parameters theta, and every model quantity ("slot") a linear
# combination of them, so equality constraints, fixed values and linear MODEL CONSTRAINTs are the
# same thing. Maximum likelihood by BFGS from random starts with a gradient from per-observation
# scores, Newton steps at the end; standard errors by the sandwich (Mplus's MLR).

mix_model <- function(spec, data) {
  n <- nrow(data)
  th <- spec$theta
  nth <- length(th)
  slots <- spec$slots
  ns <- length(slots)
  A <- matrix(0, ns, max(nth, 1)); b <- numeric(ns)
  for (s in seq_len(ns)) {
    cst <- slots[[s]]$c
    b[s] <- if (is.null(cst) || (length(cst) == 1 && is.na(cst))) -Inf else as.numeric(cst)
    t <- as.numeric(unlist(slots[[s]]$t))
    if (length(t)) for (j in seq(1, length(t), by = 2)) A[s, t[j] + 1] <- A[s, t[j] + 1] + t[j + 1]
  }
  cls <- lapply(spec$classes, function(v) {
    v$k <- as.integer(v$k); v$parents <- as.integer(unlist(v$parents)) + 1L; v$covariates <- as.character(unlist(v$covariates))
    v$slots <- as.integer(unlist(v$slots)) + 1L; v$prob <- isTRUE(v$prob)
    v$X <- if (length(v$covariates)) as.matrix(data[, v$covariates, drop = FALSE]) else NULL
    if (!is.null(v$known)) {
      vals <- as.numeric(unlist(v$known$values)); g <- data[[v$known$column]]
      v$obs <- match(g, vals)
      if (any(!is.na(g) & is.na(v$obs))) stop(sprintf("KNOWNCLASS %s: values of %s other than those listed.", v$name, v$known$column))
    }
    v
  })
  ks <- vapply(cls, function(v) v$k, 1L)
  Z <- as.matrix(expand.grid(lapply(ks, seq_len)))
  nz <- nrow(Z)
  # Index of a configuration of a subset of the class variables (first fastest), for each joint configuration.
  sub <- function(idx) { if (!length(idx)) return(rep(1L, nz)); m <- cumprod(c(1L, ks[idx]))[seq_along(idx)]; as.integer(1 + colSums(t(Z[, idx, drop = FALSE] - 1) * m)) }
  for (i in seq_along(cls)) cls[[i]]$pc <- sub(cls[[i]]$parents)
  blocks <- lapply(spec$blocks, function(bk) {
    bk$y <- as.character(unlist(bk$y)); bk$x <- as.character(unlist(bk$x)); bk$by <- as.integer(unlist(bk$by)) + 1L
    bk$Y <- as.matrix(data[, bk$y, drop = FALSE]); bk$X <- if (length(bk$x)) as.matrix(data[, bk$x, drop = FALSE]) else NULL
    bk$map <- sub(bk$by); bk$nc <- if (length(bk$by)) prod(ks[bk$by]) else 1L
    sl <- as.integer(unlist(bk$slots)) + 1L
    bk$S <- matrix(sl, nrow = bk$nc, byrow = TRUE)
    if (bk$type %in% c("cat", "nominal")) {
      lev <- as.numeric(unlist(bk$levels)); bk$code <- match(bk$Y[, 1], lev); bk$K <- length(lev)
      bk$idx <- lapply(seq_along(lev), function(j) which(bk$code == j))
      if (any(!is.na(bk$Y[, 1]) & is.na(bk$code))) stop(sprintf("%s has values other than its categories.", bk$y))
    }
    if (bk$type == "censored") bk$cpoint <- if (identical(bk$side, "above")) max(bk$Y[, 1], na.rm = TRUE) else min(bk$Y[, 1], na.rm = TRUE)
    if (bk$type == "mvn") {
      bk$p <- ncol(bk$Y); bk$m <- as.integer(bk$factors %||% 0); bk$q <- length(bk$x)
      pat <- is.na(bk$Y); key <- apply(pat, 1, function(r) paste(which(r), collapse = ","))
      bk$pats <- lapply(split(seq_len(n), key), function(rows) list(rows = rows, obs = which(!pat[rows[1], ])))
    }
    bk
  })
  w <- if (!is.null(spec$weight)) data[[spec$weight]] else rep(1, n)
  # Free probabilities (PROBABILITY parameterization) of one row: estimated through their logits, reported as probabilities.
  grp <- vapply(th, function(t) if (is.null(t$group)) NA_real_ else as.numeric(t$group), 1)
  groups <- unname(split(seq_along(grp)[!is.na(grp)], grp[!is.na(grp)]))
  list(n = n, w = w, A = A, b = b, nth = nth, cls = cls, ks = ks, Z = Z, nz = nz, blocks = blocks, loglinear = isTRUE(spec$loglinear), groups = groups,
    free = which(rowSums(A != 0) > 0))
}

mix_lse <- function(L) { m <- L[, 1]; if (ncol(L) > 1) for (j in 2:ncol(L)) m <- pmax(m, L[, j]); m[!is.finite(m)] <- 0; m + log(rowSums(exp(L - m))) }

# log P(joint class configuration | covariates): n x nz (with `parts`, also each variable's log P(category | parents, x)).
mix_prior <- function(M, phi, parts = FALSE) {
  n <- M$n; out <- matrix(0, n, M$nz); keep <- list()
  for (vi in seq_along(M$cls)) {
    v <- M$cls[[vi]]; q <- length(v$covariates); npc <- length(v$slots) / (v$k * (1 + q))
    W <- lapply(seq_len(npc), function(pc) {
      matrix(vapply(seq_len(v$k), function(m) {
        base <- ((pc - 1) * v$k + (m - 1)) * (1 + q)
        e <- rep(phi[v$slots[base + 1]], n)
        if (q) e <- e + drop(v$X %*% phi[v$slots[base + 1 + seq_len(q)]])
        e
      }, numeric(n)), n)
    })
    # (probabilities: the last category's is 1 minus the others; a step beyond 0 for a numerical derivative is floored)
    if (v$prob) W <- lapply(W, function(x) { pr <- x[1, -v$k]; matrix(log(pmax(c(pr, 1 - sum(pr)), 1e-300)), n, v$k, byrow = TRUE) })
    else if (!M$loglinear) W <- lapply(W, function(x) x - mix_lse(x))
    keep[[vi]] <- W
    for (z in seq_len(M$nz)) out[, z] <- out[, z] + W[[v$pc[z]]][, M$Z[z, vi]]
  }
  if (M$loglinear) out <- out - mix_lse(out)
  if (parts) list(lp = out, W = keep) else out
}

# log density of one block's observations in one configuration of its class variables (`v`: the slot values).
mix_ld <- function(bk, v) {
  n <- nrow(bk$Y); q <- length(bk$x)
  lin <- function(at) if (q) drop(bk$X %*% v[at + seq_len(q)]) else 0
  switch(bk$type,
    cat = {
      K <- bk$K; tau <- v[seq_len(K - 1)]; eta <- lin(K - 1); out <- numeric(n)
      if (K > 2 && is.unsorted(tau)) return(rep(-Inf, n))
      for (j in seq_len(K)) {
        ii <- bk$idx[[j]]; if (!length(ii)) next
        e <- if (length(eta) > 1) eta[ii] else eta
        out[ii] <- if (j == 1) plogis(tau[1] - e, log.p = TRUE) else if (j == K) plogis(tau[K - 1] - e, lower.tail = FALSE, log.p = TRUE)
          else log(pmax(plogis(tau[j] - e) - plogis(tau[j - 1] - e), 1e-300))
      }
      out
    },
    nominal = {
      K <- bk$K; y <- bk$code
      E <- cbind(vapply(seq_len(K - 1), function(j) rep(v[j], n) + (if (q) drop(bk$X %*% v[K - 1 + (j - 1) * q + seq_len(q)]) else 0), numeric(n)), 0)
      E <- matrix(E, n); lp <- E - mix_lse(E); out <- numeric(n); ok <- !is.na(y); out[ok] <- lp[cbind(which(ok), y[ok])]; out
    },
    normal = , censored = {
      y <- bk$Y[, 1]; mu <- v[1] + lin(1); s2 <- v[q + 2]; if (!is.finite(s2) || s2 <= 0) return(rep(-Inf, n)); s <- sqrt(s2)
      out <- dnorm(y, mu, s, log = TRUE)
      if (bk$type == "censored") {
        at <- if (identical(bk$side, "above")) y >= bk$cpoint - 1e-9 else y <= bk$cpoint + 1e-9; at[is.na(at)] <- FALSE
        mm <- if (length(mu) > 1) mu[at] else mu
        out[at] <- pnorm((bk$cpoint - mm) / s, lower.tail = !identical(bk$side, "above"), log.p = TRUE)
      }
      out[is.na(y)] <- 0; out
    },
    count = , zip = {
      y <- bk$Y[, 1]; lam <- exp(v[1] + lin(1)); out <- dpois(y, lam, log = TRUE)
      if (bk$type == "zip") {
        lz <- v[q + 2] + (if (q) drop(bk$X %*% v[q + 2 + seq_len(q)]) else 0)
        out <- ifelse(y == 0, log(plogis(lz) + plogis(lz, lower.tail = FALSE) * exp(-lam)), plogis(lz, lower.tail = FALSE, log.p = TRUE) + out)
      }
      out[is.na(y)] <- 0; out
    },
    mvn = {
      P <- mix_mvn_parts(bk, v); S <- P$S; p <- bk$p
      Mu <- matrix(P$mu0, n, p, byrow = TRUE)
      if (q) Mu <- Mu + bk$X %*% t(P$Mx)
      out <- numeric(n)
      for (pt in bk$pats) {
        ob <- pt$obs; if (!length(ob)) next
        R <- tryCatch(chol(S[ob, ob, drop = FALSE]), error = function(e) NULL); if (is.null(R)) return(rep(-Inf, n))
        D <- bk$Y[pt$rows, ob, drop = FALSE] - Mu[pt$rows, ob, drop = FALSE]
        zz <- backsolve(R, t(D), transpose = TRUE)
        out[pt$rows] <- -0.5 * colSums(zz^2) - sum(log(diag(R))) - 0.5 * length(ob) * log(2 * pi)
      }
      out
    },
    stop("Unknown block type"))
}

# A multivariate normal block's mean (mu0 + Mx x) and covariance matrix from its slots: y = nu + Lambda eta + K x + e,
# eta = alpha + B eta + Gamma x + zeta, Cov(zeta) = Psi, Cov(e) = Theta.
mix_mvn_parts <- function(bk, v) {
  p <- bk$p; m <- bk$m; q <- length(bk$x); o <- 0
  take <- function(len) { r <- v[o + seq_len(len)]; o <<- o + len; r }
  nu <- take(p); Lam <- matrix(take(p * m), p, m); Kx <- matrix(take(p * q), p, q); al <- take(m)
  B <- matrix(take(m * m), m, m); G <- matrix(take(m * q), m, q); Psi <- matrix(take(m * m), m, m); Th <- matrix(take(p * p), p, p)
  if (m) { LI <- Lam %*% solve(diag(m) - B); list(mu0 = drop(nu + LI %*% al), Mx = Kx + LI %*% G, S = LI %*% Psi %*% t(LI) + Th) }
  else list(mu0 = nu, Mx = Kx, S = Th)
}

mix_block <- function(M, bk, phi) vapply(seq_len(bk$nc), function(cc) mix_ld(bk, phi[bk$S[cc, ]]), numeric(M$n))

# The log-likelihood; with `grad`, the per-observation scores (n x theta) too.
mix_eval <- function(M, theta, grad = FALSE) {
  phi <- drop(M$b + M$A %*% theta); n <- M$n
  PR <- mix_prior(M, phi, TRUE); P <- PR$lp
  F <- lapply(M$blocks, function(bk) matrix(mix_block(M, bk, phi), n))
  L <- P
  for (i in seq_along(M$blocks)) L <- L + F[[i]][, M$blocks[[i]]$map, drop = FALSE]
  for (vi in seq_along(M$cls)) if (!is.null(M$cls[[vi]]$obs)) { v <- M$cls[[vi]]; bad <- outer(v$obs, M$Z[, vi], `!=`); bad[is.na(bad)] <- FALSE; L[bad] <- -Inf }
  lse <- mix_lse(L); ll <- sum(M$w * lse)
  if (!grad || !is.finite(ll)) return(list(ll = ll, post = exp(L - lse), lse = lse))
  post <- exp(L - lse)
  D <- matrix(0, n, length(phi))
  h <- function(x) 1e-5 * max(1, abs(x))
  # Class model: d log P(z) / d slot = x-term * (indicator of the slot's category in z - its model probability).
  pz <- if (M$loglinear) exp(P) else NULL
  for (vi in seq_along(M$cls)) {
    v <- M$cls[[vi]]; q <- length(v$covariates); npc <- length(v$slots) / (v$k * (1 + q))
    for (pc in seq_len(npc)) {
      inpc <- v$pc == pc
      ppc <- if (!M$loglinear) rowSums(post[, inpc, drop = FALSE]) else NULL
      for (m in seq_len(v$k)) {
        base <- ((pc - 1) * v$k + (m - 1)) * (1 + q)
        sl <- v$slots[base + 1 + 0:q]
        if (!any(sl %in% M$free)) next
        I <- inpc & M$Z[, vi] == m
        if (v$prob) {
          if (m == v$k) next
          pr <- exp(PR$W[[vi]][[pc]][1, ])
          g <- rowSums(post[, I, drop = FALSE]) / pr[m] - rowSums(post[, inpc & M$Z[, vi] == v$k, drop = FALSE]) / pr[v$k]
          D[, sl[1]] <- D[, sl[1]] + g
          next
        }
        g <- rowSums(post[, I, drop = FALSE]) - (if (M$loglinear) rowSums(pz[, I, drop = FALSE]) else exp(PR$W[[vi]][[pc]][, m]) * ppc)
        for (t in which(sl %in% M$free)) D[, sl[t]] <- D[, sl[t]] + g * (if (t == 1) 1 else v$X[, t - 1])
      }
    }
  }
  for (i in seq_along(M$blocks)) {
    bk <- M$blocks[[i]]
    pb <- vapply(seq_len(bk$nc), function(cc) rowSums(post[, bk$map == cc, drop = FALSE]), numeric(n)); pb <- matrix(pb, n)
    full <- bk$type == "mvn" && length(bk$pats) == 1 && length(bk$pats[[1]]$obs) == bk$p
    for (cc in seq_len(bk$nc)) {
      sl <- bk$S[cc, ]
      if (full) {
        # d log f / d slot from the derivatives of the mean and covariance matrix (the slots enter only through them).
        v <- phi[sl]; P <- mix_mvn_parts(bk, v); Si <- tryCatch(chol2inv(chol(P$S)), error = function(e) NULL)
        if (is.null(Si)) next
        Mu <- matrix(P$mu0, n, bk$p, byrow = TRUE); if (length(bk$x)) Mu <- Mu + bk$X %*% t(P$Mx)
        Rr <- (bk$Y - Mu) %*% Si
        for (r in which(sl %in% M$free)) {
          s <- sl[r]; e <- h(v[r]); vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e
          Pp <- mix_mvn_parts(bk, vp); Pm <- mix_mvn_parts(bk, vm)
          dS <- (Pp$S - Pm$S) / (2 * e)
          d <- drop(Rr %*% ((Pp$mu0 - Pm$mu0) / (2 * e))) + 0.5 * (rowSums((Rr %*% dS) * Rr) - sum(Si * dS))
          if (length(bk$x)) d <- d + rowSums((bk$X %*% t((Pp$Mx - Pm$Mx) / (2 * e))) * Rr)
          D[, s] <- D[, s] + pb[, cc] * d
        }
        next
      }
      if (bk$type == "cat" && bk$K == 2) {
        # A binary item: d log P(u) / d threshold = 1 - F (first category) or -F (second), times -x for a slope.
        v <- phi[sl]; q <- length(bk$x); z <- v[1] - (if (q) drop(bk$X %*% v[1 + seq_len(q)]) else 0)
        Fz <- plogis(z); g <- numeric(n); g[bk$idx[[1]]] <- 1 - (if (length(Fz) > 1) Fz[bk$idx[[1]]] else Fz); g[bk$idx[[2]]] <- -(if (length(Fz) > 1) Fz[bk$idx[[2]]] else Fz)
        g <- g * pb[, cc]
        for (r in which(sl %in% M$free)) D[, sl[r]] <- D[, sl[r]] + (if (r == 1) g else -g * bk$X[, r - 1])
        next
      }
      for (r in which(sl %in% M$free)) {
        s <- sl[r]; v <- phi[sl]; e <- h(v[r])
        vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e
        d <- (mix_ld(bk, vp) - mix_ld(bk, vm)) / (2 * e); d[!is.finite(d)] <- 0
        D[, s] <- D[, s] + pb[, cc] * d
      }
    }
  }
  list(ll = ll, post = post, lse = lse, scores = D %*% M$A)
}

# Random starts (`starts` short runs, the `final` best continued), BFGS then Newton steps, on the scale the optimizer
# works on (probabilities as logits).
mix_fit <- function(M, f, g, start, scale, starts = 20, final = 4, seed = 1, given = NULL) {
  run <- function(th, maxit) tryCatch(stats::optim(th, f, g, method = "BFGS", control = list(maxit = maxit, reltol = 1e-14)), error = function(e) NULL)
  set.seed(seed)
  cand <- if (!is.null(given)) list(given) else c(list(start), lapply(seq_len(max(0, starts - 1)), function(r) start + stats::rnorm(length(start)) * scale))
  stage <- lapply(cand, function(th) { o <- if (length(cand) > 1) run(th, 15) else NULL; if (is.null(o)) list(par = th, value = f(th)) else o })
  vals <- vapply(stage, function(o) o$value, 1)
  keep <- order(vals)[seq_len(min(length(stage), max(1, final)))]
  fits <- lapply(keep, function(i) { o <- run(stage[[i]]$par, 5000); if (is.null(o)) stage[[i]] else o })
  lls <- -vapply(fits, function(o) o$value, 1)
  best <- fits[[which.max(lls)]]
  th <- mix_newton(M, best$par, f, g)
  list(theta = th, lls = sort(lls, decreasing = TRUE), converged = isTRUE(best$convergence == 0) || length(fits) == 0)
}

# The optimizer's scale: a row of free probabilities as its logits against the last category.
mix_eta <- function(M) {
  G <- M$groups
  soft <- function(e) { e <- c(e, 0); p <- exp(e - max(e)); p <- p / sum(p); p[-length(p)] }
  list(to_th = function(eta) { for (gr in G) eta[gr] <- soft(eta[gr]); eta },
    to_eta = function(th) { for (gr in G) { p <- pmax(th[gr], 1e-10); th[gr] <- log(p / max(1 - sum(th[gr]), 1e-10)) }; th },
    chain = function(eta, gth) { for (gr in G) { p <- soft(eta[gr]); J <- diag(p, length(p)) - outer(p, p); gth[gr] <- drop(t(J) %*% gth[gr]) }; gth })
}

# Numerical Hessian of the log-likelihood from the score.
# (a probability at 0 or 1: one-sided differences, inside the admissible region)
mix_hessian <- function(M, th, g) {
  k <- length(th); H <- matrix(0, k, k)
  ok <- function(t2) all(vapply(M$groups, function(gr) all(t2[gr] >= 0) && sum(t2[gr]) <= 1, TRUE))
  g0 <- NULL
  for (j in seq_len(k)) {
    e <- 1e-4 * max(1, abs(th[j])); tp <- th; tp[j] <- tp[j] + e; tm <- th; tm[j] <- tm[j] - e
    if (ok(tp) && ok(tm)) H[, j] <- -(g(tp) - g(tm)) / (2 * e)
    else { if (is.null(g0)) g0 <- g(th); H[, j] <- if (ok(tp)) -(g(tp) - g0) / e else -(g0 - g(tm)) / e }
  }
  (H + t(H)) / 2
}

# Newton steps (with step halving) from the BFGS solution, to the precision Mplus's estimates are printed with.
mix_newton <- function(M, th, f, g, steps = 20) {
  if (!length(th)) return(th)
  fv <- f(th)
  for (it in seq_len(steps)) {
    gr <- g(th); if (max(abs(gr)) < 1e-7) break
    H <- mix_hessian(M, th, g)
    d <- tryCatch(solve(-H, gr), error = function(e) NULL)
    if (is.null(d) || any(!is.finite(d))) break
    s <- 1; ok <- FALSE
    while (s > 1e-4) { tn <- th - s * d; fn <- f(tn); if (fn <= fv + 1e-12) { ok <- TRUE; break }; s <- s / 2 }
    if (!ok) break
    th <- tn; fv <- fn
  }
  th
}

# Relabel the classes (`order[[v]][j]`: the fitted class shown as class j of variable v): the same distribution with the
# parameters re-expressed (reference classes, fixed values), refitted from there; NULL when the constraints do not allow it.
mix_reorder <- function(M, th, order, f, g, X) {
  phi <- drop(M$b + M$A %*% th)
  if (is.matrix(order)) order <- lapply(seq_len(nrow(order)), function(i) order[i, ])
  perm <- lapply(seq_along(M$cls), function(v) if (length(order) >= v && length(order[[v]])) as.integer(unlist(order[[v]])) else seq_len(M$ks[v]))
  if (all(vapply(seq_along(perm), function(v) identical(perm[[v]], seq_len(M$ks[v])), TRUE))) return(th)
  Zp <- M$Z; for (v in seq_along(perm)) Zp[, v] <- perm[[v]][M$Z[, v]]
  zidx <- function(Zr) as.integer(1 + colSums(t(Zr - 1) * cumprod(c(1L, M$ks))[seq_along(M$ks)]))
  zmap <- zidx(Zp)
  # Block slots: the slot of configuration c takes the fitted value of the permuted configuration.
  rows <- integer(0); target <- numeric(0)
  for (bk in M$blocks) for (cc in seq_len(bk$nc)) {
    z <- which(bk$map == cc)[1]; c2 <- bk$map[zmap[z]]
    for (r in seq_len(ncol(bk$S))) { rows <- c(rows, bk$S[cc, r]); target <- c(target, phi[bk$S[c2, r]]) }
  }
  ok <- is.finite(target) & is.finite(M$b[rows])
  if (any(is.finite(target) != is.finite(M$b[rows]))) return(NULL)
  Ab <- M$A[rows[ok], , drop = FALSE]; tb <- target[ok] - M$b[rows[ok]]
  P0 <- mix_prior(M, phi)[, zmap, drop = FALSE]; Q <- exp(P0)
  cls_th <- which(colSums(Ab != 0) == 0)
  th1 <- th
  bth <- setdiff(seq_along(th), cls_th)
  if (nrow(Ab) && length(bth)) { sol <- qr.coef(qr(Ab[, bth, drop = FALSE]), tb); th1[bth] <- ifelse(is.na(sol), th[bth], sol) }
  # A factor mean fixed in the reference class: match the implied means and covariances (the intercepts absorb the shift).
  if (length(bth) && any(vapply(M$blocks, function(bk) bk$type == "mvn", TRUE))) {
    implied <- function(ph, to) unlist(lapply(M$blocks, function(bk) lapply(seq_len(bk$nc), function(cc) {
      v <- ph[bk$S[to(bk, cc), ]]; if (bk$type == "mvn") { P <- mix_mvn_parts(bk, v); c(P$mu0, P$Mx, P$S) } else v })))
    tgt <- implied(phi, function(bk, cc) bk$map[zmap[which(bk$map == cc)[1]]]); fin <- is.finite(tgt)
    obj <- function(x) { t2 <- th1; t2[bth] <- x; d <- implied(drop(M$b + M$A %*% t2), function(bk, cc) cc)[fin] - tgt[fin]; v <- sum(d^2); if (is.finite(v)) v else 1e300 }
    th1[bth] <- stats::optim(th1[bth], obj, method = "BFGS", control = list(maxit = 5000, reltol = 1e-16))$par
  }
  e1 <- X$to_eta(th1)
  if (length(cls_th)) {
    ce <- function(x) { e2 <- e1; e2[cls_th] <- x; P <- mix_prior(M, drop(M$b + M$A %*% X$to_th(e2))); v <- -sum(M$w * rowSums(Q * ifelse(Q > 0, P, 0))); if (is.finite(v)) v else 1e300 }
    e1[cls_th] <- stats::optim(e1[cls_th] * 0, ce, method = "BFGS", control = list(maxit = 2000, reltol = 1e-14))$par
  }
  fe <- function(e) f(X$to_th(e)); ge <- function(e) X$chain(e, g(X$to_th(e)))
  o <- stats::optim(e1, fe, ge, method = "BFGS", control = list(maxit = 5000, reltol = 1e-14))
  th2 <- X$to_th(mix_newton(M, o$par, fe, ge))
  if (abs(f(th2) - f(th)) > 1e-4) return(NULL)
  th2
}

# Identical cases (all categorical data) become one row with their count as frequency weight.
mix_collapse <- function(spec, data) {
  key <- do.call(paste, c(lapply(data, function(x) ifelse(is.na(x), "NA", format(x, digits = 15))), sep = "\r"))
  first <- !duplicated(key)
  if (all(first)) return(list(spec = spec, data = data))
  w <- if (is.null(spec$weight)) rep(1, nrow(data)) else data[[spec$weight]]
  out <- data[first, , drop = FALSE]
  out$.count <- as.numeric(tapply(w, factor(key, levels = key[first]), sum))
  spec$weight <- ".count"
  list(spec = spec, data = out)
}

mix_estimate <- function(spec, data) {
  for (m in spec$missing) data[[m$column]][data[[m$column]] %in% unlist(m$values)] <- NA
  cd <- mix_collapse(spec, data); spec <- cd$spec; data <- cd$data
  M <- mix_model(spec, data)
  start <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$start), 1)); scale <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$scale %||% 0), 1))
  f <- function(th) { v <- -mix_eval(M, th)$ll; if (is.finite(v)) v else 1e300 }
  g <- function(th) { e <- mix_eval(M, th, TRUE); if (!is.finite(e$ll)) return(rep(0, length(th))); -colSums(M$w * e$scores) }
  given <- if (length(spec$given)) as.numeric(unlist(spec$given)) else NULL
  X <- mix_eta(M)
  fe <- function(e) f(X$to_th(e)); ge <- function(e) X$chain(e, g(X$to_th(e)))
  fit <- mix_fit(M, fe, ge, X$to_eta(start), scale, as.integer(spec$starts %||% 20), as.integer(spec$final %||% 4), as.integer(spec$seed %||% 1), if (is.null(given)) NULL else X$to_eta(given))
  th <- X$to_th(fit$theta)
  if (length(spec$order)) { r <- mix_reorder(M, th, spec$order, f, g, X); if (is.null(r)) stop("The class order is not allowed by the model's constraints."); th <- r }
  e <- mix_eval(M, th, TRUE)
  k <- length(th)
  H <- mix_hessian(M, th, g)
  Bm <- crossprod(e$scores * sqrt(M$w))
  Hi <- tryCatch(solve(H), error = function(err) NULL)
  V <- if (is.null(Hi)) NULL else Hi %*% Bm %*% Hi
  list(M = M, theta = th, ll = e$ll, post = e$post, V = V, fit = fit, k = k)
}

# What is printed: each row a slot (a linear combination of theta) or a class probability (PROBABILITY parameterization).
mix_report <- function(spec, est) {
  M <- est$M; th <- est$theta
  val <- function(t2) {
    phi <- drop(M$b + M$A %*% t2)
    vapply(spec$report, function(r) {
      if (!is.null(r$slot)) return(phi[r$slot + 1])
      pr <- as.integer(unlist(r$prob)); v <- M$cls[[pr[1] + 1]]; q <- length(v$covariates)
      lw <- vapply(seq_len(v$k), function(m) phi[v$slots[((pr[2]) * v$k + (m - 1)) * (1 + q) + 1]], 1)
      exp(lw[pr[3] + 1] - (max(lw) + log(sum(exp(lw - max(lw))))))
    }, 1)
  }
  est0 <- val(th)
  se <- rep(NA_real_, length(est0))
  if (!is.null(est$V) && length(th)) {
    J <- vapply(seq_along(th), function(j) { e <- 1e-6 * max(1, abs(th[j])); tp <- th; tp[j] <- tp[j] + e; tm <- th; tm[j] <- tm[j] - e; (val(tp) - val(tm)) / (2 * e) }, numeric(length(est0)))
    J <- matrix(J, length(est0))
    se <- sqrt(pmax(0, rowSums((J %*% est$V) * J)))
  }
  fixed <- vapply(spec$report, function(r) isTRUE(r$fixed), TRUE)
  se[fixed] <- 0
  lapply(seq_along(est0), function(i) { r <- spec$report[[i]]; list(lhs = r$lhs, op = r$op, rhs = r$rhs %||% "", at = as.integer(unlist(r$at)), est = est0[i], se = if (is.finite(se[i])) se[i] else NULL, fixed = fixed[i]) })
}

# Shares of each class of each latent variable, and of the joint patterns, from the posterior probabilities.
mix_shares <- function(est) {
  M <- est$M; w <- M$w / sum(M$w); pz <- colSums(est$post * w)
  list(classes = lapply(seq_along(M$cls), function(v) list(name = M$cls[[v]]$name, k = M$ks[v], shares = vapply(seq_len(M$ks[v]), function(j) sum(pz[M$Z[, v] == j]), 1))),
    patterns = lapply(seq_len(M$nz), function(z) list(classes = as.integer(M$Z[z, ]), share = pz[z])),
    entropy = if (M$nz > 1) 1 - sum(-est$post * log(pmax(est$post, 1e-300)) * M$w) / (sum(M$w) * log(M$nz)) else NULL)
}

PS_MIX_FUNCTIONS <- c("mix_collapse", "mix_model", "mix_lse", "mix_prior", "mix_ld", "mix_mvn_parts", "mix_block", "mix_eval", "mix_fit", "mix_eta", "mix_hessian", "mix_newton", "mix_reorder", "mix_estimate", "mix_report", "mix_shares")

ps_mixture <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  spec <- req$spec
  if (is.null(spec) || !length(spec$classes)) stop("No latent class variable in the model.")
  cols <- as.character(unlist(spec$columns))
  fr <- ps_long_frame(req, cols)
  names(fr$data) <- cols
  # Cases with a missing covariate are left out (as Mplus does); a missing outcome adds nothing to that case's likelihood.
  xs <- unique(c(unlist(lapply(spec$classes, function(v) v$covariates)), unlist(lapply(spec$blocks, function(bk) bk$x))))
  keep <- if (length(xs)) stats::complete.cases(fr$data[, xs, drop = FALSE]) else rep(TRUE, nrow(fr$data))
  ys <- unique(unlist(lapply(spec$blocks, function(bk) bk$y)))
  keep <- keep & rowSums(!is.na(fr$data[, ys, drop = FALSE])) > 0
  data <- fr$data[keep, , drop = FALSE]
  starts <- as.integer(spec$starts %||% 20)
  if (starts < 0 || starts > 500) stop("Invalid number of starts.")
  body <- c(unlist(lapply(PS_MIX_FUNCTIONS, function(f) c(sprintf("%s <- %s", f, paste(deparse(get(f)), collapse = "\n")), ""))),
    "spec <- jsonlite::fromJSON(spec_json, simplifyVector = TRUE, simplifyDataFrame = FALSE, simplifyMatrix = FALSE)",
    "est <- mix_estimate(spec, data)",
    "report <- mix_report(spec, est)",
    "shares <- mix_shares(est)")
  spec_json <- as.character(jsonlite::toJSON(spec, auto_unbox = TRUE, digits = NA, null = "null", na = "null"))
  inputs <- list(data = data, spec_json = spec_json)
  if (export) return(paste(ps_script("Mixture model (maximum likelihood, MLR standard errors)", "jsonlite", inputs, body,
    c("c(logLik = est$ll, npar = est$k, BIC = -2 * est$ll + est$k * log(sum(est$M$w)))",
      "do.call(rbind, lapply(report, function(r) data.frame(lhs = r$lhs, op = r$op, rhs = r$rhs, classes = paste(r$at, collapse = \" \"), est = r$est, se = if (is.null(r$se)) NA else r$se)))",
      "shares$classes")), collapse = "\n"))
  env <- ps_run(body, inputs)
  est <- env$est; nobs <- sum(est$M$w); k <- est$k
  if (is.null(est$V)) ps_warning("The information matrix is singular: no standard errors (the model may not be identified).")
  lls <- est$fit$lls
  rep_best <- sum(abs(lls - max(lls)) < 1e-3)
  if (length(lls) > 1 && rep_best < 2) ps_warning(sprintf("The best log-likelihood was reached from only one of the %d final starts: increase the starts to make sure it is the maximum.", length(lls)))
  ps_json(list(n = nobs, rows = nrow(data), logLik = est$ll, npar = k, aic = -2 * est$ll + 2 * k, bic = -2 * est$ll + k * log(nobs),
    params = env$report, classes = env$shares$classes, patterns = env$shares$patterns, entropy = env$shares$entropy,
    lls = lls, converged = est$fit$converged, theta = est$theta,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
