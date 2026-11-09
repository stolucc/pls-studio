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
  # (MODEL CONSTRAINT with non-linear expressions: parameters derived from the free ones, after them in the slots' terms)
  ndv <- length(spec$derived)
  slots <- spec$slots
  ns <- length(slots)
  A <- matrix(0, ns, max(nth + ndv, 1)); b <- numeric(ns)
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
  list(n = n, w = w, A = A, b = b, nth = nth, derived = lapply(spec$derived, function(d) d$expr), cls = cls, ks = ks, Z = Z, nz = nz, blocks = blocks, loglinear = isTRUE(spec$loglinear), groups = groups,
    free = which(rowSums(A != 0) > 0))
}

# A non-linear MODEL CONSTRAINT expression (a tree: num, th = index of a free parameter, op with args), evaluated.
mix_expr <- function(e, th) {
  if (!is.null(e$num)) return(as.numeric(e$num))
  if (!is.null(e$th)) return(th[as.integer(e$th) + 1])
  a <- lapply(e$args, mix_expr, th = th)
  switch(e$op, "+" = a[[1]] + a[[2]], "-" = a[[1]] - a[[2]], "*" = a[[1]] * a[[2]], "/" = a[[1]] / a[[2]], "^" = a[[1]]^a[[2]], neg = -a[[1]],
    exp = exp(a[[1]]), log = log(a[[1]]), sqrt = sqrt(a[[1]]), stop("Unknown operator in MODEL CONSTRAINT."))
}
# The free parameters followed by those derived from them; and its Jacobian.
mix_full <- function(M, theta) if (!length(M$derived)) theta else c(theta, vapply(M$derived, mix_expr, 1, th = theta))
mix_full_jac <- function(M, theta) {
  k <- length(theta); if (!length(M$derived)) return(diag(1, k))
  J <- rbind(diag(1, k), matrix(0, length(M$derived), k))
  for (j in seq_len(k)) { e <- 1e-6 * max(1, abs(theta[j])); tp <- theta; tp[j] <- tp[j] + e; tm <- theta; tm[j] <- tm[j] - e
    J[k + seq_along(M$derived), j] <- (mix_full(M, tp)[-seq_len(k)] - mix_full(M, tm)[-seq_len(k)]) / (2 * e) }
  J
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
mix_fit <- function(M, f, g, start, scale, starts = 20, final = 4, seed = 1, given = NULL, phase = list()) {
  run <- function(th, maxit) tryCatch(stats::optim(th, f, g, method = "BFGS", control = list(maxit = maxit, reltol = 1e-14)), error = function(e) NULL)
  ph <- mix_phase(phase, starts, final)
  if (!is.null(ph$finals)) fits <- ph$finals
  else {
    stage <- ph$stage
    if (is.null(stage)) {
      cand <- mix_candidates(start, scale, starts, seed, given)
      stage <- lapply(ph$idx %||% seq_along(cand), function(i) { th <- cand[[i]]; o <- if (length(cand) > 1) run(th, 15) else NULL; if (is.null(o)) list(i = i, par = th, value = f(th)) else c(list(i = i), o) })
      if (!is.null(ph$idx)) return(list(stage = stage))
    }
    keep <- if (!is.null(ph$cont)) seq_along(stage) else mix_keep(stage, final)
    fits <- lapply(keep, function(i) { o <- run(stage[[i]]$par, 5000); c(list(i = stage[[i]]$i), if (is.null(o)) stage[[i]][c("par", "value")] else o) })
    if (!is.null(ph$cont)) return(list(finals = fits))
  }
  lls <- -vapply(fits, function(o) o$value, 1)
  best <- fits[[which.max(lls)]]
  th <- mix_newton(M, best$par, f, g)
  list(theta = th, lls = sort(lls, decreasing = TRUE), converged = isTRUE(best$convergence == 0) || length(fits) == 0)
}

# The starts: the first from the starting values, the others perturbed at random (one seed for all, drawn in turn, so
# that a start is the same whichever R session runs it).
mix_candidates <- function(start, scale, starts, seed, given = NULL) {
  set.seed(seed)
  if (!is.null(given)) list(given) else c(list(start), lapply(seq_len(max(0, starts - 1)), function(r) start + stats::rnorm(length(start)) * scale))
}

# The phases of the random starts, which the app spreads over its R sessions (each start seeded as in mix_candidates,
# so the result does not depend on the number of sessions): `only` the short runs of those starts; `stage` given,
# continue them (`cont`) to convergence; `finals` given, finish from the best. Without any: all three in turn.
mix_phase <- function(phase, starts, final) {
  sl <- function(x) lapply(x, function(o) list(i = as.integer(o$i), par = as.numeric(unlist(o$par)), value = as.numeric(o$value), convergence = if (is.null(o$convergence)) NULL else as.integer(o$convergence)))
  list(idx = if (length(phase$only)) as.integer(unlist(phase$only)) else NULL, stage = if (length(phase$stage)) sl(phase$stage) else NULL,
    cont = if (isTRUE(phase$cont)) TRUE else NULL, finals = if (length(phase$finals)) sl(phase$finals) else NULL)
}
# The starts continued to convergence: the `final` best short runs (ties in start order).
mix_keep <- function(stage, final) { vals <- vapply(stage, function(o) o$value, 1); order(vals, vapply(stage, function(o) o$i, 1L))[seq_len(min(length(stage), max(1, final)))] }

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
  if (!is.null(spec$lat) || !is.null(spec$cluster) || length(spec$derived)) return(mixq_estimate(spec, data))
  for (m in spec$missing) data[[m$column]][data[[m$column]] %in% unlist(m$values)] <- NA
  cd <- mix_collapse(spec, data); spec <- cd$spec; data <- cd$data
  M <- mix_model(spec, data)
  start <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$start), 1)); scale <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$scale %||% 0), 1))
  f <- function(th) { v <- -mix_eval(M, th)$ll; if (is.finite(v)) v else 1e300 }
  g <- function(th) { e <- mix_eval(M, th, TRUE); if (!is.finite(e$ll)) return(rep(0, length(th))); -colSums(M$w * e$scores) }
  given <- if (length(spec$given)) as.numeric(unlist(spec$given)) else NULL
  X <- mix_eta(M)
  fe <- function(e) f(X$to_th(e)); ge <- function(e) X$chain(e, g(X$to_th(e)))
  fit <- mix_fit(M, fe, ge, X$to_eta(start), scale, as.integer(spec$starts %||% 20), as.integer(spec$final %||% 4), as.integer(spec$seed %||% 1), if (is.null(given)) NULL else X$to_eta(given), spec$phase %||% list())
  if (!is.null(fit$stage) || !is.null(fit$finals)) return(fit)
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
    phi <- drop(M$b + M$A %*% mix_full(M, t2))
    vapply(spec$report, function(r) {
      if (!is.null(r$expr)) return(mix_expr(r$expr, mix_full(M, t2)))
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
  lapply(seq_along(est0), function(i) { r <- spec$report[[i]]; c(list(lhs = r$lhs, op = r$op, rhs = r$rhs %||% "", at = as.integer(unlist(r$at)), est = est0[i], se = if (is.finite(se[i])) se[i] else NULL, fixed = fixed[i]), if (!is.null(r$level)) list(level = r$level)) })
}

# Shares of each class of each latent variable, and of the joint patterns, from the posterior probabilities.
mix_shares <- function(est) {
  M <- est$M; w <- M$w / sum(M$w); pz <- colSums(est$post * w)
  list(classes = lapply(seq_along(M$cls), function(v) list(name = M$cls[[v]]$name, k = M$ks[v], shares = vapply(seq_len(M$ks[v]), function(j) sum(pz[M$Z[, v] == j]), 1))),
    patterns = lapply(seq_len(M$nz), function(z) list(classes = as.integer(M$Z[z, ]), share = pz[z])),
    entropy = if (M$nz > 1) 1 - sum(-est$post * log(pmax(est$post, 1e-300)) * M$w) / (sum(M$w) * log(M$nz)) else NULL)
}


# ---------------------------------------------------------------------------------------------------------------
# Continuous latent variables integrated numerically, and two-level mixtures (Mplus's ALGORITHM = INTEGRATION and
# TYPE = TWOLEVEL MIXTURE). The data are clusters (a cluster per case in a single-level model) of cases. Latent class
# variables are between-level (one class per cluster: zb) or within-level (one per case: zw). Continuous latent
# variables (spec$lat) are integrated numerically at one of two places:
#   between: per cluster, outside the sum over the within classes, distributed by the between classes (factors and
#     random intercepts of a cluster; the within classes' logits and the outcomes load on them), with a shift by the
#     within classes (a between-level mean that differs between within classes);
#   within: per case, inside the sum over its classes, distributed by any classes (factors of a case).
#   L_j = sum_zb P(zb) int phi(b | zb) prod_i sum_zw P(zw | zb, b) f(y_i | zb, zw, b + shift(zw)) db      (between)
#   L_j = sum_zb P(zb) prod_i sum_zw P(zw | zb) int phi(eta | zb, zw) f(y_i | zb, zw, eta) deta           (within)
# Mplus's rules: rectangular (trapezoid) integration with 15 points per dimension, adaptive (the points centred and
# scaled on each cluster's or case's posterior, updated between optimisation rounds), or Gauss-Hermite points, or
# Monte Carlo draws. The log-likelihood's gradient and every cluster's score come from Fisher's identity (the
# posterior expectation of the complete-data score; each term's derivative by differences in its own slots), so
# the MLR sandwich is that of the integrated likelihood.

mixq_rule <- function(rule, points, d, seed = 1) {
  if (d == 0) return(list(U = matrix(0, 1, 0), base = 0, lphi = matrix(0, 1, 0)))
  if (rule == "mc") {
    old <- if (exists(".Random.seed", envir = globalenv())) get(".Random.seed", envir = globalenv()) else NULL
    set.seed(seed + 7919L); U <- matrix(stats::rnorm(points * d), points, d)
    if (!is.null(old)) assign(".Random.seed", old, envir = globalenv())
    return(list(U = U, base = rep(-log(points), points), lphi = stats::dnorm(U, log = TRUE)))
  }
  if (rule == "gh") {
    J <- matrix(0, points, points); for (k in seq_len(points - 1)) J[k, k + 1] <- J[k + 1, k] <- sqrt(k)
    e <- eigen(J, symmetric = TRUE); u <- e$values; w <- e$vectors[1, ]^2
  } else { R0 <- min(5, points / 2); u <- seq(-R0, R0, length.out = points); w <- stats::dnorm(u) }  # (Mplus: over ±5, fewer points over ±points/2)
  w <- w / sum(w)
  U <- as.matrix(expand.grid(rep(list(u), d))); W <- as.matrix(expand.grid(rep(list(w), d)))
  # (log weight of a point and, per dimension, the log standard normal density there: the integrand is divided by it,
  # except along a dimension without variance, whose points then coincide)
  list(U = unname(U), base = rowSums(log(W)), lphi = unname(stats::dnorm(U, log = TRUE)))
}

# Mean (mu0 + Mx x) and covariance of the latent variables from one configuration's slots: eta = alpha + B eta + Gamma x + zeta.
mixq_lat_parts <- function(L, v) {
  d <- L$d; q <- length(L$x); o <- 0
  take <- function(len) { r <- v[o + seq_len(len)]; o <<- o + len; r }
  al <- take(d); B <- matrix(take(d * d), d, d); G <- matrix(take(d * q), d, q); Psi <- matrix(take(d * d), d, d)
  IB <- solve(diag(d) - B)
  list(mu0 = drop(IB %*% al), Mx = IB %*% G, S = IB %*% Psi %*% t(IB))
}

# log N(E; mean rows of Mu, S) for the rows of E (a covariance with zero rows/columns: those coordinates are fixed at their mean).
mixq_ldens <- function(E, Mu, S) {
  d <- ncol(E); free <- which(diag(S) > 0)
  out <- numeric(nrow(E))
  if (length(free) < d) { fx <- setdiff(seq_len(d), free); if (any(abs(E[, fx, drop = FALSE] - Mu[, fx, drop = FALSE]) > 1e-8)) stop("mixq: a latent variable without variance is integrated.") }
  if (!length(free)) return(out)
  R <- tryCatch(chol(S[free, free, drop = FALSE]), error = function(e) NULL); if (is.null(R)) return(rep(-Inf, nrow(E)))
  z <- backsolve(R, t(E[, free, drop = FALSE] - Mu[, free, drop = FALSE]), transpose = TRUE)
  -0.5 * colSums(z^2) - sum(log(diag(R))) - 0.5 * length(free) * log(2 * pi)
}

# One block's log density on data rows `rows`, its linear predictors (means) moved by `off` (a vector, or rows x p for mvn).
mixq_ld <- function(bk, v, rows, off = NULL) {
  q <- length(bk$x); nr <- length(rows)
  X <- if (q) bk$X[rows, , drop = FALSE] else NULL
  lin <- function(at) (if (q) drop(X %*% v[at + seq_len(q)]) else 0) + (if (is.null(off)) 0 else off)
  switch(bk$type,
    cat = {
      K <- bk$K; tau <- v[seq_len(K - 1)]; if (K > 2 && is.unsorted(tau)) return(rep(-Inf, nr))
      e <- rep_len(lin(K - 1), nr); ix <- mixq_catidx(bk, rows); y <- ix$y; out <- numeric(nr)
      a <- ix$a; if (length(a)) out[a] <- stats::plogis(tau[1] - e[a], log.p = TRUE)
      b <- ix$b; if (length(b)) out[b] <- stats::plogis(tau[K - 1] - e[b], lower.tail = FALSE, log.p = TRUE)
      m <- ix$m; if (length(m)) out[m] <- log(pmax(stats::plogis(tau[y[m]] - e[m]) - stats::plogis(tau[y[m] - 1] - e[m]), 1e-300))
      out
    },
    normal = , censored = {
      y <- bk$Y[rows, 1]; mu <- v[1] + lin(1); s2 <- v[q + 2]; if (!is.finite(s2) || s2 <= 0) return(rep(-Inf, nr)); s <- sqrt(s2)
      out <- stats::dnorm(y, mu, s, log = TRUE)
      if (bk$type == "censored") {
        at <- if (identical(bk$side, "above")) y >= bk$cpoint - 1e-9 else y <= bk$cpoint + 1e-9; at[is.na(at)] <- FALSE
        mm <- rep_len(mu, nr)[at]
        out[at] <- stats::pnorm((bk$cpoint - mm) / s, lower.tail = !identical(bk$side, "above"), log.p = TRUE)
      }
      out[is.na(y)] <- 0; out
    },
    count = , zip = , nb = {
      y <- bk$Y[rows, 1]; eta <- v[1] + lin(1); lam <- exp(eta)
      out <- if (bk$type == "nb") { a <- v[q + 2]; if (!is.finite(a) || a <= 0) return(rep(-Inf, nr)); stats::dnbinom(y, size = 1 / a, mu = lam, log = TRUE) } else stats::dpois(y, lam, log = TRUE)
      if (bk$type == "zip") {
        lz <- v[q + 2] + (if (q) drop(X %*% v[q + 2 + seq_len(q)]) else 0)
        out <- ifelse(y == 0, log(stats::plogis(lz) + stats::plogis(lz, lower.tail = FALSE) * exp(-lam)), stats::plogis(lz, lower.tail = FALSE, log.p = TRUE) + out)
      }
      out[is.na(y)] <- 0; out
    },
    nominal = {
      if (!is.null(off)) stop("mixq: a nominal outcome does not load on an integrated latent variable.")
      K <- bk$K; y <- bk$code[rows]
      E <- cbind(vapply(seq_len(K - 1), function(j) rep(v[j], nr) + (if (q) drop(X %*% v[K - 1 + (j - 1) * q + seq_len(q)]) else 0), numeric(nr)), 0)
      E <- matrix(E, nr); lp <- E - mix_lse(E); out <- numeric(nr); ok <- !is.na(y); out[ok] <- lp[cbind(which(ok), y[ok])]; out
    },
    mvn = {
      P <- mix_mvn_parts(bk, v); S <- P$S; p <- bk$p
      Mu <- matrix(P$mu0, nr, p, byrow = TRUE)
      if (q) Mu <- Mu + X %*% t(P$Mx)
      if (!is.null(off)) Mu <- Mu + off
      Y <- bk$Y[rows, , drop = FALSE]; out <- numeric(nr)
      key <- bk$patkey[rows]
      for (k in unique(key)) {
        rr <- which(key == k); ob <- bk$patobs[[k]]; if (!length(ob)) next
        R <- tryCatch(chol(S[ob, ob, drop = FALSE]), error = function(e) NULL); if (is.null(R)) return(rep(-Inf, nr))
        zz <- backsolve(R, t(Y[rr, ob, drop = FALSE] - Mu[rr, ob, drop = FALSE]), transpose = TRUE)
        out[rr] <- -0.5 * colSums(zz^2) - sum(log(diag(R))) - 0.5 * length(ob) * log(2 * pi)
      }
      out
    },
    stop("Unknown block type"))
}

# d log f / d (slot r of the block) on rows `rows` (latent values VV for its loadings), for the slots `fr`: through the
# linear predictor (intercept, slopes, loadings: one difference in the predictor, times the regressor) and, for an
# mvn block, through its mean and covariance matrix; other slots (thresholds, variances) by their own differences.
mixq_dld <- function(bk, v, rows, VV, fr) {
  nr <- length(rows); q <- length(bk$x); out <- matrix(0, nr, length(fr))
  h <- function(x) 1e-5 * max(1, abs(x))
  X <- if (q) bk$X[rows, , drop = FALSE] else NULL
  offOf <- function(vv) if (bk$uses) { lam <- vv[bk$latcols]; if (bk$type == "mvn") VV %*% t(matrix(lam, bk$p)) else drop(VV %*% lam) } else NULL
  if (bk$type == "mvn") {
    if (any(bk$patkey[rows] != bk$patkey[rows[1]]) || length(bk$patobs[[bk$patkey[rows[1]]]]) < bk$p) {
      for (j in seq_along(fr)) { r <- fr[j]; e <- h(v[r]); vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e; out[, j] <- (mixq_ld(bk, vp, rows, offOf(vp)) - mixq_ld(bk, vm, rows, offOf(vm))) / (2 * e) }
      out[!is.finite(out)] <- 0; return(out)
    }
    P <- mix_mvn_parts(bk, v); Si <- tryCatch(chol2inv(chol(P$S)), error = function(e) NULL); if (is.null(Si)) return(out)
    Mu <- matrix(P$mu0, nr, bk$p, byrow = TRUE); if (q) Mu <- Mu + X %*% t(P$Mx); off <- offOf(v); if (!is.null(off)) Mu <- Mu + off
    Rr <- (bk$Y[rows, , drop = FALSE] - Mu) %*% Si
    for (j in seq_along(fr)) {
      r <- fr[j]
      if (r %in% bk$latcols) { k <- match(r, bk$latcols) - 1; out[, j] <- Rr[, k %% bk$p + 1] * VV[, k %/% bk$p + 1]; next }
      e <- h(v[r]); vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e
      Pp <- mix_mvn_parts(bk, vp); Pm <- mix_mvn_parts(bk, vm); dS <- (Pp$S - Pm$S) / (2 * e)
      d <- drop(Rr %*% ((Pp$mu0 - Pm$mu0) / (2 * e)))
      if (any(dS != 0)) d <- d + 0.5 * (rowSums((Rr %*% dS) * Rr) - sum(Si * dS))
      if (q) d <- d + rowSums((X %*% t((Pp$Mx - Pm$Mx) / (2 * e))) * Rr)
      out[, j] <- d
    }
    return(out)
  }
  K <- if (bk$type == "cat") bk$K else 0
  if (K && !all(rows == rep_len(seq_along(bk$code), length(rows)))) K <- K  # (rows are always cases, possibly stacked)
  if (K) {
    # ordered logit: P = F(tau_y - e) - F(tau_{y-1} - e); d log P / d tau_y = f_y / P, / d tau_{y-1} = -f_{y-1} / P, / d e = -(f_y - f_{y-1}) / P
    tau <- v[seq_len(K - 1)]; off <- offOf(v)
    e <- (if (q) drop(X %*% v[K - 1 + seq_len(q)]) else 0) + (if (is.null(off)) 0 else off); e <- rep_len(e, nr)
    ix <- mixq_catidx(bk, rows); y <- ix$y; ok <- !is.na(y); yy <- y; yy[!ok] <- 1L
    up <- c(tau, Inf)[yy] - e; lo <- c(-Inf, tau)[yy] - e
    Fu <- stats::plogis(up); Fl <- stats::plogis(lo); fu <- Fu * (1 - Fu); fl <- Fl * (1 - Fl)
    P <- pmax(Fu - Fl, 1e-300)
    gu <- fu / P * ok; gl <- fl / P * ok; ge <- gl - gu
    for (j in seq_along(fr)) {
      r <- fr[j]
      out[, j] <- if (r <= K - 1) (yy == r) * gu - (yy == r + 1) * gl
        else if (r %in% bk$latcols) ge * VV[, match(r, bk$latcols)] else ge * X[, r - (K - 1)]
    }
    out[!is.finite(out)] <- 0
    return(out)
  }
  # positions entering through the linear predictor, with their regressors
  lin <- if (bk$type == "cat") c(K - 1 + seq_len(q), bk$latcols) else if (bk$type == "nominal") integer(0) else c(1, 1 + seq_len(q), bk$latcols)
  reg <- function(r) if (r %in% bk$latcols) VV[, match(r, bk$latcols)] else if (bk$type == "cat") X[, r - (K - 1)] else if (r == 1) 1 else X[, r - 1]
  off0 <- offOf(v); if (is.null(off0)) off0 <- 0
  ge <- NULL
  for (j in seq_along(fr)) {
    r <- fr[j]
    if (r %in% lin) {
      if (is.null(ge)) { e <- 1e-5; ge <- (mixq_ld(bk, v, rows, off0 + e) - mixq_ld(bk, v, rows, off0 - e)) / (2 * e); ge[!is.finite(ge)] <- 0 }
      out[, j] <- ge * reg(r)
    } else {
      e <- h(v[r]); vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e
      out[, j] <- (mixq_ld(bk, vp, rows, offOf(vp)) - mixq_ld(bk, vm, rows, offOf(vm))) / (2 * e)
    }
  }
  out[!is.finite(out)] <- 0
  out
}

# d log N(VV; mu, S) / d (latent slot r), through the mean and covariance matrix.
mixq_dlat <- function(L, v, VV, Xr, fr) {
  d <- L$d; P <- mixq_lat_parts(L, v); out <- matrix(0, nrow(VV), length(fr))
  free <- which(diag(P$S) > 0); if (!length(free)) return(out)
  Si <- matrix(0, d, d); Si[free, free] <- tryCatch(chol2inv(chol(P$S[free, free, drop = FALSE])), error = function(e) matrix(0, length(free), length(free)))
  Mu <- matrix(P$mu0, nrow(VV), d, byrow = TRUE); if (!is.null(Xr)) Mu <- Mu + Xr %*% t(P$Mx)
  Rr <- (VV - Mu) %*% Si
  for (j in seq_along(fr)) {
    r <- fr[j]; e <- 1e-5 * max(1, abs(v[r])); vp <- v; vp[r] <- vp[r] + e; vm <- v; vm[r] <- vm[r] - e
    Pp <- mixq_lat_parts(L, vp); Pm <- mixq_lat_parts(L, vm); dS <- (Pp$S - Pm$S) / (2 * e)
    g <- drop(Rr %*% ((Pp$mu0 - Pm$mu0) / (2 * e)))
    if (any(dS != 0)) g <- g + 0.5 * (rowSums((Rr %*% dS) * Rr) - sum(Si * dS))
    if (!is.null(Xr)) g <- g + rowSums((Xr %*% t((Pp$Mx - Pm$Mx) / (2 * e))) * Rr)
    out[, j] <- g
  }
  out
}

# A categorical block's categories on rows `rows`: cached for the stacked rows of the integration points.
mixq_catidx <- function(bk, rows) {
  key <- as.character(length(rows))
  if (!is.null(bk$cidx[[key]]) && length(rows) %% length(bk$code) == 0 && length(rows) >= length(bk$code)) return(bk$cidx[[key]])
  y <- bk$code[rows]; list(y = y, a = which(y == 1), b = which(y == bk$K), m = which(y > 1 & y < bk$K))
}

mixq_model <- function(spec, data) {
  M <- mix_model(spec, data)
  n <- M$n
  M$cl <- if (!is.null(spec$cluster)) match(data[[spec$cluster]], unique(data[[spec$cluster]])) else seq_len(n)
  M$J <- max(M$cl); M$first <- match(seq_len(M$J), M$cl)
  L <- spec$lat
  if (!is.null(L)) {
    L$d <- as.integer(L$d); L$x <- as.character(unlist(L$x)); L$by <- as.integer(unlist(L$by)) + 1L
    L$X <- if (length(L$x)) as.matrix(data[, L$x, drop = FALSE]) else NULL
    L$map <- (function(idx) { if (!length(idx)) return(rep(1L, M$nz)); m <- cumprod(c(1L, M$ks[idx]))[seq_along(idx)]; as.integer(1 + colSums(t(M$Z[, idx, drop = FALSE] - 1) * m)) })(L$by)
    L$nc <- if (length(L$by)) prod(M$ks[L$by]) else 1L
    L$S <- matrix(as.integer(unlist(L$slots)) + 1L, nrow = L$nc, byrow = TRUE)
    L$shiftBy <- as.integer(unlist(L$shiftBy)) + 1L
    if (length(unlist(L$shiftSlots))) {
      L$shiftMap <- (function(idx) { if (!length(idx)) return(rep(1L, M$nz)); m <- cumprod(c(1L, M$ks[idx]))[seq_along(idx)]; as.integer(1 + colSums(t(M$Z[, idx, drop = FALSE] - 1) * m)) })(L$shiftBy)
      L$shiftS <- matrix(as.integer(unlist(L$shiftSlots)) + 1L, ncol = L$d, byrow = TRUE)
    }
    L$between <- identical(L$level, "between")
    rl <- mixq_rule(L$rule %||% "rect", as.integer(L$points %||% 15), L$d, as.integer(spec$seed %||% 1))
    L$U <- rl$U; L$base <- rl$base; L$lphi <- rl$lphi; L$Q <- nrow(rl$U)
    # (a product rule: each point's index along each dimension, for the marginal weights)
    L$dimIdx <- if ((L$rule %||% "rect") == "mc" || L$d < 2) NULL else lapply(seq_len(L$d), function(k) match(rl$U[, k], sort(unique(rl$U[, k]))))
    M$lat <- L
  }
  d <- if (is.null(M$lat)) 0L else M$lat$d
  lev <- vapply(spec$classes, function(v) if (identical(v$level, "b")) "b" else "w", "")
  M$bvars <- which(lev == "b"); M$wvars <- which(lev == "w")
  for (i in seq_along(M$cls)) M$cls[[i]]$nl <- as.integer(spec$classes[[i]]$nl %||% 0)
  M$zb <- (function(idx) { if (!length(idx)) return(rep(1L, M$nz)); m <- cumprod(c(1L, M$ks[idx]))[seq_along(idx)]; as.integer(1 + colSums(t(M$Z[, idx, drop = FALSE] - 1) * m)) })(M$bvars)
  M$nzb <- max(M$zb)
  for (k in seq_along(M$blocks)) {
    bk <- M$blocks[[k]]; bk$nl <- as.integer(spec$blocks[[k]]$nl %||% 0); bk$clev <- identical(spec$blocks[[k]]$level, "b")
    if (bk$type == "mvn") {
      pat <- is.na(bk$Y); key <- apply(pat, 1, function(r) paste(which(r), collapse = ","))
      u <- unique(key); bk$patkey <- match(key, u); bk$patobs <- lapply(u, function(k2) which(!pat[match(k2, key), ]))
    }
    if (bk$type == "nominal" || bk$type == "cat") bk$code <- match(bk$Y[, 1], as.numeric(unlist(spec$blocks[[k]]$levels)))
    if (bk$type == "cat") { Qn <- if (is.null(M$lat)) 1L else M$lat$Q; bk$cidx <- list(); for (qq in unique(c(1L, Qn))) { y <- rep(bk$code, qq); bk$cidx[[as.character(n * qq)]] <- list(y = y, a = which(y == 1), b = which(y == bk$K), m = which(y > 1 & y < bk$K)) } }
    # (uses the integrated latent variables: some loading slot not fixed at 0)
    nb <- ncol(bk$S); lat_sl <- if (bk$nl) bk$S[, nb - bk$nl + seq_len(bk$nl), drop = FALSE] else matrix(0L, bk$nc, 0)
    bk$latcols <- if (bk$nl) nb - bk$nl + seq_len(bk$nl) else integer(0)
    bk$uses <- bk$nl > 0 && any(M$A[lat_sl, , drop = FALSE] != 0 | (is.finite(M$b[lat_sl]) & M$b[lat_sl] != 0))
    # the configurations it is evaluated in: its own classes and, using a shifted latent variable, the shift's
    key <- bk$map
    if (bk$uses && !is.null(M$lat$shiftMap)) key <- (bk$map - 1L) * max(M$lat$shiftMap) + M$lat$shiftMap
    bk$key <- match(key, unique(key)); bk$keyz <- match(unique(key), key)
    M$blocks[[k]] <- bk
  }
  M$d <- d
  M
}

# The class model on rows `rows` (latent values Bn, rows x d, for the logits that load on them): per variable the
# log-probabilities W[[pc]] (rows x k) and the joint log P for the between and the within variables (rows x nz).
mixq_prior <- function(M, phi, rows, Bn = NULL, vars = seq_along(M$cls)) {
  nr <- length(rows); out <- list(b = matrix(0, nr, M$nz), w = matrix(0, nr, M$nz), W = list())
  for (vi in vars) {
    v <- M$cls[[vi]]; q <- length(v$covariates); nl <- v$nl; per <- 1 + q + nl; npc <- length(v$slots) / (v$k * per)
    W <- lapply(seq_len(npc), function(pc) {
      E <- vapply(seq_len(v$k), function(m) {
        base <- ((pc - 1) * v$k + (m - 1)) * per
        e <- rep(phi[v$slots[base + 1]], nr)
        if (q) e <- e + drop(v$X[rows, , drop = FALSE] %*% phi[v$slots[base + 1 + seq_len(q)]])
        if (nl) e <- e + drop(Bn %*% phi[v$slots[base + 1 + q + seq_len(nl)]])
        e
      }, numeric(nr))
      E <- matrix(E, nr); E[!is.finite(E)] <- -Inf
      E - mix_lse(E)
    })
    out$W[[vi]] <- W
    to <- if (vi %in% M$bvars) "b" else "w"
    for (z in seq_len(M$nz)) out[[to]][, z] <- out[[to]][, z] + W[[v$pc[z]]][, M$Z[z, vi]]
  }
  for (vi in seq_along(M$cls)) if (!is.null(M$cls[[vi]]$obs)) {
    v <- M$cls[[vi]]; bad <- outer(v$obs[rows], M$Z[, vi], `!=`); bad[is.na(bad)] <- FALSE
    if (vi %in% M$bvars) out$b[bad] <- -Inf else out$w[bad] <- -Inf
  }
  out
}

# The integration points of some case (in a class it is likely to be in) have collapsed onto one or two points: the
# latent distribution has moved away from them, and the sum no longer approximates the integral. (The optimizer would
# otherwise exploit it.)
mixq_collapsed <- function(E, Hz) { w <- exp(Hz - mix_lse(Hz)); any(w > 0.05 & E < 2.5) }

# The smallest effective number of points (1 / sum of squared weights) of each row's weights, jointly and along each
# dimension (marginal over the others). Points adapted to a unit's posterior have about 5 along a dimension (15
# rectangular points); far fewer means the latent distribution has moved away from them.
mixq_ess <- function(W, dimIdx) {
  W <- W / rowSums(W); r <- 1 / rowSums(W^2)
  for (ix in dimIdx) { Wk <- t(rowsum(t(W), ix, reorder = TRUE)); r <- pmin(r, 1 / rowSums(Wk^2)) }
  r
}
mixq_rowmax <- function(m) { r <- m[, 1]; for (j in seq_len(ncol(m))[-1]) r <- pmax(r, m[, j]); r }
# log of the sum of exp over a list of equal matrices (elementwise)
mix_lse_list <- function(Ls) { m <- Ls[[1]]; for (x in Ls[-1]) m <- pmax(m, x); m[!is.finite(m)] <- 0; s <- 0; for (x in Ls) s <- s + exp(x - m); m + log(s) }

mixq_lse_groups <- function(L, g) { ng <- max(g); vapply(seq_len(ng), function(k) mix_lse(L[, g == k, drop = FALSE]), numeric(nrow(L))) }

# The latent values at the integration points of one class configuration: per unit (cluster or case) a centre m and
# a Cholesky factor C (adaptive; the posterior given that configuration). Stacked rows: unit fastest.
mixq_nodes <- function(M, m, C) {
  L <- M$lat; Q <- L$Q; nu <- nrow(m); d <- L$d
  V <- matrix(0, nu * Q, d); lw <- numeric(nu * Q)
  dg <- C[, (seq_len(d) - 1) * d + seq_len(d), drop = FALSE]
  ldet <- rowSums(log(pmax(abs(dg), 1e-300)) * (dg != 0))
  for (qq in seq_len(Q)) {
    s <- (qq - 1) * nu + seq_len(nu)
    for (a in seq_len(d)) { x <- m[, a]; for (b in seq_len(d)) x <- x + C[, (b - 1) * d + a] * L$U[qq, b]; V[s, a] <- x }
    lw[s] <- L$base[qq] - drop((dg != 0) %*% L$lphi[qq, ]) + ldet
  }
  list(V = V, lw = lw)
}

# The configurations the integration points are adapted to: between, each between class pattern; within, each joint class.
mixq_aof <- function(M) if (M$d && M$lat$between) M$zb else seq_len(M$nz)

# The log-likelihood of every cluster at theta for the integration points A, with what the gradient needs.
mixq_core <- function(M, phi, A) {
  n <- M$n; J <- M$J; cl <- M$cl; nz <- M$nz; L <- M$lat; d <- M$d
  between <- d > 0 && L$between; within <- d > 0 && !L$between
  Q <- if (d) L$Q else 1L
  rows <- rep(seq_len(n), Q)
  aof <- mixq_aof(M); na <- max(aof)
  nd <- Vs <- lws <- NULL
  if (d) {
    nd <- lapply(seq_len(na), function(a) mixq_nodes(M, A$m[[a]], A$C[[a]]))
    idx <- if (between) rep(cl, Q) + rep((seq_len(Q) - 1) * J, each = n) else seq_len(n * Q)
    Vs <- lapply(nd, function(x) x$V[idx, , drop = FALSE]); lws <- lapply(nd, function(x) x$lw[idx])
  }
  Pb <- mixq_prior(M, phi, M$first, NULL, M$bvars)$b
  # (outcomes measured once per cluster: with the between classes)
  for (bk in M$blocks) if (bk$clev) for (kk in seq_along(bk$keyz)) { z0 <- bk$keyz[kk]; f <- mixq_ld(bk, phi[bk$S[bk$map[z0], ]], M$first); zs <- which(bk$key == kk); Pb[, zs] <- Pb[, zs] + f }
  wl <- any(vapply(M$wvars, function(v) M$cls[[v]]$nl > 0, TRUE))
  if (wl) { Pw <- matrix(0, n * Q, nz); for (a in seq_len(na)) { za <- which(aof == a); Pw[, za] <- mixq_prior(M, phi, rows, Vs[[a]], M$wvars)$w[, za, drop = FALSE] } }
  else { p0 <- mixq_prior(M, phi, seq_len(n), NULL, M$wvars)$w; Pw <- p0[rows, , drop = FALSE] }
  # blocks: per stacked row and joint class
  Fz <- matrix(0, n * Q, nz)
  for (bk in M$blocks) {
    if (bk$clev) next
    for (kk in seq_along(bk$keyz)) {
      z0 <- bk$keyz[kk]; v <- phi[bk$S[bk$map[z0], ]]; zs <- which(bk$key == kk)
      if (bk$uses) {
        lam <- v[bk$latcols]
        for (a in unique(aof[zs])) {
          za <- zs[aof[zs] == a]; Vz <- Vs[[a]]
          if (!is.null(L$shiftMap)) Vz <- sweep(Vz, 2, phi[L$shiftS[L$shiftMap[za[1]], ]], `+`)
          off <- if (bk$type == "mvn") Vz %*% t(matrix(lam, bk$p)) else drop(Vz %*% lam)
          Fz[, za] <- Fz[, za] + mixq_ld(bk, v, rows, off)
        }
      } else Fz[, zs] <- Fz[, zs] + mixq_ld(bk, v, seq_len(n))[rows]
    }
  }
  if (within) {
    # latent density of each case's points, per joint class; integrated per case
    Lw <- Fz
    for (z in seq_len(nz)) {
      P <- mixq_lat_parts(L, phi[L$S[L$map[z], ]])
      Mu <- matrix(P$mu0, n * Q, d, byrow = TRUE); if (length(L$x)) Mu <- Mu + L$X[rows, , drop = FALSE] %*% t(P$Mx)
      Lw[, z] <- Lw[, z] + mixq_ldens(Vs[[z]], Mu, P$S) + lws[[z]]
    }
    H <- matrix(vapply(seq_len(nz), function(z) mix_lse(matrix(Lw[, z], n, Q)), numeric(n)), n)
    Hz <- H + Pw[seq_len(n), , drop = FALSE]
    if (Q > 1 && !isTRUE(M$nocheck) && L$rule != "mc" && mixq_collapsed(matrix(vapply(seq_len(nz), function(z) mixq_ess(exp(matrix(Lw[, z], n, Q) - H[, z]), L$dimIdx), numeric(n)), n), Hz)) stop("mixq: the integration points no longer cover the latent distribution")
    G <- matrix(mixq_lse_groups(Hz, M$zb), n)
    S <- rowsum(G, cl, reorder = TRUE)
    T <- Pb[, match(seq_len(M$nzb), M$zb), drop = FALSE] + S
    ll <- mix_lse(T)
    return(list(ll = ll, T = T, G = G, Hz = Hz, H = H, Lw = Lw, Pw = Pw, rows = rows, Vs = Vs, Q = Q, nd = nd))
  }
  Lw <- Pw + Fz
  # between (or no latent variables): within classes summed per case and point, cases multiplied per cluster
  G <- matrix(0, n * Q, M$nzb)
  for (zb in seq_len(M$nzb)) G[, zb] <- mix_lse(Lw[, M$zb == zb, drop = FALSE])
  T <- array(0, c(J, M$nzb, Q)); Pb <- Pb[, match(seq_len(M$nzb), M$zb), drop = FALSE]
  for (qq in seq_len(Q)) {
    s <- (qq - 1) * n + seq_len(n)
    T[, , qq] <- rowsum(G[s, , drop = FALSE], cl, reorder = TRUE) + Pb
  }
  if (between) {
    for (zb in seq_len(M$nzb)) {
      z <- which(M$zb == zb)[1]; P <- mixq_lat_parts(L, phi[L$S[L$map[z], ]])
      Mu <- matrix(P$mu0, J * Q, d, byrow = TRUE); if (length(L$x)) Mu <- Mu + L$X[rep(M$first, Q), , drop = FALSE] %*% t(P$Mx)
      T[, zb, ] <- T[, zb, ] + matrix(mixq_ldens(nd[[zb]]$V, Mu, P$S) + nd[[zb]]$lw, J, Q)
    }
  }
  ll <- mix_lse(matrix(T, J))
  if (between && Q > 1 && !isTRUE(M$nocheck)) for (zb in seq_len(M$nzb)) {
    Tz <- matrix(T[, zb, ], J, Q); pz <- exp(mix_lse(Tz) - ll); Wq <- exp(Tz - mix_lse(Tz))
    if (L$rule != "mc" && any(pz > 0.05 & mixq_ess(Wq, L$dimIdx) < 2.5)) stop("mixq: the integration points no longer cover the latent distribution")
  }
  list(ll = ll, T = T, G = G, Lw = Lw, Pw = Pw, rows = rows, Vs = Vs, Q = Q, nd = nd)
}

# Posterior weights: of each cluster's (between class, point) and of each stacked row's joint classes.
mixq_post <- function(M, C) {
  n <- M$n; J <- M$J; Q <- C$Q; cl <- M$cl; nz <- M$nz
  if (M$d && !M$lat$between) {
    pB <- exp(C$T - C$ll)                                   # J x nzb
    pz <- exp(C$Hz - C$G[, M$zb, drop = FALSE]) * pB[cl, M$zb, drop = FALSE]  # n x nz
    pr <- matrix(0, n * Q, nz)
    for (z in seq_len(nz)) pr[, z] <- exp(C$Lw[, z] - rep(C$H[, z], Q)) * rep(pz[, z], Q)
    return(list(pB = pB, pz = pz, pr = pr))
  }
  Tm <- matrix(C$T, J); pBq <- array(exp(Tm - C$ll), c(J, M$nzb, Q))
  pr <- matrix(0, n * Q, nz)
  for (qq in seq_len(Q)) {
    s <- (qq - 1) * n + seq_len(n)
    pr[s, ] <- exp(C$Lw[s, , drop = FALSE] - C$G[s, M$zb, drop = FALSE]) * pBq[cl, M$zb, qq]
  }
  list(pB = rowSums(pBq, dims = 2), pBq = pBq, pr = pr)
}

# Per cluster log-likelihood and (grad) scores (clusters x theta).
mixq_eval <- function(M, theta, A, grad = FALSE, C = NULL) {
  phi <- drop(M$b + M$A %*% mix_full(M, theta))
  if (is.null(C)) C <- tryCatch(mixq_core(M, phi, A), error = function(e) NULL)
  if (is.null(C) || !all(is.finite(C$ll))) return(list(ll = -Inf))
  w <- M$wc
  if (!grad) return(list(ll = sum(w * C$ll), llc = C$ll, C = C))
  P <- mixq_post(M, C)
  n <- M$n; J <- M$J; Q <- C$Q; cl <- M$cl; rows <- C$rows; d <- M$d; L <- M$lat
  between <- d > 0 && L$between
  aof <- mixq_aof(M)
  sc <- rep(cl, Q)              # stacked row -> cluster
  D <- matrix(0, J, length(phi))
  h <- function(x) 1e-5 * max(1, abs(x))
  # class model
  for (vi in seq_along(M$cls)) {
    v <- M$cls[[vi]]; q <- length(v$covariates); nl <- v$nl; per <- 1 + q + nl; npc <- length(v$slots) / (v$k * per)
    isb <- vi %in% M$bvars
    parts <- if (isb) list(list(rr = M$first, Wt = P$pB[, M$zb, drop = FALSE], Bn = NULL, tocl = seq_len(J), zs = seq_len(M$nz)))
      else if (nl > 0) lapply(unique(aof), function(a) list(rr = rows, Wt = P$pr, Bn = C$Vs[[a]], tocl = sc, zs = which(aof == a)))
      else list(list(rr = seq_len(n), Wt = if (!is.null(P$pz)) P$pz else rowsum(P$pr, rep(seq_len(n), Q), reorder = TRUE), Bn = NULL, tocl = cl, zs = seq_len(M$nz)))
    for (pt in parts) {
      Wt <- pt$Wt; Wt[, -pt$zs] <- 0
      Wv <- mixq_prior(M, phi, pt$rr, pt$Bn, vi)$W[[vi]]
      for (pc in seq_len(npc)) {
        inpc <- v$pc == pc; ppc <- rowSums(Wt[, inpc, drop = FALSE])
        for (m in seq_len(v$k)) {
          base <- ((pc - 1) * v$k + (m - 1)) * per; sl <- v$slots[base + seq_len(per)]
          if (!any(sl %in% M$free)) next
          g <- rowSums(Wt[, inpc & M$Z[, vi] == m, drop = FALSE]) - exp(Wv[[pc]][, m]) * ppc
          for (t in which(sl %in% M$free)) {
            x <- if (t == 1) 1 else if (t <= 1 + q) v$X[pt$rr, t - 1] else pt$Bn[, t - 1 - q]
            D[, sl[t]] <- D[, sl[t]] + rowsum(g * x, pt$tocl, reorder = TRUE)[, 1]
          }
        }
      }
    }
  }
  # blocks
  for (bk in M$blocks) {
    if (bk$clev) {
      for (kk in seq_along(bk$keyz)) {
        z0 <- bk$keyz[kk]; sl <- bk$S[bk$map[z0], ]; zs <- which(bk$key == kk); fr <- which(sl %in% M$free); if (!length(fr)) next
        wt <- rowSums(P$pB[, unique(M$zb[zs]), drop = FALSE]); dd <- mixq_dld(bk, phi[sl], M$first, NULL, fr)
        for (j in seq_along(fr)) D[, sl[fr[j]]] <- D[, sl[fr[j]]] + wt * dd[, j]
      }
      next
    }
    for (kk in seq_along(bk$keyz)) {
      z0 <- bk$keyz[kk]; sl <- bk$S[bk$map[z0], ]; zs <- which(bk$key == kk)
      fr <- which(sl %in% M$free)
      shs <- if (bk$uses && !is.null(L$shiftMap)) L$shiftS[L$shiftMap[z0], ] else NULL
      if (!length(fr) && is.null(shs)) next
      v <- phi[sl]
      if (!bk$uses) {
        wt <- rowsum(rowSums(P$pr[, zs, drop = FALSE]), rep(seq_len(n), Q), reorder = TRUE)[, 1]
        if (length(fr)) { dd <- mixq_dld(bk, v, seq_len(n), NULL, fr); G <- rowsum(wt * dd, cl, reorder = TRUE); for (j in seq_along(fr)) D[, sl[fr[j]]] <- D[, sl[fr[j]]] + G[, j] }
        next
      }
      for (a in unique(aof[zs])) {
        za <- zs[aof[zs] == a]; wt <- rowSums(P$pr[, za, drop = FALSE])
        Vz <- C$Vs[[a]]; if (!is.null(shs)) Vz <- sweep(Vz, 2, phi[shs], `+`)
        if (length(fr)) { dd <- mixq_dld(bk, v, rows, Vz, fr); G <- rowsum(wt * dd, sc, reorder = TRUE); for (j in seq_along(fr)) D[, sl[fr[j]]] <- D[, sl[fr[j]]] + G[, j] }
        if (!is.null(shs)) {
          # (a shift moves the latent values the block loads on)
          lam <- v[bk$latcols]
          if (bk$type == "mvn") {
            for (r in seq_along(shs)) { s <- shs[r]; if (!(s %in% M$free)) next; e <- h(phi[s]); Vp <- Vz; Vp[, r] <- Vp[, r] + e; Vm <- Vz; Vm[, r] <- Vm[, r] - e
              dd <- (mixq_ld(bk, v, rows, Vp %*% t(matrix(lam, bk$p))) - mixq_ld(bk, v, rows, Vm %*% t(matrix(lam, bk$p)))) / (2 * e); dd[!is.finite(dd)] <- 0
              D[, s] <- D[, s] + rowsum(wt * dd, sc, reorder = TRUE)[, 1] }
          } else {
            off0 <- drop(Vz %*% lam); e <- 1e-5
            ge <- (mixq_ld(bk, v, rows, off0 + e) - mixq_ld(bk, v, rows, off0 - e)) / (2 * e); ge[!is.finite(ge)] <- 0
            for (r in seq_along(shs)) { s <- shs[r]; if (s %in% M$free && lam[r] != 0) D[, s] <- D[, s] + rowsum(wt * ge * lam[r], sc, reorder = TRUE)[, 1] }
          }
        }
      }
    }
  }
  # latent density
  if (d) {
    for (cc in seq_len(L$nc)) {
      sl <- L$S[cc, ]; fr <- which(sl %in% M$free); if (!length(fr)) next
      v <- phi[sl]
      if (between) {
        for (zb in unique(M$zb[L$map == cc])) {
          wt <- as.vector(P$pBq[, zb, ]); Xr <- if (length(L$x)) L$X[rep(M$first, Q), , drop = FALSE] else NULL
          dd <- mixq_dlat(L, v, C$nd[[zb]]$V, Xr, fr); G <- rowsum(wt * dd, rep(seq_len(J), Q), reorder = TRUE)
          for (j in seq_along(fr)) D[, sl[fr[j]]] <- D[, sl[fr[j]]] + G[, j]
        }
      } else {
        Xr <- if (length(L$x)) L$X[rows, , drop = FALSE] else NULL
        for (z in which(L$map == cc)) {
          dd <- mixq_dlat(L, v, C$Vs[[z]], Xr, fr); G <- rowsum(P$pr[, z] * dd, sc, reorder = TRUE)
          for (j in seq_along(fr)) D[, sl[fr[j]]] <- D[, sl[fr[j]]] + G[, j]
        }
      }
    }
  }
  list(ll = sum(w * C$ll), llc = C$ll, C = C, P = P, scores = D %*% M$A %*% mix_full_jac(M, theta))
}

# Adaptive integration points: per configuration, each unit's prior (init) or posterior mean and the Cholesky factor of
# the covariance.
mixq_adapt_init <- function(M, theta, only = NULL) {
  L <- M$lat; if (is.null(L)) return(NULL)
  phi <- drop(M$b + M$A %*% mix_full(M, theta))
  aof <- mixq_aof(M); nu <- if (L$between) M$J else M$n
  rr <- if (L$between) M$first else seq_len(M$n)
  out <- list(m = list(), C = list())
  for (a in seq_len(max(aof))) {
    P <- mixq_lat_parts(L, phi[L$S[L$map[which(aof == a)[1]], ]])
    m <- matrix(P$mu0, nu, L$d, byrow = TRUE); if (length(L$x)) m <- m + L$X[rr, , drop = FALSE] %*% t(P$Mx)
    S <- P$S; dg <- diag(S); S2 <- S; diag(S2) <- pmax(dg, 1e-8)
    Cc <- tryCatch(t(chol(S2)), error = function(e) diag(sqrt(pmax(dg, 1e-8)), L$d))
    Cc[, dg <= 0] <- 0
    out$m[[a]] <- m; out$C[[a]] <- matrix(as.vector(Cc), nu, L$d * L$d, byrow = TRUE)
  }
  out
}

mixq_adapt <- function(M, theta, A, times = 2) {
  if (is.null(A)) return(A)
  M$nocheck <- TRUE
  L <- M$lat; d <- L$d; Q <- L$Q; aof <- mixq_aof(M)
  for (it in seq_len(times)) {
    e <- mixq_eval(M, theta, A, FALSE); if (!is.finite(e$ll)) return(A)
    C <- e$C
    for (a in seq_len(max(aof))) {
      nu <- nrow(A$m[[a]])
      # (the posterior over the points given the configuration)
      W <- if (L$between) { Tz <- matrix(C$T[, a, ], M$J, Q); exp(Tz - mix_lse(Tz)) } else exp(matrix(C$Lw[, a], M$n, Q) - C$H[, a])
      W <- W / rowSums(W); W[!is.finite(W)] <- 1 / Q
      ess <- 1 / rowSums(W^2)
      V <- C$nd[[a]]$V; Ca <- A$C[[a]]
      m <- matrix(0, nu, d); for (qq in seq_len(Q)) m <- m + W[, qq] * V[(qq - 1) * nu + seq_len(nu), , drop = FALSE]
      Cn <- matrix(0, nu, d * d)
      for (qq in seq_len(Q)) { D0 <- V[(qq - 1) * nu + seq_len(nu), , drop = FALSE] - m; for (i in seq_len(d)) for (j in seq_len(d)) Cn[, (j - 1) * d + i] <- Cn[, (j - 1) * d + i] + W[, qq] * D0[, i] * D0[, j] }
      # (a dimension whose posterior falls between the points: its scale drawn in, uncorrelated meanwhile)
      for (k in seq_along(L$dimIdx)) {
        Wk <- t(rowsum(t(W), L$dimIdx[[k]], reorder = TRUE)); ek <- 1 / rowSums(Wk^2); low <- ek < 3
        if (any(low)) { sk <- abs(Ca[low, (k - 1) * d + k]) * 0.3; for (j in seq_len(d)) { Cn[low, (j - 1) * d + k] <- 0; Cn[low, (k - 1) * d + j] <- 0 }; Cn[low, (k - 1) * d + k] <- sk^2 }
      }
      newC <- if (d == 1) matrix(ifelse(Ca[, 1] == 0, 0, sqrt(pmax(Cn[, 1], 1e-12))), nu, 1)
        else if (d == 2 && all(Ca[, 1] != 0 & Ca[, 4] != 0)) {
          l11 <- sqrt(pmax(Cn[, 1], 1e-12)); l21 <- Cn[, 2] / l11; l22 <- sqrt(pmax(Cn[, 4] - l21^2, 1e-12 * pmax(Cn[, 4], 1e-12)))
          cbind(l11, l21, 0, l22)
        } else t(vapply(seq_len(nu), function(u) {
          S <- matrix(Cn[u, ], d); fx <- diag(matrix(Ca[u, ], d)) == 0
          S[fx, ] <- 0; S[, fx] <- 0
          dg <- diag(S); S2 <- S + diag(ifelse(fx, 0, pmax(1e-10, 1e-8 * max(dg))), d)
          R <- tryCatch(t(chol(S2[!fx, !fx, drop = FALSE])), error = function(e) NULL)
          out <- matrix(0, d, d); if (is.null(R)) return(Ca[u, ]); out[!fx, !fx] <- R; as.vector(out)
        }, numeric(d * d)))
      newC <- matrix(newC, nu)
      # (a unit whose posterior falls between the points: centred on its posterior mean, the points drawn closer)
      if (L$d == 1 && any(ess < 3)) newC[ess < 3, ] <- Ca[ess < 3, , drop = FALSE] * 0.4
      A$m[[a]] <- m; A$C[[a]] <- newC
    }
  }
  A
}

# Random starts and optimisation with the integration points adapted between rounds (they are held fixed while the
# optimizer runs, so that it maximises one smooth function; a round that the re-adapted points do not confirm is
# shortened and repeated), then Newton steps.
mixq_fit <- function(M, start, scale, X, starts = 20, final = 4, seed = 1, given = NULL, phase = list()) {
  fe <- function(e, A) { v <- -mixq_eval(M, X$to_th(e), A)$ll; if (is.finite(v)) v else 1e300 }
  ph <- mix_phase(phase, starts, final)
  if (!is.null(ph$finals)) fits <- ph$finals
  else {
    stage <- ph$stage
    if (is.null(stage)) {
      cand <- mix_candidates(start, scale, starts, seed, given)
      # stage 1: a short run from each start
      stage <- lapply(ph$idx %||% seq_along(cand), function(i) {
        o <- mixq_converge(M, cand[[i]], X, fe, if (length(cand) > 1) 15 else 0, newton = FALSE)
        list(i = i, par = o$par, value = o$value)
      })
      if (!is.null(ph$idx)) return(list(stage = stage))
    }
    keep <- if (!is.null(ph$cont)) seq_along(stage) else mix_keep(stage, final)
    fits <- lapply(keep, function(k) { o <- mixq_converge(M, stage[[k]]$par, X, fe); list(i = stage[[k]]$i, par = o$par, value = o$value, convergence = o$convergence) })
    if (!is.null(ph$cont)) return(list(finals = fits))
  }
  lls <- -vapply(fits, function(o) o$value, 1)
  best <- fits[[which.max(lls)]]
  # (finished again from the best: its integration points, and the same steps whichever session ran it)
  o <- mixq_converge(M, best$par, X, fe, budget = 200)
  list(theta = X$to_th(o$par), A = o$A, lls = sort(lls, decreasing = TRUE), converged = isTRUE(best$convergence == 0))
}

# From one start (on the optimizer's scale) up to `budget` iterations: BFGS rounds with the points fixed, each confirmed
# by the log-likelihood at re-adapted points; Newton steps at the end.
mixq_converge <- function(M, e, X, fe, budget = 5000, newton = TRUE) {
  # (the optimizer asks for the value and the gradient at the same points: the gradient's evaluation gives both)
  memo <- new.env(); memo$x <- NULL
  fe <- function(x, A) { r <- mixq_eval(M, X$to_th(x), A); memo$x <- x; memo$A <- A; memo$C <- r$C; v <- -r$ll; if (is.finite(v)) v else 1e300 }
  ge <- function(x, A) {
    C0 <- if (!is.null(memo$x) && identical(memo$x, x) && identical(memo$A, A)) memo$C else NULL
    r <- mixq_eval(M, X$to_th(x), A, TRUE, C0); if (!is.finite(r$ll)) return(rep(0, length(x))); X$chain(x, -colSums(M$wc * r$scores)) }
  A <- mixq_adapt(M, X$to_th(e), mixq_adapt_init(M, X$to_th(e)), 3)
  f0 <- fe(e, A); maxit <- 20; used <- 0; conv <- 1
  while (used < budget) {
    it <- min(maxit, budget - used)
    # (BFGS to a moderate tolerance: Newton steps finish)
    o <- tryCatch(stats::optim(e, function(x) fe(x, A), function(x) ge(x, A), method = "BFGS", control = list(maxit = it, reltol = if (newton) 1e-10 else 1e-12)), error = function(err) NULL)
    used <- used + it
    if (is.null(o)) break
    A2 <- mixq_adapt(M, X$to_th(o$par), A, 2); f2 <- fe(o$par, A2)
    if (nzchar(Sys.getenv("MIXQ_DEBUG"))) message(sprintf("round maxit %d: %.4f -> %.4f (fixed points %.4f), counts %s", it, f0, f2, o$value, paste(o$counts, collapse = "/")))
    if (f2 <= f0 + 1e-9) {
      # (BFGS crawling between adaptations: Newton steps take over)
      done <- (f0 - f2 < 1e-8 && o$convergence == 0) || (newton && maxit >= 80 && f0 - f2 < 0.05)
      e <- o$par; A <- A2; conv <- o$convergence; f0 <- f2
      if (done) break
      maxit <- min(maxit * 2, 500)
    } else {
      if (maxit <= 2) break
      maxit <- max(2, maxit %/% 4)
    }
  }
  if (newton && length(e)) {
    for (r in 1:10) {
      e2 <- mix_newton(M, e, function(x) fe(x, A), function(x) ge(x, A))
      A2 <- mixq_adapt(M, X$to_th(e2), A, 2); f2 <- fe(e2, A2)
      if (f2 > f0 + 1e-9) break
      moved <- max(abs(e2 - e)); e <- e2; A <- A2; f0 <- f2
      if (moved < 1e-6) break
    }
  }
  list(par = e, value = f0, A = A, convergence = conv)
}

mixq_estimate <- function(spec, data) {
  for (m in spec$missing) data[[m$column]][data[[m$column]] %in% unlist(m$values)] <- NA
  if (is.null(spec$cluster)) { cd <- mix_collapse(spec, data); spec <- cd$spec; data <- cd$data }
  M <- mixq_model(spec, data)
  M$wc <- if (is.null(spec$cluster)) M$w else rep(1, M$J)
  start <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$start), 1)); scale <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$scale %||% 0), 1))
  given <- if (length(spec$given)) as.numeric(unlist(spec$given)) else NULL
  X <- mix_eta(M)
  fit <- mixq_fit(M, X$to_eta(start), scale, X, as.integer(spec$starts %||% 20), as.integer(spec$final %||% 4), as.integer(spec$seed %||% 1),
    if (is.null(given)) NULL else X$to_eta(given), spec$phase %||% list())
  if (!is.null(fit$stage) || !is.null(fit$finals)) return(fit)
  th <- fit$theta; A <- fit$A
  f <- function(t) { v <- -mixq_eval(M, t, A)$ll; if (is.finite(v)) v else 1e300 }
  g <- function(t) { r <- mixq_eval(M, t, A, TRUE); if (!is.finite(r$ll)) return(rep(0, length(t))); -colSums(M$wc * r$scores) }
  if (length(spec$order)) { r <- mixq_reorder(M, th, spec$order, X, A); if (is.null(r)) stop("The class order is not allowed by the model's constraints."); th <- r$theta; A <- r$A }
  e <- mixq_eval(M, th, A, TRUE)
  H <- mix_hessian(M, th, g)
  Bm <- crossprod(e$scores * sqrt(M$wc))
  Hi <- tryCatch(solve(H), error = function(err) NULL)
  V <- if (is.null(Hi)) NULL else Hi %*% Bm %*% Hi
  # (each case's posterior of the joint classes)
  post <- if (!is.null(e$P$pz)) e$P$pz else rowsum(e$P$pr, rep(seq_len(M$n), e$C$Q), reorder = TRUE)
  list(M = M, theta = th, ll = e$ll, post = post, V = V, fit = fit, k = length(th))
}

