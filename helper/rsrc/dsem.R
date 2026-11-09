# Bayesian multilevel and dynamic SEM (the DSEM card, analyses/dsem.tsx): a model written in
# Mplus's syntax for ESTIMATOR = BAYES with TYPE = TWOLEVEL / CROSSCLASSIFIED (RANDOM) or an N = 1
# time series, read by analyses/dsemSyntax.ts into a structural specification (indices, never
# code), from which this file writes a Stan program and samples it with rstan. Desktop R only:
# Stan compiles the program with the computer's C++ toolchain (the program is cached, so a model
# compiles once). The model:
#   within level, row i of cluster j (and k when there are two cluster variables):
#     y = sum of y's between components over the levels + sum of terms + e,  e ~ N(0, v)
#     (v a parameter, or exp(logv) for a random log variance); latent within factors are
#     sampled with the rows; lagged predictors (y&1, f&1) are the within parts of the previous
#     occasions (latent centring: y minus its between components); the two values before a
#     series' first occasion are sampled as missing data, from the variable's residual
#     distribution, and so are missing outcomes; binary outcomes by a probit link.
#   An AR(1) factor measured by a single indicator is integrated out by the Kalman filter instead
#   (ps_dsem_kalman: the same model, without latent values whose variance trades off with the
#   indicator's residual variance).
#   Random effects are sampled centred where clusters have 20 or more rows each, standardised
#   (non-centred) otherwise; loadings start at 1 and latent values at their indicators' mean.
#   between levels: random effects (intercepts, slopes, log variances, between parts of factors),
#     between factors and between outcomes, each a mean + terms (between covariates, factors,
#     other random effects) + a residual; residuals covary in blocks.
# Priors are Mplus's defaults (MODEL PRIORS: normal priors on labelled parameters): flat for means, intercepts, loadings and slopes, flat for the
# variances (IG(-1, 0)) and the covariance matrices of blocks (IW(0, -p-1)); a block with
# variances fixed at a value has a uniform correlation matrix among those, flat covariances with
# the others and a flat conditional covariance matrix.

#' A coefficient: {p: index} a parameter (with i, j an element of a block), {v: value} fixed,
#' {r: index} a random effect (its total over the levels).
ps_dsem_coef <- function(c, np, nre, what) {
  if (!is.list(c)) stop(sprintf("Invalid coefficient (%s) in the request.", what))
  if (!is.null(c$v)) return(list(v = ps_number(c$v, what)))
  if (!is.null(c$p)) {
    p <- as.integer(ps_number(c$p, what))
    if (p < 0 || p >= np) stop(sprintf("Invalid parameter (%s) in the request.", what))
    out <- list(p = p + 1L)
    if (!is.null(c$i)) { out$i <- as.integer(ps_number(c$i, what)) + 1L; out$j <- as.integer(ps_number(c$j, what)) + 1L }
    return(out)
  }
  if (!is.null(c$r)) {
    r <- as.integer(ps_number(c$r, what))
    if (r < 0 || r >= nre) stop(sprintf("Invalid random effect (%s) in the request.", what))
    return(list(r = r + 1L))
  }
  stop(sprintf("Invalid coefficient (%s) in the request.", what))
}

ps_dsem_int <- function(x, lo, hi, what) {
  v <- as.integer(ps_number(x, what))
  if (v < lo || v > hi) stop(sprintf("Invalid %s in the request.", what))
  v
}

