# Reference results for the EFA card's congruence comparison (independent of PLS Studio's code): psych called
# directly on its documented data. The 25 Big Five items (bfi): minres with oblimin (5 factors) against
# ML with varimax (5 factors), Tucker's congruence coefficients by psych::factor.congruence (as in its
# help page, ?factor.congruence, which compares fa solutions of the same data).
#   R_LIBS=/path/to/lib Rscript scripts/validation/efa_congruence.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
  library(GPArotation)
})
b <- bfi[, 1:25]
minres <- fa(b, 5, fm = "minres", rotate = "oblimin")
ml <- fa(b, 5, fm = "ml", rotate = "varimax")
phi <- factor.congruence(minres, ml, digits = 15)
out <- list(
  psych = as.character(packageVersion("psych")),
  rows = rownames(phi),
  columns = colnames(phi),
  coefficients = unname(phi),
  loadings = unname(unclass(ml$loadings)))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/efa/congruence.json")
cat("written\n")
