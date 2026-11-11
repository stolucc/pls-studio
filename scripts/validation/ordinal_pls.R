# Reference for ordinal PLS (OrdPLS / OrdPLSc; Schuberth, Henseler & Dijkstra
# 2018) in cSEM: the OrdPLScPredict example of cSEM's ?predict help page, the
# BergamiBagozzi2000 items as ordered factors (which makes csem() use polychoric
# correlations). All 305 rows (the help page estimates on rows 1-250 to predict
# 251-305). csem() defaults (PLSc, path scheme) at a tight tolerance, plain OrdPLS
# (.disattenuate = FALSE), and the bootstrap of OrdPLSc (cSEM's resampling,
# 100 samples, seed 1234).
#   Rscript scripts/validation/ordinal_pls.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(cSEM)
})
data("BergamiBagozzi2000", package = "cSEM")
items <- c(paste0("cei", 1:8), paste0("ma", 1:6), paste0("orgcmt", c(1, 2, 3, 5, 6, 7, 8)))
d <- BergamiBagozzi2000[items]
d[items] <- lapply(d[items], ordered)
model <- "
OrgPres =~ cei1 + cei2 + cei3 + cei4 + cei5 + cei6 + cei7 + cei8
OrgIden =~ ma1 + ma2 + ma3 + ma4 + ma5 + ma6
AffJoy  =~ orgcmt1 + orgcmt2 + orgcmt3 + orgcmt7
AffLove =~ orgcmt5 + orgcmt6 + orgcmt8
OrgIden ~ OrgPres
AffLove ~ OrgIden
AffJoy  ~ OrgIden
"
paths <- list(c("OrgPres", "OrgIden"), c("OrgIden", "AffLove"), c("OrgIden", "AffJoy"))
pick <- function(f) {
  e <- f$Estimates
  own <- function(M) {
    unlist(lapply(rownames(M), function(k) {
      v <- M[k, ]
      v[v != 0]
    }))
  }
  a <- assess(f, .quality_criterion = c("reliability", "ave"))
  list(
    correlation = f$Information$Type_of_indicator_correlation,
    paths = setNames(
      lapply(paths, function(p) e$Path_estimates[p[2], p[1]]),
      vapply(paths, paste, "", collapse = " -> ")
    ),
    loadings = as.list(own(e$Loading_estimates)), weights = as.list(own(e$Weight_estimates)),
    r2 = as.list(e$R2), rhoA = as.list(a$Reliability$`Dijkstra-Henselers_rho_A`), ave = as.list(a$AVE),
    srmr = as.numeric(calculateSRMR(f))
  )
}
plsc <- csem(d, model, .tolerance = 1e-10, .iter_max = 1000)
pls <- csem(d, model, .disattenuate = FALSE, .tolerance = 1e-10, .iter_max = 1000)
boot <- csem(d, model, .tolerance = 1e-10, .iter_max = 1000, .resample_method = "bootstrap", .R = 100, .seed = 1234)
r <- boot$Estimates$Estimates_resample$Estimates1$Path_estimates
out <- list(
  cSEM = as.character(packageVersion("cSEM")), n = nrow(d), ordPLSc = pick(plsc), ordPLS = pick(pls),
  bootSd = as.list(setNames(apply(r$Resampled, 2, sd), names(r$Original)))
)
write(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/rengine/__fixtures__/ordinal_pls_csem_bergami.r.json"
)
cat("written\n")
