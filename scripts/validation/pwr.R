# Reference for the Power (standard tests) card: pwr called directly, on the
# help pages' examples (Cohen 1988's exercises) and the card's other modes
# (sensitivity, the two-proportion h from proportions, one-sided tests).
# Independent of PLS Studio's code.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/pwr.R

`%||%` <- function(a, b) if (is.null(a)) b else a

suppressPackageStartupMessages({
  library(jsonlite)
  library(pwr)
})

# The fields every case records: N (pwr's own), power and the effect size.
# N: pwr's n (exact: pw$n would match "note"), its N (chi-square) or u + v + 1 (f2).
pick <- function(pw, es) {
  n <- if (!is.null(pw$v)) pw$u + pw$v + 1 else pw[["n", exact = TRUE]] %||% pw$N
  list(n = unname(n), power = unname(pw$power), effect = unname(pw[[es]]))
}

cases <- list(
  # ?pwr.t.test
  t1_power = pick(
    pwr.t.test(d = 0.2, n = 60, sig.level = 0.10, type = "one.sample"), "d"
  ),
  paired_power = pick(
    pwr.t.test(d = 8 / (16 * sqrt(2 * (1 - 0.6))), n = 40, type = "paired"), "d"
  ),
  t2_power = pick(pwr.t.test(d = 2 / 2.8, n = 30, type = "two.sample"), "d"),
  t2_n = pick(
    pwr.t.test(d = 0.3, power = 0.75, type = "two.sample", alternative = "greater"), "d"
  ),
  # ?pwr.anova.test
  anova_power = pick(pwr.anova.test(f = 0.28, k = 4, n = 20), "f"),
  anova_n = pick(pwr.anova.test(f = 0.28, k = 4, power = 0.80), "f"),
  # ?pwr.2p.test and ?pwr.p.test
  p2_power = pick(pwr.2p.test(h = 0.3, n = 80, alternative = "greater"), "h"),
  p1_power = pick(pwr.p.test(h = ES.h(0.5, 0.4), n = 60), "h"),
  p1_n = pick(pwr.p.test(h = 0.2, power = 0.95), "h"),
  # ?pwr.r.test
  r_power = pick(pwr.r.test(r = 0.3, n = 50), "r"),
  r_power_greater = pick(pwr.r.test(r = 0.3, n = 50, alternative = "greater"), "r"),
  r_n = pick(pwr.r.test(r = 0.3, power = 0.80), "r"),
  # ?pwr.chisq.test
  chisq_power = pick(pwr.chisq.test(w = 0.289, df = 3, N = 100), "w"),
  chisq_power_01 = pick(
    pwr.chisq.test(w = 0.346, df = 2, N = 140, sig.level = 0.01), "w"
  ),
  chisq_n = pick(pwr.chisq.test(w = 0.1, df = 20, power = 0.80), "w"),
  # ?pwr.f2.test (N = u + v + 1 = 95)
  f2_power = pick(pwr.f2.test(u = 5, v = 89, f2 = 0.1 / (1 - 0.1)), "f2"),
  f2_n = pick(pwr.f2.test(u = 3, f2 = 0.15, power = 0.8), "f2"),
  # Sensitivity (the effect solved), one per kind of test
  t2_effect = pick(pwr.t.test(n = 64, power = 0.8, type = "two.sample"), "d"),
  anova_effect = pick(pwr.anova.test(k = 3, n = 30, power = 0.9), "f"),
  p2_effect = pick(pwr.2p.test(n = 100, power = 0.8), "h"),
  r_effect = pick(pwr.r.test(n = 80, power = 0.8), "r"),
  chisq_effect = pick(pwr.chisq.test(N = 140, df = 2, power = 0.8, sig.level = 0.01), "w"),
  f2_effect = pick(pwr.f2.test(u = 4, v = 95, power = 0.8), "f2"),
  # Two proportions from the proportions (h = ES.h(.65, .45)), solved for N
  p2_props_n = pick(pwr.2p.test(h = ES.h(0.65, 0.45), power = 0.9), "h")
)
# One point of the power curve: the two-sample t-test at n = 100 with d = 0.3 (greater).
cases$t2_curve_100 <- pwr.t.test(d = 0.3, n = 100, alternative = "greater")$power
cases$version <- as.character(packageVersion("pwr"))
dir.create("src/engine/__fixtures__/pwr", showWarnings = FALSE, recursive = TRUE)
write(
  toJSON(cases, auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/engine/__fixtures__/pwr/reference.json"
)
cat("written\n")
