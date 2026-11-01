# PLS Studio <-> lavaan. Builds the lavaan script for the diagram (JSON
# request), runs it, and returns what the app's CB-SEM views need, with the
# user's names restored. ps_cb(req, export = TRUE) returns the script instead.
# All estimation is lavaan's; this file only writes code and shapes output.

#' "1*a + b + c": the marker loading fixed to 1, made explicit.
#' Loadings of a factor: the marker fixed to 1 (or to the user's value), other user-fixed loadings as value*name.
ps_marked <- function(v, fixed = list(), labels = list()) {
  pre <- vapply(v, function(x) if (!is.null(fixed[[x]])) paste0(ps_num(fixed[[x]]), "*") else if (!is.null(labels[[x]])) paste0(ps_label(labels[[x]]), "*") else "", "")
  pre[1] <- if (nzchar(pre[1])) pre[1] else "1*"
  paste(paste0(pre, v), collapse = " + ")
}

ps_cb_build <- function(req) {
  cons <- req$model$constructs
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
    robust_nacov <- req$estimator %in% c("MLM", "MLMV") && !is.null(mo$nacov)
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
    if (!rot %in% c("geomin", "oblimin", "quartimin", "varimax", "target")) stop("Invalid rotation in the request.")
    # geomin's epsilon (lavaan 0.001; Mplus 0.0001 for two factors, 0.001 for three, 0.01 for four or more)
    eps <- esem$epsilon
    if (!is.null(eps) && !(is.numeric(eps) && length(eps) == 1 && eps > 0 && eps <= 1)) stop("Invalid geomin epsilon in the request.")
    if (!is.null(target)) inputs$TARGET <- target
  }
  rel_inds <- character(0); composites <- character(0)
  for (j in seq_len(k0)) {
    if (is_cov[j] || n$cname[j] %in% in_block) next
    # The first loading of each factor is fixed to 1 (marker / scaling indicator); written explicitly.
    if (length(comps[[j]])) {
      # Component loadings held at values (a latent curve: 1, 1, 1 and 0, 1, 2), keyed by the components' lavaan names.
      cl <- cons[[j]]$componentLoadings %||% list()
      fixed_c <- setNames(cl, unname(lname[names(cl)]))
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(lname[comps[[j]]], fixed_c)))
    }
    else {
      v <- unname(n$iv[n$inds[[j]]])
      fl <- cons[[j]]$fixedLoadings %||% list()
      fixed <- setNames(fl, unname(n$iv[names(fl)]))
      ll <- cons[[j]]$loadingLabels %||% list()
      # The marker's 1 is fixed: a label on it would have no effect.
      ll <- ll[names(ll) != n$inds[[j]][1]]
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
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(v, fixed, labels)))
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
      if (length(v) == 1) {
        rel <- cons[[j]]$reliability
        if (is.null(rel)) lines <- c(lines, paste0(v, " ~~ 0*", v, "   # single indicator: no measurement error"))
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
  seen <- character(0)
  for (cv in req$model$covariances) {
    a <- if (cv$kind == "construct") lname[[cv$a]] else n$iv[[cv$a]]
    b <- if (cv$kind == "construct") lname[[cv$b]] else n$iv[[cv$b]]
    key <- paste(sort(c(a, b)), collapse = "~~")
    if (key %in% seen) next  # lavaan rejects a covariance listed twice (in either order)
    seen <- c(seen, key)
    # A fixed zero makes two exogenous factors uncorrelated (lavaan frees them by default).
    lines <- c(lines, paste(a, "~~", if (isTRUE(cv$zero)) paste0("0*", b) else if (!is.null(cv$fixed)) paste0(ps_num(cv$fixed), "*", b)
      else if (!is.null(cv$label)) paste0(ps_label(cv$label), "*", b) else b))
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
      term <- if (!is.null(mt$fixed)) paste0(ps_num(mt$fixed), "*1") else if (!is.null(mt$label)) paste0(ps_label(mt$label), "*1") else "1"
      lines <- c(lines, paste(lv, "~", term))
      # (a higher-order factor's mean is identified by its components' fixed intercepts: no marker rule here)
      if (is.null(mt$fixed) && !is_cov[j] && length(n$inds[[j]]) && !length(comps[[j]])) {
        # The marker's intercept: 0 identifies the latent mean in the marker's units; a known measurement bias instead
        # (Hayduk 1987, ch. 9: the indicator reads the concept plus this much), one value per group when given so.
        bias <- unlist(mt$bias)
        if (is.null(bias)) at <- "0"
        else {
          bias <- vapply(bias, ps_number, 0, "bias")
          if (length(bias) > 1 && length(bias) != n_groups) stop("A marker intercept per group needs one value per group.")
          at <- if (length(bias) > 1) sprintf("c(%s)", paste(vapply(bias, ps_num, ""), collapse = ", ")) else ps_num(bias)
        }
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
      if (ov %in% rel_inds) next
      lines <- c(lines, paste0(lname[[j]], " ~ 1"), paste0(ov, " ~ 0*1   # the intercept of ", lname[[j]], " (an observed variable)"))
      obs_single[unname(lname[[j]])] <- ov
    }
  }
  # Defined parameters (functions of labelled parameters, with delta-method standard errors).
  defs <- vapply(req$model$defined, function(d) paste(ps_label(d$name), ":=", ps_expr(d$expr)), "")
  # Inequality constraints on labelled parameters (each side checked as an expression).
  defs <- c(defs, vapply(unlist(req$model$inequalities), function(h) {
    op <- regmatches(h, regexpr("[<>]", h))
    parts <- strsplit(h, "[<>]")[[1]]
    if (length(op) != 1 || length(parts) != 2 || grepl("=", h, fixed = TRUE)) stop("Invalid inequality in the request.")
    paste(ps_expr(trimws(parts[1])), op, ps_expr(trimws(parts[2])))
  }, ""))
  # (In a two-level model they follow the level blocks: defined once, not per level.)
  if (is.null(cluster_var)) lines <- c(lines, defs)
  # Two-level: the model within clusters; between clusters the same structure (factors named *_b)
  # or a saturated model (all variances and covariances of the observed variables free).
  if (!is.null(cluster_var)) {
    if (!(ml$between %||% "saturated") %in% c("same", "saturated")) stop("Invalid between-level model in the request.")
    if (identical(ml$between, "same")) {
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
      unlist(lapply(gv, function(v) c(sprintf("group: %s", format(v)), paste0("  ", lv_block))))
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
      else if (identical(f$kind, "intercept")) paste0(n$iv[[f$indicator]], "~1")
      else if (identical(f$kind, "regression")) paste0(lname[[f$to]], "~", lname[[f$from]])
      else if (identical(f$kind, "mean")) paste0(lname[[f$construct]], "~1")
    }))
    extra <- paste0(extra, if (!is.null(group_var)) sprintf(", group = \"%s\"", group_var) else "",
      if (length(equal)) sprintf(", group.equal = %s", ps_q(equal)) else "",
      if (length(partial)) sprintf(", group.partial = %s", ps_q(partial)) else "")
  }
  if (means_on) extra <- paste0(extra, ", meanstructure = TRUE")
  # Groups without means and intercepts (Mplus MODEL = NOMEANSTRUCTURE; lavaan adds them to every multiple-group model).
  if ((!is.null(group_var) || matrix_groups) && identical(mg$meanStructure, FALSE)) {
    if (means_on) stop("Groups without a mean structure cannot have means or intercepts (remove the constant).")
    if ((mg$invariance %||% "configural") %in% c("scalar", "strict")) stop("Scalar and strict invariance hold intercepts equal: they need the mean structure.")
    extra <- paste0(extra, ", meanstructure = FALSE")
  }
  # Standard errors from the observed information (the Hessian; Mplus's default for ML) instead of lavaan's expected information.
  if (!is.null(req$model$information)) {
    if (!identical(req$model$information, "observed")) stop("Invalid information in the request.")
    extra <- paste0(extra, ", information = \"observed\"")
  }
  # The diagram is the model: the disturbances of two endogenous constructs covary only when drawn
  # (lavaan's sem() would otherwise free every such covariance, auto.cov.y).
  extra <- paste0(extra, ", auto.cov.y = FALSE", bounds)
  if (length(esem$blocks)) {
    rargs <- c(if (!is.null(target)) "target = TARGET", if (!is.null(eps) && rot == "geomin") sprintf("geomin.epsilon = %s", format(eps, scientific = FALSE)))
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
  call <- if (matrix_input) sprintf("fit <- sem(model, sample.cov = S, sample.nobs = N%s%s, estimator = \"%s\"%s)", if (!is.null(inputs$NACOV)) ", NACOV = NACOV" else "", if (means_on) ", sample.mean = M" else "", req$estimator, extra)
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
    body[1] <- "suppressPackageStartupMessages({ library(lavaan); library(mice); library(lavaan.mi) })"
    call <- c(
      if (!is.null(group_var)) c("# The grouping column is categorical: mice uses it as a factor.", sprintf("data$%s <- factor(data$%s)", group_var, group_var)),
      sprintf("# Multiple imputation by chained equations (mice, predictive mean matching), %d imputed data sets.", ms$m),
      sprintf("imp <- mice(data, m = %d, seed = %d, printFlag = FALSE)", ms$m, ms$seed),
      "# The model in every imputed data set, pooled by Rubin's rules (lavaan.mi).",
      sprintf("fit_mi <- sem.mi(model, data = imp, estimator = \"%s\"%s)", req$estimator, extra),
      "# Pooled covariance matrix of the estimates (lavaan.mi: (1 + ARIV) times the mean within-imputation matrix, which its SEs use).",
      "# Where lavaan.mi's S4 vcov method is not dispatched (R in the browser), the same matrix from the per-imputation fits.",
      "vcov_mi <- tryCatch(vcov(fit_mi), error = function(e) {",
      sprintf("  fits <- lapply(seq_len(imp$m), function(k) sem(model, data = complete(imp, k), estimator = \"%s\"%s))", req$estimator, extra),
      "  # (as lavaan.mi's vcov: equality constraints counted out, a generalised inverse when there are any)",
      "  pt <- lavaan::parTable(fits[[1]]); ncon <- sum(pt$op == \"==\"); npar <- max(pt$free) - ncon",
      "  keep <- pt$free > 0L & !duplicated(pt$free)",
      "  B <- stats::cov(do.call(rbind, lapply(fits, function(x) lavaan::parTable(x)$est[keep])))",
      "  W <- Reduce(`+`, lapply(fits, function(x) unclass(lavaan::lavInspect(x, \"vcov\")))) / imp$m",
      "  inv <- if (ncon == 0) tryCatch(solve(W), error = function(e) MASS::ginv(W)) else MASS::ginv(W)",
      "  (1 + (1 + 1 / imp$m) / npar * sum(diag(B %*% inv))) * W",
      "})",
      "# (The model fitted to the first imputed data set: only its structure is used.)",
      sprintf("fit <- sem(model, data = complete(imp, 1), estimator = \"%s\"%s)", req$estimator, extra))
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
  # out when there are two or more of them, and fitMeasures() is told to use it.
  to_ids <- vapply(req$model$paths, function(p) p$to, "")
  xlike <- unlist(lapply(seq_len(k0), function(j) if (!is_cov[j] && length(n$inds[[j]]) == 1 && is.null(cons[[j]]$reliability) && !(n$cname[j] %in% to_ids) && !length(comps[[j]]) && !(n$cname[j] %in% in_block)) unname(n$iv[[n$inds[[j]][1]]]) else NULL))
  baseline <- character(0)
  if (length(xlike) >= 2 && !mi && !length(ordered) && !length(esem$blocks) && is.null(cluster_var) && !matrix_groups_nacov(inputs)) {
    ov <- unname(n$iv[n$all_inds])
    pairs <- combn(xlike, 2)
    bmodel <- c(paste(ov, "~~", ov), paste(pairs[1, ], "~~", pairs[2, ]), if (means_on) paste(ov, "~ 1"))
    bcall <- sub("^fit <- sem\\(model", "fit_baseline <- sem(baseline_model", call)
    for (drop in c(", group\\.equal = c\\([^)]*\\)", ", group\\.partial = c\\([^)]*\\)", ", bounds = \"pos\\.var\"")) bcall <- gsub(drop, "", bcall)
    baseline <- c("# The baseline model for CFI and TLI: as lavaan's for observed variables, the covariances among the",
      "# exogenous observed variables stay free", "baseline_model <- '", paste0("  ", bmodel), "'", bcall)
  }
  # (the baseline lines travel separately: every other user of this body expects the fit call last)
  body <- c(body, "model <- '", paste0("  ", lines), "'", call, wald)
  list(n = n, k0 = k0, comps = comps, is_cov = is_cov, lname = lname, mods = mods, means = means_on, int_names = int_names, prod = prod,
    inputs = inputs, body = body, baseline = baseline, matrix_input = matrix_input, group_var = group_var, cluster_var = cluster_var, call = call, robust = robust, mi = mi, rel_inds = rel_inds, composites = composites, obs_single = obs_single)
}

