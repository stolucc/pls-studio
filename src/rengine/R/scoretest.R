# Score-based tests of measurement invariance (parameter instability) along a
# continuous, ordinal or categorical covariate (Merkle & Zeileis 2013; Merkle,
# Fan & Zeileis 2014; Wang, Merkle & Zeileis 2014): the CB-SEM model on the
# canvas is fitted once with lavaan, as the Model tab fits it; its casewise
# scores (lavaan's estfun), ordered by the covariate, form an empirical
# fluctuation process (strucchange::gefp) whose functional is the test: double
# max (DM), Cramér-von Mises (CvM) and the maximum Lagrange multiplier (maxLM)
# for a continuous covariate, the weighted double max (WDMo) and maxLMo for an
# ordinal one, the unordered LM test (LMuo) for a categorical one. Only the
# chosen parameters are tested; the others are nuisance parameters, decorrelated
# from them by the information matrix ("info", as the authors' code).

#' The functionals by kind of covariate, and the parameter sets that can be tested.
.ps_sc_fns <- list(continuous = c("DM", "CvM", "maxLM"), ordinal = c("WDMo", "maxLMo"), categorical = "LMuo")
.ps_sc_sets <- c("loadings", "intercepts", "residuals", "rescov", "lvvar", "lvcov", "means", "regressions", "all")

#' The lavaan lines after the fit: scores with equality-constrained copies merged (K, the same reduction as
#' lavaan's estfun), the information matrix in the same parameters, the parameters tested, the process and the test.
ps_sc_lines <- function(zv, scale, fn, sets, seed, nrep) {
  zexpr <- if (scale == "continuous") {
    sprintf("data$%s[rows]", zv)
  } else {
    sprintf("factor(data$%s[rows])", zv)
  }
  c(
    "# Equality constraints (a == b, from labels or group equalities) merged: lavaan's scores have one column per",
    "# distinct parameter, the first of each set of equal ones (K maps them to the free parameters).",
    "pt <- parTable(fit)",
    "if (any(pt$op %in% c(\"<\", \">\"))) stop(\"Score-based tests are not available with inequality constraints.\")",
    "root <- seq_len(max(pt$free))",
    "plab <- setNames(pt$free[pt$free > 0], pt$plabel[pt$free > 0])",
    "eq <- pt[pt$op == \"==\", , drop = FALSE]",
    "for (i in seq_len(nrow(eq))) {",
    "  a <- plab[eq$lhs[i]]; b <- plab[eq$rhs[i]]",
    "  if (anyNA(c(a, b))) stop(\"Score-based tests need simple equality constraints (a == b) only.\")",
    "  ra <- root[a]; rb <- root[b]; root[root == max(ra, rb)] <- min(ra, rb)",
    "}",
    "keep <- sort(unique(root))",
    "K <- outer(root, keep, `==`) * 1",
    "info <- function(x, ...) t(K) %*% lavInspect(x, \"information\") %*% K",
    "# The kind of each distinct parameter, and those tested",
    "pk <- pt[match(keep, pt$free), ]",
    "ov <- lavNames(fit, \"ov\")",
    "kind <- ifelse(pk$op == \"=~\", \"loadings\", ifelse(pk$op == \"~\", \"regressions\", ifelse(pk$op == \"~1\", ifelse(pk$lhs %in% ov, \"intercepts\", \"means\"),",
    "  ifelse(pk$op == \"~~\", ifelse(pk$lhs %in% ov, ifelse(pk$lhs == pk$rhs, \"residuals\", \"rescov\"), ifelse(pk$lhs == pk$rhs, \"lvvar\", \"lvcov\")), pk$op))))",
    sprintf("sets <- %s", ps_q(sets)),
    "parm <- if (\"all\" %in% sets) seq_along(kind) else which(kind %in% sets)",
    "if (!length(parm)) stop(\"The model has none of the parameters chosen for the test.\")",
    "# The covariate of the observations lavaan used, in the order of the scores",
    "rows <- sort(unlist(lavInspect(fit, \"case.idx\")))",
    sprintf("z <- %s", zexpr),
    "if (NROW(estfun(fit)) != length(z) || NCOL(estfun(fit)) != ncol(K)) stop(\"The casewise scores do not match the observations used.\")",
    "# Empirical fluctuation process of the scores ordered by the covariate, decorrelated by the information matrix",
    "scus <- gefp(fit, fit = NULL, order.by = z, vcov = info, sandwich = FALSE, parm = parm)",
    switch(fn,
      DM = "fun <- maxBB  # double maximum",
      CvM = "fun <- meanL2BB  # Cramer-von Mises",
      maxLM = "fun <- supLM(from = 0.1)  # maximum Lagrange multiplier, 10% trimmed at either end",
      WDMo = c(
        "fun <- ordwmax(z)  # weighted double maximum, ordinal",
        sprintf(
          "set.seed(%d)  # (its p-value is a multivariate normal probability by randomised quadrature, mvtnorm)",
          seed
        )
      ),
      maxLMo = c(
        sprintf("set.seed(%d)", seed),
        sprintf(
          "fun <- ordL2BB(z, nproc = NCOL(scus$process), nrep = %d)  # maximum LM, ordinal (critical values simulated)",
          nrep
        )
      ),
      LMuo = "fun <- catL2BB(z)  # unordered LM, categorical"
    ),
    "test <- sctest(scus, functional = fun)"
  )
}

