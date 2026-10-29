# PLS Studio <-> lavaan. Builds the lavaan script for the diagram (JSON
# request), runs it, and returns what the app's CB-SEM views need, with the
# user's names restored. ps_cb(req, export = TRUE) returns the script instead.
# All estimation is lavaan's; this file only writes code and shapes output.

#' "1*a + b + c": the marker loading fixed to 1, made explicit.
#' Loadings of a factor: the marker fixed to 1 (or to the user's value), other user-fixed loadings as value*name.
ps_marked <- function(v, fixed = list()) {
  pre <- vapply(v, function(x) if (!is.null(fixed[[x]])) paste0(ps_num(fixed[[x]]), "*") else "", "")
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
      lines <- c(lines, paste(lname[[j]], "=~", ps_marked(v, fixed)))
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
    rhs <- vapply(ps, function(p) paste0(if (is.null(p$fixed)) "" else paste0(ps_num(p$fixed), "*"), lname[[p$from]]), "")
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
    lines <- c(lines, paste(a, "~~", if (isTRUE(cv$zero)) paste0("0*", b) else if (!is.null(cv$fixed)) paste0(ps_num(cv$fixed), "*", b) else b))
  }
  call <- if (matrix_input) sprintf("fit <- sem(model, sample.cov = S, sample.nobs = N%s, estimator = \"%s\")", if (!is.null(inputs$NACOV)) ", NACOV = NACOV" else "", req$estimator)
    else sprintf("fit <- sem(model, data = data, estimator = \"%s\")", req$estimator)
  body <- c(body, "model <- '", paste0("  ", lines), "'", call)
  list(n = n, k0 = k0, comps = comps, is_cov = is_cov, lname = lname, mods = mods, int_names = int_names, prod = prod,
    inputs = inputs, body = body, matrix_input = matrix_input)
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

  pt <- lavaan::parTable(fit)
  pe <- lavaan::parameterEstimates(fit, standardized = TRUE, remove.nonfree = FALSE)
  pe$free <- pt$free[match(paste(pe$lhs, pe$op, pe$rhs), paste(pt$lhs, pt$op, pt$rhs))]
  pe <- pe[pe$op %in% c("=~", "~", "~~"), ]
  est <- lapply(seq_len(nrow(pe)), function(i) {
    r <- pe[i, ]; free <- r$free > 0
    kind <- if (r$op == "=~") { if (!free) "fixed-loading" else if (is_lv(r$rhs)) "hoLoading" else "loading" }
      else if (r$op == "~") "regression"
      else if (is_lv(r$lhs) && is_lv(r$rhs)) { if (free) "lvcov" else "fixed" }
      else if (!free) NA_character_
      else if (r$lhs == r$rhs) "residual" else "rescov"
    if (is.na(kind)) return(NULL)
    list(kind = kind, lhs = nm(r$lhs), op = r$op, rhs = nm(r$rhs), est = r$est,
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
  r2 <- lavaan::lavInspect(fit, "r2")
  r2_ind <- vapply(ind_v, function(v) if (v %in% names(r2)) unname(r2[[v]]) else 1, 0)
  endo <- vapply(seq_len(K), function(j) any(has[, j]) || any(vapply(comps, function(cc) constructs[j] %in% cc, TRUE)), TRUE)
  r2_con <- lapply(seq_len(K), function(j) if (endo[j] && lv_lname[j] %in% names(r2)) unname(r2[[lv_lname[j]]]) else NULL)
  call <- lavaan::lavInspect(fit, "cor.all")
  lvcor <- call[lv_lname, lv_lname, drop = FALSE]
  rel <- lapply(seq_len(K), function(j) {
    l <- std_load[ind_con == j - 1]
    if (!length(l) || (j <= k0 && length(comps[[j]]))) return(list(cr = NULL, ave = NULL))
    list(cr = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)), ave = mean(l^2))
  })
  res <- lavaan::lavResiduals(fit, type = "cor.bollen", summary = FALSE)$cov[ind_v, ind_v]
  # HTMT on the measurement blocks (semTools), classic and HTMT2.
  htmt <- function(two) {
    out <- matrix(NA_real_, K, K)
    blocks <- which(vapply(seq_len(K), function(j) sum(ind_con == j - 1) >= 2 && !(j <= k0 && b$is_cov[j]), TRUE))
    if (length(blocks) < 2 || !requireNamespace("semTools", quietly = TRUE)) return(out)
    hm <- paste(vapply(blocks, function(j) paste(lv_lname[j], "=~", paste(ind_v[ind_con == j - 1], collapse = " + ")), ""), collapse = "\n")
    h <- tryCatch(suppressWarnings(if (b$matrix_input) semTools::htmt(hm, sample.cov = b$inputs$S, htmt2 = two)
      else semTools::htmt(hm, data = env$data, htmt2 = two)), error = function(e) NULL)
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

  ps_json(list(
    estimator = req$estimator, n = lavaan::lavInspect(fit, "nobs"),
    iterations = lavaan::lavInspect(fit, "iterations"), converged = lavaan::lavInspect(fit, "converged"),
    constructs = constructs,
    indicators = lapply(seq_along(indicators), function(i) list(name = indicators[i], construct = ind_con[i])),
    estimates = est, fit = lapply(fmv, as.numeric),
    r2Indicators = unname(r2_ind), r2Constructs = r2_con, stdLoadings = std_load,
    stdPaths = stdB, hasPath = has, stdTotal = total, stdIndirect = total - stdB,
    lvCor = unname(lvcor), reliability = rel, residualCor = unname(res),
    htmt = htmt(FALSE), htmt2 = htmt(TRUE), vcov = if (is.null(vc)) NULL else unname(vc),
    moderations = lapply(seq_along(mods), function(q) list(from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L)),
    warnings = env$.warnings, droppedRows = n_in - lavaan::lavInspect(fit, "nobs"),
    engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))
  ))
}
