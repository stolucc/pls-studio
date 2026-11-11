# Reference results for the correlation card's polychoric method from desktop lavaan: psych's bfi,
# agreeableness items A1 and A2 (six-point), gender (binary) and age (continuous): polychoric,
# polyserial and Pearson pairs with standard errors and 95% intervals, pairwise deletion, and the
# bivariate-normality tests of the ordinal pairs. Independent check: the polychoric correlations by
# psych::polychoric on the same pairs (pairwise complete cases).
#
#   Rscript scripts/validation/correlation_polychoric.R

suppressMessages({
  library(lavaan)
  library(psych)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/categorical"
vars <- c("A1", "A2", "gender", "age")
d <- psych::bfi[, vars]
ordinal <- c("A1", "A2", "gender")
d$age <- as.numeric(scale(d$age))
fit <- lavCor(d, ordered = ordinal, se = "standard", output = "fit", missing = "pairwise")
est <- standardizedSolution(fit, level = 0.95)
est <- est[est$op == "~~" & est$lhs != est$rhs, ]
nt <- lavTables(fit, dimension = 2L, type = "table", statistic = c("X2", "G2"), p_value = TRUE)
pp <- function(a, b) {
  x <- d[complete.cases(d[, c(a, b)]), c(a, b)]
  polychoric(x)$rho[1, 2]
}
out <- list(
  lavaan = as.character(packageVersion("lavaan")), vars = vars, ordinal = ordinal,
  pairs = lapply(seq_len(nrow(est)), function(i) list(a = est$lhs[i], b = est$rhs[i], r = est$est.std[i], se = est$se[i], z = est$z[i], p = est$pvalue[i], ciLow = est$ci.lower[i], ciHigh = est$ci.upper[i])),
  normality = lapply(seq_len(nrow(nt)), function(i) list(a = as.character(nt$lhs[i]), b = as.character(nt$rhs[i]), df = nt$df[i], x2 = nt$X2[i], g2 = nt$G2[i], g2p = nt$G2.pval[i])),
  psych = list(A1_A2 = pp("A1", "A2"), A1_gender = pp("A1", "gender"), A2_gender = pp("A2", "gender"))
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "correlation_polychoric.json"))
cat("written\n")
