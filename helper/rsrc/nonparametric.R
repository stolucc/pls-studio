# Nonparametric tests added to the basic-statistics cards (tests.R calls these):
# - McNemar's test of a paired 2 x 2 table (asymptotic, with and without the continuity
#   correction, and exact) and Bowker's test of symmetry of a paired k x k table;
# - Cochran's Q test of k related binary measures, with pairwise McNemar tests;
# - Dunn's test after Kruskal-Wallis.

#' Script lines of the paired tests of a contingency table: the rows and the columns
#' are the same subjects' two measurements on the same categories (already factors
#' `rv` and `cv` of `data`; `wv` the counts or ""). The table is made square on the
#' categories of both.
ps_mcnemar_lines <- function(rv, cv, wv) {
  c(
    "# Paired: the same subjects measured twice on the same categories, a square table.",
    sprintf("lev <- union(levels(data$%s), levels(data$%s))", rv, cv),
    sprintf(
      "ptab <- xtabs(%s~ factor(%s, levels = lev) + factor(%s, levels = lev), data = data)",
      if (nzchar(wv)) paste0(wv, " ") else "",
      rv,
      cv
    ),
    "if (length(lev) == 2) {",
    "  mcnemar <- mcnemar.test(ptab, correct = FALSE)",
    "  mcnemarCC <- mcnemar.test(ptab, correct = TRUE)  # with the continuity correction",
    "  # Exact: the discordant pairs, one direction against the other, binomial with p = 1/2.",
    "  mcnemarExact <- binom.test(ptab[1, 2], ptab[1, 2] + ptab[2, 1], p = 0.5)",
    "} else {",
    "  # Bowker's test of symmetry over the pairs of cells (i, j) and (j, i) that hold any",
    "  # subjects (as mcnemar.test(ptab) when none is empty).",
    "  upper <- upper.tri(ptab)",
    "  above <- ptab[upper]",
    "  below <- t(ptab)[upper]",
    "  used <- above + below > 0",
    "  bowkerStat <- sum((above[used] - below[used])^2 / (above[used] + below[used]))",
    "  bowkerDf <- sum(used)",
    "  bowkerP <- pchisq(bowkerStat, bowkerDf, lower.tail = FALSE)",
    "  if (bowkerDf == 0) bowkerP <- 1  # no subject changed category: symmetric",
    "}"
  )
}

#' The paired tests' results from the run.
ps_mcnemar_result <- function(env) {
  tab <- env$ptab
  two <- length(env$lev) == 2
  list(
    levels = env$lev,
    counts = lapply(seq_len(nrow(tab)), function(i) unname(as.numeric(tab[i, ]))),
    mcnemar = if (two) ps_htest(env$mcnemar),
    mcnemarCorrected = if (two) ps_htest(env$mcnemarCC),
    exact = if (two) {
      list(
        p = env$mcnemarExact$p.value,
        b = unname(tab[1, 2]),
        c = unname(tab[2, 1])
      )
    },
    bowker = if (!two) {
      list(stat = env$bowkerStat, df = env$bowkerDf, p = env$bowkerP)
    }
  )
}

# ---- Multiple comparisons

PS_P_ADJUST <- c("holm", "bonferroni", "BH")

#' The request's p-value adjustment of the post hoc comparisons (absent: Holm).
ps_p_adjust <- function(req) {
  method <- req$adjust %||% "holm"
  if (!is.character(method) || length(method) != 1 || !method %in% PS_P_ADJUST) {
    stop("Invalid p-value adjustment in the request.")
  }
  method
}

# ---- Cochran's Q: k related binary measures (the freqtest card's type "cochran")

