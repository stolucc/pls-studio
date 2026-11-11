# Univariate meta-analysis with metafor (Viechtbauer 2010): one row per study (or per effect size in a three-level
# model). The effect sizes are given (with their variances or standard errors) or computed from summary data by
# escalc(); the model is an equal-effects (FE) or random-effects model (rma, with the chosen tau² estimator), a
# meta-regression on moderators, or a three-level model (rma.mv with effects nested in clusters). Optional parts:
# publication bias (Egger's regression test, rank correlation, trim-and-fill, PET-PEESE) and influence diagnostics
# (influence(), leave1out()). Estimation is metafor's; this file writes the script and shapes the output.

#' The summary-data columns escalc() takes for each measure (GEN: effect sizes given, with vi or sei).
PS_META_ROLES <- list(
  GEN = c("yi"),
  SMD = c("m1i", "sd1i", "n1i", "m2i", "sd2i", "n2i"),
  MD = c("m1i", "sd1i", "n1i", "m2i", "sd2i", "n2i"),
  OR = c("ai", "bi", "ci", "di"),
  RR = c("ai", "bi", "ci", "di"),
  RD = c("ai", "bi", "ci", "di"),
  ZCOR = c("ri", "ni"),
  PLO = c("xi", "ni"),
  PR = c("xi", "ni")
)
PS_META_METHODS <- c("FE", "REML", "ML", "DL", "PM", "HE", "SJ", "EB", "HS")
#' Back-transformations of the pooled estimate (metafor's transf functions).
PS_META_TRANSF <- c(none = "", exp = "exp", ztor = "transf.ztor", ilogit = "transf.ilogit")

#' The rows of a coefficient table (coef(summary(fit)) of rma or lm) as a list; terms in the user's names.
ps_meta_coefs <- function(cs, back) {
  cs <- as.data.frame(cs)
  stat <- if ("tval" %in% names(cs)) cs$tval else cs$zval
  lapply(seq_len(nrow(cs)), function(i) {
    list(
      term = ps_back_names(rownames(cs)[i], back),
      est = cs$estimate[i],
      se = cs$se[i],
      stat = stat[i],
      df = if ("df" %in% names(cs)) cs$df[i] else NULL,
      p = cs$pval[i],
      ciLow = cs$ci.lb[i],
      ciHigh = cs$ci.ub[i]
    )
  })
}

#' A regtest() result: the test of funnel asymmetry and the limit estimate (the effect as the SE goes to 0).
ps_meta_regtest <- function(r) {
  fit <- r$fit
  intercept <- if (inherits(fit, "lm")) {
    cs <- stats::coef(summary(fit))
    list(se = cs[1, 2], p = cs[1, 4])
  } else {
    list(se = fit$se[1], p = fit$pval[1])
  }
  list(
    stat = r$zval,
    df = r$dfs,
    p = r$pval,
    est = unname(r$est),
    estSe = intercept$se,
    estP = intercept$p,
    ciLow = unname(r$ci.lb),
    ciHigh = unname(r$ci.ub)
  )
}

