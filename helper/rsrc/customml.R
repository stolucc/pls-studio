#' Maximum likelihood for a model written as expressions (the custom likelihood card): the parameters are free,
#' and each part of the model is an expression of them (Mplus MODEL CONSTRAINT), and of data columns, which then vary
#' from case to case (Mplus CONSTRAINT = pihat: definition variables). Three kinds of model:
#'   nominal  one unordered outcome: the logit of each category against the last, as in Mplus (u#1 ... u#K-1);
#'   normal   continuous outcomes: their means, variances and covariances (multivariate normal);
#'   probit   one or two binary (0/1) outcomes: normal latent responses (the value 1 above the threshold), their
#'            thresholds, variances and covariance (Mplus LINK = PROBIT; pbivnorm for two).
#' Estimated by nlminb; standard errors from the observed information (numerical Hessian), or the sandwich of the
#' cases' scores (MLR), or that sandwich with Mplus's information for parameters under MODEL CONSTRAINT (se = "mplus":
#' the parts' curvature term counted twice, which reproduces Mplus's MLR standard errors and scaling factor, ex. 3.10). Expressions are checked against a grammar here (numbers, names, + - * / ^, exp, log,
#' sqrt, parentheses) and written into the script from the checked parse tree only.

PS_CML_FUNS <- c("exp", "log", "sqrt")

#' One expression from the request, parsed and checked: the R call, or an error. `names`: the names it may use.
ps_cml_expr <- function(x, names, what) {
  if (!(is.character(x) && length(x) == 1 && nchar(x) <= 500 && grepl("^[A-Za-z0-9_ .+*/^()-]+$", x))) {
    stop(sprintf("Invalid expression for %s in the request.", what))
  }
  e <- tryCatch(str2lang(x), error = function(err) stop(sprintf("The expression for %s cannot be read.", what)))
  ok <- function(z) {
    if (is.numeric(z)) {
      return(length(z) == 1 && is.finite(z))
    }
    if (is.name(z)) {
      return(as.character(z) %in% names)
    }
    if (!is.call(z)) {
      return(FALSE)
    }
    f <- as.character(z[[1]])
    a <- as.list(z)[-1]
    if (f %in% c("+", "-")) {
      return(length(a) %in% 1:2 && all(vapply(a, ok, TRUE)))
    }
    if (f %in% c("*", "/", "^")) {
      return(length(a) == 2 && all(vapply(a, ok, TRUE)))
    }
    if (f %in% c("(", PS_CML_FUNS)) {
      return(length(a) == 1 && ok(a[[1]]))
    }
    FALSE
  }
  if (!ok(e)) {
    stop(sprintf("The expression for %s may use the parameters, data columns, numbers, + - * / ^, exp, log, sqrt and parentheses only.", what))
  }
  paste(deparse(e, width.cutoff = 500L), collapse = " ")
}

