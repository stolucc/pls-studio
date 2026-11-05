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
    se <- ps_try(sqrt(diag(lcmm::VarCov(m))), sprintf("Standard errors of the %d-class model (lcmm::VarCov)", g), otherwise = rep(NA_real_, length(m$best)))
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

# Growth mixture model of wide data with a residual variance per occasion (Mplus's default for
# TYPE = MIXTURE: i s | y1@0 y2@1 ...; i s ON x; c ON w), a likelihood written out in base R:
# within class c, y | x ~ N(L (a_c + G x), L Psi L' + diag(theta)); P(c | w) multinomial logit.
# The growth factor means differ across classes; G, Psi and theta are equal across classes.
PS_GMM_WIDE_FUNCTIONS <- c(
  "gmm_wide_fit <- function(Y, times, X, W, k, shape, random, nrep) {",
  "  Y <- as.matrix(Y); X <- as.matrix(X); W <- as.matrix(W); n <- nrow(Y); nt <- ncol(Y); q <- ncol(X); r <- ncol(W)",
  "  L <- cbind(1, times, if (shape == \"quadratic\") times^2); f <- ncol(L)",
  "  nr <- switch(random, none = 0, intercept = 1, slope = f)  # growth factors that vary within class",
  "  nv <- nr * (nr + 1) / 2",
  "  # Natural parameters: class means a (f x k), G (f x q), Psi (lower triangle), theta, membership logits (k - 1 x (1 + r)).",
  "  unpack <- function(th) {",
  "    o <- 0; take <- function(m) { v <- th[o + seq_len(m)]; o <<- o + m; v }",
  "    a <- matrix(take(f * k), f); G <- matrix(take(f * q), f); P <- matrix(0, f, f)",
  "    if (nr) { Pr <- matrix(0, nr, nr); Pr[lower.tri(Pr, diag = TRUE)] <- take(nv); Pr <- Pr + t(Pr) - diag(diag(Pr), nr); P[seq_len(nr), seq_len(nr)] <- Pr }",
  "    theta <- take(nt); B <- rbind(matrix(take((k - 1) * (1 + r)), k - 1, 1 + r), 0)",
  "    list(a = a, G = G, Psi = P, theta = theta, B = B)",
  "  }",
  "  loglik <- function(th, post = FALSE) {",
  "    p <- unpack(th); if (any(p$theta <= 0)) return(-Inf)",
  "    S <- L %*% p$Psi %*% t(L) + diag(p$theta, nt); R <- tryCatch(chol(S), error = function(e) NULL); if (is.null(R)) return(-Inf)",
  "    if (nr && any(eigen(p$Psi[seq_len(nr), seq_len(nr), drop = FALSE], symmetric = TRUE, only.values = TRUE)$values < -1e-10)) return(-Inf)",
  "    lw <- cbind(1, W) %*% t(p$B); lw <- lw - apply(lw, 1, max); lw <- lw - log(rowSums(exp(lw)))",
  "    XG <- X %*% t(p$G)",
  "    lp <- vapply(seq_len(k), function(c) { mu <- sweep(XG, 2, p$a[, c], `+`) %*% t(L)",
  "      z <- backsolve(R, t(Y - mu), transpose = TRUE); -0.5 * colSums(z^2) - sum(log(diag(R))) - 0.5 * nt * log(2 * pi) }, numeric(n))",
  "    lp <- matrix(lp, n) + lw; m <- apply(lp, 1, max); lse <- m + log(rowSums(exp(lp - m)))",
  "    if (post) exp(lp - lse) else sum(lse)",
  "  }",
  "  # Optimised on a scale without bounds: log residual variances, the covariance matrix by its Cholesky factor.",
  "  nat <- function(u) { o <- f * k + f * q; th <- u",
  "    if (nr) { C <- matrix(0, nr, nr); C[lower.tri(C, diag = TRUE)] <- u[o + seq_len(nv)]; diag(C) <- exp(diag(C)); Pr <- C %*% t(C); th[o + seq_len(nv)] <- Pr[lower.tri(Pr, diag = TRUE)] }",
  "    o <- o + nv; th[o + seq_len(nt)] <- exp(u[o + seq_len(nt)]); th }",
  "  fn <- function(u) { v <- -loglik(nat(u)); if (is.finite(v)) v else 1e300 }",
  "  # Starts: each person's least-squares growth factors, regressed on the covariates; their residuals clustered.",
  "  bi <- t(solve(crossprod(L), t(L) %*% t(Y))); X1 <- cbind(1, X); cf <- qr.solve(X1, bi); res <- bi - X1 %*% cf",
  "  th0 <- log(pmax(colMeans((Y - bi %*% t(L))^2), 1e-3 * stats::var(as.vector(Y))) + 0.1 * stats::var(as.vector(Y)) / nt)",
  "  ch0 <- if (nr) { C <- t(chol(stats::cov(res[, seq_len(nr), drop = FALSE]) * 0.5 + diag(1e-3, nr))); diag(C) <- log(diag(C)); C[lower.tri(C, diag = TRUE)] } else NULL",
  "  best <- NULL",
  "  for (s in seq_len(if (k == 1) 1 else nrep)) {",
  "    cl <- if (k == 1) rep(1L, n) else stats::kmeans(res, k, nstart = 1, iter.max = 50)$cluster",
  "    a0 <- vapply(seq_len(k), function(c) cf[1, ] + colMeans(res[cl == c, , drop = FALSE]), numeric(f))",
  "    u0 <- c(a0, t(cf[-1, , drop = FALSE]), ch0, th0, if (k > 1) stats::rnorm((k - 1) * (1 + r), 0, 0.3))",
  "    o <- tryCatch(stats::optim(u0, fn, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-12)), error = function(e) NULL)",
  "    if (!is.null(o) && o$value < 1e300 && (is.null(best) || o$value < best$value)) best <- o",
  "  }",
  "  if (is.null(best)) stop(sprintf(\"No start of the %d-class model converged.\", k))",
  "  # The best start is restarted until the log-likelihood stops improving (BFGS stops early on flat ridges).",
  "  for (i in 1:20) { o <- stats::optim(best$par, fn, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-14)); done <- best$value - o$value < 1e-9; if (o$value < best$value) best <- o; if (done) break }",
  "  est <- nat(best$par)",
  "  # Standard errors from the observed information (numerical Hessian at the maximum).",
  "  se <- tryCatch(sqrt(diag(solve(stats::optimHess(est, function(t) { v <- -loglik(t); if (is.finite(v)) v else 1e300 })))), error = function(e) rep(NA_real_, length(est)), warning = function(w) rep(NA_real_, length(est)))",
  "  list(ll = -best$value, npar = length(est), est = est, se = se, p = unpack(est), post = loglik(est, post = TRUE), converged = best$convergence == 0, f = f, nr = nr)",
  "}")

