# Reference results for the dominance analysis card (analyses/dominance.tsx, R ps_dominance) on its example
# (packages.ts: swiss-dominance): domir (Luchman) fits lm() on every subset of the predictors and gives general,
# conditional and complete dominance; relaimpo's LMG is general dominance by another route. The fungible weights'
# ranges (Waller 2008) from fungible::fungible's own construction, at the unit vectors that make each weight
# largest and smallest, with its random draws checked to fall inside them. None of these packages ships
# with the app, so install them in a library of their own:
#   R_LIBS=/path/to/scratch/library Rscript scripts/validation/dominance.R
# Writes src/engine/__fixtures__/dominance/reference.json.

suppressPackageStartupMessages({
  library(domir)
  library(relaimpo)
  library(fungible)
  library(jsonlite)
})
f <- Fertility ~ Agriculture + Examination + Education + Catholic + Infant.Mortality
d <- domir(f, function(f) summary(lm(f, data = swiss))$r.squared)
lmg <- calc.relimp(lm(f, data = swiss), type = "lmg")$lmg
stopifnot(isTRUE(all.equal(unname(lmg), unname(d$General_Dominance), tolerance = 1e-12)))
# Fungible weights at a loss of R-squared of .01, the card's default
preds <- names(d$General_Dominance)
R.X <- cor(swiss[, preds])
rxy <- cor(swiss[, preds], swiss$Fertility)
loss <- 0.01
b <- solve(R.X, rxy)
R2 <- sum(b * rxy)
r <- sqrt((R2 - loss) / R2)
set.seed(20081)
invisible(capture.output(fw <- fungible(R.X, rxy, r, sets = 20000, print = FALSE)))
# As fungible() builds each alternative: k = r u + sqrt(1 - r^2) U z, a = V L^(-1/2) k, rescaled by least squares
VLV <- eigen(R.X)
V <- VLV$vectors
L <- VLV$values
u <- sqrt(L) * (t(V) %*% b)
u <- u / sqrt(sum(u^2))
U <- qr.Q(qr(cbind(u, matrix(rnorm(length(L) * (length(L) - 1)), length(L)))))[, -1]
G <- V %*% diag(1 / sqrt(L)) %*% U
weight_at <- function(z) {
  a <- V %*% ((r * u + sqrt(1 - r^2) * U %*% z) / sqrt(L))
  a <- as.numeric((t(rxy) %*% a) / (t(a) %*% R.X %*% a)) * a
  stopifnot(abs(as.numeric(t(a) %*% rxy)^2 / as.numeric(t(a) %*% R.X %*% a) - (R2 - loss)) < 1e-12)
  a
}
extreme <- sapply(seq_along(L), function(j) {
  z <- G[j, ] / sqrt(sum(G[j, ]^2))
  c(lower = weight_at(-z)[j], upper = weight_at(z)[j])
})
stopifnot(all(apply(fw$a, 2, max) <= extreme["upper", ] + 1e-12), all(apply(fw$a, 2, min) >= extreme["lower", ] - 1e-12))
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  domir = as.character(packageVersion("domir")),
  relaimpo = as.character(packageVersion("relaimpo")),
  predictors = names(d$General_Dominance),
  r2 = d$Value,
  general = unname(d$General_Dominance),
  lmg = unname(lmg),
  conditional = unname(d$Conditional_Dominance),
  # [i][j]: the share of the subsets of the other predictors to which i adds more than j
  complete = unname(d$Complete_Dominance),
  fungible = as.character(packageVersion("fungible")),
  fungibleLoss = loss,
  fungibleR = r,
  fungibleLower = unname(extreme["lower", ]),
  fungibleUpper = unname(extreme["upper", ]),
  # the largest and smallest of fungible()'s 20,000 random draws (seed 20081): inside the ranges
  fungibleDrawMin = unname(apply(fw$a, 2, min)),
  fungibleDrawMax = unname(apply(fw$a, 2, max))
)
write_json(out, "src/engine/__fixtures__/dominance/reference.json", digits = NA, auto_unbox = TRUE, pretty = TRUE,
  na = "null")
cat("written\n")