ps_customml <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type
  if (!(is.character(type) && length(type) == 1 && type %in% c("nominal", "normal", "probit"))) {
    stop("Invalid model type in the request.")
  }
  ys <- as.character(unlist(req$outcomes))
  if (!length(ys) || anyDuplicated(ys)) stop("Choose the outcome(s).")
  if (type == "nominal" && length(ys) != 1) stop("A nominal model has one outcome.")
  if (type == "probit" && length(ys) > 2) stop("The probit model takes one or two binary outcomes.")
  if (length(ys) > 10) stop("At most 10 outcomes.")
  pars <- req$parameters
  if (!length(pars) || length(pars) > 50) stop("Give the model 1 to 50 parameters.")
  pn <- vapply(pars, function(p) ps_label(p$name), "")
  if (anyDuplicated(pn)) stop("Each parameter needs its own name.")
  start <- vapply(pars, function(p) ps_number(p$start %||% 0, "start value"), 0)
  se_type <- req$se %||% "model"
  if (!(is.character(se_type) && length(se_type) == 1 && se_type %in% c("model", "robust", "mplus"))) {
    stop("Invalid standard errors in the request.")
  }
  # Data columns the expressions may use (definition variables): any column with a plain name other than the outcomes.
  cols <- as.character(unlist(req$data$names))
  defcols <- setdiff(cols[grepl("^[A-Za-z][A-Za-z0-9_]{0,30}$", cols)], c(ys, pn))
  allowed <- c(pn, defcols)
  ex <- function(x, what) ps_cml_expr(x, allowed, what)
  p <- length(ys)
  pairs <- if (p > 1) t(utils::combn(p, 2)) else matrix(0L, 0, 2)
  if (type == "nominal") {
    lg <- as.character(unlist(req$logits))
    if (!length(lg)) stop("Give the logit of each category but the last.")
    parts <- setNames(
      lapply(seq_along(lg), function(k) ex(lg[k], sprintf("the logit of category %d", k))),
      sprintf("%s#%d", ys, seq_along(lg))
    )
  } else {
    mu <- as.character(unlist(req$means))
    vv <- as.character(unlist(req$variances))
    cv <- as.character(unlist(req$covariances))
    if (length(mu) != p || length(vv) != p || length(cv) != nrow(pairs)) {
      stop(sprintf("Give a %s and a variance for each outcome, and a covariance for each pair (empty: 0).", if (type == "probit") "threshold" else "mean"))
    }
    loc <- if (type == "probit") "threshold" else "mean"
    parts <- c(
      setNames(
        lapply(seq_len(p), function(j) ex(mu[j], sprintf("the %s of %s", loc, ys[j]))),
        sprintf("%s %s", if (type == "probit") "Threshold" else "Mean", ys)
      ),
      setNames(
        lapply(seq_len(p), function(j) ex(vv[j], sprintf("the variance of %s", ys[j]))),
        sprintf("Variance %s", ys)
      ),
      setNames(
        lapply(
          seq_len(nrow(pairs)),
          function(k) if (nzchar(trimws(cv[k]))) ex(cv[k], sprintf("the covariance of %s and %s", ys[pairs[k, 1]], ys[pairs[k, 2]])) else "0"
        ),
        if (nrow(pairs)) sprintf("Covariance %s, %s", ys[pairs[, 1]], ys[pairs[, 2]]) else character(0)
      )
    )
  }
  defs <- req$defined %||% list()
  if (length(defs) > 50) stop("At most 50 defined parameters.")
  dn <- vapply(defs, function(d) ps_label(d$name), "")
  if (any(dn %in% c(pn, defcols)) || anyDuplicated(dn)) {
    stop("A defined parameter needs a name of its own.")
  }
  dexpr <- vapply(
    seq_along(defs),
    function(i) ps_cml_expr(defs[[i]]$expr, c(pn, dn[seq_len(i - 1)]), sprintf("the defined parameter %s", dn[i])),
    ""
  )
  used <- unique(c(ys, intersect(defcols, unlist(lapply(parts, function(s) all.vars(str2lang(s)))))))
  fr <- ps_long_frame(req, used)
  # (the expressions name the columns as they are; plain names are their own R names)
  names(fr$data) <- used

  body <- c(
    "# The model: each part an expression of the parameters (and of data columns, which vary by case)",
    sprintf("outcomes <- %s", ps_q(ys)),
    sprintf("par_names <- %s", ps_q(pn)),
    sprintf("start <- c(%s)", paste(vapply(start, ps_num, ""), collapse = ", ")),
    "data <- data[complete.cases(data), , drop = FALSE]",
    "n <- nrow(data)",
    "parts <- function(theta) with(c(as.list(setNames(theta, par_names)), as.list(data)), list(",
    paste0("  ", sprintf("%s = %s", encodeString(names(parts), quote = "`"), unlist(parts)), collapse = ",\n"),
    "))",
    "# (each part as a vector over the cases)",
    "cases <- function(theta) lapply(parts(theta), function(v) rep_len(as.numeric(v), n))"
  )
  if (type == "nominal") {
    body <- c(
      body,
      sprintf("y <- data[[%s]]", encodeString(ys, quote = '"')),
      "cats <- sort(unique(y))",
      sprintf(
        "if (length(cats) != %d) stop(\"The outcome has \", length(cats), \" categories: give \", length(cats) - 1, \" logits, one for each category but the last (the reference).\")",
        length(parts) + 1
      ),
      "loglik_v <- function(v) {   # (the cases' log-likelihoods, given the parts)",
      "  eta <- cbind(do.call(cbind, v), 0)   # the last category is the reference",
      "  m <- apply(eta, 1, max); lse <- m + log(rowSums(exp(eta - m)))",
      "  eta[cbind(seq_len(n), match(y, cats))] - lse",
      "}"
    )
  } else if (type == "normal") {
    body <- c(
      body,
      "Y <- as.matrix(data[outcomes])",
      sprintf(
        "pairs <- matrix(c(%s), ncol = 2)",
        if (nrow(pairs)) paste(c(pairs[, 1], pairs[, 2]), collapse = ", ") else "integer(0)"
      ),
      "p <- length(outcomes)",
      "loglik_v <- function(v) {   # (the cases' log-likelihoods, given the parts)",
      "  M <- do.call(cbind, v[seq_len(p)]); V <- do.call(cbind, v[p + seq_len(p)]); C <- if (nrow(pairs)) do.call(cbind, v[-seq_len(2 * p)]) else matrix(0, n, 0)",
      "  # cases that share their means and covariance matrix, together",
      "  key <- do.call(paste, c(as.data.frame(signif(cbind(M, V, C), 12)), sep = \"|\"))",
      "  out <- numeric(n)",
      "  for (k in unique(key)) {",
      "    i <- which(key == k); j <- i[1]",
      "    S <- diag(V[j, ], p); if (nrow(pairs)) for (q in seq_len(nrow(pairs))) S[pairs[q, 1], pairs[q, 2]] <- S[pairs[q, 2], pairs[q, 1]] <- C[j, q]",
      "    R <- tryCatch(chol(S), error = function(e) NULL)",
      "    if (is.null(R)) return(rep(-Inf, n))",
      "    z <- backsolve(R, t(Y[i, , drop = FALSE] - rep(M[j, ], each = length(i))), transpose = TRUE)",
      "    out[i] <- -0.5 * p * log(2 * pi) - sum(log(diag(R))) - 0.5 * colSums(z^2)",
      "  }",
      "  out",
      "}"
    )
  } else {
    body <- c(
      body,
      "Y <- as.matrix(data[outcomes])",
      "if (!all(Y %in% c(0, 1))) stop(\"The probit model's outcomes are binary: 0 and 1.\")",
      "p <- length(outcomes)",
      "loglik_v <- function(v) {   # (the cases' log-likelihoods, given the parts)",
      "  if (any(unlist(v[p + seq_len(p)]) <= 0)) return(rep(-Inf, n))",
      "  # the value 1 when the latent response (mean 0) is above the threshold: P(0) = Phi(threshold / sd)",
      "  z <- lapply(seq_len(p), function(j) v[[j]] / sqrt(v[[p + j]]))",
      "  if (p == 1) return(ifelse(Y[, 1] == 0, pnorm(z[[1]], log.p = TRUE), pnorm(z[[1]], lower.tail = FALSE, log.p = TRUE)))",
      "  rho <- v[[2 * p + 1]] / sqrt(v[[p + 1]] * v[[p + 2]])",
      "  if (any(abs(rho) >= 1)) return(rep(-Inf, n))",
      "  s1 <- ifelse(Y[, 1] == 0, 1, -1); s2 <- ifelse(Y[, 2] == 0, 1, -1)",
      "  log(pmax(pbivnorm::pbivnorm(s1 * z[[1]], s2 * z[[2]], s1 * s2 * rho), 1e-300))",
      "}"
    )
  }
  body <- c(
    body,
    "loglik_i <- function(theta) loglik_v(cases(theta))",
    "loglik <- function(theta) sum(loglik_i(theta))",
    "# (where the parts cannot be evaluated, e.g. the log of a negative number, the optimiser is told so: no warning)",
    "nll <- function(theta) { l <- suppressWarnings(loglik(theta)); if (is.finite(l)) -l else 1e100 }",
    "if (!is.finite(loglik(start))) stop(\"The likelihood cannot be evaluated at the start values: choose others (e.g. values that keep variances positive and logarithms defined).\")",
    "opt <- nlminb(start, nll, control = list(eval.max = 5000, iter.max = 2000, rel.tol = 1e-12))",
    "opt2 <- optim(opt$par, nll, method = \"BFGS\", control = list(reltol = 1e-14, maxit = 2000))   # (polished)",
    "theta <- if (opt2$value <= opt$objective) opt2$par else opt$par",
    "names(theta) <- par_names",
    "H <- optimHess(theta, nll)",
    "V_model <- tryCatch(solve(H), error = function(e) matrix(NA_real_, length(theta), length(theta)))",
    if (se_type != "model") {
      c(
        "# The sandwich (Mplus MLR): the cases' scores by central differences",
        "h <- pmax(abs(theta), 1) * 1e-5",
        "S <- sapply(seq_along(theta), function(k) { e <- replace(numeric(length(theta)), k, h[k]); (loglik_i(theta + e) - loglik_i(theta - e)) / (2 * h[k]) })",
        "S <- matrix(S, nrow = n)",
        if (se_type == "mplus") {
          c(
            "# Mplus's information for parameters under MODEL CONSTRAINT (its MLR): the observed information plus, once more,",
            "# the term of the parts' curvature, -sum over cases and parts of d loglik / d part x d2 part / d theta2 (the term",
            "# by which the observed information differs from the expected one of the parts mapped to the parameters).",
            "v0 <- cases(theta); np <- length(theta); K <- matrix(0, np, np)",
            "for (k in seq_along(v0)) {",
            "  hk <- max(abs(v0[[k]]), 1) * 1e-5; vp <- vm <- v0; vp[[k]] <- v0[[k]] + hk; vm[[k]] <- v0[[k]] - hk",
            "  g <- (loglik_v(vp) - loglik_v(vm)) / (2 * hk)",
            "  for (a in seq_len(np)) for (b in seq_len(a)) {",
            "    ea <- replace(numeric(np), a, h[a] * 10); eb <- replace(numeric(np), b, h[b] * 10)",
            "    d2 <- (cases(theta + ea + eb)[[k]] - cases(theta + ea - eb)[[k]] - cases(theta - ea + eb)[[k]] + cases(theta - ea - eb)[[k]]) / (4 * ea[a] * eb[b])",
            "    K[a, b] <- K[b, a] <- K[a, b] - sum(g * d2)",
            "  }",
            "}",
            "H_mplus <- H + K",
            "V_bread <- tryCatch(solve(H_mplus), error = function(e) matrix(NA_real_, np, np))",
            "V <- V_bread %*% crossprod(S) %*% V_bread",
            "# Mplus's scaling correction factor for MLR: the trace of the bread times the meat, over the parameters",
            "scaling <- sum(diag(V_bread %*% crossprod(S))) / np"
          )
        } else {
          "V <- V_model %*% crossprod(S) %*% V_model"
        }
      )
    } else {
      "V <- V_model"
    },
    "# Derived quantities by the delta method: the model's parts (where the same for every case) and the defined parameters",
    sprintf(
      "defined <- function(theta) with(as.list(setNames(theta, par_names)), { %s })",
      if (length(dn)) paste(c(sprintf("%s <- %s", dn, dexpr), sprintf("c(%s)", paste(sprintf("%s = %s", dn, dn), collapse = ", "))), collapse = "; ") else "numeric(0)"
    ),
    "derived <- function(theta) { v <- cases(theta); c(vapply(v, function(x) if (diff(range(x)) < 1e-12) x[1] else NA_real_, 0), defined(theta)) }",
    "d0 <- derived(theta)",
    "J <- sapply(seq_along(theta), function(k) { e <- replace(numeric(length(theta)), k, pmax(abs(theta[k]), 1) * 1e-6); (derived(theta + e) - derived(theta - e)) / (2 * e[k]) })",
    "J <- matrix(J, nrow = length(d0))",
    "se_derived <- sqrt(pmax(diag(J %*% V %*% t(J)), 0))",
    "logl <- loglik(theta); npar <- length(theta)"
  )
  inputs <- list(data = fr$data)
  pk <- if (type == "probit" && p == 2) "pbivnorm" else character(0)
  if (export) {
    return(ps_script(
      sprintf("Custom likelihood (%s model, maximum likelihood)", type), pk, inputs, body,
      c(
        "cbind(estimate = theta, se = sqrt(diag(V)))",
        "cbind(estimate = d0, se = se_derived)",
        "c(logLik = logl, npar = npar, AIC = -2 * logl + 2 * npar, BIC = -2 * logl + log(n) * npar)"
      )
    ))
  }
  env <- ps_run(body, inputs)
  se <- sqrt(pmax(diag(env$V), 0))
  conv <- isTRUE(env$opt$convergence == 0) || isTRUE(env$opt2$convergence == 0)
  nparts <- length(parts)
  d0 <- env$d0
  sd0 <- env$se_derived
  item <- function(i, kind) list(name = names(d0)[i], kind = kind, est = if (is.na(d0[i])) NULL else unname(d0[i]), se = if (is.na(d0[i])) NULL else unname(sd0[i]), expr = if (kind == "part") parts[[i]] else dexpr[i - nparts])
  ps_json(list(
    type = type, outcomes = I(ys), n = env$n, converged = conv,
    parameters = lapply(
      seq_along(pn),
      function(k) list(name = pn[k], est = unname(env$theta[k]), se = unname(se[k]), start = start[k])
    ),
    parts = lapply(seq_len(nparts), function(i) item(i, "part")),
    defined = lapply(seq_along(dn), function(i) item(nparts + i, "defined")),
    categories = if (type == "nominal") I(env$cats) else NULL,
    fit = list(
      logLik = env$logl,
      npar = env$npar,
      aic = -2 * env$logl + 2 * env$npar,
      bic = -2 * env$logl + log(env$n) * env$npar
    ),
    se = se_type,
    scaling = if (se_type == "mplus") env$scaling else NULL,
    warnings = c(env$.warnings, if (!conv) "The optimiser did not report convergence: check the start values."),
    engine = list(package = "R (stats::nlminb)", version = as.character(getRversion()))
  ))
}

