# PLS Studio <-> cSEM / seminr. Builds the package's script for the diagram,
# runs it, and returns what the app's PLS views need, with the user's names
# restored. ps_pls(req, export = TRUE) returns the script instead.
# Estimation is the package's; this file only writes code and shapes output.

#' allow_hoc / allow_mi: second-order constructs (cSEM's two-stage approach) and
#' multiple imputation are accepted only by the estimation and the bootstrap;
#' other analyses refuse them. allow_ord: ordinal indicators (OrdPLS/OrdPLSc, cSEM),
#' likewise accepted by the estimation and the bootstrap only.
ps_pls_build <- function(req, allow_hoc = FALSE, allow_mi = FALSE, allow_ord = FALSE) {
  if (isTRUE(req$missing %in% c("fiml", "pairwise", "twostage", "robusttwostage"))) {
    stop("FIML, pairwise deletion and the two-stage approach are CB-SEM (lavaan) options; PLS-SEM uses mean replacement, casewise deletion or multiple imputation.")
  }
  if (identical(req$missing, "mi") && !allow_mi) {
    stop("This analysis is not available with multiple imputation; choose mean replacement or casewise deletion for it.")
  }
  pkg <- req$package
  cons <- req$model$constructs
  n <- ps_names(cons)
  cv <- unname(n$cv)
  k0 <- length(cons)
  type <- vapply(cons, function(c) c$type %||% if (identical(c$mode, "B")) "composite" else "factor", "")
  mode <- vapply(cons, function(c) c$mode %||% "A", "")
  if (!all(mode %in% c("A", "B", "unit")) || !all(type %in% c("factor", "composite"))) {
    stop("Invalid measurement mode or construct type in the request.")
  }
  comps <- lapply(cons, function(c) as.character(unlist(c$components)))
  hoc <- lengths(comps) > 0
  o <- req$options
  paths <- req$model$paths
  mods <- req$model$moderations
  from_to <- function(t) cv[match(vapply(Filter(function(p) p$to == t, paths), `[[`, "", "from"), n$cname)]
  ends <- unique(vapply(paths, `[[`, "", "to"))
  ivs <- function(j) unname(n$iv[n$inds[[j]]])
  # Repeated indicators: a second-order construct is measured by copies of its dimensions' indicators.
  rep_items <- function(j) unlist(lapply(match(comps[[j]], n$cname), ivs))
  comp_cv <- function(j) cv[match(comps[[j]], n$cname)]
  inputs <- list(data = ps_frame(req, n))
  body <- character(0)

  approach <- o$approach %||% "PLS-PM"
  if (!approach %in% c("PLS-PM", "GSCA", "PCA", "unit")) {
    stop("Invalid weighting approach in the request.")
  }
  gsca <- approach != "PLS-PM" # (any approach other than PLS path modeling: cSEM's .approach_weights)
  hoc_approach <- o$hocApproach %||% "two_stage"
  if (!hoc_approach %in% c("two_stage", "embedded", "repeated")) {
    stop("Invalid second-order approach in the request.")
  }
  repeated <- any(hoc) && hoc_approach == "repeated"
  two <- any(hoc) && !repeated # (a two-stage approach: the package estimates in two stages)
  if (any(hoc)) {
    if (!allow_hoc) {
      stop("This analysis is not available for models with second-order constructs (estimate and bootstrap them with cSEM).")
    }
    if (hoc_approach == "embedded" && pkg != "cSEM") {
      stop("The embedded two-stage approach is cSEM's (.approach_2ndorder = \"mixed\"); choose cSEM, or the two-stage or repeated-indicators approach.")
    }
    if (pkg == "seminr" && isTRUE(o$consistent)) {
      stop("Second-order constructs with consistent PLS are estimated with cSEM; choose cSEM, or turn off PLSc for seminr.")
    }
    if (gsca) {
      stop("Second-order constructs are estimated with PLS path modeling; choose PLS-PM as the weighting approach.")
    }
    first <- unique(unlist(comps))
    if (!all(first %in% n$cname)) stop("A second-order construct refers to an unknown component.")
    if (any(hoc[match(first, n$cname)]) || any(lengths(n$inds[match(first, n$cname)]) == 0)) {
      stop("The components of a second-order construct must be first-order constructs with indicators.")
    }
    if (any(lengths(n$inds[hoc]) > 0)) {
      stop("A second-order construct is measured by its components only, not by indicators of its own.")
    }
    lvs <- unlist(lapply(c(paths, mods), function(p) c(p$from, p$to, p$moderator)))
    if (any(first %in% lvs)) {
      stop("The components of a second-order construct cannot take part in the structural model (two-stage approach); connect the second-order construct instead.")
    }
    if (length(mods) && any(n$cname[hoc] %in% unlist(lapply(mods, function(m) c(m$from, m$moderator))))) {
      stop("Interactions with a second-order construct are not supported.")
    }
  }
  if (gsca && pkg != "cSEM") stop("This weighting approach is estimated with cSEM; choose cSEM.")
  # Ordinal indicators: OrdPLS / OrdPLSc (Schuberth, Henseler & Dijkstra 2018), cSEM's estimator for ordered factors.
  ord <- intersect(as.character(unlist(req$model$ordered)), n$all_inds)
  if (length(ord)) {
    if (!allow_ord) {
      stop("This analysis is for continuous indicators; ordinal PLS (OrdPLS/OrdPLSc) is available for the estimation and the bootstrap. Treat the indicators as continuous (right-click an indicator) to run it.")
    }
    if (pkg != "cSEM") {
      stop("seminr has no ordinal PLS: OrdPLS and OrdPLSc (polychoric correlations) are estimated with cSEM. Choose cSEM, or treat the indicators as continuous.")
    }
    if (identical(req$missing, "mean") && anyNA(inputs$data[unname(n$iv[ord])])) {
      stop("Mean replacement would put non-category values into ordinal indicators that have missing values; choose casewise deletion.")
    }
    if (identical(req$missing, "mi")) {
      stop("Ordinal PLS (OrdPLS/OrdPLSc) is available with casewise deletion; multiple imputation is for continuous indicators.")
    }
    if (gsca) {
      stop("Ordinal indicators are estimated by OrdPLS (PLS path modeling on polychoric correlations); choose PLS-PM as the weighting approach.")
    }
    if (length(mods)) {
      stop("Interaction terms are products of construct scores, which OrdPLS does not estimate from the polychoric correlations; remove the interactions or treat the indicators as continuous.")
    }
    if (any(hoc)) {
      stop("Second-order constructs are not available with ordinal indicators (the two-stage approach uses construct scores); treat the indicators as continuous.")
    }
    few <- ord[vapply(ord, function(i) length(unique(stats::na.omit(inputs$data[[n$iv[[i]]]]))) < 2, TRUE)]
    if (length(few)) {
      stop(sprintf("%s %s fewer than two categories; an ordinal indicator needs two or more.", paste(few, collapse = ", "), if (length(few) == 1) "has" else "have"))
    }
  }
  # Interaction terms: seminr builds them by the two-stage, orthogonalising or product-indicator approach
  # (interaction_term's method); cSEM has one approach, products of the construct scores.
  int_method <- vapply(mods, function(m) {
    v <- m$method %||% "two_stage"
    if (!v %in% c("two_stage", "orthogonal", "product_indicator")) {
      stop("Invalid interaction method in the request.")
    }
    v
  }, "")
  if (pkg != "seminr" && any(int_method != "two_stage")) {
    stop("The orthogonalising and product-indicator interaction terms are seminr's (interaction_term); cSEM estimates products of the construct scores. Choose seminr, or the two-stage term.")
  }
  if (pkg == "cSEM") {
    sep <- "."
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], ".", n$cv[[m$moderator]]), "")
    # A second-order construct is measured by its first-order constructs.
    lines <- vapply(seq_len(k0), function(j) {
      paste(
        cv[j], if (type[j] == "composite") "<~" else "=~",
        paste(
          if (hoc[j] && repeated) paste0(rep_items(j), "_rep") else if (hoc[j]) comp_cv(j) else ivs(j),
          collapse = " + "
        )
      )
    }, "")
    # (Repeated indicators: the dimensions predict the second-order construct, as on cSEM's help page.)
    for (t in if (repeated) union(ends, n$cname[hoc]) else ends) {
      extra <- int_l[vapply(mods, function(m) m$to == t, TRUE)]
      dims <- if (repeated && hoc[match(t, n$cname)]) comp_cv(match(t, n$cname)) else character(0)
      lines <- c(lines, paste(n$cv[[t]], "~", paste(c(from_to(t), dims, extra), collapse = " + ")))
    }
    # Mode A, Mode B, or sum scores ("unit": equal weights on the standardised indicators).
    # (A second-order construct is weighted in cSEM's second stage by its type: Mode A for a common factor, Mode B for a composite.)
    keep <- if (repeated) rep(TRUE, k0) else !hoc
    modes <- paste0(
      "list(",
      paste(
        sprintf("%s = \"%s\"", cv[keep], ifelse(mode == "unit", "unit", paste0("mode", mode))[keep]),
        collapse = ", "
      ),
      ")"
    )
    scheme <- c(path = "path", centroid = "centroid", factor = "factorial")[[o$scheme]]
    # Dominant indicators: each such construct's sign is set so that this indicator loads positively.
    dom <- unlist(lapply(seq_len(k0), function(j) {
      d <- cons[[j]]$dominant
      if (is.character(d) && length(d) == 1 && d %in% n$inds[[j]] && !hoc[j]) {
        setNames(unname(n$iv[d]), cv[j])
      }
    }))
    dom_arg <- if (length(dom)) {
      sprintf(", .dominant_indicators = c(%s)", paste(sprintf("%s = \"%s\"", names(dom), dom), collapse = ", "))
    } else {
      ""
    }
    body <- c(
      "suppressPackageStartupMessages(library(cSEM))", ps_missing_code(req$missing),
      if (length(ord)) {
        c(
          sprintf(
            "# Ordinal indicators: OrdPLS%s (Schuberth, Henseler & Dijkstra 2018). As ordered factors they make cSEM use",
            if (isTRUE(o$consistent)) "c" else ""
          ),
          "# polychoric (two ordinal) and polyserial (ordinal and continuous) correlations instead of Pearson's.",
          sprintf("ordinal <- c(%s)", paste(ps_q(unname(n$iv[ord])), collapse = ", ")),
          "data[ordinal] <- lapply(data[ordinal], ordered)"
        )
      },
      if (length(mods)) "# Interaction terms (X.M): products of the construct scores (cSEM's nonlinear PLS)",
      "model <- '", paste0("  ", lines), "'",
      if (gsca) {
        c(
          GSCA = "# Generalized structured component analysis (GSCA; Hwang & Takane 2004) instead of PLS path modeling.",
          PCA = "# Weights: the first principal component of each block (PCA) instead of PLS path modeling.",
          unit = "# Unit weights: each construct is the (standardised) sum of its indicators (sum scores) instead of PLS path modeling."
        )[[approach]]
      },
      if (two && hoc_approach == "two_stage") {
        c(
          "# Second-order constructs: cSEM's (disjoint) two-stage approach. Stage 1 estimates the first-order constructs; stage 2",
          "# uses their scores as the indicators of the second-order construct (cSEM corrects a second-order common factor for attenuation in stage 2)."
        )
      },
      if (two && hoc_approach == "embedded") {
        c(
          "# Second-order constructs: cSEM's embedded two-stage approach (.approach_2ndorder = \"mixed\"; Ringle, Sarstedt & Straub 2012).",
          "# Stage 1 uses the repeated indicators, so the second-order construct is in the model; stage 2 uses the dimensions' scores as its indicators."
        )
      },
      if (repeated) {
        c(
          "# Second-order constructs: the repeated indicators approach, written out as on cSEM's help page (?csem):",
          "# the dimensions' indicators are copied (*_rep) to measure the second-order construct, and the dimensions predict it.",
          sprintf("rep_items <- c(%s)", paste(ps_q(unique(unlist(lapply(which(hoc), rep_items)))), collapse = ", ")),
          "data <- cbind(data, setNames(data[rep_items], paste0(rep_items, \"_rep\")))"
        )
      },
      sprintf(
        "fit <- csem(data, model, %s.PLS_weight_scheme_inner = \"%s\", .disattenuate = %s, .tolerance = %s, .iter_max = %d%s)",
        if (gsca) sprintf(".approach_weights = \"%s\", ", approach) else sprintf(".PLS_modes = %s, ", modes), scheme, if (isTRUE(o$consistent)) "TRUE" else "FALSE", format(ps_number(o$tolerance, "tolerance"), scientific = TRUE), as.integer(o$maxIter),
        paste0(
          if (two) sprintf(", .approach_2ndorder = \"%s\"", if (hoc_approach == "embedded") "mixed" else "2stage") else "",
          dom_arg
        )
      )
    )
  } else if (pkg == "seminr") {
    if (o$scheme == "centroid") {
      stop("seminr offers the path and factor weighting schemes only; choose one of those, or cSEM.")
    }
    int_l <- vapply(mods, function(m) paste0(n$cv[[m$from]], "*", n$cv[[m$moderator]]), "")
    weights_of <- function(j) if (mode[j] == "unit") "unit_weights" else paste0("mode_", mode[j])
    mm <- vapply(which(!hoc), function(j) {
      items <- ivs(j)
      it <- if (length(items) == 1) sprintf("single_item(\"%s\")", items) else ps_q(items)
      if (isTRUE(o$consistent) && type[j] == "factor" && length(items) > 1) {
        sprintf("reflective(\"%s\", %s)", cv[j], it)
      } else if (length(items) == 1) {
        sprintf("composite(\"%s\", %s)", cv[j], it)
      } else {
        sprintf("composite(\"%s\", %s, weights = %s)", cv[j], it, weights_of(j))
      }
    }, "")
    # Second-order constructs (after their dimensions): seminr's two-stage approach, weighted by the construct's mode,
    # or, with repeated indicators, a composite of the dimensions' items (seminr has no helper for that approach).
    mm <- c(mm, vapply(which(hoc), function(j) {
      if (repeated) {
        sprintf("composite(\"%s\", %s, weights = %s)", cv[j], ps_q(rep_items(j)), weights_of(j))
      } else {
        sprintf(
          "higher_composite(\"%s\", dimensions = %s, method = two_stage, weights = %s)",
          cv[j],
          ps_q(comp_cv(j)),
          weights_of(j)
        )
      }
    }, ""))
    mm <- c(
      mm,
      vapply(
        seq_along(mods),
        function(q) sprintf("interaction_term(iv = \"%s\", moderator = \"%s\", method = %s)", n$cv[[mods[[q]]$from]], n$cv[[mods[[q]]$moderator]], int_method[q]),
        ""
      )
    )
    sm <- vapply(if (repeated) union(ends, n$cname[hoc]) else ends, function(t) {
      extra <- int_l[vapply(mods, function(m) m$to == t, TRUE)]
      dims <- if (repeated && hoc[match(t, n$cname)]) comp_cv(match(t, n$cname)) else character(0) # (repeated indicators: the dimensions predict the construct)
      sprintf("paths(from = %s, to = \"%s\")", ps_q(c(from_to(t), dims, extra)), n$cv[[t]])
    }, "")
    body <- c(
      "suppressPackageStartupMessages(library(seminr))", ps_missing_code(req$missing),
      if (repeated) {
        c(
          "# Second-order constructs: the repeated indicators approach (Lohmoeller 1989; Becker, Klein & Wetzels 2012): the dimensions'",
          "# items measure the second-order construct too, and the dimensions predict it (seminr allows an item in several constructs)."
        )
      },
      "measurement <- constructs(", paste0("  ", mm, c(rep(",", length(mm) - 1), "")), ")",
      "structure <- relationships(", paste0("  ", sm, c(rep(",", length(sm) - 1), "")), ")",
      sprintf(
        "fit <- estimate_pls(data, measurement, structure, inner_weights = %s, maxIt = %d, stopCriterion = %d)",
        if (o$scheme == "factor") "path_factorial" else "path_weighting", as.integer(o$maxIter), as.integer(round(-log10(o$tolerance)))
      )
    )
  } else {
    stop("Unknown PLS package: ", pkg)
  }
  list(
    pkg = pkg,
    n = n,
    cv = cv,
    k0 = k0,
    type = type,
    mode = mode,
    mods = mods,
    int_l = int_l,
    inputs = inputs,
    body = body,
    o = o,
    hoc = hoc,
    comps = comps,
    two = two,
    repeated = repeated,
    hoc_approach = hoc_approach,
    ord = ord
  )
}

