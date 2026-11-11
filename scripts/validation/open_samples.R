# Reference results for the open sample projects, from plain cSEM calls (independent of PLS Studio's code).
#   Rscript scripts/validation/open_samples.R
suppressPackageStartupMessages({
  library(cSEM)
  library(jsonlite)
})
fit <- function(file, model) {
  d <- read.csv(file.path("public/examples/samples", file))
  for (k in names(d)) d[[k]][is.na(d[[k]])] <- mean(d[[k]], na.rm = TRUE)
  f <- csem(d, model, .disattenuate = FALSE, .PLS_weight_scheme_inner = "path", .tolerance = 1e-7, .iter_max = 300)
  P <- f$Estimates$Path_estimates
  list(
    n = nrow(d), paths = lapply(setNames(seq_len(nrow(P)), rownames(P)), function(i) as.list(P[i, ])), r2 = as.list(f$Estimates$R2), rhoC = as.list(assess(f, .quality_criterion = "rho_C")$Reliability$Dijkstra_Henselers_rho_A %||% list()),
    loadings = as.list(f$Estimates$Loading_estimates[f$Estimates$Loading_estimates != 0] |> setNames(colnames(f$Estimates$Loading_estimates)[colSums(f$Estimates$Loading_estimates != 0) > 0]))
  )
}
`%||%` <- function(a, b) if (is.null(a)) b else a
items <- function(p, n) paste(paste0(p, seq_len(n)), collapse = " + ")
out <- list(
  tam = fit("tam_ai_design_tools.csv", paste(sprintf("%s =~ %s", c("SE", "TR", "PEOU", "PU", "BI"), mapply(items, c("SE", "TR", "PEOU", "PU", "BI"), c(7, 6, 6, 6, 6))), collapse = "\n") |> paste("PEOU ~ SE\nPU ~ TR + PEOU\nBI ~ PEOU + PU", sep = "\n")),
  utaut = fit("utaut_seabank.csv", paste(sprintf("%s =~ %s", c("PE", "EE", "SI", "FC", "BI"), mapply(items, c("PE", "EE", "SI", "FC", "BI"), c(4, 4, 3, 4, 4))), collapse = "\n") |> paste("BI ~ PE + EE + SI + FC", sep = "\n")),
  retention = fit("retention_workload.csv", "WL =~ WL1 + WL2 + WL3 + WL4 + WL5\nJS =~ FULFIL\nQUIT =~ LEAVE\nJS ~ WL\nQUIT ~ WL + JS")
)
write_json(out, "src/engine/__fixtures__/samples/reference.json", auto_unbox = TRUE, digits = 10, pretty = TRUE)
