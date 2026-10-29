# Reference results for matching, from plain package calls (independent of PLS
# Studio's code): MatchIt's vignettes on lalonde (?matchit): 1:1 nearest-
# neighbour propensity score matching (ATT) and full matching (ATT and ATE);
# balance by cobalt; the effect by marginaleffects::avg_comparisons as in the
# vignette "Estimating effects after matching" (outcome model without
# covariates; cluster-robust by subclass).
#   R_LIBS=/path/to/lib Rscript scripts/validation/match.R

suppressPackageStartupMessages({ library(jsonlite); library(MatchIt); library(cobalt); library(marginaleffects) })
data("lalonde", package = "MatchIt")
f <- treat ~ age + educ + race + married + nodegree + re74 + re75
one <- function(m, vc) {
  md <- match.data(m)
  fit <- lm(re78 ~ treat, data = md, weights = weights)
  ac <- avg_comparisons(fit, variables = "treat", vcov = vc, newdata = subset(md, treat == 1), wts = "weights")
  b <- bal.tab(m, un = TRUE, stats = c("mean.diffs", "variance.ratios"), binary = "std", continuous = "std")$Balance
  list(nn = unname(summary(m)$nn[, 2]), diffAfter = setNames(as.list(b$Diff.Adj), rownames(b)), effect = list(est = ac$estimate, se = ac$std.error))
}
set.seed(1)
out <- list(versions = c(MatchIt = as.character(packageVersion("MatchIt")), cobalt = as.character(packageVersion("cobalt"))),
  nearest = one(matchit(f, data = lalonde, method = "nearest", distance = "glm"), ~subclass),
  full = one(matchit(f, data = lalonde, method = "full", distance = "glm", estimand = "ATT"), ~subclass))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/match/reference.json")
cat(toJSON(out[c("nearest")], auto_unbox = TRUE, digits = 6), "\n")
