# Maximum likelihood by numerical integration (Mplus's ALGORITHM = INTEGRATION), written out in base R, for structural
# equation models whose outcomes are not all normal: censored (tobit, from below or above, and censored-inflated),
# counts (Poisson, negative binomial, zero-inflated Poisson and negative binomial), ordered categorical (logit or probit), normal outcomes
# that depend non-linearly on factors (XWITH), and continuous-time survival (piecewise-constant baseline hazard,
# proportional hazards), with continuous latent variables: factors, growth factors and random effects, and
# continuous observed variables that predict such outcomes and are missing for some cases (they are integrated over
# where missing). The model arrives as a specification (analyses/quadmlSyntax.ts, from Mplus's syntax): the free
# parameters theta and every model quantity a linear combination of them ("slots", as in the mixture engine,
# R/mixture.R), so equality constraints and fixed values are the same thing.
#
# The normal part is a linear structural model of the continuous variables z (latent variables and continuous
# observed outcomes): z = alpha + B z + Gamma x + zeta, Cov(zeta) = Psi, so z ~ N(mu(x), Sigma). Every other outcome
# depends on z through its linear predictor (an intercept or thresholds, slopes on z, on products of z's and on
# covariates). For each case the integral runs over the latent variables (and missing continuous predictors) that the
# case's observed non-normal outcomes depend on; the continuous outcomes enter through their normal density given
# those, as Mplus computes them. The integration variables are standardised by the Cholesky factor of their
# covariance matrix (xi), and the integral taken by one of Mplus's rules:
#   rect: Mplus's default (INTEGRATION = STANDARD): Q equally spaced points from -5 to 5 per dimension, weights
#         proportional to the normal density (normalised);
#   gh:   Gauss-Hermite;  mc: Monte Carlo draws (fixed seed);
# adaptive (Mplus's default): each dimension of xi is centred at the case's posterior mean and scaled by its posterior
# standard deviation, computed from the previous step (a fixed point at convergence), as Mplus's adaptive quadrature;
# this rule reproduces Mplus's printed log-likelihoods. Maximum likelihood by BFGS with the gradient from per-case
# scores, Newton steps at the end, the adaptation updated between runs; standard errors by the sandwich (Mplus's MLR)
# or the observed information (ML).

qml_lse <- function(L) { m <- apply(L, 1, max); m[!is.finite(m)] <- 0; m + log(rowSums(exp(L - m))) }

# The one-dimensional rule: points x and weights w for the standard normal (sum 1).
qml_rule1 <- function(type, Q, range = 5) {
  if (type == "gh") {
    i <- seq_len(Q - 1); J <- matrix(0, Q, Q); J[cbind(i, i + 1)] <- sqrt(i / 2); J[cbind(i + 1, i)] <- sqrt(i / 2)
    e <- eigen(J, symmetric = TRUE); o <- order(e$values)
    return(list(x = e$values[o] * sqrt(2), w = e$vectors[1, o]^2))
  }
  x <- if (Q == 1) 0 else seq(-range, range, length.out = Q); w <- stats::dnorm(x); list(x = x, w = w / sum(w))
}

# Points (K x r) and log weights of an r-dimensional rule: a product grid, or Monte Carlo draws.
qml_grid <- function(integ, r) {
  if (r == 0) return(list(X = matrix(0, 1, 0), lw = 0))
  if (integ$type == "mc") {
    K <- as.integer(integ$points); old <- if (exists(".Random.seed", globalenv())) get(".Random.seed", globalenv()) else NULL
    set.seed(as.integer(integ$seed %||% 0) + 1000L * r)
    X <- matrix(stats::rnorm(K * r), K, r)
    if (!is.null(old)) assign(".Random.seed", old, globalenv())
    return(list(X = X, lw = rep(-log(K), K)))
  }
  R1 <- qml_rule1(integ$type, as.integer(integ$points), as.numeric(integ$range %||% 5))
  g <- as.matrix(expand.grid(rep(list(seq_along(R1$x)), r)))
  list(X = matrix(R1$x[g], nrow(g), r), lw = rowSums(matrix(log(R1$w[g]), nrow(g), r)))
}

