# Further analyses by the R packages, each built as a script that is run and
# can be exported: the bootstrap test of overall model fit (cSEM::testOMF),
# importance-performance map analysis (cSEM::doIPMA) and MIIV-2SLS
# (MIIVsem::miive).

ps_fittest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (req$package != "cSEM") stop("The bootstrap test of overall model fit is a cSEM analysis; choose cSEM as the PLS package.")
  b <- ps_pls_build(req)
  B <- as.integer(req$boot$samples); seed <- as.integer(req$boot$seed)
  body <- c(b$body,
    "# Bootstrap test of exact overall fit (Dijkstra & Henseler 2015): HI95 / HI99 are the 95% / 99% quantiles",
    "# of each discrepancy under the null of exact fit. d_G is reported by cSEM with log10.",
    sprintf("set.seed(%d)", seed),
    sprintf("test_estimated <- testOMF(fit, .R = %d, .seed = %d, .alpha = c(0.05, 0.01))", B, seed),
    sprintf("test_saturated <- testOMF(fit, .R = %d, .seed = %d, .alpha = c(0.05, 0.01), .saturated = TRUE)", B, seed))
  if (export) return(paste(ps_script(sprintf("Test of overall model fit, %d samples (cSEM)", B), "cSEM", b$inputs, body,
    c("test_saturated", "test_estimated")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  # The app reports d_G with the natural logarithm (Dijkstra & Henseler 2015).
  disc <- function(v) list(srmr = unname(v[["SRMR"]]), dULS = unname(v[["dL"]]), dG = unname(v[["dG"]]) * log(10)^2)
  part <- function(t) list(obs = disc(t$Test_statistic), hi95 = disc(t$Critical_value[, "95%"]), hi99 = disc(t$Critical_value[, "99%"]),
    ok = t$Information$Number_admissibles %||% B)
  s <- part(env$test_saturated); e <- part(env$test_estimated)
  ps_json(list(samples = B, failed = B - min(s$ok, e$ok),
    observed = list(saturated = s$obs, estimated = e$obs), hi95 = list(saturated = s$hi95, estimated = e$hi95),
    hi99 = list(saturated = s$hi99, estimated = e$hi99), warnings = env$.warnings))
}

ps_ipma <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (req$package != "cSEM") stop("IPMA is a cSEM analysis; choose cSEM as the PLS package.")
  io <- req$ipma
  b <- ps_pls_build(req)
  tl <- b$n$cv[[io$target]]
  vars <- unname(b$n$iv[b$n$all_inds])
  resc <- if (isTRUE(io$rescale)) c(
    "# Rescale every indicator to 0-100 (Ringle & Sarstedt 2016) before estimating.",
    sprintf("lo <- %s; hi <- %s", if (is.null(io$min)) "NULL" else format(ps_number(io$min, "scale minimum")), if (is.null(io$max)) "NULL" else format(ps_number(io$max, "scale maximum"))),
    sprintf("for (v in %s) { a <- if (is.null(lo)) min(data[[v]]) else lo; z <- if (is.null(hi)) max(data[[v]]) else hi; data[[v]] <- (data[[v]] - a) / (z - a) * 100 }", ps_q(vars)))
  fitline <- length(b$body)
  body <- c(b$body[-fitline], resc, b$body[fitline], "ipma <- doIPMA(fit)")
  if (export) return(paste(ps_script(sprintf("Importance-performance map analysis for %s (cSEM)", io$target), "cSEM", b$inputs, body,
    c(sprintf("ipma$Construct$Importance[\"%s\", ]", tl), "ipma$Construct$Performance", sprintf("ipma$Indicator$Importance[\"%s\", ]", tl), "ipma$Indicator$Performance")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  ip <- env$ipma
  cn <- setNames(b$n$cname, b$cv)
  inm <- setNames(b$n$all_inds, vars)
  W <- env$fit$Estimates$Weight_estimates
  owner <- vapply(vars, function(v) b$cv[which(vapply(b$n$inds, function(x) inm[[v]] %in% x, TRUE))[1]], "")
  ps_json(list(
    target = io$target, targetPerformance = unname(ip$Construct$Performance[[tl]]),
    constructs = lapply(setdiff(colnames(ip$Construct$Importance), tl), function(k) list(name = cn[[k]], importance = ip$Construct$Importance[tl, k], performance = unname(ip$Construct$Performance[[k]]))),
    indicators = lapply(colnames(ip$Indicator$Importance), function(v) list(name = inm[[v]], construct = cn[[owner[[v]]]], weight = W[owner[[v]], v],
      importance = ip$Indicator$Importance[tl, v], performance = unname(ip$Indicator$Performance[[v]]))),
    negativeWeights = unname(inm[vars[vapply(vars, function(v) W[owner[[v]], v] < 0, TRUE)]]),
    warnings = env$.warnings))
}

ps_miiv <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (length(req$model$moderations)) stop("MIIV-2SLS does not support latent interactions.")
  if (!is.null(req$model$weights)) stop("MIIV-2SLS does not use sampling weights; choose ML, MLR or MLM.")
  req$estimator <- "ML"
  b <- ps_cb_build(req)
  # Same model syntax; single-indicator error variances are implied by MIIVsem's scaling.
  body <- b$body[!grepl("~~ 0\\*", b$body)]
  body[length(body)] <- if (b$matrix_input)
    "fit <- miive(model, sample.cov = S, sample.mean = setNames(rep(0, ncol(S)), colnames(S)), sample.nobs = N, var.cov = TRUE)  # means only affect intercepts"
  else "fit <- miive(model, data, var.cov = TRUE)"
  # Standardised values: MIIVsem's model with every coefficient fixed at its 2SLS estimate and the
  # (co)variances estimated (var.cov = TRUE), standardised by lavaan.
  body <- c(body,
    "# Standardised estimates: lavaan's std.all for the MIIV-2SLS coefficients (variances from var.cov = TRUE)",
    if (b$matrix_input) "fit_std <- lavaan::sem(paste(fit$v$model, collapse = \"\\n\"), sample.cov = S, sample.nobs = N)"
    else "fit_std <- lavaan::sem(paste(fit$v$model, collapse = \"\\n\"), data = data)",
    "std <- lavaan::standardizedSolution(fit_std, se = FALSE)")
  body[1] <- "suppressPackageStartupMessages(library(MIIVsem))"
  if (export) return(paste(ps_script("MIIV-2SLS (MIIVsem)", c("MIIVsem", "lavaan"), b$inputs, body,
    c("summary(fit)", "std[std$op %in% c(\"=~\", \"~\"), c(\"lhs\", \"op\", \"rhs\", \"est.std\")]")), collapse = "\n"))
  # The standardisation step can fail (e.g. an improper variance solution) without affecting the 2SLS estimates.
  fit_body <- body[seq_len(length(body) - 3)]
  env <- ps_run(fit_body, b$inputs)
  std_ok <- tryCatch({ eval(parse(text = paste(body[(length(body) - 1):length(body)], collapse = "\n")), envir = env); TRUE },
    error = function(e) { env$.warnings <- c(env$.warnings, paste("Standardised values unavailable:", conditionMessage(e))); FALSE })
  fit <- env$fit
  constructs <- b$n$cname
  back <- c(setNames(constructs, unname(b$lname[constructs])), setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds])))
  nm <- function(x) unname(back[x])
  et <- MIIVsem::estimatesTable(fit)
  et <- et[et$op %in% c("=~", "~") & et$se > 0, ]
  coef <- function(lhs, op, rhs) {
    r <- et[et$lhs == lhs & et$op == op & et$rhs == rhs, ][1, ]
    s <- if (std_ok) env$std$est.std[env$std$lhs == lhs & env$std$op == op & env$std$rhs == rhs] else numeric(0)
    list(lhs = nm(lhs), op = op, rhs = nm(rhs), est = r$est, se = r$se, z = r$z, p = r$pvalue, std = if (length(s)) s[1] else NULL)
  }
  lv <- unname(b$lname[constructs])
  eqs <- lapply(fit$eqn, function(e) {
    measurement <- e$EQmod == "measurement"
    kind <- if (!measurement) "structural" else if (e$DVlat %in% lv) "higher-order" else "measurement"
    cf <- if (measurement) list(coef(e$IVlat, "=~", e$DVlat)) else lapply(e$IVlat, function(iv) coef(e$DVlat, "~", iv))
    list(kind = kind, dv = nm(e$DVobs), regressors = nm(e$IVobs), instruments = nm(e$MIIVs), coefficients = cf,
      sigma2 = as.numeric(e$sigma), sargan = if (is.null(e$sargan)) NULL else as.numeric(e$sargan),
      sarganDf = if (is.null(e$sargan.df)) 0L else as.integer(e$sargan.df), sarganP = if (is.null(e$sargan.p)) NULL else as.numeric(e$sargan.p))
  })
  n <- if (b$matrix_input) b$inputs$N else nrow(env$data)
  # Marker loadings (fixed to 1) have no 2SLS estimate, but a standardised value.
  # Markers: the first indicator (or component) of each factor.
  markers <- unlist(lapply(seq_along(b$comps), function(j) if (b$is_cov[j]) NULL else if (length(b$comps[[j]])) unname(b$lname[[b$comps[[j]][1]]]) else unname(b$n$iv[[b$n$inds[[j]][1]]])))
  fixed_std <- if (std_ok) { s <- env$std[env$std$op == "=~" & env$std$rhs %in% markers, ]; as.list(setNames(s$est.std, nm(s$rhs))) } else list()
  # Variances and covariances from MIIVsem's var.cov step (no standard errors), with lavaan's std.all.
  variances <- if (std_ok) {
    pe <- lavaan::parameterEstimates(env$fit_std, se = FALSE); pe <- pe[pe$op == "~~", ]
    lapply(seq_len(nrow(pe)), function(i) list(lhs = nm(pe$lhs[i]), rhs = nm(pe$rhs[i]), latent = pe$lhs[i] %in% unname(b$lname),
      est = pe$est[i], std = env$std$est.std[env$std$op == "~~" & env$std$lhs == pe$lhs[i] & env$std$rhs == pe$rhs[i]][1]))
  } else list()
  r2 <- ps_try(env$fit$v$rsquare, "R² (MIIVsem)")
  r2 <- if (is.null(r2)) list() else as.list(setNames(as.numeric(r2), nm(names(r2))))
  ps_json(list(n = n, equations = eqs, estimates = unlist(lapply(eqs, `[[`, "coefficients"), recursive = FALSE), r2 = r2, fixedStd = fixed_std, variances = variances,
    warnings = env$.warnings, engine = list(package = "MIIVsem", version = as.character(utils::packageVersion("MIIVsem")))))
}
