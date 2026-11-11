# Reference results for the EFA card's Schmid-Leiman solution (independent of PLS Studio's code): psych::omega
# called on the raw data as its help page does (?omega: omega(m, nfactors), which calls schmid). The 25 Big
# Five items (bfi), 5 factors, minres with oblimin (omega's defaults).
#   R_LIBS=/path/to/lib Rscript scripts/validation/efa_schmid.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
  library(GPArotation)
})
b <- bfi[, 1:25]
om <- omega(b, nfactors = 5, plot = FALSE)
S <- om$schmid$sl
groups <- grep("\\*$", colnames(S), value = TRUE)
out <- list(
  psych = as.character(packageVersion("psych")),
  secondOrder = as.numeric(om$schmid$gloading),
  general = unname(S[, "g"]),
  group = unname(S[, groups]),
  h2 = unname(S[, "h2"]),
  p2 = unname(S[, "p2"]),
  ecv = unname(om$ECV[1]),
  omegaH = om$omega_h,
  omegaTotal = om$omega.tot,
  omegaGroup = unname(as.matrix(om$omega.group)),
  reversed = names(om$key)[om$key < 0])
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/efa/schmid.json")
cat("written\n")
