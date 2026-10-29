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
