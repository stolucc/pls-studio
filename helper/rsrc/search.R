# Model search and modification for the CB-SEM model on the canvas (lavaan):
# the specification search over optional arrows (as Amos), equivalent models
# confirmed by their fit, EQS's multivariate Lagrange multiplier and Wald
# tests, and regularised SEM (lslx). Each function builds the model's lavaan
# script (ps_cb_build), adds its own lines, runs exactly that script, and
# returns the script instead with export = TRUE.

#' lavaan names of an arrow of the diagram: c(lhs, op, rhs) for a path (to ~ from) or a covariance (a ~~ b).
ps_arrow_lavaan <- function(b, o) {
  lv <- function(x) { if (!(is.character(x) && length(x) == 1 && x %in% names(b$lname))) stop("Unknown construct in the request."); unname(b$lname[[x]]) }
  iv <- function(x) { if (!(is.character(x) && length(x) == 1 && x %in% names(b$n$iv))) stop("Unknown indicator in the request."); unname(b$n$iv[[x]]) }
  if (identical(o$type, "path")) c(lv(o$to), "~", lv(o$from))
  else if (identical(o$type, "cov") && identical(o$kind, "indicator")) c(iv(o$a), "~~", iv(o$b))
  else if (identical(o$type, "cov") && identical(o$kind, "construct")) c(lv(o$a), "~~", lv(o$b))
  else stop("Invalid arrow in the request.")
}

#' A list of c(lhs, op, rhs) as R code.
ps_arrows_code <- function(arrows) sprintf("list(%s)", paste(vapply(arrows, function(a) sprintf("c(%s)", paste(encodeString(a, quote = '"'), collapse = ", ")), ""), collapse = ",\n  "))

#' The estimators with a likelihood (AIC and BIC): the maximum-likelihood family.
PS_LIKELIHOOD_ESTIMATORS <- c("ML", "MLR", "MLM", "MLMV")

