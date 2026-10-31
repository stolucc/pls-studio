# Regression: lm and glm (base R), negative binomial and ordinal (MASS),
# multinomial (nnet). Categorical predictors as factors, interaction terms,
# frequency weights, binomial counts with trials, robust (sandwich) or
# cluster-robust standard errors. The script is the package's; this file
# writes it and shapes the output (coefficients, fit, diagnostics, a curve).

ps_regression <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$outcome; preds <- unlist(req$predictors); cats <- unlist(req$categorical)
  family <- req$family %||% "gaussian"
  if (!family %in% c("gaussian", "binomial", "poisson", "negbin", "gamma", "ordinal", "multinomial")) stop("Invalid family in the request.")
  link <- req$link %||% if (family == "ordinal") "logistic" else "logit"
  if (family == "binomial" && !link %in% c("logit", "probit", "cloglog")) stop("Invalid link in the request.")
  if (family == "ordinal" && !link %in% c("logistic", "probit", "cloglog")) stop("Invalid link in the request.")
  trials <- req$trials %||% ""; wcol <- req$weights %||% ""; cluster <- req$cluster %||% ""
  se <- req$se %||% "model"
  if (!se %in% c("model", "HC3", "cluster")) stop("Invalid standard-error choice in the request.")
  if (se == "cluster" && !nzchar(cluster)) stop("Choose the cluster column for cluster-robust standard errors.")
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  ints <- lapply(req$interactions, function(t) as.character(unlist(t)))
  if (!nzchar(y) || (!length(preds) && !length(ints))) stop("Choose the outcome and at least one predictor.")
  for (t in ints) if (length(t) < 2) stop("An interaction term must combine two or more variables.")
  vars <- unique(c(preds, unlist(ints)))  # (a variable may enter through an interaction only: nested effects)
  cols <- unique(c(y, vars, if (nzchar(trials)) trials, if (nzchar(wcol)) wcol, if (nzchar(cluster)) cluster))
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  levels_of <- req$categories %||% list()
  # Factors: text columns (with their category names) and numeric predictors marked categorical.
  fac_lines <- character(0)
  is_fac <- function(n) n %in% cats || !is.null(levels_of[[n]])
  for (n in unique(c(vars, if (family %in% c("ordinal", "multinomial")) y))) {
    l <- levels_of[[n]]
    # (labels for codes 1..k, as R factors arrive; a recoded column may be 0-based or sparse: its sorted values then)
    if (!is.null(l)) fac_lines <- c(fac_lines, sprintf("data$%s <- ps_labelled(data$%s, %s)", v[[n]], v[[n]], ps_q(unlist(l))))
    else if (n %in% cats || (n == y && family %in% c("ordinal", "multinomial"))) fac_lines <- c(fac_lines, sprintf("data$%s <- factor(data$%s%s)", v[[n]], v[[n]], if (n == y && family == "ordinal") ", ordered = TRUE" else ""))
  }
  if (family == "ordinal" && !is.null(levels_of[[y]])) fac_lines <- c(fac_lines, sprintf("data$%s <- factor(data$%s, ordered = TRUE)", v[[y]], v[[y]]))
  term <- function(t) paste(vapply(t, function(n) v[[n]], ""), collapse = ":")
  rhs <- paste(c(vapply(preds, function(n) v[[n]], ""), vapply(ints, term, "")), collapse = " + ")
  preds <- vars
  lhs <- if (family == "binomial" && nzchar(trials)) sprintf("cbind(%s, %s - %s)", v[[y]], v[[trials]], v[[y]]) else v[[y]]
  fml <- sprintf("%s ~ %s", lhs, rhs)
  w <- if (nzchar(wcol)) sprintf(", weights = %s", v[[wcol]]) else ""
  libs <- c(if (family %in% c("negbin", "ordinal")) "MASS", if (family == "multinomial") "nnet", if (se != "model") c("sandwich", "lmtest"))
  call <- switch(family,
    gaussian = sprintf("fit <- lm(%s, data = data%s)", fml, w),
    binomial = sprintf("fit <- glm(%s, family = binomial(link = \"%s\"), data = data%s)", fml, link, w),
    poisson = sprintf("fit <- glm(%s, family = poisson, data = data%s)", fml, w),
    gamma = sprintf("fit <- glm(%s, family = Gamma, data = data%s)", fml, w),
    negbin = sprintf("fit <- glm.nb(%s, data = data%s)", fml, w),
    ordinal = sprintf("fit <- polr(%s, data = data%s, method = \"%s\", Hess = TRUE)", fml, w, link),
    multinomial = sprintf("fit <- multinom(%s, data = data%s, Hess = TRUE, trace = FALSE)", fml, w))
  body <- c(if (length(libs)) sprintf("suppressPackageStartupMessages({ %s })", paste(sprintf("library(%s)", libs), collapse = "; ")),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    if (length(fac_lines)) c("# Categorical variables as factors (the first level is the reference).", fac_lines),
    if (family %in% c("ordinal", "multinomial")) "options(contrasts = c(\"contr.treatment\", \"contr.poly\"))",
    call,
    if (se == "HC3") "# Heteroskedasticity-consistent (HC3) standard errors.\nvc <- vcovHC(fit, type = \"HC3\"); ct <- coeftest(fit, vcov. = vc)",
    if (se == "cluster") sprintf("# Standard errors clustered by %s.\nvc <- vcovCL(fit, cluster = ~%s); ct <- coeftest(fit, vcov. = vc)", ps_comment(cluster), v[[cluster]]))
  inputs <- list(data = fr$data)
  title <- c(gaussian = "Linear regression (lm)", binomial = sprintf("%s regression (glm)", if (link == "probit") "Probit" else "Logistic"), poisson = "Poisson regression (glm)",
    gamma = "Gamma regression (glm)", negbin = "Negative binomial regression (MASS::glm.nb)", ordinal = "Ordinal regression (MASS::polr)", multinomial = "Multinomial logistic regression (nnet::multinom)")[[family]]
  report <- c("summary(fit)", if (family %in% c("binomial", "poisson", "negbin", "ordinal", "multinomial")) "exp(coef(fit))  # odds or rate ratios", if (se != "model") "ct",
    if (family %in% c("gaussian", "binomial", "poisson", "negbin", "gamma")) "anova(fit, test = \"Chisq\")")
  if (export) return(paste(ps_script(title, c("stats", libs), inputs, body, report), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  nm <- function(x) { for (k in names(fr$back)) x <- gsub(paste0("\\b", k, "\\b"), fr$back[[k]], x, perl = TRUE); x }
  z <- qnorm(1 - (1 - conf) / 2)
  ratio <- family %in% c("binomial", "poisson", "negbin", "ordinal", "multinomial") && link %in% c("logit", "logistic")
  coefs <- list(); thresholds <- list(); levels_out <- NULL
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
    B <- s$coefficients; S <- s$standard.errors
    if (!is.matrix(B)) { B <- matrix(B, 1, dimnames = list(fit$lev[2], names(B))); S <- matrix(S, 1, dimnames = list(fit$lev[2], names(S))) }
    levels_out <- list(reference = fit$lev[1], others = rownames(B))
    for (r in rownames(B)) for (j in colnames(B)) {
      st <- B[r, j] / S[r, j]
      coefs[[length(coefs) + 1]] <- list(level = r, term = nm(j), est = B[r, j], se = S[r, j], stat = st, p = 2 * pnorm(-abs(st)), ciLow = B[r, j] - z * S[r, j], ciHigh = B[r, j] + z * S[r, j], ratio = if (j != "(Intercept)") exp(B[r, j]) else NULL)
    }
  } else {
    ct <- if (se == "model") lmtest_free(fit) else env$ct
    tdist <- family == "gaussian" && se == "model"
    q <- if (tdist) qt(1 - (1 - conf) / 2, df.residual(fit)) else z
    for (i in seq_len(nrow(ct))) coefs[[length(coefs) + 1]] <- list(term = nm(rownames(ct)[i]), est = ct[i, 1], se = ct[i, 2], stat = ct[i, 3], p = ct[i, 4],
      ciLow = ct[i, 1] - q * ct[i, 2], ciHigh = ct[i, 1] + q * ct[i, 2], ratio = if (ratio && rownames(ct)[i] != "(Intercept)") exp(ct[i, 1]) else NULL)
  }
  ll <- as.numeric(logLik(fit)); npar <- attr(logLik(fit), "df")
  n <- if (family == "multinomial") nrow(env$data) else if (family == "binomial" && nzchar(trials)) nrow(env$data) else length(residuals(fit))
  # The null model (intercept only) for the likelihood-ratio test and McFadden's pseudo R2.
  null_ll <- ps_try({
    nf <- switch(family,
      gaussian = lm(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]]),
      ordinal = MASS::polr(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]], method = link, Hess = FALSE),
      multinomial = nnet::multinom(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]], trace = FALSE),
      negbin = MASS::glm.nb(as.formula(sprintf("%s ~ 1", v[[y]])), data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]]),
      glm(as.formula(sprintf("%s ~ 1", lhs)), family = fit$family, data = env$data, weights = if (nzchar(wcol)) env$data[[v[[wcol]]]]))
    as.numeric(logLik(nf))
  }, "The intercept-only model (for the likelihood-ratio test)")
  lrt <- if (!is.null(null_ll)) { st <- 2 * (ll - null_ll); df <- npar - (if (family == "ordinal") length(fit$zeta) else if (family == "multinomial") length(fit$lev) - 1 else if (family %in% c("gaussian", "negbin")) 2 else 1)
    list(stat = st, df = df, p = pchisq(st, df, lower.tail = FALSE), pseudoR2 = if (family == "gaussian") NULL else 1 - ll / null_ll) } else NULL
  fitv <- list(n = n, logLik = ll, aic = AIC(fit), bic = BIC(fit), npar = npar,
    r2 = if (family == "gaussian") summary(fit)$r.squared else NULL, adjR2 = if (family == "gaussian") summary(fit)$adj.r.squared else NULL,
    sigma = if (family == "gaussian") summary(fit)$sigma else NULL,
    deviance = if (inherits(fit, "glm")) deviance(fit) else NULL, nullDeviance = if (inherits(fit, "glm")) fit$null.deviance else NULL,
    dfResidual = if (inherits(fit, "glm") || inherits(fit, "lm")) df.residual(fit) else NULL,
    dispersion = if (family %in% c("poisson", "binomial")) deviance(fit) / df.residual(fit) else NULL,
    theta = if (family == "negbin") fit$theta else NULL, thetaSe = if (family == "negbin") fit$SE.theta else NULL)
  # Diagnostics: VIFs from the design matrix (each column on the others), classification for a binary outcome.
  diag <- list()
  X <- ps_try(model.matrix(fit), "The design matrix")
  if (is.matrix(X) && ncol(X) > 2) {
    X <- X[, colnames(X) != "(Intercept)", drop = FALSE]
    vifs <- vapply(seq_len(ncol(X)), function(j) { r2 <- summary(lm(X[, j] ~ X[, -j, drop = FALSE]))$r.squared; if (is.finite(r2) && r2 < 1) 1 / (1 - r2) else NA_real_ }, 0)
    diag$vif <- lapply(seq_len(ncol(X)), function(j) list(term = nm(colnames(X)[j]), vif = vifs[j]))
  }
  if (family == "binomial" && !nzchar(trials)) {
    pr <- fitted(fit); yy <- fit$y
    diag$accuracy <- mean((pr >= 0.5) == (yy == 1))
    r <- rank(pr); n1 <- sum(yy == 1); n0 <- sum(yy == 0)
    diag$auc <- if (n1 > 0 && n0 > 0) (sum(r[yy == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0) else NULL
    # Hosmer-Lemeshow with ten groups of fitted probability.
    g <- cut(pr, unique(quantile(pr, seq(0, 1, 0.1))), include.lowest = TRUE)
    if (nlevels(g) > 2) { o <- tapply(yy, g, sum); e <- tapply(pr, g, sum); k <- tapply(yy, g, length)
      hl <- sum((o - e)^2 / (e * (1 - e / k))); diag$hosmerLemeshow <- list(stat = hl, df = nlevels(g) - 2, p = pchisq(hl, nlevels(g) - 2, lower.tail = FALSE)) }
  }
  # A curve: the response over the first numeric predictor, the others at their means or reference levels.
  curve <- NULL
  xnum <- Filter(function(n) !is_fac(n), preds)
  if (length(xnum)) {
    xn <- xnum[1]; xv <- v[[xn]]; d <- env$data
    grid <- seq(min(d[[xv]]), max(d[[xv]]), length.out = 50)
    nd <- d[rep(1, 50), , drop = FALSE]
    for (n in preds) { cv <- v[[n]]; nd[[cv]] <- if (is.factor(d[[cv]])) factor(rep(levels(d[[cv]])[1], 50), levels = levels(d[[cv]])) else rep(mean(d[[cv]]), 50) }
    nd[[xv]] <- grid
    pred <- ps_try({
      if (family == "multinomial") { p <- predict(fit, nd, type = "probs"); if (!is.matrix(p)) p <- cbind(1 - p, p, deparse.level = 0); list(levels = fit$lev, probs = lapply(seq_len(ncol(p)), function(j) unname(p[, j]))) }
      else if (family == "ordinal") { p <- predict(fit, nd, type = "probs"); list(levels = levels(d[[v[[y]]]]), probs = lapply(seq_len(ncol(p)), function(j) unname(p[, j]))) }
      else list(y = unname(predict(fit, nd, type = "response")))
    }, "The fitted curve")
    if (!is.null(pred)) curve <- c(list(x = xn, grid = grid), pred,
      if (!family %in% c("ordinal", "multinomial", "binomial") || !nzchar(trials)) list(points = list(x = unname(d[[xv]]), y = unname(if (family == "binomial" && nzchar(trials)) d[[v[[y]]]] / d[[v[[trials]]]] else if (family %in% c("ordinal", "multinomial")) as.numeric(d[[v[[y]]]]) else d[[v[[y]]]]))))
  }
  ps_json(list(family = family, link = link, formula = nm(fml), se = se, coefficients = coefs, thresholds = thresholds, levels = levels_out, fit = fitv, lrt = lrt, diagnostics = diag, curve = curve,
    warnings = env$.warnings, engine = list(package = if (family %in% c("negbin", "ordinal")) "MASS" else if (family == "multinomial") "nnet" else "stats",
      version = as.character(if (family %in% c("negbin", "ordinal")) utils::packageVersion("MASS") else if (family == "multinomial") utils::packageVersion("nnet") else getRversion()))))
}

#' The coefficient table of an lm / glm with the model's own standard errors (as coeftest would print it).
lmtest_free <- function(fit) {
  s <- summary(fit)$coefficients
  s[, 1:4, drop = FALSE]
}

#' A coded column as a factor with its labels: codes 1..k, or, when the values are not those (a
#' recoded 0-based column), the sorted distinct values; without a match, the values as they are.
ps_labelled <- function(x, labels) {
  k <- length(labels)
  if (all(x[!is.na(x)] %in% seq_len(k))) return(factor(x, levels = seq_len(k), labels = labels))
  u <- sort(unique(x[!is.na(x)]))
  if (length(u) == k) factor(x, levels = u, labels = labels) else factor(x)
}
