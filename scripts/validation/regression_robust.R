# Reference for the regression card's robust standard errors (src/rengine/regression.webr.test.ts): HC0, HC3 and
# cluster-robust standard errors of the ?infert logistic regression, run natively. HC0 is also computed by hand
# (bread × meat × bread of the logistic scores) as an independent check of sandwich::vcovHC.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/regression_robust.R
suppressPackageStartupMessages({
  library(sandwich)
  library(jsonlite)
})
fit <- glm(case ~ spontaneous + induced, data = infert, family = binomial())

# HC0 by hand: (X'WX)^-1 (Σ s_i s_i') (X'WX)^-1, with s_i = x_i (y_i - μ_i) and W = μ(1 - μ).
X <- model.matrix(fit)
mu <- fitted(fit)
bread <- solve(crossprod(X * sqrt(mu * (1 - mu))))
scores <- X * (infert$case - mu)
hc0_hand <- bread %*% crossprod(scores) %*% bread

ses <- function(v) as.list(setNames(sqrt(diag(v)), colnames(X)))
out <- list(
  coefficients = as.list(coef(fit)),
  model = ses(vcov(fit)),
  HC0 = ses(vcovHC(fit, type = "HC0")),
  HC0_hand = ses(hc0_hand),
  HC3 = ses(vcovHC(fit, type = "HC3")),
  cluster = ses(vcovCL(fit, cluster = ~stratum, data = infert)),
  versions = list(R = R.version.string, sandwich = as.character(packageVersion("sandwich")))
)
# (agree to ~5e-9: sandwich takes the bread from glm's last IRLS weights, the hand version from the final fitted values)
stopifnot(isTRUE(all.equal(unlist(out$HC0), unlist(out$HC0_hand), tolerance = 1e-7)))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/regression/robust.json")
cat("written\n")
