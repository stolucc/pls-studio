# Reference for single indicators with a known reliability in CB-SEM (lavaan):
# HolzingerSwineford1939, visual and textual measured by three indicators each,
# speed by x7 alone with reliability 0.7, so x7's error variance is fixed at
# (1 - 0.7) * var(x7) (Bollen 1989). Also on the covariance matrix (sample.cov),
# and the default (no reliability: error variance 0).
#   R_LIBS=/path/to/lib Rscript scripts/validation/reliability_single.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
})
d <- HolzingerSwineford1939[, paste0("x", 1:9)]
ev <- (1 - 0.7) * var(d$x7)
m <- function(e) sprintf("visual =~ 1*x1 + x2 + x3\ntextual =~ 1*x4 + x5 + x6\nspeed =~ 1*x7\nx7 ~~ %s*x7\nspeed ~ visual + textual", e)
pick <- function(f) {
  pe <- parameterEstimates(f)
  s <- standardizedSolution(f)
  r <- pe[pe$op == "~", ]
  list(
    paths = setNames(as.list(r$est), r$rhs), se = setNames(as.list(r$se), r$rhs),
    std = setNames(as.list(s$est.std[s$op == "~"]), s$rhs[s$op == "~"]),
    speedVar = pe$est[pe$op == "~~" & pe$lhs == "speed" & pe$rhs == "speed"], chisq = unname(fitMeasures(f, "chisq")), df = unname(fitMeasures(f, "df"))
  )
}
raw <- pick(sem(m(format(ev, digits = 15)), d))
S <- cov(d)
mat <- pick(sem(m(format((1 - 0.7) * S["x7", "x7"], digits = 15)), sample.cov = S, sample.nobs = nrow(d)))
none <- pick(sem(m("0"), d))
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")), errorVariance = ev, raw = raw, matrix = mat, none = none),
  auto_unbox = TRUE, digits = NA, pretty = TRUE
), "src/engine/__fixtures__/reliability_single.json")
cat("written\n")
