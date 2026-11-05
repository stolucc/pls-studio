# Item-level measurement models: item response theory with ltm (Rizopoulos
# 2006: Rasch, two-parameter logistic, graded response, generalized partial
# credit) and latent class analysis with poLCA (Linzer & Lewis 2011).

ps_items_frame <- function(req) {
  items <- unlist(req$items)
  if (length(items) < 2) stop("Choose at least two items.")
  fr <- ps_long_frame(req, items)
  fr$items <- unname(fr$v[items])
  fr
}

# Robust (sandwich) standard errors for the 2PL and generalized partial credit models, as Mplus's MLR:
# H^-1 B H^-1, with H ltm's Hessian and B the cross-product of each person's score (the gradient of their
# marginal log-likelihood, on the Gauss-Hermite nodes of the fit). A missing response adds nothing.
PS_IRT_ROBUST <- c(
  "irt_robust <- function(fit, X, k) {",
  "  gh <- ltm:::gauher(k); z <- sqrt(2) * gh$x; w <- gh$w / sqrt(pi)",
  "  N <- nrow(X); Q <- length(z); M <- !is.na(X); X[!M] <- 1",
  "  cf <- fit$coefficients",
  "  # per item: the category probabilities at each node (Q x categories) and each person's response (1, 2, ...)",
  "  if (inherits(fit, \"gpcm\")) {",
  "    P <- lapply(cf, function(b) { K <- length(b); s <- outer(z, rep(b[K], K - 1)) + rep(b[-K], each = Q)",
  "      num <- cbind(0, t(apply(s, 1, cumsum))); e <- exp(num - apply(num, 1, max)); e / rowSums(e) })",
  "    R <- X",
  "  } else {",
  "    P <- lapply(seq_len(nrow(cf)), function(j) { p <- plogis(cf[j, 1] + cf[j, 2] * z); cbind(1 - p, p) })",
  "    R <- X + 1",
  "  }",
  "  LL <- matrix(0, N, Q)",
  "  for (j in seq_along(P)) LL[M[, j], ] <- LL[M[, j], ] + t(log(P[[j]]))[R[M[, j], j], , drop = FALSE]",
  "  L <- exp(LL - apply(LL, 1, max)) * rep(w, each = N); post <- L / rowSums(L)",
  "  S <- NULL",
  "  for (j in seq_along(P)) {",
  "    p <- P[[j]]; K <- ncol(p); r <- R[, j] - 1; m <- M[, j]",
  "    if (inherits(fit, \"gpcm\")) {",
  "      # d log P(r) / d intercept v = [r >= v] - P(u >= v); d / d slope = z (r - E(u))",
  "      sv <- lapply(seq_len(K - 1), function(v) m * rowSums(post * (outer(r >= v, rep(1, Q)) - rep(rowSums(p[, (v + 1):K, drop = FALSE]), each = N))))",
  "      sa <- m * rowSums(post * (outer(r, rep(1, Q)) - rep(as.vector(p %*% (0:(K - 1))), each = N)) * rep(z, each = N))",
  "      S <- cbind(S, do.call(cbind, sv), sa)",
  "    } else {",
  "      res <- outer(r, rep(1, Q)) - rep(p[, 2], each = N)",
  "      S <- cbind(S, m * rowSums(post * res), m * rowSums(post * res * rep(z, each = N)))",
  "    }",
  "  }",
  "  # (ltm orders the 2PL's parameters as all intercepts, then all slopes)",
  "  if (!inherits(fit, \"gpcm\")) S <- S[, c(seq(1, ncol(S), 2), seq(2, ncol(S), 2))]",
  "  H <- solve(fit$hessian)",
  "  H %*% crossprod(S) %*% H",
  "}")

