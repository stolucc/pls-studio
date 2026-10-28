# Reference output for consistent PLS (PLSc), composite models and the
# Dijkstra-Henseler fit measures. Run from the repo root:
#   Rscript scripts/make-csem-fixtures.R
suppressMessages(library(cSEM))
out <- "src/engine/__fixtures__"
mobi <- read.csv(file.path(out, "mobi.csv"))

structural <- "
Expectation ~ Image
Quality ~ Expectation
Value ~ Expectation + Quality
Satisfaction ~ Image + Expectation + Quality + Value
Loyalty ~ Image + Satisfaction"

models <- list(
  # Common factors (=~, disattenuated by PLSc) plus one Mode B composite.
  plsc_mixed = paste("
Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
Expectation =~ CUEX1 + CUEX2 + CUEX3
Quality <~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
Value =~ PERV1 + PERV2
Satisfaction =~ CUSA1 + CUSA2 + CUSA3
Loyalty =~ CUSL1 + CUSL2 + CUSL3", structural),
  # Pure composite model (confirmatory composite analysis setting), Mode B.
  composite = paste("
Image <~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
Expectation <~ CUEX1 + CUEX2 + CUEX3
Quality <~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
Value <~ PERV1 + PERV2
Satisfaction <~ CUSA1 + CUSA2 + CUSA3
Loyalty <~ CUSL1 + CUSL2 + CUSL3", structural)
)

m2l <- function(m) lapply(seq_len(nrow(m)), function(i) setNames(as.list(unclass(m)[i, ]), colnames(m))) |> setNames(rownames(m))
for (name in names(models)) {
  r <- csem(mobi, models[[name]], .tolerance = 1e-12, .iter_max = 1000)
  e <- r$Estimates
  load <- colSums(e$Loading_estimates)
  wts <- colSums(e$Weight_estimates)
  res <- list(
    paths = m2l(e$Path_estimates),            # rows = dependent, cols = predictor
    loadings = as.list(load),
    weights = as.list(wts),
    constructCor = m2l(e$Construct_VCV),
    r2 = as.list(e$R2),
    rhoA = as.list(e$Reliabilities),
    htmt = if (name == "plsc_mixed") m2l(calculateHTMT(r)$htmts) else NULL,
    htmt2 = if (name == "plsc_mixed") m2l(calculateHTMT(r, .type_htmt = "htmt2")$htmts) else NULL,
    fit = list(
      srmr = calculateSRMR(r), dL = calculateDL(r), dG_log10 = calculateDG(r),
      srmr_sat = calculateSRMR(r, .saturated = TRUE), dL_sat = calculateDL(r, .saturated = TRUE),
      dG_log10_sat = calculateDG(r, .saturated = TRUE)))
  jsonlite::write_json(res, file.path(out, paste0("csem_", name, ".json")), digits = NA, auto_unbox = TRUE, pretty = TRUE)
  cat(name, "SRMR", res$fit$srmr, "dL", res$fit$dL, "\n")
}
