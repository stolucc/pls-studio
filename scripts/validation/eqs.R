# Reference for the built-in examples from the EQS 6 Structural Equations
# Program Manual (Bentler 2006): the data its example inputs print, fitted with
# native lavaan as EQS fits them (ML with N - 1: likelihood = "wishart").
# Writes src/engine/__fixtures__/textbook/eqs.json with the manual's chi-squares.
#   R_LIBS=... Rscript scripts/validation/eqs.R
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
fit_one <- function(model, S, n, ...) {
  f <- lavaan::sem(model, sample.cov = S, sample.nobs = n, likelihood = "wishart", fixed.x = FALSE, auto.cov.y = FALSE, ...)
  pe <- parameterEstimates(f)
  keep <- pe$op %in% c("=~", "~", "~~", "~1")
  list(chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), cfi = unname(fitMeasures(f, "cfi")), rmsea = unname(fitMeasures(f, "rmsea")),
    estimates = lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], group = if ("group" %in% names(pe)) pe$group[i] else 1, est = pe$est[i], se = pe$se[i])))
}
out <- list()
bn <- c("perform", "satisf1", "satisf2", "achieve1", "achieve2", "esteem1", "esteem2", "verbalIQ")
S <- cor2cov(getCov(c(1, .418, 1, .394, .627, 1, .129, .202, .266, 1, .189, .284, .208, .365, 1, .544, .281, .324, .201, .161, 1, .507, .225, .314, .172, .174, .546, 1, -.357, -.156, -.038, -.199, -.277, -.294, -.174, 1), names = bn),
  c(2.09, 3.43, 2.81, 1.95, 2.08, 2.16, 2.06, 3.65))
out$bagozzi <- fit_one("JobSat =~ satisf1 + satisf2\nAchieve =~ achieve1 + achieve2\nEsteem =~ esteem1 + esteem2\nPerform =~ 1*perform\nperform ~~ 0*perform\nPerform ~ verbalIQ + Esteem\nJobSat ~ Perform + Achieve\nAchieve ~~ Esteem + verbalIQ\nEsteem ~~ verbalIQ", S, 122)
out$bagozzi$eqs <- list(chisq = 15.400, df = 15)
w1 <- getCov(c(63.382, 70.984, 110.237, 41.710, 52.747, 60.584, 30.218, 37.489, 36.392, 32.295), names = paste0("v", 1:4))
w2 <- getCov(c(67.898, 72.301, 107.330, 40.549, 55.347, 63.203, 28.976, 38.896, 39.261, 35.403), names = paste0("v", 1:4))
out$werts <- fit_one("F1 =~ v1 + v2\nF2 =~ v3 + v4", list(`Group 1` = w1, `Group 2` = w2), list(`Group 1` = 865, `Group 2` = 900), group.equal = c("loadings", "lv.variances", "lv.covariances"))
out$werts$eqs <- list(chisq = 10.870, df = 7)
hn <- c("ses1", "ses2", "ses3", "ses4", "ability1", "ability2")
h1 <- cor2cov(getCov(c(1, .441, 1, .220, .203, 1, .304, .182, .377, 1, .274, .265, .208, .084, 1, .270, .122, .251, .198, .664, 1), names = hn), c(1.332, 1.281, 1.075, 2.648, 3.764, 2.677))
h2 <- cor2cov(getCov(c(1, .484, 1, .224, .342, 1, .268, .215, .387, 1, .230, .215, .196, .115, 1, .265, .297, .234, .162, .635, 1), names = hn), c(1.360, 1.195, 1.193, 3.239, 3.900, 2.719))
hm <- "SES =~ ses1 + ses2 + ses3 + ses4\nAbility =~ ability1 + ability2\nAbility ~ SES\nses1 ~~ ses2"
out$headStart <- fit_one(hm, h1, 148); out$headStart$eqs <- list(chisq = 15.655, df = 7)
out$headStartGroups <- fit_one(hm, list(`Head Start` = h1, Control = h2), list(`Head Start` = 148, Control = 155),
  sample.mean = list(`Head Start` = setNames(c(3.520, 3.081, 2.088, 5.358, 19.672, 9.562), hn), Control = setNames(c(3.839, 3.290, 2.600, 6.435, 20.415, 10.070), hn)),
  group.equal = c("loadings", "intercepts", "regressions"))
out$headStartGroups$eqs <- list(chisq = 27.451, df = 23)
on <- c("syn1", "opp1", "syn2", "opp2")
o1 <- getCov(c(37.626, 24.933, 34.680, 26.639, 24.236, 32.013, 23.649, 27.760, 23.565, 33.443), names = on)
o2 <- getCov(c(50.084, 42.373, 49.872, 40.760, 36.094, 51.237, 37.343, 40.396, 39.890, 53.641), names = on)
out$olsson <- fit_one("Pre =~ syn1 + opp1\nPost =~ syn2 + opp2\nPost ~ Pre\nopp1 ~~ opp2", list(Control = o1, Experimental = o2), list(Control = 105, Experimental = 108),
  sample.mean = list(Control = setNames(c(18.381, 20.229, 20.400, 21.343), on), Experimental = setNames(c(20.556, 21.241, 25.667, 25.870), on)),
  group.equal = c("loadings", "intercepts", "regressions"))
out$olsson$eqs <- list(chisq = 3.952, df = 5)
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/eqs.json")