ps_irt <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  model <- req$model %||% "twopl"
  if (!model %in% c("rasch", "twopl", "grm", "gpcm")) stop("Invalid IRT model in the request.")
  fr <- ps_items_frame(req)
  binary <- model %in% c("rasch", "twopl")
  # (ltm's optimisers warn "NaNs produced" while searching, also on the package's own help-page
  #  examples; the fit is unaffected, so those warnings are not kept.)
  quiet <- function(x) sprintf("fit <- withCallingHandlers(%s, warning = function(w) if (grepl(\"NaNs produced\", conditionMessage(w))) invokeRestart(\"muffleWarning\"))", x)
  # Gauss-Hermite quadrature points (ltm's GHk; its defaults are 15 to 21, too few for long tests: the
  # log-likelihood keeps changing up to some 80 points with 20 items), and robust standard errors (Mplus MLR).
  k <- req$quadrature
  if (!is.null(k) && !(is.numeric(k) && length(k) == 1 && k == round(k) && k >= 5 && k <= 100)) stop("Choose between 5 and 100 quadrature points.")
  robust <- isTRUE(req$robust)
  if (robust && !model %in% c("twopl", "gpcm")) stop("Robust standard errors are available for the 2PL and partial credit models.")
  ctl <- if (is.null(k)) "" else sprintf(", control = list(GHk = %d)", as.integer(k))
  call <- switch(model,
    rasch = quiet(sprintf("rasch(items%s)", ctl)),
    twopl = quiet(sprintf("ltm(items ~ z1%s)", ctl)),
    grm = quiet(sprintf("grm(items%s)", ctl)),
    # (fitted in its intercept parameterisation, IRT.param = FALSE, so that the Hessian is that of the logit metric)
    gpcm = quiet(sprintf("gpcm(items, IRT.param = FALSE%s)", ctl)))
  body <- c("suppressPackageStartupMessages(library(ltm))",
    sprintf("items <- data[, %s]", ps_q(fr$items)),
    if (binary) c("# Binary items: the two observed values become 0 and 1 (lower = 0).",
      "items[] <- lapply(items, function(v) { u <- sort(unique(v[!is.na(v)])); if (length(u) != 2) stop('Rasch and 2PL models need binary items; use the graded response or partial credit model for more categories.'); as.integer(v == u[2]) })")
    else "items[] <- lapply(items, function(v) as.integer(factor(v)))  # categories 1, 2, ..., in their order",
    call,
    "# Item parameters in the IRT parameterisation: difficulty / thresholds (b) and discrimination (a).",
    "pars <- if (inherits(fit, \"grm\")) ltm:::IRT.parm(fit)$parms else",
    "  if (inherits(fit, \"gpcm\")) t(sapply(fit$coefficients, function(b) { K <- length(b); c(setNames(-b[-K] / b[K], names(b)[-K]), Dscrmn = unname(b[K])) })) else",
    "  coef(fit)",
    if (model %in% c("twopl", "gpcm")) c(
      "# The same parameters in the logit metric Mplus prints: loadings (discriminations) and thresholds (steps),",
      "# a threshold being minus ltm's intercept; standard errors from the inverse Hessian.",
      "V <- solve(fit$hessian)",
      if (robust) c(PS_IRT_ROBUST, "V <- irt_robust(fit, as.matrix(items), fit$control$GHk)")),
    "# Item and test information over the latent trait (theta).",
    "theta <- seq(-4, 4, by = 0.1)",
    "info <- plot(fit, type = \"IIC\", z = theta, plot = FALSE)",
    "# Reliability of the trait estimates (marginal), from the expected a posteriori scores.",
    "scores <- factor.scores(fit, method = \"EAP\")$score.dat")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Item response model (%s, ltm)", model), "ltm", inputs, body,
    c("summary(fit)", "pars", "item.fit(fit)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  pars <- env$pars
  if (is.list(pars) && !is.data.frame(pars)) {
    rows <- names(pars)
    params <- lapply(seq_along(pars), function(i) list(item = unname(fr$back[rows[i]]), values = as.list(pars[[i]])))
  } else {
    pars <- as.matrix(pars)
    params <- lapply(seq_len(nrow(pars)), function(i) list(item = unname(fr$back[rownames(pars)[i]]), values = as.list(pars[i, ])))
  }
  info <- env$info
  # (ltm's item fit is defined for dichotomous models: Rasch and 2PL.)
  ifit <- if (model %in% c("rasch", "twopl")) ps_try(ltm::item.fit(fit), "Item fit (ltm::item.fit)") else NULL
  sd <- env$scores
  # Marginal reliability: 1 - mean posterior variance / variance of the EAP scores (+ posterior variance).
  rel <- ps_try({ v <- mean(sd$se.z1^2); 1 - v / (stats::var(sd$z1) + v) }, "Marginal reliability")
  # Loadings and thresholds (steps) in the logit metric, with standard errors (robust: Mplus's MLR).
  coefficients <- NULL
  if (model %in% c("twopl", "gpcm")) {
    se <- sqrt(pmax(diag(env$V), 0)); cf <- fit$coefficients
    coefficients <- if (model == "twopl") {
      J <- nrow(cf)
      c(lapply(seq_len(J), function(j) list(item = unname(fr$back[rownames(cf)[j]]), parameter = "loading", est = unname(cf[j, 2]), se = unname(se[J + j]))),
        lapply(seq_len(J), function(j) list(item = unname(fr$back[rownames(cf)[j]]), parameter = "threshold 1", est = -unname(cf[j, 1]), se = unname(se[j]))))
    } else {
      at <- cumsum(c(0, lengths(cf)))
      unlist(lapply(seq_along(cf), function(j) { b <- cf[[j]]; K <- length(b); it <- unname(fr$back[names(cf)[j]])
        c(list(list(item = it, parameter = "loading", est = unname(b[K]), se = unname(se[at[j] + K]))),
          lapply(seq_len(K - 1), function(v) list(item = it, parameter = sprintf("step %d", v), est = -unname(b[v]), se = unname(se[at[j] + v])))) }), recursive = FALSE)
    }
  }
  ps_json(list(model = model, n = nrow(env$items), items = unname(fr$back[fr$items]),
    params = params, coefficients = coefficients, quadrature = k, robust = robust, logLik = as.numeric(logLik(fit)), aic = AIC(fit), bic = BIC(fit), reliability = rel,
    theta = unname(info[, 1]), information = lapply(seq_len(ncol(info) - 1), function(j) unname(info[, j + 1])),
    itemFit = if (is.null(ifit)) list() else lapply(seq_along(ifit$Tobs), function(i) list(item = unname(fr$back[names(ifit$Tobs)[i]]), x2 = unname(ifit$Tobs[i]), p = unname(ifit$p.values[i]))),
    warnings = env$.warnings, engine = list(package = "ltm", version = as.character(utils::packageVersion("ltm")))))
}

