# Reference for the basic-test cards (src/rengine/R/tests.R): the same tests by
# direct calls to base R on R's own datasets, written without the app's code.
# Writes src/engine/__fixtures__/tests/reference.json (the data and the results);
# the webR test runs the cards on the data and compares.
#   Rscript scripts/validation/tests.R
suppressPackageStartupMessages(library(jsonlite))
frame <- function(df) {
  list(
    names = names(df), cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
    categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x)))
  )
}
ht <- function(h) {
  list(
    stat = unname(h$statistic), p = h$p.value, df = if (is.null(h$parameter)) NULL else unname(h$parameter),
    ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1], ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2]
  )
}
out <- list()
# ToothGrowth: tooth length by supplement (2 groups) and dose (3 levels)
tg <- ToothGrowth
tg$dose <- factor(tg$dose)
out$toothgrowth <- frame(tg)
a <- split(tg$len, tg$supp)
out$ttestIndependent <- list(
  student = ht(t.test(a$OJ, a$VC, var.equal = TRUE)),
  welch = ht(t.test(a$OJ, a$VC)),
  rank = ht(wilcox.test(a$OJ, a$VC, exact = FALSE)),
  d = (mean(a$OJ) - mean(a$VC)) / sqrt((29 * var(a$OJ) + 29 * var(a$VC)) / 58),
  levene = {
    m <- anova(lm(abs(tg$len - ave(tg$len, tg$supp, FUN = median)) ~ tg$supp))
    list(stat = m$`F value`[1], p = m$`Pr(>F)`[1])
  }
)
out$ttestOne <- list(
  student = ht(t.test(tg$len, mu = 18, alternative = "greater")),
  rank = ht(wilcox.test(tg$len, mu = 18, alternative = "greater", exact = FALSE)),
  d = (mean(tg$len) - 18) / sd(tg$len),
  shapiro = ht(shapiro.test(tg$len))
)
# Two-way ANOVA, type III (sum-to-zero contrasts) and type I
op <- options(contrasts = c("contr.sum", "contr.poly"))
f3 <- drop1(lm(len ~ supp * dose, data = tg), ~., test = "F")
options(op)
f1 <- anova(lm(len ~ supp * dose, data = tg))
out$anova2 <- list(
  typeIII = lapply(
    c("supp", "dose", "supp:dose"),
    function(t) list(term = t, ss = f3[t, "Sum of Sq"], df = f3[t, "Df"], f = f3[t, "F value"], p = f3[t, "Pr(>F)"])
  ),
  typeI = lapply(
    c("supp", "dose", "supp:dose"),
    function(t) list(term = t, ss = f1[t, "Sum Sq"], df = f1[t, "Df"], f = f1[t, "F value"], p = f1[t, "Pr(>F)"])
  ),
  residualSS = f1["Residuals", "Sum Sq"]
)
# One-way ANOVA with Welch, Kruskal-Wallis and Tukey
tk <- TukeyHSD(aov(len ~ dose, data = tg))$dose
out$anova1 <- list(
  f = anova(lm(len ~ dose, data = tg))["dose", "F value"],
  welch = ht(oneway.test(len ~ dose, data = tg)),
  kruskal = ht(kruskal.test(len ~ dose, data = tg)),
  tukey = lapply(
    seq_len(nrow(tk)),
    function(i) list(diff = tk[i, "diff"], ciLow = tk[i, "lwr"], ciHigh = tk[i, "upr"], p = tk[i, "p adj"])
  )
)
# ANCOVA: mtcars mpg by transmission, weight as covariate (type III)
mt <- data.frame(
  mpg = mtcars$mpg,
  wt = mtcars$wt,
  am = factor(mtcars$am, labels = c("automatic", "manual")),
  vs = factor(mtcars$vs, labels = c("V", "straight")),
  cyl = factor(mtcars$cyl),
  hp = mtcars$hp,
  disp = mtcars$disp
)
out$mtcars <- frame(mt)
op <- options(contrasts = c("contr.sum", "contr.poly"))
fa <- drop1(lm(mpg ~ am + wt, data = mt), ~., test = "F")
options(op)
out$ancova <- lapply(
  c("am", "wt"),
  function(t) list(term = t, ss = fa[t, "Sum of Sq"], f = fa[t, "F value"], p = fa[t, "Pr(>F)"])
)
# Sleep: paired samples (the two drugs on the same ten patients)
sl <- data.frame(drug1 = sleep$extra[1:10], drug2 = sleep$extra[11:20])
out$sleep <- frame(sl)
dif <- sl$drug1 - sl$drug2
out$ttestPaired <- list(
  student = ht(t.test(sl$drug1, sl$drug2, paired = TRUE)),
  rank = ht(wilcox.test(sl$drug1, sl$drug2, paired = TRUE, exact = FALSE)),
  d = mean(dif) / sd(dif)
)
# Repeated measures: CO2 uptake of 12 plants at four concentrations, plant type between
w <- reshape(
  as.data.frame(CO2)[CO2$conc %in% c(95, 175, 250, 350), c("Plant", "Type", "conc", "uptake")],
  idvar = c("Plant", "Type"),
  timevar = "conc",
  direction = "wide"
)
co2 <- data.frame(
  c95 = w$uptake.95,
  c175 = w$uptake.175,
  c250 = w$uptake.250,
  c350 = w$uptake.350,
  type = factor(as.character(w$Type))
)
out$co2 <- frame(co2)
Y <- as.matrix(co2[, 1:4])
long <- data.frame(
  subject = factor(rep(1:12, 4)),
  conc = factor(rep(names(co2)[1:4], each = 12), levels = names(co2)[1:4]),
  y = c(Y),
  type = rep(co2$type, 4)
)
s <- summary(aov(y ~ conc * type + Error(subject / conc), data = long))
wt <- s[["Error: subject:conc"]][[1]]
bt <- s[["Error: subject"]][[1]]
m1 <- lm(Y ~ co2$type)
sp <- anova(m1, X = ~1, test = "Spherical")
m0 <- lm(Y ~ 1)
sp0 <- anova(m0, X = ~1, test = "Spherical")
out$rmanova <- list(
  withinF = unname(wt[1:2, "F value"]), withinP = unname(wt[1:2, "Pr(>F)"]), betweenF = unname(bt[1, "F value"]),
  mauchly = ht(mauchly.test(m1, X = ~1)), pGG = unname(sp[1:2, "G-G Pr"]), pHF = unname(sp[1:2, "H-F Pr"])
)
s0 <- summary(aov(y ~ conc + Error(subject / conc), data = long))[["Error: subject:conc"]][[1]]
out$rmanova0 <- list(f = s0[1, "F value"], p = s0[1, "Pr(>F)"], pGG = sp0[1, "G-G Pr"], friedman = ht(friedman.test(Y)))
# MANOVA: iris sepal and petal length by species
out$iris <- frame(iris[, c("Sepal.Length", "Petal.Length", "Species")])
fm <- manova(cbind(Sepal.Length, Petal.Length) ~ Species, data = iris)
out$manova <- lapply(c("Pillai", "Wilks", "Hotelling-Lawley", "Roy"), function(t) {
  st <- summary(fm, test = t)$stats
  list(test = t, value = st[1, 2], f = st[1, 3], p = st[1, 6])
})
# Correlations: mtcars mpg, wt, hp, disp
cr <- function(m) {
  lapply(combn(c("mpg", "wt", "hp", "disp"), 2, simplify = FALSE), function(p) {
    h <- cor.test(mt[[p[1]]], mt[[p[2]]], method = m, exact = if (m == "pearson") NULL else FALSE)
    list(
      a = p[1],
      b = p[2],
      r = unname(h$estimate),
      p = h$p.value,
      ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1],
      ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2]
    )
  })
}
out$correlation <- list(pearson = cr("pearson"), spearman = cr("spearman"), kendall = cr("kendall"))
# Contingency: transmission by engine shape (2 x 2), and by cylinders (2 x 3)
t22 <- table(mt$am, mt$vs)
t23 <- table(mt$am, mt$cyl)
ch <- chisq.test(t22, correct = FALSE)
E <- ch$expected
out$contingency22 <- list(
  chisq = ht(ch),
  yates = ht(chisq.test(t22)),
  fisher = ht(fisher.test(t22)),
  g2 = 2 * sum(t22 * log(t22 / E)),
  cramerV = sqrt(unname(ch$statistic) / 32),
  oddsRatio = (t22[1, 1] * t22[2, 2]) / (t22[1, 2] * t22[2, 1])
)
c23 <- suppressWarnings(chisq.test(t23, correct = FALSE))
out$contingency23 <- list(chisq = ht(c23), fisher = ht(fisher.test(t23)), cramerV = sqrt(unname(c23$statistic) / 32))
# Binomial and multinomial: transmission against 0.5; cylinders against equal and given proportions
out$binomial <- lapply(as.numeric(table(mt$am)), function(k) ht(binom.test(k, 32, p = 0.5)))
out$multinomial <- list(
  equal = ht(chisq.test(table(mt$cyl))),
  given = ht(chisq.test(table(mt$cyl), p = c(1, 1, 2), rescale.p = TRUE))
)
# Post hoc: pairwise Wilcoxon after Kruskal-Wallis (Holm), pairwise paired t-tests after repeated measures (Holm)
pw <- pairwise.wilcox.test(tg$len, tg$dose, p.adjust.method = "holm", exact = FALSE)$p.value
out$pairwiseRank <- c(pw["1", "0.5"], pw["2", "0.5"], pw["2", "1"])
pr <- combn(4, 2, simplify = FALSE)
pp <- vapply(pr, function(k) t.test(Y[, k[1]], Y[, k[2]], paired = TRUE)$p.value, 0)
out$rmPosthoc <- list(p = pp, pHolm = p.adjust(pp, "holm"))
# Reliability (psych): five agreeableness items of bfi (complete cases of the first 300), Shrout & Fleiss's ratings,
# two raters' categories, and Bland-Altman on two of the CO2 concentrations
if (requireNamespace("psych", quietly = TRUE)) {
  suppressPackageStartupMessages(library(psych))
  it <- bfi[1:300, c("A2", "A3", "A4", "A5")]
  out$bfi <- frame(it)
  itc <- it[complete.cases(it), ]
  al <- alpha(itc, check.keys = FALSE)
  out$scale <- list(
    alpha = al$total$raw_alpha,
    omega = suppressMessages(omega(itc, nfactors = 1, plot = FALSE))$omega.tot,
    glb = glb.fa(cor(itc))$glb,
    alphaDrop = al$alpha.drop$raw_alpha,
    itemRest = al$item.stats$r.drop
  )
  sf <- data.frame(
    j1 = c(9, 6, 8, 7, 10, 6),
    j2 = c(2, 1, 4, 1, 5, 2),
    j3 = c(5, 3, 6, 2, 6, 4),
    j4 = c(8, 2, 8, 6, 9, 7)
  )
  out$shroutFleiss <- frame(sf)
  ic <- ICC(sf, lmer = FALSE)$results
  out$icc <- list(icc = ic$ICC, lower = ic[["lower bound"]])
  kp <- data.frame(a = c(1, 2, 2, 3, 1, 1, 2, 3, 3, 1, 2, 2), b = c(1, 2, 3, 3, 1, 2, 2, 3, 3, 1, 1, 2))
  out$raters <- frame(kp)
  ck <- suppressWarnings(cohen.kappa(kp))$confid
  out$kappa <- list(kappa = ck[1, 2], weighted = ck[2, 2], lower = ck[1, 1])
}
d <- co2$c250 - co2$c350
out$blandAltman <- list(
  bias = mean(d),
  lower = mean(d) - 1.96 * sd(d),
  upper = mean(d) + 1.96 * sd(d),
  ciLow = t.test(d)$conf.int[1]
)
out$versions <- list(R = R.version.string)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"),
  "src/engine/__fixtures__/tests/reference.json"
)
