# Reference for the estimated marginal means section (src/rengine/R/emm.R) of the ANOVA,
# repeated-measures ANOVA and multilevel regression cards, written without the app's code:
# - ANOVA / ANCOVA: emmeans on lm fits (means, pairwise comparisons with each adjustment,
#   planned contrasts), simple effects by emmeans::joint_tests, Games-Howell by
#   rstatix::games_howell_test, Helmert contrasts from the raw cell means of a balanced design;
# - repeated measures: afex::aov_car with emmeans (afex's default multivariate model);
# - multilevel regression: lmerTest::lmer with emmeans, Kenward-Roger and Satterthwaite df.
# Writes src/engine/__fixtures__/emm/reference.json (data and results); emm.webr.test.ts compares.
#   Rscript scripts/validation/emm.R
suppressPackageStartupMessages({
  library(jsonlite)
  library(emmeans)
  library(afex)
  library(lmerTest)
})
frame <- function(df) {
  list(
    names = names(df),
    cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
    categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x)))
  )
}
tab <- function(x) {
  d <- as.data.frame(x)
  lower <- intersect(c("lower.CL", "asymp.LCL"), names(d))
  upper <- intersect(c("upper.CL", "asymp.UCL"), names(d))
  est <- intersect(c("emmean", "estimate"), names(d))
  stat <- intersect(c("t.ratio", "z.ratio"), names(d))
  out <- list(estimate = d[[est]], se = d$SE, df = d$df)
  if (length(stat)) out$t <- d[[stat]]
  if ("p.value" %in% names(d)) out$p <- d$p.value
  if (length(lower)) {
    out$lower <- d[[lower]]
    out$upper <- d[[upper]]
  }
  out
}
out <- list()

# ---- Two-way ANOVA: warpbreaks (balanced, 2 wools x 3 tensions)
wb <- warpbreaks
out$warpbreaks <- frame(wb)
op <- options(contrasts = c("contr.sum", "contr.poly"))
fit <- lm(breaks ~ wool * tension, data = wb)
options(op)
out$anova <- list(
  tension = tab(emmeans(fit, ~tension)),
  cells = tab(emmeans(fit, ~ wool * tension)),
  posthoc = lapply(
    setNames(c("tukey", "bonferroni", "holm", "scheffe", "none"), c("tukey", "bonferroni", "holm", "scheffe", "none")),
    function(a) tab(summary(pairs(emmeans(fit, ~tension)), adjust = a, infer = TRUE))
  ),
  simple = {
    j <- as.data.frame(joint_tests(fit, by = "wool"))
    j <- j[j$`model term` == "tension", ]
    list(f = j$F.ratio, df1 = j$df1, df2 = j$df2, p = j$p.value)
  },
  gamesHowell = {
    g <- rstatix::games_howell_test(wb, breaks ~ tension, conf.level = 0.95)
    # rstatix: estimate = mean(group2) - mean(group1); the card reports group1 - group2.
    list(estimate = -g$estimate, lower = -g$conf.high, upper = -g$conf.low, p = g$p.adj)
  },
  deviation = tab(summary(contrast(emmeans(fit, ~tension), "eff", adjust = "none"), infer = TRUE)),
  simpleLast = tab(summary(contrast(emmeans(fit, ~tension), "trt.vs.ctrl", ref = 3, adjust = "none"), infer = TRUE)),
  polynomial = tab(summary(contrast(emmeans(fit, ~tension), "poly", adjust = "none"), infer = TRUE)),
  # Balanced design: the marginal means are the raw group means, so Helmert contrasts are differences of raw means.
  helmert = {
    m <- tapply(wb$breaks, wb$tension, mean)
    c(m[["L"]] - mean(m[c("M", "H")]), m[["M"]] - m[["H"]])
  },
  custom = tab(summary(contrast(emmeans(fit, ~tension), list(c(1, -0.5, -0.5), c(0, 1, -1)), adjust = "none"), infer = TRUE))
)

