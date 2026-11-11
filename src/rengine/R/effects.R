# Effect sizes with confidence intervals (effectsize) and equivalence tests (TOSTER)
# for the basic test cards (tests.R): script lines that the cards add to the script
# they run, and the shaping of the results.

#' The arguments every effectsize call of a run shares: the interval's level and side.
ps_es_args <- function(conf, alt = "two.sided") {
  sprintf("ci = %s, alternative = \"%s\"", format(conf, digits = 15), alt)
}

#' Script lines for the effect sizes of one t-test (`r`: its result list, e.g. "r1"),
#' on the vectors the t-test lines define: y (one sample, against `mu`), x1 and x2
#' with their differences dif (paired), y1 and y2 (independent samples).
ps_es_ttest_lines <- function(type, r, conf, alt, mu, welch, rank) {
  a <- ps_es_args(conf, alt)
  m <- format(mu, digits = 15)
  calls <- if (type == "one") {
    c(
      d = sprintf("effectsize::cohens_d(y, mu = %s, %s)", m, a),
      g = sprintf("effectsize::hedges_g(y, mu = %s, %s)", m, a),
      rb = if (rank) sprintf("effectsize::rank_biserial(y, mu = %s, %s)", m, a)
    )
  } else if (type == "paired") {
    # (d of the differences, d_z, as the card's t-test; effectsize's paired = TRUE is the same)
    c(
      d = sprintf("effectsize::cohens_d(dif, %s)", a),
      g = sprintf("effectsize::hedges_g(dif, %s)", a),
      rb = if (rank) sprintf("effectsize::rank_biserial(x1, x2, paired = TRUE, %s)", a)
    )
  } else {
    c(
      d = sprintf("effectsize::cohens_d(y1, y2, %s)", a),
      g = sprintf("effectsize::hedges_g(y1, y2, %s)", a),
      dWelch = if (welch) sprintf("effectsize::cohens_d(y1, y2, pooled_sd = FALSE, %s)", a),
      glass = sprintf("effectsize::glass_delta(y1, y2, adjust = FALSE, %s)", a),
      rb = if (rank) sprintf("effectsize::rank_biserial(y1, y2, %s)", a)
    )
  }
  c(
    "# Effect sizes with confidence intervals (effectsize).",
    sprintf("%s$es <- list(", r),
    paste0("  ", names(calls), " = ", calls, c(rep(",", length(calls) - 1), "")),
    ")"
  )
}

#' Equivalence bounds from the request: `low` < `high`, finite, in raw or standardised units.
ps_tost_bounds <- function(x) {
  if (!is.list(x)) stop("Invalid equivalence bounds in the request.")
  low <- ps_number(x$low, "lower equivalence bound")
  high <- ps_number(x$high, "upper equivalence bound")
  units <- x$units %||% "raw"
  if (!units %in% c("raw", "smd")) stop("Invalid units of the equivalence bounds in the request.")
  if (!(low < high)) stop("The lower equivalence bound must be below the upper one.")
  list(low = low, high = high, units = units)
}

#' Script lines for the equivalence test (TOSTER::t_TOST) of one t-test, on the same
#' vectors as ps_es_ttest_lines. One sample: the values minus the test value, so that
#' the bounds are differences from it (t_TOST takes them as absolute values otherwise).
ps_tost_ttest_lines <- function(type, r, bounds, conf, mu, welch) {
  data <- switch(type,
    one = sprintf("x = y - %s", format(mu, digits = 15)),
    paired = "x = x1, y = x2, paired = TRUE",
    independent = sprintf("x = y1, y = y2, var.equal = %s", if (welch) "FALSE" else "TRUE")
  )
  c(
    sprintf(
      "# Equivalence test (TOST): bounds %s and %s (%s), alpha = %s.",
      format(bounds$low, digits = 15),
      format(bounds$high, digits = 15),
      if (bounds$units == "raw") "raw units" else "standardised mean differences",
      format(1 - conf, digits = 15)
    ),
    sprintf("%s$tost <- TOSTER::t_TOST(", r),
    sprintf("  %s,", data),
    sprintf("  low_eqbound = %s,", format(bounds$low, digits = 15)),
    sprintf("  high_eqbound = %s,", format(bounds$high, digits = 15)),
    sprintf("  eqbound_type = \"%s\",", if (bounds$units == "raw") "raw" else "SMD"),
    sprintf("  alpha = %s", format(1 - conf, digits = 15)),
    ")"
  )
}

#' One effectsize result as a row: the estimate and its interval.
ps_es_row <- function(id, x) {
  list(id = id, est = x[[1]][1], ciLow = x$CI_low[1], ciHigh = x$CI_high[1], ci = x$CI[1])
}

#' The rows of a named list of effectsize results.
ps_es_rows <- function(es) {
  if (is.null(es)) {
    return(NULL)
  }
  unname(lapply(names(es), function(k) ps_es_row(k, es[[k]])))
}

#' A t_TOST result: the two one-sided tests, the bounds in both units, the raw and
#' standardised differences with their 1 - 2 alpha intervals.
ps_tost_result <- function(t) {
  if (is.null(t)) {
    return(NULL)
  }
  tt <- t$TOST
  es <- t$effsize
  test <- function(k) list(t = tt[k, "t"], df = tt[k, "df"], p = tt[k, "p.value"])
  diff <- function(i) {
    list(
      label = rownames(es)[i],
      est = es$estimate[i],
      ciLow = es$lower.ci[i],
      ciHigh = es$upper.ci[i]
    )
  }
  list(
    lower = test("TOST Lower"),
    upper = test("TOST Upper"),
    p = max(tt["TOST Lower", "p.value"], tt["TOST Upper", "p.value"]),
    low = t$eqb$low_eq[1],
    high = t$eqb$high_eq[1],
    lowSmd = t$eqb$low_eq[2],
    highSmd = t$eqb$high_eq[2],
    raw = diff(1),
    smd = diff(2),
    level = es$conf.level[1]
  )
}

