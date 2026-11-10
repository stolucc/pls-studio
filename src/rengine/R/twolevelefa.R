#' Two-level exploratory factor analysis (Mplus TYPE = TWOLEVEL EFA): factors at the within and the between level, or
#' a level left unrestricted. lavaan's efa() blocks fail in two-level models, so each level's factors are fitted
#' unrotated (the usual echelon identification: loading j of factor k fixed at 0 for j < k, factor variances 1,
#' uncorrelated), the level's loadings standardised by its model-implied standard deviations (Mplus's row
#' standardisation = CORRELATION) and rotated by oblique geomin (GPArotation, many random starts, as Mplus), and the
#' standard errors of the rotated loadings, factor correlations and standardised residual variances follow by the
#' delta method from the covariance matrix of the unrotated estimates (numerical derivatives of the whole map, the
#' rotation included).

ps_efa2_syntax <- function(ys, k, prefix) {
  if (identical(k, "U")) {
    p <- length(ys)
    return(unlist(lapply(seq_len(p), function(i) sprintf("%s ~~ %s", ys[i], paste(ys[i:p], collapse = " + ")))))
  }
  fs <- sprintf("%s%d", prefix, seq_len(k))
  c(vapply(seq_len(k), function(j) sprintf("%s =~ %s", fs[j], paste(c(if (j > 1) sprintf("0*%s", ys[seq_len(j - 1)]), sprintf("NA*%s", ys[j]), if (j < length(ys)) ys[(j + 1):length(ys)]), collapse = " + ")), ""),
    sprintf("%s ~~ 1*%s", fs, fs),
    if (k > 1) unlist(lapply(seq_len(k - 1), function(i) sprintf("%s ~~ 0*%s", fs[i], fs[(i + 1):k]))))
}

#' Mplus's geomin epsilon by the number of factors (0.0001 for 2, 0.001 for 3, 0.01 for 4 or more).
ps_efa2_epsilon <- function(k) if (k <= 2) 1e-4 else if (k == 3) 1e-3 else 1e-2

