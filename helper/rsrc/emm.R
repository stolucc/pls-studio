# Estimated marginal means and what follows them (emmeans, Lenth): marginal means with
# confidence intervals per term, post hoc pairwise comparisons (Tukey, Bonferroni, Holm,
# Scheffe, unadjusted), simple effects (joint tests of one factor at each level of another),
# planned contrasts (deviation, simple, Helmert, polynomial, custom weights) and the means of
# a profile plot, for the fits of the ANOVA, repeated-measures ANOVA and multilevel
# regression cards. Games-Howell comparisons are not in emmeans: the script defines them by
# their formula (Games & Howell 1976), validated against rstatix::games_howell_test.
#
# Each card calls ps_emm_options() on its request, adds ps_emm_lines() to the script it runs
# and puts ps_emm_result() into its result.

PS_EMM_ADJUST <- c("tukey", "bonferroni", "holm", "scheffe", "none")
PS_EMM_CONTRASTS <- c("deviation", "simple", "helmert", "polynomial", "custom")
PS_EMM_DF <- c("kenward-roger", "satterthwaite", "asymptotic")

#' A term of the request (one to three different factor names), checked against the factors.
ps_emm_term <- function(t, factors, what) {
  t <- as.character(unlist(t))
  ok <- length(t) >= 1 && length(t) <= 3 && !anyDuplicated(t) && all(t %in% factors)
  if (!ok) {
    stop(sprintf("Invalid %s in the marginal means options: use the model's factors.", what))
  }
  t
}

#' One factor name of the request, checked against the factors.
ps_emm_factor <- function(x, factors, what) {
  if (!is.character(x) || length(x) != 1 || !x %in% factors) {
    stop(sprintf("Invalid %s in the marginal means options: use one of the model's factors.", what))
  }
  x
}

#' The request's marginal means options (`req$emm`), validated against the model's factors
#' (`levels`: each factor's level names, named by the factor as the user names it). NULL when
#' no marginal means were asked for. `games`: whether Games-Howell comparisons are possible
#' (between-subjects factors of a fixed-effects model); `lmer`: whether the fit is a mixed model.
ps_emm_options <- function(req, levels, games = FALSE, lmer = FALSE) {
  e <- req$emm
  if (is.null(e)) {
    return(NULL)
  }
  if (!is.list(e)) stop("Invalid marginal means options in the request.")
  factors <- names(levels)
  if (!length(factors)) stop("Marginal means need at least one factor in the model.")
  terms <- lapply(ps_string_rows(e$terms), ps_emm_term, factors, "term")
  posthoc <- lapply(ps_string_rows(e$posthoc), ps_emm_term, factors, "post hoc term")
  adjust <- as.character(unlist(e$adjust))
  if (!length(adjust)) adjust <- "tukey"
  if (!all(adjust %in% PS_EMM_ADJUST) || anyDuplicated(adjust)) {
    stop("Invalid p-value adjustment in the marginal means options.")
  }
  gh <- isTRUE(e$gamesHowell)
  if (gh && !games) stop("Games-Howell comparisons are for between-subjects factors of the ANOVA card.")
  gh_factors <- if (gh) unique(unlist(posthoc[lengths(posthoc) == 1])) else character(0)
  if (gh && !length(gh_factors)) stop("Games-Howell comparisons need a post hoc term with one factor.")
  simple <- NULL
  if (!is.null(e$simple)) {
    s <- e$simple
    simple <- list(
      factor = ps_emm_factor(s$factor, factors, "simple effect factor"),
      by = ps_emm_factor(s$by, factors, "moderator of the simple effects")
    )
    if (simple$factor == simple$by) stop("A simple effect needs two different factors.")
  }
  contrasts <- lapply(e$contrasts %||% list(), function(k) ps_emm_contrast(k, levels))
  plot <- NULL
  if (!is.null(e$plot)) {
    p <- e$plot
    x <- ps_emm_factor(p$x, factors, "horizontal axis of the profile plot")
    lines <- p$lines %||% ""
    if (nzchar(lines)) lines <- ps_emm_factor(lines, factors, "separate lines of the profile plot")
    if (identical(lines, x)) stop("The profile plot needs different factors on the axis and as lines.")
    plot <- list(x = x, lines = lines)
  }
  df <- e$df %||% "kenward-roger"
  if (!is.character(df) || length(df) != 1 || !df %in% PS_EMM_DF) {
    stop("Invalid degrees of freedom method in the marginal means options.")
  }
  if (!length(terms) && !length(posthoc) && is.null(simple) && !length(contrasts) && is.null(plot)) {
    stop("Choose what the marginal means section shows: means, post hoc tests, simple effects, contrasts or a plot.")
  }
  list(
    terms = terms,
    posthoc = posthoc,
    adjust = adjust,
    gamesHowell = gh_factors,
    simple = simple,
    contrasts = contrasts,
    plot = plot,
    df = if (lmer) df else NULL,
    levels = levels
  )
}