#' Cochran's Q test of k related binary measures (one column per measure, one row per
#' subject), with every pair of measures compared by McNemar's test (continuity-corrected,
#' as mcnemar.test, and exact), the p-values adjusted.
ps_cochran <- function(req, export) {
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two binary measures.")
  adjust <- ps_p_adjust(req)
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  body <- c(
    sprintf("X <- data[complete.cases(data[, %s]), %s, drop = FALSE]", ps_q(v), ps_q(v)),
    ps_agreement_ratings(req, fr, vars),
    "values <- sort(unique(c(ratings)))",
    "if (length(values) != 2) stop(\"Cochran's Q needs binary measures: two values in all the columns.\")",
    "Y <- (ratings == values[2]) * 1  # 1: the second value (category), 0: the first",
    "# Cochran's Q from the measures' and the subjects' totals.",
    "k <- ncol(Y)",
    "measureTotals <- colSums(Y)",
    "subjectTotals <- rowSums(Y)",
    "total <- sum(Y)",
    "denominator <- k * total - sum(subjectTotals^2)",
    "if (denominator == 0) stop(\"Every subject has the same value on all the measures: Cochran's Q is undefined.\")",
    "Q <- (k - 1) * (k * sum(measureTotals^2) - total^2) / denominator",
    "pQ <- pchisq(Q, k - 1, lower.tail = FALSE)",
    sprintf("# Post hoc: every pair of measures by McNemar's test, p adjusted (%s).", adjust),
    "pairs <- combn(k, 2, simplify = FALSE)",
    "mcnemarPair <- function(pair) {",
    "  tab <- table(factor(Y[, pair[1]], levels = 0:1), factor(Y[, pair[2]], levels = 0:1))",
    "  b <- tab[2, 1]  # 1 on the first measure, 0 on the second",
    "  c <- tab[1, 2]",
    "  if (b + c == 0) {",
    "    return(c(b = b, c = c, chisq = 0, p = 1, pExact = 1))",
    "  }",
    "  test <- mcnemar.test(tab)  # with the continuity correction, R's default",
    "  exact <- binom.test(b, b + c, p = 0.5)",
    "  c(b = b, c = c, chisq = unname(test$statistic), p = test$p.value, pExact = exact$p.value)",
    "}",
    "posthoc <- as.data.frame(do.call(rbind, lapply(pairs, mcnemarPair)))",
    sprintf("posthoc$pAdjusted <- p.adjust(posthoc$p, method = \"%s\")", adjust),
    sprintf("posthoc$pExactAdjusted <- p.adjust(posthoc$pExact, method = \"%s\")", adjust)
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c("c(Q = Q, df = k - 1, p = pQ)", "colMeans(Y)", "posthoc")
    return(ps_script("Cochran's Q test", character(0), inputs, body, report))
  }
  env <- ps_run(body, inputs)
  ph <- env$posthoc
  ps_json(list(
    type = "cochran",
    variable = "",
    vars = vars,
    n = nrow(env$Y),
    success = ps_agreement_labels(env, env$values[2]),
    proportions = unname(colMeans(env$Y)),
    cochran = list(stat = env$Q, df = env$k - 1, p = env$pQ),
    posthoc = lapply(seq_along(env$pairs), function(i) {
      pair <- env$pairs[[i]]
      list(
        comparison = paste(vars[pair[1]], "-", vars[pair[2]]),
        b = ph$b[i],
        c = ph$c[i],
        chisq = ph$chisq[i],
        p = ph$p[i],
        pAdjusted = ph$pAdjusted[i],
        pExact = ph$pExact[i],
        pExactAdjusted = ph$pExactAdjusted[i]
      )
    }),
    adjust = adjust,
    confidence = ps_bt_conf(req),
    warnings = env$.warnings,
    engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

# ---- Dunn's test after Kruskal-Wallis (the ANOVA card with one factor)

#' Script lines of Dunn's (1964) test of every pair of groups: the difference of the
#' groups' mean ranks over its standard error, with the correction for ties, two-sided
#' normal p-values, adjusted (`adjust`). `y` and `g` name the dependent variable and the
#' factor (a factor) in `data`.
ps_dunn_lines <- function(y, g, adjust) {
  c(
    sprintf("# After Kruskal-Wallis: Dunn's test of every pair of groups, p adjusted (%s).", adjust),
    sprintf("ranks <- rank(data$%s)", y),
    "N <- length(ranks)",
    "tied <- table(ranks)",
    "tieCorrection <- sum(tied^3 - tied) / (12 * (N - 1))",
    sprintf("meanRank <- tapply(ranks, data$%s, mean)", g),
    sprintf("groupSize <- tapply(ranks, data$%s, length)", g),
    "dunnPairs <- combn(length(meanRank), 2, simplify = FALSE)",
    "dunnPair <- function(pair) {",
    "  i <- pair[1]",
    "  j <- pair[2]",
    "  se <- sqrt((N * (N + 1) / 12 - tieCorrection) * (1 / groupSize[[i]] + 1 / groupSize[[j]]))",
    "  z <- (meanRank[[i]] - meanRank[[j]]) / se",
    "  c(z = z, p = 2 * pnorm(-abs(z)))",
    "}",
    "dunn <- as.data.frame(do.call(rbind, lapply(dunnPairs, dunnPair)))",
    "dunn$comparison <- vapply(dunnPairs, function(pair) paste(names(meanRank)[pair], collapse = \" - \"), \"\")",
    sprintf("dunn$pAdjusted <- p.adjust(dunn$p, method = \"%s\")", adjust)
  )
}

#' Dunn's comparisons from the run.
ps_dunn_result <- function(env) {
  d <- env$dunn
  lapply(seq_len(nrow(d)), function(i) {
    list(comparison = d$comparison[i], z = d$z[i], p = d$p[i], pAdjusted = d$pAdjusted[i])
  })
}
