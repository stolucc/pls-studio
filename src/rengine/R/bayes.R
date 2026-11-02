# Bayesian tests, with JASP's default priors: the JZS t-tests (BayesFactor::ttestBF,
# Cauchy prior on the standardised effect), Pearson correlations
# (BayesFactor::correlationBF, stretched beta prior) and the binomial test (beta
# prior, closed form in base R). Bayes factors BF10 of H1 against H0; one-sided
# alternatives restrict H1 to positive or negative effects. Each function writes
# the script it runs.

ps_bayes_seed <- function(req) {
  s <- req$seed %||% 1234
  if (!is.numeric(s) || length(s) != 1 || !is.finite(s) || s != round(s) || abs(s) > .Machine$integer.max) stop("Invalid seed in the request.")
  as.integer(s)
}
ps_bayes_width <- function(req, default) {
  w <- ps_number(req$priorWidth %||% default, "prior width")
  if (w <= 0 || w > 100) stop("The prior width must be positive.")
  w
}
#' The interval of H1 for BayesFactor's nullInterval: NULL (two-sided), (0, Inf) or (-Inf, 0); for a correlation (0, 1) or (-1, 0).
ps_bayes_interval <- function(alt, bound = "Inf") switch(alt, two.sided = "NULL", greater = sprintf("c(0, %s)", bound), less = sprintf("c(-%s, 0)", bound))

#' Bayesian t-tests: one sample, paired samples, independent samples.
ps_bttest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "one"
  if (!type %in% c("one", "paired", "independent")) stop("Invalid t-test type in the request.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  mu <- ps_number(req$testValue %||% 0, "test value")
  r <- ps_bayes_width(req, sqrt(2) / 2); seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  pairs <- if (type == "paired") { p <- req$pairs; if (is.matrix(p)) lapply(seq_len(nrow(p)), function(i) as.character(p[i, ])) else lapply(p, function(t) as.character(unlist(t))) } else NULL
  vars <- if (type == "paired") unique(unlist(pairs)) else unlist(req$vars)
  if (!length(vars)) stop(if (type == "paired") "Choose at least one pair of variables." else "Choose at least one variable.")
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
    if (length(levels(factor(fr$data[[v[[group]]]]))) != 2) stop(sprintf("The grouping variable must have exactly two groups; %s has %d.", group, length(levels(factor(fr$data[[v[[group]]]])))))
  }
  q <- c((1 - conf) / 2, 0.5, 1 - (1 - conf) / 2)
  items <- if (type == "paired") pairs else as.list(vars)
  for (k in seq_along(items)) {
    b <- sprintf("b%d", k)
    if (type == "one") body <- c(body, sprintf("# %s", ps_comment(items[[k]])), sprintf("y <- data$%s[!is.na(data$%s)]", v[[items[[k]]]], v[[items[[k]]]]),
      sprintf("%s <- ttestBF(y, mu = %s, %s)", b, format(mu, digits = 15), args))
    else if (type == "paired") { p <- items[[k]]; body <- c(body, sprintf("# %s - %s", ps_comment(p[1]), ps_comment(p[2])),
      sprintf("ok <- complete.cases(data$%s, data$%s)", v[[p[1]]], v[[p[2]]]),
      sprintf("%s <- ttestBF(data$%s[ok], data$%s[ok], paired = TRUE, %s)", b, v[[p[1]]], v[[p[2]]], args)) }
    else body <- c(body, sprintf("# %s", ps_comment(items[[k]])),
      sprintf("ok <- !is.na(data$%s) & !is.na(g); y <- data$%s[ok]; gg <- droplevels(g[ok])", v[[items[[k]]]], v[[items[[k]]]]),
      sprintf("%s <- ttestBF(y[gg == levels(gg)[1]], y[gg == levels(gg)[2]], %s)", b, args))
    body <- c(body, sprintf("post%d <- posterior(%s[1], iterations = %d, progress = FALSE)  # the standardised effect delta under H1", k, b, iter),
      sprintf("delta%d <- quantile(as.numeric(post%d[, \"delta\"]), %s)", k, k, paste0("c(", paste(format(q, digits = 15), collapse = ", "), ")")))
  }
  inputs <- list(data = fr$data)
  title <- c(one = "Bayesian one-sample t-test", paired = "Bayesian paired-samples t-test", independent = "Bayesian independent-samples t-test")[[type]]
  if (export) return(paste(ps_script(title, "BayesFactor", inputs, body, unlist(lapply(seq_along(items), function(k) c(sprintf("b%d", k), sprintf("delta%d", k))))), collapse = "\n"))
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(items), function(k) {
    e <- BayesFactor::extractBF(env[[sprintf("b%d", k)]], logbf = TRUE)[1, ]
    d <- env[[sprintf("delta%d", k)]]
    list(label = if (type == "paired") paste(items[[k]], collapse = " - ") else items[[k]], bf10 = exp(e$bf),
      error = e$error,
      delta = list(median = unname(d[2]), low = unname(d[1]), high = unname(d[3])))
  })
  groups <- if (type == "independent") { g <- fr$data[[v[[group]]]]; codes <- sort(unique(g[!is.na(g)])); l <- unlist(req$categories[[group]]); if (!is.null(l) && all(codes %in% seq_along(l))) l[codes] else format(codes, trim = TRUE) } else NULL
  ps_json(list(type = type, alternative = alt, testValue = mu, priorWidth = r, confidence = conf, seed = seed, iterations = iter, groups = groups, rows = rows,
    warnings = env$.warnings, engine = list(package = "BayesFactor", version = as.character(utils::packageVersion("BayesFactor")))))
}

