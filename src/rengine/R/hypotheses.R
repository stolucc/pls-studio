# Informative hypotheses on the labelled parameters of the CB-SEM model on the canvas: order-restricted hypotheses
# ("b1 > b2 > 0", "b1 = b2") evaluated by the GORICA (Altinisik, Van Lissa, Hoijtink, Oldehinkel & Kuiper 2021;
# restriktor::goric on the lavaan fit, its estimates and their covariance matrix) and by approximate adjusted
# fractional Bayes factors (Gu, Mulder & Hoijtink 2018; bain::bain on the lavaan fit).

#' One constraint as the app prints it (model/hypothesis.ts constraintText): one comparison of two linear sides of
#' labels, numbers, + - * and abs(label); anything else is refused. Returns the labels it names.
ps_hyp_constraint <- function(x) {
  ok <- is.character(x) && length(x) == 1 && nchar(x) <= 1000 && grepl("^[A-Za-z0-9_ .+*<>=()-]+$", x) &&
    lengths(regmatches(x, gregexpr("[<>=]", x))) == 1
  # (parentheses only around one label after abs: abs(b1))
  if (ok) ok <- !grepl("[()]", gsub("abs\\([A-Za-z][A-Za-z0-9_]{0,30}\\)", "", x))
  if (!ok) stop("Invalid hypothesis in the request.")
  names <- setdiff(regmatches(x, gregexpr("[A-Za-z][A-Za-z0-9_]*", x))[[1]], "abs")
  for (n in names) ps_label(n)
  names
}

#' The hypotheses of the request: each a list of constraints (at most 10 hypotheses).
ps_hyp_list <- function(hs) {
  if (!is.list(hs) || !length(hs) || length(hs) > 10) stop("Invalid hypotheses in the request.")
  lapply(hs, function(h) { cs <- unlist(h$constraints); if (!is.character(cs) || !length(cs) || length(cs) > 50) stop("Invalid hypothesis in the request."); cs })
}