ps_meta <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  measure <- req$measure %||% "GEN"
  if (!(is.character(measure) && length(measure) == 1 && measure %in% names(PS_META_ROLES))) {
    stop("Invalid effect size measure in the request.")
  }
  method <- req$method %||% "REML"
  if (!(is.character(method) && length(method) == 1 && method %in% PS_META_METHODS)) {
    stop("Invalid estimator in the request.")
  }
  knha <- isTRUE(req$knha)
  transf <- req$transf %||% "none"
  if (!(is.character(transf) && length(transf) == 1 && transf %in% names(PS_META_TRANSF))) {
    stop("Invalid back-transformation in the request.")
  }
  var_type <- req$varType %||% "vi"
  if (!var_type %in% c("vi", "sei")) stop("Invalid variance type in the request.")
  roles <- PS_META_ROLES[[measure]]
  if (measure == "GEN") roles <- c(roles, var_type)
  columns <- req$columns
  role_cols <- vapply(roles, function(r) {
    x <- columns[[r, exact = TRUE]]
    if (!(is.character(x) && length(x) == 1 && nzchar(x))) {
      stop(sprintf("Choose the column for %s.", r))
    }
    x
  }, "")
  moderators <- as.character(unlist(req$moderators))
  categorical <- as.character(unlist(req$categorical))
  if (!all(categorical %in% moderators)) stop("Invalid categorical moderators in the request.")
  cluster <- req$cluster
  three_level <- !is.null(cluster)
  if (three_level) {
    if (!(is.character(cluster) && length(cluster) == 1 && nzchar(cluster))) {
      stop("Invalid cluster column in the request.")
    }
    if (!method %in% c("REML", "ML")) {
      stop("A three-level model is estimated by REML or ML.")
    }
  }
  if (any(c(moderators, cluster) %in% role_cols)) {
    stop("Moderators and the cluster must be other columns than the effect size data.")
  }
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  level <- ps_num(100 * conf)
  bias <- isTRUE(req$bias) && !length(moderators) && !three_level
  influence <- isTRUE(req$influence) && !three_level

  fr <- ps_long_frame(req, unique(c(role_cols, moderators, cluster)))
  v <- fr$v
  data <- fr$data
  labels <- req$labels
  if (!is.null(labels)) {
    labels <- as.character(unlist(labels))
    if (length(labels) != nrow(data)) stop("Invalid study labels in the request.")
    data$.label <- labels
  }
  used <- unname(v[unique(c(role_cols, moderators, cluster))])

  # escalc()'s arguments: role = column
  args <- paste(sprintf("%s = %s", roles, unname(v[role_cols])), collapse = ", ")
  slab <- if (is.null(labels)) "" else ", slab = .label"
  mod_terms <- vapply(moderators, function(m) {
    if (m %in% categorical) sprintf("factor(%s)", v[[m]]) else v[[m]]
  }, "")
  mods <- if (length(moderators)) {
    sprintf(", mods = ~ %s", paste(mod_terms, collapse = " + "))
  } else {
    ""
  }
  if (three_level) {
    fit_line <- sprintf(
      "res <- rma.mv(yi, vi%s, random = ~ 1 | %s/.effect, data = dat, method = \"%s\"%s, level = %s)",
      mods,
      v[[cluster]],
      method,
      if (knha) ", test = \"t\"" else "",
      level
    )
  } else {
    fit_line <- sprintf(
      "res <- rma(yi, vi%s, data = dat, method = \"%s\"%s, level = %s)",
      mods,
      method,
      if (knha) ", test = \"knha\"" else "",
      level
    )
  }
  tf <- PS_META_TRANSF[[transf]]
  body <- c(
    "suppressPackageStartupMessages(library(metafor))",
    sprintf("data <- data[complete.cases(data[, %s]), , drop = FALSE]", ps_q(used)),
    if (measure == "GEN") {
      "# Effect sizes as given, with their sampling variances"
    } else {
      sprintf("# Effect sizes from the summary data: measure \"%s\" (escalc)", measure)
    },
    sprintf("dat <- escalc(measure = \"%s\", %s, data = data%s)", measure, args, slab),
    "# (a study without an effect size, e.g. no events in either group, is left out)",
    "dat <- dat[is.finite(dat$yi) & is.finite(dat$vi), ]",
    if (three_level) "dat$.effect <- seq_len(nrow(dat))  # one id per effect size (the inner level)",
    if (three_level) {
      sprintf(
        "# Three-level model: effect sizes (.effect) nested in %s",
        ps_comment(cluster)
      )
    } else if (length(moderators)) {
      "# Meta-regression (mixed-effects model) on the moderators"
    } else {
      "# The meta-analytic model"
    },
    fit_line,
    if (!length(moderators)) {
      c(
        "pooled <- predict(res)  # the pooled estimate with its confidence and prediction intervals",
        if (nzchar(tf)) sprintf("pooled_back <- predict(res, transf = %s)  # on the original scale", tf)
      )
    },
    if (!three_level && method != "FE") {
      "heterogeneity <- confint(res)  # confidence intervals of tau², tau, I² and H² (Q-profile)"
    }
  )
  bias_lines <- if (bias) {
    c(
      "# Publication bias",
      "egger <- regtest(res)  # Egger's regression test (the standard error as moderator)",
      "rank <- ranktest(res)  # Begg and Mazumdar's rank correlation test",
      "filled <- trimfill(res)  # Duval and Tweedie's trim-and-fill",
      "pet <- regtest(res, model = \"lm\", predictor = \"sei\")  # PET (weighted least squares)",
      "peese <- regtest(res, model = \"lm\", predictor = \"vi\")  # PEESE (weighted least squares)"
    )
  }
  influence_lines <- if (influence) {
    c(
      "# Influence diagnostics",
      "inf <- influence(res)",
      if (!length(moderators)) "loo <- leave1out(res)  # the model refitted without each study in turn"
    )
  }
  report <- c(
    "summary(res)",
    if (!length(moderators)) c("pooled", if (nzchar(tf)) "pooled_back"),
    if (!three_level && method != "FE") "heterogeneity",
    "forest(res)",
    if (bias) c("egger", "rank", "filled", "funnel(filled)", "pet", "peese"),
    if (influence) c("inf", if (!length(moderators)) "loo")
  )
  inputs <- list(data = data)
  if (export) {
    return(ps_script(
      "Meta-analysis (metafor)",
      "metafor",
      inputs,
      c(body, bias_lines, influence_lines),
      report
    ))
  }
  env <- ps_run(body, inputs)
  # Optional parts in the same environment: a failure is reported, the rest of the results kept.
  more <- function(lines, what) {
    if (!length(lines)) {
      return(invisible(NULL))
    }
    ps_try(eval(parse(text = paste(lines, collapse = "\n")), envir = env), what)
  }
  more(bias_lines, "Publication bias")
  more(influence_lines, "Influence diagnostics")

  res <- env$res
  dat <- env$dat
  z <- stats::qnorm(1 - (1 - conf) / 2)
  yi <- as.numeric(dat$yi)
  vi <- as.numeric(dat$vi)
  study_labels <- if (is.null(labels)) rownames(dat) else as.character(dat$.label)
  w <- as.numeric(stats::weights(res))
  studies <- lapply(seq_along(yi), function(i) {
    list(
      label = study_labels[i],
      yi = yi[i],
      vi = vi[i],
      ciLow = yi[i] - z * sqrt(vi[i]),
      ciHigh = yi[i] + z * sqrt(vi[i]),
      weight = w[i]
    )
  })
  interval <- function(p) {
    if (is.null(p)) {
      return(NULL)
    }
    list(
      est = as.numeric(p$pred),
      se = if (is.null(p$se)) NULL else as.numeric(p$se),
      ciLow = as.numeric(p$ci.lb),
      ciHigh = as.numeric(p$ci.ub),
      piLow = as.numeric(p$pi.lb %||% p$ci.lb),
      piHigh = as.numeric(p$pi.ub %||% p$ci.ub)
    )
  }
  het <- if (three_level) {
    # Multilevel I² per level (Cheung 2014; the metafor FAQ): each variance component over the total variance
    W <- diag(1 / res$vi)
    X <- stats::model.matrix(res)
    P <- W - W %*% X %*% solve(t(X) %*% W %*% X) %*% t(X) %*% W
    typical <- (res$k - res$p) / sum(diag(P))
    list(
      sigma2 = res$sigma2,
      I2 = 100 * res$sigma2 / (sum(res$sigma2) + typical),
      levels = I(c(cluster, "effect size")),
      clusters = res$s.nlevels[1]
    )
  } else {
    ci <- env$heterogeneity$random
    row <- function(r) {
      if (is.null(ci)) {
        return(NULL)
      }
      list(est = ci[r, 1], ciLow = ci[r, 2], ciHigh = ci[r, 3])
    }
    list(
      tau2 = res$tau2,
      tau2se = res$se.tau2,
      I2 = res$I2,
      H2 = res$H2,
      R2 = res$R2,
      ci = list(tau2 = row(1), tau = row(2), I2 = row(3), H2 = row(4))
    )
  }
  fit_col <- if (method == "REML") "REML" else "ML"
  fs <- res$fit.stats[, fit_col]
  out <- list(
    measure = measure,
    method = method,
    knha = knha,
    threeLevel = three_level,
    k = res$k,
    studies = studies,
    coefs = ps_meta_coefs(stats::coef(summary(res)), fr$back),
    pooled = interval(env$pooled),
    pooledBack = interval(env$pooled_back),
    Q = res$QE,
    Qdf = res$k - res$p,
    Qp = res$QEp,
    QM = if (length(moderators)) res$QM else NULL,
    QMdf = if (length(moderators)) I(res$QMdf[!is.na(res$QMdf)]) else NULL,
    QMp = if (length(moderators)) res$QMp else NULL,
    heterogeneity = het,
    fit = list(logLik = fs[1], deviance = fs[2], AIC = fs[3], BIC = fs[4], AICc = fs[5]),
    warnings = env$.warnings,
    engine = ps_engine("metafor")
  )
  if (bias && !is.null(env$egger)) {
    tfl <- env$filled
    fill <- tfl$fill
    out$bias <- list(
      egger = ps_meta_regtest(env$egger),
      rank = list(tau = unname(env$rank$tau), p = unname(env$rank$pval)),
      trimfill = list(
        k0 = tfl$k0,
        side = tfl$side,
        est = as.numeric(tfl$beta),
        se = tfl$se,
        p = tfl$pval,
        ciLow = tfl$ci.lb,
        ciHigh = tfl$ci.ub,
        tau2 = tfl$tau2,
        filled = lapply(which(fill), function(i) list(yi = tfl$yi[i], vi = tfl$vi[i]))
      ),
      pet = ps_meta_regtest(env$pet),
      peese = ps_meta_regtest(env$peese)
    )
  }
  if (influence && !is.null(env$inf)) {
    inf <- env$inf$inf
    out$influence <- lapply(seq_along(inf$rstudent), function(i) {
      list(
        label = study_labels[i],
        rstudent = inf$rstudent[i],
        dffits = inf$dffits[i],
        cook = inf$cook.d[i],
        covr = inf$cov.r[i],
        tau2del = inf$tau2.del[i],
        QEdel = inf$QE.del[i],
        hat = inf$hat[i],
        weight = inf$weight[i],
        influential = isTRUE(env$inf$is.infl[i])
      )
    })
    loo <- env$loo
    if (!is.null(loo)) {
      out$leaveOneOut <- lapply(seq_along(loo$estimate), function(i) {
        list(
          label = study_labels[i],
          est = loo$estimate[i],
          se = loo$se[i],
          p = loo$pval[i],
          ciLow = loo$ci.lb[i],
          ciHigh = loo$ci.ub[i],
          Q = loo$Q[i],
          Qp = loo$Qp[i],
          tau2 = loo$tau2[i],
          I2 = loo$I2[i]
        )
      })
    }
  }
  ps_json(out)
}