PS_EFA2_FUNCTIONS <- c(
  "# One level's loadings, standardised and geomin-rotated: x the unrotated estimates (lavaan's free parameters).",
  "efa2_level <- function(x, fit, lev, ys, fs, eps, T0 = NULL, ref = NULL, starts = 30) {",
  "  pt <- lavaan::parTable(fit); est <- pt$est; est[pt$free > 0] <- x[pt$free[pt$free > 0]]",
  "  L <- matrix(0, length(ys), length(fs), dimnames = list(ys, fs)); th <- setNames(numeric(length(ys)), ys)",
  "  for (i in which(pt$level == lev)) {",
  "    if (pt$op[i] == \"=~\") L[pt$rhs[i], pt$lhs[i]] <- est[i]",
  "    if (pt$op[i] == \"~~\" && pt$lhs[i] == pt$rhs[i] && pt$lhs[i] %in% ys) th[pt$lhs[i]] <- est[i]",
  "  }",
  "  sdv <- sqrt(rowSums(L^2) + th); Ls <- L / sdv",
  "  k <- length(fs)",
  "  if (k == 1) { s <- if (is.null(ref)) sign(sum(Ls)) else sign(sum(Ls * ref)); return(list(L = Ls * s, Phi = matrix(1, 1, 1), th = th / sdv^2, Tm = matrix(1), f = NA_real_)) }",
  "  best <- NULL",
  "  for (s in seq_len(if (is.null(T0)) starts else 1)) {",
  "    set.seed(s); Ti <- if (!is.null(T0)) T0 else if (s == 1) diag(k) else qr.Q(qr(matrix(stats::rnorm(k * k), k)))",
  "    r <- GPArotation::geominQ(Ls, Tmat = Ti, delta = eps, normalize = FALSE, eps = 1e-9, maxit = 20000)",
  "    if (is.null(best) || min(r$Table[, 2]) < min(best$Table[, 2]) - 1e-10) best <- r",
  "  }",
  "  Lr <- unclass(best$loadings); attr(Lr, \"covariance\") <- NULL; Phi <- best$Phi",
  "  # the same factors in the same order and direction as the reference solution (for the derivatives), or",
  "  # columns ordered by their sums of squares and pointing positive",
  "  if (!is.null(ref)) {",
  "    perms <- if (k <= 6) { g <- as.matrix(expand.grid(rep(list(seq_len(k)), k))); g[apply(g, 1, function(r) length(unique(r)) == k), , drop = FALSE] } else matrix(seq_len(k), 1)",
  "    o <- perms[which.max(apply(perms, 1, function(pm) sum(abs(colSums(Lr[, pm, drop = FALSE] * ref))))), ]",
  "  } else o <- order(-colSums(Lr^2))",
  "  Lr <- Lr[, o, drop = FALSE]; Phi <- Phi[o, o, drop = FALSE]",
  "  sg <- if (!is.null(ref)) sign(colSums(Lr * ref)) else sign(colSums(Lr^3)); sg[sg == 0] <- 1",
  "  Lr <- sweep(Lr, 2, sg, `*`); Phi <- Phi * outer(sg, sg)",
  "  colnames(Lr) <- fs",
  "  list(L = Lr, Phi = Phi, th = th / sdv^2, Tm = best$Th, f = min(best$Table[, 2]))",
  "}",
  "# The delta method for one level: the rotated loadings, factor correlations and standardised residual variances.",
  "efa2_se <- function(fit, lev, ys, fs, eps, sol) {",
  "  x0 <- lavaan::coef(fit); V <- lavaan::vcov(fit)",
  "  g <- function(x) { r <- efa2_level(x, fit, lev, ys, fs, eps, T0 = sol$Tm, ref = sol$L); c(r$L, r$Phi[lower.tri(r$Phi)], r$th) }",
  "  h <- pmax(abs(x0), 1) * 1e-6",
  "  J <- sapply(seq_along(x0), function(i) { e <- replace(numeric(length(x0)), i, h[i]); (g(x0 + e) - g(x0 - e)) / (2 * h[i]) })",
  "  se <- sqrt(pmax(diag(J %*% V %*% t(J)), 0))",
  "  k <- length(fs); p <- length(ys); nl <- p * k; nphi <- k * (k - 1) / 2",
  "  list(L = matrix(se[seq_len(nl)], p, k, dimnames = list(ys, fs)), Phi = se[nl + seq_len(nphi)], th = setNames(se[nl + nphi + seq_len(p)], ys))",
  "}")

