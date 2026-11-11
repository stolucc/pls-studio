# CB-SEM diagnostics of the model on the canvas (lavaan, semTools): local fit
# (residual z-tests per pair of observed variables, SRMR tests, further tests of
# exact fit). Each function writes the script it runs (exported as is) on the
# fit ps_cb_build writes; this file shapes the output.

#' lavaan's further tests of exact fit the local-fit card offers (lavaan::lavTest names).
PS_LOCALFIT_TESTS <- c(
  "browne.residual.nt.model",
  "browne.residual.nt",
  "browne.residual.adf",
  "satorra.bentler",
  "yuan.bentler",
  "mean.var.adjusted",
  "scaled.shifted",
  "mean.var.adjusted.corrected",
  "scaled.shifted.corrected",
  "peba4",
  "pols3",
  "pall"
)
#' The tests that rescale (or, FMG, take the p-value of) a base statistic: lavTest's scaled_test applies to them.
PS_LOCALFIT_SCALED <- c(
  "satorra.bentler",
  "yuan.bentler",
  "mean.var.adjusted",
  "scaled.shifted",
  "mean.var.adjusted.corrected",
  "scaled.shifted.corrected",
  "peba4",
  "pols3",
  "pall"
)

#' Script lines: functions that refit the model by update() (semTools, nonnest2) evaluate its call elsewhere, where
#' `data` (or `S`, `N`) would not be this script's objects: the call is given the objects themselves.
ps_call_objects <- function(f = "fit") {
  c(
    "# (the model is refitted by update() outside this script: its call takes the data objects themselves)",
    sprintf(
      "for (a in names(%s@call)[-1]) if (is.name(%s@call[[a]]) && exists(as.character(%s@call[[a]]), inherits = FALSE)) %s@call[[a]] <- get(as.character(%s@call[[a]]))",
      f,
      f,
      f,
      f,
      f
    )
  )
}

#' One finite number, or NULL; one non-empty text (one line), or NULL.
ps_num1 <- function(x) if (is.numeric(x) && length(x) == 1 && is.finite(x)) unname(x) else NULL
ps_str1 <- function(x) if (is.character(x) && length(x) == 1 && nzchar(x)) ps_flat(x) else NULL

