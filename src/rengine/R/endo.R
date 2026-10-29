# Endogeneity in regression models: instrumental variables (ivreg; Fox,
# Kleiber & Zeileis), instrument-free corrections after REndo (Gui, Meierer,
# Algesheimer & Schilter): the Gaussian copula control function (Park & Gupta
# 2012), heteroskedasticity-based instruments (Lewbel 2012) and higher-moment
# instruments (Lewbel 1997); and the Heckman selection model (sampleSelection).
# REndo cannot be loaded in the browser's R (its dependency mclust is not
# built for WebAssembly), so its estimators are written out here, line for
# line as in REndo, and checked against REndo in desktop R.

ps_endo_frame <- function(req) {
  cols <- unique(c(req$outcome, unlist(req$exogenous), unlist(req$endogenous), unlist(req$instruments), req$selection$outcome, unlist(req$selection$regressors)))
  cols <- cols[nzchar(cols)]
  fr <- ps_long_frame(req, cols)
  v <- function(x) unname(fr$v[unlist(x)])
  list(fr = fr, y = v(req$outcome), x = v(req$exogenous), p = v(req$endogenous), z = v(req$instruments), v = v)
}

#' Coefficient table rows from a matrix with estimate, SE, statistic, p.
#' Intervals by position when they line up with the rows (Heckman repeats "(Intercept)"), else by name.
ps_coef_rows <- function(m, back, ci = NULL, equation = NULL) {
  at <- function(i) if (is.null(ci)) NA else if (nrow(ci) == nrow(m)) i else match(rownames(m)[i], rownames(ci))
  lapply(seq_len(nrow(m)), function(i) {
    term <- rownames(m)[i]; j <- at(i)
    list(term = if (term == "(Intercept)") "Intercept" else if (term %in% names(back)) unname(back[term]) else term,
      equation = if (is.null(equation)) NULL else equation[i],
      est = m[i, 1], se = m[i, 2], stat = m[i, 3], p = m[i, 4],
      ciLow = if (is.na(j)) NULL else ci[j, 1], ciHigh = if (is.na(j)) NULL else ci[j, 2])
  })
}

