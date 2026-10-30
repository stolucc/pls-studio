# Reference for categorical exogenous variables in PLS-SEM (dummy-coded Mode B
# composite; Henseler 2021): seminr's corp_rep_data, the service provider (four
# providers; the first the reference) predicting satisfaction (cusa) and
# loyalty (cusl_1-3), satisfaction predicting loyalty. cSEM, PLS, path scheme.
#   R_LIBS=/path/to/lib Rscript scripts/validation/categorical_pls.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM); library(seminr) })
d <- corp_rep_data
for (k in 2:4) d[[paste0("P", k)]] <- as.integer(d$serviceprovider == k)
m <- "
Provider <~ P2 + P3 + P4
SAT =~ cusa
LOY =~ cusl_1 + cusl_2 + cusl_3
SAT ~ Provider
LOY ~ Provider + SAT
"
f <- csem(d, m, .disattenuate = FALSE, .tolerance = 1e-10)
e <- f$Estimates
out <- list(cSEM = as.character(packageVersion("cSEM")),
  weights = as.list(e$Weight_estimates["Provider", c("P2", "P3", "P4")]),
  paths = list(`Provider -> SAT` = e$Path_estimates["SAT", "Provider"], `Provider -> LOY` = e$Path_estimates["LOY", "Provider"], `SAT -> LOY` = e$Path_estimates["LOY", "SAT"]),
  r2 = as.list(e$R2))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/categorical_pls.json")
cat("written\n")
