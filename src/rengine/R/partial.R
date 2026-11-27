# Partial and semi-partial (part) correlations with ppcor (Kim 2015): each
# pair of the chosen variables controlling for the chosen control variables,
# or, with none chosen, for all the other variables of the set (ppcor's
# pcor() and spcor() matrices). Pearson, Spearman or Kendall; listwise
# deletion, as ppcor requires complete data.

ps_pcor <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unique(as.character(unlist(req$vars)))
  controls <- unique(as.character(unlist(req$controls)))
  method <- req[["method", exact = TRUE]] %||% "pearson"
  if (!(is.character(method) && length(method) == 1 &&
    method %in% c("pearson", "spearman", "kendall"))) {
    stop("Invalid correlation method in the request.")
  }
  if (length(vars) < 2) stop("Choose at least two variables.")
  if (any(controls %in% vars)) stop("A control variable cannot also be one of the variables.")
  if (!length(controls) && length(vars) < 3) {
    stop("Choose control variables, or at least three variables (each pair controlling for the others).")
  }
  cols <- c(vars, controls)
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  body <- c(
    "suppressPackageStartupMessages(library(ppcor))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    sprintf("vars <- %s", ps_q(unname(unlist(v[vars])))),
    sprintf(
      "controls <- %s",
      if (length(controls)) ps_q(unname(unlist(v[controls]))) else "character(0)"
    ),
    "pairs <- combn(vars, 2, simplify = FALSE)",
    "# What each pair is controlled for: the control variables, or (none chosen) the other variables",
    "given <- function(p) if (length(controls)) controls else setdiff(vars, p)",
    "# Partial correlation: both variables adjusted for the controls",
    "partial <- lapply(pairs, function(p) {",
    sprintf(
      "  pcor.test(data[[p[1]]], data[[p[2]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})",
    "# Semi-partial (part) correlations: the controls removed from the second variable only (spcor.test),",
    "# in both directions",
    "semi_ab <- lapply(pairs, function(p) {",
    sprintf(
      "  spcor.test(data[[p[1]]], data[[p[2]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})",
    "semi_ba <- lapply(pairs, function(p) {",
    sprintf(
      "  spcor.test(data[[p[2]]], data[[p[1]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})"
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "names(partial) <- vapply(pairs, paste, \"\", collapse = \" ~ \")",
      "do.call(rbind, partial)",
      "do.call(rbind, semi_ab)",
      "do.call(rbind, semi_ba)"
    )
    title <- sprintf("Partial and semi-partial correlations (ppcor, %s)", method)
    return(ps_script(title, "ppcor", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  test_row <- function(t) {
    list(r = t$estimate, stat = t$statistic, p = t$p.value)
  }
  back <- function(x) unname(vapply(x, function(n) fr$back[[n]], ""))
  rows <- lapply(seq_along(env$pairs), function(i) {
    p <- env$pairs[[i]]
    list(
      a = fr$back[[p[1]]],
      b = fr$back[[p[2]]],
      given = I(back(env$given(p))),
      n = env$partial[[i]]$n,
      gp = env$partial[[i]]$gp,
      partial = test_row(env$partial[[i]]),
      semiAB = test_row(env$semi_ab[[i]]),
      semiBA = test_row(env$semi_ba[[i]])
    )
  })
  ps_json(list(
    method = method,
    vars = I(vars),
    controls = I(controls),
    n = nrow(env$data),
    pairs = rows,
    warnings = env$.warnings,
    engine = ps_engine("ppcor")
  ))
}

# Dominance analysis of a linear regression (Budescu 1993; Azen & Budescu 2003): every subset of the predictors
# fitted, each R-squared from the correlations of the complete cases (OLS with an intercept), so no package is
# needed. Conditional dominance: a predictor's average increment in R-squared over the subsets of the others of
# each size; general dominance: the average of those (it sums to the full R-squared, and equals LMG / the Shapley
# value); complete dominance: the share of the subsets of the other predictors to which one predictor adds more
# than another (1: it dominates completely).
ps_dominance <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  outcome <- as.character(unlist(req$outcome))
  preds <- unique(as.character(unlist(req$predictors)))
  if (length(outcome) != 1) stop("Choose one outcome.")
  if (length(preds) < 2) stop("Choose at least two predictors.")
  if (length(preds) > 12) stop("Dominance analysis fits every subset of the predictors: choose at most 12.")
  if (outcome %in% preds) stop("The outcome cannot also be a predictor.")
  loss <- as.numeric(req$loss %||% 0.01)
  if (!(length(loss) == 1 && is.finite(loss) && loss > 0 && loss < 1)) stop("Invalid loss of R-squared in the request.")
  cols <- c(outcome, preds)
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    sprintf("y <- %s", ps_q(unname(unlist(v[outcome])))),
    sprintf("x <- %s", ps_q(unname(unlist(v[preds])))),
    "k <- length(x)",
    "R <- cor(data[, c(y, x)])",
    "rxy <- R[x, y]",
    "Rxx <- R[x, x]",
    "# Every subset of a set of predictors (by position), and those of one size",
    "subsets_of <- function(v) {",
    "  unlist(lapply(0:length(v), function(m) of_size(v, m)), recursive = FALSE)",
    "}",
    "of_size <- function(v, m) {",
    "  if (m == 0) list(integer(0)) else combn(length(v), m, function(ix) v[ix], simplify = FALSE)",
    "}",
    "# R-squared of y on each subset, from the correlations (OLS with an intercept)",
    "all_subsets <- subsets_of(seq_len(k))",
    "key <- function(s) paste0(\"s\", paste(sort(s), collapse = \",\"))",
    "fits <- vapply(all_subsets, function(s) {",
    "  if (!length(s)) 0 else sum(solve(Rxx[s, s, drop = FALSE], rxy[s]) * rxy[s])",
    "}, 0)",
    "names(fits) <- vapply(all_subsets, key, \"\")",
    "r2 <- function(s) fits[[key(s)]]",
    "# Conditional dominance: each predictor's average increment over the subsets of the others of each size",
    "conditional <- t(vapply(seq_len(k), function(i) {",
    "  others <- setdiff(seq_len(k), i)",
    "  vapply(0:(k - 1), function(m) {",
    "    mean(vapply(of_size(others, m), function(s) r2(c(s, i)) - r2(s), 0))",
    "  }, 0)",
    "}, numeric(k)))",
    "dimnames(conditional) <- list(x, paste0(\"size_\", 0:(k - 1)))",
    "# General dominance: the average over the sizes; it sums to the full R-squared",
    "general <- setNames(rowMeans(conditional), x)",
    "# Complete dominance: the share of the subsets of the other predictors to which row adds more than column",
    "complete <- matrix(NA_real_, k, k, dimnames = list(x, x))",
    "for (i in seq_len(k)) for (j in seq_len(k)) if (i != j) {",
    "  ss <- subsets_of(setdiff(seq_len(k), c(i, j)))",
    "  complete[i, j] <- mean(vapply(ss, function(s) r2(c(s, i)) > r2(c(s, j)), TRUE))",
    "}",
    "full_r2 <- r2(seq_len(k))",
    "beta <- setNames(solve(Rxx, rxy), x)",
    "# Fungible weights (Waller 2008): every standardised weight vector whose composite predicts y with R-squared",
    "# lower by `loss` correlates r with the least-squares composite. Each weight's smallest and largest value over",
    "# them, in closed form (Waller & Jones 2009; the extremes of fungible::fungible's random draws).",
    sprintf("loss <- %s", format(loss, digits = 15)),
    "if (loss >= full_r2) stop(\"The loss of R-squared must be smaller than R-squared itself.\")",
    "r <- sqrt((full_r2 - loss) / full_r2)",
    "spread <- sqrt(full_r2) * r * sqrt(1 - r^2) * sqrt(pmax(diag(solve(Rxx)) - beta^2 / full_r2, 0))",
    "fungible <- cbind(lower = r^2 * beta - spread, upper = r^2 * beta + spread)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "full_r2",
      "cbind(general, share = general / full_r2, beta, r2_alone = rxy^2)",
      "conditional",
      "complete",
      "fungible"
    )
    return(ps_script("Dominance analysis (base R)", "stats", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  back <- function(x) unname(vapply(x, function(n) fr$back[[n]], ""))
  ps_json(list(
    outcome = fr$back[[env$y]],
    predictors = I(back(env$x)),
    n = nrow(env$data),
    r2 = env$full_r2,
    general = I(unname(env$general)),
    conditional = ps_rows(env$conditional),
    complete = ps_rows(env$complete),
    beta = I(unname(env$beta)),
    r2Alone = I(unname(env$rxy^2)),
    fungible = list(loss = env$loss, r = env$r, lower = I(unname(env$fungible[, "lower"])),
      upper = I(unname(env$fungible[, "upper"]))),
    warnings = env$.warnings,
    engine = ps_engine("stats")
  ))
}

# Tests of the independencies a path model implies (d-separation; Shipley 2000; Thoemmes, Rosseel & Textor 2018):
# each claim of the basis set, y independent of x given the parents of both, by the t test of x in the regression of
# y on x and the conditioning variables (the test of the partial correlation, as piecewiseSEM::dSep does it), with
# the partial correlation and its Fisher-z interval; Shipley's Fisher's C over all claims, and Holm-adjusted p values.
# The claims come from the app (model/dsep.ts); complete cases on the model's variables.
ps_dsep <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  claims <- lapply(req$claims, function(cl) {
    list(x = as.character(cl$x), y = as.character(cl$y), given = as.character(unlist(cl$given)))
  })
  if (!length(claims)) stop("The model implies no independencies: every pair of variables is joined.")
  vars <- unique(as.character(unlist(req$variables)))
  if (!all(unlist(lapply(claims, function(cl) c(cl$x, cl$y, cl$given))) %in% vars)) {
    stop("A claim names a variable that is not in the model.")
  }
  fr <- ps_long_frame(req, vars)
  v <- fr$v
  claim_lines <- vapply(claims, function(cl) {
    sprintf(
      "  list(x = %s, y = %s, given = %s)", ps_q(v[[cl$x]]), ps_q(v[[cl$y]]),
      if (length(cl$given)) ps_q(unname(unlist(v[cl$given]))) else "character(0)"
    )
  }, "")
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[vars])))),
    "# The basis set: y independent of x given the parents of both",
    "claims <- list(",
    paste(claim_lines, collapse = ",\n"),
    ")",
    "# Each claim: the t test of x in lm(y ~ x + given), the partial correlation and its Fisher-z 95% interval",
    "test_claim <- function(cl) {",
    "  fit <- lm(reformulate(sprintf(\"`%s`\", c(cl$x, cl$given)), response = sprintf(\"`%s`\", cl$y)), data = data)",
    "  t <- summary(fit)$coefficients[2, \"t value\"]",
    "  df <- fit$df.residual",
    "  r <- t / sqrt(t^2 + df)",
    "  half <- qnorm(0.975) / sqrt(nrow(data) - length(cl$given) - 3)",
    "  c(r = r, t = t, df = df, p = 2 * pt(-abs(t), df), lower = tanh(atanh(r) - half), upper = tanh(atanh(r) + half))",
    "}",
    "tests <- do.call(rbind, lapply(claims, test_claim))",
    "# Shipley's Fisher's C: -2 sum log p, chi-squared on 2k df",
    "fisher_c <- -2 * sum(log(tests[, \"p\"]))",
    "fisher_df <- 2 * nrow(tests)",
    "fisher_p <- pchisq(fisher_c, fisher_df, lower.tail = FALSE)",
    "holm <- p.adjust(tests[, \"p\"], \"holm\")"
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "cbind(claim = vapply(claims, function(cl) sprintf(\"%s _||_ %s | %s\", cl$y, cl$x, paste(cl$given, collapse = \", \")), \"\"),",
      "  as.data.frame(round(tests, 4)), holm = round(holm, 4))",
      "c(fisher_c = fisher_c, df = fisher_df, p = fisher_p)"
    )
    return(ps_script("Tests of the implied independencies (d-separation, base R)", "stats", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(claims), function(i) {
    t <- env$tests[i, ]
    list(
      x = claims[[i]]$x, y = claims[[i]]$y, given = I(claims[[i]]$given),
      r = t[["r"]], t = t[["t"]], df = t[["df"]], p = t[["p"]], lower = t[["lower"]], upper = t[["upper"]],
      holm = env$holm[[i]]
    )
  })
  ps_json(list(
    n = nrow(env$data),
    claims = rows,
    fisherC = env$fisher_c, fisherDf = env$fisher_df, fisherP = env$fisher_p,
    warnings = env$.warnings,
    engine = ps_engine("stats")
  ))
}
