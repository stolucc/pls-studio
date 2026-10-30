# PLS Studio <-> cSEM / seminr. Builds the package's script for the diagram,
# runs it, and returns what the app's PLS views need, with the user's names
# restored. ps_pls(req, export = TRUE) returns the script instead.
# Estimation is the package's; this file only writes code and shapes output.

ps_pls_build <- function(req) {
  pkg <- req$package
  cons <- req$model$constructs
  n <- ps_names(cons)
  cv <- unname(n$cv)
  k0 <- length(cons)
  type <- vapply(cons, function(c) c$type %||% if (identical(c$mode, "B")) "composite" else "factor", "")
  mode <- vapply(cons, function(c) c$mode %||% "A", "")
  if (!all(mode %in% c("A", "B", "unit")) || !all(type %in% c("factor", "composite"))) stop("Invalid measurement mode or construct type in the request.")
  if (any(lengths(lapply(cons, function(c) unlist(c$components))) > 0)) stop("Higher-order constructs are supported in CB-SEM only.")
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
  if (gsca && pkg != "cSEM") stop("This weighting approach is estimated with cSEM; choose cSEM.")
  if (pkg == "cSEM") {
    sep <- "."
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], ".", n$cv[[m$moderator]]), "")
    lines <- vapply(seq_len(k0), function(j) paste(cv[j], if (type[j] == "composite") "<~" else "=~", paste(ivs(j), collapse = " + ")), "")
    for (t in ends) {
      extra <- int_l[vapply(mods, function(m) m$to == t, TRUE)]
      lines <- c(lines, paste(n$cv[[t]], "~", paste(c(from_to(t), extra), collapse = " + ")))
    }
    # Mode A, Mode B, or sum scores ("unit": equal weights on the standardised indicators).
    modes <- paste0("list(", paste(sprintf("%s = \"%s\"", cv, ifelse(mode == "unit", "unit", paste0("mode", mode))), collapse = ", "), ")")
    scheme <- c(path = "path", centroid = "centroid", factor = "factorial")[[o$scheme]]
    body <- c("suppressPackageStartupMessages(library(cSEM))", ps_missing_code(req$missing),
      if (length(mods)) "# Interaction terms (X.M): products of the construct scores (cSEM's nonlinear PLS)",
      "model <- '", paste0("  ", lines), "'",
      if (gsca) c(GSCA = "# Generalized structured component analysis (GSCA; Hwang & Takane 2004) instead of PLS path modeling.",
        PCA = "# Weights: the first principal component of each block (PCA) instead of PLS path modeling.",
        unit = "# Unit weights: each construct is the (standardised) sum of its indicators (sum scores) instead of PLS path modeling.")[[approach]],
      sprintf("fit <- csem(data, model, %s.PLS_weight_scheme_inner = \"%s\", .disattenuate = %s, .tolerance = %s, .iter_max = %d)",
        if (gsca) sprintf(".approach_weights = \"%s\", ", approach) else sprintf(".PLS_modes = %s, ", modes), scheme, if (isTRUE(o$consistent)) "TRUE" else "FALSE", format(ps_number(o$tolerance, "tolerance"), scientific = TRUE), as.integer(o$maxIter)))
  } else if (pkg == "seminr") {
    if (o$scheme == "centroid") stop("seminr offers the path and factor weighting schemes only; choose one of those, or cSEM.")
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], "*", n$cv[[m$moderator]]), "")
    mm <- vapply(seq_len(k0), function(j) {
      items <- ivs(j)
      it <- if (length(items) == 1) sprintf("single_item(\"%s\")", items) else ps_q(items)
      if (isTRUE(o$consistent) && type[j] == "factor" && length(items) > 1) sprintf("reflective(\"%s\", %s)", cv[j], it)
      else if (length(items) == 1) sprintf("composite(\"%s\", %s)", cv[j], it)
      else sprintf("composite(\"%s\", %s, weights = %s)", cv[j], it, if (mode[j] == "unit") "unit_weights" else paste0("mode_", mode[j]))
    }, "")
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
  list(pkg = pkg, n = n, cv = cv, k0 = k0, type = type, mods = mods, int_l = int_l, inputs = inputs, body = body, o = o)
}

