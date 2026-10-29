# Reference results for necessary condition analysis from the NCA package
# (Dul), on its own example (nca.example: individualism and risk taking as
# conditions for innovation performance), CE-FDH and CR-FDH, 100 permutations.
# Also writes nca.example for the app (NCA cannot run in the browser's R).
#   R_LIBS=/path/to/lib Rscript scripts/validation/nca.R

suppressPackageStartupMessages({ library(jsonlite); library(NCA) })
data(nca.example)
write.csv(nca.example, "public/examples/nca/nca_example.csv", row.names = FALSE)
m <- nca_analysis(nca.example, c(1, 2), 3, ceilings = c("ce_fdh", "cr_fdh"), test.rep = 100)
out <- list(version = as.character(packageVersion("NCA")), conditions = lapply(1:2, function(j) {
  p <- m$summaries[[j]]$params
  list(x = names(nca.example)[j], ce = p["Effect size", "ce_fdh"], cr = p["Effect size", "cr_fdh"], pce = p["p-value", "ce_fdh"], pcr = p["p-value", "cr_fdh"],
    accuracy = p["c-accuracy", "cr_fdh"], slope = p["Slope", "cr_fdh"], intercept = p["Intercept", "cr_fdh"],
    bottleneckCr = as.character(m$bottlenecks$cr_fdh[[j + 1]]), bottleneckCe = as.character(m$bottlenecks$ce_fdh[[j + 1]]))
}))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/nca/reference.json")
cat("written; licence", packageDescription("NCA")$License, "\n")