#' Read and check the specification; columns are looked up by name in the data (never written as code).
ps_dsem_spec <- function(req) {
  s <- req$spec
  if (!is.list(s)) stop("Invalid model specification in the request.")
  L <- length(s$levels)
  if (L > 2) stop("At most two cluster variables.")
  params <- lapply(s$params, function(p) {
    t <- p$type
    if (!(is.character(t) && length(t) == 1 && t %in% c("real", "pos", "block"))) stop("Invalid parameter type in the request.")
    if (t == "block") {
      fx <- unlist(lapply(p$fixed, function(x) if (is.null(x) || (length(x) == 1 && is.na(x))) NA_real_ else ps_number(x, "fixed variance")))
      k <- length(fx)
      if (k < 1 || k > 30) stop("Invalid block in the request.")
      if (any(!is.na(fx) & fx <= 0)) stop("A fixed variance in a block must be positive.")
      return(list(type = t, k = k, fixed = fx))
    }
    out <- list(type = t)
    if (!is.null(p$start)) { out$start <- ps_number(p$start, "starting value"); if (t == "pos" && out$start <= 0) stop("Invalid starting value in the request.") }
    # (Mplus's N(0, 5) for the loadings and thresholds of categorical outcomes: a mean and a variance)
    if (!is.null(p$prior)) { pr <- unlist(p$prior); if (length(pr) != 2 || !is.numeric(pr) || any(!is.finite(pr)) || pr[2] <= 0) stop("Invalid prior in the request."); out$prior <- pr }
    out
  })
  np <- length(params)
  nre <- length(s$re)
  re <- lapply(s$re, function(r) {
    comps <- r$comps
    if (length(comps) != L) stop("Invalid random effect in the request.")
    lapply(comps, function(cp) if (is.null(cp) || !is.list(cp)) NULL else list(on = TRUE))
  })
  coef <- function(c, what) ps_dsem_coef(c, np, nre, what)
  nodes <- lapply(s$nodes, function(n) {
    k <- n$kind
    if (!(is.character(k) && length(k) == 1 && k %in% c("y", "u", "f", "x"))) stop("Invalid variable kind in the request.")
    out <- list(kind = k)
    if (k != "f") { if (!(is.character(n$column) && length(n$column) == 1)) stop("Invalid column in the request."); out$column <- n$column }
    if (!is.null(n$int)) out$int <- coef(n$int, "intercept")
    if (!is.null(n$thr)) out$thr <- coef(n$thr, "threshold")
    if (!is.null(n$part)) out$part <- ps_dsem_int(n$part, 0, nre - 1, "between part") + 1L
    if (!is.null(n$resid)) out$resid <- coef(n$resid, "residual variance")
    out
  })
  nn <- length(nodes)
  if (!nn) stop("The model has no variables.")
  wterms <- lapply(s$wterms, function(t) list(t = ps_dsem_int(t$t, 0, nn - 1, "term") + 1L,
    p = if (!is.null(t$pb)) NA_integer_ else ps_dsem_int(t$p, 0, nn - 1, "term") + 1L, pb = if (is.null(t$pb)) NULL else ps_dsem_int(t$pb, 0, length(s$btargets) - 1, "term") + 1L,
    lag = ps_dsem_int(t$lag %||% 0, 0, 2, "lag"), load = isTRUE(t$load), c = coef(t$c, "coefficient")))
  wblocks <- lapply(s$wblocks, function(b) list(members = vapply(b$members, function(m) ps_dsem_int(m, 0, nn - 1, "block member") + 1L, 1L), c = coef(b$c, "block")))
  bt <- lapply(s$btargets, function(t) {
    k <- t$kind
    if (!(is.character(k) && length(k) == 1 && k %in% c("re", "bf", "z"))) stop("Invalid between-level variable in the request.")
    out <- list(kind = k, level = ps_dsem_int(t$level, 0, L - 1, "level") + 1L)
    if (k == "re") out$re <- ps_dsem_int(t$re, 0, nre - 1, "random effect") + 1L
    if (k == "z") { if (!(is.character(t$column) && length(t$column) == 1)) stop("Invalid column in the request."); out$column <- t$column }
    out$mean <- if (is.null(t$mean)) list(v = 0) else coef(t$mean, "mean")
    out
  })
  nb <- length(bt)
  bterms <- lapply(s$bterms, function(t) {
    out <- list(t = ps_dsem_int(t$t, 0, nb - 1, "between term") + 1L, c = coef(t$c, "between coefficient"))
    if (!is.null(t$b)) out$b <- ps_dsem_int(t$b, 0, nb - 1, "between term") + 1L
    else if (is.character(t$x) && length(t$x) == 1) out$x <- t$x
    else stop("Invalid between-level term in the request.")
    if (!is.null(out$b) && bt[[out$b]]$level != bt[[out$t]]$level) stop("A between-level term must stay at its level.")
    out
  })
  bblocks <- lapply(s$bblocks, function(b) list(members = vapply(b$members, function(m) ps_dsem_int(m, 0, nb - 1, "block member") + 1L, 1L), c = coef(b$c, "block")))
  for (b in bblocks) if (length(unique(vapply(b$members, function(m) bt[[m]]$level, 1L))) != 1) stop("A block of between-level residuals must stay at one level.")
  report <- lapply(s$report, function(r) list(lhs = as.character(r$lhs), op = as.character(r$op), rhs = as.character(r$rhs %||% ""), block = as.character(r$block %||% ""), c = coef(r$c, "reported value")))
  levels <- lapply(s$levels, function(l) { if (!(is.character(l$column) && length(l$column) == 1)) stop("Invalid cluster column in the request."); list(column = l$column, nested = isTRUE(l$nested)) })
  series <- s$series %||% list()
  sl <- if (is.null(series$level)) 0L else ps_dsem_int(series$level, 0, L, "series level")
  list(levels = levels, series = list(level = sl, time = series$time, interval = if (is.null(series$interval)) NULL else ps_number(series$interval, "time interval")),
    params = params, re = re, nodes = nodes, wterms = wterms, wblocks = wblocks, bt = bt, bterms = bterms, bblocks = bblocks, report = report)
}

