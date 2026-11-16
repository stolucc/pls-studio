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
  # Estimation models: PLS keeps factors (=~) and composites (<~); CB-SEM treats every construct as a common factor.
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
      function(j) paste(cv[[j]], if (identical(spec$constructs[[j]]$type, "composite")) "<~" else "=~", paste(ind(j), collapse = " + ")),
      ""
    ),
    reg
  )
  cbm <- c(vapply(seq_along(spec$constructs), function(j) paste(cv[[j]], "=~", ps_marked(ind(j))), ""), reg)
  req$params <- lapply(req$params, function(p) {
    if (p$kind != "fit") {
      p$from <- cv[[p$from]]
      p$to <- cv[[p$to]]
    }
    p
  })
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
      boot <- if (req$bootSamples > 0) {
        sprintf(
          ", .resample_method = \"bootstrap\", .R = %d, .seed = boot_seed, .sign_change_option = \"%s\"",
          as.integer(req$bootSamples),
          sign_change
        )
      } else {
        ""
      }
      # Every construct in one outer mode (unit: sum scores), else cSEM's default (=~ mode A, <~ mode B).
      modes <- c(A = "modeA", B = "modeB", unit = "unit")
      # (mode and scheme are checked by ps_validate; the lookups only ever give these fixed strings)
      mode <- if (is.null(e$mode)) "" else sprintf(", .PLS_modes = \"%s\"", modes[[e$mode]])
      schemes <- c(path = "path", factor = "factorial", centroid = "centroid")
      scheme <- schemes[[e$scheme %||% "path"]]
      sprintf(
        "  res[%d] <- list(tryCatch(pls_stats(csem(data_pls, pls_model, .disattenuate = %s, .PLS_weight_scheme_inner = \"%s\"%s%s)), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL }))",
        ei,
        if (isTRUE(e$consistent)) "TRUE" else "FALSE",
        scheme,
        mode,
        boot
      )
    } else {
      sprintf(
        "  res[%d] <- list(tryCatch(cb_stats(sem(cb_model, data = data, estimator = \"%s\", missing = cb_missing%s), mc_seed), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL }))",
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
    "pls_model <- '",
    paste0("  ", plsm),
    "'",
    "cb_model <- '",
    paste0("  ", cbm),
    "'",
    sprintf("alpha <- %s; mc_draws <- %d", format(ps_number(req$alpha, "significance level")), as.integer(req$mcDraws)),
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
    "    if (params$kind[k] == 'reliability') return(c(true_rel(f, rep(1, length(blocks[[f]]))), NA, NA, NA))",
    "    if (params$kind[k] == 'covariance') return(c(C[f, t], NA, NA, NA))",
    "    if (params$kind[k] == 'indirect') return(c(E$indirect[f, t], NA, NA, NA))",
    "    crit <- stats::qt(1 - alpha / 2, df[t]); b <- B[f, t]; s <- SE[f, t]",
    "    c(b, b - crit * s, b + crit * s, as.numeric(2 * stats::pt(-abs(b / s), df[t]) < alpha))",
    "  })",
    "  list(values = do.call(rbind, out), proper = as.numeric(ok))",
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
    "# PLS: path and indirect estimates; with bootstrap draws, the tests and the chosen interval.",
    "pls_stats <- function(fit) {",
    "  if (!isTRUE(fit$Information$Weight_info$Convergence_status)) stop('not converged')",
    "  P <- t(fit$Estimates$Path_estimates); E <- effects(P)",
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
    "  rows <- lapply(seq_len(nrow(params)), function(k) {",
    "    none <- list(values = c(NA, NA, NA, NA), tests = rep(NA_real_, 5))",
    "    if (params$kind[k] == 'fit') return(none)",
    "    if (params$kind[k] == 'reliability') {",
    "      w <- fit$Estimates$Weight_estimates[params$from[k], blocks[[params$from[k]]]]",
    "      return(list(values = c(true_rel(params$from[k], w), NA, NA, NA), tests = none$tests))",
    "    }",
    "    # (a covariance: the correlation of the two exogenous constructs, disattenuated with PLSc; no resampled draws)",
    "    if (params$kind[k] == 'covariance') return(list(values = c(fit$Estimates$Construct_VCV[params$from[k], params$to[k]], NA, NA, NA), tests = none$tests))",
    "    path <- params$kind[k] == 'path'",
    "    v <- if (path) E$direct[params$from[k], params$to[k]] else E$indirect[params$from[k], params$to[k]]",
    "    if (is.null(r)) return(list(values = c(v, NA, NA, NA), tests = none$tests))",
    "    nm <- paste(params$to[k], '~', params$from[k])",
    "    x <- if (path) r$Path_estimates$Resampled[, nm] else r$Indirect_effect$Resampled[, nm]",
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
    "cb_stats <- function(fit, mc_seed) {",
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
    "  out <- lapply(seq_len(nrow(params)), function(k) {",
    "    if (params$index[k] != '') {",
    "      # A fit index against its cutoff (Hu & Bentler 1999); the robust index where the estimator has one.",
    "      id <- params$index[k]; robust <- paste0(id, '.robust')",
    "      v <- if (robust %in% names(fm) && is.finite(fm[[robust]])) fm[[robust]] else fm[[id]]",
    "      poor <- if (params$poor_below[k]) v < params$cutoff[k] else v > params$cutoff[k]",
    "      return(c(v, NA, NA, if (is.finite(v)) as.numeric(poor) else NA))",
    "    }",
    "    if (params$kind[k] == 'reliability') return(c(NA, NA, NA, NA))  # (CB-SEM estimates no composites)",
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
    "if (all(c(skew, kurt) == 0)) skew <- kurt <- NULL  # multivariate normal",
    sprintf(
      "miss_rate <- %s; miss_mar <- %s; pls_missing <- %s; cb_missing <- %s",
      format(miss$rate), if (miss$mar) "TRUE" else "FALSE", ps_q(miss$pls), ps_q(miss$cb)
    ),
    sprintf("cuts <- %s", paste(deparse(unname(cuts)), collapse = "")),
    sprintf("interval <- %s", ps_q(interval)),
    sprintf("individual <- %s", if (individual) "TRUE" else "FALSE"),
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
