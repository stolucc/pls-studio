# Reference results for the implied-independencies card (analyses/dsep.tsx, R ps_dsep) on Bollen's union sentiment
# path model (packages.ts: bollen-union-dsep; MIIVsem::bollen1989b): piecewiseSEM's dSep() finds the basis set from
# the same model written as regressions (age and years in the mill correlated), and tests each claim by the t test
# in its lm(); Fisher's C and its p value from fisherC(). lavaan's χ² of the same model for comparison.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/dsep.R
# Writes src/engine/__fixtures__/dsep/reference.json.

suppressPackageStartupMessages({
  library(piecewiseSEM)
  library(lavaan)
  library(jsonlite)
})
data(bollen1989b, package = "MIIVsem")
d <- bollen1989b
model <- psem(
  lm(deferenc ~ age, data = d),
  lm(laboract ~ age + deferenc, data = d),
  lm(unionsen ~ deferenc + laboract + yrsmill, data = d),
  age %~~% yrsmill,
  data = d
)
ds <- dSep(model, conditioning = TRUE, .progressBar = FALSE)
fc <- fisherC(model, .progressBar = FALSE)
fit <- sem("deferenc ~ age\n laboract ~ age + deferenc\n unionsen ~ deferenc + laboract + yrsmill\n age ~~ yrsmill",
  data = d)
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  piecewiseSEM = as.character(packageVersion("piecewiseSEM")),
  n = nrow(d),
  claims = I(as.character(ds$Independ.Claim)),
  estimate = ds$Estimate,
  t = ds$Crit.Value,
  df = ds$DF,
  p = ds$P.Value,
  fisherC = unname(-2 * sum(log(ds$P.Value))),
  fisherCRounded = fc$Fisher.C,
  fisherDf = fc$df,
  lavaanChisq = unname(fitMeasures(fit, "chisq")),
  lavaanDf = unname(fitMeasures(fit, "df"))
)
print(ds)
write_json(out, "src/engine/__fixtures__/dsep/reference.json", digits = NA, auto_unbox = TRUE, pretty = TRUE)
cat("written\n")
