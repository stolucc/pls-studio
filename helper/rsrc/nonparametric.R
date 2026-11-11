# Nonparametric tests added to the basic-statistics cards (tests.R calls these):
# - McNemar's test of a paired 2 x 2 table (asymptotic, with and without the continuity
#   correction, and exact) and Bowker's test of symmetry of a paired k x k table.

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