ps_cb <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (!is.null(b$modsem)) { r <- ps_cb_modsem(req, b, export); return(if (export) r else ps_json(r)) }
  body <- c(b$body, b$baseline)
  if (export) {
    return(paste(ps_script("CB-SEM (lavaan)", "lavaan", b$inputs, body,
      c(if (length(b$baseline)) "summary(fit, standardized = TRUE, rsquare = TRUE); fitMeasures(fit, baseline.model = fit_baseline)" else "summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)")), collapse = "\n"))
  }
  env <- ps_run(body, b$inputs)
  fit <- env$fit
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
  back <- c(setNames(constructs, lv_lname), setNames(constructs, paste0(lv_lname, "_b")), setNames(indicators, ind_v))
  is_lv <- function(x) x %in% c(lv_lname, paste0(lv_lname, "_b"))
  # (an observed covariate is its own lavaan name: its "~1" is an intercept, not a latent mean)
  latent_names <- { lv <- unname(b$lname[!b$is_cov]); c(lv, paste0(lv, "_b")) }
  nm <- function(x) unname(back[x])

  levels2 <- !is.null(b$cluster_var)
  glab <- lavaan::lavInspect(fit, "group.label")
  # Blocks: groups, levels, or both (block = (group - 1) * 2 + level, as lavaan numbers them).
  groups <- if (levels2 && length(glab) > 1) as.vector(t(outer(glab, c("Within", "Between"), paste, sep = " · ")))
    else if (levels2) c("Within", "Between") else glab
  between_block <- function(g) levels2 && !is.null(g) && g %% 2 == 0
  group_of <- function(g) if (levels2) (g + 1) %/% 2 else g
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
    pe <- pe[pe$op %in% c("=~", "<~", "~", "~~", "|", ":=") | (pe$op == "~1" & (isTRUE(b$means) | (pe$lhs %in% lv_lname & !is.na(pe$free) & pe$free > 0))), ]
    est <- lapply(seq_len(nrow(pe)), function(i) {
      r <- pe[i, ]; free <- r$free > 0
      # (an observed variable's intercept is its construct's: the indicator's, fixed at 0, is not listed)
      if (r$op == "~1" && r$lhs %in% unname(b$obs_single)) return(NULL)
      kind <- if (r$op == "~1") { if (r$lhs %in% latent_names && !r$lhs %in% names(b$obs_single)) "mean" else "intercept" } else if (r$op == ":=") "defined" else if (r$op == "|") "threshold"
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
      list(kind = kind, lhs = nm(r$lhs), op = r$op, rhs = if (r$op %in% c("|", "~1")) r$rhs else nm(r$rhs), est = r$est,
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
        inds <- pt$rhs[pt$op == "=~" & pt$lhs %in% facs]
        fixed <- pt[pt$op == "~~" & pt$lhs == pt$rhs & pt$free == 0 & !is.na(pt$ustart) & pt$lhs %in% inds, ]
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
      v <- if (is.list(x)) x[[name]] else NULL
      if (is.null(v)) return(NULL)
      v <- as.numeric(unclass(v))
      if (length(v) > 1) v[if (is.null(g)) 1 else group_of(g)] else v
    }
    rel <- lapply(seq_len(K), function(j) {
      l <- std_load[ind_con == j - 1]
      if (!length(l) || (j <= k0 && length(comps[[j]])) || constructs[j] %in% b$composites) return(list(cr = NULL, ave = NULL))
      list(cr = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)), ave = mean(l^2), omega = per_group(omega, lv_lname[j]), alpha = per_group(alpha, lv_lname[j]))
    })
    rr <- if (isTRUE(b$mi)) lavaan.mi::lavResiduals.mi(env$fit_mi, type = "cor.bollen")
      else if (isTRUE(req$missing %in% c("twostage", "robusttwostage"))) ps_cor_residuals(fit)
      else lavaan::lavResiduals(fit, type = "cor.bollen", summary = FALSE)
    res <- (if (is.null(g)) rr$cov else rr[[g]]$cov)[ind_v, ind_v]
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
        else if (isTRUE(b$mi)) Reduce(`+`, lapply(seq_len(env$imp$m), function(k) { dk <- mice::complete(env$imp, k)
          if (!is.null(g) && !is.null(b$group_var)) dk <- dk[as.character(dk[[b$group_var]]) == glab[group_of(g)], , drop = FALSE]
          semTools::htmt(hm, data = dk, htmt2 = two) })) / env$imp$m
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
      lvCor = unname(lvcor), reliability = rel, residualCor = unname(res),
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
  if (isTRUE(b$mi)) out$imputations <- env$imp$m
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
#' data row of each score (rows dropped for missing values get none).
ps_cb_scores <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  method <- req$scoreMethod %||% "regression"
  if (!method %in% c("regression", "Bartlett")) stop("Invalid factor score method in the request.")
  b <- ps_cb_build(req)
  if (b$matrix_input) stop("Factor scores need raw data; this dataset is a covariance matrix.")
  if (isTRUE(b$robust)) stop("Factor scores are not available with robust ML (rsem), which fits robust moments; use ML or MLR.")
  if (isTRUE(b$mi)) stop("Factor scores are not available with multiple imputation (they would differ per imputed data set); use FIML.")
  if (!is.null(b$modsem)) stop("Factor scores are not available for LMS / QML models; use product indicators.")
  if (!is.null(b$cluster_var)) stop("Factor scores are not available for two-level models.")
  body <- c(b$body,
    sprintf("# Factor scores (%s method) for the analysed cases; case.idx gives each case's row in data.", method),
    sprintf("scores <- lavPredict(fit, method = \"%s\")", method),
    "idx <- lavInspect(fit, \"case.idx\")",
    "if (!is.list(scores)) { scores <- list(scores); idx <- list(idx) }",
    "rows <- unlist(lapply(idx, function(i) as.integer(rownames(data))[i]))",
    "scores <- do.call(rbind, scores)")
  inputs <- b$inputs
  if (export) return(paste(ps_script(sprintf("Factor scores (lavaan, %s)", method), "lavaan", inputs, body, "head(cbind(row = rows, scores))"), collapse = "\n"))
  env <- ps_run(body, inputs)
  cons <- c(b$n$cname, b$int_names)
  back <- setNames(cons, unname(b$lname[cons]))
  sc <- env$scores
  ps_json(list(method = method, names = unname(back[colnames(sc)]), rows = env$rows,
    scores = lapply(seq_len(ncol(sc)), function(j) unname(sc[, j])),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
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
  sel <- env$sel; back <- ps_cb_back(b)
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
  W <- env$W; back <- ps_cb_back(b)
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
