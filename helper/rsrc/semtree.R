# SEM trees and forests (semtree; Brandmaier, von Oertzen, McArdle & Lindenberger
# 2013): the CB-SEM model on the canvas, fitted by lavaan as the Model tab fits
# it, is split recursively on chosen covariates into groups whose model
# parameters differ most (a likelihood-ratio test per candidate split, or
# score-based tests); every node is the model refitted to its cases. Optionally
# a SEM forest of trees on subsamples and its permutation variable importance.
# semtree depends on OpenMx, which has no build for R in the browser: desktop R only.

.ps_semtree_types <- c("numeric", "ordered", "categorical")

#' The tree's nodes in depth-first order: id, parent, which side of the parent's rule (0: the rule false, semtree's
#' left child; 1: true), N, the split (variable, relation, value) and its test, and the model's free parameters as
#' estimated in the node (semtree's node$params, in the order of the template fit's free parameters `fr`).
ps_semtree_nodes <- function(node, back, fr, parent = NULL, edge = NULL) {
  est <- as.numeric(node$params)
  if (length(est) != nrow(fr)) stop("The tree's parameters do not match the model's.")
  leaf <- semtree::isLeaf(node)
  r <- node$rule
  me <- list(id = node$node_id, parent = parent, edge = edge, n = node$N, terminal = leaf,
    rule = if (!leaf && !is.null(r)) list(variable = ps_back(r$name, back), relation = as.character(r$relation), value = I(as.character(r$value))) else NULL,
    lr = if (!leaf) node$lr else NULL, df = if (!leaf) node$df else NULL, p = if (!leaf) node$p else NULL,
    params = lapply(seq_len(nrow(fr)), function(i) list(lhs = ps_back(fr$lhs[i], back), op = fr$op[i], rhs = if (fr$op[i] == "~1") "" else ps_back(fr$rhs[i], back),
      est = est[i])))
  if (leaf) return(list(me))
  c(list(me), ps_semtree_nodes(node$left_child, back, fr, node$node_id, 0L), ps_semtree_nodes(node$right_child, back, fr, node$node_id, 1L))
}

