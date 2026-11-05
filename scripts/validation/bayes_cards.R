# Reference values for the Bayesian card examples (src/examples/cards/bayes.ts, checked in
# src/examples/cards/bayes.webr.test.ts): the help pages' and the BayesFactor manual's calls run natively
# (BayesFactor 0.9.12-4.8), and the Monte Carlo ones also as the card calls them (generalTestBF, seed 1234).
# Rscript scripts/validation/bayes_cards.R
suppressPackageStartupMessages(library(BayesFactor))
bf <- function(label, x) for (i in seq_len(nrow(extractBF(x)))) cat(sprintf("%-45s %s  (error %.3g)\n", paste(label, rownames(extractBF(x))[i]), format(extractBF(x)$bf[i], digits = 12), extractBF(x)$error[i]))

# ?ttestBF: paired; manual: one-sample difference scores, one-sided; manual: chickwts horsebean vs linseed
bf("paired", ttestBF(x = sleep$extra[sleep$group == 1], y = sleep$extra[sleep$group == 2], paired = TRUE))
bf("one-sided", ttestBF(x = sleep$extra[1:10] - sleep$extra[11:20], nullInterval = c(-Inf, 0))[1])
ch <- droplevels(chickwts[chickwts$feed %in% c("horsebean", "linseed"), ])
bf("chickwts", ttestBF(formula = weight ~ feed, data = ch))

# ?anovaBF: sleep as repeated measures; the card: generalTestBF over the long data / the subjects-only model
set.seed(1234); bf("sleep rm (anovaBF)", anovaBF(extra ~ group + ID, data = sleep, whichRandom = "ID", progress = FALSE))

# Manual, fixed-effects ANOVA: ToothGrowth, dose as a factor; and with log2(dose) as a covariate
tg <- ToothGrowth; tg$dose <- factor(tg$dose)
set.seed(1234); bf("toothgrowth (anovaBF)", anovaBF(len ~ supp * dose, data = tg, progress = FALSE))
tg2 <- ToothGrowth; tg2$dose <- log2(tg2$dose)
set.seed(1234); bf("ancova", lmBF(len ~ supp + dose, data = tg2)); bf("ancova", lmBF(len ~ dose, data = tg2)); bf("ancova", lmBF(len ~ supp, data = tg2))

# ?regressionBF: attitude, all 63 models (quadrature)
o <- regressionBF(rating ~ ., data = attitude, progress = FALSE)
bf("attitude", head(o)); bf("attitude", o[63])

# ?contingencyTableBF: raceDolls, columns fixed (closed form)
data(raceDolls)
bf("raceDolls", contingencyTableBF(raceDolls, sampleType = "indepMulti", fixedMargin = "cols"))

# ?binom.test (Conover 1971): 682 giant of 925 against p = 3/4, beta(1, 1) prior: closed form and numerical integration
k <- 682; n <- 925; p0 <- 3 / 4
cat(sprintf("%-45s %s\n", "binomial giant closed form", format(exp(lbeta(k + 1, n - k + 1) - (k * log(p0) + (n - k) * log1p(-p0))), digits = 12)))
cat(sprintf("%-45s %s\n", "binomial giant integrate", format(integrate(function(q) dbinom(k, n, q), 0, 1, rel.tol = 1e-12)$value / dbinom(k, n, p0), digits = 12)))
cat(sprintf("%-45s %s\n", "binomial dwarf log10 BF", format(log10(integrate(function(q) dbinom(n - k, n, q), 0, 1, rel.tol = 1e-12)$value) - log10(dbinom(n - k, n, p0)), digits = 12)))
cat(sprintf("%-45s %s\n", "binom.test p", format(binom.test(c(k, n - k), p = p0)$p.value, digits = 7)))

# ?anovaBF / manual, mixed models: puzzles, shape x color within subjects (shipped wide, one column per cell, as the card takes it)
data(puzzles)
cell <- function(s, k) with(puzzles[puzzles$shape == s & puzzles$color == k, ], RT[order(ID)])
wide <- data.frame(ID = 1:12, round.color = cell("round", "color"), round.mono = cell("round", "monochromatic"), square.color = cell("square", "color"), square.mono = cell("square", "monochromatic"))
write.csv(wide, "public/examples/bayes/puzzles.csv", row.names = FALSE, quote = FALSE)
set.seed(1234); bf("puzzles (anovaBF)", anovaBF(RT ~ shape * color + ID, data = puzzles, whichRandom = "ID", progress = FALSE))

# Manual, regression and ANOVA: log2(dose) with the supp x dose interaction; the card's call (generalTestBF, seed 1234)
set.seed(1234); bf("ancova with interaction (generalTestBF)", generalTestBF(len ~ supp * dose, data = tg2, whichModels = "withmain", progress = FALSE))

# proportionBF (logistic prior on the log odds, r = 0.5): the manual's peas and ?proportionBF's 15 of 25
bf("proportionBF peas", proportionBF(682, 682 + 243, p = 3 / 4)); bf("proportionBF peas, null", 1 / proportionBF(682, 682 + 243, p = 3 / 4))
bf("proportionBF 15 of 25", proportionBF(y = 15, N = 25, p = .5))
write.csv(data.frame(outcome = rep(1:2, c(15, 10))), "public/examples/bayes/proportion-15-of-25.csv", row.names = FALSE, quote = FALSE)