# Read the specification against the data.
qml_model <- function(spec, data) {
  n <- nrow(data)
  th <- spec$theta; nth <- length(th); slots <- spec$slots; ns <- length(slots)
  A <- matrix(0, ns, max(nth, 1)); b <- numeric(ns)
  for (s in seq_len(ns)) {
    cst <- slots[[s]]$c; b[s] <- if (is.null(cst)) 0 else as.numeric(cst)
    t <- as.numeric(unlist(slots[[s]]$t))
    if (length(t)) for (j in seq(1, length(t), by = 2)) A[s, t[j] + 1] <- A[s, t[j] + 1] + t[j + 1]
  }
  g <- spec$gauss
  vars <- as.character(unlist(g$vars)); m <- length(vars)
  gcols <- as.character(unlist(g$cols))
  xs <- as.character(unlist(g$x))
  trip <- function(v) { v <- unlist(v); if (!length(v)) matrix(0L, 0, 3) else matrix(as.integer(v), ncol = 3, byrow = TRUE) }
  G <- list(m = m, vars = vars, cols = gcols, obs = which(nzchar(gcols)), alpha = as.integer(unlist(g$alpha)), B = trip(g$B), Gam = trip(g$G), Psi = trip(g$Psi), x = xs,
    X = if (length(xs)) as.matrix(data[, xs, drop = FALSE]) else matrix(0, n, 0))
  Yc <- matrix(NA_real_, n, m); for (v in G$obs) Yc[, v] <- data[[gcols[v]]]
  G$Y <- Yc
  pairs <- function(v) { v <- unlist(v); if (!length(v)) matrix(0L, 0, 2) else matrix(as.integer(v), ncol = 2, byrow = TRUE) }
  xpairs <- function(v) if (!length(v)) list() else lapply(v, function(p) list(x = as.character(p[[1]]), slot = as.integer(p[[2]])))
  lin_part <- function(o) {
    if (is.null(o)) return(NULL)
    list(icpt = as.integer(o$icpt %||% -1L), loads = pairs(o$loads), prods = trip(o$prods), xs = xpairs(o$xs))
  }
  outs <- lapply(spec$outcomes, function(o) {
    u <- list(name = o$name, column = o$column, type = o$type, link = o$link %||% "logit", y = data[[o$column]],
      asym = o$asym, thr = as.integer(unlist(o$thr)), resvar = as.integer(o$resvar %||% -1L), disp = as.integer(o$disp %||% -1L), side = o$side %||% "below")
    u <- c(u, lin_part(o))
    u$infl <- lin_part(o$infl)
    if (u$type == "cat") {
      lev <- as.numeric(unlist(o$levels)); u$code <- match(u$y, lev); u$K <- length(lev)
      if (any(!is.na(u$y) & is.na(u$code))) stop(sprintf("%s has values other than its categories.", o$column))
    }
    if (u$type %in% c("censored", "cinfl")) u$cpoint <- if (identical(u$side, "above")) max(u$y, na.rm = TRUE) else min(u$y, na.rm = TRUE)
    if (u$type == "surv") {
      br <- as.numeric(unlist(o$breaks)); nb <- length(br)  # 0 = b_0 < b_1 < … < b_k, then [b_k, Inf)
      tt <- u$y; up <- c(br[-1], Inf)
      u$expo <- vapply(seq_len(nb), function(k) pmax(0, pmin(tt, up[k]) - br[k]), numeric(n))
      u$expo <- matrix(u$expo, n)
      u$at <- findInterval(tt, br, rightmost.closed = FALSE); u$at[u$at < 1] <- 1L
      cens <- if (!is.null(o$censor) && nzchar(o$censor)) data[[o$censor]] else rep(0, n)
      u$event <- as.numeric(!is.na(cens) & cens == 0)
      u$haz <- as.integer(unlist(o$hazards))
    }
    u$xs_mat <- if (length(u$xs)) as.matrix(data[, vapply(u$xs, function(p) p$x, ""), drop = FALSE]) else NULL
    if (!is.null(u$infl)) u$infl$xs_mat <- if (length(u$infl$xs)) as.matrix(data[, vapply(u$infl$xs, function(p) p$x, ""), drop = FALSE]) else NULL
    u$refs <- unique(c(u$loads[, 1], u$prods[, 1:2], if (!is.null(u$infl)) c(u$infl$loads[, 1], u$infl$prods[, 1:2])))
    u$slots <- unique(c(u$thr, u$resvar, u$disp, u$icpt, u$loads[, 2], u$prods[, 3], vapply(u$xs, function(p) p$slot, 1L), u$haz,
      if (!is.null(u$infl)) c(u$infl$icpt, u$infl$loads[, 2], u$infl$prods[, 3], vapply(u$infl$xs, function(p) p$slot, 1L))))
    u$slots <- u$slots[u$slots >= 0] + 1L
    u
  })
  # The normal part's slots (global: they move the integration points of every case).
  gsl <- unique(c(G$alpha, G$B[, 3], G$Gam[, 3], G$Psi[, 3])); gsl <- gsl[gsl >= 0] + 1L
  # Patterns: observed continuous variables, observed outcomes, and the variables to integrate over.
  obsC <- !is.na(Yc[, G$obs, drop = FALSE])
  obsU <- vapply(outs, function(u) !is.na(u$y), logical(n)); obsU <- matrix(obsU, n)
  refd <- lapply(outs, function(u) u$refs)
  key <- vapply(seq_len(n), function(i) {
    oc <- G$obs[obsC[i, ]]
    ou <- which(obsU[i, ])
    D <- setdiff(unique(unlist(refd[ou])) + 1L, oc)
    paste(paste(oc, collapse = ","), paste(ou, collapse = ","), paste(sort(D), collapse = ","), sep = "|")
  }, "")
  pats <- lapply(split(seq_len(n), factor(key, levels = unique(key))), function(rows) {
    i <- rows[1]; oc <- G$obs[obsC[i, ]]; ou <- which(obsU[i, ])
    list(rows = rows, oc = oc, ou = ou, D = sort(setdiff(unique(unlist(refd[ou])) + 1L, oc)))
  })
  w <- if (!is.null(spec$weight) && nzchar(spec$weight)) data[[spec$weight]] else rep(1, n)
  integ <- spec$integration
  grids <- list()
  for (r in 0:max(c(0, vapply(pats, function(p) length(p$D), 1L)))) grids[[r + 1]] <- qml_grid(integ, r)
  M <- list(n = n, w = w, A = A, b = b, nth = nth, G = G, outs = outs, pats = pats, gsl = gsl, integ = integ, grids = grids,
    adaptive = isTRUE(integ$adaptive), free = which(rowSums(A != 0) > 0))
  M$state <- new.env()
  M$state$ad <- lapply(pats, function(p) NULL)
  M
}