#' Local fit (JARS-Quant 2024, Table 7): for every pair of observed variables the residual correlation
#' (observed minus model-implied, both scaled by the observed SDs: Bentler's metric, as the SRMR) with
#' its standard error and z-test (lavaan::lavResiduals), the normalized residuals, the SRMR with its test
#' of exact fit and the unbiased SRMR with its CI and test of close fit (Maydeu-Olivares 2017), and the
#' further tests of exact fit chosen (lavaan::lavTest, each on its own: one that does not apply says why).
ps_cb_localfit <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Local fit", raw = FALSE)
  if (identical(req$estimator, "2SLS")) {
    stop("Local fit needs a model fitted as a whole; MIIV-2SLS estimates it equation by equation.")
  }
  lf <- req$localfit
  tests <- PS_LOCALFIT_TESTS[PS_LOCALFIT_TESTS %in% unlist(lf$tests)]
  base <- if (identical(lf$base, "RLS")) "RLS" else "standard"
  body <- c(
    b$body,
    "",
    "# Local fit: residual correlations (observed minus model-implied, both scaled by the observed SDs: Bentler's",
    "# metric, as the SRMR) with their standard errors and z-tests; the SRMR's tests (Maydeu-Olivares 2017).",
    "res <- lavResiduals(fit, type = \"cor.bentler\", se = TRUE, drop_list_single_group = FALSE)",
    "# Normalized residuals: each raw residual over its standard error under normality, ignoring that the model was estimated.",
    "res_norm <- tryCatch(lavResiduals(fit, type = \"normalized\", zstat = FALSE, summary = FALSE, drop_list_single_group = FALSE), error = function(e) NULL)",
    if (length(tests)) {
      c(
        "# Tests of exact fit (lavaan::lavTest), each on its own: one that does not apply to this model says why.",
        "lav_test <- function(test, scaled_test = \"standard\") {",
        "  why <- character(0)",
        "  out <- tryCatch(withCallingHandlers(lavTest(fit, test = test, scaled_test = scaled_test, drop_list_single = FALSE),",
        "    warning = function(w) { why <<- c(why, conditionMessage(w)); invokeRestart(\"muffleWarning\") }),",
        "    error = function(e) { why <<- c(why, conditionMessage(e)); NULL })",
        "  t <- out[[test]]",
        "  if (is.null(t)) list(test = test, error = paste(why, collapse = \" \")) else c(t, list(warning = paste(why, collapse = \" \")))",
        "}",
        sprintf("tests <- list(standard = lav_test(\"standard\"),\n  %s)", paste(sprintf(
          "%s = lav_test(\"%s\"%s)", tests, tests,
          ifelse(tests %in% PS_LOCALFIT_SCALED & base == "RLS", ", scaled_test = \"RLS\"", "")
        ), collapse = ",\n  "))
      )
    }
  )
  report <- c("print(res)", if (length(tests)) "str(tests, max.level = 2)")
  if (export) {
    return(ps_script("Local fit: residual z-tests and tests of exact fit (lavaan)", "lavaan", b$inputs, body, report))
  }
  env <- ps_run(body, b$inputs)
  back <- ps_cb_back(b)
  nm <- function(x) ps_back(x, back)
  res <- env$res
  rn <- env$res_norm
  blocks <- lapply(seq_along(res), function(g) {
    r <- res[[g]]
    v <- rownames(r$cov)
    s <- r$summary
    col <- if ("cov" %in% names(s)) "cov" else names(s)[1]
    sm <- function(k) if (k %in% rownames(s)) unname(s[k, col]) else NULL
    mz <- if (!is.null(r$mean.z) && any(abs(r$mean) > 1e-10)) {
      list(
        names = I(nm(names(r$mean))),
        residual = I(unname(as.numeric(r$mean))),
        se = I(unname(as.numeric(r$mean.se))),
        z = I(unname(as.numeric(r$mean.z)))
      )
    } else {
      NULL
    }
    list(
      label = names(res)[g] %||% "",
      names = I(nm(v)),
      residual = ps_rows(r$cov),
      se = ps_rows(r$cov.se),
      z = ps_rows(r$cov.z),
      normalized = if (!is.null(rn[[g]]$cov)) ps_rows(rn[[g]]$cov[v, v, drop = FALSE]),
      means = mz,
      summary = list(
        srmr = sm("srmr"), se = sm("srmr.se"), z = sm("srmr.exactfit.z"), p = sm("srmr.exactfit.pvalue"),
        usrmr = sm("usrmr"), usrmrSe = sm("usrmr.se"), low = sm("usrmr.ci.lower"), high = sm("usrmr.ci.upper"),
        h0 = sm("usrmr.closefit.h0.value"), closeZ = sm("usrmr.closefit.z"), closeP = sm("usrmr.closefit.pvalue")
      )
    )
  })
  tl <- lapply(names(env$tests), function(k) {
    t <- env$tests[[k]]
    list(
      test = k,
      label = ps_str1(t$label),
      stat = ps_num1(t$stat),
      df = ps_num1(t$df),
      p = ps_num1(t$pvalue),
      scaling = ps_num1(t$scaling.factor),
      shift = ps_num1(t$shift.parameter),
      base = ps_str1(t$scaled.test %||% t$chisq.type),
      error = ps_str1(t$error),
      warning = ps_str1(t$warning)
    )
  })
  ps_json(list(
    blocks = blocks,
    tests = tl,
    base = base,
    estimator = req$estimator,
    n = sum(lavInspect(env$fit, "nobs")),
    warnings = env$.warnings,
    engine = ps_engine("lavaan")
  ))
}

