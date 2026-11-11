# Reference for the robust, bootstrap and permutation alternatives (src/rengine/R/robust.R) on the
# t-test, ANOVA, correlation and regression cards, by direct calls to the packages, written without
# the app's code:
# - trimmed means: WRS2::yuen, yuend, t1way, t2way; the one-sample trimmed-mean t-test by Wilcox's
#   trimci formula with WRS2::winvar (WRS2 has no one-sample function);
# - bootstrap: boot::boot and boot.ci (percentile, BCa), seed 1234;
# - permutation: coin (approximate, seed 1234) and, as a check of the Monte Carlo p-values, coin's
#   exact distribution where it exists.
# Writes src/engine/__fixtures__/robust/reference.json; robust.webr.test.ts compares.
#   Rscript scripts/validation/robust.R
suppressPackageStartupMessages({
  library(jsonlite)
  library(WRS2)
  library(boot)
  library(coin)
})
B <- 2000
SEED <- 1234
frame <- function(df) {
  list(
    names = names(df),
    cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
    categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x)))
  )
}
boot_out <- function(b) {
  ci <- boot.ci(b, conf = 0.95, type = c("perc", "bca"))
  list(
    estimate = unname(b$t0),
    se = sd(b$t),
    percLow = ci$percent[4],
    percHigh = ci$percent[5],
    bcaLow = ci$bca[4],
    bcaHigh = ci$bca[5]
  )
}
perm_out <- function(t, exact = NULL) {
  list(
    z = as.numeric(statistic(t)),
    p = as.numeric(pvalue(t)),
    exact = if (is.null(exact)) NULL else as.numeric(pvalue(exact))
  )
}
out <- list(resamples = B, seed = SEED)

# ---- Independent samples: ToothGrowth length by supplement
tg <- ToothGrowth
tg$dose <- factor(tg$dose)
out$toothgrowth <- frame(tg)
y <- yuen(len ~ supp, data = tg, tr = 0.2)
set.seed(SEED)
b <- boot(
  data.frame(y = tg$len, g = tg$supp),
  function(d, i) mean(d$y[i][d$g[i] == "OJ"]) - mean(d$y[i][d$g[i] == "VC"]),
  R = B,
  strata = tg$supp
)
set.seed(SEED)
p <- oneway_test(len ~ supp, data = tg, distribution = approximate(nresample = B))
out$independent <- list(
  trimmed = list(estimate = y$diff, t = y$test, df = y$df, p = y$p.value, ciLow = y$conf.int[1], ciHigh = y$conf.int[2], effsize = y$effsize),
  bootstrap = boot_out(b),
  permutation = perm_out(p)
)

# ---- Paired samples: Student's sleep data, wide
s2 <- data.frame(extra.1 = sleep$extra[1:10], extra.2 = sleep$extra[11:20])
out$sleep <- frame(s2)
yd <- yuend(s2$extra.1, s2$extra.2, tr = 0.2)
dif <- s2$extra.1 - s2$extra.2
set.seed(SEED)
b <- boot(dif, function(d, i) mean(d[i]), R = B)
long <- data.frame(
  y = c(s2$extra.1, s2$extra.2),
  side = factor(rep(1:2, each = 10)),
  id = factor(rep(1:10, 2))
)
set.seed(SEED)
p <- symmetry_test(y ~ side | id, data = long, distribution = approximate(nresample = B))
pe <- symmetry_test(y ~ side | id, data = long, distribution = "exact")
out$paired <- list(
  trimmed = list(estimate = yd$diff, se = yd$se, t = yd$test, df = yd$df, p = yd$p.value, ciLow = yd$conf.int[1], ciHigh = yd$conf.int[2], effsize = yd$effsize),
  bootstrap = boot_out(b),
  permutation = perm_out(p, pe)
)

