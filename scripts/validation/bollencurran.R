# Reference for the Bollen & Curran (2004) examples: the artificial covariance
# matrix of their Sociological Methods & Research paper on autoregressive latent
# trajectory (ALT) models (five waves, N = 500; typed from the lavaan
# reproduction in github.com/cddesja/lavaan-reproducible), the latent curve
# model and the ALT model with the first wave predetermined, as the app fits
# them (lavaan, marker identification, sample.cov.rescale = TRUE; no means, the
# matrix carries none). Writes src/engine/__fixtures__/textbook/bollencurran.json.
#   Rscript scripts/validation/bollencurran.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
S <- lavaan::getCov(".619 \n .453 .595 \n .438 .438 .587 \n .422 .430 .438 .595 \n .406 .422 .438 .453 .619", names = paste0("t", 1:5))
fit_one <- function(model) {
  f <- lavaan::sem(model, sample.cov = S, sample.nobs = 500, auto.cov.y = FALSE)
  pe <- parameterEstimates(f, standardized = TRUE)
  keep <- pe$op %in% c("=~", "~", "~~")
  list(
    chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), pvalue = unname(fitMeasures(f, "pvalue")), cfi = unname(fitMeasures(f, "cfi")), tli = unname(fitMeasures(f, "tli")), rmsea = unname(fitMeasures(f, "rmsea")),
    estimates = lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i], std = pe$std.all[i]))
  )
}
out <- list()
# The latent curve model: intercept and slope factors with fixed loadings over the five waves (as the app draws it: the waves
# are single-indicator constructs T1..T5, the factors higher-order constructs with fixed component loadings).
out$lcm <- fit_one("Intercept =~ 1*t1 + 1*t2 + 1*t3 + 1*t4 + 1*t5\nSlope =~ 0*t1 + 1*t2 + 2*t3 + 3*t4 + 4*t5\nIntercept ~~ Slope")
# The ALT model with t1 predetermined: t1 exogenous, correlated with intercept and slope; autoregressive paths between waves.
out$alt <- fit_one("Intercept =~ 1*t2 + 1*t3 + 1*t4 + 1*t5\nSlope =~ 1*t2 + 2*t3 + 3*t4 + 4*t5\nIntercept ~~ Slope + t1\nSlope ~~ t1\nt2 ~ t1\nt3 ~ t2\nt4 ~ t3\nt5 ~ t4")
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/bollencurran.json")
for (k in c("lcm", "alt")) cat(sprintf("%-4s chisq %8.3f df %2d p %.3f cfi %.3f rmsea %.3f\n", k, out[[k]]$chisq, out[[k]]$df, out[[k]]$pvalue, out[[k]]$cfi, out[[k]]$rmsea))
pe <- parameterEstimates(sem("Intercept =~ 1*t2 + 1*t3 + 1*t4 + 1*t5\nSlope =~ 1*t2 + 2*t3 + 3*t4 + 4*t5\nIntercept ~~ Slope + t1\nSlope ~~ t1\nt2 ~ t1\nt3 ~ t2\nt4 ~ t3\nt5 ~ t4", sample.cov = S, sample.nobs = 500))
print(pe[pe$op == "~", c("lhs", "rhs", "est", "se")], digits = 3)
