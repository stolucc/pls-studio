# Reference results for the ordinal-indicator outputs of CB-SEM: the sample polychoric correlations and
# thresholds (Mplus SAMPSTAT) and the bivariate fit of each pair of indicators (Mplus TECH10), from
# desktop lavaan, with two independent checks: the polychoric correlations by psych::polychoric, and one
# pair's X2 and G2 recomputed here from the observed table and the cell probabilities the fitted model
# implies (bivariate normal, pbivnorm, from lavaan's implied thresholds and correlation).
# Data: psych's bfi, agreeableness A1-A5 and conscientiousness C1-C5 (six-point items), the first 1000
# complete cases, written to the fixture as the app reads it.
#
# No standard errors are compared, so the WLSMV standard-error convention (the app's default is Mplus's, the expected
# information in the sandwich; lavaan >= 0.7-2 uses the observed one) does not enter these references.
#
#   Rscript scripts/validation/ordinal_fit.R

suppressMessages({
  library(lavaan)
  library(psych)
  library(jsonlite)
  library(pbivnorm)
})
root <- "src/engine/__fixtures__/categorical"
items <- c(paste0("A", 1:5), paste0("C", 1:5))
d <- psych::bfi[, items]
d <- head(d[complete.cases(d), ], 1000)
write.csv(d, file.path(root, "bfi_ac.csv"), row.names = FALSE)
m <- "agree =~ A1 + A2 + A3 + A4 + A5\nconsc =~ C1 + C2 + C3 + C4 + C5"
fit <- cfa(m, data = d, ordered = items, estimator = "WLSMV")

ss <- lavInspect(fit, "sampstat")
R <- cov2cor(unclass(ss$cov))[items, items]
tb <- lavTables(fit, dimension = 2L, type = "table", statistic = c("X2", "G2"), p_value = TRUE)

# One pair by hand: the observed table, and the probabilities of its cells under the fitted model.
pair <- c("A1", "C5")
th <- lavInspect(fit, "th")
rho <- lavInspect(fit, "cor.ov")[pair[1], pair[2]]
cuts <- function(v) c(-Inf, th[grep(paste0("^", v, "\\|"), names(th))], Inf)
a <- cuts(pair[1])
b <- cuts(pair[2])
F2 <- function(x, y) if (x == -Inf || y == -Inf) 0 else if (x == Inf && y == Inf) 1 else if (x == Inf) pnorm(y) else if (y == Inf) pnorm(x) else pbivnorm(x, y, rho)
P <- outer(seq_len(length(a) - 1), seq_len(length(b) - 1), Vectorize(function(i, j) F2(a[i + 1], b[j + 1]) - F2(a[i], b[j + 1]) - F2(a[i + 1], b[j]) + F2(a[i], b[j])))
O <- table(factor(d[[pair[1]]], levels = 1:6), factor(d[[pair[2]]], levels = 1:6))
N <- sum(O)
E <- N * P
x2 <- sum((O - E)^2 / E)
g2 <- 2 * sum(ifelse(O > 0, O * log(O / E), 0))

out <- list(
  lavaan = as.character(packageVersion("lavaan")), items = items,
  polychoric = unname(R), psychPolychoric = unname(polychoric(d)$rho[items, items]),
  thresholds = list(names = names(unclass(ss$th)), values = unname(as.numeric(ss$th))),
  tech10 = list(lhs = as.character(tb$lhs), rhs = as.character(tb$rhs), df = as.numeric(tb$df), x2 = as.numeric(tb$X2), x2p = as.numeric(tb$X2.pval), g2 = as.numeric(tb$G2), g2p = as.numeric(tb$G2.pval)),
  byHand = list(lhs = pair[1], rhs = pair[2], x2 = x2, g2 = g2)
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "ordinal_fit.json"))
cat("written\n")
