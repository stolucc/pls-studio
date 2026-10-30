# PLS Studio <-> cSEM / seminr. Builds the package's script for the diagram,
# runs it, and returns what the app's PLS views need, with the user's names
# restored. ps_pls(req, export = TRUE) returns the script instead.
# Estimation is the package's; this file only writes code and shapes output.

#' allow_hoc: second-order constructs (cSEM's two-stage approach) are accepted
#' only by the estimation and the bootstrap; other analyses refuse them.
ps_pls_build <- function(req, allow_hoc = FALSE) {
  pkg <- req$package
  cons <- req$model$constructs
  n <- ps_names(cons)
  cv <- unname(n$cv)
  k0 <- length(cons)
  type <- vapply(cons, function(c) c$type %||% if (identical(c$mode, "B")) "composite" else "factor", "")
  mode <- vapply(cons, function(c) c$mode %||% "A", "")
  if (!all(mode %in% c("A", "B", "unit")) || !all(type %in% c("factor", "composite"))) stop("Invalid measurement mode or construct type in the request.")
  comps <- lapply(cons, function(c) as.character(unlist(c$components)))
  hoc <- lengths(comps) > 0
  o <- req$options
  paths <- req$model$paths
  mods <- req$model$moderations
  from_to <- function(t) cv[match(vapply(Filter(function(p) p$to == t, paths), `[[`, "", "from"), n$cname)]
  ends <- unique(vapply(paths, `[[`, "", "to"))
  ivs <- function(j) unname(n$iv[n$inds[[j]]])
  inputs <- list(data = ps_frame(req, n))
  body <- character(0)

  approach <- o$approach %||% "PLS-PM"
  if (!approach %in% c("PLS-PM", "GSCA", "PCA", "unit")) stop("Invalid weighting approach in the request.")
  gsca <- approach != "PLS-PM"  # (any approach other than PLS path modeling: cSEM's .approach_weights)
  if (any(hoc)) {
    if (!allow_hoc) stop("This analysis is not available for models with second-order constructs (estimate and bootstrap them with cSEM).")
    if (pkg == "seminr" && isTRUE(o$consistent)) stop("Second-order constructs with consistent PLS are estimated with cSEM; choose cSEM, or turn off PLSc for seminr.")
    if (gsca) stop("Second-order constructs are estimated with PLS path modeling; choose PLS-PM as the weighting approach.")
    first <- unique(unlist(comps))
    if (!all(first %in% n$cname)) stop("A second-order construct refers to an unknown component.")
    if (any(hoc[match(first, n$cname)]) || any(lengths(n$inds[match(first, n$cname)]) == 0)) stop("The components of a second-order construct must be first-order constructs with indicators.")
    if (any(lengths(n$inds[hoc]) > 0)) stop("A second-order construct is measured by its components only, not by indicators of its own.")
    lvs <- unlist(lapply(c(paths, mods), function(p) c(p$from, p$to, p$moderator)))
    if (any(first %in% lvs)) stop("The components of a second-order construct cannot take part in the structural model (two-stage approach); connect the second-order construct instead.")
    if (length(mods) && any(n$cname[hoc] %in% unlist(lapply(mods, function(m) c(m$from, m$moderator))))) stop("Interactions with a second-order construct are not supported.")
  }
  if (gsca && pkg != "cSEM") stop("This weighting approach is estimated with cSEM; choose cSEM.")
  if (pkg == "cSEM") {
    sep <- "."
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], ".", n$cv[[m$moderator]]), "")
    # A second-order construct is measured by its first-order constructs.
    lines <- vapply(seq_len(k0), function(j) paste(cv[j], if (type[j] == "composite") "<~" else "=~",
      paste(if (hoc[j]) cv[match(comps[[j]], n$cname)] else ivs(j), collapse = " + ")), "")
    for (t in ends) {
      extra <- int_l[vapply(mods, function(m) m$to == t, TRUE)]
      lines <- c(lines, paste(n$cv[[t]], "~", paste(c(from_to(t), extra), collapse = " + ")))
    }
    # Mode A, Mode B, or sum scores ("unit": equal weights on the standardised indicators).
    # (A second-order construct is weighted in cSEM's second stage by its type: Mode A for a common factor, Mode B for a composite.)
    modes <- paste0("list(", paste(sprintf("%s = \"%s\"", cv[!hoc], ifelse(mode == "unit", "unit", paste0("mode", mode))[!hoc]), collapse = ", "), ")")
    scheme <- c(path = "path", centroid = "centroid", factor = "factorial")[[o$scheme]]
    body <- c("suppressPackageStartupMessages(library(cSEM))", ps_missing_code(req$missing),
      if (length(mods)) "# Interaction terms (X.M): products of the construct scores (cSEM's nonlinear PLS)",
      "model <- '", paste0("  ", lines), "'",
      if (gsca) c(GSCA = "# Generalized structured component analysis (GSCA; Hwang & Takane 2004) instead of PLS path modeling.",
        PCA = "# Weights: the first principal component of each block (PCA) instead of PLS path modeling.",
        unit = "# Unit weights: each construct is the (standardised) sum of its indicators (sum scores) instead of PLS path modeling.")[[approach]],
      if (any(hoc)) c("# Second-order constructs: cSEM's two-stage approach. Stage 1 estimates the first-order constructs; stage 2",
        "# uses their scores as the indicators of the second-order construct (cSEM corrects a second-order common factor for attenuation in stage 2)."),
      sprintf("fit <- csem(data, model, %s.PLS_weight_scheme_inner = \"%s\", .disattenuate = %s, .tolerance = %s, .iter_max = %d%s)",
        if (gsca) sprintf(".approach_weights = \"%s\", ", approach) else sprintf(".PLS_modes = %s, ", modes), scheme, if (isTRUE(o$consistent)) "TRUE" else "FALSE", format(ps_number(o$tolerance, "tolerance"), scientific = TRUE), as.integer(o$maxIter),
        if (any(hoc)) ", .approach_2ndorder = \"2stage\"" else ""))
  } else if (pkg == "seminr") {
    if (o$scheme == "centroid") stop("seminr offers the path and factor weighting schemes only; choose one of those, or cSEM.")
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], "*", n$cv[[m$moderator]]), "")
    weights_of <- function(j) if (mode[j] == "unit") "unit_weights" else paste0("mode_", mode[j])
    mm <- vapply(which(!hoc), function(j) {
      items <- ivs(j)
      it <- if (length(items) == 1) sprintf("single_item(\"%s\")", items) else ps_q(items)
      if (isTRUE(o$consistent) && type[j] == "factor" && length(items) > 1) sprintf("reflective(\"%s\", %s)", cv[j], it)
      else if (length(items) == 1) sprintf("composite(\"%s\", %s)", cv[j], it)
      else sprintf("composite(\"%s\", %s, weights = %s)", cv[j], it, weights_of(j))
    }, "")
    # Second-order constructs (after their dimensions): seminr's two-stage approach, weighted by the construct's mode.
    mm <- c(mm, vapply(which(hoc), function(j) sprintf("higher_composite(\"%s\", dimensions = %s, method = two_stage, weights = %s)",
      cv[j], ps_q(cv[match(comps[[j]], n$cname)]), weights_of(j)), ""))
    mm <- c(mm, vapply(mods, function(m) sprintf("interaction_term(iv = \"%s\", moderator = \"%s\", method = two_stage)", n$cv[[m$from]], n$cv[[m$moderator]]), ""))
    sm <- vapply(ends, function(t) {
      extra <- int_l[vapply(mods, function(m) m$to == t, TRUE)]
      sprintf("paths(from = %s, to = \"%s\")", ps_q(c(from_to(t), extra)), n$cv[[t]])
    }, "")
    body <- c("suppressPackageStartupMessages(library(seminr))", ps_missing_code(req$missing),
      "measurement <- constructs(", paste0("  ", mm, c(rep(",", length(mm) - 1), "")), ")",
      "structure <- relationships(", paste0("  ", sm, c(rep(",", length(sm) - 1), "")), ")",
      sprintf("fit <- estimate_pls(data, measurement, structure, inner_weights = %s, maxIt = %d, stopCriterion = %d)",
        if (o$scheme == "factor") "path_factorial" else "path_weighting", as.integer(o$maxIter), as.integer(round(-log10(o$tolerance)))))
  } else stop("Unknown PLS package: ", pkg)
  list(pkg = pkg, n = n, cv = cv, k0 = k0, type = type, mods = mods, int_l = int_l, inputs = inputs, body = body, o = o, hoc = hoc, comps = comps)
}

