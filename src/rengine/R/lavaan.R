# PLS Studio <-> lavaan. Builds the lavaan script for the diagram (JSON
# request), runs it, and returns what the app's CB-SEM views need, with the
# user's names restored. ps_cb(req, export = TRUE) returns the script instead.
# All estimation is lavaan's; this file only writes code and shapes output.

#' "1*a + b + c": the marker loading fixed to 1, made explicit.
#' Loadings of a factor: the marker fixed to 1 (or to the user's value), other user-fixed loadings as value*name.
#' `free_first`: the first loading estimated as well (NA*), the scale being set elsewhere (a fixed path into the factor).
ps_marked <- function(v, fixed = list(), labels = list(), free_first = FALSE, label_mod = function(l) paste0(ps_label(l), "*")) {
  pre <- vapply(v, function(x) if (!is.null(fixed[[x]])) paste0(ps_num(fixed[[x]]), "*") else if (!is.null(labels[[x]])) label_mod(labels[[x]]) else "", "")
  # (a free first loading that is labelled is written twice, NA* frees it and the label names it: lavaan's way)
  if (isTRUE(free_first) && is.null(fixed[[v[1]]]) && nzchar(pre[1])) return(paste(c(paste0("NA*", v[1]), paste0(pre, v)), collapse = " + "))
  pre[1] <- if (nzchar(pre[1])) pre[1] else if (isTRUE(free_first)) "NA*" else "1*"
  paste(paste0(pre, v), collapse = " + ")
}

#' Standard errors as Mplus's WLSMV (Muthen, du Toit & Spisic 1997), the script lines that follow the fit:
#' since 0.7-2 lavaan puts the observed information (the Hessian) in the sandwich's bread for DWLS and ULS with
#' categorical data; Mplus, and lavaan up to 0.7-1, the expected one, (Delta' W Delta)^-1 (information.bread =
#' "expected" in the call), and Mplus divides the covariance matrix of the estimates by N where lavaan divides
#' by N - G (G groups). `fits`: the name of a list of fits (EFA) instead of one fit.
ps_mplus_se_lines <- function(fits = NULL) c(
  "# Standard errors as Mplus's WLSMV (Muthen, du Toit & Spisic 1997; lavaan up to 0.7-1): the expected information",
  "# in the sandwich (information.bread = \"expected\" above), and the covariance matrix of the estimates divided by N",
  "# where lavaan divides by N - G (G groups). z, p, intervals, standardised standard errors, defined parameters and",
  "# Wald tests follow from it; estimates and the test statistic are unchanged.",
  "mplus_se <- function(fit) {",
  "  if (is.null(fit@vcov$vcov)) return(fit)",
  "  k <- 1 - lavInspect(fit, \"ngroups\") / lavInspect(fit, \"ntotal\")",
  "  fit@vcov$vcov <- fit@vcov$vcov * k",
  "  fit@ParTable$se <- fit@ParTable$se * sqrt(k)",
  "  fit@Fit@se <- fit@Fit@se * sqrt(k)",
  "  fit",
  "}",
  if (is.null(fits)) "fit <- mplus_se(fit)" else sprintf("%s <- lapply(%s, mplus_se)", fits, fits))

#' Robust (MLR) standard errors of a two-level model with groups, the script lines that follow the fit. lavaan 0.7
#' weights each group's first-order (cluster-level) information by its share of the observations; the sandwich
#' over the clusters (Mplus's MLR) weights it by the group's share of the clusters. With one group the two agree.
#' The covariance matrix is rebuilt from lavaan's own information matrices with the clusters' shares.
PS_TWOLEVEL_GROUPS_SE <- c(
  "# Robust standard errors (MLR) with groups and clusters: the sandwich over all clusters, as Mplus. lavaan 0.7",
  "# weights each group's cluster-level first-order information by its share of the observations; here by its share",
  "# of the clusters. z, p, intervals and defined parameters follow; estimates and test statistics are unchanged.",
  "mlr_clusters <- function(fit) {",
  "  if (is.null(fit@vcov$vcov)) return(fit)",
  "  a <- list(lavmodel = fit@Model, lavsamplestats = fit@SampleStats, lavdata = fit@Data, lavcache = fit@Cache, lavimplied = fit@implied, lavh1 = fit@h1, lavoptions = fit@Options)",
  "  e_inv <- do.call(lavaan:::lav_model_info, c(a, list(extra = FALSE, augmented = TRUE, inverted = TRUE)))",
  "  b0 <- attr(do.call(lavaan:::lav_model_info_firstorder, c(a, list(extra = TRUE))), \"B0.group\")",
  "  J <- vapply(fit@Data@Lp, function(l) as.numeric(l$nclusters[[2]]), 0)",
  "  V <- e_inv %*% Reduce(`+`, lapply(seq_along(b0), function(g) b0[[g]] * J[g] / sum(J))) %*% e_inv / sum(J)",
  "  V <- V[seq_len(nrow(fit@vcov$vcov)), seq_len(ncol(fit@vcov$vcov)), drop = FALSE]",
  "  free <- fit@ParTable$free > 0",
  "  fit@vcov$vcov[] <- V",
  "  fit@ParTable$se[free] <- sqrt(diag(V))[fit@ParTable$free[free]]",
  "  fit@Fit@se[free] <- fit@ParTable$se[free]",
  "  fit",
  "}",
  "fit <- mlr_clusters(fit)")

#' The WLSMV conventions of a CB-SEM request: `args` for the lavaan call, `lines` after it.
#' Standard errors as Mplus's unless model$wlsmvSe is "lavaan" (lavaan 0.7's observed information in the sandwich);
#' with sampling clusters or weights lavaan's own (design-based) standard errors are kept. model$mimic = "Mplus":
#' Mplus's test statistic as well (lavaan's mimic = "Mplus", with gamma.vcov.mplus = FALSE). With groups mimic =
#' "Mplus" would also hold loadings and thresholds equal whenever group.equal is empty (a configural model), so
#' there the options it sets for the test statistic are written out instead (the same statistic, the model unchanged:
#' gamma.wls.mplus, gls.v11.mplus, information.expected.mplus, rmsea.scaled.mplus), the equalities being the request's.
ps_wlsmv_se <- function(req, ordinal, groups, design) {
  se <- req$model$wlsmvSe; mimic <- req$model$mimic
  if (!is.null(se) && !identical(se, "lavaan")) stop("Invalid WLSMV standard errors in the request.")
  if (!is.null(mimic) && !identical(mimic, "Mplus")) stop("Invalid test statistic in the request.")
  wlsmv <- ordinal && isTRUE(req$estimator %in% c("WLSMV", "ULSMV"))
  args <- ""
  # (both apply to WLSMV with ordinal indicators only; with another estimator they are kept for when it comes back)
  if (!is.null(mimic) && wlsmv) {
    args <- if (groups) ", gamma.wls.mplus = TRUE, gls.v11.mplus = TRUE, information.expected.mplus = TRUE, rmsea.scaled.mplus = TRUE, gamma.vcov.mplus = FALSE"
      else ", mimic = \"Mplus\", gamma.vcov.mplus = FALSE"
  }
  mplus <- wlsmv && is.null(se) && !design
  list(args = paste0(args, if (mplus) ", information.bread = \"expected\"" else ""), lines = if (mplus) ps_mplus_se_lines() else character(0))
}

#' ESEM blocks with invariant loadings, rotated jointly (Mplus ex. 5.26: the same two factors measured at two times, the
#' loadings equal across the blocks). lavaan rotates each efa() block on its own, so the rotated solution is written out
#' instead: each block's factors load on all the block's indicators, the k-th indicators of every block alike (labels),
#' the first block's factors with variance 1 and free correlations, the later blocks' variances and covariances free,
#' and the oblique geomin rotation of the stacked loadings as constraints, its stationarity conditions (Jennrich 2002:
#' the rotated loadings L, the gradient G of the criterion and the factor correlations Phi satisfy L'G = D Phi, D
#' diagonal; for the factors j and k, (L'G)_jk = (L'G)_jj Phi_jk). The maximum is the unrotated model's, and the
#' estimates and standard errors are the rotated solution's (the constrained information: the delta method through the
#' rotation). Mplus's geomin epsilon by default: 0.0001 for two factors, 0.001 for three, 0.01 for more.
ps_esem_invariant <- function(esem, n, lname) {
  rot <- esem$rotation %||% "geomin"
  if (!identical(rot, "geomin") || isTRUE(esem$orthogonal)) stop("Invariant ESEM blocks are rotated jointly by oblique geomin.")
  blocks <- lapply(esem$blocks, function(b) as.character(unlist(b)))
  if (length(blocks) < 2) stop("Invariant loadings need two or more ESEM blocks.")
  m <- length(blocks[[1]])
  if (any(lengths(blocks) != m) || m < 2) stop("Invariant ESEM blocks need the same number of factors (two or more).")
  if (any(!unlist(blocks) %in% n$cname) || anyDuplicated(unlist(blocks))) stop("Invalid ESEM block in the request.")
  inds <- lapply(blocks, function(fs) unique(unname(n$iv[unlist(n$inds[match(fs, n$cname)])])))
  p <- length(inds[[1]])
  if (any(lengths(inds) != p) || anyDuplicated(unlist(inds))) stop("Invariant ESEM blocks need the same number of indicators, each in one block (the k-th indicators of the blocks correspond).")
  eps <- esem$epsilon %||% (if (m == 2) 1e-4 else if (m == 3) 1e-3 else 1e-2)
  if (!(is.numeric(eps) && length(eps) == 1 && eps > 0 && eps <= 1)) stop("Invalid geomin epsilon in the request.")
  lab <- function(k, i) sprintf("lam%d_%d", k, i)
  lines <- "# ESEM blocks with invariant loadings (labels alike), rotated jointly: oblique geomin on the stacked loadings"
  # (the unrotated model, fitted first for the rotation: the first block's factors uncorrelated, the k-th factor's loadings
  #  on the first k - 1 indicators at 0)
  unrot <- "# the same blocks unrotated: the factors of the first block uncorrelated with variance 1, the loadings in echelon form"
  pairs <- utils::combn(m, 2)
  for (bi in seq_along(blocks)) {
    js <- match(blocks[[bi]], n$cname)
    for (k in seq_len(m)) {
      lines <- c(lines, sprintf("%s =~ NA*%s + %s", lname[[js[k]]], inds[[bi]][1], paste(sprintf("%s*%s", lab(k, seq_len(p)), inds[[bi]]), collapse = " + ")))
      unrot <- c(unrot, sprintf("%s =~ %s", lname[[js[k]]], paste(ifelse(seq_len(p) < k, sprintf("0*%s", inds[[bi]]), sprintf("%s%s*%s", ifelse(seq_len(p) == k, "NA*", ""), lab(k, seq_len(p)), inds[[bi]])), collapse = " + ")))
    }
    unrot <- sub("NA\\*(lam[0-9_]+)\\*", "NA*\\1*", unrot)
    if (bi == 1) {
      lines <- c(lines, sprintf("%s ~~ 1*%s", lname[js], lname[js]), sprintf("%s ~~ phi%d_%d*%s", lname[js[pairs[1, ]]], pairs[1, ], pairs[2, ], lname[js[pairs[2, ]]]))
      unrot <- c(unrot, sprintf("%s ~~ 1*%s", lname[js], lname[js]), sprintf("%s ~~ 0*%s", lname[js[pairs[1, ]]], lname[js[pairs[2, ]]]))
    } else {
      cov_lines <- c(sprintf("%s ~~ %s", lname[js], lname[js]), sprintf("%s ~~ %s", lname[js[pairs[1, ]]], lname[js[pairs[2, ]]]))
      lines <- c(lines, cov_lines); unrot <- c(unrot, cov_lines)
    }
  }
  # Geomin (m factors): Q = sum_i prod_k (l_ik^2 + eps)^(1/m); dQ/dl_ik is proportional to l_ik P_i^(1/m) / (l_ik^2 + eps).
  P <- vapply(seq_len(p), function(i) sprintf("(%s)^(1/%d)", paste(sprintf("(%s^2 + %s)", lab(seq_len(m), i), format(eps)), collapse = "*"), m), "")
  g <- function(k, i) sprintf("%s*%s/(%s^2 + %s)", lab(k, i), P[i], lab(k, i), format(eps))
  LG <- function(j, k) paste(sprintf("%s*%s", lab(j, seq_len(p)), vapply(seq_len(p), function(i) g(k, i), "")), collapse = " + ")
  phi <- function(j, k) sprintf("phi%d_%d", min(j, k), max(j, k))
  cons <- unlist(lapply(seq_len(m), function(j) lapply(setdiff(seq_len(m), j), function(k) sprintf("0 == %s - %s*(%s)", LG(j, k), phi(j, k), LG(j, j)))))
  within <- unlist(lapply(blocks, function(fs) { js <- match(fs, n$cname); c(sprintf("%s ~~ %s", lname[js[pairs[1, ]]], lname[js[pairs[2, ]]]), sprintf("%s ~~ %s", lname[js[pairs[2, ]]], lname[js[pairs[1, ]]])) }))
  list(lines = c(lines, sprintf("# the stationarity conditions of geomin (epsilon %s): (t(L) G)_jk = (t(L) G)_jj Phi_jk for every pair of factors j, k", format(eps)), cons),
    unrotated = unrot, within = within, in_block = unlist(blocks),
    # (lavaan names of the blocks' factors and indicators, for the rotation's script lines)
    factors = lapply(blocks, function(fs) unname(lname[match(fs, n$cname)])), indicators = inds, eps = eps, m = m,
    # (each factor of the first block's own indicators on the diagram: they set the order of the rotated factors)
    own = lapply(match(blocks[[1]], n$cname), function(j) unname(n$iv[n$inds[[j]]])))
}

#' Script lines between the unrotated fit and the rotated one: the joint geomin rotation of the stacked loadings (GPArotation,
#' oblique; the identity and 30 random starts, Mplus's number; the lowest criterion kept; each factor's loadings made to sum
#' to a positive number), and the rotated values as start values for the rotated model, from which it converges at once.
ps_esem_invariant_rotate <- function(inv) {
  q <- function(x) sprintf("c(%s)", paste(sprintf("\"%s\"", x), collapse = ", "))
  c("# The joint rotation: oblique geomin of the stacked loadings of every block (GPArotation), the best of 31 starts",
    sprintf("blocks_f <- list(%s)", paste(vapply(inv$factors, q, ""), collapse = ", ")),
    sprintf("blocks_y <- list(%s)", paste(vapply(inv$indicators, q, ""), collapse = ", ")),
    "E <- lavInspect(fit_unrotated, \"est\")",
    "A <- E$lambda[blocks_y[[1]], blocks_f[[1]], drop = FALSE]",
    "rot <- NULL",
    "for (k in 0:30) {",
    "  T0 <- if (k == 0) diag(ncol(A)) else { set.seed(k); qr.Q(qr(matrix(rnorm(ncol(A)^2), ncol(A)))) }",
    sprintf("  r <- GPArotation::GPFoblq(do.call(rbind, rep(list(A), length(blocks_f))), Tmat = T0, method = \"geomin\", methodArgs = list(delta = %s), eps = 1e-12, maxit = 10000)", format(inv$eps)),
    "  if (is.null(rot) || min(r$Table[, 2]) < min(rot$Table[, 2])) rot <- r",
    "}",
    "# The factors in the order of the diagram (each with its own indicators' loadings largest), the loadings summing positive",
    sprintf("own <- list(%s)", paste(vapply(inv$own, q, ""), collapse = ", ")),
    "L0 <- abs(A %*% t(solve(rot$Th)))",
    "perms <- function(v) if (length(v) <= 1) list(v) else unlist(lapply(seq_along(v), function(i) lapply(perms(v[-i]), function(p) c(v[i], p))), recursive = FALSE)",
    "fit_order <- function(o) sum(vapply(seq_along(o), function(k) sum(L0[rownames(L0) %in% own[[k]], o[k]]), 0))",
    "best_order <- Reduce(function(a, b) if (fit_order(b) > fit_order(a)) b else a, perms(seq_len(ncol(A))))",
    "Tm <- rot$Th[, best_order, drop = FALSE]",
    "Tm <- Tm %*% diag(sign(colSums(A %*% t(solve(Tm)))), ncol(A))",
    "L_rot <- A %*% t(solve(Tm))",
    "allf <- unlist(blocks_f); Tb <- kronecker(diag(length(blocks_f)), Tm)",
    "P_rot <- t(Tb) %*% E$psi[allf, allf] %*% Tb; dimnames(P_rot) <- list(allf, allf)",
    "start_rot <- parTable(fit_unrotated)[, c(\"lhs\", \"op\", \"rhs\", \"est\")]",
    "set_start <- function(lhs, op, rhs, v) {",
    "  i <- which(start_rot$lhs == lhs & start_rot$op == op & start_rot$rhs == rhs)",
    "  if (!length(i)) i <- which(start_rot$lhs == rhs & start_rot$op == op & start_rot$rhs == lhs)",
    "  if (length(i)) start_rot$est[i] <<- v else start_rot <<- rbind(start_rot, data.frame(lhs = lhs, op = op, rhs = rhs, est = v))",
    "}",
    "for (b in seq_along(blocks_f)) for (k in seq_along(blocks_f[[b]])) for (i in seq_along(blocks_y[[b]])) set_start(blocks_f[[b]][k], \"=~\", blocks_y[[b]][i], L_rot[i, k])",
    "for (a in seq_along(allf)) for (b in seq_len(a)) set_start(allf[a], \"~~\", allf[b], P_rot[a, b])")
}