ps_lca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  f <- sprintf("cbind(%s) ~ 1", paste(fr$items, collapse = ", "))
  body <- c("suppressPackageStartupMessages(library(poLCA))",
    sprintf("items <- data[, %s]", ps_q(fr$items)),
    "items[] <- lapply(items, function(v) as.integer(factor(v)))  # poLCA needs categories 1, 2, ...",
    sprintf("# Latent class models with %s classes; %d random starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), nrep),
    "# (A best start that stops at the iteration limit, as on a flat likelihood, is continued to convergence.)",
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); m <- poLCA(%s, items, nclass = k, nrep = %d, maxiter = 5000, verbose = FALSE)",
      paste(deparse(ks), collapse = ""), seed, f, nrep),
    sprintf("  if (m$numiter >= 5000) m <- poLCA(%s, items, nclass = k, probs.start = m$probs, maxiter = 100000, verbose = FALSE)", f),
    "  if (m$numiter >= 100000) warning(sprintf(\"The %d-class model did not converge in 100000 iterations.\", k))",
    "  m })",
    "# Entropy-based classification quality (1 = perfectly separated classes).",
    "entropy <- function(m) { p <- m$posterior; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Latent class analysis (poLCA)", "poLCA", inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$P), llik = m$llik, AIC = m$aic, BIC = m$bic, entropy = entropy(m)))", "fits")), collapse = "\n"))
  env <- ps_run(body, inputs)
  models <- lapply(env$fits, function(m) {
    ord <- order(-m$P)  # classes ordered by size
    list(k = length(m$P), llik = m$llik, npar = m$npar, aic = m$aic, bic = m$bic, gsq = m$Gsq, entropy = env$entropy(m),
      shares = unname(m$P[ord]),
      probs = lapply(seq_along(m$probs), function(i) list(item = unname(fr$back[fr$items[i]]),
        categories = levels(factor(fr$data[[fr$items[i]]])),
        byClass = lapply(ord, function(c) unname(m$probs[[i]][c, ])))))
  })
  ps_json(list(n = nrow(env$items), items = unname(fr$back[fr$items]), models = models,
    warnings = env$.warnings, engine = list(package = "poLCA", version = as.character(utils::packageVersion("poLCA")))))
}

