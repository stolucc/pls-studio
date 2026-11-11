# Reference for principal axis factoring (src/rengine/efa.webr.test.ts): psych::fa(fm = "pa") on the 25 Big Five
# items (bfi, 5 factors, promax), called directly; loadings, communalities, factor correlations and fit.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/efa_pa.R
suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
  library(GPArotation)
})
pa <- fa(bfi[, 1:25], 5, fm = "pa", rotate = "promax")
out <- list(
  psych = as.character(packageVersion("psych")),
  loadings = unname(unclass(pa$loadings)),
  communality = unname(pa$communality),
  phi = unname(pa$Phi),
  rmsea = unname(pa$RMSEA[1]),
  tli = pa$TLI
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/efa/pa.json")
cat("written\n")
