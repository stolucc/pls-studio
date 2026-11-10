# Sensitivity to an unmeasured confounder.
#  - CB-SEM (ps_semsens): SEMsens (Leite, Shen, Marcoulides, Fisk & Harring 2022): a phantom variable (mean 0,
#    variance 1) is added to the model on the canvas, with paths to the constructs it may confound; ant colony
#    optimisation searches the phantom coefficients (the sensitivity parameters, within a domain) for the confounder
#    that most changes the paths of interest, refitting the model with lavaan at each try. The result is the range of
#    each path's standardised estimate over the tries and the phantom coefficients at which a path's significance flips.
#  - Conditional process analysis, simple mediation (ps_medsens): mediation::medsens (Imai, Keele & Yamamoto 2010):
#    the average causal mediation effect (ACME) and the direct effect (ADE) as functions of rho, the correlation of the
#    mediator's and the outcome's residuals that an unmeasured pre-treatment confounder would induce; the rho at which
#    each is zero, and the same in terms of the R^2 the confounder would explain (R2*_M R2*_Y and R2~_M R2~_Y).

#' SEMsens's objective functions (sa.aco opt.fun): 1 the mean absolute standardised estimate shrinks, 2 the estimates
#' change most (SD of the change relative to their mean size), 3 the p-values change most, 4 the p-values come closest
#' to the significance level.
.ps_semsens_opt <- 1:4

