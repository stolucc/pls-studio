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
      K, scheme, format(ps_number(req$options$tolerance %||% 1e-6, "tolerance"), scientific = TRUE), as.integer(req$options$maxIter %||% 100)),
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
  if (any(vapply(cons, function(c) identical(c$mode, "unit"), TRUE))) stop("PATHMOX (genpathmox) offers Mode A and Mode B only; set the sum-score constructs to Mode A or Mode B.")
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
  nm <- function(x) ps_back_names(x, back_lv)
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

#' FIMIX-PLS (Hahn, Johnson, Herrmann & Huber 2002; Sarstedt, Becker, Ringle
#' & Schwaiger 2011): a finite mixture of the structural model on the global
#' PLS construct scores. Each segment has its own path coefficients and error
#' variances; the equations are independent given the segment. Estimated with
#' flexmix (one Gaussian regression per endogenous construct, sharing the
#' segment membership), the best of several random starts per number of segments.
ps_fimix <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (length(req$model$moderations)) stop("FIMIX-PLS works on models without interaction terms.")
  if (!length(req$model$paths)) stop("FIMIX-PLS needs a structural model (paths).")
  ks <- as.integer(unlist(req$classes)); nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (!length(ks) || any(ks < 1 | ks > 8) || nrep < 1 || nrep > 100) stop("Invalid FIMIX settings.")
  req$package <- "cSEM"
  b <- ps_pls_build(req)
  cv <- b$n$cv
  ends <- unique(vapply(req$model$paths, function(p) p$to, ""))
  intercepts <- !identical(req$intercepts, FALSE)
  eqs <- vapply(ends, function(t) sprintf("FLXMRglm(%s ~ %s%s)", cv[[t]], paste(unique(vapply(Filter(function(p) p$to == t, req$model$paths), function(p) cv[[p$from]], "")), collapse = " + "),
    if (intercepts) "" else " - 1"), "")
  body <- c(b$body,
    "suppressPackageStartupMessages(library(flexmix))",
    "# The global model's standardised construct scores.",
    "scores <- as.data.frame(cSEM::getConstructScores(fit)$Construct_scores)",
    if (intercepts) "# One regression per endogenous construct, sharing the segments; segment-specific intercepts let segments differ in level too."
    else "# One regression per endogenous construct, sharing the segments; no intercepts (Hahn et al.'s model on standardised scores).",
    sprintf("equations <- list(%s)", paste(eqs, collapse = ", ")),
    sprintf("set.seed(%d)", seed),
    sprintf("fits <- stepFlexmix(~ 1, data = scores, k = %s, model = equations, nrep = %d, verbose = FALSE, control = list(minprior = 0))", paste(deparse(ks), collapse = ""), nrep),
    "if (inherits(fits, \"flexmix\")) fits <- list(fits) else fits <- lapply(as.character(sort(unique(fits@k))), function(k) getModel(fits, k))",
    "# Fit criteria (Sarstedt et al. 2011): AIC3 and CAIC together, BIC; EN: normed entropy (separation of the segments).",
    "criteria <- function(m) {",
    "  ll <- as.numeric(logLik(m)); p <- attr(logLik(m), \"df\"); n <- nrow(scores); k <- m@k",
    "  post <- posterior(m); en <- if (k > 1) 1 - sum(-post * log(pmax(post, 1e-300))) / (n * log(k)) else NA",
    "  c(k = k, logLik = ll, npar = p, AIC = -2 * ll + 2 * p, AIC3 = -2 * ll + 3 * p, AIC4 = -2 * ll + 4 * p, BIC = -2 * ll + log(n) * p,",
    "    CAIC = -2 * ll + (log(n) + 1) * p, HQ = -2 * ll + 2 * log(log(n)) * p, MDL5 = -2 * ll + 5 * log(n) * p, EN = en)",
    "}",
    "summary_table <- t(sapply(fits, criteria))")
  inputs <- b$inputs
  if (export) return(paste(ps_script("FIMIX-PLS (cSEM scores, flexmix)", c("cSEM", "flexmix"), inputs, body, c("summary_table", "lapply(fits, parameters)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  back <- setNames(names(cv), unname(cv))
  models <- lapply(env$fits, function(m) {
    cr <- env$criteria(m); k <- m@k; cl <- flexmix::clusters(m)
    segs <- lapply(seq_len(k), function(s) {
      paths <- unlist(lapply(seq_along(ends), function(j) {
        pr <- flexmix::parameters(m, component = s, model = j)
        co <- pr[grepl("^coef\\.", rownames(pr)), 1]; names(co) <- sub("^coef\\.", "", names(co))
        lapply(names(co), function(f) list(from = if (f == "(Intercept)") "Intercept" else unname(back[f]), to = ends[j], est = unname(co[[f]])))
      }), recursive = FALSE)
      r2 <- lapply(seq_along(ends), function(j) {
        y <- env$scores[[cv[[ends[j]]]]][cl == s]
        pr <- flexmix::parameters(m, component = s, model = j); sigma <- pr["sigma", 1]
        list(construct = ends[j], r2 = if (length(y) > 2) max(0, 1 - sigma^2 / stats::var(y)) else NA)
      })
      list(segment = s, share = mean(cl == s), paths = paths, r2 = r2)
    })
    list(k = k, criteria = as.list(cr[-1]), segments = segs, assignment = unname(as.integer(cl)))
  })
  ps_json(list(n = nrow(env$scores), models = models,
    warnings = env$.warnings, engine = list(package = "flexmix", version = as.character(utils::packageVersion("flexmix")))))
}

#' PLS-POS (Becker, Rai, Ringle & Voelckner 2013): prediction-oriented
#' segmentation. Starting from random partitions, observations are moved to
#' the segment whose local PLS model predicts their endogenous construct
#' scores best, and a move is kept only if it raises the objective, the sum
#' of the R-squared values of all endogenous constructs over the segments.
#' Written out here (no R package implements it); checked by recovering
#' known segments.
PS_POS_FUNCTIONS <- c(
  "# A local PLS model: weights, paths, standardisation and R-squared of one segment.",
  "pos_fit <- function(d) {",
  "  f <- pos_estimate(d); e <- f$Estimates",
  "  list(W = e$Weight_estimates, B = e$Path_estimates, m = colMeans(d), s = apply(d, 2, stats::sd), r2 = e$R2)",
  "}",
  "# Squared structural residuals of every observation under a segment's model (its weights, standardisation and paths).",
  "pos_distance <- function(g, X) {",
  "  Z <- sweep(sweep(X[, colnames(g$W), drop = FALSE], 2, g$m[colnames(g$W)]), 2, g$s[colnames(g$W)], \"/\")",
  "  S <- Z %*% t(g$W); endo <- names(g$r2)",
  "  rowSums((S[, endo, drop = FALSE] - S %*% t(g$B[endo, , drop = FALSE]))^2)",
  "}",
  "pos_objective <- function(fits) sum(unlist(lapply(fits, `[[`, \"r2\")))",
  "pos_run <- function(X, K, min_size, max_moves, candidates) {",
  "  n <- nrow(X); a <- sample(rep(seq_len(K), length.out = n))",
  "  fits <- lapply(seq_len(K), function(k) pos_fit(X[a == k, , drop = FALSE])); obj <- pos_objective(fits); moves <- 0",
  "  repeat {",
  "    D <- sapply(fits, function(g) pos_distance(g, X))",
  "    gain <- D[cbind(seq_len(n), a)] - apply(D, 1, min)",
  "    cand <- utils::head(order(-gain)[sort(-gain) < 0], candidates)",
  "    moved <- FALSE",
  "    for (i in cand) {",
  "      to <- which.min(D[i, ]); from <- a[i]",
  "      if (sum(a == from) - 1 < min_size) next",
  "      b <- a; b[i] <- to",
  "      trial <- fits; ok <- TRUE",
  "      for (k in c(from, to)) { f <- tryCatch(pos_fit(X[b == k, , drop = FALSE]), error = function(e) NULL); if (is.null(f)) { ok <- FALSE; break }; trial[[k]] <- f }",
  "      if (ok && pos_objective(trial) > obj + 1e-12) { a <- b; fits <- trial; obj <- pos_objective(trial); moved <- TRUE; moves <- moves + 1; break }",
  "    }",
  "    if (!moved || moves >= max_moves) break",
  "  }",
  "  list(assignment = a, fits = fits, objective = obj, moves = moves)",
  "}")

ps_pos <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (length(req$model$moderations)) stop("PLS-POS works on models without interaction terms.")
  if (!length(req$model$paths)) stop("PLS-POS needs a structural model (paths).")
  K <- as.integer(req$segments %||% 2); nrep <- as.integer(req$nrep %||% 5); seed <- as.integer(req$seed %||% 1)
  max_moves <- as.integer(req$maxMoves %||% 1000); cands <- as.integer(req$candidates %||% 10)
  if (K < 2 || K > 6 || nrep < 1 || nrep > 50 || max_moves < 1 || max_moves > 100000 || cands < 1 || cands > 100) stop("Invalid PLS-POS settings.")
  req$package <- "cSEM"
  b <- ps_pls_build(req)
  fit_line <- b$body[length(b$body)]
  body <- c(b$body[-length(b$body)],
    "# The global model (for comparison).", fit_line,
    sprintf("pos_estimate <- function(d) %s", sub("^fit <- ", "", sub("csem(data,", "csem(d,", fit_line, fixed = TRUE))),
    PS_POS_FUNCTIONS,
    "X <- as.matrix(data)",
    sprintf("min_size <- max(%d, ceiling(0.05 * nrow(X)))  # smallest segment: 5%% of the sample (at least the number of indicators)", ncol(b$inputs$data) + 1),
    sprintf("set.seed(%d)", seed),
    sprintf("runs <- lapply(seq_len(%d), function(r) pos_run(X, %d, min_size, %d, %d))", nrep, K, max_moves, cands),
    "best <- runs[[which.max(sapply(runs, `[[`, \"objective\"))]]")
  inputs <- b$inputs
  if (export) return(paste(ps_script(sprintf("PLS-POS, %d segments (cSEM)", K), "cSEM", inputs, body, c("table(best$assignment)", "lapply(best$fits, function(g) g$B)", "sapply(best$fits, function(g) g$r2)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  cv <- b$n$cv; back <- setNames(names(cv), unname(cv))
  best <- env$best
  global_r2 <- env$fit$Estimates$R2
  ps_json(list(k = K, n = nrow(env$X), objective = best$objective, globalObjective = sum(global_r2), moves = best$moves, starts = sapply(env$runs, `[[`, "objective"),
    assignment = best$assignment, globalR2 = as.list(setNames(unname(global_r2), unname(back[names(global_r2)]))),
    segments = lapply(seq_len(K), function(k) { g <- best$fits[[k]]
      list(segment = k, size = sum(best$assignment == k),
        paths = lapply(req$model$paths, function(p) list(from = p$from, to = p$to, est = g$B[cv[[p$to]], cv[[p$from]]])),
        r2 = as.list(setNames(unname(g$r2), unname(back[names(g$r2)])))) }),
    warnings = env$.warnings, engine = list(package = "cSEM (PLS-POS as Becker et al. 2013)", version = as.character(utils::packageVersion("cSEM")))))
}