ps_endo <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  method <- req$method %||% "iv"
  if (!method %in% c("iv", "copula", "het", "hm", "heckman")) stop("Invalid method in the request.")
  f <- ps_endo_frame(req)
  y <- f$y; x <- f$x; p <- f$p; z <- f$z
  if (method != "heckman" && (!length(y) || !length(p))) stop("Choose the outcome and the endogenous regressor(s).")
  rhs <- function(...) { t <- c(...); if (length(t)) paste(t, collapse = " + ") else "1" }
  conf <- as.numeric(req$boot$confidence %||% 0.95)
  B <- as.integer(req$boot$samples %||% 1000); seed <- as.integer(req$boot$seed %||% 1)
  if (B < 10 || B > 20000 || !is.finite(conf) || conf <= 0.5 || conf >= 1) stop("Invalid bootstrap settings.")
  ols <- sprintf("ols <- lm(%s ~ %s, data = data)", y, rhs(x, p))
  body <- c("suppressPackageStartupMessages({ library(ivreg); library(lmtest) })",
    "data <- data[complete.cases(data), ]",
    "# For comparison: ordinary least squares, which assumes the regressors are exogenous.", ols)
  pkgs <- "ivreg"
  if (method == "iv") {
    if (!length(z)) stop("Choose at least one instrument (a variable that affects the outcome only through the endogenous regressor).")
    if (length(z) < length(p)) stop("Two-stage least squares needs at least as many instruments as endogenous regressors.")
    body <- c(body, "# Two-stage least squares: the endogenous regressors replaced by their prediction from the instruments and the exogenous regressors.",
      sprintf("fit <- ivreg(%s ~ %s | %s, data = data)", y, rhs(x, p), rhs(x, z)),
      "res <- summary(fit, diagnostics = TRUE)  # weak instruments, Wu-Hausman, Sargan",
      sprintf("ci <- confint(fit, level = %s)", format(conf)))
  } else if (method == "copula") {
    body <- c(body,
      "# Gaussian copula control function (Park & Gupta 2012), as REndo::copulaCorrection for continuous",
      "# endogenous regressors: P* = qnorm(empirical CDF of P) enters as an extra regressor; its coefficient",
      "# tests endogeneity. Standard errors and intervals by a case bootstrap (the P* are recomputed per sample).",
      "pstar <- function(v) { H <- stats::ecdf(v); U <- H(v); n <- length(v); U[U == 0] <- 1 - n / (n + 1); U[U == 1] <- n / (n + 1); s <- stats::qnorm(U); s[s == 0] <- 1 - n / (n + 1); s }",
      sprintf("fit_copula <- function(d) { %s; lm(%s ~ %s, data = d) }",
        paste(sprintf("d$PStar.%s <- pstar(d$%s)", p, p), collapse = "; "), y, rhs(x, p, paste0("PStar.", p))),
      "fit <- fit_copula(data)",
      sprintf("set.seed(%d)", seed),
      sprintf("boots <- sapply(seq_len(%d), function(i) coef(fit_copula(data[sample.int(nrow(data), replace = TRUE), , drop = FALSE])))", B),
      "se <- apply(boots, 1, sd)",
      sprintf("ci <- t(apply(boots, 1, stats::quantile, probs = c(%s, %s)))", format((1 - conf) / 2), format(1 - (1 - conf) / 2)),
      "est <- coef(fit); z <- est / se",
      "res <- cbind(Estimate = est, `Std. Error` = se, `z value` = z, `Pr(>|z|)` = 2 * stats::pnorm(-abs(z)))",
      "# The method needs non-normal endogenous regressors (otherwise P* is collinear with P): Shapiro-Wilk tests.",
      sprintf("normality <- sapply(%s, function(v) stats::shapiro.test(utils::head(data[[v]], 5000))$p.value)", ps_q(p)))
  } else if (method == "het") {
    hx <- f$v(req$hetRegressors %||% req$exogenous)
    if (!length(hx)) stop("Choose the exogenous regressors whose heteroskedasticity builds the instruments.")
    if (length(p) != 1) stop("Heteroskedasticity-based instruments need exactly one endogenous regressor.")
    body <- c(body,
      "# Heteroskedasticity-based instruments (Lewbel 2012), as REndo::hetErrorsIV: (X - mean X) times the",
      "# residuals of the endogenous regressor on the exogenous ones; they work only if those residuals are heteroskedastic.",
      sprintf("e <- residuals(lm(%s ~ %s, data = data))", p, rhs(x)),
      sprintf("data$IIV.%s <- (data$%s - mean(data$%s)) * e", hx, hx, hx),
      sprintf("bp <- sapply(%s, function(v) lmtest::bptest(stats::reformulate(v, \"%s\"), studentize = TRUE, data = data)$p.value[[1]])", ps_q(hx), p),
      sprintf("fit <- ivreg(%s ~ %s | %s, data = data)", y, rhs(x, p), rhs(x, paste0("IIV.", hx))),
      "res <- summary(fit, diagnostics = TRUE)",
      sprintf("ci <- confint(fit, level = %s)", format(conf)))
  } else if (method == "hm") {
    if (length(p) != 1) stop("Higher-moment instruments need exactly one endogenous regressor.")
    types <- unlist(req$hmTypes)
    if (!length(types) || !all(types %in% c("g", "gp", "gy", "yp", "p2", "y2"))) stop("Choose the internal instruments.")
    hx <- f$v(req$hetRegressors %||% req$exogenous)
    if (any(types %in% c("g", "gp", "gy")) && !length(hx)) stop("These instruments need exogenous regressors.")
    dm <- function(e) sprintf("(%s - mean(%s))", e, e)
    lines <- unlist(lapply(types, function(t) switch(t,
      g = sprintf("data$IIV.isg.gisx2.regis%s <- %s", hx, dm(sprintf("data$%s^2", hx))),
      gp = sprintf("data$IIV.isgp.gisx2.regis%s <- %s * %s", hx, dm(sprintf("data$%s^2", hx)), dm(sprintf("data$%s", p))),
      gy = sprintf("data$IIV.isgy.gisx2.regis%s <- %s * %s", hx, dm(sprintf("data$%s^2", hx)), dm(sprintf("data$%s", y))),
      yp = sprintf("data$IIV.isyp <- %s * %s", dm(sprintf("data$%s", y)), dm(sprintf("data$%s", p))),
      p2 = sprintf("data$IIV.isp2 <- %s^2", dm(sprintf("data$%s", p))),
      y2 = sprintf("data$IIV.isy2 <- %s^2", dm(sprintf("data$%s", y))))))
    inst <- sub("^data\\$", "", sub(" <-.*$", "", lines))
    body <- c(body,
      "# Higher-moment instruments (Lewbel 1997), as REndo::higherMomentsIV (g(x) = x^2): products of",
      "# de-meaned variables; they need non-normal, skewed regressors.", lines,
      sprintf("fit <- ivreg(%s ~ %s | %s, data = data)", y, rhs(x, p), rhs(x, inst)),
      "res <- summary(fit, diagnostics = TRUE)",
      sprintf("ci <- confint(fit, level = %s)", format(conf)))
  } else {
    s <- f$v(req$selection$outcome); w <- f$v(req$selection$regressors)
    if (!length(s) || !length(w) || !length(y)) stop("Choose the selection indicator, its regressors and the outcome.")
    hm <- req$heckmanMethod %||% "ml"
    if (!hm %in% c("ml", "2step")) stop("Invalid Heckman estimation method in the request.")
    pkgs <- "sampleSelection"
    body <- c("suppressPackageStartupMessages(library(sampleSelection))",
      "# Rows with a missing outcome are kept: they are the unselected cases (the outcome is not observed).",
      sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(s, w))),
      sprintf("data$%s <- as.integer(data$%s != 0)", s, s),
      "# Heckman selection model: a probit for being selected, and the outcome equation corrected for selection.",
      sprintf("fit <- selection(%s ~ %s, %s ~ %s, data = data, method = \"%s\")", s, rhs(w), y, rhs(x), hm),
      "res <- summary(fit)$estimate",
      sprintf("ci <- confint(fit, level = %s)", format(conf)))
  }
  inputs <- list(data = f$fr$data)
  title <- c(iv = "Instrumental variables (ivreg)", copula = "Gaussian copula correction", het = "Heteroskedasticity-based instruments (Lewbel 2012)",
    hm = "Higher-moment instruments (Lewbel 1997)", heckman = "Heckman selection model (sampleSelection)")[[method]]
  if (export) return(paste(ps_script(title, pkgs, inputs, body,
    c(if (method != "heckman") "summary(ols)", if (method %in% c("copula", "heckman")) "res" else "res", if (method == "copula") "normality")), collapse = "\n"))
  env <- ps_run(body, inputs)
  back <- f$fr$back
  for (q in p) back[[paste0("PStar.", q)]] <- paste0("P* (", f$fr$back[[q]], ")")
  diag <- list()
  if (method %in% c("iv", "het", "hm")) {
    dg <- env$res$diagnostics
    for (i in seq_len(nrow(dg))) diag[[length(diag) + 1]] <- list(test = rownames(dg)[i], df1 = dg[i, 1], df2 = dg[i, 2], stat = dg[i, 3], p = dg[i, 4])
  }
  coefs <- if (method == "heckman") {
    ix <- env$fit$param$index
    eq <- rep("error terms", nrow(env$res)); eq[ix$betaS] <- "selection"; eq[ix$betaO] <- "outcome"
    ps_coef_rows(env$res, back, env$ci, eq)
  } else ps_coef_rows(if (method == "copula") env$res else stats::coef(env$res), back, env$ci)
  ps_json(list(method = method, n = if (method == "heckman") nrow(env$data) else stats::nobs(env$fit),
    coefficients = coefs,
    ols = if (method == "heckman") list() else ps_coef_rows(stats::coef(summary(env$ols)), back, stats::confint(env$ols, level = conf)),
    diagnostics = diag,
    normality = if (method == "copula") lapply(names(env$normality), function(k) list(variable = unname(f$fr$back[k]), p = unname(env$normality[[k]]))) else list(),
    heteroskedasticity = if (method == "het") lapply(names(env$bp), function(k) list(variable = unname(f$fr$back[k]), p = unname(env$bp[[k]]))) else list(),
    selection = if (method == "heckman") list(selected = sum(env$data[[f$v(req$selection$outcome)]] == 1), total = nrow(env$data)) else NULL,
    boot = if (method == "copula") list(samples = B, confidence = conf) else NULL,
    warnings = env$.warnings, engine = list(package = if (method == "heckman") "sampleSelection" else "ivreg",
      version = as.character(utils::packageVersion(if (method == "heckman") "sampleSelection" else "ivreg")))))
}
