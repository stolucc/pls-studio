# Monte Carlo simulation with the R packages. Data: lavaan::simulateData from
# the population covariance matrix of the indicators (Vale-Maurelli for
# non-normal data). Estimation: cSEM (PLS / PLSc, bootstrap percentile CIs) and
# lavaan (CB-SEM, Wald CIs in the marker metric, Monte Carlo CIs for indirect
# effects, the model chi-square test). Per-replication seeds come from the app
# so results do not depend on how replications are split into chunks.

#' The script for one sample size and a set of replications (seeds given).
ps_mc_body <- function(req) {
  spec <- req$spec
  n <- ps_names(spec$constructs)
  cv <- n$cv
  vars <- unname(n$iv[req$population$names])
  S <- req$population$Sigma
  # Estimation models: PLS keeps factors (=~) and composites (<~); CB-SEM treats every construct as a common factor.
  ind <- function(j) unname(n$iv[n$inds[[j]]])
  ends <- unique(vapply(spec$paths, `[[`, "", "to"))
  reg <- vapply(ends, function(t) paste(cv[[t]], "~", paste(cv[vapply(Filter(function(p) p$to == t, spec$paths), `[[`, "", "from")], collapse = " + ")), "")
  plsm <- c(vapply(seq_along(spec$constructs), function(j) paste(cv[[j]], if (identical(spec$constructs[[j]]$type, "composite")) "<~" else "=~", paste(ind(j), collapse = " + ")), ""), reg)
  cbm <- c(vapply(seq_along(spec$constructs), function(j) paste(cv[[j]], "=~", ps_marked(ind(j))), ""), reg)
  req$params <- lapply(req$params, function(p) { if (p$kind != "fit") { p$from <- cv[[p$from]]; p$to <- cv[[p$to]] }; p })
  # Population model: every indicator (co)variance fixed at its population value.
  pop <- c()
  for (i in seq_along(vars)) for (j in i:length(vars)) pop <- c(pop, sprintf("%s ~~ %s*%s", vars[i], format(S[i, j], digits = 15), vars[j]))
  est_lines <- unlist(lapply(seq_along(req$estimators), function(ei) {
    e <- req$estimators[[ei]]
    if (e$method == "pls") {
      boot <- if (req$bootSamples > 0) sprintf(", .resample_method = \"bootstrap\", .R = %d, .seed = boot_seed", as.integer(req$bootSamples)) else ""
      sprintf("  res[[%d]] <- tryCatch(pls_stats(csem(data, pls_model, .disattenuate = %s, .PLS_weight_scheme_inner = \"path\"%s)), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL })",
        ei, if (isTRUE(e$consistent)) "TRUE" else "FALSE", boot)
    } else sprintf("  res[[%d]] <- tryCatch(cb_stats(sem(cb_model, data = data, estimator = \"%s\"), mc_seed), error = function(e) { mc_errors <<- c(mc_errors, conditionMessage(e)); NULL })", ei, e$estimator)
  }))
  c("suppressPackageStartupMessages({ library(lavaan); library(cSEM) })",
    sprintf("vars <- %s", ps_q(vars)),
    "pop_model <- '", paste0("  ", pop), "'",
    sprintf("skew <- %s; kurt <- %s", paste(deparse(as.numeric(req$population$skew)), collapse = ""), paste(deparse(as.numeric(req$population$kurtosis)), collapse = "")),
    "pls_model <- '", paste0("  ", plsm), "'",
    "cb_model <- '", paste0("  ", cbm), "'",
    sprintf("alpha <- %s; mc_draws <- %d", format(ps_number(req$alpha, "significance level")), as.integer(req$mcDraws)),
    "# Parameters to evaluate: standardised paths and indirect effects between constructs.",
    "params <- data.frame(kind = ", ps_q(vapply(req$params, `[[`, "", "kind")), ", from = ", ps_q(vapply(req$params, `[[`, "", "from")),
    ", to = ", ps_q(vapply(req$params, `[[`, "", "to")), ")",
    "effects <- function(B) { Tm <- solve(diag(nrow(B)) - B) - diag(nrow(B)); dimnames(Tm) <- dimnames(B); list(direct = B, indirect = Tm - B) }",
    "# PLS: path and indirect estimates; with bootstrap draws, percentile CIs and a t test.",
    "pls_stats <- function(fit) {",
    "  if (!isTRUE(fit$Information$Weight_info$Convergence_status)) stop('not converged')",
    "  P <- t(fit$Estimates$Path_estimates); E <- effects(P)",
    "  r <- fit$Estimates$Estimates_resample$Estimates1",
    "  draw <- function(k) {",
    "    if (is.null(r)) return(NULL)",
    "    nm <- paste(params$to[k], '~', params$from[k])",
    "    x <- if (params$kind[k] == 'path') r$Path_estimates$Resampled[, nm] else r$Indirect_effect$Resampled[, nm]",
    "    x[is.finite(x)]",
    "  }",
    "  out <- lapply(seq_len(nrow(params)), function(k) {",
    "    if (params$kind[k] == 'fit') return(c(NA, NA, NA, NA))",
    "    v <- if (params$kind[k] == 'path') E$direct[params$from[k], params$to[k]] else E$indirect[params$from[k], params$to[k]]",
    "    x <- draw(k)",
    "    if (is.null(x) || length(x) < 2) return(c(v, NA, NA, NA))",
    "    q <- stats::quantile(x, c(alpha / 2, 1 - alpha / 2)); t <- v / stats::sd(x)",
    "    c(v, q[[1]], q[[2]], as.numeric(2 * stats::pt(-abs(t), length(x) - 1) < alpha))",
    "  })",
    "  list(values = do.call(rbind, out), proper = 1)",
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
    "    if (params$kind[k] == 'fit') {",
    "      pv <- if (scaled) fm[['pvalue.scaled']] else fm[['pvalue']]",
    "      return(c(if (scaled) fm[['chisq.scaled']] else fm[['chisq']], NA, NA, if (is.finite(pv)) as.numeric(pv < alpha) else NA))",
    "    }",
    "    f <- params$from[k]; t <- params$to[k]",
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
    "one_replication <- function(n, seed, boot_seed, mc_seed) {",
    "  set.seed(seed)",
    "  data <- simulateData(pop_model, sample.nobs = n, skewness = skew, kurtosis = kurt)[, vars]",
    "  res <- list()",
    est_lines,
    "  res",
    "}")
}