ps_pls <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_pls_build(req, allow_hoc = TRUE, allow_mi = TRUE, allow_ord = TRUE)
  if (export) {
    report <- if (b$pkg == "cSEM") c("summarize(fit)", "assess(fit)") else c("summary(fit)")
    title <- if (length(b$ord)) {
      sprintf("Ordinal PLS (OrdPLS%s, cSEM)", if (isTRUE(b$o$consistent)) "c" else "")
    } else if (isTRUE(b$o$consistent)) sprintf("Consistent PLS (%s)", b$pkg) else sprintf("PLS-SEM (%s)", b$pkg)
    if (identical(req$missing, "mi")) {
      # Multiple imputation: the model in every imputed data set; PLS Studio averages the estimates.
      ms <- ps_mi_settings(req)
      body <- c(
        "suppressPackageStartupMessages(library(mice))",
        sprintf(
          "imp <- mice(data, m = %d, seed = %d, printFlag = FALSE)  # multiple imputation (predictive mean matching)",
          ms$m,
          ms$seed
        ),
        "fits <- lapply(seq_len(imp$m), function(k) {", "  data <- complete(imp, k)", paste0("  ", b$body), "  fit", "})",
        "# Estimates averaged over the imputed data sets (Rubin's point estimate), e.g. the path coefficients:"
      )
      report <- if (b$pkg == "cSEM") "Reduce(`+`, lapply(fits, function(f) f$Estimates$Path_estimates)) / length(fits)" else "Reduce(`+`, lapply(fits, function(f) f$path_coef)) / length(fits)"
      return(ps_script(paste(title, "with multiple imputation"), c(b$pkg, "mice"), b$inputs, body, report))
    }
    return(ps_script(title, b$pkg, b$inputs, b$body, report))
  }
  if (identical(req$missing, "mi")) {
    return(ps_json(ps_pls_mi(req, b)))
  }
  ps_json(ps_htmt_notes(ps_pls_out(req, b, ps_run(b$body, b$inputs))))
}