# The normal part at the slot values phi: the mean of z for each case (n x m) and its covariance matrix.
qml_gauss <- function(M, phi) {
  G <- M$G; m <- G$m
  # (no latent or continuous variable: the outcomes depend on covariates only, nothing to integrate)
  if (m == 0) return(list(Mu = matrix(0, M$n, 0), S = matrix(0, 0, 0)))
  al <- vapply(G$alpha, function(s) if (s >= 0) phi[s + 1] else 0, 1)
  B <- matrix(0, m, m); for (r in seq_len(nrow(G$B))) B[G$B[r, 1] + 1, G$B[r, 2] + 1] <- phi[G$B[r, 3] + 1]
  Ga <- matrix(0, m, length(G$x)); for (r in seq_len(nrow(G$Gam))) Ga[G$Gam[r, 1] + 1, G$Gam[r, 2] + 1] <- phi[G$Gam[r, 3] + 1]
  Psi <- matrix(0, m, m); for (r in seq_len(nrow(G$Psi))) { i <- G$Psi[r, 1] + 1; j <- G$Psi[r, 2] + 1; Psi[i, j] <- Psi[j, i] <- phi[G$Psi[r, 3] + 1] }
  IB <- tryCatch(solve(diag(m) - B), error = function(e) NULL)
  if (is.null(IB)) return(NULL)
  Mu <- matrix(al, M$n, m, byrow = TRUE); if (length(G$x)) Mu <- Mu + G$X %*% t(Ga)
  list(Mu = Mu %*% t(IB), S = IB %*% Psi %*% t(IB))
}

# A linear predictor at the nodes: Z[[v]] the values of z_v (n_p x K matrices, or vectors for observed variables).
qml_lin <- function(part, phi, Z, rows, K) {
  out <- matrix(if (part$icpt >= 0) phi[part$icpt + 1] else 0, length(rows), K)
  for (j in seq_along(part$xs)) out <- out + part$xs_mat[rows, j] * phi[part$xs[[j]]$slot + 1]
  for (r in seq_len(nrow(part$loads))) out <- out + phi[part$loads[r, 2] + 1] * Z[[part$loads[r, 1] + 1]]
  for (r in seq_len(nrow(part$prods))) out <- out + phi[part$prods[r, 3] + 1] * Z[[part$prods[r, 1] + 1]] * Z[[part$prods[r, 2] + 1]]
  out
}

