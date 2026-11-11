# Reference for the linear regression's extras on the regression card and the
# partial correlation card, independent of PLS Studio's code:
#   - hierarchical regression on ?swiss (three blocks): R2 of each model, and
#     the F test of each change written out from the residual sums of squares
#   - standardised coefficients (lm on scale()d variables), zero-order
#     correlations, partial and part correlations (ppcor::pcor.test and
#     ppcor::spcor.test of the outcome with each predictor given the others) and
#     tolerance (1 / car::vif) of the full model
#   - case diagnostics: influence.measures() (hat values, Cook's distance,
#     DFBETAS) and rstandard / rstudent
#   - partial correlations: ppcor's help-page example (?pcor, ?spcor.test: the
#     y.data of the help pages) with Pearson, Spearman and Kendall; and pairs of
#     swiss controlling for chosen variables
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/regression_extras.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(ppcor)
  library(car)
})

# ---- Hierarchical regression on swiss
blocks <- list(
  c("Agriculture", "Examination"),
  c("Education", "Catholic"),
  "Infant.Mortality"
)
rhs <- Reduce(function(a, b) c(a, b), blocks, accumulate = TRUE)
fits <- lapply(rhs, function(x) lm(reformulate(x, "Fertility"), data = swiss))
rss <- vapply(fits, deviance, 0)
dfr <- vapply(fits, df.residual, 0)
tss <- sum((swiss$Fertility - mean(swiss$Fertility))^2)
r2 <- 1 - rss / tss
prev_rss <- c(tss, rss[-length(rss)])
prev_df <- c(nrow(swiss) - 1, dfr[-length(dfr)])
df1 <- prev_df - dfr
f_change <- ((prev_rss - rss) / df1) / (rss / dfr)
hierarchical <- list(
  r2 = r2,
  r2_change = r2 - c(0, r2[-length(r2)]),
  f_change = f_change,
  df1 = df1,
  df2 = dfr,
  p_change = pf(f_change, df1, dfr, lower.tail = FALSE)
)

# ---- Each term of the full model
full <- fits[[length(fits)]]
preds <- unlist(blocks)
std_fit <- lm(reformulate(sprintf("scale(%s)", preds), "scale(Fertility)"), data = swiss)
others <- function(x) swiss[, setdiff(preds, x), drop = FALSE]
terms <- list(
  term = preds,
  beta = unname(coef(std_fit)[-1]),
  zero_order = unname(vapply(preds, function(x) cor(swiss[[x]], swiss$Fertility), 0)),
  partial = unname(vapply(preds, function(x) {
    pcor.test(swiss$Fertility, swiss[[x]], others(x))$estimate
  }, 0)),
  part = unname(vapply(preds, function(x) {
    spcor.test(swiss$Fertility, swiss[[x]], others(x))$estimate
  }, 0)),
  tolerance = unname(1 / vif(full))
)

# ---- Case diagnostics of the full model
im <- influence.measures(full)$infmat
cases <- list(
  standardized = unname(rstandard(full)),
  studentized = unname(rstudent(full)),
  leverage = unname(im[, "hat"]),
  cooks = unname(im[, "cook.d"]),
  dfbetas = lapply(seq_len(length(coef(full))), function(j) unname(im[, j]))
)

# ---- Partial correlations: ppcor's help-page data
y_data <- read.csv("public/examples/ppcor/y-data.csv")
help_page <- lapply(setNames(nm = c("pearson", "spearman", "kendall")), function(m) {
  list(
    partial = unname(pcor(y_data, method = m)$estimate),
    partial_p = unname(pcor(y_data, method = m)$p.value),
    partial_stat = unname(pcor(y_data, method = m)$statistic),
    semi = unname(spcor(y_data, method = m)$estimate),
    semi_p = unname(spcor(y_data, method = m)$p.value)
  )
})
# Pairs of swiss controlling for Education and Catholic.
pairs <- combn(c("Fertility", "Agriculture", "Examination"), 2, simplify = FALSE)
z <- swiss[, c("Education", "Catholic")]
controlled <- lapply(setNames(nm = c("pearson", "spearman", "kendall")), function(m) {
  lapply(pairs, function(p) {
    list(
      a = p[1],
      b = p[2],
      partial = pcor.test(swiss[[p[1]]], swiss[[p[2]]], z, method = m)$estimate,
      partial_p = pcor.test(swiss[[p[1]]], swiss[[p[2]]], z, method = m)$p.value,
      semi_ab = spcor.test(swiss[[p[1]]], swiss[[p[2]]], z, method = m)$estimate,
      semi_ba = spcor.test(swiss[[p[2]]], swiss[[p[1]]], z, method = m)$estimate
    )
  })
})

out <- list(
  versions = list(
    R = as.character(getRversion()),
    ppcor = as.character(packageVersion("ppcor")),
    car = as.character(packageVersion("car"))
  ),
  hierarchical = hierarchical,
  terms = terms,
  cases = cases,
  pcorHelp = help_page,
  pcorControlled = controlled
)
dir.create("src/engine/__fixtures__/regression", showWarnings = FALSE, recursive = TRUE)
write(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/engine/__fixtures__/regression/extras.json"
)
cat("written\n")
