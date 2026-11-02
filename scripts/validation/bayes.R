# Reference for the Bayesian tests (src/rengine/R/bayes.R), computed without
# BayesFactor: the Bayes factors and posteriors from their definitions by
# numerical integration in base R.
# - t-tests (Rouder et al. 2009, JZS): BF10 = integral of the noncentral t density
#   of the observed t over a Cauchy(0, r) prior on delta, over the central t density;
#   one-sided: the prior restricted (and renormalised) to delta > 0 or < 0.
# - Pearson correlation (Ly, Verhagen & Wagenmakers 2016): the exact likelihood of
#   r given rho (Hotelling's form, the hypergeometric function by its integral),
#   over a stretched beta(1/kappa, 1/kappa) prior on rho.
# - Binomial: beta(a, b) prior on p against p0.
# Also BayesFactor's documented value for the sleep data (paired: 17.25888).
# Writes src/engine/__fixtures__/bayes/reference.json.
#   Rscript scripts/validation/bayes.R
suppressPackageStartupMessages(library(jsonlite))
frame <- function(df) list(names = names(df), cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
  categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x))))
jzs <- function(t, N, nu, r, alt = "two.sided") {
  lo <- if (alt == "greater") 0 else -Inf; hi <- if (alt == "less") 0 else Inf
  mass <- if (alt == "two.sided") 1 else 0.5
  num <- integrate(function(d) dt(t, nu, ncp = d * sqrt(N)) * dcauchy(d, 0, r) / mass, lo, hi, rel.tol = 1e-12)$value
  num / dt(t, nu)
}
# posterior of delta (unrestricted, two-sided model): median and central interval by integration
post_delta <- function(t, N, nu, r, q = c(0.025, 0.5, 0.975)) {
  f <- function(d) dt(t, nu, ncp = d * sqrt(N)) * dcauchy(d, 0, r)
  Z <- integrate(f, -Inf, Inf, rel.tol = 1e-12)$value
  cdf <- function(x) integrate(f, -Inf, x, rel.tol = 1e-12)$value / Z
  vapply(q, function(p) uniroot(function(x) cdf(x) - p, c(-10, 10), tol = 1e-10)$root, 0)
}
out <- list()
tg <- ToothGrowth; out$toothgrowth <- frame(tg)
sl <- data.frame(drug1 = sleep$extra[1:10], drug2 = sleep$extra[11:20]); out$sleep <- frame(sl)
r0 <- sqrt(2) / 2
# paired (sleep)
d <- sl$drug1 - sl$drug2; t1 <- mean(d) / (sd(d) / sqrt(10))
out$paired <- list(bf10 = jzs(t1, 10, 9, r0), documented = 17.25888, delta = post_delta(t1, 10, 9, r0))
# independent (ToothGrowth len by supp), two-sided and one-sided
a <- split(tg$len, tg$supp); n1 <- length(a$OJ); n2 <- length(a$VC)
t2 <- t.test(a$OJ, a$VC, var.equal = TRUE)$statistic
out$independent <- list(bf10 = jzs(t2, n1 * n2 / (n1 + n2), n1 + n2 - 2, r0), greater = jzs(t2, n1 * n2 / (n1 + n2), n1 + n2 - 2, r0, "greater"),
  less = jzs(t2, n1 * n2 / (n1 + n2), n1 + n2 - 2, r0, "less"), delta = post_delta(t2, n1 * n2 / (n1 + n2), n1 + n2 - 2, r0))