#' One planned contrast of the request: a factor, its type, the reference level of a simple
#' contrast, the weights of a custom one (one row per contrast, one weight per level).
ps_emm_contrast <- function(k, levels) {
  if (!is.list(k)) stop("Invalid contrast in the marginal means options.")
  f <- ps_emm_factor(k$factor, names(levels), "contrast factor")
  type <- k$type
  if (!is.character(type) || length(type) != 1 || !type %in% PS_EMM_CONTRASTS) {
    stop("Invalid contrast type in the marginal means options.")
  }
  nl <- length(levels[[f]])
  ref <- k$reference %||% "first"
  if (!ref %in% c("first", "last")) stop("Invalid reference level of a simple contrast.")
  weights <- NULL
  if (type == "custom") {
    w <- k$weights
    rows <- if (is.matrix(w)) {
      lapply(seq_len(nrow(w)), function(i) w[i, ])
    } else {
      lapply(w, unlist)
    }
    if (!length(rows) || length(rows) > 20) stop("A custom contrast needs one to twenty rows of weights.")
    for (r in rows) {
      ok <- is.numeric(r) && length(r) == nl && all(is.finite(r)) && any(r != 0) &&
        abs(sum(r)) < 1e-8 * max(1, sum(abs(r)))
      if (!ok) {
        stop(sprintf(
          "Each row of custom weights for %s needs %d numbers that sum to zero (not all zero).",
          f,
          nl
        ))
      }
    }
    weights <- rows
  }
  list(factor = f, type = type, reference = ref, weights = weights)
}

#' Helmert contrasts (SPSS's): each level against the mean of the levels after it.
ps_emm_helmert <- function(lv) {
  k <- length(lv)
  rows <- lapply(seq_len(k - 1), function(i) {
    w <- numeric(k)
    w[i] <- 1
    w[(i + 1):k] <- -1 / (k - i)
    w
  })
  names(rows) <- vapply(seq_len(k - 1), function(i) {
    sprintf("%s - mean(%s)", lv[i], paste(lv[(i + 1):k], collapse = ", "))
  }, "")
  rows
}

#' A numeric vector as R code (all digits kept).
ps_emm_num <- function(x) sprintf("c(%s)", paste(format(x, digits = 15, trim = TRUE), collapse = ", "))

#' A named list of weight vectors as R code.
ps_emm_weights_code <- function(rows) {
  items <- vapply(seq_along(rows), function(i) {
    sprintf("%s = %s", encodeString(names(rows)[i], quote = '"'), ps_emm_num(rows[[i]]))
  }, "")
  sprintf("list(%s)", paste(items, collapse = ", "))
}

#' The `method` argument of emmeans::contrast for a planned contrast (R code).
ps_emm_method_code <- function(k, lv) {
  switch(k$type,
    deviation = "\"eff\"",
    polynomial = "\"poly\"",
    simple = sprintf("\"trt.vs.ctrl\", ref = %d", if (k$reference == "first") 1L else length(lv)),
    helmert = ps_emm_weights_code(ps_emm_helmert(lv)),
    custom = {
      rows <- k$weights
      names(rows) <- vapply(rows, function(r) {
        paste(vapply(r, format, "", digits = 6), collapse = " ")
      }, "")
      names(rows) <- make.unique(names(rows), sep = " #")
      ps_emm_weights_code(rows)
    }
  )
}

#' The Games-Howell function as script lines (self-contained; no package).
PS_EMM_GAMES_HOWELL <- c(
  "# Games-Howell comparisons (Games & Howell 1976): Welch's t for each pair of groups, its",
  "# p-value and interval from the studentized range with Welch-Satterthwaite degrees of freedom.",
  "games_howell <- function(y, g, conf) {",
  "  g <- droplevels(g)",
  "  lv <- levels(g)",
  "  k <- length(lv)",
  "  m <- tapply(y, g, mean)",
  "  v <- tapply(y, g, var)",
  "  n <- tapply(y, g, length)",
  "  pairs <- combn(k, 2, simplify = FALSE)",
  "  rows <- lapply(pairs, function(p) {",
  "    i <- p[1]",
  "    j <- p[2]",
  "    vi <- v[i] / n[i]",
  "    vj <- v[j] / n[j]",
  "    se <- sqrt(vi + vj)",
  "    est <- m[i] - m[j]",
  "    df <- (vi + vj)^2 / (vi^2 / (n[i] - 1) + vj^2 / (n[j] - 1))",
  "    t <- est / se",
  "    q <- qtukey(conf, k, df) / sqrt(2)",
  "    data.frame(",
  "      contrast = paste(lv[i], \"-\", lv[j]),",
  "      estimate = unname(est),",
  "      SE = unname(se),",
  "      df = unname(df),",
  "      t.ratio = unname(t),",
  "      p.value = unname(ptukey(abs(t) * sqrt(2), k, df, lower.tail = FALSE)),",
  "      lower.CL = unname(est - q * se),",
  "      upper.CL = unname(est + q * se)",
  "    )",
  "  })",
  "  do.call(rbind, rows)",
  "}"
)

