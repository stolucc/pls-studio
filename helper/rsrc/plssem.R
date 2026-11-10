# Two-level (multilevel) PLS-SEM with plssem (Kjell Solem Slupphaug):
# Monte Carlo consistent PLS for multilevel models (MC-PLSc-MLM). The model on the
# canvas is the within-cluster (level 1) model; the between-cluster (level 2) model
# comes from the project's Clusters setting (the same structure, the factors
# regressed on cluster-level covariates, or the model as written). Paths may carry
# random slopes (plssem's rv()), which are latent variables at level 2. MC-PLSc
# simulates: the estimates depend on the seed (the project's, set before the fit).
# The browser's R has an older plssem (0.1.5) with another multilevel interface:
# desktop R only (plssem 0.2.0).

#' The level-1 / level-2 syntax and the data for a two-level PLS-SEM request.
#' Returns the syntax lines, the data frame (syntactic names), the cluster and ordered columns, and the names back to the app's.
ps_plssem_build <- function(req) {
  m <- req$model
  ml <- m$multilevel
  if (is.null(ml) || !is.character(ml$column) || length(ml$column) != 1 || !nzchar(ml$column)) stop("Multilevel PLS-SEM needs a cluster column (Clusters on the Model tab).")
  between <- ml[["between", exact = TRUE]] %||% "saturated"
  if (!(is.character(between) && length(between) == 1 && between %in% c("same", "factors", "model"))) stop("Multilevel PLS-SEM needs a between-level model: choose Same model, Factors or As written under Clusters (a saturated between level is lavaan's).")
  cons <- m$constructs
  if (!length(cons)) stop("The model has no constructs.")
  if (length(m$moderations) || length(m$threeWay) || length(m$copulas)) stop("Multilevel PLS-SEM is not available with interactions or copulas.")
  for (c in cons) {
    if (length(unlist(c$components))) stop(sprintf("%s is a higher-order construct: not available in multilevel PLS-SEM.", c$name))
    if (!length(unlist(c$indicators))) stop(sprintf("%s has no indicators.", c$name))
    if (length(unlist(c$indicators)) > 1 && (!identical(c$mode %||% "A", "A") || identical(c$type, "composite"))) stop(sprintf("%s is a composite: plssem's MC-PLSc estimates common factors only (it has no Mode B yet); make it a factor with Mode A.", c$name))
  }
  n <- ps_names(cons)
  cname <- n$cname
  single <- vapply(n$inds, length, 0L) == 1
  # Single-indicator constructs enter as their observed variable (as plssem treats observed variables).
  lv <- setNames(ifelse(single, unname(n$iv[vapply(n$inds, `[`, "", 1)]), unname(n$cv)), cname)
  taken <- c(unname(n$iv), unname(n$cv))
  fresh <- function(x) { y <- ps_ident(x); while (y %in% taken) y <- paste0(y, "_"); taken <<- c(taken, y); y }
  col <- function(nm) {
    at <- match(nm, req$data$names)
    if (is.na(at)) stop(sprintf("%s is not in the dataset.", nm))
    ps_col(req$data$cols, at)
  }
  data <- ps_frame(req, n)
  if (ml$column %in% n$all_inds) stop(sprintf("%s is an indicator and cannot also define the clusters.", ml$column))
  cl <- fresh(ml$column)
  data[[cl]] <- col(ml$column)
  # (constructs first: a single-indicator construct's variable is shown by the construct's name, except as an indicator)
  back <- c(setNames(cname, unname(lv)), setNames(n$all_inds, unname(n$iv[n$all_inds])))
  # Other columns (cluster-level covariates, variables of a between model as written), under fresh names.
  extra <- character(0)
  column <- function(nm) {
    if (nm %in% names(n$iv)) return(unname(n$iv[[nm]]))
    if (nm %in% names(extra)) return(unname(extra[[nm]]))
    if (identical(nm, ml$column)) stop(sprintf("%s defines the clusters and cannot be a variable of the model.", nm))
    id <- fresh(nm)
    data[[id]] <<- col(nm)
    extra[nm] <<- id
    back[id] <<- nm
    id
  }
  # Random slopes: paths (by construct names) whose coefficient varies across clusters.
  slopes <- m$slopes %||% list()
  if (length(slopes) > 20) stop("At most 20 random slopes.")
  sname <- character(0); slab <- character(0)
  for (s in slopes) {
    if (!(is.character(s$from) && is.character(s$to) && length(s$from) == 1 && length(s$to) == 1)) stop("Invalid random slope in the request.")
    if (!any(vapply(m$paths, function(p) identical(p$from, s$from) && identical(p$to, s$to), TRUE))) stop(sprintf("The random slope %s -> %s is not a path of the model.", s$from, s$to))
    key <- paste(s$from, s$to, sep = "\r")
    if (key %in% names(sname)) stop("A random slope is listed twice.")
    sname[key] <- fresh(sprintf("s_%s_%s", lv[[s$from]], lv[[s$to]]))
    slab[key] <- sprintf("%s → %s (slope)", s$from, s$to)
  }
  back <- c(back, setNames(unname(slab), unname(sname)))
  # Level 1: the canvas model.
  meas <- vapply(which(!single), function(j) sprintf("%s =~ %s", lv[[j]], paste(unname(n$iv[n$inds[[j]]]), collapse = " + ")), "")
  to <- unique(vapply(m$paths, function(p) p$to, ""))
  for (p in m$paths) if (!all(c(p$from, p$to) %in% cname)) stop("A path refers to a removed construct.")
  for (p in m$paths) if (!is.null(p$fixed) || !is.null(p$label)) stop("Multilevel PLS-SEM estimates every path: remove fixed values and labels.")
  struct <- vapply(to, function(y) {
    terms <- vapply(Filter(function(p) identical(p$to, y), m$paths), function(p) {
      key <- paste(p$from, y, sep = "\r")
      if (key %in% names(sname)) sprintf("rv(\"%s\")*%s", sname[[key]], lv[[p$from]]) else lv[[p$from]]
    }, "")
    sprintf("%s ~ %s", lv[[y]], paste(terms, collapse = " + "))
  }, "")
  level1 <- c(meas, unname(struct))
  # Level 2.
  bname <- function(j) { id <- fresh(paste0(n$cv[[j]], "_b")); back[id] <<- paste(cname[j], "(between)"); id }
  if (identical(between, "factors")) {
    fac <- which(!single)
    if (!length(fac)) stop("A between-level factor model needs factors with indicators.")
    ws <- vapply(as.character(unlist(ml$betweenCovariates)), column, "")
    fb <- vapply(fac, bname, "")
    level2 <- c(vapply(seq_along(fac), function(k) sprintf("%s =~ %s", fb[k], paste(unname(n$iv[n$inds[[fac[k]]]]), collapse = " + ")), ""),
      if (length(ws)) sprintf("%s ~ %s", paste(fb, collapse = " + "), paste(ws, collapse = " + ")),
      if (length(ws) && length(sname)) sprintf("%s ~ %s", paste(unname(sname), collapse = " + "), paste(ws, collapse = " + ")))
  } else if (identical(between, "same")) {
    # The same factors (suffix _b) and paths between clusters; observed variables as their cluster-level parts.
    fb <- setNames(lv, cname)
    for (j in which(!single)) fb[[cname[j]]] <- bname(j)
    level2 <- c(vapply(which(!single), function(j) sprintf("%s =~ %s", fb[[j]], paste(unname(n$iv[n$inds[[j]]]), collapse = " + ")), ""),
      unname(vapply(to, function(y) sprintf("%s ~ %s", fb[[y]], paste(vapply(Filter(function(p) identical(p$to, y), m$paths), function(p) fb[[p$from]], ""), collapse = " + ")), "")))
  } else {
    sts <- ml$betweenModel
    if (!length(sts)) stop("The between-level model has no statements.")
    ok_name <- function(x) is.character(x) && length(x) == 1 && grepl("^[A-Za-z_.][A-Za-z0-9_.]*$", x)
    fac_b <- unique(unlist(lapply(sts, function(st) if (identical(st$op, "=~")) st$lhs)))
    bmap <- character(0)
    name2 <- function(x) {
      if (!ok_name(x)) stop("Invalid name in the between-level model.")
      if (x %in% names(bmap)) return(unname(bmap[[x]]))
      id <- if (x %in% fac_b) { id <- fresh(x); back[id] <<- paste(x, "(between)"); id } else column(x)
      bmap[x] <<- id
      id
    }
    level2 <- vapply(sts, function(st) {
      op <- st$op
      if (!(is.character(op) && length(op) == 1 && op %in% c("=~", "~", "~~"))) stop("Multilevel PLS-SEM takes =~, ~ and ~~ statements in the between-level model (no intercepts).")
      if (!length(st$rhs)) stop("A between-level statement has no right-hand side.")
      if (any(vapply(st$rhs, function(t) !is.null(t$fixed) || !is.null(t$label), TRUE))) stop("Multilevel PLS-SEM estimates every between-level parameter: remove fixed values and labels.")
      paste(name2(st$lhs), op, paste(vapply(st$rhs, function(t) name2(t$name), ""), collapse = " + "))
    }, "")
  }
  # Ordinal variables (plssem's ordered: MC-OrdPLSc): indicators, and cluster-level variables of the between model.
  vars <- c(n$iv, extra)
  ord <- intersect(as.character(unlist(m$ordered)), names(vars))
  list(syntax = c("level: 1", paste0("  ", level1), "level: 2", paste0("  ", level2)), data = data, cluster = cl,
    ordered = unname(vars[ord]), ordered_names = ord, back = back, inds_map = setNames(n$all_inds, unname(n$iv[n$all_inds])), slopes = sname)
}

