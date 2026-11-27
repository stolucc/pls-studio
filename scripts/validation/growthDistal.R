# Reference results for growth factors as predictors of a distal outcome, and how the slope's effect depends on where
# time is coded zero (McCormick, Curran & Hancock 2026, "Latent growth factors as predictors of distal outcomes"). Data:
# the National Longitudinal Survey of Young Women (sampleSelection::nlswork, NLS public-use data): log hourly wage at
# the five yearly interviews 1969-1973, and log hourly wage at the 1988 interview as the distal outcome. Women
# interviewed in at least one of these years; missing values by FIML. The same model twice: intercept at the first
# wave (time 0..4) and at the last (time -4..0), as in the authors' code (OSF fzubt, AlphaBeta.Rmd).
# Also writes the examples' data, public/examples/growth-distal/nlswork-distal.csv.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/growthDistal.R

suppressPackageStartupMessages(library(lavaan))
data(nlswork, package = "sampleSelection")
years <- c(69:73, 88)
long <- nlswork[nlswork$year %in% years, c("idcode", "year", "ln_wage")]
wide <- reshape(long, idvar = "idcode", timevar = "year", direction = "wide")
wide <- wide[order(wide$idcode), ]
d <- data.frame(id = wide$idcode)
for (t in years) d[[paste0("lnwage", t)]] <- round(wide[[paste0("ln_wage.", t)]], 6)
dir.create("public/examples/growth-distal", showWarnings = FALSE, recursive = TRUE)
write.csv(d, "public/examples/growth-distal/nlswork-distal.csv", row.names = FALSE, na = "")

model <- function(times) paste(
  "i =~ 1*lnwage69 + 1*lnwage70 + 1*lnwage71 + 1*lnwage72 + 1*lnwage73",
  sprintf("s =~ %s", paste0(times, "*lnwage", 69:73, collapse = " + ")),
  "lnwage88 ~ 1 + i + s",
  sep = "\n"
)
for (times in list(0:4, -4:0)) {
  fit <- growth(model(times), data = d, estimator = "ML", missing = "ml")
  cat("\ntimes", times, " n", lavInspect(fit, "nobs"), "\n")
  print(fitMeasures(fit, c("chisq", "df", "cfi", "rmsea")), digits = 10)
  pe <- parameterEstimates(fit, standardized = TRUE)
  print(pe[pe$op %in% c("~", "~1", "~~") & pe$lhs %in% c("i", "s", "lnwage88"), c("lhs", "op", "rhs", "est", "se", "z", "std.all")], digits = 10)
  print(lavInspect(fit, "rsquare")["lnwage88"], digits = 10)
}
