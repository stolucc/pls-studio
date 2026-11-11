# Reference for inverse probability weighting (WeightIt): lalonde (MatchIt), the
# ATT with logistic propensity scores, as in WeightIt's vignette "Estimating
# effects after weighting": IPW (lm_weightit of re78 on treat) and doubly robust
# (with the covariates and their interactions, g-computation over the treated).
#   R_LIBS=/path/to/lib Rscript scripts/validation/weightit.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(WeightIt)
  library(cobalt)
  library(marginaleffects)
})
data("lalonde", package = "MatchIt")
W <- weightit(treat ~ age + educ + race + married + nodegree + re74 + re75, data = lalonde, method = "glm", estimand = "ATT")
ipw <- as.data.frame(avg_comparisons(lm_weightit(re78 ~ treat, data = lalonde, weightit = W), variables = "treat"))
dr <- as.data.frame(avg_comparisons(lm_weightit(re78 ~ treat * (age + educ + race + married + nodegree + re74 + re75), data = lalonde, weightit = W),
  variables = "treat", newdata = subset(lalonde, treat == 1)
))
b <- bal.tab(W, un = TRUE, stats = c("mean.diffs", "variance.ratios"), binary = "std", continuous = "std")$Balance
out <- list(
  WeightIt = as.character(packageVersion("WeightIt")), marginaleffects = as.character(packageVersion("marginaleffects")),
  ipw = list(est = ipw$estimate, se = ipw$std.error), dr = list(est = dr$estimate, se = dr$std.error, low = dr$conf.low, high = dr$conf.high),
  essControl = summary(W)$effective.sample.size["Weighted", "Control"], ageAfter = b["age", "Diff.Adj"]
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/match/weightit.json")
cat("written\n")
