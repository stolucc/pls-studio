# Reference results for ordinal indicators (WLSMV) and FIML, from desktop
# lavaan. Writes src/engine/__fixtures__/categorical/*.{csv,json}.
#
#   Rscript scripts/validation/categorical_fiml.R

suppressMessages({ library(lavaan); library(jsonlite) })
root <- "src/engine/__fixtures__/categorical"
hs <- HolzingerSwineford1939[, paste0("x", 1:9)]
model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nspeed ~ visual + textual"

# Ordinal: each item cut into 4 categories at its quartiles (1-4).
ord <- as.data.frame(lapply(hs, function(v) as.integer(cut(v, quantile(v, 0:4 / 4), include.lowest = TRUE))))
write.csv(ord, file.path(root, "hs_ordinal.csv"), row.names = FALSE)
f <- sem(model, ord, ordered = names(ord), estimator = "WLSMV")
pe <- parameterEstimates(f, standardized = TRUE)
pick <- function(op) { r <- pe[pe$op == op, ]; lapply(seq_len(nrow(r)), function(i) list(lhs = r$lhs[i], op = op, rhs = r$rhs[i], est = r$est[i], se = r$se[i], std = r$std.all[i])) }
fm <- fitMeasures(f, c("chisq", "df", "chisq.scaled", "df.scaled", "pvalue.scaled", "cfi.scaled", "tli.scaled", "rmsea.scaled", "srmr"))
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")), model = model, fit = as.list(fm),
  loadings = pick("=~"), regressions = pick("~"), thresholds = pick("|")), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  file.path(root, "hs_wlsmv.json"))

# FIML: about 10% of the values removed (MCAR, fixed seed); MLR with missing = "ml".
set.seed(20261029)
miss <- hs
for (v in names(miss)) miss[[v]][sample(nrow(miss), 30)] <- NA
write.csv(miss, file.path(root, "hs_missing.csv"), row.names = FALSE, na = "")
g <- sem(model, miss, estimator = "MLR", missing = "ml")
pe <- parameterEstimates(g, standardized = TRUE)
fm <- fitMeasures(g, c("chisq", "df", "chisq.scaled", "cfi.robust", "rmsea.robust", "srmr", "logl", "ntotal"))
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")), model = model, n = nobs(g), fit = as.list(fm),
  loadings = pick("=~"), regressions = pick("~")), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  file.path(root, "hs_fiml.json"))
cat("written\n")
