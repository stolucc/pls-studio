# Reference results for the dominance analysis card (analyses/dominance.tsx, R ps_dominance) on its example
# (packages.ts: swiss-dominance): domir (Luchman) fits lm() on every subset of the predictors and gives general,
# conditional and complete dominance; relaimpo's LMG is general dominance by another route. Neither package ships
# with the app, so install them in a library of their own:
#   R_LIBS=/path/to/scratch/library Rscript scripts/validation/dominance.R
# Writes src/engine/__fixtures__/dominance/reference.json.

suppressPackageStartupMessages({
  library(domir)
  library(relaimpo)
  library(jsonlite)
})
f <- Fertility ~ Agriculture + Examination + Education + Catholic + Infant.Mortality
d <- domir(f, function(f) summary(lm(f, data = swiss))$r.squared)
lmg <- calc.relimp(lm(f, data = swiss), type = "lmg")$lmg
stopifnot(isTRUE(all.equal(unname(lmg), unname(d$General_Dominance), tolerance = 1e-12)))
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  domir = as.character(packageVersion("domir")),
  relaimpo = as.character(packageVersion("relaimpo")),
  predictors = names(d$General_Dominance),
  r2 = d$Value,
  general = unname(d$General_Dominance),
  lmg = unname(lmg),
  conditional = unname(d$Conditional_Dominance),
  # [i][j]: the share of the subsets of the other predictors to which i adds more than j
  complete = unname(d$Complete_Dominance)
)
write_json(out, "src/engine/__fixtures__/dominance/reference.json", digits = NA, auto_unbox = TRUE, pretty = TRUE,
  na = "null")
cat("written\n")