# log f(outcome | nodes) of the cases `rows` (n_p x K).
qml_ld <- function(u, phi, Z, rows, K, lin = NULL, li = NULL) {
  y <- u$y[rows]; np <- length(rows)
  if (is.null(lin)) lin <- qml_lin(u, phi, Z, rows, K)
  Y <- y
  switch(u$type,
    cat = {
      tau <- phi[u$thr + 1]; Kc <- u$K; code <- u$code[rows]
      if (!is.null(u$asym)) {
        # (3PL / 4PL: P(u = 1) = g + (h - g) F(lin - u$1), u$2 = -logit(g), u$3 = -logit(h))
        g <- stats::plogis(-tau[2]); hh <- if (u$asym == "4pl") stats::plogis(-tau[3]) else 1
        p1 <- g + (hh - g) * stats::plogis(lin - tau[1])
        out <- matrix(0, np, K); one <- code == 2; zero <- code == 1
        out[one, ] <- log(pmax(p1[one, , drop = FALSE], 1e-300)); out[zero, ] <- log(pmax(1 - p1[zero, , drop = FALSE], 1e-300))
        return(out)
      }
      if (Kc > 2 && is.unsorted(tau)) return(matrix(-Inf, np, K))
      Fn <- if (u$link == "probit") stats::pnorm else stats::plogis
      out <- matrix(0, np, K)
      for (j in seq_len(Kc)) {
        ii <- which(code == j); if (!length(ii)) next
        e <- lin[ii, , drop = FALSE]
        out[ii, ] <- if (j == 1) Fn(tau[1] - e, log.p = TRUE) else if (j == Kc) Fn(tau[Kc - 1] - e, lower.tail = FALSE, log.p = TRUE)
          else log(pmax(Fn(tau[j] - e) - Fn(tau[j - 1] - e), 1e-300))
      }
      out
    },
    count = Y * lin - exp(lin) - lgamma(Y + 1),
    nb = {
      a <- phi[u$disp + 1]; if (!is.finite(a) || a <= 0) return(matrix(-Inf, np, K)); s <- 1 / a; mu <- exp(lin)
      lgamma(Y + s) - lgamma(s) - lgamma(Y + 1) + s * log(s / (s + mu)) + Y * log(mu / (s + mu))
    },
    zinb = {
      # (zero-inflated negative binomial, Mplus COUNT = u (nbi): the dispersion a = 1 / theta, the inflation's logit li)
      a <- phi[u$disp + 1]; if (!is.finite(a) || a <= 0) return(matrix(-Inf, np, K)); s <- 1 / a; mu <- exp(lin)
      if (is.null(li)) li <- qml_lin(u$infl, phi, Z, rows, K)
      nb <- lgamma(Y + s) - lgamma(s) - lgamma(Y + 1) + s * log(s / (s + mu)) + Y * log(mu / (s + mu))
      zero <- matrix(Y == 0, np, K)
      out <- stats::plogis(li, lower.tail = FALSE, log.p = TRUE) + nb
      out[zero] <- log(stats::plogis(li[zero]) + stats::plogis(li[zero], lower.tail = FALSE) * exp(nb[zero]))
      out
    },
    zip = {
      if (is.null(li)) li <- qml_lin(u$infl, phi, Z, rows, K); lam <- exp(lin)
      zero <- matrix(Y == 0, np, K)
      out <- stats::plogis(li, lower.tail = FALSE, log.p = TRUE) + Y * lin - lam - lgamma(Y + 1)
      out[zero] <- log(stats::plogis(li[zero]) + stats::plogis(li[zero], lower.tail = FALSE) * exp(-lam[zero]))
      out
    },
    normal = , censored = , cinfl = {
      s2 <- phi[u$resvar + 1]; if (!is.finite(s2) || s2 <= 0) return(matrix(-Inf, np, K)); s <- sqrt(s2)
      out <- lin; out[] <- stats::dnorm(Y, lin, s, log = TRUE)
      if (u$type != "normal") {
        at <- if (identical(u$side, "above")) y >= u$cpoint - 1e-9 else y <= u$cpoint + 1e-9
        if (any(at)) out[at, ] <- stats::pnorm((u$cpoint - lin[at, , drop = FALSE]) / s, lower.tail = !identical(u$side, "above"), log.p = TRUE)
        if (u$type == "cinfl") {
          if (is.null(li)) li <- qml_lin(u$infl, phi, Z, rows, K)
          out <- stats::plogis(li, lower.tail = FALSE, log.p = TRUE) + out
          if (any(at)) { l1 <- stats::plogis(li[at, , drop = FALSE], log.p = TRUE); l2 <- out[at, , drop = FALSE]; mx <- pmax(l1, l2); out[at, ] <- mx + log(exp(l1 - mx) + exp(l2 - mx)) }
        }
      }
      out
    },
    surv = {
      h <- phi[u$haz + 1]; if (any(!is.finite(h)) || any(h <= 0)) return(matrix(-Inf, np, K))
      H <- drop(u$expo[rows, , drop = FALSE] %*% h); ev <- u$event[rows]
      ev * (log(h[u$at[rows]]) + lin) - H * exp(lin)
    },
    stop("Unknown outcome type."))
}

# A pattern's integration variables (D: those with variance), the Cholesky factor L of their covariance matrix, and
# for its observed continuous variables O, given D: U = (y_O - mu_O) R^-1 and Bm = (A L)' R^-1 (V = R'R the conditional
# covariance matrix, A the regression on D), so that log f(y_O | xi) = lO0 - |U - xi Bm|^2 / 2. NULL: not admissible.
qml_parts <- function(M, gp, pk) {
  p <- M$pats[[pk]]; rows <- p$rows; S <- gp$S; Mu <- gp$Mu[rows, , drop = FALSE]
  D <- p$D; if (any(diag(S)[D] < -1e-12)) return(NULL)
  D <- D[diag(S)[D] > 1e-12]            # (a variable with variance 0 is its mean)
  r <- length(D); O <- p$oc; out <- list(D = D, r = r, O = O, Mu = Mu, L = NULL)
  if (r) { out$L <- tryCatch(t(chol(S[D, D, drop = FALSE])), error = function(e) NULL); if (is.null(out$L)) return(NULL) }
  if (length(O)) {
    if (r) { Ai <- S[O, D, drop = FALSE] %*% chol2inv(t(out$L)); V <- S[O, O, drop = FALSE] - Ai %*% S[D, O, drop = FALSE]; AL <- Ai %*% out$L }
    else V <- S[O, O, drop = FALSE]
    Rv <- tryCatch(chol(V), error = function(e) NULL); if (is.null(Rv)) return(NULL)
    Ri <- backsolve(Rv, diag(length(O)))
    out$U <- (M$G$Y[rows, O, drop = FALSE] - Mu[, O, drop = FALSE]) %*% Ri
    out$Bm <- if (r) t(AL) %*% Ri else NULL
    out$lO0 <- -sum(log(diag(Rv))) - 0.5 * length(O) * log(2 * pi)
  }
  out
}

# The values of the normal part's variables at the nodes Xi (n_p x K matrices; vectors where they do not vary).
qml_nodes <- function(M, pt, rows, Xi, K) {
  np <- length(rows); Z <- vector("list", M$G$m)
  for (v in pt$O) Z[[v]] <- M$G$Y[rows, v]
  for (v in setdiff(seq_len(M$G$m), pt$O)) Z[[v]] <- pt$Mu[, v]
  for (a in seq_len(pt$r)) { v <- pt$D[a]; e <- matrix(pt$Mu[, v], np, K); for (j in seq_len(a)) e <- e + pt$L[a, j] * Xi[[j]]; Z[[v]] <- e }
  Z
}

