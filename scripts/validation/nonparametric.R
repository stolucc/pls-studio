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

# ---- Cochran's Q: 15 subjects, three tasks solved (1) or not (0); DescTools::CochranQTest,
# then every pair by mcnemar.test (continuity correction) and binom.test, Holm and BH.
tasks <- data.frame(
  task1 = c(1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1),
  task2 = c(1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0),
  task3 = c(0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0)
)
out$tasks <- list(names = names(tasks), cols = unname(as.list(tasks)), categories = list())
# The same answers coded as categories "no" (1) and "yes" (2).
out$tasksLabelled <- list(
  names = names(tasks),
  cols = unname(lapply(tasks, function(x) x + 1)),
  categories = list(task1 = c("no", "yes"), task2 = c("no", "yes"), task3 = c("no", "yes"))
)
q <- DescTools::CochranQTest(as.matrix(tasks))
pairs <- combn(3, 2, simplify = FALSE)
pair_test <- function(pair) {
  tab <- table(factor(tasks[[pair[1]]], levels = 0:1), factor(tasks[[pair[2]]], levels = 0:1))
  m <- mcnemar.test(tab)
  c(
    b = tab[2, 1],
    c = tab[1, 2],
    chisq = unname(m$statistic),
    p = m$p.value,
    pExact = binom.test(tab[2, 1], tab[2, 1] + tab[1, 2])$p.value
  )
}
ph <- as.data.frame(do.call(rbind, lapply(pairs, pair_test)))
out$cochran <- list(
  q = unname(q$statistic),
  df = unname(q$parameter),
  p = q$p.value,
  proportions = unname(colMeans(tasks)),
  b = ph$b,
  c = ph$c,
  chisq = ph$chisq,
  pPairs = ph$p,
  pHolm = p.adjust(ph$p, "holm"),
  pBH = p.adjust(ph$p, "BH"),
  pExact = ph$pExact,
  pExactHolm = p.adjust(ph$pExact, "holm")
)

# ---- Dunn's test after Kruskal-Wallis: dunn.test (altp = TRUE: two-sided p) on PlantGrowth
# (no ties) and ToothGrowth's length by dose (ties), Holm, Bonferroni and Benjamini-Hochberg.
dunn_ref <- function(y, g) {
  run <- function(method) {
    invisible(capture.output(suppressMessages(
      d <- dunn.test::dunn.test(y, g, method = method, altp = TRUE, kw = FALSE, table = FALSE)
    ), type = "output"))
    d
  }
  holm <- run("holm")
  list(
    comparisons = holm$comparisons,
    z = holm$Z,
    p = holm$altP,
    pHolm = holm$altP.adjusted,
    pBonferroni = run("bonferroni")$altP.adjusted,
    pBH = run("bh")$altP.adjusted
  )
}
pg <- datasets::PlantGrowth
out$plantGrowth <- list(
  names = c("weight", "group"),
  cols = list(pg$weight, as.integer(pg$group)),
  categories = list(group = levels(pg$group))
)
out$dunnPlantGrowth <- dunn_ref(pg$weight, pg$group)
tg <- datasets::ToothGrowth
out$toothGrowth <- list(names = c("len", "dose"), cols = list(tg$len, tg$dose), categories = list())
out$dunnToothGrowth <- dunn_ref(tg$len, factor(tg$dose))

writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null", na = "null"),
  "src/engine/__fixtures__/nonparametric/reference.json"
)
