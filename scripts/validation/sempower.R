# Reference for the power analysis card (independent of PLS Studio's code):
#   - semPower's help-page examples: ?semPower.aPriori (RMSEA .05 on 200 df, alpha .05, beta .05), ?semPower.postHoc
#     (N = 250), ?semPower.compromise (RMSEA .08, abratio 1, N = 250); and AGFI .95 with p = 20 (a measure that needs p)
#   - the power to detect the visual-textual covariance of lavaan's Holzinger & Swineford CFA: semPower.powerLav with
#     the fitted model as the population (Sigma) and H0 written as syntax with the covariance fixed at 0
#   - the RMSEA equivalence test of that CFA: dynamic::equivTest (T-size RMSEA and adjusted cutoffs, 3 decimals) and
#     lavaan's upper limit of the 90% RMSEA interval, which the T-size RMSEA equals
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/sempower.R

suppressPackageStartupMessages({ library(jsonlite); library(semPower); library(lavaan); library(dynamic) })
pick <- function(x, ...) lapply(setNames(nm = c(...)), function(k) if (is.null(x[[k]])) NULL else unname(as.numeric(x[[k]])))
ap <- semPower.aPriori(effect = .05, effect.measure = "RMSEA", alpha = .05, beta = .05, df = 200)
ph <- semPower.postHoc(effect = .05, effect.measure = "RMSEA", alpha = .05, N = 250, df = 200)
cp <- semPower.compromise(effect = .08, effect.measure = "RMSEA", abratio = 1, N = 250, df = 200)
ag <- semPower.aPriori(effect = .95, effect.measure = "AGFI", alpha = .05, power = .80, df = 100, p = 20)

HS <- HolzingerSwineford1939
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nvisual ~~ textual\nvisual ~~ speed\ntextual ~~ speed"
m0 <- sub("visual ~~ textual", "visual ~~ 0*textual", m, fixed = TRUE)
fit <- sem(m, HS)
S <- lavInspect(fit, "implied")$cov
plA <- semPower.powerLav(type = "a-priori", Sigma = S, modelH0 = m0, modelH1 = m, alpha = .05, power = .80)
plP <- semPower.powerLav(type = "post-hoc", Sigma = S, modelH0 = m0, modelH1 = m, alpha = .05, N = 100)
eq <- equivTest(fit)
fm <- fitMeasures(fit, c("chisq", "df", "rmsea", "rmsea.ci.upper"))
cuts <- as.numeric(unlist(regmatches(c(eq$ct_r, eq$ft_r, eq$mf_r, eq$pf_r), regexpr("[.0-9]+", c(eq$ct_r, eq$ft_r, eq$mf_r, eq$pf_r)))))

out <- list(
  semPower = as.character(packageVersion("semPower")), lavaan = as.character(packageVersion("lavaan")), dynamic = as.character(packageVersion("dynamic")),
  apriori = pick(ap, "requiredN", "impliedPower", "impliedNCP", "chiCrit", "fmin", "mc"),
  posthoc = pick(ph, "power", "ncp", "chiCrit", "fmin"),
  compromise = pick(cp, "chiCrit", "impliedAlpha", "impliedBeta", "impliedAbratio"),
  agfi = pick(ag, "requiredN", "impliedPower", "fmin", "rmsea"),
  parameter = list(estimate = unname(coef(fit)["visual~~textual"]), apriori = pick(plA, "requiredN", "impliedPower", "fmin"), posthoc = pick(plP, "power", "fmin", "ncp")),
  equivalence = list(chisq = unname(fm["chisq"]), df = unname(fm["df"]), n = nobs(fit), rmsea = unname(fm["rmsea"]), rmseaUpper90 = unname(fm["rmsea.ci.upper"]),
    dynamicRmseaT = as.numeric(sub("^\\.", "0.", eq$rmsea)), dynamicCutoffs = cuts))
dir.create("src/engine/__fixtures__/power", showWarnings = FALSE, recursive = TRUE)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/power/reference.json")
cat("written\n")
