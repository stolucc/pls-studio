# Reference for CB-SEM with sampling weights (lavaan's sampling.weights): the
# three-factor CFA on HolzingerSwineford1939 weighted by w = 1 + (ageyr - 12) / 4,
# with ML (robust standard errors) and with MLR plus FIML (x1 missing in rows 3, 10).
#   R_LIBS=/path/to/lib Rscript scripts/validation/weights.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
})
d <- HolzingerSwineford1939
d$w <- 1 + (d$ageyr - 12) / 4
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
pick <- function(fit) {
  pe <- parameterEstimates(fit)
  ld <- pe[pe$op == "=~", ]
  list(
    chisq = unname(fitMeasures(fit, "chisq")),
    chisqScaled = unname(fitMeasures(fit, "chisq.scaled")),
    df = unname(fitMeasures(fit, "df")),
    loadings = setNames(as.list(ld$est), paste(ld$lhs, ld$rhs)),
    se = setNames(as.list(ld$se), paste(ld$lhs, ld$rhs)),
    n = lavInspect(fit, "nobs")
  )
}
ml <- cfa(m, d, sampling.weights = "w", estimator = "ML")
d2 <- d
d2$x1[c(3, 10)] <- NA
fiml <- cfa(m, d2, sampling.weights = "w", estimator = "MLR", missing = "ml")
write(
  toJSON(
    list(lavaan = as.character(packageVersion("lavaan")), ml = pick(ml), mlrFiml = pick(fiml)),
    auto_unbox = TRUE,
    digits = NA,
    pretty = TRUE
  ),
  "src/engine/__fixtures__/weights/reference.json"
)
cat("written\n")