#' The Stan data: rows ordered by series and time (TINTERVAL inserts the missing occasions), lags, clusters.
ps_dsem_data <- function(req, s) {
  cols <- unique(c(vapply(s$levels, `[[`, "", "column"), unlist(lapply(s$nodes, `[[`, "column")), unlist(lapply(s$bt, `[[`, "column")),
    unlist(lapply(s$bterms, `[[`, "x")), if (is.character(s$series$time)) s$series$time))
  fr <- ps_long_frame(req, cols)
  d <- fr$data; v <- fr$v
  col <- function(nm) d[[v[[nm]]]]
  L <- length(s$levels)
  # cluster ids (a nested level-2 cluster is unique within its level-3 cluster)
  cid <- lapply(seq_len(L), function(l) col(s$levels[[l]]$column))
  if (L == 2 && s$levels[[1]]$nested) cid[[1]] <- interaction(cid[[2]], cid[[1]], drop = TRUE)
  for (l in seq_len(L)) if (anyNA(cid[[l]])) stop(sprintf("The cluster variable %s has missing values.", s$levels[[l]]$column))
  xs <- unique(unlist(lapply(s$nodes, function(n) if (n$kind == "x") n$column)))
  series <- if (s$series$level > 0) as.character(cid[[s$series$level]]) else rep("1", nrow(d))
  has_lag <- any(vapply(s$wterms, function(t) t$lag > 0, TRUE))
  ord <- seq_len(nrow(d))
  tm <- NULL
  if (is.character(s$series$time)) {
    tm <- col(s$series$time)
    if (anyNA(tm)) stop("The time variable has missing values.")
    step <- s$series$interval %||% 1
    if (step <= 0) stop("The time interval must be positive.")
    tm <- round(tm / step)
    ord <- order(match(series, unique(series)), tm)
  } else ord <- order(match(series, unique(series)), seq_len(nrow(d)))
  d <- d[ord, , drop = FALSE]; series <- series[ord]; cid <- lapply(cid, function(x) x[ord])
  if (!is.null(tm)) {
    tm <- tm[ord]
    if (any(duplicated(paste(series, tm)))) stop("Two rows of a series have the same time.")
    # missing occasions: a row for each skipped time step (outcomes missing)
    fill <- do.call(rbind, lapply(split(seq_along(series), factor(series, unique(series))), function(ix) {
      t0 <- tm[ix]; full <- seq(min(t0), max(t0))
      data.frame(src = ix[match(full, t0)], first = ix[1], t = full)
    }))
    if (nrow(fill) > 5 * nrow(d)) stop("The time intervals insert too many missing occasions.")
    nd <- d[ifelse(is.na(fill$src), fill$first, fill$src), , drop = FALSE]
    miss <- is.na(fill$src)
    for (n in s$nodes) if (n$kind %in% c("y", "u")) nd[[v[[n$column]]]][miss] <- NA
    series <- series[fill$first]; cid <- lapply(cid, function(x) x[fill$first])
    d <- nd
  }
  for (n in s$nodes) if (n$kind == "x" && anyNA(col(n$column))) {
    if (has_lag) stop(sprintf("The covariate %s has missing values in a time series; the rows cannot be dropped.", n$column))
    keep <- !is.na(col(n$column)); d <- d[keep, , drop = FALSE]; series <- series[keep]; cid <- lapply(cid, function(x) x[keep])
  }
  N <- nrow(d)
  if (N < 2) stop("Too few rows.")
  pos <- ave(seq_len(N), series, FUN = seq_along)
  # Lags index append_row(pre, values): pre holds each series' two values before its first occasion (times 0 and -1,
  # sampled as missing data), then the rows.
  sid <- match(series, unique(series)); S <- max(sid)
  at <- function(lag) { t <- pos - lag; ifelse(t >= 1, 2L * S + seq_len(N) - lag, (sid - 1L) * 2L + (1L - t)) }
  sd <- list(N = N, S = S, sid = as.integer(sid), first = as.array(as.integer(match(seq_len(S), sid))), lag1 = as.integer(at(1)), lag2 = as.integer(at(2)))
  J <- integer(L)
  for (l in seq_len(L)) {
    f <- factor(as.character(cid[[l]]), levels = unique(as.character(cid[[l]])))
    sd[[sprintf("cl%d", l)]] <- as.integer(f); J[l] <- nlevels(f); sd[[sprintf("J%d", l)]] <- J[l]
    cid[[l]] <- f
  }
  for (k in seq_along(s$nodes)) {
    n <- s$nodes[[k]]
    if (n$kind == "f") next
    x <- as.numeric(col(n$column))
    if (n$kind == "y") {
      mis <- which(is.na(x)); x[mis] <- 0
      sd[[sprintf("y%d", k)]] <- x; sd[[sprintf("nm%d", k)]] <- length(mis); sd[[sprintf("mi%d", k)]] <- as.array(as.integer(mis))
    } else if (n$kind == "u") {
      if (any(!is.na(x) & !(x %in% c(0, 1)))) stop(sprintf("%s: binary outcomes are coded 0 and 1 (ordinal outcomes with more categories are not available here).", n$column))
      sd[[sprintf("n1_%d", k)]] <- sum(x == 1, na.rm = TRUE); sd[[sprintf("i1_%d", k)]] <- as.array(which(x == 1))
      sd[[sprintf("n0_%d", k)]] <- sum(x == 0, na.rm = TRUE); sd[[sprintf("i0_%d", k)]] <- as.array(which(x == 0))
    } else if (n$kind == "x") sd[[sprintf("x%d", k)]] <- x
  }
  # between-level covariates and outcomes: one value per cluster (the first non-missing row's)
  per <- function(nm, l) { x <- as.numeric(col(nm)); vapply(split(x, cid[[l]]), function(z) { z <- z[!is.na(z)]; if (length(z)) z[1] else NA_real_ }, 0) }
  for (i in seq_along(s$bterms)) { t <- s$bterms[[i]]; if (!is.null(t$x)) {
    l <- s$bt[[t$t]]$level; x <- per(t$x, l)
    if (anyNA(x)) stop(sprintf("The between-level covariate %s is missing for some clusters.", t$x))
    sd[[sprintf("bx%d", i)]] <- unname(x) } }
  for (i in seq_along(s$bt)) { t <- s$bt[[i]]; if (t$kind == "z") {
    z <- unname(per(t$column, t$level)); ok <- which(!is.na(z))
    sd[[sprintf("nz%d", i)]] <- length(ok); sd[[sprintf("iz%d", i)]] <- as.array(as.integer(ok)); sd[[sprintf("z%d", i)]] <- as.array(z[ok]) } }
  list(data = sd, N = N, J = J, series = length(unique(series)))
}

#' Latent within factors that the Kalman filter integrates out: a factor with no between part and a residual variance
#' of its own (not random, not in a block), regressed on its own previous value only (the AR coefficient fixed, a
#' parameter or a random effect), measured by a single continuous indicator (a loading not random) that has a residual
#' variance of its own and nothing else in the within model. Returns list(f, y, ar, load) per such factor.
ps_dsem_kalman <- function(s) {
  nodes <- s$nodes; wt <- s$wterms
  inb <- unlist(lapply(s$wblocks, `[[`, "members"))
  plain <- function(c) !is.null(c) && is.null(c$r)
  out <- list()
  for (k in seq_along(nodes)) {
    n <- nodes[[k]]
    if (n$kind != "f" || !is.null(n$part) || k %in% inb || !plain(n$resid)) next
    to <- Filter(function(t) t$t == k, wt)
    from <- Filter(function(t) !is.na(t$p) && t$p == k, wt)
    if (length(to) != 1 || is.null(to[[1]]$pb) == FALSE || is.na(to[[1]]$p) || to[[1]]$p != k || to[[1]]$lag != 1) next
    ind <- Filter(function(t) !(t$t == k && t$lag == 1), from)
    if (length(ind) != 1 || ind[[1]]$lag != 0 || !isTRUE(ind[[1]]$load) || !plain(ind[[1]]$c)) next
    m <- ind[[1]]$t
    if (nodes[[m]]$kind != "y" || m %in% inb || !plain(nodes[[m]]$resid)) next
    if (length(Filter(function(t) t$t == m, wt)) != 1 || length(Filter(function(t) !is.na(t$p) && t$p == m, wt))) next
    out[[length(out) + 1]] <- list(f = k, y = m, ar = to[[1]]$c, load = ind[[1]]$c)
  }
  out
}

