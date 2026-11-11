# Reference for the Kaplan-Meier card, survival called directly (independent of
# PLS Studio's code):
#   - ?survfit.formula's example: survfit(Surv(time, status) ~ x, data = aml),
#     the estimates, their log intervals, medians with intervals, and the
#     numbers at risk at 0, 20, ..., 160
#   - ?survdiff's two-sample test: survdiff(Surv(futime, fustat) ~ rx,
#     data = ovarian), rho = 0 and rho = 1
#   - lung by sex (status 1/2 recoded 0/1) with log-log intervals and the
#     log-rank and Peto tests; aml as one sample (no groups) with plain intervals
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/survival_km.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(survival)
})

curve <- function(fit, times) {
  tab <- summary(fit)$table
  if (!is.matrix(tab)) tab <- t(as.matrix(tab))
  risk <- summary(fit, times = times, extend = TRUE)
  sizes <- if (is.null(fit$strata)) length(fit$time) else unname(fit$strata)
  ends <- cumsum(sizes)
  lapply(seq_along(sizes), function(i) {
    k <- seq(ends[i] - sizes[i] + 1, ends[i])
    strata <- if (is.null(risk$strata)) rep(TRUE, length(risk$time)) else as.integer(risk$strata) == i
    list(
      n = unname(tab[i, "records"]),
      events = unname(tab[i, "events"]),
      median = unname(tab[i, "median"]),
      medianLow = unname(tab[i, grep("LCL$", colnames(tab))]),
      medianHigh = unname(tab[i, grep("UCL$", colnames(tab))]),
      time = fit$time[k],
      surv = fit$surv[k],
      lower = fit$lower[k],
      upper = fit$upper[k],
      riskAt = risk$n.risk[strata]
    )
  })
}
test <- function(sd) {
  list(
    chisq = sd$chisq,
    df = length(sd$n) - 1,
    p = pchisq(sd$chisq, length(sd$n) - 1, lower.tail = FALSE),
    observed = as.numeric(sd$obs),
    expected = as.numeric(sd$exp)
  )
}

lung2 <- transform(lung, dead = status - 1)
aml_times <- seq(0, 160, by = 20)
out <- list(
  version = as.character(packageVersion("survival")),
  aml = list(
    strata = curve(survfit(Surv(time, status) ~ x, data = aml), aml_times),
    logrank = test(survdiff(Surv(time, status) ~ x, data = aml)),
    peto = test(survdiff(Surv(time, status) ~ x, data = aml, rho = 1))
  ),
  ovarian = list(
    logrank = test(survdiff(Surv(futime, fustat) ~ rx, data = ovarian)),
    peto = test(survdiff(Surv(futime, fustat) ~ rx, data = ovarian, rho = 1))
  ),
  lung = list(
    strata = curve(
      survfit(Surv(time, dead) ~ sex, data = lung2, conf.type = "log-log"),
      c(0, 250, 500, 750, 1000)
    ),
    logrank = test(survdiff(Surv(time, dead) ~ sex, data = lung2)),
    peto = test(survdiff(Surv(time, dead) ~ sex, data = lung2, rho = 1))
  ),
  amlOne = list(
    strata = curve(survfit(Surv(time, status) ~ 1, data = aml, conf.type = "plain", conf.int = 0.9), aml_times)
  )
)
dir.create("src/engine/__fixtures__/survival", showWarnings = FALSE, recursive = TRUE)
write(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  "src/engine/__fixtures__/survival/km.json"
)
cat("written\n")
