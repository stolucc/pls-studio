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
  list(
    fr = fr, names = fn, fv = fv, inds = inds, iv = iv, lines = sprintf("  %s =~ %s", fv, vapply(iv, paste, "", collapse = " + ")),
    back = c(fr$back, setNames(fn, fv))
  )
}

#' lavaan fit measures shown with the sequences and the configural fit (scaled where the estimator has them).
ps_inv_fit <- function(fit) {
  m <- lavaan::fitMeasures(fit)
  robust <- !is.na(m["chisq.scaled"])
  pick <- function(a, b) unname(if (robust && !is.na(m[b])) m[b] else m[a])
  list(chisq = pick("chisq", "chisq.scaled"), df = unname(m["df"]), cfi = pick("cfi", "cfi.robust"), rmsea = pick("rmsea", "rmsea.robust"), srmr = unname(m["srmr"]))
}

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
  num <- function(x, what, lo, hi) {
    v <- ps_number(x, what)
    if (v < lo || v > hi) stop(sprintf("The %s must be between %s and %s.", what, lo, hi))
    format(v, digits = 15)
  }
  pow <- c(num(req$power$lambda %||% 0.5, "alignment power for loadings", 0, 2), num(req$power$nu %||% 0.5, "alignment power for intercepts", 0, 2))
  scl <- c(num(req$scale$lambda %||% 1, "alignment scale for loadings", 0.01, 10), num(req$scale$nu %||% 1, "alignment scale for intercepts", 0.01, 10))
  tol <- c(num(req$tolerance$lambda %||% 0.2, "tolerance for loadings", 0.001, 10), num(req$tolerance$nu %||% 0.4, "tolerance for intercepts", 0.001, 10))
  weights <- req$weights %||% "sqrtN"
  if (!weights %in% c("sqrtN", "equal")) stop("Invalid group weights in the request.")
  gv <- unname(f$fr$v[group])
  body <- c(
    "suppressPackageStartupMessages({ library(lavaan); library(sirt) })",
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]  # (cases without a group are left out)", gv),
    "model <- '", f$lines, "'",
    "# Configural model: loadings and intercepts free in every group, each factor standardised within each group",
    "# (std.lv = TRUE: mean 0 and variance 1), as the alignment takes them (sirt, ?invariance.alignment, example 2).",
    sprintf("fit <- cfa(model, data = data, group = \"%s\", std.lv = TRUE, meanstructure = TRUE, estimator = \"%s\"%s%s)", gv, o$est, ps_lavaan_missing(req$missing), o$extra),
    "est <- lavInspect(fit, \"est\"); N <- lavInspect(fit, \"nobs\"); groups <- lavInspect(fit, \"group.label\")",
    "if (length(groups) < 2) stop(\"The grouping column has one group: alignment compares two or more.\")"
  )
  for (k in seq_along(f$fv)) {
    s <- f$fv[k]
    items <- ps_q(f$iv[[k]])
    body <- c(
      body, "",
      sprintf("# Factor %s: its loadings and intercepts in each group (groups x items), aligned", ps_comment(f$names[k])),
      sprintf("lambda_%s <- do.call(rbind, lapply(est, function(g) g$lambda[%s, \"%s\"]))", s, items, s),
      sprintf("nu_%s <- do.call(rbind, lapply(est, function(g) g$nu[%s, 1]))", s, items),
      sprintf("rownames(lambda_%s) <- rownames(nu_%s) <- groups", s, s),
      if (weights == "sqrtN") {
        sprintf("wgt_%s <- matrix(sqrt(N), length(N), ncol(nu_%s))  # each pair of groups weighted by sqrt(N1 * N2) (Asparouhov & Muthen 2014)", s, s)
      } else {
        sprintf("wgt_%s <- NULL  # every group weighted equally", s)
      },
      sprintf("align_%s <- invariance.alignment(lambda_%s, nu_%s, wgt = wgt_%s, align.pow = c(%s, %s), align.scale = c(%s, %s))", s, s, s, s, pow[1], pow[2], scl[1], scl[2]),
      sprintf("# Approximately invariant parameters: aligned values within the tolerance of a joint value"),
      sprintf("cons_%s <- invariance_alignment_constraints(align_%s, lambda_parm_tol = %s, nu_parm_tol = %s)", s, s, tol[1], tol[2])
    )
  }
  inputs <- list(data = f$fr$data)
  if (export) {
    return(ps_script(
      "Alignment optimisation (sirt)", c("lavaan", "sirt"), inputs, body,
      unlist(lapply(f$fv, function(s) c(sprintf("summary(align_%s)", s), sprintf("summary(cons_%s)", s))))
    ))
  }
  env <- ps_run(body, inputs)
  fit <- env$fit
  factors <- lapply(seq_along(f$fv), function(k) {
    s <- f$fv[k]
    a <- env[[paste0("align_", s)]]
    cons <- env[[paste0("cons_", s)]]
    es <- a$es.invariance
    side <- function(l) {
      list(
        tolerance = l$parm_tol, noninvariant = l$prop_noninvariance / 100, joint = I(unname(l$parm_joint)), dif = ps_rows(l$parm_dif),
        unique = I(unname(l$N_unique_parm_items)), uniqueGroups = I(unname(l$N_unique_parm_groups))
      )
    }
    list(
      name = f$names[k], items = I(f$inds[[k]]),
      lambda = ps_rows(a$lambda), nu = ps_rows(a$nu), lambdaAligned = ps_rows(a$lambda.aligned), nuAligned = ps_rows(a$nu.aligned),
      mean = I(unname(a$pars$alpha0)), sd = I(unname(a$pars$psi0)),
      r2 = list(lambda = unname(es["R2", 1]), nu = unname(es["R2", 2])), sqrtU2 = list(lambda = unname(es["sqrtU2", 1]), nu = unname(es["sqrtU2", 2])),
      rbar = list(lambda = unname(es["rbar", 1]), nu = unname(es["rbar", 2])),
      fopt = a$fopt, converged = isTRUE(a$res_optim$converged), fixed = isTRUE(a$fixed),
      lambdaConstraints = side(cons$lambda_list), nuConstraints = side(cons$nu_list)
    )
  })
  ps_json(list(
    groups = I(as.character(env$groups)), n = I(unname(as.numeric(env$N))), fit = ps_inv_fit(fit), factors = factors,
    power = as.numeric(pow), scale = as.numeric(scl), weights = weights, warnings = env$.warnings,
    engine = ps_engine("sirt", lavaan = "lavaan")
  ))
}