#' The aggregated process as strucchange plots it (plot(scus, functional = fun)), at most about 600 points, with the
#' 5% boundary; categories (ordinal and categorical) at their upper ends; LMuo: each category's contribution.
ps_sc_series <- function(scus, fun, fn, z) {
  P <- as.matrix(scus$process)
  k <- ncol(P)
  n <- nrow(P) - 1L
  P1 <- P[-1L, , drop = FALSE]
  crit <- fun$computeCritval(alpha = 0.05, nproc = k)
  thin <- function(y, at) {
    i <- unique(sort(c(round(seq(1, length(y), length.out = min(length(y), 600))), which.max(y))))
    list(x = I(at[i]), y = I(unname(y[i])))
  }
  if (fn %in% c("DM", "CvM", "maxLM")) {
    tz <- as.numeric(time(scus))[-1L]
    if (fn == "DM") {
      return(c(thin(apply(abs(P1), 1, max), tz), list(boundary = crit, labels = NULL)))
    }
    if (fn == "CvM") {
      return(c(thin(rowSums(P1^2), tz), list(boundary = crit, labels = NULL)))
    }
    t <- seq_len(n) / n
    ok <- t >= 0.1 & t <= 0.9
    return(c(thin((rowSums(P1^2) / (t * (1 - t)))[ok], tz[ok]), list(boundary = crit, labels = NULL)))
  }
  nc <- as.vector(table(z))
  ix <- cumsum(nc)
  tt <- ix / n
  lev <- levels(z)
  if (fn == "LMuo") {
    inc <- rbind(P1[ix[1], ], diff(P1[ix, , drop = FALSE]))
    return(list(x = I(seq_along(lev)), y = I(unname(rowSums(inc^2) / (nc / n))), boundary = crit, labels = I(lev)))
  }
  m <- length(lev) - 1L
  y <- if (fn == "WDMo") {
    apply(abs(P1[ix[1:m], , drop = FALSE]), 1, max) / sqrt(tt[1:m] * (1 - tt[1:m]))
  } else {
    rowSums(P1[ix[1:m], , drop = FALSE]^2) / (tt[1:m] * (1 - tt[1:m]))
  }
  list(x = I(seq_len(m)), y = I(unname(y)), boundary = I(unname(crit * fun$boundary(tt[1:m]))), labels = I(lev[1:m]))
}

