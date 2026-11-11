# Reference Durbin-Watson tests (lmtest::dwtest, default H1 of positive
# autocorrelation; exact p-values by Pan's algorithm below 100 rows, the normal
# approximation from 100) for the regression card's diagnostics: the linear
# models of the card's help-page examples, and lmtest's own example
# (?growthofmoney: dwtest(TG1.TG0 ~ AG0.TG0), Kraemer & Sonnberger 1986).
#   R_LIBS=/path/to/lib Rscript scripts/validation/durbin_watson.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lmtest)
  library(carData)
})
data(growthofmoney, package = "lmtest")

models <- list(
  attitude = lm(rating ~ complaints + privileges + learning + raises + critical + advance, data = attitude),
  swiss = lm(Fertility ~ Agriculture + Examination + Education + Catholic + Infant.Mortality, data = swiss),
  duncan = lm(prestige ~ income + education, data = Duncan),
  prestige = lm(prestige ~ education + log2(income) + women, data = Prestige),
  growthofmoney = lm(TG1.TG0 ~ AG0.TG0, data = growthofmoney)
)

out <- lapply(models, function(fit) {
  dw <- dwtest(fit)
  e <- residuals(fit)
  list(
    n = length(e),
    stat = unname(dw$statistic),
    p = dw$p.value,
    r1 = sum(e[-1] * e[-length(e)]) / sum(e^2)
  )
})
out$version <- as.character(packageVersion("lmtest"))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/regression/durbin_watson.json")
cat("written\n")
