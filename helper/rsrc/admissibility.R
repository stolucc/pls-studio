# Admissibility of a fitted lavaan model, checked independently of lavaan's own post.check.
# For every block (group and/or level) it returns the eigenvalue range of the model matrices:
# the model-implied covariance matrix of the observed variables (Sigma-hat), the covariance
# matrix of the latent variables (cov.lv), the residual covariance matrix (theta), the
# disturbance covariance matrix (psi) and the sample covariance (or polychoric) matrix. With
# ordinal indicators, the pairs whose two-way table has empty cells. The names of the free
# parameters (in vcov order) and the number of equality constraints let the app check vcov.
# Nothing here changes an estimate; the app (src/engine/admissibility.ts) grades the findings.

#' The eigenvalue range of one symmetric matrix, and the variables most involved in its smallest
#' eigenvalue (eigenvector entries at least half the largest in size; at most four).
ps_adm_spectrum <- function(m, what, nm) {
  m <- unclass(m)
  if (!is.matrix(m) || nrow(m) == 0) {
    return(NULL)
  }
  names_m <- rownames(m)
  if (any(!is.finite(m))) {
    return(list(matrix = what, size = nrow(m), finite = FALSE))
  }
  e <- eigen((m + t(m)) / 2, symmetric = TRUE)
  k <- length(e$values)
  v <- abs(e$vectors[, k])
  ranked <- order(-v)
  involved <- ranked[v[ranked] >= 0.5 * max(v)]
  involved <- involved[seq_len(min(4L, length(involved)))]
  negative <- which(diag(m) < 0)
  list(
    matrix = what,
    size = k,
    finite = TRUE,
    min = e$values[k],
    max = e$values[1],
    involved = I(nm(names_m[involved])),
    negativeDiagonal = I(nm(names_m[negative]))
  )
}

#' Ordinal indicators: per group, the pairs whose observed two-way table has an empty cell, with
#' the number of cells, empty cells and cells with fewer than 5 cases, and the pair's sample
#' polychoric correlation. (lavTables' observed frequencies; at most 50 pairs, most empty first.)
ps_adm_sparse <- function(fit, nm) {
  if (length(lavaan::lavNames(fit, "ov.ord")) < 2) {
    return(NULL)
  }
  tb <- lavaan::lavTables(fit, dimension = 2L, type = "cells")
  if (is.null(tb) || !nrow(tb)) {
    return(NULL)
  }
  s <- lavaan::lavInspect(fit, "sampstat")
  if (!is.null(s$cov)) s <- list(s)
  lapply(seq_len(lavaan::lavInspect(fit, "ngroups")), function(g) {
    t <- if ("group" %in% names(tb)) tb[tb$group == g, , drop = FALSE] else tb
    key <- paste(t$lhs, t$rhs, sep = "\r")
    pairs <- unique(key)
    R <- stats::cov2cor(unclass(s[[g]]$cov))
    rows <- lapply(pairs, function(p) {
      cells <- t[key == p, , drop = FALSE]
      empty <- sum(cells$obs.freq == 0)
      if (empty == 0) {
        return(NULL)
      }
      a <- as.character(cells$lhs[1])
      b <- as.character(cells$rhs[1])
      list(
        a = nm(a),
        b = nm(b),
        cells = nrow(cells),
        empty = empty,
        sparse = sum(cells$obs.freq < 5),
        r = if (a %in% rownames(R) && b %in% rownames(R)) R[a, b] else NA_real_
      )
    })
    rows <- Filter(Negate(is.null), rows)
    rows <- rows[order(-vapply(rows, `[[`, 0, "empty"))]
    list(pairs = rows[seq_len(min(50L, length(rows)))], total = length(rows))
  })
}

#' The admissibility information of a lavaan fit. `back`: lavaan names to the app's names;
#' `labels`: the block labels as the app shows them (one per group and/or level).
ps_cb_admissibility <- function(fit, back, labels) {
  nm <- function(x) ps_back(x, back, TRUE)
  nb <- fit@Model@nblocks
  per_block <- function(x) if (nb == 1) list(x) else x
  inspect <- function(what) tryCatch(per_block(lavaan::lavInspect(fit, what)), error = function(e) NULL)
  implied <- inspect("cov.ov")
  latent <- inspect("cov.lv")
  theta <- inspect("theta")
  # (psi, the disturbance covariances, from the estimates: lavInspect has no "psi" of its own)
  psi <- lapply(inspect("est") %||% list(), function(x) x$psi)
  sample <- tryCatch(
    {
      s <- lavaan::lavInspect(fit, "sampstat")
      if (!is.null(s$cov)) s <- list(s)
      lapply(s, function(x) x$cov)
    },
    error = function(e) NULL
  )
  blocks <- lapply(seq_len(nb), function(i) {
    one <- function(x, what) if (length(x) >= i) ps_adm_spectrum(x[[i]], what, nm)
    list(
      label = if (length(labels) >= i) labels[[i]] else NULL,
      matrices = Filter(Negate(is.null), list(
        one(sample, "sample"),
        one(implied, "implied"),
        one(latent, "latent"),
        one(psi, "psi"),
        one(theta, "theta")
      ))
    )
  })
  # The free parameters in vcov order, as the app names them; a group's label after its parameters.
  pt <- lavaan::parTable(fit)
  free <- pt[pt$free > 0, , drop = FALSE]
  free <- free[order(free$free), , drop = FALSE]
  # (by block, as the app labels groups and levels; the app puts category names for codes)
  group_label <- if ("block" %in% names(free) && nb > 1 && length(labels) >= nb) {
    paste0(" (", labels[free$block], ")")
  } else {
    ""
  }
  rhs <- ifelse(free$op %in% c("~1", "|"), free$rhs, nm(free$rhs))
  op <- ifelse(free$op == "~1", "~ 1", free$op)
  vcov_names <- paste0(nm(free$lhs), " ", op, " ", ifelse(free$op == "~1", "", rhs), group_label)
  list(
    blocks = blocks,
    vcovNames = I(trimws(gsub(" +", " ", vcov_names))),
    # lavaan drops one eigenvalue of vcov per equality constraint before its own check (lav_model_vcov)
    equalityConstraints = sum(pt$op == "=="),
    sparse = ps_adm_sparse(fit, nm)
  )
}