ps_pls <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_pls_build(req, allow_hoc = TRUE)
  if (export) {
    report <- if (b$pkg == "cSEM") c("summarize(fit)", "assess(fit)") else c("summary(fit)")
    title <- if (isTRUE(b$o$consistent)) sprintf("Consistent PLS (%s)", b$pkg) else sprintf("PLS-SEM (%s)", b$pkg)
    return(paste(ps_script(title, b$pkg, b$inputs, b$body, report), collapse = "\n"))
  }
  env <- ps_run(b$body, b$inputs)
  fit <- env$fit
  n <- b$n; cv <- b$cv; k0 <- b$k0; mods <- b$mods
  int_names <- vapply(mods, function(m) ps_int_name(m$from, m$moderator), "")
  constructs <- c(n$cname, int_names)
  all_l <- c(cv, b$int_l)
  K <- length(all_l)
  item_l <- unname(n$iv[n$all_inds])
  owner <- vapply(n$all_inds, function(i) which(vapply(n$inds, function(x) i %in% x, TRUE))[1], 1L)
  # M[rows, cols] by name; NA where a name is absent.
  mat <- function(M, rows, cols) {
    out <- matrix(NA_real_, length(rows), length(cols))
    for (i in seq_along(rows)) for (j in seq_along(cols)) if (rows[i] %in% rownames(M) && cols[j] %in% colnames(M)) out[i, j] <- M[rows[i], cols[j]]
    out
  }
  safe <- function(expr) tryCatch(expr, error = function(e) NULL)
  nas <- function(k) rep(NA_real_, k)

  two <- any(b$hoc)
  if (b$pkg == "cSEM") {
    # Two-stage (second-order constructs): the first-order measurement from stage 1, the
    # rest from stage 2, whose constructs other than the second-order ones are named "X_temp".
    untemp <- function(M) { if (is.matrix(M)) { rownames(M) <- sub("_temp$", "", rownames(M)); colnames(M) <- sub("_temp$", "", colnames(M)) } else if (!is.null(names(M))) names(M) <- sub("_temp$", "", names(M)); M }
    fit1 <- if (two) fit$First_stage else fit
    fit2 <- if (two) fit$Second_stage else fit
    e1 <- fit1$Estimates
    e <- if (two) lapply(fit2$Estimates, untemp) else fit$Estimates
    B <- t(mat(e$Path_estimates, all_l, all_l)); B[is.na(B)] <- 0
    W <- e1$Weight_estimates; L <- e1$Loading_estimates
    weights <- vapply(seq_along(item_l), function(i) W[cv[owner[i]], item_l[i]], 0)
    loadings <- vapply(seq_along(item_l), function(i) L[cv[owner[i]], item_l[i]], 0)
    r2 <- e$R2; r2a <- e$R2adj
    scores <- if (two) cbind(e1$Construct_scores, e$Construct_scores[, cv[b$hoc], drop = FALSE])[, cv, drop = FALSE] else e$Construct_scores[, cv, drop = FALSE]
    for (q in seq_along(mods)) scores <- cbind(scores, scores[, b$cv[match(mods[[q]]$from, n$cname)]] * scores[, b$cv[match(mods[[q]]$moderator, n$cname)]])
    ccor <- if (two) stats::cor(scores) else e$Construct_VCV[cv, cv, drop = FALSE]
    if (length(mods)) { full <- stats::cor(scores); full[seq_len(k0), seq_len(k0)] <- ccor; ccor <- full }
    linear <- !length(mods)
    a <- if (linear) safe(cSEM::assess(fit1, .quality_criterion = c("reliability", "ave"))) else NULL
    # Second-order constructs: their reliability and AVE from stage 2 (components as indicators).
    a2 <- if (two && linear) safe(cSEM::assess(fit2, .quality_criterion = c("reliability", "ave"))) else NULL
    pick <- function(v, v2 = NULL) { out <- if (is.null(v)) nas(k0) else unname(v[cv]); if (two && !is.null(v2)) out[b$hoc] <- unname(v2[cv[b$hoc]]); out }
    alpha <- pick(if (!is.null(a)) a$Reliability$Cronbachs_alpha else safe(cSEM::calculateRhoT(fit1, .only_common_factors = FALSE)), a2$Reliability$Cronbachs_alpha)
    rhoC <- pick(if (!is.null(a)) a$Reliability$Joereskogs_rho else safe(cSEM::calculateRhoC(fit1, .only_common_factors = FALSE)), a2$Reliability$Joereskogs_rho)
    rhoA <- pick(if (!is.null(a)) a$Reliability$`Dijkstra-Henselers_rho_A` else NULL, a2$Reliability$`Dijkstra-Henselers_rho_A`)
    ave <- pick(if (!is.null(a)) a$AVE else safe(cSEM::calculateAVE(fit1, .only_common_factors = FALSE)), a2$AVE)
    htmt <- function(type) {
      h <- safe(cSEM::calculateHTMT(fit1, .type_htmt = type))  # (first-order constructs)
      if (is.list(h) && !is.null(h$htmts)) h <- h$htmts
      out <- matrix(NA_real_, K, K)
      if (is.matrix(h)) { m <- mat(h, all_l, all_l); out[lower.tri(out)] <- m[lower.tri(m)] }
      out
    }
    fitm <- function(sat) {
      # (Not reported for two-stage models: cSEM's discrepancies refer to one stage only.)
      g <- function(f, ...) { v <- if (two) NULL else safe(f(fit, .saturated = sat, ...)); if (is.null(v)) NA_real_ else as.numeric(v) }
      list(srmr = g(cSEM::calculateSRMR), dULS = g(cSEM::calculateDL), dG = g(cSEM::calculateDG) * log(10)^2)
    }
    f2 <- untemp(safe(cSEM::calculatef2(fit2)))
    fsq <- if (is.matrix(f2)) t(mat(f2, all_l, all_l)) else matrix(NA_real_, K, K)
    vif <- if (is.matrix(e$VIF)) t(mat(e$VIF, all_l, all_l)) else matrix(NA_real_, K, K)
    vb <- safe(cSEM::calculateVIFModeB(fit1))
    # (cSEM returns a construct x indicator matrix, zero off the block; older versions a list per construct.)
    vif_outer <- vapply(seq_along(item_l), function(i) {
      k <- cv[owner[i]]; it <- item_l[i]
      v <- if (is.matrix(vb) && k %in% rownames(vb) && it %in% colnames(vb)) vb[k, it]
        else if (is.list(vb) && k %in% names(vb) && it %in% names(vb[[k]])) vb[[k]][[it]] else NA_real_
      if (is.finite(v) && v > 0) unname(v) else NA_real_
    }, 0)
    info <- fit1$Information$Weight_info
    iterations <- info$Number_iterations; converged <- isTRUE(info$Convergence_status) && (!two || isTRUE(fit2$Information$Weight_info$Convergence_status))
    version <- as.character(utils::packageVersion("cSEM"))
  } else {
    s <- summary(fit)
    P <- fit$path_coef
    B <- mat(P, all_l, all_l); B[is.na(B)] <- 0
    weights <- vapply(seq_along(item_l), function(i) fit$outer_weights[item_l[i], cv[owner[i]]], 0)
    loadings <- vapply(seq_along(item_l), function(i) fit$outer_loadings[item_l[i], cv[owner[i]]], 0)
    rs <- fit$rSquared  # one column per endogenous construct; keep names when there is only one
    r2 <- setNames(as.numeric(rs["Rsq", ]), colnames(rs)); r2a <- setNames(as.numeric(rs["AdjRsq", ]), colnames(rs))
    # (Second-order models: the dimensions' scores are the first stage's.)
    sc <- fit$construct_scores
    if (two) sc <- cbind(sc, fit$first_stage_model$construct_scores[, setdiff(colnames(fit$first_stage_model$construct_scores), colnames(sc)), drop = FALSE])
    scores <- sc[, all_l, drop = FALSE]
    ccor <- stats::cor(scores)
    rel <- s$reliability
    alpha <- unname(rel[cv, "alpha"]); rhoC <- unname(rel[cv, "rhoC"]); rhoA <- unname(rel[cv, "rhoA"]); ave <- unname(rel[cv, "AVE"])
    htmt <- function(type) {
      out <- matrix(NA_real_, K, K)
      if (type == "htmt" && is.matrix(s$validity$htmt)) {
        m <- mat(unclass(s$validity$htmt), all_l, all_l)
        lo <- lower.tri(out); out[lo] <- ifelse(is.na(m[lo]), t(m)[lo], m[lo])
      }
      out
    }
    fitm <- function(sat) list(srmr = NA_real_, dULS = NA_real_, dG = NA_real_)
    fsq <- mat(unclass(s$fSquare), all_l, all_l)
    vif <- matrix(NA_real_, K, K)
    for (t in names(s$vif_antecedents)) { v <- s$vif_antecedents[[t]]; for (f in names(v)) if (f %in% all_l && t %in% all_l) vif[match(f, all_l), match(t, all_l)] <- v[[f]] }
    vif_outer <- vapply(seq_along(item_l), function(i) { v <- s$validity$vif_items[[cv[owner[i]]]]; if (is.null(v) || !item_l[i] %in% names(v)) NA_real_ else unname(v[[item_l[i]]]) }, 0)
    iterations <- fit$iterations; converged <- fit$iterations < b$o$maxIter
    version <- as.character(utils::packageVersion("seminr"))
  }

  has <- matrix(FALSE, K, K)
  for (p in req$model$paths) has[match(p$from, constructs), match(p$to, constructs)] <- TRUE
  for (q in seq_along(mods)) has[k0 + q, match(mods[[q]]$to, constructs)] <- TRUE
  total <- solve(diag(K) - B) - diag(K)
  endo <- vapply(seq_len(K), function(j) any(has[, j]), TRUE)
  r2v <- lapply(seq_len(K), function(j) if (endo[j] && all_l[j] %in% names(r2)) unname(r2[[all_l[j]]]) else NULL)
  r2av <- lapply(seq_len(K), function(j) if (endo[j] && all_l[j] %in% names(r2a)) unname(r2a[[all_l[j]]]) else NULL)
  fsq[!has] <- NA; vif[!has] <- NA
  # Interaction terms: reliabilities are not defined.
  q4 <- function(v) c(v, nas(length(mods)))

  ps_json(list(
    n = nrow(env$data), iterations = iterations, converged = converged,
    constructs = constructs,
    indicators = lapply(seq_along(item_l), function(i) list(name = n$all_inds[i], construct = owner[i] - 1L)),
    weights = weights, loadings = loadings, pathCoef = B, hasPath = has, totalEffects = total, indirectEffects = total - B,
    rSquared = r2v, adjRSquared = r2av, constructCor = unname(ccor),
    # Redundancy analysis (cSEM): each Mode B composite correlated with a Mode A version of the same indicators.
    # Second-order constructs: loadings and weights of their components (cSEM's stage 2).
    higherOrder = if (two) unlist(lapply(which(b$hoc), function(j) lapply(b$comps[[j]], function(k) {
      ck <- cv[match(k, n$cname)]
      if (b$pkg == "cSEM") list(construct = j - 1L, component = match(k, n$cname) - 1L, loading = e$Loading_estimates[cv[j], ck], weight = e$Weight_estimates[cv[j], ck])
      # seminr: the dimensions are the second-order construct's items.
      else list(construct = j - 1L, component = match(k, n$cname) - 1L, loading = fit$outer_loadings[ck, cv[j]], weight = fit$outer_weights[ck, cv[j]])
    })), recursive = FALSE) else NULL,
    redundancy = if (b$pkg == "cSEM" && !two) { ra <- safe(suppressWarnings(cSEM::doRedundancyAnalysis(fit))); if (is.numeric(ra) && !is.null(names(ra)) && !anyNA(ra)) as.list(setNames(unname(ra), n$cname[match(names(ra), cv)])) else NULL } else NULL,
    quality = lapply(seq_len(K), function(j) list(alpha = q4(alpha)[j], rhoC = q4(rhoC)[j], rhoA = q4(rhoA)[j], ave = q4(ave)[j])),
    htmt = htmt("htmt"), htmt2 = htmt("htmt2"),
    fit = list(estimated = fitm(FALSE), saturated = fitm(TRUE)),
    consistent = isTRUE(b$o$consistent), types = c(b$type, rep("composite", length(mods))),
    moderations = lapply(seq_along(mods), function(q) list(from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L)),
    fSquare = fsq, vifInner = vif, vifOuter = vif_outer,
    scores = lapply(seq_len(K), function(j) unname(scores[, j])),
    # (cSEM's two-stage approach always corrects a second-order common factor in stage 2 and says so; the script explains it.)
    droppedRows = nrow(b$inputs$data) - nrow(env$data), warnings = ps_quiet_2ndorder(env$.warnings),
    engine = list(package = b$pkg, version = version)
  ))
}