# Latent profile analysis (continuous indicators) and latent class growth analysis (ordered
# categorical repeated measures): the mixtures Mplus fits with TYPE = MIXTURE, written out in base R
# (no package in the browser fits them with Mplus's constraints). Both maximise the likelihood from
# several random starts and keep the best.
PS_LPA_FUNCTIONS <- c(
  "# A mixture of multivariate normal distributions, fitted by EM. structure: EEI = variances equal across",
  "# classes, no covariances (Mplus's default); VVI = class-specific variances; EEE = covariances, equal",
  "# across classes; VVV = class-specific covariance matrices.",
  "lpa_fit <- function(Y, k, structure, nrep, maxiter = 5000, tol = 1e-10) {",
  "  Y <- as.matrix(Y); n <- nrow(Y); p <- ncol(Y)",
  "  equal <- structure %in% c(\"EEI\", \"EEE\"); diagonal <- structure %in% c(\"EEI\", \"VVI\")",
  "  dens <- function(mu, S) { R <- chol(S); z <- backsolve(R, t(Y) - mu, transpose = TRUE); -0.5 * colSums(z^2) - sum(log(diag(R))) - 0.5 * p * log(2 * pi) }",
  "  mstep <- function(post) {",
  "    w <- colSums(post)",
  "    mu <- lapply(seq_len(k), function(c) colSums(post[, c] * Y) / w[c])",
  "    S <- lapply(seq_len(k), function(c) { D <- t(Y) - mu[[c]]; (D %*% (post[, c] * t(D))) / w[c] })",
  "    if (equal) S <- rep(list(Reduce(`+`, lapply(seq_len(k), function(c) S[[c]] * w[c])) / n), k)",
  "    if (diagonal) S <- lapply(S, function(s) diag(diag(s), p))",
  "    list(pi = w / n, mu = mu, S = S)",
  "  }",
  "  run <- function(post) {",
  "    ll0 <- -Inf",
  "    for (it in seq_len(maxiter)) {",
  "      th <- mstep(post)",
  "      lp <- vapply(seq_len(k), function(c) log(th$pi[c]) + dens(th$mu[[c]], th$S[[c]]), numeric(n))",
  "      lp <- matrix(lp, n); m <- apply(lp, 1, max); lse <- m + log(rowSums(exp(lp - m)))",
  "      post <- exp(lp - lse); ll <- sum(lse)",
  "      if (abs(ll - ll0) < tol * abs(ll)) break",
  "      ll0 <- ll",
  "    }",
  "    c(th, list(ll = ll, post = post, iterations = it))",
  "  }",
  "  best <- NULL",
  "  for (r in seq_len(if (k == 1) 1 else nrep)) {",
  "    # Starts: k-means, then k random cases as centres, each case assigned to the nearest.",
  "    cl <- if (k == 1) rep(1L, n) else if (r == 1) stats::kmeans(Y, k, nstart = 5)$cluster",
  "      else { C <- Y[sample(n, k), , drop = FALSE]; max.col(-vapply(seq_len(k), function(c) colSums((t(Y) - C[c, ])^2), numeric(n)), ties.method = \"first\") }",
  "    if (any(tabulate(cl, k) <= p)) next",
  "    f <- tryCatch(run(outer(cl, seq_len(k), `==`) * 1), error = function(e) NULL)",
  "    if (!is.null(f) && is.finite(f$ll) && (is.null(best) || f$ll > best$ll)) best <- f",
  "  }",
  "  if (is.null(best)) stop(sprintf(\"No start of the %d-class model converged (a class became too small or singular).\", k))",
  "  best$npar <- (k - 1) + k * p + (if (diagonal) p else p * (p + 1) / 2) * (if (equal) 1 else k)",
  "  best",
  "}")

