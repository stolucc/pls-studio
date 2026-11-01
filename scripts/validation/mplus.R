# Reference for the Mplus User's Guide examples (Muthen & Muthen; data, inputs and
# outputs at statmodel.com/usersguide): the generated data of each example, fitted
# natively as the app fits them (lavaan ML / WLSMV, glm, modsem LMS), with the
# loglikelihood or chi-square the Mplus output prints for comparison.
# Writes src/engine/__fixtures__/textbook/mplus.json.
#   Rscript scripts/validation/mplus.R
`%||%` <- function(a, b) if (is.null(a)) b else a
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
csv <- function(ex) read.csv(sprintf("public/examples/mplus/ex%s.csv", ex))
pe_of <- function(f) { pe <- parameterEstimates(f, standardized = TRUE); keep <- pe$op %in% c("=~", "~", "~~", "~1", ":=", "|")
  lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], group = if ("group" %in% names(pe)) pe$group[i] else 1, est = pe$est[i], se = pe$se[i], std = pe$std.all[i])) }
fit_lav <- function(ex, model, mplus, ..., meanstructure = TRUE) {
  f <- lavaan::sem(model, data = csv(ex), auto.cov.y = FALSE, meanstructure = meanstructure, ...)
  fm <- fitMeasures(f)
  list(n = lavInspect(f, "nobs"), chisq = unname(fm["chisq"]), df = unname(fm["df"]), logl = unname(if ("logl" %in% names(fm)) fm["logl"] else NA), npar = unname(fm["npar"]),
    scaled = unname(if ("chisq.scaled" %in% names(fm)) fm["chisq.scaled"] else NA), mplus = mplus, estimates = pe_of(f))
}
out <- list()
# ch. 3: regressions (glm); Mplus loglikelihoods H0
g <- glm(y1 ~ x1 + x3, data = csv("3.1")); out$ex3.1 <- list(logl = as.numeric(logLik(g)), coef = as.list(coef(g)), mplus = list(logl = -694.334, note = "Mplus ML includes the residual variance: same loglikelihood as lm"))
g <- glm(u1 ~ x1 + x3, family = binomial, data = csv("3.5")); out$ex3.5 <- list(logl = as.numeric(logLik(g)), coef = as.list(coef(g)), mplus = list(logl = -202.620))
g <- glm(u1 ~ x1 + x3, family = poisson, data = csv("3.7")); out$ex3.7 <- list(logl = as.numeric(logLik(g)), coef = as.list(coef(g)), mplus = list(logl = -966.884))
# Mplus frees the disturbance covariance of f1 and f2 in the MIMIC models (f1 ~~ f2 below).
# ch. 3.11: path analysis (x fixed, as Mplus)
out$ex3.11 <- fit_lav("3.11", "y1 ~ x1 + x2 + x3\ny2 ~ x1 + x2 + x3\ny3 ~ y1 + y2 + x2", list(logl = -2364.002, npar = 15))
out$ex5.1 <- fit_lav("5.1", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6", list(logl = -4906.609, chisq = 3.896, df = 8))
out$ex5.2 <- fit_lav("5.2", "f1 =~ u1 + u2 + u3\nf2 =~ u4 + u5 + u6", list(chisq = 5.482, df = 8, note = "WLSMV, scaled"), ordered = paste0("u", 1:6), estimator = "WLSMV")
out$ex5.6 <- fit_lav("5.6", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf3 =~ y7 + y8 + y9\nf4 =~ y10 + y11 + y12\nf5 =~ f1 + f2 + f3 + f4", list(logl = -7211.373))
out$ex5.8 <- fit_lav("5.8", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf1 ~ x1 + x2 + x3\nf2 ~ x1 + x2 + x3\nf1 ~~ f2", list(logl = -4000.617))
out$ex5.11 <- fit_lav("5.11", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf3 =~ y7 + y8 + y9\nf4 =~ y10 + y11 + y12\nf4 ~ b*f3\nf3 ~ a*f1 + f2\nind := a*b", list(logl = -9646.960))
out$ex5.14 <- fit_lav("5.14", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf1 ~ x1 + x2 + x3\nf2 ~ x1 + x2 + x3\nf1 ~~ f2", list(logl = -8811.413, npar = 35), group = "g", group.equal = "loadings", group.partial = "f1 =~ y3", meanstructure = FALSE)
out$ex5.15 <- fit_lav("5.15", "f1 =~ y1 + y2 + y3\nf2 =~ y4 + y5 + y6\nf1 ~ x1 + x2 + x3\nf2 ~ x1 + x2 + x3\nf1 ~~ f2", list(logl = -8812.330, npar = 44), group = "g", group.equal = c("loadings", "intercepts"), group.partial = c("f1 =~ y3", "y3 ~ 1"))
out$ex5.25 <- fit_lav("5.25", "efa('block1')*f1 + efa('block1')*f2 =~ y1 + y2 + y3 + y4 + y5 + y6\nf3 =~ y7 + y8 + y9\nf4 =~ y10 + y11 + y12\nf3 ~ f1 + f2\nf4 ~ f3", list(logl = -6482.762, npar = 44), rotation = "geomin")
# ch. 6: growth (lavaan::growth)
fit_growth <- function(ex, model, mplus) { f <- lavaan::growth(model, data = csv(ex)); fm <- fitMeasures(f)
  list(n = lavInspect(f, "nobs"), chisq = unname(fm["chisq"]), df = unname(fm["df"]), logl = unname(fm["logl"]), npar = unname(fm["npar"]), mplus = mplus, estimates = pe_of(f)) }
out$ex6.1 <- fit_growth("6.1", "i =~ 1*y11 + 1*y12 + 1*y13 + 1*y14\ns =~ 0*y11 + 1*y12 + 2*y13 + 3*y14", list(logl = -3016.386, npar = 9))
out$ex6.8 <- fit_growth("6.8", "i =~ 1*y11 + 1*y12 + 1*y13 + 1*y14\ns =~ 0*y11 + 1*y12 + y13 + y14", list(logl = -3016.249, npar = 11))
out$ex6.9 <- fit_growth("6.9", "i =~ 1*y11 + 1*y12 + 1*y13 + 1*y14\ns =~ 0*y11 + 1*y12 + 2*y13 + 3*y14\nq =~ 0*y11 + 1*y12 + 4*y13 + 9*y14", list(logl = -3975.519, npar = 13))
out$ex6.10 <- fit_growth("6.10", "i =~ 1*y11 + 1*y12 + 1*y13 + 1*y14\ns =~ 0*y11 + 1*y12 + 2*y13 + 3*y14\ni + s ~ x1 + x2\ny11 ~ a31\ny12 ~ a32\ny13 ~ a33\ny14 ~ a34", list(npar = 17))
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/mplus.json")
for (k in setdiff(names(out), "versions")) { o <- out[[k]]; cat(sprintf("%-8s logl %10.3f (Mplus %10.3f)  chisq %8.3f df %3s  npar %3s (Mplus %3s)\n", k, o$logl %||% NA, o$mplus$logl %||% NA, o$chisq %||% NA, o$df %||% "", o$npar %||% "", o$mplus$npar %||% "")) }