#' The Stan program (names are indices: nothing from the request is written as text).
ps_dsem_stan <- function(s, centered = rep(FALSE, length(s$levels))) {
  L <- length(s$levels)
  D <- c("data {", "  int<lower=1> N;", "  int<lower=1> S;", "  array[N] int<lower=1, upper=S> sid;", "  array[S] int<lower=1, upper=N> first;",
    "  array[N] int<lower=1> lag1;", "  array[N] int<lower=1> lag2;")
  for (l in seq_len(L)) D <- c(D, sprintf("  int<lower=1> J%d;", l), sprintf("  array[N] int<lower=1, upper=J%d> cl%d;", l, l))
  P <- c("parameters {"); TP <- c("transformed parameters {"); M <- c("model {")
  # parameters
  for (i in seq_along(s$params)) {
    p <- s$params[[i]]
    if (!is.null(p$prior)) M <- c(M, sprintf("  p%d ~ normal(%s, %s);", i, format(p$prior[1], digits = 15), format(sqrt(p$prior[2]), digits = 15)))
    if (p$type == "real") P <- c(P, sprintf("  real p%d;", i))
    else if (p$type == "pos") P <- c(P, sprintf("  real<lower=0> p%d;", i))
    else {
      fx <- p$fixed; A <- which(!is.na(fx)); B <- which(is.na(fx)); k <- p$k
      TP <- c(TP, sprintf("  cov_matrix[%d] p%d;", k, i))
      if (!length(A)) { P <- c(P, sprintf("  cov_matrix[%d] p%d_s;", k, i)); TP <- c(TP, sprintf("  p%d = p%d_s;", i, i)); next }
      ia <- paste(A, collapse = ", "); ib <- paste(B, collapse = ", ")
      if (length(A) > 1) P <- c(P, sprintf("  corr_matrix[%d] p%d_r;", length(A), i))
      TP <- c(TP, "  {", sprintf("    vector[%d] sa = sqrt([%s]');", length(A), paste(format(fx[A], digits = 15), collapse = ", ")),
        if (length(A) > 1) sprintf("    matrix[%d, %d] saa = quad_form_diag(p%d_r, sa);", length(A), length(A), i) else "    matrix[1, 1] saa = rep_matrix(square(sa[1]), 1, 1);",
        sprintf("    p%d[{%s}, {%s}] = saa;", i, ia, ia))
      if (length(B)) {
        P <- c(P, sprintf("  matrix[%d, %d] p%d_c;", length(B), length(A), i), sprintf("  cov_matrix[%d] p%d_s;", length(B), i))
        TP <- c(TP, sprintf("    p%d[{%s}, {%s}] = p%d_c;", i, ib, ia, i), sprintf("    p%d[{%s}, {%s}] = p%d_c';", i, ia, ib, i),
          sprintf("    p%d[{%s}, {%s}] = p%d_s + quad_form_sym(saa, mdivide_left_spd(saa, p%d_c'));", i, ib, ib, i, i))
      }
      TP <- c(TP, "  }")
    }
  }
  cval <- function(c, rows = FALSE) {
    if (!is.null(c$v)) return(format(c$v, digits = 15))
    if (!is.null(c$p)) return(if (!is.null(c$i)) sprintf("p%d[%d, %d]", c$p, c$i, c$j) else sprintf("p%d", c$p))
    if (!is.null(c$r)) return(sprintf("re%d", c$r))
  }
  # ---- between levels ----
  bt <- s$bt; nb <- length(bt)
  # topological order of the between targets (a term's predictor first)
  deps <- lapply(seq_len(nb), function(i) unlist(lapply(s$bterms, function(t) if (t$t == i && !is.null(t$b)) t$b)))
  ordr <- integer(0)
  while (length(ordr) < nb) {
    ready <- setdiff(which(vapply(seq_len(nb), function(i) all(deps[[i]] %in% ordr), TRUE)), ordr)
    if (!length(ready)) stop("The between-level regressions form a loop.")
    ordr <- c(ordr, ready)
  }
  blockof <- integer(nb)
  for (b in seq_along(s$bblocks)) blockof[s$bblocks[[b]]$members] <- b
  for (b in seq_along(s$bblocks)) {
    bl <- s$bblocks[[b]]; l <- bt[[bl$members[1]]]$level; k <- length(bl$members)
    if (any(vapply(bl$members, function(m) bt[[m]]$kind == "z", TRUE))) next
    P <- c(P, sprintf("  matrix[J%d, %d] zb%d;", l, k, b))
    single <- !is.null(bl$c$v) || (is.null(bl$c$i) && s$params[[bl$c$p]]$type != "block")
    sdb <- if (!is.null(bl$c$v)) sprintf("sqrt(%s)", format(bl$c$v, digits = 15)) else if (single) sprintf("sqrt(p%d)", bl$c$p) else NULL
    if (centered[l]) {
      # clusters with many observations each: the residuals themselves (centred), which their data determine well
      M <- c(M, if (single) sprintf("  to_vector(zb%d) ~ normal(0, %s);", b, sdb)
        else sprintf("  { matrix[%d, %d] Lb = cholesky_decompose(p%d); for (j in 1:J%d) zb%d[j]' ~ multi_normal_cholesky(rep_vector(0, %d), Lb); }", k, k, bl$c$p, l, b, k))
      TP <- c(TP, sprintf("  matrix[J%d, %d] eb%d = zb%d;", l, k, b, b))
    } else {
      # few observations per cluster: standardised residuals (non-centred)
      M <- c(M, sprintf("  to_vector(zb%d) ~ std_normal();", b))
      TP <- c(TP, sprintf("  matrix[J%d, %d] eb%d = %s;", l, k, b, if (single) sprintf("zb%d * %s", b, sdb) else sprintf("zb%d * cholesky_decompose(p%d)'", b, bl$c$p)))
    }
  }
  for (i in ordr) {
    t <- bt[[i]]; l <- t$level
    if (t$kind == "z") next
    rhs <- sprintf("rep_vector(%s, J%d)", cval(t$mean), l)
    for (j in seq_along(s$bterms)) { tm <- s$bterms[[j]]; if (tm$t == i) rhs <- paste(rhs, "+", if (!is.null(tm$b)) sprintf("%s * bt%d", cval(tm$c), tm$b) else sprintf("%s * bx%d", cval(tm$c), j)) }
    if (blockof[i]) rhs <- paste(rhs, "+", sprintf("eb%d[:, %d]", blockof[i], match(i, s$bblocks[[blockof[i]]]$members)))
    TP <- c(TP, sprintf("  vector[J%d] bt%d = %s;", l, i, rhs))
  }
  for (j in seq_along(s$bterms)) if (!is.null(s$bterms[[j]]$x)) D <- c(D, sprintf("  vector[J%d] bx%d;", bt[[s$bterms[[j]]$t]]$level, j))
  for (i in seq_len(nb)) {
    t <- bt[[i]]
    if (t$kind != "z") next
    D <- c(D, sprintf("  int<lower=0> nz%d;", i), sprintf("  array[nz%d] int iz%d;", i, i), sprintf("  vector[nz%d] z%d;", i, i))
    mu <- sprintf("rep_vector(%s, J%d)", cval(t$mean), t$level)
    for (j in seq_along(s$bterms)) { tm <- s$bterms[[j]]; if (tm$t == i) mu <- paste(mu, "+", if (!is.null(tm$b)) sprintf("%s * bt%d", cval(tm$c), tm$b) else sprintf("%s * bx%d", cval(tm$c), j)) }
    if (!blockof[i] || length(s$bblocks[[blockof[i]]]$members) != 1) stop("A between-level outcome needs a residual variance of its own.")
    M <- c(M, sprintf("  z%d ~ normal((%s)[iz%d], sqrt(%s));", i, mu, i, cval(s$bblocks[[blockof[i]]]$c)))
  }
  # random effects' totals over the levels, per row
  M <- c(M, "  // random effects per row (the sum of their components over the levels)")
  for (r in seq_along(s$re)) {
    parts <- unlist(lapply(seq_len(L), function(l) { i <- which(vapply(bt, function(t) t$kind == "re" && t$re == r && t$level == l, TRUE)); if (length(i)) sprintf("bt%d[cl%d]", i, l) }))
    M <- c(M, sprintf("  vector[N] re%d = %s;", r, if (length(parts)) paste(parts, collapse = " + ") else "rep_vector(0, N)"))
  }
  # ---- within level ----
  nodes <- s$nodes
  kal <- ps_dsem_kalman(s)
  kf <- vapply(kal, `[[`, 1L, "f"); ky <- vapply(kal, `[[`, 1L, "y")
  for (k in seq_along(nodes)) {
    n <- nodes[[k]]
    if (k %in% kf) next
    if (n$kind == "y") {
      D <- c(D, sprintf("  vector[N] y%d;", k), sprintf("  int<lower=0> nm%d;", k), sprintf("  array[nm%d] int mi%d;", k, k))
      if (k %in% ky) {
        # (a series filtered by the Kalman filter below: its missing values are skipped, not sampled)
        base <- c(if (!is.null(n$int)) sprintf("rep_vector(%s, N)", cval(n$int)), if (!is.null(n$part)) sprintf("re%d", n$part))
        M <- c(M, sprintf("  vector[N] B%d = %s;", k, if (length(base)) paste(base, collapse = " + ") else "rep_vector(0, N)"))
        next
      }
      P <- c(P, sprintf("  vector[nm%d] ym%d;", k, k))
      M <- c(M, sprintf("  vector[N] Y%d = y%d;", k, k), sprintf("  Y%d[mi%d] = ym%d;", k, k, k))
      base <- c(if (!is.null(n$int)) sprintf("rep_vector(%s, N)", cval(n$int)), if (!is.null(n$part)) sprintf("re%d", n$part))
      M <- c(M, sprintf("  vector[N] B%d = %s;", k, if (length(base)) paste(base, collapse = " + ") else "rep_vector(0, N)"), sprintf("  vector[N] W%d = Y%d - B%d;", k, k, k))
    } else if (n$kind == "u") {
      D <- c(D, sprintf("  int<lower=0> n1_%d;", k), sprintf("  array[n1_%d] int i1_%d;", k, k), sprintf("  int<lower=0> n0_%d;", k), sprintf("  array[n0_%d] int i0_%d;", k, k))
      base <- c(if (!is.null(n$thr)) sprintf("rep_vector(-%s, N)", cval(n$thr)), if (!is.null(n$part)) sprintf("re%d", n$part))
      M <- c(M, sprintf("  vector[N] B%d = %s;", k, if (length(base)) paste(base, collapse = " + ") else "rep_vector(0, N)"))
    } else if (n$kind == "f") {
      P <- c(P, sprintf("  vector[N] W%d;", k))
      M <- c(M, sprintf("  vector[N] F%d = W%d%s;", k, k, if (!is.null(n$part)) sprintf(" + re%d", n$part) else ""))
    } else D <- c(D, sprintf("  vector[N] x%d;", k))
  }
  lagged <- function(k, lag, load) {
    n <- nodes[[k]]
    v <- if (n$kind == "x") sprintf("x%d", k) else if (n$kind == "f" && load) sprintf("F%d", k) else sprintf("W%d", k)
    if (n$kind == "u") stop("A binary outcome cannot be a predictor here.")
    if (lag == 0) v else sprintf("append_row(%s, %s)[lag%d]", if (n$kind == "x") "rep_vector(0, 2 * S)" else sprintf("pre%d", k), v, lag)
  }
  # values before each series' first occasion: parameters, drawn from the variable's residual distribution
  lagnodes <- setdiff(unique(unlist(lapply(s$wterms, function(t) if (t$lag > 0 && !is.na(t$p) && nodes[[t$p]]$kind != "x") t$p))), kf)
  inblock0 <- integer(length(nodes))
  for (b in seq_along(s$wblocks)) inblock0[s$wblocks[[b]]$members] <- b
  for (k in lagnodes) {
    P <- c(P, sprintf("  vector[2 * S] pre%d;", k))
    res <- nodes[[k]]$resid
    if (!inblock0[k] && !is.null(res$r)) {
      M <- c(M, sprintf("  { vector[S] sf = exp(0.5 * re%d[first]); vector[2 * S] sp; for (j in 1:S) { sp[2 * j - 1] = sf[j]; sp[2 * j] = sf[j]; } pre%d ~ normal(0, sp); }", res$r, k))
      next
    }
    sdp <- if (inblock0[k]) { bl <- s$wblocks[[inblock0[k]]]; i <- match(k, bl$members); sprintf("sqrt(%s[%d, %d])", cval(bl$c), i, i) } else sprintf("sqrt(%s)", cval(res))
    M <- c(M, sprintf("  pre%d ~ normal(0, %s);", k, sdp))
  }
  mu <- list()
  for (k in seq_along(nodes)) if (nodes[[k]]$kind != "x") {
    terms <- unlist(lapply(s$wterms, function(t) if (t$t == k) {
      cf <- cval(t$c)
      pv <- if (!is.null(t$pb)) { if (bt[[t$pb]]$kind != "bf") stop("Invalid between-level predictor in the request."); sprintf("bt%d[cl%d]", t$pb, bt[[t$pb]]$level) } else lagged(t$p, t$lag, t$load)
      if (!is.null(t$c$r)) sprintf("%s .* %s", cf, pv) else sprintf("%s * %s", cf, pv) }))
    mu[[k]] <- if (length(terms)) paste(terms, collapse = " + ") else "rep_vector(0, N)"
  }
  inblock <- integer(length(nodes))
  for (b in seq_along(s$wblocks)) inblock[s$wblocks[[b]]$members] <- b
  sdv <- function(c) if (!is.null(c$r)) sprintf("exp(0.5 * re%d)", c$r) else sprintf("sqrt(%s)", cval(c))
  for (k in seq_along(nodes)) {
    n <- nodes[[k]]
    if (n$kind == "x" || inblock[k] || k %in% c(kf, ky)) next
    res <- n$resid %||% list(v = if (n$kind == "u") 1 else 0)
    if (n$kind == "u") {
      eta <- sprintf("(B%d + %s)", k, mu[[k]])
      M <- c(M, sprintf("  target += std_normal_lcdf(%s[i1_%d] / %s) + std_normal_lccdf(%s[i0_%d] / %s);", eta, k, sdv(res), eta, k, sdv(res)))
      next
    }
    if (!is.null(res$v) && res$v == 0) stop("A variable with a residual variance of 0 is not available here.")
    M <- c(M, sprintf("  W%d ~ normal(%s, %s);", k, mu[[k]], sdv(res)))
  }
  for (b in seq_along(s$wblocks)) {
    bl <- s$wblocks[[b]]; ms <- bl$members; kk <- length(ms)
    M <- c(M, "  {", sprintf("    matrix[N, %d] E;", kk), sprintf("    E[:, %d] = W%d - (%s);", seq_len(kk), ms, vapply(ms, function(k) mu[[k]], "")),
      sprintf("    matrix[%d, %d] Lw = cholesky_decompose(%s);", kk, kk, cval(bl$c)),
      "    for (i in 1:N) target += multi_normal_cholesky_lpdf(E[i]' | rep_vector(0, rows(Lw)), Lw);", "  }")
  }
  # An AR(1) factor measured by one indicator: the factor integrated out by the Kalman filter, series by series (the
  # same model; sampled as latent values, its variance and the indicator's residual variance trade off and the chains
  # barely move). The value before a series' first occasion is N(0, v) as above.
  for (q in kal) {
    k <- q$f; m <- q$y
    if (is.null(nodes[[k]]$resid) || is.null(nodes[[m]]$resid)) stop("Invalid filtered series in the request.")
    ph <- if (!is.null(q$ar$r)) sprintf("re%d[i]", q$ar$r) else cval(q$ar)
    M <- c(M, "  {",
      sprintf("    array[N] int ob = rep_array(1, N); ob[mi%d] = rep_array(0, nm%d);", m, m),
      sprintf("    real vf = %s; real ve = %s; real lam = %s;", cval(nodes[[k]]$resid), cval(nodes[[m]]$resid), cval(q$load)),
      "    real mk = 0; real Pk = vf;",
      "    for (i in 1:N) {",
      "      if (i == first[sid[i]]) { mk = 0; Pk = vf; }",
      sprintf("      real ph = %s; real mp = ph * mk; real Pp = square(ph) * Pk + vf;", ph),
      "      if (ob[i]) {",
      sprintf("        real e = y%d[i] - B%d[i] - lam * mp; real Sv = square(lam) * Pp + ve; real K = Pp * lam / Sv;", m, m),
      "        target += normal_lpdf(e | 0, sqrt(Sv)); mk = mp + K * e; Pk = Pp - K * lam * Pp;",
      "      } else { mk = mp; Pk = Pp; }",
      "    }",
      "  }")
  }
  if (length(P) == 1) P <- c(P, "  real dummy__;")
  structure(paste(c(D, "}", P, "}", TP, "}", M, "}"), collapse = "\n"),
    # (the latent values, the random effects' standardised residuals and the missing outcomes start at 0 or the
    # outcome's mean: with the loadings starting at 1, the chains begin in the mode with positive loadings)
    zeros = regmatches(P, regexpr("(zb|ym|W|pre)[0-9]+(?=;$)", P, perl = TRUE)))
}

