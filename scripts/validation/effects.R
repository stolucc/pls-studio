# Reference for the effect sizes and equivalence tests of the basic test cards
# (src/rengine/R/effects.R): direct calls to effectsize and TOSTER on R's own datasets, written
# without the app's code. Two-sided 95% intervals throughout (the cards' convention), except the
# one-sided t-test, whose intervals follow its alternative.
# Writes src/engine/__fixtures__/effects/reference.json; src/rengine/effects.webr.test.ts runs the
# cards and compares.
#   Rscript scripts/validation/effects.R   (with effectsize and TOSTER installed)
suppressPackageStartupMessages({
  library(jsonlite)
  library(effectsize)
  library(TOSTER)
})

frame <- function(df) {
  list(
    names = names(df),
    cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
    categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x)))
  )
}
es <- function(x) list(est = x[[1]][1], ciLow = x$CI_low[1], ciHigh = x$CI_high[1])
es_terms <- function(x) {
  lapply(seq_len(nrow(x)), function(i) {
    list(term = x$Parameter[i], est = x[[2]][i], ciLow = x$CI_low[i], ciHigh = x$CI_high[i])
  })
}
tost <- function(t) {
  list(
    lowerT = t$TOST["TOST Lower", "t"],
    lowerP = t$TOST["TOST Lower", "p.value"],
    upperT = t$TOST["TOST Upper", "t"],
    upperP = t$TOST["TOST Upper", "p.value"],
    df = t$TOST["TOST Lower", "df"],
    lowSmd = t$eqb$low_eq[2],
    rawLow = t$effsize$lower.ci[1],
    rawHigh = t$effsize$upper.ci[1],
    smd = t$effsize$estimate[2],
    smdLow = t$effsize$lower.ci[2],
    smdHigh = t$effsize$upper.ci[2]
  )
}

tg <- ToothGrowth
oj <- tg$len[tg$supp == "OJ"]
vc <- tg$len[tg$supp == "VC"]
sleep_wide <- data.frame(extra.1 = sleep$extra[1:10], extra.2 = sleep$extra[11:20])
dif <- sleep_wide$extra.1 - sleep_wide$extra.2

out <- list(
  toothgrowth = frame(tg),
  sleepWide = frame(sleep_wide),
  mtcars = frame(mtcars[, c("mpg", "wt", "qsec", "am", "vs", "cyl")]),
  independent = list(
    d = es(cohens_d(oj, vc)),
    g = es(hedges_g(oj, vc)),
    dWelch = es(cohens_d(oj, vc, pooled_sd = FALSE)),
    glass = es(glass_delta(oj, vc, adjust = FALSE)),
    rb = es(rank_biserial(oj, vc)),
    tostWelch = tost(t_TOST(x = oj, y = vc, low_eqbound = -3, high_eqbound = 3)),
    tostStudent = tost(t_TOST(x = oj, y = vc, var.equal = TRUE, low_eqbound = -3, high_eqbound = 3))
  ),
  # One sample against 18, one-sided ("greater"): intervals open above.
  one = list(
    d = es(cohens_d(tg$len, mu = 18, alternative = "greater")),
    g = es(hedges_g(tg$len, mu = 18, alternative = "greater")),
    rb = es(rank_biserial(tg$len, mu = 18, alternative = "greater")),
    # (bounds as differences from 18: t_TOST on the values minus 18)
    tost = tost(t_TOST(x = tg$len - 18, low_eqbound = -2, high_eqbound = 2))
  ),
  paired = list(
    d = es(cohens_d(dif)),
    g = es(hedges_g(dif)),
    rb = es(rank_biserial(sleep_wide$extra.1, sleep_wide$extra.2, paired = TRUE)),
    tostSmd = tost(suppressMessages(t_TOST(
      x = sleep_wide$extra.1,
      y = sleep_wide$extra.2,
      paired = TRUE,
      low_eqbound = -0.5,
      high_eqbound = 0.5,
      eqbound_type = "SMD"
    )))
  )
)

# ANOVA: ToothGrowth len by supp and dose; type I from aov, type III from car::Anova (type 3,
# sum-to-zero contrasts) on an unbalanced subset; one-way with Kruskal-Wallis epsilon-squared.
tg$dose <- factor(tg$dose)
fit1 <- aov(len ~ supp * dose, data = tg)
anova_es <- function(model) {
  list(
    eta2 = es_terms(eta_squared(model, partial = FALSE, alternative = "two.sided")),
    partialEta2 = es_terms(eta_squared(model, partial = TRUE, alternative = "two.sided")),
    omega2 = es_terms(omega_squared(model, partial = FALSE, alternative = "two.sided")),
    partialOmega2 = es_terms(omega_squared(model, partial = TRUE, alternative = "two.sided"))
  )
}
out$anovaTypeI <- anova_es(fit1)
unbalanced <- tg[-c(1, 2, 3, 40), ]
out$unbalanced <- frame(unbalanced)
op <- options(contrasts = c("contr.sum", "contr.poly"))
fit3 <- lm(len ~ supp * dose, data = unbalanced)
out$anovaTypeIII <- suppressMessages(anova_es(car::Anova(fit3, type = 3)[-1, ]))
options(op)
set.seed(1234)
out$epsilon2 <- es(rank_epsilon_squared(
  len ~ dose,
  data = tg,
  iterations = 1000,
  alternative = "two.sided"
))

# Contingency: Cramer's V (unadjusted) for am x cyl (2 x 3), and phi for am x vs (2 x 2).
am_cyl <- table(mtcars$am, mtcars$cyl)
am_vs <- table(mtcars$am, mtcars$vs)
out$cramerV <- es(cramers_v(am_cyl, adjust = FALSE, alternative = "two.sided"))
out$phi <- es(phi(am_vs, adjust = FALSE, alternative = "two.sided"))
out$cramerV2x2 <- es(cramers_v(am_vs, adjust = FALSE, alternative = "two.sided"))

# Correlation equivalence tests, bound 0.4, each method.
cor_tost <- function(method) {
  pairs <- combn(c("mpg", "wt", "qsec"), 2, simplify = FALSE)
  lapply(pairs, function(p) {
    h <- z_cor_test(
      mtcars[[p[1]]],
      mtcars[[p[2]]],
      alternative = "equivalence",
      method = method,
      null = 0.4
    )
    list(
      r = unname(h$estimate),
      z = unname(h$statistic),
      p = h$p.value,
      ciLow = h$conf.int[1],
      ciHigh = h$conf.int[2]
    )
  })
}
out$corTost <- list(
  pearson = cor_tost("pearson"),
  spearman = cor_tost("spearman"),
  kendall = cor_tost("kendall")
)

out$versions <- list(
  R = R.version.string,
  effectsize = as.character(packageVersion("effectsize")),
  TOSTER = as.character(packageVersion("TOSTER"))
)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, na = "null", pretty = TRUE),
  "src/engine/__fixtures__/effects/reference.json"
)
cat("written\n")
