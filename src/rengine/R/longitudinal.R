# Longitudinal models with lavaan: latent growth curves (lavaan::growth) and
# the random-intercept cross-lagged panel model (RI-CLPM; Hamaker, Kuiper &
# Grasman 2015, lavaan code after Mulder & Hamaker 2021), compared with the
# traditional cross-lagged panel model.

#' Data frame of the requested columns under syntactic names; the map back.
ps_long_frame <- function(req, cols) {
  at <- match(cols, req$data$names)
  if (anyNA(at)) stop("Column(s) not in the dataset: ", paste(cols[is.na(at)], collapse = ", "))
  df <- as.data.frame(lapply(at, function(i) ps_col(req$data$cols, i)))
  v <- ps_ident(cols)
  names(df) <- v
  list(data = df, v = setNames(v, cols), back = setNames(cols, v))
}

#' lavaan options for the estimator and missing values.
ps_long_options <- function(req) {
  est <- req$estimator %||% "ML"
  if (!est %in% c("ML", "MLR")) stop("Longitudinal models use the ML or MLR estimator.")
  # (fiml: lavaan handles the missing values (FIML, pairwise, two-stage), so no rows are dropped beforehand)
  info <- req$information
  if (!is.null(info) && !(identical(info, "observed") && est == "ML")) stop("Invalid information in the request: observed information is an option for ML.")
  # (`extra`: the further lavaan arguments of the call: standard errors from the observed information, as Mplus)
  list(est = est, fiml = !is.null(PS_LAVAAN_MISSING[[req$missing %||% ""]]), extra = if (!is.null(info)) ", information = \"observed\"" else "")
}

ps_long_fit <- function(fit) {
  fm <- lavaan::fitMeasures(fit)
  keep <- intersect(c("npar", "chisq", "df", "pvalue", "chisq.scaled", "df.scaled", "pvalue.scaled", "cfi", "tli", "cfi.robust", "tli.robust",
    "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.robust", "srmr", "logl", "aic", "bic"), names(fm))
  lapply(as.list(fm[keep]), as.numeric)
}

#' `also`: further rows to keep (ops and lhs), e.g. the occasions' residual variances and their regressions on time-varying covariates.
ps_long_estimates <- function(fit, back, lvs, also = NULL) {
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
  keep <- pe$op %in% c("~1", "~~", "~", "=~") & pe$lhs %in% lvs
  for (a in also) keep <- keep | (pe$op == a$op & pe$lhs %in% a$lhs & (a$op != "~~" | pe$lhs == pe$rhs))
  pe <- pe[keep, ]
  lapply(seq_len(nrow(pe)), function(i) list(lhs = ps_back(pe$lhs[i], back), op = pe$op[i], rhs = ps_back(pe$rhs[i], back), est = pe$est[i],
    se = if (is.na(pe$se[i]) || pe$se[i] == 0) NULL else pe$se[i], z = if (is.na(pe$z[i])) NULL else pe$z[i],
    p = if (is.na(pe$pvalue[i])) NULL else pe$pvalue[i], std = pe$std.all[i]))
}

#' The model syntax of a growth model as written: lavaan syntax with variable names, numbers, operators and the
#' modifiers c() and start() only. lavaan turns constraints (==, <, >, :=) into R code, so no other function call
#' (and no quote, $, @, [ or {) may reach it. Comments are dropped.
ps_growth_syntax_text <- function(x) {
  if (!is.character(x) || length(x) != 1 || nchar(x) > 20000) stop("Invalid model syntax in the request.")
  body <- gsub("[#!][^\n]*", "", x)
  if (!grepl("^[-A-Za-z0-9_ .+*/^()=~|:,;<>\n\r\t]*$", body)) stop("The model syntax may contain only variable names, numbers, lavaan operators and the modifiers c() and start().")
  calls <- sub("[[:space:]]*\\($", "", regmatches(body, gregexpr("[A-Za-z0-9_.]+[[:space:]]*\\(", body))[[1]])
  if (length(setdiff(calls, c("c", "start")))) stop("The model syntax may call no function other than the modifiers c() and start().")
  trimws(gsub("\n[[:space:]]*\n+", "\n", body))
}