#' Bayesian Pearson correlations: every pair, stretched beta prior of width kappa (JASP's default 1: uniform on rho).
ps_bcorrelation <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two variables.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  kappa <- ps_bayes_width(req, 1); seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of posterior samples"))
  if (iter < 1000 || iter > 1e6) stop("The number of posterior samples must be between 1,000 and 1,000,000.")
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  q <- c((1 - conf) / 2, 0.5, 1 - (1 - conf) / 2)
  body <- c("suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("pairs <- combn(%s, 2, simplify = FALSE)", ps_q(v)),
    "# Stretched beta prior of width kappa on rho: BayesFactor's rscale is kappa (1: uniform on -1 to 1).",
    sprintf("bfs <- lapply(pairs, function(p) { ok <- complete.cases(data[[p[1]]], data[[p[2]]]); correlationBF(data[[p[1]]][ok], data[[p[2]]][ok], rscale = %s, nullInterval = %s) })",
      format(kappa, digits = 15), ps_bayes_interval(alt, "1")),
    sprintf("rho <- lapply(bfs, function(b) quantile(as.numeric(posterior(b[1], iterations = %d, progress = FALSE)[, \"rho\"]), %s))", iter, paste0("c(", paste(format(q, digits = 15), collapse = ", "), ")")),
    "n <- vapply(pairs, function(p) sum(complete.cases(data[[p[1]]], data[[p[2]]])), 0)",
    "r <- vapply(pairs, function(p) cor(data[[p[1]]], data[[p[2]]], use = \"complete.obs\"), 0)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Bayesian Pearson correlations", "BayesFactor", inputs, body, c("bfs", "rho")), collapse = "\n"))
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(env$pairs), function(i) { p <- env$pairs[[i]]; e <- BayesFactor::extractBF(env$bfs[[i]], logbf = TRUE)[1, ]
    list(a = fr$back[[p[1]]], b = fr$back[[p[2]]], r = env$r[i], n = env$n[i], bf10 = exp(e$bf), error = e$error,
      rho = list(median = unname(env$rho[[i]][2]), low = unname(env$rho[[i]][1]), high = unname(env$rho[[i]][3]))) })
  ps_json(list(alternative = alt, priorWidth = kappa, confidence = conf, seed = seed, iterations = iter, vars = vars, pairs = rows,
    warnings = env$.warnings, engine = list(package = "BayesFactor", version = as.character(utils::packageVersion("BayesFactor")))))
}

