# Mixed (multilevel) models: linear mixed models with random intercepts and
# slopes for observed variables (lme4, Bates et al. 2015; Satterthwaite
# degrees of freedom by lmerTest, Kuznetsova et al. 2017), and growth mixture
# models (latent class linear mixed models, lcmm::hlme; Proust-Lima et al. 2017).

#' Linear mixed model: outcome on predictors, clustered, with random intercepts
#' and optional random slopes; within / between decomposition on request.
ps_lmm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$outcome; xs <- unlist(req$predictors); cl <- req$cluster; slopes <- unlist(req$slopes)
  if (!length(y) || !length(cl)) stop("Choose an outcome and a cluster column.")
  if (y %in% c(xs, cl) || cl %in% xs) stop("The outcome, predictors and cluster column must be different columns.")
  if (!all(slopes %in% xs)) stop("Random slopes need predictors in the model.")
  center <- req$center %||% "none"
  if (!center %in% c("none", "grand", "cluster")) stop("Invalid centring in the request.")
  reml <- !identical(req$estimation, "ML")
  fr <- ps_long_frame(req, c(y, xs, cl))
  v <- fr$v; Y <- v[[y]]; C <- v[[cl]]; X <- unname(v[xs]); S <- unname(v[slopes])
  # Cluster means of the predictors (between effects), named <x>_cm.
  cm <- if (center == "cluster" && length(X)) ps_ident(c(unname(v), paste0(X, "_cm")))[length(v) + seq_along(X)] else character(0)
  fixed <- c(X, cm)
  rhs <- if (length(fixed)) paste(fixed, collapse = " + ") else "1"
  ran <- sprintf("(%s | %s)", if (length(S)) paste(c("1", S), collapse = " + ") else "1", C)
  f_full <- sprintf("%s ~ %s + %s", Y, rhs, ran)
  body <- c("suppressPackageStartupMessages(library(lmerTest))  # lme4 with Satterthwaite degrees of freedom",
    "# Cases complete on the model's variables.",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(Y, X, C))),
    if (center == "grand" && length(X)) c("# Predictors centred at their grand mean.",
      sprintf("data$%s <- data$%s - mean(data$%s)", X, X, X)),
    if (center == "cluster" && length(X)) c("# Within / between: each predictor split into its cluster mean (between) and the deviation from it (within).",
      sprintf("data$%s <- ave(data$%s, data$%s)", cm, X, C), sprintf("data$%s <- data$%s - data$%s", X, X, cm)),
    "# Intraclass correlation from the model without predictors.",
    sprintf("null <- lmer(%s ~ 1 + (1 | %s), data = data, REML = %s)", Y, C, reml),
    "vc0 <- as.data.frame(VarCorr(null)); icc <- vc0$vcov[1] / sum(vc0$vcov)",
    sprintf("fit <- lmer(%s, data = data, REML = %s)", f_full, reml),
    "coefs <- summary(fit)$coefficients  # estimate, SE, df (Satterthwaite), t, p",
    "ci <- confint(fit, parm = \"beta_\", method = \"Wald\")",
    if (length(S)) c("# Do the random slopes improve the model? (Variances on the boundary: conservative test.)",
      sprintf("fit_ri <- lmer(%s ~ %s + (1 | %s), data = data, REML = %s)", Y, rhs, C, reml),
      "slope_test <- anova(fit_ri, fit, refit = FALSE)"),
    "# R-squared (Nakagawa & Schielzeth 2013; random slopes: Johnson 2014): fixed effects (marginal), fixed + random (conditional).",
    "vf <- var(as.vector(model.matrix(fit) %*% fixef(fit)))",
    sprintf("Zr <- model.matrix(~ %s, data = data); Sg <- VarCorr(fit)[[1]]", if (length(S)) paste(S, collapse = " + ") else "1"),
    "vr <- mean(rowSums((Zr %*% Sg) * Zr)); ve <- sigma(fit)^2",
    "r2 <- c(marginal = vf / (vf + vr + ve), conditional = (vf + vr) / (vf + vr + ve))")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Multilevel regression (lme4%s)", if (length(S)) ", random slopes" else ""), c("lme4", "lmerTest"), inputs, body,
    c("summary(fit)", "icc", "r2", if (length(S)) "slope_test")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  nm <- function(x) {
    out <- ifelse(x %in% names(fr$back), fr$back[x], x)
    at <- match(x, cm); out[!is.na(at)] <- paste0(xs[at[!is.na(at)]], " (cluster mean)")
    unname(ifelse(x == "(Intercept)", "Intercept", out))
  }
  co <- env$coefs; ci <- env$ci
  vc <- as.data.frame(lme4::VarCorr(fit))
  focal <- if (length(S)) S[1] else if (length(X)) X[1] else NULL
  cc <- stats::coef(fit)[[1]]
  st <- env$slope_test
  ps_json(list(n = nrow(env$data), clusters = length(unique(env$data[[C]])), reml = reml, icc = env$icc,
    fixed = lapply(seq_len(nrow(co)), function(i) list(term = nm(rownames(co)[i]), est = co[i, 1], se = co[i, 2], df = co[i, 3], t = co[i, 4], p = co[i, 5],
      ciLow = ci[rownames(co)[i], 1], ciHigh = ci[rownames(co)[i], 2])),
    random = lapply(seq_len(nrow(vc)), function(i) list(group = if (vc$grp[i] == "Residual") "Residual" else nm(vc$grp[i]),
      a = if (is.na(vc$var1[i])) NULL else nm(vc$var1[i]), b = if (is.na(vc$var2[i])) NULL else nm(vc$var2[i]), variance = vc$vcov[i], sd = vc$sdcor[i])),
    r2 = as.list(env$r2), logLik = as.numeric(stats::logLik(fit)), aic = stats::AIC(fit), bic = stats::BIC(fit), singular = lme4::isSingular(fit),
    slopeTest = if (is.null(st)) NULL else list(chisq = st$Chisq[2], df = st$Df[2], p = st$`Pr(>Chisq)`[2]),
    # Cluster-specific lines of the focal predictor (other predictors at 0), for the chart.
    lines = if (is.null(focal)) NULL else list(predictor = nm(focal), range = range(env$data[[focal]]),
      intercepts = unname(cc[, "(Intercept)"]), slopes = unname(cc[, focal]),
      fixed = c(unname(lme4::fixef(fit)["(Intercept)"]), unname(lme4::fixef(fit)[focal]))),
    warnings = env$.warnings, engine = list(package = "lme4", version = as.character(utils::packageVersion("lme4")))))
}

