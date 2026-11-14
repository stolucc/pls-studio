# Reference for the specific indirect effects of the PLS bootstrap (src/rengine/R/boot.R,
# PS_SPECIFIC_INDIRECT): seminr's own specific_effect_significance() on the extended corporate
# reputation model of Hair et al. (2021; seminr's corp_rep_data), bootstrapped by seminr with 500 samples
# and seed 123. Written without the app's code. The missing values (-99) are replaced by the indicator
# means once, before estimation, as the app does (seminr's own missing_value = "-99" would replace them
# again in every bootstrap sample, from that sample's means: other draws, same estimates).
# Writes src/engine/__fixtures__/mediation/seminr_specific.json; src/rengine/specificIndirect.webr.test.ts
# bootstraps the same model through the app (seminr, native R) and compares.
#   Rscript scripts/validation/specific_indirect.R   (with seminr installed)
suppressPackageStartupMessages({
  library(jsonlite)
  library(seminr)
})

mm <- constructs(
  composite("QUAL", multi_items("qual_", 1:8), weights = mode_B),
  composite("PERF", multi_items("perf_", 1:5), weights = mode_B),
  composite("CSOR", multi_items("csor_", 1:5), weights = mode_B),
  composite("ATTR", multi_items("attr_", 1:3), weights = mode_B),
  composite("COMP", multi_items("comp_", 1:3)),
  composite("LIKE", multi_items("like_", 1:3)),
  composite("CUSA", single_item("cusa")),
  composite("CUSL", multi_items("cusl_", 1:3))
)
sm <- relationships(
  paths(from = c("QUAL", "PERF", "CSOR", "ATTR"), to = c("COMP", "LIKE")),
  paths(from = c("COMP", "LIKE"), to = c("CUSA", "CUSL")),
  paths(from = "CUSA", to = "CUSL")
)
data <- corp_rep_data
for (v in names(data)) {
  x <- data[[v]]
  x[x == -99] <- NA
  x[is.na(x)] <- mean(x, na.rm = TRUE)
  data[[v]] <- x
}
fit <- estimate_pls(
  data = data,
  measurement_model = mm,
  structural_model = sm
)
boot <- bootstrap_model(fit, nboot = 500, seed = 123, cores = 1)

chains <- list(
  c("COMP", "CUSA", "CUSL"),
  c("LIKE", "CUSA", "CUSL"),
  c("QUAL", "COMP", "CUSA"),
  c("QUAL", "LIKE", "CUSA", "CUSL"),
  c("ATTR", "COMP", "CUSA", "CUSL")
)
one <- function(ch) {
  k <- length(ch)
  through <- ch[2:(k - 1)]
  s <- specific_effect_significance(boot, from = ch[1], through = through, to = ch[k], alpha = 0.05)
  list(
    chain = ch,
    original = unname(s[1, "Original Est."]),
    mean = unname(s[1, "Bootstrap Mean"]),
    sd = unname(s[1, "Bootstrap SD"]),
    t = unname(s[1, "T Stat."]),
    ciLow = unname(s[1, "2.5% CI"]),
    ciHigh = unname(s[1, "97.5% CI"])
  )
}
direct <- function(from, to) {
  s <- specific_effect_significance(boot, from = from, to = to, alpha = 0.05)
  list(
    from = from,
    to = to,
    original = unname(s[1, "Original Est."]),
    ciLow = unname(s[1, "2.5% CI"]),
    ciHigh = unname(s[1, "97.5% CI"])
  )
}
out <- list(
  seminr = as.character(packageVersion("seminr")),
  nboot = 500,
  seed = 123,
  specific = lapply(chains, one),
  direct = list(direct("COMP", "CUSL"), direct("LIKE", "CUSL"))
)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/engine/__fixtures__/mediation/seminr_specific.json"
)