#' Bayesian binomial test: each category against the rest, beta(a, b) prior on the
#' proportion (JASP's default a = b = 1). BF10 in closed form; the posterior is beta.
ps_bbinomial <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  x <- req$variable %||% ""
  if (!nzchar(x)) stop("Choose the variable.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  p0 <- ps_number(req$testValue %||% 0.5, "test proportion")
  if (p0 <= 0 || p0 >= 1) stop("The test proportion must be between 0 and 1.")
  a <- ps_number(req$priorA %||% 1, "prior a"); b <- ps_number(req$priorB %||% 1, "prior b")
  if (a <= 0 || b <= 0) stop("The beta prior's parameters must be positive.")
  fr <- ps_long_frame(req, x)
  v <- fr$v
  body <- c(sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[x]]), ps_bt_factor_line(req, fr, x), sprintf("counts <- table(data$%s); n <- sum(counts)", v[[x]]),
    sprintf("a <- %s; b <- %s; p0 <- %s", format(a, digits = 15), format(b, digits = 15), format(p0, digits = 15)),
    "# Marginal likelihood under H1 (beta prior, restricted to the alternative) over the likelihood at p0, on the log scale.",
    switch(alt,
      two.sided = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) - (k * log(p0) + (n - k) * log1p(-p0))",
      greater = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) + pbeta(p0, k + a, n - k + b, lower.tail = FALSE, log.p = TRUE) - pbeta(p0, a, b, lower.tail = FALSE, log.p = TRUE) - (k * log(p0) + (n - k) * log1p(-p0))",
      less = "logBF <- function(k) lbeta(k + a, n - k + b) - lbeta(a, b) + pbeta(p0, k + a, n - k + b, log.p = TRUE) - pbeta(p0, a, b, log.p = TRUE) - (k * log(p0) + (n - k) * log1p(-p0))"),
    "bf10 <- exp(vapply(as.numeric(counts), logBF, 0))",
    sprintf("cri <- t(vapply(as.numeric(counts), function(k) qbeta(c(%s, 0.5, %s), k + a, n - k + b), numeric(3)))  # posterior (beta) median and central interval, unrestricted", format((1 - conf) / 2, digits = 15), format(1 - (1 - conf) / 2, digits = 15)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Bayesian binomial test", character(0), inputs, body, c("counts", "bf10", "cri")), collapse = "\n"))
  env <- ps_run(body, inputs)
  ct <- env$counts
  ps_json(list(variable = x, levels = names(ct), counts = unname(as.numeric(ct)), n = sum(ct), alternative = alt, testValue = p0, priorA = a, priorB = b, confidence = conf,
    rows = lapply(seq_along(ct), function(i) list(bf10 = env$bf10[i], median = env$cri[i, 2], low = env$cri[i, 1], high = env$cri[i, 3])),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' Bayesian ANOVA and ANCOVA (BayesFactor::generalTestBF): every model of the
#' factors (with their interactions, or main effects only) and covariates that
#' keeps the principle of marginality ("withmain"), each against the null model.
#' JASP's priors: fixed effects r = 0.5, covariates r = sqrt(2)/4. Equal prior
#' model probabilities; inclusion Bayes factors of each effect across all models.
ps_banova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$dependent %||% ""; fac <- unlist(req$factors); cov <- unlist(req$covariates)
  if (!nzchar(y) || !length(fac)) stop("Choose the dependent variable and at least one factor.")
  full <- !identical(req$interactions, FALSE)
  rf <- ps_number(req$priorFixed %||% 0.5, "prior width of the fixed effects"); rc <- ps_number(req$priorCovariates %||% (sqrt(2) / 4), "prior width of the covariates")
  if (rf <= 0 || rc <= 0) stop("The prior widths must be positive.")
  seed <- ps_bayes_seed(req)
  iter <- as.integer(ps_number(req$iterations %||% 10000, "number of samples"))
  if (iter < 1000 || iter > 1e6) stop("The number of samples must be between 1,000 and 1,000,000.")
  fr <- ps_long_frame(req, unique(c(y, fac, cov)))
  v <- fr$v
  if (length(fac) + length(cov) > 6) stop("At most six factors and covariates: the number of models grows quickly.")
  rhs <- paste(c(paste(vapply(fac, function(n) v[[n]], ""), collapse = if (full) " * " else " + "), vapply(cov, function(n) v[[n]], "")), collapse = " + ")
  body <- c("suppressPackageStartupMessages(library(BayesFactor))", sprintf("set.seed(%d)", seed),
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(y, fac, cov)])))),
    "# Factors (their levels as the groups).", vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    sprintf("bf <- generalTestBF(%s ~ %s, data = data, whichModels = \"withmain\", rscaleFixed = %s, rscaleCont = %s, iterations = %d, progress = FALSE)",
      v[[y]], rhs, format(rf, digits = 15), format(rc, digits = 15), iter),
    "# Posterior model probabilities (equal prior probabilities, the null model included).",
    "lbf <- c(0, extractBF(bf, logbf = TRUE)$bf); names(lbf) <- c(\"Null model\", rownames(extractBF(bf)))",
    "post <- exp(lbf - max(lbf)); post <- post / sum(post)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(if (length(cov)) "Bayesian ANCOVA" else "Bayesian ANOVA", "BayesFactor", inputs, body, c("bf", "post")), collapse = "\n"))
  env <- ps_run(body, inputs)
  ex <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  back <- function(t) paste(vapply(strsplit(trimws(t), ":", fixed = TRUE)[[1]], function(p) ps_bt_back(fr, p), ""), collapse = " × ")
  terms_of <- function(m) trimws(strsplit(m, "+", fixed = TRUE)[[1]])
  mods <- rownames(ex); k <- length(mods) + 1
  prior <- 1 / k
  models <- c(list(list(model = "Null model", terms = list(), bf10 = 1, error = 0, posterior = unname(env$post[1]))),
    lapply(seq_along(mods), function(i) list(model = paste(vapply(terms_of(mods[i]), back, ""), collapse = " + "), terms = I(vapply(terms_of(mods[i]), back, "")),
      bf10 = exp(ex$bf[i]), error = ex$error[i], posterior = unname(env$post[i + 1]))))
  # From the log Bayes factors (sums of Bayes factors on the log scale), so that odds stay exact when a probability is near 1.
  lse <- function(x) { m <- max(x); m + log(sum(exp(x - m))) }
  lbf <- env$lbf
  # BF_M: a model's posterior odds over its prior odds, 1 / (k - 1) with k equally likely models.
  for (i in seq_along(models)) models[[i]]$bfM <- exp(lbf[i] - lse(lbf[-i]) + log(k - 1))
  # Inclusion Bayes factors across all models: the posterior odds of the models with the effect over those without, by their prior odds.
  effects <- unique(unlist(lapply(mods, terms_of)))
  incl <- lapply(effects, function(t) {
    has <- c(FALSE, vapply(mods, function(m) t %in% terms_of(m), TRUE))
    pi <- mean(has)
    list(effect = back(t), priorInclusion = pi, posteriorInclusion = sum(env$post[has]), bfInclusion = exp(lse(lbf[has]) - lse(lbf[!has]) - log(pi / (1 - pi))))
  })
  ps_json(list(dependent = y, factors = fac, covariates = cov, n = nrow(env$data), priorFixed = rf, priorCovariates = rc, seed = seed, iterations = iter,
    models = models, effects = incl, warnings = env$.warnings, engine = list(package = "BayesFactor", version = as.character(utils::packageVersion("BayesFactor")))))
}

