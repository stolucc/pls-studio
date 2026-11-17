# Monte Carlo simulation with the R packages. Data: lavaan::simulateData from
# the population covariance matrix of the indicators (Vale-Maurelli for
# non-normal data). Estimation: cSEM (PLS / PLSc, bootstrap percentile CIs) and
# lavaan (CB-SEM, Wald CIs in the marker metric, Monte Carlo CIs for indirect
# effects, the model chi-square test). Per-replication seeds come from the app
# so results do not depend on how replications are split into chunks.

#' The script for one sample size and a set of replications (seeds given).
ps_mc_body <- function(req) {
  spec <- req$spec
  # Missing values (checked by ps_validate); none: rate 0.
  nr <- req$nonresponse
  miss <- list(
    rate = if (is.null(nr)) 0 else ps_number(nr$rate, "missing-value rate"),
    mar = identical(nr$mechanism, "MAR"),
    pls = c(mean = "mean", casewise = "casewise")[[nr$pls %||% "mean"]],
    cb = c(casewise = "listwise", fiml = "ml")[[nr$cb %||% "casewise"]]
  )
  # Bootstrap inference (checked by ps_validate): cSEM's sign-change option and the interval reported.
  # (individual is applied to the draws in pls_stats: cSEM 0.7.1's own fails on a model without indirect effects,
  # sign() of its empty indirect-effect estimates)
  sign_change <- c(none = "none", individual = "none", construct = "construct_reestimate")[[req$inference$signChange %||% "none"]]
  individual <- identical(req$inference$signChange, "individual")
  interval <- c(percentile = "percentile", normal = "normal", basic = "basic", bca = "bca")[[req$inference$interval %||% "percentile"]]
  # Ordinal indicators: the thresholds to cut at (from the app), none: continuous.
  cuts <- vapply(req$ordinal$thresholds %||% list(), function(t) ps_number(t, "threshold"), 0)
  n <- ps_names(spec$constructs)
  cv <- n$cv
  vars <- unname(n$iv[req$population$names])
  S <- req$population$Sigma
  # Fleishman's polynomial per indicator (a, b, c, d rows), applied to normal data: none for Vale-Maurelli.
  fl <- req$population$fleishman
  fleishman <- NULL
  if (length(fl)) {
    # (jsonlite reads the rows as a matrix; a list of rows is bound into one)
    m <- if (is.matrix(fl)) fl else do.call(rbind, fl)
    if (ncol(m) != 4) stop("Fleishman coefficients come in rows of four")
    fleishman <- matrix(vapply(m, function(v) ps_number(v, "Fleishman coefficient"), 0), nrow(m))
  }
  # Estimation models: PLS keeps factors (=~) and composites (<~), unless the design estimates every construct as a
  # common factor (factorModel); CB-SEM treats every construct as a common factor.
  ind <- function(j) unname(n$iv[n$inds[[j]]])
  ends <- unique(vapply(spec$paths, `[[`, "", "to"))
  reg <- vapply(
    ends,
    function(t) paste(cv[[t]], "~", paste(cv[vapply(Filter(function(p) p$to == t, spec$paths), `[[`, "", "from")], collapse = " + ")),
    ""
  )
  plsm <- c(
    vapply(
      seq_along(spec$constructs),
      function(j) paste(cv[[j]], if (identical(spec$constructs[[j]]$type, "composite") && !isTRUE(req$factorModel)) "<~" else "=~", paste(ind(j), collapse = " + ")),
      ""
    ),
    reg,
    # (cSEM needs the construct correlations spelled out when there is no structural model)
    if (!length(spec$paths) && length(cv) > 1) utils::combn(unname(unlist(cv)), 2, function(x) paste(x[1], "~~", x[2]))
  )
  cbm <- c(vapply(seq_along(spec$constructs), function(j) paste(cv[[j]], "=~", ps_marked(ind(j))), ""), reg)
  req$params <- lapply(req$params, function(p) {
    # (fit tests and GoF are of the model, named 'model', not a construct)
    if (p$kind != "fit" && p$from != "model") {
      p$from <- cv[[p$from]]
      p$to <- cv[[p$to]]
    }
    p
  })
  # A PLS measurement check: one of these (mcValidity.ts), '' for any other parameter.
  one_rule <- function(r) {
    if (!r %in% c("", "cr", "ave", "fl", "xl", "htmt", "htmt90", "htmtci", "gof", "cicfa", "cicfa90", "cicfa85", "chi1")) stop("Unknown measurement check.")
    r
  }
  # Composite reliabilities: per construct, its block's covariances with the construct (a) and covariance
  # matrix (S) in the population, in the order of the block's indicators (the app's blockMoments).
  rel_lines <- unlist(lapply(Filter(function(p) p$kind == "reliability", req$params), function(p) {
    a <- vapply(unlist(p$a), function(v) ps_number(v, "reliability moment"), 0)
    # (S is symmetric: the order the JSON matrix is read in does not matter)
    S <- vapply(unlist(p$S), function(v) ps_number(v, "reliability moment"), 0)
    if (length(S) != length(a)^2) stop("A reliability's covariance matrix does not match its block.")
    sprintf(
      "rel_truth[[%s]] <- list(a = %s, S = matrix(%s, %d))",
      ps_q(p$from),
      paste(deparse(unname(a)), collapse = ""),
      paste(deparse(unname(as.numeric(S))), collapse = ""),
      length(a)
    )
  }))
  # Population model: every indicator (co)variance fixed at its population value.
  pop <- c()
  for (i in seq_along(vars)) for (j in i:length(vars)) pop <- c(pop, sprintf("%s ~~ %s*%s", vars[i], format(S[i, j], digits = 15), vars[j]))
  est_lines <- unlist(lapply(seq_along(req$estimators), function(ei) {
    e <- req$estimators[[ei]]
    if (e$method == "regression") {
      return(sprintf(
        "  res[%d] <- list(tryCatch(reg_stats(data_pls, dr = %s), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL }))",
        ei,
        if (isTRUE(e$dr)) "TRUE" else "FALSE"
      ))
    }
    if (e$method == "pls") {
      # BCa: cSEM's own resampling (its acceleration needs cSEM's resample structure); otherwise pls_boot
      # resamples (the same estimation per draw, without cSEM's per-draw summaries).
      cSEM_boot <- req$bootSamples > 0 && interval == "bca"
      boot <- if (cSEM_boot) {
        sprintf(
          ", .resample_method = \"bootstrap\", .R = %d, .seed = boot_seed, .sign_change_option = \"%s\"",
          as.integer(req$bootSamples),
          sign_change
        )
      } else {
        ""
      }
      own_boot <- if (req$bootSamples > 0 && !cSEM_boot) sprintf(", boot = %d, seed = boot_seed", as.integer(req$bootSamples)) else ""
      # (HTMT inference resamples the cases itself, whoever bootstraps the estimates)
      if (cSEM_boot) own_boot <- sprintf(", htmt_boot = %d, seed = boot_seed", as.integer(req$bootSamples))
      # Every construct in one outer mode (unit: sum scores), else cSEM's default (=~ mode A, <~ mode B).
      modes <- c(A = "modeA", B = "modeB", unit = "unit")
      # (mode and scheme are checked by ps_validate; the lookups only ever give these fixed strings)
      mode <- if (is.null(e$mode)) "" else sprintf(", .PLS_modes = \"%s\"", modes[[e$mode]])
      schemes <- c(path = "path", factor = "factorial", centroid = "centroid")
      scheme <- schemes[[e$scheme %||% "path"]]
      # (no structural model: cSEM cannot weight by paths; factorial is what a single path between two would give)
      if (!length(spec$paths) && scheme == "path") scheme <- "factorial"
      sprintf(
        "  res[%d] <- list(tryCatch(pls_stats(csem(data_pls, pls_model, .disattenuate = %s, .PLS_weight_scheme_inner = \"%s\"%s%s)%s), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL }))",
        ei,
        if (isTRUE(e$consistent)) "TRUE" else "FALSE",
        scheme,
        mode,
        boot,
        own_boot
      )
    } else {
      sprintf(
        "  res[%d] <- list(tryCatch(cb_stats(sem(cb_model, data = data, estimator = \"%s\", missing = cb_missing%s), mc_seed, boot_seed), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL }))",
        ei,
        e$estimator,
        # WLSMV on ordinal indicators: polychoric correlations (the other estimators take the categories as numbers)
        if (length(cuts) && identical(e$estimator, "WLSMV")) ", ordered = vars" else ""
      )
    }
  }))
  c(
    "suppressPackageStartupMessages({ library(lavaan); library(cSEM) })",
    sprintf("vars <- %s", ps_q(vars)),
    "pop_model <- '", paste0("  ", pop), "'",
    sprintf(
      "skew <- %s; kurt <- %s",
      paste(deparse(as.numeric(req$population$skew)), collapse = ""),
      paste(deparse(as.numeric(req$population$kurtosis)), collapse = "")
    ),
    sprintf("fleishman <- %s", paste(deparse(fleishman), collapse = "")),
    "pls_model <- '",
    paste0("  ", plsm),
    "'",
    "cb_model <- '",
    paste0("  ", cbm),
    "'",
    sprintf("alpha <- %s; mc_draws <- %d", format(ps_number(req$alpha, "significance level")), as.integer(req$mcDraws)),
    sprintf("cb_checks <- %s; req_boot <- %d", if (isTRUE(req$cbChecks)) "TRUE" else "FALSE", as.integer(req$bootSamples)),
    sprintf("reg_from <- %s; reg_to <- %s", ps_q(cv[vapply(spec$paths, `[[`, "", "from")]), ps_q(cv[vapply(spec$paths, `[[`, "", "to")])),
    "# Parameters to evaluate: standardised paths, indirect effects and correlations of exogenous constructs.",
    "params <- data.frame(kind = ",
    ps_q(vapply(req$params, `[[`, "", "kind")),
    ", from = ",
    ps_q(vapply(req$params, `[[`, "", "from")),
    ", to = ",
    ps_q(vapply(req$params, `[[`, "", "to")),
    ", index = ",
    ps_q(vapply(req$params, function(p) p$index %||% "", "")),
    ", rule = ",
    ps_q(vapply(req$params, function(p) one_rule(p$rule %||% ""), "")),
    ", cutoff = ",
    paste(deparse(vapply(req$params, function(p) if (is.null(p$cutoff)) NA_real_ else ps_number(p$cutoff, "cutoff"), 0)), collapse = ""),
    ", poor_below = ",
    paste(deparse(vapply(req$params, function(p) isTRUE(p$poorBelow), TRUE)), collapse = ""),
    ")",
    "# Regression on unit-weighted composites (sum of standardised indicators); DR: correlations of common factors",
    "# disattenuated by omega of the composite from a one-factor MINRES solution; OLS t tests on n - k - 1 df.",
    paste0("blocks <- list(", paste(vapply(seq_along(spec$constructs), function(j) sprintf("%s = %s", cv[[j]], ps_q(ind(j))), ""), collapse = ", "), ")"),
    sprintf("factor_block <- %s", paste(deparse(vapply(spec$constructs, function(c) !identical(c$type, "composite"), TRUE)), collapse = "")),
    "minres1 <- function(R) {",
    "  if (nrow(R) == 1) return(1)",
    "  h <- tryCatch(1 - 1 / diag(solve(R)), error = function(e) rep(0.5, nrow(R)))",
    "  for (iter in 1:1000) {",
    "    Rr <- R; diag(Rr) <- h; e <- eigen(Rr, symmetric = TRUE)",
    "    l <- e$vectors[, 1] * sqrt(max(e$values[1], 0)); if (sum(l) < 0) l <- -l",
    "    change <- max(abs(l^2 - h)); h <- l^2",
    "    if (change < 1e-10) break",
    "  }",
    "  l",
    "}",
    "omega_unit <- function(l) sum(l)^2 / (sum(l)^2 + sum(1 - l^2))",
    "# Reliability of a composite with weights w: its squared correlation with the construct in the population.",
    "rel_truth <- list()",
    rel_lines,
    "true_rel <- function(f, w) { m <- rel_truth[[f]]; sum(w * m$a)^2 / drop(t(w) %*% m$S %*% w) }",
    "# PLS measurement checks (as mcValidity.ts): rho_c, AVE, Fornell-Larcker margin, HTMT, GoF; and failing the cutoff.",
    "htmt_of <- function(R, a, b) {",
    "  mono <- function(x) { r <- abs(R[x, x]); mean(r[upper.tri(r)]) }",
    "  mean(abs(R[a, b])) / sqrt(mono(a) * mono(b))",
    "}",
    "# HTMT inference (Henseler et al. 2015): the upper bound of boot's 90% normal interval, cases resampled.",
    "htmt_upper <- function(D, a, b, B, seed) {",
    "  set.seed(seed)",
    "  t0 <- htmt_of(stats::cor(D), a, b)",
    "  d <- replicate(B, { i <- sample.int(nrow(D), nrow(D), TRUE); suppressWarnings(htmt_of(stats::cor(D[i, c(a, b)]), a, b)) })",
    "  d <- d[is.finite(d)]",
    "  if (length(d) < 2) return(NA_real_)",
    "  2 * t0 - mean(d) + stats::qnorm(0.95) * stats::sd(d)",
    "}",
    "validity_value <- function(fit, R, k, B = 0, seed = NULL) {",
    "  L <- fit$Estimates$Loading_estimates; C <- fit$Estimates$Construct_VCV",
    "  checked <- names(blocks)[factor_block & lengths(blocks) >= 2]",
    "  lam <- function(f) L[f, blocks[[f]]]",
    "  ave <- function(f) mean(lam(f)^2)",
    "  f <- params$from[k]; t <- params$to[k]",
    "  switch(params$rule[k],",
    "    cr = { l <- lam(f); sum(l)^2 / (sum(l)^2 + sum(1 - l^2)) },",
    "    ave = ave(f),",
    "    fl = sqrt(ave(f)) - max(abs(C[f, colnames(C) != f])),",
    "    htmt = , htmt90 = htmt_of(R, blocks[[f]], blocks[[t]]),",
    "    htmtci = htmt_upper(fit$Information$Data, blocks[[f]], blocks[[t]], B, seed + 5L),",
    "    xl = {",
    "      X <- stats::cor(fit$Information$Data, fit$Estimates$Construct_scores)",
    "      min(vapply(blocks[[f]], function(i) abs(X[i, f]) - max(abs(X[i, colnames(X) != f])), 0))",
    "    },",
    "    gof = sqrt(mean(vapply(checked, ave, 0)) * mean(fit$Estimates$R2))",
    "  )",
    "}",
    "fails_cutoff <- function(v, k) if (!is.finite(v)) NA else as.numeric(if (params$poor_below[k]) v < params$cutoff[k] else v > params$cutoff[k])",
    "reg_stats <- function(data, dr) {",
    "  z <- scale(data)",
    "  comp <- sapply(blocks, function(b) rowSums(z[, b, drop = FALSE]))",
    "  C <- stats::cor(comp)",
    "  rel <- vapply(seq_along(blocks), function(j) {",
    "    if (!dr || !factor_block[j] || length(blocks[[j]]) < 2) return(1)",
    "    omega_unit(minres1(stats::cor(z[, blocks[[j]], drop = FALSE])))",
    "  }, 0)",
    "  ok <- all(rel > 0 & rel <= 1 + 1e-10)",
    "  C <- C / sqrt(outer(rel, rel)); diag(C) <- 1",
    "  if (any(abs(C) > 1 + 1e-10)) ok <- FALSE",
    "  lv <- names(blocks); B <- matrix(0, length(lv), length(lv), dimnames = list(lv, lv)); SE <- B * NA; df <- setNames(rep(NA, length(lv)), lv)",
    "  for (t in lv) {",
    "    P <- reg_from[reg_to == t]",
    "    if (!length(P)) next",
    "    beta <- solve(C[P, P, drop = FALSE], C[P, t]); r2 <- sum(beta * C[P, t])",
    "    df[t] <- nrow(data) - length(P) - 1",
    "    B[P, t] <- beta; SE[P, t] <- sqrt(max(0, 1 - r2) / df[t] * diag(solve(C[P, P, drop = FALSE])))",
    "  }",
    "  E <- effects(B)",
    "  out <- lapply(seq_len(nrow(params)), function(k) {",
    "    f <- params$from[k]; t <- params$to[k]",
    "    if (params$kind[k] == 'fit') return(c(NA, NA, NA, NA))",
    "    if (params$kind[k] == 'validity') return(c(NA, NA, NA, NA))",
    "    if (params$kind[k] == 'reliability') return(c(true_rel(f, rep(1, length(blocks[[f]]))), NA, NA, NA))",
    "    if (params$kind[k] == 'covariance') return(c(C[f, t], NA, NA, NA))",
    "    if (params$kind[k] == 'indirect') return(c(E$indirect[f, t], NA, NA, NA))",
    "    crit <- stats::qt(1 - alpha / 2, df[t]); b <- B[f, t]; s <- SE[f, t]",
    "    c(b, b - crit * s, b + crit * s, as.numeric(2 * stats::pt(-abs(b / s), df[t]) < alpha))",
    "  })",
    "  list(values = do.call(rbind, out), proper = as.numeric(ok))",
    "}",
    "# The path estimates; a model without paths (cSEM gives none): all zero.",
    "path_matrix <- function(fit) {",
    "  P <- fit$Estimates$Path_estimates",
    "  if (is.matrix(P)) return(P)",
    "  cn <- rownames(fit$Estimates$Construct_VCV)",
    "  matrix(0, length(cn), length(cn), dimnames = list(cn, cn))",
    "}",
    "effects <- function(B) { Tm <- solve(diag(nrow(B)) - B) - diag(nrow(B)); dimnames(Tm) <- dimnames(B); list(direct = B, indirect = Tm - B) }",
    "# PLS: path and indirect estimates; with bootstrap draws, percentile CIs and a t test.",
    "# Bootstrap tests of H0: theta = 0 from the draws (after cSEM's sign-change correction): t on n - 1 df,",
    "# normal (bias-corrected), basic, percentile and BCa (cSEM's infer) intervals; an interval rejects when it excludes 0.",
    "tests_names <- c('t', 'normal', 'basic', 'percentile', 'bca')",
    "boot_tests <- function(x, v, n_cases, bca) {",
    "  se <- stats::sd(x); q <- stats::quantile(x, c(alpha / 2, 1 - alpha / 2), names = FALSE)",
    "  z <- stats::qnorm(1 - alpha / 2); b <- mean(x) - v",
    "  ci <- list(normal = c(v - b - z * se, v - b + z * se), basic = c(2 * v - q[2], 2 * v - q[1]), percentile = q, bca = bca)",
    "  ex0 <- function(i) if (length(i) == 2 && all(is.finite(i))) as.numeric(i[1] > 0 || i[2] < 0) else NA",
    "  t <- if (se > 0) as.numeric(2 * stats::pt(-abs(v / se), n_cases - 1) < alpha) else NA",
    "  list(ci = ci, reject = c(t = t, normal = ex0(ci$normal), basic = ex0(ci$basic), percentile = ex0(ci$percentile), bca = ex0(ci$bca)))",
    "}",
    "# The bootstrap of a PLS fit as cSEM's resampling does it: cSEM's estimation (cSEM:::foreman, which csem()",
    "# runs for each draw) on each resample with the fit's own arguments; inadmissible draws dropped (cSEM's",
    "# default); with the construct sign change, a draw whose construct's loadings flip is estimated again with",
    "# that construct's weights reversed (cSEM's construct_reestimate). Without cSEM's summaries of every draw it",
    "# takes about two thirds of the time. The draws: each one's direct and indirect effects.",
    "pls_boot <- function(fit, R, seed) {",
    "  args <- fit$Information$Arguments",
    "  args <- args[intersect(names(args), names(formals(cSEM:::foreman)))]",
    "  X <- args$.data",
    "  n <- nrow(X)",
    "  est0 <- fit$Estimates",
    "  estimate <- function(a) tryCatch(do.call(cSEM:::foreman, a), error = function(e) NULL)",
    "  set.seed(seed)",
    "  draws <- lapply(seq_len(R), function(b) {",
    "    a <- args",
    "    a$.data <- X[sample.int(n, n, replace = TRUE), , drop = FALSE]",
    "    est <- estimate(a)",
    "    if (is.null(est) || sum(unlist(cSEM::verify(est))) != 0) return(NULL)",
    "    W <- est$Estimates$Weight_estimates",
    "    if (sign_change == 'construct_reestimate' && any(sign(est0$Weight_estimates) != sign(W))) {",
    "      L0 <- est0$Loading_estimates",
    "      L <- est$Estimates$Loading_estimates",
    "      flip <- abs(rowSums(L0 - L)) > abs(rowSums(L0 + L))",
    "      W[flip, ] <- -W[flip, ]",
    "      a$.PLS_modes <- setNames(lapply(seq_len(nrow(W)), function(i) W[i, W[i, ] != 0]), rownames(W))",
    "      est <- estimate(a)",
    "      if (is.null(est)) return(NULL)",
    "    }",
    "    effects(t(path_matrix(est)))",
    "  })",
    "  Filter(Negate(is.null), draws)",
    "}",
    "# PLS: path and indirect estimates; with bootstrap draws (pls_boot, or cSEM's own for BCa), the tests and the",
    "# chosen interval.",
    "pls_stats <- function(fit, boot = 0, seed = NULL, htmt_boot = boot) {",
    "  if (!isTRUE(fit$Information$Weight_info$Convergence_status)) stop('not converged')",
    "  P <- t(path_matrix(fit)); E <- effects(P)",
    "  # (no path or indirect effect to test, as in a model without paths: no bootstrap of the estimates)",
    "  draws <- if (boot > 0 && any(params$kind %in% c('path', 'indirect'))) pls_boot(fit, boot, seed) else NULL",
    "  r <- fit$Estimates$Estimates_resample$Estimates1",
    "  # Individual sign-change correction: every draw takes the sign of the original estimate, |draw| * sign(estimate)",
    "  if (!is.null(r) && individual) {",
    "    for (q in c('Path_estimates', 'Indirect_effect')) {",
    "      if (length(r[[q]]$Original)) r[[q]]$Resampled <- sweep(abs(r[[q]]$Resampled), 2, sign(r[[q]]$Original), `*`)",
    "    }",
    "    fit$Estimates$Estimates_resample$Estimates1 <- r",
    "  }",
    "  bca <- if (!is.null(r) && interval == 'bca') cSEM::infer(fit, .quantity = 'CI_bca', .alpha = alpha) else NULL",
    "  n_cases <- nrow(fit$Information$Data)",
    "  R_ind <- if (any(params$kind == 'validity')) stats::cor(fit$Information$Data) else NULL",
    "  rows <- lapply(seq_len(nrow(params)), function(k) {",
    "    none <- list(values = c(NA, NA, NA, NA), tests = rep(NA_real_, 5))",
    "    if (params$kind[k] == 'fit') return(none)",
    "    if (params$kind[k] == 'validity') {",
    "      v <- validity_value(fit, R_ind, k, htmt_boot, seed)",
    "      return(list(values = c(v, NA, NA, fails_cutoff(v, k)), tests = none$tests))",
    "    }",
    "    if (params$kind[k] == 'reliability') {",
    "      w <- fit$Estimates$Weight_estimates[params$from[k], blocks[[params$from[k]]]]",
    "      return(list(values = c(true_rel(params$from[k], w), NA, NA, NA), tests = none$tests))",
    "    }",
    "    # (a covariance: the correlation of the two exogenous constructs, disattenuated with PLSc; no resampled draws)",
    "    if (params$kind[k] == 'covariance') return(list(values = c(fit$Estimates$Construct_VCV[params$from[k], params$to[k]], NA, NA, NA), tests = none$tests))",
    "    path <- params$kind[k] == 'path'",
    "    v <- if (path) E$direct[params$from[k], params$to[k]] else E$indirect[params$from[k], params$to[k]]",
    "    if (is.null(r) && is.null(draws)) return(list(values = c(v, NA, NA, NA), tests = none$tests))",
    "    nm <- paste(params$to[k], '~', params$from[k])",
    "    x <- if (!is.null(draws)) {",
    "      effect <- if (path) 'direct' else 'indirect'",
    "      x <- vapply(draws, function(D) D[[effect]][params$from[k], params$to[k]], 0)",
    "      if (individual) abs(x) * sign(v) else x",
    "    } else if (path) r$Path_estimates$Resampled[, nm] else r$Indirect_effect$Resampled[, nm]",
    "    x <- x[is.finite(x)]",
    "    if (length(x) < 2) return(list(values = c(v, NA, NA, NA), tests = none$tests))",
    "    b <- if (is.null(bca)) NULL else if (path) bca$Path_estimates$CI_bca[, nm] else bca$Indirect_effect$CI_bca[, nm]",
    "    res <- boot_tests(x, v, n_cases, b)",
    "    list(values = c(v, res$ci[[interval]], res$reject[[interval]]), tests = unname(res$reject))",
    "  })",
    "  # PLSc: admissible as cSEM's verify() defines it (loadings, reliabilities, construct correlations); composites always are.",
    "  ok <- !isTRUE(fit$Information$Arguments$.disattenuate) || sum(cSEM::verify(fit)) == 0",
    "  list(values = do.call(rbind, lapply(rows, `[[`, 'values')), tests = do.call(rbind, lapply(rows, `[[`, 'tests')), proper = as.numeric(ok))",
    "}",
    "# CB-SEM: standardised estimates; Wald CIs (marker metric) for paths, Monte Carlo CIs for indirect effects.",
    "# CB-SEM measurement checks (as mcValidity.ts cbValidity): from the standardised loadings and factor",
    "# correlations, HTMT from the complete cases; per pair of exogenous factors the upper bound of the factor",
    "# correlation's 1 - alpha interval (standardizedSolution, delta method) and chi2(1), the chi2 difference against the",
    "# model with the correlation fixed at 1 (std.lv; Ronkko & Cho 2022).",
    "cb_validity_value <- function(fit, k, D, R, boot_seed) {",
    "  ss <- standardizedSolution(fit, level = 1 - alpha)",
    "  f <- params$from[k]; t <- params$to[k]",
    "  lam <- function(g) vapply(blocks[[g]], function(i) ss$est.std[ss$op == '=~' & ss$lhs == g & ss$rhs == i], 0)",
    "  C <- lavInspect(fit, 'cor.lv')",
    "  endo <- unique(ss$lhs[ss$op == '~'])",
    "  pair <- function() ss[ss$op == '~~' & ((ss$lhs == f & ss$rhs == t) | (ss$lhs == t & ss$rhs == f)), ]",
    "  switch(params$rule[k],",
    "    cr = { l <- lam(f); sum(l)^2 / (sum(l)^2 + sum(1 - l^2)) },",
    "    ave = mean(lam(f)^2),",
    "    fl = sqrt(mean(lam(f)^2)) - max(abs(C[f, colnames(C) != f])),",
    "    htmt = , htmt90 = htmt_of(R, blocks[[f]], blocks[[t]]),",
    "    htmtci = htmt_upper(D, blocks[[f]], blocks[[t]], req_boot, boot_seed + 5L),",
    "    cicfa = , cicfa90 = , cicfa85 = if (f %in% endo || t %in% endo) NA_real_ else pair()$ci.upper[1],",
    "    chi1 = {",
    "      if (f %in% endo || t %in% endo) return(NA_real_)",
    "      # (the model refitted with std.lv on the analysed data, the correlation fixed at 1; not for ordinal indicators)",
    "      if (length(lavNames(fit, 'ov.ord'))) return(NA_real_)",
    "      o <- lavInspect(fit, 'options')",
    "      # (the marker loadings, 1*, freed: std.lv fixes the factor variances instead)",
    "      std_model <- gsub('=~ 1*', '=~ NA*', cb_model, fixed = TRUE)",
    "      con <- sem(paste(std_model, sprintf('%s ~~ 1*%s', f, t), sep = '\\n'), data = as.data.frame(lavInspect(fit, 'data')),",
    "        estimator = o$estimator, se = o$se, test = o$test, missing = o$missing, std.lv = TRUE)",
    "      if (!lavInspect(con, 'converged')) return(NA_real_)",
    "      lavTestLRT(con, fit)[['Chisq diff']][2]",
    "    },",
    "    NA_real_",
    "  )",
    "}",
    "cb_stats <- function(fit, mc_seed, boot_seed = NULL) {",
    "  if (!lavInspect(fit, 'converged')) stop('not converged')",
    "  ss <- standardizedSolution(fit, se = FALSE); pe <- parameterEstimates(fit, level = 1 - alpha)",
    "  lv <- lavNames(fit, 'lv'); reg <- pe[pe$op == '~', ]",
    "  Bs <- matrix(0, length(lv), length(lv), dimnames = list(lv, lv)); Bu <- Bs",
    "  for (i in seq_len(nrow(reg))) { Bu[reg$rhs[i], reg$lhs[i]] <- reg$est[i]; Bs[reg$rhs[i], reg$lhs[i]] <- ss$est.std[ss$op == '~' & ss$lhs == reg$lhs[i] & ss$rhs == reg$rhs[i]] }",
    "  E <- effects(Bs)",
    "  mc <- NULL",
    "  if (mc_draws > 0 && any(params$kind == 'indirect')) {",
    "    free <- lavInspect(fit, 'free')$beta; V <- lavInspect(fit, 'vcov'); co <- coef(fit)",
    "    idx <- which(free != 0, arr.ind = TRUE)  # beta[to, from]",
    "    set.seed(mc_seed); D <- MASS::mvrnorm(mc_draws, co[free[idx]], V[free[idx], free[idx], drop = FALSE])",
    "    mc <- lapply(seq_len(mc_draws), function(d) { B <- matrix(0, length(lv), length(lv), dimnames = list(lv, lv)); B[cbind(idx[, 2], idx[, 1])] <- D[d, ]; effects(B)$indirect })",
    "  }",
    "  fm <- fitMeasures(fit); scaled <- 'chisq.scaled' %in% names(fm)",
    "  D_cb <- if (cb_checks && any(params$kind == 'validity')) stats::na.omit(as.data.frame(lavInspect(fit, 'data'))) else NULL",
    "  R_cb <- if (is.null(D_cb)) NULL else stats::cor(D_cb)",
    "  out <- lapply(seq_len(nrow(params)), function(k) {",
    "    if (params$index[k] != '') {",
    "      # A fit index against its cutoff (Hu & Bentler 1999); the robust index where the estimator has one.",
    "      id <- params$index[k]; robust <- paste0(id, '.robust')",
    "      v <- if (robust %in% names(fm) && is.finite(fm[[robust]])) fm[[robust]] else fm[[id]]",
    "      poor <- if (params$poor_below[k]) v < params$cutoff[k] else v > params$cutoff[k]",
    "      return(c(v, NA, NA, if (is.finite(v)) as.numeric(poor) else NA))",
    "    }",
    "    if (params$kind[k] == 'reliability') return(c(NA, NA, NA, NA))  # (PLS composites)",
    "    if (params$kind[k] == 'validity') {",
    "      if (!cb_checks) return(c(NA, NA, NA, NA))",
    "      v <- tryCatch(cb_validity_value(fit, k, D_cb, R_cb, boot_seed), error = function(e) NA_real_)",
    "      return(c(v, NA, NA, fails_cutoff(v, k)))",
    "    }",
    "    if (params$kind[k] == 'fit') {",
    "      pv <- if (scaled) fm[['pvalue.scaled']] else fm[['pvalue']]",
    "      return(c(if (scaled) fm[['chisq.scaled']] else fm[['chisq']], NA, NA, if (is.finite(pv)) as.numeric(pv < alpha) else NA))",
    "    }",
    "    f <- params$from[k]; t <- params$to[k]",
    "    if (params$kind[k] == 'covariance') {",
    "      # The factors' correlation (standardised); its Wald CI and test in the marker metric.",
    "      r <- pe[pe$op == '~~' & ((pe$lhs == f & pe$rhs == t) | (pe$lhs == t & pe$rhs == f)), ]",
    "      s <- ss[ss$op == '~~' & ((ss$lhs == f & ss$rhs == t) | (ss$lhs == t & ss$rhs == f)), ]",
    "      return(c(s$est.std[1], r$ci.lower[1], r$ci.upper[1], as.numeric(r$pvalue[1] < alpha)))",
    "    }",
    "    if (params$kind[k] == 'path') {",
    "      r <- reg[reg$lhs == t & reg$rhs == f, ]",
    "      return(c(E$direct[f, t], r$ci.lower, r$ci.upper, as.numeric(r$pvalue < alpha)))",
    "    }",
    "    if (is.null(mc)) return(c(E$indirect[f, t], NA, NA, NA))",
    "    x <- vapply(mc, function(m) m[f, t], 0); q <- stats::quantile(x, c(alpha / 2, 1 - alpha / 2))",
    "    c(E$indirect[f, t], q[[1]], q[[2]], as.numeric(q[[1]] > 0 || q[[2]] < 0))",
    "  })",
    "  list(values = do.call(rbind, out), proper = as.numeric(isTRUE(suppressWarnings(lavInspect(fit, 'post.check')))))",
    "}",
    "if (all(c(skew, kurt) == 0) || !is.null(fleishman)) skew <- kurt <- NULL  # multivariate normal",
    "# Goodhue et al. (2012): Fleishman's polynomial applied to each normal indicator, correlations not corrected.",
    "to_fleishman <- function(data) {",
    "  for (j in seq_along(data)) {",
    "    f <- fleishman[j, ]; x <- data[[j]]",
    "    data[[j]] <- f[1] + f[2] * x + f[3] * x^2 + f[4] * x^3",
    "  }",
    "  data",
    "}",
    sprintf(
      "miss_rate <- %s; miss_mar <- %s; pls_missing <- %s; cb_missing <- %s",
      format(miss$rate), if (miss$mar) "TRUE" else "FALSE", ps_q(miss$pls), ps_q(miss$cb)
    ),
    sprintf("cuts <- %s", paste(deparse(unname(cuts)), collapse = "")),
    sprintf("interval <- %s", ps_q(interval)),
    sprintf("individual <- %s", if (individual) "TRUE" else "FALSE"),
    sprintf("sign_change <- %s", ps_q(sign_change)),
    "# Missing values: MCAR, or MAR on the first indicator (kept complete): chance 2 * rate * rank / n.",
    "add_missing <- function(data, seed) {",
    "  set.seed(seed)",
    "  n <- nrow(data)",
    "  chance <- if (miss_mar) pmin(1, 2 * miss_rate * (rank(data[[1]], ties.method = 'first') - 0.5) / n) else rep(miss_rate, n)",
    "  for (j in seq_along(data)) if (!(miss_mar && j == 1)) data[[j]][stats::runif(n) < chance] <- NA",
    "  data",
    "}",
    "one_replication <- function(n, seed, boot_seed, mc_seed, miss_seed) {",
    "  set.seed(seed)",
    "  data <- simulateData(pop_model, sample.nobs = n, skewness = skew, kurtosis = kurt)[, vars]",
    "  if (!is.null(fleishman)) data <- to_fleishman(data)",
    "  if (length(cuts)) data[] <- lapply(data, function(x) findInterval(x, cuts) + 1)  # categories 1..k",
    "  if (miss_rate > 0) data <- add_missing(data, miss_seed)",
    "  # PLS (cSEM) needs complete data: mean replacement or casewise deletion.",
    "  data_pls <- if (pls_missing == 'mean') as.data.frame(lapply(data, function(x) { x[is.na(x)] <- mean(x, na.rm = TRUE); x })) else stats::na.omit(data)",
    "  res <- list()",
    est_lines,
    "  res",
    "}"
  )
}

