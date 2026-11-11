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
ps_cpa_probe_code <- function(how) {
  c(
    "# Values of each moderator at which effects are probed: the two values of a dichotomous",
    if (how == "meansd") {
      "# moderator, otherwise the mean and one standard deviation below and above it."
    } else {
      "# moderator, otherwise its 16th, 50th and 84th percentiles (as PROCESS)."
    },
    "probe <- function(v) {",
    "  u <- sort(unique(v))",
    "  if (length(u) == 2) return(u)",
    if (how == "meansd") "  mean(v) + c(-1, 0, 1) * sd(v)" else "  unname(quantile(v, c(0.16, 0.5, 0.84), type = 6))",
    "}"
  )
}

#' Script lines: helpers for the latent-variable (SAM) model, with Monte Carlo intervals.
ps_cpa_sam_helper_code <- function() {
  c(
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
    ps_cpa_combine_code("mc_indirect", "Monte Carlo draws")
  )
}

#' Script lines: a linear combination of effects with a percentile interval from the same draws.
ps_cpa_combine_code <- function(field, what) {
  c(
    sprintf(
      "# A linear combination of indirect effects (an index), with the percentile interval from the same %s.",
      what
    ),
    "combine <- function(effects, weights) {",
    "  est <- sum(weights * vapply(effects, function(e) e$indirect, 0))",
    sprintf(
      "  draws <- drop(vapply(effects, function(e) e$%s, numeric(length(effects[[1]]$%s))) %%*%% weights)",
      field,
      field
    ),
    "  # (the percentile interval as manymome computes it for its effects: boot::boot.ci, type \"perc\")",
    "  ci <- unname(boot::boot.ci(list(t0 = est, t = matrix(draws, ncol = 1), R = length(draws)), type = \"perc\", conf = level)$perc[4:5])",
    "  c(est = est, se = sd(draws), lo = ci[1], hi = ci[2])",
    "}"
  )
}

#' Script lines: helpers that turn the fitted equations into effects.
ps_cpa_helper_code <- function(hc) {
  c(
    if (hc == "none") {
      "# Covariance matrix of the coefficients: OLS."
    } else {
      sprintf("# Covariance matrix of the coefficients: heteroskedasticity-consistent (sandwich::vcovHC, type %s).", hc)
    },
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
    ps_cpa_combine_code("boot_indirect", "bootstrap samples")
  )
}

