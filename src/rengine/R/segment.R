# Segmentation of PLS path models for unobserved heterogeneity: REBUS-PLS
# (response-based unit segmentation; Esposito Vinzi, Trinchera, Squillacciotti
# & Tenenhaus 2008) with plspm (Sanchez, Trinchera & Russolillo).

#' Constructs in an order where every path goes from an earlier to a later one
#' (plspm wants a lower-triangular path matrix).
ps_topo_order <- function(names, paths) {
  out <- character(0); left <- names
  while (length(left)) {
    ready <- left[vapply(left, function(x) !any(vapply(paths, function(p) p$to == x && p$from %in% left, TRUE)), TRUE)]
    if (!length(ready)) stop("The structural model has a cycle.")
    out <- c(out, ready); left <- setdiff(left, ready)
  }
  out
}

ps_rebus <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  cons <- req$model$constructs
  if (length(req$model$moderations)) stop("REBUS-PLS works on models without interaction terms.")
  if (any(lengths(lapply(cons, function(c) unlist(c$components))) > 0)) stop("REBUS-PLS works on models without higher-order constructs.")
  if (any(vapply(cons, function(c) !identical(c$mode %||% "A", "A"), TRUE))) stop("REBUS-PLS needs reflective (Mode A) blocks only.")
  if (!length(req$model$paths)) stop("REBUS-PLS needs a structural model (paths).")
  n <- ps_names(cons)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 2 | ks > 6)) stop("Choose between 2 and 6 classes.")
  stop_crit <- as.numeric(req$stopCrit %||% 0.005); iter_max <- as.integer(req$iterMax %||% 100)
  if (!is.finite(stop_crit) || stop_crit <= 0 || stop_crit >= 1 || iter_max < 1 || iter_max > 1000) stop("Invalid REBUS settings.")
  seed <- as.integer(req$seed %||% 1)
  scheme <- req$options$scheme %||% "centroid"
  if (!scheme %in% c("path", "centroid", "factor")) stop("Invalid weighting scheme in the request.")
  ord <- ps_topo_order(n$cname, req$model$paths)
  lv <- unname(n$cv[ord])
  K <- length(lv)
  edges <- vapply(req$model$paths, function(p) sprintf("path[\"%s\", \"%s\"] <- 1", n$cv[[p$to]], n$cv[[p$from]]), "")
  blocks <- vapply(ord, function(x) ps_q(unname(n$iv[n$inds[[match(x, n$cname)]]])), "")
  body <- c("suppressPackageStartupMessages(library(plspm))", ps_missing_code(req$missing),
    "# Inner model: path[to, from] = 1, constructs in causal order (lower triangular).",
    sprintf("lvs <- %s", ps_q(lv)),
    "path <- matrix(0, length(lvs), length(lvs), dimnames = list(lvs, lvs))", edges,
    sprintf("blocks <- list(%s)", paste(blocks, collapse = ", ")),
    sprintf("global <- plspm(data, path, blocks, modes = rep(\"A\", %d), scheme = \"%s\", tol = %s, maxiter = %d)",
      K, scheme, format(req$options$tolerance %||% 1e-6, scientific = TRUE), as.integer(req$options$maxIter %||% 100)),
    "# Step 1: Ward clustering of the global model's residuals: outer (standardised indicators minus",
    "# score x loading) and inner (endogenous scores minus their fitted values). This is plspm::res.clus,",
    "# whose amap::hcluster(nbproc = 2) needs threads; base R's hclust Ward (ward.D) gives the same tree.",
    "rebus_residuals <- function(g) {",
    "  bl <- rep(seq_along(g$model$blocks), lengths(g$model$blocks)); n <- nrow(g$data)",
    "  X <- scale(g$data) * sqrt(n / (n - 1)); S <- g$scores; L <- g$outer_model$loading; endo <- rowSums(g$model$IDM) > 0",
    "  outer <- X; for (j in seq_along(g$model$blocks)) outer[, bl == j] <- X[, bl == j] - S[, j] %*% t(L[bl == j])",
    "  cbind(outer, S[, endo, drop = FALSE] - S %*% t(g$path_coefs[endo, , drop = FALSE]))",
    "}",
    "hc <- hclust(dist(rebus_residuals(global)), method = \"ward.D\")",
    sprintf("# Step 2: REBUS iterations from the hierarchical solution with %s classes; permutation tests between the classes.", paste(ks, collapse = ", ")),
    sprintf("set.seed(%d)", seed),
    "rebus <- list(); tests <- list()",
    sprintf("for (k in %s) {", paste(deparse(ks), collapse = "")),
    sprintf("  rebus[[as.character(k)]] <- it.reb(global, hc, nk = k, stop.crit = %s, iter.max = %d)", format(stop_crit), iter_max),
    "  tests[[as.character(k)]] <- rebus.test(global, rebus[[as.character(k)]])",
    "}")
  inputs <- list(data = ps_frame(req, n))
  if (export) return(paste(ps_script("REBUS-PLS segmentation (plspm)", "plspm", inputs, body,
    c("global", "plot(hc, labels = FALSE, main = \"REBUS: Ward clustering of the residuals\")", "rebus", "tests")), collapse = "\n"))
  env <- ps_run(body, inputs)
  back_lv <- setNames(ord, lv)
  back_mv <- setNames(n$all_inds, unname(n$iv[n$all_inds]))
  # "A->B" path names and "Com.X" / "R2.X" quality rows, in the app's names.
  path_name <- function(s) { p <- strsplit(s, "->", fixed = TRUE)[[1]]; list(from = unname(back_lv[p[1]]), to = unname(back_lv[p[2]])) }
  h <- env$hc$height
  top <- rev(utils::tail(h, 12))  # fusion levels of the last merges: the k-class cut lies below top[k - 1]
  models <- lapply(as.character(ks), function(k) {
    r <- env$rebus[[k]]; q <- r$quality; t <- env$tests[[k]]
    row <- function(prefix) { i <- startsWith(rownames(q), paste0(prefix, ".")); setNames(lapply(which(i), function(j) unname(q[j, ])), unname(back_lv[sub("^[A-Za-z0-9]+\\.", "", rownames(q)[i])])) }
    list(k = as.integer(k), gqi = r$aux[[7]], iterations = r$aux[[6]], changeRate = r$aux[[3]],
      sizes = as.integer(table(factor(r$segments, levels = seq_len(as.integer(k))))),
      segments = unname(as.integer(r$segments)),
      paths = lapply(seq_len(nrow(r$path.coef)), function(i) c(path_name(rownames(r$path.coef)[i]), list(byClass = unname(r$path.coef[i, ])))),
      loadings = lapply(seq_len(nrow(r$loadings)), function(i) list(indicator = unname(back_mv[rownames(r$loadings)[i]]), byClass = unname(r$loadings[i, ]))),
      communality = row("Com"), r2 = row("R2"), gof = unname(q["GoF", ]),
      tests = lapply(names(t), function(nm) {
        x <- t[[nm]]; cls <- as.integer(strsplit(sub("^test_", "", nm), "_")[[1]])
        list(classes = cls,
          paths = lapply(seq_len(nrow(x$paths)), function(i) c(path_name(rownames(x$paths)[i]), list(diff = x$paths[i, 3], p = x$paths[i, 4]))),
          gof = list(diff = x$gof[1, 3], p = x$gof[1, 4]))
      }))
  })
  ps_json(list(n = nrow(env$global$scores), globalGof = env$global$gof,
    globalPaths = lapply(req$model$paths, function(p) list(from = p$from, to = p$to,
      est = env$global$path_coefs[n$cv[[p$to]], n$cv[[p$from]]])),
    fusion = top, models = models,
    warnings = env$.warnings, engine = list(package = "plspm", version = as.character(utils::packageVersion("plspm")))))
}

