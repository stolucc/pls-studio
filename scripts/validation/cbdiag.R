# Native reference for the CB-SEM diagnostics (src/rengine/cbDiag.webr.test.ts): direct lavaan
# calls on the Holzinger-Swineford CFA (lavaan's ?cfa), as the cards should reproduce them.
#  - local fit: lavResiduals (cor.bentler z-tests, normalized residuals, SRMR tests) and lavTest
#    for each further test of exact fit, on the ML fit (base ML chi-square, and Browne's RLS);
#  - FIML with auxiliary variables (lavaan's aux =, saturated correlates) on the data with values
#    removed by a fixed rule (x1 missing in every 5th row, x5 in rows 3, 10, 17, ...).
#  - discriminant validity: semTools::discriminantValidity at the cutoffs .8, .9 and 1 and merged, on the HS CFA
#    and Political Democracy's measurement model;
#  - comparing models: nonnest2's vuongtest / icci (documented lavaan example) and lavTestNET / lavTestLRT;
#  - the EPC-based judgement: semTools::epcEquivFit (its help page's one-factor model; the HS CFA, other settings).
# Run: Rscript scripts/validation/cbdiag.R  (writes src/engine/__fixtures__/cbdiag/reference.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
hs_model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
hs <- HolzingerSwineford1939
fit <- cfa(hs_model, data = hs)
low <- function(m) {
  m <- unclass(m)
  unname(m[lower.tri(m)])
} # the lower triangle, column by column

