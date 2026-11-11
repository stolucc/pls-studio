# Reference results for polynomial regression / response surface analysis,
# independent of PLS Studio's code, on the RSA package's example (?RSA:
# motcon, postVA ~ ePow * iPow, the full polynomial model):
#   - lavaan ML and MLR: RSA::RSA (out.rm = FALSE, no centring);
#   - OLS: lm, with the surface tests from car::linearHypothesis.
# Also writes motcon for the app (RSA cannot run in the browser's R).
#   R_LIBS=/path/to/lib Rscript scripts/validation/rsa.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(RSA)
  library(car)
})
data(motcon, package = "RSA")
write.csv(motcon, "public/examples/rsa/motcon.csv", row.names = FALSE)
grab <- function(r) {
  p <- getPar(r, "coef", model = "full")
  setNames(lapply(seq_len(nrow(p)), function(i) list(est = p$est[i], se = p$se[i])), p$label)
}
out <- list(version = as.character(packageVersion("RSA")))
for (e in c("ML", "MLR")) out[[e]] <- grab(RSA(postVA ~ ePow * iPow, motcon, models = "full", out.rm = FALSE, verbose = FALSE, estimator = e, se = if (e == "MLR") "robust" else "standard"))
d <- motcon
d$X2 <- d$ePow^2
d$XY <- d$ePow * d$iPow
d$Y2 <- d$iPow^2
m <- lm(postVA ~ ePow + iPow + X2 + XY + Y2, d)
h <- function(s) {
  lh <- linearHypothesis(m, s)
  list(F = lh$F[2], p = lh$`Pr(>F)`[2])
}
out$OLS <- list(
  b = as.list(coef(m)),
  r2 = summary(m)$r.squared,
  a1 = h("ePow + iPow = 0"),
  a2 = h("X2 + XY + Y2 = 0"),
  a3 = h("ePow - iPow = 0"),
  a4 = h("X2 - XY + Y2 = 0"),
  a5 = h("X2 - Y2 = 0")
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/rsa/reference.json")
cat("written; licence", packageDescription("RSA")$License, "\n")