#' The emmeans call of a term (R code): `rn` maps the user's factor names to the fit's.
ps_emm_call <- function(term, rn, extra, by = character(0)) {
  spec <- paste(unname(rn[term]), collapse = " * ")
  if (length(by)) spec <- sprintf("%s | %s", spec, paste(unname(rn[by]), collapse = " * "))
  sprintf("emmeans(fit_emm, ~ %s%s)", spec, extra)
}

#' Script lines for the options `o` on the fit in `fit` (a variable of the script). `rn`: the
#' user's factor names to the fit's variable names; `extra`: further emmeans arguments (R code,
#' e.g. the levels of a multivariate response); `y`, `data`: for Games-Howell, the outcome and
#' the data frame (R code). The results are in `emm_out`, a list.
ps_emm_lines <- function(o, fit, rn, conf, extra = "", y = NULL, data = "data") {
  if (is.null(o)) {
    return(character(0))
  }
  if (!is.null(o$df)) {
    extra <- sprintf("%s, lmer.df = \"%s\"", extra, o$df)
  }
  lev <- format(conf, digits = 15)
  adjust <- ps_q(o$adjust)
  out <- c(
    "",
    "# ---- Estimated marginal means (emmeans) ----",
    "suppressPackageStartupMessages(library(emmeans))",
    sprintf("fit_emm <- %s", fit),
    "emm_out <- list(means = list(), posthoc = list(), gamesHowell = list(), contrasts = list())"
  )
  for (t in o$terms) {
    out <- c(
      out,
      sprintf("# Marginal means of %s", ps_comment(paste(t, collapse = " x "))),
      sprintf(
        "emm_out$means <- c(emm_out$means, list(as.data.frame(summary(%s, level = %s))))",
        ps_emm_call(t, rn, extra),
        lev
      )
    )
  }
  if (length(o$posthoc)) {
    out <- c(
      out,
      sprintf("# Post hoc: every pair of the term's means, p adjusted by each of %s", paste(o$adjust, collapse = ", ")),
      "emm_pairs <- function(emm, adjust) {",
      "  pw <- pairs(emm)",
      sprintf(
        "  lapply(setNames(adjust, adjust), function(a) as.data.frame(summary(pw, adjust = a, infer = TRUE, level = %s)))",
        lev
      ),
      "}"
    )
    for (t in o$posthoc) {
      out <- c(
        out,
        sprintf(
          "emm_out$posthoc <- c(emm_out$posthoc, list(emm_pairs(%s, %s)))",
          ps_emm_call(t, rn, extra),
          adjust
        )
      )
    }
  }
  if (length(o$gamesHowell)) {
    out <- c(out, PS_EMM_GAMES_HOWELL)
    for (f in o$gamesHowell) {
      out <- c(
        out,
        sprintf(
          "emm_out$gamesHowell <- c(emm_out$gamesHowell, list(games_howell(%s$%s, %s$%s, %s)))",
          data,
          y,
          data,
          rn[[f]],
          lev
        )
      )
    }
  }
  if (!is.null(o$simple)) {
    s <- o$simple
    out <- c(
      out,
      sprintf(
        "# Simple effects: %s at each level of %s (joint test of its consecutive differences)",
        ps_comment(s$factor),
        ps_comment(s$by)
      ),
      sprintf(
        "emm_out$simple <- as.data.frame(test(contrast(%s, \"consec\"), joint = TRUE))",
        ps_emm_call(s$factor, rn, extra, s$by)
      )
    )
  }
  for (k in o$contrasts) {
    out <- c(
      out,
      sprintf("# Planned contrasts (%s) of %s, unadjusted", k$type, ps_comment(k$factor)),
      sprintf(
        "emm_out$contrasts <- c(emm_out$contrasts, list(as.data.frame(summary(contrast(%s, method = %s, adjust = \"none\"), infer = TRUE, level = %s))))",
        ps_emm_call(k$factor, rn, extra),
        ps_emm_method_code(k, o$levels[[k$factor]]),
        lev
      )
    )
  }
  if (!is.null(o$plot)) {
    term <- c(o$plot$x, if (nzchar(o$plot$lines)) o$plot$lines)
    out <- c(
      out,
      "# The profile plot's means and their confidence intervals",
      sprintf("emm_out$plot <- as.data.frame(summary(%s, level = %s))", ps_emm_call(term, rn, extra), lev)
    )
  }
  out
}