#' The HTMT sign diagnostics of a PLS result as notes, once (ps_pls_out keeps them as
#' flags so that a multiply-imputed result reports the union over its imputations).
ps_htmt_notes <- function(res) {
  f <- res$htmtFlags
  res$htmtFlags <- NULL
  if (length(f$within)) {
    ps_note(sprintf("Some items of %s correlate negatively with the others: is an item reverse-coded? Recode it (Data tab) before interpreting loadings, reliability and HTMT.", paste(f$within, collapse = ", ")))
  }
  if (length(f$undefined)) {
    ps_note(sprintf("The HTMT of %s is not reported: it assumes same-sign item correlations, which a reverse-coded item breaks.", paste(f$undefined, collapse = "; ")))
  }
  if (length(f$mixed)) {
    ps_note(sprintf("The items of %s correlate with mixed signs: these constructs are nearly uncorrelated, so their HTMT is close to zero and their HTMT2, a geometric mean, is not defined (Roemer, Schuberth & Henseler, 2021).", paste(f$mixed, collapse = "; of ")))
  }
  res
}

#' The app's PLS result from one estimation (env: the script's environment).
ps_pls_out <- function(req, b, env) {
  fit <- env$fit
  n <- b$n
  cv <- b$cv
  k0 <- b$k0
  mods <- b$mods
  int_names <- vapply(mods, function(m) ps_int_name(m$from, m$moderator), "")
  constructs <- c(n$cname, int_names)
  all_l <- c(cv, b$int_l)
  K <- length(all_l)
  item_l <- unname(n$iv[n$all_inds])
  owner <- vapply(n$all_inds, function(i) which(vapply(n$inds, function(x) i %in% x, TRUE))[1], 1L)
  # M[rows, cols] by name; NA where a name is absent.
  mat <- function(M, rows, cols) {
    out <- matrix(NA_real_, length(rows), length(cols))
    for (i in seq_along(rows)) for (j in seq_along(cols)) if (rows[i] %in% rownames(M) && cols[j] %in% colnames(M)) out[i, j] <- M[rows[i], cols[j]]
    out
  }
  # Optional statistics: a failure is reported (Messages), and the statistic left empty.
  safe <- function(expr, what) ps_try(expr, what)
  nas <- function(k) rep(NA_real_, k)

  two <- isTRUE(b$two)
  if (b$pkg == "cSEM") {
    # Two-stage (second-order constructs): the first-order measurement from stage 1, the
    # rest from stage 2, whose constructs other than the second-order ones are named "X_temp".
    untemp <- function(M) {
      if (is.matrix(M)) {
        rownames(M) <- sub("_temp$", "", rownames(M))
        colnames(M) <- sub("_temp$", "", colnames(M))
      } else if (!is.null(names(M))) names(M) <- sub("_temp$", "", names(M))
      M
    }
    fit1 <- if (two) fit$First_stage else fit
    fit2 <- if (two) fit$Second_stage else fit
    e1 <- fit1$Estimates
    e <- if (two) lapply(fit2$Estimates, untemp) else fit$Estimates
    B <- t(mat(e$Path_estimates, all_l, all_l))
    B[is.na(B)] <- 0
    W <- e1$Weight_estimates
    L <- e1$Loading_estimates
    weights <- vapply(seq_along(item_l), function(i) W[cv[owner[i]], item_l[i]], 0)
    loadings <- vapply(seq_along(item_l), function(i) L[cv[owner[i]], item_l[i]], 0)
    r2 <- e$R2
    r2a <- e$R2adj
    scores <- if (two) {
      cbind(e1$Construct_scores, e$Construct_scores[, cv[b$hoc], drop = FALSE])[, cv, drop = FALSE]
    } else {
      e$Construct_scores[, cv, drop = FALSE]
    }
    for (q in seq_along(mods)) scores <- cbind(scores, scores[, b$cv[match(mods[[q]]$from, n$cname)]] * scores[, b$cv[match(mods[[q]]$moderator, n$cname)]])
    ccor <- if (two) stats::cor(scores) else e$Construct_VCV[cv, cv, drop = FALSE]
    if (length(mods)) {
      full <- stats::cor(scores)
      full[seq_len(k0), seq_len(k0)] <- ccor
      ccor <- full
    }
    linear <- !length(mods)
    a <- if (linear) {
      safe(
        cSEM::assess(fit1, .quality_criterion = c("reliability", "ave")),
        "Reliability and AVE (cSEM::assess; computed one by one instead)"
      )
    } else {
      NULL
    }
    # Second-order constructs: their reliability and AVE from stage 2 (components as indicators).
    a2 <- if (two && linear) {
      safe(
        cSEM::assess(fit2, .quality_criterion = c("reliability", "ave")),
        "Reliability and AVE of the second-order constructs (cSEM::assess)"
      )
    } else {
      NULL
    }
    pick <- function(v, v2 = NULL) {
      out <- if (is.null(v)) nas(k0) else unname(v[cv])
      if (two && !is.null(v2)) out[b$hoc] <- unname(v2[cv[b$hoc]])
      out
    }
    alpha <- pick(
      if (!is.null(a)) a$Reliability$Cronbachs_alpha else safe(cSEM::calculateRhoT(fit1, .only_common_factors = FALSE), "Cronbach's alpha (cSEM::calculateRhoT)"),
      a2$Reliability$Cronbachs_alpha
    )
    # (cSEM's composite reliability and overall fit need the model-implied correlations, which nonlinear models do not have.)
    rhoC <- pick(
      if (!is.null(a)) a$Reliability$Joereskogs_rho else if (!linear) NULL else safe(cSEM::calculateRhoC(fit1, .only_common_factors = FALSE), "Composite reliability (cSEM::calculateRhoC)"),
      a2$Reliability$Joereskogs_rho
    )
    rhoA <- pick(
      if (!is.null(a)) a$Reliability$`Dijkstra-Henselers_rho_A` else NULL,
      a2$Reliability$`Dijkstra-Henselers_rho_A`
    )
    # Without disattenuation cSEM treats every construct as a composite and reports
    # rho_A = 1 for all of them. seminr, SmartPLS and the built-in engine report
    # Dijkstra & Henseler's (2015) rho_A for Mode A blocks regardless (it depends on
    # the weights and the indicator correlations only), so it is computed here too.
    S0 <- fit1$Estimates$Indicator_VCV
    if (!isTRUE(b$o$consistent) && is.matrix(S0) && is.matrix(W)) {
      for (j in which(b$type[seq_len(k0)] == "factor" & b$mode[seq_len(k0)] == "A" & !b$hoc[seq_len(k0)])) {
        it <- intersect(unname(n$iv[n$inds[[j]]]), rownames(S0))
        if (length(it) < 2 || !(cv[j] %in% rownames(W))) next
        w <- W[cv[j], it]
        Sj <- S0[it, it]
        ww <- tcrossprod(w)
        rhoA[j] <- as.numeric(sum(w^2)^2 * (t(w) %*% (Sj - diag(diag(Sj))) %*% w) / (t(w) %*% (ww - diag(diag(ww))) %*% w))
      }
    }
    ave <- pick(
      if (!is.null(a)) a$AVE else safe(cSEM::calculateAVE(fit1, .only_common_factors = FALSE), "AVE (cSEM::calculateAVE)"),
      a2$AVE
    )
    # The HTMT assumes that the items of a construct correlate positively with each other
    # and that the items of two constructs correlate all with the same sign. cSEM warns
    # about violations without naming the constructs and, for mixed-sign blocks, returns
    # NaN or an arbitrary signed root; the checks below (on the common-factor blocks that
    # the HTMT covers) name the constructs and blank the undefined values.
    htmt <- function(type) {
      h <- safe(withCallingHandlers(cSEM::calculateHTMT(fit1, .type_htmt = type), warning = function(w) {
        if (grepl("all-positive or all-negative|show different signs|could not be computed|NaNs produced", conditionMessage(w))) {
          invokeRestart("muffleWarning")
        }
      }), if (type == "htmt2") "HTMT2 (cSEM::calculateHTMT)" else "HTMT (cSEM::calculateHTMT)") # (first-order constructs)
      if (is.list(h) && !is.null(h$htmts)) h <- h$htmts
      out <- matrix(NA_real_, K, K)
      if (is.matrix(h)) {
        m <- mat(h, all_l, all_l)
        out[lower.tri(out)] <- m[lower.tri(m)]
      }
      out
    }
    htmt1 <- htmt("htmt")
    htmt2 <- htmt("htmt2")
    htmt_flags <- NULL
    S <- fit1$Estimates$Indicator_VCV
    if (is.matrix(S)) {
      fac <- which(b$type[seq_len(k0)] == "factor" & !b$hoc[seq_len(k0)])
      blk <- lapply(n$inds, function(x) intersect(unname(n$iv[x]), rownames(S)))
      within <- integer(0)
      for (i in fac) {
        v <- S[blk[[i]], blk[[i]], drop = FALSE]
        if (any(v[upper.tri(v)] < 0)) within <- c(within, i)
      }
      mixed <- character(0)
      undefined <- character(0)
      for (i in fac) {
        for (j in fac[fac < i]) {
          v <- S[blk[[i]], blk[[j]]]
          if (!(any(v > 0) && any(v < 0))) next
          htmt2[i, j] <- NA_real_
          if (i %in% within || j %in% within) {
            undefined <- c(undefined, sprintf("%s \u2013 %s", n$cname[j], n$cname[i]))
            htmt1[i, j] <- NA_real_
          } else {
            mixed <- c(mixed, sprintf("%s and %s", n$cname[j], n$cname[i]))
          }
        }
      }
      htmt_flags <- list(within = n$cname[within], undefined = undefined, mixed = mixed)
    }
    fitm <- function(sat) {
      # (Not reported for two-stage models, cSEM's discrepancies refer to one stage only, nor with repeated
      # indicators: the copied indicators make the model-implied correlation matrix singular.)
      g <- function(f, ...) {
        v <- if (two || !linear || isTRUE(b$repeated)) NULL else safe(f(fit, .saturated = sat, ...), sprintf("Overall fit (%s model, cSEM)", if (sat) "saturated" else "estimated"))
        if (is.null(v)) NA_real_ else as.numeric(v)
      }
      list(srmr = g(cSEM::calculateSRMR), dULS = g(cSEM::calculateDL), dG = g(cSEM::calculateDG) * log(10)^2)
    }
    f2 <- untemp(safe(cSEM::calculatef2(fit2), "Effect sizes f² (cSEM::calculatef2)"))
    fsq <- if (is.matrix(f2)) t(mat(f2, all_l, all_l)) else matrix(NA_real_, K, K)
    vif <- if (is.matrix(e$VIF)) t(mat(e$VIF, all_l, all_l)) else matrix(NA_real_, K, K)
    vb <- safe(cSEM::calculateVIFModeB(fit1), "Indicator VIFs (cSEM::calculateVIFModeB)")
    # (cSEM returns a construct x indicator matrix, zero off the block; older versions a list per construct.)
    vif_outer <- vapply(seq_along(item_l), function(i) {
      k <- cv[owner[i]]
      it <- item_l[i]
      v <- if (is.matrix(vb) && k %in% rownames(vb) && it %in% colnames(vb)) {
        vb[k, it]
      } else if (is.list(vb) && k %in% names(vb) && it %in% names(vb[[k]])) vb[[k]][[it]] else NA_real_
      if (is.finite(v) && v > 0) unname(v) else NA_real_
    }, 0)
    info <- fit1$Information$Weight_info
    iterations <- info$Number_iterations
    converged <- isTRUE(info$Convergence_status) && (!two || isTRUE(fit2$Information$Weight_info$Convergence_status))
    version <- as.character(utils::packageVersion("cSEM"))
  } else {
    s <- summary(fit)
    P <- fit$path_coef
    B <- mat(P, all_l, all_l)
    B[is.na(B)] <- 0
    weights <- vapply(seq_along(item_l), function(i) fit$outer_weights[item_l[i], cv[owner[i]]], 0)
    loadings <- vapply(seq_along(item_l), function(i) fit$outer_loadings[item_l[i], cv[owner[i]]], 0)
    rs <- fit$rSquared # one column per endogenous construct; keep names when there is only one
    r2 <- setNames(as.numeric(rs["Rsq", ]), colnames(rs))
    r2a <- setNames(as.numeric(rs["AdjRsq", ]), colnames(rs))
    # (Second-order models: the dimensions' scores are the first stage's.)
    sc <- fit$construct_scores
    if (two) {
      sc <- cbind(
        sc,
        fit$first_stage_model$construct_scores[, setdiff(colnames(fit$first_stage_model$construct_scores), colnames(sc)), drop = FALSE]
      )
    }
    scores <- sc[, all_l, drop = FALSE]
    ccor <- stats::cor(scores)
    rel <- s$reliability
    alpha <- unname(rel[cv, "alpha"])
    rhoC <- unname(rel[cv, "rhoC"])
    rhoA <- unname(rel[cv, "rhoA"])
    ave <- unname(rel[cv, "AVE"])
    htmt <- function(type) {
      out <- matrix(NA_real_, K, K)
      if (type == "htmt" && is.matrix(s$validity$htmt)) {
        m <- mat(unclass(s$validity$htmt), all_l, all_l)
        lo <- lower.tri(out)
        out[lo] <- ifelse(is.na(m[lo]), t(m)[lo], m[lo])
      }
      out
    }
    htmt1 <- htmt("htmt")
    htmt2 <- htmt("htmt2")
    htmt_flags <- NULL
    fitm <- function(sat) list(srmr = NA_real_, dULS = NA_real_, dG = NA_real_)
    fsq <- mat(unclass(s$fSquare), all_l, all_l)
    vif <- matrix(NA_real_, K, K)
    for (t in names(s$vif_antecedents)) {
      v <- s$vif_antecedents[[t]]
      for (f in names(v)) if (f %in% all_l && t %in% all_l) vif[match(f, all_l), match(t, all_l)] <- v[[f]]
    }
    vif_outer <- vapply(seq_along(item_l), function(i) {
      v <- s$validity$vif_items[[cv[owner[i]]]]
      if (is.null(v) || !item_l[i] %in% names(v)) NA_real_ else unname(v[[item_l[i]]])
    }, 0)
    iterations <- fit$iterations
    converged <- fit$iterations < b$o$maxIter
    version <- as.character(utils::packageVersion("seminr"))
  }

  has <- matrix(FALSE, K, K)
  for (p in req$model$paths) has[match(p$from, constructs), match(p$to, constructs)] <- TRUE
  # Repeated indicators: the dimensions' paths to their second-order construct are part of the model.
  if (isTRUE(b$repeated)) {
    for (j in which(b$hoc)) for (k in match(b$comps[[j]], n$cname)) has[k, j] <- TRUE
  }
  for (q in seq_along(mods)) has[k0 + q, match(mods[[q]]$to, constructs)] <- TRUE
  total <- solve(diag(K) - B) - diag(K)
  endo <- vapply(seq_len(K), function(j) any(has[, j]), TRUE)
  r2v <- lapply(seq_len(K), function(j) if (endo[j] && all_l[j] %in% names(r2)) unname(r2[[all_l[j]]]) else NULL)
  r2av <- lapply(seq_len(K), function(j) if (endo[j] && all_l[j] %in% names(r2a)) unname(r2a[[all_l[j]]]) else NULL)
  fsq[!has] <- NA
  vif[!has] <- NA
  # Interaction terms: reliabilities are not defined.
  q4 <- function(v) c(v, nas(length(mods)))

  list(
    n = nrow(env$data), iterations = iterations, converged = converged,
    constructs = constructs,
    indicators = lapply(seq_along(item_l), function(i) list(name = n$all_inds[i], construct = owner[i] - 1L)),
    weights = weights, loadings = loadings, pathCoef = B, hasPath = has, totalEffects = total, indirectEffects = total - B,
    rSquared = r2v, adjRSquared = r2av, constructCor = unname(ccor),
    # Redundancy analysis (cSEM): each Mode B composite correlated with a Mode A version of the same indicators.
    # Second-order constructs: loadings and weights of their components (cSEM's stage 2).
    higherOrder = if (two) {
      unlist(lapply(which(b$hoc), function(j) {
        lapply(b$comps[[j]], function(k) {
          ck <- cv[match(k, n$cname)]
          if (b$pkg == "cSEM") {
            list(
              construct = j - 1L,
              component = match(k, n$cname) - 1L,
              loading = e$Loading_estimates[cv[j], ck],
              weight = e$Weight_estimates[cv[j], ck]
            )
          } # seminr: the dimensions are the second-order construct's items.
          else {
            list(
              construct = j - 1L,
              component = match(k, n$cname) - 1L,
              loading = fit$outer_loadings[ck, cv[j]],
              weight = fit$outer_weights[ck, cv[j]]
            )
          }
        })
      }), recursive = FALSE)
    } # Repeated indicators: a dimension's loading is its correlation with the second-order construct's scores, its weight the path coefficient.
    else if (isTRUE(b$repeated)) {
      unlist(lapply(which(b$hoc), function(j) {
        lapply(match(b$comps[[j]], n$cname), function(k) {
          list(
            construct = j - 1L,
            component = k - 1L,
            loading = unname(stats::cor(scores[, k], scores[, j])),
            weight = B[k, j]
          )
        })
      }), recursive = FALSE)
    } else {
      NULL
    },
    redundancy = if (b$pkg == "cSEM" && !two) {
      ra <- safe(cSEM::doRedundancyAnalysis(fit), "Redundancy analysis (cSEM::doRedundancyAnalysis)")
      if (is.numeric(ra) && !is.null(names(ra)) && !anyNA(ra)) as.list(setNames(unname(ra), n$cname[match(names(ra), cv)])) else NULL
    } else {
      NULL
    },
    quality = lapply(
      seq_len(K),
      function(j) list(alpha = q4(alpha)[j], rhoC = q4(rhoC)[j], rhoA = q4(rhoA)[j], ave = q4(ave)[j])
    ),
    htmt = htmt1, htmt2 = htmt2, htmtFlags = htmt_flags,
    fit = list(estimated = fitm(FALSE), saturated = fitm(TRUE)),
    consistent = isTRUE(b$o$consistent), types = c(b$type, rep("composite", length(mods))),
    moderations = lapply(seq_along(mods), function(q) {
      list(
        from = mods[[q]]$from, moderator = mods[[q]]$moderator, to = mods[[q]]$to, construct = k0 + q - 1L,
        method = if (b$pkg == "seminr") mods[[q]]$method %||% "two_stage" else "two_stage"
      )
    }),
    # How the constructs were weighted (PLS-PM with each construct's mode, or GSCA / PCA / sum scores for all) and second-order constructs estimated.
    approach = b$o$approach %||% "PLS-PM", hocApproach = if (any(b$hoc)) b$hoc_approach else NULL,
    # Ordinal indicators (OrdPLS/OrdPLSc: polychoric and polyserial correlations), by the user's names.
    ordinal = if (length(b$ord)) as.list(b$ord) else NULL,
    fSquare = fsq, vifInner = vif, vifOuter = vif_outer,
    scores = lapply(seq_len(K), function(j) unname(scores[, j])),
    # (cSEM's two-stage approach always corrects a second-order common factor in stage 2 and says so; the script explains it.)
    droppedRows = nrow(b$inputs$data) - nrow(env$data), warnings = ps_quiet_2ndorder(env$.warnings),
    engine = list(package = b$pkg, version = version)
  )
}