#' A growth model written as lavaan syntax, estimated by lavaan::growth() (growth factor means free, the
#' occasions' intercepts fixed at 0): piecewise or parallel processes, multiple indicators per occasion,
#' equality and nonlinear constraints, labels, and (`group`) several groups with c() modifiers per group.
ps_growth_syntax <- function(req, export) {
  model <- ps_growth_syntax_text(req$syntax)
  group <- req$group %||% ""
  cols <- unlist(req$data$names)
  fr <- ps_long_frame(req, cols)
  if (!identical(unname(fr$v), cols)) stop("The variables of a growth model written as syntax must be column names of letters, digits and _.")
  o <- ps_long_options(req)
  if (nzchar(group) && !group %in% cols) stop("The group column is not in the request.")
  measures <- unlist(req$measures); times <- as.numeric(unlist(req$times))
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    "# Latent growth model as written (lavaan syntax in `model`)",
    sprintf("fit <- growth(model, data = data, estimator = \"%s\"%s%s%s)", o$est, ps_lavaan_missing(req$missing),
      if (nzchar(group)) sprintf(", group = %s", encodeString(group, quote = '"')) else "", o$extra))
  inputs <- list(data = fr$data, model = model)
  if (export) return(ps_script("Latent growth model (lavaan)", "lavaan", inputs, body,
    "summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
  pe <- pe[pe$op %in% c("=~", "~", "~~", "~1", "|", "~*~", ":="), ]
  num <- function(x) if (is.null(x) || is.na(x)) NULL else x
  est <- lapply(seq_len(nrow(pe)), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i],
    se = if (is.na(pe$se[i]) || pe$se[i] == 0) NULL else pe$se[i], z = num(pe$z[i]), p = num(pe$pvalue[i]), std = num(pe$std.all[i]),
    group = if (is.null(pe$group)) 1L else pe$group[i], label = if (is.null(pe$label) || !nzchar(pe$label[i])) NULL else pe$label[i]))
  groups <- lavaan::lavInspect(fit, "ngroups")
  # (the trajectory chart: the model-implied and observed means of the occasions listed, one group only)
  plot <- groups == 1 && length(measures) >= 2 && length(times) == length(measures) && all(measures %in% cols)
  ps_json(list(n = sum(unlist(lavaan::lavInspect(fit, "nobs"))), fit = ps_long_fit(fit), estimates = est, r2 = list(),
    impliedMeans = if (plot) unname(lavaan::fitted(fit)$mean[measures]) else list(),
    observedMeans = if (plot) unname(colMeans(env$data[, measures, drop = FALSE], na.rm = TRUE)) else list(),
    measures = if (plot) measures else list(), times = if (plot) times else list(),
    groups = if (groups > 1) as.list(lavaan::lavInspect(fit, "group.label")) else list(),
    warnings = env$.warnings, engine = ps_engine("lavaan")))
}

