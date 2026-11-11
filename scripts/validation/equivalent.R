# Native reference for the equivalent-models card (src/rengine/search.webr.test.ts): the path model of Roth et al.
# (1989) from Kline (2016, 2023; the correlations and SDs of his companion files, N = 373) and the six equivalent
# alternatives its Markov equivalence class gives (the same skeleton and the one v-structure fitness -> illness <-
# stress; Verma & Pearl 1990), each written by hand as lavaan syntax and fitted on its own. Every one must reproduce
# the model's chi-square and df; the app's replacing rules (model/equivalent.ts) must generate exactly these six.
# Run: Rscript scripts/validation/equivalent.R  (writes src/engine/__fixtures__/search/equivalent.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
vars <- c("exercise", "hardy", "fitness", "stress", "illness")
R <- suppressWarnings(lavaan::getCov(" 1.00 \n -.03 1.00 \n .39 .07 1.00 \n -.05 -.23 -.13 1.00 \n -.08 -.16 -.29 .34 1.00", names = vars))
S <- suppressWarnings(lavaan::cor2cov(R, sds = c(66.50, 38.00, 18.40, 33.50, 62.48)))
models <- list(
  model = "fitness ~ exercise\nstress ~ hardy\nillness ~ fitness + stress\nexercise ~~ hardy",
  a = "hardy ~ exercise\nfitness ~ exercise\nstress ~ hardy\nillness ~ fitness + stress",
  b = "exercise ~ hardy\nfitness ~ exercise\nstress ~ hardy\nillness ~ fitness + stress",
  c = "hardy ~ stress\nexercise ~ hardy\nfitness ~ exercise\nillness ~ fitness + stress",
  d = "exercise ~ hardy\nfitness ~ exercise\nillness ~ fitness + stress\nhardy ~~ stress",
  e = "exercise ~ fitness\nhardy ~ exercise\nstress ~ hardy\nillness ~ fitness + stress",
  f = "hardy ~ exercise\nstress ~ hardy\nillness ~ fitness + stress\nexercise ~~ fitness"
)
# (as the app: every variable an observed variable, its exogenous ones free (fixed.x = FALSE), disturbances
#  uncorrelated unless drawn)
fits <- lapply(models, function(m) sem(m, sample.cov = S, sample.nobs = 373, fixed.x = FALSE, auto.cov.y = FALSE))
out <- list(
  versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), S = unname(S), names = vars, n = 373,
  fits = lapply(names(fits), function(k) list(name = k, syntax = models[[k]], chisq = unname(fitMeasures(fits[[k]], "chisq")), df = unname(fitMeasures(fits[[k]], "df"))))
)
dir.create("src/engine/__fixtures__/search", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/search/equivalent.json")
print(sapply(fits, function(f) fitMeasures(f, c("chisq", "df"))))