#' Growth mixture model (latent class linear mixed model, lcmm::hlme) for 1..K
#' classes, from wide (one column per occasion) or long data (subject, time, outcome).
ps_gmm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  long <- identical(req$format, "long")
  covs <- unlist(req$covariates)
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic")) stop("Invalid trajectory shape in the request.")
  random <- req$random %||% "intercept"
  if (!random %in% c("none", "intercept", "slope")) stop("Invalid random effects in the request.")
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 6)) stop("Choose between 1 and 6 classes.")
  if (!1L %in% ks) ks <- sort(unique(c(1L, ks)))  # the one-class model starts the others
  nrep <- as.integer(req$nrep %||% 20); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of random starts.")
  if (long) {
    if (!length(req$subject) || !length(req$time) || !length(req$outcome)) stop("Long data need a subject, a time and an outcome column.")
    fr <- ps_long_frame(req, c(req$subject, req$time, req$outcome, covs))
    prep <- c(sprintf("long <- data.frame(id = data$%s, time = data$%s, y = data$%s%s)", fr$v[[req$subject]], fr$v[[req$time]], fr$v[[req$outcome]],
      if (length(covs)) paste0(", ", paste(sprintf("%s = data$%s", fr$v[covs], fr$v[covs]), collapse = ", ")) else ""))
  } else {
    measures <- unlist(req$measures); times <- as.numeric(unlist(req$times))
    if (length(measures) < 3) stop("A growth mixture model needs at least three occasions.")
    if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per occasion.")
    fr <- ps_long_frame(req, c(measures, covs))
    m <- unname(fr$v[measures])
    prep <- c("# Wide to long: one row per person and occasion.",
      sprintf("long <- data.frame(id = rep(seq_len(nrow(data)), times = %d), time = rep(%s, each = nrow(data)),", length(m), paste(deparse(times), collapse = "")),
      sprintf("  y = unlist(data[, %s], use.names = FALSE)%s)", ps_q(m),
        if (length(covs)) paste0(", ", paste(sprintf("%s = rep(data$%s, times = %d)", fr$v[covs], fr$v[covs], length(m)), collapse = ", ")) else ""))
  }
  cv <- unname(fr$v[covs])
  traj <- if (shape == "quadratic") "time + I(time^2)" else "time"
  fixed <- sprintf("y ~ %s%s", traj, if (length(cv)) paste0(" + ", paste(cv, collapse = " + ")) else "")
  ran <- switch(random, none = "~ -1", intercept = "~ 1", slope = "~ time")
  call <- function(k) sprintf("hlme(%s,%s random = %s, subject = \"id\", ng = %d, data = long)", fixed,
    if (k > 1) sprintf(" mixture = ~ %s,", traj) else "", ran, k)
  body <- c("suppressPackageStartupMessages(library(lcmm))", prep,
    "long <- long[complete.cases(long), ]",
    "# Enough persons for classes (the id must identify persons). Two rows of one person at the same",
    "# time are allowed (e.g. times in whole weeks) but often mean the id column is not the person.",
    # (The column name is written as an escaped R string literal.)
    sprintf("if (anyDuplicated(long[, c(\"id\", \"time\")])) warning(%s)", encodeString(ps_comment(if (long) sprintf(
      "Some persons have two rows at the same time. If that is not expected, the person column %s may not identify persons.", req$subject)
      else "Two occasions have the same time score."), quote = '"')),
    "if (length(unique(long$id)) < 10) stop(sprintf(\"Only %d persons: a growth mixture model needs many persons (the person column must identify them).\", length(unique(long$id))))",
    "fits <- list()",
    sprintf("fits[[\"1\"]] <- %s", call(1)),
    if (any(ks > 1)) c(sprintf("# More classes: %d random starts from the one-class solution (lcmm::gridsearch), the best kept.", nrep),
      sprintf("set.seed(%d)", seed),
      vapply(ks[ks > 1], function(k) sprintf("fits[[\"%d\"]] <- gridsearch(rep = %d, maxiter = 30, minit = fits[[\"1\"]], %s)", k, nrep, call(k)), "")),
    "# Classification quality: relative entropy (1 = perfectly separated classes).",
    "entropy <- function(m) { k <- m$ng; if (k == 1) return(NA); p <- as.matrix(m$pprob[, paste0(\"prob\", 1:k)]); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }",
    "# Sample-size adjusted BIC (Sclove 1987).",
    "sabic <- function(m) -2 * m$loglik + length(m$best) * log((m$ns + 2) / 24)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Growth mixture model (lcmm::hlme)", "lcmm", inputs, body,
    c("summarytable(fits[[1]], fits[-1], which = c(\"G\", \"loglik\", \"npm\", \"BIC\", \"SABIC\", \"entropy\", \"%class\"))", "lapply(fits, summary)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  grid <- seq(min(env$long$time), max(env$long$time), length.out = 41)
  nd <- data.frame(time = grid)
  for (c in cv) nd[[c]] <- mean(env$long[[c]])
  obs_times <- sort(unique(env$long$time))
  # Covariate names back, as whole words only (a covariate "x" must not change "max").
  back <- function(x) { for (c in cv) x <- gsub(paste0("(?<![A-Za-z0-9._])\\Q", c, "\\E(?![A-Za-z0-9._])"), fr$back[[c]], x, perl = TRUE); x }
  models <- lapply(as.character(ks), function(k) {
    m <- env$fits[[k]]; g <- m$ng
    cls <- m$pprob$class
    pr <- lcmm::predictY(m, newdata = nd, var.time = "time")$pred
    se <- tryCatch(sqrt(diag(lcmm::VarCov(m))), error = function(e) rep(NA_real_, length(m$best)))
    est <- m$best; z <- est / se[seq_along(est)]
    # The first ng - 1 parameters are class membership (multinomial logit, last class the reference); lcmm names them like trajectory intercepts.
    pn <- names(est); if (g > 1) pn[seq_len(g - 1)] <- sprintf("membership: class %d vs %d", seq_len(g - 1), g)
    # Observed means per occasion of the people in each class (modal class), when occasions are few.
    obs <- if (length(obs_times) <= 20) lapply(seq_len(g), function(c) {
      ids <- m$pprob$id[cls == c]; d <- env$long[env$long$id %in% ids, ]
      unname(vapply(obs_times, function(t) { x <- d$y[d$time == t]; if (length(x)) mean(x) else NA_real_ }, 0))
    }) else NULL
    list(k = g, logLik = m$loglik, npar = length(m$best), aic = m$AIC, bic = m$BIC, sabic = env$sabic(m), entropy = env$entropy(m),
      converged = m$conv == 1, shares = unname(vapply(seq_len(g), function(c) mean(cls == c), 0)),
      params = lapply(seq_along(est), function(i) list(name = back(pn[i]), est = unname(est[i]), se = unname(se[i]),
        p = if (is.finite(z[i])) 2 * stats::pnorm(-abs(unname(z[i]))) else NULL)),
      trajectories = lapply(seq_len(g), function(c) unname(pr[, if (g == 1) 1 else paste0("Ypred_class", c)])), observed = obs)
  })
  ps_json(list(n = length(unique(env$long$id)), observations = nrow(env$long), times = grid, observedTimes = obs_times, models = models,
    warnings = env$.warnings, engine = list(package = "lcmm", version = as.character(utils::packageVersion("lcmm")))))
}
