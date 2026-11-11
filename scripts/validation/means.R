# Native reference for the mean structure (src/rengine/means.webr.test.ts): the constant on
# the canvas with a free latent mean (its marker's intercept fixed at 0) and an observed
# covariate's intercept, lavaan meanstructure = TRUE, on Holzinger & Swineford.
# Run: R_LIBS=<lib> Rscript scripts/validation/means.R  (writes src/engine/__fixtures__/means/reference.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\ntextual ~ visual + ageyr\nvisual ~ 1\nx1 ~ 0*1"
fit <- sem(model, data = HolzingerSwineford1939, estimator = "ML", meanstructure = TRUE)
pe <- parameterEstimates(fit, standardized = TRUE)
rows <- pe[pe$op == "~1", ]
out <- list(
  versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string),
  chisq = unname(fitMeasures(fit, "chisq")), df = unname(fitMeasures(fit, "df")),
  intercepts = lapply(
    seq_len(nrow(rows)),
    function(i) list(lhs = rows$lhs[i], est = rows$est[i], se = rows$se[i], std = rows$std.all[i])
  )
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/means/reference.json")
print(rows[, c("lhs", "est", "se")])