ps_cb_build <- function(req) {
  cons <- req$model$constructs
  # Identification of the factors: a marker indicator (the default), or unit factor variances (the first
  # loading free; the caller then fits with std.lv = TRUE: Bayesian SEM, whose chains mix better that way).
  unit_id <- identical(req$model$identification, "unit")
  n <- ps_names(cons)
  k0 <- length(cons)
  comps <- lapply(cons, function(c) as.character(unlist(c$components)))
  is_cov <- vapply(cons, function(c) isTRUE(c$covariate), TRUE)
  # lavaan name of each construct: an observed covariate is its own indicator.
  lname <- unname(n$cv)
  lname[is_cov] <- unname(n$iv[vapply(n$inds[is_cov], `[`, "", 1)])
  names(lname) <- n$cname
  matrix_input <- !is.null(req$data$moments)
  mods <- req$model$moderations
  if (matrix_input && length(mods)) stop("Latent interactions need raw data (product indicators); this dataset is a covariance matrix.")
  if (matrix_input && req$estimator == "MLR") stop("MLR needs raw data; with a covariance matrix use MLM or MLMV (with NACOV), ML, GLS or ULS.")

  body <- "suppressPackageStartupMessages(library(lavaan))"
  inputs <- list()
  group_var <- NULL; cluster_var <- NULL; weight_var <- NULL; complex_var <- NULL
  mg <- req$model$multigroup
  ml <- req$model$multilevel
  matrix_groups <- matrix_input && !is.null(mg) && !is.null(req$data$moments$groups)
  if (matrix_input && !is.null(mg) && !matrix_groups) stop("Multiple-group analysis needs raw data with a grouping column, or one covariance matrix per group.")
  if (matrix_input) {
    mo <- req$data$moments
    if (!all(n$all_inds %in% req$data$names)) stop("Indicator(s) not in the covariance matrix: ", paste(setdiff(n$all_inds, req$data$names), collapse = ", "))
    pick <- function(S) {
      dimnames(S) <- list(req$data$names, req$data$names)
      S <- S[n$all_inds, n$all_inds, drop = FALSE]
      dimnames(S) <- list(unname(n$iv[n$all_inds]), unname(n$iv[n$all_inds]))
      S
    }
    # The variables' means, when the matrix carries them (a mean structure can then be estimated: lavaan's sample.mean).
    pick_m <- function(m) { m <- as.numeric(unlist(m)); names(m) <- req$data$names; m <- m[n$all_inds]; names(m) <- unname(n$iv[n$all_inds]); m }
    if (matrix_groups) {
      # A stacked model: one matrix per group (lavaan takes a named list, the names as group labels).
      if (!is.null(mo$nacov)) stop("A NACOV matrix is not available with several groups.")
      labels <- vapply(mo$groups, function(g) as.character(g$label), "")
      inputs$S <- setNames(lapply(mo$groups, function(g) pick(g$S)), labels)
      inputs$N <- vapply(mo$groups, function(g) as.numeric(g$n), 0)
      if (all(vapply(mo$groups, function(g) !is.null(g$means), TRUE))) inputs$M <- setNames(lapply(mo$groups, function(g) pick_m(g$means)), labels)
    } else {
      inputs$S <- pick(mo$S)
      inputs$N <- mo$n
      if (!is.null(mo$means)) inputs$M <- pick_m(mo$means)
    }
    robust_nacov <- req$estimator %in% c("MLM", "MLMV", "WLS") && !is.null(mo$nacov)
    if (robust_nacov) {
      # NACOV arrives in the file's column-major vech order; keep the model's variables, in vech order.
      p0 <- length(req$data$names)
      pos <- function(i, j) { hi <- max(i, j); lo <- min(i, j); (lo - 1) * p0 - (lo - 1) * (lo - 2) / 2 + (hi - lo) + 1 }
      idx <- match(n$all_inds, req$data$names); pk <- length(idx)
      pr <- do.call(rbind, lapply(seq_len(pk), function(j) cbind(j:pk, j)))
      at <- apply(pr, 1, function(r) pos(idx[r[1]], idx[r[2]]))
      inputs$NACOV <- unname(mo$nacov[at, at, drop = FALSE])
    }
  } else {
    inputs$data <- ps_frame(req, n)
    # Multiple groups: the grouping column travels with the data under a name no indicator has.
    if (!is.null(mg)) {
      at <- match(mg$column, req$data$names)
      if (is.na(at)) stop("The grouping column is not in the dataset.")
      cols <- req$data$cols
      gcol <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
      group_var <- ps_ident(c(unname(n$iv), mg$column))[length(n$iv) + 1]
      inputs$data[[group_var]] <- gcol
    }
    # Two-level models: the cluster column, likewise.
    if (!is.null(ml)) {
      at <- match(ml$column, req$data$names)
      if (is.na(at)) stop("The cluster column is not in the dataset.")
      cols <- req$data$cols
      ccol <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
      cluster_var <- ps_ident(c(unname(n$iv), ml$column))[length(n$iv) + 1]
      inputs$data[[cluster_var]] <- ccol
    }
    # Sampling clusters of a complex design (lavaan's cluster = in a single-level model): likewise.
    kcol <- req$model$cluster
    if (!is.null(kcol)) {
      if (!is.null(ml)) stop("Sampling clusters (cluster-robust standard errors) and a two-level model are alternatives.")
      at <- match(kcol, req$data$names)
      if (is.na(at)) stop("The cluster column is not in the dataset.")
      cols <- req$data$cols
      kv <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
      if (length(unique(kv[is.finite(kv)])) < 2) stop("The cluster column needs at least two clusters.")
      complex_var <- ps_ident(c(unname(n$iv), kcol))[length(n$iv) + 1]
      inputs$data[[complex_var]] <- kv
    }
    # Sampling (survey) weights: the column, likewise (lavaan's sampling.weights).
    wcol <- req$model$weights
    if (!is.null(wcol)) {
      at <- match(wcol, req$data$names)
      if (is.na(at)) stop("The sampling-weights column is not in the dataset.")
      cols <- req$data$cols
      wv <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
      if (any(!is.finite(wv) | wv < 0)) stop("Sampling weights must be non-negative numbers without missing values.")
      weight_var <- ps_ident(c(unname(n$iv), wcol))[length(n$iv) + 1]
      inputs$data[[weight_var]] <- wv
    }
    body <- c(body, ps_missing_code(req$missing))
  }

  lines <- character(0)
  # ESEM blocks: every factor of a block loads on all the block's indicators (lavaan efa()), rotated.
  esem <- req$model$esem
  # jsonlite turns equal-length blocks into a matrix (one row per block).
  if (is.matrix(esem$blocks)) esem$blocks <- lapply(seq_len(nrow(esem$blocks)), function(i) esem$blocks[i, ])
  in_block <- character(0)
  target <- NULL
  # Blocks with invariant loadings (Mplus ex. 5.26: f1-f2 BY y1-y6 (*t1 1); f3-f4 BY y7-y12 (*t2 1)): ps_esem_invariant writes
  # them out as factors whose loadings are labelled alike, rotated jointly by geomin's stationarity conditions.
  inv <- NULL
  if (isTRUE(esem$invariant)) {
    inv <- ps_esem_invariant(esem, n, lname)
    lines <- c(lines, inv$lines); in_block <- inv$in_block
    esem$blocks <- list()
    if (any(vapply(req$model$paths, function(p) any(c(p$from, p$to) %in% in_block), TRUE)) || length(mods) || !is.null(req$model$multigroup) || !is.null(req$model$multilevel))
      stop("Invariant ESEM blocks are available for a measurement model in one group: no paths to or from their factors, no groups or clusters.")
  }
  for (bi in seq_along(esem$blocks)) {
    fs <- unlist(esem$blocks[[bi]])
    if (length(fs) < 2 || any(!fs %in% n$cname)) stop("Invalid ESEM block in the request.")
    js <- match(fs, n$cname)
    inds <- unique(unname(n$iv[unlist(n$inds[js])]))
    lines <- c(lines, sprintf("%s =~ %s", paste(sprintf("efa(\"b%d\")*%s", bi, lname[js]), collapse = " + "), paste(inds, collapse = " + ")))
    in_block <- c(in_block, fs)
    if (identical(esem$rotation, "target")) {
      # Target: each factor's own indicators free (NA), the others towards 0.
      target <- matrix(0, length(inds), length(js), dimnames = list(inds, unname(lname[js])))
      for (k in seq_along(js)) target[unname(n$iv[n$inds[[js[k]]]]), k] <- NA
    }
  }
  if (length(esem$blocks)) {
    rot <- esem$rotation %||% "geomin"
    if (!rot %in% c("geomin", "oblimin", "quartimin", "varimax", "target", "bigeomin", "biquartimin")) stop("Invalid rotation in the request.")
    # Bifactor rotations (Jennrich & Bentler 2011, 2012; Mplus BI-GEOMIN, BI-QUARTIMIN): a general factor,
    # the block's first, and specific factors; oblique by default (the specific factors correlate, the
    # general factor with none of them), or orthogonal (Mplus's BI-GEOMIN(ORTHOGONAL)).
    bifactor <- rot %in% c("bigeomin", "biquartimin")
    if (bifactor && any(lengths(lapply(esem$blocks, unlist)) < 3)) stop("A bifactor rotation needs a general and at least two specific factors in each ESEM block.")
    orth <- isTRUE(esem$orthogonal)
    if (orth && rot %in% c("varimax", "target")) stop("Invalid orthogonal option for this rotation in the request.")
    # geomin's epsilon (lavaan 0.001; Mplus 0.0001 for two factors, 0.001 for three, 0.01 for four or more)
    eps <- esem$epsilon
    if (!is.null(eps) && !(is.numeric(eps) && length(eps) == 1 && eps > 0 && eps <= 1)) stop("Invalid geomin epsilon in the request.")
    if (!is.null(target)) inputs$TARGET <- target
  }
  rel_inds <- character(0); free_err_inds <- character(0); composites <- character(0)
  # Ordinal indicators (lavaan names), the parameterisation, and the constructs whose variance is given (parameters).
  ord_iv <- unname(n$iv[intersect(unlist(req$model$ordered), n$all_inds)])
  if (!is.null(req$model$parameterization) && !identical(req$model$parameterization, "theta")) stop("Invalid parameterization in the request.")
  theta <- identical(req$model$parameterization, "theta")
  var_set <- unlist(lapply(req$model$parameters, function(t) if (identical(t$kind, "variance") && !isTRUE(t$indicator)) t$target))
  # Values per group (lavaan c(...)): a number holds the parameter, a name labels it, null (NA) leaves it free.
  n_groups <- if (matrix_groups) length(inputs$S) else if (!is.null(group_var)) length(unique(inputs$data[[group_var]][is.finite(inputs$data[[group_var]])])) else 1
  ps_mod <- function(t) {
    if (!is.null(t$byGroup)) {
      vals <- t$byGroup
      if (n_groups < 2 || length(vals) != n_groups) stop("Values per group need one value per group.")
      return(sprintf("c(%s)*", paste(vapply(vals, function(x) if (is.null(x) || (length(x) == 1 && is.na(x))) "NA" else if (is.character(x)) ps_label(x) else ps_num(x), ""), collapse = ", ")))
    }
    # (one label for every group, written once per group: lavaan's way to say "equal across the groups")
    if (!is.null(t$fixed)) paste0(ps_num(t$fixed), "*") else if (!is.null(t$label)) ps_group_label(t$label) else ""
  }
  # (not in a two-level model with groups: it is written once per "group:" block, where a label is a plain label)
  ps_group_label <- function(l) if (n_groups > 1 && is.null(req$model$multilevel)) sprintf("c(%s)*", paste(rep(ps_label(l), n_groups), collapse = ", ")) else paste0(ps_label(l), "*")
  # Indicators that load on several factors outside ESEM blocks (Mplus ex. 5.18, 5.19: twin A, C and E factors). A factor
  # of one such indicator is a factor of its own, not the variable: its residual variance is the model's to set.
  fac_j <- which(!is_cov & !(n$cname %in% in_block) & vapply(seq_len(k0), function(j) !length(comps[[j]]) && !identical(cons[[j]]$type, "composite"), TRUE))
  fac_iv <- unlist(lapply(fac_j, function(j) unname(n$iv[n$inds[[j]]])))
  shared_iv <- unique(fac_iv[duplicated(fac_iv)])
  # An ordinal mediator whose predictors include another outcome, in the delta parameterisation (Mplus: u2 ON u1 x1;
  # u3 ON u2, the u's categorical): its construct is the whole latent response, whose variance given the covariates
  # is 1, so the disturbance would be 1 minus the variance of what the other outcomes explain, a non-linear
  # function of the model. lavaan imposes exactly that for an ordinal variable regressed in the syntax, so the
  # variable stands for itself there (the construct's lavaan name is the variable's, as an observed covariate's).
  ord_self <- vapply(seq_len(k0), function(j) {
    if (is_cov[j] || theta || length(mods) || length(n$inds[[j]]) != 1 || length(comps[[j]]) || n$cname[j] %in% in_block || identical(cons[[j]]$type, "composite")) return(FALSE)
    v <- unname(n$iv[[n$inds[[j]][1]]])
    if (!(v %in% ord_iv) || v %in% shared_iv || !is.null(cons[[j]]$reliability) || isTRUE(cons[[j]]$freeError) || n$cname[j] %in% var_set) return(FALSE)
    from <- vapply(req$model$paths, function(p) if (identical(p$to, n$cname[j])) p$from else NA_character_, "")
    from <- from[!is.na(from)]
    length(from) > 0 && n$cname[j] %in% vapply(req$model$paths, function(p) p$from, "") && any(!is_cov[match(from, n$cname)] %in% TRUE)
  }, TRUE)
  lname[ord_self] <- unname(n$iv[vapply(n$inds[ord_self], `[`, "", 1)])
  for (j in seq_len(k0)) {
    if (is_cov[j] || ord_self[j] || n$cname[j] %in% in_block) next
    # The first loading of each factor is fixed to 1 (marker / scaling indicator); written explicitly.
    if (length(comps[[j]])) {
      # Component loadings held at values (a latent curve: 1, 1, 1 and 0, 1, 2), keyed by the components' lavaan names.
      cl <- cons[[j]]$componentLoadings %||% list()
      fixed_c <- setNames(cl, unname(lname[names(cl)]))
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(lname[comps[[j]]], fixed_c, free_first = isTRUE(cons[[j]]$markerFree) || unit_id)))
    }
    else {
      v <- unname(n$iv[n$inds[[j]]])
      fl <- cons[[j]]$fixedLoadings %||% list()
      fixed <- setNames(fl, unname(n$iv[names(fl)]))
      ll <- cons[[j]]$loadingLabels %||% list()
      # The marker's 1 is fixed: a label on it would have no effect. With the scale from the variance, there is no marker.
      by_variance <- identical(cons[[j]]$scaling, "variance")
      if (!is.null(cons[[j]]$scaling) && !by_variance) stop("Invalid factor scaling in the request.")
      if (!by_variance) ll <- ll[names(ll) != n$inds[[j]][1]]
      labels <- setNames(ll, unname(n$iv[names(ll)]))
      if (identical(cons[[j]]$type, "composite")) {
        # A composite (emergent variable): an exact weighted sum of its indicators, which covary freely
        # (lavaan >= 0.6-20 composites; the first weight fixed to 1, the composite has no disturbance).
        if (length(v) < 2) stop("A composite needs at least two indicators.")
        if (length(fl) || length(ll)) stop("Composite weights cannot be fixed or labelled.")
        lines <- c(lines, paste(lname[[j]], "<~", ps_marked(v)))
        composites <- c(composites, n$cname[j])
        next
      }
      # (a label written once per group: lavaan's way to hold a loading equal across groups, without its warning)
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(v, fixed, labels, free_first = unit_id || by_variance, label_mod = ps_group_label)))
      # The factor's scale from its variance (Mplus f BY y1* …; f@1): every loading estimated, the variance 1.
      if (by_variance && !unit_id && !(n$cname[j] %in% var_set)) lines <- c(lines, paste0(lname[[j]], " ~~ 1*", lname[[j]], "   # scale: the variance fixed at 1, every loading estimated"))
      # Known reliability (Bollen 1989; Hayduk 1987): error variance fixed at (1 - reliability) x the indicator's variance.
      # With several groups, each group's own variance (Hayduk 1987, ch. 9: the stacked model fixes each group's error variance).
      fix_theta <- function(vi, rel, what) {
        rel <- ps_number(rel, "reliability")
        if (rel <= 0 || rel > 1) stop("A reliability must be above 0 and at most 1.")
        s2 <- if (matrix_groups) vapply(inputs$S, function(M) M[vi, vi], 0)
          else if (matrix_input) inputs$S[vi, vi]
          else if (!is.null(group_var)) vapply(split(inputs$data[[vi]], inputs$data[[group_var]]), stats::var, 0, na.rm = TRUE)
          else stats::var(inputs$data[[vi]], na.rm = TRUE)
        if (!all(is.finite(s2))) stop("The variance of ", vi, " cannot be computed.")
        rel_inds <<- c(rel_inds, vi)
        theta <- if (length(s2) > 1) sprintf("c(%s)", paste(vapply((1 - rel) * s2, ps_num, ""), collapse = ", ")) else ps_num((1 - rel) * s2)
        sprintf("%s ~~ %s*%s   # %s, reliability %s: (1 - %s) x variance %s", vi, theta, vi, what, format(rel), format(rel), paste(format(signif(s2, 6)), collapse = " / "))
      }
      if (length(v) == 1 && !(v %in% shared_iv)) {
        rel <- cons[[j]]$reliability
        if (isTRUE(cons[[j]]$freeError)) { free_err_inds <- c(free_err_inds, v); lines <- c(lines, paste0(v, " ~~ NA*", v, "   # single indicator: error variance estimated (identified by the model)")) }
        else if (is.null(rel) && v %in% ord_iv) {
          # An ordinal variable on its own: the construct is its latent response, whose variance is 1 (delta
          # parameterisation; lavaan has no residual variance to fix for it). Explained, or with theta: lavaan's own.
          if (!(n$cname[j] %in% vapply(req$model$paths, function(p) p$to, "")) && !theta && !(n$cname[j] %in% var_set))
            lines <- c(lines, paste0(lname[[j]], " ~~ 1*", lname[[j]], "   # an ordinal variable: its latent response has variance 1"))
          # An ordinal outcome that predicts nothing (a probit regression, Mplus's u ON x): the construct is the systematic
          # part of the latent response, its disturbance fixed at 0 (the response's residual variance is set by the
          # parameterisation, 1 given the predictors); left free it is not identified (one parameter too many).
          else if (n$cname[j] %in% vapply(req$model$paths, function(p) p$to, "") && !(n$cname[j] %in% vapply(req$model$paths, function(p) p$from, "")) &&
            !length(req$model$moderations) && !(n$cname[j] %in% var_set))
            lines <- c(lines, paste0(lname[[j]], " ~~ 0*", lname[[j]], "   # an ordinal outcome: the systematic part of its latent response (probit regression)"))
          # An ordinal outcome that predicts others (Mplus ex. 3.12: u3 ON u1 u2 x2): the construct is the whole latent
          # response, which the others regress on, so the indicator has no residual of its own and the construct's
          # disturbance is the response's residual variance given its predictors, 1 (theta; delta with covariates
          # as the only predictors, whose conditional variance the delta parameterisation sets to 1).
          else if (n$cname[j] %in% vapply(req$model$paths, function(p) p$to, "") && !length(req$model$moderations) && !(n$cname[j] %in% var_set) &&
            (theta || all(vapply(req$model$paths, function(p) !identical(p$to, n$cname[j]) || isTRUE(is_cov[match(p$from, n$cname)]), TRUE))))
            lines <- c(lines, if (theta) paste0(v, " ~~ 0*", v, "   # an ordinal outcome that predicts others: the construct is its whole latent response"),
              paste0(lname[[j]], " ~~ 1*", lname[[j]], "   # an ordinal outcome that predicts others: the residual variance of its latent response, 1 given its predictors"))
        }
        else if (is.null(rel)) lines <- c(lines, paste0(v, " ~~ 0*", v, "   # single indicator: no measurement error"))
        else lines <- c(lines, fix_theta(v, rel, "single indicator"))
      } else {
        rels <- cons[[j]]$reliabilities %||% list()
        for (ind in names(rels)) if (ind %in% n$inds[[j]]) lines <- c(lines, fix_theta(unname(n$iv[[ind]]), rels[[ind]], "known reliability"))
      }
    }
  }
  if (any(vapply(seq_len(k0), function(j) identical(cons[[j]]$type, "composite") && length(comps[[j]]) > 0, TRUE)) ||
      any(unlist(comps) %in% composites)) stop("Composites cannot be higher-order constructs or their components in CB-SEM.")
  if (any(vapply(cons, function(c) identical(c$type, "composite"), TRUE) & n$cname %in% in_block)) stop("Composites cannot be in an ESEM block.")
  if (length(composites)) {
    if (!is.null(mg) || !is.null(ml)) stop("Composites are not available in multiple-group or two-level models.")
    if (length(mods)) stop("Composites are not available with latent interactions.")
    if (identical(req$missing, "mi") || identical(req$estimator, "RML")) stop("Composites are not available with multiple imputation or robust ML (rsem).")
    if (any(unlist(req$model$ordered) %in% unlist(n$inds[match(composites, n$cname)]))) stop("Composite indicators cannot be ordinal.")
  }
  paths <- req$model$paths
  int_names <- character(0); int_l <- character(0); prod <- list()
  # Latent interactions: product indicators (lavaan), or LMS / QML (modsem), which model X:Z directly.
  method <- req$interaction %||% "product"
  use_modsem <- length(mods) > 0 && method %in% c("lms", "qml")
  if (use_modsem && (matrix_input || !is.null(mg) || length(esem$blocks))) stop("LMS and QML need raw data and a single-group model without ESEM blocks.")
  if (use_modsem && !is.null(complex_var)) stop("Cluster-robust standard errors are not available with LMS / QML; use product indicators.")
  if (length(mods) && !use_modsem) body <- c(body, "# Latent interactions: matched-pair products of mean-centred indicators (Marsh, Wen & Hau 2004)")
  for (q in seq_along(mods)) {
    m <- mods[[q]]
    if (use_modsem) {
      nm <- ps_int_name(m$from, m$moderator)
      lname[[nm]] <- paste0(lname[[m$from]], ":", lname[[m$moderator]])
      paths <- c(paths, list(list(from = nm, to = m$to)))
      int_names <- c(int_names, nm); int_l <- c(int_l, lname[[nm]])
      next
    }
    xi <- unname(n$iv[n$inds[[match(m$from, n$cname)]]]); mi <- unname(n$iv[n$inds[[match(m$moderator, n$cname)]]])
    pn <- character(0)
    for (i in seq_len(min(length(xi), length(mi)))) {
      v <- paste0(xi[i], "_x_", mi[i])
      body <- c(body, sprintf("data$%s <- (data$%s - mean(data$%s)) * (data$%s - mean(data$%s))", v, xi[i], xi[i], mi[i], mi[i]))
      pn <- c(pn, v)
      prod[[v]] <- paste0(n$inds[[match(m$from, n$cname)]][i], "×", n$inds[[match(m$moderator, n$cname)]][i])
    }
    nm <- ps_int_name(m$from, m$moderator)
    il <- paste0(lname[[m$from]], "_x_", lname[[m$moderator]])
    lines <- c(lines, paste(il, "=~", ps_marked(pn)))
    paths <- c(paths, list(list(from = nm, to = m$to)))
    lname[[nm]] <- il
    int_names <- c(int_names, nm); int_l <- c(int_l, il)
  }
  to <- unique(vapply(paths, `[[`, "", "to"))
  # A fixed coefficient is written as value*predictor (lavaan holds it at that value).
  for (t in to) {
    ps <- Filter(function(p) p$to == t, paths)
    rhs <- vapply(ps, function(p) paste0(if (!is.null(p$fixed)) paste0(ps_num(p$fixed), "*") else if (!is.null(p$label)) paste0(ps_label(p$label), "*") else "", lname[[p$from]]), "")
    lines <- c(lines, paste(lname[[t]], "~", paste(rhs, collapse = " + ")))
  }
  # Direct effects on indicators (Mplus y1 ON x1), beside their loadings.
  for (ip in req$model$indicatorPaths) {
    if (!(ip$to %in% n$all_inds) || !(ip$from %in% n$cname)) stop("Unknown construct or indicator in a direct effect.")
    lines <- c(lines, paste(n$iv[[ip$to]], "~", paste0(if (!is.null(ip$fixed)) paste0(ps_num(ip$fixed), "*") else if (!is.null(ip$label)) ps_group_label(ip$label) else "", lname[[ip$from]])))
  }
  seen <- character(0)
  for (cv in req$model$covariances) {
    a <- if (cv$kind == "construct") lname[[cv$a]] else n$iv[[cv$a]]
    b <- if (cv$kind == "construct") lname[[cv$b]] else n$iv[[cv$b]]
    key <- paste(sort(c(a, b)), collapse = "~~")
    if (key %in% seen) next  # lavaan rejects a covariance listed twice (in either order)
    seen <- c(seen, key)
    # A fixed zero makes two exogenous factors uncorrelated (lavaan frees them by default).
    lines <- c(lines, paste(a, "~~", if (isTRUE(cv$zero)) paste0("0*", b) else if (!is.null(cv$byGroup)) paste0(ps_mod(cv), b) else if (!is.null(cv$fixed)) paste0(ps_num(cv$fixed), "*", b)
      else if (!is.null(cv$label)) paste0(ps_label(cv$label), "*", b) else b))
  }
  # Variances, intercepts of indicators, thresholds and scale factors held at values or labelled (Mplus f1@1;
  # y1-y3 (ve1-ve3); [y1a y1b y1c] (1); [u1$1] (t); {u1@1}), per group when given so; `free`: written out (NA*),
  # which frees what lavaan fixes by default (an ordinal indicator's scale factor, or its residual variance with theta).
  for (t in req$model$parameters) {
    if (!(is.character(t$kind) && length(t$kind) == 1 && t$kind %in% c("variance", "intercept", "threshold", "scale"))) stop("Invalid parameter in the request.")
    tgt <- if (isTRUE(t$indicator)) { if (!t$target %in% n$all_inds) stop("Unknown indicator in a parameter."); unname(n$iv[[t$target]]) }
      else { if (!identical(t$kind, "variance") || !t$target %in% n$cname) stop("Unknown construct in a parameter."); lname[[t$target]] }
    mod <- ps_mod(t)
    if (!nzchar(mod) && isTRUE(t$free)) mod <- "NA*"
    if (!nzchar(mod)) next
    if (identical(t$kind, "scale") && (!tgt %in% ord_iv || theta)) stop("A scale factor belongs to an ordinal indicator in the delta parameterisation.")
    lines <- c(lines, switch(t$kind,
      variance = paste0(tgt, " ~~ ", mod, tgt),
      scale = paste0(tgt, " ~*~ ", mod, tgt),
      intercept = paste0(tgt, " ~ ", mod, "1"),
      threshold = { k <- t$threshold %||% 1; if (!(is.numeric(k) && length(k) == 1 && k >= 1 && k == round(k))) stop("Invalid threshold number in the request.")
        if (!tgt %in% ord_iv) stop("A threshold belongs to an ordinal indicator."); paste0(tgt, " | ", mod, "t", k) }))
  }
  # The mean structure (the constant on the canvas): every indicator intercept is free (lavaan's default
  # under meanstructure = TRUE). A drawn arrow is a latent mean, identified by fixing the marker
  # indicator's intercept at 0 (the latent mean is then in the marker's units), or an observed
  # variable's intercept; fixed at a value or labelled when asked.
  means_on <- isTRUE(req$model$meanStructure)
  if (means_on) {
    if (matrix_input && is.null(inputs$M)) stop("Means and intercepts need the variables' means: this covariance matrix carries none.")
    if (!is.null(ml)) stop("Means and intercepts are not available in a two-level model here.")
    n_groups <- if (matrix_groups) length(inputs$S) else if (!is.null(group_var)) length(unique(inputs$data[[group_var]][is.finite(inputs$data[[group_var]])])) else 1
    for (mt in req$model$means) {
      j <- match(mt$construct, n$cname)
      if (is.na(j)) stop("Unknown construct in a mean term.")
      lv <- lname[[mt$construct]]
      # (values per group: c(NA, 0)*1 holds the mean in a reference group, which identifies it; no marker rule then)
      term <- if (!is.null(mt$byGroup)) paste0(ps_mod(mt), "1") else if (!is.null(mt$fixed)) paste0(ps_num(mt$fixed), "*1") else if (!is.null(mt$label)) paste0(ps_group_label(mt$label), "1") else "1"
      lines <- c(lines, paste(lv, "~", term))
      # (a higher-order factor's mean is identified by its components' fixed intercepts: no marker rule here)
      if (is.null(mt$fixed) && is.null(mt$byGroup) && !is_cov[j] && !ord_self[j] && length(n$inds[[j]]) && !length(comps[[j]])) {
        # The marker's intercept: 0 identifies the latent mean in the marker's units; a known measurement bias instead
        # (Hayduk 1987, ch. 9: the indicator reads the concept plus this much), one value per group when given so.
        bias <- unlist(mt$bias)
        if (is.null(bias)) at <- "0"
        else {
          bias <- vapply(bias, ps_number, 0, "bias")
          if (length(bias) > 1 && length(bias) != n_groups) stop("A marker intercept per group needs one value per group.")
          at <- if (length(bias) > 1) sprintf("c(%s)", paste(vapply(bias, ps_num, ""), collapse = ", ")) else ps_num(bias)
        }
        # (two factors with the same marker, e.g. a growth model's intercept and slope: its intercept is fixed once)
        if (!any(startsWith(lines, paste0(n$iv[[n$inds[[j]][1]]], " ~ ", at, "*1"))))
        lines <- c(lines, paste0(n$iv[[n$inds[[j]][1]]], " ~ ", at, "*1   # marker intercept fixed", if (is.null(bias)) " at 0: identifies" else " at a known bias: identifies", " the latent mean of ", lv))
      }
    }
  }
  # An observed variable drawn as an error-free single indicator stands for itself: its intercept belongs to
  # the construct (the indicator's fixed at 0), so the construct equals the variable and the intercept of an
  # equation that it predicts is that of the observed regression (as lavaan and Mplus give for observed
  # variables). Equivalent fit. (One group only: with groups, equal intercepts across groups are the indicators'.)
  obs_single <- character(0)
  if (means_on && is.null(group_var) && !matrix_groups) {
    drawn <- vapply(req$model$means, function(mt) mt$construct, "")
    for (j in seq_len(k0)) {
      if (is_cov[j] || length(n$inds[[j]]) != 1 || length(comps[[j]]) || n$cname[j] %in% drawn) next
      ov <- unname(n$iv[[n$inds[[j]][1]]])
      if (ov %in% shared_iv) next
      # (an ordinal variable's location is its thresholds: no intercept of its own)
      if (ov %in% rel_inds || ov %in% free_err_inds || ov %in% ord_iv) next
      lines <- c(lines, paste0(lname[[j]], " ~ 1"), paste0(ov, " ~ 0*1   # the intercept of ", lname[[j]], " (an observed variable)"))
      obs_single[unname(lname[[j]])] <- ov
    }
  }
  # Defined parameters (functions of labelled parameters, with delta-method standard errors).
  defs <- vapply(req$model$defined, function(d) paste(ps_label(d$name), ":=", ps_expr(d$expr)), "")
  # Inequality constraints on labelled parameters (each side checked as an expression).
  # Equality constraints on labelled and defined parameters (lavaan ==; Mplus MODEL CONSTRAINT: rel5 = rel2).
  defs <- c(defs, vapply(unlist(req$model$equalities), function(h) {
    parts <- strsplit(h, "==", fixed = TRUE)[[1]]
    if (length(parts) != 2) stop("Invalid equality constraint in the request.")
    paste(ps_expr(trimws(parts[1])), "==", ps_expr(trimws(parts[2])))
  }, ""))
  defs <- c(defs, vapply(unlist(req$model$inequalities), function(h) {
    op <- regmatches(h, regexpr("[<>]", h))
    parts <- strsplit(h, "[<>]")[[1]]
    if (length(op) != 1 || length(parts) != 2 || grepl("=", h, fixed = TRUE)) stop("Invalid inequality in the request.")
    paste(ps_expr(trimws(parts[1])), op, ps_expr(trimws(parts[2])))
  }, ""))
  # (In a two-level model they follow the level blocks: defined once, not per level.)
  if (is.null(cluster_var)) lines <- c(lines, defs)
  between_cov <- character(0); between_lv <- character(0)
  # Two-level: the model within clusters; between clusters the same structure (factors named *_b),
  # a saturated model (all variances and covariances of the observed variables free), or the factors
  # (same indicators, *_b) regressed on cluster-level covariates (lavaan's tutorial: fb =~ y1 + y2 + y3; fb ~ w1 + w2).
  if (!is.null(cluster_var)) {
    if (!(ml$between %||% "saturated") %in% c("same", "saturated", "factors", "model")) stop("Invalid between-level model in the request.")
    if (identical(ml$between, "model")) {
      # The between level as written (two-level syntax, lavaan's level: 2 block; Mplus %BETWEEN%): its variables are
      # the diagram's observed variables, other data columns (cluster-level ones join the data under their own names)
      # and the between-level factors defined there (=~), under names no other variable has.
      sts <- ml$betweenModel
      if (!length(sts)) stop("The between-level model has no statements.")
      ok_name <- function(x) is.character(x) && length(x) == 1 && grepl("^[A-Za-z_.][A-Za-z0-9_.]*$", x)
      fac_b <- unique(unlist(lapply(sts, function(st) if (identical(st$op, "=~")) st$lhs)))
      bmap <- character(0)
      bname <- function(x) {
        if (!ok_name(x)) stop("Invalid name in the between-level model.")
        if (x %in% names(bmap)) return(unname(bmap[[x]]))
        taken <- c(unname(n$iv), names(inputs$data), unname(lname), unname(bmap))
        fresh <- function() ps_ident(c(taken, x))[length(taken) + 1]
        id <- if (x %in% fac_b) { id <- fresh(); between_lv <<- c(between_lv, id); between_cov[id] <<- x; id }
          else if (x %in% names(n$iv)) unname(n$iv[[x]])
          else {
            at <- match(x, req$data$names)
            if (is.na(at)) stop(sprintf("%s in the between-level model is neither a column of the dataset nor a between-level factor.", x))
            cols <- req$data$cols
            id <- fresh()
            inputs$data[[id]] <<- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
            between_cov[id] <<- x
            id
          }
        bmap[x] <<- id
        id
      }
      term <- function(t) {
        pre <- if (!is.null(t$fixed)) paste0(ps_num(t$fixed), "*") else if (!is.null(t$label)) paste0(ps_label(t$label), "*") else ""
        paste0(pre, if (identical(t$name, "1")) "1" else bname(t$name))
      }
      between <- vapply(sts, function(st) {
        op <- st$op
        if (!(is.character(op) && length(op) == 1 && op %in% c("=~", "~", "~~", "~1"))) stop("Invalid operator in the between-level model.")
        if (!length(st$rhs)) stop("A between-level statement has no right-hand side.")
        lhs <- bname(st$lhs)
        if (op == "~1") {
          t <- st$rhs[[1]]
          if (!identical(t$name, "1")) stop("Invalid intercept in the between-level model.")
          return(paste(lhs, "~", term(t)))
        }
        if (any(vapply(st$rhs, function(t) identical(t$name, "1"), TRUE))) stop("Invalid term in the between-level model.")
        paste(lhs, op, paste(vapply(st$rhs, term, ""), collapse = " + "))
      }, "")
    } else if (identical(ml$between, "factors")) {
      ws <- character(0)
      for (w in as.character(unlist(ml$betweenCovariates))) {
        at <- match(w, req$data$names)
        if (is.na(at)) stop("A cluster-level covariate is not in the dataset.")
        cols <- req$data$cols
        id <- ps_ident(c(unname(n$iv), names(inputs$data), w))[length(n$iv) + ncol(inputs$data) + 1]
        inputs$data[[id]] <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
        ws <- c(ws, id); between_cov[id] <- w
      }
      fac <- which(!is_cov[seq_len(k0)] & vapply(seq_len(k0), function(j) length(n$inds[[j]]) > 0 && !length(comps[[j]]), TRUE))
      if (!length(fac)) stop("A between-level factor model needs factors with indicators.")
      between <- c(vapply(fac, function(j) paste(paste0(lname[[j]], "_b"), "=~", ps_marked(unname(n$iv[n$inds[[j]]]))), ""),
        if (length(ws)) sprintf("%s ~ %s", paste0(unname(lname[fac]), "_b"), paste(ws, collapse = " + ")))
    } else if (identical(ml$between, "same")) {
      between <- lines
      for (lv in unname(lname[n$cname[!is_cov]])) between <- gsub(sprintf("\\b%s\\b", lv), paste0(lv, "_b"), between, perl = TRUE)
    } else {
      ov <- unique(c(unname(n$iv[n$all_inds])))
      between <- vapply(seq_along(ov), function(i) paste(ov[i], "~~", paste(ov[i:length(ov)], collapse = " + ")), "")
    }
    lv_block <- c("level: 1", paste0("  ", lines), "level: 2", paste0("  ", between))
    # With groups as well, lavaan wants the level blocks once per group (group: <value>).
    lines <- if (!is.null(group_var)) {
      gv <- sort(unique(inputs$data[[group_var]][!is.na(inputs$data[[group_var]])]))
      # Intercepts held equal (scalar or strict invariance): the between-level factors' means are free after the first
      # group, as lavaan frees the factor means in a one-level model and Mplus at the between level (unless the means
      # are held equal too).
      bfree <- if ((mg$invariance %||% "configural") %in% c("scalar", "strict") && !"means" %in% unlist(mg$structural)) between_lv else character(0)
      unlist(lapply(seq_along(gv), function(i) c(sprintf("group: %s", format(gv[i])), paste0("  ", lv_block),
        if (i > 1 && length(bfree)) sprintf("    %s ~ NA*1", bfree))))
    } else lv_block
    lines <- c(lines, defs)
  }
  # Ordered categorical indicators (thresholds, polychoric correlations) and FIML.
  ordered <- unname(n$iv[intersect(unlist(req$model$ordered), n$all_inds)])
  extra <- paste0(if (length(ordered)) sprintf(", ordered = %s", ps_q(ordered)) else "",
    ps_lavaan_missing(req$missing))
  if (!is.null(cluster_var)) extra <- paste0(extra, sprintf(", cluster = \"%s\"", cluster_var))
  # Sampling clusters: lavaan then reports cluster-robust (sandwich) standard errors and, with MLR, a scaled test (Mplus TYPE = COMPLEX).
  if (!is.null(complex_var)) {
    if (!req$estimator %in% c("ML", "MLR", "MLM", "MLMV", "WLSMV", "ULS", "GLS")) stop("Cluster-robust standard errors: choose ML or MLR.")
    extra <- paste0(extra, sprintf(", cluster = \"%s\"", complex_var))
    body <- c(body, sprintf("# Sampling clusters (%s): cluster-robust standard errors (lavaan cluster = in a single-level model; Mplus TYPE = COMPLEX).", ps_comment(kcol)))
    ps_note(sprintf("Standard errors are robust to the clustering of cases by %s (lavaan cluster =, se = \"robust.cluster\"; as Mplus TYPE = COMPLEX).%s", kcol,
      if (identical(req$estimator, "MLR")) " The scaled chi-square and the robust fit measures account for it too." else " With MLR the chi-square test would be adjusted as well."))
  }
  # Variances kept non-negative (lavaan's bounds; a guard against Heywood cases).
  bounds <- if (isTRUE(req$model$positiveVariances)) ", bounds = \"pos.var\"" else ""
  if (!is.null(weight_var)) {
    if (!is.null(cluster_var)) stop("Sampling weights cannot be combined with a two-level model here.")
    if (!req$estimator %in% c("ML", "MLR", "MLM", "WLSMV")) stop("With sampling weights choose ML, MLR or MLM (or WLSMV for ordinal indicators).")
    # (lavaan then reports robust, design-based standard errors)
    extra <- paste0(extra, sprintf(", sampling.weights = \"%s\"", weight_var))
  }
  if (matrix_input && nzchar(extra)) stop("Ordinal indicators and FIML need raw data.")
  if (!is.null(group_var) || matrix_groups) {
    # Measurement invariance: what is held equal across groups, and what is freed (partial invariance);
    # structural equalities (a stacked model: the paths, the exogenous variances and covariances) likewise.
    lev <- mg$invariance %||% "configural"
    if (!lev %in% c("configural", "metric", "scalar", "strict")) stop("Invalid invariance level in the request.")
    structural <- unlist(mg$structural)
    if (!all(structural %in% c("regressions", "lv.variances", "lv.covariances", "means"))) stop("Invalid structural equality in the request.")
    if ("means" %in% structural && !means_on) structural <- setdiff(structural, "means")
    equal <- c(if (lev != "configural") "loadings", if (lev %in% c("scalar", "strict")) c("intercepts", if (length(ordered)) "thresholds"),
      if (lev == "strict") "residuals", structural)
    partial <- unlist(lapply(mg$free, function(f) {
      if (identical(f$kind, "loading")) paste0(lname[[f$construct]], "=~", n$iv[[f$indicator]])
      else if (identical(f$kind, "intercept")) {
        iv <- n$iv[[f$indicator]]
        # An ordinal indicator's "intercept" is its thresholds: all of them freed.
        if (iv %in% ordered && !matrix_input) c(paste0(iv, "|t", seq_len(max(1, length(unique(inputs$data[[iv]][!is.na(inputs$data[[iv]])])) - 1))))
        else paste0(iv, "~1")
      }
      else if (identical(f$kind, "regression")) paste0(lname[[f$to]], "~", lname[[f$from]])
      else if (identical(f$kind, "mean")) paste0(lname[[f$construct]], "~1")
    }))
    # Mplus's default with equal thresholds: the ordinal indicators' scale factors (delta) or residual variances
    # (theta) free after the first group; an indicator whose thresholds are freed keeps 1 in every group ({u3@1}).
    if (!is.null(mg$ordinalScales)) {
      if (!identical(mg$ordinalScales, "free")) stop("Invalid ordinal scales in the request.")
      if (!length(ordered) || !lev %in% c("scalar", "strict")) stop("Free scale factors need ordinal indicators with equal thresholds (scalar invariance).")
      freed <- unlist(lapply(mg$free, function(f) if (identical(f$kind, "intercept")) n$iv[[f$indicator]]))
      op <- if (theta) " ~~ " else " ~*~ "
      lines <- c(lines, vapply(ordered, function(u) paste0(u, op, sprintf("c(%s)*", paste(c("1", rep(if (u %in% freed) "1" else "NA", n_groups - 1)), collapse = ", ")), u,
        if (u %in% freed) "   # thresholds free across groups: scale fixed at 1" else ""), ""))
    }
    extra <- paste0(extra, if (!is.null(group_var)) sprintf(", group = \"%s\"", group_var) else "",
      if (length(equal)) sprintf(", group.equal = %s", ps_q(equal)) else "",
      if (length(partial)) sprintf(", group.partial = %s", ps_q(partial)) else "")
  }
  if (means_on) extra <- paste0(extra, ", meanstructure = TRUE")
  if (theta) {
    if (!length(ordered)) stop("The theta parameterisation applies to ordinal indicators.")
    extra <- paste0(extra, ", parameterization = \"theta\"")
  }
  # Groups without means and intercepts (Mplus MODEL = NOMEANSTRUCTURE; lavaan adds them to every multiple-group model).
  if ((!is.null(group_var) || matrix_groups) && identical(mg$meanStructure, FALSE)) {
    if (means_on) stop("Groups without a mean structure cannot have means or intercepts (remove the constant).")
    if ((mg$invariance %||% "configural") %in% c("scalar", "strict")) stop("Scalar and strict invariance hold intercepts equal: they need the mean structure.")
    extra <- paste0(extra, ", meanstructure = FALSE")
  }
  # Groups from matrices that carry means behave as groups from raw data: lavaan gets the means, so every group
  # has its intercepts (held equal under scalar invariance, the latent means then free after the first group).
  pass_m <- means_on || (matrix_groups && !is.null(inputs$M) && !identical(mg$meanStructure, FALSE))
  if (matrix_groups && is.null(inputs$M) && (mg$invariance %||% "configural") %in% c("scalar", "strict"))
    stop("Scalar and strict invariance hold intercepts equal: they need the variables' means, and these matrices carry none.")
  # The sample-size convention: the Wishart likelihood (N - 1, the matrix as given; LISREL, EQS, Amos, the sem package),
  # or a covariance matrix fitted as given with N (sample.cov.rescale = FALSE, as Kline's scripts).
  if (!is.null(req$model$likelihood)) {
    if (!identical(req$model$likelihood, "wishart")) stop("Invalid likelihood in the request.")
    extra <- paste0(extra, ", likelihood = \"wishart\"")
  }
  if (identical(req$model$sampleCovRescale, FALSE)) {
    if (!matrix_input) stop("sample.cov.rescale applies to covariance-matrix input.")
    extra <- paste0(extra, ", sample.cov.rescale = FALSE")
  }
  # Standard errors from the observed information (the Hessian; Mplus's default for ML) instead of lavaan's expected information.
  if (!is.null(req$model$information)) {
    if (!identical(req$model$information, "observed")) stop("Invalid information in the request.")
    extra <- paste0(extra, ", information = \"observed\"")
  }
  # WLSMV standard errors as Mplus computes them (the default; wlsmvSe = "lavaan" keeps lavaan 0.7's), and the
  # test statistic as Mplus (mimic = "Mplus"): ps_wlsmv_se.
  wse <- ps_wlsmv_se(req, length(ordered) > 0, !is.null(group_var) || matrix_groups, !is.null(complex_var) || !is.null(weight_var))
  extra <- paste0(extra, wse$args)
  # The diagram is the model: the disturbances of two endogenous constructs covary only when drawn
  # (lavaan's sem() would otherwise free every such covariance, auto.cov.y).
  # Exception: explained factors of an ESEM block. Their residual covariance comes with the rotation (lavaan
  # frees it after rotating, which keeps the count of parameters and df right); written as a covariance it would be
  # estimated before the rotation as well, one parameter too many. When every explained construct is in an ESEM
  # block, lavaan's default is kept and a drawn covariance within a block is left to the rotation (Mplus ex. 5.24).
  endo_names <- unique(vapply(req$model$paths, function(p) p$to, ""))
  esem_endo <- length(esem$blocks) && length(endo_names) && all(endo_names %in% in_block)
  if (esem_endo) {
    same_block <- function(a, b) any(vapply(esem$blocks, function(bl) all(c(a, b) %in% unname(lname[unlist(bl)])), TRUE))
    keep <- vapply(lines, function(l) { m <- regmatches(l, regexec("^(\\S+) ~~ (\\S+)$", l))[[1]]; !(length(m) == 3 && m[2] != m[3] && same_block(m[2], m[3])) }, TRUE)
    lines <- lines[keep]
  }
  extra <- paste0(extra, if (esem_endo) "" else ", auto.cov.y = FALSE", bounds)
  if (length(esem$blocks)) {
    rargs <- c(if (!is.null(target)) "target = TARGET", if (!is.null(eps) && rot %in% c("geomin", "bigeomin")) sprintf("geomin.epsilon = %s", format(eps, scientific = FALSE)),
      if (orth) "orthogonal = TRUE",
      # Loadings held equal across groups (invariant ESEM): the unstandardised loadings are rotated, as Mplus does
      # (Mplus ex. 5.27 b-e); lavaan's default standardises them by the observed SDs, which differ between groups.
      if ((!is.null(group_var) || matrix_groups) && (mg$invariance %||% "configural") != "configural") "std.ov = FALSE",
      # (the bifactor criteria are flat: at lavaan's default tolerance, 1e-5, the loadings vary in the third
      #  decimal with the random starts; at 1e-8 they are reproducible)
      if (bifactor) "gpa.tol = 1e-8")
    extra <- paste0(extra, sprintf(", rotation = \"%s\"", rot), if (length(rargs)) sprintf(", rotation.args = list(%s)", paste(rargs, collapse = ", ")) else "")
  }
  if (use_modsem) {
    if (!is.null(weight_var)) stop("Sampling weights cannot be combined with LMS / QML latent interactions; use product indicators.")
    if (means_on) stop("Means and intercepts are not available with LMS / QML; use product indicators.")
    body[1] <- "suppressPackageStartupMessages({ library(lavaan); library(modsem) })"
    body <- c(body, sprintf("# Latent interaction by %s (modsem; Klein & Moosbrugger 2000 / Klein & Muthen 2007)", toupper(method)),
      "model <- '", paste0("  ", lines), "'", sprintf("fit <- modsem(model, data = data, method = \"%s\")", method))
    return(list(n = n, k0 = k0, comps = comps, is_cov = is_cov, lname = lname, mods = mods, int_names = int_names, prod = prod,
      inputs = inputs, body = body, matrix_input = matrix_input, group_var = NULL, modsem = method))
  }
  # (with matrices, extra holds the group equalities of a stacked model and the bounds only: the rest was refused above)
  call <- if (matrix_input) sprintf("fit <- sem(model, sample.cov = S, sample.nobs = N%s%s, estimator = \"%s\"%s)", if (!is.null(inputs$NACOV)) ", NACOV = NACOV" else "", if (pass_m) ", sample.mean = M" else "", req$estimator, extra)
    else sprintf("fit <- sem(model, data = data, estimator = \"%s\"%s)", req$estimator, extra)
  # Multiple imputation (mice, then lavaan.mi's Rubin pooling); a lavaan fit to the first imputed data set
  # serves as the template for the model's structure, every reported number is pooled.
  mi <- identical(req$missing, "mi")
  if (mi) {
    if (matrix_input) stop("Multiple imputation needs raw data.")
    if (!is.null(cluster_var) || !is.null(complex_var) || !is.null(weight_var) || length(ordered) || length(esem$blocks))
      stop("Multiple imputation is available for continuous indicators: no clusters, sampling weights, ordinal indicators or ESEM blocks.")
    if (!req$estimator %in% c("ML", "MLR")) stop("With multiple imputation choose the ML or MLR estimator.")
    ms <- ps_mi_settings(req)
    # Auxiliary variables: columns that inform the imputation without being in the model (they travel with the data).
    model_cols <- intersect(names(n$iv), req$data$names)
    aux_id <- character(0)
    for (a in setdiff(ms$auxiliary, model_cols)) {
      at <- match(a, req$data$names)
      if (is.na(at)) stop("An auxiliary variable for the imputation is not in the dataset.")
      cols <- req$data$cols
      av <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
      id <- ps_ident(c(unname(n$iv), names(inputs$data), a))[length(n$iv) + ncol(inputs$data) + 1]
      inputs$data[[id]] <- av
      aux_id[a] <- id
    }
    ident_of <- function(x) if (x %in% names(aux_id)) unname(aux_id[x]) else if (x %in% names(n$iv)) unname(n$iv[[x]]) else stop("A nominal variable for the imputation is not among its variables.")
    noms <- vapply(ms$nominal, ident_of, "")
    amelia <- identical(ms$method, "amelia")
    body[1] <- sprintf("suppressPackageStartupMessages({ library(lavaan); %slibrary(lavaan.mi) })", if (amelia) "library(Amelia); " else if (identical(ms$method, "joint")) "" else "library(mice); ")
    call <- c(
      if (length(aux_id)) sprintf("# Auxiliary variables of the imputation (not in the model): %s", paste(ps_comment(names(aux_id)), collapse = ", ")),
      if (amelia) c(
        sprintf("# Multiple imputation by Amelia (EM with bootstrapping; Honaker, King & Blackwell), %d imputed data sets.", ms$m),
        sprintf("set.seed(%d)", ms$seed),
        sprintf("imp <- amelia(data, m = %d%s, p2s = 0)$imputations", ms$m, if (length(noms)) sprintf(", noms = %s", ps_q(unname(noms))) else ""),
        "imp <- lapply(seq_along(imp), function(k) as.data.frame(imp[[k]]))")
      else if (identical(ms$method, "joint")) c(
        sprintf("# Multiple imputation as Mplus's DATA IMPUTATION, %d imputed data sets: a draw every 100 iterations of the data", ms$m),
        "# augmentation for the unrestricted (H1) multivariate normal model, the categorical columns through latent responses.",
        ps_joint_impute_lines(),
        if (!is.null(group_var)) "# (the grouping column is complete: a variable of the imputation model)",
        sprintf("imp <- ps_joint_impute(data, m = %d, seed = %d%s)", ms$m, ms$seed, if (length(noms)) sprintf(", categorical = %s", ps_q(unname(noms))) else ""))
      else if (identical(ms$method, "micenorm")) c(
        if (!is.null(group_var)) c("# The grouping column is categorical: mice uses it as a factor.", sprintf("data$%s <- factor(data$%s)", group_var, group_var)),
        sprintf("# Multiple imputation by chained equations (mice), %d imputed data sets: Bayesian linear regression (norm) for", ms$m),
        "# continuous variables, a draw from the posterior of a normal model as Mplus's H1 imputation; logistic or multinomial",
        "# regression for the nominal ones, which return to their codes for the model.",
        if (length(noms)) sprintf("for (v in %s) data[[v]] <- factor(data[[v]])", ps_q(unname(noms))),
        sprintf("imp <- mice(data, m = %d, seed = %d, printFlag = FALSE, defaultMethod = c(\"norm\", \"logreg\", \"polyreg\", \"polr\"))", ms$m, ms$seed),
        sprintf("imp <- lapply(seq_len(%d), function(k) { d <- complete(imp, k)%s; d })", ms$m,
          if (length(noms)) sprintf("; for (v in %s) d[[v]] <- as.numeric(as.character(d[[v]]))", ps_q(unname(noms))) else ""))
      else c(
        if (!is.null(group_var)) c("# The grouping column is categorical: mice uses it as a factor.", sprintf("data$%s <- factor(data$%s)", group_var, group_var)),
        sprintf("# Multiple imputation by chained equations (mice, predictive mean matching), %d imputed data sets.", ms$m),
        sprintf("imp <- mice(data, m = %d, seed = %d, printFlag = FALSE)", ms$m, ms$seed),
        sprintf("imp <- lapply(seq_len(%d), function(k) complete(imp, k))", ms$m)),
      "# The model in every imputed data set, pooled by Rubin's rules (lavaan.mi).",
      sprintf("fit_mi <- sem.mi(model, data = imp, estimator = \"%s\"%s)", req$estimator, extra),
      "# Pooled covariance matrix of the estimates (lavaan.mi: (1 + ARIV) times the mean within-imputation matrix, which its SEs use).",
      "# Where lavaan.mi's S4 vcov method is not dispatched (R in the browser), the same matrix from the per-imputation fits.",
      "vcov_mi <- tryCatch(vcov(fit_mi), error = function(e) {",
      sprintf("  fits <- lapply(imp, function(d) sem(model, data = d, estimator = \"%s\"%s))", req$estimator, extra),
      "  # (as lavaan.mi's vcov: equality constraints counted out, a generalised inverse when there are any)",
      "  pt <- lavaan::parTable(fits[[1]]); ncon <- sum(pt$op == \"==\"); npar <- max(pt$free) - ncon",
      "  keep <- pt$free > 0L & !duplicated(pt$free)",
      "  B <- stats::cov(do.call(rbind, lapply(fits, function(x) lavaan::parTable(x)$est[keep])))",
      "  W <- Reduce(`+`, lapply(fits, function(x) unclass(lavaan::lavInspect(x, \"vcov\")))) / length(imp)",
      "  inv <- if (ncon == 0) tryCatch(solve(W), error = function(e) MASS::ginv(W)) else MASS::ginv(W)",
      "  (1 + (1 + 1 / length(imp)) / npar * sum(diag(B %*% inv))) * W",
      "})",
      "# (The model fitted to the first imputed data set: only its structure is used.)",
      sprintf("fit <- sem(model, data = imp[[1]], estimator = \"%s\"%s)", req$estimator, extra))
  }
  robust <- identical(req$estimator, "RML")
  if (robust) {
    if (mi) stop("Robust ML (rsem) uses the missing values itself (EM); choose FIML or casewise instead of multiple imputation.")
    if (matrix_input) stop("Robust ML (rsem) needs raw data.")
    if (!is.null(group_var) || !is.null(cluster_var) || !is.null(complex_var) || !is.null(weight_var) || length(ordered) || length(esem$blocks))
      stop("Robust ML (rsem) handles one group of continuous indicators: no groups, clusters, sampling weights, ordinal indicators or ESEM blocks.")
    body[1] <- "suppressPackageStartupMessages({ library(lavaan); library(rsem) })"
    vars <- unname(n$iv[n$all_inds])
    call <- c(
      "# Robust ML (Yuan & Zhang 2012; rsem): Huber-type case weights (varphi = 0.1) give robust means and",
      "# covariances (by EM, so missing values are used); the model is fitted to them by ML (EQS conventions),",
      "# with robust standard errors and the rescaled test statistic TRML.",
      sprintf("X <- data.matrix(data[, %s])", ps_q(vars)),
      "pattern <- rsem.pattern(X)",
      "musig <- rsem.emmusig(pattern, varphi = 0.1)",
      "fit <- sem(model, sample.cov = musig$sigma, sample.mean = musig$mu, sample.nobs = nrow(X), mimic = \"EQS\")",
      "ascov <- rsem.Ascov(pattern, musig, varphi = 0.1)",
      "robust_se <- rsem.se(fit, ascov$Gamma)",
      "robust_fit <- rsem.fit(fit, ascov$Gamma, musig)",
      "# Each case's weight (1 = full weight; rsem sorts the cases by missing-data pattern, so they are put back in order)",
      "case_weight <- numeric(nrow(X)); case_weight[order(as.vector(is.na(X) %*% 2^(seq_len(ncol(X)) - 1)))] <- musig$weight$w1",
      "case_row <- as.integer(rownames(data))")
  }
  tests <- req$model$waldTests
  wald <- if (length(tests)) c("# Wald tests of the hypotheses (lavaan::lavTestWald)",
    sprintf("wald <- list(%s)", paste(vapply(seq_along(tests), function(i) sprintf("lavTestWald(fit, constraints = '%s')",
      paste(vapply(unlist(tests[[i]]$constraints), function(h) { parts <- strsplit(h, "==", fixed = TRUE)[[1]]
        if (length(parts) != 2) stop("Invalid hypothesis in the request."); paste(ps_expr(trimws(parts[1])), "==", ps_expr(trimws(parts[2]))) }, ""), collapse = "\n")), ""), collapse = ",\n  ")))
  # CFI and TLI compare the model with a baseline of uncorrelated variables. lavaan leaves the covariances
  # among exogenous *observed* variables free in that baseline (as Mplus); an observed variable drawn as a
  # single error-free indicator of its own exogenous construct would lose that, so the baseline is written
  # out when there are two or more of them, and fitMeasures() is told to use it. (A component of a
  # higher-order factor, such as a wave of a latent curve, is not exogenous.) `baseline = "independence"`:
  # every variable uncorrelated instead (LISREL's null model; lavaan's when the exogenous covariances are
  # written out in the syntax, as on some help pages).
  to_ids <- vapply(req$model$paths, function(p) p$to, "")
  in_hoc <- unlist(lapply(seq_len(k0), function(j) unlist(cons[[j]]$components)))
  xlike <- unlist(lapply(seq_len(k0), function(j) if (!is_cov[j] && length(n$inds[[j]]) == 1 && !(unname(n$iv[[n$inds[[j]][1]]]) %in% shared_iv) && is.null(cons[[j]]$reliability) && !(n$cname[j] %in% to_ids) && !length(comps[[j]]) && !(n$cname[j] %in% in_hoc) && !(n$cname[j] %in% in_block)) unname(n$iv[[n$inds[[j]][1]]]) else NULL))
  if (!is.null(req$model$baseline) && !identical(req$model$baseline, "independence")) stop("Invalid baseline in the request.")
  baseline <- character(0)
  if (length(xlike) >= 2 && !identical(req$model$baseline, "independence") && !mi && !length(ordered) && !length(esem$blocks) && is.null(cluster_var) && !matrix_groups_nacov(inputs)) {
    ov <- unname(n$iv[n$all_inds])
    pairs <- combn(xlike, 2)
    bmodel <- c(paste(ov, "~~", ov), paste(pairs[1, ], "~~", pairs[2, ]), if (means_on) paste(ov, "~ 1"))
    bcall <- sub("^fit <- sem\\(model", "fit_baseline <- sem(baseline_model", call)
    for (drop in c(", group\\.equal = c\\([^)]*\\)", ", group\\.partial = c\\([^)]*\\)", ", bounds = \"pos\\.var\"")) bcall <- gsub(drop, "", bcall)
    baseline <- c("# The baseline model for CFI and TLI: as lavaan's for observed variables, the covariances among the",
      "# exogenous observed variables stay free", "baseline_model <- '", paste0("  ", bmodel), "'", bcall)
  }
  # Invariant ESEM blocks: the unrotated model first, rotated jointly; its values start the rotated model.
  if (!is.null(inv)) {
    other <- lines[-seq_along(inv$lines)]
    other <- other[!other %in% inv$within]
    body <- c(body, "model_unrotated <- '", paste0("  ", c(inv$unrotated, other)), "'",
      sub("^fit <- sem\\(model,", "fit_unrotated <- sem(model_unrotated,", call), ps_esem_invariant_rotate(inv))
    call <- sub("\\)$", if (identical(req$estimator, "ML")) ", start = start_rot, test = \"standard\")" else ", start = start_rot)", call)
  }
  # (the baseline lines travel separately: every other user of this body expects the fit call last)
  body <- c(body, "model <- '", paste0("  ", lines), "'", call, wse$lines,
    # (MLR with groups and clusters: Mplus's robust standard errors, lavaan's pieces weighted by the groups' clusters)
    if (!is.null(cluster_var) && !is.null(group_var) && identical(req$estimator, "MLR")) PS_TWOLEVEL_GROUPS_SE, wald)
  list(n = n, k0 = k0, comps = comps, is_cov = is_cov, ord_self = ord_self, lname = lname, mods = mods, means = means_on, int_names = int_names, prod = prod,
    inputs = inputs, body = body, baseline = baseline, matrix_input = matrix_input, group_var = group_var, cluster_var = cluster_var, call = call, robust = robust, mi = mi, rel_inds = rel_inds, composites = composites, obs_single = obs_single, between_cov = between_cov, between_lv = between_lv,
    esem_blocks = lapply(esem$blocks, function(x) as.character(unlist(x))), bifactor = length(esem$blocks) > 0 && bifactor)
}