ps_growth <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  # (a model written as lavaan syntax instead of the shape and covariates)
  if (nzchar(req$syntax %||% "")) return(ps_growth_syntax(req, export))
  measures <- unlist(req$measures); covs <- unlist(req$covariates); tvc <- unlist(req$timeVarying)
  times <- as.numeric(unlist(req$times))
  if (length(measures) < 3) stop("A growth model needs at least three measurement occasions.")
  if (length(tvc) && length(tvc) != length(measures)) stop("Give one time-varying covariate per measurement occasion (or none).")
  if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per measurement occasion.")
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic", "basis")) stop("Invalid growth shape in the request.")
  if (shape == "quadratic" && length(measures) < 4) stop("A quadratic growth model needs at least four occasions.")
  fr <- ps_long_frame(req, c(measures, covs, tvc))
  o <- ps_long_options(req)
  y <- unname(fr$v[measures])
  slope <- if (shape == "basis") c(paste0("0*", y[1]), paste0("1*", y[2]), y[-(1:2)]) else paste0(format(times), "*", y)
  lines <- c(paste("i =~", paste0("1*", y, collapse = " + ")), paste("s =~", paste(trimws(slope), collapse = " + ")),
    if (shape == "quadratic") paste("q =~", paste0(format(times^2), "*", y, collapse = " + ")),
    if (length(covs)) sprintf("%s ~ %s", paste(c("i", "s", if (shape == "quadratic") "q"), collapse = " + "), paste(unname(fr$v[covs]), collapse = " + ")),
    # Time-varying covariates: each occasion regressed on its own covariate (lavaan tutorial, growth curve models).
    if (length(tvc)) c("# time-varying covariates", sprintf("%s ~ %s", y, unname(fr$v[tvc]))))
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("# Latent growth curve (%s), time scores %s", shape, paste(format(times), collapse = ", ")),
    "model <- '", paste0("  ", lines), "'",
    sprintf("fit <- growth(model, data = data, estimator = \"%s\"%s%s)", o$est, ps_lavaan_missing(req$missing), o$extra))
  inputs <- list(data = fr$data)
  if (export) return(ps_script("Latent growth curve (lavaan)", "lavaan", inputs, body,
    "summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  implied <- lavaan::fitted(fit)$mean[y]
  ps_json(list(n = lavaan::lavInspect(fit, "nobs"), fit = ps_long_fit(fit),
    # (with the occasions' residual variances, as lavaan's and Mplus's output list them)
    estimates = ps_long_estimates(fit, fr$back, c("i", "s", "q"), also = c(list(list(op = "~~", lhs = y)), if (length(tvc)) list(list(op = "~", lhs = y)))),
    r2 = as.list(lavaan::lavInspect(fit, "r2")[intersect(c("i", "s", "q"), names(lavaan::lavInspect(fit, "r2")))]),
    impliedMeans = unname(implied), observedMeans = unname(colMeans(env$data[, y, drop = FALSE], na.rm = TRUE)),
    measures = measures, times = times,
    warnings = env$.warnings, engine = ps_engine("lavaan")))
}

ps_riclpm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  xs <- unlist(req$x); ys <- unlist(req$y)
  T <- length(xs)
  if (T < 3 || length(ys) != T) stop("The RI-CLPM needs both variables at the same three or more waves.")
  fr <- ps_long_frame(req, c(xs, ys))
  o <- ps_long_options(req)
  x <- unname(fr$v[xs]); y <- unname(fr$v[ys])
  equal <- isTRUE(req$equal)
  spec <- function(random) c(
    if (random) c(sprintf("RIx =~ %s", paste0("1*", x, collapse = " + ")), sprintf("RIy =~ %s", paste0("1*", y, collapse = " + "))),
    sprintf("wx%d =~ 1*%s", 1:T, x), sprintf("wy%d =~ 1*%s", 1:T, y),
    sprintf("wx%d ~ %swx%d + %swy%d", 2:T, if (equal) "a*" else "", 1:(T - 1), if (equal) "b*" else "", 1:(T - 1)),
    sprintf("wy%d ~ %swx%d + %swy%d", 2:T, if (equal) "c*" else "", 1:(T - 1), if (equal) "d*" else "", 1:(T - 1)),
    sprintf("wx%d ~~ wy%d", 1:T, 1:T), sprintf("wx%d ~~ wx%d", 1:T, 1:T), sprintf("wy%d ~~ wy%d", 1:T, 1:T),
    if (random) c("RIx ~~ RIx", "RIy ~~ RIy", "RIx ~~ RIy", "RIx ~~ 0*wx1", "RIx ~~ 0*wy1", "RIy ~~ 0*wx1", "RIy ~~ 0*wy1"),
    sprintf("%s ~~ 0*%s", c(x, y), c(x, y)))
  call <- function(name, model) sprintf("%s <- lavaan(%s, data = data, meanstructure = TRUE, int.ov.free = TRUE, estimator = \"%s\"%s%s)",
    name, model, o$est, ps_lavaan_missing(req$missing), o$extra)
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    "# RI-CLPM: stable between-person differences (random intercepts RIx, RIy) separated from",
    "# within-person fluctuations (wx, wy), which carry the autoregressive and cross-lagged effects.",
    "riclpm <- '", paste0("  ", spec(TRUE)), "'",
    "# The traditional cross-lagged panel model: the same without random intercepts.",
    "clpm <- '", paste0("  ", spec(FALSE)), "'",
    call("fit", "riclpm"), call("fit_clpm", "clpm"),
    "# Do the random intercepts improve fit? (Their variances lie on the boundary: conservative test.)",
    "compare <- lavTestLRT(fit_clpm, fit)")
  inputs <- list(data = fr$data)
  if (export) return(ps_script("RI-CLPM (lavaan)", "lavaan", inputs, body,
    c("summary(fit, fit.measures = TRUE, standardized = TRUE)", "compare")))
  env <- ps_run(body, inputs)
  lvs <- c("RIx", "RIy", sprintf("wx%d", 1:T), sprintf("wy%d", 1:T))
  cmp <- env$compare
  ps_json(list(n = lavaan::lavInspect(env$fit, "nobs"), waves = T, equal = equal, fit = ps_long_fit(env$fit), clpmFit = ps_long_fit(env$fit_clpm),
    estimates = ps_long_estimates(env$fit, fr$back, lvs),
    comparison = list(chisqDiff = unname(cmp[["Chisq diff"]][2]), dfDiff = unname(cmp[["Df diff"]][2]), p = unname(cmp[["Pr(>Chisq)"]][2])),
    warnings = env$.warnings, engine = ps_engine("lavaan")))
}

