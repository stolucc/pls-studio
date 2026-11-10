# Measurement invariance beyond the multigroup sequence of the Model tab: alignment
# optimisation for many groups (sirt). Each function writes the script it runs
# (exported as is); this file shapes the output.

#' Factors of the request as lavaan names: list(name, indicators) -> model names, lines and the map back.
ps_inv_factors <- function(req, extra = character(0)) {
  facs <- req$factors
  if (!length(facs)) stop("Choose a factor.")
  fn <- vapply(facs, function(f) as.character(f$name), "")
  inds <- lapply(facs, function(f) as.character(unlist(f$indicators)))
  if (any(lengths(inds) < 2)) stop("Each factor needs at least two indicators.")
  if (anyDuplicated(unlist(inds))) stop("An indicator belongs to more than one of the chosen factors: alignment needs each indicator on one factor.")
  fr <- ps_long_frame(req, c(unique(unlist(inds)), extra))
  fv <- ps_ident(fn)
  for (j in seq_along(fv)) while (fv[j] %in% fr$v || fv[j] %in% fv[-j]) fv[j] <- paste0(fv[j], "_lv")
  iv <- lapply(inds, function(x) unname(fr$v[x]))
  list(fr = fr, names = fn, fv = fv, inds = inds, iv = iv, lines = sprintf("  %s =~ %s", fv, vapply(iv, paste, "", collapse = " + ")),
    back = c(fr$back, setNames(fn, fv)))
}

#' lavaan fit measures shown with the sequences and the configural fit (scaled where the estimator has them).
ps_inv_fit <- function(fit) {
  m <- lavaan::fitMeasures(fit)
  robust <- !is.na(m["chisq.scaled"])
  pick <- function(a, b) unname(if (robust && !is.na(m[b])) m[b] else m[a])
  list(chisq = pick("chisq", "chisq.scaled"), df = unname(m["df"]), cfi = pick("cfi", "cfi.robust"), rmsea = pick("rmsea", "rmsea.robust"), srmr = unname(m["srmr"]))
}

#' A G x I matrix as rows of numbers (JSON).
ps_inv_rows <- function(m) lapply(seq_len(nrow(m)), function(g) I(unname(as.numeric(m[g, ]))))

