# Native references for network psychometrics and EGA (src/rengine/network.webr.test.ts):
# bootnet's EBICglasso network of the 25 Big Five items (its ?estimateNetwork example data, psych::bfi)
# with Pearson and cor_auto correlations, qgraph centrality; EGAnet's ?EGA example (wmt2[, 7:24]).
# Run: R_LIBS=<isolated lib> Rscript scripts/validation/network.R
suppressPackageStartupMessages({
  library(bootnet)
  library(EGAnet)
  library(jsonlite)
})
d <- psych::bfi[, 1:25]
one <- function(cm) {
  n <- estimateNetwork(d, default = "EBICglasso", corMethod = cm, missing = "pairwise", verbose = FALSE)
  ce <- qgraph::centrality_auto(n$graph)$node.centrality
  list(weights = unname(n$graph), strength = unname(ce$Strength), expectedInfluence = unname(ce$ExpectedInfluence), betweenness = unname(ce$Betweenness))
}
ega <- EGA(wmt2[, 7:24], plot.EGA = FALSE)
out <- list(
  versions = list(
    bootnet = as.character(packageVersion("bootnet")), qgraph = as.character(packageVersion("qgraph")),
    glasso = as.character(packageVersion("glasso")), EGAnet = as.character(packageVersion("EGAnet")), R = R.version.string
  ),
  names = colnames(d), pearson = one("cor"), cor_auto = one("cor_auto"),
  ega = list(dims = ega$n.dim, membership = unname(as.integer(ega$wc)), weights = unname(ega$network), loadings = unname(net.loads(ega)$std[colnames(ega$network), ]))
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "src/engine/__fixtures__/network/reference.json")
cat("dims", ega$n.dim, "edges", sum(out$pearson$weights[upper.tri(out$pearson$weights)] != 0), "\n")
