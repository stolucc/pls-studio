# Bayesian tests, with JASP's default priors: the JZS t-tests (BayesFactor::ttestBF,
# Cauchy prior on the standardised effect), Pearson correlations
# (BayesFactor::correlationBF, stretched beta prior) and the binomial test (beta
# prior, closed form in base R). Bayes factors BF10 of H1 against H0; one-sided
# alternatives restrict H1 to positive or negative effects. Each function writes
# the script it runs.

ps_bayes_seed <- function(req) {
  s <- req$seed %||% 1234
  if (!is.numeric(s) || length(s) != 1 || !is.finite(s) || s != round(s) || abs(s) > .Machine$integer.max) {
    stop("Invalid seed in the request.")
  }
  as.integer(s)
}
ps_bayes_width <- function(req, default) {
  w <- ps_number(req$priorWidth %||% default, "prior width")
  if (w <= 0 || w > 100) stop("The prior width must be positive.")
  w
}
#' The interval of H1 for BayesFactor's nullInterval: NULL (two-sided), (0, Inf) or (-Inf, 0); for a correlation (0, 1) or (-1, 0).
ps_bayes_interval <- function(alt, bound = "Inf") {
  switch(alt,
    two.sided = "NULL",
    greater = sprintf("c(0, %s)", bound),
    less = sprintf("c(-%s, 0)", bound)
  )
}