#' Alignment optimisation (Asparouhov & Muthen 2014) with sirt::invariance.alignment, following sirt's
#' documented workflow (?invariance.alignment, example 2): the configural model is fitted in every group by
#' lavaan with the factors standardised (std.lv = TRUE: mean 0, variance 1 in each group), each chosen factor's
#' group-wise loadings and intercepts (groups x items) are aligned, and invariance_alignment_constraints()
#' finds the parameters that are approximately invariant within the tolerances. Several factors are aligned
#' one at a time (as Mplus does), from one configural fit.
ps_alignment <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  group <- req$group
  if (!(is.character(group) && length(group) == 1 && nzchar(group))) stop("Choose a grouping column.")
  f <- ps_inv_factors(req, group)
  if (group %in% unlist(f$inds)) stop("The grouping column is an indicator of the factor.")
  o <- ps_long_options(req)
  num <- function(x, what, lo, hi) { v <- ps_number(x, what); if (v < lo || v > hi) stop(sprintf("The %s must be between %s and %s.", what, lo, hi)); format(v, digits = 15) }
  pow <- c(num(req$power$lambda %||% 0.5, "alignment power for loadings", 0, 2), num(req$power$nu %||% 0.5, "alignment power for intercepts", 0, 2))
  scl <- c(num(req$scale$lambda %||% 1, "alignment scale for loadings", 0.01, 10), num(req$scale$nu %||% 1, "alignment scale for intercepts", 0.01, 10))
  tol <- c(num(req$tolerance$lambda %||% 0.2, "tolerance for loadings", 0.001, 10), num(req$tolerance$nu %||% 0.4, "tolerance for intercepts", 0.001, 10))
  weights <- req$weights %||% "sqrtN"
  if (!weights %in% c("sqrtN", "equal")) stop("Invalid group weights in the request.")
  gv <- unname(f$fr$v[group])
  body <- c("suppressPackageStartupMessages({ library(lavaan); library(sirt) })",
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]  # (cases without a group are left out)", gv),
    "model <- '", f$lines, "'",
    "# Configural model: loadings and intercepts free in every group, each factor standardised within each group",
    "# (std.lv = TRUE: mean 0 and variance 1), as the alignment takes them (sirt, ?invariance.alignment, example 2).",
    sprintf("fit <- cfa(model, data = data, group = \"%s\", std.lv = TRUE, meanstructure = TRUE, estimator = \"%s\"%s%s)", gv, o$est, ps_lavaan_missing(req$missing), o$extra),
    "est <- lavInspect(fit, \"est\"); N <- lavInspect(fit, \"nobs\"); groups <- lavInspect(fit, \"group.label\")",
    "if (length(groups) < 2) stop(\"The grouping column has one group: alignment compares two or more.\")")
  for (k in seq_along(f$fv)) {
    s <- f$fv[k]; items <- ps_q(f$iv[[k]])
    body <- c(body, "",
      sprintf("# Factor %s: its loadings and intercepts in each group (groups x items), aligned", ps_comment(f$names[k])),
      sprintf("lambda_%s <- do.call(rbind, lapply(est, function(g) g$lambda[%s, \"%s\"]))", s, items, s),
      sprintf("nu_%s <- do.call(rbind, lapply(est, function(g) g$nu[%s, 1]))", s, items),
      sprintf("rownames(lambda_%s) <- rownames(nu_%s) <- groups", s, s),
      if (weights == "sqrtN") sprintf("wgt_%s <- matrix(sqrt(N), length(N), ncol(nu_%s))  # each pair of groups weighted by sqrt(N1 * N2) (Asparouhov & Muthen 2014)", s, s)
      else sprintf("wgt_%s <- NULL  # every group weighted equally", s),
      sprintf("align_%s <- invariance.alignment(lambda_%s, nu_%s, wgt = wgt_%s, align.pow = c(%s, %s), align.scale = c(%s, %s))", s, s, s, s, pow[1], pow[2], scl[1], scl[2]),
      sprintf("# Approximately invariant parameters: aligned values within the tolerance of a joint value"),
      sprintf("cons_%s <- invariance_alignment_constraints(align_%s, lambda_parm_tol = %s, nu_parm_tol = %s)", s, s, tol[1], tol[2]))
  }
  inputs <- list(data = f$fr$data)
  if (export) return(paste(ps_script("Alignment optimisation (sirt)", c("lavaan", "sirt"), inputs, body,
    unlist(lapply(f$fv, function(s) c(sprintf("summary(align_%s)", s), sprintf("summary(cons_%s)", s))))), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  factors <- lapply(seq_along(f$fv), function(k) {
    s <- f$fv[k]; a <- env[[paste0("align_", s)]]; cons <- env[[paste0("cons_", s)]]
    es <- a$es.invariance
    side <- function(l) list(tolerance = l$parm_tol, noninvariant = l$prop_noninvariance / 100, joint = I(unname(l$parm_joint)), dif = ps_inv_rows(l$parm_dif),
      unique = I(unname(l$N_unique_parm_items)), uniqueGroups = I(unname(l$N_unique_parm_groups)))
    list(name = f$names[k], items = I(f$inds[[k]]),
      lambda = ps_inv_rows(a$lambda), nu = ps_inv_rows(a$nu), lambdaAligned = ps_inv_rows(a$lambda.aligned), nuAligned = ps_inv_rows(a$nu.aligned),
      mean = I(unname(a$pars$alpha0)), sd = I(unname(a$pars$psi0)),
      r2 = list(lambda = unname(es["R2", 1]), nu = unname(es["R2", 2])), sqrtU2 = list(lambda = unname(es["sqrtU2", 1]), nu = unname(es["sqrtU2", 2])),
      rbar = list(lambda = unname(es["rbar", 1]), nu = unname(es["rbar", 2])),
      fopt = a$fopt, converged = isTRUE(a$res_optim$converged), fixed = isTRUE(a$fixed),
      lambdaConstraints = side(cons$lambda_list), nuConstraints = side(cons$nu_list))
  })
  ps_json(list(groups = I(as.character(env$groups)), n = I(unname(as.numeric(env$N))), fit = ps_inv_fit(fit), factors = factors,
    power = as.numeric(pow), scale = as.numeric(scl), weights = weights, warnings = env$.warnings,
    engine = list(package = "sirt", version = as.character(utils::packageVersion("sirt")), lavaan = as.character(utils::packageVersion("lavaan")))))
}
