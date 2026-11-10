# Native reference for the multivariate LM and Wald tests (src/rengine/search.webr.test.ts), EQS's stepwise
# procedures (Bentler 1986; Chou & Bentler 1990) on the Holzinger & Swineford data (lavaan's ?cfa):
#  - LM, forward: model A (three factors, textual ~ visual, speed ~ textual). Candidates: every fixed-at-zero loading,
#    path and covariance of modindices(); at each step the candidate that raises the multivariate score statistic
#    (lavTestScore of the set) most is added while its increment is significant at .05. Recorded with lavaan's own
#    lavTestScore(cumulative = TRUE) of the selected set, whose last row is the multivariate statistic of the set.
#  - Wald, backward: model B (model A with speed ~ visual and three residual covariances). Candidates: the free paths
#    and covariances; at each step the one that raises lavTestWald's statistic of "all dropped = 0" least is dropped
#    while neither the increment nor the multivariate statistic is significant at .05.
# Run: Rscript scripts/validation/lmwald.R  (writes src/engine/__fixtures__/search/lmwald.json)
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
hs <- HolzingerSwineford1939
A <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\ntextual ~ visual\nspeed ~ textual"
B <- paste(A, "speed ~ visual", "x1 ~~ x4", "x2 ~~ x7", "x3 ~~ x5", sep = "\n")
alpha <- 0.05

fa <- sem(A, data = hs, estimator = "ML", auto.cov.y = FALSE)
mi <- modindices(fa)
mi <- mi[mi$op %in% c("=~", "~", "~~") & (mi$op != "~~" | mi$lhs != mi$rhs), ]
pool <- paste(mi$lhs, mi$op, mi$rhs)
score <- function(set) lavTestScore(fa, add = paste(set, collapse = "\n"), univariate = FALSE)$test$X2
chosen <- character(0); lm <- list(); last <- 0
repeat {
  left <- pool[!pool %in% chosen]
  if (!length(left)) break
  s <- sapply(left, function(p) score(c(chosen, p)))
  if (1 - pchisq(max(s) - last, 1) > alpha) break
  chosen <- c(chosen, left[which.max(s)])
  lm[[length(lm) + 1]] <- list(parameter = left[which.max(s)], chisq = max(s), df = length(chosen), increment = max(s) - last)
  last <- max(s)
}
cumul <- lavTestScore(fa, add = paste(chosen, collapse = "\n"), cumulative = TRUE)$cumulative

fb <- sem(B, data = hs, estimator = "ML", auto.cov.y = FALSE)
pt <- parTable(fb)
cand <- pt[pt$free > 0 & pt$op %in% c("~", "~~") & pt$lhs != pt$rhs, ]
wald <- function(set) lavTestWald(fb, constraints = paste(paste(set, "== 0"), collapse = "\n"))$stat
gone <- character(0); wd <- list(); last <- 0
repeat {
  left <- setdiff(cand$plabel, gone)
  if (!length(left)) break
  w <- sapply(left, function(p) wald(c(gone, p)))
  if (1 - pchisq(min(w) - last, 1) < alpha || 1 - pchisq(min(w), length(gone) + 1) < alpha) break
  j <- match(left[which.min(w)], cand$plabel)
  gone <- c(gone, left[which.min(w)])
  wd[[length(wd) + 1]] <- list(parameter = paste(cand$lhs[j], cand$op[j], cand$rhs[j]), chisq = min(w), df = length(gone), increment = min(w) - last)
  last <- min(w)
}
out <- list(versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), lm = lm, lmCandidates = length(pool),
  lavaanCumulative = list(parameters = paste(cumul$lhs, cumul$rhs), chisq = cumul$X2, df = cumul$df), wald = wd, waldCandidates = nrow(cand))
dir.create("src/engine/__fixtures__/search", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/search/lmwald.json")
str(lm); str(wd); print(cumul)
