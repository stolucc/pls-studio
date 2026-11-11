# Reference for the "PLS-SEM and CB-SEM compared" card (src/analyses/methodCompare.test.ts): the home screen's
# example (seminr's mobi, expectation and quality predicting satisfaction) estimated by plain seminr (PLS, mode A,
# path weighting) and plain lavaan (ML, standardised solution), the numbers the card puts side by side.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/method_compare.R
suppressPackageStartupMessages({
  library(seminr)
  library(lavaan)
  library(jsonlite)
})
data(mobi, package = "seminr")
# (composite, mode A: the PLS-PM estimates the card shows; seminr's reflective() would apply PLSc)
mm <- constructs(composite("Expectation", multi_items("CUEX", 1:3)), composite("Quality", multi_items("PERQ", 1:7)), composite("Satisfaction", multi_items("CUSA", 1:3)))
sm <- relationships(paths(from = c("Expectation", "Quality"), to = "Satisfaction"))
pls <- estimate_pls(mobi, mm, sm)
cb <- sem("Expectation =~ CUEX1 + CUEX2 + CUEX3
Quality =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
Satisfaction =~ CUSA1 + CUSA2 + CUSA3
Satisfaction ~ Expectation + Quality", data = mobi)
std <- standardizedSolution(cb)
pick <- function(op) {
  s <- std[std$op == op, ]
  lapply(seq_len(nrow(s)), function(i) list(lhs = s$lhs[i], rhs = s$rhs[i], std = s$est.std[i]))
}
L <- pls$outer_loadings
out <- list(
  pls = list(
    paths = list(Expectation = pls$path_coef["Expectation", "Satisfaction"], Quality = pls$path_coef["Quality", "Satisfaction"]),
    loadings = as.list(setNames(sapply(rownames(L), function(i) sum(L[i, ])), rownames(L))), r2 = pls$rSquared["Rsq", "Satisfaction"]
  ),
  cb = list(paths = pick("~"), loadings = pick("=~"), r2 = unname(inspect(cb, "r2")["Satisfaction"]), n = lavInspect(cb, "nobs")),
  versions = list(R = R.version.string, seminr = as.character(packageVersion("seminr")), lavaan = as.character(packageVersion("lavaan")))
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/methodcompare/mobi.json")
cat("written\n")
