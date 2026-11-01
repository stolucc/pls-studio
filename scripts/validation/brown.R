# Reference for the examples from Brown (2015), Confirmatory Factor Analysis for
# Applied Research, 2nd ed.: the standard deviations and correlations of his
# companion files (sites.bu.edu/tabrown/cfabook), fitted with lavaan as the app
# fits them (marker identification, sample.cov.rescale = TRUE). Brown's book
# prints the Mplus results; the chi-squares are invariant to the identification.
# Writes src/engine/__fixtures__/textbook/brown.json.
#   Rscript scripts/validation/brown.R
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
cov_of <- function(lower, names, sds) lavaan::cor2cov(lavaan::getCov(lower, names = names), sds = sds)
fit_one <- function(model, S, n, ...) {
  f <- lavaan::sem(model, sample.cov = S, sample.nobs = n, auto.cov.y = FALSE, ...)
  pe <- parameterEstimates(f, standardized = TRUE)
  keep <- pe$op %in% c("=~", "~", "~~", "~1", ":=")
  list(chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), pvalue = unname(fitMeasures(f, "pvalue")),
    cfi = unname(fitMeasures(f, "cfi")), rmsea = unname(fitMeasures(f, "rmsea")), srmr = unname(fitMeasures(f, "srmr")),
    estimates = lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], group = if ("group" %in% names(pe)) pe$group[i] else 1, est = pe$est[i], se = pe$se[i], std = pe$std.all[i])))
}
out <- list()
# Figure 4.1 / Table 4.1: neuroticism and extraversion, N = 250
S <- cov_of('1 \n .767 1 \n .731 .709 1 \n .778 .738 .762 1 \n -.351 -.302 -.356 -.318 1 \n -.316 -.280 -.300 -.267 .675 1 \n -.296 -.289 -.297 -.296 .634 .651 1 \n -.282 -.254 -.292 -.245 .534 .593 .566 1',
  c("N1","N2","N3","N4","E1","E2","E3","E4"), c(5.7, 5.6, 6.4, 5.7, 6.0, 6.2, 5.7, 5.6))
out$ne <- fit_one('Neuroticism =~ N1 + N2 + N3 + N4\nExtraversion =~ E1 + E2 + E3 + E4', S, 250)
# Figure 7.1 / Table 7.2: tau-equivalent auditory indicators (loadings equal), N = 200
S <- cov_of('1 \n .661 1 \n .630 .643 1 \n .270 .300 .268 1 \n .297 .265 .225 .805 1 \n .290 .287 .248 .796 .779 1', paste0("X", 1:6), c(2.610, 2.660, 2.590, 1.940, 2.030, 2.050))
out$tau <- fit_one('Auditory =~ 1*X1 + 1*X2 + 1*X3\nVisual =~ X4 + X5 + X6', S, 200)
out$tauFree <- fit_one('Auditory =~ X1 + X2 + X3\nVisual =~ X4 + X5 + X6', S, 200)
# Table 6.1 / 6.3: correlated-uniqueness MTMM model of personality disorders, N = 500
nm <- c("PARI","SZTI","SZDI","PARC","SZTC","SZDC","PARO","SZTO","SZDO")
S <- cov_of('1 \n .290 1 \n .372 .478 1 \n .587 .238 .209 1 \n .201 .586 .126 .213 1 \n .218 .281 .681 .195 .096 1 \n .557 .228 .195 .664 .242 .232 1 \n .196 .644 .146 .261 .641 .248 .383 1 \n .219 .241 .676 .290 .168 .749 .361 .342 1',
  nm, c(3.61, 3.66, 3.59, 2.94, 3.03, 2.85, 2.22, 2.42, 2.04))
out$mtmm <- fit_one('Paranoid =~ PARI + PARC + PARO\nSchizotypal =~ SZTI + SZTC + SZTO\nSchizoid =~ SZDI + SZDC + SZDO\nPARI ~~ SZTI + SZDI\nSZTI ~~ SZDI\nPARC ~~ SZTC + SZDC\nSZTC ~~ SZDC\nPARO ~~ SZTO + SZDO\nSZTO ~~ SZDO', S, 500)
# Figure 8.1 / Table 8.2: higher-order CFA of coping, N = 275
S <- cov_of('1 \n .78 1 \n .80 .77 1 \n .56 .51 .48 1 \n .52 .51 .46 .78 1 \n .59 .51 .51 .80 .79 1 \n .16 .15 .17 .14 .18 .16 1 \n .19 .13 .18 .14 .16 .16 .81 1 \n .12 .17 .17 .17 .20 .16 .75 .80 1 \n .16 .13 .17 .15 .16 .18 .56 .52 .50 1 \n .16 .14 .18 .15 .16 .18 .51 .58 .51 .81 1 \n .16 .15 .14 .16 .16 .14 .52 .57 .52 .80 .79 1',
  c("P1","P2","P3","C1","C2","C3","E1","E2","E3","S1","S2","S3"), c(1.40, 2.10, 1.30, 2.30, 2.40, 1.90, 2.00, 2.90, 2.30, 3.10, 2.20, 1.20))
out$coping <- fit_one('ProblemSolving =~ P1 + P2 + P3\nCognitiveRestructuring =~ C1 + C2 + C3\nExpressEmotions =~ E1 + E2 + E3\nSocialSupport =~ S1 + S2 + S3\nProblemFocused =~ ProblemSolving + CognitiveRestructuring\nEmotionFocused =~ ExpressEmotions + SocialSupport', S, 275)
# Figure 8.4 / Table 8.8: scale reliability (intrusions, avoidance; one error covariance), N = 500
S <- cov_of('1 \n .594 1 \n .607 .613 1 \n .736 .765 .717 1 \n .378 .321 .360 .414 1 \n .314 .301 .345 .363 .732 1 \n .310 .262 .323 .337 .665 .583 1 \n .317 .235 .276 .302 .632 .557 .796 1',
  paste0("Y", 1:8), c(1.150, 1.200, 1.570, 2.820, 1.310, 1.240, 1.330, 1.290))
out$reliability <- fit_one('Intrusions =~ Y1 + Y2 + Y3 + Y4\nAvoidance =~ Y5 + Y6 + Y7 + Y8\nY7 ~~ Y8', S, 500)
# Figure 8.7 / Table 8.12: a formative construct (life stress) with two reflective second-order indicators, N = 500
S <- cov_of('1 \n .700 1 \n .713 .636 1 \n .079 .066 .076 1 \n .088 .058 .070 .681 1 \n .084 .056 .074 .712 .633 1 \n .279 .248 .240 .177 .155 .170 1 \n .250 .214 .222 .157 .143 .152 .373 1 \n .280 .236 .251 .173 .178 .171 .448 .344 1',
  c("Y1","Y2","Y3","Y4","Y5","Y6","X1","X2","X3"), c(2.5, 2.1, 3.0, 4.1, 3.9, 4.4, 1.2, 1.0, 1.2))
out$stress <- fit_one('Satisfaction =~ Y1 + Y2 + Y3\nOptimism =~ Y4 + Y5 + Y6\nStress =~ Satisfaction + Optimism\nStress ~ 1*X1 + X2 + X3', S, 500)
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/brown.json")
for (k in setdiff(names(out), "versions")) cat(sprintf("%-12s chisq %8.3f df %2d p %.3f cfi %.3f rmsea %.3f\n", k, out[[k]]$chisq, out[[k]]$df, out[[k]]$pvalue, out[[k]]$cfi, out[[k]]$rmsea))
