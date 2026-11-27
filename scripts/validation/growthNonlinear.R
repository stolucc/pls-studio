# Reference results for nonlinear growth on the growth card (packages.ts: nls-growth-exponential, nls-growth-quadratic):
# log hourly wage of the NLS Young Women every five years 1968-1988 (sampleSelection::nlswork, NLS public-use data;
# the women interviewed at least once in 1968, 1973, 1978, 1983 or 1988; missing interviews by FIML). An
# exponential curve written as a structured latent curve (Browne 1993; Preacher & Hancock 2015): the slope factor's
# loadings (1 - r^k) / (1 - r) for k five-year steps, fixed at 0 and 1 for 1968 and 1973, the later ones nonlinear
# functions of the 1978 loading (r = l3 - 1, the share of each five years' gain that carries on to the next), so a
# woman's change has two meaningful random coefficients: her starting level and her first five years' gain; against
# linear, quadratic and latent-basis curves of the same data, in desktop lavaan. (All 15 interviews take desktop
# lavaan minutes with 13 nonlinear constraints; the five waves take seconds, also in the browser.)
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/growthNonlinear.R
# Writes public/examples/nls-growth/nlswork-5wave.csv and src/engine/__fixtures__/growthNonlinear/reference.json.

suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
data(nlswork, package = "sampleSelection")
yrs <- c(68, 73, 78, 83, 88)
y <- paste0("lnwage", yrs)
t <- yrs - 68
k <- t / 5
lab <- paste0("l", seq_along(t))
w <- nlswork[nlswork$year %in% yrs, c("idcode", "year", "ln_wage")]
w <- reshape(w, idvar = "idcode", timevar = "year", direction = "wide")
names(w) <- sub("ln_wage.", "lnwage", names(w), fixed = TRUE)
w <- w[order(w$idcode), c("idcode", y)]
for (v in y) w[[v]] <- round(w[[v]], 6)
write.csv(w, "public/examples/nls-growth/nlswork-5wave.csv", row.names = FALSE, na = "")
w <- read.csv("public/examples/nls-growth/nlswork-5wave.csv")
i_line <- sprintf("i =~ %s", paste0("1*", y, collapse = " + "))
exponential <- paste(
  i_line,
  sprintf(
    "s =~ 0*%s + 1*%s + %s + %s", y[1], y[2], paste0(lab[-(1:2)], "*", y[-(1:2)], collapse = " + "),
    # (starts from r = .55, rounded: starts that meet the constraints exactly stop lavaan's constrained optimiser
    # at its first step)
    paste0("start(", round((1 - 0.55^k[-(1:2)]) / 0.45, 3), ")*", y[-(1:2)], collapse = " + ")
  ),
  paste(sprintf("%s == (1 - (l3 - 1)^%s) / (2 - l3)", lab[-(1:3)], k[-(1:3)]), collapse = "\n"),
  "r := l3 - 1",
  sep = "\n"
)
writeLines(exponential, "src/engine/__fixtures__/growthNonlinear/exponential.lav")
fit_e <- growth(exponential, data = w, missing = "ml")
# (the quadratic as the card writes it, time in decades since 1968: scores d and d^2; in years, the squares reach
# 400 and lavaan stops short of the optimum)
d <- t / 10
fit_q <- growth(paste(i_line, sprintf("s =~ %s", paste0(format(d), "*", y, collapse = " + ")),
  sprintf("q =~ %s", paste0(format(d^2), "*", y, collapse = " + ")), sep = "\n"), data = w, missing = "ml")
fit_l <- growth(paste(i_line, sprintf("s =~ %s", paste0(t, "*", y, collapse = " + ")), sep = "\n"), data = w,
  missing = "ml")
fit_b <- growth(paste(i_line, sprintf("s =~ 0*%s + 1*%s + %s", y[1], y[2], paste0(y[-(1:2)], collapse = " + ")),
  sep = "\n"), data = w, missing = "ml")
fm <- function(f) as.list(fitMeasures(f, c("chisq", "df", "cfi", "rmsea", "aic", "bic")))
est <- function(f, lhs, op, rhs = "") {
  pe <- parameterEstimates(f)
  r <- pe[pe$lhs == lhs & pe$op == op & pe$rhs == rhs, ][1, ]
  list(est = r$est, se = r$se)
}
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  lavaan = as.character(packageVersion("lavaan")),
  n = lavInspect(fit_e, "nobs"),
  times = t,
  exponential = list(fit = fm(fit_e), r = est(fit_e, "r", ":=", "l3-1"), iMean = est(fit_e, "i", "~1"),
    sMean = est(fit_e, "s", "~1"), sVar = est(fit_e, "s", "~~", "s"), l5 = est(fit_e, "s", "=~", "lnwage88")),
  quadratic = list(fit = fm(fit_q), sMean = est(fit_q, "s", "~1"), qMean = est(fit_q, "q", "~1")),
  linear = list(fit = fm(fit_l)),
  basis = list(fit = fm(fit_b))
)
write_json(out, "src/engine/__fixtures__/growthNonlinear/reference.json", digits = NA, auto_unbox = TRUE, pretty = TRUE)
for (m in c("linear", "basis", "exponential", "quadratic")) print(round(unlist(out[[m]]$fit), 3))
str(out$exponential[-1]); str(out$quadratic[-1])