ps_cpa_build <- function(req) {
  vars <- req$variables
  n <- ps_names(vars)
  # A single-item variable named like its column is that column; others are scores.
  rn <- vapply(seq_along(vars), function(j) {
    it <- n$inds[[j]]
    if (length(it) == 1 && identical(it, n$cname[j])) unname(n$iv[[it]]) else unname(n$cv[[j]])
  }, "")
  names(rn) <- n$cname
  id <- function(x) ps_lookup(rn, x)
  inputs <- list(data = ps_frame(req, n))
  latent <- id(req$latent)
  sam <- length(latent) > 0
  scoring <- unlist(lapply(seq_along(vars), function(j) {
    it <- unname(n$iv[n$inds[[j]]])
    if (rn[[j]] %in% latent) {
      NULL
    } else if (length(it) == 1 && it == rn[[j]]) {
      NULL
    } else if (length(it) == 1) {
      sprintf("data$%s <- data$%s", rn[[j]], it)
    } else {
      sprintf("data$%s <- rowMeans(data[, %s])", rn[[j]], ps_q(it))
    }
  }))
  term <- function(t) paste(id(t$vars), collapse = ":")
  outcomes <- vapply(req$equations, function(e) id(e$outcome), "")
  fit_lines <- vapply(req$equations, function(e) {
    sprintf(
      "fit_%s <- lm(%s ~ %s, data = data)", id(e$outcome), id(e$outcome),
      paste(vapply(e$terms, term, ""), collapse = " + ")
    )
  }, "")
  mods <- id(req$moderators)
  B <- as.integer(req$boot$samples %||% 0)
  seed <- as.integer(req$boot$seed %||% 1)
  has_ind <- length(req$indirect) > 0
  if (sam) {
    measurement <- unlist(lapply(seq_along(vars), function(j) {
      if (rn[[j]] %in% latent) {
        sprintf("%s =~ %s", rn[[j]], paste(unname(n$iv[n$inds[[j]]]), collapse = " + "))
      }
    }))
    structural <- vapply(
      req$equations,
      function(e) sprintf("%s ~ %s", id(e$outcome), paste(vapply(e$terms, term, ""), collapse = " + ")),
      ""
    )
    observed_mods <- setdiff(mods, latent)
    body <- c(
      "suppressPackageStartupMessages({ library(manymome); library(lavaan) })",
      ps_missing_code(req$missing),
      if (length(scoring)) c("# Scale scores: the mean of each scale's items", scoring),
      sprintf("level <- %s", format(ps_number(req$confidence %||% 0.95, "confidence level"))),
      "# Latent variables (measurement) and one equation per outcome (structure)",
      "model <- '", paste0("  ", c(measurement, structural)), "'",
      "# Structural-after-measurement estimation with two-step standard errors",
      "fit <- sam(model, data = data, se = \"twostep\")",
      "# Monte Carlo draws of the parameters for the confidence intervals of all effects",
      sprintf("mc_out <- do_mc(fit, R = %d, seed = %d, progress = FALSE)", B, seed),
      if (length(observed_mods)) ps_cpa_probe_code(req$probe %||% "percentiles"),
      if (length(mods)) {
        c(
          if (length(intersect(mods, latent))) "# A latent moderator is probed at its mean and one SD below and above it (manymome::mod_levels).",
          sprintf("probe_values <- list(%s)", paste(sprintf(
            "%s = %s", mods,
            ifelse(
              mods %in% latent,
              sprintf("rev(mod_levels(\"%s\", fit = fit)[[1]])", mods),
              sprintf("probe(data$%s)", mods)
            )
          ), collapse = ", "))
        )
      },
      ps_cpa_sam_helper_code()
    )
    return(list(body = body, inputs = inputs, id = id, rn = rn, mods = mods, has_ind = has_ind, sam = TRUE, latent = latent))
  }
  body <- c(
    "suppressPackageStartupMessages(library(manymome))",
    ps_missing_code(req$missing),
    if (length(scoring)) c("# Scale scores: the mean of each scale's items", scoring),
    sprintf("level <- %s", format(ps_number(req$confidence %||% 0.95, "confidence level"))),
    "# One OLS regression per outcome",
    fit_lines,
    sprintf("eqs <- list(%s)", paste(sprintf("%s = fit_%s", outcomes, outcomes), collapse = ", ")),
    sprintf("fits <- lm2list(%s)", paste0("fit_", outcomes, collapse = ", ")),
    if (has_ind) {
      c(
        "# Percentile bootstrap of the indirect effects (rows resampled, every equation refitted)",
        sprintf(
          "boot_out <- do_boot(fits, R = %d, seed = %d, parallel = FALSE, progress = FALSE)",
          B,
          as.integer(req$boot$seed %||% 1)
        )
      )
    },
    if (length(mods)) {
      c(
        ps_cpa_probe_code(req$probe %||% "percentiles"),
        sprintf("probe_values <- list(%s)", paste(sprintf("%s = probe(data$%s)", mods, mods), collapse = ", "))
      )
    },
    ps_cpa_helper_code(req$hc %||% "none")
  )
  list(
    body = body,
    inputs = inputs,
    id = id,
    rn = rn,
    mods = mods,
    has_ind = has_ind,
    sam = FALSE,
    latent = character(0)
  )
}

#' Rows over every combination of the probe values of `mods` (first moderator varying slowest, as PROCESS).
ps_cpa_grid <- function(mods, probe_values) {
  if (!length(mods)) {
    return(list(numeric(0)))
  }
  g <- expand.grid(rev(probe_values[mods]), KEEP.OUT.ATTRS = FALSE)[, rev(seq_along(mods)), drop = FALSE]
  lapply(seq_len(nrow(g)), function(i) setNames(unlist(g[i, ]), mods))
}

