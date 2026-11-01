# Reference for the built-in examples from Bollen (1989), Structural Equations
# with Latent Variables: the matrices the book prints, fitted with native lavaan
# as the book fits them (ML with N - 1: likelihood = "wishart"). Writes
# src/engine/__fixtures__/textbook/bollen1989.json with the book's printed
# values next to lavaan's; the webR test compares the app with both.
#   R_LIBS=... Rscript scripts/validation/bollen1989.R
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
fit_one <- function(model, S, n, ...) {
  f <- lavaan::sem(model, sample.cov = S, sample.nobs = n, likelihood = "wishart", fixed.x = FALSE, auto.cov.y = FALSE, ...)
  pe <- parameterEstimates(f, standardized = TRUE)
  keep <- pe$op %in% c("=~", "~", "~~", "~1")
  list(chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df")), cfi = unname(fitMeasures(f, "cfi")), rmsea = unname(fitMeasures(f, "rmsea")),
    estimates = lapply(which(keep), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], group = if ("group" %in% names(pe)) pe$group[i] else 1, est = pe$est[i], se = pe$se[i])))
}
nm <- c("subjIncome", "subjPrestige", "subjStatus", "income", "prestige")
W <- getCov(c(.449, .166, .410, .226, .173, .393, .564, .259, .382, 4.831, 2.366, 3.840, 3.082, 13.656, 452.711), names = nm)
B <- getCov(c(.663, .334, .558, .301, .282, .615, .724, .420, .391, 4.397, 2.417, 3.357, 1.806, 7.485, 263.218), names = nm)
paths <- "subjIncome ~ income + subjPrestige\nsubjPrestige ~ prestige + subjIncome\nsubjStatus ~ subjIncome + subjPrestige"
out <- list()
# ch. 4, Table 4.2: exactly identified, the disturbances covary
out$ses <- fit_one(paste(paths, "subjIncome ~~ subjPrestige + subjStatus\nsubjPrestige ~~ subjStatus", sep = "\n"), W, 432)
out$ses$book <- list(chisq = 0, df = 0, est = list(`subjPrestige~subjIncome` = .29, `subjIncome~subjPrestige` = .25, `subjStatus~subjIncome` = .43, `subjStatus~subjPrestige` = .54,
  `subjIncome~income` = .10, `subjPrestige~prestige` = .007, `subjIncome~~subjIncome` = .34, `subjIncome~~subjPrestige` = -.06, `subjPrestige~~subjPrestige` = .33,
  `subjIncome~~subjStatus` = -.03, `subjPrestige~~subjStatus` = -.10, `subjStatus~~subjStatus` = .29))
# ch. 5, Table 5.3 column (2): measurement error in subjective income and prestige (latent eta1, eta2 on the scale of y1, y2)
err <- "SI =~ 1*subjIncome\nSP =~ 1*subjPrestige\nsubjIncome ~~ NA*subjIncome\nsubjPrestige ~~ NA*subjPrestige\nSI ~ income + SP\nSP ~ prestige + SI\nsubjStatus ~ SI + SP"
out$sesError <- fit_one(err, W, 432)
out$sesError$book <- list(est = list(`SP~SI` = .33, `SI~SP` = .29, `subjStatus~SI` = .40, `subjStatus~SP` = .54, `SI~income` = .10, `SP~prestige` = .007,
  `SI~~SI` = .22, `SP~~SP` = .11, `subjStatus~~subjStatus` = .21, `subjIncome~~subjIncome` = .10, `subjPrestige~~subjPrestige` = .21))
# ch. 8, Table 8.6: the same model in blacks and whites, Gamma and B equal (H_GB: 13.85 on 8 df in the book)
out$sesGroups <- fit_one(err, list(Blacks = B, Whites = W), list(Blacks = 368, Whites = 432), group.equal = "regressions")
out$sesGroups$book <- list(chisq = 13.85, df = 8, note = "LISREL VI on three-decimal matrices; lavaan 13.80")
# ch. 8, Tables 8.7 and 8.8: morale and belonging, females (N = 49) and males (N = 57), loadings and intercepts equal (H_Lambda-nu: 35.37 on 36 df)
mn <- c("morale1", "morale2", "morale3", "morale4", "belong1", "belong2", "belong3")
Fe <- getCov(c(4.023, -2.954, 7.223, 2.256, -2.340, 2.665, 1.808, -2.598, 1.965, 2.473, 2.756, -3.163, 2.517, 2.121, 3.969, 2.132, -1.997, 1.772, 1.455, 2.690, 4.604, 1.978, -2.614, 1.810, 1.677, 2.410, 1.835, 4.267), names = mn)
Ma <- getCov(c(4.096, -2.663, 5.446, 2.762, -2.334, 2.848, 2.917, -2.514, 2.471, 3.429, 3.553, -3.479, 2.919, 3.017, 4.707, 3.652, -3.403, 2.773, 3.420, 4.039, 6.070, 3.522, -3.142, 2.811, 3.331, 3.923, 4.146, 4.427), names = mn)
out$morale <- fit_one("Morale =~ morale1 + morale2 + morale3 + morale4\nBelonging =~ belong1 + belong2 + belong3", list(Females = Fe, Males = Ma), list(Females = 49, Males = 57),
  sample.mean = list(Females = setNames(c(8.347, 2.163, 9.041, 8.837, 8.102, 7.980, 8.061), mn), Males = setNames(c(8.105, 2.018, 8.719, 8.772, 7.842, 7.579, 7.965), mn)),
  meanstructure = TRUE, group.equal = c("loadings", "intercepts"))
out$morale$book <- list(chisq = 35.37, df = 36)
# ch. 7, Tables 7.1 and 7.8: two-wave CFA of political democracy, loadings equal over the waves (46.7 on 22 df; with six correlated errors 15.1 on 16)
dn <- c("press60", "opposition60", "elections60", "legislature60", "press65", "opposition65", "elections65", "legislature65")
S <- cor2cov(getCov(c(1, .604, 1, .679, .451, 1, .693, .719, .609, 1, .739, .543, .576, .652, 1, .650, .705, .427, .659, .565, 1, .674, .581, .650, .680, .678, .609, 1, .666, .606, .530, .737, .630, .753, .712, 1), names = dn),
  c(2.623, 3.947, 3.281, 3.349, 2.613, 3.373, 3.286, 3.246))
cfa2 <- "Democracy60 =~ press60 + l2*opposition60 + l3*elections60 + l4*legislature60\nDemocracy65 =~ press65 + l2*opposition65 + l3*elections65 + l4*legislature65"
out$demUncorrelated <- fit_one(cfa2, S, 75); out$demUncorrelated$book <- list(chisq = 46.7, df = 22)
out$demCorrelated <- fit_one(paste(cfa2, "press60 ~~ press65\nopposition60 ~~ opposition65\nelections60 ~~ elections65\nlegislature60 ~~ legislature65\nopposition60 ~~ legislature60\nopposition65 ~~ legislature65", sep = "\n"), S, 75)
out$demCorrelated$book <- list(chisq = 15.1, df = 16, note = "lavaan 15.25 on the two-decimal correlations")
# ch. 7, (7.82): perceived air quality, one factor (16.0 on 2 df)
A <- getCov(c(.331, .431, 1.160, .406, .847, .898, .216, .272, .312, .268), names = c("overall", "clarity", "color", "odor"))
out$air <- fit_one("Air =~ overall + clarity + color + odor", A, 57); out$air$book <- list(chisq = 16.0, df = 2)
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/bollen1989.json")
