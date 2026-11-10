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

#' Moderated nonlinear factor analysis (Curran et al. 2014; Bauer 2017) with mnlfa: one factor of binary items
#' (1PL or 2PL, P(x = 1) = invlogit(a theta - b)) whose item intercepts b and slopes a (2PL), mean and log SD depend
#' on person covariates, continuous or categorical (dummy coded, the first level the reference). The mean is 0 and
#' (2PL) the log SD 0 where every covariate is 0; for 1PL the log SD's intercept is free. mnlfa handles one factor
#' and binary items only, and gives no standard errors. (lavaan 0.7's `:~` data-defined parameters could express
#' such models, but lavaan cannot estimate them yet.)
ps_mnlfa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  items <- as.character(unlist(req$items)); covs <- as.character(unlist(req$covariates))
  if (length(items) < 3) stop("Choose at least three binary items.")
  if (length(intersect(items, covs))) stop("An item cannot also be a covariate.")
  type <- req$itemType %||% "2PL"
  if (!(is.character(type) && length(type) == 1 && type %in% c("1PL", "2PL"))) stop("Invalid item type in the request.")
  role <- function(k) { x <- as.character(unlist(req[[k, exact = TRUE]])); if (length(setdiff(x, covs))) stop(sprintf("Unknown covariate in the request (%s).", k)); x }
  int <- role("intercept"); slo <- if (type == "2PL") role("slope") else character(0); mu <- role("mean"); sdv <- role("sd")
  cats <- intersect(as.character(unlist(req$categorical)), covs)
  moderated <- as.character(unlist(req$moderated))
  if (length(setdiff(moderated, items))) stop("Unknown moderated item in the request.")
  if (!length(moderated)) moderated <- items
  all_mod <- length(moderated) == length(items)
  if (all_mod && length(intersect(int, mu))) stop("A covariate moderates the factor mean and the intercepts of every item: not identified. Leave at least one item unmoderated (an anchor).")
  if (all_mod && length(intersect(slo, sdv))) stop("A covariate moderates the factor SD and the slopes of every item: not identified. Leave at least one item unmoderated (an anchor).")
  fr <- ps_long_frame(req, c(items, covs))
  iv <- unname(fr$v[items]); cv <- fr$v[covs]
  d <- fr$data
  # Categorical covariates: a dummy per level but the first (the reference), named covariate_level.
  terms <- list(); used <- names(d); body_cat <- character(0); term_of <- list()
  for (k in covs) {
    v <- unname(cv[k])
    if (k %in% cats) {
      lv <- sort(unique(d[[v]][!is.na(d[[v]])]))
      if (length(lv) < 2) stop(sprintf("The categorical covariate %s has one level.", k))
      if (length(lv) > 20) stop(sprintf("The categorical covariate %s has more than 20 levels.", k))
      nm <- character(0)
      for (l in lv[-1]) {
        t <- ps_ident(paste0(v, "_", format(l, trim = TRUE))); while (t %in% used) t <- paste0(t, "_d"); used <- c(used, t); nm <- c(nm, t)
        body_cat <- c(body_cat, sprintf("data$%s <- as.numeric(data$%s == %s)", t, v, format(l, digits = 15)))
        terms[[length(terms) + 1]] <- list(term = t, covariate = k, level = format(l, trim = TRUE))
      }
      term_of[[k]] <- nm
    } else { term_of[[k]] <- v; terms[[length(terms) + 1]] <- list(term = v, covariate = k, level = NULL) }
  }
  fml <- function(x, intercept) { t <- unlist(term_of[x], use.names = FALSE); if (!length(t)) sprintf("~%d", as.integer(intercept)) else paste0("~", if (intercept) "1" else "0", " + ", paste(t, collapse = " + ")) }
  item_fml <- function(x, what) {
    if (!length(x) || all_mod) return(sprintf("formula_%s <- %s", what, fml(x, TRUE)))
    c(sprintf("formula_%s <- mnlfa_expand_to_list(x = ~1, names_list = items)", what),
      sprintf("for (i in %s) formula_%s[[i]] <- %s  # the moderated items", ps_q(unname(fr$v[moderated])), what, fml(x, TRUE)))
  }
  body <- c("suppressPackageStartupMessages(library(mnlfa))",
    sprintf("items <- %s", ps_q(iv)),
    if (length(cv)) c("# Covariates must be complete (cases without them are left out)", sprintf("data <- data[complete.cases(data[, %s, drop = FALSE]), , drop = FALSE]", ps_q(unname(cv)))),
    "if (!all(unlist(data[items]) %in% c(0, 1, NA))) stop(\"The items must be binary, coded 0 and 1.\")",
    if (length(body_cat)) c("# Categorical covariates as dummies: one per level but the first (the reference)", body_cat),
    "# Item intercepts (b) and slopes (a) as functions of the covariates: P(x = 1) = invlogit(a * theta - b)",
    item_fml(int, "int"), item_fml(slo, "slo"),
    "# The factor's mean (0 where the covariates are 0) and log SD",
    sprintf("formula_mean <- %s", fml(mu, FALSE)),
    sprintf("formula_sd <- %s%s", fml(sdv, type == "1PL"), if (type == "1PL") "  # (1PL: slopes fixed at 1, the SD free)" else "  # (2PL: the SD is 1 where the covariates are 0)"),
    sprintf("mod <- mnlfa(dat = data, items = items, item_type = \"%s\", formula_int = formula_int, formula_slo = formula_slo, formula_mean = formula_mean, formula_sd = formula_sd, verbose = FALSE)", type))
  inputs <- list(data = d)
  if (export) return(paste(ps_script(sprintf("Moderated nonlinear factor analysis, %s (mnlfa)", type), "mnlfa", inputs, body, c("summary(mod)", "mod$item", "mod$trait")), collapse = "\n"))
  env <- ps_run(body, inputs)
  m <- env$mod; it <- m$item; tr <- m$trait
  item_rows <- lapply(seq_len(nrow(it)), function(i) {
    p <- as.character(it$parm[i]); nm <- as.character(it$item[i]); rest <- substring(p, nchar(nm) + 2)
    list(item = ps_back(nm, fr$back), kind = substr(rest, 1, 1), term = substring(rest, 3), est = it$est[i], free = it$estim[i] == 1)
  })
  trait_rows <- lapply(seq_len(nrow(tr)), function(i) list(kind = as.character(tr$type[i]), term = sub("^(mu|sigma)_", "", as.character(tr$par[i])), est = tr$est[i]))
  ic <- m$ic
  ps_json(list(itemType = type, n = nrow(env$data), items = item_rows, trait = trait_rows, terms = terms,
    fit = list(deviance = ic$deviance, logLik = -ic$deviance / 2, npar = ic$np, aic = ic$AIC, bic = ic$BIC, caic = ic$CAIC, aicc = ic$AICc),
    iterations = m$iter, converged = isTRUE(m$converged), warnings = env$.warnings,
    engine = list(package = "mnlfa", version = as.character(utils::packageVersion("mnlfa")))))
}

