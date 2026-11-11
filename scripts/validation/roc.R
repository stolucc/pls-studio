# Reference results for the ROC card (R/roc.R): pROC called directly, as its help pages do, on its aSAH data (?roc,
# ?ci.auc, ?coords, ?auc, ?roc.test): the ROC curve of s100b for the outcome, its AUC with DeLong and bootstrap
# intervals, the best cut-points (Youden, closest to the top-left corner), partial AUCs, DeLong's paired test against
# wfns and the unpaired test between the sexes, a predictor whose low values mark cases (ndka, direction ">"), the
# fitted probabilities of a logistic regression, and the outcome's levels reversed. The data are recorded as the app
# codes them (factors as 1, 2, ...).
#
#   Rscript scripts/validation/roc.R [library]

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressPackageStartupMessages({
  library(pROC)
  library(jsonlite)
})
data(aSAH)

curve_ref <- function(r) {
  list(
    auc = as.numeric(r$auc),
    se = sqrt(pROC::var(r)),
    ci = as.numeric(ci.auc(r, method = "delong")),
    direction = r$direction,
    specificities = r$specificities,
    sensitivities = r$sensitivities
  )
}

best_ref <- function(r, method) {
  b <- coords(
    r,
    "best",
    best.method = method,
    ret = c("threshold", "sensitivity", "specificity", "ppv", "npv", "accuracy"),
    transpose = FALSE
  )
  as.list(b[1, ])
}

r1 <- roc(aSAH$outcome, aSAH$s100b, quiet = TRUE)
r2 <- roc(aSAH$outcome, aSAH$wfns, quiet = TRUE)
set.seed(1)
boot <- ci.auc(r1, method = "bootstrap", boot.n = 500, boot.stratified = TRUE)
partial_sp <- auc(r1, partial.auc = c(1, 0.8), partial.auc.focus = "specificity")
partial_se <- auc(r1, partial.auc = c(1, 0.9), partial.auc.focus = "sensitivity", partial.auc.correct = TRUE)
set.seed(1)
partial_se_ci <- ci.auc(partial_se, method = "bootstrap", boot.n = 500, boot.stratified = TRUE)
paired <- roc.test(r1, r2, method = "delong", paired = TRUE)
male <- aSAH$gender == "Male"
r_male <- roc(aSAH$outcome[male], aSAH$s100b[male], quiet = TRUE)
r_female <- roc(aSAH$outcome[!male], aSAH$s100b[!male], quiet = TRUE)
unpaired <- roc.test(r_male, r_female, method = "delong", paired = FALSE)
fit <- glm(outcome == "Poor" ~ age + s100b, family = binomial, data = aSAH)
r_fit <- roc(aSAH$outcome, fitted(fit), direction = "<", quiet = TRUE)
r_ndka <- roc(aSAH$outcome, aSAH$ndka, direction = ">", quiet = TRUE)
r_reversed <- roc(aSAH$outcome, aSAH$s100b, levels = c("Poor", "Good"), quiet = TRUE)

coded <- data.frame(
  outcome = as.integer(aSAH$outcome),
  gender = as.integer(aSAH$gender),
  age = aSAH$age,
  wfns = as.integer(aSAH$wfns),
  s100b = aSAH$s100b,
  ndka = aSAH$ndka
)
ref <- list(
  pROC = as.character(packageVersion("pROC")),
  data = list(names = names(coded), cols = unname(lapply(coded, as.numeric))),
  s100b = curve_ref(r1),
  youden = best_ref(r1, "youden"),
  topleft = best_ref(r1, "closest.topleft"),
  bootstrap = as.numeric(boot),
  partialSp = as.numeric(partial_sp),
  partialSe = as.numeric(partial_se),
  partialSeCi = as.numeric(partial_se_ci),
  paired = list(
    statistic = unname(paired$statistic),
    p = paired$p.value,
    aucs = unname(as.numeric(paired$estimate)),
    ci = as.numeric(paired$conf.int)
  ),
  unpaired = list(
    statistic = unname(unpaired$statistic),
    df = unname(unpaired$parameter),
    p = unpaired$p.value,
    aucs = unname(as.numeric(unpaired$estimate))
  ),
  logistic = list(
    coefs = unname(coef(fit)),
    se = unname(sqrt(diag(vcov(fit)))),
    curve = curve_ref(r_fit)
  ),
  ndka = curve_ref(r_ndka),
  reversed = curve_ref(r_reversed)
)
dir.create("src/engine/__fixtures__/roc", showWarnings = FALSE)
write(
  toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  "src/engine/__fixtures__/roc/reference.json"
)
cat("written\n")