# log-likelihood of each case (and the nodes and posterior weights of each pattern, for the scores). The adaptation of
# the nodes (each case's posterior mean and standard deviation of xi) is held fixed; `adapt` = number of updates first.
qml_eval <- function(M, phi, keep = FALSE, adapt = 0L) {
  gp <- qml_gauss(M, phi); n <- M$n
  if (is.null(gp)) return(list(ll = rep(-Inf, n)))
  ll <- rep(NA_real_, n); store <- if (keep) vector("list", length(M$pats)) else NULL
  for (pk in seq_along(M$pats)) {
    p <- M$pats[[pk]]; rows <- p$rows; np <- length(rows)
    pt <- qml_parts(M, gp, pk); if (is.null(pt)) return(list(ll = rep(-Inf, n)))
    r <- pt$r; O <- pt$O
    gr <- M$grids[[r + 1]]; K <- nrow(gr$X)
    ad <- M$state$ad[[pk]]
    if (!M$adaptive || is.null(ad) || ncol(ad$m) != r) ad <- list(m = matrix(0, np, r), s = matrix(1, np, r))
    passes <- if (M$adaptive && r) adapt + 1L else 1L
    for (pass in seq_len(passes)) {
      Xi <- lapply(seq_len(r), function(j) ad$m[, j] + outer(ad$s[, j], gr$X[, j]))
      LW <- matrix(gr$lw, np, K, byrow = TRUE)
      for (j in seq_len(r)) LW <- LW + log(ad$s[, j]) + stats::dnorm(Xi[[j]], log = TRUE) - matrix(stats::dnorm(gr$X[, j], log = TRUE), np, K, byrow = TRUE)
      if (length(O)) {
        q <- matrix(0, np, K)
        for (o in seq_along(O)) { e <- matrix(pt$U[, o], np, K); for (j in seq_len(r)) e <- e - pt$Bm[j, o] * Xi[[j]]; q <- q + e^2 }
        LW <- LW + pt$lO0 - 0.5 * q
      }
      Z <- qml_nodes(M, pt, rows, Xi, K)
      LU <- lapply(p$ou, function(k) qml_ld(M$outs[[k]], phi, Z, rows, K))
      for (lu in LU) LW <- LW + lu
      lse <- qml_lse(LW)
      if (pass < passes) {
        P <- exp(LW - lse)
        if (any(!is.finite(P))) break
        for (j in seq_len(r)) { mj <- rowSums(P * Xi[[j]]); sj <- sqrt(pmax(rowSums(P * (Xi[[j]] - mj)^2), 1e-8)); ad$m[, j] <- mj; ad$s[, j] <- sj }
      }
    }
    if (M$adaptive && adapt > 0) M$state$ad[[pk]] <- ad
    ll[rows] <- lse
    if (keep) store[[pk]] <- list(P = exp(LW - lse), Z = Z, Xi = Xi, K = K, pt = pt)
  }
  list(ll = ll, store = store)
}