#' A latent variable's starting values: the mean of its observed indicators, each centred (a crude factor score, of
#' the sign of loadings that start at 1, and with the indicators' variation, so that the chains begin in the mode with
#' positive loadings and with the factor's variance away from 0); 0 when no observed variable measures it.
ps_dsem_score <- function(s, dd, k) {
  ind <- unique(unlist(lapply(s$wterms, function(t) if (isTRUE(t$load) && identical(t$p, k) && s$nodes[[t$t]]$kind %in% c("y", "u")) t$t)))
  if (!length(ind)) return(rep(0, dd$N))
  cols <- lapply(ind, function(i) {
    if (s$nodes[[i]]$kind == "y") { y <- dd[[sprintf("y%d", i)]]; y[dd[[sprintf("mi%d", i)]]] <- NA }
    else { y <- rep(NA_real_, dd$N); y[dd[[sprintf("i1_%d", i)]]] <- 1; y[dd[[sprintf("i0_%d", i)]]] <- 0 }
    # (an indicator with a between part: centred within its clusters, so the start of the within factor carries no
    # cluster-level variation, which the between parts and between factors start with)
    y <- y - mean(y, na.rm = TRUE)
    if (!is.null(s$nodes[[i]]$part)) for (l in seq_along(s$levels)) if (!is.null(s$re[[s$nodes[[i]]$part]][[l]])) {
      cl <- dd[[sprintf("cl%d", l)]]; m <- tapply(y, cl, mean, na.rm = TRUE); m[!is.finite(m)] <- 0; y <- y - m[cl]
    }
    y
  })
  # (0.7 of the indicators' mean: the start leaves the residuals part of the variation, so that neither the factor's nor
  # the residual variance starts at 0, which a single indicator would otherwise give)
  sc <- 0.7 * rowMeans(do.call(cbind, cols), na.rm = TRUE)
  sc[!is.finite(sc)] <- 0
  sc
}

