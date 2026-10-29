# Longitudinal models with lavaan: latent growth curves (lavaan::growth) and
# the random-intercept cross-lagged panel model (RI-CLPM; Hamaker, Kuiper &
# Grasman 2015, lavaan code after Mulder & Hamaker 2021), compared with the
# traditional cross-lagged panel model.

#' Data frame of the requested columns under syntactic names; the map back.
ps_long_frame <- function(req, cols) {
  at <- match(cols, req$data$names)
  if (anyNA(at)) stop("Column(s) not in the dataset: ", paste(cols[is.na(at)], collapse = ", "))
  dc <- req$data$cols
  col <- function(i) as.numeric(if (is.matrix(dc)) dc[i, ] else dc[[i]])
  df <- as.data.frame(lapply(at, col))
  v <- ps_ident(cols)
  names(df) <- v
  list(data = df, v = setNames(v, cols), back = setNames(cols, v))
}

#' lavaan options for the estimator and missing values.
ps_long_options <- function(req) {
  est <- req$estimator %||% "ML"
  if (!est %in% c("ML", "MLR")) stop("Longitudinal models use the ML or MLR estimator.")
  list(est = est, fiml = identical(req$missing, "fiml"))
}

ps_long_fit <- function(fit) {
  fm <- lavaan::fitMeasures(fit)
  keep <- intersect(c("npar", "chisq", "df", "pvalue", "chisq.scaled", "df.scaled", "pvalue.scaled", "cfi", "tli", "cfi.robust", "tli.robust",
    "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.robust", "srmr", "logl", "aic", "bic"), names(fm))
  lapply(as.list(fm[keep]), as.numeric)
}

ps_long_estimates <- function(fit, back, lvs) {
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
  pe <- pe[pe$op %in% c("~1", "~~", "~", "=~") & pe$lhs %in% lvs, ]
  nm <- function(x) ifelse(x %in% names(back), back[x], x)
  lapply(seq_len(nrow(pe)), function(i) list(lhs = nm(pe$lhs[i]), op = pe$op[i], rhs = nm(pe$rhs[i]), est = pe$est[i],
    se = if (is.na(pe$se[i]) || pe$se[i] == 0) NULL else pe$se[i], z = if (is.na(pe$z[i])) NULL else pe$z[i],
    p = if (is.na(pe$pvalue[i])) NULL else pe$pvalue[i], std = pe$std.all[i]))
}

ps_growth <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  measures <- unlist(req$measures); covs <- unlist(req$covariates)
  times <- as.numeric(unlist(req$times))
  if (length(measures) < 3) stop("A growth model needs at least three measurement occasions.")
  if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per measurement occasion.")
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic", "basis")) stop("Invalid growth shape in the request.")
  if (shape == "quadratic" && length(measures) < 4) stop("A quadratic growth model needs at least four occasions.")
  fr <- ps_long_frame(req, c(measures, covs))
  o <- ps_long_options(req)
  y <- unname(fr$v[measures])
  slope <- if (shape == "basis") c(paste0("0*", y[1]), paste0("1*", y[2]), y[-(1:2)]) else paste0(format(times), "*", y)
  lines <- c(paste("i =~", paste0("1*", y, collapse = " + ")), paste("s =~", paste(trimws(slope), collapse = " + ")),
    if (shape == "quadratic") paste("q =~", paste0(format(times^2), "*", y, collapse = " + ")),
    if (length(covs)) sprintf("%s ~ %s", paste(c("i", "s", if (shape == "quadratic") "q"), collapse = " + "), paste(unname(fr$v[covs]), collapse = " + ")))
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("# Latent growth curve (%s), time scores %s", shape, paste(format(times), collapse = ", ")),
    "model <- '", paste0("  ", lines), "'",
    sprintf("fit <- growth(model, data = data, estimator = \"%s\"%s)", o$est, if (o$fiml) ", missing = \"ml\"" else ""))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Latent growth curve (lavaan)", "lavaan", inputs, body,
    "summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)"), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  implied <- lavaan::fitted(fit)$mean[y]
  ps_json(list(n = lavaan::lavInspect(fit, "nobs"), fit = ps_long_fit(fit),
    estimates = ps_long_estimates(fit, fr$back, c("i", "s", "q")),
    r2 = as.list(lavaan::lavInspect(fit, "r2")[intersect(c("i", "s", "q"), names(lavaan::lavInspect(fit, "r2")))]),
    impliedMeans = unname(implied), observedMeans = unname(colMeans(env$data[, y, drop = FALSE], na.rm = TRUE)),
    measures = measures, times = times,
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
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
  call <- function(name, model) sprintf("%s <- lavaan(%s, data = data, meanstructure = TRUE, int.ov.free = TRUE, estimator = \"%s\"%s)",
    name, model, o$est, if (o$fiml) ", missing = \"ml\"" else "")
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
  if (export) return(paste(ps_script("RI-CLPM (lavaan)", "lavaan", inputs, body,
    c("summary(fit, fit.measures = TRUE, standardized = TRUE)", "compare")), collapse = "\n"))
  env <- ps_run(body, inputs)
  lvs <- c("RIx", "RIy", sprintf("wx%d", 1:T), sprintf("wy%d", 1:T))
  cmp <- env$compare
  ps_json(list(n = lavaan::lavInspect(env$fit, "nobs"), waves = T, equal = equal, fit = ps_long_fit(env$fit), clpmFit = ps_long_fit(env$fit_clpm),
    estimates = ps_long_estimates(env$fit, fr$back, lvs),
    comparison = list(chisqDiff = unname(cmp[["Chisq diff"]][2]), dfDiff = unname(cmp[["Df diff"]][2]), p = unname(cmp[["Pr(>Chisq)"]][2])),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}