#' Latent change score (LCS) models (McArdle 2009; Kievit et al. 2018): the univariate and bivariate dual change score
#' models of lcsm's specify_uni_lcsm / specify_bi_lcsm (Wiedemann), written here with the same latent names and
#' parameter labels: a latent true score per occasion (lx1 ... lxT, one observed score each, residual variances equal
#' over time), latent changes dx2 ... dxT between consecutive true scores, and the change components: constant change
#' (a factor g2 loading 1 on every change: its mean alpha and variance), proportional change (beta: each change on the
#' previous true score), autoregression of the changes (phi: each change on the previous change), and between two
#' variables the coupling (delta: a change on the other variable's previous true score; xi: on the other's previous
#' change). The observed columns are renamed x1 ... xT and y1 ... yT, as lcsm renames them, and fitted with lavaan() as
#' lcsm::fit_uni_lcsm / fit_bi_lcsm fit them (mean structure, fixed.x = FALSE), with the estimator and missing-value
#' treatment of the Model settings.
ps_lcs_uni_lines <- function(T, v, m, g) {
  t <- seq_len(T); t2 <- t[-1]; t3 <- t[-(1:2)]
  lv <- function(i) sprintf("l%s%d", v, i); d <- function(i) sprintf("d%s%d", v, i)
  c("# Latent true scores", sprintf("%s =~ 1 * %s%d", lv(t), v, t),
    "# Means and variances of the latent true scores: the first free, the others defined by the changes",
    sprintf("%s ~ gamma_%s * 1", lv(1), lv(1)), sprintf("%s ~ 0 * 1", lv(t2)),
    sprintf("%s ~~ sigma2_%s * %s", lv(1), lv(1), lv(1)), sprintf("%s ~~ 0 * %s", lv(t2), lv(t2)),
    "# Observed scores: intercepts 0, residual variances equal over time", sprintf("%s%d ~ 0 * 1", v, t), sprintf("%s%d ~~ sigma2_u%s * %s%d", v, t, v, v, t),
    "# Each true score is the previous one plus the latent change", sprintf("%s ~ 1 * %s", lv(t2), lv(t2 - 1)), sprintf("%s =~ 1 * %s", d(t2), lv(t2)),
    sprintf("%s ~ 0 * 1", d(t2)), sprintf("%s ~~ 0 * %s", d(t2), d(t2)),
    if (isTRUE(m$constant)) c("# Constant change: a factor loading 1 on every change; its mean, variance and covariance with the initial true score",
      sprintf("%s2 =~ %s", g, paste(sprintf("1 * %s", d(t2)), collapse = " + ")), sprintf("%s2 ~ alpha_%s2 * 1", g, g), sprintf("%s2 ~~ sigma2_%s2 * %s2", g, g, g),
      sprintf("%s2 ~~ sigma_%s2%s * %s", g, g, lv(1), lv(1))),
    if (isTRUE(m$proportional)) c("# Proportional change: each change depends on the previous true score", sprintf("%s ~ beta_%s * %s", d(t2), v, lv(t2 - 1))),
    if (isTRUE(m$autoregressive)) c("# Autoregression of the changes: each change depends on the previous change", sprintf("%s ~ phi_%s * %s", d(t3), v, d(t3 - 1))))
}

ps_lcs_bi_lines <- function(T, mx, my, cp) {
  t2 <- seq_len(T)[-1]; t3 <- seq_len(T)[-(1:2)]
  c(ps_lcs_uni_lines(T, "x", mx, "g"), ps_lcs_uni_lines(T, "y", my, "j"),
    "# Residual covariances of the two observed scores at each occasion, equal over time", sprintf("x%d ~~ sigma_su * y%d", seq_len(T), seq_len(T)),
    "# Covariances of the initial true scores and the constant changes between the variables", "lx1 ~~ sigma_ly1lx1 * ly1",
    if (isTRUE(mx$constant)) "ly1 ~~ sigma_g2ly1 * g2", if (isTRUE(my$constant)) "lx1 ~~ sigma_j2lx1 * j2", if (isTRUE(mx$constant) && isTRUE(my$constant)) "g2 ~~ sigma_j2g2 * j2",
    if (isTRUE(cp$deltaXY)) c("# Coupling: the change in x depends on the previous true score of y", sprintf("dx%d ~ delta_lag_xy * ly%d", t2, t2 - 1)),
    if (isTRUE(cp$deltaYX)) c("# Coupling: the change in y depends on the previous true score of x", sprintf("dy%d ~ delta_lag_yx * lx%d", t2, t2 - 1)),
    if (isTRUE(cp$xiXY)) c("# Coupling: the change in x depends on the previous change in y", sprintf("dx%d ~ xi_lag_xy * dy%d", t3, t3 - 1)),
    if (isTRUE(cp$xiYX)) c("# Coupling: the change in y depends on the previous change in x", sprintf("dy%d ~ xi_lag_yx * dx%d", t3, t3 - 1)))
}