ps_efa_twolevel <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  items <- as.character(unlist(req$items)); cl <- req$cluster
  if (length(items) < 3 || length(items) > 30) stop("Choose 3 to 30 items.")
  if (!(is.character(cl) && length(cl) == 1 && nzchar(cl)) || cl %in% items) stop("Choose the cluster column (not one of the items).")
  lev_list <- function(v, what) {
    v <- unlist(v); if (!length(v)) stop(sprintf("Choose the numbers of %s factors.", what))
    out <- lapply(v, function(x) if (identical(x, "U")) "U" else { k <- suppressWarnings(as.integer(x)); if (is.na(k) || k < 1 || k > 6) stop(sprintf("Invalid number of %s factors in the request.", what)); k })
    if (anyDuplicated(vapply(out, as.character, ""))) stop(sprintf("Each number of %s factors once.", what))
    out
  }
  within <- lev_list(req$within, "within"); between <- lev_list(req$between, "between")
  p <- length(items)
  for (k in c(within, between)) if (!identical(k, "U") && (p - k)^2 < p + k) stop(sprintf("%d factors are too many for %d items.", k, p))
  combos <- Filter(Negate(is.null), unlist(lapply(within, function(w) lapply(between, function(b) if (identical(w, "U") && identical(b, "U")) NULL else list(w = w, b = b))), recursive = FALSE))
  if (!length(combos)) stop("Choose factors for at least one level (both unrestricted is the saturated model).")
  if (length(combos) > 12) stop("At most 12 combinations of within and between factors.")
  fr <- ps_long_frame(req, c(items, cl))
  ys <- unname(fr$v[items]); cv <- unname(fr$v[cl])
  body <- c(PS_EFA2_FUNCTIONS, sprintf("ys <- %s", ps_q(ys)), "solutions <- list()")
  for (i in seq_along(combos)) {
    w <- combos[[i]]$w; b <- combos[[i]]$b
    syn <- c("level: 1", ps_efa2_syntax(ys, w, "fw"), "level: 2", ps_efa2_syntax(ys, b, "fb"))
    body <- c(body, sprintf("# %s within, %s between", if (identical(w, "U")) "unrestricted" else sprintf("%d factor(s)", w), if (identical(b, "U")) "unrestricted" else sprintf("%d factor(s)", b)),
      "model <- '", paste0("  ", syn), "'",
      sprintf("fit <- lavaan::sem(model, data = data, cluster = \"%s\", estimator = \"ML\", information = \"observed\")", cv),
      "sol <- list(fit = fit)",
      if (!identical(w, "U")) c(sprintf("fw <- %s", ps_q(sprintf("fw%d", seq_len(w)))), sprintf("sol$within <- efa2_level(lavaan::coef(fit), fit, 1, ys, fw, %s)", format(ps_efa2_epsilon(w))),
        sprintf("sol$within_se <- efa2_se(fit, 1, ys, fw, %s, sol$within)", format(ps_efa2_epsilon(w)))),
      if (!identical(b, "U")) c(sprintf("fb <- %s", ps_q(sprintf("fb%d", seq_len(b)))), sprintf("sol$between <- efa2_level(lavaan::coef(fit), fit, 2, ys, fb, %s)", format(ps_efa2_epsilon(b))),
        sprintf("sol$between_se <- efa2_se(fit, 2, ys, fb, %s, sol$between)", format(ps_efa2_epsilon(b)))),
      sprintf("solutions[[%d]] <- sol", i))
  }
  inputs <- list(data = fr$data)
  if (export) return(ps_script("Two-level exploratory factor analysis (lavaan, geomin rotation by GPArotation)", c("lavaan", "GPArotation"), inputs, body,
    c("lapply(solutions, function(s) list(fit = lavaan::fitMeasures(s$fit, c(\"npar\", \"logl\", \"chisq\", \"df\", \"aic\", \"bic\")), within = s$within[c(\"L\", \"Phi\", \"th\")], between = s$between[c(\"L\", \"Phi\", \"th\")]))")))
  env <- ps_run(body, inputs)
  level_out <- function(sol, se) if (is.null(sol)) NULL else list(
    factors = I(colnames(sol$L)), loadings = lapply(seq_len(nrow(sol$L)), function(r) list(item = items[r], est = I(unname(sol$L[r, ])), se = I(unname(se$L[r, ])))),
    correlations = if (ncol(sol$L) > 1) { ij <- which(lower.tri(sol$Phi), arr.ind = TRUE); lapply(seq_len(nrow(ij)), function(q) list(a = ij[q, 2], b = ij[q, 1], est = sol$Phi[ij[q, 1], ij[q, 2]], se = se$Phi[q])) } else list(),
    residuals = lapply(seq_along(items), function(r) list(item = items[r], est = unname(sol$th[r]), se = unname(se$th[r]))),
    criterion = if (is.na(sol$f)) NULL else sol$f)
  out <- lapply(seq_along(combos), function(i) {
    s <- env$solutions[[i]]; fm <- lavaan::fitMeasures(s$fit, c("npar", "logl", "chisq", "df", "pvalue", "aic", "bic", "rmsea", "cfi", "tli", "srmr_within", "srmr_between"))
    w <- combos[[i]]$w; b <- combos[[i]]$b
    # (Mplus does not count an unrestricted level's variances and covariances among the free parameters)
    nparM <- unname(fm[["npar"]]) - (if (identical(w, "U") || identical(b, "U")) p * (p + 1) / 2 else 0)
    list(within = if (identical(w, "U")) "U" else w, between = if (identical(b, "U")) "U" else b, converged = lavaan::lavInspect(s$fit, "converged"),
      fit = c(as.list(fm), list(nparMplus = nparM)),
      withinLevel = level_out(s$within, s$within_se), betweenLevel = level_out(s$between, s$between_se))
  })
  ps_json(list(items = I(items), cluster = cl, n = lavaan::lavInspect(env$solutions[[1]]$fit, "nobs"), clusters = lavaan::lavInspect(env$solutions[[1]]$fit, "nclusters"),
    solutions = out, warnings = env$.warnings, engine = list(package = "lavaan + GPArotation", version = as.character(utils::packageVersion("lavaan")))))
}