`%|NA|%` <- function(a, b) if (!length(a) || is.na(a)) b else unname(a)

#' PATHMOX (Lamberti, Aluja & Sanchez 2016; genpathmox): a binary tree that
#' splits the sample by categorical segmentation variables where the PLS
#' models of the two sides differ most (F test of equal inner models).
ps_pathmox <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  cons <- req$model$constructs
  if (length(req$model$moderations)) stop("PATHMOX works on models without interaction terms.")
  if (!length(req$model$paths)) stop("PATHMOX needs a structural model (paths).")
  segs <- req$segments
  if (!length(segs)) stop("Choose at least one segmentation variable.")
  alpha <- as.numeric(req$alpha %||% 0.05); deep <- as.integer(req$depth %||% 2); size <- as.numeric(req$size %||% 0.1)
  if (!is.finite(alpha) || alpha <= 0 || alpha >= 0.5 || deep < 1 || deep > 6 || !is.finite(size) || size <= 0 || size >= 0.5) stop("Invalid PATHMOX settings.")
  scheme <- req$options$scheme %||% "path"
  if (!scheme %in% c("path", "centroid", "factor")) stop("Invalid weighting scheme in the request.")
  n <- ps_names(cons)
  seg_names <- vapply(segs, function(s) s[["column"]], "")
  if (any(seg_names %in% n$all_inds)) stop("A segmentation variable cannot also be an indicator.")
  fr <- ps_long_frame(req, c(n$all_inds, seg_names))
  v <- fr$v
  lv <- function(c) n$cv[[c$name]]
  lines <- c(vapply(req$model$paths, function(p) sprintf("%s ~ %s", n$cv[[p$to]], n$cv[[p$from]]), ""),
    vapply(cons, function(c) sprintf("%s %s %s", lv(c), if (identical(c$mode, "B") || identical(c$type, "composite")) "<~" else "=~",
      paste(unname(v[unlist(c$indicators)]), collapse = " + ")), ""))
  facs <- unlist(lapply(segs, function(s) {
    # ([[ ]], not $: s$order would partially match s$ordered)
    col <- v[[s[["column"]]]]; labs <- unlist(s[["labels"]]); ord <- unlist(s[["order"]])
    if (!length(labs)) labs <- as.character(sort(unique(fr$data[[col]])))
    lev <- if (length(ord)) ord else seq_along(labs)
    if (length(ord) && (!setequal(ord, seq_along(labs)))) stop("Invalid category order in the request.")
    sprintf("catvar$%s <- factor(data$%s, levels = %s, labels = %s, ordered = %s)", col, col,
      paste(deparse(as.integer(lev)), collapse = ""), ps_q(labs[lev]), if (isTRUE(s[["ordered"]])) "TRUE" else "FALSE")
  }))
  body <- c("suppressPackageStartupMessages(library(genpathmox))",
    "data <- data[complete.cases(data), ]",
    "model <- '", paste0("  ", lines), "'",
    "# Segmentation variables: factors (ordered ones may only be split between neighbouring categories).",
    "catvar <- data.frame(row.names = seq_len(nrow(data)))", facs,
    sprintf("pmx <- pls.pathmox(.model = model, .data = data, .catvar = catvar, .scheme = \"%s\", .consistent = %s, .alpha = %s, .deep = %d, .size = %s, .tree = FALSE)",
      c(path = "path", centroid = "centroid", factor = "factorial")[[scheme]], if (isTRUE(req$options$consistent)) "TRUE" else "FALSE", format(alpha), deep, format(size)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("PATHMOX segmentation tree (genpathmox)", "genpathmox", inputs, body, c("pmx$MOX", "pmx$Fg.r", "pmx$terminal_paths", "pmx$var_imp")), collapse = "\n"))
  env <- ps_run(body, inputs)
  p <- env$pmx
  back_lv <- setNames(n$cname, unname(n$cv))
  nm <- function(x) { for (k in names(back_lv)) x <- gsub(paste0("\\b", k, "\\b"), back_lv[[k]], x, perl = TRUE); x }
  mox <- p$MOX
  tp <- p$terminal_paths
  ps_json(list(
    nodes = lapply(seq_len(nrow(mox)), function(i) list(node = mox$node[i], parent = mox$parent[i], depth = mox$depth[i], terminal = mox$terminal[i] == "yes",
      size = mox$size[i], percent = mox[["%"]][i], variable = if (is.na(mox$variable[i])) NULL else unname(fr$back[mox$variable[i]] %|NA|% mox$variable[i]),
      category = if (is.na(mox$category[i])) NULL else mox$category[i])),
    splits = lapply(seq_len(nrow(p$Fg.r)), function(i) list(node = p$Fg.r$node[i], f = p$Fg.r[["F value"]][i], p = p$Fg.r[["Pr(>F)"]][i],
      variable = unname(fr$back[p$Fg.r$variable[i]] %|NA|% p$Fg.r$variable[i]), left = p$Fg.r$g1.mod[i], right = p$Fg.r$g2.mod[i],
      paths = { fc <- p$Fc.r[[i]]; lapply(seq_len(nrow(fc)), function(j) list(path = nm(rownames(fc)[j]), f = fc[j, 1], p = fc[j, 2])) })),
    terminal = list(nodes = colnames(tp), rows = lapply(seq_len(nrow(tp)), function(i) list(name = nm(rownames(tp)[i]), values = unname(tp[i, ])))),
    importance = lapply(seq_len(nrow(p$var_imp)), function(i) list(variable = unname(fr$back[p$var_imp$variable[i]] %|NA|% p$var_imp$variable[i]), ranking = p$var_imp$ranking[i])),
    warnings = env$.warnings, engine = list(package = "genpathmox", version = as.character(utils::packageVersion("genpathmox")))))
}