ps_plssem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (ps_in_browser()) stop("Multilevel PLS-SEM (plssem 0.2.0) runs in desktop R: choose Desktop R (helper) under R runs in.")
  if (utils::packageVersion("plssem") < "0.2.0") stop(sprintf("Multilevel PLS-SEM needs plssem 0.2.0 or later (desktop R has %s): update it from the helper's menu (Install R packages...).", utils::packageVersion("plssem")))
  o <- req$options
  b <- ps_plssem_build(req)
  scheme <- c(path = "path", centroid = "centroid", factor = "factorial")[[o[["scheme", exact = TRUE]] %||% "path"]]
  missing <- req[["missing", exact = TRUE]] %||% "casewise"
  if (!missing %in% c("mean", "casewise")) stop("Multilevel PLS-SEM handles missing values by casewise deletion or mean replacement (plssem's listwise and mean).")
  seed <- as.integer(ps_number(o$seed %||% 1, "seed"))
  boot <- isTRUE(o$bootstrap)
  R <- if (boot) as.integer(ps_number(o$bootR %||% 500, "number of bootstrap samples")) else 0L
  if (boot && (R < 10 || R > 10000)) stop("The bootstrap takes 10 to 10000 samples.")
  consistent <- isTRUE(o$consistent)
  data <- b$data
  args <- c(sprintf("cluster = \"%s\"", b$cluster), sprintf("consistent = %s", consistent), sprintf("inner.weights = \"%s\"", scheme),
    sprintf("missing = \"%s\"", if (missing == "mean") "mean" else "listwise"),
    if (length(b$ordered)) sprintf("ordered = %s", ps_q(b$ordered)),
    if (boot) sprintf("bootstrap = TRUE, boot.R = %d", R), "verbose = FALSE")
  body <- c("suppressPackageStartupMessages(library(plssem))",
    "# The two-level model: level 1 within clusters (the diagram), level 2 between clusters",
    "model <- '", b$syntax, "'",
    "# MC-PLSc is a Monte Carlo estimator: its estimates depend on the seed, set here",
    sprintf("set.seed(%d)", seed),
    sprintf("fit <- pls(model, data = data, %s)", paste(args, collapse = ", ")),
    "est <- parameter_estimates(fit)",
    "# Fit measures (plssem: under development for MC-PLSc models; simulated, so after the fit with the same seed stream)",
    "fm <- fit_measures(fit)",
    "r2 <- summary(fit, fit = FALSE)$levels")
  inputs <- list(data = data)
  if (export) return(ps_script("Two-level PLS-SEM (plssem, MC-PLSc)", "plssem", inputs, body, c("summary(fit)", "est")))
  env <- ps_run(body, inputs)
  # plssem's own note (a message) with the fit measures of MC-PLSc models, shown beside them.
  fit_note <- "Fit measures for MC-PLSc models are under development! Traditional fit criteria will likely be too strict."
  fit <- env$fit
  bk <- b$back
  nm <- function(x) ps_back(x, bk)
  est <- env$est
  num <- function(x) ifelse(is.finite(x), x, NA_real_)
  # (an indicator keeps its column name, also when it is a single-indicator construct's variable)
  inds_map <- b$inds_map
  level <- function(l) {
    pt <- est[est$level %in% l, , drop = FALSE]
    rhs <- ifelse(pt$op == "=~", ps_back(pt$rhs, inds_map), nm(pt$rhs))
    lv <- env$r2[[l]]
    fm <- env$fm[[l]]
    list(level = l, rows = lapply(seq_len(nrow(pt)), function(i) list(lhs = nm(pt$lhs[i]), op = pt$op[i], rhs = rhs[i], est = num(pt$est[i]), se = num(pt$se[i]),
        z = num(pt$z[i]), p = num(pt$pvalue[i]), lo = num(pt$ci.lower[i]), hi = num(pt$ci.upper[i]))),
      r2 = list(names = I(nm(names(lv$r2.etas))), values = I(num(unname(lv$r2.etas)))),
      r2Indicators = list(names = I(ps_back(names(lv$r2.inds), inds_map)), values = I(num(unname(lv$r2.inds)))),
      fit = if (is.null(fm)) NULL else list(chisq = num(fm$chisq), df = num(fm$chisq.df), rmsea = num(fm$rmsea), srmr = num(fm$srmr)))
  }
  # Thresholds of ordinal variables: one set for both levels (plssem's level-agnostic rows).
  th <- est[is.na(est$level), , drop = FALSE]
  icc <- fit@params$icc
  rsd <- fit@params$rsd
  ps_json(list(levels = list(level(1), level(2)),
    thresholds = lapply(seq_len(nrow(th)), function(i) list(variable = ps_back(th$lhs[i], c(inds_map, bk)), threshold = th$rhs[i], est = num(th$est[i]), se = num(th$se[i]))),
    icc = list(names = I(ps_back(names(icc), inds_map)), values = I(num(unname(icc)))),
    slopes = lapply(seq_along(rsd), function(i) list(name = nm(names(rsd)[i]), sd = num(unname(rsd[i])))),
    n = fit@info$n, clusters = fit@info$nclusters, iterations = fit@status$iterations, converged = isTRUE(fit@status$converged),
    admissible = isTRUE(fit@status$is.admissible), estimator = fit@info$estimator, consistent = consistent, scheme = scheme,
    missing = missing, seed = seed, bootR = R, ordered = I(b$ordered_names), fitNote = fit_note, syntax = I(b$syntax),
    warnings = I(env$.warnings), engine = ps_engine("plssem")))
}