ps_semtree <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (grepl("emscripten", R.version$platform)) stop("SEM trees (semtree, OpenMx) run in desktop R: choose Desktop R (helper) under R runs in.")
  o <- req$tree
  method <- o[["method", exact = TRUE]] %||% "naive"
  if (!(is.character(method) && length(method) == 1 && method %in% c("naive", "score", "fair"))) stop("Invalid split method in the request.")
  alpha <- ps_number(o$alpha %||% 0.05, "significance level")
  if (alpha <= 0 || alpha >= 1) stop("Invalid significance level in the request.")
  depth <- ps_number(o$maxDepth %||% 3, "maximum depth")
  if (depth < 1 || depth > 10 || depth != round(depth)) stop("The maximum depth must be 1 to 10.")
  minn <- ps_number(o$minN %||% 20, "minimum node size")
  if (minn < 2 || minn > 1e6 || minn != round(minn)) stop("Invalid minimum node size in the request.")
  b <- ps_cb_build(req)
  ps_cb_plain(b, "SEM trees")
  if (!grepl("^fit <- sem\\(.*\\)$", b$call)) stop("SEM trees are not available for this model.")
  if (!is.null(b$group_var)) stop("SEM trees split one sample: remove the grouping (add the grouping column as a covariate instead).")
  if (length(b$composites)) stop("SEM trees are for common-factor models; the model has composites (<~).")
  # The covariates travel with the data under syntactic names no model variable has.
  cv <- req$covariates
  cn <- as.character(unlist(cv$names)); types <- as.character(unlist(cv$types))
  if (!length(cn) || length(cn) > 50 || anyDuplicated(cn) || length(types) != length(cn) || !all(types %in% .ps_semtree_types)) stop("Choose 1 to 50 covariates, each numeric, ordered or categorical.")
  if (any(cn %in% b$n$all_inds)) stop("A covariate is also a variable of the model.")
  cols <- cv$cols
  col <- function(i) as.numeric(if (is.matrix(cols)) cols[i, ] else cols[[i]])
  idents <- ps_ident(c(names(b$inputs$data), cn))[-seq_along(names(b$inputs$data))]
  for (j in seq_along(idents)) while (idents[j] %in% c(names(b$inputs$data), idents[-j])) idents[j] <- paste0(idents[j], "_cov")
  if (any(vapply(seq_along(cn), function(i) length(col(i)) != nrow(b$inputs$data), TRUE))) stop("A covariate does not have one value per case.")
  for (i in seq_along(cn)) b$inputs$data[[idents[i]]] <- col(i)
  back <- c(ps_cb_back(b), setNames(cn, idents))
  conv <- vapply(seq_along(cn), function(i) switch(types[i],
    numeric = sprintf("data$%s <- as.numeric(data$%s)", idents[i], idents[i]),
    ordered = sprintf("data$%s <- ordered(data$%s)", idents[i], idents[i]),
    categorical = sprintf("data$%s <- factor(data$%s)", idents[i], idents[i])), "")
  ctrl <- sprintf("semtree.control(method = \"%s\", alpha = %s, max.depth = %d, min.N = %d, verbose = FALSE, progress.bar = FALSE)", method, format(alpha), as.integer(depth), as.integer(minn))
  fo <- o$forest
  trees <- if (is.null(fo)) 0L else as.integer(ps_number(fo$trees %||% 50, "number of trees"))
  if (!is.null(fo) && (is.na(trees) || trees < 2 || trees > 1000)) stop("A forest of 2 to 1000 trees.")
  seed <- if (is.null(fo)) NULL else as.integer(ps_number(fo$seed %||% 1, "seed"))
  body <- c(b$body,
    "suppressPackageStartupMessages(library(semtree))",
    "# The covariates the tree may split on, with their scales",
    conv,
    sprintf("# The SEM tree: the fitted model split on the covariates (%s; alpha = %s, depth at most %d, at least %d cases a node)",
      c(naive = "likelihood-ratio tests of every split", score = "score-based tests", fair = "the fair two-stage selection")[[method]], format(alpha), as.integer(depth), as.integer(minn)),
    sprintf("tree <- semtree(model = fit, data = data, predictors = %s, control = %s)", ps_q(idents), ctrl),
    if (trees > 0) c(
      sprintf("# A SEM forest of %d trees on subsamples, and the covariates' permutation importance (the seed makes both reproducible)", trees),
      sprintf("set.seed(%d)", seed),
      sprintf("forest <- semforest(model = fit, data = data, predictors = %s, control = semforest.control(num.trees = %d, control = %s))", ps_q(idents), trees, ctrl),
      "vim <- varimp(forest)",
      "importance <- colMeans(vim$importance, na.rm = TRUE)"))
  inputs <- b$inputs
  if (export) return(paste(ps_script(sprintf("SEM tree%s (semtree)", if (trees > 0) " and forest" else ""), c("lavaan", "semtree"), inputs, body, c("print(tree)", "toTable(tree)", if (trees > 0) "importance")), collapse = "\n"))
  env <- ps_run(body, inputs)
  imp <- if (trees > 0) list(variables = I(unname(ps_back(names(env$importance), back))), importance = I(unname(ifelse(is.finite(env$importance), env$importance, NA_real_))),
    trees = length(env$forest$forest), seed = seed) else NULL
  pt <- lavaan::parTable(env$fit)
  fr <- pt[pt$free > 0, , drop = FALSE]
  fr <- fr[order(fr$free), , drop = FALSE]
  ps_json(list(nodes = ps_semtree_nodes(env$tree, back, fr), n = nrow(env$data), method = method, alpha = alpha, maxDepth = depth, minN = minn,
    covariates = lapply(seq_along(cn), function(i) list(name = cn[i], type = types[i])), forest = imp,
    warnings = env$.warnings, engine = list(package = "semtree", version = as.character(utils::packageVersion("semtree")), openmx = as.character(utils::packageVersion("OpenMx")))))
}
