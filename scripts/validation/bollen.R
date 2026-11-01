# Reference for the Bollen examples: the datasets MIIVsem ships (Bollen 1989;
# Bollen, Speizer & Mroz 1996; Felson & Bohrnstedt 1979; Reisenzein 1986) with
# the models their help pages give (Reisenzein: the model its help page states in words,
# as it gives no code), fitted as the app fits them: lavaan ML (auto.cov.y = FALSE,
# exogenous observed variables with free variances) and MIIVsem's MIIV-2SLS. Writes src/engine/__fixtures__/textbook/bollen.json.
#   Rscript scripts/validation/bollen.R
suppressPackageStartupMessages({ library(lavaan); library(MIIVsem); library(jsonlite) })
fit_ml <- function(model, data) {
  f <- lavaan::sem(model, data = data, auto.cov.y = FALSE, fixed.x = FALSE)
  pe <- parameterEstimates(f, standardized = TRUE)
  keep <- pe$op %in% c("=~", "~", "~~")
  list(n = lavInspect(f, "nobs"), chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), pvalue = unname(fitMeasures(f, "pvalue")), cfi = unname(fitMeasures(f, "cfi")), tli = unname(fitMeasures(f, "tli")), rmsea = unname(fitMeasures(f, "rmsea")),
    estimates = lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i], std = pe$std.all[i])))
}
fit_miiv <- function(model, data) {
  m <- MIIVsem::miive(model, data = data, var.cov = TRUE)
  co <- m$coefficients
  list(coefficients = lapply(names(co), function(k) list(name = k, est = unname(co[k]))), eqn = lapply(m$eqn, function(e) list(DVobs = e$DVobs, sargan = e$sargan, sargan.df = e$sargan.df, sargan.p = e$sargan.p)))
}
out <- list()
m <- 'unionsen ~ deferenc + laboract + yrsmill\ndeferenc ~ age\nlaboract ~ age + deferenc\nyrsmill ~~ age'
out$union <- list(ml = fit_ml(m, bollen1989b), miiv = fit_miiv(m, bollen1989b))
# (the help page's model, by MIIV-2SLS as MIIVsem estimates it; its var.cov step is improper: factor correlations above 1)
m <- 'femaleAccess =~ access1 + access2 + access3\nmaleAccess =~ access4 + access5 + access6\nfemaleEasy =~ easy1 + easy2 + easy3\nmaleEasy =~ easy4 + easy5 + easy6'
out$accessibility <- list(miiv = suppressWarnings(fit_miiv(m, bollen1996)))
m <- 'acad ~ gpa + attract\nattract ~ height + weight + rating + acad'
out$felson <- list(ml = fit_ml(m, felson1979), miiv = fit_miiv(m, felson1979))
m <- 'controllability =~ Z2 + Z3 + Z4\nsympathy =~ Z5 + Z6 + Z7\nanger =~ Z8 + Z9 + Z10\nhelping =~ Z11 + Z12 + Z13\ncontrollability ~ Z1\nsympathy ~ controllability\nanger ~ controllability\nhelping ~ sympathy + anger'
out$reisenzein <- list(ml = fit_ml(m, reisenzein1986), miiv = fit_miiv(m, reisenzein1986))
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")), MIIVsem = as.character(packageVersion("MIIVsem")))
dir.create("src/engine/__fixtures__/textbook", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/bollen.json")
for (k in setdiff(names(out), c("versions", "accessibility"))) { ml <- out[[k]]$ml; if (!is.null(ml$error)) cat(sprintf("%-16s ML error: %s\n", k, ml$error)) else cat(sprintf("%-16s N %4d chisq %8.3f df %2d p %.3f cfi %.3f\n", k, ml$n, ml$chisq, ml$df, ml$pvalue, ml$cfi)) }
