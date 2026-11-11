# Native reference for the Latent change score card (analyses/longitudinal.tsx, ps_lcs in R/longitudinal.R): the lcsm
# package (Wiedemann, Thew, Stott & Ehlers; lcsm 0.3.3) specifies and fits each model, and its estimates by parameter
# label, fit measures and model-implied means are recorded in src/engine/__fixtures__/lcs/reference.json, with the
# data of lcsm's help-page examples (data_uni_lcsm, data_bi_lcsm: simulated, MIT licence; the occasions used).
# lcsm fits with lavaan(meanstructure = TRUE, fixed.x = FALSE, estimator = "MLR", missing = "FIML", mimic = "Mplus");
# the card fits with the Model settings' estimator and missing values and lavaan's own conventions, so the comparison
# passes the same estimator and missing = "fiml" with mimic = "lavaan" (and records lcsm's Mplus-mimic run too: the
# same estimates, standard errors computed differently). The bridge's syntax is also checked against lcsm's own:
# the same parameter table (lavaanify) for every combination of change components and couplings.
#   Rscript scripts/validation/lcs.R    (lcsm in the helper's library: R_LIBS_USER=~/.pls-studio-helper/library)
suppressPackageStartupMessages({
  library(lavaan)
  library(lcsm)
  library(jsonlite)
})
for (f in c("common.R", "longitudinal.R")) source(file.path("src/rengine/R", f))

keep <- c("npar", "chisq", "df", "pvalue", "chisq.scaled", "cfi", "tli", "rmsea", "srmr", "logl", "aic", "bic")
record <- function(fit, T, bi) {
  pe <- parameterEstimates(fit, standardized = TRUE)
  pe <- pe[nzchar(pe$label) & !duplicated(pe$label), ]
  list(
    n = lavInspect(fit, "nobs"), estimates = setNames(lapply(seq_len(nrow(pe)), function(i) list(est = pe$est[i], se = pe$se[i], std = pe$std.all[i])), pe$label),
    fit = as.list(fitMeasures(fit)[intersect(keep, names(fitMeasures(fit)))]),
    implied = list(x = unname(fitted(fit)$mean[sprintf("x%d", seq_len(T))]), y = if (bi) unname(fitted(fit)$mean[sprintf("y%d", seq_len(T))]) else numeric(0))
  )
}
# The bridge's syntax and lcsm's give the same parameter table (variable, operator, label, fixed value).
same_table <- function(a, b) {
  key <- function(m) {
    p <- lavaanify(m, meanstructure = TRUE, fixed.x = FALSE)
    p <- p[p$user == 1, ]
    sort(paste(p$lhs, p$op, p$rhs, p$label, ifelse(p$free > 0, "free", format(p$ustart))))
  }
  identical(key(a), key(b))
}
lc <- function(m) list(alpha_constant = isTRUE(m$constant), beta = isTRUE(m$proportional), phi = isTRUE(m$autoregressive))
grid <- expand.grid(constant = c(TRUE, FALSE), proportional = c(TRUE, FALSE), autoregressive = c(TRUE, FALSE))
syntax_ok <- TRUE
for (T in c(3, 5)) {
  for (i in seq_len(nrow(grid))) {
    m <- as.list(grid[i, ])
    syntax_ok <- syntax_ok && same_table(paste(ps_lcs_uni_lines(T, "x", m, "g"), collapse = "\n"), specify_uni_lcsm(T, "x", lc(m), change_letter = "g"))
    for (cp in list(list(), list(deltaXY = TRUE), list(deltaYX = TRUE, xiXY = TRUE), list(deltaXY = TRUE, deltaYX = TRUE, xiXY = TRUE, xiYX = TRUE))) {
      syntax_ok <- syntax_ok && same_table(
        paste(ps_lcs_bi_lines(T, m, list(constant = TRUE, proportional = TRUE), cp), collapse = "\n"),
        specify_bi_lcsm(T, "x", lc(m), "y", list(alpha_constant = TRUE, beta = TRUE), coupling = list(delta_lag_xy = isTRUE(cp$deltaXY), delta_lag_yx = isTRUE(cp$deltaYX), xi_lag_xy = isTRUE(cp$xiXY), xi_lag_yx = isTRUE(cp$xiYX)))
      )
    }
  }
}
cat("syntax equivalent to lcsm's:", syntax_ok, "\n")
stopifnot(syntax_ok)

