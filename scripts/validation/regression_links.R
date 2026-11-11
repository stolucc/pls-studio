# Reference for the regression card's other links (src/rengine/regression.webr.test.ts): the complementary log-log
# link of a binomial model (?menarche, the help page's data with glm(binomial("cloglog"))) and the probit and
# cloglog links of the proportional-odds model (?housing, MASS::polr(method = "probit" / "cloglog")), run natively.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/regression_links.R
suppressPackageStartupMessages({
  library(MASS)
  library(jsonlite)
})
options(contrasts = c("contr.treatment", "contr.poly"))
tab <- function(fit) {
  s <- summary(fit)$coefficients
  lapply(seq_len(nrow(s)), function(i) list(term = rownames(s)[i], est = s[i, 1], se = s[i, 2]))
}
m <- list(
  menarche_cloglog = glm(cbind(Menarche, Total - Menarche) ~ Age, binomial(link = "cloglog"), data = menarche),
  housing_probit = polr(Sat ~ Infl + Type + Cont, weights = Freq, data = housing, method = "probit", Hess = TRUE),
  housing_cloglog = polr(Sat ~ Infl + Type + Cont, weights = Freq, data = housing, method = "cloglog", Hess = TRUE)
)
out <- lapply(names(m), function(k) {
  f <- m[[k]]
  r <- list(coefficients = tab(f), logLik = as.numeric(logLik(f)), aic = AIC(f))
  if (inherits(f, "polr")) r$zeta <- as.list(f$zeta)
  if (inherits(f, "glm")) r$deviance <- deviance(f)
  r
})
names(out) <- names(m)
out$versions <- list(R = R.version.string, MASS = as.character(packageVersion("MASS")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/regression/links.json")
cat("written\n")