ps_gmm_wide <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  covs <- unlist(req$covariates); memb <- unlist(req$membership)
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic")) stop("Invalid trajectory shape in the request.")
  random <- req$random %||% "slope"
  if (!random %in% c("none", "intercept", "slope")) stop("Invalid random effects in the request.")
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 6)) stop("Choose between 1 and 6 classes.")
  nrep <- as.integer(req$nrep %||% 20); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of random starts.")
  measures <- unlist(req$measures); times <- as.numeric(unlist(req$times))
  if (length(measures) < 3) stop("A growth mixture model needs at least three occasions.")
  if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per occasion.")
  fr <- ps_long_frame(req, unique(c(measures, covs, memb)))
  m <- unname(fr$v[measures]); cv <- unname(fr$v[covs]); wv <- unname(fr$v[memb])
  body <- c(PS_GMM_WIDE_FUNCTIONS,
    sprintf("d <- data[complete.cases(data[, %s]), , drop = FALSE]  # persons with every occasion and covariate", ps_q(unique(c(m, cv, wv)))),
    sprintf("Y <- d[, %s]; X <- d[, %s, drop = FALSE]; W <- d[, %s, drop = FALSE]", ps_q(m), if (length(cv)) ps_q(cv) else "integer(0)", if (length(wv)) ps_q(wv) else "integer(0)"),
    sprintf("times <- %s", paste(deparse(times), collapse = "")),
    sprintf("# %s classes; %d random starts each (k-means of the persons' growth factors), the best kept.", paste(ks, collapse = ", "), nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); gmm_wide_fit(Y, times, X, W, k, \"%s\", \"%s\", %d) })", paste(deparse(ks), collapse = ""), seed, shape, random, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Growth mixture model, a residual variance per occasion", character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = ncol(m$post), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(Y)), entropy = env_entropy <- entropy(m)))",
      "lapply(fits, `[[`, \"p\")")), collapse = "\n"))
  env <- ps_run(body, inputs)
  n <- nrow(env$Y); nt <- length(m)
  fac <- c("intercept", "slope", "quadratic")
  grid <- seq(min(times), max(times), length.out = 41)
  xbar <- if (length(cv)) colMeans(as.matrix(env$X)) else numeric(0)
  models <- lapply(env$fits, function(fit) {
    p <- fit$p; k <- ncol(fit$post); f <- fit$f; nr <- fit$nr
    shares <- colMeans(fit$post); ord <- order(-shares); ref <- ord[k]
    # Parameter names in the order of the estimates (unpack), with the classes renumbered by size.
    cls <- match(seq_len(k), ord)
    nm <- c(as.vector(outer(fac[seq_len(f)], seq_len(k), function(a, c) sprintf("class %d: %s mean", cls[c], a))),
      as.vector(outer(fac[seq_len(f)], covs, function(a, x) sprintf("%s ~ %s", a, x))),
      if (nr) { ix <- which(lower.tri(diag(nr), diag = TRUE), arr.ind = TRUE); ifelse(ix[, 1] == ix[, 2], sprintf("variance: %s", fac[ix[, 1]]), sprintf("covariance: %s, %s", fac[ix[, 2]], fac[ix[, 1]])) },
      sprintf("residual variance: %s", measures),
      if (k > 1) as.vector(outer(seq_len(k - 1), c("intercept", memb), function(c, x) sprintf("membership: class %d vs %d: %s", cls[c], cls[k], x))))
    est <- fit$est; se <- fit$se
    keep <- if (k > 1) TRUE else !grepl("^membership", nm)
    # The membership logits against the smallest class (the last): re-expressed when the reference differs.
    B <- p$B; Bs <- sweep(B, 2, B[ref, ], `-`)
    mb <- if (k > 1) lapply(setdiff(ord, ref), function(c) list(name = sprintf("membership: class %d vs %d", cls[c], k), est = unname(Bs[c, ]), terms = c("intercept", memb))) else list()
    params <- lapply(which(keep & !grepl("^membership", nm)), function(i) {
      z <- est[i] / se[i]; list(name = nm[i], est = unname(est[i]), se = if (is.finite(se[i])) unname(se[i]) else NULL, p = if (is.finite(z)) 2 * stats::pnorm(-abs(unname(z))) else NULL) })
    for (b in mb) for (j in seq_along(b$terms)) params[[length(params) + 1]] <- list(name = sprintf("%s: %s", b$name, b$terms[j]), est = b$est[j], se = NULL, p = NULL)
    Lg <- cbind(1, grid, if (f == 3) grid^2)
    cl <- max.col(fit$post, ties.method = "first")
    list(k = k, logLik = fit$ll, npar = fit$npar, aic = -2 * fit$ll + 2 * fit$npar, bic = -2 * fit$ll + fit$npar * log(n), sabic = -2 * fit$ll + fit$npar * log((n + 2) / 24),
      entropy = env$entropy(fit), converged = fit$converged, shares = unname(shares[ord]), params = params,
      trajectories = lapply(ord, function(c) unname(as.vector(Lg %*% (p$a[, c] + if (length(xbar)) p$G %*% xbar else 0)))),
      observed = lapply(ord, function(c) unname(colMeans(as.matrix(env$Y)[cl == c, , drop = FALSE]))))
  })
  ps_json(list(n = n, observations = n * nt, times = grid, observedTimes = times, models = models,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
