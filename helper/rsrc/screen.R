# Data screening: univariate distributions (psych::describe), multivariate
# normality (Mardia's test, psych::mardia), multivariate outliers (Mahalanobis
# distances against the chi-square distribution), and, for a CB-SEM model, case
# influence by leave-one-out refits (semfindr: generalized Cook's distance,
# change in fit).

ps_screen <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two variables.")
  alpha <- ps_number(req$alpha %||% 0.001, "outlier significance level")
  if (alpha <= 0 || alpha >= 0.5) stop("Invalid outlier significance level.")
  fr <- ps_long_frame(req, vars)
  v <- ps_lookup(fr$v, vars)
  body <- c(
    "suppressPackageStartupMessages(library(psych))",
    sprintf("X <- data[, %s]", ps_q(v)),
    "# Univariate: mean, SD, skewness and excess kurtosis (psych's type 3), missing values.",
    "desc <- describe(X)",
    "missing <- colSums(is.na(X))",
    "# Mardia's multivariate skewness and kurtosis (complete cases).",
    "Xc <- X[complete.cases(X), , drop = FALSE]",
    "mard <- mardia(Xc, plot = FALSE)",
    "# Mahalanobis distance of each complete case from the centroid; p from chi-square with",
    sprintf("# df = number of variables. Cases with p < %s are flagged (Tabachnick & Fidell).", format(alpha)),
    "d2 <- mahalanobis(Xc, colMeans(Xc), cov(Xc))",
    "p <- pchisq(d2, df = ncol(Xc), lower.tail = FALSE)",
    "rows <- as.integer(rownames(Xc))",
    sprintf("flagged <- rows[p < %s]", format(alpha)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Data screening (psych)", "psych", inputs, body, c("desc", "mard", "flagged")), collapse = "\n"))
  env <- ps_run(body, inputs)
  d <- env$desc; m <- env$mard
  ps_json(list(
    variables = ps_back(rownames(d), fr$back, FALSE),
    describe = lapply(seq_len(nrow(d)), function(i) list(n = d$n[i], missing = unname(env$missing[i]), mean = d$mean[i], sd = d$sd[i],
      median = d$median[i], min = d$min[i], max = d$max[i], skew = d$skew[i], kurtosis = d$kurtosis[i])),
    mardia = list(n = m$n.obs, p = m$n.var, b1p = m$b1p, b2p = m$b2p, skew = m$skew, smallSkew = m$small.skew, pSkew = m$p.skew,
      pSmall = m$p.small, kurtosis = m$kurtosis, pKurt = m$p.kurt, df = m$n.var * (m$n.var + 1) * (m$n.var + 2) / 6),
    cases = list(rows = env$rows, d2 = unname(env$d2), p = unname(env$p)), alpha = alpha, df = length(vars),
    warnings = env$.warnings, engine = list(package = "psych", version = as.character(utils::packageVersion("psych")))))
}

#' Case influence on a CB-SEM model: the model refitted without each case in turn
#' (semfindr::lavaan_rerun), then generalized Cook's distance, Mahalanobis distance
#' and the change in chi-square and fit indices (semfindr::influence_stat); or
#' `approach = "approximate"`: semfindr's approximations from the one fit (influence_stat(fit)).
ps_influence <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (b$matrix_input) stop("Case influence needs raw data; this dataset is a covariance matrix.")
  if (isTRUE(b$mi)) stop("Case influence is not available with multiple imputation; use FIML or casewise deletion.")
  if (isTRUE(b$robust)) stop("Case influence refits the model by ML; choose ML or MLR (robust ML already down-weights influential cases).")
  if (!is.null(b$modsem)) stop("Case influence is not available for LMS / QML models.")
  if (!is.null(b$cluster_var)) stop("Case influence is not available for two-level models.")
  cores <- as.integer(req$cores %||% 1L)
  if (is.na(cores) || cores < 1L || cores > 64L) stop("Invalid number of cores.")
  # (forking is unavailable in R in the browser)
  par <- cores > 1L && !grepl("emscripten", R.version$platform)
  approach <- req$approach %||% "exact"
  if (!approach %in% c("exact", "approximate")) stop("Invalid influence approach in the request.")
  body <- c(b$body,
    "suppressPackageStartupMessages(library(semfindr))",
    if (approach == "approximate") c(
      "# The approximate approach: the influence statistics from the one fit, without refitting (semfindr).",
      "infl <- influence_stat(fit)")
    else c(
      "# Leave-one-out: the model refitted without each case (semfindr), then the influence statistics.",
      sprintf("rerun <- lavaan_rerun(fit, parallel = %s, progress = FALSE%s)", if (par) "TRUE" else "FALSE", if (par) sprintf(", ncores = %d", cores) else ""),
      "infl <- influence_stat(rerun)"),
    "rows <- as.integer(rownames(data))[as.integer(rownames(infl))]",
    "# Each case's contribution to Mardia's multivariate kurtosis b2,p of the model's indicators (as psych::mardia:",
    "# complete cases, the sample covariance matrix): d_i^4 / n, with d_i^2 the case's Mahalanobis distance; they sum to b2,p.",
    sprintf("Xk <- as.matrix(data[, %s, drop = FALSE]); okk <- complete.cases(Xk); Xk <- Xk[okk, , drop = FALSE]", ps_q(unname(b$n$iv[b$n$all_inds]))),
    "kurt_d2 <- mahalanobis(Xk, colMeans(Xk), cov(Xk))",
    "kurt_i <- kurt_d2^2 / nrow(Xk)",
    "kurt_rows <- as.integer(rownames(data))[okk]")
  inputs <- b$inputs
  g <- if (approach == "approximate") "gcd_approx" else "gcd"
  if (export) return(paste(ps_script("Case influence (semfindr)", c("lavaan", "semfindr"), inputs, body, c(sprintf("head(infl[order(-infl[, \"%s\"]), c(\"%s\", \"md\", \"chisq\")], 10)", g, g), "sum(kurt_i)  # = Mardia's b2,p", "head(sort(setNames(kurt_i, kurt_rows), decreasing = TRUE), 10)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  infl <- env$infl
  col <- function(k) if (k %in% colnames(infl)) unname(infl[, k]) else rep(NA_real_, nrow(infl))
  ps_json(list(approach = approach, rows = env$rows, gcd = col(g), md = col("md"), chisq = col("chisq"), cfi = col("cfi"), rmsea = col("rmsea"), tli = col("tli"),
    kurtosis = list(rows = env$kurt_rows, contribution = unname(env$kurt_i), b2p = sum(env$kurt_i), p = ncol(env$Xk)),
    warnings = env$.warnings, engine = list(package = "semfindr", version = as.character(utils::packageVersion("semfindr")))))
}

#' Missing data as Mplus's TYPE = BASIC describes them: the patterns of missing values (Mplus's order: a pattern read as
#' a binary number, a missing value 1, the first variable the most significant digit) with their frequencies, the
#' covariance coverage (the proportion of cases with both values), the EM estimates of the means, covariances and
#' correlations (the unrestricted H1 model by FIML, lavaan), the H1 log-likelihood, and, for repeated measures
#' (DATA MISSING: TYPE = DDROPOUT), Mplus's dropout descriptives: a case drops out at occasion t when it is observed at
#' t - 1 and missing from t on; a non-dropout is observed at the last occasion; intermittent missing is a missing value
#' before that. A second set of variables (Mplus DESCRIPTIVE = y0-y5 | * z1-z5) is described by the same groups, each
#' variable at its occasion ("" for none).
ps_missing <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- as.character(unlist(req$vars)); meas <- as.character(unlist(req$measures)); desc <- as.character(unlist(req$descriptive))
  if (length(vars) < 1 || length(vars) > 200 || anyDuplicated(vars)) stop("Choose 1 to 200 variables.")
  if (length(meas) == 1 || length(meas) > 50 || anyDuplicated(meas)) stop("Dropout needs 2 to 50 repeated measures, in time order.")
  if (length(desc) && length(desc) != length(meas)) stop("The second set of variables needs one entry per occasion (empty for none).")
  if (length(desc) && !length(meas)) stop("The second set of variables is described by dropout: choose the repeated measures.")
  # Little's (1988) MCAR test and Jamshidian & Jalal's (2010) tests (misty::na.test; mvnmle's ML estimates)
  mcar <- isTRUE(req$mcar); jamjal <- isTRUE(req$jamjal)
  seed <- as.integer(ps_number(req$seed %||% 42, "seed"))
  if (is.na(seed)) stop("Invalid seed.")
  if ((mcar || jamjal) && length(vars) > 50) stop("The MCAR tests take at most 50 variables (mvnmle::mlest).")
  if ((mcar || jamjal) && length(vars) < 2) stop("The MCAR tests need at least two variables.")
  used <- unique(c(vars, meas, desc[nzchar(desc)]))
  fr <- ps_long_frame(req, used)
  if ((mcar || jamjal) && !anyNA(fr$data[ps_lookup(fr$v, vars)])) { ps_note("No value of the variables is missing: the MCAR tests do not apply."); mcar <- jamjal <- FALSE }
  v <- ps_lookup(fr$v, vars); vm <- ps_lookup(fr$v, meas); vd <- vapply(desc, function(x) if (nzchar(x)) ps_lookup(fr$v, x) else "", "")
  body <- c(
    "suppressPackageStartupMessages(library(lavaan))",
    sprintf("X <- as.matrix(data[, %s, drop = FALSE])", ps_q(v)),
    "n <- nrow(X); M <- is.na(X)",
    "# Missing-data patterns (x = observed), in Mplus's order: the pattern as a binary number, a missing value 1, the first",
    "# variable the most significant digit; with their frequencies",
    "key <- apply(M, 1, function(m) paste(as.integer(m), collapse = \"\"))",
    "freq <- table(key); pats <- names(freq)[order(names(freq))]",
    "patterns <- lapply(pats, function(k) list(observed = strsplit(k, \"\")[[1]] == \"0\", n = unname(as.integer(freq[k]))))",
    "# Covariance coverage: the proportion of cases with both values",
    "coverage <- crossprod(!M) / n",
    "# EM estimates of the means and covariance matrix (the unrestricted model by FIML, lavaan) and its log-likelihood",
    "h1 <- lavaan::lavCor(as.data.frame(X), missing = \"ml\", output = \"fit\", se = \"none\", test = \"none\")",
    "em <- lavaan::lavInspect(h1, \"h1\")",
    "em_mean <- em$mean[colnames(X)]; em_cov <- em$cov[colnames(X), colnames(X)]",
    "loglik_h1 <- tryCatch(sum(vapply(unique(key), function(k) {",
    "  i <- which(key == k); o <- !M[i[1], ]",
    "  if (!any(o)) return(0)",
    "  R <- chol(em_cov[o, o, drop = FALSE])",
    "  z <- backsolve(R, t(sweep(X[i, o, drop = FALSE], 2, em_mean[o])), transpose = TRUE)",
    "  -0.5 * (length(i) * (sum(o) * log(2 * pi) + 2 * sum(log(diag(R)))) + sum(z^2))",
    "}, 0)), error = function(e) NA_real_)",
    "# (a covariance matrix near singular, e.g. with variables that are functions of the missingness: no finite maximum)",
    "singular <- min(eigen(em_cov, symmetric = TRUE, only.values = TRUE)$values) < 1e-6 * max(diag(em_cov))")
  if (mcar || jamjal) body <- c(body, "suppressPackageStartupMessages(library(misty))")
  if (mcar) body <- c(body,
    "# Little's (1988) MCAR test (misty::na.test): d2 = sum over the patterns j of n_j (ybar_j - mu)' Sigma^-1 (ybar_j - mu),",
    "# each over the pattern's k_j observed variables, mu and Sigma the ML estimates (mvnmle::mlest); df = sum of k_j - p",
    "little <- misty::na.test(as.data.frame(X), print = \"little\", output = FALSE)$result$little",
    "# Each pattern's share of d2 (cases missing on every variable are left out, as na.test does)",
    "Xm <- X[rowSums(!M) > 0, , drop = FALSE]",
    "ml <- suppressWarnings(mvnmle::mlest(Xm))",
    "km <- apply(is.na(Xm), 1, function(m) paste(as.integer(m), collapse = \"\"))",
    "little_patterns <- lapply(sort(unique(km)), function(k) {",
    "  i <- which(km == k); o <- strsplit(k, \"\")[[1]] == \"0\"",
    "  dev <- colMeans(Xm[i, o, drop = FALSE]) - ml$muhat[o]",
    "  list(observed = o, n = length(i), k = sum(o), d2 = length(i) * drop(crossprod(dev, solve(ml$sigmahat[o, o, drop = FALSE], dev))))",
    "})")
  if (jamjal) body <- c(body,
    "# Jamshidian & Jalal's (2010) tests (misty::na.test, after MissMech::TestMCARNormality): the data imputed 20 times",
    "# (nonparametric), the patterns' covariance matrices compared by Hawkins's test of homoscedasticity, and the",
    "# patterns' distributions by a k-sample Anderson-Darling test; patterns with fewer than 6 cases are left out",
    sprintf("jj <- tryCatch(misty::na.test(as.data.frame(X), print = \"jamjal\", seed = %d, output = FALSE)$result, error = function(e) conditionMessage(e))", seed))
  if (length(meas)) body <- c(body,
    "# Dropout (Mplus DATA MISSING: TYPE = DDROPOUT): out at occasion t (t = 1, ...) when observed at t - 1 and missing from t on",
    sprintf("Y <- as.matrix(data[, %s, drop = FALSE]); MY <- is.na(Y); Tn <- ncol(Y)", ps_q(vm)),
    "out_at <- rep(NA_integer_, n)",
    "for (t in seq_len(Tn - 1)) out_at[!MY[, t] & rowSums(MY[, (t + 1):Tn, drop = FALSE]) == Tn - t] <- t",
    "dropout <- !is.na(out_at); stayer <- !MY[, Tn]",
    "# intermittent missing: a missing value of the set before the dropout (or, for a non-dropout, anywhere); the dropout",
    "# counts use the repeated measures",
    "last <- ifelse(dropout, out_at, Tn)",
    "gaps <- function(MS) vapply(seq_len(n), function(i) any(MS[i, seq_len(last[i])]), TRUE)",
    "intermittent <- gaps(MY)",
    "describe <- function(x, keep) { x <- x[keep & !is.na(x)]; list(n = length(x), mean = if (length(x)) mean(x) else NA_real_, sd = if (length(x) > 1) stats::sd(x) else NA_real_) }",
    "# Each variable at its occasion t (0 = the first): who drops out after it, and the totals",
    "occasion <- function(x, t, intermittent) {",
    "  rows <- list()",
    "  if (t < Tn - 1) rows <- c(rows, list(c(list(group = \"after\", time = t + 1), describe(x, out_at %in% (t + 1))), c(list(group = \"stayAfter\", time = t + 1), describe(x, !(out_at %in% (t + 1))))))",
    "  dt <- dropout & out_at > t",
    "  # (no case drops out after the last occasion)",
    "  if (t < Tn - 1) rows <- c(rows, list(c(list(group = \"dropouts\"), describe(x, dt)), c(list(group = \"dropoutsNoIntermittent\"), describe(x, dt & !intermittent)),",
    "    c(list(group = \"dropoutsIntermittent\"), describe(x, dt & intermittent))))",
    "  c(rows, list(c(list(group = \"nonDropouts\"), describe(x, stayer)),",
    "    c(list(group = \"nonDropoutsComplete\"), describe(x, stayer & !intermittent)), c(list(group = \"nonDropoutsIntermittent\"), describe(x, stayer & intermittent)),",
    "    c(list(group = \"total\"), describe(x, dt | stayer))))",
    "}",
    "set1 <- lapply(seq_len(Tn), function(t) occasion(Y[, t], t - 1, intermittent))",
    if (length(desc)) c(sprintf("D2 <- data[, %s, drop = FALSE]", ps_q(unname(vd[nzchar(vd)]))),
      "# (the second set's intermittent missing is its own: an occasion without a variable counts as observed)",
      sprintf("at2 <- %s", sprintf("c(%s)", paste(which(nzchar(vd)), collapse = ", "))),
      "M2 <- matrix(FALSE, n, Tn); M2[, at2] <- is.na(as.matrix(D2))",
      "set2 <- lapply(seq_along(at2), function(k) occasion(D2[[k]], at2[k] - 1, gaps(M2)))"))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Missing data (patterns, coverage, EM estimates, dropout%s)", if (mcar || jamjal) ", MCAR tests" else ""), c("lavaan", if (mcar || jamjal) c("misty", "mvnmle")), inputs, body,
    c("patterns", "coverage", "em_mean", "em_cov", "loglik_h1", if (mcar) c("little", "little_patterns"), if (jamjal) "jj[c(\"hawkins\", \"anderson\")]", if (length(meas)) c("table(out_at, useNA = \"ifany\")", "set1"), if (length(desc)) "set2")), collapse = "\n"))
  env <- ps_run(body, inputs)
  sym <- function(S) lapply(seq_len(nrow(S)), function(i) unname(S[i, ]))
  em_cor <- stats::cov2cor(env$em_cov)
  res <- list(variables = I(vars), n = env$n, patterns = env$patterns, coverage = sym(env$coverage),
    em = list(means = I(unname(env$em_mean)), cov = sym(env$em_cov), cor = sym(em_cor), loglik = if (is.finite(env$loglik_h1) && !env$singular) env$loglik_h1 else NULL, singular = env$singular),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan"))))
  if (mcar) {
    L <- env$little
    res$little <- list(n = L$no.cases, incomplete = L$no.incomplete, patterns = L$no.pattern, chisq = L$statistic, df = L$df, p = L$p,
      byPattern = lapply(env$little_patterns, function(x) list(observed = I(x$observed), n = x$n, k = x$k, d2 = x$d2)))
  }
  if (jamjal) {
    jj <- env$jj
    res$jamjal <- if (is.character(jj)) list(error = ps_flat(jj)) else list(n = jj$hawkins$no.cases, incomplete = jj$hawkins$no.incomplete, patterns = jj$hawkins$no.pattern,
      patternN = I(as.integer(jj$jamjal$n.pattern)), hawkins = list(stat = jj$hawkins$statistic, df = jj$hawkins$df, p = jj$hawkins$p),
      anderson = list(stat = jj$anderson$statistic, p = jj$anderson$p), seed = seed)
  }
  if (mcar || jamjal) res$engine <- list(package = "misty", version = as.character(utils::packageVersion("misty")), lavaan = as.character(utils::packageVersion("lavaan")), mvnmle = as.character(utils::packageVersion("mvnmle")))
  if (length(meas)) {
    res$dropout <- list(measures = I(meas), dropouts = sum(env$dropout), nonDropoutsComplete = sum(env$stayer & !env$intermittent), nonDropoutsIntermittent = sum(env$stayer & env$intermittent),
      byTime = I(vapply(seq_len(length(meas) - 1), function(t) sum(env$out_at %in% t), 0L)),
      set1 = lapply(seq_along(meas), function(t) list(variable = meas[t], time = t - 1, rows = env$set1[[t]])),
      set2 = if (length(desc)) { w <- which(nzchar(desc)); lapply(seq_along(w), function(k) list(variable = desc[w[k]], time = w[k] - 1, rows = env$set2[[k]])) } else list())
  }
  ps_json(res)
}