#' Script lines for the effect sizes of an ANOVA fit `fit` with its table `tab` (type I:
#' anova(fit); type III: drop1, turned into the table effectsize reads), and for one
#' factor epsilon-squared of Kruskal-Wallis (bootstrap interval, seeded).
ps_es_anova_lines <- function(ss, conf, oneway, fml, seed) {
  a <- ps_es_args(conf)
  c(
    "# Effect sizes with confidence intervals (effectsize), from the table of sums of squares.",
    if (ss == "III") {
      c(
        "terms3 <- tab[rownames(tab) != \"<none>\", ]",
        "aovTab <- data.frame(",
        "  Df = c(terms3$Df, df.residual(fit)),",
        "  \"Sum Sq\" = c(terms3$\"Sum of Sq\", sum(residuals(fit)^2)),",
        "  check.names = FALSE",
        ")",
        "aovTab$\"Mean Sq\" <- aovTab$\"Sum Sq\" / aovTab$Df",
        "aovTab$\"F value\" <- c(terms3$\"F value\", NA)",
        "aovTab$\"Pr(>F)\" <- c(terms3$\"Pr(>F)\", NA)",
        "rownames(aovTab) <- c(rownames(terms3), \"Residuals\")",
        "class(aovTab) <- c(\"anova\", \"data.frame\")"
      )
    } else {
      "aovTab <- tab"
    },
    "es <- list(",
    sprintf("  eta2 = effectsize::eta_squared(aovTab, partial = FALSE, %s),", a),
    sprintf("  partialEta2 = effectsize::eta_squared(aovTab, partial = TRUE, %s),", a),
    sprintf("  omega2 = effectsize::omega_squared(aovTab, partial = FALSE, %s),", a),
    sprintf("  partialOmega2 = effectsize::omega_squared(aovTab, partial = TRUE, %s)", a),
    ")",
    if (oneway) {
      c(
        "# Kruskal-Wallis: rank epsilon-squared, its interval by 1000 bootstrap samples.",
        sprintf("set.seed(%d)", as.integer(seed)),
        sprintf(
          "epsilon2 <- effectsize::rank_epsilon_squared(%s, data = data, iterations = 1000, %s)",
          fml,
          a
        )
      )
    }
  )
}

#' The ANOVA effect sizes by term (the term names as the table gives them).
ps_es_anova_result <- function(env, back) {
  es <- env$es
  if (is.null(es)) {
    return(NULL)
  }
  terms <- as.character(es$eta2$Parameter)
  lapply(seq_along(terms), function(i) {
    one <- function(x) list(est = x[[2]][i], ciLow = x$CI_low[i], ciHigh = x$CI_high[i])
    list(
      term = ps_back_term(terms[i], back),
      eta2 = one(es$eta2),
      partialEta2 = one(es$partialEta2),
      omega2 = one(es$omega2),
      partialOmega2 = one(es$partialOmega2)
    )
  })
}

#' Script lines for Cramer's V and (2 x 2) phi with intervals (unadjusted, as the card's
#' own V; two-sided intervals) on the table `tab`.
ps_es_contingency_lines <- function(conf) {
  a <- ps_es_args(conf)
  c(
    "# Effect sizes with confidence intervals (effectsize; unadjusted, two-sided intervals).",
    "es <- list(",
    sprintf("  cramerV = effectsize::cramers_v(tab, adjust = FALSE, %s),", a),
    sprintf("  phi = if (all(dim(tab) == 2)) effectsize::phi(tab, adjust = FALSE, %s)", a),
    ")"
  )
}

#' Equivalence bound of a correlation: 0 < r < 1 (symmetric bounds -r and r).
ps_tost_cor_bound <- function(x) {
  b <- ps_number(x, "equivalence bound of the correlation")
  if (b <= 0 || b >= 1) stop("The equivalence bound of a correlation must be between 0 and 1.")
  b
}

#' Script lines for the equivalence test of every pair (TOSTER::z_cor_test: Fisher's z;
#' Bonett-Wright and Fieller standard errors for Spearman and Kendall).
ps_tost_cor_lines <- function(method, bound, conf) {
  c(
    sprintf(
      "# Equivalence tests (TOST): is |correlation| < %s? alpha = %s.",
      format(bound, digits = 15),
      format(1 - conf, digits = 15)
    ),
    "tost <- lapply(pairs, function(p) {",
    "  ok <- complete.cases(data[[p[1]]], data[[p[2]]])",
    "  TOSTER::z_cor_test(",
    "    data[[p[1]]][ok],",
    "    data[[p[2]]][ok],",
    "    alternative = \"equivalence\",",
    sprintf("    method = \"%s\",", method),
    sprintf("    null = %s,", format(bound, digits = 15)),
    sprintf("    alpha = %s", format(1 - conf, digits = 15)),
    "  )",
    "})"
  )
}

#' One pair's equivalence test.
ps_tost_cor_result <- function(h) {
  list(
    r = unname(h$estimate),
    z = unname(h$statistic),
    p = h$p.value,
    ciLow = h$conf.int[1],
    ciHigh = h$conf.int[2],
    level = attr(h$conf.int, "conf.level")
  )
}