#' Bayesian t-tests: one sample, paired samples, independent samples.
ps_bttest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "one"
  if (!type %in% c("one", "paired", "independent")) stop("Invalid t-test type in the request.")
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  mu <- ps_number(req$testValue %||% 0, "test value")
  r <- ps_bayes_width(req, sqrt(2) / 2)
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) {
    stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  }
  pairs <- if (type == "paired") {
    p <- req$pairs
    if (is.matrix(p)) lapply(seq_len(nrow(p)), function(i) as.character(p[i, ])) else lapply(p, function(t) as.character(unlist(t)))
  } else {
    NULL
  }
  vars <- if (type == "paired") unique(unlist(pairs)) else unlist(req$vars)
  if (!length(vars)) {
    stop(if (type == "paired") "Choose at least one pair of variables." else "Choose at least one variable.")
  }
  for (p in pairs) if (length(p) != 2 || p[1] == p[2]) stop("Each pair needs two different variables.")
  group <- req$group %||% ""
  if (type == "independent" && !nzchar(group)) stop("Choose the grouping variable.")
  fr <- ps_long_frame(req, unique(c(vars, if (type == "independent") group)))
  v <- fr$v
  ni <- ps_bayes_interval(alt)
  args <- sprintf("rscale = %s, nullInterval = %s", format(r, digits = 15), ni)
  body <- c("suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed))
  if (type == "independent") {
    body <- c(body, ps_bt_factor_line(req, fr, group), sprintf("g <- data$%s", v[[group]]))
    if (length(levels(factor(fr$data[[v[[group]]]]))) != 2) {
      stop(sprintf("The grouping variable must have exactly two groups; %s has %d.", group, length(levels(factor(fr$data[[v[[group]]]])))))
    }
  }
  q <- c((1 - conf) / 2, 0.5, 1 - (1 - conf) / 2)
  items <- if (type == "paired") pairs else as.list(vars)
  robust <- isTRUE(req$robustness)
  sequential <- isTRUE(req$sequential)
  if (robust || sequential) {
    body <- c(
      body,
      "# The Bayes factor of x (and y) for a prior width w: for the robustness check and the sequential analysis.",
      "# (NA where no Bayes factor exists, e.g. the first cases all equal: no variance)",
      sprintf(
        "bfAt <- function(x, y = NULL, w) tryCatch({ b <- exp(extractBF(ttestBF(x, y, %s%srscale = w, nullInterval = %s), logbf = TRUE)$bf[1]); if (is.finite(b) && b > 0) b else NA_real_ }, error = function(e) NA_real_)",
        if (type == "one") sprintf("mu = %s, ", format(mu, digits = 15)) else "", if (type == "paired") "paired = TRUE, " else "", ni
      )
    )
  }
  if (robust) {
    body <- c(body, sprintf("widths <- sort(unique(c(seq(0.05, 1.5, by = 0.05), %s)))  # prior widths for the robustness check", format(r, digits = 15)))
  }
  for (k in seq_along(items)) {
    b <- sprintf("b%d", k)
    # x and y: the two samples of this row (y = NULL for one sample), in row order.
    if (type == "one") {
      body <- c(
        body, sprintf("# %s", ps_comment(items[[k]])), sprintf("x <- data$%s[!is.na(data$%s)]; y <- NULL", v[[items[[k]]]], v[[items[[k]]]]),
        sprintf("%s <- ttestBF(x, mu = %s, %s)", b, format(mu, digits = 15), args)
      )
    } else if (type == "paired") {
      p <- items[[k]]
      body <- c(
        body, sprintf("# %s - %s", ps_comment(p[1]), ps_comment(p[2])),
        sprintf("ok <- complete.cases(data$%s, data$%s); x <- data$%s[ok]; y <- data$%s[ok]", v[[p[1]]], v[[p[2]]], v[[p[1]]], v[[p[2]]]),
        sprintf("%s <- ttestBF(x, y, paired = TRUE, %s)", b, args)
      )
    } else {
      body <- c(
        body, sprintf("# %s", ps_comment(items[[k]])),
        sprintf("ok <- !is.na(data$%s) & !is.na(g); yy <- data$%s[ok]; gg <- droplevels(g[ok]); x <- yy[gg == levels(gg)[1]]; y <- yy[gg == levels(gg)[2]]", v[[items[[k]]]], v[[items[[k]]]]),
        sprintf("%s <- ttestBF(x, y, %s)", b, args)
      )
    }
    body <- c(
      body, sprintf("post%d <- posterior(%s[1], iterations = %d, progress = FALSE)  # the standardised effect delta under H1", k, b, iter),
      sprintf("delta%d <- quantile(as.numeric(post%d[, \"delta\"]), %s)", k, k, paste0("c(", paste(format(q, digits = 15), collapse = ", "), ")"))
    )
    if (robust) {
      body <- c(body, sprintf("robust%d <- vapply(widths, function(w) bfAt(x, y, w), 0)", k))
    }
    if (sequential) {
      body <- c(
        body,
        # (the first n cases in row order; at most 150 steps; each group needs two cases)
        if (type == "independent") {
          c(
            "idx <- seq_along(yy); first <- max(vapply(levels(gg), function(l) which(gg == l)[2], 0))",
            "steps <- unique(round(seq(first, length(yy), length.out = min(150, length(yy) - first + 1))))",
            sprintf("seq%d <- vapply(steps, function(n) { s <- yy[1:n]; h <- gg[1:n]; bfAt(s[h == levels(gg)[1]], s[h == levels(gg)[2]], %s) }, 0)", k, format(r, digits = 15))
          )
        } else {
          c(
            "steps <- unique(round(seq(2, length(x), length.out = min(150, length(x) - 1))))",
            sprintf("seq%d <- vapply(steps, function(n) bfAt(x[1:n], if (is.null(y)) NULL else y[1:n], %s), 0)", k, format(r, digits = 15))
          )
        },
        sprintf("steps%d <- steps", k)
      )
    }
  }
  inputs <- list(data = fr$data)
  title <- c(one = "Bayesian one-sample t-test", paired = "Bayesian paired-samples t-test", independent = "Bayesian independent-samples t-test")[[type]]
  if (export) {
    return(ps_script(title, "BayesFactor", inputs, body, unlist(lapply(seq_along(items), function(k) c(sprintf("b%d", k), sprintf("delta%d", k))))))
  }
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(items), function(k) {
    e <- BayesFactor::extractBF(env[[sprintf("b%d", k)]], logbf = TRUE)[1, ]
    d <- env[[sprintf("delta%d", k)]]
    list(
      label = if (type == "paired") paste(items[[k]], collapse = " - ") else items[[k]], bf10 = exp(e$bf),
      error = e$error,
      delta = list(median = unname(d[2]), low = unname(d[1]), high = unname(d[3])),
      robustness = if (robust) list(widths = env$widths, bf10 = env[[sprintf("robust%d", k)]]) else NULL,
      sequential = if (sequential) list(n = env[[sprintf("steps%d", k)]], bf10 = env[[sprintf("seq%d", k)]]) else NULL
    )
  })
  groups <- if (type == "independent") {
    g <- fr$data[[v[[group]]]]
    codes <- sort(unique(g[!is.na(g)]))
    l <- unlist(req$categories[[group]])
    if (!is.null(l) && all(codes %in% seq_along(l))) l[codes] else format(codes, trim = TRUE)
  } else {
    NULL
  }
  ps_json(list(
    type = type, alternative = alt, testValue = mu, priorWidth = r, confidence = conf, seed = seed, iterations = iter, groups = groups, rows = rows,
    warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian Pearson correlations: every pair, stretched beta prior of width kappa (JASP's default 1: uniform on rho).
ps_bcorrelation <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two variables.")
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  kappa <- ps_bayes_width(req, 1)
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) {
    stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  }
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  q <- c((1 - conf) / 2, 0.5, 1 - (1 - conf) / 2)
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("pairs <- combn(%s, 2, simplify = FALSE)", ps_q(v)),
    "# Stretched beta prior of width kappa on rho: BayesFactor's rscale is kappa (1: uniform on -1 to 1).",
    sprintf(
      "bfs <- lapply(pairs, function(p) { ok <- complete.cases(data[[p[1]]], data[[p[2]]]); correlationBF(data[[p[1]]][ok], data[[p[2]]][ok], rscale = %s, nullInterval = %s) })",
      format(kappa, digits = 15), ps_bayes_interval(alt, "1")
    ),
    sprintf("rho <- lapply(bfs, function(b) quantile(as.numeric(posterior(b[1], iterations = %d, progress = FALSE)[, \"rho\"]), %s))", iter, paste0("c(", paste(format(q, digits = 15), collapse = ", "), ")")),
    "n <- vapply(pairs, function(p) sum(complete.cases(data[[p[1]]], data[[p[2]]])), 0)",
    "r <- vapply(pairs, function(p) cor(data[[p[1]]], data[[p[2]]], use = \"complete.obs\"), 0)",
    if (isTRUE(req$robustness) || isTRUE(req$sequential)) {
      c(
        "# The Bayes factor of x and y for a prior width w: for the robustness check and the sequential analysis.",
        "# (NA where no Bayes factor exists, e.g. the first cases without variance)",
        sprintf("bfAt <- function(x, y, w) tryCatch({ b <- exp(extractBF(correlationBF(x, y, rscale = w, nullInterval = %s), logbf = TRUE)$bf[1]); if (is.finite(b) && b > 0) b else NA_real_ }, error = function(e) NA_real_)", ps_bayes_interval(alt, "1")),
        "xy <- lapply(pairs, function(p) { ok <- complete.cases(data[[p[1]]], data[[p[2]]]); list(x = data[[p[1]]][ok], y = data[[p[2]]][ok]) })"
      )
    },
    if (isTRUE(req$robustness)) {
      c(
        sprintf("widths <- sort(unique(c(seq(0.05, 2, by = 0.05), %s)))", format(kappa, digits = 15)),
        "robust <- lapply(xy, function(d) vapply(widths, function(w) bfAt(d$x, d$y, w), 0))"
      )
    },
    # (the first n cases in row order, from 3; at most 150 steps)
    if (isTRUE(req$sequential)) {
      sprintf("sequential <- lapply(xy, function(d) { steps <- unique(round(seq(3, length(d$x), length.out = min(150, length(d$x) - 2)))); list(n = steps, bf10 = vapply(steps, function(n) bfAt(d$x[1:n], d$y[1:n], %s), 0)) })", format(kappa, digits = 15))
    }
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian Pearson correlations", "BayesFactor", inputs, body, c("bfs", "rho")))
  }
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(env$pairs), function(i) {
    p <- env$pairs[[i]]
    e <- BayesFactor::extractBF(env$bfs[[i]], logbf = TRUE)[1, ]
    list(
      a = fr$back[[p[1]]], b = fr$back[[p[2]]], r = env$r[i], n = env$n[i], bf10 = exp(e$bf), error = e$error,
      rho = list(median = unname(env$rho[[i]][2]), low = unname(env$rho[[i]][1]), high = unname(env$rho[[i]][3])),
      robustness = if (isTRUE(req$robustness)) list(widths = env$widths, bf10 = env$robust[[i]]) else NULL,
      sequential = if (isTRUE(req$sequential)) env$sequential[[i]] else NULL
    )
  })
  ps_json(list(
    alternative = alt, priorWidth = kappa, confidence = conf, seed = seed, iterations = iter, vars = vars, pairs = rows,
    warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian binomial test: each category against the rest, beta(a, b) prior on the
#' proportion (JASP's default a = b = 1). BF10 in closed form; the posterior is beta.
ps_bbinomial <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  x <- req$variable %||% ""
  if (!nzchar(x)) stop("Choose the variable.")
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  p0 <- ps_number(req$testValue %||% 0.5, "test proportion")
  if (p0 <= 0 || p0 >= 1) stop("The test proportion must be between 0 and 1.")
  a <- ps_number(req$priorA %||% 1, "prior a")
  b <- ps_number(req$priorB %||% 1, "prior b")
  if (a <= 0 || b <= 0) stop("The beta prior's parameters must be positive.")
  prior <- req$prior %||% "beta"
  if (!prior %in% c("beta", "logistic")) stop("Invalid prior in the request.")
  fr <- ps_long_frame(req, x)
  v <- fr$v
  if (prior == "logistic") {
    return(ps_bbinomial_logistic(req, fr, x, alt, conf, p0, export))
  }
  body <- c(
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[x]]), ps_bt_factor_line(req, fr, x), sprintf("counts <- table(data$%s); n <- sum(counts)", v[[x]]),
    sprintf("a <- %s; b <- %s; p0 <- %s", format(a, digits = 15), format(b, digits = 15), format(p0, digits = 15)),
    "# Marginal likelihood under H1 (beta prior, restricted to the alternative) over the likelihood at p0, on the log scale.",
    switch(alt,
      two.sided = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) - (k * log(p0) + (n - k) * log1p(-p0))",
      greater = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) + pbeta(p0, k + a, n - k + b, lower.tail = FALSE, log.p = TRUE) - pbeta(p0, a, b, lower.tail = FALSE, log.p = TRUE) - (k * log(p0) + (n - k) * log1p(-p0))",
      less = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) + pbeta(p0, k + a, n - k + b, log.p = TRUE) - pbeta(p0, a, b, log.p = TRUE) - (k * log(p0) + (n - k) * log1p(-p0))"
    ),
    "bf10 <- exp(vapply(as.numeric(counts), logBF, 0))",
    sprintf("cri <- t(vapply(as.numeric(counts), function(k) qbeta(c(%s, 0.5, %s), k + a, n - k + b), numeric(3)))  # posterior (beta) median and central interval, unrestricted", format((1 - conf) / 2, digits = 15), format(1 - (1 - conf) / 2, digits = 15))
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian binomial test", character(0), inputs, body, c("counts", "bf10", "cri")))
  }
  env <- ps_run(body, inputs)
  ct <- env$counts
  ps_json(list(
    variable = x, levels = names(ct), counts = unname(as.numeric(ct)), n = sum(ct), alternative = alt, testValue = p0, priorA = a, priorB = b, confidence = conf,
    rows = lapply(seq_along(ct), function(i) list(bf10 = env$bf10[i], median = env$cri[i, 2], low = env$cri[i, 1], high = env$cri[i, 3])),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' The binomial test with BayesFactor's prior (proportionBF): under H1 the log odds
#' are logistic, centred on the null value's log odds, with scale r (BayesFactor's
#' "medium" 0.5). BF10 by quadrature; the posterior of the proportion sampled.
ps_bbinomial_logistic <- function(req, fr, x, alt, conf, p0, export) {
  v <- fr$v
  r <- ps_number(req$priorScale %||% 0.5, "prior scale")
  if (r <= 0 || r > 100) stop("The prior scale must be positive.")
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) {
    stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  }
  ni <- switch(alt,
    two.sided = "NULL",
    greater = "c(p0, 1)",
    less = "c(0, p0)"
  )
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[x]]), ps_bt_factor_line(req, fr, x), sprintf("counts <- table(data$%s); n <- sum(counts)", v[[x]]),
    sprintf("p0 <- %s", format(p0, digits = 15)),
    "# Each category against the rest: logistic prior on the log odds under H1 (restricted to the alternative's side).",
    sprintf("bfs <- lapply(as.numeric(counts), function(k) proportionBF(y = k, N = n, p = p0, rscale = %s, nullInterval = %s))", format(r, digits = 15), ni),
    "bf10 <- exp(vapply(bfs, function(b) extractBF(b, logbf = TRUE)$bf[1], 0))",
    sprintf(
      "cri <- t(vapply(bfs, function(b) quantile(as.numeric(suppressMessages(posterior(b[1], iterations = %d, progress = FALSE))[, \"p\"]), c(%s, 0.5, %s)), numeric(3)))  # posterior median and central interval of the proportion",
      iter, format((1 - conf) / 2, digits = 15), format(1 - (1 - conf) / 2, digits = 15)
    )
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian binomial test", "BayesFactor", inputs, body, c("counts", "bfs", "cri")))
  }
  env <- ps_run(body, inputs)
  ct <- env$counts
  ps_json(list(
    variable = x, levels = names(ct), counts = unname(as.numeric(ct)), n = sum(ct), alternative = alt, testValue = p0, prior = "logistic", priorScale = r,
    seed = seed, iterations = iter, confidence = conf,
    rows = lapply(seq_along(ct), function(i) list(bf10 = env$bf10[i], error = BayesFactor::extractBF(env$bfs[[i]])$error[1], median = unname(env$cri[i, 2]), low = unname(env$cri[i, 1]), high = unname(env$cri[i, 3]))),
    warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Model comparison from log Bayes factors against the null model: posterior
#' probabilities, BF_M and inclusion Bayes factors per effect, all from sums on the
#' log scale (odds stay exact when a probability is near 1). `prior`: the prior
#' model probabilities (null model first; equal by default).
ps_bayes_models <- function(names, lbf, errors, back, prior = NULL, terms_of = function(m) trimws(strsplit(m, "+", fixed = TRUE)[[1]])) {
  lse <- function(x) {
    m <- max(x)
    m + log(sum(exp(x - m)))
  }
  k <- length(lbf)
  prior <- if (is.null(prior)) rep(1 / k, k) else prior
  lp <- lbf + log(prior)
  post <- exp(lp - lse(lp))
  terms <- c(list(character(0)), lapply(names[-1], terms_of))
  models <- lapply(seq_len(k), function(i) {
    list(
      model = if (i == 1) names[1] else paste(vapply(terms[[i]], back, ""), collapse = " + "),
      terms = I(vapply(terms[[i]], back, "")), bf10 = exp(lbf[i]), error = errors[i], prior = prior[i], posterior = post[i],
      # BF_M: the model's posterior odds over its prior odds
      bfM = exp(lp[i] - lse(lp[-i]) - (log(prior[i]) - log(sum(prior[-i]))))
    )
  })
  effects <- unique(unlist(terms))
  incl <- lapply(effects, function(t) {
    has <- vapply(terms, function(x) t %in% x, TRUE)
    pi <- sum(prior[has])
    list(effect = back(t), priorInclusion = pi, posteriorInclusion = sum(post[has]), bfInclusion = exp(lse(lp[has]) - lse(lp[!has]) - log(pi / (1 - pi))))
  })
  list(models = models, effects = incl)
}

#' Bayesian ANOVA and ANCOVA (BayesFactor::generalTestBF): every model of the
#' factors (with their interactions, or main effects only) and covariates that
#' keeps the principle of marginality ("withmain"), each against the null model.
#' JASP's priors: fixed effects r = 0.5, covariates r = sqrt(2)/4. Equal prior
#' model probabilities; inclusion Bayes factors of each effect across all models.
ps_banova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$dependent %||% ""
  fac <- unlist(req$factors)
  cov <- unlist(req$covariates)
  if (!nzchar(y) || !length(fac)) stop("Choose the dependent variable and at least one factor.")
  full <- !identical(req$interactions, FALSE)
  rf <- ps_number(req$priorFixed %||% 0.5, "prior width of the fixed effects")
  rc <- ps_number(req$priorCovariates %||% (sqrt(2) / 4), "prior width of the covariates")
  if (rf <= 0 || rc <= 0) stop("The prior widths must be positive.")
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of samples"))
  if (iter < 1000 || iter > 1e6) stop("The number of samples must be between 1,000 and 1,000,000.")
  fr <- ps_long_frame(req, unique(c(y, fac, cov)))
  v <- fr$v
  if (length(fac) + length(cov) > 6) {
    stop("At most six factors and covariates: the number of models grows quickly.")
  }
  # covariateInteractions: the covariates enter the factorial too (factor x covariate interactions, slopes differing by group).
  withCov <- full && isTRUE(req$covariateInteractions) && length(cov) > 0
  rhs <- if (withCov) {
    paste(vapply(c(fac, cov), function(n) v[[n]], ""), collapse = " * ")
  } else {
    paste(c(paste(vapply(fac, function(n) v[[n]], ""), collapse = if (full) " * " else " + "), vapply(cov, function(n) v[[n]], "")), collapse = " + ")
  }
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(y, fac, cov)])))),
    "# Factors (their levels as the groups).", vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    sprintf(
      "bf <- generalTestBF(%s ~ %s, data = data, whichModels = \"withmain\", rscaleFixed = %s, rscaleCont = %s, iterations = %d, progress = FALSE)",
      v[[y]], rhs, format(rf, digits = 15), format(rc, digits = 15), iter
    ),
    "# Posterior model probabilities (equal prior probabilities, the null model included).",
    "lbf <- c(0, extractBF(bf, logbf = TRUE)$bf); names(lbf) <- c(\"Null model\", rownames(extractBF(bf)))",
    "post <- exp(lbf - max(lbf)); post <- post / sum(post)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(if (length(cov)) "Bayesian ANCOVA" else "Bayesian ANOVA", "BayesFactor", inputs, body, c("bf", "post")))
  }
  env <- ps_run(body, inputs)
  ex <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  back <- function(t) ps_back_term(trimws(t), fr$back)
  mc <- ps_bayes_models(c("Null model", rownames(ex)), c(0, ex$bf), c(0, ex$error), back)
  models <- mc$models
  incl <- mc$effects
  ps_json(list(
    dependent = y, factors = fac, covariates = cov, covariateInteractions = withCov, n = nrow(env$data), priorFixed = rf, priorCovariates = rc, seed = seed, iterations = iter,
    models = models, effects = incl, warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian contingency table (BayesFactor::contingencyTableBF; Gunel & Dickey
#' 1974): independence against dependence under the chosen sampling scheme,
#' Dirichlet prior of concentration a (JASP's default 1).
ps_bcontingency <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  rv <- req$rows %||% ""
  cv <- req$columns %||% ""
  wv <- req$counts %||% ""
  if (!nzchar(rv) || !nzchar(cv) || rv == cv) {
    stop("Choose two different variables for the rows and the columns.")
  }
  st <- req$sampling %||% "jointMulti"
  if (!st %in% c("poisson", "jointMulti", "indepRows", "indepCols", "hypergeom")) {
    stop("Invalid sampling scheme in the request.")
  }
  a <- ps_number(req$priorConcentration %||% 1, "prior concentration")
  if (a <= 0) stop("The prior concentration must be positive.")
  fr <- ps_long_frame(req, unique(c(rv, cv, if (nzchar(wv)) wv)))
  v <- fr$v
  call <- switch(st,
    poisson = "sampleType = \"poisson\"",
    jointMulti = "sampleType = \"jointMulti\"",
    hypergeom = "sampleType = \"hypergeom\"",
    indepRows = "sampleType = \"indepMulti\", fixedMargin = \"rows\"",
    indepCols = "sampleType = \"indepMulti\", fixedMargin = \"cols\""
  )
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(rv, cv, if (nzchar(wv)) wv)])))),
    ps_bt_factor_line(req, fr, rv), ps_bt_factor_line(req, fr, cv),
    sprintf("tab <- xtabs(%s~ %s + %s, data = data)", if (nzchar(wv)) paste0(v[[wv]], " ") else "", v[[rv]], v[[cv]]),
    sprintf("bf <- contingencyTableBF(tab, %s, priorConcentration = %s)", call, format(a, digits = 15))
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian contingency table", "BayesFactor", inputs, body, c("tab", "bf")))
  }
  env <- ps_run(body, inputs)
  tab <- env$tab
  if (st == "hypergeom" && !all(dim(tab) == 2)) {
    stop("The hypergeometric scheme (both margins fixed) is for 2 x 2 tables.")
  }
  e <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  ps_json(list(
    rows = rv, columns = cv, rowLevels = rownames(tab), colLevels = colnames(tab), counts = lapply(seq_len(nrow(tab)), function(i) unname(as.numeric(tab[i, ]))), n = sum(tab),
    sampling = st, priorConcentration = a, bf10 = exp(e$bf[1]), error = e$error[1],
    warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian repeated-measures ANOVA: one within-subject factor (wide columns) and
#' optionally one between factor; subjects as a random effect (BayesFactor's
#' whichRandom). As JASP, every model includes the subjects and is compared with
#' the null model of the subjects alone. Priors: fixed effects r = 0.5, the
#' subjects' random effect r = 1.
ps_brmanova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  within <- unlist(req$levels)
  between <- req$between %||% ""
  multi <- !is.null(req$factors) && length(req$factors) >= 2
  if (!multi && length(within) < 2) {
    stop("Choose at least two columns: one per level of the within-subject factor.")
  }
  fname <- req$factorName %||% "condition"
  if (!multi && (!grepl("^[A-Za-z][A-Za-z0-9_.]{0,30}$", fname) || fname %in% c("subject", "y"))) {
    stop("The factor name must be a letter followed by letters, digits, _ or . (at most 31), and not subject or y.")
  }
  rf <- ps_number(req$priorFixed %||% 0.5, "prior width of the fixed effects")
  rr <- ps_number(req$priorRandom %||% 1, "prior width of the random effect")
  if (rf <= 0 || rr <= 0) stop("The prior widths must be positive.")
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of samples"))
  if (iter < 1000 || iter > 1e6) stop("The number of samples must be between 1,000 and 1,000,000.")
  design <- ps_rm_design(req)
  if (!is.null(design)) {
    within <- design$cells
    fname <- paste(design$names, collapse = " * ")
  }
  fr <- ps_long_frame(req, unique(c(within, if (nzchar(between)) between)))
  v <- fr$v
  bt <- nzchar(between)
  if (bt && v[[between]] %in% c("subject", "y", "idata", fname, design$names)) {
    stop("Rename the between factor: its name is taken by the model.")
  }
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(within, if (bt) between)])))),
    if (bt) ps_bt_factor_line(req, fr, between),
    if (!is.null(design)) {
      ps_rm_design_lines(design, unname(unlist(v[within])), if (bt) v[[between]] else "")
    } else {
      c(
        sprintf("Y <- as.matrix(data[, %s])", ps_q(unname(unlist(v[within])))),
        sprintf(
          "long <- data.frame(subject = factor(rep(seq_len(nrow(Y)), ncol(Y))), %s = factor(rep(%s, each = nrow(Y)), levels = %s), y = c(Y)%s)",
          fname, ps_q(within), ps_q(within), if (bt) sprintf(", %s = rep(data$%s, ncol(Y))", v[[between]], v[[between]]) else ""
        )
      )
    },
    "# Every model with the subjects as a random effect, against the subjects-only model (JASP's null model).",
    sprintf(
      "bf <- generalTestBF(y ~ %s%s + subject, data = long, whichRandom = \"subject\", whichModels = \"withmain\", neverExclude = \"^subject$\", rscaleFixed = %s, rscaleRandom = %s, iterations = %d, progress = FALSE)",
      fname, if (bt) sprintf(" * %s", v[[between]]) else "", format(rf, digits = 15), format(rr, digits = 15), iter
    ),
    sprintf("null <- lmBF(y ~ subject, data = long, whichRandom = \"subject\", rscaleRandom = %s, iterations = %d, progress = FALSE)", format(rr, digits = 15), iter),
    "rel <- bf / null"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian repeated-measures ANOVA", "BayesFactor", inputs, body, "rel"))
  }
  env <- ps_run(body, inputs)
  e <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  e0 <- BayesFactor::extractBF(env$null, logbf = TRUE)
  keep <- rownames(e) != "subject"
  strip <- function(m) trimws(setdiff(trimws(strsplit(m, "+", fixed = TRUE)[[1]]), "subject"))
  names_ <- c("Null model (subjects)", vapply(rownames(e)[keep], function(m) paste(strip(m), collapse = " + "), ""))
  back <- function(t) ps_back_term(trimws(t), fr$back)
  # (errors of the two Bayes factors combine as proportional errors do)
  mc <- ps_bayes_models(names_, c(0, e$bf[keep] - e0$bf[1]), c(e0$error[1], sqrt(e$error[keep]^2 + e0$error[1]^2)), back)
  ps_json(list(
    factorName = if (is.null(design)) fname else paste(design$names, collapse = " \u00d7 "), levels = within, between = between, n = nrow(env$Y),
    factors = if (!is.null(design)) lapply(seq_along(design$names), function(i) list(name = design$names[i], levels = I(design$levels[[i]]))), priorFixed = rf, priorRandom = rr, seed = seed, iterations = iter,
    models = mc$models, effects = mc$effects, warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian linear regression (BayesFactor::regressionBF): every subset of the
#' predictors against the intercept-only model, JZS (Zellner-Siow) prior with
#' scale r = sqrt(2)/4 (JASP's default). Model prior: uniform over the models, or
#' beta-binomial(1, 1) (each model size equally likely; JASP's default). Inclusion
#' probabilities and Bayes factors per predictor; the most probable model's
#' coefficients from its posterior.
ps_bregression <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$outcome %||% ""
  preds <- unlist(req$predictors)
  if (!nzchar(y) || !length(preds)) stop("Choose the outcome and at least one predictor.")
  if (length(preds) > 10) stop("At most ten predictors (1,024 models).")
  r <- ps_bayes_width(req, sqrt(2) / 4)
  seed <- ps_bayes_seed(req)
  mp <- req$modelPrior %||% "betabinomial"
  if (!mp %in% c("uniform", "betabinomial")) stop("Invalid model prior in the request.")
  conf <- ps_bt_conf(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) {
    stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  }
  fr <- ps_long_frame(req, unique(c(y, preds)))
  v <- fr$v
  fml <- sprintf("%s ~ %s", v[[y]], paste(vapply(preds, function(n) v[[n]], ""), collapse = " + "))
  q <- c((1 - conf) / 2, 1 - (1 - conf) / 2)
  body <- c(
    "suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(y, preds)])))),
    sprintf("bf <- regressionBF(%s, data = data, whichModels = \"all\", rscaleCont = %s, progress = FALSE)", fml, format(r, digits = 15)),
    "# The most probable model (under the model prior below) and its coefficients' posterior.",
    "lbf <- c(0, extractBF(bf, logbf = TRUE)$bf); sizes <- c(0, vapply(strsplit(rownames(extractBF(bf)), \"+\", fixed = TRUE), length, 0))",
    sprintf("prior <- %s", if (mp == "uniform") "rep(1 / length(lbf), length(lbf))" else sprintf("1 / ((%d + 1) * choose(%d, sizes))  # beta-binomial(1, 1): each model size equally likely", length(preds), length(preds))),
    "best <- which.max(lbf + log(prior))",
    sprintf("post <- if (best > 1) posterior(bf[best - 1], iterations = %d, progress = FALSE)", iter)
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Bayesian linear regression", "BayesFactor", inputs, body, c("bf", "summary(post)")))
  }
  env <- ps_run(body, inputs)
  e <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  back <- function(t) ps_back(trimws(t), fr$back)
  mc <- ps_bayes_models(c("Null model", rownames(e)), c(0, e$bf), c(0, e$error), back, prior = env$prior)
  # R2 of each model (lm), for reading the comparison.
  r2 <- c(0, vapply(rownames(e), function(m) summary(stats::lm(stats::as.formula(paste(v[[y]], "~", m)), data = env$data))$r.squared, 0))
  for (i in seq_along(mc$models)) mc$models[[i]]$r2 <- r2[i]
  coefs <- if (!is.null(env$post)) {
    pm <- as.matrix(env$post)
    keep <- colnames(pm) %in% unname(unlist(v[preds]))
    lapply(colnames(pm)[keep], function(cn) {
      x <- pm[, cn]
      list(term = back(cn), mean = mean(x), sd = stats::sd(x), low = unname(stats::quantile(x, q[1])), high = unname(stats::quantile(x, q[2])))
    })
  } else {
    list()
  }
  ps_json(list(
    outcome = y, predictors = preds, n = nrow(env$data), priorWidth = r, modelPrior = mp, confidence = conf, seed = seed, iterations = iter,
    models = mc$models, effects = mc$effects, best = mc$models[[env$best]]$model, coefficients = coefs,
    warnings = env$.warnings, engine = ps_engine("BayesFactor")
  ))
}

#' Bayesian SEM (blavaan, Stan): the CB-SEM model of the diagram fitted by MCMC.
#' Desktop R only (Stan is not available in R in the browser). Factors identified
#' by unit variances (std.lv; chains mix more reliably) or by marker indicators as
#' the diagram. Several groups (with the diagram's invariance), ordinal indicators
#' (probit, blavaan's data augmentation), labelled and defined parameters.
#' Priors: blavaan's defaults, or Mplus's (flat: N(0, 10^6) for loadings,
#' regressions, intercepts and means, a variance's prior flat on the variance,
#' and N(0, 5) for the loadings and thresholds of ordinal indicators), and normal
#' priors on labelled parameters (Mplus MODEL PRIORS). Approximate invariance
#' across groups by blavaan's wiggle (Mplus's DIFF priors: see below).
#' Reports posterior medians, means, SDs and central intervals from the draws,
#' R-hat and effective sample sizes, blavaan's fit measures (PPP, DIC, WAIC, LOOIC,
#' the marginal log-likelihood), a defined quantity over a grid of a moderator
#' (Mplus LOOP), and summaries of plausible values (draws of the factor scores).
#' engine = "inlavaan": the same model by INLAvaan's approximate Bayesian inference
#' instead (ps_bsem_inla below), which runs in the browser too.
ps_bsem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  engine <- req$engine %||% "blavaan"
  if (!(is.character(engine) && length(engine) == 1 && engine %in% c("blavaan", "inlavaan"))) {
    stop("Invalid engine in the request.")
  }
  inla <- engine == "inlavaan"
  if (!inla && ps_in_browser()) {
    stop("Bayesian SEM (blavaan, Stan) runs in desktop R: choose Desktop R (helper) under R runs in, or the INLAvaan engine.")
  }
  ident <- req$identification %||% "unit"
  if (!ident %in% c("unit", "marker")) stop("Invalid identification in the request.")
  chains <- as.integer(ps_number(req$chains %||% 3, "number of chains"))
  burnin <- as.integer(ps_number(req$burnin %||% 500, "burn-in"))
  sample <- as.integer(ps_number(req$sample %||% 1000, "number of draws per chain"))
  if (chains < 1 || chains > 8 || burnin < 100 || burnin > 1e5 || sample < 100 || sample > 1e5) {
    stop("Chains 1 to 8; burn-in and draws per chain 100 to 100,000.")
  }
  seed <- ps_bayes_seed(req)
  conf <- ps_bt_conf(req)
  cores <- as.integer(req$cores %||% 1L)
  if (is.na(cores) || cores < 1L || cores > 64L) stop("Invalid number of cores.")
  priors <- req$priors %||% "blavaan"
  if (!(is.character(priors) && length(priors) == 1 && priors %in% c("blavaan", "mplus"))) {
    stop("Invalid priors in the request.")
  }
  npv <- as.integer(ps_number(req$plausible %||% 0, "number of plausible values"))
  if (npv < 0 || npv > 500) stop("Plausible values: 0 to 500 per case.")
  if (npv > 0 && !is.null(req$model$multigroup)) stop("Plausible values here are for one group.")
  req$model$identification <- ident
  b <- ps_cb_build(req)
  if (b$matrix_input) stop("Bayesian SEM needs raw data; this dataset is a covariance matrix.")
  if (isTRUE(b$mi) || isTRUE(b$robust)) {
    stop("Bayesian SEM handles missing values itself (FIML-like); choose casewise or FIML, not multiple imputation or robust ML.")
  }
  if (!is.null(b$cluster_var)) stop("Bayesian SEM here fits models without clusters.")
  if (length(b$mods)) stop("Bayesian SEM here does not include latent interactions.")
  if (length(b$composites)) stop("Composites are not available in Bayesian SEM.")
  if (length(b$esem_blocks)) stop("ESEM blocks are not available in Bayesian SEM.")
  if (isTRUE(b$means) && ident == "unit") {
    stop("Means and intercepts in Bayesian SEM need marker identification: choose Marker indicators.")
  }
  span <- ps_model_span(b)
  at <- span[1]
  close <- span[2]
  # What the lavaan call holds besides the estimator: groups and their invariance, ordinal indicators, no mean
  # structure, and the diagram's own residual covariances (auto.cov.y = FALSE). (Written by ps_cb_build from
  # validated names: group and ordered are syntactic names, the rest fixed words.)
  carried <- function(arg) {
    m <- regmatches(b$call, regexpr(sprintf(", %s = (c\\([^()]*\\)|\"[A-Za-z0-9_.]*\"|TRUE|FALSE)", gsub(".", "\\.", arg, fixed = TRUE)), b$call))
    if (length(m)) m else ""
  }
  args <- paste0(vapply(c("group", "group.equal", "group.partial", "ordered", "meanstructure", "auto.cov.y"), carried, ""), collapse = "")
  ordered <- unname(b$n$iv[intersect(unlist(req$model$ordered), b$n$all_inds)])
  n_groups <- if (!is.null(b$group_var)) {
    length(unique(b$inputs$data[[b$group_var]][is.finite(b$inputs$data[[b$group_var]])]))
  } else {
    1L
  }
  # Normal priors on labelled parameters (Mplus MODEL PRIORS: label ~ N(mean, variance); Stan's normal takes the SD).
  lp <- req$labelPriors
  if (is.data.frame(lp)) lp <- lapply(seq_len(nrow(lp)), function(i) as.list(lp[i, , drop = FALSE]))
  lp_lines <- unlist(lapply(lp, function(p) {
    labs <- vapply(unlist(p$labels), ps_label, "")
    if (!length(labs)) stop("A prior needs at least one label.")
    m <- ps_number(p$mean, "prior mean")
    v <- ps_number(p$variance, "prior variance")
    if (v <= 0) stop("A prior variance must be positive.")
    sprintf("pt$prior[pt$label %%in%% %s] <- \"normal(%s,%s)\"   # Mplus N(%s, %s)", ps_q(labs), format(m, digits = 15), format(sqrt(v), digits = 15), format(m, digits = 15), format(v, digits = 15))
  }))
  # Approximate invariance (blavaan's wiggle): parameters held equal across groups become approximately equal.
  wg <- req$wiggle
  wiggle <- character(0)
  wsd <- NULL
  if (!is.null(wg)) {
    if (inla) {
      stop("Approximate invariance (blavaan's wiggle) is not available with INLAvaan: choose blavaan.")
    }
    if (n_groups < 2) stop("Approximate invariance needs several groups.")
    wiggle <- unique(as.character(unlist(wg$what)))
    if (!length(wiggle) || !all(wiggle %in% c("loadings", "intercepts", "regressions", "means", "thresholds"))) {
      stop("Invalid approximate invariance in the request.")
    }
    v <- ps_number(wg$variance, "variance of the differences")
    if (v <= 0 || v > 100) stop("The variance of the differences must be positive.")
    # Mplus's DIFF(p1-pG) ~ N(0, v): every pairwise difference between the groups' values has prior variance v,
    # i.e. group effects around a common (flat) mean with variance v/2 each. blavaan's wiggle centres groups 2..G on
    # group 1 with SD wiggle.sd: with wiggle.sd = sqrt(v/2) a difference between two of groups 2..G has prior
    # variance v, as Mplus's, and a difference from group 1 v/2 (blavaan's group 1 is the hub; Mplus has none).
    wsd <- sqrt(v / 2)
  }
  loop <- req$loop
  if (!is.null(loop)) {
    lname <- ps_label(loop$name)
    lvar <- ps_label(loop$variable)
    from <- ps_number(loop$from, "loop start")
    to <- ps_number(loop$to, "loop end")
    by <- ps_number(loop$by, "loop step")
    if (by <= 0 || to < from || (to - from) / by > 1000) {
      stop("The loop runs from its start to its end in at most 1,000 positive steps.")
    }
    lexpr <- ps_expr(loop$expr)
  }
  mplus <- priors == "mplus"
  # Priors are set per parameter in blavaan's parameter table; blavaan cannot take a table together with wiggle,
  # so with approximate invariance Mplus's priors go by type (dpriors) and priors on labels are not available.
  if (length(wiggle) && length(lp_lines)) {
    stop("Priors on labelled parameters cannot be combined with approximate invariance (blavaan's wiggle) here.")
  }
  via_pt <- (mplus || length(lp_lines) > 0) && !length(wiggle)
  pre_args <- sprintf("%s%s, std.lv = %s", args, if (isTRUE(b$means) && !grepl("meanstructure", args)) ", meanstructure = TRUE" else "", if (ident == "unit") "TRUE" else "FALSE")
  q <- c((1 - conf) / 2, 1 - (1 - conf) / 2)
  if (!is.null(req$defaultPriors) && !inla) {
    stop("Default priors by parameter type are set here for INLAvaan only.")
  }
  if (inla) {
    return(ps_bsem_inla(list(
      req = req, b = b, at = at, close = close, args = paste0(args, carried("missing")), pre_args = paste0(pre_args, carried("missing")), ordered = ordered,
      n_groups = n_groups, lp_lines = lp_lines, mplus = mplus, ident = ident, seed = seed, conf = conf, q = q, nsamp = sample, npv = npv,
      loop = if (!is.null(loop)) list(name = lname, variable = lvar, from = from, to = to, by = by, expr = lexpr)
    ), export))
  }
  fit_args <- sprintf(
    "%s%s%s%s%s", args,
    if (isTRUE(b$means) && !grepl("meanstructure", args)) ", meanstructure = TRUE" else "",
    if (mplus) ", dp = dp" else "",
    if (length(wiggle)) sprintf(", wiggle = %s, wiggle.sd = %s", ps_q(wiggle), format(wsd, digits = 15)) else "",
    if (npv > 0) ", save.lvs = TRUE" else ""
  )
  run <- sprintf(
    "n.chains = %d, burnin = %d, sample = %d, seed = %d, std.lv = %s%s, bcontrol = list(cores = %d)",
    chains, burnin, sample, seed, if (ident == "unit") "TRUE" else "FALSE", fit_args, cores
  )
  body <- c(
    b$body[seq_len(close)],
    "suppressPackageStartupMessages({ library(lavaan); library(blavaan) })",
    if (mplus) {
      c(
        "# Mplus's default priors: N(0, infinity) for loadings, regressions, intercepts and means (here N(0, 1000^2));",
        "# N(0, 5) for the loadings and thresholds of ordinal indicators; IG(-1, 0), flat, for a variance, and IW(0, -p-1),",
        "# flat, for a covariance matrix. blavaan puts its priors on variances and correlations: a variance with k free",
        "# covariances gets Gamma(1 + k/2, 1e-4) on the variance, which with a uniform correlation is flat on the covariance",
        "# matrix for k = 1 (two variables), as Mplus's; for larger blocks it is close (blavaan's correlations: LKJ(1)).",
        if (length(wiggle)) {
          c(
            "# (with approximate invariance the priors go by type: a factor variance's shape from the most covariances any factor has)",
            sprintf("pt0 <- parTable(bsem(model, data = data%s, do.fit = FALSE))", pre_args),
            "cv0 <- pt0$free > 0 & pt0$op == \"~~\" & pt0$lhs != pt0$rhs",
            "k0 <- max(0, vapply(unique(pt0$lhs[pt0$op == \"=~\"]), function(v) max(0, tapply(cv0 & (pt0$lhs == v | pt0$rhs == v), pt0$group, sum)), 0))"
          )
        },
        sprintf(
          "dp <- dpriors(nu = \"normal(0,1000)\", alpha = \"normal(0,1000)\", lambda = \"%s\", beta = \"normal(0,1000)\"%s%s)",
          if (length(wiggle) && length(ordered) && all(b$n$all_inds %in% names(b$n$iv)[b$n$iv %in% ordered])) "normal(0,2.2360680)" else "normal(0,1000)",
          if (length(ordered)) ", tau = \"normal(0,2.2360680)\"" else "",
          if (length(wiggle)) ", theta = \"gamma(1,1e-4)[var]\", psi = sprintf(\"gamma(%s,1e-4)[var]\", 1 + k0 / 2)" else ""
        )
      )
    },
    sprintf("# MCMC by Stan%s: %d chains, %d burn-in and %d draws each%s.", if (mplus) " (Mplus's default priors)" else if (via_pt) "" else " (blavaan's default priors)", chains, burnin, sample, if (ident == "unit") "; factors with unit variances (std.lv)" else ""),
    if (length(wiggle)) sprintf("# Approximate invariance (%s): groups 2..%d centred on group 1 with SD %s, Mplus DIFF priors of variance %s.", paste(wiggle, collapse = ", "), n_groups, format(signif(wsd, 4)), format(ps_number(wg$variance))),
    if (via_pt) {
      c(
        sprintf("pt <- parTable(bsem(model, data = data%s%s, do.fit = FALSE))", pre_args, if (mplus) ", dp = dp" else ""),
        if (mplus) {
          c(
            "free <- pt$free > 0",
            "cv <- free & pt$op == \"~~\" & pt$lhs != pt$rhs",
            "for (i in which(free & pt$op == \"~~\" & pt$lhs == pt$rhs)) pt$prior[i] <- sprintf(\"gamma(%s,1e-4)[var]\", 1 + sum(cv & pt$group == pt$group[i] & (pt$lhs == pt$lhs[i] | pt$rhs == pt$lhs[i])) / 2)",
            if (length(ordered)) {
              sprintf("pt$prior[free & pt$op == \"=~\" & pt$rhs %%in%% %s] <- \"normal(0,2.2360680)\"   # Mplus N(0, 5)", ps_q(ordered))
            }
          )
        },
        lp_lines,
        sprintf("fit <- bsem(pt, data = data, %s)", run)
      )
    } else {
      sprintf("fit <- bsem(model, data = data, %s)", run)
    },
    "pt <- parTable(fit)",
    "draws <- do.call(rbind, lapply(blavInspect(fit, \"mcmc\", add.defined = TRUE), as.matrix))",
    "rhat <- blavInspect(fit, \"rhat\"); neff <- blavInspect(fit, \"neff\")",
    "# (lavaan 0.7's fitMeasures generic does not reach blavaan's method: blavaan's own function)",
    "fm <- tryCatch(blavaan:::blav_fit_measures(fit), error = function(e) NULL)",
    if (!is.null(loop)) {
      c(
        sprintf("# %s = %s over %s from %s to %s by %s (Mplus MODEL CONSTRAINT: LOOP), from the draws of the labelled parameters", lname, lexpr, lvar, format(from), format(to), format(by)),
        sprintf("loop_at <- function(%s) with(as.data.frame(draws), %s)", lvar, lexpr),
        sprintf("loop_x <- seq(%s, %s, by = %s)", format(from, digits = 15), format(to, digits = 15), format(by, digits = 15)),
        sprintf("loop <- t(vapply(loop_x, function(v) { d <- loop_at(v); c(median = stats::median(d), mean = mean(d), sd = stats::sd(d), stats::quantile(d, %s)) }, numeric(5)))", ps_num_vec(q))
      )
    },
    if (npv > 0) {
      c(
        sprintf("# Plausible values: %d draws of every case's factor scores, evenly spaced over the saved draws (Mplus FSCORES(%d))", npv, npv),
        "lv <- blavPredict(fit, type = \"lv\")",
        "# (blavaan 0.6's draws of a factor explained by other factors lack the part of its mean that comes from theirs, e.g.",
        "#  a growth model's occasion factors the slope's mean: it is added back, at the posterior means of the parameters)",
        "shift <- lavInspect(fit, \"mean.lv\"); shift <- shift - lavInspect(fit, \"est\")$alpha[names(shift), 1]",
        "lv <- lapply(lv, function(m) sweep(as.matrix(m), 2, shift[colnames(as.matrix(m))], `+`))",
        sprintf("pv <- lv[unique(round(seq(1, length(lv), length.out = %d)))]", npv)
      )
    }
  )
  inputs <- b$inputs
  if (export) {
    return(ps_script("Bayesian SEM (blavaan)", c("lavaan", "blavaan"), inputs, body, c("summary(fit)", "fm", if (!is.null(loop)) "loop")))
  }
  if (!is.null(loop)) ps_bsem_loop_check(b, at, close, lexpr, lvar)
  env <- ps_run(body, inputs)
  n <- b$n
  constructs <- n$cname
  lv_lname <- unname(b$lname[constructs])
  back <- ps_back_map(b, constructs)
  nm <- function(x) ps_back(x, back, FALSE)
  d <- env$draws
  pt <- env$pt
  glab <- if (n_groups > 1) {
    as.character(lavaan::lavInspect(env$fit, "group.label"))
  } else {
    character(0)
  }
  # The draws' columns: one per free parameter of the parameter table (in its order), then the defined ones.
  rows <- pt[pt$free > 0, , drop = FALSE]
  rows <- rows[order(rows$free), , drop = FALSE]
  defs <- pt[pt$op == ":=", , drop = FALSE]
  if (ncol(d) != nrow(rows) + nrow(defs)) {
    stop("The posterior draws do not match the parameter table.")
  }
  summ <- function(x) list(median = stats::median(x), mean = mean(x), sd = stats::sd(x), low = unname(stats::quantile(x, q[1])), high = unname(stats::quantile(x, q[2])))
  pars <- lapply(seq_len(nrow(rows)), function(k) {
    r <- rows[k, ]
    x <- d[, k]
    p <- colnames(d)[k]
    op <- if (r$op == "~1") "~1" else r$op
    c(
      list(lhs = ps_back(r$lhs, back), op = op, rhs = if (op == "~1") "" else if (op == "|") r$rhs else ps_back(r$rhs, back)), summ(x),
      list(
        rhat = unname(env$rhat[p]), neff = unname(env$neff[p]), label = if (nzchar(r$label)) r$label else NULL,
        group = if (n_groups > 1) as.integer(r$group) else NULL, groupLabel = if (n_groups > 1) glab[r$group] else NULL, prior = if (nzchar(r$prior %||% "")) r$prior else NULL
      )
    )
  })
  defined <- lapply(seq_len(nrow(defs)), function(k) c(list(name = defs$lhs[k], expr = defs$rhs[k]), summ(d[, nrow(rows) + k])))
  fm <- env$fm
  fmv <- function(k) if (!is.null(fm) && k %in% names(fm)) unname(as.numeric(fm[[k]])) else NULL
  rh <- env$rhat[is.finite(env$rhat)]
  maxr <- if (length(rh)) max(rh) else NA_real_
  loop_out <- if (!is.null(loop)) ps_bsem_loop_out(env, lname, lvar, lexpr)
  # (blavPredict names the columns by the model's latent variables; observed-variable phantoms are left out)
  pv_out <- if (npv > 0) ps_bsem_pv_out(env$pv, lv_lname, nm)
  ps_json(list(
    identification = ident, chains = chains, burnin = burnin, sample = sample, seed = seed, confidence = conf, n = sum(lavaan::lavInspect(env$fit, "nobs")),
    priors = priors, groups = if (n_groups > 1) I(glab) else NULL, wiggleSd = wsd,
    parameters = pars, defined = defined, maxRhat = maxr, minNeff = min(env$neff, na.rm = TRUE), converged = is.finite(maxr) && maxr < 1.05,
    fit = list(ppp = fmv("ppp"), dic = fmv("dic"), pDic = fmv("p_dic"), waic = fmv("waic"), looic = fmv("looic"), seLooic = fmv("se_loo"), margLogLik = fmv("margloglik"), bic = fmv("bic")),
    loop = loop_out, plausible = pv_out,
    warnings = env$.warnings, engine = ps_engine("blavaan")
  ))
}
#' The loop's expression names labelled or defined parameters and the loop variable only (checked before the run).
ps_bsem_loop_check <- function(b, at, close, lexpr, lvar) {
  model_lines <- b$body[seq(at + 1, close - 1)]
  labs <- unique(c(
    unlist(regmatches(model_lines, gregexpr("[A-Za-z][A-Za-z0-9_]*(?=\\*)", model_lines, perl = TRUE))),
    # (no variable-length lookbehind: webR's PCRE2 has none)
    sub("^[(,] ?", "", unlist(regmatches(model_lines, gregexpr("[(,] ?[A-Za-z][A-Za-z0-9_]*(?=[,)])", model_lines, perl = TRUE)))),
    sub(" :=.*$", "", trimws(grep(":=", model_lines, value = TRUE, fixed = TRUE)))
  ))
  bad <- setdiff(all.vars(parse(text = lexpr)), c(lvar, labs))
  if (length(bad)) {
    stop(sprintf("The loop's expression names %s: not a label of the model or the loop variable.", paste(bad, collapse = ", ")))
  }
}
#' The loop's grid and the summaries of the quantity at each point (the script's loop_x and loop).
ps_bsem_loop_out <- function(env, lname, lvar, lexpr) {
  list(
    name = lname, variable = lvar, expr = lexpr, x = env$loop_x,
    median = unname(env$loop[, "median"]), mean = unname(env$loop[, "mean"]), sd = unname(env$loop[, "sd"]), low = unname(env$loop[, 4]), high = unname(env$loop[, 5])
  )
}
#' Summaries of plausible values (a list of cases x variables draws): over all cases and draws, and each case's SD averaged.
ps_bsem_pv_out <- function(pv, lv_lname, nm) {
  stack <- do.call(rbind, lapply(pv, as.matrix))
  keep <- colnames(stack) %in% lv_lname
  cols <- colnames(stack)[keep]
  per_case <- simplify2array(lapply(pv, function(m) as.matrix(m)[, keep, drop = FALSE]))
  case_sd <- apply(per_case, c(1, 2), stats::sd)
  list(
    draws = length(pv), cases = nrow(as.matrix(pv[[1]])), factors = I(vapply(cols, nm, "")),
    mean = unname(colMeans(stack[, keep, drop = FALSE])), cov = unname(stats::cov(stack[, keep, drop = FALSE])), meanSd = unname(colMeans(case_sd))
  )
}
#' A default prior by parameter type for INLAvaan's priors_for(): "normal(m,s)" (the SD), "gamma(a,b)" on the
#' variance, with [sd] on the SD or [prec] on the precision, or "beta(a,b)" (correlations); rebuilt from its numbers.
ps_inla_prior <- function(x, family) {
  num <- "([-+]?[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"
  m <- if (is.character(x) && length(x) == 1 && nchar(x) <= 60) {
    regmatches(x, regexec(sprintf("^\\s*(normal|gamma|beta)\\s*\\(\\s*%s\\s*,\\s*%s\\s*\\)\\s*(\\[sd\\]|\\[prec\\])?\\s*$", num, num), x, perl = TRUE))[[1]]
  } else {
    character(0)
  }
  if (length(m) != 5 || m[2] != family) {
    stop(sprintf("Invalid default prior in the request (a %s prior is expected).", family))
  }
  a <- as.numeric(m[3])
  b <- as.numeric(m[4])
  if (!is.finite(a) || !is.finite(b) || b <= 0 || (family != "normal" && a <= 0) || (nzchar(m[5]) && family != "gamma")) {
    stop("Invalid default prior in the request.")
  }
  sprintf("%s(%s,%s)%s", family, format(a, digits = 15), format(b, digits = 15), m[5])
}
PS_INLA_FAMILY <- c(nu = "normal", alpha = "normal", lambda = "normal", beta = "normal", tau = "normal", theta = "gamma", psi = "gamma", rho = "beta")

