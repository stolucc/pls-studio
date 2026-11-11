# Reference results for nonlinear (polynomial, WarpPLS-style) structural paths on PLS construct scores:
# seminr's construct scores on mobi, then lm() of each endogenous construct on polynomial terms of its
# predictors' scores (raw powers I(x^2), I(x^3)). The scores are recorded so the test can feed exactly
# these to the built-in engine's regression (independent of its own PLS estimation).
#   Rscript scripts/validation/nonlinear_paths.R [R library]
args <- commandArgs(trailingOnly = TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressPackageStartupMessages({
  library(seminr)
  library(jsonlite)
})
d <- read.csv("src/engine/__fixtures__/mobi.csv")
m <- suppressMessages(estimate_pls(d, constructs(
  composite("Image", multi_items("IMAG", 1:5)), composite("Expectation", multi_items("CUEX", 1:3)),
  composite("Value", multi_items("PERV", 1:2)), composite("Satisfaction", multi_items("CUSA", 1:3)),
  composite("Loyalty", multi_items("CUSL", 1:3))
), relationships(
  paths(from = c("Image", "Expectation", "Value"), to = "Satisfaction"), paths(from = c("Satisfaction", "Image"), to = "Loyalty")
)))
S <- as.data.frame(m$construct_scores)
# Shapes: Image -> Satisfaction quadratic, Value -> Satisfaction cubic, Expectation -> Satisfaction linear;
# Satisfaction -> Loyalty quadratic, Image -> Loyalty linear.
fits <- list(
  Satisfaction = lm(Satisfaction ~ Image + I(Image^2) + Expectation + Value + I(Value^2) + I(Value^3), data = S),
  Loyalty = lm(Loyalty ~ Satisfaction + I(Satisfaction^2) + Image, data = S)
)
linear <- list(Satisfaction = lm(Satisfaction ~ Image + Expectation + Value, data = S), Loyalty = lm(Loyalty ~ Satisfaction + Image, data = S))
out <- list(
  seminr = as.character(packageVersion("seminr")),
  scores = as.list(S),
  equations = lapply(names(fits), function(k) {
    co <- summary(fits[[k]])$coefficients
    list(
      to = k, terms = rownames(co), b = unname(co[, 1]), se = unname(co[, 2]), p = unname(co[, 4]),
      r2 = summary(fits[[k]])$r.squared, r2Linear = summary(linear[[k]])$r.squared
    )
  })
)
write_json(out, "src/engine/__fixtures__/nonlinear/reference.json", auto_unbox = TRUE, digits = 14)