ps_cpa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  # A dichotomous Y or counterfactual (X by M) effects: our own bootstrap of lm / glm.
  if (isTRUE(req$binaryY) || !is.null(req$counterfactual)) {
    return(ps_cpa_glm(req, export))
  }
  b <- ps_cpa_build(req)
  id <- b$id
  back <- setNames(names(b$rn), unname(b$rn))
  nm <- function(x) ps_back(x, back, FALSE)
  title <- sprintf(
    "Conditional process analysis%s (%s)", if (is.null(req$model)) "" else sprintf(", PROCESS model %d", as.integer(req$model)),
    if (b$sam) "lavaan::sam and manymome" else "manymome"
  )
  fit_name <- if (b$sam) "fit" else "fits"
  ci_args <- if (b$sam) "mc_ci = TRUE, mc_out = mc_out" else "boot_ci = TRUE, boot_out = boot_out"
  if (export) {
    levels_code <- function(ms) {
      one <- sprintf("mod_levels(\"%s\", fit = %s, values = probe_values$%s)", ms, fit_name, ms)
      if (length(one) == 1) one else sprintf("merge_mod_levels(%s)", paste(one, collapse = ", "))
    }
    report <- c(
      if (b$sam) "summary(fit)" else "lapply(fits, summary)",
      if (length(b$mods)) "probe_values",
      unlist(lapply(req$indirect, function(p) {
        path <- id(p$vars)
        k <- length(path)
        m <- if (k > 2) ps_q(path[2:(k - 1)]) else "NULL"
        if (length(p$moderators)) {
          sprintf(
            "cond_indirect_effects(wlevels = %s, x = \"%s\", y = \"%s\", m = %s, fit = %s, %s, level = level)",
            levels_code(id(p$moderators)), path[1], path[k], m, fit_name, ci_args
          )
        } else {
          sprintf("ind(%s)", ps_q(path))
        }
      }))
    )
    return(ps_script(title, if (b$sam) c("manymome", "lavaan") else "manymome", b$inputs, b$body, report))
  }
  env <- ps_run(b$body, b$inputs)
  pv <- if (length(b$mods)) env$probe_values else list()
  at_list <- function(at) as.list(setNames(unname(at), nm(names(at))))

  level <- req$confidence %||% 0.95
  equations <- if (b$sam) {
    pe <- lavaan::parameterEstimates(env$fit, level = level)
    r2 <- lavaan::lavInspect(env$fit, "r2")
    lapply(req$equations, function(e) {
      o <- id(e$outcome)
      rows <- pe[pe$op == "~" & pe$lhs == o, ]
      list(
        outcome = e$outcome, n = nrow(env$data), r2 = unname(r2[o]), mse = NULL, f = NULL, df1 = NULL, df2 = NULL, p = NULL, interactions = list(),
        coefficients = lapply(seq_len(nrow(rows)), function(i) {
          list(
            term = nm(strsplit(rows$rhs[i], ":", fixed = TRUE)[[1]]),
            est = rows$est[i], se = rows$se[i], t = rows$z[i], p = rows$pvalue[i], lo = rows$ci.lower[i], hi = rows$ci.upper[i]
          )
        })
      )
    })
  } else {
    lapply(req$equations, function(e) {
      f <- env$eqs[[id(e$outcome)]]
      s <- summary(f)
      b <- coef(f)
      V <- env$vc(f)
      se <- sqrt(diag(V))
      df <- df.residual(f)
      tv <- b / se
      q <- qt(1 - (1 - level) / 2, df)
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
        list(
          focal = focal, terms = lapply(vs, function(v) nm(id(v$vars))), r2change = s$r.squared - summary(reduced)$r.squared,
          f = fq, df1 = length(nms), df2 = df, p = pf(fq, length(nms), df, lower.tail = FALSE)
        )
      }
      tests <- unlist(lapply(Filter(function(i) id(i$outcome) == id(e$outcome), req$interactions %||% list()), function(i) {
        rows <- lapply(i$terms, function(v) test(i$focal, list(v)))
        if (length(i$terms) > 1) rows <- c(rows, list(test(i$focal, i$terms)))
        rows
      }), recursive = FALSE)
      list(
        outcome = e$outcome, n = length(f$residuals), r2 = s$r.squared, mse = s$sigma^2,
        f = fval, df1 = sum(k), df2 = df, p = pf(fval, sum(k), df, lower.tail = FALSE), interactions = tests %||% list(),
        coefficients = lapply(seq_along(b), function(i) {
          list(
            term = if (names(b)[i] == "(Intercept)") list() else nm(strsplit(names(b)[i], ":", fixed = TRUE)[[1]]),
            est = unname(b[i]), se = unname(se[i]), t = unname(tv[i]), p = unname(2 * pt(-abs(tv[i]), df)),
            lo = unname(b[i] - q * se[i]), hi = unname(b[i] + q * se[i])
          )
        })
      )
    })
  }

  slope_row <- function(from, to, at) {
    s <- env$slope(from, to, at)
    c(list(at = at_list(at)), as.list(s))
  }
  direct <- if (!is.null(req$direct)) {
    dm <- id(req$direct$moderators)
    list(
      moderators = req$direct$moderators %||% list(),
      rows = lapply(ps_cpa_grid(dm, pv), function(at) slope_row(id(req$x), id(req$y), at))
    )
  }
  # A multicategorical X: one relative direct effect per code.
  directs <- lapply(req$directs %||% list(), function(dd) {
    dm <- id(dd$moderators)
    list(
      x = dd$x,
      moderators = dd$moderators %||% list(),
      rows = lapply(ps_cpa_grid(dm, pv), function(at) slope_row(id(dd$x), id(req$y), at))
    )
  })

  # Johnson-Neyman: values of the single moderator of an edge where the conditional effect is just significant.
  # (Inside, `b` is the coefficient vector.)
  is_sam <- b$sam
  b_latent <- b$latent
  jn <- lapply(req$jn %||% list(), function(j) {
    from <- id(j$from)
    to <- id(j$to)
    w <- id(j$moderator)
    if (is_sam) {
      # lavaan names regressions "to~from"; z critical value.
      cf <- coef(env$fit)
      V0 <- vcov(env$fit)
      keep <- grepl(paste0("^", to, "~"), names(cf)) & !grepl("~~", names(cf), fixed = TRUE)
      b <- setNames(cf[keep], sub(paste0("^", to, "~"), "", names(cf)[keep]))
      V <- V0[names(cf)[keep], names(cf)[keep], drop = FALSE]
      dimnames(V) <- list(names(b), names(b))
      q <- qnorm(1 - (1 - level) / 2)
    } else {
      f <- env$eqs[[to]]
      b <- coef(f)
      V <- env$vc(f)
      q <- qt(1 - (1 - level) / 2, df.residual(f))
    }
    xw <- names(b)[vapply(strsplit(names(b), ":", fixed = TRUE), function(p) setequal(p, c(from, w)), TRUE)]
    # (b1 + b3 w)^2 = q^2 (V11 + 2 w V13 + w^2 V33): a quadratic in w.
    A <- b[xw]^2 - q^2 * V[xw, xw]
    B2 <- 2 * (b[from] * b[xw] - q^2 * V[from, xw])
    C <- b[from]^2 - q^2 * V[from, from]
    disc <- B2^2 - 4 * A * C
    roots <- if (disc < 0 || A == 0) numeric(0) else sort((-B2 + c(-1, 1) * sqrt(disc)) / (2 * A))
    if (w %in% b_latent) {
      # A latent moderator has no observed values: its range is taken as the mean ± 3 SD.
      sdw <- diff(range(pv[[w]])) / 2
      roots <- roots[abs(roots) <= 3 * sdw]
      return(list(
        from = j$from, to = j$to, moderator = j$moderator, range = c(-3 * sdw, 3 * sdw), mean = 0, sd = sdw, latent = TRUE,
        b = unname(b[from]), bint = unname(b[xw]), v = unname(c(V[from, from], V[from, xw], V[xw, xw])), crit = unname(q),
        bounds = lapply(roots, function(r) list(value = unname(r), below = NULL, above = NULL))
      ))
    }
    wv <- env$data[[w]]
    roots <- roots[roots >= min(wv) & roots <= max(wv)]
    list(
      from = j$from, to = j$to, moderator = j$moderator, range = c(min(wv), max(wv)), mean = mean(wv), sd = sd(wv),
      b = unname(b[from]), bint = unname(b[xw]), v = unname(c(V[from, from], V[from, xw], V[xw, xw])), crit = unname(q),
      bounds = lapply(
        roots,
        function(r) list(value = unname(r), below = 100 * mean(wv < r), above = 100 * mean(wv > r))
      )
    )
  })

  indirect <- list()
  indices <- list()
  total <- NULL
  draws_of <- function(e) if (b$sam) e$mc_indirect else e$boot_indirect
  if (b$has_ind) {
    eff_row <- function(e) {
      ci <- confint(e, level = req$confidence %||% 0.95)
      list(est = unname(e$indirect), se = sd(draws_of(e)), lo = unname(ci[1]), hi = unname(ci[2]))
    }
    unmoderated <- list()
    for (p in req$indirect) {
      path <- id(p$vars)
      pm <- id(p$moderators)
      rows <- lapply(ps_cpa_grid(pm, pv), function(at) {
        e <- env$ind(path, if (length(at)) at else NULL)
        if (!length(pm)) unmoderated[[length(unmoderated) + 1]] <<- e
        c(list(at = at_list(at)), eff_row(e))
      })
      indirect[[length(indirect) + 1]] <- list(path = p$vars, moderators = p$moderators %||% list(), rows = rows)
      ix <- p$index
      if (!is.null(ix)) {
        at <- function(...) {
          v <- c(...)
          v[pm]
        }
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
            for (zv in pv[[z]]) {
              put(
                "cmm", env$combine(list(ie(pt(1, zv)), ie(pt(0, zv))), c(1, -1)),
                list(moderator = ix$w, at = setNames(list(zv), ix$z))
              )
            }
          }
        }
      }
    }
    if (length(unmoderated) > 1 && length(unmoderated) == length(req$indirect)) {
      total <- as.list(env$combine(unmoderated, rep(1, length(unmoderated))))
    }
  }

  ps_json(list(
    n = nrow(env$data), equations = equations,
    moderators = lapply(b$mods, function(m) list(name = nm(m), values = pv[[m]])),
    direct = direct, directs = directs, indirect = indirect, total = total, indices = indices, jn = jn,
    boot = list(samples = if (b$has_ind || b$sam) as.integer(req$boot$samples) else 0L),
    inference = if (b$sam) "montecarlo" else "bootstrap", hc = if (b$sam) "none" else req$hc %||% "none", latent = lapply(b$latent, nm),
    warnings = env$.warnings,
    engine = list(
      package = if (b$sam) "lavaan::sam + manymome" else "manymome",
      version = if (b$sam) sprintf("%s / %s", utils::packageVersion("lavaan"), utils::packageVersion("manymome")) else as.character(utils::packageVersion("manymome"))
    )
  ))
}