#' Starting values of a block of between-level residuals: 0, but for a between-level factor its indicators' cluster
#' means, centred, averaged and standardised (as ps_dsem_score on the within level).
ps_dsem_bscore <- function(s, dd, k) {
  ms <- s$bblocks[[k]]$members; l <- s$bt[[ms[1]]]$level; J <- dd[[sprintf("J%d", l)]]
  out <- matrix(0, J, length(ms))
  for (m in seq_along(ms)) {
    if (s$bt[[ms[m]]]$kind != "bf") next
    res <- unlist(lapply(s$bterms, function(t) if (identical(t$b, ms[m]) && s$bt[[t$t]]$kind == "re") s$bt[[t$t]]$re))
    nd <- which(vapply(s$nodes, function(n) !is.null(n$part) && n$part %in% res && n$kind == "y", TRUE))
    if (!length(nd)) next
    cl <- dd[[sprintf("cl%d", l)]]
    cols <- lapply(nd, function(i) { y <- dd[[sprintf("y%d", i)]]; y[dd[[sprintf("mi%d", i)]]] <- NA; v <- tapply(y, factor(cl, levels = seq_len(J)), mean, na.rm = TRUE); v - mean(v, na.rm = TRUE) })
    sc <- rowMeans(do.call(cbind, cols), na.rm = TRUE); sc[!is.finite(sc)] <- 0
    if (stats::sd(sc) > 0) out[, m] <- sc / stats::sd(sc)
  }
  out
}