ps_cb <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (!is.null(b$modsem)) { r <- ps_cb_modsem(req, b, export); return(if (export) r else ps_json(r)) }
  body <- c(b$body, b$baseline)
  if (export) {
    return(paste(ps_script("CB-SEM (lavaan)", "lavaan", b$inputs, body,
      # (multiple imputation: the results pooled over the imputed data sets, fit_mi, as the app reports them; fit is one imputation)
      c(if (isTRUE(b$mi)) "summary(fit_mi, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)"
        else if (length(b$baseline)) "summary(fit, standardized = TRUE, rsquare = TRUE); fitMeasures(fit, baseline.model = fit_baseline)" else "summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)")), collapse = "\n"))
  }
  env <- ps_run(body, b$inputs)
  fit <- env$fit
  b <- ps_esem_align(b, fit)
  n <- b$n; k0 <- b$k0; comps <- b$comps; mods <- b$mods

  # ---- names back
  constructs <- c(n$cname, b$int_names)
  lv_lname <- unname(b$lname[constructs])
  indicators <- c(n$all_inds, unname(unlist(b$prod)))
  ind_v <- c(unname(n$iv[n$all_inds]), names(b$prod))
  owner <- function(i) which(vapply(n$inds, function(x) i %in% x, TRUE))[1]
  # Product indicators belong to their interaction factor, in moderation order.
  counts <- vapply(mods, function(m) min(length(n$inds[[match(m$from, n$cname)]]), length(n$inds[[match(m$moderator, n$cname)]])), 1L)
  ind_con <- c(unname(vapply(n$all_inds, owner, 1L)) - 1L, rep(k0 - 1L + seq_along(mods), counts))
  # Between-level factors of a two-level model carry the suffix _b.
  # (cluster-level covariates of a between-level factor model: their own names)
  back <- c(setNames(constructs, lv_lname), setNames(constructs, paste0(lv_lname, "_b")), setNames(indicators, ind_v), setNames(unname(b$between_cov), names(b$between_cov)))
  is_lv <- function(x) x %in% c(lv_lname, paste0(lv_lname, "_b"), b$between_lv)
  # (an observed covariate is its own lavaan name: its "~1" is an intercept, not a latent mean)
  latent_names <- { lv <- unname(b$lname[!(b$is_cov | (b$ord_self %||% FALSE))]); c(lv, paste0(lv, "_b"), b$between_lv) }
  nm <- function(x) unname(back[x])

  levels2 <- !is.null(b$cluster_var)
  glab <- lavaan::lavInspect(fit, "group.label")
  # Blocks: groups, levels, or both (block = (group - 1) * 2 + level, as lavaan numbers them).
  groups <- if (levels2 && length(glab) > 1) as.vector(t(outer(glab, c("Within", "Between"), paste, sep = " · ")))
    else if (levels2) c("Within", "Between") else glab
  between_block <- function(g) levels2 && !is.null(g) && g %% 2 == 0
  group_of <- function(g) if (levels2) (g + 1) %/% 2 else g
  # Mplus TECH4: the model-implied means, covariances and correlations of the latent variables, per block.
  # (Not with multiple imputation, whose estimates are pooled; robust ML (rsem) has no lavaan covariance matrix.)
  tech4 <- if (isTRUE(b$mi)) NULL else ps_try(ps_tech4(fit, se = !isTRUE(b$robust)), "The model-implied latent means and covariances (TECH4)")
  # Ordinal indicators: the sample polychoric (and polyserial) correlations and thresholds the model is fitted
  # to (Mplus SAMPSTAT), and each pair's bivariate fit (Mplus TECH10). (Not pooled over imputations.)
  ordinal <- length(unlist(req$model$ordered)) > 0 && !isTRUE(b$mi)
  sampstat <- if (ordinal) ps_try(ps_sampstat(fit), "The sample polychoric correlations (SAMPSTAT)") else NULL
  # (TECH10 needs pairs: not with a single ordinal variable)
  tech10 <- if (ordinal && length(lavaan::lavNames(fit, "ov.ord")) >= 2) ps_try(ps_tech10(fit), "The bivariate fit of the ordinal indicators (TECH10)") else NULL
  map_group <- function(g) {
    pt <- lavaan::parTable(fit)
    pe <- lavaan::parameterEstimates(fit, standardized = TRUE, remove.nonfree = FALSE)
    multi <- "block" %in% names(pe) || "group" %in% names(pe)
    blk <- function(t) if ("block" %in% names(t)) t$block else if ("group" %in% names(t)) t$group else 1
    key <- function(t) paste(t$lhs, t$op, t$rhs, if (multi) blk(t) else 1)
    pe$free <- pt$free[match(key(pe), key(pt))]
    # Multiple imputation: pooled estimates, SEs and tests (Rubin; t with Barnard-Rubin df) and the pooled
    # standardised solution replace those of the template fit.
    if (isTRUE(b$mi)) {
      pp <- lavaan.mi::parameterEstimates.mi(env$fit_mi)
      ps <- lavaan.mi::standardizedSolution.mi(env$fit_mi)
      k3 <- function(t) paste(t$lhs, t$op, t$rhs, if ("group" %in% names(t)) t$group else 1)
      i <- match(k3(pe), k3(pp)); j <- match(k3(pe), k3(ps))
      pe$est <- pp$est[i]; pe$se <- pp$se[i]; pe$z <- pp$t[i]; pe$pvalue <- pp$pvalue[i]; pe$std.all <- ps$est.std[j]
    }
    # Robust ML (rsem): its robust standard errors (one per free parameter, in lavaan's order) replace ML's.
    if (isTRUE(b$robust)) {
      rse <- env$robust_se$se[[1]]
      on <- !is.na(pe$free) & pe$free > 0
      pe$se[on] <- rse[pe$free[on]]; pe$z[on] <- pe$est[on] / pe$se[on]; pe$pvalue[on] <- 2 * stats::pnorm(-abs(pe$z[on]))
    }
    # Defined parameters (block 0) belong to the whole model: shown with every group or level.
    if (!is.null(g)) pe <- pe[blk(pe) == g | pe$op == ":=", ]
    # Means and intercepts: all of them with the mean structure on (a fixed marker intercept
    # included); otherwise the latent means estimated in groups after the first under scalar invariance.
    # (A two-level model always has its mean structure: the free intercepts and means are listed.)
    pe <- pe[pe$op %in% c("=~", "<~", "~", "~~", "|", ":=") | (pe$op == "~*~" & !is.na(pe$free) & pe$free > 0) | (pe$op == "~1" & (isTRUE(b$means) | ((pe$lhs %in% lv_lname | levels2) & !is.na(pe$free) & pe$free > 0))), ]
    est <- lapply(seq_len(nrow(pe)), function(i) {
      r <- pe[i, ]; free <- r$free > 0
      # (an observed variable's intercept is its construct's: the indicator's, fixed at 0, is not listed)
      if (r$op == "~1" && r$lhs %in% unname(b$obs_single)) return(NULL)
      kind <- if (r$op == "~*~") "scale" else if (r$op == "~1") { if (r$lhs %in% latent_names && !r$lhs %in% names(b$obs_single)) "mean" else "intercept" } else if (r$op == ":=") "defined" else if (r$op == "|") "threshold"
        else if (r$op == "<~") { if (free) "weight" else "fixed-weight" }
        else if (r$op == "=~") { if (!free) "fixed-loading" else if (is_lv(r$rhs)) "hoLoading" else "loading" }
        else if (r$op == "~") "regression"
        else if (is_lv(r$lhs) && is_lv(r$rhs)) { if (free) "lvcov" else "fixed" }
        # Fixed error variances are reported for single indicators with a known reliability only (others are 0).
        else if (!free) { if (r$op == "~~" && r$lhs == r$rhs && r$lhs %in% b$rel_inds) "residual" else NA_character_ }
        else if (r$lhs == r$rhs) "residual" else "rescov"
      if (is.na(kind)) return(NULL)
      if (r$op == ":=") return(list(kind = kind, lhs = r$lhs, op = r$op, rhs = r$rhs, est = r$est, se = if (is.na(r$se)) NULL else r$se,
        z = if (is.na(r$z)) NULL else r$z, p = if (is.na(r$pvalue)) NULL else r$pvalue, std = r$std.all))
      # (a threshold is the variable's, also where the variable stands for its construct: an ordinal mediator)
      list(kind = kind, lhs = if (r$op == "|" && r$lhs %in% ind_v) indicators[match(r$lhs, ind_v)] else nm(r$lhs), op = r$op, rhs = if (r$op %in% c("|", "~1")) r$rhs else nm(r$rhs), est = r$est,
        label = if (isTRUE(nzchar(r$label)) && !startsWith(r$label, ".")) r$label else NULL,
        se = if (!free || is.na(r$se)) NULL else r$se, z = if (!free || is.na(r$z)) NULL else r$z,
        p = if (!free || is.na(r$pvalue)) NULL else r$pvalue, std = r$std.all,
        index = if (free) r$free - 1L else NULL)
    })
    est <- Filter(Negate(is.null), est)

    K <- length(constructs)
    stdB <- matrix(0, K, K); has <- matrix(FALSE, K, K)
    for (e in est) if (e$kind == "regression") { f <- match(e$rhs, constructs); t <- match(e$lhs, constructs); stdB[f, t] <- e$std; has[f, t] <- TRUE }
    total <- solve(diag(K) - stdB) - diag(K)
    std_load <- vapply(seq_along(indicators), function(i) {
      e <- Filter(function(x) x$op == "=~" && x$rhs == indicators[i] && x$lhs == constructs[ind_con[i] + 1], est)
      if (length(e)) e[[1]]$std else 1
    }, 0)
    # Composites: the loading of an indicator is its correlation with the composite, from the implied
    # covariance matrix (lavaan's cor.all leaves these out): (Sigma w)_i / sqrt(Sigma_ii w'Sigma w).
    if (length(b$composites)) {
      sig <- lavaan::lavInspect(fit, "cov.ov"); if (!is.null(g) && is.list(sig)) sig <- sig[[g]]
      for (cn in b$composites) {
        j <- match(cn, constructs); at <- which(ind_con == j - 1)
        w <- vapply(at, function(i) { e <- Filter(function(x) x$op == "<~" && x$lhs == cn && x$rhs == indicators[i], est); e[[1]]$est }, 0)
        S <- sig[ind_v[at], ind_v[at], drop = FALSE]
        std_load[at] <- as.vector(S %*% w) / sqrt(diag(S) * as.numeric(t(w) %*% S %*% w))
      }
    }
    r2 <- lavaan::lavInspect(fit, "r2"); if (!is.null(g)) r2 <- r2[[g]]
    # Multiple imputation: R² = 1 - the pooled standardised residual variance.
    if (isTRUE(b$mi)) { rv <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$lhs %in% names(r2), ]; r2[rv$lhs] <- 1 - rv$std.all }
    comp_ind <- ind_con %in% (match(b$composites, constructs) - 1L)
    # Composite indicators have no error term (their R² is undefined).
    r2_ind <- vapply(seq_along(ind_v), function(i) if (comp_ind[i]) NA_real_ else if (ind_v[i] %in% names(r2)) unname(r2[[ind_v[i]]]) else 1, 0)
    endo <- vapply(seq_len(K), function(j) any(has[, j]) || any(vapply(comps, function(cc) constructs[j] %in% cc, TRUE)), TRUE)
    # Between clusters the factors are *_b (or absent in a saturated between model).
    lvn <- if (between_block(g)) paste0(lv_lname, "_b") else lv_lname
    r2_con <- lapply(seq_len(K), function(j) if (endo[j] && lvn[j] %in% names(r2)) unname(r2[[lvn[j]]]) else NULL)
    call <- lavaan::lavInspect(fit, "cor.all"); if (!is.null(g)) call <- call[[g]]
    lvcor <- matrix(NA_real_, K, K, dimnames = list(lvn, lvn))
    have <- intersect(lvn, rownames(call))
    lvcor[have, have] <- call[have, have]
    if (isTRUE(b$mi)) {
      # The pooled standardised factor covariances (correlations).
      cv <- pe[pe$op == "~~" & pe$lhs != pe$rhs & pe$lhs %in% have & pe$rhs %in% have, ]
      for (r in seq_len(nrow(cv))) lvcor[cv$lhs[r], cv$rhs[r]] <- lvcor[cv$rhs[r], cv$lhs[r]] <- cv$std.all[r]
    }
    # semTools::compRelSEM: model-based omega (correlated errors and ordinal indicators accounted for)
    # and coefficient alpha, of each first-order factor's indicator sum; one value per group.
    # (Not for two-level models, whose reliability is level-specific.)
    # (Multiple imputation: semTools pools them over the imputed data sets.)
    rfit <- if (isTRUE(b$mi)) env$fit_mi else fit
    # (Not with composites in the model: compRelSEM then misreads the factors' true-score variance.)
    no_rel <- levels2 || length(b$composites) > 0
    # (Reliability is of factors with two or more indicators: none, as in a path model of observed variables, then none.)
    pt_rel <- lavaan::parTable(fit)
    if (!any(table(pt_rel$lhs[pt_rel$op == "=~" & pt_rel$lhs %in% unname(b$lname[!b$is_cov])]) >= 2)) no_rel <- TRUE
    # (a growth curve: every factor measured by two or more observed variables has all its loadings fixed, its
    #  intercept and slope; they measure nothing, and semTools fails on them, e.g. with multiple imputation)
    ld_rel <- pt_rel[pt_rel$op == "=~" & !(pt_rel$rhs %in% pt_rel$lhs[pt_rel$op == "=~"]), ]
    measured <- names(which(table(ld_rel$lhs) >= 2))
    if (length(measured) && !any(ld_rel$free[ld_rel$lhs %in% measured] > 0)) no_rel <- TRUE
    # semTools's compRelSEM fails on models with observed covariates (lavaan's fixed.x): omega and alpha
    # then come from the factors' measurement model alone (their CFA on the same data, estimator and
    # options, through update()), which is where reliability is assessed anyway.
    if (!no_rel && any(b$is_cov) && !isTRUE(b$mi)) {
      rfit <- ps_try({
        pt <- lavaan::parTable(fit)
        if ("group" %in% names(pt)) pt <- pt[pt$group <= 1, ]
        # (first-order factors only: a higher-order factor measured by them is not identified on its own)
        facs <- unique(pt$lhs[pt$op == "=~" & pt$lhs %in% unname(b$lname[!b$is_cov]) & !(pt$rhs %in% lv_lname)])
        term <- function(r) if (r$free == 0 && !is.na(r$ustart)) sprintf("%s*%s", format(r$ustart), r$rhs) else r$rhs
        lines <- vapply(facs, function(f) { rows <- pt[pt$op == "=~" & pt$lhs == f, ]; paste(f, "=~", paste(vapply(seq_len(nrow(rows)), function(i) term(rows[i, ]), ""), collapse = " + ")) }, "")
        # (factors of an ESEM block stay a rotated block: written out as plain factors their cross-loadings are not identified)
        for (bi in seq_along(b$esem_blocks)) {
          bf <- intersect(unname(b$lname[b$esem_blocks[[bi]]]), facs)
          if (!length(bf)) next
          lines <- c(lines[!facs %in% bf], sprintf("%s =~ %s", paste(sprintf("efa(\"b%d\")*%s", bi, bf), collapse = " + "), paste(unique(pt$rhs[pt$op == "=~" & pt$lhs %in% bf]), collapse = " + ")))
          facs <- c(facs[!facs %in% bf], bf)
        }
        inds <- pt$rhs[pt$op == "=~" & pt$lhs %in% facs]
        fixed <- pt[pt$op == "~~" & pt$lhs == pt$rhs & pt$free == 0 & !is.na(pt$ustart) & pt$lhs %in% inds, ]
        # (an ordinal indicator's residual variance is not a parameter under the delta parameterisation)
        if (!identical(lavaan::lavInspect(fit, "options")$parameterization, "theta")) fixed <- fixed[!fixed$lhs %in% lavaan::lavNames(fit, "ov.ord"), ]
        if (nrow(fixed)) lines <- c(lines, sprintf("%s ~~ %s*%s", fixed$lhs, format(fixed$ustart), fixed$rhs))
        # (the original call with the measurement model only, evaluated where its data live; a NACOV
        #  matrix covers the full model's variables, and omega needs point estimates only: plain ML then)
        cl <- fit@call; cl$model <- paste(lines, collapse = "\n")
        if (!is.null(cl$NACOV)) { cl$NACOV <- NULL; cl$estimator <- "ML" }
        eval(cl, envir = env)
      }, "The factors' measurement model, for omega and alpha (lavaan)")
      if (is.null(rfit)) no_rel <- TRUE
    }
    omega <- if (no_rel) NULL else ps_try(semTools::compRelSEM(rfit), "Model-based reliability (omega, semTools::compRelSEM)")
    # (Ordinal indicators: semTools puts omega on the observed ordinal scale (Green & Yang 2009) but refuses
    #  alpha there; alpha then comes from the polychoric correlations, on the latent-response scale: the
    #  ordinal alpha of Zumbo, Gadermann & Zeisser 2007.)
    alpha <- if (no_rel) NULL else ps_try(semTools::compRelSEM(rfit, tau.eq = TRUE, ord.scale = !length(unlist(req$model$ordered))), "Coefficient alpha (semTools::compRelSEM)")
    per_group <- function(x, name) {
      # (semTools returns a list per group, or for one group a named vector: a lavaan.vector in semTools 0.5-7)
      v <- if (is.list(x)) x[[name]] else if (is.numeric(x) && !is.null(names(x)) && name %in% names(x)) x[[name]] else NULL
      if (is.null(v)) return(NULL)
      v <- as.numeric(unclass(v))
      if (length(v) > 1) v[if (is.null(g)) 1 else group_of(g)] else v
    }
    rel <- lapply(seq_len(K), function(j) {
      l <- std_load[ind_con == j - 1]
      if (!length(l) || (j <= k0 && length(comps[[j]])) || constructs[j] %in% b$composites) return(list(cr = NULL, ave = NULL))
      list(cr = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)), ave = mean(l^2), omega = per_group(omega, lv_lname[j]), alpha = per_group(alpha, lv_lname[j]))
    })
    bifactor <- if (isTRUE(b$bifactor)) lapply(b$esem_blocks, function(fs) ps_try(ps_bifactor(fit, g, b, fs), "Bifactor indices (ECV, omega hierarchical)"))
    rr <- if (isTRUE(b$mi)) lavaan.mi::lavResiduals.mi(env$fit_mi, type = "cor.bollen")
      else if (isTRUE(req$missing %in% c("twostage", "robusttwostage"))) ps_cor_residuals(fit)
      else lavaan::lavResiduals(fit, type = "cor.bollen", summary = FALSE)
    # (a two-level model's between level lacks the within-only variables: their rows stay NA)
    r0 <- if (is.null(g)) rr$cov else rr[[g]]$cov
    res <- matrix(NA_real_, length(ind_v), length(ind_v), dimnames = list(ind_v, ind_v))
    have_r <- intersect(ind_v, rownames(r0)); res[have_r, have_r] <- r0[have_r, have_r]
    gdata <- if (is.null(g) || b$matrix_input || is.null(b$group_var)) env$data else env$data[as.character(env$data[[b$group_var]]) == glab[group_of(g)], , drop = FALSE]
    # HTMT on the measurement blocks (semTools), classic and HTMT2.
    htmt <- function(two) {
      out <- matrix(NA_real_, K, K)
      blocks <- which(vapply(seq_len(K), function(j) sum(ind_con == j - 1) >= 2 && !(j <= k0 && b$is_cov[j]) && !constructs[j] %in% b$composites, TRUE))
      if (length(blocks) < 2) return(out)
      if (!requireNamespace("semTools", quietly = TRUE)) { ps_note("HTMT could not be computed: the R package semTools is not installed."); return(out) }
      hm <- paste(vapply(blocks, function(j) paste(lv_lname[j], "=~", paste(ind_v[ind_con == j - 1], collapse = " + ")), ""), collapse = "\n")
      h <- ps_try((if (b$matrix_input) semTools::htmt(hm, sample.cov = if (is.list(b$inputs$S)) b$inputs$S[[group_of(g)]] else b$inputs$S, htmt2 = two)
        # Multiple imputation: the average over the imputed data sets.
        else if (isTRUE(b$mi)) Reduce(`+`, lapply(seq_along(env$imp), function(k) { dk <- env$imp[[k]]
          if (!is.null(g) && !is.null(b$group_var)) dk <- dk[as.character(dk[[b$group_var]]) == glab[group_of(g)], , drop = FALSE]
          semTools::htmt(hm, data = dk, htmt2 = two) })) / length(env$imp)
        else semTools::htmt(hm, data = gdata, htmt2 = two)), if (two) "HTMT2 (semTools::htmt)" else "HTMT (semTools::htmt)")
      if (is.null(h)) return(out)
      for (a in seq_along(blocks)) for (c in seq_along(blocks)) out[blocks[a], blocks[c]] <- h[lv_lname[blocks[a]], lv_lname[blocks[c]]]
      out
    }
    fm <- if (isTRUE(b$mi)) lavaan::fitMeasures(env$fit_mi) else if (exists("fit_baseline", envir = env, inherits = FALSE)) lavaan::fitMeasures(fit, baseline.model = env$fit_baseline) else lavaan::fitMeasures(fit)
    # Robust ML (rsem): the rescaled statistic TRML takes the place of the scaled chi-square.
    if (isTRUE(b$robust)) { t <- env$robust_fit$TRML[[1]]; fm[c("chisq.scaled", "df.scaled", "pvalue.scaled")] <- c(t[["Statistic"]], t[["df"]], t[["p-value"]]) }
    fmv <- as.list(fm[intersect(c("npar", "chisq", "df", "pvalue", "chisq.scaled", "df.scaled", "pvalue.scaled", "chisq.scaling.factor",
      "chisq.shift.parameter", "baseline.chisq", "baseline.df", "baseline.chisq.scaled", "cfi", "tli", "cfi.scaled", "tli.scaled",
      "cfi.robust", "tli.robust", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.pvalue", "rmsea.scaled", "rmsea.robust",
      "srmr", "logl", "aic", "bic"), names(fm))])
    vc <- if (isTRUE(b$robust)) unname(env$robust_se$vcov[[1]]) else if (isTRUE(b$mi)) { if (is.null(env$vcov_mi)) NULL else unname(unclass(env$vcov_mi)) }
      else ps_try(unclass(lavaan::lavInspect(fit, "vcov")), "The covariance matrix of the estimates (lavInspect vcov; used for Monte Carlo intervals)")
    n_in <- if (b$matrix_input) sum(b$inputs$N) else nrow(b$inputs$data)

    list(
      estimator = req$estimator,
      # How the standard errors were computed (lavaan's se option): standard, robust, cluster-robust, bootstrap.
      seType = as.character(fit@Options$se %||% "standard"),
      # Between clusters, n is the number of clusters.
      n = if (is.null(g)) lavaan::lavInspect(fit, "nobs") else if (between_block(g)) ps_per_group(lavaan::lavInspect(fit, "nclusters"), group_of(g))
        else lavaan::lavInspect(fit, "nobs")[group_of(g)],
      iterations = lavaan::lavInspect(fit, "iterations"), converged = lavaan::lavInspect(fit, "converged"),
      constructs = constructs,
      indicators = lapply(seq_along(indicators), function(i) list(name = indicators[i], construct = ind_con[i])),
      estimates = est, fit = lapply(fmv, as.numeric),
      r2Indicators = unname(r2_ind), r2Constructs = r2_con, stdLoadings = std_load,
      stdPaths = stdB, hasPath = has, stdTotal = total, stdIndirect = total - stdB,
      lvCor = unname(lvcor), reliability = rel, residualCor = unname(res), bifactor = Filter(Negate(is.null), bifactor),
      tech4 = if (!is.null(tech4)) { t4 <- tech4[[g %||% 1]]; t4$names <- nm(t4$names); t4 },
      sampleCor = if (!is.null(sampstat)) { s <- sampstat[[g %||% 1]]; s$names <- nm(s$names); s$thresholds$variable <- nm(s$thresholds$variable); s },
      tech10 = if (!is.null(tech10)) { t <- tech10[[g %||% 1]]; t$lhs <- nm(t$lhs); t$rhs <- nm(t$rhs); t },
      htmt = htmt(FALSE), htmt2 = htmt(TRUE), vcov = if (is.null(vc)) NULL else unname(vc),
      moderations = lapply(seq_along(mods), function(q) list(from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L)),
      wald = lapply(seq_along(env$wald), function(i) list(name = req$model$waldTests[[i]]$name, stat = unname(env$wald[[i]]$stat),
        df = unname(env$wald[[i]]$df), p = unname(env$wald[[i]]$p.value))),
      warnings = env$.warnings, droppedRows = n_in - sum(lavaan::lavInspect(fit, "nobs")),
      engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))
    )
  }
  out <- if (length(groups) > 1) {
    per <- lapply(seq_along(groups), map_group)
    # ICCs: of the (first) group's data when there are groups as well.
    icc <- if (levels2) { x <- lavaan::lavInspect(fit, "icc"); if (is.list(x)) x[[1]] else x } else NULL
    c(per[[1]], list(groups = list(labels = as.character(groups), results = per, score = if (levels2 || isTRUE(b$mi)) list() else ps_cb_score(fit, nm), levels = levels2,
      icc = if (levels2) as.list(setNames(as.numeric(icc), nm(names(icc)))) else NULL)))
  } else map_group(NULL)
  mi <- ps_cb_modindices(if (isTRUE(b$mi)) env$fit_mi else fit, nm, groups)
  out$modindices <- mi$items
  out$modindicesError <- mi$error
  out$modindicesNote <- mi$note
  if (isTRUE(b$mi)) out$imputations <- length(env$imp)
  # Robust ML (rsem): each analysed case's weight (below 1: down-weighted as atypical).
  if (isTRUE(b$robust)) out$caseWeights <- list(rows = env$case_row, weights = env$case_weight)
  ps_json(out)
}