#' Conditional process analysis without manymome: a dichotomous Y (logistic
#' regression, as PROCESS) and/or X moderating its own M -> Y paths with
#' counterfactual effects (model 74; VanderWeele 2015). Effects are products of
#' conditional slopes along each path (log-odds metric for a dichotomous Y),
#' with a percentile bootstrap that resamples cases and refits every equation.
ps_cpa_glm <- function(req, export = FALSE) {
  b <- ps_cpa_build(req)
  id <- b$id
  binary <- isTRUE(req$binaryY)
  yv <- id(req$y)
  term <- function(t) paste(id(t$vars), collapse = ":")
  fit_lines <- vapply(req$equations, function(e) {
    o <- id(e$outcome)
    rhs <- paste(vapply(e$terms, term, ""), collapse = " + ")
    if (binary && o == yv) {
      sprintf("fit_%s <- glm(%s ~ %s, family = binomial, data = data)", o, o, rhs)
    } else {
      sprintf("fit_%s <- lm(%s ~ %s, data = data)", o, o, rhs)
    }
  }, "")
  outcomes <- vapply(req$equations, function(e) id(e$outcome), "")
  B <- as.integer(req$boot$samples %||% 1000)
  seed <- as.integer(req$boot$seed %||% 1)
  cf <- req$counterfactual
  body <- c(
    b$body[seq_len(match("# One OLS regression per outcome", b$body) - 1)][-1],
    if (binary) sprintf("# Mediators by OLS; the dichotomous %s by logistic regression (coefficients in log-odds)", yv) else "# One OLS regression per outcome",
    fit_lines,
    sprintf("eqs <- list(%s)", paste(sprintf("%s = fit_%s", outcomes, outcomes), collapse = ", ")),
    if (length(b$mods)) {
      c(
        ps_cpa_probe_code(req$probe %||% "percentiles"),
        sprintf("probe_values <- list(%s)", paste(sprintf("%s = probe(data$%s)", b$mods, b$mods), collapse = ", "))
      )
    },
    "# Conditional slope of `from` on `to` at moderator values `at`, from a coefficient list",
    "slope_c <- function(cf, from, to, at = numeric(0)) {",
    "  b <- cf[[to]]; parts <- strsplit(names(b), \":\", fixed = TRUE)",
    "  sum(vapply(seq_along(b), function(i) if (from %in% parts[[i]]) b[i] * prod(at[setdiff(parts[[i]], from)]) else 0, 0))",
    "}",
    "# (Conditional) indirect effect: the product of the slopes along the path",
    "ind_c <- function(cf, path, at = numeric(0)) prod(vapply(seq_len(length(path) - 1), function(i) slope_c(cf, path[i], path[i + 1], at), 0))",
    "# Percentile bootstrap: resample cases, refit every equation, keep the coefficients",
    "refit <- function(d) lapply(eqs, function(f) coef(update(f, data = d)))",
    sprintf("set.seed(%d)", seed),
    "boot_errors <- character(0)",
    sprintf(
      "boots <- lapply(seq_len(%d), function(r) tryCatch(refit(data[sample(nrow(data), replace = TRUE), , drop = FALSE]),",
      B
    ),
    "  error = function(e) { boot_errors <<- c(boot_errors, conditionMessage(e)); NULL }))",
    "boots <- Filter(function(x) !is.null(x) && !anyNA(unlist(x)), boots)",
    "# Samples that failed or gave missing coefficients are dropped, and reported.",
    sprintf(
      "if (length(boots) < %d) warning(sprintf(\"%%d of %d bootstrap samples failed or gave missing coefficients and were dropped%%s\", %d - length(boots),",
      B,
      B,
      B
    ),
    "  if (length(boot_errors)) paste0(\", e.g.: \", boot_errors[1]) else \"\"))",
    "cf0 <- lapply(eqs, coef)"
  )
  if (export) {
    report <- c(
      "lapply(eqs, summary)", if (length(b$mods)) "probe_values",
      unlist(lapply(req$indirect, function(p) {
        sprintf(
          "ind_c(cf0, %s%s)  # point estimate; bootstrap: sapply(boots, ind_c, path = ...)", ps_q(id(p$vars)),
          if (length(p$moderators)) sprintf(", at = c(%s)", paste(sprintf("%s = probe_values$%s[2]", id(p$moderators), id(p$moderators)), collapse = ", ")) else ""
        )
      }))
    )
    return(ps_script(
      sprintf(
        "Conditional process analysis%s",
        if (binary) " with a dichotomous outcome (logistic regression)" else " with counterfactual effects (X by M interaction)"
      ),
      "stats", b$inputs, body, report
    ))
  }
  env <- ps_run(body, b$inputs)
  level <- req$confidence %||% 0.95
  back <- setNames(names(b$rn), unname(b$rn))
  nm <- function(x) ps_back(x, back, FALSE)
  at_list <- function(at) as.list(setNames(unname(at), nm(names(at))))
  pv <- if (length(b$mods)) env$probe_values else list()
  cf0 <- env$cf0
  boots <- env$boots
  # (percentile intervals as manymome computes them: boot::boot.ci, type "perc")
  ci <- function(draws, est) unname(boot::boot.ci(list(t0 = est, t = matrix(draws, ncol = 1), R = length(draws)), type = "perc", conf = level)$perc[4:5])
  boot_eff <- function(f) {
    d <- vapply(boots, f, 0)
    est <- f(cf0)
    q <- ci(d, est)
    list(est = est, se = sd(d), lo = q[1], hi = q[2])
  }
  combine <- function(fs, w) boot_eff(function(cf) sum(w * vapply(fs, function(f) f(cf), 0)))
  eq_out <- lapply(req$equations, function(e) {
    f <- env$eqs[[id(e$outcome)]]
    s <- summary(f)
    ct <- s$coefficients
    glm <- inherits(f, "glm")
    q <- if (glm) qnorm(1 - (1 - level) / 2) else qt(1 - (1 - level) / 2, f$df.residual)
    common <- list(
      outcome = e$outcome, n = length(f$residuals), interactions = list(),
      coefficients = lapply(seq_len(nrow(ct)), function(i) {
        list(
          term = if (rownames(ct)[i] == "(Intercept)") list() else nm(strsplit(rownames(ct)[i], ":", fixed = TRUE)[[1]]),
          est = ct[i, 1], se = ct[i, 2], t = ct[i, 3], p = ct[i, 4], lo = ct[i, 1] - q * ct[i, 2], hi = ct[i, 1] + q * ct[i, 2]
        )
      })
    )
    if (glm) {
      n <- length(f$residuals)
      dev <- f$deviance
      nd <- f$null.deviance
      cs <- 1 - exp((dev - nd) / n)
      c(common, list(
        logistic = TRUE, r2 = 1 - dev / nd, mse = NULL, f = NULL, df1 = f$df.null - f$df.residual, df2 = NULL,
        p = pchisq(nd - dev, f$df.null - f$df.residual, lower.tail = FALSE),
        deviance = dev, chisq = nd - dev, mcfadden = 1 - dev / nd, coxsnell = cs, nagelkerke = cs / (1 - exp(-nd / n))
      ))
    } else {
      fs <- s$fstatistic
      c(
        common,
        list(
          r2 = s$r.squared,
          mse = s$sigma^2,
          f = unname(fs[1]),
          df1 = unname(fs[2]),
          df2 = unname(fs[3]),
          p = unname(pf(fs[1], fs[2], fs[3], lower.tail = FALSE))
        )
      )
    }
  })
  # Direct (conditional) effects with their ML / OLS standard errors.
  slope_row <- function(from, to, at) {
    f <- env$eqs[[to]]
    bb <- coef(f)
    V <- vcov(f)
    parts <- strsplit(names(bb), ":", fixed = TRUE)
    g <- vapply(parts, function(p) if (from %in% p) prod(at[setdiff(p, from)]) else 0, 0)
    est <- sum(g * bb)
    se <- sqrt(drop(t(g) %*% V %*% g))
    glm <- inherits(f, "glm")
    q <- if (glm) qnorm(1 - (1 - level) / 2) else qt(1 - (1 - level) / 2, f$df.residual)
    p <- if (glm) 2 * pnorm(-abs(est / se)) else 2 * pt(-abs(est / se), f$df.residual)
    c(list(at = at_list(at)), list(est = est, se = se, t = est / se, p = p, lo = est - q * se, hi = est + q * se))
  }
  direct <- if (!is.null(req$direct)) {
    list(
      moderators = req$direct$moderators %||% list(),
      rows = lapply(ps_cpa_grid(id(req$direct$moderators), pv), function(at) slope_row(id(req$x), yv, at))
    )
  }
  directs <- lapply(req$directs %||% list(), function(dd) {
    list(
      x = dd$x, moderators = dd$moderators %||% list(),
      rows = lapply(ps_cpa_grid(id(dd$moderators), pv), function(at) slope_row(id(dd$x), yv, at))
    )
  })
  indirect <- list()
  indices <- list()
  for (p in req$indirect) {
    path <- id(p$vars)
    pm <- id(p$moderators)
    rows <- lapply(
      ps_cpa_grid(pm, pv),
      function(at) c(list(at = at_list(at)), boot_eff(function(cf) env$ind_c(cf, path, at)))
    )
    indirect[[length(indirect) + 1]] <- list(path = p$vars, moderators = p$moderators %||% list(), rows = rows)
    ix <- p$index
    if (!is.null(ix)) {
      f_at <- function(v) function(cf) env$ind_c(cf, path, v)
      put <- function(kind, r, extra = list()) indices[[length(indices) + 1]] <<- c(list(kind = kind, path = p$vars), extra, r)
      w <- id(ix$w)
      if (ix$kind == "mm") {
        put("mm", combine(list(f_at(setNames(1, w)), f_at(setNames(0, w))), c(1, -1)), list(moderator = ix$w))
      } else {
        z <- id(ix$z)
        pt <- function(a, c) setNames(c(a, c), c(w, z))
        if (ix$kind == "partial") {
          put("partial", combine(list(f_at(pt(1, 0)), f_at(pt(0, 0))), c(1, -1)), list(moderator = ix$w))
          put("partial", combine(list(f_at(pt(0, 1)), f_at(pt(0, 0))), c(1, -1)), list(moderator = ix$z))
        } else {
          put("mmm", combine(list(f_at(pt(1, 1)), f_at(pt(1, 0)), f_at(pt(0, 1)), f_at(pt(0, 0))), c(1, -1, -1, 1)))
          for (zv in pv[[z]]) put("cmm", combine(list(f_at(pt(1, zv)), f_at(pt(0, zv))), c(1, -1)), list(moderator = ix$w, at = setNames(list(zv), ix$z)))
        }
      }
    }
  }
  # Counterfactual effects of moving X from x_ref to x_cf, with X moderating M -> Y (VanderWeele 2015).
  counterfactual <- if (!is.null(cf)) {
    x <- id(req$x)
    ms <- id(req$mediators)
    xr <- as.numeric(cf$xref)
    xc <- as.numeric(cf$xcf)
    dx <- xc - xr
    covs <- id(req$covariates)
    cmeans <- if (length(covs)) colMeans(env$data[, covs, drop = FALSE]) else numeric(0)
    mmeans <- colMeans(env$data[, ms, drop = FALSE])
    # E[M | x] with the covariates at their means.
    mhat <- function(bm, xv) {
      v <- c("(Intercept)" = 1, setNames(xv, x), cmeans)
      sum(bm[names(bm)] * v[names(bm)], na.rm = TRUE)
    }
    coef_of <- function(by, a, bvar) {
      k <- names(by)[vapply(strsplit(names(by), ":", fixed = TRUE), function(p) setequal(p, c(a, bvar)), TRUE)]
      if (length(k)) by[[k]] else 0
    }
    direct_at <- function(cf, mv) {
      by <- cf[[yv]]
      (by[[x]] + sum(vapply(ms, function(m) coef_of(by, m, x) * mv[[m]], 0))) * dx
    }
    tnie <- function(cf, m, xv) {
      by <- cf[[yv]]
      cf[[m]][[x]] * (by[[m]] + coef_of(by, m, x) * xv) * dx
    }
    ref_m <- function(cf, xv) setNames(vapply(ms, function(m) mhat(cf[[m]], xv), 0), ms)
    eff <- list(
      list(name = "pnde", label = "Pure natural direct effect", f = function(cf) direct_at(cf, ref_m(cf, xr))),
      list(name = "tnde", label = "Total natural direct effect", f = function(cf) direct_at(cf, ref_m(cf, xc))),
      list(
        name = "cde",
        label = "Controlled direct effect (mediators at their means)",
        f = function(cf) direct_at(cf, as.list(mmeans))
      )
    )
    for (m in ms) {
      eff <- c(eff, list(
        list(name = paste0("tnie:", nm(m)), label = sprintf("Total natural indirect effect through %s", nm(m)), f = local({
          mm <- m
          function(cf) tnie(cf, mm, xc)
        })),
        list(name = paste0("pnie:", nm(m)), label = sprintf("Pure natural indirect effect through %s", nm(m)), f = local({
          mm <- m
          function(cf) tnie(cf, mm, xr)
        }))
      ))
    }
    eff <- c(eff, list(list(
      name = "total", label = "Total effect (pure natural direct + total natural indirect)",
      f = function(cf) direct_at(cf, ref_m(cf, xr)) + sum(vapply(ms, function(m) tnie(cf, m, xc), 0))
    )))
    list(xref = xr, xcf = xc, effects = lapply(eff, function(e) c(list(name = e$name, label = e$label), boot_eff(e$f))))
  }
  ps_json(list(
    n = nrow(env$data), equations = eq_out, moderators = lapply(b$mods, function(m) list(name = nm(m), values = pv[[m]])),
    direct = direct, directs = directs, indirect = indirect, total = NULL, indices = indices, jn = list(),
    counterfactual = counterfactual, binaryY = binary,
    boot = list(samples = length(boots)), inference = "bootstrap", hc = "none", latent = list(),
    warnings = c(
      env$.warnings,
      if (length(boots) < B) sprintf("%d of %d bootstrap samples failed (e.g. separation in the logistic regression) and were left out.", B - length(boots), B)
    ),
    engine = list(package = "stats (lm, glm)", version = paste(R.version$major, R.version$minor, sep = "."))
  ))
}