#' Discriminant validity per Ronkko & Cho (2022), semTools::discriminantValidity: each factor
#' correlation with its confidence interval (CI-CFA; factors scaled by unit variances, the model
#' refitted so when it used markers), and the chi-square difference tests against the model with
#' that correlation fixed at .8, .9 and 1 (chi2(sys)); optionally against the model with the two
#' factors merged into one (chi2(merge)). The app classifies the pairs (Table 12).
ps_cb_discriminant <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Discriminant validity", raw = FALSE)
  if (identical(req$estimator, "2SLS")) {
    stop("Discriminant validity needs a model fitted as a whole; MIIV-2SLS estimates it equation by equation.")
  }
  if (!is.null(b$group_var) || !is.null(req$data$moments$groups)) {
    stop("Discriminant validity is computed for one group: remove the grouping.")
  }
  if (length(b$composites)) {
    stop("Discriminant validity (CI-CFA) is for common factors; the model has composites.")
  }
  dv <- req$discriminant
  level <- ps_number(dv$level %||% 0.95, "confidence level")
  if (!is.finite(level) || level < 0.5 || level >= 1) {
    stop("The confidence level must be between 0.5 and 1.")
  }
  merge <- isTRUE(dv$merge)
  body <- c(
    b$body, "",
    "# Discriminant validity (Ronkko & Cho 2022, Table 12): factor correlations with confidence intervals (CI-CFA; the",
    "# model is refitted with unit factor variances when it uses markers), and chi-square difference tests against the",
    "# model with each correlation fixed at the classification's cutoffs .8, .9 and 1, one at a time (chi2(sys)).",
    "suppressPackageStartupMessages(library(semTools))",
    ps_call_objects(),
    sprintf(
      "dv <- lapply(c(cut_0.8 = 0.8, cut_0.9 = 0.9, cut_1 = 1), function(k) discriminantValidity(fit, cutoff = k, level = %s))",
      format(level)
    ),
    if (merge) {
      c(
        "# ... and against the model with the two factors merged into one (chi2(merge)).",
        sprintf("dv_merge <- discriminantValidity(fit, merge = TRUE, level = %s)", format(level))
      )
    }
  )
  if (export) {
    return(ps_script("Discriminant validity, CI-CFA(sys) and chi2(sys) (semTools)", c("lavaan", "semTools"), b$inputs, body, c("print(dv)", if (merge) "print(dv_merge)")))
  }
  env <- ps_run(body, b$inputs)
  back <- ps_cb_back(ps_esem_align(b, env$fit))
  nm <- function(x) ps_back(x, back)
  col <- function(d, k) {
    v <- d[[k]]
    if (is.null(v)) rep(NA_real_, nrow(d)) else as.numeric(v)
  }
  pr <- function(d) {
    d <- as.data.frame(d)
    list(chisq = I(col(d, "Chisq diff")), df = I(col(d, "Df diff")), p = I(col(d, "Pr(>Chisq)")))
  }
  d <- as.data.frame(env$dv[[1]])
  ps_json(list(
    level = level,
    lhs = I(nm(d$lhs)),
    rhs = I(nm(d$rhs)),
    est = I(as.numeric(d$est)),
    low = I(as.numeric(d$ci.lower)),
    high = I(as.numeric(d$ci.upper)),
    cut80 = pr(env$dv[[1]]),
    cut90 = pr(env$dv[[2]]),
    cut100 = pr(env$dv[[3]]),
    merge = if (merge) pr(env$dv_merge) else NULL,
    markers = !isTRUE(lavInspect(env$fit, "options")$std.lv),
    warnings = env$.warnings,
    engine = ps_engine("semTools")
  ))
}