#' (a placeholder guard: the baseline is not refitted with a NACOV matrix of several groups, which cannot arise)
matrix_groups_nacov <- function(inputs) is.list(inputs$S) && !is.null(inputs$NACOV)

#' One group's value of a per-group lavInspect result (a plain number with one group).
ps_per_group <- function(x, g) if (is.list(x)) x[[g]] else if (length(x) >= g) x[[g]] else x[[1]]

#' Modification indices (lavaan::modindices) at or above 3.84, largest first, in the app's names:
#' list(items, error), where error says why lavaan could not compute them (not the same as none reaching 3.84).
ps_cb_modindices <- function(fit, nm, groups) {
  err <- NULL
  # lavaan's modindices() ignores equality constraints and warns about it on every call: the table's
  # footnote says so instead (the score test under Groups covers the constraints themselves).
  constrained <- !inherits(fit, "lavaan.mi") && any(lavaan::parTable(fit)$op == "==")
  note <- if (constrained) "lavaan computes these ignoring the model's equality constraints (equal labels or invariance): read them with that in mind; the score test under Groups assesses releasing a constraint." else NULL
  # (lavaan.mi's pooled modification indices for multiply imputed data)
  mi <- tryCatch(if (inherits(fit, "lavaan.mi")) { x <- lavaan.mi::modindices.mi(fit); x <- x[x$mi >= 3.84, ]; head(x[order(-x$mi), ], 100) }
    else withCallingHandlers(lavaan::modindices(fit, sort. = TRUE, minimum.value = 3.84, maximum.number = 100),
      warning = function(w) if (grepl("ignores equality constraints", conditionMessage(w))) invokeRestart("muffleWarning")),
    error = function(e) { err <<- ps_comment(trimws(gsub("\\s+", " ", sub("^lavaan->modindices\\(\\):", "", conditionMessage(e))))); NULL })
  if (!is.null(err)) return(list(items = list(), error = err))
  if (is.null(mi) || !nrow(mi)) return(list(items = list(), error = NULL, note = note))
  mi <- mi[mi$op %in% c("=~", "~", "~~"), ]
  back <- function(x) { y <- nm(x); ifelse(is.na(y), x, y) }
  list(items = lapply(seq_len(nrow(mi)), function(i) list(lhs = back(mi$lhs[i]), op = mi$op[i], rhs = back(mi$rhs[i]), mi = mi$mi[i], epc = mi$epc[i],
    sepc = mi$sepc.all[i], group = if (length(groups) > 1 && "block" %in% names(mi)) as.character(groups[mi$block[i]])
      else if (length(groups) > 1 && "group" %in% names(mi)) as.character(groups[mi$group[i]]) else NULL)), error = NULL, note = note)
}

