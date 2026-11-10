# Native reference for the specification search (src/rengine/search.webr.test.ts): Bollen's Political Democracy
# model (lavaan's ?sem, without the equality labels) with three optional arrows, dem65 ~ ind60, y1 ~~ y5 and
# y4 ~~ y8. Each of the 2^3 = 8 models is written out as its own lavaan syntax (the arrows left out simply
# omitted) and fitted on its own, as a user would; the app's search fixes the left-out arrows at zero in the full
# model's parameter table instead, which must give the same fit.
# Run: Rscript scripts/validation/specsearch.R  (writes src/engine/__fixtures__/search/specsearch.json)
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
base <- c("ind60 =~ x1 + x2 + x3", "dem60 =~ y1 + y2 + y3 + y4", "dem65 =~ y5 + y6 + y7 + y8", "dem60 ~ ind60")
optional <- c(path = "dem65 ~ ind60", cov1 = "y1 ~~ y5", cov2 = "y4 ~~ y8")
out <- list(versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), models = list())
grid <- expand.grid(rep(list(c(TRUE, FALSE)), 3))
for (i in seq_len(nrow(grid))) {
  keep <- unlist(grid[i, ])
  # (dem65 keeps dem60 as a predictor, so it stays endogenous whichever arrows are in)
  dem65 <- if (keep[1]) "dem65 ~ ind60 + dem60" else "dem65 ~ dem60"
  model <- paste(c(base, dem65, optional[-1][keep[2:3]]), collapse = "\n")
  fit <- sem(model, data = PoliticalDemocracy, estimator = "ML", auto.cov.y = FALSE)
  fm <- fitMeasures(fit, c("npar", "chisq", "df", "pvalue", "cfi", "rmsea", "aic", "bic"))
  out$models[[i]] <- c(list(keep = I(unname(keep))), as.list(unname(fm)) |> setNames(names(fm)))
}
dir.create("src/engine/__fixtures__/search", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/search/specsearch.json")
print(do.call(rbind, lapply(out$models, function(m) unlist(m[c("npar", "chisq", "df", "bic")]))))
