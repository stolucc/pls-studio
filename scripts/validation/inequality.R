# Reference for inequality constraints in CB-SEM (lavaan): semfindr's
# cfa_dat_heywood two-factor CFA, whose x1 residual variance comes out
# negative (a Heywood case): with bounds = "pos.var" (variances kept >= 0), and
# with the loading of x2 labelled a and constrained a > 0.5 (active: it would be about 0.15).
#   R_LIBS=/path/to/lib Rscript scripts/validation/inequality.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(semfindr)
})
m <- "f1 =~ x1 + x2 + x3\nf2 =~ x4 + x5 + x6"
fb <- cfa(m, cfa_dat_heywood, bounds = "pos.var")
fa <- cfa("f1 =~ x1 + a*x2 + x3\nf2 =~ x4 + x5 + x6\na > 0.5", cfa_dat_heywood)
pick <- function(f) {
  pe <- parameterEstimates(f)
  v <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% paste0("x", 1:6), ]
  l <- pe[pe$op == "=~", ]
  list(variances = setNames(as.list(v$est), v$lhs), loadings = setNames(as.list(l$est), paste(l$lhs, l$rhs)), chisq = unname(fitMeasures(f, "chisq")))
}
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")), bounds = pick(fb), loading = pick(fa)), auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/inequality.json")
cat("written\n")