#' Comparison of the model on the canvas (model 1) with a saved alternative (model 2), fitted to the same
#' data: their fit, lavaan's nesting and equivalence test (lavTestNET; Bentler & Satorra 2010), the
#' chi-square difference test (lavTestLRT, its own nesting check on), Vuong's tests (nonnest2::vuongtest;
#' Merkle, You & Preacher 2016) and confidence intervals of the AIC and BIC differences (nonnest2::icci).
#' Each test on its own: one that does not apply says why.
ps_cb_compare_models <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (!is.list(req$alternative) || !length(req$alternative$constructs)) {
    stop("Save an alternative model first.")
  }
  if (!identical(req$estimator, "ML") && !identical(req$estimator, "MLR") && !identical(req$estimator, "MLM")) {
    stop("Comparing models needs a maximum-likelihood estimator (ML, MLR or MLM): Vuong's tests use each case's log-likelihood.")
  }
  for (c in req$alternative$constructs) {
    if (!is.null(c$mode) && !c$mode %in% c("A", "B", "unit")) {
      stop("Invalid construct mode in the request.")
    }
    if (!is.null(c$type) && !c$type %in% c("factor", "composite")) {
      stop("Invalid construct type in the request.")
    }
  }
  b1 <- ps_cb_build(req)
  req2 <- req
  req2$model <- req$alternative
  b2 <- ps_cb_build(req2)
  for (b in list(b1, b2)) {
    ps_cb_plain(b, "Comparing models")
    if (length(b$call) != 1 || !grepl("^fit <- sem\\(model, data = data", b$call)) {
      stop("Comparing models is not available for this model.")
    }
  }
  # (one data frame: model 2's own columns, such as its grouping column, travel too)
  for (k in setdiff(names(b2$inputs$data), names(b1$inputs$data))) b1$inputs$data[[k]] <- b2$inputs$data[[k]]
  if (!setequal(b1$n$all_inds, b2$n$all_inds)) {
    stop("The two models must use the same observed variables (Vuong's tests compare the likelihoods of the same data).")
  }
  if (!identical(unname(b1$n$iv[sort(b1$n$all_inds)]), unname(b2$n$iv[sort(b2$n$all_inds)]))) {
    stop("The two models name their indicators differently: rename a construct that has an indicator's name.")
  }
  nested <- req$compare$nested %||% "auto"
  if (!nested %in% c("auto", "nested", "nonnested")) stop("Invalid nesting choice in the request.")
  at <- match("model <- '", b2$body)
  seg <- b2$body[at:match(b2$call, b2$body)]
  seg[1] <- "model_2 <- '"
  seg[length(seg)] <- sub("^fit <- sem\\(model,", "fit_2 <- sem(model_2,", seg[length(seg)])
  body <- c(
    b1$body,
    "fit_1 <- fit",
    "",
    "# Model 2: the alternative, fitted to the same data",
    seg,
    "",
    ps_call_objects("fit_1"),
    ps_call_objects("fit_2"),
    "# Each test on its own: one that does not apply says why.",
    "try_test <- function(expr) tryCatch(withCallingHandlers(expr, warning = function(w) { note <<- c(note, conditionMessage(w)); invokeRestart(\"muffleWarning\") }), error = function(e) conditionMessage(e))",
    "note <- character(0)",
    "# Nesting and equivalence (Bentler & Satorra 2010): is one model nested in the other, in the covariance sense?",
    "net <- try_test(lavTestNET(fit_1, fit_2, model_names = c(\"model_1\", \"model_2\")))",
    "note_net <- note; note <- character(0)",
    "# Chi-square difference test (lavaan checks the nesting itself)",
    "lrt <- try_test(lavTestLRT(fit_1, fit_2, model_names = c(\"model_1\", \"model_2\")))",
    "note_lrt <- note; note <- character(0)",
    "suppressPackageStartupMessages(library(nonnest2))",
    switch(nested,
      auto = c(
        "# Vuong's tests (Merkle, You & Preacher 2016): as nested models when NET finds one nested in the other with fewer df",
        "nested <- is.list(net) && isTRUE(net$df[1] != net$df[2]) && isTRUE(net$nested[1, 2] || net$nested[2, 1])"
      ),
      nested = c("# Vuong's tests (Merkle, You & Preacher 2016), the models taken as nested", "nested <- TRUE"),
      nonnested = c("# Vuong's tests (Merkle, You & Preacher 2016), the models taken as non-nested", "nested <- FALSE")
    ),
    "vt <- try_test(vuongtest(fit_1, fit_2, nested = nested))",
    "note_vt <- note; note <- character(0)",
    "# Confidence intervals of the AIC and BIC differences (model 1 minus model 2); for non-nested, distinguishable models",
    "ic <- try_test(icci(fit_1, fit_2))",
    "note_ic <- note"
  )
  report <- c("print(net)", "print(lrt)", "print(vt)", "print(ic)")
  if (export) {
    return(ps_script("Comparing two models: NET, chi-square difference, Vuong's tests (lavaan, nonnest2)", c("lavaan", "nonnest2"), b1$inputs, body, report))
  }
  env <- ps_run(body, b1$inputs)
  fm <- function(f) {
    m <- fitMeasures(f, c("npar", "chisq", "df", "pvalue", "cfi", "rmsea", "srmr", "logl", "aic", "bic"))
    as.list(setNames(as.numeric(m), names(m)))
  }
  why <- function(x, notes) list(error = if (is.character(x)) ps_flat(paste(x, collapse = " ")) else NULL, notes = I(ps_flat(unique(notes))))
  net <- env$net
  netOut <- if (is.list(net)) {
    list(
      nested12 = net$nested[1, 2],
      nested21 = net$nested[2, 1],
      fx12 = ps_num1(net$fx[1, 2]),
      fx21 = ps_num1(net$fx[2, 1]),
      reason12 = ps_flat(net$reason[1, 2]),
      reason21 = ps_flat(net$reason[2, 1]),
      crit = ps_num1(net$crit)
    )
  } else {
    NULL
  }
  lrt <- env$lrt
  lrtOut <- if (is.data.frame(lrt)) {
    list(
      chisq = ps_num1(lrt[["Chisq diff"]][2]),
      df = ps_num1(lrt[["Df diff"]][2]),
      p = ps_num1(lrt[["Pr(>Chisq)"]][2]),
      method = ps_flat(attr(lrt, "heading")[1] %||% "")
    )
  } else {
    NULL
  }
  vt <- env$vt
  vtOut <- if (is.list(vt)) {
    list(
      nested = isTRUE(vt$nested),
      omega = ps_num1(vt$omega),
      pOmega = ps_num1(vt$p_omega),
      stat = ps_num1(vt$LRTstat),
      pA = ps_num1(vt$p_LRT$A),
      pB = ps_num1(vt$p_LRT$B)
    )
  } else {
    NULL
  }
  ic <- env$ic
  icOut <- if (is.list(ic)) {
    list(
      aic1 = ps_num1(ic$AIC$AIC1),
      aic2 = ps_num1(ic$AIC$AIC2),
      aicLow = ps_num1(ic$AICci[1]),
      aicHigh = ps_num1(ic$AICci[2]),
      bic1 = ps_num1(ic$BIC$BIC1),
      bic2 = ps_num1(ic$BIC$BIC2),
      bicLow = ps_num1(ic$BICci[1]),
      bicHigh = ps_num1(ic$BICci[2]),
      level = ps_num1(ic$confLevel)
    )
  } else {
    NULL
  }
  ps_json(list(
    fit1 = fm(env$fit_1),
    fit2 = fm(env$fit_2),
    n = sum(lavInspect(env$fit_1, "nobs")),
    net = c(netOut, why(net, env$note_net)),
    lrt = c(lrtOut, why(lrt, env$note_lrt)),
    vuong = c(vtOut, why(vt, env$note_vt)),
    icci = c(icOut, why(ic, env$note_ic)),
    nestedChoice = nested,
    warnings = env$.warnings,
    engine = ps_engine("nonnest2", lavaan = "lavaan")
  ))
}