# Relabel the classes of an integrated model (see mix_reorder): every slot takes its value in the permuted classes
# (class logits re-expressed against the new last class), the free parameters from those by least squares, then
# optimised from there (a mean fixed in a reference class is reached by the optimisation).
mixq_reorder <- function(M, th, order, X, A) {
  phi <- drop(M$b + M$A %*% mix_full(M, th))
  if (is.matrix(order)) order <- lapply(seq_len(nrow(order)), function(i) order[i, ])
  perm <- lapply(seq_along(M$cls), function(v) if (length(order) >= v && length(order[[v]])) as.integer(unlist(order[[v]])) else seq_len(M$ks[v]))
  if (all(vapply(seq_along(perm), function(v) identical(perm[[v]], seq_len(M$ks[v])), TRUE))) return(list(theta = th, A = A))
  Zp <- M$Z; for (v in seq_along(perm)) Zp[, v] <- perm[[v]][M$Z[, v]]
  zidx <- function(Zr) as.integer(1 + colSums(t(Zr - 1) * cumprod(c(1L, M$ks))[seq_along(M$ks)]))
  zmap <- zidx(Zp)
  rows <- integer(0); target <- numeric(0)
  put <- function(S, map) for (cc in seq_len(nrow(S))) { z <- which(map == cc)[1]; if (is.na(z)) next; c2 <- map[zmap[z]]; rows <<- c(rows, S[cc, ]); target <<- c(target, phi[S[c2, ]]) }
  for (bk in M$blocks) put(bk$S, bk$map)
  if (!is.null(M$lat)) { put(M$lat$S, M$lat$map); if (!is.null(M$lat$shiftMap)) put(M$lat$shiftS, M$lat$shiftMap) }
  for (vi in seq_along(M$cls)) {
    v <- M$cls[[vi]]; per <- 1 + length(v$covariates) + v$nl; k <- v$k
    for (z in seq_len(M$nz)) {
      pc <- v$pc[z]; pc2 <- v$pc[zmap[z]]
      for (m in seq_len(k - 1)) {
        sl <- v$slots[((pc - 1) * k + (m - 1)) * per + seq_len(per)]
        a <- v$slots[((pc2 - 1) * k + (perm[[vi]][m] - 1)) * per + seq_len(per)]; b <- v$slots[((pc2 - 1) * k + (perm[[vi]][k] - 1)) * per + seq_len(per)]
        val <- ifelse(is.finite(phi[a]), phi[a], 0) - ifelse(is.finite(phi[b]), phi[b], 0)
        rows <- c(rows, sl); target <- c(target, val)
      }
    }
  }
  Af <- M$A[, seq_along(th), drop = FALSE]
  ok <- is.finite(target) & is.finite(M$b[rows]) & rowSums(Af[rows, , drop = FALSE] != 0) > 0
  th1 <- th
  if (any(ok)) { sol <- qr.coef(qr(Af[rows[ok], , drop = FALSE]), target[ok] - M$b[rows[ok]]); th1 <- ifelse(is.na(sol), th, sol) }
  fe <- function(e, A2) { v <- -mixq_eval(M, X$to_th(e), A2)$ll; if (is.finite(v)) v else 1e300 }
  o <- mixq_converge(M, X$to_eta(th1), X, fe)
  th2 <- X$to_th(o$par)
  if (abs(o$value + mixq_eval(M, th, A)$ll) > 1e-3) return(NULL)
  list(theta = th2, A = o$A)
}

