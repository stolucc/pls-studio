# Analytic power analysis for SEM with semPower (Moshagen & Bader): a priori
# (the N a test needs), post hoc (the power at an N) and compromise (the
# critical chi-square balancing alpha and beta) for misfit given as an effect
# (RMSEA, F0, Mc, GFI, AGFI) on df degrees of freedom; the power to detect one
# parameter of the CB-SEM model on the canvas (the model as fitted is the
# population; H0 fixes the parameter; semPower on the two implied matrices, as
# semPower.powerLav computes it); and the RMSEA equivalence test (Yuan, Chan,
# Marcoulides & Bentler 2016: the T-size RMSEA and its adjusted cutoffs), which
# neither semPower nor semTools provides: computed here from the formulas.

.ps_power_measures <- c("RMSEA", "F0", "Mc", "GFI", "AGFI")

#' One number from the request within [lo, hi] (an integer when int), written into code with all its digits.
ps_power_num <- function(x, what, lo, hi, int = FALSE) {
  v <- ps_number(x, what)
  if (v < lo || v > hi || (int && v != round(v))) stop(sprintf("Invalid %s in the request.", what))
  format(v, digits = 15)
}

#' The power of the chi-square test at each N of a grid, from F0 (ncp = (N - 1) F0, as semPower).
.ps_power_curve <- c(
  "# Power at each N of a grid (the noncentral chi-square, ncp = (N - 1) * F0, as semPower computes it)",
  "crit <- qchisq(1 - alpha, df_test)",
  "curve_n <- unique(round(seq(max(df_test + 2, 10), max(3 * n_at, 50), length.out = 60)))",
  "curve_power <- pchisq(crit, df_test, ncp = (curve_n - 1) * f0, lower.tail = FALSE)")