res <- lavResiduals(fit, type = "cor.bentler", se = TRUE)
nrm <- lavResiduals(fit, type = "normalized", zstat = FALSE, summary = FALSE)
s <- res$summary
tests <- c(
  "browne.residual.nt.model",
  "browne.residual.nt",
  "browne.residual.adf",
  "satorra.bentler",
  "yuan.bentler",
  "mean.var.adjusted",
  "scaled.shifted",
  "mean.var.adjusted.corrected",
  "scaled.shifted.corrected",
  "peba4",
  "pols3",
  "pall"
)
one <- function(test, scaled_test = "standard") {
  t <- lavTest(fit, test = test, scaled_test = scaled_test, drop_list_single = FALSE)[[test]]
  list(stat = t$stat, df = t$df, p = t$pvalue, scaling = t$scaling.factor %||% NA, shift = t$shift.parameter %||% NA)
}
localfit <- list(
  names = rownames(res$cov),
  residual = low(res$cov),
  se = low(res$cov.se),
  z = low(res$cov.z),
  normalized = low(nrm$cov),
  srmr = s["srmr", "cov"],
  srmrSe = s["srmr.se", "cov"],
  srmrZ = s["srmr.exactfit.z", "cov"],
  srmrP = s["srmr.exactfit.pvalue", "cov"],
  usrmr = s["usrmr", "cov"],
  usrmrLow = s["usrmr.ci.lower", "cov"],
  usrmrHigh = s["usrmr.ci.upper", "cov"],
  closeP = s["usrmr.closefit.pvalue", "cov"],
  tests = c(list(standard = one("standard")), setNames(lapply(tests, one), tests)),
  rls = setNames(
    lapply(
      c("satorra.bentler", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4"),
      one,
      scaled_test = "RLS"
    ),
    c("satorra.bentler", "mean.var.adjusted.corrected", "scaled.shifted.corrected", "peba4")
  )
)

# FIML with auxiliary variables (and without, for the difference they make)
hs_na <- hs
hs_na$x1[seq(5, nrow(hs), by = 5)] <- NA
hs_na$x5[seq(3, nrow(hs), by = 7)] <- NA
fiml <- function(...) {
  f <- cfa(hs_model, data = hs_na, missing = "ml", ...)
  list(
    chisq = unname(fitMeasures(f, "chisq")),
    df = unname(fitMeasures(f, "df")),
    cfi = unname(fitMeasures(f, "cfi")),
    est = parameterEstimates(f)$est[parameterEstimates(f)$op == "=~"],
    se = parameterEstimates(f)$se[parameterEstimates(f)$op == "=~"]
  )
}
aux <- list(none = fiml(), aux = fiml(aux = c("ageyr", "agemo")), twostage = (function() {
  f <- cfa(hs_model, data = hs_na, missing = "two.stage", aux = c("ageyr", "agemo"))
  list(
    chisq = unname(fitMeasures(f, "chisq")),
    est = parameterEstimates(f)$est[parameterEstimates(f)$op == "=~"],
    se = parameterEstimates(f)$se[parameterEstimates(f)$op == "=~"]
  )
})())

# Discriminant validity (semTools::discriminantValidity; Ronkko & Cho 2022): cutoffs .8, .9 and 1, and merging,
# on the HS CFA and on Political Democracy's measurement model (dem60 and dem65 correlate highly)
suppressPackageStartupMessages(library(semTools))
dvs <- function(f) {
  one <- function(d) {
    d <- as.data.frame(d)
    list(chisq = d[["Chisq diff"]], df = d[["Df diff"]], p = d[["Pr(>Chisq)"]])
  }
  d <- lapply(c(0.8, 0.9, 1), function(k) suppressMessages(discriminantValidity(f, cutoff = k)))
  m <- as.data.frame(d[[1]])
  list(
    lhs = m$lhs,
    rhs = m$rhs,
    est = m$est,
    low = m$ci.lower,
    high = m$ci.upper,
    cut80 = one(d[[1]]),
    cut90 = one(d[[2]]),
    cut100 = one(d[[3]]),
    merge = one(suppressMessages(discriminantValidity(f, merge = TRUE)))
  )
}
pd_model <- "ind60 =~ x1 + x2 + x3\ndem60 =~ y1 + y2 + y3 + y4\ndem65 =~ y5 + y6 + y7 + y8"
discriminant <- list(hs = dvs(fit), poldem = dvs(cfa(pd_model, data = PoliticalDemocracy)))

# Comparing models: nonnest2's documented lavaan example (?vuongtest, ?icci: the HS CFA in one group, with a mean
# structure as ?icci fits it, against the same CFA by school), and a nested pair (three factors against one) with
# lavTestNET and lavTestLRT. (nonnest2 from the helper's library when it is not in R's own.)
.libPaths(unique(c(.libPaths(), path.expand("~/.pls-studio-helper/library"))))
suppressPackageStartupMessages(library(nonnest2))
vt <- function(v) list(omega = v$omega, pOmega = v$p_omega, stat = v$LRTstat, pA = v$p_LRT$A, pB = if (is.na(v$p_LRT$B)) NULL else v$p_LRT$B)
ici <- function(i) list(aic1 = i$AIC$AIC1, aic2 = i$AIC$AIC2, aicLow = i$AICci[1], aicHigh = i$AICci[2], bic1 = i$BIC$BIC1, bic2 = i$BIC$BIC2, bicLow = i$BICci[1], bicHigh = i$BICci[2])
fit1m <- cfa(hs_model, data = hs, meanstructure = TRUE)
fit2 <- cfa(hs_model, data = hs, group = "school")
one_f <- cfa("g =~ x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9", data = hs)
net <- lavTestNET(fit, one_f)
lrt <- lavTestLRT(fit, one_f)
compare <- list(
  documented = list(
    vuong = vt(vuongtest(fit1m, fit2)), vuongHelp = vt(vuongtest(fit, fit2)), icci = ici(icci(fit1m, fit2)),
    logl1 = unname(fitMeasures(fit1m, "logl")), logl2 = unname(fitMeasures(fit2, "logl"))
  ),
  nested = list(
    net21 = net$nested[2, 1],
    net12 = net$nested[1, 2],
    lrt = list(chisq = lrt[["Chisq diff"]][2], df = lrt[["Df diff"]][2], p = lrt[["Pr(>Chisq)"]][2]),
    vuong = vt(vuongtest(fit, one_f, nested = TRUE))
  )
)

# EPC-based judgement (semTools::epcEquivFit): ?epcEquivFit's one-factor example with the defaults, and the HS CFA
# with other SESOIs and Bonferroni; semTools' global decisions from its summary() counts.
epcs <- function(e) {
  sm <- summary(e)
  g <- function(n, u = 0) semTools:::global_localfit_decision(n_M = n$n_M, n_I = n$n_I, n_U = u, n_NM = n$n_NM)
  list(
    lhs = e$lhs,
    op = e$op,
    rhs = e$rhs,
    mi = e$mi,
    epc = e$epc,
    stdEpc = e$std.epc,
    stdSesoi = e$std.sesoi,
    power = e$pow,
    decisionPow = e$decision.pow,
    lowStd = e$lower.std.epc,
    highStd = e$upper.std.epc,
    decisionCi = e$decision.ci,
    globalCi = g(sm$epc_equivalence, sm$epc_equivalence$n_U),
    globalPow = g(sm$ssv)
  )
}
epc <- list(
  one = epcs(epcEquivFit(one_f)),
  hs = epcs(epcEquivFit(fit, stdLoad = 0.3, cor = 0.15, stdBeta = 0.2, cilevel = 0.95, mialpha = 0.01, mipower = 0.9, adjust.method = "bonferroni"))
)

out <- list(
  versions = list(
    lavaan = as.character(packageVersion("lavaan")),
    semTools = as.character(packageVersion("semTools")),
    nonnest2 = as.character(packageVersion("nonnest2")),
    R = R.version.string
  ),
  localfit = localfit, aux = aux, discriminant = discriminant, compare = compare, epc = epc
)
dir.create("src/engine/__fixtures__/cbdiag", showWarnings = FALSE, recursive = TRUE)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  "src/engine/__fixtures__/cbdiag/reference.json"
)
str(out, max.level = 2)