#' EPC-based judgement of misspecification (semTools::epcEquivFit): for every fixed parameter its MI, EPC,
#' the power of the MI test to detect a misspecification of the smallest size of interest, and the
#' decisions of Saris, Satorra & van der Veld (2009; the J-rule) and of the EPC's confidence interval
#' against that size (equivalence testing). The app counts the decisions and gives semTools' global verdict.
ps_cb_epcequiv <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "The EPC-based judgement", raw = FALSE)
  if (identical(req$estimator, "2SLS")) {
    stop("The EPC-based judgement needs a model fitted as a whole; MIIV-2SLS estimates it equation by equation.")
  }
  if (length(unlist(req$model$ordered))) {
    stop("The EPC-based judgement is for continuous indicators (semTools::epcEquivFit).")
  }
  e <- req$epc
  val <- function(k, lo, hi, def) {
    x <- e[[k, exact = TRUE]] %||% def
    x <- ps_number(x, k)
    if (x < lo || x > hi) stop(sprintf("Invalid %s in the request.", k))
    x
  }
  std_load <- val("stdLoad", 0.01, 1, 0.4)
  cor <- val("cor", 0.01, 1, 0.1)
  std_beta <- val("stdBeta", 0.01, 1, 0.1)
  std_int <- val("stdIntcept", 0.01, 5, 0.2)
  cilevel <- val("cilevel", 0.5, 0.999, 0.9)
  mialpha <- val("mialpha", 0.0001, 0.5, 0.05)
  mipower <- val("mipower", 0.5, 0.999, 0.8)
  adjust <- if (identical(e$adjust, "bonferroni")) "bonferroni" else "none"
  body <- c(
    b$body,
    "",
    "# EPC-based judgement of misspecification (Saris, Satorra & van der Veld 2009; semTools::epcEquivFit): per fixed",
    "# parameter the MI, EPC, the power to detect a misspecification of the smallest effect size of interest (SESOI), the",
    "# J-rule decision (decision.pow) and the EPC confidence interval against the SESOI (decision.ci).",
    "suppressPackageStartupMessages(library(semTools))",
    ps_call_objects(),
    sprintf(
      "epc <- epcEquivFit(fit, stdLoad = %s, cor = %s, stdBeta = %s, stdIntcept = %s, cilevel = %s, mialpha = %s, mipower = %s, adjust.method = \"%s\")",
      format(std_load),
      format(cor),
      format(std_beta),
      format(std_int),
      format(cilevel),
      format(mialpha),
      format(mipower),
      adjust
    )
  )
  if (export) {
    return(ps_script("EPC-based judgement of misspecification (semTools::epcEquivFit)", c("lavaan", "semTools"), b$inputs, body, c("print(epc)", "summary(epc, ssv = TRUE)")))
  }
  env <- ps_run(body, b$inputs)
  d <- as.data.frame(env$epc)
  back <- ps_cb_back(ps_esem_align(b, env$fit))
  nm <- function(x) ps_back(x, back)
  col <- function(k) if (is.null(d[[k]])) rep(NA_real_, nrow(d)) else suppressWarnings(as.numeric(d[[k]]))
  chr <- function(k) if (is.null(d[[k]])) rep(NA_character_, nrow(d)) else as.character(d[[k]])
  lg <- function(k) if (is.null(d[[k]])) rep(NA, nrow(d)) else as.logical(d[[k]])
  ps_json(list(
    lhs = I(nm(chr("lhs"))),
    op = I(chr("op")),
    rhs = I(nm(chr("rhs"))),
    group = I(col("group")),
    mi = I(col("mi")),
    epc = I(col("epc")),
    stdEpc = I(col("std.epc")),
    sesoi = I(col("sesoi")),
    stdSesoi = I(col("std.sesoi")),
    significant = I(lg("significant.mi")),
    highPower = I(lg("high.power")),
    power = I(col("pow")),
    decisionPow = I(chr("decision.pow")),
    seEpc = I(col("se.epc")),
    lowStd = I(col("lower.std.epc")),
    highStd = I(col("upper.std.epc")),
    decisionCi = I(chr("decision.ci")),
    settings = list(
      stdLoad = std_load,
      cor = cor,
      stdBeta = std_beta,
      stdIntcept = std_int,
      cilevel = cilevel,
      mialpha = mialpha,
      mipower = mipower,
      adjust = adjust
    ),
    groups = if (!is.null(b$group_var)) I(as.character(lavInspect(env$fit, "group.label"))) else NULL,
    warnings = env$.warnings,
    engine = ps_engine("semTools")
  ))
}
