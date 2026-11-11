# Reference for the distribution-free estimator (ADF; EQS's AGLS; lavaan's WLS):
# the three-factor CFA of the Holzinger & Swineford (1939) data by native lavaan
# from the raw data.
# Writes src/engine/__fixtures__/adf/reference.json.
#   R_LIBS=... Rscript scripts/validation/adf.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
x <- HolzingerSwineford1939[, paste0("x", 1:9)]
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
f <- cfa(m, data = x, estimator = "WLS")
pe <- parameterEstimates(f)
keep <- pe$op %in% c("=~", "~~") & pe$se > 0
out <- list(
  data = list(names = names(x), cols = unname(lapply(x, as.numeric))),
  n = nrow(x),
  chisq = unname(fitMeasures(f, "chisq")),
  df = unname(fitMeasures(f, "df")),
  cfi = unname(fitMeasures(f, "cfi")),
  rmsea = unname(fitMeasures(f, "rmsea")),
  estimates = lapply(
    which(keep),
    function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i])
  ),
  versions = list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = FALSE), "src/engine/__fixtures__/adf/reference.json")
cat(out$chisq, out$df, "\n")