#' Bayesian multilevel / DSEM model by Stan (desktop R).
ps_dsem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (grepl("emscripten", R.version$platform)) stop("Bayesian multilevel and DSEM models (Stan) run in desktop R: choose Desktop R (helper) under R runs in.")
  chains <- ps_dsem_int(req$chains %||% 2, 1, 8, "number of chains")
  warmup <- ps_dsem_int(req$warmup %||% 1000, 100, 1e5, "burn-in")
  draws <- ps_dsem_int(req$draws %||% 1000, 100, 1e5, "number of draws")
  cores <- ps_dsem_int(req$cores %||% 1, 1, 64, "number of cores")
  seed <- ps_bayes_seed(req); conf <- ps_bt_conf(req)
  s <- ps_dsem_spec(req)
  sdat <- ps_dsem_data(req, s)
  # (a level whose clusters have 20 or more rows each: its random effects centred, unless the request asks for
  # standardised random effects on every level)
  par <- req[["parametrization", exact = TRUE]] %||% "auto"
  if (!(is.character(par) && length(par) == 1 && par %in% c("auto", "noncentred"))) stop("Invalid parametrization in the request.")
  code <- ps_dsem_stan(s, centered = vapply(seq_along(s$levels), function(l) par == "auto" && sdat$N / sdat$J[l] >= 20, TRUE))
  keep <- unique(c(sprintf("p%d", seq_along(s$params))))
  q <- c((1 - conf) / 2, 1 - (1 - conf) / 2)
  body <- c(
    "suppressPackageStartupMessages(library(rstan))",
    "# The model as a Stan program (Mplus's default priors: flat; see the header of PLS Studio's R/dsem.R).",
    "code <- '", ps_sq(code), "'",
    "# Compiled once per model (cached as an .rds next to the program's file).",
    "cache <- file.path(tools::R_user_dir(\"pls-studio\", \"cache\"), \"stan\"); dir.create(cache, recursive = TRUE, showWarnings = FALSE)",
    "tmp <- tempfile(fileext = \".stan\"); writeLines(code, tmp)",
    "stan_file <- file.path(cache, paste0(\"dsem_\", unname(tools::md5sum(tmp)), \".stan\")); if (!file.exists(stan_file)) file.copy(tmp, stan_file)",
    "mod <- tryCatch(rstan::stan_model(file = stan_file, auto_write = TRUE), error = function(e) stop(\"Stan could not compile the model: a C++ toolchain is needed (macOS: Xcode Command Line Tools, xcode-select --install; Windows: Rtools; Linux: g++ and make). \", conditionMessage(e)))",
    sprintf("fit <- rstan::sampling(mod, data = standata, chains = %d, warmup = %d, iter = %d, seed = %d, cores = %d, refresh = 0, pars = %s, init = if (length(inits[[1]])) inits else \"random\")",
      chains, warmup, warmup + draws, seed, min(cores, chains), ps_q(keep)),
    "summ <- rstan::summary(fit)$summary",
    "post <- as.matrix(fit)")
  # Starting values where the model gives them (loadings 1: the chains begin in the mode with positive loadings, as
  # Mplus's; the rest Stan's random starts)
  st <- Filter(Negate(is.null), setNames(lapply(s$params, function(p) p$start), sprintf("p%d", seq_along(s$params))))
  dd <- sdat$data
  for (z in attr(code, "zeros")) {
    k <- as.integer(sub("^[a-zA-Z]+", "", z))
    st[[z]] <- switch(sub("[0-9]+$", "", z),
      zb = ps_dsem_bscore(s, dd, k),
      ym = { y <- dd[[sprintf("y%d", k)]]; m <- if (length(dd[[sprintf("mi%d", k)]]) < length(y)) mean(y[-dd[[sprintf("mi%d", k)]]]) else 0; as.array(rep(m, dd[[sprintf("nm%d", k)]])) },
      W = ps_dsem_score(s, dd, k), pre = rep(0, 2 * dd$S))
  }
  inputs <- list(standata = sdat$data, inits = lapply(seq_len(chains), function(i) st))
  if (export) return(paste(ps_script("Bayesian multilevel / DSEM model (Stan)", c("rstan"), inputs, body, c("print(fit, digits = 3)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  post <- env$post; summ <- env$summ
  colv <- function(c) {
    if (!is.null(c$v)) return(rep(c$v, nrow(post)))
    nm <- if (!is.null(c$i)) sprintf("p%d[%d,%d]", c$p, c$i, c$j) else sprintf("p%d", c$p)
    post[, nm]
  }
  stat <- function(c) {
    if (!is.null(c$v)) return(list(fixed = TRUE, median = c$v, mean = c$v, sd = 0, low = c$v, high = c$v, rhat = NULL, neff = NULL, pOne = NULL))
    if (!is.null(c$r)) stop("A random effect cannot be reported.")
    nm <- if (!is.null(c$i)) sprintf("p%d[%d,%d]", c$p, c$i, c$j) else sprintf("p%d", c$p)
    x <- post[, nm]
    list(fixed = FALSE, median = stats::median(x), mean = mean(x), sd = stats::sd(x), low = unname(stats::quantile(x, q[1])), high = unname(stats::quantile(x, q[2])),
      rhat = unname(summ[nm, "Rhat"]), neff = unname(summ[nm, "n_eff"]), pOne = min(mean(x > 0), mean(x < 0)))
  }
  rows <- lapply(s$report, function(r) c(list(lhs = r$lhs, op = r$op, rhs = r$rhs, block = r$block), stat(r$c)))
  free <- Filter(function(r) !r$fixed, rows)
  rh <- vapply(free, function(r) r$rhat %||% NA_real_, 0); ne <- vapply(free, function(r) r$neff %||% NA_real_, 0)
  maxr <- if (length(rh) && any(is.finite(rh))) max(rh, na.rm = TRUE) else NA_real_
  sp <- rstan::get_sampler_params(env$fit, inc_warmup = FALSE)
  div <- sum(vapply(sp, function(x) sum(x[, "divergent__"]), 0))
  ps_json(list(chains = chains, warmup = warmup, draws = draws, seed = seed, confidence = conf, n = sdat$N, clusters = I(sdat$J), series = sdat$series,
    parameters = rows, maxRhat = maxr, minNeff = if (length(ne) && any(is.finite(ne))) min(ne, na.rm = TRUE) else NA_real_,
    converged = is.finite(maxr) && maxr < 1.05, divergent = div,
    npar = length(unique(unlist(lapply(s$report, function(r) if (!is.null(r$c$p)) paste(r$c$p, r$c$i %||% 0, r$c$j %||% 0))))),
    warnings = env$.warnings, engine = list(package = "rstan", version = as.character(utils::packageVersion("rstan")))))
}