#' Bayesian contingency table (BayesFactor::contingencyTableBF; Gunel & Dickey
#' 1974): independence against dependence under the chosen sampling scheme,
#' Dirichlet prior of concentration a (JASP's default 1).
ps_bcontingency <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  rv <- req$rows %||% ""; cv <- req$columns %||% ""; wv <- req$counts %||% ""
  if (!nzchar(rv) || !nzchar(cv) || rv == cv) stop("Choose two different variables for the rows and the columns.")
  st <- req$sampling %||% "jointMulti"
  if (!st %in% c("poisson", "jointMulti", "indepRows", "indepCols", "hypergeom")) stop("Invalid sampling scheme in the request.")
  a <- ps_number(req$priorConcentration %||% 1, "prior concentration")
  if (a <= 0) stop("The prior concentration must be positive.")
  fr <- ps_long_frame(req, unique(c(rv, cv, if (nzchar(wv)) wv)))
  v <- fr$v
  call <- switch(st, poisson = "sampleType = \"poisson\"", jointMulti = "sampleType = \"jointMulti\"", hypergeom = "sampleType = \"hypergeom\"",
    indepRows = "sampleType = \"indepMulti\", fixedMargin = \"rows\"", indepCols = "sampleType = \"indepMulti\", fixedMargin = \"cols\"")
  body <- c("suppressPackageStartupMessages(library(BayesFactor))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(rv, cv, if (nzchar(wv)) wv)])))),
    ps_bt_factor_line(req, fr, rv), ps_bt_factor_line(req, fr, cv),
    sprintf("tab <- xtabs(%s~ %s + %s, data = data)", if (nzchar(wv)) paste0(v[[wv]], " ") else "", v[[rv]], v[[cv]]),
    sprintf("bf <- contingencyTableBF(tab, %s, priorConcentration = %s)", call, format(a, digits = 15)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Bayesian contingency table", "BayesFactor", inputs, body, c("tab", "bf")), collapse = "\n"))
  env <- ps_run(body, inputs)
  tab <- env$tab
  if (st == "hypergeom" && !all(dim(tab) == 2)) stop("The hypergeometric scheme (both margins fixed) is for 2 x 2 tables.")
  e <- BayesFactor::extractBF(env$bf, logbf = TRUE)
  ps_json(list(rows = rv, columns = cv, rowLevels = rownames(tab), colLevels = colnames(tab), counts = lapply(seq_len(nrow(tab)), function(i) unname(as.numeric(tab[i, ]))), n = sum(tab),
    sampling = st, priorConcentration = a, bf10 = exp(e$bf[1]), error = e$error[1],
    warnings = env$.warnings, engine = list(package = "BayesFactor", version = as.character(utils::packageVersion("BayesFactor")))))
}
