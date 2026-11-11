# The validity card examples (src/examples/cards/validity.ts): prints the reference values
# src/examples/cards/validity.webr.test.ts compares with, from desktop R (seminr 2.6.0, psych 2.6.9, R 4.6.2).
# Run: Rscript scripts/validation/validity_cards.R
options(digits = 10)
suppressPackageStartupMessages({
  library(seminr)
  library(psych)
})

# Hair et al. (2021): the extended corporate reputation model (as seminr-corprep in packages.ts).
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
  paths(from = "CUSA", to = "CUSL")
)
m <- estimate_pls(
  data = corp_rep_data,
  measurement_model = mm,
  structural_model = sm,
  missing = mean_replacement,
  missing_value = "-99"
)
S <- m$construct_scores
cat("n", nrow(S), "\n")
# Full-collinearity VIFs (Kock 2015): each construct on all the others, from seminr's construct scores.
vif <- diag(solve(cor(S)))
print(vif)
for (k in colnames(S)) {
  r2 <- summary(lm(S[, k] ~ S[, colnames(S) != k]))$r.squared
  cat(k, "R2", r2, "VIF", 1 / (1 - r2), "\n")
} # the same by regression

# Harman's single-factor test on the 31 indicators, complete cases (-99 is missing).
items <- c(
  paste0("qual_", 1:8),
  paste0("perf_", 1:5),
  paste0("csor_", 1:5),
  paste0("attr_", 1:3),
  paste0("comp_", 1:3),
  paste0("like_", 1:3),
  "cusa",
  paste0("cusl_", 1:3)
)
X <- corp_rep_data[, items]
X[X == -99] <- NA
cat("missing cells", sum(is.na(X)), "complete rows", sum(complete.cases(X)), "\n")
Xc <- X[complete.cases(X), ]
ev <- eigen(cor(Xc))$values
cat("eigenvalue 1", ev[1], "share", ev[1] / length(items), "eigenvalues > 1:", sum(ev > 1), "\n")
p <- principal(Xc, nfactors = 1, rotate = "none")
cat("principal: SS loadings", p$Vaccounted[1, 1], "proportion", p$Vaccounted[2, 1], "\n")
f <- fa(Xc, nfactors = 1, fm = "minres", rotate = "none")
cat("fa (minres): SS loadings", f$Vaccounted[1, 1], "proportion", f$Vaccounted[2, 1], "\n")

# Content validity index: Polit & Beck (2006), Table 1: 10 items, 3 experts, items 1-7 unanimous, items 8-10 with one dissent
# (public/examples/tests/polit2006.csv). I-CVI, S-CVI/UA and S-CVI/Ave as printed; pc and k* by Polit, Beck & Owen (2007).
A <- c(rep(3, 7), 2, 2, 2)
N <- 3
icvi <- A / N
pc <- choose(N, A) * 0.5^N
kappa <- (icvi - pc) / (1 - pc)
print(data.frame(item = 1:10, A, icvi, pc, kappa))
cat("S-CVI/Ave", mean(icvi), "S-CVI/UA", mean(A == N), "\n")
