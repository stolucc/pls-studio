# Reference results for PLS-SEM interaction terms built by seminr's three approaches
# (interaction_term(method = two_stage / product_indicator / orthogonal); Henseler & Chin 2010,
# Chin, Marcolin & Newsted 2003, Little, Bovaird & Widaman 2006), from plain seminr calls on
# seminr's mobi data (independent of PLS Studio's code). One moderation, and two at once.
#   Rscript scripts/validation/pls_interaction_methods.R [R library]
args <- commandArgs(trailingOnly = TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressPackageStartupMessages({ library(seminr); library(jsonlite) })
d <- read.csv("src/engine/__fixtures__/mobi.csv")
measurement <- function(method, two = FALSE) do.call(constructs, c(list(
  composite("Image", multi_items("IMAG", 1:5)), composite("Expectation", multi_items("CUEX", 1:3)),
  composite("Value", multi_items("PERV", 1:2)), composite("Satisfaction", multi_items("CUSA", 1:3)),
  composite("Loyalty", multi_items("CUSL", 1:3)),
  interaction_term(iv = "Image", moderator = "Expectation", method = method)),
  if (two) list(interaction_term(iv = "Value", moderator = "Expectation", method = method)) else list()))
structure <- function(two = FALSE) relationships(
  paths(from = c("Image", "Expectation", "Value", "Image*Expectation", if (two) "Value*Expectation"), to = "Satisfaction"),
  paths(from = "Satisfaction", to = "Loyalty"))
fit_of <- function(method, two = FALSE) {
  m <- suppressMessages(estimate_pls(d, measurement(method, two), structure(two)))
  B <- m$path_coef
  W <- m$outer_weights; L <- m$outer_loadings
  int <- grep("\\*", colnames(W), value = TRUE)
  list(
    constructs = rownames(B), paths = unname(B),  # paths[from, to]
    r2 = as.list(m$rSquared["Rsq", ]),
    # the interaction constructs' indicators, weights and loadings (by item name, seminr's "a*b")
    termWeights = setNames(lapply(int, function(k) as.list(W[W[, k] != 0, k])), int),
    termLoadings = setNames(lapply(int, function(k) as.list(L[L[, k] != 0, k])), int),
    weights = as.list(W[, "Image"][W[, "Image"] != 0]),
    iterations = m$iterations)
}
out <- list(seminr = as.character(packageVersion("seminr")), n = nrow(d),
  one = list(two_stage = fit_of(two_stage), product_indicator = fit_of(product_indicator), orthogonal = fit_of(orthogonal)),
  two = list(product_indicator = fit_of(product_indicator, TRUE), orthogonal = fit_of(orthogonal, TRUE)))
write_json(out, "src/engine/__fixtures__/interaction_methods/reference.json", auto_unbox = TRUE, digits = 12, pretty = TRUE)
