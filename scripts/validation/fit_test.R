# Reference for the built-in PLS model fit test (src/engine/fit.test.ts): cSEM::testOMF (Dijkstra & Henseler's
# bootstrap test of overall model fit) on cSEM's threecommonfactors with the three-factor model, PLS (mode A, path
# weighting, not disattenuated), 2,000 bootstrap samples: the observed discrepancies (exact) and the 95% and 99%
# quantiles of their bootstrap distribution under the null (random: compared within Monte Carlo error).
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/fit_test.R
suppressPackageStartupMessages({ library(cSEM); library(jsonlite) })
model <- "eta2 ~ eta1\neta3 ~ eta1 + eta2\neta1 =~ y11 + y12 + y13\neta2 =~ y21 + y22 + y23\neta3 =~ y31 + y32 + y33"
res <- csem(threecommonfactors, model, .disattenuate = FALSE)
t <- testOMF(res, .R = 2000, .seed = 1, .alpha = c(0.05, 0.01))
stat <- t$Test_statistic; crit <- t$Critical_value
# (dG on the natural-log scale, as the app reports it: cSEM's calculateDG uses log10, so its dG times log(10)^2)
pick <- function(x) list(srmr = unname(x["SRMR"]), dULS = unname(x["dL"]), dG = unname(x["dG"]) * log(10)^2)
out <- list(observed = pick(stat), hi95 = pick(crit[, "95%"]), hi99 = pick(crit[, "99%"]), samples = 2000,
  versions = list(R = R.version.string, cSEM = as.character(packageVersion("cSEM"))))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/fittest/threecf.json")
print(stat); print(crit)
