#' Diagnosing misfit of a fitted CB-SEM model (the "Diagnose misfit" panel of the Model fit tab):
#' the largest residual correlations with their z-statistics (lavaan::lavResiduals), and the modification
#' indices with their standardised expected parameter change (lavaan::modindices, sepc.all), largest |SEPC|
#' first (Saris, Satorra & van der Veld 2009 judge a fixed parameter by its SEPC and the power of its MI test,
#' not by the size of the MI). The app judges each row from these numbers (src/rengine/misfit.ts).
#'
#' The lines below are the R code that computes them, returned with the results so the panel can show the code
#' to run after the model's own script. ps_cb_misfit evaluates this text, except that the first statement's
#' table (`mi_all <- modindices(fit)`) is the one the modification indices tab already computed with that call
#' (ps_cb_modindices): lavaan runs modindices once per fit.
ps_misfit_mi_line <- "mi_all <- modindices(fit)"

ps_misfit_code <- function(top_mi, top_res) {
  c(
    "# Modification indices, ranked by the size of the standardised expected parameter change (sepc.all)",
    ps_misfit_mi_line,
    "mi_all <- mi_all[mi_all$op %in% c(\"=~\", \"~\", \"~~\") & is.finite(mi_all$sepc.all), ]",
    sprintf("mi_by_sepc <- head(mi_all[order(-abs(mi_all$sepc.all)), ], %d)", as.integer(top_mi)),
    "# Residual correlations (observed minus implied) and their z-statistics (standardized residuals)",
    "res <- lavResiduals(fit, type = \"cor.bollen\", summary = FALSE)",
    "# (one group: the list itself; several groups: one list per group)",
    "res_blocks <- if (!is.null(res$cov)) list(res) else res",
    "largest_residuals <- lapply(res_blocks, function(r) {",
    "  low <- which(lower.tri(r$cov), arr.ind = TRUE)",
    "  z <- if (is.null(r$cov.z)) rep(NA_real_, nrow(low)) else r$cov.z[low]",
    "  d <- data.frame(a = colnames(r$cov)[low[, 2]], b = rownames(r$cov)[low[, 1]], r = r$cov[low], z = z)",
    "  # (largest |z| first; without z-statistics, largest |r|)",
    "  key <- ifelse(is.finite(d$z), abs(d$z), -1) * 1e6 + abs(d$r)",
    sprintf("  head(d[order(-key), ], %d)", as.integer(top_res)),
    "})"
  )
}

#' The misfit diagnostics of `fit`, in the app's names (`back`), per group (`groups`: the group labels).
#' `mi_all`: lavaan::modindices(fit) as ps_cb_modindices computed it (NULL with `mi_error`, why lavaan could not).
#' list(mi, residuals, code), or list(error) when lavaan cannot compute them.
ps_cb_misfit <- function(fit, back, groups, mi_all, mi_error = NULL, top_mi = 150L, top_res = 20L) {
  code <- ps_misfit_code(top_mi, top_res)
  if (!is.null(mi_error) || is.null(mi_all)) {
    return(list(error = mi_error %||% "lavaan computed no modification indices.", code = code))
  }
  env <- new.env(parent = globalenv())
  env$fit <- fit
  env$mi_all <- mi_all
  err <- NULL
  withCallingHandlers(
    tryCatch(eval(parse(text = code[code != ps_misfit_mi_line]), envir = env), error = function(e) {
      err <<- ps_flat(conditionMessage(e))
    }),
    warning = function(w) invokeRestart("muffleWarning")
  )
  if (!is.null(err)) {
    return(list(error = err, code = code))
  }
  nm <- function(x) ps_back(x, back)
  group_label <- function(mi, i) {
    if (length(groups) <= 1) {
      return(NULL)
    }
    if ("block" %in% names(mi)) {
      return(as.character(groups[mi$block[i]]))
    }
    if ("group" %in% names(mi)) {
      return(as.character(groups[mi$group[i]]))
    }
    NULL
  }
  mi <- env$mi_by_sepc
  mi_rows <- lapply(seq_len(nrow(mi)), function(i) {
    list(
      lhs = nm(mi$lhs[i]),
      op = mi$op[i],
      rhs = nm(mi$rhs[i]),
      mi = unname(mi$mi[i]),
      epc = unname(mi$epc[i]),
      sepc = unname(mi$sepc.all[i]),
      group = group_label(mi, i)
    )
  })
  blocks <- env$largest_residuals
  residuals <- lapply(seq_along(blocks), function(g) {
    d <- blocks[[g]]
    list(
      group = if (length(blocks) > 1) as.character(names(blocks)[g] %||% groups[g]) else NULL,
      pairs = lapply(seq_len(nrow(d)), function(i) {
        list(
          a = nm(d$a[i]),
          b = nm(d$b[i]),
          r = unname(d$r[i]),
          z = if (is.finite(d$z[i])) unname(d$z[i]) else NULL
        )
      })
    )
  })
  list(
    mi = mi_rows,
    # (the number of fixed parameters lavaan computed an index for, before the ranking kept the largest)
    miCount = nrow(env$mi_all),
    residuals = residuals,
    code = code
  )
}