ps_mc <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  body <- ps_mc_body(req)
  seeds <- req$seeds # list of {n, rep, data, boot, mc}
  run <- c(
    "mc_errors <- character(0)",
    "results <- lapply(seq_len(nrow(seeds)), function(i) one_replication(seeds$n[i], seeds$data[i], seeds$boot[i], seeds$mc[i], seeds$miss[i]))",
    "# Estimations that failed count as not converged; how many, and why, is reported.",
    "if (length(mc_errors)) warning(sprintf(\"%d estimations failed or did not converge (counted as not converged); most common: %s\", length(mc_errors), names(sort(table(mc_errors), decreasing = TRUE))[1]))"
  )
  sd <- data.frame(
    n = vapply(seeds, `[[`, 0, "n"), rep = vapply(seeds, `[[`, 0, "rep"), data = vapply(seeds, `[[`, 0, "data"),
    boot = vapply(seeds, `[[`, 0, "boot"), mc = vapply(seeds, `[[`, 0, "mc"), miss = vapply(seeds, `[[`, 0, "miss")
  )
  if (export) {
    est_ids <- vapply(req$estimators, `[[`, "", "id")
    report <- c(
      sprintf("estimators <- %s", ps_q(est_ids)),
      "truth <- c(",
      paste0("  ", vapply(req$params, function(p) ps_num(p$value), ""), c(rep(",", length(req$params) - 1), "")),
      ")",
      "# Summary: mean, bias, SD, RMSE (standardised); rejection rate (power, or Type I error when the truth is 0);",
      "# mean CI width (in the CI metric: unstandardised, marker metric, for CB-SEM); share of inadmissible solutions.",
      "summary_rows <- do.call(rbind, lapply(sort(unique(seeds$n)), function(n) do.call(rbind, lapply(seq_along(estimators), function(e) do.call(rbind, lapply(seq_len(nrow(params)), function(k) {",
      "  vals <- do.call(rbind, lapply(results[seeds$n == n], function(r) if (is.null(r[[e]])) c(NA, NA, NA, NA) else r[[e]]$values[k, ]))",
      "  ok <- is.finite(vals[, 1]); x <- vals[ok, 1]",
      "  proper <- vapply(results[seeds$n == n], function(r) if (is.null(r[[e]])) NA_real_ else r[[e]]$proper, 0)",
      "  data.frame(n = n, estimator = estimators[e], parameter = paste(params$kind[k], params$from[k], params$to[k]), reps = sum(ok),",
      "    mean = mean(x), bias = if (params$kind[k] == 'fit') NA else mean(x) - truth[k], sd = stats::sd(x),",
      "    rmse = if (params$kind[k] == 'fit') NA else sqrt(mean((x - truth[k])^2)), rejection = mean(vals[ok, 4], na.rm = TRUE),",
      "    ci_width = mean(vals[ok, 3] - vals[ok, 2], na.rm = TRUE), inadmissible = mean(proper[ok] == 0))",
      "}))))))",
      "print(summary_rows, digits = 3)"
    )
    return(ps_script("Monte Carlo simulation (lavaan::simulateData; cSEM / lavaan)", c("lavaan", "cSEM"), list(seeds = sd), c(body, run), report))
  }
  env <- ps_run(c(body, run), list(seeds = sd))
  E <- length(req$estimators)
  K <- length(req$params)
  # One column of the results (est, lo, hi, sig) per estimator e and parameter k, over the replications (NA where
  # an estimator failed); I(): a chunk of one replication stays a one-element array
  pick <- function(col) {
    over_replications <- function(e, k) {
      I(vapply(env$results, function(r) if (is.null(r[[e]])) NA_real_ else r[[e]]$values[k, col], 0))
    }
    lapply(seq_len(E), function(e) lapply(seq_len(K), function(k) over_replications(e, k)))
  }
  ps_json(list(
    est = pick(1), lo = pick(2), hi = pick(3), sig = pick(4),
    tests = lapply(seq_len(5), function(ti) {
      lapply(seq_len(E), function(e) {
        lapply(seq_len(K), function(k) {
          I(vapply(env$results, function(r) if (is.null(r[[e]]$tests)) NA_real_ else r[[e]]$tests[k, ti], 0))
        })
      })
    }),
    proper = lapply(
      seq_len(E),
      function(e) I(vapply(env$results, function(r) if (is.null(r[[e]])) NA_real_ else r[[e]]$proper, 0))
    ),
    warnings = env$.warnings
  ))
}