# Per-case scores (n x theta) at theta, with the adaptation held fixed (the derivative of the log-likelihood the
# rule computes): the posterior-weighted derivatives of the log-density at the nodes. An outcome's own parameters
# by differences of its log-density; the normal part's through the nodes they move (the means and Cholesky factor)
# and the continuous outcomes' conditional density, by the chain rule with the outcomes' derivatives in their
# linear predictors.
qml_scores <- function(M, theta, base = NULL) {
  phi <- drop(M$b + M$A %*% theta); n <- M$n
  e0 <- if (is.null(base)) qml_eval(M, phi, keep = TRUE) else base
  Dm <- matrix(0, n, length(phi))
  if (!all(is.finite(e0$ll))) return(list(ll = e0$ll, scores = Dm %*% M$A))
  h <- function(x) 1e-5 * max(1, abs(x))
  used <- which(rowSums(M$A != 0) > 0)
  glob <- intersect(M$gsl, used)
  gpm <- lapply(glob, function(s) { e <- h(phi[s]); pp <- phi; pp[s] <- pp[s] + e; pm <- phi; pm[s] <- pm[s] - e; list(e = e, p = qml_gauss(M, pp), m = qml_gauss(M, pm)) })
  for (pk in seq_along(M$pats)) {
    p <- M$pats[[pk]]; st <- e0$store[[pk]]; if (is.null(st)) next
    rows <- p$rows; np <- length(rows); K <- st$K; Z <- st$Z; pt <- st$pt; r <- pt$r
    # derivatives of each outcome's log-density in its linear predictor(s) at the nodes
    dl <- lapply(p$ou, function(k) {
      u <- M$outs[[k]]; lin <- qml_lin(u, phi, Z, rows, K); hh <- 1e-5
      g1 <- (qml_ld(u, phi, Z, rows, K, lin = lin + hh) - qml_ld(u, phi, Z, rows, K, lin = lin - hh)) / (2 * hh); g1[!is.finite(g1)] <- 0
      g2 <- NULL
      if (!is.null(u$infl)) { li <- qml_lin(u$infl, phi, Z, rows, K); g2 <- (qml_ld(u, phi, Z, rows, K, lin = lin, li = li + hh) - qml_ld(u, phi, Z, rows, K, lin = lin, li = li - hh)) / (2 * hh); g2[!is.finite(g2)] <- 0 }
      list(g1 = g1, g2 = g2)
    })
    # the outcomes' own parameters: those of a linear predictor through its derivative (times 1, z, x or a product),
    # the others (thresholds, variances, hazards, dispersion) by differences of the log-density
    for (a in seq_along(p$ou)) {
      u <- M$outs[[p$ou[a]]]
      lin_slot <- function(part, G) {
        if (is.null(part) || is.null(G)) return(NULL)
        out <- list()
        if (part$icpt >= 0) out[[as.character(part$icpt + 1)]] <- G
        for (q in seq_len(nrow(part$loads))) out[[as.character(part$loads[q, 2] + 1)]] <- G * Z[[part$loads[q, 1] + 1]]
        for (q in seq_len(nrow(part$prods))) out[[as.character(part$prods[q, 3] + 1)]] <- G * Z[[part$prods[q, 1] + 1]] * Z[[part$prods[q, 2] + 1]]
        for (j in seq_along(part$xs)) out[[as.character(part$xs[[j]]$slot + 1)]] <- G * part$xs_mat[rows, j]
        out
      }
      byLin <- c(lin_slot(u, dl[[a]]$g1), lin_slot(u$infl, dl[[a]]$g2))
      for (s in intersect(setdiff(u$slots, M$gsl), used)) {
        d <- byLin[[as.character(s)]]
        if (is.null(d)) {
          e <- h(phi[s]); pp <- phi; pp[s] <- pp[s] + e; pm <- phi; pm[s] <- pm[s] - e
          d <- (qml_ld(u, pp, Z, rows, K) - qml_ld(u, pm, Z, rows, K)) / (2 * e); d[!is.finite(d)] <- 0
        }
        Dm[rows, s] <- Dm[rows, s] + rowSums(st$P * d)
      }
    }
    if (!length(glob)) next
    dlin <- function(part, dZ) {
      out <- 0
      for (q in seq_len(nrow(part$loads))) { v <- part$loads[q, 1] + 1; if (!is.null(dZ[[v]])) out <- out + phi[part$loads[q, 2] + 1] * dZ[[v]] }
      for (q in seq_len(nrow(part$prods))) { a <- part$prods[q, 1] + 1; b <- part$prods[q, 2] + 1; cf <- phi[part$prods[q, 3] + 1]
        if (!is.null(dZ[[a]])) out <- out + cf * dZ[[a]] * Z[[b]]; if (!is.null(dZ[[b]])) out <- out + cf * Z[[a]] * dZ[[b]] }
      out
    }
    for (gi in seq_along(glob)) {
      s <- glob[gi]; g <- gpm[[gi]]
      ptp <- qml_parts(M, g$p, pk); ptm <- qml_parts(M, g$m, pk)
      if (is.null(ptp) || is.null(ptm) || ptp$r != r || ptm$r != r) next
      e2 <- 2 * g$e
      # the normal part's variables at the (fixed) standardised nodes
      dZ <- vector("list", M$G$m)
      for (v in setdiff(seq_len(M$G$m), pt$O)) { d <- (ptp$Mu[, v] - ptm$Mu[, v]) / e2; if (any(d != 0)) dZ[[v]] <- d }
      for (a in seq_len(r)) { v <- pt$D[a]; d <- matrix((ptp$Mu[, v] - ptm$Mu[, v]) / e2, np, K); for (j in seq_len(a)) d <- d + (ptp$L[a, j] - ptm$L[a, j]) / e2 * st$Xi[[j]]; dZ[[v]] <- d }
      tot <- matrix(0, np, K)
      if (length(pt$O)) {
        tot <- tot + (ptp$lO0 - ptm$lO0) / e2
        for (o in seq_along(pt$O)) {
          ev <- matrix(pt$U[, o], np, K); de <- matrix((ptp$U[, o] - ptm$U[, o]) / e2, np, K)
          for (j in seq_len(r)) { ev <- ev - pt$Bm[j, o] * st$Xi[[j]]; de <- de - (ptp$Bm[j, o] - ptm$Bm[j, o]) / e2 * st$Xi[[j]] }
          tot <- tot - ev * de
        }
      }
      for (a in seq_along(p$ou)) {
        u <- M$outs[[p$ou[a]]]
        d1 <- dlin(u, dZ); if (!identical(d1, 0)) tot <- tot + dl[[a]]$g1 * d1
        if (!is.null(u$infl)) { d2 <- dlin(u$infl, dZ); if (!identical(d2, 0)) tot <- tot + dl[[a]]$g2 * d2 }
      }
      Dm[rows, s] <- Dm[rows, s] + rowSums(st$P * tot)
    }
  }
  list(ll = e0$ll, scores = Dm %*% M$A)
}

qml_hessian <- function(th, g) {
  k <- length(th); H <- matrix(0, k, k)
  for (j in seq_len(k)) { e <- 1e-4 * max(1, abs(th[j])); tp <- th; tp[j] <- tp[j] + e; tm <- th; tm[j] <- tm[j] - e; H[, j] <- -(g(tp) - g(tm)) / (2 * e) }
  (H + t(H)) / 2
}

