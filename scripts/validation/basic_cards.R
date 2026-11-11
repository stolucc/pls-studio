# The basic-statistics card examples (src/examples/cards/basic.ts): writes their CSV files (public/examples/tests, the help
# pages' inline data, coded 1..k) and prints the reference values src/examples/cards/basic.webr.test.ts compares with.
# Run from public/examples/tests: Rscript ../../../scripts/validation/basic_cards.R
suppressPackageStartupMessages(library(seminr))
cat("faithful:", coef(lm(waiting ~ eruptions, faithful)), cor(faithful$eruptions, faithful$waiting), "\n")
# corp_rep extended (Hair et al. 2021)
mm <- constructs(
  composite("QUAL", multi_items("qual_", 1:8), weights = mode_B),
  composite("PERF", multi_items("perf_", 1:5), weights = mode_B),
  composite("CSOR", multi_items("csor_", 1:5), weights = mode_B),
  composite("ATTR", multi_items("attr_", 1:3), weights = mode_B),
  composite("COMP", multi_items("comp_", 1:3)),
  composite("LIKE", multi_items("like_", 1:3)),
  composite("CUSA", single_item("cusa")),
  composite("CUSL", multi_items("cusl_", 1:3))
)
sm <- relationships(
  paths(from = c("QUAL", "PERF", "CSOR", "ATTR"), to = c("COMP", "LIKE")),
  paths(from = c("COMP", "LIKE"), to = c("CUSA", "CUSL")),
  paths(from = c("CUSA"), to = c("CUSL"))
)
m <- estimate_pls(data = corp_rep_data, measurement_model = mm, structural_model = sm, missing = mean_replacement, missing_value = "-99")
print(round(m$path_coef, 4))
cat("n", nrow(m$data), "\n")
for (tech in c("DA", "EA")) {
  set.seed(123)
  p <- predict_pls(model = m, technique = if (tech == "DA") predict_DA else predict_EA, noFolds = 10, reps = 10)
  s <- summary(p)
  cat(tech, "\n")
  print(s$PLS_out_of_sample)
  print(s$LM_out_of_sample)
}
# mobi alternative models demo
mobi_mm <- constructs(
  composite("Image", multi_items("IMAG", 1:5)), composite("Expectation", multi_items("CUEX", 1:3)),
  composite("Quality", multi_items("PERQ", 1:7)), composite("Value", multi_items("PERV", 1:2)),
  composite("Satisfaction", multi_items("CUSA", 1:3)), composite("Complaints", single_item("CUSCO")),
  composite("Loyalty", multi_items("CUSL", 1:3))
)
antecedents <- c("Image", "Expectation", "Quality")
mediators <- c("Satisfaction", "Value")
outcomes <- c("Loyalty", "Complaints")
med <- estimate_pls(mobi, mobi_mm, relationships(paths(from = antecedents, to = mediators), paths(from = mediators, to = outcomes)))
ovr <- estimate_pls(mobi, mobi_mm, relationships(paths(from = antecedents, to = mediators), paths(from = c(antecedents, mediators), to = outcomes)))
cat("mediated\n")
print(summary(med)$it_criteria)
cat("overriding\n")
print(summary(ovr)$it_criteria)
w <- function(d, f) write.csv(d, f, row.names = FALSE, quote = FALSE)
tear <- c(6.5, 6.2, 5.8, 6.5, 6.5, 6.9, 7.2, 6.9, 6.1, 6.3, 6.7, 6.6, 7.2, 7.1, 6.8, 7.1, 7.0, 7.2, 7.5, 7.6)
gloss <- c(9.5, 9.9, 9.6, 9.6, 9.2, 9.1, 10.0, 9.9, 9.5, 9.4, 9.1, 9.3, 8.3, 8.4, 8.5, 9.2, 8.8, 9.7, 10.1, 9.2)
opacity <- c(4.4, 6.4, 3.0, 4.1, 0.8, 5.7, 2.0, 3.9, 1.9, 5.7, 2.8, 4.1, 3.8, 1.6, 3.4, 8.4, 5.2, 6.9, 2.7, 1.9)
Y <- cbind(tear, gloss, opacity)
rate <- gl(2, 10, labels = c("Low", "High"))
additive <- gl(2, 5, length = 20, labels = c("Low", "High"))
w(data.frame(rate = as.integer(rate), additive = as.integer(additive), tear, gloss, opacity), "plastic.csv")
fit <- manova(Y ~ rate * additive)
print(summary(fit, test = "Wilks"))
print(summary(fit))
print(summary(fit, test = "Hotelling-Lawley")$stats)
print(summary(fit, test = "Roy")$stats)
print(cor.test(~ CONT + INTG, data = USJudgeRatings))
M <- as.table(rbind(c(762, 327, 468), c(484, 239, 477)))
print(chisq.test(M))
w(data.frame(gender = rep(1:2, each = 3), party = rep(1:3, 2), count = c(762, 327, 468, 484, 239, 477)), "party.csv")
Job <- matrix(c(1, 2, 1, 0, 3, 3, 6, 1, 10, 10, 14, 9, 6, 7, 12, 11), 4, 4)
print(fisher.test(Job))
w(data.frame(income = rep(1:4, 4), satisfaction = rep(1:4, each = 4), count = c(Job)), "job.csv")
print(binom.test(c(682, 243), p = 3 / 4))
w(data.frame(plant = rep(1:2, c(682, 243))), "mendel.csv")
x <- c(89, 37, 30, 28, 2)
print(chisq.test(x, p = c(40, 20, 20, 15, 5), rescale.p = TRUE))
w(data.frame(category = rep(1:5, x)), "multinomial.csv")
sf <- matrix(c(9, 2, 5, 8, 6, 1, 3, 2, 8, 4, 6, 8, 7, 1, 2, 6, 10, 5, 6, 9, 6, 2, 4, 7), ncol = 4, byrow = TRUE)
colnames(sf) <- paste0("J", 1:4)
w(data.frame(subject = 1:6, sf), "shroutfleiss.csv")
options(digits = 10)
library(psych)
print(ICC(sf, lmer = FALSE)$results)
N <- bfi[, paste0("N", 1:5)]
X <- N[complete.cases(N), ]
a <- alpha(X, check.keys = FALSE)
print(a$total)
print(nrow(X))
o <- suppressWarnings(suppressMessages(omega(X, nfactors = 1, plot = FALSE)))
print(o$omega.tot)
print(glb.fa(cor(X))$glb)
print(a$alpha.drop$raw_alpha)
bfi.keys <- list(neuroticism = c("N1", "N2", "N3", "N4", "N5"))
s <- scoreItems(bfi.keys, bfi, min = 1, max = 6)
print(s$alpha)
print(packageVersion("psych"))
# Repeated measures with two within-subject factors: carData's OBrienKaiser as car's ?Anova analyses it (idata, idesign =
# ~ phase * hour), the help page's model treatment * gender with its contrasts. Type II tests (car::Anova); the sphericity
# tests and corrections of summary(..., multivariate = FALSE).
suppressPackageStartupMessages(library(car))
phase <- factor(rep(c("pretest", "posttest", "followup"), c(5, 5, 5)), levels = c("pretest", "posttest", "followup"))
hour <- ordered(rep(1:5, 3))
idata <- data.frame(phase, hour)
ok <- OBrienKaiser
contrasts(ok$treatment) <- matrix(c(-2, 1, 1, 0, -1, 1), ncol = 2)
contrasts(ok$gender) <- c(-1, 1)
mod.ok <- lm(cbind(pre.1, pre.2, pre.3, pre.4, pre.5, post.1, post.2, post.3, post.4, post.5, fup.1, fup.2, fup.3, fup.4, fup.5) ~ treatment * gender, data = ok)
s <- summary(Anova(mod.ok, idata = idata, idesign = ~ phase * hour, type = 2), multivariate = FALSE)
print(unclass(s$univariate.tests))
print(unclass(s$sphericity.tests))
print(unclass(s$pval.adjustments)[, 1:4])
# ?cohen.kappa: Cohen's (1968) table of proportions, with his disagreement weights (Cohen reports .492 and .348) and the non-symmetric ones (.353)
cohen <- matrix(c(0.44, 0.07, 0.09, 0.05, 0.20, 0.05, 0.01, 0.03, 0.06), ncol = 3, byrow = TRUE)
w(data.frame(rater1 = rep(1:3, each = 3), rater2 = rep(1:3, 3), proportion = c(t(cohen))), "cohen.csv")
cohen.weights <- matrix(c(0, 1, 3, 1, 0, 6, 3, 6, 0), ncol = 3)
wc <- matrix(c(0, 1, 4, 1, 0, 6, 2, 2, 0), ncol = 3, byrow = TRUE)
print(cohen.kappa(cohen, cohen.weights, n.obs = 200)$confid)
print(cohen.kappa(cohen, wc)$confid)
# (the same weighted kappa from the agreement weights 1 - w / max(w), with psych's standard error for agreement weights)
print(cohen.kappa(cohen, 1 - cohen.weights / 6, n.obs = 200)$confid)
print(cohen.kappa(cohen, 1 - wc / 6, n.obs = 200)$confid)
# ?cor.test: Hollander & Wolfe (1973, p. 187f.), Hunter L lightness and panel scores of nine lots of tuna; exact Kendall test
x <- c(44.4, 45.9, 41.9, 53.3, 44.7, 44.1, 50.7, 45.2, 60.1)
y <- c(2.6, 3.1, 2.5, 5.0, 3.6, 4.0, 5.2, 2.8, 3.8)
w(data.frame(hunter = x, panel = y), "tuna.csv")
print(cor.test(x, y, method = "kendall", alternative = "greater")$p.value)
print(cor.test(x, y, method = "kendall", alternative = "greater", exact = FALSE)$p.value)
print(cor.test(x, y, method = "spearman", alternative = "greater")$p.value)
