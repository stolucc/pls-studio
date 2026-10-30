# Network psychometrics (bootnet, qgraph) and exploratory graph analysis (EGAnet).

#' The chosen data columns as a data frame (missing values NA).
ps_net_data <- function(req) {
  cols <- req$data$cols
  nm <- unlist(req$data$names)
  # jsonlite turns equal-length columns into a (variables x rows) matrix (as in ps_frame).
  col <- function(i) as.numeric(if (is.matrix(cols)) cols[i, ] else unlist(lapply(cols[[i]], function(v) if (is.null(v)) NA else v)))
  d <- as.data.frame(lapply(seq_along(nm), col), col.names = nm, check.names = FALSE)
  vars <- unlist(req$vars)
  if (length(vars) < 3) stop("Choose at least three variables.")
  if (!all(vars %in% names(d))) stop("A chosen variable is not in the data.")
  d[vars]
}

#' A Gaussian graphical model (bootnet::estimateNetwork): regularised partial
#' correlations (EBICglasso, Epskamp & Fried 2018) or unregularised ones; node
#' centrality (qgraph::centrality_auto) and qgraph's spring layout; optionally the
#' case-dropping bootstrap of centrality stability (bootnet, CS coefficient).
ps_network <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  # (netEstimator / netMissing: "estimator" and "missing" are reserved for the SEM settings in ps_validate)
  estimator <- req[["netEstimator", exact = TRUE]]
  if (!estimator %in% c("EBICglasso", "pcor", "cor")) stop("Unknown network estimator.")
  cor_method <- req[["corMethod", exact = TRUE]]
  if (!cor_method %in% c("cor_auto", "cor", "spearman")) stop("Unknown correlation method.")
  missing <- if (identical(req[["netMissing", exact = TRUE]], "listwise")) "listwise" else "pairwise"
  gamma <- ps_number(req[["gamma", exact = TRUE]] %||% 0.5, "EBIC tuning parameter")
  if (gamma < 0 || gamma > 1) stop("The EBIC tuning parameter must be between 0 and 1.")
  B <- as.integer(ps_number(req$boot$samples %||% 0, "bootstrap samples")); seed <- as.integer(ps_number(req$boot$seed %||% 1, "seed"))
  if (is.na(B) || B < 0 || B > 5000) stop("The number of bootstrap samples must be between 0 and 5000.")
  inputs <- list(data = ps_net_data(req))
  body <- c(
    "suppressPackageStartupMessages(library(bootnet))",
    sprintf("net <- estimateNetwork(data, default = \"%s\", corMethod = \"%s\", missing = \"%s\"%s, verbose = FALSE)",
      estimator, cor_method, missing, if (estimator == "EBICglasso") sprintf(", tuning = %s", format(gamma)) else ""),
    "W <- net$graph  # edge weights: partial correlations",
    "central <- qgraph::centrality_auto(W)$node.centrality",
    "layout <- qgraph::qgraph(W, layout = \"spring\", DoNotPlot = TRUE)$layout",
    if (B > 0) c(
      "# Stability of the centrality indices: the network re-estimated on subsets of the cases (case-dropping bootstrap).",
      sprintf("set.seed(%d)", seed),
      sprintf("boot <- bootnet(net, nBoots = %d, type = \"case\", statistics = c(\"strength\", \"expectedInfluence\", \"closeness\", \"betweenness\"), nCores = 1, verbose = FALSE)", B),
      "cs <- corStability(boot, verbose = FALSE)"))
  if (export) return(paste(ps_script("Network (bootnet, qgraph)", c("bootnet", "qgraph"), inputs, body, c("print(round(W, 3))", "print(central)", if (B > 0) "print(cs)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  W <- env$W; ce <- env$central
  ps_json(list(names = I(colnames(W)), weights = lapply(seq_len(nrow(W)), function(i) I(unname(W[i, ]))),
    centrality = list(strength = I(unname(ce$Strength)), expectedInfluence = I(unname(ce$ExpectedInfluence)), closeness = I(unname(ce$Closeness)), betweenness = I(unname(ce$Betweenness))),
    layout = lapply(seq_len(nrow(env$layout)), function(i) I(unname(env$layout[i, ]))),
    n = nrow(inputs$data), nComplete = sum(stats::complete.cases(inputs$data)),
    cs = if (B > 0) as.list(env$cs) else NULL, samples = B, warnings = env$.warnings,
    engine = list(package = "bootnet", version = as.character(utils::packageVersion("bootnet")))))
}

#' Exploratory graph analysis (Golino & Epskamp 2017; EGAnet::EGA): the number of
#' dimensions as the communities of the (EBICglasso or TMFG) network; network
#' loadings (net.loads); optionally bootEGA's dimension and item stability.
ps_ega <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  model <- req[["model", exact = TRUE]]; if (!model %in% c("glasso", "TMFG")) stop("Unknown network model.")
  algorithm <- req[["algorithm", exact = TRUE]]; if (!algorithm %in% c("walktrap", "louvain", "leiden")) stop("Unknown community algorithm.")
  corr <- req[["corr", exact = TRUE]]; if (!corr %in% c("auto", "pearson", "spearman")) stop("Unknown correlation.")
  B <- as.integer(ps_number(req$boot$samples %||% 0, "bootstrap samples")); seed <- as.integer(ps_number(req$boot$seed %||% 1, "seed"))
  if (is.na(B) || B < 0 || B > 5000) stop("The number of bootstrap samples must be between 0 and 5000.")
  inputs <- list(data = ps_net_data(req))
  args <- sprintf("model = \"%s\", algorithm = \"%s\", corr = \"%s\"", model, algorithm, corr)
  body <- c(
    "suppressPackageStartupMessages(library(EGAnet))",
    sprintf("ega <- EGA(data, %s, plot.EGA = FALSE)", args),
    "loads <- net.loads(ega)$std  # network loadings (standardised)",
    "# A layout for drawing the network (Fruchterman-Reingold, fixed seed).",
    "set.seed(1); layout <- igraph::layout_with_fr(igraph::graph_from_adjacency_matrix(abs(ega$network), mode = \"undirected\", weighted = TRUE, diag = FALSE))",
    if (B > 0) c(
      "# Stability: EGA on bootstrap samples (bootEGA); how often each number of dimensions and each item's dimension recurs.",
      sprintf("boot <- bootEGA(data, iter = %d, seed = %d, %s, ncores = 1, plot.itemStability = FALSE, plot.typicalStructure = FALSE, verbose = FALSE)", B, seed, args),
      "items <- itemStability(boot, IS.plot = FALSE)"))
  if (export) return(paste(ps_script("Exploratory graph analysis (EGAnet)", "EGAnet", inputs, body, c("print(ega)", "print(round(loads, 3))", if (B > 0) c("print(boot$frequency)", "print(items)"))), collapse = "\n"))
  env <- ps_run(body, inputs)
  e <- env$ega; L <- env$loads
  vars <- colnames(e$network)
  L <- L[vars, , drop = FALSE]
  st <- if (B > 0) env$items$item.stability$empirical.dimensions else NULL
  ps_json(list(names = I(vars), dims = e$n.dim, membership = I(unname(as.integer(e$wc[vars]))),
    weights = lapply(seq_len(nrow(e$network)), function(i) I(unname(e$network[i, ]))),
    loadings = lapply(seq_len(nrow(L)), function(i) I(unname(L[i, ]))), loadingDims = I(colnames(L)),
    layout = lapply(seq_len(nrow(env$layout)), function(i) I(unname(env$layout[i, ]))), tefi = unname(e$TEFI),
    frequency = if (B > 0) lapply(seq_len(nrow(env$boot$frequency)), function(i) list(dims = env$boot$frequency[i, 1], share = env$boot$frequency[i, 2])) else NULL,
    itemStability = if (B > 0) I(unname(as.numeric(if (is.matrix(st)) apply(st, 1, max)[vars] else st[vars]))) else NULL,
    samples = B, n = nrow(inputs$data), warnings = env$.warnings,
    engine = list(package = "EGAnet", version = as.character(utils::packageVersion("EGAnet")))))
}
