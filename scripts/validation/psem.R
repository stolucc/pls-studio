# Reference results for the Piecewise SEM card (R/psem.R): piecewiseSEM called directly on its own data (keeley,
# shipley). For each model: the tests of directed separation (dSep(), unrounded), Fisher's C, df and p (fisherC()),
# the AIC and AICc (summary()$AIC: the sum of the equations' AIC and MuMIn::AICc), the coefficients with their
# standardised values (coefs(); unrounded from the same standardisation, piecewiseSEM:::stdCoefs) and the R² (rsquared()).
# fisherC(), summary() and coefs() round (3 and 4 decimals): their rounded values are recorded as well, and the test
# checks the app's unrounded numbers round to them.
#
#   Rscript scripts/validation/psem.R [library]

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressPackageStartupMessages({ library(piecewiseSEM); library(lme4); library(jsonlite) })
data(keeley); data(shipley)
# (complete cases numbered 1, 2, ...: piecewiseSEM's observation-empirical standardisation looks the cases up by their row
# names as numbers, so the rows of a subset must be renumbered; the app does the same)
sh <- shipley[complete.cases(shipley[, c("lat", "DD", "Date", "Growth", "Live", "site")]), ]; sh$site <- factor(sh$site); rownames(sh) <- NULL
sh0 <- shipley[complete.cases(shipley[, c("lat", "DD", "Date", "Growth", "Live")]), ]; rownames(sh0) <- NULL

record <- function(eqs, extras = list(), data, std = "latent.linear") {
  model <- do.call(psem, c(eqs, extras, list(data = data)))
  d <- dSep(model, conditioning = TRUE, .progressBar = FALSE)
  s <- summary(model, .progressBar = FALSE, standardize.type = std)
  cf <- piecewiseSEM:::stdCoefs(model, data, "scale", std, "F", "II", FALSE)
  rounded <- coefs(model, standardize.type = std)
  r2 <- rsquared(model)
  list(claims = lapply(seq_len(nrow(d)), function(i) list(claim = as.character(d$Independ.Claim[i]), df = d$DF[i], stat = d$Crit.Value[i], p = d$P.Value[i])),
    fisherC = -2 * sum(log(d$P.Value)), fisherRounded = as.list(fisherC(model)), aic = sum(sapply(eqs, AIC)), aicc = sum(sapply(eqs, MuMIn::AICc)),
    aicRounded = as.list(s$AIC), coefs = lapply(seq_len(nrow(cf)), function(i) list(response = as.character(cf$Response[i]), predictor = as.character(cf$Predictor[i]),
      est = cf$Estimate[i], se = cf$Std.Error[i], df = cf$DF[i], stat = cf$Crit.Value[i], p = cf$P.Value[i], std = suppressWarnings(as.numeric(cf$Std.Estimate[i])),
      stdRounded = suppressWarnings(as.numeric(rounded$Std.Estimate[i])))),
    r2 = lapply(seq_len(nrow(r2)), function(i) as.list(r2[i, ])))
}

ref <- list(
  piecewiseSEM = as.character(packageVersion("piecewiseSEM")), lme4 = as.character(packageVersion("lme4")),
  # ?psem: the help page's model
  keeley = record(list(lm(rich ~ cover, data = keeley), lm(cover ~ firesev, data = keeley), lm(firesev ~ age, data = keeley)), data = keeley),
  # A Poisson count (species richness; standardised by the observation-empirical approach), a variable in no path and a correlated error
  poisson = record(list(lm(firesev ~ age, data = keeley), lm(cover ~ firesev, data = keeley), glm(rich ~ cover + distance, family = poisson(link = "log"), data = keeley)),
    list(hetero ~ 1, cover %~~% hetero), data = keeley),
  # ?shipley's path model with a random intercept per site (lmer, and glmer for survival)
  shipley = record(list(lmer(DD ~ lat + (1 | site), data = sh), lmer(Date ~ DD + (1 | site), data = sh), lmer(Growth ~ Date + (1 | site), data = sh),
    glmer(Live ~ Growth + (1 | site), family = binomial(link = "logit"), data = sh)), data = sh),
  # The same without random effects (glm for survival): the latent-theoretic and observation-empirical standardisations
  binomialLT = record(list(lm(DD ~ lat, data = sh0), lm(Date ~ DD, data = sh0), lm(Growth ~ Date, data = sh0), glm(Live ~ Growth, family = binomial(link = "logit"), data = sh0)), data = sh0),
  binomialOE = record(list(lm(DD ~ lat, data = sh0), lm(Date ~ DD, data = sh0), lm(Growth ~ Date, data = sh0), glm(Live ~ Growth, family = binomial(link = "logit"), data = sh0)), data = sh0, std = "Menard.OE"))
dir.create("src/engine/__fixtures__/psem", showWarnings = FALSE)
write(toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), "src/engine/__fixtures__/psem/reference.json")
cat("written\n")
