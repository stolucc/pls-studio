# Reference for composites (emergent variables) in CB-SEM (lavaan >= 0.6-20 `<~`):
# HolzingerSwineford1939 with visual a composite of x1-x3, textual and speed common
# factors, speed ~ visual + textual. ML on complete data, and FIML with x2 and x5
# partly missing. Composite loadings: each indicator's correlation with the composite
# scores (lavPredict, an exact weighted sum), which the app computes from the implied
# covariance matrix instead.
#   R_LIBS=/path/to/lib Rscript scripts/validation/cb_composite.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
})
d <- HolzingerSwineford1939[, paste0("x", 1:9)]
m <- "visual <~ 1*x1 + x2 + x3\ntextual =~ 1*x4 + x5 + x6\nspeed =~ 1*x7 + x8 + x9\nspeed ~ visual + textual\nvisual ~~ textual"
pick <- function(f, dat) {
  pe <- parameterEstimates(f, standardized = TRUE)
  w <- pe[pe$op == "<~", ]
  r <- pe[pe$op == "~", ]
  sc <- lavPredict(f)[, "visual"]
  ok <- complete.cases(dat[, c("x1", "x2", "x3")])
  list(
    weights = setNames(as.list(w$est), w$rhs), weightSe = setNames(as.list(w$se), w$rhs), weightStd = setNames(as.list(w$std.all), w$rhs),
    loadings = as.list(sapply(c("x1", "x2", "x3"), function(x) cor(dat[ok, x], sc[ok]))),
    paths = setNames(as.list(r$est), r$rhs), pathSe = setNames(as.list(r$se), r$rhs),
    chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df"))
  )
}
ml <- pick(sem(m, d), d)
dm <- d
dm$x2[seq(1, 301, 10)] <- NA
dm$x5[seq(5, 301, 12)] <- NA
fiml <- sem(m, dm, missing = "ml")
fm <- pick(fiml, dm)
# With missing values the composite scores are not an exact sum on incomplete rows, so the
# FIML loadings come from the implied covariance matrix: (Sigma w)_i / sqrt(Sigma_ii w'Sigma w).
S <- lavInspect(fiml, "cov.ov")[c("x1", "x2", "x3"), c("x1", "x2", "x3")]
wv <- unlist(fm$weights)
fm$loadings <- as.list(setNames(as.vector(S %*% wv) / sqrt(diag(S) * as.numeric(t(wv) %*% S %*% wv)), c("x1", "x2", "x3")))
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")), ml = ml, fiml = fm, missing = list(x2 = seq(1, 301, 10), x5 = seq(5, 301, 12))),
  auto_unbox = TRUE, digits = NA, pretty = TRUE
), "src/engine/__fixtures__/cb_composite.json")
cat("written\n")