#' Longitudinal measurement invariance: one factor measured at several occasions by the same items (`occasions`:
#' one indicator set per occasion, item k of every set the same item). semTools::measEq.syntax builds the
#' configural, metric (loadings), scalar (+ intercepts) and strict (+ residual variances) models with the factor
#' standardised at the first occasion (ID.fac = "std.lv"; later occasions' means and variances freed as the
#' constraints allow) and each item's residuals correlated across occasions (auto = "all", or adjacent occasions);
#' lavaan fits them and lavTestLRT compares successive levels (scaled for MLR), as the multigroup sequence does.
ps_long_invariance <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  oc <- req$occasions
  # (equal-length sets arrive from JSON as an occasions x items matrix)
  occ <- if (is.matrix(oc)) lapply(seq_len(nrow(oc)), function(i) as.character(oc[i, ])) else lapply(oc, function(x) as.character(unlist(x)))
  if (length(occ) < 2) stop("Choose the indicators at two or more occasions.")
  k <- unique(lengths(occ))
  if (length(k) != 1) stop("Every occasion needs the same number of indicators (item k of each occasion is the same item).")
  if (k < 2) stop("Each occasion needs at least two indicators.")
  if (anyDuplicated(unlist(occ))) stop("A column appears at more than one occasion.")
  fname <- as.character(req$factor %||% "F")
  if (!(length(fname) == 1 && nzchar(fname))) stop("Invalid factor name in the request.")
  lag <- req$lag %||% "all"
  if (!lag %in% c("all", "adjacent")) stop("Invalid residual correlations in the request.")
  fr <- ps_long_frame(req, unlist(occ))
  o <- ps_long_options(req)
  T <- length(occ)
  base <- ps_ident(fname)
  fv <- ps_ident(sprintf("%s_t%d", base, seq_len(T)))
  for (j in seq_along(fv)) while (fv[j] %in% fr$v) fv[j] <- paste0(fv[j], "_lv")
  iv <- lapply(occ, function(x) unname(fr$v[x]))
  items <- lapply(seq_len(k), function(i) vapply(iv, `[`, "", i))
  levels <- c("configural", "metric", "scalar", "strict")
  equal <- list(configural = "\"\"", metric = "\"loadings\"", scalar = "c(\"loadings\", \"intercepts\")", strict = "c(\"loadings\", \"intercepts\", \"residuals\")")
  opts <- sprintf("estimator = \"%s\"%s%s", o$est, ps_lavaan_missing(req$missing), o$extra)
  body <- c("suppressPackageStartupMessages({ library(lavaan); library(semTools) })",
    if (!o$fiml) ps_missing_code(req$missing),
    "# The factor at each occasion (configural: nothing held equal)",
    "model <- '", sprintf("  %s =~ %s", fv, vapply(iv, paste, "", collapse = " + ")), "'",
    sprintf("longFacNames <- list(%s = %s)  # the same factor at each occasion", base, ps_q(fv)),
    "# The same item at each occasion (its residuals are correlated across occasions)",
    sprintf("longIndNames <- list(%s)", paste(sprintf("%s = %s", vapply(items, `[`, "", 1), vapply(items, ps_q, "")), collapse = ", ")),
    "# Each level adds equality constraints across occasions to the one before",
    vapply(levels, function(l) sprintf("fit_%s <- measEq.syntax(configural.model = model, data = data, ID.fac = \"std.lv\", longFacNames = longFacNames, longIndNames = longIndNames, long.equal = %s, auto = %s, meanstructure = TRUE, %s, return.fit = TRUE)",
      l, equal[[l]], if (lag == "all") "\"all\"" else "1L", opts), ""),
    "# Chi-square difference tests between successive levels",
    "lrt <- lavTestLRT(fit_configural, fit_metric, fit_scalar, fit_strict)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Longitudinal measurement invariance (semTools::measEq.syntax, lavaan)", c("lavaan", "semTools"), inputs, body,
    c("lrt", "sapply(list(configural = fit_configural, metric = fit_metric, scalar = fit_scalar, strict = fit_strict), fitMeasures, fit.measures = c(\"chisq\", \"df\", \"cfi\", \"rmsea\", \"srmr\"))",
      "cat(as.character(measEq.syntax(configural.model = model, data = data, ID.fac = \"std.lv\", longFacNames = longFacNames, longIndNames = longIndNames, long.equal = c(\"loadings\", \"intercepts\"), meanstructure = TRUE)))")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fits <- lapply(levels, function(l) env[[paste0("fit_", l)]])
  fm <- lapply(fits, ps_inv_fit)
  robust <- !is.na(lavaan::fitMeasures(fits[[1]])["chisq.scaled"])
  lrt <- env$lrt; rn <- rownames(lrt)
  at <- function(i) match(paste0("fit_", levels[i]), rn)
  factor_pars <- function(f) {
    pe <- lavaan::parameterEstimates(f)
    lapply(seq_len(T), function(t) {
      m <- pe[pe$lhs == fv[t] & pe$op == "~1", ]; v <- pe[pe$lhs == fv[t] & pe$op == "~~" & pe$rhs == fv[t], ]
      nz <- function(x) if (length(x) && !is.na(x) && x > 0) x else NULL
      list(mean = m$est, meanSe = nz(m$se), variance = v$est, varianceSe = nz(v$se))
    })
  }
  ps_json(list(robust = robust, n = lavaan::lavInspect(fits[[1]], "nobs"), occasions = T, items = k, lag = lag,
    levels = lapply(seq_along(levels), function(i) c(list(level = levels[i]), fm[[i]],
      if (i > 1) list(chisqDiff = unname(lrt[["Chisq diff"]][at(i)]), dfDiff = unname(lrt[["Df diff"]][at(i)]), p = unname(lrt[["Pr(>Chisq)"]][at(i)]),
        cfiChange = fm[[i]]$cfi - fm[[i - 1]]$cfi, rmseaChange = fm[[i]]$rmsea - fm[[i - 1]]$rmsea),
      list(factor = factor_pars(fits[[i]])))),
    warnings = env$.warnings, engine = list(package = "semTools", version = as.character(utils::packageVersion("semTools")), lavaan = as.character(utils::packageVersion("lavaan")))))
}
