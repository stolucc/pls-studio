# Reference for CB-SEM reliability: semTools::compRelSEM omega and alpha of the
# three HolzingerSwineford1939 factors - one group, the two schools, and with a
# residual covariance x1 ~~ x4.
#   R_LIBS=/path/to/lib Rscript scripts/validation/reliability.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(semTools)
})
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
rel <- function(fit) list(omega = lapply(compRelSEM(fit), function(v) as.numeric(unclass(v))), alpha = lapply(compRelSEM(fit, tau.eq = TRUE), function(v) as.numeric(unclass(v))))
out <- list(
  semTools = as.character(packageVersion("semTools")),
  one = rel(cfa(m, HolzingerSwineford1939)),
  groups = rel(cfa(m, HolzingerSwineford1939, group = "school")),
  rescov = rel(cfa(paste(m, "\nx1 ~~ x4"), HolzingerSwineford1939))
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/weights/reliability.json")
cat("written\n")
