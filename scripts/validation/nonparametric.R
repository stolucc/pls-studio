# Reference for the nonparametric tests of the basic-statistics cards
# (src/rengine/R/nonparametric.R): McNemar and Bowker, Cochran's Q, Dunn's test and
# Conover's test after Friedman, by base R and by the packages that implement them
# (DescTools, dunn.test, PMCMRplus: references only, they do not run in the browser),
# written without the app's code. Writes src/engine/__fixtures__/nonparametric/reference.json;
# src/rengine/nonparametric.webr.test.ts runs the cards on the data and compares.
#   Rscript scripts/validation/nonparametric.R
# The packages come from the helper's library (PS_HELPER_LIBRARY or ~/.pls-studio-helper/library).
local({
  lib <- Sys.getenv("PS_HELPER_LIBRARY", path.expand("~/.pls-studio-helper/library"))
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})
suppressPackageStartupMessages(library(jsonlite))

out <- list()

# ---- McNemar: Agresti's (1990, p. 350) presidential approval of 1600 people (?mcnemar.test),
# one row per cell with its count.
performance <- matrix(
  c(794, 86, 150, 570),
  nrow = 2,
  dimnames = list(first = c("Approve", "Disapprove"), second = c("Approve", "Disapprove"))
)
cells <- as.data.frame(as.table(performance))
out$performance <- list(
  names = c("first", "second", "count"),
  cols = list(as.integer(cells$first), as.integer(cells$second), cells$Freq),
  categories = list(first = levels(cells$first), second = levels(cells$second))
)
ht <- function(h) list(stat = unname(h$statistic), df = unname(h$parameter), p = h$p.value)
out$mcnemar <- list(
  plain = ht(mcnemar.test(performance, correct = FALSE)),
  corrected = ht(mcnemar.test(performance)),
  exactP = binom.test(150, 150 + 86, p = 0.5)$p.value
)

# ---- Bowker: a 3 x 3 table of 60 subjects without empty pairs (equals mcnemar.test) and one
# with an empty pair of cells (left out: df 2), the statistic written out.
full <- matrix(c(10, 4, 2, 9, 12, 3, 6, 1, 13), nrow = 3)
empty <- matrix(c(10, 0, 2, 0, 12, 3, 6, 1, 13), nrow = 3)
frame3 <- function(m) {
  d <- as.data.frame(as.table(m))
  list(
    names = c("before", "after", "count"),
    cols = list(as.integer(d$Var1), as.integer(d$Var2), d$Freq),
    categories = list(before = c("low", "mid", "high"), after = c("low", "mid", "high"))
  )
}
out$bowkerFull <- frame3(full)
out$bowkerEmpty <- frame3(empty)
bowker <- function(m) {
  pairs <- which(upper.tri(m), arr.ind = TRUE)
  a <- m[pairs]
  b <- m[pairs[, 2:1]]
  keep <- a + b > 0
  stat <- sum((a[keep] - b[keep])^2 / (a[keep] + b[keep]))
  list(stat = stat, df = sum(keep), p = pchisq(stat, sum(keep), lower.tail = FALSE))
}
out$bowker <- list(
  full = ht(mcnemar.test(full)),
  empty = bowker(empty)
)

writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null", na = "null"),
  "src/engine/__fixtures__/nonparametric/reference.json"
)
