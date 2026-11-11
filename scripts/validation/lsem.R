# Native reference for the Local SEM card (src/analyses/invariance.tsx, R/invariance.R ps_lsem): sirt's help page
# ?lsem.estimate, example 1, model 1 as written (data.lsem01, age differentiation; h = 2, focal points 4 to 23),
# run in desktop R independently of the app's bridge, then lsem.bootstrap and lsem.permutationTest each after
# set.seed(1234) (the project's default seed), as the card runs them. A second fit with an Epanechnikov kernel,
# h = 1.1 and 8 focal points checks the options; the help page's example 2 (FIML with missing values) checks FIML.
# Writes src/engine/__fixtures__/invariance/lsem.json; cards/invariance.webr.test.ts compares the card with it.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/lsem.R
suppressPackageStartupMessages({
  library(lavaan)
  library(sirt)
  library(jsonlite)
})
data(data.lsem01, package = "sirt")
dat <- data.lsem01
lavmodel <- "
        F=~ v1+v2+v3+v4+v5
        F ~~ 1*F"
moderator.grid <- seq(4, 23, 1)
mod1 <- sirt::lsem.estimate(dat, moderator = "age", moderator.grid = moderator.grid, lavmodel = lavmodel, h = 2, std.lv = TRUE, verbose = FALSE)
set.seed(1234)
bmod1 <- sirt::lsem.bootstrap(mod1, R = 20, verbose = FALSE)
set.seed(1234)
pmod1 <- sirt::lsem.permutationTest(mod1, B = 10, verbose = FALSE)
mod2 <- sirt::lsem.estimate(dat, moderator = "age", moderator.grid = seq(4, 23, length.out = 8), lavmodel = lavmodel, h = 1.1, kernel = "epanechnikov", std.lv = TRUE, verbose = FALSE)
# Example 2 (FIML with missing data) as written: values of v1 and v2 deleted at random, the model fitted by FIML
dat2 <- data.lsem01
set.seed(98)
dat2[stats::runif(nrow(dat2)) < .5, c("v1")] <- NA
dat2[stats::runif(nrow(dat2)) < .25, c("v2")] <- NA
lavmodel1 <- "
        F=~ v1+v2+v3+v4+v5
        F ~~ 1*F"
mod3 <- sirt::lsem.estimate(dat2, moderator = "age", moderator.grid = seq(4, 23, 2), lavmodel = lavmodel1, h = 2, std.lv = TRUE, estimator = "ML", missing = "fiml", verbose = FALSE)

curves <- function(P) {
  lapply(split(P, factor(P$par, levels = unique(P$par))), function(r) {
    r <- r[order(r$grid_index), ]
    list(est = r$est, se = r$se)
  })
}
summ <- function(S) setNames(lapply(seq_len(nrow(S)), function(i) list(mean = S$M[i], sd = S$SD[i], mad = S$MAD[i], min = S$Min[i], max = S$Max[i], linSlope = S$lin_slo[i], sdNonlin = S$SD_nonlin[i])), S$par)
out <- list(
  sirt = as.character(packageVersion("sirt")), lavaan = as.character(packageVersion("lavaan")), R = paste(R.version$major, R.version$minor, sep = "."),
  model1 = list(
    pars = unique(mod1$parameters$par), grid = mod1$moderator.grid, h = mod1$h, bw = mod1$bw, n = mod1$N,
    weight = mod1$moderator.density$wgt, neff = mod1$moderator.density$Neff, curves = curves(mod1$parameters), summary = summ(mod1$parameters_summary),
    boot = lapply(split(bmod1$parameters, factor(bmod1$parameters$par, levels = unique(bmod1$parameters$par))), function(r) {
      r <- r[order(r$grid_index), ]
      list(se = r$se, lower = r$ci.lower, upper = r$ci.upper)
    }),
    perm = setNames(lapply(seq_len(nrow(pmod1$teststat)), function(i) {
      t <- pmod1$teststat[i, ]
      w <- pmod1$parameters_pointwise_test
      w <- w[w$par == t$par, ]
      list(sdP = t$SD_p, madP = t$MAD_p, linSlopeP = t$lin_slo_p, pointwise = w$p[order(w$grid_index)])
    }), pmod1$teststat$par)
  ),
  model2 = list(grid = mod2$moderator.grid, bw = mod2$bw, curves = curves(mod2$parameters), summary = summ(mod2$parameters_summary)),
  fiml = list(missingV1 = which(is.na(dat2$v1)), missingV2 = which(is.na(dat2$v2)), grid = mod3$moderator.grid, curves = curves(mod3$parameters))
)
dir <- file.path("src", "engine", "__fixtures__", "invariance")
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(dir, "lsem.json"))
cat("Wrote", file.path(dir, "lsem.json"), "\n")
