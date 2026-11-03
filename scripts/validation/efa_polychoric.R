# Reference results for exploratory factor analysis of ordinal items on polychoric correlations
# (psych, cor = "mixed") from desktop R: the Big Five items (bfi, six-point) with age (continuous,
# polyserial), minres with oblimin rotation, five factors. The correlation matrix is also computed by
# lavaan (lavCor, ordinal items declared; an independent implementation) on the complete cases: the
# polychoric correlations agree within 1e-4; the polyserial ones with age differ by up to .02, the two
# packages' polyserial estimators being different (psych's ad hoc, lavaan's two-step maximum likelihood).
#
#   Rscript scripts/validation/efa_polychoric.R

suppressMessages({ library(psych); library(GPArotation); library(lavaan); library(jsonlite) })
options(mc.cores = 1)
root <- "src/engine/__fixtures__/efa"
vars <- c(colnames(bfi)[1:25], "age")
X <- bfi[, vars]
R <- mixedCor(X)$rho
f <- fa(X, nfactors = 5, fm = "minres", rotate = "oblimin", cor = "mixed")
pearson <- fa(X, nfactors = 5, fm = "minres", rotate = "oblimin")
cc <- X[complete.cases(X), ]
Rcc <- mixedCor(cc)$rho
Rlav <- lavCor(cc, ordered = colnames(bfi)[1:25])
set.seed(1)
par <- fa.parallel(X, fm = "minres", fa = "fa", n.iter = 5, cor = "mixed", plot = FALSE)
out <- list(psych = as.character(packageVersion("psych")), vars = vars,
  cor = unname(R), kmo = unname(KMO(R)$MSA), eigenvalues = unname(eigen(R, symmetric = TRUE, only.values = TRUE)$values),
  loadings = unname(unclass(f$loadings)), communality = unname(f$communality[vars]),
  # the polychoric solution's loadings are larger than Pearson's: the mean of each item's largest |loading|
  meanTopLoading = c(polychoric = mean(apply(abs(unclass(f$loadings)), 1, max)), pearson = mean(apply(abs(unclass(pearson$loadings)), 1, max))),
  completeCases = list(n = nrow(cc), psych = unname(Rcc), lavaan = unname(unclass(Rlav)[vars, vars])),
  parallelObserved = unname(par$fa.values))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "polychoric.json"))
cat("written\n")
