# Native references for CB-SEM pairwise deletion and the two-stage approach
# (src/rengine/missingTwoStage.webr.test.ts): the Holzinger-Swineford CFA with
# 30 values per item removed (seed 1). Run: Rscript scripts/validation/missing_twostage.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
d <- HolzingerSwineford1939[paste0("x", 1:9)]
set.seed(1)
for (v in names(d)) d[[v]][sample(nrow(d), 30)] <- NA
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
one <- function(estimator, missing) {
  f <- cfa(m, data = d, estimator = estimator, missing = missing)
  pe <- parameterEstimates(f)
  list(
    chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")),
    loadings = pe$est[pe$op == "=~"], se = pe$se[pe$op == "=~"]
  )
}
out <- list(
  versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), data = as.list(d),
  pairwise = one("ML", "pairwise"), twostage = one("ML", "two.stage"), robusttwostage = one("MLR", "robust.two.stage")
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, na = "null"), "src/engine/__fixtures__/missing/reference.json")
str(out[c("pairwise", "twostage", "robusttwostage")], max.level = 2)