ps_pls <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_pls_build(req)
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

  if (b$pkg == "cSEM") {
    e <- fit$Estimates
    B <- t(mat(e$Path_estimates, all_l, all_l)); B[is.na(B)] <- 0
    W <- e$Weight_estimates; L <- e$Loading_estimates
    weights <- vapply(seq_along(item_l), function(i) W[cv[owner[i]], item_l[i]], 0)
    loadings <- vapply(seq_along(item_l), function(i) L[cv[owner[i]], item_l[i]], 0)
    r2 <- e$R2; r2a <- e$R2adj
    scores <- e$Construct_scores[, cv, drop = FALSE]
    for (q in seq_along(mods)) scores <- cbind(scores, scores[, b$cv[match(mods[[q]]$from, n$cname)]] * scores[, b$cv[match(mods[[q]]$moderator, n$cname)]])
    ccor <- e$Construct_VCV[cv, cv, drop = FALSE]
    if (length(mods)) { full <- stats::cor(scores); full[seq_len(k0), seq_len(k0)] <- ccor; ccor <- full }
    linear <- !length(mods)
    a <- if (linear) safe(cSEM::assess(fit, .quality_criterion = c("reliability", "ave"))) else NULL
    pick <- function(v) if (is.null(v)) nas(k0) else unname(v[cv])
    alpha <- pick(if (!is.null(a)) a$Reliability$Cronbachs_alpha else safe(cSEM::calculateRhoT(fit, .only_common_factors = FALSE)))
    rhoC <- pick(if (!is.null(a)) a$Reliability$Joereskogs_rho else safe(cSEM::calculateRhoC(fit, .only_common_factors = FALSE)))
    rhoA <- pick(if (!is.null(a)) a$Reliability$`Dijkstra-Henselers_rho_A` else NULL)
    ave <- pick(if (!is.null(a)) a$AVE else safe(cSEM::calculateAVE(fit, .only_common_factors = FALSE)))
    htmt <- function(type) {
      h <- safe(cSEM::calculateHTMT(fit, .type_htmt = type))
      if (is.list(h) && !is.null(h$htmts)) h <- h$htmts
      out <- matrix(NA_real_, K, K)
      if (is.matrix(h)) { m <- mat(h, all_l, all_l); out[lower.tri(out)] <- m[lower.tri(m)] }
      out
    }
    fitm <- function(sat) {
      g <- function(f, ...) { v <- safe(f(fit, .saturated = sat, ...)); if (is.null(v)) NA_real_ else as.numeric(v) }
      list(srmr = g(cSEM::calculateSRMR), dULS = g(cSEM::calculateDL), dG = g(cSEM::calculateDG) * log(10)^2)
    }
    f2 <- safe(cSEM::calculatef2(fit))
    fsq <- if (is.matrix(f2)) t(mat(f2, all_l, all_l)) else matrix(NA_real_, K, K)
    vif <- if (is.matrix(e$VIF)) t(mat(e$VIF, all_l, all_l)) else matrix(NA_real_, K, K)
    vb <- safe(cSEM::calculateVIFModeB(fit))
    vif_outer <- vapply(seq_along(item_l), function(i) { v <- if (is.list(vb) && cv[owner[i]] %in% names(vb)) vb[[cv[owner[i]]]] else NULL; if (is.null(v) || !item_l[i] %in% names(v)) NA_real_ else unname(v[[item_l[i]]]) }, 0)
    info <- fit$Information$Weight_info
    iterations <- info$Number_iterations; converged <- isTRUE(info$Convergence_status)
    version <- as.character(utils::packageVersion("cSEM"))
  } else {
    s <- summary(fit)
    P <- fit$path_coef
    B <- mat(P, all_l, all_l); B[is.na(B)] <- 0
    weights <- vapply(seq_along(item_l), function(i) fit$outer_weights[item_l[i], cv[owner[i]]], 0)
    loadings <- vapply(seq_along(item_l), function(i) fit$outer_loadings[item_l[i], cv[owner[i]]], 0)
    rs <- fit$rSquared  # one column per endogenous construct; keep names when there is only one
    r2 <- setNames(as.numeric(rs["Rsq", ]), colnames(rs)); r2a <- setNames(as.numeric(rs["AdjRsq", ]), colnames(rs))
    scores <- fit$construct_scores[, all_l, drop = FALSE]
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
    redundancy = if (b$pkg == "cSEM") { ra <- safe(suppressWarnings(cSEM::doRedundancyAnalysis(fit))); if (is.numeric(ra) && !is.null(names(ra)) && !anyNA(ra)) as.list(setNames(unname(ra), n$cname[match(names(ra), cv)])) else NULL } else NULL,
    quality = lapply(seq_len(K), function(j) list(alpha = q4(alpha)[j], rhoC = q4(rhoC)[j], rhoA = q4(rhoA)[j], ave = q4(ave)[j])),
    htmt = htmt("htmt"), htmt2 = htmt("htmt2"),
    fit = list(estimated = fitm(FALSE), saturated = fitm(TRUE)),
    consistent = isTRUE(b$o$consistent), types = c(b$type, rep("composite", length(mods))),
    moderations = lapply(seq_along(mods), function(q) list(from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L)),
    fSquare = fsq, vifInner = vif, vifOuter = vif_outer,
    scores = lapply(seq_len(K), function(j) unname(scores[, j])),
    droppedRows = nrow(b$inputs$data) - nrow(env$data), warnings = env$.warnings,
    engine = list(package = b$pkg, version = version)
  ))
}
