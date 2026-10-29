# Conditional process analysis (Hayes's PROCESS models) with manymome:
# one OLS regression per outcome (lm), manymome::lm2list to join them into a
# path model, manymome::do_boot for percentile bootstrap confidence intervals
# of indirect effects, and manymome::cond_indirect for (conditional) indirect
# effects at values of the moderators. Indices of (partial / moderated)
# moderated mediation are differences of conditional indirect effects, with
# confidence intervals from the same bootstrap samples.
#
# Latent variables: when scales are modelled as latent variables, the
# equations are estimated together by structural-after-measurement
# (lavaan::sam, two-step standard errors; Rosseel & Loh, 2024; Rosseel et al.,
# 2025), and confidence intervals come from manymome's Monte Carlo draws
# (do_mc): SAM's own bootstrap is too slow to run in the browser.
#
# The request carries the equations and indirect paths (built by
# src/process/templates.ts), so this file only runs them.

#' Script lines: the probing values of a moderator, as PROCESS chooses them.
ps_cpa_probe_code <- function(how) c(
  "# Values of each moderator at which effects are probed: the two values of a dichotomous",
  if (how == "meansd") "# moderator, otherwise the mean and one standard deviation below and above it."
  else "# moderator, otherwise its 16th, 50th and 84th percentiles (as PROCESS).",
  "probe <- function(v) {",
  "  u <- sort(unique(v))",
  "  if (length(u) == 2) return(u)",
  if (how == "meansd") "  mean(v) + c(-1, 0, 1) * sd(v)" else "  unname(quantile(v, c(0.16, 0.5, 0.84), type = 6))",
  "}")

#' Script lines: helpers for the latent-variable (SAM) model, with Monte Carlo intervals.
ps_cpa_sam_helper_code <- function() c(
  "# Conditional effect of `from` on `to` at moderator values `at`, with its Monte Carlo",
  "# standard error, p value and confidence interval (manymome).",
  "slope <- function(from, to, at = numeric(0)) {",
  "  e <- cond_indirect(x = from, y = to, fit = fit, wvalues = if (length(at)) at else NULL,",
  "    mc_ci = TRUE, mc_out = mc_out, level = level)",
  "  ci <- confint(e, level = level)",
  "  c(est = unname(e$indirect), se = unname(e$mc_se), t = NA, p = unname(e$mc_p), lo = unname(ci[1]), hi = unname(ci[2]))",
  "}",
  "# (Conditional) indirect effect along `path` (x, mediators..., y), with Monte Carlo draws.",
  "ind <- function(path, at = NULL) {",
  "  k <- length(path)",
  "  cond_indirect(x = path[1], y = path[k], m = if (k > 2) path[2:(k - 1)] else NULL, fit = fit,",
  "    wvalues = at, mc_ci = TRUE, mc_out = mc_out, level = level)",
  "}",
  ps_cpa_combine_code("mc_indirect", "Monte Carlo draws"))

#' Script lines: a linear combination of effects with a percentile interval from the same draws.
ps_cpa_combine_code <- function(field, what) c(
  sprintf("# A linear combination of indirect effects (an index), with the percentile interval from the same %s.", what),
  "combine <- function(effects, weights) {",
  "  est <- sum(weights * vapply(effects, function(e) e$indirect, 0))",
  sprintf("  draws <- drop(vapply(effects, function(e) e$%s, numeric(length(effects[[1]]$%s))) %%*%% weights)", field, field),
  "  ci <- unname(quantile(draws, c((1 - level) / 2, 1 - (1 - level) / 2), type = 6))",
  "  c(est = est, se = sd(draws), lo = ci[1], hi = ci[2])",
  "}")

