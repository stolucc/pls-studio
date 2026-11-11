# Dynamic fit index (DFI) cutoffs for the CB-SEM model on the canvas: the
# dynamic package (Wolf & McNeish; dynamicfit.app) simulates the model's own
# fit-index distributions, correctly specified and with graded hypothetical
# misspecifications, and reads the cutoffs off them. The model is fitted with
# lavaan as the Model tab fits it, and the fitted object is handed to the
# dynamic function the request names; its tables are returned as the package
# prints them (character cells), with the simulated distributions behind them.
# The package draws its replications with fixed seeds of its own, so a run is
# reproducible without a seed from the app.

#' The dynamic functions the card can call, and what each takes besides the fit.
.ps_dfi_fns <- c(
  "cfaOne",
  "cfaHB",
  "catOne",
  "catHB",
  "likertOne",
  "likertHB",
  "nnorOne",
  "nnorHB",
  "hier1HB",
  "hier2",
  "exactFit",
  "equivTest",
  "DDDFI"
)
.ps_dfi_with_data <- c("likertOne", "likertHB", "nnorOne", "nnorHB")
.ps_dfi_estimators <- c("ML", "MLR", "MLM", "MLMV", "WLSMV", "ULSMV", "DWLS", "WLS", "ULS", "GLS")

#' A table as dynamic prints it: row and column names and character cells (its
#' cutoff tables are noquote character matrices mixing numbers, "NONE" and
#' percentages; exactFit's is numeric).
ps_dfi_table <- function(m) {
  if (is.null(m)) {
    return(NULL)
  }
  # (a data frame keeps its names through as.matrix; a noquote matrix needs unclass first)
  m <- if (is.data.frame(m)) as.matrix(m) else as.matrix(unclass(m))
  if (!length(m)) {
    return(NULL)
  }
  cells <- lapply(seq_len(nrow(m)), function(i) I(unname(ifelse(is.na(m[i, ]), "", as.character(m[i, ])))))
  list(
    rows = I(if (is.null(rownames(m))) rep("", nrow(m)) else unname(rownames(m))),
    columns = I(if (is.null(colnames(m))) paste0("V", seq_len(ncol(m))) else trimws(unname(colnames(m)))), cells = cells
  )
}

#' The simulated fit indices behind the cutoffs (one column per index and level), numeric columns only, at most 2000 rows.
ps_dfi_columns <- function(d) {
  if (is.null(d) || !is.data.frame(d) || !nrow(d)) {
    return(NULL)
  }
  d <- d[seq_len(min(nrow(d), 2000L)), vapply(d, is.numeric, TRUE), drop = FALSE]
  if (!ncol(d)) {
    return(NULL)
  }
  list(names = I(names(d)), cols = lapply(d, function(x) I(unname(as.numeric(x)))))
}

#' The lavaan test name the estimator implies (lavaan's own default for it): dynamic reads the
#' last entry of fit@Options$test, which lavaan 0.7 leaves at c("standard", "browne...") unless
#' the test is named in the call, so the call names it. The fit is the same.
ps_dfi_test <- function(estimator) {
  switch(estimator,
    ML = ,
    GLS = ,
    ULS = ,
    WLS = "standard",
    MLM = "satorra.bentler",
    MLMV = "scaled.shifted",
    MLR = "yuan.bentler.mplus",
    WLSMV = "scaled.shifted",
    stop(sprintf("Dynamic fit cutoffs are not available with the %s estimator; choose ML, MLM, MLMV, MLR, GLS, ULS, WLS or WLSMV.", estimator))
  )
}