ps_semsens <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Sensitivity analysis (SEMsens)", raw = FALSE)
  if (!grepl("^fit <- sem\\(model, .*\\)$", b$call)) stop("Sensitivity analysis (SEMsens) is not available for this model.")
  if (!is.null(b$group_var)) stop("Sensitivity analysis (SEMsens) is for a single group: remove the grouping.")
  if (length(req$model$moderations)) stop("Sensitivity analysis (SEMsens) is not available with latent interactions.")
  if (length(b$composites)) stop("Sensitivity analysis (SEMsens) is for common-factor and observed variables; the model has composites (<~).")
  o <- req$semsens
  opt <- as.integer(ps_number(o$optFun %||% 1, "objective"))
  if (is.na(opt) || !opt %in% .ps_semsens_opt) stop("Invalid objective function.")
  k <- as.integer(ps_number(o$k %||% 20, "archive size")); iter <- as.integer(ps_number(o$maxIter %||% 200, "iterations"))
  ants <- as.integer(ps_number(o$ants %||% 10, "ants")); seed <- as.integer(ps_number(o$seed %||% 1, "seed"))
  bound <- ps_number(o$bound %||% 1, "domain"); alpha <- ps_number(o$alpha %||% 0.05, "significance level")
  if (is.na(k) || k < 2 || k > 500) stop("The archive size (k) must be between 2 and 500.")
  if (is.na(iter) || iter < k || iter > 20000) stop("The number of evaluations must be between the archive size and 20000.")
  if (is.na(ants) || ants < 1 || ants > 100) stop("The number of ants must be between 1 and 100.")
  if (is.na(seed)) stop("Invalid seed.")
  if (!is.finite(bound) || bound <= 0 || bound > 1) stop("The phantom coefficients' bound must be in (0, 1].")
  if (!is.finite(alpha) || alpha <= 0 || alpha >= 0.5) stop("The significance level must be in (0, 0.5).")
  # (jsonlite reads [[from, to], ...] as a matrix)
  paths <- if (is.matrix(o$paths)) lapply(seq_len(nrow(o$paths)), function(i) as.character(o$paths[i, ])) else lapply(o$paths, function(p) as.character(unlist(p)))
  if (!length(paths) || length(paths) > 200 || any(lengths(paths) != 2)) stop("Choose the paths of interest.")
  drawn <- vapply(req$model$paths, function(p) paste(p$from, p$to, sep = "\r"), "")
  for (p in paths) if (!paste(p[1], p[2], sep = "\r") %in% drawn) stop(sprintf("%s -> %s is not a path of the model.", p[1], p[2]))
  phantoms <- as.character(unlist(o$phantoms))
  if (length(phantoms) < 2 || anyDuplicated(phantoms)) stop("Choose at least two constructs the phantom variable affects.")
  # (sa.aco substitutes phantom1, phantom2, ... as text: phantom10 would be read as phantom1 followed by 0)
  if (length(phantoms) > 9) stop("The phantom variable can affect at most nine constructs.")
  if (!all(phantoms %in% b$n$cname)) stop("Unknown construct for the phantom variable.")
  lv <- unname(b$lname[phantoms])
  if (any(grepl("phantom", c(unname(b$lname), unname(b$n$iv)), fixed = TRUE))) stop("Rename the variables whose names contain \"phantom\": SEMsens reserves the word.")
  plines <- unique(vapply(paths, function(p) sprintf("%s ~ %s", b$lname[[p[2]]], b$lname[[p[1]]]), ""))
  args <- sub("^fit <- sem\\(model, (.*)\\)$", "\\1", b$call)
  body <- c(b$body,
    "suppressPackageStartupMessages(library(SEMsens))",
    "# The sensitivity model: the model plus a phantom variable (mean 0, variance 1), the unmeasured confounder, with",
    "# a path to each construct it may affect; phantom1, phantom2, ... are the sensitivity parameters SEMsens searches",
    "sens_model <- paste0(model, '",
    paste0("  ", sprintf("%s ~ phantom%d*phantom", lv, seq_along(lv))),
    "  phantom =~ 0          # (no indicators: mean zero)",
    "  phantom ~~ 1*phantom  # unit variance",
    "')",
    "# The paths of interest, by their rows in lavaan's standardised solution (the model's own lines come first in both models)",
    sprintf("of_interest <- %s", ps_q(plines)),
    "std0 <- standardizedSolution(fit)",
    "path_rows <- which(paste(std0$lhs, std0$op, std0$rhs) %in% of_interest)",
    sprintf("# Ant colony optimisation (Leite et al. 2022): objective %d, an archive of %d solutions, %d ants, at most %d", opt, k, ants, iter),
    sprintf("# evaluations, each phantom coefficient in [-%s, %s]; the model refitted with lavaan at each evaluation", format(bound), format(bound)),
    sprintf("sa <- SEMsens::sa.aco(model = model, sens.model = sens_model, %s, opt.fun = %d, paths = path_rows, k = %d, n.of.ants = %d,", args, opt, k, ants),
    sprintf("  max.iter = %d, d = list(rep(c(%s, %s), %d)), sig.level = %s, seed = %d, verbose = FALSE)", iter, format(-bound), format(bound), length(lv), format(alpha), seed),
    "# (the paths' rows are the same in the sensitivity model's solution)",
    "first <- sa$model.results[sa$model.results$evals == 1, ]",
    "stopifnot(identical(paste(first$lhs, first$op, first$rhs)[path_rows], paste(std0$lhs, std0$op, std0$rhs)[path_rows]))",
    sprintf("tables <- SEMsens::sens.tables(sa, sig.level = %s, sort = FALSE)", format(alpha)))
  if (export) return(paste(ps_script(sprintf("Sensitivity analysis for an unmeasured confounder (SEMsens, objective %d)", opt), c("lavaan", "SEMsens"), b$inputs, body,
    c("tables$sens.summary   # each path: the model's standardised estimate and p, and its mean, minimum and maximum over the evaluations",
      "tables$phan.paths     # the phantom coefficients (standardised): mean, minimum, maximum",
      "tables$phan.min       # the phantom coefficients at each path's minimum",
      "tables$phan.max       # ... and maximum",
      "tables$p.paths        # the p-value closest to a flip of significance, and the phantom coefficients that give it")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_back_map(b)
  nm <- function(x) { s <- strsplit(x, "~", fixed = TRUE)[[1]]; c(from = ps_back(trimws(s[2]), back), to = ps_back(trimws(s[1]), back)) }
  t <- env$tables
  rowsOf <- function(m) lapply(rownames(m), function(r) { x <- nm(r); list(from = x[["from"]], to = x[["to"]], values = I(unname(as.numeric(m[r, ])))) })
  mr <- env$sa$model.results
  ph <- unique(sprintf("%s~phantom", lv))
  key <- paste0(mr$lhs, mr$op, mr$rhs)
  regs <- rownames(t$sens.summary)
  evals <- sort(unique(mr$evals))
  pick <- function(col, k) vapply(evals, function(e) { v <- mr[[col]][mr$evals == e & key == k]; if (length(v)) v[1] else NA_real_ }, 0)
  ps_json(list(n = unname(lavaan::lavInspect(env$fit, "nobs")), optFun = opt, k = k, ants = ants, maxIter = iter, bound = bound, alpha = alpha, seed = seed,
    evaluations = env$sa$n.eval, tried = env$sa$n.iter, maxObjective = env$sa$max.y,
    phantoms = I(phantoms), interest = lapply(paths, function(p) list(from = p[1], to = p[2])),
    summary = rowsOf(t$sens.summary), phantom = lapply(seq_along(lv), function(i) list(construct = phantoms[i], values = I(unname(as.numeric(t$phan.paths[ph[i], ]))))),
    atMin = rowsOf(t$phan.min), atMax = rowsOf(t$phan.max), flip = rowsOf(t$p.paths),
    draws = list(path = lapply(regs, function(r) { x <- nm(r); list(from = x[["from"]], to = x[["to"]], est = I(pick("est.std", r)), p = I(pick("pvalue", r))) }),
      phantom = lapply(ph, function(k) I(pick("est.std", k)))),
    warnings = env$.warnings,
    engine = list(package = "SEMsens", version = as.character(utils::packageVersion("SEMsens")), lavaan = as.character(utils::packageVersion("lavaan")))))
}

ps_medsens <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- req$variables
  n <- ps_names(vars)
  # A single-item variable named like its column is that column; others are scale scores (as in conditional process analysis).
  rn <- vapply(seq_along(vars), function(j) { it <- n$inds[[j]]; if (length(it) == 1 && identical(it, n$cname[j])) unname(n$iv[[it]]) else unname(n$cv[[j]]) }, "")
  names(rn) <- n$cname
  id <- function(x) ps_lookup(rn, x)
  x <- id(req$x); m <- id(req$m); y <- id(req$y); covs <- id(as.character(unlist(req$covariates)))
  if (length(unique(c(x, m, y, covs))) != 3 + length(covs)) stop("X, the mediator, the outcome and the covariates must be different variables.")
  rho_by <- ps_number(req$rhoBy %||% 0.1, "rho step"); eps <- ps_number(req$eps %||% sqrt(.Machine$double.eps), "tolerance")
  level <- ps_number(req$confidence %||% 0.95, "confidence level"); seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
  if (!is.finite(rho_by) || rho_by < 0.001 || rho_by > 0.25 || abs(1 / rho_by - round(1 / rho_by)) > 1e-8) stop("The step of rho must divide 1 (e.g. 0.1, 0.05, 0.01).")
  if (!is.finite(eps) || eps <= 0 || eps > 0.1) stop("The tolerance must be in (0, 0.1].")
  if (!is.finite(level) || level <= 0.5 || level >= 1) stop("Invalid confidence level.")
  if (is.na(seed)) stop("Invalid seed.")
  scoring <- unlist(lapply(seq_along(vars), function(j) {
    it <- unname(n$iv[n$inds[[j]]])
    if (length(it) == 1 && it == rn[[j]]) NULL else if (length(it) == 1) sprintf("data$%s <- data$%s", rn[[j]], it) else sprintf("data$%s <- rowMeans(data[, %s])", rn[[j]], ps_q(it))
  }))
  rhs <- function(...) paste(c(...), collapse = " + ")
  body <- c("suppressPackageStartupMessages(library(mediation))",
    ps_missing_code("casewise"),
    if (length(scoring)) c("# Scale scores: the mean of each scale's items", scoring),
    "# The mediator and outcome equations of simple mediation (PROCESS model 4), by least squares",
    sprintf("fit_m <- lm(%s ~ %s, data = data)", m, rhs(x, covs)),
    sprintf("fit_y <- lm(%s ~ %s, data = data)", y, rhs(x, m, covs)),
    "# mediate(): the causal mediation object medsens() reads, for X from 0 to 1 (with two linear models",
    "# medsens() computes its curves and their confidence intervals analytically, not from these simulations)",
    sprintf("set.seed(%d)", seed),
    sprintf("med <- mediate(fit_m, fit_y, treat = %s, mediator = %s, sims = 100, conf.level = %s)", encodeString(x, quote = '"'), encodeString(m, quote = '"'), format(level)),
    "# Sensitivity to an unmeasured pre-treatment confounder (Imai, Keele & Yamamoto 2010): the ACME and ADE as functions",
    "# of rho, the correlation of the two equations' residuals",
    sprintf("sens <- medsens(med, rho.by = %s, eps = %s, effect.type = \"both\")", format(rho_by), format(eps, digits = 15)))
  inputs <- list(data = ps_frame(req, n))
  if (export) return(paste(ps_script("Sensitivity of a mediation effect to an unmeasured confounder (mediation::medsens)", "mediation", inputs, body, c("summary(sens)", "plot(sens, sens.par = \"rho\")")), collapse = "\n"))
  env <- ps_run(body, inputs)
  s <- env$sens
  v <- function(z) I(unname(as.numeric(z)))
  ps_json(list(n = stats::nobs(env$fit_y), rhoBy = rho_by, eps = eps, confidence = level, x = req$x, m = req$m, y = req$y, covariates = I(as.character(unlist(req$covariates))),
    a = unname(stats::coef(env$fit_m)[[x]]), b = unname(stats::coef(env$fit_y)[[m]]), r2m = s$r.square.m, r2y = s$r.square.y,
    rho = v(s$rho), acme = list(est = v(s$d0), lo = v(s$lower.d0), hi = v(s$upper.d0)), ade = list(est = v(s$z0), lo = v(s$lower.z0), hi = v(s$upper.z0)),
    r2starProd = v(s$R2star.prod), r2tildeProd = v(s$R2tilde.prod),
    acmeZero = list(rho = s$err.cr.d, r2star = s$R2star.d.thresh, r2tilde = s$R2tilde.d.thresh),
    adeZero = list(rho = s$err.cr.z, r2star = s$R2star.z.thresh, r2tilde = s$R2tilde.z.thresh),
    printed = I(ps_flat_lines(utils::capture.output(summary(s)))), warnings = env$.warnings,
    engine = list(package = "mediation", version = as.character(utils::packageVersion("mediation")))))
}