#' Moderated nonlinear factor analysis (Curran et al. 2014; Bauer 2017) with mnlfa: one factor of binary items
#' (1PL or 2PL, P(x = 1) = invlogit(a theta - b)) whose item intercepts b and slopes a (2PL), mean and log SD depend
#' on person covariates, continuous or categorical (dummy coded, the first level the reference). The mean is 0 and
#' (2PL) the log SD 0 where every covariate is 0; for 1PL the log SD's intercept is free. mnlfa handles one factor
#' and binary items only, and gives no standard errors. (lavaan 0.7's `:~` data-defined parameters could express
#' such models, but lavaan cannot estimate them yet.)
ps_mnlfa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  items <- as.character(unlist(req$items))
  covs <- as.character(unlist(req$covariates))
  if (length(items) < 3) stop("Choose at least three binary items.")
  if (length(intersect(items, covs))) stop("An item cannot also be a covariate.")
  type <- req$itemType %||% "2PL"
  if (!(is.character(type) && length(type) == 1 && type %in% c("1PL", "2PL"))) stop("Invalid item type in the request.")
  role <- function(k) {
    x <- as.character(unlist(req[[k, exact = TRUE]]))
    if (length(setdiff(x, covs))) stop(sprintf("Unknown covariate in the request (%s).", k))
    x
  }
  int <- role("intercept")
  slo <- if (type == "2PL") role("slope") else character(0)
  mu <- role("mean")
  sdv <- role("sd")
  cats <- intersect(as.character(unlist(req$categorical)), covs)
  moderated <- as.character(unlist(req$moderated))
  if (length(setdiff(moderated, items))) stop("Unknown moderated item in the request.")
  if (!length(moderated)) moderated <- items
  all_mod <- length(moderated) == length(items)
  if (all_mod && length(intersect(int, mu))) stop("A covariate moderates the factor mean and the intercepts of every item: not identified. Leave at least one item unmoderated (an anchor).")
  if (all_mod && length(intersect(slo, sdv))) stop("A covariate moderates the factor SD and the slopes of every item: not identified. Leave at least one item unmoderated (an anchor).")
  fr <- ps_long_frame(req, c(items, covs))
  iv <- unname(fr$v[items])
  cv <- fr$v[covs]
  d <- fr$data
  # Categorical covariates: a dummy per level but the first (the reference), named covariate_level.
  terms <- list()
  used <- names(d)
  body_cat <- character(0)
  term_of <- list()
  for (k in covs) {
    v <- unname(cv[k])
    if (k %in% cats) {
      lv <- sort(unique(d[[v]][!is.na(d[[v]])]))
      if (length(lv) < 2) stop(sprintf("The categorical covariate %s has one level.", k))
      if (length(lv) > 20) stop(sprintf("The categorical covariate %s has more than 20 levels.", k))
      nm <- character(0)
      for (l in lv[-1]) {
        t <- ps_ident(paste0(v, "_", format(l, trim = TRUE)))
        while (t %in% used) t <- paste0(t, "_d")
        used <- c(used, t)
        nm <- c(nm, t)
        body_cat <- c(body_cat, sprintf("data$%s <- as.numeric(data$%s == %s)", t, v, format(l, digits = 15)))
        terms[[length(terms) + 1]] <- list(term = t, covariate = k, level = format(l, trim = TRUE))
      }
      term_of[[k]] <- nm
    } else {
      term_of[[k]] <- v
      terms[[length(terms) + 1]] <- list(term = v, covariate = k, level = NULL)
    }
  }
  fml <- function(x, intercept) {
    t <- unlist(term_of[x], use.names = FALSE)
    if (!length(t)) sprintf("~%d", as.integer(intercept)) else paste0("~", if (intercept) "1" else "0", " + ", paste(t, collapse = " + "))
  }
  item_fml <- function(x, what) {
    if (!length(x) || all_mod) {
      return(sprintf("formula_%s <- %s", what, fml(x, TRUE)))
    }
    c(
      sprintf("formula_%s <- mnlfa_expand_to_list(x = ~1, names_list = items)", what),
      sprintf("for (i in %s) formula_%s[[i]] <- %s  # the moderated items", ps_q(unname(fr$v[moderated])), what, fml(x, TRUE))
    )
  }
  body <- c(
    "suppressPackageStartupMessages(library(mnlfa))",
    sprintf("items <- %s", ps_q(iv)),
    if (length(cv)) c("# Covariates must be complete (cases without them are left out)", sprintf("data <- data[complete.cases(data[, %s, drop = FALSE]), , drop = FALSE]", ps_q(unname(cv)))),
    "if (!all(unlist(data[items]) %in% c(0, 1, NA))) stop(\"The items must be binary, coded 0 and 1.\")",
    if (length(body_cat)) c("# Categorical covariates as dummies: one per level but the first (the reference)", body_cat),
    "# Item intercepts (b) and slopes (a) as functions of the covariates: P(x = 1) = invlogit(a * theta - b)",
    item_fml(int, "int"), item_fml(slo, "slo"),
    "# The factor's mean (0 where the covariates are 0) and log SD",
    sprintf("formula_mean <- %s", fml(mu, FALSE)),
    sprintf("formula_sd <- %s%s", fml(sdv, type == "1PL"), if (type == "1PL") "  # (1PL: slopes fixed at 1, the SD free)" else "  # (2PL: the SD is 1 where the covariates are 0)"),
    sprintf("mod <- mnlfa(dat = data, items = items, item_type = \"%s\", formula_int = formula_int, formula_slo = formula_slo, formula_mean = formula_mean, formula_sd = formula_sd, verbose = FALSE)", type)
  )
  inputs <- list(data = d)
  if (export) {
    return(ps_script(sprintf("Moderated nonlinear factor analysis, %s (mnlfa)", type), "mnlfa", inputs, body, c("summary(mod)", "mod$item", "mod$trait")))
  }
  env <- ps_run(body, inputs)
  m <- env$mod
  it <- m$item
  tr <- m$trait
  item_rows <- lapply(seq_len(nrow(it)), function(i) {
    p <- as.character(it$parm[i])
    nm <- as.character(it$item[i])
    rest <- substring(p, nchar(nm) + 2)
    list(item = ps_back(nm, fr$back), kind = substr(rest, 1, 1), term = substring(rest, 3), est = it$est[i], free = it$estim[i] == 1)
  })
  trait_rows <- lapply(seq_len(nrow(tr)), function(i) list(kind = as.character(tr$type[i]), term = sub("^(mu|sigma)_", "", as.character(tr$par[i])), est = tr$est[i]))
  ic <- m$ic
  ps_json(list(
    itemType = type, n = nrow(env$data), items = item_rows, trait = trait_rows, terms = terms,
    fit = list(deviance = ic$deviance, logLik = -ic$deviance / 2, npar = ic$np, aic = ic$AIC, bic = ic$BIC, caic = ic$CAIC, aicc = ic$AICc),
    iterations = m$iter, converged = isTRUE(m$converged), warnings = env$.warnings,
    engine = ps_engine("mnlfa")
  ))
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
  body <- c(
    "suppressPackageStartupMessages({ library(lavaan); library(semTools) })",
    if (!o$fiml) ps_missing_code(req$missing),
    "# The factor at each occasion (configural: nothing held equal)",
    "model <- '", sprintf("  %s =~ %s", fv, vapply(iv, paste, "", collapse = " + ")), "'",
    sprintf("longFacNames <- list(%s = %s)  # the same factor at each occasion", base, ps_q(fv)),
    "# The same item at each occasion (its residuals are correlated across occasions)",
    sprintf("longIndNames <- list(%s)", paste(sprintf("%s = %s", vapply(items, `[`, "", 1), vapply(items, ps_q, "")), collapse = ", ")),
    "# Each level adds equality constraints across occasions to the one before",
    vapply(levels, function(l) {
      sprintf(
        "fit_%s <- measEq.syntax(configural.model = model, data = data, ID.fac = \"std.lv\", longFacNames = longFacNames, longIndNames = longIndNames, long.equal = %s, auto = %s, meanstructure = TRUE, %s, return.fit = TRUE)",
        l, equal[[l]], if (lag == "all") "\"all\"" else "1L", opts
      )
    }, ""),
    "# Chi-square difference tests between successive levels",
    "lrt <- lavTestLRT(fit_configural, fit_metric, fit_scalar, fit_strict)",
    "# The lavaan syntax measEq.syntax generated for each level: lavaan(syntax$scalar, data = data, ...)",
    "# with the same estimator and missing-data options fits that model again",
    "fits <- list(configural = fit_configural, metric = fit_metric, scalar = fit_scalar, strict = fit_strict)",
    "syntax <- lapply(fits, function(f) as.character(f@external$measEq.syntax))"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      "Longitudinal measurement invariance (semTools::measEq.syntax, lavaan)", c("lavaan", "semTools"), inputs, body,
      c(
        "lrt", "sapply(list(configural = fit_configural, metric = fit_metric, scalar = fit_scalar, strict = fit_strict), fitMeasures, fit.measures = c(\"chisq\", \"df\", \"cfi\", \"rmsea\", \"srmr\"))",
        "cat(syntax$scalar)"
      )
    ))
  }
  env <- ps_run(body, inputs)
  fits <- lapply(levels, function(l) env[[paste0("fit_", l)]])
  fm <- lapply(fits, ps_inv_fit)
  robust <- !is.na(lavaan::fitMeasures(fits[[1]])["chisq.scaled"])
  lrt <- env$lrt
  rn <- rownames(lrt)
  at <- function(i) match(paste0("fit_", levels[i]), rn)
  factor_pars <- function(f) {
    pe <- lavaan::parameterEstimates(f)
    lapply(seq_len(T), function(t) {
      m <- pe[pe$lhs == fv[t] & pe$op == "~1", ]
      v <- pe[pe$lhs == fv[t] & pe$op == "~~" & pe$rhs == fv[t], ]
      nz <- function(x) if (length(x) && !is.na(x) && x > 0) x else NULL
      list(mean = m$est, meanSe = nz(m$se), variance = v$est, varianceSe = nz(v$se))
    })
  }
  ps_json(list(
    robust = robust, n = lavaan::lavInspect(fits[[1]], "nobs"), occasions = T, items = k, lag = lag,
    levels = lapply(seq_along(levels), function(i) {
      c(
        list(level = levels[i]), fm[[i]],
        if (i > 1) {
          list(
            chisqDiff = unname(lrt[["Chisq diff"]][at(i)]), dfDiff = unname(lrt[["Df diff"]][at(i)]), p = unname(lrt[["Pr(>Chisq)"]][at(i)]),
            cfiChange = fm[[i]]$cfi - fm[[i - 1]]$cfi, rmseaChange = fm[[i]]$rmsea - fm[[i - 1]]$rmsea
          )
        },
        list(factor = factor_pars(fits[[i]]), syntax = env$syntax[[levels[i]]])
      )
    }),
    warnings = env$.warnings, engine = ps_engine("semTools", lavaan = "lavaan")
  ))
}