ps_lcs <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  xs <- unlist(req$x); ys <- unlist(req$y)
  T <- length(xs)
  bi <- length(ys) > 0
  if (T < 3) stop("A latent change score model needs at least three occasions.")
  if (T > 50) stop("A latent change score model takes at most 50 occasions.")
  if (bi && length(ys) != T) stop("Choose the second variable at the same number of occasions.")
  if (anyDuplicated(c(xs, ys))) stop("An occasion is chosen twice.")
  flags <- function(m, keys) {
    m <- if (is.list(m)) m else list()
    for (k in keys) if (!is.null(m[[k]]) && !(is.logical(m[[k]]) && length(m[[k]]) == 1 && !is.na(m[[k]]))) stop("Invalid model option in the request.")
    m
  }
  mx <- flags(req$modelX, c("constant", "proportional", "autoregressive")); my <- flags(req$modelY, c("constant", "proportional", "autoregressive"))
  cp <- flags(req$coupling, c("deltaXY", "deltaYX", "xiXY", "xiYX"))
  fr <- ps_long_frame(req, c(xs, ys))
  o <- ps_long_options(req)
  # (the columns renamed as lcsm renames them: x1 ... xT, y1 ... yT)
  names(fr$data) <- c(sprintf("x%d", seq_len(T)), if (bi) sprintf("y%d", seq_len(T)))
  lines <- if (bi) ps_lcs_bi_lines(T, mx, my, cp) else ps_lcs_uni_lines(T, "x", mx, "g")
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    sprintf("# The occasions as x1 ... x%d: %s", T, ps_comment(paste(xs, collapse = ", "))),
    if (bi) sprintf("# and y1 ... y%d: %s", T, ps_comment(paste(ys, collapse = ", "))),
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("# %s latent change score model (McArdle; the specification of lcsm::specify_%s_lcsm)", if (bi) "Bivariate" else "Univariate", if (bi) "bi" else "uni"),
    "model <- '", paste0("  ", lines), "'",
    sprintf("fit <- lavaan(model, data = data, meanstructure = TRUE, fixed.x = FALSE, control = list(iter.max = 10000), estimator = \"%s\"%s%s)", o$est, ps_lavaan_missing(req$missing), o$extra))
  inputs <- list(data = fr$data)
  if (export) return(ps_script(sprintf("%s latent change score model (lavaan)", if (bi) "Bivariate" else "Univariate"), "lavaan", inputs, body,
    "summary(fit, fit.measures = TRUE, standardized = TRUE)"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
  # (each labelled parameter once: equal labels are one parameter)
  pe <- pe[nzchar(pe$label) & !duplicated(pe$label), ]
  num <- function(x) if (is.null(x) || is.na(x)) NULL else x
  est <- lapply(seq_len(nrow(pe)), function(i) list(label = pe$label[i], lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i],
    se = if (is.na(pe$se[i]) || pe$se[i] == 0) NULL else pe$se[i], z = num(pe$z[i]), p = num(pe$pvalue[i]), std = num(pe$std.all[i])))
  occ <- function(v) sprintf("%s%d", v, seq_len(T))
  obs <- function(v) if (bi || v == "x") I(unname(colMeans(env$data[, occ(v), drop = FALSE], na.rm = TRUE))) else I(numeric(0))
  imp <- function(v) if (bi || v == "x") I(unname(lavaan::fitted(fit)$mean[occ(v)])) else I(numeric(0))
  ps_json(list(n = lavaan::lavInspect(fit, "nobs"), occasions = T, bivariate = bi, x = I(as.character(xs)), y = I(as.character(ys)), fit = ps_long_fit(fit), estimates = est,
    impliedMeans = list(x = imp("x"), y = imp("y")), observedMeans = list(x = obs("x"), y = obs("y")),
    warnings = env$.warnings, engine = ps_engine("lavaan")))
}