#' Bayesian SEM by INLAvaan (Jamil & Rue): the model of ps_bsem fitted by approximate Bayesian inference (the
#' posterior mode, a Laplace approximation with a variational-Bayes correction of the mean, skew-normal marginals),
#' without MCMC, so it runs in R in the browser too. Priors: INLAvaan's defaults (blavaan's), Mplus's (as for
#' blavaan), defaults by parameter type, and normal priors on labelled parameters. Reports INLAvaan's posterior
#' summaries (mean, SD, median; the central 95% interval from the marginals, other levels from posterior draws),
#' its fit measures (PPP, DIC, the marginal log-likelihood, Bayesian fit indices), WAIC and leave-one-out (its
#' approximations from the single fit), its diagnostics of the approximation, a defined quantity over a moderator
#' and plausible values (both from posterior draws). `s`: what ps_bsem validated and built.
ps_bsem_inla <- function(s, export) {
  req <- s$req
  b <- s$b
  seed <- s$seed
  conf <- s$conf
  q <- s$q
  nsamp <- s$nsamp
  npv <- s$npv
  loop <- s$loop
  ordered <- s$ordered
  mplus <- s$mplus
  miss <- req$missing %||% "casewise"
  if (!is.null(PS_LAVAAN_MISSING[[miss]]) && miss != "fiml") {
    stop("Bayesian SEM by INLAvaan: choose casewise deletion, mean replacement or FIML for the missing values.")
  }
  dp_args <- character(0)
  if (!is.null(req$defaultPriors)) {
    dpr <- req$defaultPriors
    if (mplus) stop("Choose Mplus's priors or default priors by parameter type, not both.")
    if (!is.list(dpr) || !length(dpr) || is.null(names(dpr)) || !all(names(dpr) %in% names(PS_INLA_FAMILY)) || anyDuplicated(names(dpr))) {
      stop("Invalid default priors in the request.")
    }
    dp_args <- vapply(names(dpr), function(k) ps_inla_prior(dpr[[k]], PS_INLA_FAMILY[[k]]), "")
  }
  via_pt <- mplus || length(s$lp_lines) > 0
  marg <- abs(conf - 0.95) < 1e-9
  run <- sprintf(
    "data = data%s%s, std.lv = %s, dp = dp, nsamp = %d, verbose = FALSE", s$args,
    if (isTRUE(b$means) && !grepl("meanstructure", s$args)) ", meanstructure = TRUE" else "", if (s$ident == "unit") "TRUE" else "FALSE", nsamp
  )
  body <- c(
    b$body[seq_len(s$close)],
    "suppressPackageStartupMessages({ library(lavaan); library(INLAvaan) })",
    if (mplus) {
      c(
        "# Mplus's default priors: N(0, 1000^2) for loadings, regressions, intercepts and means (Mplus: flat); N(0, 5) for the",
        "# loadings and thresholds of ordinal indicators; a variance with k free covariances gets Gamma(1 + k/2, 1e-4) on the",
        "# variance with uniform correlations, flat on the covariance matrix for k = 1 as Mplus's IW(0, -p-1) (as for blavaan).",
        sprintf("dp <- priors_for(nu = \"normal(0,1000)\", alpha = \"normal(0,1000)\", lambda = \"normal(0,1000)\", beta = \"normal(0,1000)\"%s)", if (length(ordered)) ", tau = \"normal(0,2.2360680)\"" else "")
      )
    } else if (length(dp_args)) {
      c(
        "# Default priors by parameter type (INLAvaan's own for the types not set)",
        sprintf("dp <- priors_for(%s)", paste(sprintf("%s = \"%s\"", names(dp_args), dp_args), collapse = ", "))
      )
    } else {
      c("# INLAvaan's default priors (blavaan's): N(0, 10) for loadings and regressions, N(0, 32) for intercepts, Gamma(1, 0.5) on the SDs, uniform correlations", "dp <- priors_for()")
    },
    sprintf("# Approximate Bayesian inference by INLAvaan (Laplace approximation at the posterior mode, VB-corrected mean, skew-normal marginals)%s;", if (s$ident == "unit") ", factors with unit variances (std.lv)" else ""),
    sprintf("# %d posterior draws for PPP, DIC and the defined parameters.", nsamp),
    if (via_pt) {
      c(
        sprintf("pt <- parTable(asem(model, data = data%s, dp = dp, do.fit = FALSE, verbose = FALSE))", s$pre_args),
        "pt <- pt[, c(\"id\", \"lhs\", \"op\", \"rhs\", \"user\", \"block\", \"group\", \"free\", \"ustart\", \"exo\", \"label\", \"plabel\", \"prior\")]",
        "pt$prior[is.na(pt$prior)] <- \"\"",
        if (mplus) {
          c(
            "free <- pt$free > 0",
            "cv <- free & pt$op == \"~~\" & pt$lhs != pt$rhs",
            "for (i in which(free & pt$op == \"~~\" & pt$lhs == pt$rhs)) pt$prior[i] <- sprintf(\"gamma(%s,1e-4)\", 1 + sum(cv & pt$group == pt$group[i] & (pt$lhs == pt$lhs[i] | pt$rhs == pt$lhs[i])) / 2)",
            if (length(ordered)) {
              sprintf("pt$prior[free & pt$op == \"=~\" & pt$rhs %%in%% %s] <- \"normal(0,2.2360680)\"   # Mplus N(0, 5)", ps_q(ordered))
            }
          )
        },
        s$lp_lines,
        sprintf("set.seed(%d)", seed), sprintf("fit <- asem(pt, %s)", run)
      )
    } else {
      c(sprintf("set.seed(%d)", seed), sprintf("fit <- asem(model, %s)", run))
    },
    "s <- get_inlavaan_internal(fit)$summary   # one row per free parameter (in the order of pt$free), then the defined ones",
    "pt <- parTable(fit)",
    sprintf("set.seed(%d)", seed),
    "fm <- fitMeasures(fit)   # PPP, DIC, the marginal log-likelihood, Bayesian fit indices (against the independence model)",
    "dg <- diagnostics(fit); dgp <- diagnostics(fit, type = \"param\")",
    "# WAIC and leave-one-out from the single fit (INLAvaan's approximations; no refitting)",
    "ic_waic <- tryCatch(waic(fit), error = function(e) NULL)",
    "ic_loo <- tryCatch(loo(fit), error = function(e) NULL)",
    if (!marg || !is.null(loop)) {
      c(
        sprintf("set.seed(%d)", seed),
        sprintf("draws <- as.data.frame(sampling(fit, nsamp = %d))   # posterior draws of the free parameters (a labelled one by its label)", nsamp),
        "for (k in which(pt$op == \":=\")) draws[[pt$lhs[k]]] <- eval(parse(text = pt$rhs[k]), draws)   # the defined parameters, draw by draw"
      )
    },
    if (!is.null(loop)) {
      c(
        sprintf("# %s = %s over %s from %s to %s by %s (Mplus MODEL CONSTRAINT: LOOP), from the posterior draws", loop$name, loop$expr, loop$variable, format(loop$from), format(loop$to), format(loop$by)),
        sprintf("loop_at <- function(%s) with(draws, %s)", loop$variable, loop$expr),
        sprintf("loop_x <- seq(%s, %s, by = %s)", format(loop$from, digits = 15), format(loop$to, digits = 15), format(loop$by, digits = 15)),
        sprintf("loop <- t(vapply(loop_x, function(v) { d <- loop_at(v); c(median = stats::median(d), mean = mean(d), sd = stats::sd(d), stats::quantile(d, %s)) }, numeric(5)))", ps_num_vec(q))
      )
    },
    if (npv > 0) {
      c(
        sprintf("# Plausible values: %d draws of every case's factor scores from their posterior (Mplus FSCORES(%d))", npv, npv),
        sprintf("set.seed(%d)", seed), sprintf("pv <- predict(fit, nsamp = %d)", npv)
      )
    }
  )
  if (export) {
    return(ps_script("Bayesian SEM (INLAvaan)", c("lavaan", "INLAvaan"), b$inputs, body, c("summary(fit)", "fm", "dg", "ic_waic", "ic_loo", if (!is.null(loop)) "loop")))
  }
  if (!is.null(loop)) ps_bsem_loop_check(b, s$at, s$close, loop$expr, loop$variable)
  env <- ps_run(body, b$inputs)
  constructs <- b$n$cname
  lv_lname <- unname(b$lname[constructs])
  back <- ps_back_map(b, constructs)
  nm <- function(x) ps_back(x, back, FALSE)
  sm <- env$s
  pt <- env$pt
  dgp <- env$dgp
  d <- env$draws
  nfree <- max(pt$free)
  defs <- pt[pt$op == ":=", , drop = FALSE]
  if (nrow(sm) != nfree + nrow(defs) || nrow(dgp) != nfree) {
    stop("INLAvaan's summary does not match the parameter table.")
  }
  glab <- if (s$n_groups > 1) {
    as.character(lavaan::lavInspect(env$fit, "group.label"))
  } else {
    character(0)
  }
  fin <- function(x) if (length(x) == 1 && is.finite(x)) unname(as.numeric(x)) else NULL
  # (the central interval: INLAvaan's 95% from the marginals; another level from the posterior draws)
  ci <- function(k, col) if (marg) unname(as.numeric(sm[k, c("2.5%", "97.5%")])) else unname(stats::quantile(d[[col]], q))
  summ <- function(k, col) {
    iv <- ci(k, col)
    list(median = sm[k, "50%"], mean = sm[k, "Mean"], sd = sm[k, "SD"], low = iv[1], high = iv[2])
  }
  pars <- lapply(which(pt$free > 0), function(i) {
    r <- pt[i, ]
    k <- r$free
    op <- r$op
    c(
      list(lhs = ps_back(r$lhs, back), op = op, rhs = if (op == "~1") "" else if (op == "|") r$rhs else ps_back(r$rhs, back)), summ(k, k),
      list(
        nmad = fin(dgp$nmad[k]), vbShift = fin(dgp$vb_shift_sigma[k]), label = if (nzchar(r$label)) r$label else NULL,
        group = if (s$n_groups > 1) as.integer(r$group) else NULL, groupLabel = if (s$n_groups > 1) glab[r$group] else NULL,
        prior = if (!is.na(sm$Prior[k]) && nzchar(sm$Prior[k])) sm$Prior[k] else NULL
      )
    )
  })
  defined <- lapply(seq_len(nrow(defs)), function(j) c(list(name = defs$lhs[j], expr = defs$rhs[j]), summ(nfree + j, defs$lhs[j])))
  fm <- env$fm
  dg <- env$dg
  fmv <- function(k) if (k %in% names(fm)) fin(fm[[k]]) else NULL
  dgv <- function(k) if (k %in% names(dg)) fin(dg[[k]]) else NULL
  ic <- function(x, row, col) if (!is.null(x) && row %in% rownames(x$estimates)) fin(x$estimates[row, col]) else NULL
  w <- env$ic_waic
  l <- env$ic_loo
  ps_json(list(
    identification = s$ident, chains = 0L, burnin = 0L, sample = nsamp, seed = seed, confidence = conf, n = sum(lavaan::lavInspect(env$fit, "nobs")),
    priors = if (mplus) "mplus" else if (length(dp_args)) "custom" else "inlavaan", defaultPriors = if (length(dp_args)) as.list(dp_args),
    groups = if (s$n_groups > 1) I(glab) else NULL, parameters = pars, defined = defined, maxRhat = NULL, minNeff = NULL, converged = isTRUE(dg[["converged"]] == 1),
    fit = list(
      ppp = fmv("ppp"), dic = fmv("dic"), pDic = fmv("p_dic"), waic = ic(w, "waic", "Estimate"), seWaic = ic(w, "waic", "SE"), pWaic = ic(w, "p_waic", "Estimate"),
      looic = ic(l, "looic", "Estimate"), seLooic = ic(l, "looic", "SE"), pLoo = ic(l, "p_loo", "Estimate"), margLogLik = fmv("margloglik"),
      brmsea = fmv("BRMSEA"), bgammahat = fmv("BGammaHat"), adjBgammahat = fmv("adjBGammaHat"), bmc = fmv("BMc"), bcfi = fmv("BCFI"), btli = fmv("BTLI"), bnfi = fmv("BNFI")
    ),
    diagnostics = list(
      iterations = dgv("iterations"), gradInf = dgv("grad_inf"), modeShiftMax = dgv("mode_shift_max"), hessCond = dgv("hess_cond"),
      vbShiftMax = dgv("vb_shift_max"), kldMax = dgv("kld_max"), nmadMax = dgv("nmad_max"), scanEndMassMax = dgv("scan_end_mass_max")
    ),
    seconds = fin(INLAvaan::timing(env$fit)[["total"]]), intervals = if (marg) "marginals" else "draws",
    loop = if (!is.null(loop)) ps_bsem_loop_out(env, loop$name, loop$variable, loop$expr), plausible = if (npv > 0) ps_bsem_pv_out(env$pv, lv_lname, nm),
    warnings = env$.warnings, engine = ps_engine("INLAvaan")
  ))
}
#' A numeric vector as R code.
ps_num_vec <- function(x) sprintf("c(%s)", paste(vapply(x, function(v) format(ps_number(v), digits = 15), ""), collapse = ", "))