#' A number column of an emmeans table (NULL when it has none of the names).
ps_emm_col <- function(d, names) {
  hit <- intersect(names, colnames(d))
  if (length(hit)) as.numeric(d[[hit[1]]]) else NULL
}

#' The rows of an emmeans table of means: the levels of each factor, the mean, its interval.
ps_emm_means_rows <- function(d, term, rn) {
  lapply(seq_len(nrow(d)), function(i) {
    list(
      levels = I(vapply(term, function(f) as.character(d[[rn[[f]]]][i]), "")),
      emmean = ps_emm_col(d, "emmean")[i],
      se = ps_emm_col(d, "SE")[i],
      df = ps_emm_col(d, "df")[i],
      lower = ps_emm_col(d, c("lower.CL", "asymp.LCL"))[i],
      upper = ps_emm_col(d, c("upper.CL", "asymp.UCL"))[i]
    )
  })
}

#' The rows of a table of contrasts: the label, estimate, SE, df, t (z), p and interval.
ps_emm_contrast_rows <- function(d) {
  lapply(seq_len(nrow(d)), function(i) {
    list(
      contrast = as.character(d$contrast[i]),
      estimate = ps_emm_col(d, "estimate")[i],
      se = ps_emm_col(d, "SE")[i],
      df = ps_emm_col(d, "df")[i],
      t = ps_emm_col(d, c("t.ratio", "z.ratio"))[i],
      p = ps_emm_col(d, "p.value")[i],
      lower = ps_emm_col(d, c("lower.CL", "asymp.LCL"))[i],
      upper = ps_emm_col(d, c("upper.CL", "asymp.UCL"))[i]
    )
  })
}

#' The result's `emm` from the run's `emm_out` (the user's names throughout).
ps_emm_result <- function(env, o, rn, conf) {
  if (is.null(o)) {
    return(NULL)
  }
  x <- env$emm_out
  means <- lapply(seq_along(o$terms), function(i) {
    list(term = I(o$terms[[i]]), rows = ps_emm_means_rows(x$means[[i]], o$terms[[i]], rn))
  })
  posthoc <- lapply(seq_along(o$posthoc), function(i) {
    tabs <- x$posthoc[[i]]
    first <- tabs[[1]]
    rows <- ps_emm_contrast_rows(first)
    # (the estimates are the same for every adjustment; the p-values and intervals are not)
    for (j in seq_along(rows)) {
      rows[[j]]$p <- NULL
      rows[[j]]$pAdjusted <- lapply(tabs, function(d) d$p.value[j])
    }
    list(term = I(o$posthoc[[i]]), adjust = I(o$adjust), rows = rows)
  })
  games <- lapply(seq_along(o$gamesHowell), function(i) {
    list(factor = o$gamesHowell[[i]], rows = ps_emm_contrast_rows(x$gamesHowell[[i]]))
  })
  simple <- NULL
  if (!is.null(o$simple)) {
    d <- x$simple
    by <- rn[[o$simple$by]]
    simple <- list(
      factor = o$simple$factor,
      by = o$simple$by,
      rows = lapply(seq_len(nrow(d)), function(i) {
        list(
          level = as.character(d[[by]][i]),
          df1 = as.numeric(d$df1[i]),
          df2 = as.numeric(d$df2[i]),
          f = as.numeric(d$F.ratio[i]),
          p = as.numeric(d$p.value[i])
        )
      })
    )
  }
  contrasts <- lapply(seq_along(o$contrasts), function(i) {
    k <- o$contrasts[[i]]
    list(factor = k$factor, type = k$type, rows = ps_emm_contrast_rows(x$contrasts[[i]]))
  })
  plot <- NULL
  if (!is.null(o$plot)) {
    d <- x$plot
    has_lines <- nzchar(o$plot$lines)
    plot <- list(
      x = o$plot$x,
      lines = o$plot$lines,
      rows = lapply(seq_len(nrow(d)), function(i) {
        list(
          x = as.character(d[[rn[[o$plot$x]]]][i]),
          line = if (has_lines) as.character(d[[rn[[o$plot$lines]]]][i]) else "",
          emmean = ps_emm_col(d, "emmean")[i],
          lower = ps_emm_col(d, c("lower.CL", "asymp.LCL"))[i],
          upper = ps_emm_col(d, c("upper.CL", "asymp.UCL"))[i]
        )
      })
    )
  }
  list(
    confidence = conf,
    df = o$df,
    means = means,
    posthoc = posthoc,
    gamesHowell = games,
    simple = simple,
    contrasts = contrasts,
    plot = plot,
    version = as.character(utils::packageVersion("emmeans"))
  )
}

#' The report lines of an exported script with marginal means.
ps_emm_report <- function(o) if (is.null(o)) character(0) else "emm_out"
