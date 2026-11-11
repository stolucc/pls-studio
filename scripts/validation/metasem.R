# Reference for the meta-analytic SEM card (independent of PLS Studio's code): metaSEM's ?Digman97 example, two-stage
# SEM of the 14 studies' correlations of the Big Five (Digman 1997): stage 1 by random effects (RE.type = "Diag", the
# help page's) and fixed effects, stage 2 the two-factor model Alpha =~ A + C + ES, Beta =~ E + I (lavaan2RAM); and
# random effects with study 1 not measuring I (its row and column missing).
# Also writes the example's data, one row per study (N and the correlations A_C, A_ES, ...), public/examples/metasem.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/metasem.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(metaSEM)
})
v <- c("A", "C", "ES", "E", "I")
model <- "Alpha =~ A + C + ES\nBeta =~ E + I\nAlpha ~~ Beta"
RAM <- lavaan2RAM(model, obs.variables = v)
run <- function(data, method, re = "Diag") {
  s1 <- if (method == "FEM") tssem1(data, Digman97$n, method = "FEM") else tssem1(data, Digman97$n, method = "REM", RE.type = re)
  s2 <- summary(tssem2(s1, RAM = RAM))
  pooled <- if (method == "FEM") coef(s1) else vec2symMat(coef(s1, select = "fixed"), diag = FALSE)
  list(
    pooled = unname(pooled[lower.tri(pooled)]), est = as.list(setNames(s2$coefficients$Estimate, rownames(s2$coefficients))),
    se = as.list(setNames(s2$coefficients$Std.Error, rownames(s2$coefficients))), chisq = unname(s2$stat["Chi-square of target model", 1]),
    df = unname(s2$stat["DF of target model", 1]), rmsea = unname(s2$stat["RMSEA", 1]), srmr = unname(s2$stat["SRMR", 1]), cfi = unname(s2$stat["CFI", 1]),
    q = if (method == "REM") unname(as.numeric(summary(s1)$Q.stat$Q)) else NULL
  )
}
miss <- Digman97$data
miss[[1]]["I", ] <- NA
miss[[1]][, "I"] <- NA
out <- list(
  metaSEM = as.character(packageVersion("metaSEM")), OpenMx = as.character(packageVersion("OpenMx")),
  rem = run(Digman97$data, "REM"), fem = run(Digman97$data, "FEM"), missingI = run(miss, "REM")
)
dir.create("src/engine/__fixtures__/metasem", showWarnings = FALSE, recursive = TRUE)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/metasem/reference.json")

# The example's data: Study, N, then each pair's correlation (lower triangle by columns: A_C, A_ES, A_E, A_I, C_ES, ...)
pairs <- which(upper.tri(diag(5)), arr.ind = TRUE)
pairs <- pairs[order(pairs[, 1], pairs[, 2]), ]
d <- data.frame(Study = seq_along(Digman97$n), N = Digman97$n)
for (k in seq_len(nrow(pairs))) d[[paste(v[pairs[k, 1]], v[pairs[k, 2]], sep = "_")]] <- vapply(Digman97$data, function(m) m[v[pairs[k, 1]], v[pairs[k, 2]]], 0)
dir.create("public/examples/metasem", showWarnings = FALSE, recursive = TRUE)
write.csv(d, "public/examples/metasem/digman97.csv", row.names = FALSE)
cat("written\n")