#' Script lines: helpers that turn the fitted equations into effects.
ps_cpa_helper_code <- function(hc) c(
  if (hc == "none") "# Covariance matrix of the coefficients: OLS."
  else sprintf("# Covariance matrix of the coefficients: heteroskedasticity-consistent (sandwich::vcovHC, type %s).", hc),
  if (hc == "none") "vc <- function(fit) vcov(fit)" else sprintf("vc <- function(fit) sandwich::vcovHC(fit, type = \"%s\")", hc),
  "# Conditional effect of `from` on `to` at moderator values `at` (a named vector), with its",
  "# standard error, t test and confidence interval: the sum of the coefficients of every term of",
  "# `to`'s equation that contains `from`, each times the product of the other variables in the term.",
  "slope <- function(from, to, at = numeric(0)) {",
  "  fit <- eqs[[to]]",
  "  b <- coef(fit); V <- vc(fit)",
  "  parts <- strsplit(names(b), \":\", fixed = TRUE)",
  "  g <- vapply(parts, function(p) if (from %in% p) prod(at[setdiff(p, from)]) else 0, 0)",
  "  est <- sum(g * b); se <- sqrt(drop(t(g) %*% V %*% g)); df <- df.residual(fit)",
  "  q <- qt(1 - (1 - level) / 2, df)",
  "  c(est = est, se = se, t = est / se, p = 2 * pt(-abs(est / se), df), lo = est - q * se, hi = est + q * se)",
  "}",
  "# (Conditional) indirect effect along `path` (x, mediators..., y), bootstrapped by manymome.",
  "ind <- function(path, at = NULL) {",
  "  k <- length(path)",
  "  cond_indirect(x = path[1], y = path[k], m = if (k > 2) path[2:(k - 1)] else NULL, fit = fits,",
  "    wvalues = at, boot_ci = TRUE, boot_out = boot_out, level = level)",
  "}",
  ps_cpa_combine_code("boot_indirect", "bootstrap samples"))