# ---- One sample: extra.1 against 0.5; Wilcox's trimci: SE = sqrt(winvar) / ((1 - 2 tr) sqrt(n))
x <- s2$extra.1
tr <- 0.2
n <- length(x)
se <- sqrt(winvar(x, tr = tr)) / ((1 - 2 * tr) * sqrt(n))
df <- n - 2 * floor(tr * n) - 1
t1 <- (mean(x, trim = tr) - 0.5) / se
set.seed(SEED)
b <- boot(x, function(d, i) mean(d[i]), R = B)
long1 <- data.frame(y = c(x - 0.5, rep(0, n)), side = factor(rep(1:2, each = n)), id = factor(rep(1:n, 2)))
set.seed(SEED)
p <- symmetry_test(y ~ side | id, data = long1, distribution = approximate(nresample = B))
pe <- symmetry_test(y ~ side | id, data = long1, distribution = "exact")
out$one <- list(
  trimmed = list(
    estimate = mean(x, trim = tr), se = se, t = t1, df = df, p = 2 * pt(-abs(t1), df),
    ciLow = mean(x, trim = tr) - qt(0.975, df) * se, ciHigh = mean(x, trim = tr) + qt(0.975, df) * se
  ),
  bootstrap = boot_out(b),
  permutation = perm_out(p, pe)
)

# ---- ANOVA: ToothGrowth length by dose (one way), by supplement and dose (two way)
set.seed(SEED)
a1 <- t1way(len ~ dose, data = tg, tr = 0.2, nboot = 100)
a2 <- t2way(len ~ supp * dose, data = tg, tr = 0.2)
set.seed(SEED)
p <- oneway_test(len ~ dose, data = tg, distribution = approximate(nresample = B))
out$anova <- list(
  t1way = list(stat = a1$test, df1 = a1$df1, df2 = a1$df2, p = a1$p.value, effsize = a1$effsize, effsizeLow = a1$effsize_ci[1], effsizeHigh = a1$effsize_ci[2]),
  t2way = list(stat = c(a2$Qa, a2$Qb, a2$Qab), p = c(a2$A.p.value, a2$B.p.value, a2$AB.p.value)),
  permutation = list(stat = as.numeric(statistic(p)), p = as.numeric(pvalue(p)))
)
# A one-way permutation test with a p-value away from zero: PlantGrowth (exact is infeasible; asymptotic beside it)
pg <- PlantGrowth
out$plantgrowth <- frame(pg)
set.seed(SEED)
p <- oneway_test(weight ~ group, data = pg, distribution = approximate(nresample = B))
out$plantPermutation <- list(
  stat = as.numeric(statistic(p)),
  p = as.numeric(pvalue(p)),
  asymptotic = as.numeric(pvalue(oneway_test(weight ~ group, data = pg)))
)

# ---- Correlations: mtcars mpg, wt, qsec (every pair, in the card's order)
mt <- mtcars[, c("mpg", "wt", "qsec")]
out$mtcars <- frame(mt)
pairs <- combn(names(mt), 2, simplify = FALSE)
cors <- list()
for (method in c("pearson", "spearman")) {
  set.seed(SEED)
  boots <- lapply(pairs, function(pr) {
    d <- data.frame(x = mt[[pr[1]]], y = mt[[pr[2]]])
    boot_out(boot(d, function(d, i) cor(d$x[i], d$y[i], method = method), R = B))
  })
  set.seed(SEED)
  perms <- lapply(pairs, function(pr) {
    d <- data.frame(x = mt[[pr[1]]], y = mt[[pr[2]]])
    t <- if (method == "spearman") {
      spearman_test(x ~ y, data = d, distribution = approximate(nresample = B))
    } else {
      independence_test(x ~ y, data = d, distribution = approximate(nresample = B))
    }
    perm_out(t)
  })
  cors[[method]] <- list(bootstrap = boots, permutation = perms)
}
out$correlation <- cors

# ---- Regression: mpg on weight and horsepower, cases resampled
mt2 <- mtcars[, c("mpg", "wt", "hp")]
out$mtcars2 <- frame(mt2)
set.seed(SEED)
b <- boot(mt2, function(d, i) coef(lm(mpg ~ wt + hp, data = d[i, ])), R = B)
out$regression <- lapply(1:3, function(j) {
  ci <- boot.ci(b, conf = 0.95, type = c("perc", "bca"), index = j)
  list(
    term = names(b$t0)[j],
    estimate = unname(b$t0[j]),
    se = sd(b$t[, j]),
    percLow = ci$percent[4],
    percHigh = ci$percent[5],
    bcaLow = ci$bca[4],
    bcaHigh = ci$bca[5]
  )
})

out$versions <- list(
  WRS2 = as.character(packageVersion("WRS2")),
  boot = as.character(packageVersion("boot")),
  coin = as.character(packageVersion("coin"))
)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"),
  file.path("src", "engine", "__fixtures__", "robust", "reference.json")
)