# ---- ANCOVA: mtcars mpg by cylinders, adjusted for weight (means at the mean weight)
mt <- data.frame(mpg = mtcars$mpg, cyl = factor(mtcars$cyl), wt = mtcars$wt)
out$mtcars <- frame(mt)
fit2 <- lm(mpg ~ cyl + wt, data = mt)
out$ancova <- list(
  cyl = tab(emmeans(fit2, ~cyl)),
  posthoc = tab(summary(pairs(emmeans(fit2, ~cyl)), adjust = "tukey", infer = TRUE))
)

# ---- Repeated measures: OBrienKaiser (carData), afex's multivariate model
ok <- carData::OBrienKaiser
out$obk <- frame(ok)
cells <- names(ok)[3:17]
ok$id <- factor(seq_len(nrow(ok)))
long <- reshape(ok, direction = "long", varying = cells, v.names = "y", timevar = "cell", times = cells, idvar = "id")
long$phase <- factor(sub("\\..*", "", long$cell), levels = c("pre", "post", "fup"))
long$hour <- factor(sub(".*\\.", "", long$cell), levels = as.character(1:5))
# phase x hour within, treatment x gender between (the car path)
a1 <- aov_car(y ~ treatment * gender + Error(id / (phase * hour)), data = long)
# phase x hour within, no between factor
a2 <- aov_car(y ~ Error(id / (phase * hour)), data = long)
# one within factor (the pre-test's five hours) and one between factor
pre <- long[long$phase == "pre", ]
a3 <- aov_car(y ~ treatment + Error(id / hour), data = pre)
simple1 <- {
  j <- as.data.frame(joint_tests(a1, by = "treatment"))
  j <- j[j$`model term` == "phase", ]
  list(f = j$F.ratio, df1 = j$df1, df2 = j$df2, p = j$p.value)
}
out$rm <- list(
  car = list(
    phase = tab(emmeans(a1, ~phase)),
    treatmentPhase = tab(emmeans(a1, ~ treatment * phase)),
    posthoc = tab(summary(pairs(emmeans(a1, ~phase)), adjust = "bonferroni", infer = TRUE)),
    simple = simple1,
    polynomial = tab(summary(contrast(emmeans(a1, ~phase), "poly", adjust = "none"), infer = TRUE))
  ),
  multi = list(
    hour = tab(emmeans(a2, ~hour)),
    posthoc = tab(summary(pairs(emmeans(a2, ~phase)), adjust = "holm", infer = TRUE))
  ),
  single = list(
    hour = tab(emmeans(a3, ~hour)),
    cells = tab(emmeans(a3, ~ hour * treatment)),
    posthoc = tab(summary(pairs(emmeans(a3, ~treatment)), adjust = "tukey", infer = TRUE))
  )
)

# ---- Multilevel regression: nlme's Oats (split plot; yield by variety and nitrogen, blocks as clusters)
oats <- as.data.frame(nlme::Oats)
oats <- data.frame(
  yield = oats$yield,
  Variety = factor(as.character(oats$Variety)),
  nitro = oats$nitro,
  Block = as.integer(factor(as.character(oats$Block)))
)
out$oats <- frame(oats)
oats$Block <- factor(oats$Block)
fit3 <- lmer(yield ~ Variety + nitro + (1 | Block), data = oats)
out$lmm <- list(
  kr = tab(emmeans(fit3, ~Variety, lmer.df = "kenward-roger")),
  satterthwaite = tab(emmeans(fit3, ~Variety, lmer.df = "satterthwaite")),
  asymptotic = tab(emmeans(fit3, ~Variety, lmer.df = "asymptotic")),
  posthoc = tab(summary(pairs(emmeans(fit3, ~Variety, lmer.df = "kenward-roger")), adjust = "tukey", infer = TRUE))
)

out$versions <- list(
  emmeans = as.character(packageVersion("emmeans")),
  afex = as.character(packageVersion("afex")),
  rstatix = as.character(packageVersion("rstatix")),
  lme4 = as.character(packageVersion("lme4"))
)
dir <- file.path("src", "engine", "__fixtures__", "emm")
dir.create(dir, showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"), file.path(dir, "reference.json"))