#' Score tests of releasing each equality constraint (lavaan::lavTestScore): which across-group
#' equality is worst (partial invariance).
ps_cb_score <- function(fit, nm) {
  # (Only with equality constraints across groups: without them there is nothing to release.)
  if (!any(lavaan::parTable(fit)$op == "==")) return(list())
  st <- ps_try(lavaan::lavTestScore(fit)$uni, "Score tests of the equality constraints (lavaan::lavTestScore)")
  if (is.null(st) || !nrow(st)) return(list())
  pt <- lavaan::parTable(fit)
  groups <- lavaan::lavInspect(fit, "group.label")
  back <- function(x) { y <- nm(x); ifelse(is.na(y), x, y) }
  what <- function(pl) {
    r <- pt[pt$plabel == pl, ][1, ]
    list(param = paste(back(r$lhs), r$op, if (r$op == "~1") "" else back(r$rhs)), group = as.character(groups[r$group]))
  }
  lapply(seq_len(nrow(st)), function(i) {
    a <- what(st$lhs[i]); z <- what(st$rhs[i])
    list(param = a$param, groups = c(a$group, z$group), x2 = st$X2[i], df = st$df[i], p = st$p.value[i])
  })
}

#' Measurement invariance across groups: the model at each level (configural,
#' metric, scalar, strict), with fit and chi-square difference tests between
#' successive levels (lavaan::lavTestLRT, scaled for robust estimators).
ps_invariance <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (is.null(req$model$multigroup)) stop("Choose a grouping column first.")
  if (identical(req$missing, "mi")) stop("The comparison of invariance levels is not available with multiple imputation; estimate each level in turn, or use FIML.")
  levels <- c("configural", "metric", "scalar", "strict")
  builds <- lapply(levels, function(l) { r <- req; r$model$multigroup$invariance <- l; r$model$waldTests <- NULL; ps_cb_build(r) })
  b <- builds[[1]]
  call_of <- function(x) grep("^fit <- sem\\(", x$body, value = TRUE)[1]
  pre <- b$body[seq_len(match(call_of(b), b$body) - 1)]
  body <- c(pre, "# The model at each level of measurement invariance",
    vapply(seq_along(levels), function(i) sub("^fit <- ", sprintf("fit_%s <- ", levels[i]), call_of(builds[[i]])), ""),
    "# Chi-square difference tests between successive levels",
    "lrt <- lavTestLRT(fit_configural, fit_metric, fit_scalar, fit_strict)")
  if (export) return(paste(ps_script("Measurement invariance (lavaan)", "lavaan", b$inputs, body,
    c("lrt", "sapply(list(configural = fit_configural, metric = fit_metric, scalar = fit_scalar, strict = fit_strict), fitMeasures, fit.measures = c(\"chisq\", \"df\", \"cfi\", \"rmsea\", \"srmr\"))")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  fits <- lapply(levels, function(l) env[[paste0("fit_", l)]])
  robust <- any(c("chisq.scaled") %in% names(lavaan::fitMeasures(fits[[1]])))
  fm <- lapply(fits, function(f) {
    m <- lavaan::fitMeasures(f)
    pick <- function(a, b) unname(if (robust && !is.na(m[b])) m[b] else m[a])
    list(chisq = pick("chisq", "chisq.scaled"), df = unname(m["df"]), cfi = pick("cfi", "cfi.robust"), rmsea = pick("rmsea", "rmsea.robust"), srmr = unname(m["srmr"]))
  })
  lrt <- env$lrt
  ps_json(list(robust = robust, levels = lapply(seq_along(levels), function(i) c(list(level = levels[i]), fm[[i]],
    if (i > 1) list(chisqDiff = unname(lrt[["Chisq diff"]][i]), dfDiff = unname(lrt[["Df diff"]][i]), p = unname(lrt[["Pr(>Chisq)"]][i]),
      cfiChange = fm[[i]]$cfi - fm[[i - 1]]$cfi, rmseaChange = fm[[i]]$rmsea - fm[[i - 1]]$rmsea))),
    warnings = env$.warnings))
}

#' CB-SEM with latent interactions estimated by LMS or QML (modsem): the same
#' result shape as ps_cb. LMS / QML have no chi-square for the full model; the
#' fit statistics reported are those of the model without interaction terms.
ps_cb_modsem <- function(req, b, export) {
  title <- sprintf("CB-SEM with latent interactions by %s (modsem)", toupper(b$modsem))
  if (export) return(paste(ps_script(title, c("modsem", "lavaan"), b$inputs, b$body,
    c("summary(fit, standardized = TRUE)", "standardized_estimates(fit)",
      "# Likelihood-ratio test of the interaction terms: the model against the same model without them",
      "h0 <- estimate_h0(fit, calc.se = FALSE)", "compare_fit(est_h1 = fit, est_h0 = h0)")), collapse = "\n"))
  env <- ps_run(b$body, b$inputs)
  fit <- env$fit
  n <- b$n; k0 <- b$k0; mods <- b$mods
  constructs <- c(n$cname, b$int_names)
  lv_lname <- unname(b$lname[constructs])
  indicators <- n$all_inds
  ind_v <- unname(n$iv[n$all_inds])
  owner <- function(i) which(vapply(n$inds, function(x) i %in% x, TRUE))[1]
  ind_con <- unname(vapply(n$all_inds, owner, 1L)) - 1L
  back <- c(setNames(constructs, lv_lname), setNames(indicators, ind_v))
  nm <- function(x) unname(back[x])
  is_lv <- function(x) x %in% lv_lname
  pe <- modsem::parameter_estimates(fit)
  st <- modsem::standardized_estimates(fit)
  key <- function(t) paste(t$lhs, t$op, t$rhs)
  pe$std <- st$est[match(key(pe), key(st))]
  V <- ps_try(vcov(fit), "The covariance matrix of the estimates (modsem vcov)")
  vn <- if (is.null(V)) character(0) else colnames(V)
  pe <- pe[pe$op %in% c("=~", "~", "~~"), ]
  est <- lapply(seq_len(nrow(pe)), function(i) {
    r <- pe[i, ]
    free <- !is.na(r$std.error) && r$std.error > 0
    kind <- if (r$op == "=~") { if (free) "loading" else "fixed-loading" } else if (r$op == "~") "regression"
      else if (is_lv(r$lhs) && is_lv(r$rhs)) "lvcov" else if (r$lhs == r$rhs) "residual" else "rescov"
    if (r$op == "~~" && !free) return(NULL)
    at <- match(paste0(r$lhs, r$op, r$rhs), vn)
    list(kind = kind, lhs = nm(r$lhs), op = r$op, rhs = nm(r$rhs), est = r$est,
      se = if (free) r$std.error else NULL, z = if (free) r$z.value else NULL, p = if (free) r$p.value else NULL,
      std = r$std, index = if (free && !is.na(at)) at - 1L else NULL)
  })
  est <- Filter(Negate(is.null), est)
  K <- length(constructs)
  stdB <- matrix(0, K, K); has <- matrix(FALSE, K, K)
  for (e in est) if (e$kind == "regression") { f <- match(e$rhs, constructs); t <- match(e$lhs, constructs); stdB[f, t] <- e$std; has[f, t] <- TRUE }
  total <- solve(diag(K) - stdB) - diag(K)
  std_load <- vapply(seq_along(indicators), function(i) {
    e <- Filter(function(x) x$op == "=~" && x$rhs == indicators[i] && x$lhs == constructs[ind_con[i] + 1], est)
    if (length(e)) e[[1]]$std else 1
  }, 0)
  # R-squared: one minus the standardised residual variance.
  std_res <- function(v) { r <- st[st$op == "~~" & st$lhs == v & st$rhs == v, ]; if (nrow(r)) 1 - r$est[1] else NA_real_ }
  r2_ind <- vapply(ind_v, std_res, 0)
  endo <- vapply(seq_len(K), function(j) any(has[, j]), TRUE)
  r2_con <- lapply(seq_len(K), function(j) if (endo[j]) std_res(lv_lname[j]) else NULL)
  lvcor <- diag(K)
  for (a in seq_len(K)) for (c in seq_len(K)) if (a != c) {
    r <- st[st$op == "~~" & ((st$lhs == lv_lname[a] & st$rhs == lv_lname[c]) | (st$lhs == lv_lname[c] & st$rhs == lv_lname[a])), ]
    lvcor[a, c] <- if (nrow(r)) r$est[1] else NA_real_
  }
  rel <- lapply(seq_len(K), function(j) {
    l <- std_load[ind_con == j - 1]
    if (!length(l)) return(list(cr = NULL, ave = NULL))
    list(cr = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)), ave = mean(l^2))
  })
  # modsem's chi-square-based fit measures of an LMS / QML model are not meaningful (the package warns
  # so on every call): as it advises, they are those of the baseline model without the interaction,
  # refitted with lavaan; AIC and BIC are the interaction model's own.
  fm <- ps_try(modsem::fit_modsem_da(fit, chisq = FALSE), "Fit measures (modsem::fit_modsem_da)")
  # The likelihood-ratio test of the interaction terms (modsem::compare_fit): the model against the
  # same model without them, refitted by the same method (modsem::estimate_h0).
  lrt <- ps_try({ h0 <- modsem::estimate_h0(fit, calc.se = FALSE); modsem::compare_fit(est_h1 = fit, est_h0 = h0) }, "Likelihood-ratio test of the interaction (modsem::compare_fit)")
  base <- ps_try(lavaan::fitMeasures(lavaan::sem(gsub("\\s*\\+\\s*[A-Za-z0-9_.]+:[A-Za-z0-9_.]+", "", env$model), data = env$data)), "Fit of the baseline model without the interaction (lavaan)")
  num1 <- function(x) if (is.null(x) || !length(x) || is.na(x[1])) NULL else as.numeric(x[1])
  fitv <- c(if (is.null(base)) list() else list(npar = num1(base["npar"]), chisq = num1(base["chisq"]), df = num1(base["df"]), pvalue = num1(base["pvalue"]),
      cfi = num1(base["cfi"]), tli = num1(base["tli"]), rmsea = num1(base["rmsea"]), rmsea.ci.lower = num1(base["rmsea.ci.lower"]), rmsea.ci.upper = num1(base["rmsea.ci.upper"]), srmr = num1(base["srmr"])),
    if (is.null(fm)) list() else list(aic = num1(fm$AIC), bic = num1(fm$BIC)))
  NAmat <- matrix(NA_real_, K, K)
  list(estimator = "ML", interaction = b$modsem, n = nrow(env$data), iterations = 0L, converged = TRUE,
    constructs = constructs, indicators = lapply(seq_along(indicators), function(i) list(name = indicators[i], construct = ind_con[i])),
    estimates = est, fit = fitv, r2Indicators = unname(r2_ind), r2Constructs = r2_con, stdLoadings = std_load,
    stdPaths = stdB, hasPath = has, stdTotal = total, stdIndirect = total - stdB, lvCor = unname(lvcor), reliability = rel,
    residualCor = matrix(NA_real_, length(ind_v), length(ind_v)), htmt = NAmat, htmt2 = NAmat, vcov = if (is.null(V)) NULL else unname(V),
    moderations = lapply(seq_along(mods), function(q) list(from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L)),
    wald = list(), modindices = list(), modindicesError = "lavaan's modification indices are not available for LMS / QML (modsem) models.",
    lrt = if (is.list(lrt) && !is.null(lrt$D)) list(D = num1(lrt$D), df = num1(lrt$df), p = num1(lrt$p), llChange = num1(lrt$llChange)) else NULL,
    fitNote = "Chi-square-based fit measures (chi-square, CFI, TLI, RMSEA, SRMR) are those of the baseline model without the interaction term, refitted with lavaan, as modsem advises; AIC and BIC are the interaction model's.",
    warnings = env$.warnings, droppedRows = 0L,
    engine = list(package = "modsem", version = as.character(utils::packageVersion("modsem"))))
}