#' Uniform DIF by MIMIC (Muthen 1989; Woods 2009): the factor regressed on a covariate (a binary group or a continuous
#' one); each item's direct effect from the covariate screened (1) by a score test from the model without direct
#' effects (lavTestScore, add = ...) and (2) by one model per item with its direct path (Wald z and a likelihood-ratio
#' test against the model without it, scaled for MLR), the LR p-values corrected for the number of items (p.adjust).
#' Optionally the items flagged at alpha get their direct effects in a final model, which gives the factor's
#' difference corrected for that DIF.
ps_mimic_dif <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  cov <- req$covariate
  if (!(is.character(cov) && length(cov) == 1 && nzchar(cov))) stop("Choose a covariate.")
  f <- ps_inv_factors(req, cov)
  if (length(f$fv) != 1) stop("Choose one factor.")
  if (length(f$iv[[1]]) < 3) stop("DIF screening needs a factor with at least three indicators.")
  if (cov %in% unlist(f$inds)) stop("The covariate is an indicator of the factor.")
  adjust <- req$adjust %||% "holm"
  if (!(is.character(adjust) && length(adjust) == 1 && adjust %in% c("holm", "BH", "bonferroni", "none"))) stop("Invalid p-value correction in the request.")
  alpha <- ps_number(req$alpha %||% 0.05, "significance level")
  if (alpha <= 0 || alpha >= 1) stop("The significance level must be between 0 and 1.")
  free <- isTRUE(req$free)
  o <- ps_long_options(req)
  s <- f$fv
  items <- f$iv[[1]]
  x <- unname(f$fr$v[cov])
  call <- function(model) sprintf("sem(%s, data = data, estimator = \"%s\"%s%s)", model, o$est, ps_lavaan_missing(req$missing), o$extra)
  body <- c(
    "suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]  # (cases without the covariate are left out)", x),
    "# MIMIC model: the factor regressed on the covariate, no direct effects on the items",
    "base <- '", f$lines, sprintf("  %s ~ %s", s, x), "'",
    sprintf("fit0 <- %s", call("base")),
    sprintf("items <- %s", ps_q(items)),
    sprintf("paths <- sprintf(\"%%s ~ %s\", items)  # each item's direct effect from the covariate (uniform DIF)", x),
    "# Score tests of the direct effects, from the model without them",
    "score <- tryCatch(lavTestScore(fit0, add = paths)$uni, error = function(e) NULL)",
    "# One model per item with its direct effect, tested against the model without it",
    sprintf("fits <- lapply(paths, function(p) %s)", call("paste(base, p, sep = \"\\n\")")),
    "lrt <- lapply(fits, function(f) lavTestLRT(fit0, f))",
    "direct <- do.call(rbind, lapply(seq_along(items), function(k) {",
    "  pe <- parameterEstimates(fits[[k]], standardized = TRUE)",
    sprintf("  r <- pe[pe$op == \"~\" & pe$lhs == items[k] & pe$rhs == \"%s\", ]", x),
    "  data.frame(item = items[k], est = r$est, se = r$se, z = r$z, p = r$pvalue, std = r$std.all,",
    "    chisq = lrt[[k]][[\"Chisq diff\"]][2], df = lrt[[k]][[\"Df diff\"]][2], p_lrt = lrt[[k]][[\"Pr(>Chisq)\"]][2])",
    "}))",
    sprintf("direct$p_adj <- p.adjust(direct$p_lrt, method = \"%s\")  # corrected for the number of items", adjust),
    sprintf("flagged <- direct$item[direct$p_adj < %s]", format(alpha, digits = 15)),
    if (free) {
      c(
        "# Final model: the flagged items' direct effects freed",
        sprintf("fit_free <- %s", call("paste(c(base, paths[match(flagged, items)]), collapse = \"\\n\")"))
      )
    }
  )
  inputs <- list(data = f$fr$data)
  if (export) {
    return(ps_script(
      "DIF by MIMIC (lavaan)", "lavaan", inputs, body,
      c("summary(fit0, standardized = TRUE)", "score", "direct", "flagged", if (free) "summary(fit_free, standardized = TRUE)")
    ))
  }
  env <- ps_run(body, inputs)
  eff <- function(fit) {
    pe <- lavaan::parameterEstimates(fit, standardized = TRUE)
    r <- pe[pe$op == "~" & pe$lhs == s & pe$rhs == x, ]
    list(est = r$est, se = r$se, z = r$z, p = r$pvalue, std = r$std.all)
  }
  d <- env$direct
  sc <- env$score
  back <- f$fr$back
  rows <- lapply(seq_len(nrow(d)), function(k) {
    list(
      item = ps_back(d$item[k], back), est = d$est[k], se = d$se[k], z = d$z[k], p = d$p[k], std = d$std[k],
      chisq = d$chisq[k], df = d$df[k], pLrt = d$p_lrt[k], pAdj = d$p_adj[k], flagged = d$p_adj[k] < alpha,
      score = if (!is.null(sc)) sc$X2[k], scoreP = if (!is.null(sc)) sc$p.value[k]
    )
  })
  final <- if (free) {
    pe <- lavaan::parameterEstimates(env$fit_free, standardized = TRUE)
    dd <- pe[pe$op == "~" & pe$rhs == x & pe$lhs %in% env$flagged, ]
    list(
      effect = eff(env$fit_free), fit = ps_inv_fit(env$fit_free),
      direct = lapply(seq_len(nrow(dd)), function(k) list(item = ps_back(dd$lhs[k], back), est = dd$est[k], se = dd$se[k], z = dd$z[k], p = dd$pvalue[k], std = dd$std.all[k]))
    )
  } else {
    NULL
  }
  ps_json(list(
    n = lavaan::lavInspect(env$fit0, "nobs"), factor = f$names, covariate = cov, adjust = adjust, alpha = alpha,
    effect = eff(env$fit0), fit = ps_inv_fit(env$fit0), items = rows, flagged = I(ps_back(as.character(env$flagged), back)), final = final,
    scoreError = is.null(sc), warnings = env$.warnings,
    engine = ps_engine("lavaan")
  ))
}

