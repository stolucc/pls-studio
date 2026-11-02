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
out$versions <- list(R = R.version.string, BayesFactor = as.character(packageVersion("BayesFactor")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/bayes/native.json")
str(out[c("ttest", "anova", "contingency")], digits.d = 10)