out <- list()
# 1. ?fit_uni_lcsm: constant change only, x1 to x3
uni <- data_uni_lcsm[, c("x1", "x2", "x3", "x4", "x5")]
out$uniHelp <- record(fit_uni_lcsm(uni, var = c("x1", "x2", "x3"), model = list(alpha_constant = TRUE, beta = FALSE, phi = FALSE), mimic = "lavaan"), 3, FALSE)
out$uniHelpMplus <- record(fit_uni_lcsm(uni, var = c("x1", "x2", "x3"), model = list(alpha_constant = TRUE, beta = FALSE, phi = FALSE)), 3, FALSE)
# 2. The dual change score model on five occasions (constant and proportional change, autoregressed changes), ML
out$uniDual <- record(fit_uni_lcsm(uni, var = c("x1", "x2", "x3", "x4", "x5"), model = list(alpha_constant = TRUE, beta = TRUE, phi = TRUE), mimic = "lavaan", estimator = "ML"), 5, FALSE)
# 3. ?fit_bi_lcsm
bi <- data_bi_lcsm[, c("x1", "x2", "x3", "y1", "y2", "y3")]
out$biHelp <- record(fit_bi_lcsm(bi,
  var_x = c("x1", "x2", "x3"), var_y = c("y1", "y2", "y3"), model_x = list(alpha_constant = TRUE, beta = TRUE, phi = FALSE),
  model_y = list(alpha_constant = TRUE, beta = TRUE, phi = TRUE), coupling = list(delta_lag_xy = TRUE, xi_lag_yx = TRUE), mimic = "lavaan"
), 3, TRUE)
out$biHelpMplus <- record(fit_bi_lcsm(bi,
  var_x = c("x1", "x2", "x3"), var_y = c("y1", "y2", "y3"), model_x = list(alpha_constant = TRUE, beta = TRUE, phi = FALSE),
  model_y = list(alpha_constant = TRUE, beta = TRUE, phi = TRUE), coupling = list(delta_lag_xy = TRUE, xi_lag_yx = TRUE)
), 3, TRUE)
# 4. lavaan's Demo.growth (t1-t4 and c1-c4, complete; the home-screen example), ML, listwise: the dual change score
#    model of t, and t with c coupled through the previous true scores (both directions)
dg <- Demo.growth
out$demoGrowth <- record(fit_bi_lcsm(dg,
  var_x = c("t1", "t2", "t3", "t4"), var_y = c("c1", "c2", "c3", "c4"), model_x = list(alpha_constant = TRUE, beta = TRUE),
  model_y = list(alpha_constant = FALSE, beta = TRUE), coupling = list(delta_lag_xy = TRUE, delta_lag_yx = TRUE), mimic = "lavaan", estimator = "ML", missing = "listwise"
), 4, TRUE)
out$demoGrowthUni <- record(fit_uni_lcsm(dg, var = c("t1", "t2", "t3", "t4"), model = list(alpha_constant = TRUE, beta = TRUE, phi = TRUE), mimic = "lavaan", estimator = "ML", missing = "listwise"), 4, FALSE)
str(out$uniHelp$estimates)

dir.create("src/engine/__fixtures__/lcs", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(
  list(
    generated = format(Sys.time()), R = R.version.string, lcsm = as.character(packageVersion("lcsm")), lavaan = as.character(packageVersion("lavaan")), syntaxEquivalent = syntax_ok,
    data = list(uni = lapply(uni, function(v) unname(v)), bi = lapply(bi, function(v) unname(v))), results = out
  ),
  auto_unbox = TRUE, digits = I(17), null = "null", na = "null"
), "src/engine/__fixtures__/lcs/reference.json")
cat("written\n")