#' Factor scores of the latent constructs (lavaan::lavPredict): regression
#' (Thurstone; what AMOS's factor-score imputation gives) or Bartlett, with the
#' data row of each score (rows dropped for missing values get none); with
#' scoreSe, each score's standard error (lavPredict se = "standard": for
#' regression scores the posterior SD, for Bartlett scores the SD of the error).
#' scoreMethod "plausible": plausible values (semTools::plausibleValues; Mplus
#' SAVEDATA FACTORS / PLAUSIBLE), draws from each case's distribution of the
#' factors given its data and the estimates (Asparouhov & Muthen 2010), for
#' secondary analyses that keep the scores' uncertainty.
ps_cb_scores <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  method <- req$scoreMethod %||% "regression"
  if (!method %in% c("regression", "Bartlett", "plausible")) stop("Invalid factor score method in the request.")
  b <- ps_cb_build(req)
  if (b$matrix_input) stop("Factor scores need raw data; this dataset is a covariance matrix.")
  if (isTRUE(b$robust)) stop("Factor scores are not available with robust ML (rsem), which fits robust moments; use ML or MLR.")
  if (isTRUE(b$mi)) stop("Factor scores are not available with multiple imputation (they would differ per imputed data set); use FIML.")
  if (!is.null(b$modsem)) stop("Factor scores are not available for LMS / QML models; use product indicators.")
  if (!is.null(b$cluster_var)) stop("Factor scores are not available for two-level models.")
  common <- c(
    "idx <- lavInspect(fit, \"case.idx\")",
    "if (!is.list(idx)) idx <- list(idx)",
    "rows <- unlist(lapply(idx, function(i) as.integer(rownames(data))[i]))")
  if (method == "plausible") {
    # (semTools draws them for complete data and continuous indicators only)
    if (!is.null(PS_LAVAAN_MISSING[[req$missing %||% ""]])) stop("Plausible values need complete cases: choose casewise deletion or mean replacement (semTools does not draw them with FIML, pairwise or two-stage missing data).")
    if (length(unlist(req$model$ordered))) stop("Plausible values are available for continuous indicators only (semTools); with ordinal indicators save the factor scores.")
    draws <- as.integer(ps_number(req$plausibleDraws %||% 5, "number of plausible values"))
    if (draws < 1 || draws > 100) stop("The number of plausible values must be between 1 and 100.")
    seed <- as.integer(ps_number(req$seed %||% 1234, "seed"))
    body <- c(b$body,
      sprintf("# %d plausible values of each factor per case (semTools::plausibleValues): draws from the", draws),
      "# distribution of the factors given the case's data and the estimates; case.idx gives each case's row in data.",
      "suppressPackageStartupMessages(library(semTools))",
      sprintf("pv <- plausibleValues(fit, nDraws = %d, seed = %d)", draws, seed),
      "rows <- as.integer(rownames(data))[pv[[1]]$case.idx]",
      "factors <- setdiff(names(pv[[1]]), c(\"case.idx\", lavInspect(fit, \"group\")))")
    if (export) return(paste(ps_script(sprintf("Plausible values (semTools, %d draws)", draws), c("lavaan", "semTools"), b$inputs, body, "head(cbind(row = rows, pv[[1]][factors]))"), collapse = "\n"))
    env <- ps_run(body, b$inputs)
    b <- ps_esem_align(b, env$fit)
    cons <- c(b$n$cname, b$int_names)
    back <- setNames(cons, unname(b$lname[cons]))
    f <- env$factors
    return(ps_json(list(method = method, names = unname(back[f]), rows = env$rows,
      draws = lapply(env$pv, function(d) lapply(f, function(k) unname(d[[k]]))),
      warnings = env$.warnings, engine = list(package = "semTools", version = as.character(utils::packageVersion("semTools"))))))
  }
  se <- isTRUE(req$scoreSe)
  body <- c(b$body,
    sprintf("# Factor scores (%s method) for the analysed cases%s; case.idx gives each case's row in data.", method, if (se) ", with their standard errors" else ""),
    sprintf("scores <- lavPredict(fit, method = \"%s\"%s)", method, if (se) ", se = \"standard\"" else ""),
    common,
    if (se) c(
      "# (one row of standard errors per group when every case has the same pattern of observed values)",
      "se <- attr(scores, \"se\")",
      "se <- do.call(rbind, lapply(seq_along(idx), function(g) { s <- se[[g]]; if (nrow(s) == 1) s[rep(1, length(idx[[g]])), , drop = FALSE] else s }))"),
    "if (!is.list(scores) || is.data.frame(scores)) scores <- list(scores)",
    "scores <- do.call(rbind, scores)")
  inputs <- b$inputs
  if (export) return(paste(ps_script(sprintf("Factor scores (lavaan, %s)", method), "lavaan", inputs, body, if (se) "head(cbind(row = rows, scores, se = se))" else "head(cbind(row = rows, scores))"), collapse = "\n"))
  env <- ps_run(body, inputs)
  b <- ps_esem_align(b, env$fit)
  cons <- c(b$n$cname, b$int_names)
  back <- setNames(cons, unname(b$lname[cons]))
  sc <- env$scores
  ps_json(c(list(method = method, names = unname(back[colnames(sc)]), rows = env$rows,
    scores = lapply(seq_len(ncol(sc)), function(j) unname(sc[, j]))),
    if (se) list(se = lapply(colnames(sc), function(k) unname(env$se[, k]))),
    list(warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan"))))))
}

#' Mplus TECH4: the model-implied means (with a mean structure), covariances and correlations of the
#' latent variables in each block (group or level), endogenous ones included (their total variance, not
#' the disturbance), with delta-method standard errors: the numerical Jacobian of the moments in the
#' free parameters (lavaan's own functions for the implied moments) and lavaan's covariance matrix of
#' the estimates, as lavaan computes the standard errors of defined (:=) parameters.
ps_tech4 <- function(fit, se = TRUE) {
  ns <- asNamespace("lavaan")
  M <- fit@Model
  means <- isTRUE(M@meanstructure)
  lv <- lavaan::lavInspect(fit, "cov.lv"); if (!is.list(lv)) lv <- list(lv)
  names_b <- lapply(lv, rownames)
  if (!sum(lengths(names_b))) return(NULL)
  low <- function(m) m[lower.tri(m, diag = TRUE)]
  moments <- function(x) {
    M2 <- ns$lav_model_set_parameters(M, x)
    V <- ns$lav_model_veta(M2, remove_dummy_lv = TRUE)
    E <- if (means) ns$lav_model_eeta(M2, NULL, fit@SampleStats, remove_dummy_lv = TRUE) else NULL
    unlist(lapply(seq_along(V), function(b) { v <- V[[b]]; r <- stats::cov2cor(v)
      c(if (means) as.numeric(E[[b]]), low(v), low(r)) }))
  }
  x <- ns$lav_model_get_parameters(M, type = "free")
  est <- moments(x)
  k <- lengths(names_b)
  if (length(est) != sum((if (means) k else 0) + k * (k + 1))) stop("the latent variables could not be matched to lavaan's")
  ses <- if (se) {
    V <- lavaan::lavInspect(fit, "vcov")
    J <- numDeriv::jacobian(moments, x)
    sqrt(pmax(diag(J %*% V %*% t(J)), 0))
  } else NULL
  # (moments held fixed, such as a reference group's latent means or a correlation's diagonal, get no standard error)
  if (!is.null(ses)) ses[ses < 1e-10] <- NA
  at <- 0
  take <- function(n) { i <- at + seq_len(n); at <<- at + n; list(est = est[i], se = if (is.null(ses)) NULL else ses[i]) }
  full <- function(v, kb) { if (is.null(v)) return(NULL); m <- matrix(NA_real_, kb, kb); m[lower.tri(m, diag = TRUE)] <- v; m[upper.tri(m)] <- t(m)[upper.tri(m)]; m }
  lapply(seq_along(names_b), function(b) {
    kb <- k[b]
    mu <- if (means) take(kb) else NULL
    cv <- take(kb * (kb + 1) / 2); cr <- take(kb * (kb + 1) / 2)
    list(names = names_b[[b]], mean = mu$est, meanSe = mu$se, cov = full(cv$est, kb), covSe = full(cv$se, kb), cor = full(cr$est, kb), corSe = full(cr$se, kb))
  })
}

#' Mplus SAMPSTAT for ordinal indicators: the sample statistics the model is fitted to, per group: the
#' correlation matrix of the indicators (polychoric between ordinal ones, polyserial between an ordinal and
#' a continuous one, Pearson between continuous ones) and the thresholds, in standard-normal units.
ps_sampstat <- function(fit) {
  s <- lavaan::lavInspect(fit, "sampstat")
  if (!is.null(s$cov)) s <- list(s)
  ord <- lavaan::lavNames(fit, "ov.ord")
  lapply(s, function(x) {
    R <- stats::cov2cor(unclass(x$cov))
    th <- unclass(x$th)
    list(names = rownames(R), ordinal = rownames(R) %in% ord, cor = unname(R),
      thresholds = list(variable = sub("\\|t[0-9]+$", "", names(th)), index = as.integer(sub(".*\\|t", "", names(th))), value = unname(as.numeric(th))))
  })
}

#' Mplus TECH10 (bivariate part): for each pair of ordinal indicators, the observed against the
#' model-implied two-way table of their categories (lavaan::lavTables), as Pearson X2 and likelihood-ratio
#' G2 with their df and p. A large value points to a pair the model does not reproduce: a local
#' dependency, a missing cross-loading or error correlation, or categories that do not follow the
#' bivariate normal distribution the polychoric correlation assumes. One list per group.
ps_tech10 <- function(fit) {
  tb <- lavaan::lavTables(fit, dimension = 2L, type = "table", statistic = c("X2", "G2"), p_value = TRUE)
  if (is.null(tb) || !nrow(tb)) return(NULL)
  lapply(seq_len(lavaan::lavInspect(fit, "ngroups")), function(g) {
    t <- if ("group" %in% names(tb)) tb[tb$group == g, , drop = FALSE] else tb
    list(lhs = as.character(t$lhs), rhs = as.character(t$rhs), df = as.numeric(t$df), x2 = as.numeric(t$X2), x2p = as.numeric(t$X2.pval),
      g2 = as.numeric(t$G2), g2p = as.numeric(t$G2.pval))
  })
}

#' ESEM blocks: lavaan orders a block's rotated factors by its own rule (order.lv.by), and a bifactor
#' rotation's general factor need not come first, so each of the app's factors is matched to the rotated
#' column that carries it, and the app's names follow the columns (b$lname permuted within the block).
#' A bifactor block's general factor (its first) takes the column with the largest sum of squared
#' loadings; every other factor the column on which its own (drawn) indicators load most: the
#' permutation with the largest total, lavaan's order on a tie.
ps_esem_align <- function(b, fit) {
  if (!length(b$esem_blocks)) return(b)
  std <- lavaan::lavInspect(fit, "std")
  L <- if (is.matrix(std$lambda)) std$lambda else std[[1]]$lambda
  for (fs in b$esem_blocks) {
    k <- length(fs)
    if (k > 8) next
    js <- match(fs, b$n$cname)
    ln <- unname(b$lname[fs])
    own <- lapply(js, function(j) unname(b$n$iv[b$n$inds[[j]]]))
    A <- L[unique(unlist(own)), ln, drop = FALSE]^2
    # score[f, c]: the squared loadings of factor f's own indicators on column c
    score <- t(vapply(own, function(ii) colSums(A[ii, , drop = FALSE]), numeric(k)))
    # The general factor: the column without near-zero loadings (the largest product of squared loadings; the
    # largest sum would pick a strong specific factor, as in Mplus's example 5.29).
    if (isTRUE(b$bifactor)) score[1, ] <- 1e6 * rank(colSums(log(pmax(A, 1e-12))))
    P <- ps_perms(k)
    best <- P[which.max(apply(P, 1, function(p) sum(score[cbind(seq_len(k), p)]))), ]
    b$lname[fs] <- ln[best]
  }
  b
}

#' All permutations of 1..n, one per row, the identity first.
ps_perms <- function(n) {
  if (n <= 1) return(matrix(seq_len(n), 1))
  do.call(rbind, lapply(seq_len(n), function(i) { r <- setdiff(seq_len(n), i); cbind(i, matrix(r[ps_perms(n - 1)], ncol = n - 1)) }))
}

#' Bifactor indices of an ESEM block (fs: the app's factors, general first) from the standardised
#' solution (Rodriguez, Reise & Haviland 2016): ECV, the general factor's share of the common variance;
#' omega and omega hierarchical of the total score of the block's indicators; for each specific factor,
#' omega and omega hierarchical subscale (omegaHS) of the sum of its own (drawn) indicators. The total
#' variance is the model-implied one (residual covariances included); a specific factor's omegaHS counts
#' its own variance only, also when the specific factors correlate (oblique bifactor rotation).
ps_bifactor <- function(fit, g, b, fs) {
  std <- lavaan::lavInspect(fit, "std")
  if (!is.matrix(std$lambda)) std <- std[[g %||% 1]]
  P <- lavaan::lavInspect(fit, "cor.lv"); if (is.list(P)) P <- P[[g %||% 1]]
  lv <- unname(b$lname[fs])
  own <- lapply(match(fs, b$n$cname), function(j) unname(b$n$iv[b$n$inds[[j]]]))
  inds <- unique(unlist(own))
  L <- std$lambda[inds, lv, drop = FALSE]
  P <- P[lv, lv]
  C <- L %*% P %*% t(L)
  S <- C + std$theta[inds, inds, drop = FALSE]
  part <- function(ii, k) { tot <- sum(S[ii, ii]); list(omega = sum(C[ii, ii]) / tot, omegaH = sum(L[ii, k])^2 * P[k, k] / tot) }
  all <- part(inds, 1)
  list(general = fs[1], items = length(inds), ecv = sum(L[, 1]^2) / sum(L^2), omega = all$omega, omegaH = all$omegaH,
    specific = lapply(seq_along(fs)[-1], function(k) { s <- part(own[[k]], k); list(factor = fs[k], omega = s$omega, omegaHS = s$omegaH, items = length(own[[k]])) }))
}

#' Correlation residuals (lavaan's "cor.bollen": each matrix standardised by its own
#' variances) from the saturated and the model-implied moments, per group. For the
#' two-stage approach, where lavResiduals needs an h1 ACOV that lavaan does not have.
ps_cor_residuals <- function(fit) {
  S <- lavaan::lavInspect(fit, "sampstat"); I <- lavaan::lavInspect(fit, "implied")
  one <- function(s, i) list(cov = stats::cov2cor(s$cov) - stats::cov2cor(i$cov[rownames(s$cov), colnames(s$cov)]))
  if (!is.null(S$cov)) one(S, I) else Map(one, S, I)
}

# ---------- CB-SEM extras: Bollen-Stine p, pairwise parameter comparisons, factor score weights ----------

#' lavaan names back to the app's (constructs, interaction terms, indicators).
ps_cb_back <- function(b) {
  constructs <- c(b$n$cname, b$int_names)
  c(setNames(constructs, unname(b$lname[constructs])), setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds])))
}