ps_scoretest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  what <- "Score-based invariance tests"
  ps_cb_plain(b, what)
  if (!grepl("^fit <- sem\\(.*\\)$", b$call)) {
    stop(sprintf("%s are not available for this model.", what))
  }
  if (!req$estimator %in% c("ML", "MLR")) {
    stop(sprintf("%s use the casewise scores of maximum likelihood: choose ML or MLR.", what))
  }
  if (length(unlist(req$model$ordered))) {
    stop(sprintf("%s are for continuous indicators (maximum likelihood); the model has ordinal indicators.", what))
  }
  if (!(req$missing %||% "casewise") %in% c("casewise", "mean", "fiml")) {
    stop(sprintf("%s need casewise deletion, mean replacement or FIML for missing values.", what))
  }
  if (!is.null(req$model$weights) || !is.null(req$model$cluster)) {
    stop(sprintf("%s are not available with sampling weights or sampling clusters.", what))
  }
  o <- req$scoretest
  scale <- o[["scale", exact = TRUE]]
  if (!(is.character(scale) && length(scale) == 1 && scale %in% names(.ps_sc_fns))) {
    stop("Invalid kind of covariate in the request.")
  }
  fn <- o[["fn", exact = TRUE]]
  if (!(is.character(fn) && length(fn) == 1 && fn %in% .ps_sc_fns[[scale]])) {
    stop(sprintf("Invalid test for a %s covariate in the request.", scale))
  }
  sets <- unique(as.character(unlist(o$sets)))
  if (!length(sets) || !all(sets %in% .ps_sc_sets)) {
    stop("Invalid parameters to test in the request.")
  }
  seed <- as.integer(ps_number(o$seed %||% 1, "seed"))
  nrep <- as.integer(ps_number(o$nrep %||% 50000, "replications"))
  if (is.na(nrep) || nrep < 1000L || nrep > 200000L) {
    stop("The number of replications must be between 1000 and 200000.")
  }
  cov <- o[["covariate", exact = TRUE]]
  if (!(is.character(cov) && length(cov) == 1 && nzchar(cov))) {
    stop("Invalid covariate in the request.")
  }
  z <- suppressWarnings(as.numeric(unlist(lapply(o$values, function(v) if (is.null(v)) NA else v))))
  if (length(z) != nrow(b$inputs$data)) stop("The covariate's values do not match the data's rows.")
  if (sum(!is.na(z)) < 10) stop("The covariate has fewer than 10 values.")
  zlev <- unique(z[!is.na(z)])
  if (scale != "continuous" && length(zlev) < 2) stop("The covariate has a single value.")
  if (scale != "continuous" && length(zlev) > 50) {
    stop("An ordinal or categorical covariate may have at most 50 values; treat it as continuous.")
  }
  # The covariate travels with the data under a name no model variable has; rows without it are left out.
  zv <- ps_ident(c(names(b$inputs$data), cov))[ncol(b$inputs$data) + 1L]
  inputs <- b$inputs
  inputs$data[[zv]] <- z
  drop <- sprintf(
    "data <- data[!is.na(data$%s)%s, , drop = FALSE]",
    zv,
    if (!is.null(b$group_var)) sprintf(" & !is.na(data$%s)", b$group_var) else ""
  )
  body <- c(
    b$body[1], sprintf("# The covariate %s: rows without it%s are left out", ps_comment(cov), if (!is.null(b$group_var)) " (or without a group)" else ""), drop,
    b$body[-1], "suppressPackageStartupMessages(library(strucchange))",
    sprintf("# Score-based test of parameter instability along %s (%s covariate, %s)", ps_comment(cov), scale, fn),
    ps_sc_lines(zv, scale, fn, sets, seed, nrep)
  )
  if (export) {
    return(ps_script(
      sprintf("Score-based invariance test along %s: %s (strucchange)", cov, fn), c("lavaan", "strucchange"), inputs, body,
      c("test", "plot(scus, functional = fun)")
    ))
  }
  env <- ps_run(body, inputs)
  back <- ps_back_map(b)
  pk <- env$pk[env$parm, , drop = FALSE]
  ng <- lavaan::lavInspect(env$fit, "ngroups")
  shared <- vapply(env$keep[env$parm], function(j) sum(env$root == j) > 1, TRUE)
  glab <- if (ng > 1) lavaan::lavInspect(env$fit, "group.label") else character(0)
  OPS <- c("=~" = " → ", "~" = " ← ", "~~" = " ↔ ")
  label <- vapply(seq_len(nrow(pk)), function(i) {
    l <- ps_back(pk$lhs[i], back)
    r <- ps_back(pk$rhs[i], back)
    s <- if (pk$op[i] == "~1") {
      sprintf("%s (%s)", l, if (pk$lhs[i] %in% env$ov) "intercept" else "mean")
    } else if (pk$op[i] == "~~" && pk$lhs[i] == pk$rhs[i]) {
      sprintf("%s (variance)", l)
    } else {
      paste0(l, OPS[[pk$op[i]]] %||% pk$op[i], r)
    }
    if (ng > 1) sprintf("%s, %s", s, if (shared[i]) "all groups (equal)" else sprintf("group %s", glab[pk$group[i]])) else s
  }, "")
  P <- as.matrix(env$scus$process)
  z_used <- env$z
  # (WDMo's critical values are multivariate normal quantiles by randomised quadrature: seeded, so a run is reproducible)
  set.seed(seed)
  critical <- env$fun$computeCritval(alpha = 0.05, nproc = ncol(P))
  set.seed(seed)
  series <- ps_sc_series(env$scus, env$fun, fn, z_used)
  # (where the aggregated process peaks: the covariate value, or the category, splitting the observations best)
  top <- which.max(series$y)
  peak <- if (scale == "continuous") {
    as.numeric(series$x[top])
  } else if (fn == "LMuo") {
    NULL
  } else {
    as.character(series$labels[top])
  }
  ps_json(list(
    fn = fn, scale = scale, covariate = cov, n = length(z_used), nGroups = ng,
    statistic = unname(env$test$statistic), p = unname(env$test$p.value),
    params = I(label), kinds = I(unname(env$kind[env$parm])), componentMax = I(unname(apply(abs(P), 2, max))),
    critical = critical, peak = peak,
    levels = if (scale != "continuous") I(levels(z_used)) else NULL,
    series = series,
    nrep = if (fn == "maxLMo") nrep else NULL, seed = if (fn %in% c("maxLMo", "WDMo")) seed else NULL,
    warnings = env$.warnings,
    engine = ps_engine("strucchange", lavaan = "lavaan")
  ))
}
