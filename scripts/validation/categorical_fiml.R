# Reference results for ordinal indicators (WLSMV; standard errors as Mplus's, the app's default) and FIML,
# from desktop lavaan. Writes src/engine/__fixtures__/categorical/*.{csv,json}.
#
#   Rscript scripts/validation/categorical_fiml.R

suppressMessages({
  library(lavaan)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/categorical"
hs <- HolzingerSwineford1939[, paste0("x", 1:9)]
model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nspeed ~ visual + textual"

# Ordinal: each item cut into 4 categories at its quartiles (1-4).
ord <- as.data.frame(lapply(hs, function(v) as.integer(cut(v, quantile(v, 0:4 / 4), include.lowest = TRUE))))
write.csv(ord, file.path(root, "hs_ordinal.csv"), row.names = FALSE)
# Standard errors as the app computes them by default, Mplus's WLSMV (Muthen, du Toit & Spisic 1997): since 0.7-2
# lavaan puts the observed information in the sandwich's bread for categorical DWLS; Mplus (and lavaan up to 0.7-1)
# the expected one, information.bread = "expected", and Mplus divides the covariance matrix of the estimates by N
# where lavaan divides by N - G. `lavaanSe`: lavaan 0.7's own standard errors (the app's wlsmvSe = "lavaan").
f <- sem(model, ord, ordered = names(ord), estimator = "WLSMV", information.bread = "expected")
mplus_se <- function(fit) {
  k <- 1 - lavInspect(fit, "ngroups") / lavInspect(fit, "ntotal")
  fit@vcov$vcov <- fit@vcov$vcov * k
  fit@ParTable$se <- fit@ParTable$se * sqrt(k)
  fit@Fit@se <- fit@Fit@se * sqrt(k)
  fit
}
f <- mplus_se(f)
f_lavaan <- sem(model, ord, ordered = names(ord), estimator = "WLSMV")
pe <- parameterEstimates(f, standardized = TRUE)
pe_lavaan <- parameterEstimates(f_lavaan)
pick <- function(op) {
  r <- pe[pe$op == op, ]
  l <- pe_lavaan[pe_lavaan$op == op, ]
  lapply(
    seq_len(nrow(r)),
    function(i) list(lhs = r$lhs[i], op = op, rhs = r$rhs[i], est = r$est[i], se = r$se[i], std = r$std.all[i], stdSe = standardizedSolution(f)$se[standardizedSolution(f)$op == op][i], lavaanSe = l$se[i])
  )
}
fm <- fitMeasures(
  f,
  c("chisq", "df", "chisq.scaled", "df.scaled", "pvalue.scaled", "cfi.scaled", "tli.scaled", "rmsea.scaled", "srmr")
)
write(
  toJSON(list(
    lavaan = as.character(packageVersion("lavaan")),
    model = model,
    se = "Mplus (information.bread = \"expected\", vcov x (N - 1) / N)",
    fit = as.list(fm),
    loadings = pick("=~"),
    regressions = pick("~"),
    thresholds = pick("|")
  ), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  file.path(root, "hs_wlsmv.json")
)

# FIML: about 10% of the values removed (MCAR, fixed seed); MLR with missing = "ml".
set.seed(20261029)
miss <- hs
for (v in names(miss)) miss[[v]][sample(nrow(miss), 30)] <- NA
write.csv(miss, file.path(root, "hs_missing.csv"), row.names = FALSE, na = "")
g <- sem(model, miss, estimator = "MLR", missing = "ml")
pe <- parameterEstimates(g, standardized = TRUE)
fm <- fitMeasures(g, c("chisq", "df", "chisq.scaled", "cfi.robust", "rmsea.robust", "srmr", "logl", "ntotal"))
write(
  toJSON(list(
    lavaan = as.character(packageVersion("lavaan")), model = model, n = nobs(g), fit = as.list(fm),
    loadings = pick("=~"), regressions = pick("~")
  ), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  file.path(root, "hs_fiml.json")
)
cat("written\n")

# Labels, equality constraints, a defined parameter and a Wald test (ML).
lab <- "visual =~ x1 + b*x2 + b*x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nspeed ~ a*visual + a*textual\nab := (a * b)"
h <- sem(lab, hs)
pe <- parameterEstimates(h, standardized = TRUE)
w <- lavTestWald(h, constraints = "b == 1\na == 0.2")
write(
  toJSON(list(
    lavaan = as.character(packageVersion("lavaan")), model = lab,
    fit = as.list(fitMeasures(h, c("chisq", "df"))),
    labelled = lapply(
      which(nzchar(pe$label) & pe$op != ":="),
      function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], label = pe$label[i], est = pe$est[i], se = pe$se[i])
    ),
    defined = list(
      name = "ab",
      est = pe$est[pe$op == ":="],
      se = pe$se[pe$op == ":="],
      std = pe$std.all[pe$op == ":="]
    ),
    wald = list(stat = unname(w$stat), df = unname(w$df), p = unname(w$p.value))
  ), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  file.path(root, "hs_constraints.json")
)
cat("constraints written\n")