#' Local structural equation models (LSEM; Hildebrandt, Wilhelm & Robitzsch 2009; Hildebrandt, Luedtke, Robitzsch,
#' Sommer & Wilhelm 2016) with sirt::lsem.estimate: the CB-SEM model on the canvas (as lavaan syntax) is fitted at
#' each focal point of a continuous moderator to the cases weighted by a kernel around it (bandwidth h x SD x N^-1/5),
#' so every parameter becomes a curve along the moderator. Optionally lsem.bootstrap (resampled cases: standard
#' errors and normal-theory intervals per focal point) and lsem.permutationTest (the moderator permuted: p values of
#' each parameter's variation, SD and MAD over the focal points and its linear slope, and pointwise), each after
#' set.seed() so a run reproduces. Continuous indicators, one group, ML.
ps_lsem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  o <- req$lsem
  if (!is.list(o)) stop("Invalid local SEM options in the request.")
  b <- ps_cb_build(req)
  ps_cb_plain(b, "Local SEM")
  if (!grepl("^fit <- sem\\(.*\\)$", b$call)) stop("Local SEM is not available for this model.")
  if (!is.null(b$group_var)) stop("Local SEM moderates one sample by a continuous variable: remove the grouping (the moderator replaces the groups).")
  if (!is.null(req$model$weights)) stop("Local SEM here does not take sampling weights: remove them under the model's settings.")
  if (!is.null(req$model$cluster)) stop("Local SEM here does not take sampling clusters.")
  if (length(b$composites)) stop("Local SEM is for common-factor models; the model has composites (<~).")
  if (length(unlist(req$model$ordered))) stop("Local SEM here is for continuous indicators (ML); the model has ordinal indicators.")
  if (length(b$esem_blocks)) stop("Local SEM is not available for ESEM blocks (the rotation would differ between focal points).")
  est <- req$estimator %||% "ML"
  if (!est %in% c("ML", "MLR")) stop("Local SEM fits each focal point by maximum likelihood: choose ML or MLR (Model settings).")
  miss <- req$missing %||% "casewise"
  if (miss %in% c("pairwise", "twostage", "robusttwostage", "mi")) stop("Local SEM handles missing values by FIML, casewise deletion or mean replacement (Model settings).")
  fiml <- identical(miss, "fiml")
  mo <- req$moderator
  mname <- mo$name
  if (!(is.character(mname) && length(mname) == 1 && nzchar(mname))) stop("Choose a moderator.")
  if (mname %in% b$n$all_inds) stop("The moderator is a variable of the model; choose another column.")
  mcol <- as.numeric(unlist(lapply(mo$col, function(v) if (is.null(v)) NA_real_ else v)))
  if (length(mcol) != nrow(b$inputs$data)) stop("The moderator does not have one value per case.")
  if (length(unique(mcol[is.finite(mcol)])) < 3) stop("The moderator needs at least three distinct values.")
  mv <- ps_ident(c(names(b$inputs$data), mname))[ncol(b$inputs$data) + 1]
  while (mv %in% names(b$inputs$data)) mv <- paste0(mv, "_mod")
  b$inputs$data[[mv]] <- mcol
  num <- function(x, what, lo, hi) {
    v <- ps_number(x, what)
    if (v < lo || v > hi) stop(sprintf("The %s must be between %s and %s.", what, lo, hi))
    v
  }
  from <- ps_number(o$from, "first focal point")
  to <- ps_number(o$to, "last focal point")
  if (from >= to) stop("The last focal point must be above the first.")
  points <- num(o$points, "number of focal points", 2, 100)
  if (points != round(points)) stop("The number of focal points must be a whole number.")
  h <- num(o$h %||% 1.1, "bandwidth factor h", 0.05, 20)
  kernel <- o$kernel %||% "gaussian"
  if (!(is.character(kernel) && length(kernel) == 1 && kernel %in% c("gaussian", "epanechnikov", "uniform"))) stop("Invalid kernel in the request.")
  R <- if (is.null(o$bootstrap)) 0L else as.integer(num(o$bootstrap, "number of bootstrap samples", 10, 5000))
  B <- if (is.null(o$permutations)) 0L else as.integer(num(o$permutations, "number of permutations", 10, 5000))
  seed <- as.integer(num(o$seed %||% 1, "seed", -2147483647, 2147483647))
  span <- ps_model_span(b)
  f15 <- function(x) format(x, digits = 15)
  args <- c(
    sprintf("h = %s", f15(h)), sprintf("kernel = \"%s\"", kernel),
    if (fiml) "sufficient_statistics = FALSE, missing = \"fiml\"", # (FIML needs the cases, not weighted moments)
    if (isTRUE(b$means)) "meanstructure = TRUE"
  )
  body <- c(
    b$body[seq_len(span[2])],
    "suppressPackageStartupMessages(library(sirt))",
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]  # (cases without a moderator value are left out)", mv),
    sprintf("# Focal points of the moderator %s; each fit weights the cases by a %s kernel around the point", ps_comment(mname), kernel),
    sprintf("# (bandwidth h x SD(moderator) x N^(-1/5), h = %s)", f15(h)),
    sprintf("moderator_grid <- seq(%s, %s, length.out = %d)", f15(from), f15(to), as.integer(points)),
    sprintf("mod <- lsem.estimate(data, moderator = \"%s\", moderator.grid = moderator_grid, lavmodel = model, %s, verbose = FALSE)", mv, paste(args, collapse = ", ")),
    if (R > 0) {
      c(
        sprintf("# Bootstrap: %d resamples of the cases, each refitted at every focal point (standard errors and intervals)", R),
        sprintf("set.seed(%d)", seed), sprintf("boot <- lsem.bootstrap(mod, R = %d, verbose = FALSE)", R)
      )
    },
    if (B > 0) {
      c(
        sprintf("# Permutation test of invariance: the moderator permuted %d times; how often the parameters vary as much", B),
        sprintf("set.seed(%d)", seed), sprintf("perm <- lsem.permutationTest(mod, B = %d, verbose = FALSE)", B)
      )
    }
  )
  inputs <- b$inputs
  if (export) {
    return(ps_script(
      "Local structural equation model (sirt)", c("lavaan", "sirt"), inputs, body,
      c("summary(mod)", if (R > 0) "boot$parameters", if (B > 0) "summary(perm)")
    ))
  }
  env <- ps_run(body, inputs)
  mod <- env$mod
  back <- ps_cb_back(b)
  P <- mod$parameters
  pars <- unique(as.character(P$par))
  S <- mod$parameters_summary
  bp <- if (R > 0) env$boot$parameters else NULL
  ts <- if (B > 0) env$perm$teststat else NULL
  pw <- if (B > 0) env$perm$parameters_pointwise_test else NULL
  nn <- function(x) unname(as.numeric(x))
  params <- lapply(pars, function(p) {
    r <- P[P$par == p, , drop = FALSE]
    r <- r[order(r$grid_index), , drop = FALSE]
    s <- S[S$par == p, , drop = FALSE]
    fit <- identical(as.character(r$op[1]), "fit")
    out <- list(
      par = p, op = if (fit) "fit" else as.character(r$op[1]),
      lhs = if (fit) p else ps_back(as.character(r$lhs[1]), back), rhs = if (fit) "" else ps_back(as.character(r$rhs[1]), back),
      est = I(nn(r$est)), se = I(nn(r$se))
    )
    if (nrow(s)) out$summary <- list(mean = nn(s$M), sd = nn(s$SD), mad = nn(s$MAD), min = nn(s$Min), max = nn(s$Max), linInt = nn(s$lin_int), linSlope = nn(s$lin_slo), sdNonlin = nn(s$SD_nonlin))
    if (!is.null(bp)) {
      q <- bp[bp$par == p, , drop = FALSE]
      q <- q[order(q$grid_index), , drop = FALSE]
      if (nrow(q)) out$boot <- list(se = I(nn(q$se)), lower = I(nn(q$ci.lower)), upper = I(nn(q$ci.upper)))
    }
    if (!is.null(ts)) {
      t <- ts[ts$par == p, , drop = FALSE]
      if (nrow(t)) {
        w <- pw[pw$par == p, , drop = FALSE]
        w <- w[order(w$grid_index), , drop = FALSE]
        out$test <- list(sdP = nn(t$SD_p), madP = nn(t$MAD_p), linSlopeP = nn(t$lin_slo_p), pointwise = I(nn(w$p)))
      }
    }
    out
  })
  dens <- mod$moderator.density
  ps_json(list(
    moderator = mname, grid = I(nn(mod$moderator.grid)), n = nrow(env$data), h = nn(mod$h), bw = nn(mod$bw), kernel = kernel,
    weight = I(nn(dens$wgt)), neff = I(nn(dens$Neff)), params = params, bootstrap = R, permutations = B, seed = seed,
    warnings = env$.warnings, engine = ps_engine("sirt", lavaan = "lavaan")
  ))
}