#' GORICA values and weights (restriktor) and/or Bayes factors and posterior model probabilities (bain) of the
#' hypotheses, on the model's estimates (unstandardised, or standardised: standardizedSolution and its covariance).
ps_cb_hypotheses <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Informative hypothesis evaluation", raw = FALSE)
  if (identical(req$estimator, "2SLS")) stop("Informative hypotheses need the covariance matrix of all estimates; MIIV-2SLS estimates the model equation by equation.")
  o <- req$hyp
  hs <- ps_hyp_list(o$hypotheses)
  labels <- unique(unlist(lapply(unlist(hs), ps_hyp_constraint)))
  method <- o[["method", exact = TRUE]]
  if (!(is.character(method) && length(method) == 1 && method %in% c("gorica", "bain", "both"))) stop("Invalid method in the request.")
  gorica <- method != "bain"; bf <- method != "gorica"
  comparison <- o[["comparison", exact = TRUE]] %||% "complement"
  if (!(is.character(comparison) && length(comparison) == 1 && comparison %in% c("complement", "unconstrained", "none"))) stop("Invalid comparison in the request.")
  if (gorica && comparison == "complement" && length(hs) != 1) stop("The comparison with the complement is for one hypothesis; with several, compare them with the unconstrained hypothesis or with each other.")
  if (gorica && comparison == "none" && length(hs) < 2) stop("With one hypothesis, compare it with its complement or with the unconstrained hypothesis.")
  if (bf && any(grepl("abs(", unlist(hs), fixed = TRUE))) stop("bain has no abs(): compare signed parameters, or use the GORICA alone.")
  if (bf && !is.null(b$group_var)) stop("Bayes factors (bain) are available for one group here; use the GORICA with groups.")
  std <- isTRUE(o$standardized)
  fraction <- as.integer(ps_number(o$fraction %||% 1, "fraction"))
  if (is.na(fraction) || fraction < 1 || fraction > 3) stop("The fraction must be 1, 2 or 3.")
  seed <- as.integer(ps_number(o$seed %||% 100, "seed"))
  q <- function(x) encodeString(x, quote = '"')
  hnames <- paste0("H", seq_along(hs))
  body <- c(b$body, "",
    "# ---- Informative hypotheses on the labelled parameters ----",
    "# One hypothesis per element, its constraints joined by ; (restriktor) or & (bain).",
    sprintf("hypotheses <- list(%s)", paste(sprintf("%s = %s", hnames, vapply(hs, function(cs) q(paste(cs, collapse = "; ")), "")), collapse = ",\n  ")),
    sprintf("labels <- %s", ps_q(labels)),
    "unknown <- setdiff(labels, names(coef(fit)))",
    "if (length(unknown)) stop(\"Not free labelled parameters of the model: \", paste(unknown, collapse = \", \"))",
    sprintf("estimates <- subset(%s, label %%in%% labels & !duplicated(label))", if (std) "standardizedSolution(fit)" else "parameterEstimates(fit)"),
    if (gorica) c("",
      "# GORICA (Altinisik et al. 2021): the order-restricted fit (log-likelihood of the estimates under the constraints,",
      "# from their asymptotic normal distribution) minus a penalty for the hypothesis's complexity (from chi-bar-square",
      "# level probabilities); lower is better, and the weights are the relative support.",
      "suppressPackageStartupMessages(library(restriktor))",
      sprintf("set.seed(%d)", seed),
      sprintf("gorica <- goric(fit, hypotheses = hypotheses, comparison = %s, type = \"gorica\", standardized = %s)", q(comparison), if (std) "TRUE" else "FALSE")),
    if (bf) c("",
      "# Approximate adjusted fractional Bayes factors (Gu, Mulder & Hoijtink 2018): each hypothesis against the",
      "# unconstrained (BF.u) and against its complement (BF.c), and the posterior model probabilities.",
      "suppressPackageStartupMessages(library(bain))",
      sprintf("set.seed(%d)", seed),
      sprintf("bf <- bain(fit, %s, fraction = %d, standardize = %s)", q(paste(vapply(hs, function(cs) paste(cs, collapse = " & "), ""), collapse = "; ")), fraction, if (std) "TRUE" else "FALSE")))
  pkgs <- c("lavaan", if (gorica) "restriktor", if (bf) "bain")
  if (export) return(ps_script(sprintf("Informative hypotheses: %s", c(gorica = "GORICA (restriktor)", bain = "Bayes factors (bain)", both = "GORICA (restriktor) and Bayes factors (bain)")[[method]]), pkgs, b$inputs, body,
    c("print(estimates)", if (gorica) c("print(gorica)", "summary(gorica)"), if (bf) c("print(bf)", "print(bf$BFmatrix)", "summary(bf)"))))
  env <- ps_run(body, b$inputs)
  back <- ps_cb_back(ps_esem_align(b, env$fit))
  nm <- function(x) ps_back(x, back)
  e <- env$estimates
  what <- ifelse(e$op == "~", paste(nm(e$rhs), "→", nm(e$lhs)), ifelse(e$op == "=~", paste(nm(e$lhs), "→", nm(e$rhs)),
    ifelse(e$op == "~1", paste("Mean of", nm(e$lhs)), ifelse(e$lhs == e$rhs, paste("Variance of", nm(e$lhs)), paste(nm(e$lhs), "↔", nm(e$rhs))))))
  est <- if (std) e$est.std else e$est
  num <- function(x) I(unname(as.numeric(x)))
  out_g <- NULL
  if (gorica) {
    g <- env$gorica; r <- g$result
    out_g <- list(models = I(as.character(r$model)), loglik = num(r$loglik), penalty = num(r$penalty), gorica = num(r$gorica), weights = num(r$gorica.weights),
      ratio = lapply(seq_len(nrow(g$ratio.gw)), function(i) num(g$ratio.gw[i, ])), comparison = comparison)
  }
  out_b <- NULL
  if (bf) {
    f <- env$bf$fit
    col <- function(k) num(if (is.null(f[[k]])) rep(NA_real_, nrow(f)) else f[[k]])
    out_b <- list(rows = I(rownames(f)), fit = col("Fit"), com = col("Com"), bfu = col("BF.u"), bfc = col("BF.c"), pmpa = col("PMPa"), pmpb = col("PMPb"), pmpc = col("PMPc"),
      matrix = lapply(seq_len(nrow(env$bf$BFmatrix)), function(i) num(env$bf$BFmatrix[i, ])), fraction = fraction)
  }
  ps_json(list(hypotheses = I(vapply(hs, function(cs) paste(cs, collapse = " & "), "")),
    estimates = list(label = I(e$label), what = I(what), est = num(est), se = num(e$se)), standardized = std, n = sum(lavInspect(env$fit, "ntotal")),
    gorica = out_g, bain = out_b, warnings = env$.warnings,
    engine = do.call(ps_engine, c(list(if (gorica) "restriktor" else "bain"), as.list(setNames(setdiff(pkgs, if (gorica) "restriktor" else "bain"), setdiff(pkgs, if (gorica) "restriktor" else "bain")))))))
}
