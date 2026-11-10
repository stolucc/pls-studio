# CB-SEM diagnostics of the model on the canvas (lavaan, semTools): local fit
# (residual z-tests per pair of observed variables, SRMR tests, further tests of
# exact fit). Each function writes the script it runs (exported as is) on the
# fit ps_cb_build writes; this file shapes the output.

#' lavaan's further tests of exact fit the local-fit card offers (lavaan::lavTest names).
PS_LOCALFIT_TESTS <- c("browne.residual.nt.model", "browne.residual.nt", "browne.residual.adf", "satorra.bentler", "yuan.bentler",
  "mean.var.adjusted", "scaled.shifted", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4", "pols3", "pall")
#' The tests that rescale (or, FMG, take the p-value of) a base statistic: lavTest's scaled_test applies to them.
PS_LOCALFIT_SCALED <- c("satorra.bentler", "yuan.bentler", "mean.var.adjusted", "scaled.shifted", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4", "pols3", "pall")

#' A symmetric lavaan matrix as rows of numbers (NA as null).
ps_rows <- function(m) lapply(seq_len(nrow(m)), function(i) I(unname(as.numeric(m[i, ]))))

#' Local fit (JARS-Quant 2024, Table 7): for every pair of observed variables the residual correlation
#' (observed minus model-implied, both scaled by the observed SDs: Bentler's metric, as the SRMR) with
#' its standard error and z-test (lavaan::lavResiduals), the normalized residuals, the SRMR with its test
#' of exact fit and the unbiased SRMR with its CI and test of close fit (Maydeu-Olivares 2017), and the
#' further tests of exact fit chosen (lavaan::lavTest, each on its own: one that does not apply says why).
ps_cb_localfit <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Local fit", raw = FALSE)
  if (identical(req$estimator, "2SLS")) stop("Local fit needs a model fitted as a whole; MIIV-2SLS estimates it equation by equation.")
  lf <- req$localfit
  tests <- PS_LOCALFIT_TESTS[PS_LOCALFIT_TESTS %in% unlist(lf$tests)]
  base <- if (identical(lf$base, "RLS")) "RLS" else "standard"
  body <- c(b$body, "",
    "# Local fit: residual correlations (observed minus model-implied, both scaled by the observed SDs: Bentler's",
    "# metric, as the SRMR) with their standard errors and z-tests; the SRMR's tests (Maydeu-Olivares 2017).",
    "res <- lavResiduals(fit, type = \"cor.bentler\", se = TRUE, drop_list_single_group = FALSE)",
    "# Normalized residuals: each raw residual over its standard error under normality, ignoring that the model was estimated.",
    "res_norm <- tryCatch(lavResiduals(fit, type = \"normalized\", zstat = FALSE, summary = FALSE, drop_list_single_group = FALSE), error = function(e) NULL)",
    if (length(tests)) c(
      "# Tests of exact fit (lavaan::lavTest), each on its own: one that does not apply to this model says why.",
      "lav_test <- function(test, scaled_test = \"standard\") {",
      "  why <- character(0)",
      "  out <- tryCatch(withCallingHandlers(lavTest(fit, test = test, scaled_test = scaled_test, drop_list_single = FALSE),",
      "    warning = function(w) { why <<- c(why, conditionMessage(w)); invokeRestart(\"muffleWarning\") }),",
      "    error = function(e) { why <<- c(why, conditionMessage(e)); NULL })",
      "  t <- out[[test]]",
      "  if (is.null(t)) list(test = test, error = paste(why, collapse = \" \")) else c(t, list(warning = paste(why, collapse = \" \")))",
      "}",
      sprintf("tests <- list(standard = lav_test(\"standard\"),\n  %s)", paste(sprintf("%s = lav_test(\"%s\"%s)", tests, tests,
        ifelse(tests %in% PS_LOCALFIT_SCALED & base == "RLS", ", scaled_test = \"RLS\"", "")), collapse = ",\n  "))))
  report <- c("print(res)", if (length(tests)) "str(tests, max.level = 2)")
  if (export) return(paste(ps_script("Local fit: residual z-tests and tests of exact fit (lavaan)", "lavaan", b$inputs, body, report), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_cb_back(b)
  nm <- function(x) ps_back(x, back)
  res <- env$res; rn <- env$res_norm
  blocks <- lapply(seq_along(res), function(g) {
    r <- res[[g]]; v <- rownames(r$cov)
    s <- r$summary
    col <- if ("cov" %in% names(s)) "cov" else names(s)[1]
    sm <- function(k) if (k %in% rownames(s)) unname(s[k, col]) else NULL
    mz <- if (!is.null(r$mean.z) && any(abs(r$mean) > 1e-10)) list(names = I(nm(names(r$mean))), residual = I(unname(as.numeric(r$mean))), se = I(unname(as.numeric(r$mean.se))), z = I(unname(as.numeric(r$mean.z)))) else NULL
    list(label = names(res)[g] %||% "", names = I(nm(v)), residual = ps_rows(r$cov), se = ps_rows(r$cov.se), z = ps_rows(r$cov.z),
      normalized = if (!is.null(rn[[g]]$cov)) ps_rows(rn[[g]]$cov[v, v, drop = FALSE]), means = mz,
      summary = list(srmr = sm("srmr"), se = sm("srmr.se"), z = sm("srmr.exactfit.z"), p = sm("srmr.exactfit.pvalue"),
        usrmr = sm("usrmr"), usrmrSe = sm("usrmr.se"), low = sm("usrmr.ci.lower"), high = sm("usrmr.ci.upper"),
        h0 = sm("usrmr.closefit.h0.value"), closeZ = sm("usrmr.closefit.z"), closeP = sm("usrmr.closefit.pvalue")))
  })
  num1 <- function(x) if (is.numeric(x) && length(x) == 1 && is.finite(x)) x else NULL
  str1 <- function(x) if (is.character(x) && length(x) == 1 && nzchar(x)) ps_flat(x) else NULL
  tl <- lapply(names(env$tests), function(k) {
    t <- env$tests[[k]]
    list(test = k, label = str1(t$label), stat = num1(t$stat), df = num1(t$df), p = num1(t$pvalue), scaling = num1(t$scaling.factor), shift = num1(t$shift.parameter),
      base = str1(t$scaled.test %||% t$chisq.type), error = str1(t$error), warning = str1(t$warning))
  })
  ps_json(list(blocks = blocks, tests = tl, base = base, estimator = req$estimator, n = sum(lavInspect(env$fit, "nobs")), warnings = env$.warnings,
    engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}
