# Reference results for the time-varying effect model card (analyses/tvem.tsx, R ps_tvem) from the tvem package
# (Dziak et al.), which the card follows, on its two examples: mgcv's own varying-coefficient example data (?gam.models:
# set.seed(10); gamSim(3, n = 400), y = f(x2) x1 + noise; packages.ts: mgcv-gamsim3-tvem), each row its own case, and
# the NLS Young Women in long format (public/examples/lcmsr/nlswork-long.csv; nls-tvem): log wage on weekly hours,
# the effect varying with age, clustered by woman. tvem is not part of the app: install it in a library of its own.
#   R_LIBS=/path/to/scratch/library:/path/to/helper/library Rscript scripts/validation/tvem.R
# Writes public/examples/mgcv/gamsim3.csv and src/engine/__fixtures__/tvem/reference.json.

suppressPackageStartupMessages({
  library(mgcv)
  library(tvem)
  library(jsonlite)
})
set.seed(10)
dat <- gamSim(3, n = 400, verbose = FALSE)
write.csv(round(dat, 8), "public/examples/mgcv/gamsim3.csv", row.names = FALSE)
dat <- read.csv("public/examples/mgcv/gamsim3.csv")
dat$row <- seq_len(nrow(dat))
curves <- function(m) {
  lapply(m$grid_fitted_coefficients, function(g) list(estimate = g$estimate, se = g$standard_error))
}
quiet <- function(e) {
  out <- NULL
  invisible(capture.output(out <- e))
  out
}
g3 <- quiet(tvem(data = dat, formula = y ~ x1, id = row, time = x2))
# The help page's own model, for comparison: gam(y ~ s(x2, by = x1)); and the true f(x2) on the grid
doc <- gam(y ~ s(x2, by = x1), data = dat)
grid3 <- g3$time_grid
f_true <- 0.2 * grid3^11 * (10 * (1 - grid3))^6 + 10 * (10 * grid3)^3 * (1 - grid3)^10
doc_curve <- predict(doc, newdata = data.frame(x2 = grid3, x1 = 1))

nls <- read.csv("public/examples/lcmsr/nlswork-long.csv")
nls <- nls[complete.cases(nls[, c("idcode", "ln_wage", "age", "hours")]), ]
gn <- quiet(tvem(data = nls, formula = ln_wage ~ hours, id = idcode, time = age))

out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  tvem = as.character(packageVersion("tvem")),
  mgcv = as.character(packageVersion("mgcv")),
  gamsim3 = list(n = nrow(dat), grid = grid3, curves = curves(g3), truth = f_true, docModel = unname(doc_curve)),
  nls = list(n = nrow(nls), clusters = length(unique(nls$idcode)), grid = gn$time_grid, curves = curves(gn))
)
write_json(out, "src/engine/__fixtures__/tvem/reference.json", digits = NA, auto_unbox = TRUE)
cat("written\n")
cat("gamsim3: RMSE of the card's curve against f", sqrt(mean((g3$grid_fitted_coefficients$x1$estimate - f_true)^2)),
  " the help model's", sqrt(mean((doc_curve - f_true)^2)), "\n")
b <- gn$grid_fitted_coefficients$hours
print(round(cbind(age = gn$time_grid, b)[seq(1, 100, by = 11), ], 5))
