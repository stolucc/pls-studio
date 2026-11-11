# Power analysis for standard tests with pwr (Champely; Cohen 1988): t-tests
# (one sample, two independent samples, paired), one-way ANOVA, one and two
# proportions (Cohen's h), a correlation, a chi-square test (Cohen's w) and
# multiple regression (Cohen's f2). Each solves for the one quantity left
# out: the N (a priori), the power (achieved) or the effect size
# (sensitivity), and a power curve over N at the effect.

.ps_pwr_tests <- c("t1", "t2", "paired", "anova", "p1", "p2", "r", "chisq", "f2")

#' One number of the request within [lo, hi], written into code with all its digits.
ps_pwr_num <- function(x, what, lo, hi, int = FALSE) {
  v <- ps_number(x, what)
  if (v < lo || v > hi || (int && v != round(v))) {
    stop(sprintf("Invalid %s in the request.", what))
  }
  format(v, digits = 15)
}

#' The pwr call of a test: its function and the arguments other than the
#' solved one (`n_arg` the name of its N, `es_arg` that of its effect size).
ps_pwr_spec <- function(test) {
  switch(test,
    t1 = list(fn = "pwr.t.test", n_arg = "n", es_arg = "d", type = "one.sample"),
    t2 = list(fn = "pwr.t.test", n_arg = "n", es_arg = "d", type = "two.sample"),
    paired = list(fn = "pwr.t.test", n_arg = "n", es_arg = "d", type = "paired"),
    anova = list(fn = "pwr.anova.test", n_arg = "n", es_arg = "f"),
    p1 = list(fn = "pwr.p.test", n_arg = "n", es_arg = "h"),
    p2 = list(fn = "pwr.2p.test", n_arg = "n", es_arg = "h"),
    r = list(fn = "pwr.r.test", n_arg = "n", es_arg = "r"),
    chisq = list(fn = "pwr.chisq.test", n_arg = "N", es_arg = "w"),
    f2 = list(fn = "pwr.f2.test", n_arg = "v", es_arg = "f2")
  )
}