PS_MIX_FUNCTIONS <- c("mix_expr", "mix_full", "mix_full_jac", "mix_collapse", "mix_model", "mix_lse", "mix_prior", "mix_ld", "mix_mvn_parts", "mix_block", "mix_eval", "mix_fit", "mix_eta", "mix_hessian", "mix_newton", "mix_reorder", "mix_estimate", "mix_report", "mix_shares", "mix_candidates", "mix_phase", "mix_keep",
  "mixq_rule", "mixq_lat_parts", "mixq_catidx", "mixq_dld", "mixq_dlat", "mixq_ldens", "mixq_ld", "mixq_model", "mixq_prior", "mixq_collapsed", "mixq_ess", "mixq_rowmax", "mix_lse_list", "mixq_lse_groups", "mixq_nodes", "mixq_aof", "mixq_core", "mixq_post", "mixq_eval",
  "mixq_adapt_init", "mixq_adapt", "mixq_fit", "mixq_converge", "mixq_estimate", "mixq_reorder")

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
    "if (is.null(est$stage) && is.null(est$finals)) {",
    "  report <- mix_report(spec, est)",
    "  shares <- mix_shares(est)",
    "}")
  spec_json <- as.character(jsonlite::toJSON(spec, auto_unbox = TRUE, digits = NA, null = "null", na = "null"))
  inputs <- list(data = data, spec_json = spec_json)
  if (export) return(paste(ps_script("Mixture model (maximum likelihood, MLR standard errors)", "jsonlite", inputs, body,
    c("c(logLik = est$ll, npar = est$k, BIC = -2 * est$ll + est$k * log(sum(est$M$w)))",
      "do.call(rbind, lapply(report, function(r) data.frame(lhs = r$lhs, op = r$op, rhs = r$rhs, classes = paste(r$at, collapse = \" \"), est = r$est, se = if (is.null(r$se)) NA else r$se)))",
      "shares$classes")), collapse = "\n"))
  env <- ps_run(body, inputs)
  est <- env$est
  # (a phase of the random starts run in one of several R sessions: its runs only)
  if (!is.null(est$stage) || !is.null(est$finals)) return(ps_json(list(stage = est$stage, finals = est$finals)))
  nobs <- sum(est$M$w); k <- est$k
  if (is.null(est$V)) ps_warning("The information matrix is singular: no standard errors (the model may not be identified).")
  lls <- est$fit$lls
  rep_best <- sum(abs(lls - max(lls)) < 1e-3)
  if (length(lls) > 1 && rep_best < 2) ps_warning(sprintf("The best log-likelihood was reached from only one of the %d final starts: increase the starts to make sure it is the maximum.", length(lls)))
  ps_json(list(n = nobs, rows = nrow(data), logLik = est$ll, npar = k, aic = -2 * est$ll + 2 * k, bic = -2 * est$ll + k * log(nobs),
    params = env$report, classes = env$shares$classes, patterns = env$shares$patterns, entropy = env$shares$entropy,
    lls = lls, converged = est$fit$converged, theta = est$theta,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