#' Multiple imputation: the imputed data sets (mice, predictive mean matching).
ps_impute <- function(req, inputs) {
  ms <- ps_mi_settings(req)
  env <- ps_run(c(
    "suppressPackageStartupMessages(library(mice))",
    sprintf("imp <- mice(data, m = %d, seed = %d, printFlag = FALSE)", ms$m, ms$seed)
  ), inputs)
  env$imp
}

#' Average results over imputed data sets, element by element (Rubin's point estimate): numbers and
#' matrices averaged, logicals all true, anything else as in the first.
ps_avg <- function(xs) {
  x1 <- xs[[1]]
  if (is.list(x1) && !is.data.frame(x1)) {
    out <- lapply(seq_along(x1), function(i) ps_avg(lapply(xs, function(x) x[[i]])))
    names(out) <- names(x1)
    return(out)
  }
  if (is.logical(x1)) {
    return(all(unlist(xs)))
  }
  if (is.numeric(x1) && all(vapply(xs, function(x) is.numeric(x) && length(x) == length(x1), TRUE))) {
    return(Reduce(`+`, xs) / length(xs))
  }
  x1
}

#' PLS with multiple imputation: the model in every imputed data set, the estimates averaged.
ps_pls_mi <- function(req, b) {
  imp <- ps_impute(req, b$inputs)
  outs <- lapply(seq_len(imp$m), function(k) ps_pls_out(req, b, ps_run(b$body, list(data = mice::complete(imp, k)))))
  res <- ps_avg(outs)
  res$n <- outs[[1]]$n
  res$droppedRows <- 0L
  res$warnings <- unique(unlist(lapply(outs, function(o) unlist(o$warnings))))
  res$imputations <- imp$m
  # (the sign diagnostics over all imputations, reported once; a pair undefined in any is NA in the average)
  flags <- lapply(outs, `[[`, "htmtFlags")
  res$htmtFlags <- list(
    within = unique(unlist(lapply(flags, `[[`, "within"))),
    undefined = unique(unlist(lapply(flags, `[[`, "undefined"))),
    mixed = unique(unlist(lapply(flags, `[[`, "mixed")))
  )
  ps_htmt_notes(res)
}