ps_pwr <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  o <- req$pwr
  test <- o[["test", exact = TRUE]]
  if (!(is.character(test) && length(test) == 1 && test %in% .ps_pwr_tests)) {
    stop("Invalid test in the request.")
  }
  solve <- o[["solve", exact = TRUE]]
  if (!(is.character(solve) && length(solve) == 1 && solve %in% c("n", "power", "effect"))) {
    stop("Invalid quantity to solve for in the request.")
  }
  alternative <- o[["alternative", exact = TRUE]] %||% "two.sided"
  sided <- test %in% c("t1", "t2", "paired", "p1", "p2", "r")
  if (!sided) {
    alternative <- "two.sided"
  }
  if (!(is.character(alternative) && length(alternative) == 1 &&
    alternative %in% c("two.sided", "less", "greater"))) {
    stop("Invalid alternative in the request.")
  }
  spec <- ps_pwr_spec(test)
  alpha <- ps_pwr_num(o$alpha %||% 0.05, "alpha", 1e-6, 0.5)

  # The effect size: as entered, or (proportions) Cohen's h from the two proportions.
  from_props <- test %in% c("p1", "p2") && identical(o[["effectFrom", exact = TRUE]], "props")
  effect_lines <- character(0)
  es_value <- NULL
  if (solve != "effect") {
    if (from_props) {
      prop1 <- ps_pwr_num(o$prop1, "first proportion", 1e-6, 1 - 1e-6)
      prop2 <- ps_pwr_num(o$prop2, "second proportion", 1e-6, 1 - 1e-6)
      effect_lines <- c(
        "# Cohen's h from the two proportions: 2 asin(sqrt(p1)) - 2 asin(sqrt(p2))",
        sprintf("h <- ES.h(%s, %s)", prop1, prop2)
      )
      es_value <- "h"
    } else {
      hi <- if (test == "r") 0.999999 else 100
      lo <- if (test == "r") -0.999999 else -100
      es_value <- ps_pwr_num(o$effect, "effect size", lo, hi)
      if (as.numeric(es_value) == 0) {
        stop("The effect size must not be zero.")
      }
    }
  }

  # The design's own numbers: groups (ANOVA), df (chi-square), predictors tested (f2).
  k <- if (test == "anova") ps_pwr_num(o$k %||% 3, "number of groups", 2, 1000, TRUE)
  df <- if (test == "chisq") ps_pwr_num(o$df %||% 1, "degrees of freedom", 1, 1e5, TRUE)
  u <- if (test == "f2") ps_pwr_num(o$u %||% 1, "numerator degrees of freedom", 1, 1000, TRUE)
  # The smallest N each test accepts (pwr's own checks), the start of the curve.
  n_min <- switch(test,
    r = 4,
    chisq = 1,
    f2 = as.numeric(u) + 2,
    2
  )
  n_value <- NULL
  if (solve != "n") {
    n_total <- ps_pwr_num(o$n, "N", n_min, 1e8)
    # (pwr.f2.test takes the denominator df: v = N - u - 1)
    n_value <- if (test == "f2") {
      format(as.numeric(n_total) - as.numeric(u) - 1, digits = 15)
    } else {
      n_total
    }
  }
  power_value <- if (solve != "power") ps_pwr_num(o$power, "power", 0.01, 0.9999)

  arg <- function(name, value) sprintf("%s = %s", name, value %||% "NULL")
  fixed <- c(
    if (test == "anova") arg("k", k),
    if (test == "chisq") arg("df", df),
    if (test == "f2") arg("u", u)
  )
  args <- c(
    fixed,
    arg(spec$n_arg, n_value),
    arg(spec$es_arg, es_value),
    arg("sig.level", alpha),
    arg("power", power_value),
    if (!is.null(spec$type)) sprintf("type = \"%s\"", spec$type),
    if (sided) sprintf("alternative = \"%s\"", alternative)
  )
  curve_args <- c(
    fixed,
    sprintf("%s = %s", spec$n_arg, if (test == "f2") "n - u_df - 1" else "n"),
    sprintf("%s = es", spec$es_arg),
    arg("sig.level", alpha),
    if (!is.null(spec$type)) sprintf("type = \"%s\"", spec$type),
    if (sided) sprintf("alternative = \"%s\"", alternative)
  )
  n_expr <- if (test == "f2") "pw$v + pw$u + 1" else sprintf("pw$%s", spec$n_arg)
  what <- c(
    n = "A priori: the N needed",
    power = "Achieved power at N",
    effect = "Sensitivity: the smallest effect detectable"
  )[[solve]]
  body <- c(
    "suppressPackageStartupMessages(library(pwr))",
    effect_lines,
    sprintf("# %s (%s)", what, spec$fn),
    sprintf("pw <- %s(%s)", spec$fn, paste(args, collapse = ", ")),
    "# The N of the design (per group for two samples, ANOVA and two proportions; the total for f2: v + u + 1)",
    sprintf("n_at <- %s", n_expr),
    sprintf("es <- pw$%s", spec$es_arg),
    if (test == "f2") sprintf("u_df <- %s", u),
    "# Power at each N of a grid, at the effect",
    sprintf(
      "curve_n <- unique(round(seq(%s, max(3 * ceiling(n_at), %s + 20), length.out = 60)))",
      n_min,
      n_min
    ),
    "curve_power <- vapply(curve_n, function(n) {",
    sprintf("  %s(%s)$power", spec$fn, paste(curve_args, collapse = ", ")),
    "}, 0)"
  )
  if (export) {
    title <- sprintf("Power analysis. %s (pwr::%s)", what, spec$fn)
    return(ps_script(title, "pwr", list(), body, c("pw", "ceiling(n_at)")))
  }
  env <- ps_run(body, list())
  pw <- env$pw
  num <- function(x) if (is.null(x) || !length(x)) NULL else unname(as.numeric(x[1]))
  ps_json(list(
    test = test,
    solve = solve,
    alternative = alternative,
    alpha = num(pw$sig.level),
    power = num(pw$power),
    effect = num(env$es),
    n = num(env$n_at),
    nNeeded = ceiling(num(env$n_at) - 1e-9),
    k = num(pw$k),
    df = num(pw$df),
    u = num(pw$u),
    v = num(pw$v),
    method = ps_flat(pw$method),
    note = if (is.null(pw$note)) NULL else ps_flat(pw$note),
    curve = list(n = I(env$curve_n), power = I(unname(env$curve_power))),
    warnings = env$.warnings,
    engine = ps_engine("pwr")
  ))
}