qml_estimate <- function(spec, data) {
  M <- qml_model(spec, data)
  th <- as.numeric(vapply(spec$theta, function(t) as.numeric(t$start), 1))
  phi_of <- function(t) drop(M$b + M$A %*% t)
  # Normal priors (MODEL PRIORS): the log prior density is added to the log-likelihood (and its derivatives).
  pri <- spec$priors
  ps <- if (length(pri)) vapply(pri, function(q) as.integer(q$slot) + 1L, 1L) else integer(0)
  pm <- vapply(pri, function(q) as.numeric(q$mean), 1); pv <- vapply(pri, function(q) as.numeric(q$variance), 1)
  lprior <- function(t) if (length(ps)) sum(stats::dnorm(phi_of(t)[ps], pm, sqrt(pv), log = TRUE)) else 0
  dprior <- function(t) if (length(ps)) drop(crossprod(M$A[ps, , drop = FALSE], -(phi_of(t)[ps] - pm) / pv)) else 0
  f <- function(t) { v <- -sum(M$w * qml_eval(M, phi_of(t))$ll) - lprior(t); if (is.finite(v)) v else 1e300 }
  g <- function(t) { s <- qml_scores(M, t); if (!all(is.finite(s$ll))) return(rep(0, length(t))); -colSums(M$w * s$scores) - dprior(t) }
  adapt <- function(t, k = 3L) invisible(qml_eval(M, phi_of(t), adapt = k))
  if (M$adaptive) adapt(th, 4L)
  # BFGS with the adaptation held fixed for a limited number of iterations (the rule is accurate only near the
  # parameters it was adapted to), then the adaptation updated; a run that ends worse (once re-adapted) is undone
  # and the next one shorter, until the log-likelihood settles.
  # (first, from the starting values: the objective re-adapted at each point, which keeps the rule accurate on the
  # way; its maximum is close to, but not exactly, the fixed point of the adaptation that Mplus reaches and the
  # rounds below find)
  if (M$adaptive) {
    fa <- function(t) { adapt(t, 2L); f(t) }
    o <- stats::optim(th, fa, g, method = "BFGS", control = list(maxit = 500, reltol = 1e-8))
    if (is.finite(o$value) && o$value < 1e299) th <- o$par
    adapt(th, 3L)
    if (getOption("qml.trace", FALSE)) message(sprintf("re-adapted BFGS: f %.6f (%d evaluations)", f(th), o$counts[1]))
  }
  prev <- f(th); conv <- FALSE; maxit <- if (M$adaptive) 20L else 2000L
  for (round in seq_len(if (M$adaptive) 80L else 1L)) {
    saved <- M$state$ad
    o <- stats::optim(th, f, g, method = "BFGS", control = list(maxit = maxit, reltol = 1e-10))
    th1 <- o$par
    if (M$adaptive) adapt(th1, 3L)
    cur <- f(th1)
    if (getOption("qml.trace", FALSE)) message(sprintf("round %d: f %.6f (%d evaluations, at most %d iterations)", round, cur, o$counts[1], maxit))
    if (M$adaptive && cur > prev + 1e-6) { M$state$ad <- saved; if (maxit <= 2L) break; maxit <- max(2L, maxit %/% 2L); next }
    th <- th1; conv <- o$convergence == 0
    done <- prev - cur < 1e-4 && conv; prev <- cur
    if (done || !M$adaptive) break
    maxit <- min(400L, maxit * 2L)
  }
  # Newton steps (the Hessian of the gradient, reused while it works: at most three are computed), the adaptation
  # updated after each step.
  H <- NULL; fresh <- FALSE; nh <- 0L; thH <- NULL
  for (it in seq_len(30)) {
    gr <- g(th); if (max(abs(gr)) < 1e-6) break
    if (is.null(H)) { if (nh >= 3L) break; H <- qml_hessian(th, g); thH <- th; nh <- nh + 1L; fresh <- TRUE }
    d <- tryCatch(solve(-H, gr), error = function(e) NULL)
    if (is.null(d) || any(!is.finite(d))) break
    s <- 1; fv <- f(th); ok <- FALSE
    while (s > 1e-4) { tn <- th - s * d; if (f(tn) <= fv + 1e-10) { ok <- TRUE; break }; s <- s / 2 }
    if (!ok) { if (fresh) break; H <- NULL; next }
    if (s < 1) H <- NULL
    fresh <- FALSE
    th <- tn
    if (M$adaptive) adapt(th, 1L)
    if (getOption("qml.trace", FALSE)) message(sprintf("newton %d: f %.6f step %.2g", it, f(th), max(abs(s * d))))
    if (max(abs(s * d)) < 1e-7) break
  }
  if (M$adaptive) adapt(th, 3L)
  # (converged: the gradient at the end, the adaptation updated, is small)
  conv <- isTRUE(max(abs(g(th))) < 1e-3)
  sc <- qml_scores(M, th)
  lp <- lprior(th); ll <- sum(M$w * sc$ll) + lp
  # (the last Newton step's Hessian when the estimates have not moved since, else a new one)
  if (is.null(H) || is.null(thH) || max(abs(th - thH)) > 2e-5) H <- qml_hessian(th, g)
  Hi <- tryCatch(solve(H), error = function(e) NULL)
  robust <- !identical(spec$se, "ml")
  # (H: the Hessian of the log-likelihood, negative definite at the maximum)
  V <- if (is.null(Hi)) NULL else if (robust) Hi %*% crossprod(sc$scores * sqrt(M$w)) %*% Hi else -Hi
  list(M = M, theta = th, ll = ll, logPrior = if (length(ps)) lp else NULL, V = V, k = length(th), converged = conv)
}