ps_cpa_build <- function(req) {
  vars <- req$variables
  n <- ps_names(vars)
  # A single-item variable named like its column is that column; others are scores.
  rn <- vapply(seq_along(vars), function(j) {
    it <- n$inds[[j]]
    if (length(it) == 1 && identical(it, n$cname[j])) unname(n$iv[[it]]) else unname(n$cv[[j]])
  }, "")
  names(rn) <- n$cname
  id <- function(x) unname(rn[unlist(x)])
  inputs <- list(data = ps_frame(req, n))
  latent <- id(req$latent)
  sam <- length(latent) > 0
  scoring <- unlist(lapply(seq_along(vars), function(j) {
    it <- unname(n$iv[n$inds[[j]]])
    if (rn[[j]] %in% latent) NULL
    else if (length(it) == 1 && it == rn[[j]]) NULL
    else if (length(it) == 1) sprintf("data$%s <- data$%s", rn[[j]], it)
    else sprintf("data$%s <- rowMeans(data[, %s])", rn[[j]], ps_q(it))
  }))
  term <- function(t) paste(id(t$vars), collapse = ":")
  outcomes <- vapply(req$equations, function(e) id(e$outcome), "")
  fit_lines <- vapply(req$equations, function(e) sprintf("fit_%s <- lm(%s ~ %s, data = data)", id(e$outcome), id(e$outcome),
    paste(vapply(e$terms, term, ""), collapse = " + ")), "")
  mods <- id(req$moderators)
  B <- as.integer(req$boot$samples %||% 0)
  seed <- as.integer(req$boot$seed %||% 1)
  has_ind <- length(req$indirect) > 0
  if (sam) {
    measurement <- unlist(lapply(seq_along(vars), function(j) if (rn[[j]] %in% latent)
      sprintf("%s =~ %s", rn[[j]], paste(unname(n$iv[n$inds[[j]]]), collapse = " + "))))
    structural <- vapply(req$equations, function(e) sprintf("%s ~ %s", id(e$outcome), paste(vapply(e$terms, term, ""), collapse = " + ")), "")
    observed_mods <- setdiff(mods, latent)
    body <- c("suppressPackageStartupMessages({ library(manymome); library(lavaan) })",
      ps_missing_code(req$missing),
      if (length(scoring)) c("# Scale scores: the mean of each scale's items", scoring),
      sprintf("level <- %s", format(req$confidence %||% 0.95)),
      "# Latent variables (measurement) and one equation per outcome (structure)",
      "model <- '", paste0("  ", c(measurement, structural)), "'",
      "# Structural-after-measurement estimation with two-step standard errors",
      "fit <- sam(model, data = data, se = \"twostep\")",
      "# Monte Carlo draws of the parameters for the confidence intervals of all effects",
      sprintf("mc_out <- do_mc(fit, R = %d, seed = %d, progress = FALSE)", B, seed),
      if (length(observed_mods)) ps_cpa_probe_code(req$probe %||% "percentiles"),
      if (length(mods)) c(
        if (length(intersect(mods, latent))) "# A latent moderator is probed at its mean and one SD below and above it (manymome::mod_levels).",
        sprintf("probe_values <- list(%s)", paste(sprintf("%s = %s", mods,
          ifelse(mods %in% latent, sprintf("rev(mod_levels(\"%s\", fit = fit)[[1]])", mods), sprintf("probe(data$%s)", mods))), collapse = ", "))),
      ps_cpa_sam_helper_code())
    return(list(body = body, inputs = inputs, id = id, rn = rn, mods = mods, has_ind = has_ind, sam = TRUE, latent = latent))
  }
  body <- c("suppressPackageStartupMessages(library(manymome))",
    ps_missing_code(req$missing),
    if (length(scoring)) c("# Scale scores: the mean of each scale's items", scoring),
    sprintf("level <- %s", format(req$confidence %||% 0.95)),
    "# One OLS regression per outcome",
    fit_lines,
    sprintf("eqs <- list(%s)", paste(sprintf("%s = fit_%s", outcomes, outcomes), collapse = ", ")),
    sprintf("fits <- lm2list(%s)", paste0("fit_", outcomes, collapse = ", ")),
    if (has_ind) c("# Percentile bootstrap of the indirect effects (rows resampled, every equation refitted)",
      sprintf("boot_out <- do_boot(fits, R = %d, seed = %d, parallel = FALSE, progress = FALSE)", B, as.integer(req$boot$seed %||% 1))),
    if (length(mods)) c(ps_cpa_probe_code(req$probe %||% "percentiles"),
      sprintf("probe_values <- list(%s)", paste(sprintf("%s = probe(data$%s)", mods, mods), collapse = ", "))),
    ps_cpa_helper_code(req$hc %||% "none"))
  list(body = body, inputs = inputs, id = id, rn = rn, mods = mods, has_ind = has_ind, sam = FALSE, latent = character(0))
}

#' Rows over every combination of the probe values of `mods` (first moderator varying slowest, as PROCESS).
ps_cpa_grid <- function(mods, probe_values) {
  if (!length(mods)) return(list(numeric(0)))
  g <- expand.grid(rev(probe_values[mods]), KEEP.OUT.ATTRS = FALSE)[, rev(seq_along(mods)), drop = FALSE]
  lapply(seq_len(nrow(g)), function(i) setNames(unlist(g[i, ]), mods))
}