ps_mc <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  body <- ps_mc_body(req)
  seeds <- req$seeds  # list of {n, rep, data, boot, mc}
  run <- c("mc_errors <- character(0)",
    "results <- lapply(seq_len(nrow(seeds)), function(i) one_replication(seeds$n[i], seeds$data[i], seeds$boot[i], seeds$mc[i]))",
    "# Estimations that failed count as not converged; how many, and why, is reported.",
    "if (length(mc_errors)) warning(sprintf(\"%d estimations failed or did not converge (counted as not converged); most common: %s\", length(mc_errors), names(sort(table(mc_errors), decreasing = TRUE))[1]))")
  sd <- data.frame(n = vapply(seeds, `[[`, 0, "n"), rep = vapply(seeds, `[[`, 0, "rep"), data = vapply(seeds, `[[`, 0, "data"),
    boot = vapply(seeds, `[[`, 0, "boot"), mc = vapply(seeds, `[[`, 0, "mc"))
  if (export) {
    est_ids <- vapply(req$estimators, `[[`, "", "id")
    report <- c(
      sprintf("estimators <- %s", ps_q(est_ids)),
      "truth <- c(", paste0("  ", vapply(req$params, function(p) ps_num(p$value), ""), c(rep(",", length(req$params) - 1), "")), ")",
      "# Summary: mean, bias, SD, RMSE (standardised); coverage and rejection rate (power, or Type I error when the truth is 0).",
      "summary_rows <- do.call(rbind, lapply(sort(unique(seeds$n)), function(n) do.call(rbind, lapply(seq_along(estimators), function(e) do.call(rbind, lapply(seq_len(nrow(params)), function(k) {",
      "  vals <- do.call(rbind, lapply(results[seeds$n == n], function(r) if (is.null(r[[e]])) c(NA, NA, NA, NA) else r[[e]]$values[k, ]))",
      "  ok <- is.finite(vals[, 1]); x <- vals[ok, 1]",
      "  data.frame(n = n, estimator = estimators[e], parameter = paste(params$kind[k], params$from[k], params$to[k]), reps = sum(ok),",
      "    mean = mean(x), bias = if (params$kind[k] == 'fit') NA else mean(x) - truth[k], sd = stats::sd(x),",
      "    rmse = if (params$kind[k] == 'fit') NA else sqrt(mean((x - truth[k])^2)), rejection = mean(vals[ok, 4], na.rm = TRUE))",
      "}))))))",
      "print(summary_rows, digits = 3)")
    return(paste(ps_script("Monte Carlo simulation (lavaan::simulateData; cSEM / lavaan)", c("lavaan", "cSEM"), list(seeds = sd), c(body, run), report), collapse = "\n"))
  }
  env <- ps_run(c(body, run), list(seeds = sd))
  E <- length(req$estimators); K <- length(req$params)
  pick <- function(col) lapply(seq_len(E), function(e) lapply(seq_len(K), function(k) vapply(env$results, function(r) if (is.null(r[[e]])) NA_real_ else r[[e]]$values[k, col], 0)))
  ps_json(list(est = pick(1), lo = pick(2), hi = pick(3), sig = pick(4),
    proper = lapply(seq_len(E), function(e) vapply(env$results, function(r) if (is.null(r[[e]])) NA_real_ else r[[e]]$proper, 0)),
    warnings = env$.warnings))
}