#' Models these analyses cannot use (each says why).
ps_cb_plain <- function(b, what, raw = TRUE) {
  if (raw && b$matrix_input) stop(sprintf("%s needs raw data; this dataset is a covariance matrix.", what))
  if (isTRUE(b$mi)) stop(sprintf("%s is not available with multiple imputation; use FIML or casewise deletion.", what))
  if (isTRUE(b$robust)) stop(sprintf("%s is not available with robust ML (rsem); choose ML or MLR.", what))
  if (!is.null(b$modsem)) stop(sprintf("%s is not available for LMS / QML models.", what))
  if (!is.null(b$cluster_var)) stop(sprintf("%s is not available for two-level models.", what))
}

#' Bollen-Stine bootstrap p-value of the chi-square test (lavaan, test = "bollen.stine"):
#' the data are transformed so that the model holds exactly, resampled, and the model
#' refitted to each sample; p is the share of bootstrap chi-squares at least as large as the observed.
ps_cb_bollen_stine <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "The Bollen-Stine bootstrap")
  if (!grepl("^fit <- sem\\(.*\\)$", b$call)) stop("The Bollen-Stine bootstrap is not available for this model.")
  if (length(unlist(req$model$ordered))) stop("The Bollen-Stine bootstrap is for continuous indicators; with ordinal indicators (WLSMV) use the robust chi-square test.")
  B <- as.integer(ps_number(req$boot$samples, "bootstrap samples")); seed <- as.integer(ps_number(req$boot$seed, "seed"))
  if (is.na(B) || B < 10L || B > 100000L) stop("The number of bootstrap samples must be between 10 and 100000.")
  body <- c(b$body,
    "# Bollen-Stine bootstrap of the chi-square test (Bollen & Stine 1992): the data are transformed so",
    "# that the model fits exactly, resampled, and the model refitted to each sample.",
    sprintf("set.seed(%d)", seed),
    sprintf("fit_bs <- %s", sub("\\)$", sprintf(", test = \"bollen.stine\", bootstrap = %d)", B), sub("^fit <- ", "", b$call))),
    "bs <- lavInspect(fit_bs, \"test\")$bollen.stine",
    "boot_chisq <- attr(bs, \"boot.T\") %||% bs$boot.T")
  if (export) return(paste(ps_script(sprintf("Bollen-Stine bootstrap, %d samples (lavaan)", B), "lavaan", b$inputs, body, "print(bs[c(\"stat\", \"df\", \"pvalue\")])"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  bs <- env$bs; boot <- env$boot_chisq
  ps_json(list(chisq = bs$stat, df = bs$df, p = bs$pvalue, samples = B,
    valid = if (is.null(boot)) NULL else sum(is.finite(boot)), boot = if (is.null(boot)) NULL else I(unname(as.numeric(boot))),
    mlChisq = unname(fitMeasures(env$fit, "chisq")), warnings = env$.warnings,
    engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}

#' Pairwise comparisons of free parameters (AMOS's critical ratios for differences):
#' z = (a - b) / sqrt(var(a) + var(b) - 2 cov(a, b)) from the covariance matrix of the estimates.
ps_cb_compare_params <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Comparing parameters", raw = FALSE)
  kinds <- intersect(unlist(req$kinds), c("paths", "loadings", "variances", "covariances"))
  if (!length(kinds)) stop("Choose which parameters to compare.")
  ops <- c(paths = "~", loadings = "=~")
  body <- c(b$body,
    "# Free parameters of the chosen kinds and the covariance matrix of their estimates.",
    "pt <- parTable(fit)",
    sprintf("kinds <- %s", ps_q(kinds)),
    "keep <- pt$free > 0 & ((\"paths\" %in% kinds & pt$op == \"~\") | (\"loadings\" %in% kinds & pt$op == \"=~\") |",
    "  (\"variances\" %in% kinds & pt$op == \"~~\" & pt$lhs == pt$rhs) | (\"covariances\" %in% kinds & pt$op == \"~~\" & pt$lhs != pt$rhs))",
    "sel <- pt[keep, ]",
    "# Parameters held equal share one free parameter: keep the first.",
    "sel <- sel[!duplicated(sel$free), ]",
    "V <- vcov(fit)[sel$free, sel$free, drop = FALSE]",
    "d <- outer(sel$est, sel$est, \"-\")",
    "se <- sqrt(pmax(outer(diag(V), diag(V), \"+\") - 2 * V, 0))",
    "z <- d / se; diag(z) <- NA",
    "rownames(z) <- colnames(z) <- paste(sel$lhs, sel$op, sel$rhs, if (max(sel$group) > 1) paste0(\"@\", sel$group) else \"\")")
  if (export) return(paste(ps_script("Pairwise parameter comparisons (critical ratios for differences)", "lavaan", b$inputs, body, "print(round(z, 3))"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  sel <- env$sel; back <- ps_cb_back(ps_esem_align(b, env$fit))
  nm <- function(x) ifelse(x %in% names(back), unname(back[x]), x)
  label <- ifelse(sel$op == "~", paste(nm(sel$rhs), "→", nm(sel$lhs)),
    ifelse(sel$op == "=~", paste(nm(sel$lhs), "→", nm(sel$rhs)),
      ifelse(sel$lhs == sel$rhs, paste("Variance of", nm(sel$lhs)), paste(nm(sel$lhs), "↔", nm(sel$rhs)))))
  if (max(sel$group) > 1) label <- paste0(label, " (group ", sel$group, ")")
  z <- env$z
  ps_json(list(params = lapply(seq_len(nrow(sel)), function(i) list(label = label[i], est = sel$est[i], kind = switch(sel$op[i], "~" = "path", "=~" = "loading", if (sel$lhs[i] == sel$rhs[i]) "variance" else "covariance"))),
    z = if (length(z)) lapply(seq_len(nrow(z)), function(i) I(unname(z[i, ]))) else list(), warnings = env$.warnings,
    engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}

#' Factor score weights: how each latent variable's score is computed from the observed
#' variables. Regression (Thurstone; AMOS's factor score weights): Phi Lambda' Sigma^-1;
#' Bartlett: (Lambda' Theta^-1 Lambda)^-1 Lambda' Theta^-1. Model-implied matrices.
ps_cb_score_weights <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Factor score weights", raw = FALSE)
  if (!is.null(b$group_var)) stop("Factor score weights are shown for one group: remove the grouping (or analyse each group's data).")
  if (length(unlist(req$model$ordered))) stop("Factor score weights are for continuous indicators.")
  if (length(b$composites)) stop("Factor score weights are for common factors; the model has composites (<~).")
  method <- req[["method", exact = TRUE]]
  if (!identical(method, "Bartlett")) method <- "regression"
  body <- c(b$body,
    "L <- lavInspect(fit, \"est\")$lambda          # loadings (observed x latent)",
    "Sigma <- lavInspect(fit, \"cov.ov\")[rownames(L), rownames(L)]  # model-implied covariances",
    if (method == "regression") c(
      "# Regression (Thurstone) weights: latent covariances x loadings' x inverse implied covariances.",
      "Phi <- lavInspect(fit, \"cov.lv\")[colnames(L), colnames(L)]",
      "W <- Phi %*% t(L) %*% solve(Sigma)")
    else c(
      "# Bartlett weights: (L' Theta^-1 L)^-1 L' Theta^-1.",
      "Ti <- solve(lavInspect(fit, \"est\")$theta[rownames(L), rownames(L)])",
      "W <- solve(t(L) %*% Ti %*% L) %*% t(L) %*% Ti"),
    "dimnames(W) <- list(colnames(L), rownames(L))")
  if (export) return(paste(ps_script(sprintf("Factor score weights (%s)", method), "lavaan", b$inputs, body, "print(round(W, 4))"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  W <- env$W; back <- ps_cb_back(ps_esem_align(b, env$fit))
  nm <- function(x) ifelse(x %in% names(back), unname(back[x]), x)
  ps_json(list(method = method, factors = I(nm(rownames(W))), variables = I(nm(colnames(W))),
    weights = lapply(seq_len(nrow(W)), function(i) I(unname(W[i, ]))), warnings = env$.warnings,
    engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}

#' Mplus MODEL syntax converted to lavaan syntax (lavaan::mplus2lavaan.modelSyntax):
#' text in, text out; nothing is evaluated.
ps_mplus_syntax <- function(req_json) {
  req <- ps_parse(req_json)
  syntax <- req$syntax
  if (!is.character(syntax) || length(syntax) != 1 || nchar(syntax) > 20000) stop("Invalid Mplus syntax in the request.")
  # (only the MODEL section is converted: keep what follows MODEL: when the whole input file was pasted)
  m <- regmatches(syntax, regexpr("(?is)MODEL\\s*:(.*?)(?=\\n\\s*(MODEL\\s+(CONSTRAINT|TEST|INDIRECT|PRIORS)|OUTPUT|SAVEDATA|PLOT|MONTECARLO)\\s*:|$)", syntax, perl = TRUE))
  if (length(m)) syntax <- sub("(?is)^MODEL\\s*:", "", m, perl = TRUE)
  out <- lavaan::mplus2lavaan.modelSyntax(syntax)
  ps_json(list(syntax = paste(out, collapse = "\n")))
}
