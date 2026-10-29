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
  group_var <- NULL
  mg <- req$model$multigroup
  if (matrix_input && !is.null(mg)) stop("Multiple-group analysis needs raw data with a grouping column.")
  if (matrix_input) {
    mo <- req$data$moments
    S <- mo$S; dimnames(S) <- list(req$data$names, req$data$names)
    if (!all(n$all_inds %in% req$data$names)) stop("Indicator(s) not in the covariance matrix: ", paste(setdiff(n$all_inds, req$data$names), collapse = ", "))
    S <- S[n$all_inds, n$all_inds, drop = FALSE]
    dimnames(S) <- list(unname(n$iv[n$all_inds]), unname(n$iv[n$all_inds]))
    inputs$S <- S
    inputs$N <- mo$n
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
    body <- c(body, ps_missing_code(req$missing))
  }

  lines <- character(0)
  for (j in seq_len(k0)) {
    if (is_cov[j]) next
    # The first loading of each factor is fixed to 1 (marker / scaling indicator); written explicitly.
    if (length(comps[[j]])) lines <- c(lines, paste(lname[[j]], "=~", ps_marked(lname[comps[[j]]])))
    else {
      v <- unname(n$iv[n$inds[[j]]])
      fl <- cons[[j]]$fixedLoadings %||% list()
      fixed <- setNames(fl, unname(n$iv[names(fl)]))
      ll <- cons[[j]]$loadingLabels %||% list()
      # The marker's 1 is fixed: a label on it would have no effect.
      ll <- ll[names(ll) != n$inds[[j]][1]]
      labels <- setNames(ll, unname(n$iv[names(ll)]))
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(v, fixed, labels)))
      if (length(v) == 1) lines <- c(lines, paste0(v, " ~~ 0*", v, "   # single indicator: no measurement error"))
    }
  }
  paths <- req$model$paths
  int_names <- character(0); int_l <- character(0); prod <- list()
  if (length(mods)) body <- c(body, "# Latent interactions: matched-pair products of mean-centred indicators (Marsh, Wen & Hau 2004)")
  for (q in seq_along(mods)) {
    m <- mods[[q]]
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
  # Defined parameters (functions of labelled parameters, with delta-method standard errors).
  for (d in req$model$defined) lines <- c(lines, paste(ps_label(d$name), ":=", ps_expr(d$expr)))
  # Ordered categorical indicators (thresholds, polychoric correlations) and FIML.
  ordered <- unname(n$iv[intersect(unlist(req$model$ordered), n$all_inds)])
  extra <- paste0(if (length(ordered)) sprintf(", ordered = %s", ps_q(ordered)) else "",
    if (identical(req$missing, "fiml")) ", missing = \"ml\"" else "")
  if (!is.null(group_var)) {
    # Measurement invariance: what is held equal across groups, and what is freed (partial invariance).
    lev <- mg$invariance %||% "configural"
    if (!lev %in% c("configural", "metric", "scalar", "strict")) stop("Invalid invariance level in the request.")
    equal <- c(if (lev != "configural") "loadings", if (lev %in% c("scalar", "strict")) c("intercepts", if (length(ordered)) "thresholds"),
      if (lev == "strict") "residuals")
    partial <- unlist(lapply(mg$free, function(f) {
      if (identical(f$kind, "loading")) paste0(lname[[f$construct]], "=~", n$iv[[f$indicator]])
      else if (identical(f$kind, "intercept")) paste0(n$iv[[f$indicator]], "~1")
    }))
    extra <- paste0(extra, sprintf(", group = \"%s\"", group_var),
      if (length(equal)) sprintf(", group.equal = %s", ps_q(equal)) else "",
      if (length(partial)) sprintf(", group.partial = %s", ps_q(partial)) else "")
  }
  if (matrix_input && nzchar(extra)) stop("Ordinal indicators and FIML need raw data.")
  call <- if (matrix_input) sprintf("fit <- sem(model, sample.cov = S, sample.nobs = N%s, estimator = \"%s\")", if (!is.null(inputs$NACOV)) ", NACOV = NACOV" else "", req$estimator)
    else sprintf("fit <- sem(model, data = data, estimator = \"%s\"%s)", req$estimator, extra)
  tests <- req$model$waldTests
  wald <- if (length(tests)) c("# Wald tests of the hypotheses (lavaan::lavTestWald)",
    sprintf("wald <- list(%s)", paste(vapply(seq_along(tests), function(i) sprintf("lavTestWald(fit, constraints = '%s')",
      paste(vapply(unlist(tests[[i]]$constraints), function(h) { parts <- strsplit(h, "==", fixed = TRUE)[[1]]
        if (length(parts) != 2) stop("Invalid hypothesis in the request."); paste(ps_expr(trimws(parts[1])), "==", ps_expr(trimws(parts[2]))) }, ""), collapse = "\n")), ""), collapse = ",\n  ")))
  body <- c(body, "model <- '", paste0("  ", lines), "'", call, wald)
  list(n = n, k0 = k0, comps = comps, is_cov = is_cov, lname = lname, mods = mods, int_names = int_names, prod = prod,
    inputs = inputs, body = body, matrix_input = matrix_input, group_var = group_var)
}

