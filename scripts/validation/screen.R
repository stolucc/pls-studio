# Reference for Data screening (independent of PLS Studio's code):
#   - psych::describe and psych::mardia, and Mahalanobis distances, on lavaan's
#     HolzingerSwineford1939 x1-x9 with x1 missing in rows 3 and 10
#   - semfindr's ?cfa_dat2 CFA: leave-one-out influence (lavaan_rerun +
#     influence_stat), generalized Cook's distance and fit change per case
#   - each case's contribution to Mardia's multivariate kurtosis of cfa_dat2's x1-x6:
#     psych::mardia's b2p and the cases' d_i^4 / n (they sum to it)
#   R_LIBS=/path/to/lib Rscript scripts/validation/screen.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
  library(lavaan)
  library(semfindr)
})
X <- HolzingerSwineford1939[, paste0("x", 1:9)]
X$x1[c(3, 10)] <- NA
d <- describe(X)
Xc <- X[complete.cases(X), ]
m <- mardia(Xc, plot = FALSE)
d2 <- mahalanobis(Xc, colMeans(Xc), cov(Xc))
fit <- cfa("f1 =~ x1 + x2 + x3\nf2 =~ x4 + x5 + x6", cfa_dat2)
infl <- influence_stat(lavaan_rerun(fit, parallel = FALSE, progress = FALSE))
o <- order(-infl[, "gcd"])[1:5]
Xk <- as.matrix(cfa_dat2[, paste0("x", 1:6)])
mk <- mardia(Xk, plot = FALSE)
contrib <- mahalanobis(Xk, colMeans(Xk), cov(Xk))^2 / nrow(Xk)
ok <- order(-contrib)[1:5]
out <- list(
  psych = as.character(packageVersion("psych")), semfindr = as.character(packageVersion("semfindr")),
  describe = list(skew = d$skew, kurtosis = d$kurtosis, sd = d$sd, n = d$n),
  mardia = list(b1p = m$b1p, b2p = m$b2p, skew = m$skew, pSkew = m$p.skew, kurtosis = m$kurtosis, pKurt = m$p.kurt),
  mahalanobis = list(rows = as.integer(rownames(Xc))[order(-d2)[1:5]], d2 = unname(sort(d2, decreasing = TRUE)[1:5])),
  influence = list(
    rows = as.integer(rownames(infl))[o],
    gcd = unname(infl[o, "gcd"]),
    chisq = unname(infl[o, "chisq"]),
    cfi = unname(infl[o, "cfi"])
  ),
  kurtosis = list(b2p = mk$b2p, rows = ok, contribution = unname(contrib[ok]), sum = sum(contrib))
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/screen/reference.json")
cat("written\n")