# one sample (len against 18), prior width 1
t3 <- t.test(tg$len, mu = 18)$statistic
out$one <- list(bf10 = jzs(t3, 60, 59, 1), greater = jzs(t3, 60, 59, 1, "greater"))
# correlation: exact likelihood of r (Hotelling), stretched beta prior
hyp <- function(a, b, c, z) gamma(c) / (gamma(b) * gamma(c - b)) * integrate(function(t) t^(b - 1) * (1 - t)^(c - b - 1) * (1 - z * t)^(-a), 0, 1, rel.tol = 1e-12)$value
lik <- function(rho, r, n) (1 - rho^2)^((n - 1) / 2) * (1 - rho * r)^(-(n - 3 / 2)) * hyp(1 / 2, 1 / 2, n - 1 / 2, (1 + rho * r) / 2)
prior <- function(rho, k) (1 - rho^2)^(1 / k - 1) / (2^(2 / k - 1) * beta(1 / k, 1 / k))
bfcor <- function(r, n, k, alt = "two.sided") {
  lo <- if (alt == "greater") 0 else -1; hi <- if (alt == "less") 0 else 1; mass <- if (alt == "two.sided") 1 else 0.5
  num <- integrate(Vectorize(function(rho) lik(rho, r, n) * prior(rho, k) / mass), lo, hi, rel.tol = 1e-10)$value
  num / lik(0, r, n)
}
mt <- data.frame(mpg = mtcars$mpg, wt = mtcars$wt, qsec = mtcars$qsec, am = factor(mtcars$am, labels = c("automatic", "manual")))
out$mtcars <- frame(mt)
pr <- combn(c("mpg", "wt", "qsec"), 2, simplify = FALSE)
out$correlation <- lapply(pr, function(p) { r <- cor(mt[[p[1]]], mt[[p[2]]]); list(a = p[1], b = p[2], r = r, bf10 = bfcor(r, 32, 1), greater = bfcor(r, 32, 1, "greater"), width3 = bfcor(r, 32, 1 / 3)) })
# binomial: beta(1, 1) and beta(2, 3) priors, p0 = 0.5 and 0.3
bfbin <- function(k, n, p0, a, b, alt = "two.sided") {
  lo <- if (alt == "greater") p0 else 0; hi <- if (alt == "less") p0 else 1
  mass <- integrate(function(p) dbeta(p, a, b), lo, hi)$value
  integrate(function(p) dbinom(k, n, p) * dbeta(p, a, b) / mass, lo, hi, rel.tol = 1e-12)$value / dbinom(k, n, p0)
}
k <- as.numeric(table(mt$am))
out$binomial <- list(counts = k, bf = vapply(k, function(x) bfbin(x, 32, 0.5, 1, 1), 0), bfLess = vapply(k, function(x) bfbin(x, 32, 0.3, 2, 3, "less"), 0),
  median = vapply(k, function(x) qbeta(0.5, x + 1, 32 - x + 1), 0))
# BayesFactor's ?correlationBF example (iris, sepal length and width; the package's default rscale "medium" = 1/3)
out$iris <- frame(iris[, c("Sepal.Length", "Sepal.Width")])
ri <- cor(iris$Sepal.Length, iris$Sepal.Width)
out$irisCorrelation <- list(r = ri, bf10 = bfcor(ri, 150, 1 / 3))
# Linear regression (Liang et al. 2008, Zellner-Siow): BF of a model with p predictors and R2 against the intercept-only
# model = integral over g of (1 + g)^((N - p - 1)/2) (1 + g (1 - R2))^(-(N - 1)/2) times an inverse-gamma(1/2, r^2 N / 2) prior on g.
zs <- function(N, p, R2, r) integrate(function(g) exp(((N - p - 1) / 2) * log1p(g) - ((N - 1) / 2) * log1p(g * (1 - R2)) + log(r^2 * N / 2) / 2 - lgamma(1 / 2) - 1.5 * log(g) - r^2 * N / (2 * g)), 0, Inf, rel.tol = 1e-12)$value
sets <- list("wt", "hp", "qsec", c("wt", "hp"), c("wt", "qsec"), c("hp", "qsec"), c("wt", "hp", "qsec"))
out$regression <- lapply(sets, function(x) list(model = paste(x, collapse = " + "), bf10 = zs(32, length(x), summary(lm(reformulate(x, "mpg"), mtcars))$r.squared, sqrt(2) / 4)))
out$versions <- list(R = R.version.string)
dir.create("src/engine/__fixtures__/bayes", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/bayes/reference.json")
cat(out$paired$bf10, out$independent$bf10, out$correlation[[1]]$bf10, out$binomial$bf, "\n")
