# Native reference for the CB-SEM diagnostics (src/rengine/cbDiag.webr.test.ts): direct lavaan
# calls on the Holzinger-Swineford CFA (lavaan's ?cfa), as the cards should reproduce them.
#  - local fit: lavResiduals (cor.bentler z-tests, normalized residuals, SRMR tests) and lavTest
#    for each further test of exact fit, on the ML fit (base ML chi-square, and Browne's RLS);
#  - FIML with auxiliary variables (lavaan's aux =, saturated correlates) on the data with values
#    removed by a fixed rule (x1 missing in every 5th row, x5 in rows 3, 10, 17, ...).
# Run: Rscript scripts/validation/cbdiag.R  (writes src/engine/__fixtures__/cbdiag/reference.json)
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
hs_model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
hs <- HolzingerSwineford1939
fit <- cfa(hs_model, data = hs)
low <- function(m) { m <- unclass(m); unname(m[lower.tri(m)]) }  # the lower triangle, column by column

res <- lavResiduals(fit, type = "cor.bentler", se = TRUE)
nrm <- lavResiduals(fit, type = "normalized", zstat = FALSE, summary = FALSE)
s <- res$summary
tests <- c("browne.residual.nt.model", "browne.residual.nt", "browne.residual.adf", "satorra.bentler", "yuan.bentler",
  "mean.var.adjusted", "scaled.shifted", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4", "pols3", "pall")
one <- function(test, scaled_test = "standard") {
  t <- lavTest(fit, test = test, scaled_test = scaled_test, drop_list_single = FALSE)[[test]]
  list(stat = t$stat, df = t$df, p = t$pvalue, scaling = t$scaling.factor %||% NA, shift = t$shift.parameter %||% NA)
}
localfit <- list(names = rownames(res$cov), residual = low(res$cov), se = low(res$cov.se), z = low(res$cov.z), normalized = low(nrm$cov),
  srmr = s["srmr", "cov"], srmrSe = s["srmr.se", "cov"], srmrZ = s["srmr.exactfit.z", "cov"], srmrP = s["srmr.exactfit.pvalue", "cov"],
  usrmr = s["usrmr", "cov"], usrmrLow = s["usrmr.ci.lower", "cov"], usrmrHigh = s["usrmr.ci.upper", "cov"], closeP = s["usrmr.closefit.pvalue", "cov"],
  tests = c(list(standard = one("standard")), setNames(lapply(tests, one), tests)),
  rls = setNames(lapply(c("satorra.bentler", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4"), one, scaled_test = "RLS"),
    c("satorra.bentler", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4")))

# FIML with auxiliary variables (and without, for the difference they make)
hs_na <- hs
hs_na$x1[seq(5, nrow(hs), by = 5)] <- NA
hs_na$x5[seq(3, nrow(hs), by = 7)] <- NA
fiml <- function(...) { f <- cfa(hs_model, data = hs_na, missing = "ml", ...); list(chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), cfi = unname(fitMeasures(f, "cfi")),
  est = parameterEstimates(f)$est[parameterEstimates(f)$op == "=~"], se = parameterEstimates(f)$se[parameterEstimates(f)$op == "=~"]) }
aux <- list(none = fiml(), aux = fiml(aux = c("ageyr", "agemo")), twostage = (function() { f <- cfa(hs_model, data = hs_na, missing = "two.stage", aux = c("ageyr", "agemo"))
  list(chisq = unname(fitMeasures(f, "chisq")), est = parameterEstimates(f)$est[parameterEstimates(f)$op == "=~"], se = parameterEstimates(f)$se[parameterEstimates(f)$op == "=~"]) })())

out <- list(versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), localfit = localfit, aux = aux)
dir.create("src/engine/__fixtures__/cbdiag", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), "src/engine/__fixtures__/cbdiag/reference.json")
str(out, max.level = 2)