ps_lpa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  structure <- req$structure %||% "EEI"
  if (!structure %in% c("EEI", "VVI", "EEE", "VVV")) stop("Invalid variance structure in the request.")
  body <- c(PS_LPA_FUNCTIONS,
    sprintf("Y <- data[, %s]", ps_q(fr$items)),
    "Y <- Y[complete.cases(Y), , drop = FALSE]  # cases with every indicator",
    sprintf("# Latent profile models with %s classes (%s); %d starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), structure, nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); lpa_fit(Y, k, \"%s\", %d) })", paste(deparse(ks), collapse = ""), seed, structure, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Latent profile analysis (%s)", structure), character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$pi), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(Y)), entropy = entropy(m)))",
      "lapply(fits, function(m) list(proportions = m$pi, means = do.call(rbind, m$mu), covariances = m$S))")), collapse = "\n"))
  env <- ps_run(body, inputs)
  n <- nrow(env$Y)
  models <- lapply(env$fits, function(m) {
    ord <- order(-m$pi)
    list(k = length(m$pi), llik = m$ll, npar = m$npar, aic = -2 * m$ll + 2 * m$npar, bic = -2 * m$ll + m$npar * log(n), gsq = NULL,
      entropy = env$entropy(m), shares = unname(m$pi[ord]),
      means = lapply(ord, function(c) unname(m$mu[[c]])),
      cov = lapply(ord, function(c) unname(m$S[[c]])), probs = list())
  })
  ps_json(list(n = n, items = unname(fr$back[fr$items]), models = models, structure = structure,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}

PS_LCGA_FUNCTIONS <- c(
  "# Latent class growth analysis of an ordered categorical outcome (Mplus: i s | u1@t1 ...; TYPE = MIXTURE):",
  "# within class c, P(u_t <= j) = plogis(tau_j - (i_c + s_c * t)), thresholds equal over time and classes,",
  "# no growth factor variance within class, the intercept of the last class fixed at 0.",
  "lcga_fit <- function(U, times, k, nrep) {",
  "  U <- as.matrix(U); n <- nrow(U); nt <- ncol(U)",
  "  lev <- sort(unique(as.vector(U[!is.na(U)]))); K <- length(lev)",
  "  if (K < 2) stop(\"The outcome has a single category.\")",
  "  cell <- cbind(match(U, lev), rep(seq_len(nt), each = n))",
  "  unpack <- function(th) {",
  "    tau <- cumsum(c(th[1], exp(th[seq_len(K - 2) + 1]))); o <- K - 1",
  "    i <- c(th[o + seq_len(k - 1)], 0); o <- o + k - 1",
  "    s <- th[o + seq_len(k)]; o <- o + k",
  "    list(tau = tau, i = i, s = s, logit = c(th[o + seq_len(k - 1)], 0))",
  "  }",
  "  probs <- function(p, c) { cum <- plogis(outer(p$tau, p$i[c] + p$s[c] * times, `-`)); rbind(cum, 1) - rbind(0, cum) }",
  "  loglik <- function(th) {",
  "    p <- unpack(th)",
  "    lp <- vapply(seq_len(k), function(c) rowSums(matrix(log(probs(p, c)[cell]), n), na.rm = TRUE), numeric(n))",
  "    lw <- p$logit - max(p$logit); lw <- lw - log(sum(exp(lw)))",
  "    lp <- sweep(matrix(lp, n), 2, lw, `+`); m <- apply(lp, 1, max)",
  "    list(ll = sum(m + log(rowSums(exp(lp - m)))), post = exp(lp - m - log(rowSums(exp(lp - m)))))",
  "  }",
  "  f <- function(th) { v <- -loglik(th)$ll; if (is.finite(v)) v else 1e300 }",
  "  cp <- cumsum(table(factor(U, levels = lev)))[-K] / sum(!is.na(U))",
  "  best <- NULL",
  "  for (r in seq_len(nrep)) {",
  "    st <- c(qlogis(cp[1]), log(pmax(diff(qlogis(cp)), 0.1)), stats::rnorm(k - 1, 0, 2), stats::rnorm(k, 0, 1), stats::rnorm(k - 1, 0, 1))",
  "    o <- tryCatch(stats::optim(st, f, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-12)), error = function(e) NULL)",
  "    if (!is.null(o) && (is.null(best) || o$value < best$value)) best <- o",
  "  }",
  "  p <- unpack(best$par); l <- loglik(best$par)",
  "  pi <- exp(p$logit) / sum(exp(p$logit))",
  "  # Classes by size (largest first); the last (smallest) is the reference whose intercept is 0.",
  "  ord <- order(-pi); ref <- ord[k]",
  "  list(ll = l$ll, npar = (K - 1) + 3 * k - 2, converged = best$convergence == 0, levels = lev, pi = pi[ord], post = l$post[, ord, drop = FALSE],",
  "    thresholds = p$tau - p$i[ref], intercepts = p$i[ord] - p$i[ref], slopes = p$s[ord],",
  "    probs = lapply(ord, function(c) probs(p, c)))",
  "}")

ps_lcga <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  times <- as.numeric(unlist(req$times))
  if (length(times) != length(fr$items) || any(!is.finite(times))) stop("Give one time score per occasion.")
  body <- c(PS_LCGA_FUNCTIONS,
    sprintf("U <- data[, %s]", ps_q(fr$items)),
    "U <- U[rowSums(!is.na(U)) > 0, , drop = FALSE]  # (a missing occasion is left out of that person's likelihood)",
    sprintf("times <- %s", paste(deparse(times), collapse = "")),
    sprintf("# Latent class growth models with %s classes; %d random starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); lcga_fit(U, times, k, %d) })", paste(deparse(ks), collapse = ""), seed, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Latent class growth analysis (ordered categorical outcome)", character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$pi), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(U)), entropy = entropy(m)))",
      "lapply(fits, function(m) m[c(\"pi\", \"thresholds\", \"intercepts\", \"slopes\")])")), collapse = "\n"))
  env <- ps_run(body, inputs)
  n <- nrow(env$U)
  models <- lapply(env$fits, function(m) {
    k <- length(m$pi)
    if (!m$converged) ps_warning(sprintf("The %d-class growth model did not converge.", k))
    list(k = k, llik = m$ll, npar = m$npar, aic = -2 * m$ll + 2 * m$npar, bic = -2 * m$ll + m$npar * log(n), gsq = NULL,
      entropy = env$entropy(m), shares = unname(m$pi),
      growth = list(thresholds = unname(m$thresholds), intercepts = unname(m$intercepts), slopes = unname(m$slopes)),
      probs = lapply(seq_along(fr$items), function(t) list(item = unname(fr$back[fr$items[t]]), categories = as.character(m$levels),
        byClass = lapply(seq_len(k), function(c) unname(m$probs[[c]][, t])))))
  })
  ps_json(list(n = n, items = unname(fr$back[fr$items]), models = models, times = times,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