ps_cpa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cpa_build(req)
  id <- b$id
  back <- setNames(names(b$rn), unname(b$rn))
  nm <- function(x) unname(back[x])
  title <- sprintf("Conditional process analysis%s (%s)", if (is.null(req$model)) "" else sprintf(", PROCESS model %d", as.integer(req$model)),
    if (b$sam) "lavaan::sam and manymome" else "manymome")
  fit_name <- if (b$sam) "fit" else "fits"
  ci_args <- if (b$sam) "mc_ci = TRUE, mc_out = mc_out" else "boot_ci = TRUE, boot_out = boot_out"
  if (export) {
    levels_code <- function(ms) {
      one <- sprintf("mod_levels(\"%s\", fit = %s, values = probe_values$%s)", ms, fit_name, ms)
      if (length(one) == 1) one else sprintf("merge_mod_levels(%s)", paste(one, collapse = ", "))
    }
    report <- c(if (b$sam) "summary(fit)" else "lapply(fits, summary)",
      if (length(b$mods)) "probe_values",
      unlist(lapply(req$indirect, function(p) {
        path <- id(p$vars); k <- length(path)
        m <- if (k > 2) ps_q(path[2:(k - 1)]) else "NULL"
        if (length(p$moderators)) sprintf("cond_indirect_effects(wlevels = %s, x = \"%s\", y = \"%s\", m = %s, fit = %s, %s, level = level)",
          levels_code(id(p$moderators)), path[1], path[k], m, fit_name, ci_args)
        else sprintf("ind(%s)", ps_q(path))
      })))
    return(paste(ps_script(title, if (b$sam) c("manymome", "lavaan") else "manymome", b$inputs, b$body, report), collapse = "\n"))
  }
  env <- ps_run(b$body, b$inputs)
  pv <- if (length(b$mods)) env$probe_values else list()
  at_list <- function(at) as.list(setNames(unname(at), nm(names(at))))

  level <- req$confidence %||% 0.95
  equations <- if (b$sam) {
    pe <- lavaan::parameterEstimates(env$fit, level = level)
    r2 <- lavaan::lavInspect(env$fit, "r2")
    lapply(req$equations, function(e) {
      o <- id(e$outcome); rows <- pe[pe$op == "~" & pe$lhs == o, ]
      list(outcome = e$outcome, n = nrow(env$data), r2 = unname(r2[o]), mse = NULL, f = NULL, df1 = NULL, df2 = NULL, p = NULL, interactions = list(),
        coefficients = lapply(seq_len(nrow(rows)), function(i) list(term = nm(strsplit(rows$rhs[i], ":", fixed = TRUE)[[1]]),
          est = rows$est[i], se = rows$se[i], t = rows$z[i], p = rows$pvalue[i], lo = rows$ci.lower[i], hi = rows$ci.upper[i])))
    })
  } else lapply(req$equations, function(e) {
    f <- env$eqs[[id(e$outcome)]]
    s <- summary(f)
    b <- coef(f); V <- env$vc(f); se <- sqrt(diag(V)); df <- df.residual(f)
    tv <- b / se; q <- qt(1 - (1 - level) / 2, df)
    # F test of all predictors: the usual one, or the Wald test with the robust covariance matrix (as PROCESS).
    k <- names(b) != "(Intercept)"
    fval <- drop(t(b[k]) %*% solve(V[k, k, drop = FALSE]) %*% b[k]) / sum(k)
    # Highest-order interactions of this outcome: R² change on dropping the product(s), Wald F with V.
    labels <- attr(terms(f), "term.labels")
    find <- function(vars) names(b)[vapply(strsplit(names(b), ":", fixed = TRUE), function(p) setequal(p, id(vars)), TRUE)]
    test <- function(focal, vs) {
      nms <- vapply(vs, function(v) find(v$vars), "")
      keep <- labels[!vapply(strsplit(labels, ":", fixed = TRUE), function(p) any(vapply(vs, function(v) setequal(p, id(v$vars)), TRUE)), TRUE)]
      reduced <- lm(reformulate(keep, response = id(e$outcome)), data = f$model)
      fq <- drop(t(b[nms]) %*% solve(V[nms, nms, drop = FALSE]) %*% b[nms]) / length(nms)
      list(focal = focal, terms = lapply(vs, function(v) nm(id(v$vars))), r2change = s$r.squared - summary(reduced)$r.squared,
        f = fq, df1 = length(nms), df2 = df, p = pf(fq, length(nms), df, lower.tail = FALSE))
    }
    tests <- unlist(lapply(Filter(function(i) id(i$outcome) == id(e$outcome), req$interactions %||% list()), function(i) {
      rows <- lapply(i$terms, function(v) test(i$focal, list(v)))
      if (length(i$terms) > 1) rows <- c(rows, list(test(i$focal, i$terms)))
      rows
    }), recursive = FALSE)
    list(outcome = e$outcome, n = length(f$residuals), r2 = s$r.squared, mse = s$sigma^2,
      f = fval, df1 = sum(k), df2 = df, p = pf(fval, sum(k), df, lower.tail = FALSE), interactions = tests %||% list(),
      coefficients = lapply(seq_along(b), function(i) list(
        term = if (names(b)[i] == "(Intercept)") list() else nm(strsplit(names(b)[i], ":", fixed = TRUE)[[1]]),
        est = unname(b[i]), se = unname(se[i]), t = unname(tv[i]), p = unname(2 * pt(-abs(tv[i]), df)),
        lo = unname(b[i] - q * se[i]), hi = unname(b[i] + q * se[i]))))
  })

  slope_row <- function(from, to, at) { s <- env$slope(from, to, at); c(list(at = at_list(at)), as.list(s)) }
  direct <- if (!is.null(req$direct)) {
    dm <- id(req$direct$moderators)
    list(moderators = req$direct$moderators %||% list(),
      rows = lapply(ps_cpa_grid(dm, pv), function(at) slope_row(id(req$x), id(req$y), at)))
  }

  # Johnson-Neyman: values of the single moderator of an edge where the conditional effect is just significant.
  # (Inside, `b` is the coefficient vector.)
  is_sam <- b$sam; b_latent <- b$latent
  jn <- lapply(req$jn %||% list(), function(j) {
    from <- id(j$from); to <- id(j$to); w <- id(j$moderator)
    if (is_sam) {
      # lavaan names regressions "to~from"; z critical value.
      cf <- coef(env$fit); V0 <- vcov(env$fit)
      keep <- grepl(paste0("^", to, "~"), names(cf)) & !grepl("~~", names(cf), fixed = TRUE)
      b <- setNames(cf[keep], sub(paste0("^", to, "~"), "", names(cf)[keep]))
      V <- V0[names(cf)[keep], names(cf)[keep], drop = FALSE]; dimnames(V) <- list(names(b), names(b))
      q <- qnorm(1 - (1 - level) / 2)
    } else {
      f <- env$eqs[[to]]; b <- coef(f); V <- env$vc(f)
      q <- qt(1 - (1 - level) / 2, df.residual(f))
    }
    xw <- names(b)[vapply(strsplit(names(b), ":", fixed = TRUE), function(p) setequal(p, c(from, w)), TRUE)]
    # (b1 + b3 w)^2 = q^2 (V11 + 2 w V13 + w^2 V33): a quadratic in w.
    A <- b[xw]^2 - q^2 * V[xw, xw]; B2 <- 2 * (b[from] * b[xw] - q^2 * V[from, xw]); C <- b[from]^2 - q^2 * V[from, from]
    disc <- B2^2 - 4 * A * C
    roots <- if (disc < 0 || A == 0) numeric(0) else sort((-B2 + c(-1, 1) * sqrt(disc)) / (2 * A))
    if (w %in% b_latent) {
      # A latent moderator has no observed values: its range is taken as the mean ± 3 SD.
      sdw <- diff(range(pv[[w]])) / 2
      roots <- roots[abs(roots) <= 3 * sdw]
      return(list(from = j$from, to = j$to, moderator = j$moderator, range = c(-3 * sdw, 3 * sdw), mean = 0, sd = sdw, latent = TRUE,
        b = unname(b[from]), bint = unname(b[xw]), v = unname(c(V[from, from], V[from, xw], V[xw, xw])), crit = unname(q),
        bounds = lapply(roots, function(r) list(value = unname(r), below = NULL, above = NULL))))
    }
    wv <- env$data[[w]]
    roots <- roots[roots >= min(wv) & roots <= max(wv)]
    list(from = j$from, to = j$to, moderator = j$moderator, range = c(min(wv), max(wv)), mean = mean(wv), sd = sd(wv),
      b = unname(b[from]), bint = unname(b[xw]), v = unname(c(V[from, from], V[from, xw], V[xw, xw])), crit = unname(q),
      bounds = lapply(roots, function(r) list(value = unname(r), below = 100 * mean(wv < r), above = 100 * mean(wv > r))))
  })

  indirect <- list(); indices <- list(); total <- NULL
  draws_of <- function(e) if (b$sam) e$mc_indirect else e$boot_indirect
  if (b$has_ind) {
    eff_row <- function(e) {
      ci <- confint(e, level = req$confidence %||% 0.95)
      list(est = unname(e$indirect), se = sd(draws_of(e)), lo = unname(ci[1]), hi = unname(ci[2]))
    }
    unmoderated <- list()
    for (p in req$indirect) {
      path <- id(p$vars); pm <- id(p$moderators)
      rows <- lapply(ps_cpa_grid(pm, pv), function(at) {
        e <- env$ind(path, if (length(at)) at else NULL)
        if (!length(pm)) unmoderated[[length(unmoderated) + 1]] <<- e
        c(list(at = at_list(at)), eff_row(e))
      })
      indirect[[length(indirect) + 1]] <- list(path = p$vars, moderators = p$moderators %||% list(), rows = rows)
      ix <- p$index
      if (!is.null(ix)) {
        at <- function(...) { v <- c(...); v[pm] }
        ie <- function(v) env$ind(path, v)
        put <- function(kind, r, extra = list()) indices[[length(indices) + 1]] <<- c(list(kind = kind, path = p$vars), extra, as.list(r))
        w <- id(ix$w)
        if (ix$kind == "mm") {
          put("mm", env$combine(list(ie(setNames(1, w)), ie(setNames(0, w))), c(1, -1)), list(moderator = ix$w))
        } else {
          z <- id(ix$z)
          pt <- function(a, c) setNames(c(a, c), c(w, z))
          if (ix$kind == "partial") {
            put("partial", env$combine(list(ie(pt(1, 0)), ie(pt(0, 0))), c(1, -1)), list(moderator = ix$w))
            put("partial", env$combine(list(ie(pt(0, 1)), ie(pt(0, 0))), c(1, -1)), list(moderator = ix$z))
          } else {
            put("mmm", env$combine(list(ie(pt(1, 1)), ie(pt(1, 0)), ie(pt(0, 1)), ie(pt(0, 0))), c(1, -1, -1, 1)))
            for (zv in pv[[z]]) put("cmm", env$combine(list(ie(pt(1, zv)), ie(pt(0, zv))), c(1, -1)),
              list(moderator = ix$w, at = setNames(list(zv), ix$z)))
          }
        }
      }
    }
    if (length(unmoderated) > 1 && length(unmoderated) == length(req$indirect))
      total <- as.list(env$combine(unmoderated, rep(1, length(unmoderated))))
  }

  ps_json(list(n = nrow(env$data), equations = equations,
    moderators = lapply(b$mods, function(m) list(name = nm(m), values = pv[[m]])),
    direct = direct, indirect = indirect, total = total, indices = indices, jn = jn,
    boot = list(samples = if (b$has_ind || b$sam) as.integer(req$boot$samples) else 0L),
    inference = if (b$sam) "montecarlo" else "bootstrap", hc = if (b$sam) "none" else req$hc %||% "none", latent = lapply(b$latent, nm),
    warnings = env$.warnings,
    engine = list(package = if (b$sam) "lavaan::sam + manymome" else "manymome",
      version = if (b$sam) sprintf("%s / %s", utils::packageVersion("lavaan"), utils::packageVersion("manymome")) else as.character(utils::packageVersion("manymome")))))
}