ps_dfi <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Dynamic fit cutoffs", raw = FALSE)
  if (!grepl("^fit <- sem\\(.*\\)$", b$call)) {
    stop("Dynamic fit cutoffs are not available for this model.")
  }
  if (!is.null(b$group_var)) {
    stop("Dynamic fit cutoffs are for a single group: remove the grouping (or analyse each group's data).")
  }
  if (length(b$composites)) {
    stop("Dynamic fit cutoffs are for common-factor models; the model has composites (<~).")
  }
  if (length(req$model$moderations)) {
    stop("Dynamic fit cutoffs are not available with latent interactions.")
  }
  o <- req$dfi
  fn <- o[["fn", exact = TRUE]]
  if (!(is.character(fn) && length(fn) == 1 && fn %in% .ps_dfi_fns)) {
    stop("Invalid DFI function in the request.")
  }
  reps <- as.integer(ps_number(o$reps %||% 500, "replications"))
  if (is.na(reps) || reps < 10L || reps > 5000L) {
    stop("The number of replications must be between 10 and 5000.")
  }
  est <- o[["estimator", exact = TRUE]]
  if (!is.null(est) && !(is.character(est) && length(est) == 1 && est %in% .ps_dfi_estimators)) {
    stop("Invalid simulation estimator in the request.")
  }
  scale <- o[["scale", exact = TRUE]] %||% "normal"
  if (!(is.character(scale) && length(scale) == 1 && scale %in% c("normal", "nonnormal", "categorical"))) {
    stop("Invalid DDDFI scale in the request.")
  }
  mad <- o[["mad", exact = TRUE]]
  if (!is.null(mad)) {
    mad <- vapply(as.list(unlist(mad)), function(v) ps_number(v, "mean absolute discrepancy"), 0)
    if (!length(mad) || length(mad) > 6 || any(mad <= 0 | mad >= 0.5)) {
      stop("Mean absolute discrepancies must be between 0 and 0.5 (at most six).")
    }
  }
  needs_data <- fn %in% .ps_dfi_with_data || (fn == "DDDFI" && scale != "normal")
  if (needs_data && b$matrix_input) {
    stop(sprintf("dynamic::%s needs raw data; this dataset is a covariance matrix.", fn))
  }
  if (length(unlist(req$model$ordered)) && !fn %in% c("catOne", "catHB", "equivTest", "DDDFI")) {
    stop(sprintf("dynamic::%s is for continuous indicators; with ordinal indicators use catOne, catHB or DDDFI.", fn))
  }

  # The lavaan call with its test named (ps_dfi_test), otherwise as the Model tab fits it.
  call <- b$call
  if (!grepl("test = ", call, fixed = TRUE)) {
    call <- sub("\\)$", sprintf(", test = \"%s\")", ps_dfi_test(req$estimator)), call)
  }
  body <- b$body
  body[body == b$call] <- call
  args <- c(
    "fit",
    if (fn %in% .ps_dfi_with_data) "data = data",
    if (fn == "DDDFI" && scale != "normal") c("data = data", sprintf("scale = \"%s\"", scale)),
    if (fn != "equivTest") sprintf("reps = %d", reps),
    if (!is.null(est) && !fn %in% c("exactFit", "equivTest")) sprintf("estimator = \"%s\"", est),
    if (!is.null(mad) && fn == "DDDFI") {
      sprintf("MAD = c(%s)", paste(format(mad, digits = 15), collapse = ", "))
    }
  )
  body <- c(
    body,
    "suppressPackageStartupMessages(library(dynamic))",
    sprintf(
      "# Dynamic fit index cutoffs (Wolf & McNeish, dynamic::%s): the package simulates this model's fit-index",
      fn
    ),
    "# distributions, correctly specified and under graded misspecifications, with its own fixed seeds.",
    sprintf("dfi <- dynamic::%s(%s)", fn, paste(args, collapse = ", ")),
    "printed <- capture.output(print(dfi))"
  )
  if (export) {
    return(ps_script(sprintf("Dynamic fit index cutoffs: dynamic::%s, %s", fn, if (fn == "equivTest") "equivalence testing" else sprintf("%d replications", reps)), c("lavaan", "dynamic"), b$inputs, body, "print(dfi)"))
  }
  env <- ps_run(body, b$inputs)
  # lavaan's warnings about single simulated replications (a negative residual variance, a fit that did not
  # converge) concern the package's simulation, not the user's model: reported as notes, as the package itself
  # muffles most of them.
  sim <- grepl(
    "ov variances are negative|could not compute standard errors|not positive definite|did not converge|optimizer warning",
    env$.warnings
  )
  for (m in env$.warnings[sim]) ps_note(sprintf("In dynamic's simulated replications: %s", m))
  env$.warnings <- env$.warnings[!sim]
  dfi <- env$dfi
  r <- unclass(dfi)
  dist <- if (fn == "DDDFI") r$indices else r$data
  ps_json(list(
    fn = fn,
    reps = if (fn == "equivTest") NULL else reps,
    n = unname(lavaan::lavInspect(env$fit, "nobs")),
    estimator = if (!is.null(r$estimator)) as.character(r$estimator) else if (!is.null(est)) est else NULL,
    scale = if (fn == "DDDFI") scale else NULL,
    cutoffs = ps_dfi_table(r$cutoffs),
    fit = ps_dfi_table(r$fit),
    data = ps_dfi_columns(dist),
    equiv = if (fn == "equivTest") {
      list(
        rmsea = as.character(r$rmsea),
        cfi = as.character(r$cfi),
        rmseaBins = I(as.character(c(r$eo_r, r$ct_r, r$ft_r, r$mf_r, r$pf_r))),
        cfiBins = I(as.character(c(r$pf_c, r$mf_c, r$ft_c, r$ct_c, r$eo_c)))
      )
    } else {
      NULL
    },
    printed = I(ps_flat_lines(env$printed)), warnings = env$.warnings,
    engine = ps_engine("dynamic", lavaan = "lavaan")
  ))
}

#' Printed output as lines without control characters (at most 200).
ps_flat_lines <- function(x) {
  x <- gsub("[[:cntrl:]]", " ", as.character(x))
  x[seq_len(min(length(x), 200L))]
}