qml_report <- function(spec, est) {
  M <- est$M; th <- est$theta
  val <- function(t2) { phi <- drop(M$b + M$A %*% t2); vapply(spec$report, function(r) phi[as.integer(r$slot) + 1], 1) }
  est0 <- val(th); se <- rep(NA_real_, length(est0))
  if (!is.null(est$V) && length(th)) { J <- matrix(M$A[vapply(spec$report, function(r) as.integer(r$slot) + 1L, 1L), , drop = FALSE], length(est0)); se <- sqrt(pmax(0, rowSums((J %*% est$V) * J))) }
  fixed <- vapply(spec$report, function(r) isTRUE(r$fixed), TRUE); se[fixed] <- 0
  lapply(seq_along(est0), function(i) { r <- spec$report[[i]]; list(lhs = r$lhs, op = r$op, rhs = r$rhs %||% "", est = est0[i], se = if (is.finite(se[i])) se[i] else NULL, fixed = fixed[i]) })
}

PS_QML_FUNCTIONS <- c("qml_lse", "qml_rule1", "qml_grid", "qml_model", "qml_gauss", "qml_lin", "qml_ld", "qml_parts", "qml_nodes", "qml_eval", "qml_scores", "qml_hessian", "qml_estimate", "qml_report")

ps_quadml <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  # (the specification as the script reads it: arrays stay lists)
  spec <- jsonlite::fromJSON(req_json, simplifyVector = TRUE, simplifyDataFrame = FALSE, simplifyMatrix = FALSE)$spec
  if (is.null(spec) || !length(spec$outcomes) && !length(spec$gauss$vars)) stop("No model.")
  cols <- as.character(unlist(spec$columns))
  fr <- ps_long_frame(req, cols)
  names(fr$data) <- cols
  for (m in spec$missing) if (m$column %in% cols) fr$data[[m$column]][fr$data[[m$column]] %in% as.numeric(unlist(m$values))] <- NA
  # Cases with a missing covariate are left out (as Mplus does).
  xs <- unique(c(unlist(spec$gauss$x), unlist(lapply(spec$outcomes, function(o) c(vapply(o$xs %||% list(), function(p) as.character(p[[1]]), ""), vapply(o$infl$xs %||% list(), function(p) as.character(p[[1]]), "")))),
    unlist(lapply(spec$outcomes, function(o) if (identical(o$type, "surv") && nzchar(o$censor %||% "")) o$censor))))
  keep <- if (length(xs)) stats::complete.cases(fr$data[, xs, drop = FALSE]) else rep(TRUE, nrow(fr$data))
  ys <- c(unlist(lapply(spec$outcomes, function(o) o$column)), unlist(spec$gauss$cols)); ys <- ys[nzchar(ys)]
  keep <- keep & rowSums(!is.na(fr$data[, ys, drop = FALSE])) > 0
  data <- fr$data[keep, , drop = FALSE]
  integ <- spec$integration
  if (!integ$type %in% c("rect", "gh", "mc")) stop("Invalid integration in the request.")
  pts <- as.integer(integ$points)
  if (!is.finite(pts) || pts < 1 || pts > (if (integ$type == "mc") 100000 else 100)) stop("Invalid number of integration points.")
  body <- c(unlist(lapply(PS_QML_FUNCTIONS, function(f) c(sprintf("%s <- %s", f, paste(deparse(get(f)), collapse = "\n")), ""))),
    "spec <- jsonlite::fromJSON(spec_json, simplifyVector = TRUE, simplifyDataFrame = FALSE, simplifyMatrix = FALSE)",
    "est <- qml_estimate(spec, data)",
    "report <- qml_report(spec, est)")
  spec_json <- as.character(jsonlite::toJSON(spec, auto_unbox = TRUE, digits = NA, null = "null", na = "null"))
  inputs <- list(data = data, spec_json = spec_json)
  if (export) return(paste(ps_script("Maximum likelihood by numerical integration (Mplus ALGORITHM = INTEGRATION)", "jsonlite", inputs, body,
    c("c(logLik = est$ll, npar = est$k, AIC = -2 * est$ll + 2 * est$k, BIC = -2 * est$ll + est$k * log(sum(est$M$w)))",
      "do.call(rbind, lapply(report, function(r) data.frame(lhs = r$lhs, op = r$op, rhs = r$rhs, est = r$est, se = if (is.null(r$se)) NA else r$se)))")), collapse = "\n"))
  env <- ps_run(body, inputs)
  est <- env$est; nobs <- sum(est$M$w); k <- est$k
  if (is.null(est$V)) ps_warning("The information matrix is singular: no standard errors (the model may not be identified).")
  if (!isTRUE(est$converged)) ps_warning("The optimizer did not report convergence.")
  gp <- qml_gauss(est$M, drop(est$M$b + est$M$A %*% est$theta))
  dims <- max(vapply(est$M$pats, function(p) sum(diag(gp$S)[p$D] > 1e-12), 1L))
  ps_json(list(n = nobs, logLik = est$ll, npar = k, aic = -2 * est$ll + 2 * k, bic = -2 * est$ll + k * log(nobs),
    params = env$report, converged = isTRUE(est$converged), theta = est$theta, dims = dims, logPrior = est$logPrior,
    integration = list(type = integ$type, points = pts, adaptive = isTRUE(integ$adaptive)),
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