ps_power <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  o <- req$power
  analysis <- o[["analysis", exact = TRUE]]
  if (!(is.character(analysis) && length(analysis) == 1 && analysis %in% c("apriori", "posthoc", "compromise", "parameter", "equivalence"))) stop("Invalid power analysis in the request.")
  alpha <- ps_power_num(o$alpha %||% 0.05, "alpha", 1e-6, 0.5)
  inputs <- list()
  packages <- "semPower"
  if (analysis %in% c("apriori", "posthoc", "compromise")) {
    measure <- o[["measure", exact = TRUE]]
    if (!(is.character(measure) && length(measure) == 1 && measure %in% .ps_power_measures)) stop("Invalid effect measure in the request.")
    effect <- if (measure == "F0") ps_power_num(o$effect, "effect", 1e-8, 100) else ps_power_num(o$effect, "effect", 1e-8, 0.999999)
    df <- ps_power_num(o$df, "degrees of freedom", 1, 1e6, TRUE)
    args <- c(sprintf("effect = %s", effect), sprintf("effect.measure = \"%s\"", measure),
      if (analysis != "compromise") sprintf("alpha = %s", alpha),
      if (analysis == "apriori") sprintf("power = %s", ps_power_num(o$power, "power", 0.01, 0.9999)),
      if (analysis == "compromise") sprintf("abratio = %s", ps_power_num(o$abratio %||% 1, "alpha/beta ratio", 1e-4, 1e4)),
      if (analysis != "apriori") sprintf("N = %s", ps_power_num(o$n, "N", 2, 1e8, TRUE)),
      sprintf("df = %s", df),
      if (measure %in% c("GFI", "AGFI")) sprintf("p = %s", ps_power_num(o$p, "number of observed variables", 1, 1e4, TRUE)))
    fn <- c(apriori = "semPower.aPriori", posthoc = "semPower.postHoc", compromise = "semPower.compromise")[[analysis]]
    body <- c("suppressPackageStartupMessages(library(semPower))",
      sprintf("# %s: misfit of %s = %s on %s degrees of freedom", c(apriori = "A priori power analysis (the N needed)", posthoc = "Post hoc power analysis (the power at N)", compromise = "Compromise power analysis (the critical chi-square with alpha / beta as chosen)")[[analysis]], measure, effect, df),
      sprintf("pw <- %s(%s)", fn, paste(args, collapse = ", ")),
      if (analysis != "compromise") c(sprintf("alpha <- %s; df_test <- %s; f0 <- pw$fmin", alpha, df),
        sprintf("n_at <- %s", if (analysis == "apriori") "pw$requiredN" else "pw$N"), .ps_power_curve))
    report <- "summary(pw)"
  } else if (analysis == "parameter") {
    b <- ps_cb_build(req)
    ps_cb_plain(b, "Power for a parameter", raw = FALSE)
    if (!grepl("^fit <- sem\\(.*\\)$", b$call)) stop("Power for a parameter is not available for this model.")
    if (!is.null(b$group_var) || isTRUE(b$matrix_input) && is.list(b$inputs$S) && !is.matrix(b$inputs$S)) stop("Power for a parameter is computed for one group: remove the grouping.")
    if (length(unlist(req$model$ordered))) stop("Power for a parameter is for continuous indicators (ML); this model has ordinal ones.")
    if (!identical(req$estimator, "ML")) stop("Power for a parameter uses ML (the likelihood-ratio test semPower computes): set the estimator to ML (Model settings).")
    if (length(b$composites)) stop("Power for a parameter is for common-factor models; the model has composites (<~).")
    p <- o$param
    op <- p[["op", exact = TRUE]]
    if (!(is.character(op) && length(op) == 1 && op %in% c("=~", "~", "~~"))) stop("Invalid parameter in the request.")
    map <- c(b$lname, b$n$iv)
    nm <- function(x) { if (!(is.character(x) && length(x) == 1 && x %in% names(map))) stop("The parameter is not in the model."); unname(map[[x]]) }
    lhs <- nm(p$lhs); rhs <- nm(p$rhs)
    value <- ps_power_num(p$value %||% 0, "value under H0", -1e6, 1e6)
    type <- o[["type", exact = TRUE]] %||% "apriori"
    if (!type %in% c("apriori", "posthoc")) stop("Invalid power analysis in the request.")
    at <- if (type == "apriori") sprintf("power = %s", ps_power_num(o$power, "power", 0.01, 0.9999)) else sprintf("N = %s", ps_power_num(o$n, "N", 2, 1e8, TRUE))
    q <- function(x) encodeString(x, quote = '"')
    body <- c(b$body,
      "suppressPackageStartupMessages(library(semPower))",
      "# The population: the model as fitted (its implied covariance matrix, and means with a mean structure)",
      "Sigma <- lavInspect(fit, \"implied\")$cov",
      "mu <- if (lavInspect(fit, \"meanstructure\")) lavInspect(fit, \"implied\")$mean else NULL",
      sprintf("# H0: the same model (lavaan's parameter table of the fit, so every option applies) with %s %s %s fixed at %s", ps_comment(lhs), op, ps_comment(rhs), value),
      "pt <- parTable(fit)",
      sprintf("k <- which(pt$lhs == %s & pt$op == %s & pt$rhs == %s & pt$free > 0)", q(lhs), q(op), q(rhs)),
      "if (length(k) != 1) stop(\"The parameter is not a free parameter of the model.\")",
      "if (nzchar(pt$label[k]) && sum(pt$label == pt$label[k]) > 1) stop(\"The parameter shares its label with another (held equal): test a parameter of its own.\")",
      "estimate <- pt$est[k]",
      "pt0 <- pt; pt0$est <- NULL; pt0$se <- NULL; pt0$start <- NULL",
      sprintf("pt0$free[k] <- 0L; pt0$ustart[k] <- %s", value),
      "pt0$free[pt0$free > 0] <- seq_len(sum(pt0$free > 0))",
      "fit0 <- lavaan(pt0, sample.cov = Sigma, sample.mean = mu, sample.nobs = lavInspect(fit, \"ntotal\"), sample.cov.rescale = FALSE)",
      "SigmaHat <- lavInspect(fit0, \"implied\")$cov",
      "muHat <- if (is.null(mu)) NULL else lavInspect(fit0, \"implied\")$mean",
      "# The likelihood-ratio test of H0 against the model (df = 1): semPower on the two implied matrices (as semPower.powerLav)",
      sprintf("pw <- %s(SigmaHat = SigmaHat, Sigma = Sigma, muHat = muHat, mu = mu, df = 1, alpha = %s, %s)", if (type == "apriori") "semPower.aPriori" else "semPower.postHoc", alpha, at),
      sprintf("alpha <- %s; df_test <- 1; f0 <- pw$fmin", alpha),
      sprintf("n_at <- %s", if (type == "apriori") "pw$requiredN" else "pw$N"), .ps_power_curve,
      "n_sample <- lavInspect(fit, \"ntotal\")")
    inputs <- b$inputs
    packages <- c("lavaan", "semPower")
    report <- c("estimate", "summary(pw)")
  } else {
    src <- o[["source", exact = TRUE]] %||% "manual"
    if (!src %in% c("model", "manual")) stop("Invalid source in the request.")
    if (src == "model") {
      b <- ps_cb_build(req)
      ps_cb_plain(b, "The RMSEA equivalence test", raw = FALSE)
      if (!grepl("^fit <- sem\\(.*\\)$", b$call)) stop("The RMSEA equivalence test is not available for this model.")
      if (!is.null(b$group_var)) stop("The RMSEA equivalence test is for one group: remove the grouping.")
      body <- c(b$body,
        "# The model's ML chi-square, degrees of freedom and N",
        "Tml <- unname(fitMeasures(fit, \"chisq\")); df <- unname(fitMeasures(fit, \"df\")); n <- lavInspect(fit, \"ntotal\")")
      inputs <- b$inputs
      packages <- "lavaan"
    } else {
      body <- c("# The model's ML chi-square, degrees of freedom and N, as entered",
        sprintf("Tml <- %s; df <- %s; n <- %s", ps_power_num(o$chisq, "chi-square", 0, 1e9), ps_power_num(o$df, "degrees of freedom", 1, 1e6, TRUE), ps_power_num(o$n, "N", 2, 1e8, TRUE)))
      packages <- character(0)
    }
    body <- c(body,
      "if (df < 1) stop(\"The model has no degrees of freedom: the equivalence test needs df > 0.\")",
      "# Equivalence testing (Yuan, Chan, Marcoulides & Bentler 2016): H0, the misfit is at least e0, is rejected when the",
      "# T-size RMSEA is below e0. The T-size RMSEA: the noncentrality at which T is the alpha-quantile of the noncentral",
      "# chi-square, pchisq(T, df, ncp) = alpha (the upper limit of the 1 - 2 alpha interval of RMSEA), alpha = .05.",
      "alpha <- 0.05",
      "ncp_t <- 0",
      "if (pchisq(Tml, df) > alpha) {",
      "  hi <- max(10, Tml); while (pchisq(Tml, df, ncp = hi) > alpha) hi <- 2 * hi",
      "  ncp_t <- uniroot(function(l) pchisq(Tml, df, ncp = l) - alpha, c(0, hi), tol = 1e-12)$root",
      "}",
      "rmsea_t <- sqrt(ncp_t / (df * n))",
      "rmsea <- sqrt(max(0, (Tml - df) / (df * n)))",
      "# Yuan et al.'s adjusted cutoffs for this df and n (their eqs.; as McNeish & Wolf's dynamic::equivTest): the bounds",
      "# of excellent, close, fair, mediocre and poor fit, the counterparts of the conventional .01, .05, .08 and .10",
      "cut_e01 <- exp(1.34863 - 0.51999 * log(df) + 0.01925 * log(df)^2 - 0.59811 * log(n) + 0.00902 * sqrt(n) + 0.01796 * log(df) * log(n))",
      "cut_e05 <- exp(2.06034 - 0.62974 * log(df) + 0.02512 * log(df)^2 - 0.98388 * log(n) + 0.05442 * log(n)^2 - 5.188e-05 * n + 0.0526 * log(df) * log(n))",
      "cut_e08 <- exp(2.84129 - 0.54809 * log(df) + 0.02296 * log(df)^2 - 0.76005 * log(n) + 0.10229 * log(n)^2 - 1.11167 * n^0.2 + 0.04845 * log(df) * log(n))",
      "cut_e10 <- exp(2.36352 - 0.4944 * log(df) + 0.02131 * log(df)^2 - 0.64445 * log(n) + 0.09043 * log(n)^2 - 1.01634 * n^0.2 + 0.04422 * log(df) * log(n))",
      "cutoffs <- c(excellent = cut_e01, close = cut_e05, fair = cut_e08, mediocre = cut_e10)",
      "verdict <- c(\"excellent\", \"close\", \"fair\", \"mediocre\", \"poor\")[findInterval(rmsea_t, cutoffs) + 1]")
    report <- c("c(T = Tml, df = df, n = n, RMSEA = rmsea, RMSEA_t = rmsea_t)", "cutoffs", "verdict")
  }
  if (export) return(ps_script(sprintf("Power analysis (%s)", c(apriori = "a priori", posthoc = "post hoc", compromise = "compromise", parameter = "a parameter", equivalence = "RMSEA equivalence test")[[analysis]]), packages, inputs, body, report))
  env <- ps_run(body, inputs)
  val <- function(x) if (is.null(x) || !length(x) || !is.finite(x[1])) NULL else unname(as.numeric(x[1]))
  res <- list(analysis = analysis)
  if (analysis == "equivalence") {
    res <- c(res, list(chisq = env$Tml, df = env$df, n = env$n, rmsea = env$rmsea, rmseaT = env$rmsea_t, ncpT = env$ncp_t, cutoffs = I(unname(env$cutoffs)), verdict = env$verdict))
  } else {
    pw <- env$pw
    res <- c(res, list(
      type = if (analysis == "parameter") type else analysis,
      alpha = val(if (analysis == "compromise") pw$impliedAlpha else pw$alpha), beta = val(pw$impliedBeta %||% pw$beta),
      power = val(pw$impliedPower %||% pw$power), n = val(pw$requiredN %||% pw$N), df = val(pw$df), ncp = val(pw$impliedNCP %||% pw$ncp),
      chiCrit = val(pw$chiCrit), fmin = val(pw$fmin), rmsea = val(pw$rmsea), mc = val(pw$mc), gfi = val(pw$gfi), agfi = val(pw$agfi),
      abratio = val(pw$impliedAbratio)))
    if (!is.null(env$curve_n)) res$curve <- list(n = I(env$curve_n), power = I(unname(env$curve_power)))
    if (analysis == "parameter") res <- c(res, list(estimate = env$estimate, sampleN = env$n_sample, param = list(lhs = p$lhs, op = op, rhs = p$rhs, value = as.numeric(value))))
  }
  res$warnings <- env$.warnings
  res$engine <- ps_engine("semPower")
  ps_json(res)
}
