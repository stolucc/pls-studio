# Native references for the network card's other estimators and correlations and EGA's TMFG model
# (src/rengine/network.webr.test.ts): bootnet's unregularised partial-correlation ("pcor") and correlation ("cor")
# networks and the EBICglasso network of Spearman correlations, on the first ten Big Five items (psych::bfi, as
# ?estimateNetwork; pairwise deletion), with qgraph centrality; EGAnet's ?EGA data (wmt2[, 7:24]) with model = "TMFG".
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/network_modes.R
suppressPackageStartupMessages({
  library(bootnet)
  library(EGAnet)
  library(jsonlite)
})
d <- psych::bfi[, 1:10]
one <- function(default, cm) {
  n <- estimateNetwork(d, default = default, corMethod = cm, missing = "pairwise", verbose = FALSE)
  ce <- qgraph::centrality_auto(n$graph)$node.centrality
  list(weights = unname(n$graph), strength = unname(ce$Strength), expectedInfluence = unname(ce$ExpectedInfluence))
}
ega <- EGA(wmt2[, 7:24], model = "TMFG", algorithm = "walktrap", corr = "auto", plot.EGA = FALSE)
out <- list(
  versions = list(bootnet = as.character(packageVersion("bootnet")), qgraph = as.character(packageVersion("qgraph")), EGAnet = as.character(packageVersion("EGAnet")), R = R.version.string),
  names = colnames(d), pcor = one("pcor", "cor"), cor = one("cor", "cor"), spearman = one("EBICglasso", "spearman"),
  tmfg = list(dims = ega$n.dim, membership = unname(as.integer(ega$wc)), weights = unname(ega$network), loadings = unname(net.loads(ega)$std[colnames(ega$network), ]))
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA), "src/engine/__fixtures__/network/modes.json")
cat("TMFG dims", ega$n.dim, "\n")