#' Effect sizes of measurement non-invariance between groups (Nye & Drasgow 2011; signed dMACS and the expected bias
#' in item and scale means and variances, Nye, Bradburn, Olenick, Bialko & Drasgow 2019) from the multigroup CB-SEM
#' model on the canvas as the Model tab fits it (configural, or partial invariance with some parameters freed): for
#' each focal group against the reference group, each item's expected score under the two groups' loadings and
#' intercepts, E(X | eta) = nu + lambda eta, is compared over the focal group's latent distribution, eta ~ N(kappa_F,
#' phi_F) (the factor's model-implied mean and variance in the focal group), by numerical integration as the dmacs
#' package does it: dMACS = sqrt(int (E_F - E_R)^2 f_F) / SD, signed dMACS = int (E_F - E_R) f_F / SD (positive: the
#' focal group scores higher at the same factor level), SD the item's pooled within-group SD (or the reference
#' group's). The scale's mean bias is the sum of the items'; its variance bias phi_F ((sum lambda_F)^2 - (sum
#' lambda_R)^2) (Nye & Drasgow's equations 7-9 summed). Continuous indicators.
ps_dmacs <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  o <- req$dmacs %||% list()
  b <- ps_cb_build(req)
  ps_cb_plain(b, "dMACS")
  if (is.null(b$group_var)) {
    stop("Effect sizes of non-invariance compare groups: choose a grouping column under Groups (Model inspector).")
  }
  if (length(unlist(req$model$ordered))) {
    stop("dMACS here is for continuous indicators (linear item functions); the model has ordinal indicators.")
  }
  if (length(b$composites)) stop("dMACS is for common factors; the model has composites (<~).")
  if (isFALSE(req$model$multigroup$meanStructure)) {
    stop("dMACS needs the groups' intercepts: keep the mean structure under Groups.")
  }
  sdtype <- o$sd %||% "pooled"
  if (!(is.character(sdtype) && length(sdtype) == 1 && sdtype %in% c("pooled", "reference"))) {
    stop("Invalid SD in the request.")
  }
  ref <- o$reference
  if (!is.null(ref) && !(is.character(ref) && length(ref) == 1 && nchar(ref) <= 200)) {
    stop("Invalid reference group in the request.")
  }
  ref_line <- if (is.null(ref)) {
    "ref <- 1  # the reference group: the first"
  } else {
    sprintf("ref <- match('%s', groups)  # the reference group", ps_sq(ref))
  }
  denominator <- if (sdtype == "pooled") {
    c(
      "# Denominator: each item's pooled within-group SD of the two groups compared (Nye & Drasgow 2011, equation 3)",
      "denominator <- function(f) {",
      "  nr <- item_n(ref)",
      "  nf <- item_n(f)",
      "  sqrt(((nr - 1) * item_sd(ref)^2 + (nf - 1) * item_sd(f)^2) / (nr + nf - 2))",
      "}"
    )
  } else {
    c(
      "# Denominator: each item's SD in the reference group (Glass's choice)",
      "denominator <- function(f) item_sd(ref)"
    )
  }
  body <- c(
    b$body,
    "# ---- Effect sizes of measurement non-invariance (Nye & Drasgow 2011; Nye et al. 2019) ----",
    "est <- lavInspect(fit, \"est\")",
    "groups <- lavInspect(fit, \"group.label\")",
    "kappa <- lavInspect(fit, \"mean.lv\")  # each group's model-implied factor means",
    "phi <- lavInspect(fit, \"cov.lv\")     # and factor (co)variances",
    "obs <- lavInspect(fit, \"data\")       # each group's analysed cases",
    ref_line,
    "if (is.na(ref)) stop(\"The reference group is not one of the model's groups.\")",
    "factors <- unique(parTable(fit)$lhs[parTable(fit)$op == \"=~\"])",
    "# Expected item score E(X | eta) = nu + lambda eta, eta = kappa_F + z sqrt(phi_F), z standard normal",
    "# (integrated over z as the dmacs package does it)",
    "difference <- function(z, lR, nR, lF, nF, m, v) {",
    "  eta <- m + z * sqrt(v)",
    "  (nF + lF * eta) - (nR + lR * eta)",
    "}",
    "dmacs_item <- function(lR, nR, lF, nF, m, v, sd) {",
    "  f <- function(z) difference(z, lR, nR, lF, nF, m, v)^2 * dnorm(z)",
    "  sqrt(integrate(f, -Inf, Inf, rel.tol = 1e-10)$value) / sd",
    "}",
    "mean_bias <- function(lR, nR, lF, nF, m, v) {",
    "  f <- function(z) difference(z, lR, nR, lF, nF, m, v) * dnorm(z)",
    "  integrate(f, -Inf, Inf, rel.tol = 1e-10)$value",
    "}",
    "item_sd <- function(g) apply(obs[[g]], 2, sd, na.rm = TRUE)",
    "item_n <- function(g) colSums(!is.na(obs[[g]]))",
    denominator,
    "effects <- NULL",
    "for (f in setdiff(seq_along(groups), ref)) {",
    "  sd <- denominator(f)",
    "  for (k in factors) {",
    "    LR <- est[[ref]]$lambda[, k]",
    "    LF <- est[[f]]$lambda[, k]",
    "    m <- kappa[[f]][k]",
    "    v <- phi[[f]][k, k]",
    "    for (i in names(LR)[LR != 0]) {",
    "      lR <- LR[[i]]",
    "      lF <- LF[[i]]",
    "      nR <- est[[ref]]$nu[i, 1]",
    "      nF <- est[[f]]$nu[i, 1]",
    "      row <- data.frame(focal = groups[f], factor = k, item = i,",
    "        lambda_ref = lR, nu_ref = nR, lambda_focal = lF, nu_focal = nF, kappa_focal = m, phi_focal = v, sd = sd[[i]],",
    "        dmacs = dmacs_item(lR, nR, lF, nF, m, v, sd[[i]]),",
    "        mean_bias = mean_bias(lR, nR, lF, nF, m, v),",
    "        var_bias = v * (lF^2 - lR^2))",
    "      effects <- rbind(effects, row)",
    "    }",
    "  }",
    "}",
    "effects$dmacs_signed <- effects$mean_bias / effects$sd",
    "# The scale (sum of a factor's items): expected bias in its mean and in its variance",
    "scales <- NULL",
    "for (e in split(effects, list(effects$focal, effects$factor), drop = TRUE)) {",
    "  var_bias <- e$phi_focal[1] * (sum(e$lambda_focal)^2 - sum(e$lambda_ref)^2)",
    "  row <- data.frame(focal = e$focal[1], factor = e$factor[1], items = nrow(e),",
    "    kappa = e$kappa_focal[1], phi = e$phi_focal[1], mean_bias = sum(e$mean_bias), var_bias = var_bias)",
    "  scales <- rbind(scales, row)",
    "}"
  )
  inputs <- b$inputs
  if (export) {
    title <- "Effect sizes of measurement non-invariance (dMACS)"
    return(ps_script(title, "lavaan", inputs, body, c("summary(fit)", "effects", "scales")))
  }
  env <- ps_run(body, inputs)
  e <- env$effects
  s <- env$scales
  if (is.null(e) || !nrow(e)) stop("No factor with loadings to compare: draw factors with indicators.")
  back <- ps_cb_back(b)
  nm <- function(x) ps_back(as.character(x), back)
  items <- lapply(seq_len(nrow(e)), function(i) {
    list(
      focal = as.character(e$focal[i]), factor = nm(e$factor[i]), item = nm(e$item[i]),
      lambdaRef = e$lambda_ref[i], nuRef = e$nu_ref[i], lambdaFocal = e$lambda_focal[i], nuFocal = e$nu_focal[i],
      sd = e$sd[i], dmacs = e$dmacs[i], signed = e$dmacs_signed[i], meanBias = e$mean_bias[i], varBias = e$var_bias[i]
    )
  })
  scales <- lapply(seq_len(nrow(s)), function(i) {
    list(
      focal = as.character(s$focal[i]), factor = nm(s$factor[i]), items = s$items[i],
      kappa = s$kappa[i], phi = s$phi[i], meanBias = s$mean_bias[i], varBias = s$var_bias[i]
    )
  })
  ps_json(list(
    groups = I(as.character(env$groups)),
    reference = as.character(env$groups[env$ref]),
    sd = sdtype,
    n = I(unname(as.numeric(lavaan::lavInspect(env$fit, "nobs")))),
    items = items,
    scales = scales,
    warnings = env$.warnings,
    engine = ps_engine("lavaan")
  ))
}
