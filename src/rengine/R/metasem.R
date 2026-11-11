# Meta-analytic SEM by two-stage structural equation modelling (TSSEM; Cheung &
# Chan 2005) with metaSEM (Cheung): stage 1 pools the studies' correlation
# matrices (fixed effects, or random effects with a chosen heterogeneity
# structure; tssem1), stage 2 fits the CB-SEM model drawn on the canvas to the
# pooled matrix by weighted least squares (tssem2), its RAM matrices from the
# model's lavaan syntax (lavaan2RAM). The input is one row per study: its N and
# the lower-triangle correlations of the model's observed variables (NA where a
# study did not report one); no raw data. metaSEM runs on OpenMx, which has no
# build for R in the browser: desktop R only.

#' The studies' correlation matrices from the request: names (the model's observed variables, in order) and per study
#' its N and the p(p - 1)/2 correlations of the lower triangle by rows of the upper (A-C, A-ES, ..., E-I), NA allowed.
#' Strictly checked: |r| < 1, N a whole number above 2, every study with a correlation, every pair in some study.
ps_metasem_studies <- function(meta, vars) {
  p <- length(vars)
  st <- meta$studies
  if (!is.list(st) || length(st) < 2 || length(st) > 5000) {
    stop("Meta-analytic SEM needs 2 to 5000 studies.")
  }
  pairs <- which(upper.tri(diag(p)), arr.ind = TRUE)
  pairs <- pairs[order(pairs[, 1], pairs[, 2]), , drop = FALSE]
  n <- numeric(length(st))
  R <- vector("list", length(st))
  for (k in seq_along(st)) {
    s <- st[[k]]
    nk <- s$n
    if (!is.numeric(nk) || length(nk) != 1 || !is.finite(nk) || nk != round(nk) || nk < 3 || nk > 1e8) {
      stop(sprintf("Study %d: N must be a whole number of at least 3.", k))
    }
    r <- s$r
    r <- if (is.null(r)) rep(NA_real_, nrow(pairs)) else as.numeric(vapply(r, function(x) if (is.null(x)) NA_real_ else as.numeric(x), 0))
    if (length(r) != nrow(pairs)) {
      stop(sprintf("Study %d: %d correlations expected, one per pair of the model's %d observed variables.", k, nrow(pairs), p))
    }
    if (any(!is.na(r) & (!is.finite(r) | abs(r) >= 1))) {
      stop(sprintf("Study %d: a correlation is not between -1 and 1.", k))
    }
    if (all(is.na(r))) stop(sprintf("Study %d reports none of the correlations.", k))
    m <- diag(p)
    m[pairs] <- r
    m[pairs[, 2:1, drop = FALSE]] <- r
    # A variable a study did not measure: its whole row and column missing (metaSEM's convention), the diagonal too.
    gone <- vapply(seq_len(p), function(i) all(is.na(m[i, -i])), TRUE)
    m[gone, ] <- NA
    m[, gone] <- NA
    dimnames(m) <- list(vars, vars)
    n[k] <- nk
    R[[k]] <- m
  }
  seen <- Reduce(`+`, lapply(R, function(m) !is.na(m)))
  if (any(seen[pairs] == 0)) {
    w <- pairs[seen[pairs] == 0, , drop = FALSE][1, ]
    stop(sprintf("No study reports the correlation of %s and %s.", vars[w[1]], vars[w[2]]))
  }
  names(R) <- paste0("Study", seq_along(R))
  list(R = R, n = n)
}

