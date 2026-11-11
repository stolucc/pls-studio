# Regression: lm and glm (base R), negative binomial and ordinal (MASS),
# multinomial (nnet). Categorical predictors as factors, interaction terms,
# frequency weights, binomial counts with trials, robust (sandwich) or
# cluster-robust standard errors. The script is the package's; this file
# writes it and shapes the output (coefficients, fit, diagnostics, a curve).

ps_regression <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$outcome
  preds <- unlist(req$predictors)
  cats <- unlist(req$categorical)
  family <- req$family %||% "gaussian"
  if (!family %in% c("gaussian", "binomial", "poisson", "negbin", "gamma", "ordinal", "multinomial", "censored", "survival")) {
    stop("Invalid family in the request.")
  }
  link <- req$link %||% if (family == "ordinal") "logistic" else "logit"
  if (family == "binomial" && !link %in% c("logit", "probit", "cloglog")) {
    stop("Invalid link in the request.")
  }
  if (family == "ordinal" && !link %in% c("logistic", "probit", "cloglog")) {
    stop("Invalid link in the request.")
  }
  trials <- req$trials %||% ""
  wcol <- req$weights %||% ""
  cluster <- req$cluster %||% ""
  se <- req$se %||% "model"
  if (!se %in% c("model", "HC0", "HC3", "cluster")) {
    stop("Invalid standard-error choice in the request.")
  }
  if (se == "cluster" && !nzchar(cluster)) {
    stop("Choose the cluster column for cluster-robust standard errors.")
  }
  # Censored (tobit), zero- or censored-inflated, survival (Cox, piecewise exponential), the multinomial reference level.
  censoring <- req$censoring %||% "below"
  if (!identical(censoring, "below") && !identical(censoring, "above")) {
    stop("Invalid censoring in the request.")
  }
  inflated <- isTRUE(req$inflated)
  if (inflated && !family %in% c("poisson", "censored")) {
    stop("Inflation applies to Poisson and censored models.")
  }
  reference <- req$reference %||% "first"
  if (!identical(reference, "first") && !identical(reference, "last")) {
    stop("Invalid reference level in the request.")
  }
  status <- if (family == "survival") req$status %||% "" else ""
  status_censored <- isTRUE(req$statusCensored)
  cuts <- if (family == "survival") {
    vapply(as.list(unlist(req$cuts)), function(x) ps_number(x, "interval cut point"), 0)
  } else {
    numeric(0)
  }
  if (length(cuts) && (any(cuts <= 0) || is.unsorted(cuts, strictly = TRUE) || length(cuts) > 200)) {
    stop("The interval cut points must be positive and increasing (at most 200).")
  }
  if (family == "survival" && !nzchar(status)) {
    stop("Choose the status column: which times are events and which are censored.")
  }
  # A random slope in a one-level linear model (Mplus TYPE = RANDOM: s | y ON x): the residual variance becomes
  # sigma2 + 2 c x + tau x^2 (tau the slope's variance, c its covariance with the residual), by maximum likelihood.
  slope <- req$randomSlope %||% ""
  if (nzchar(slope) && family != "gaussian") {
    stop("A random slope is available for a linear regression.")
  }
  if (nzchar(slope) && !slope %in% unlist(req$predictors)) {
    stop("The random slope must be one of the predictors.")
  }
  if (nzchar(slope) && slope %in% cats) stop("A random slope needs a numeric predictor.")
  # Zero-inflated and hurdle count models (pscl): the count part on the predictors, the zero part (a logit model for a
  # structural zero, or for crossing the hurdle) on the same predictors, an intercept only, or its own predictors.
  zmodel <- req$zeroModel %||% ""
  if (!zmodel %in% c("", "zeroinfl", "hurdle")) stop("Invalid zero model in the request.")
  zmod <- nzchar(zmodel)
  if (zmod && !family %in% c("poisson", "negbin")) {
    stop("Zero-inflated and hurdle models apply to Poisson and negative binomial counts.")
  }
  if (zmod && inflated) {
    stop("Choose either the zero-inflated Poisson written out (Mplus COUNT (i)) or a pscl zero model, not both.")
  }
  zpart <- if (zmod) req$zeroPart %||% "same" else "same"
  if (!zpart %in% c("same", "intercept", "chosen")) stop("Invalid zero part in the request.")
  zpreds <- if (zpart == "chosen") {
    unique(as.character(unlist(req$zeroPredictors)))
  } else {
    character(0)
  }
  if (zpart == "chosen" && !length(zpreds)) stop("Choose the predictors of the zero part.")
  if (y %in% zpreds) stop("The outcome cannot be a predictor.")
  if (zmod && nzchar(wcol)) stop("Weights are not available for zero-inflated and hurdle models.")
  own <- inflated || family %in% c("censored", "survival") || nzchar(slope)
  if (se != "model" && family == "ordinal") {
    stop("Robust standard errors are available for lm and glm models; ordinal models report their own.")
  }
  if (se %in% c("HC3", "cluster") && zmod) {
    stop("For zero-inflated and hurdle models choose model-based or HC0 (sandwich) standard errors.")
  }
  if (se %in% c("HC3", "cluster") && (family == "multinomial" || own)) {
    stop("For multinomial, censored, inflated and survival models choose model-based or HC0 (Mplus MLR) standard errors.")
  }
  if (nzchar(wcol) && (family == "survival" || inflated || nzchar(slope))) {
    stop("Weights are not available for survival, inflated and random-slope models.")
  }
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  # (terms of equal length arrive from JSON as a matrix, one row per term; otherwise as a list)
  ints <- req$interactions
  ints <- if (is.matrix(ints)) lapply(seq_len(nrow(ints)), function(i) as.character(ints[i, ])) else lapply(ints, function(t) as.character(unlist(t)))
  if (!nzchar(y) || (!length(preds) && !length(ints))) {
    stop("Choose the outcome and at least one predictor.")
  }
  for (t in ints) if (length(t) < 2) stop("An interaction term must combine two or more variables.")
  vars <- unique(c(preds, unlist(ints), zpreds)) # (a variable may enter through an interaction or the zero part only)
  cols <- unique(c(y, vars, if (nzchar(trials)) trials, if (nzchar(wcol)) wcol, if (nzchar(cluster)) cluster, if (nzchar(status)) status))
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  levels_of <- req$categories %||% list()
  # Factors: text columns (with their category names) and numeric predictors marked categorical.
  fac_lines <- character(0)
  is_fac <- function(n) n %in% cats || !is.null(levels_of[[n]])
  for (n in unique(c(vars, if (family %in% c("ordinal", "multinomial")) y))) {
    l <- levels_of[[n]]
    # (labels for codes 1..k, as R factors arrive; a recoded column may be 0-based or sparse: its sorted values then)
    if (!is.null(l)) {
      fac_lines <- c(fac_lines, sprintf("data$%s <- ps_labelled(data$%s, %s)", v[[n]], v[[n]], ps_q(unlist(l))))
    } else if (n %in% cats || (n == y && family %in% c("ordinal", "multinomial"))) fac_lines <- c(fac_lines, sprintf("data$%s <- factor(data$%s%s)", v[[n]], v[[n]], if (n == y && family == "ordinal") ", ordered = TRUE" else ""))
  }
  # A text outcome with two categories in a logistic model: a factor, whose second level is the event (glm's convention).
  if (family == "binomial" && !nzchar(trials) && !is.null(levels_of[[y]])) {
    if (length(unlist(levels_of[[y]])) != 2) {
      stop("A logistic model needs a 0/1 outcome, or a text column with exactly two categories.")
    }
    fac_lines <- c(fac_lines, sprintf("data$%s <- ps_labelled(data$%s, %s)", v[[y]], v[[y]], ps_q(unlist(levels_of[[y]]))))
  }
  if (family == "ordinal" && !is.null(levels_of[[y]])) {
    fac_lines <- c(fac_lines, sprintf("data$%s <- factor(data$%s, ordered = TRUE)", v[[y]], v[[y]]))
  }
  # (Mplus's reference category of a nominal outcome is the last)
  if (family == "multinomial" && reference == "last") {
    fac_lines <- c(fac_lines, sprintf("data$%s <- relevel(data$%s, ref = tail(levels(data$%s), 1))  # the last level is the reference", v[[y]], v[[y]], v[[y]]))
  }
  if (nzchar(status)) {
    if (!is.null(levels_of[[status]]) || !all(fr$data[[v[[status]]]] %in% c(0, 1, NA))) {
      stop("The status column must be coded 0/1.")
    }
    if (!is.null(levels_of[[y]])) stop("The survival time must be a numeric column.")
  }
  if (own && !is.null(levels_of[[y]])) {
    stop("The outcome of a censored, inflated or survival model must be numeric.")
  }
  term <- function(t) paste(vapply(t, function(n) v[[n]], ""), collapse = ":")
  rhs <- paste(c(vapply(preds, function(n) v[[n]], ""), vapply(ints, term, "")), collapse = " + ")
  preds <- vars
  lhs <- if (family == "binomial" && nzchar(trials)) {
    sprintf("cbind(%s, %s - %s)", v[[y]], v[[trials]], v[[y]])
  } else {
    v[[y]]
  }
  fml <- sprintf("%s ~ %s", lhs, rhs)
  zfml <- if (zpart == "intercept") {
    sprintf("%s | 1", fml)
  } else if (zpart == "chosen") {
    sprintf("%s | %s", fml, paste(vapply(zpreds, function(n) v[[n]], ""), collapse = " + "))
  } else {
    fml
  }
  w <- if (nzchar(wcol)) sprintf(", weights = %s", v[[wcol]]) else ""
  piecewise <- family == "survival" && length(cuts) > 0
  # (HC0 for the negative binomial and multinomial models, and every model fitted below by survival or by
  # maximum likelihood written out, is computed here rather than by sandwich::vcovHC)
  own_hc0 <- se == "HC0" && (family %in% c("negbin", "multinomial") || own || zmod)
  libs <- c(
    if (family %in% c("negbin", "ordinal")) "MASS", if (family == "multinomial") "nnet", if (family == "survival" || (family == "censored" && !inflated)) "survival",
    if (zmod) "pscl", if (zmod && se == "HC0") "sandwich", if (se != "model" && !zmod && (!own_hc0 || piecewise)) c("sandwich", "lmtest")
  )
  # Durbin-Watson test of the residuals of an unweighted lm (lmtest::dwtest refits without weights).
  durbin <- family == "gaussian" && !own && !nzchar(wcol)
  if (durbin && !"lmtest" %in% libs) libs <- c(libs, "lmtest")
  zdist <- if (family == "negbin") "negbin" else "poisson"
  yv <- v[[y]]
  lim_line <- if (family == "censored") sprintf("lim <- %s(data$%s)  # the censoring point: the %s value (censored from %s)", if (censoring == "below") "min" else "max", yv, if (censoring == "below") "lowest" else "highest", censoring)
  event <- if (nzchar(status)) sprintf("%s == %d", v[[status]], if (status_censored) 0L else 1L)
  call <- if (nzchar(slope)) {
    c(
      ps_ml_source,
      sprintf("X <- model.matrix(~ %s, data); y <- data$%s; x <- data$%s; k <- ncol(X)", rhs, yv, v[[slope]]),
      sprintf("# A random slope of %s: y = X b + u x + e, u and e with variances tau and sigma2 and covariance c, so y | x is", ps_comment(slope)),
      "# normal with mean X b and variance sigma2 + 2 c x + tau x^2 (Mplus TYPE = RANDOM; s | y ON x; s WITH y).",
      "ll <- function(p) dnorm(y, drop(X %*% p[1:k]), sqrt(pmax(p[k + 1] + 2 * p[k + 3] * x + p[k + 2] * x^2, 1e-8)), log = TRUE)",
      sprintf("ols <- lm(%s, data = data)", fml),
      "start <- c(setNames(coef(ols), colnames(X)), \"random:residual\" = summary(ols)$sigma^2, \"random:slope\" = 0.1 * summary(ols)$sigma^2 / var(x), \"random:slope with residual\" = 0)",
      sprintf("fit <- ml_fit(ll, start, robust = %s)", if (se == "HC0") "TRUE" else "FALSE")
    )
  } else if (inflated) {
    c(
      ps_ml_source,
      sprintf("X <- model.matrix(~ %s, data); y <- data$%s; k <- ncol(X)", rhs, yv),
      if (family == "poisson") {
        c(
          "# Zero-inflated Poisson: counts from a Poisson model (log link) and extra zeros, whose probability is a logistic model (the inflation).",
          "ll <- function(p) { lam <- exp(drop(X %*% p[1:k])); pz <- plogis(drop(X %*% p[k + 1:k]))",
          "  ifelse(y == 0, log(pz + (1 - pz) * exp(-lam)), log1p(-pz) + dpois(y, lam, log = TRUE)) }",
          sprintf("start <- c(setNames(coef(glm(%s, family = poisson, data = data)), colnames(X)), setNames(rep(0, k), paste0(\"inflation:\", colnames(X))))", fml)
        )
      } else {
        c(
          lim_line, sprintf("cen <- y %s lim", if (censoring == "below") "<=" else ">="),
          "# Censored-inflated: a censored-normal (tobit) model, and extra values at the censoring point, whose probability is a logistic model (the inflation).",
          "ll <- function(p) { mu <- drop(X %*% p[1:k]); s <- exp(p[k + 1]); pz <- plogis(drop(X %*% p[k + 1 + 1:k]))",
          sprintf("  ifelse(cen, log(pz + (1 - pz) * pnorm((lim - mu) / s, lower.tail = %s)), log1p(-pz) + dnorm(y, mu, s, log = TRUE)) }", if (censoring == "below") "TRUE" else "FALSE"),
          sprintf("ols <- lm(%s, data = data)", fml),
          "start <- c(setNames(coef(ols), colnames(X)), \"log(sigma)\" = log(summary(ols)$sigma), setNames(rep(0, k), paste0(\"inflation:\", colnames(X))))"
        )
      },
      sprintf("fit <- ml_fit(ll, start, robust = %s)", if (se == "HC0") "TRUE" else "FALSE")
    )
  } else if (family == "censored") {
    c(
      lim_line,
      sprintf(
        "fit <- survreg(Surv(%s, %s %s lim%s) ~ %s, data = data, dist = \"gaussian\"%s%s)", yv, yv, if (censoring == "below") ">" else "<", if (censoring == "below") ", type = \"left\"" else "", rhs, w,
        if (se == "HC0") ", robust = TRUE" else ""
      )
    )
  } else if (piecewise) {
    c(
      "# Piecewise-constant baseline hazard (piecewise exponential): each person's time split at the cut points, a Poisson model",
      "# of the events with log exposure as offset; the interval coefficients are the log baseline hazards.",
      sprintf("data$.event <- as.integer(data$%s); data$.id <- seq_len(nrow(data))", event),
      sprintf("long <- survSplit(Surv(%s, .event) ~ ., data = data, cut = c(%s), episode = \".interval\", start = \".start\")", yv, paste(format(cuts, digits = 15, trim = TRUE), collapse = ", ")),
      sprintf("long$.exposure <- long$%s - long$.start; long$.interval <- factor(long$.interval)", yv),
      sprintf("fit <- glm(.event ~ 0 + .interval + %s + offset(log(.exposure)), family = poisson, data = long)", rhs),
      "ll <- as.numeric(logLik(fit)) - sum(long$.event * log(long$.exposure))  # the log-likelihood of the survival times",
      if (se == "HC0") {
        "# Robust (HC0) standard errors, clustered by person (as Mplus MLR).\nvc <- vcovCL(fit, cluster = ~.id, type = \"HC0\", cadjust = FALSE)"
      }
    )
  } else if (zmod) {
    c(
      if (zmodel == "zeroinfl") {
        sprintf("fit <- zeroinfl(%s, data = data, dist = \"%s\")", zfml, zdist)
      } else {
        sprintf("fit <- hurdle(%s, data = data, dist = \"%s\", zero.dist = \"binomial\")", zfml, zdist)
      },
      "# The standard count model (no zero part), for Vuong's test and the predicted zeros.",
      if (family == "negbin") sprintf("std <- glm.nb(%s, data = data)", fml) else sprintf("std <- glm(%s, family = poisson, data = data)", fml),
      if (se == "HC0") "# Robust (HC0) standard errors: the sandwich of the count and zero parts' scores (sandwich::sandwich; theta held at its estimate).\nvc <- sandwich(fit)" else "vc <- vcov(fit)",
      "ct <- cbind(Estimate = coef(fit), \"Std. Error\" = sqrt(diag(vc))); ct <- cbind(ct, \"z value\" = ct[, 1] / ct[, 2], \"Pr(>|z|)\" = 2 * pnorm(-abs(ct[, 1] / ct[, 2])))",
      "# Vuong's non-nested test of this model against the standard one, computed as pscl::vuong does (which prints it only):",
      "# the rows' log-probability differences, raw and with the AIC and BIC corrections; z > 0 favours this model.",
      "vuong_z <- function(m1, m2) {",
      "  p1 <- predprob(m1); p2 <- predprob(m2); j <- cbind(seq_along(m1$y), match(m1$y, colnames(p1)))",
      "  m <- log(p1[j]) - log(p2[j]); ok <- is.finite(log(p1[j])) & is.finite(log(p2[j])) & is.finite(m); n <- sum(ok); k <- length(coef(m1)) - length(coef(m2))",
      "  vapply(c(raw = 0, aic = k / n, bic = k / (2 * n) * log(n)), function(a) sum(m[ok] - a) / (sd(m[ok] - a) * sqrt(n)), 0)",
      "}",
      "vz <- vuong_z(fit, std)",
      "# Zeros: observed, and expected under this model and under the standard one (the sums of the predicted P(y = 0)).",
      "zeros <- c(observed = sum(fit$y == 0), model = sum(predict(fit, type = \"prob\")[, 1]), standard = sum(predprob(std)[, 1]))"
    )
  } else {
    switch(family,
      gaussian = sprintf("fit <- lm(%s, data = data%s)", fml, w),
      binomial = sprintf("fit <- glm(%s, family = binomial(link = \"%s\"), data = data%s)", fml, link, w),
      poisson = sprintf("fit <- glm(%s, family = poisson, data = data%s)", fml, w),
      gamma = sprintf("fit <- glm(%s, family = Gamma, data = data%s)", fml, w),
      negbin = sprintf("fit <- glm.nb(%s, data = data%s)", fml, w),
      ordinal = sprintf("fit <- polr(%s, data = data%s, method = \"%s\", Hess = TRUE)", fml, w, link),
      multinomial = sprintf("fit <- multinom(%s, data = data%s, Hess = TRUE, trace = FALSE)", fml, w),
      survival = sprintf("fit <- coxph(Surv(%s, %s) ~ %s, data = data%s)", yv, event, rhs, if (se == "HC0") ", robust = TRUE" else "")
    )
  }
  hc0 <- if (se == "HC0" && family == "negbin" && !zmod) {
    c(
      ps_ml_source,
      "# HC0 (as Mplus MLR): the sandwich over the coefficients and theta together (theta is estimated too).",
      "X <- model.matrix(fit); k <- ncol(X)",
      "ll <- function(p) dnbinom(fit$y, size = p[k + 1], mu = exp(drop(X %*% p[1:k])), log = TRUE)",
      "vc <- ml_vcov(ll, c(coef(fit), theta = fit$theta), fit$prior.weights, robust = TRUE)",
      "ct <- cbind(coef(fit), sqrt(diag(vc))[1:k]); ct <- cbind(ct, ct[, 1] / ct[, 2], 2 * pnorm(-abs(ct[, 1] / ct[, 2])))"
    )
  } else if (se == "HC0" && family == "multinomial") {
    c(
      "# HC0 (as Mplus MLR): the sandwich of the rows' scores, (indicator - probability) x predictors for each non-reference level.",
      "X <- model.matrix(fit); P <- fitted(fit); if (!is.matrix(P)) P <- cbind(1 - P, P)",
      sprintf("Y <- sapply(fit$lev, function(l) as.numeric(data$%s == l)); wt <- if (is.null(fit$weights)) 1 else as.numeric(fit$weights)", yv),
      "S <- do.call(cbind, lapply(2:ncol(P), function(j) (Y[, j] - P[, j]) * X))",
      "vc <- vcov(fit) %*% crossprod(sqrt(wt) * S) %*% vcov(fit); dimnames(vc) <- dimnames(vcov(fit))"
    )
  }
  body <- c(
    if (length(libs)) sprintf("suppressPackageStartupMessages({ %s })", paste(sprintf("library(%s)", libs), collapse = "; ")),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    if (length(fac_lines)) c("# Categorical variables as factors (the first level is the reference).", fac_lines),
    if (family %in% c("ordinal", "multinomial")) "options(contrasts = c(\"contr.treatment\", \"contr.poly\"))",
    call, hc0,
    if (se == "HC3") "# Heteroskedasticity-consistent (HC3) standard errors.\nvc <- vcovHC(fit, type = \"HC3\"); ct <- coeftest(fit, vcov. = vc)",
    # (HC0: White's sandwich without small-sample correction, the robust ML standard errors of Mplus's MLR)
    if (se == "HC0" && !own_hc0) "# Heteroskedasticity-consistent (HC0, White) standard errors: the maximum-likelihood sandwich, as Mplus MLR.\nvc <- vcovHC(fit, type = \"HC0\"); ct <- coeftest(fit, vcov. = vc)",
    if (se == "cluster") sprintf("# Standard errors clustered by %s.\nvc <- vcovCL(fit, cluster = ~%s); ct <- coeftest(fit, vcov. = vc)", ps_comment(cluster), v[[cluster]]),
    if (durbin) PS_DURBIN_WATSON_LINES
  )
  inputs <- list(data = fr$data)
  title <- if (nzchar(slope)) {
    "Linear regression with a random slope (maximum likelihood, optim)"
  } else if (inflated) {
    sprintf("%s regression (maximum likelihood, optim)", if (family == "poisson") "Zero-inflated Poisson" else "Censored-inflated")
  } else if (zmod) {
    sprintf("%s %s regression (pscl::%s)", if (zmodel == "zeroinfl") "Zero-inflated" else "Hurdle", if (family == "negbin") "negative binomial" else "Poisson", zmodel)
  } else {
    c(
      gaussian = "Linear regression (lm)", binomial = sprintf("%s regression (glm)", if (link == "probit") "Probit" else "Logistic"), poisson = "Poisson regression (glm)",
      gamma = "Gamma regression (glm)", negbin = "Negative binomial regression (MASS::glm.nb)", ordinal = "Ordinal regression (MASS::polr)", multinomial = "Multinomial logistic regression (nnet::multinom)",
      censored = "Censored (tobit) regression (survival::survreg)", survival = if (piecewise) "Piecewise exponential survival model (survival::survSplit, glm)" else "Cox regression (survival::coxph)"
    )[[family]]
  }
  report <- if (inflated || nzchar(slope)) {
    c("cbind(estimate = fit$coefficients, se = sqrt(diag(fit$vcov)))", "fit$logLik")
  } else if (zmod) {
    c("summary(fit)", if (se == "HC0") "ct", "exp(coef(fit))  # rate ratios (count part) and odds ratios (zero part)", "c(logLik = logLik(fit), AIC = AIC(fit), BIC = BIC(fit))", "vuong(fit, std)", "zeros")
  } else {
    c(
      "summary(fit)", if (family %in% c("binomial", "poisson", "negbin", "ordinal", "multinomial", "survival") && !piecewise) "exp(coef(fit))  # odds, rate or hazard ratios", if (se != "model" && !own) "ct",
      if (se == "HC0" && family == "multinomial") "matrix(sqrt(diag(vc)), nrow = nrow(coef(fit)), byrow = TRUE, dimnames = dimnames(coef(fit)))  # HC0 standard errors",
      if (piecewise) c("exp(coef(fit))  # baseline hazards and hazard ratios", "ll", if (se == "HC0") "sqrt(diag(vc))"),
      if (family %in% c("gaussian", "binomial", "poisson", "negbin", "gamma")) "anova(fit, test = \"Chisq\")",
      if (durbin) c("dw", "r1  # lag-1 autocorrelation of the residuals")
    )
  }
  if (export) {
    return(ps_script(title, c("stats", libs), inputs, body, report))
  }
  env <- ps_run(body, inputs)
  fit <- env$fit
  # Term names back to the columns' names: each piece of a term (a:b) starts with one identifier (longest first), the rest is its level.
  keys <- names(fr$back)[order(-nchar(names(fr$back)))]
  nm <- function(x) {
    vapply(x, function(t) {
      paste(vapply(strsplit(t, ":", fixed = TRUE)[[1]], function(piece) {
        k <- keys[startsWith(piece, keys)][1]
        if (is.na(k)) piece else paste0(fr$back[[k]], substring(piece, nchar(k) + 1))
      }, ""), collapse = ":")
    }, "", USE.NAMES = FALSE)
  }
  z <- qnorm(1 - (1 - conf) / 2)
  ratio <- family %in% c("binomial", "poisson", "negbin", "ordinal", "multinomial") && link %in% c("logit", "logistic")
  coefs <- list()
  thresholds <- list()
  levels_out <- NULL
  if (own) {
    # Censored, inflated and survival models: the coefficients by part (the inflation's, the baseline hazards of a
    # piecewise exponential model), the residual variance of a censored outcome (as Mplus prints it), the fit.
    if (inflated || nzchar(slope)) {
      est <- fit$coefficients
      sev <- sqrt(diag(fit$vcov))
    } else {
      est <- coef(fit)
      sev <- sqrt(diag(if (piecewise && se == "HC0") env$vc else vcov(fit)))[names(est)]
    }
    resvar <- NULL
    if (family == "censored") {
      ls <- if (inflated) est[["log(sigma)"]] else log(fit$scale)
      ls_se <- if (inflated) sev[["log(sigma)"]] else sqrt(vcov(fit)["Log(scale)", "Log(scale)"])
      resvar <- list(est = exp(2 * ls), se = 2 * exp(2 * ls) * ls_se) # (the delta method)
      keep <- names(est) != "log(sigma)"
      est <- est[keep]
      sev <- sev[keep]
    }
    br <- c(0, cuts, Inf)
    for (i in seq_along(est)) {
      t <- names(est)[i]
      b <- est[[i]]
      s <- sev[[i]]
      part <- if (startsWith(t, "inflation:")) {
        "inflation"
      } else if (startsWith(t, ".interval")) {
        "baseline"
      } else if (startsWith(t, "random:")) {
        "random"
      } else {
        NULL
      }
      coefs[[length(coefs) + 1]] <- if (identical(part, "baseline")) {
        j <- as.integer(substring(t, 10))
        list(part = part, term = sprintf("[%s, %s)", format(br[j]), format(br[j + 1])), est = exp(b), se = exp(b) * s, stat = b / s, p = 2 * pnorm(-abs(b / s)), ciLow = exp(b - z * s), ciHigh = exp(b + z * s))
      } else if (identical(part, "random")) {
        # (Mplus: y ~~ y, s ~~ s, s WITH y)
        lab <- c("random:residual" = "Residual variance", "random:slope" = sprintf("Variance of the slope of %s", slope), "random:slope with residual" = sprintf("Covariance of the slope of %s and the residual", slope))[[t]]
        list(part = part, term = lab, est = b, se = s, stat = b / s, p = 2 * pnorm(-abs(b / s)), ciLow = b - z * s, ciHigh = b + z * s)
      } else {
        list(
          part = part, term = nm(if (identical(part, "inflation")) substring(t, 11) else t), est = b, se = s, stat = b / s, p = 2 * pnorm(-abs(b / s)),
          ciLow = b - z * s, ciHigh = b + z * s, ratio = if (family == "survival") exp(b) else NULL
        )
      }
    }
    n <- nrow(env$data)
    ll <- if (inflated || nzchar(slope)) {
      fit$logLik
    } else if (piecewise) {
      env$ll
    } else if (family == "survival") {
      fit$loglik[2]
    } else {
      as.numeric(logLik(fit))
    }
    npar <- if (inflated || nzchar(slope)) {
      fit$npar
    } else if (family == "survival") {
      length(coef(fit))
    } else {
      attr(logLik(fit), "df")
    }
    lrt <- if (family == "survival" && !piecewise) {
      st <- 2 * (fit$loglik[2] - fit$loglik[1])
      list(stat = st, df = npar, p = pchisq(st, npar, lower.tail = FALSE))
    } else {
      NULL
    }
    yy <- env$data[[yv]]
    fitv <- list(
      n = n, logLik = ll, aic = -2 * ll + 2 * npar, bic = -2 * ll + npar * log(n), npar = npar,
      events = if (family == "survival") sum(env$data[[v[[status]]]] == (if (status_censored) 0 else 1)) else NULL,
      censored = if (family == "censored") sum(if (censoring == "below") yy <= min(yy) else yy >= max(yy)) else NULL,
      zeros = if (family == "poisson") sum(yy == 0) else NULL,
      residualVariance = resvar$est, residualVarianceSe = resvar$se
    )
    eng <- if (inflated || nzchar(slope)) {
      list(package = "stats", version = as.character(getRversion()))
    } else {
      ps_engine("survival")
    }
    shown <- if (family == "survival") sprintf("Surv(%s, %s) ~ %s%s", yv, event, if (piecewise) "baseline hazard by interval + " else "", rhs) else fml
    return(ps_json(list(
      family = family, link = link, formula = nm(shown), se = se, coefficients = coefs, thresholds = list(), levels = NULL, fit = fitv, lrt = lrt,
      diagnostics = list(), curves = list(), warnings = env$.warnings, engine = eng
    )))
  }
  if (family %in% c("ordinal")) {
    s <- summary(fit)$coefficients
    k <- length(coef(fit))
    for (i in seq_len(nrow(s))) {
      p <- 2 * pnorm(-abs(s[i, 3]))
      row <- list(term = nm(rownames(s)[i]), est = s[i, 1], se = s[i, 2], stat = s[i, 3], p = p, ciLow = s[i, 1] - z * s[i, 2], ciHigh = s[i, 1] + z * s[i, 2], ratio = if (ratio && i <= k) exp(s[i, 1]) else NULL)
      if (i <= k) coefs[[length(coefs) + 1]] <- row else thresholds[[length(thresholds) + 1]] <- row
    }
  } else if (family == "multinomial") {
    s <- summary(fit)
    B <- s$coefficients
    S <- s$standard.errors
    if (!is.matrix(B)) {
      B <- matrix(B, 1, dimnames = list(fit$lev[2], names(B)))
      S <- matrix(S, 1, dimnames = list(fit$lev[2], names(S)))
    }
    if (se == "HC0") {
      S <- matrix(sqrt(diag(env$vc)), nrow = nrow(B), byrow = TRUE, dimnames = dimnames(B))
    }
    levels_out <- list(reference = fit$lev[1], others = rownames(B))
    for (r in rownames(B)) {
      for (j in colnames(B)) {
        st <- B[r, j] / S[r, j]
        coefs[[length(coefs) + 1]] <- list(level = r, term = nm(j), est = B[r, j], se = S[r, j], stat = st, p = 2 * pnorm(-abs(st)), ciLow = B[r, j] - z * S[r, j], ciHigh = B[r, j] + z * S[r, j], ratio = if (j != "(Intercept)") exp(B[r, j]) else NULL)
      }
    }
  } else if (zmod) {
    # The count part (rate ratios) and the zero part (odds ratios: of a structural zero, or of a count above zero for a hurdle).
    ct <- env$ct
    for (i in seq_len(nrow(ct))) {
      t <- rownames(ct)[i]
      zero <- startsWith(t, "zero_")
      t <- sub("^(count|zero)_", "", t)
      coefs[[length(coefs) + 1]] <- list(
        part = if (zero) "zero" else NULL, term = nm(t), est = ct[i, 1], se = ct[i, 2], stat = ct[i, 3], p = ct[i, 4],
        ciLow = ct[i, 1] - z * ct[i, 2], ciHigh = ct[i, 1] + z * ct[i, 2], ratio = if (t != "(Intercept)") exp(ct[i, 1]) else NULL
      )
    }
  } else {
    ct <- if (se == "model") lmtest_free(fit) else env$ct
    # (lm and Gamma estimate a dispersion: summary and coeftest test with t on the residual df; the interval uses the same quantile)
    tdist <- family %in% c("gaussian", "gamma")
    q <- if (tdist) qt(1 - (1 - conf) / 2, df.residual(fit)) else z
    for (i in seq_len(nrow(ct))) {
      coefs[[length(coefs) + 1]] <- list(
        term = nm(rownames(ct)[i]), est = ct[i, 1], se = ct[i, 2], stat = ct[i, 3], p = ct[i, 4],
        ciLow = ct[i, 1] - q * ct[i, 2], ciHigh = ct[i, 1] + q * ct[i, 2], ratio = if (ratio && rownames(ct)[i] != "(Intercept)") exp(ct[i, 1]) else NULL
      )
    }
  }
  ll <- as.numeric(logLik(fit))
  npar <- attr(logLik(fit), "df")
  n <- nrow(env$data)
  # The null model (intercept only) for the likelihood-ratio test and McFadden's pseudo R2.
  null_ll <- if (zmod) {
    NULL
  } else {
    ps_try(
      {
        nf <- switch(family,
          gaussian = lm(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]]),
          ordinal = MASS::polr(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]], method = link, Hess = FALSE),
          multinomial = nnet::multinom(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]], trace = FALSE),
          negbin = MASS::glm.nb(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]]),
          glm(as.formula(sprintf("%s ~ 1", lhs)), family = fit$family, data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]])
        )
        as.numeric(logLik(nf))
      },
      "The intercept-only model (for the likelihood-ratio test)"
    )
  }
  lrt <- if (!is.null(null_ll)) {
    st <- 2 * (ll - null_ll)
    df <- npar - (if (family == "ordinal") length(fit$zeta) else if (family == "multinomial") length(fit$lev) - 1 else if (family %in% c("gaussian", "negbin", "gamma")) 2 else 1) # (lm, glm.nb and Gamma count a dispersion parameter)
    list(stat = st, df = df, p = pchisq(st, df, lower.tail = FALSE), pseudoR2 = if (family == "gaussian") NULL else 1 - ll / null_ll)
  } else {
    NULL
  }
  fitv <- list(
    n = n, logLik = ll, aic = AIC(fit), bic = BIC(fit), npar = npar,
    r2 = if (family == "gaussian") summary(fit)$r.squared else NULL, adjR2 = if (family == "gaussian") summary(fit)$adj.r.squared else NULL,
    sigma = if (family == "gaussian") summary(fit)$sigma else NULL,
    deviance = if (inherits(fit, "glm")) deviance(fit) else NULL, nullDeviance = if (inherits(fit, "glm")) fit$null.deviance else NULL,
    dfResidual = if (inherits(fit, "glm") || inherits(fit, "lm")) df.residual(fit) else NULL,
    dispersion = if (family %in% c("poisson", "binomial") && !zmod) deviance(fit) / df.residual(fit) else NULL,
    theta = if (family == "negbin") unname(fit$theta[1]) else NULL,
    # (pscl: theta's standard error by the delta method from log(theta)'s; none with the sandwich, which holds theta fixed)
    thetaSe = if (family == "negbin") (if (zmod) (if (se == "HC0") NULL else unname(fit$theta[1] * fit$SE.logtheta[1])) else if (se == "HC0") sqrt(env$vc[nrow(env$vc), ncol(env$vc)]) else fit$SE.theta) else NULL,
    zeros = if (zmod) env$zeros[["observed"]] else NULL, zerosPredicted = if (zmod) env$zeros[["model"]] else NULL, zerosStandard = if (zmod) env$zeros[["standard"]] else NULL
  )
  vuong <- if (zmod) {
    lapply(c(raw = "raw", aic = "aic", bic = "bic"), function(k) {
      zz <- env$vz[[k]]
      list(z = zz, p = if (zz > 0) pnorm(zz, lower.tail = FALSE) else pnorm(zz))
    })
  } else {
    NULL
  }
  # Diagnostics: VIFs from the design matrix (each column on the others), classification for a binary outcome.
  diag <- list()
  X <- ps_try(model.matrix(fit), "The design matrix")
  if (is.matrix(X) && ncol(X) > 2) {
    X <- X[, colnames(X) != "(Intercept)", drop = FALSE]
    vifs <- vapply(seq_len(ncol(X)), function(j) {
      r2 <- summary(lm(X[, j] ~ X[, -j, drop = FALSE]))$r.squared
      if (is.finite(r2) && r2 < 1) 1 / (1 - r2) else NA_real_
    }, 0)
    diag$vif <- lapply(seq_len(ncol(X)), function(j) list(term = nm(colnames(X)[j]), vif = vifs[j]))
  }
  if (durbin) {
    diag$durbinWatson <- list(
      stat = unname(env$dw$statistic),
      p = env$dw$p.value,
      exact = isTRUE(env$dw_exact),
      r1 = env$r1
    )
  }
  if (family == "binomial" && !nzchar(trials)) {
    pr <- fitted(fit)
    yy <- fit$y
    diag$accuracy <- mean((pr >= 0.5) == (yy == 1))
    r <- rank(pr)
    n1 <- sum(yy == 1)
    n0 <- sum(yy == 0)
    diag$auc <- if (n1 > 0 && n0 > 0) (sum(r[yy == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0) else NULL
    # Hosmer-Lemeshow with ten groups of fitted probability.
    g <- cut(pr, unique(quantile(pr, seq(0, 1, 0.1))), include.lowest = TRUE)
    if (nlevels(g) > 2) {
      o <- tapply(yy, g, sum)
      e <- tapply(pr, g, sum)
      k <- tapply(yy, g, length)
      hl <- sum((o - e)^2 / (e * (1 - e / k)))
      diag$hosmerLemeshow <- list(stat = hl, df = nlevels(g) - 2, p = pchisq(hl, nlevels(g) - 2, lower.tail = FALSE))
    }
  }
  # Curves, one per numeric predictor: the response over that predictor, the others at their means or
  # reference levels (a partial-effect plot). Observed values: proportions for binomial counts; none for
  # the probability curves of ordinal and multinomial outcomes; at most 5,000 rows, every k-th row beyond.
  xnum <- Filter(function(n) !is_fac(n), preds)
  d <- env$data
  keep <- if (nrow(d) > 5000) seq(1, nrow(d), length.out = 5000) else seq_len(nrow(d))
  yobs <- if (family == "binomial" && nzchar(trials)) {
    d[[v[[y]]]] / d[[v[[trials]]]]
  } else if (family == "binomial" && is.factor(d[[v[[y]]]])) {
    as.numeric(d[[v[[y]]]]) - 1
  } else {
    d[[v[[y]]]]
  }
  curves <- Filter(Negate(is.null), lapply(xnum, function(xn) {
    xv <- v[[xn]]
    grid <- seq(min(d[[xv]]), max(d[[xv]]), length.out = 50)
    nd <- d[rep(1, 50), , drop = FALSE]
    for (n in preds) {
      cv <- v[[n]]
      nd[[cv]] <- if (is.factor(d[[cv]])) {
        factor(rep(levels(d[[cv]])[1], 50), levels = levels(d[[cv]]))
      } else {
        rep(mean(d[[cv]]), 50)
      }
    }
    nd[[xv]] <- grid
    pred <- ps_try(
      {
        if (family == "multinomial") {
          p <- predict(fit, nd, type = "probs")
          if (!is.matrix(p)) p <- cbind(1 - p, p, deparse.level = 0)
          list(levels = fit$lev, probs = lapply(seq_len(ncol(p)), function(j) unname(p[, j])))
        } else if (family == "ordinal") {
          p <- predict(fit, nd, type = "probs")
          list(levels = levels(d[[v[[y]]]]), probs = lapply(seq_len(ncol(p)), function(j) unname(p[, j])))
        } else {
          list(y = unname(predict(fit, nd, type = "response")))
        }
      },
      sprintf("The fitted curve over %s", xn)
    )
    if (is.null(pred)) NULL else c(list(x = xn, grid = grid), pred, if (!family %in% c("ordinal", "multinomial")) list(points = list(x = unname(d[[xv]][keep]), y = unname(yobs[keep]))))
  }))
  ps_json(list(
    family = family, link = link, formula = nm(if (zmod) zfml else fml), se = se, zeroModel = if (zmod) zmodel else NULL, coefficients = coefs, thresholds = thresholds, levels = levels_out, fit = fitv, lrt = lrt, vuong = vuong, diagnostics = diag, curves = curves,
    warnings = env$.warnings, engine = list(
      package = if (zmod) "pscl" else if (family %in% c("negbin", "ordinal")) "MASS" else if (family == "multinomial") "nnet" else "stats",
      version = as.character(if (zmod) utils::packageVersion("pscl") else if (family %in% c("negbin", "ordinal")) utils::packageVersion("MASS") else if (family == "multinomial") utils::packageVersion("nnet") else getRversion())
    )
  ))
}

#' Maximum likelihood written out, as script lines (so the exported script runs on its own): ml_vcov gives the
#' observed-information covariance of the estimates or, robust, the sandwich of the rows' scores (HC0, Mplus's
#' MLR), both from numerical derivatives of ll(p), the rows' log-likelihoods; ml_fit maximises sum(ll) (BFGS).
ps_ml_source <- c(
  "# Maximum likelihood written out: ll(p) gives each row's log-likelihood; standard errors from the observed",
  "# information or, robust, the sandwich of the rows' scores (HC0, as Mplus MLR); numerical derivatives.",
  "ml_scores <- function(ll, p, h = 1e-5) vapply(seq_along(p), function(j) { e <- replace(numeric(length(p)), j, h); (ll(p + e) - ll(p - e)) / (2 * h) }, numeric(length(ll(p))))",
  "ml_vcov <- function(ll, p, w = 1, robust = FALSE) {",
  "  A <- solve(optimHess(p, function(q) -sum(w * ll(q)), function(q) -colSums(w * ml_scores(ll, q))))",
  "  vc <- if (robust) A %*% crossprod(sqrt(w) * ml_scores(ll, p)) %*% A else A",
  "  dimnames(vc) <- list(names(p), names(p)); vc",
  "}",
  "ml_fit <- function(ll, start, robust = FALSE) {",
  "  o <- optim(start, function(p) -sum(ll(p)), function(p) -colSums(ml_scores(ll, p)), method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-15))",
  "  if (o$convergence != 0) warning(\"The maximum-likelihood estimation did not converge.\")",
  "  list(coefficients = o$par, vcov = ml_vcov(ll, o$par, robust = robust), logLik = -o$value, npar = length(o$par))",
  "}"
)

#' Script lines: the Durbin-Watson test of a linear model's residuals, in the rows' order.
PS_DURBIN_WATSON_LINES <- c(
  "# Durbin-Watson test for first-order autocorrelation of the residuals, in the rows' order",
  "# (H1: positive autocorrelation; exact p-value by Pan's algorithm below 100 rows, else the",
  "# normal approximation, as lmtest does), and the lag-1 autocorrelation of the residuals.",
  "# (when Pan's exact p-value falls outside [0, 1], lmtest uses the normal approximation: say so, not warn)",
  "dw_exact <- nrow(data) < 100",
  "dw <- withCallingHandlers(",
  "  dwtest(fit),",
  "  warning = function(w) {",
  "    if (grepl(\"exact p value cannot be computed\", conditionMessage(w))) {",
  "      dw_exact <<- FALSE",
  "      invokeRestart(\"muffleWarning\")",
  "    }",
  "  }",
  ")",
  "e <- residuals(fit)",
  "r1 <- sum(e[-1] * e[-length(e)]) / sum(e^2)"
)

#' The coefficient table of an lm / glm with the model's own standard errors (as coeftest would print it).
lmtest_free <- function(fit) {
  s <- summary(fit)$coefficients
  s[, 1:4, drop = FALSE]
}

#' A coded column as a factor with its labels: codes 1..k, or, when the values are not those (a
#' recoded 0-based column), the sorted distinct values; without a match, the values as they are.
ps_labelled <- function(x, labels) {
  k <- length(labels)
  if (all(x[!is.na(x)] %in% seq_len(k))) {
    return(factor(x, levels = seq_len(k), labels = labels))
  }
  u <- sort(unique(x[!is.na(x)]))
  if (length(u) == k) factor(x, levels = u, labels = labels) else factor(x)
}
