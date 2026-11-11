# Native reference for the CB-SEM extras (src/rengine/cbExtras.webr.test.ts):
# the Bollen-Stine bootstrap p on the Holzinger-Swineford model, 200 samples, seed 1.
# Run: Rscript scripts/validation/cbextras.R  (writes src/engine/__fixtures__/cbextras/reference.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\ntextual ~ visual\nspeed ~ visual + textual"
set.seed(1)
fit <- sem(model, data = HolzingerSwineford1939, estimator = "ML", test = "bollen.stine", bootstrap = 200)
t <- lavInspect(fit, "test")$bollen.stine
out <- list(
  versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string),
  bollenStine = list(chisq = t$stat, df = t$df, p = t$pvalue)
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/cbextras/reference.json")
print(out$bollenStine)