#' Specification search (Amos's): the user marks arrows as optional; every combination of them is fitted, an arrow
#' left out being fixed at zero (every variable stays in the model, as on the diagram), with the same estimator,
#' missing-data treatment and baseline as the model. lavaan refits each from the full model's parameter table.
ps_cb_specsearch <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "The specification search", raw = FALSE)
  if (!(req$estimator %in% PS_LIKELIHOOD_ESTIMATORS)) stop("The specification search ranks models by AIC and BIC: choose a maximum-likelihood estimator (ML, MLR, MLM or MLMV).")
  if (length(unlist(req$model$ordered))) stop("The specification search ranks models by AIC and BIC, which ordinal indicators (WLSMV) do not have.")
  opt <- req$optional
  m <- length(opt)
  if (m < 1) stop("Mark at least one arrow as optional (right-click a path or covariance).")
  if (m > 12) stop(sprintf("%d optional arrows would mean %s models: at most 12 (4096 models).", m, format(2^m, big.mark = ",")))
  arrows <- lapply(opt, function(o) ps_arrow_lavaan(b, o))
  bl <- if (length(b$baseline)) ", baseline.model = fit_baseline" else ""
  # (the model's own call, fitted to a parameter table instead of the syntax)
  refit <- sub("^fit <- sem\\(model,", "sem(p,", b$call)
  if (identical(refit, b$call)) stop("The specification search is not available for this model.")
  body <- c(b$body, b$baseline,
    "# ---- Specification search (as Amos): every combination of the optional arrows ----",
    "# An arrow left out is fixed at zero in the full model's parameter table (every variable stays in the model);",
    "# each model is refitted with the same data, estimator and options.",
    sprintf("optional <- %s", ps_arrows_code(arrows)),
    "pt <- parTable(fit)",
    "rows <- lapply(optional, function(a) which(pt$op == a[2] & ((pt$lhs == a[1] & pt$rhs == a[3]) | (a[2] == \"~~\" & pt$lhs == a[3] & pt$rhs == a[1]))))",
    "if (any(lengths(rows) == 0) || any(pt$free[unlist(rows)] == 0)) stop(\"An optional arrow is not a free parameter of the model.\")",
    "fit_without <- function(drop) {",
    "  r <- unlist(rows[drop])",
    "  if (!length(r)) return(fit)",
    "  p <- pt",
    "  p$free[r] <- 0L; p$ustart[r] <- 0; p$start[r] <- 0; p$est[r] <- 0",
    "  p$free[p$free > 0] <- seq_len(sum(p$free > 0))",
    sprintf("  %s", refit),
    "}",
    "measures <- c(\"npar\", \"chisq\", \"df\", \"pvalue\", \"cfi\", \"rmsea\", \"aic\", \"bic\")",
    "# One row per model; in_model[i, j]: optional arrow j is in model i",
    "in_model <- as.matrix(expand.grid(rep(list(c(TRUE, FALSE)), length(optional))))",
    "warned <- character(nrow(in_model))",
    "search <- t(vapply(seq_len(nrow(in_model)), function(i) {",
    "  f <- withCallingHandlers(tryCatch(fit_without(!in_model[i, ]), error = function(e) { warned[i] <<- conditionMessage(e); NULL }),",
    "    warning = function(w) { if (!nzchar(warned[i])) warned[i] <<- conditionMessage(w); invokeRestart(\"muffleWarning\") })",
    "  if (is.null(f)) return(c(converged = 0, setNames(rep(NA_real_, length(measures)), measures)))",
    sprintf("  c(converged = as.numeric(lavInspect(f, \"converged\")), fitMeasures(f, measures%s))", bl),
    "}, numeric(length(measures) + 1)))")
  if (export) return(paste(ps_script(sprintf("Specification search over %d optional arrows, %d models (lavaan)", m, 2^m), "lavaan", b$inputs, body,
    c("results <- data.frame(in_model, search)", "print(head(results[order(results$bic), ], 20))")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  S <- env$search; K <- env$in_model
  ps_json(list(models = lapply(seq_len(nrow(S)), function(i) list(keep = I(unname(K[i, ])), converged = S[i, "converged"] == 1,
      npar = S[i, "npar"], chisq = S[i, "chisq"], df = S[i, "df"], p = S[i, "pvalue"], cfi = S[i, "cfi"], rmsea = S[i, "rmsea"], aic = S[i, "aic"], bic = S[i, "bic"],
      warning = if (nzchar(env$warned[i])) ps_flat(env$warned[i]) else NULL)),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}

#' The model syntax lines of a built model (between model <- ' and ').
ps_model_lines <- function(b) {
  i <- match("model <- '", b$body)
  j <- if (is.na(i)) NA else i + match("'", b$body[-seq_len(i)])
  if (is.na(j)) stop("The model syntax could not be found.")
  b$body[seq_len(j - i - 1) + i]
}

#' Equivalent models confirmed by their fit: the model on the canvas and each alternative (the paths and covariances
#' of the structural model replaced, the rest as on the canvas) fitted with the same data, estimator and options;
#' equivalent models have the same chi-square and df (and log-likelihood).
ps_cb_equivalent <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Fitting equivalent models", raw = FALSE)
  variants <- req$variants
  if (!length(variants)) stop("No alternative models to fit.")
  if (length(variants) > 50) stop("At most 50 alternative models.")
  refit <- sub("^fit <- sem\\(model,", "sem(m,", b$call)
  if (identical(refit, b$call)) stop("Fitting equivalent models is not available for this model.")
  texts <- c(list(ps_model_lines(b)), lapply(variants, function(v) {
    r2 <- req
    r2$model$paths <- v$paths
    r2$model$covariances <- v$covariances
    b2 <- ps_cb_build(r2)
    if (!identical(b2$call, b$call)) stop("An alternative model needs other lavaan options than the model; it cannot be compared.")
    ps_model_lines(b2)
  }))
  names(texts) <- c("model", sprintf("alternative_%d", seq_along(variants)))
  body <- c(b$body,
    "# ---- The model and its equivalent alternatives (Lee & Hershberger's replacing rules), each fitted alike ----",
    sprintf("models <- c(%s)", paste(sprintf("%s = %s", names(texts), vapply(texts, function(t) encodeString(paste(trimws(t), collapse = "\n"), quote = '"'), "")), collapse = ",\n  ")),
    "# Each model from lavaan's default and from simple starting values, the better (lower) minimum kept: a",
    "# reparameterised model can stop at a local minimum from one of them.",
    sprintf("fit_from <- function(m) %s", refit),
    if (grepl("start = ", refit, fixed = TRUE)) "fit_simple <- function(m) NULL" else sprintf("fit_simple <- function(m) %s", sub("\\)$", ", start = \"simple\")", refit)),
    "fit_model <- function(m) {",
    "  fits <- Filter(function(f) !is.null(f) && lavInspect(f, \"converged\"), list(tryCatch(fit_from(m), error = function(e) NULL), tryCatch(fit_simple(m), error = function(e) NULL)))",
    "  if (!length(fits)) return(NULL)",
    "  fits[[which.min(vapply(fits, function(f) fitMeasures(f, \"fmin\"), 0))]]",
    "}",
    "measures <- c(\"npar\", \"chisq\", \"df\", \"logl\")",
    "equivalent <- t(vapply(models, function(m) {",
    "  f <- fit_model(m)",
    "  if (is.null(f)) return(c(converged = 0, setNames(rep(NA_real_, length(measures)), measures)))",
    "  fm <- fitMeasures(f); fm <- setNames(fm[measures], measures)",
    "  c(converged = as.numeric(lavInspect(f, \"converged\")), fm)",
    "}, numeric(length(measures) + 1)))")
  if (export) return(paste(ps_script(sprintf("The model and %d equivalent alternatives (lavaan)", length(variants)), "lavaan", b$inputs, body,
    "print(equivalent)"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  E <- env$equivalent
  ps_json(list(fits = lapply(seq_len(nrow(E)), function(i) list(converged = isTRUE(E[i, "converged"] == 1), npar = E[i, "npar"], chisq = E[i, "chisq"], df = E[i, "df"], logl = E[i, "logl"])),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}
