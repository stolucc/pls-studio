# Reference for the HTMT bootstrap of the "What now?" helper (Discriminant validity tab):
# cSEM's HTMT (calculateHTMT, the call the app's R bridge makes: signed mean correlations)
# and seminr's (absolute correlations, as the built-in engine) on bootstrap
# resamples of mobi, the ECSI model with every construct a common factor. The resamples are
# drawn here and written out with the results, so the app's TypeScript bootstrap can be run
# on exactly the same rows. The upper bound of the one-sided 95% interval is the 95th
# percentile (matrixStats::colQuantiles, type 7, as cSEM's own CI_percentile; Franke &
# Sarstedt 2019 recommend this bound against the threshold).
#   R_LIBS=/path/to/lib Rscript scripts/validation/htmt_bootstrap.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(cSEM)
  library(matrixStats)
  library(seminr)
})

d <- read.csv("src/engine/__fixtures__/mobi.csv")
model <- "
Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
Expectation =~ CUEX1 + CUEX2 + CUEX3
Quality =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
Value =~ PERV1 + PERV2
Satisfaction =~ CUSA1 + CUSA2 + CUSA3
Loyalty =~ CUSL1 + CUSL2 + CUSL3
Expectation ~ Image
Quality ~ Expectation
Value ~ Expectation + Quality
Satisfaction ~ Image + Expectation + Quality + Value
Loyalty ~ Image + Satisfaction
"
constructs <- c("Image", "Expectation", "Quality", "Value", "Satisfaction", "Loyalty")

# Every pair below the diagonal, in the app's order (row i > column j).
pairs <- list()
for (i in seq_along(constructs)) {
  for (j in seq_len(i - 1)) {
    pairs[[length(pairs) + 1]] <- c(constructs[i], constructs[j])
  }
}

# (HTMT only: HTMT2 is not defined on resamples where an item correlation changes sign.)
htmt_of <- function(data, type) {
  fit <- csem(data, model, .disattenuate = FALSE, .tolerance = 1e-10)
  h <- calculateHTMT(fit, .type_htmt = type)
  if (is.list(h) && !is.null(h$htmts)) h <- h$htmts
  # cSEM fills the lower triangle (row = later construct).
  vapply(pairs, function(p) h[p[1], p[2]], 0)
}

# seminr's HTMT (absolute item correlations), from a seminr model of the same blocks.
mm <- constructs(
  composite("Image", multi_items("IMAG", 1:5)),
  composite("Expectation", multi_items("CUEX", 1:3)),
  composite("Quality", multi_items("PERQ", 1:7)),
  composite("Value", multi_items("PERV", 1:2)),
  composite("Satisfaction", multi_items("CUSA", 1:3)),
  composite("Loyalty", multi_items("CUSL", 1:3))
)
sm <- relationships(
  paths(from = "Image", to = c("Expectation", "Satisfaction", "Loyalty")),
  paths(from = "Expectation", to = c("Quality", "Value", "Satisfaction")),
  paths(from = "Quality", to = c("Value", "Satisfaction")),
  paths(from = "Value", to = "Satisfaction"),
  paths(from = "Satisfaction", to = "Loyalty")
)
htmt_seminr <- function(data) {
  m <- suppressMessages(estimate_pls(data, mm, sm))
  h <- seminr:::HTMT(m)
  # seminr fills the upper triangle (row = earlier construct).
  vapply(pairs, function(p) h[p[2], p[1]], 0)
}

set.seed(20261114)
B <- 200
n <- nrow(d)
indices <- lapply(seq_len(B), function(b) sample.int(n, n, replace = TRUE))

original <- htmt_of(d, "htmt")
draws <- t(vapply(indices, function(idx) htmt_of(d[idx, ], "htmt"), original))
upper <- colQuantiles(draws, probs = 0.95, type = 7)
original_abs <- htmt_seminr(d)
draws_abs <- t(vapply(indices, function(idx) htmt_seminr(d[idx, ]), original_abs))
upper_abs <- colQuantiles(draws_abs, probs = 0.95, type = 7)

out <- list(
  cSEM = as.character(packageVersion("cSEM")),
  constructs = constructs,
  pairs = lapply(pairs, function(p) p),
  # 1-based row numbers of each resample
  indices = indices,
  original = original,
  draws = unname(draws),
  upper95 = unname(upper),
  seminr = as.character(packageVersion("seminr")),
  originalAbsolute = original_abs,
  drawsAbsolute = unname(draws_abs),
  upper95Absolute = unname(upper_abs)
)
dir.create("src/measurement/__fixtures__", showWarnings = FALSE, recursive = TRUE)
writeLines(
  toJSON(out, digits = NA, auto_unbox = TRUE),
  "src/measurement/__fixtures__/htmt_bootstrap.json"
)
