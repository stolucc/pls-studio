# Native BayesFactor reference for the Bayesian cards (src/rengine/R/bayes.R):
# direct calls of BayesFactor in desktop R, written without the app's code, with
# the seeds the webR test uses. Complements scripts/validation/bayes.R (the Bayes
# factors from their definitions, without BayesFactor).
# Writes src/engine/__fixtures__/bayes/native.json.
#   R_LIBS=<library with BayesFactor> Rscript scripts/validation/bayes_native.R
suppressPackageStartupMessages({ library(BayesFactor); library(jsonlite) })
frame <- function(df) list(names = names(df), cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
  categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x))))
lbf <- function(b) extractBF(b, logbf = TRUE)
out <- list()
# t-tests and correlations, as shipped (deterministic: quadrature)
sl <- data.frame(drug1 = sleep$extra[1:10], drug2 = sleep$extra[11:20])
a <- split(ToothGrowth$len, ToothGrowth$supp)
out$ttest <- list(paired = exp(lbf(ttestBF(sl$drug1, sl$drug2, paired = TRUE))$bf),
  independent = exp(lbf(ttestBF(a$OJ, a$VC))$bf), independentGreater = exp(lbf(ttestBF(a$OJ, a$VC, nullInterval = c(0, Inf)))$bf[1]),
  one = exp(lbf(ttestBF(ToothGrowth$len, mu = 18, rscale = 1))$bf))
out$correlation <- list(mpgWt = exp(lbf(correlationBF(mtcars$mpg, mtcars$wt, rscale = 1))$bf), mpgWtGreater = exp(lbf(correlationBF(mtcars$mpg, mtcars$wt, rscale = 1, nullInterval = c(0, 1)))$bf[1]))
# ANOVA: ToothGrowth len by supp and dose, every model with its main effects; JASP's prior r = 0.5
tg <- ToothGrowth; tg$dose <- factor(tg$dose)
out$toothgrowth <- frame(tg)
set.seed(1234)
b <- generalTestBF(len ~ supp * dose, data = tg, whichModels = "withmain", rscaleFixed = 0.5, rscaleCont = sqrt(2) / 4, iterations = 10000, progress = FALSE)
e <- lbf(b)
out$anova <- list(models = rownames(e), bf10 = exp(e$bf), error = e$error)
# ANCOVA: mtcars mpg by transmission with weight; covariate prior r = sqrt(2)/4
mt <- data.frame(mpg = mtcars$mpg, wt = mtcars$wt, am = factor(mtcars$am, labels = c("automatic", "manual")), vs = factor(mtcars$vs, labels = c("V", "straight")))
out$mtcars <- frame(mt)
set.seed(1234)
b <- generalTestBF(mpg ~ am + wt, data = mt, whichModels = "withmain", rscaleFixed = 0.5, rscaleCont = sqrt(2) / 4, iterations = 10000, progress = FALSE)
e <- lbf(b)
out$ancova <- list(models = rownames(e), bf10 = exp(e$bf), error = e$error)
# Contingency: transmission by engine shape, every sampling scheme, concentration 1 and 2
t22 <- xtabs(~ am + vs, data = mt)
out$contingency <- list(
  jointMulti = exp(lbf(contingencyTableBF(t22, sampleType = "jointMulti", priorConcentration = 1))$bf),
  poisson = exp(lbf(contingencyTableBF(t22, sampleType = "poisson", priorConcentration = 1))$bf),
  indepRows = exp(lbf(contingencyTableBF(t22, sampleType = "indepMulti", fixedMargin = "rows", priorConcentration = 1))$bf),
  indepCols = exp(lbf(contingencyTableBF(t22, sampleType = "indepMulti", fixedMargin = "cols", priorConcentration = 1))$bf),
  hypergeom = exp(lbf(contingencyTableBF(t22, sampleType = "hypergeom", priorConcentration = 1))$bf),
  concentration2 = exp(lbf(contingencyTableBF(t22, sampleType = "jointMulti", priorConcentration = 2))$bf))
# Repeated measures: CO2 uptake at four concentrations, plant type between; subjects random (r = 1), against the subjects-only model
w <- reshape(as.data.frame(CO2)[CO2$conc %in% c(95, 175, 250, 350), c("Plant", "Type", "conc", "uptake")], idvar = c("Plant", "Type"), timevar = "conc", direction = "wide")
co2 <- data.frame(c95 = w$uptake.95, c175 = w$uptake.175, c250 = w$uptake.250, c350 = w$uptake.350, type = factor(as.character(w$Type)))
out$co2 <- frame(co2)
Y <- as.matrix(co2[, 1:4])
long <- data.frame(subject = factor(rep(seq_len(nrow(Y)), 4)), conc = factor(rep(names(co2)[1:4], each = nrow(Y)), levels = names(co2)[1:4]), y = c(Y), type = rep(co2$type, 4))
set.seed(1234)
b <- generalTestBF(y ~ conc * type + subject, data = long, whichRandom = "subject", whichModels = "withmain", neverExclude = "^subject$", rscaleFixed = 0.5, rscaleRandom = 1, iterations = 10000, progress = FALSE)
nl <- lmBF(y ~ subject, data = long, whichRandom = "subject", rscaleRandom = 1, iterations = 10000, progress = FALSE)
e <- lbf(b); e0 <- lbf(nl)
keep <- rownames(e) != "subject"
out$rmanova <- list(models = rownames(e)[keep], bf10 = exp(e$bf[keep] - e0$bf[1]))
# Regression: mpg on wt, hp, qsec, every subset, r = sqrt(2)/4 (exact: Gaussian quadrature)
rb <- regressionBF(mpg ~ wt + hp + qsec, data = mtcars, whichModels = "all", rscaleCont = sqrt(2) / 4, progress = FALSE)
out$mtcarsFull <- frame(mtcars[, c("mpg", "wt", "hp", "qsec")])
out$regression <- list(models = rownames(lbf(rb)), bf10 = exp(lbf(rb)$bf))
# Robustness and sequential spot values (t-test: sleep paired; correlation: mpg and wt)
out$curves <- list(pairedR02 = exp(lbf(ttestBF(sl$drug1, sl$drug2, paired = TRUE, rscale = 0.2))$bf), pairedFirst5 = exp(lbf(ttestBF(sl$drug1[1:5], sl$drug2[1:5], paired = TRUE))$bf),
  corK05 = exp(lbf(correlationBF(mtcars$mpg, mtcars$wt, rscale = 0.5))$bf), corFirst10 = exp(lbf(correlationBF(mtcars$mpg[1:10], mtcars$wt[1:10], rscale = 1))$bf))
out$versions <- list(R = R.version.string, BayesFactor = as.character(packageVersion("BayesFactor")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/bayes/native.json")
str(out[c("ttest", "anova", "contingency")], digits.d = 10)