#' Bayesian multivariate regression under flat priors (the Bayesian multivariate regression card; Mplus ESTIMATOR = BAYES
#' with its default priors: flat for the coefficients and intercepts, IW(0, -p-1) for the residual covariance matrix, i.e.
#' p(B, Sigma) constant). The posterior is known exactly (Box & Tiao 1973, ch. 8; Zellner 1971): Sigma ~ inverse
#' Wishart(S, N - k - p - 1), S the residual cross-products, and B | Sigma matrix normal around the least-squares B with
#' (X'X)^-1 and Sigma. The coefficients' posterior medians are the least-squares estimates (their marginals are
#' symmetric), the residual variances' are inverse-gamma quantiles; the covariances' medians, the SDs and the intervals
#' come from independent draws of the exact posterior (no MCMC: no burn-in, no autocorrelation).
ps_bmvreg <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  ys <- as.character(unlist(req$outcomes))
  xs <- as.character(unlist(req$predictors))
  if (!length(ys) || length(ys) > 10) stop("Choose 1 to 10 outcomes.")
  if (length(intersect(ys, xs)) || anyDuplicated(c(ys, xs))) {
    stop("A column cannot be both an outcome and a predictor.")
  }
  draws <- as.integer(req$draws %||% 50000)
  if (is.na(draws) || draws < 1000 || draws > 1e6) stop("Invalid number of draws in the request.")
  seed <- as.integer(req$seed %||% 1)
  if (is.na(seed)) stop("Invalid seed in the request.")
  fr <- ps_long_frame(req, c(ys, xs))
  vy <- unname(fr$v[ys])
  vx <- unname(fr$v[xs])
  body <- c(
    "data <- data[complete.cases(data), , drop = FALSE]",
    sprintf("Y <- as.matrix(data[%s])", ps_q(vy)),
    sprintf("X <- cbind(`(Intercept)` = 1, as.matrix(data[%s]))", if (length(vx)) ps_q(vx) else "character(0)"),
    "N <- nrow(Y); k <- ncol(X); p <- ncol(Y)",
    "nu <- N - k - p - 1   # flat prior on (B, Sigma): Sigma | data ~ inverse Wishart(S, N - k - p - 1)",
    "if (nu < p) stop(\"Too few complete cases for the posterior to be proper (N - k - p - 1 must be at least p).\")",
    "XtXi <- solve(crossprod(X)); B <- XtXi %*% crossprod(X, Y); S <- crossprod(Y - X %*% B)",
    sprintf("set.seed(%d); M <- %d", seed, draws),
    "W <- stats::rWishart(M, nu, solve(S))   # Sigma^-1 ~ Wishart(nu, S^-1)",
    "Lx <- t(chol(XtXi))",
    "pairs <- if (p > 1) t(utils::combn(p, 2)) else matrix(0L, 0, 2)",
    "out <- matrix(NA_real_, M, k * p + p + nrow(pairs))",
    "for (i in seq_len(M)) {",
    "  Sig <- chol2inv(chol(W[, , i]))",
    "  Bi <- B + Lx %*% matrix(rnorm(k * p), k, p) %*% chol(Sig)",
    "  out[i, ] <- c(Bi, diag(Sig), Sig[pairs])",
    "}",
    "lab <- c(outer(colnames(X), colnames(Y), function(x, y) paste(y, \"ON\", x)), paste(\"Residual variance\", colnames(Y)),",
    "  if (nrow(pairs)) paste(\"Residual covariance\", colnames(Y)[pairs[, 1]], colnames(Y)[pairs[, 2]]) else character(0))",
    "# Exact posterior medians where known: the least-squares coefficients; the residual variances' inverse-gamma medians.",
    "med <- apply(out, 2, stats::median)",
    "med[seq_len(k * p)] <- c(B)",
    "med[k * p + seq_len(p)] <- diag(S) / (2 * stats::qgamma(0.5, (nu - p + 1) / 2))",
    "post <- data.frame(parameter = lab, median = med, mean = colMeans(out), sd = apply(out, 2, stats::sd),",
    "  lower = apply(out, 2, stats::quantile, 0.025), upper = apply(out, 2, stats::quantile, 0.975),",
    "  p_one = pmin(colMeans(out > 0), colMeans(out < 0)))",
    "post$exact <- seq_len(nrow(post)) <= k * p + p"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian multivariate regression, flat priors (exact posterior)", character(0), inputs, body, c("post")))
  }
  env <- ps_run(body, inputs)
  back <- function(s) ps_back_names(s, fr$back)
  P <- env$post
  ps_json(list(
    n = env$N, k = env$k, df = env$nu, draws = draws, seed = seed, outcomes = I(ys), predictors = I(xs),
    parameters = lapply(
      seq_len(nrow(P)),
      function(i) list(name = back(P$parameter[i]), median = P$median[i], mean = P$mean[i], sd = P$sd[i], lower = P$lower[i], upper = P$upper[i], pOne = P$p_one[i], exact = P$exact[i])
    ),
    warnings = env$.warnings, engine = list(package = "R (stats::rWishart)", version = as.character(getRversion()))
  ))
}