ps_cb <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (export) {
    return(paste(ps_script("CB-SEM (lavaan)", "lavaan", b$inputs, b$body,
      c("summary(fit, fit.measures = TRUE, standardized = TRUE, rsquare = TRUE)")), collapse = "\n"))
  }
  env <- ps_run(b$body, b$inputs)
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
  back <- c(setNames(constructs, lv_lname), setNames(indicators, ind_v))
  is_lv <- function(x) x %in% lv_lname
  nm <- function(x) unname(back[x])

  groups <- lavaan::lavInspect(fit, "group.label")
  map_group <- function(g) {
    pt <- lavaan::parTable(fit)
    pe <- lavaan::parameterEstimates(fit, standardized = TRUE, remove.nonfree = FALSE)
    multi <- "group" %in% names(pe)
    key <- function(t) paste(t$lhs, t$op, t$rhs, if (multi) t$group else 1)
    pe$free <- pt$free[match(key(pe), key(pt))]
    if (!is.null(g)) pe <- pe[pe$group == g, ]
    # Latent means (estimated in groups after the first under scalar invariance).
    pe <- pe[pe$op %in% c("=~", "~", "~~", "|", ":=") | (pe$op == "~1" & pe$lhs %in% lv_lname & !is.na(pe$free) & pe$free > 0), ]
    est <- lapply(seq_len(nrow(pe)), function(i) {
      r <- pe[i, ]; free <- r$free > 0
      kind <- if (r$op == "~1") "mean" else if (r$op == ":=") "defined" else if (r$op == "|") "threshold" else if (r$op == "=~") { if (!free) "fixed-loading" else if (is_lv(r$rhs)) "hoLoading" else "loading" }
        else if (r$op == "~") "regression"
        else if (is_lv(r$lhs) && is_lv(r$rhs)) { if (free) "lvcov" else "fixed" }
        else if (!free) NA_character_
        else if (r$lhs == r$rhs) "residual" else "rescov"
      if (is.na(kind)) return(NULL)
      if (r$op == ":=") return(list(kind = kind, lhs = r$lhs, op = r$op, rhs = r$rhs, est = r$est, se = if (is.na(r$se)) NULL else r$se,
        z = if (is.na(r$z)) NULL else r$z, p = if (is.na(r$pvalue)) NULL else r$pvalue, std = r$std.all))
      list(kind = kind, lhs = nm(r$lhs), op = r$op, rhs = if (r$op == "|") r$rhs else nm(r$rhs), est = r$est,
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
    r2 <- lavaan::lavInspect(fit, "r2"); if (!is.null(g)) r2 <- r2[[g]]
    r2_ind <- vapply(ind_v, function(v) if (v %in% names(r2)) unname(r2[[v]]) else 1, 0)
    endo <- vapply(seq_len(K), function(j) any(has[, j]) || any(vapply(comps, function(cc) constructs[j] %in% cc, TRUE)), TRUE)
    r2_con <- lapply(seq_len(K), function(j) if (endo[j] && lv_lname[j] %in% names(r2)) unname(r2[[lv_lname[j]]]) else NULL)
    call <- lavaan::lavInspect(fit, "cor.all"); if (!is.null(g)) call <- call[[g]]
    lvcor <- call[lv_lname, lv_lname, drop = FALSE]
    rel <- lapply(seq_len(K), function(j) {
      l <- std_load[ind_con == j - 1]
      if (!length(l) || (j <= k0 && length(comps[[j]]))) return(list(cr = NULL, ave = NULL))
      list(cr = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)), ave = mean(l^2))
    })
    rr <- lavaan::lavResiduals(fit, type = "cor.bollen", summary = FALSE)
    res <- (if (is.null(g)) rr$cov else rr[[g]]$cov)[ind_v, ind_v]
    gdata <- if (is.null(g) || b$matrix_input) env$data else env$data[as.character(env$data[[b$group_var]]) == groups[g], , drop = FALSE]
    # HTMT on the measurement blocks (semTools), classic and HTMT2.
    htmt <- function(two) {
      out <- matrix(NA_real_, K, K)
      blocks <- which(vapply(seq_len(K), function(j) sum(ind_con == j - 1) >= 2 && !(j <= k0 && b$is_cov[j]), TRUE))
      if (length(blocks) < 2 || !requireNamespace("semTools", quietly = TRUE)) return(out)
      hm <- paste(vapply(blocks, function(j) paste(lv_lname[j], "=~", paste(ind_v[ind_con == j - 1], collapse = " + ")), ""), collapse = "\n")
      h <- tryCatch(suppressWarnings(if (b$matrix_input) semTools::htmt(hm, sample.cov = b$inputs$S, htmt2 = two)
        else semTools::htmt(hm, data = gdata, htmt2 = two)), error = function(e) NULL)
      if (is.null(h)) return(out)
      for (a in seq_along(blocks)) for (c in seq_along(blocks)) out[blocks[a], blocks[c]] <- h[lv_lname[blocks[a]], lv_lname[blocks[c]]]
      out
    }
    fm <- lavaan::fitMeasures(fit)
    fmv <- as.list(fm[intersect(c("npar", "chisq", "df", "pvalue", "chisq.scaled", "df.scaled", "pvalue.scaled", "chisq.scaling.factor",
      "chisq.shift.parameter", "baseline.chisq", "baseline.df", "baseline.chisq.scaled", "cfi", "tli", "cfi.scaled", "tli.scaled",
      "cfi.robust", "tli.robust", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.pvalue", "rmsea.scaled", "rmsea.robust",
      "srmr", "logl", "aic", "bic"), names(fm))])
    vc <- tryCatch(unclass(lavaan::lavInspect(fit, "vcov")), error = function(e) NULL)
    n_in <- if (b$matrix_input) b$inputs$N else nrow(b$inputs$data)

    list(
      estimator = req$estimator, n = if (is.null(g)) lavaan::lavInspect(fit, "nobs") else lavaan::lavInspect(fit, "nobs")[g],
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
    c(per[[1]], list(groups = list(labels = as.character(groups), results = per, score = ps_cb_score(fit, nm))))
  } else map_group(NULL)
  out$modindices <- ps_cb_modindices(fit, nm, groups)
  ps_json(out)
}

#' Modification indices (lavaan::modindices) at or above 3.84, largest first, in the app's names.
ps_cb_modindices <- function(fit, nm, groups) {
  mi <- tryCatch(lavaan::modindices(fit, sort. = TRUE, minimum.value = 3.84, maximum.number = 100), error = function(e) NULL)
  if (is.null(mi) || !nrow(mi)) return(list())
  mi <- mi[mi$op %in% c("=~", "~", "~~"), ]
  back <- function(x) { y <- nm(x); ifelse(is.na(y), x, y) }
  lapply(seq_len(nrow(mi)), function(i) list(lhs = back(mi$lhs[i]), op = mi$op[i], rhs = back(mi$rhs[i]), mi = mi$mi[i], epc = mi$epc[i],
    sepc = mi$sepc.all[i], group = if (length(groups) > 1 && "group" %in% names(mi)) as.character(groups[mi$group[i]]) else NULL))
}

#' Score tests of releasing each equality constraint (lavaan::lavTestScore): which across-group
#' equality is worst (partial invariance).
ps_cb_score <- function(fit, nm) {
  st <- tryCatch(lavaan::lavTestScore(fit)$uni, error = function(e) NULL)
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