ps_metasem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (ps_in_browser()) {
    stop("Meta-analytic SEM (metaSEM, OpenMx) runs in desktop R: choose Desktop R (helper) under R runs in.")
  }
  meta <- req$meta
  method <- meta[["method", exact = TRUE]] %||% "REM"
  if (!(is.character(method) && length(method) == 1 && method %in% c("FEM", "REM"))) {
    stop("Invalid stage-1 method in the request.")
  }
  re_type <- meta[["reType", exact = TRUE]] %||% "Diag"
  if (!(is.character(re_type) && length(re_type) == 1 && re_type %in% c("Diag", "Symm", "Zero"))) {
    stop("Invalid random-effects structure in the request.")
  }
  # The canvas model's lavaan syntax, as the Model tab writes it (factors identified by unit variances, as TSSEM on
  # correlations does: lavaan2RAM's std.lv); built against a placeholder correlation matrix of its observed variables.
  n0 <- ps_names(req$model$constructs)
  vars <- n0$all_inds
  if (length(vars) < 2 || length(vars) > 60) {
    stop("Meta-analytic SEM needs a model of 2 to 60 observed variables.")
  }
  if (length(req$model$moderations)) {
    stop("Meta-analytic SEM is not available with latent interactions.")
  }
  if (!is.null(req$model$multigroup) || !is.null(req$model$multilevel)) {
    stop("Meta-analytic SEM fits one pooled matrix: remove the grouping or the levels.")
  }
  if (length(unlist(req$model$ordered))) {
    stop("Meta-analytic SEM pools correlations: the model cannot have ordinal indicators.")
  }
  req$model$identification <- "unit"
  req$estimator <- "ML"
  req$missing <- "casewise"
  req$data <- list(names = vars, moments = list(S = diag(length(vars)), n = 1000))
  b <- ps_cb_build(req)
  if (length(b$composites)) stop("Composites (<~) are not available in meta-analytic SEM.")
  if (length(b$esem_blocks)) stop("ESEM blocks are not available in meta-analytic SEM.")
  if (isTRUE(b$means)) {
    stop("Meta-analytic SEM on correlations has no mean structure: remove the constant.")
  }
  iv <- unname(b$n$iv[vars])
  studies <- ps_metasem_studies(meta, iv)
  inputs <- list(n = studies$n)
  # (the matrices are written into the script one by one: ps_script embeds matrices and plain vectors)
  for (k in seq_along(studies$R)) inputs[[sprintf("R%d", k)]] <- studies$R[[k]]
  body <- c(
    "suppressPackageStartupMessages(library(metaSEM))",
    sprintf("R <- list(%s)", paste(sprintf("Study%d = R%d", seq_along(studies$R), seq_along(studies$R)), collapse = ", ")),
    sprintf("# Stage 1: the studies' correlation matrices pooled (%s)", if (method == "FEM") "fixed effects: one common matrix, its homogeneity tested" else sprintf("random effects, heterogeneity variances %s", c(Diag = "of each correlation (diagonal)", Symm = "and their covariances (symmetric)", Zero = "fixed at zero")[[re_type]])),
    sprintf("stage1 <- tssem1(R, n, method = \"%s\"%s)", method, if (method == "REM") sprintf(", RE.type = \"%s\"", re_type) else ""),
    "s1 <- summary(stage1)",
    if (method == "FEM") "pooled <- coef(stage1)" else c("pooled <- vec2symMat(coef(stage1, select = \"fixed\"), diag = FALSE)", "dimnames(pooled) <- list(colnames(R[[1]]), colnames(R[[1]]))"),
    "# Stage 2: the model on the canvas, its RAM matrices from its lavaan syntax, fitted to the pooled matrix (WLS)",
    "model <- '", ps_model_lines(b), "'",
    sprintf("RAM <- lavaan2RAM(model, obs.variables = %s)", ps_q(iv)),
    "stage2 <- tssem2(stage1, RAM = RAM)",
    "s2 <- summary(stage2)"
  )
  if (export) {
    return(ps_script(sprintf("Meta-analytic SEM (TSSEM, %s)", if (method == "FEM") "fixed effects" else "random effects"), "metaSEM", inputs, body, c("s1", "s2")))
  }
  env <- ps_run(body, inputs)
  back <- ps_back_map(b)
  nm <- function(x) unname(ps_back(x, back))
  s1 <- env$s1
  s2 <- env$s2
  # Stage 1: the pooled correlations with their standard errors (and, random effects, heterogeneity variances and I2)
  co1 <- s1$coefficients
  p <- length(iv)
  low <- which(lower.tri(diag(p)), arr.ind = TRUE)
  low <- low[order(low[, 2], low[, 1]), , drop = FALSE]
  fixed_rows <- if (method == "FEM") seq_len(nrow(low)) else grep("^Intercept", rownames(co1))
  tau_rows <- if (method == "REM") grep("^Tau2_([0-9]+)_\\1$", rownames(co1)) else integer(0)
  i2 <- if (method == "REM" && !is.null(s1$I2.values)) s1$I2.values[, "Estimate"] else NULL
  pooled <- lapply(seq_len(nrow(low)), function(k) {
    i <- fixed_rows[k]
    cell <- function(col) if (col %in% colnames(co1)) co1[i, col] else NULL
    list(
      a = nm(iv[low[k, 2]]), b = nm(iv[low[k, 1]]), r = co1[i, "Estimate"], se = co1[i, "Std.Error"], low = cell("lbound"), high = cell("ubound"),
      tau2 = if (length(tau_rows) >= k && re_type != "Zero") co1[tau_rows[k], "Estimate"] else NULL, i2 = if (!is.null(i2) && length(i2) >= k) unname(i2[k]) else NULL
    )
  })
  st1 <- if (method == "FEM") s1$stat else NULL
  stat1 <- function(k) if (!is.null(st1) && k %in% rownames(st1)) unname(st1[k, 1]) else NULL
  stage1 <- list(
    method = method, reType = if (method == "REM") re_type else NULL, studies = length(studies$n), totalN = sum(studies$n), pooled = pooled,
    q = if (method == "REM") unname(as.numeric(s1$Q.stat$Q)) else NULL, qDf = if (method == "REM") unname(as.numeric(s1$Q.stat$Q.df)) else NULL, qP = if (method == "REM") unname(as.numeric(s1$Q.stat$pval)) else NULL,
    chisq = stat1("Chi-square of target model"), df = stat1("DF of target model"), p = stat1("p value of target model"),
    rmsea = stat1("RMSEA"), srmr = stat1("SRMR"), cfi = stat1("CFI"), status = s1$Mx.status1
  )
  # Stage 2: each free parameter by where RAM puts it (A: a regression or loading, from column to row; S: a covariance)
  A <- env$RAM$A
  S <- env$RAM$S
  lab <- function(x) sub("^[^*]*\\*", "", x)
  find <- function(l) {
    w <- which(grepl("\\*", A) & lab(A) == l, arr.ind = TRUE)
    if (nrow(w)) {
      return(list(kind = if (rownames(A)[w[1, 1]] %in% iv && !colnames(A)[w[1, 2]] %in% iv) "loading" else "regression", from = colnames(A)[w[1, 2]], to = rownames(A)[w[1, 1]]))
    }
    w <- which(grepl("\\*", S) & lab(S) == l, arr.ind = TRUE)
    if (nrow(w)) {
      return(list(kind = if (w[1, 1] == w[1, 2]) "variance" else "covariance", from = colnames(S)[w[1, 2]], to = rownames(S)[w[1, 1]]))
    }
    list(kind = "other", from = l, to = l)
  }
  co2 <- s2$coefficients
  params <- lapply(rownames(co2), function(l) {
    f <- find(l)
    list(
      label = l, kind = f$kind, from = nm(f$from), to = nm(f$to), est = co2[l, "Estimate"], se = co2[l, "Std.Error"], low = co2[l, "lbound"], high = co2[l, "ubound"],
      z = co2[l, "z value"], p = co2[l, "Pr(>|z|)"]
    )
  })
  st2 <- s2$stat
  stat2 <- function(k) if (k %in% rownames(st2)) unname(st2[k, 1]) else NULL
  fit <- list(
    n = stat2("Sample size"), chisq = stat2("Chi-square of target model"), df = stat2("DF of target model"), p = stat2("p value of target model"),
    baselineChisq = stat2("Chi-square of independence model"), baselineDf = stat2("DF of independence model"), rmsea = stat2("RMSEA"), rmseaLow = stat2("RMSEA lower 95% CI"),
    rmseaHigh = stat2("RMSEA upper 95% CI"), srmr = stat2("SRMR"), tli = stat2("TLI"), cfi = stat2("CFI"), aic = stat2("AIC"), bic = stat2("BIC")
  )
  ps_json(list(
    stage1 = stage1, stage2 = list(params = params, fit = fit, status = s2$Mx.status1), variables = I(nm(iv)),
    warnings = env$.warnings, engine = ps_engine("metaSEM", openmx = "OpenMx")
  ))
}
