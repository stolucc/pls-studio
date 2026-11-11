# The actor-partner interdependence model (APIM; Kenny, Kashy & Cook 2006) for dyads, from the columns
# of each member's X and Y: an observed variable (one column) or a latent variable (its items, in the
# same order for both members).
#
# Written as Sakaluk's dySEM::scriptAPIM writes the latent APIM: fixed-factor scaling on member 1; the
# items' loadings and intercepts equal across members; residual covariances of the same item across
# members. Distinguishable dyads leave the rest free. Indistinguishable dyads also hold equal the items'
# residual variances, the latent (or observed) variances and means of X, the residual variances and
# intercepts of Y, and the actor and partner effects.
#
# Both models are fitted; the LR test between them is the omnibus test of distinguishability (Kenny et
# al. 2006, ch. 6). k = partner / actor effect on the same member's Y (Kenny & Ledermann 2010), with
# delta-method and optionally percentile bootstrap intervals.

#' Syntax lines for a latent variable (`s`: "x" or "y"): items m1 (member 1) and m2 (member 2).
ps_apim_latent <- function(s, m1, m2, lv, dist) {
  S <- toupper(s)
  K <- seq_along(m1)
  load1 <- paste(sprintf("l%s%d*%s", s, K, m1), collapse = " + ")
  load2 <- paste(sprintf("l%s%d*%s", s, K, m2), collapse = " + ")
  items <- c(m1, m2)
  residuals <- if (dist) {
    sprintf("%s ~~ %s", items, items)
  } else {
    sprintf("%s ~~ th%s%d*%s", items, s, c(K, K), items)
  }
  what <- if (s == "x") "variance 1 and mean 0" else "residual variance 1 and intercept 0"
  scaling <- sprintf("# %s of member 1 scaled by %s; of member 2 %s", S, what, if (dist) "free" else "equal to them")
  free2 <- if (dist) "NA" else "1"
  mean2 <- if (dist) "NA" else "0"
  c(
    sprintf("# %s: latent, %d items per member; loadings and intercepts equal across members", S, length(m1)),
    sprintf("%s =~ NA*%s + %s", lv[1], m1[1], load1),
    sprintf("%s =~ NA*%s + %s", lv[2], m2[1], load2),
    sprintf("%s ~ t%s%d*1", items, s, c(K, K)),
    residuals,
    "# residuals of the same item covary across members",
    sprintf("%s ~~ %s", m1, m2),
    scaling,
    sprintf("%s ~~ 1*%s", lv[1], lv[1]),
    sprintf("%s ~~ %s*%s", lv[2], free2, lv[2]),
    sprintf("%s ~ 0*1", lv[1]),
    sprintf("%s ~ %s*1", lv[2], mean2)
  )
}

#' Syntax lines for an observed variable (`lv`: the two members' columns).
ps_apim_observed <- function(s, lv, dist) {
  S <- toupper(s)
  if (dist) {
    return(c(sprintf("# %s: observed", S), sprintf("%s ~~ %s", lv, lv)))
  }
  what <- if (s == "x") "variances and means" else "residual variances and intercepts"
  c(
    sprintf("# %s: observed, equal %s across members", S, what),
    sprintf("%s ~~ v%s*%s", lv, s, lv),
    sprintf("%s ~ m%s*1", lv, s)
  )
}

#' The model syntax for one dyad type (`dist`: distinguishable).
ps_apim_lines <- function(v, dist) {
  out <- character(0)
  for (s in c("x", "y")) {
    m1 <- v[[paste0(s, "1")]]
    m2 <- v[[paste0(s, "2")]]
    lv <- v$lv[[s]]
    lines <- if (length(m1) > 1) {
      ps_apim_latent(s, m1, m2, lv, dist)
    } else {
      ps_apim_observed(s, lv, dist)
    }
    out <- c(out, lines)
  }
  x <- v$lv$x
  y <- v$lv$y
  effects <- if (dist) {
    c(
      sprintf("%s ~ a1*%s + p1*%s", y[1], x[1], x[2]),
      sprintf("%s ~ a2*%s + p2*%s", y[2], x[2], x[1])
    )
  } else {
    c(
      sprintf("%s ~ a*%s + p*%s", y[1], x[1], x[2]),
      sprintf("%s ~ a*%s + p*%s", y[2], x[2], x[1])
    )
  }
  k <- if (dist) c("k1 := p1/a1", "k2 := p2/a2") else "k := p/a"
  c(
    out,
    "# Actor (a) and partner (p) effects on the Y of each member",
    effects,
    "# The X of the members covary, and so do their Y residuals (nonindependence)",
    sprintf("%s ~~ %s", x[1], x[2]),
    sprintf("%s ~~ %s", y[1], y[2]),
    "# k = partner / actor effect on the Y of the same member (Kenny & Ledermann 2010)",
    k
  )
}

#' The columns of the request's four roles, checked.
ps_apim_columns <- function(req) {
  keys <- c(x1 = "x1", x2 = "x2", y1 = "y1", y2 = "y2")
  cols <- lapply(keys, function(k) {
    v <- unlist(req[[k, exact = TRUE]])
    if (!is.character(v) || !length(v) || length(v) > 20) {
      stop("Choose the columns of X and Y for both members.")
    }
    v
  })
  if (length(cols$x1) != length(cols$x2) || length(cols$y1) != length(cols$y2)) {
    stop("Both members need the same number of items for X, and for Y.")
  }
  if (anyDuplicated(unlist(cols, use.names = FALSE))) stop("Each column can play one role only.")
  cols
}

#' One estimate (an effect or k) of the reported fit, with its bootstrap interval when there is one.
ps_apim_row <- function(pe, bc, lab) {
  i <- which(pe$label == lab & pe$op %in% c("~", ":="))[1]
  j <- if (is.null(bc)) NA else which(bc$label == lab & bc$op %in% c("~", ":="))[1]
  list(
    label = lab, est = pe$est[i], se = pe$se[i], z = pe$z[i], p = pe$pvalue[i],
    low = pe$ci.lower[i], high = pe$ci.upper[i],
    std = if (pe$op[i] == "~") pe$std.all[i] else NULL,
    bootLow = if (is.na(j)) NULL else bc$ci.lower[j],
    bootHigh = if (is.na(j)) NULL else bc$ci.upper[j]
  )
}

#' A covariance of the reported fit and its correlation (std.all).
ps_apim_cor <- function(pe, a, b) {
  i <- which(pe$op == "~~" & ((pe$lhs == a & pe$rhs == b) | (pe$lhs == b & pe$rhs == a)))[1]
  list(est = pe$est[i], se = pe$se[i], p = pe$pvalue[i], std = pe$std.all[i])
}

ps_apim <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  cols <- ps_apim_columns(req)
  if (!(identical(req$missing, "casewise") || identical(req$missing, "fiml"))) {
    stop("The APIM takes casewise deletion or FIML for missing values.")
  }
  dist <- !identical(req$dyads, "indistinguishable")
  fr <- ps_long_frame(req, unlist(cols, use.names = FALSE))
  o <- ps_long_options(req)
  v <- lapply(cols, function(cs) unname(fr$v[cs]))
  # Latent variables are named X1, X2, Y1, Y2 (never a column's name); an observed one is its column.
  lv_names <- function(s) {
    n <- paste0(s, 1:2)
    while (any(n %in% fr$v)) n <- paste0(n, "_lv")
    n
  }
  v$lv <- list(
    x = if (length(v$x1) > 1) lv_names("X") else c(v$x1, v$x2),
    y = if (length(v$y1) > 1) lv_names("Y") else c(v$y1, v$y2)
  )

  boot <- req[["boot", exact = TRUE]]
  B <- 0L
  level <- 0.95
  if (!is.null(boot)) {
    B <- as.integer(ps_number(boot$samples, "bootstrap samples"))
    if (is.na(B) || B < 50L || B > 100000L) {
      stop("The number of bootstrap samples must be between 50 and 100000.")
    }
    level <- ps_number(boot$level, "confidence level")
    if (level <= 0.5 || level >= 1) stop("Invalid confidence level in the request.")
    seed <- as.integer(ps_number(boot$seed, "seed"))
  }

  call <- function(name, model, more = "") {
    sprintf(
      "%s <- sem(%s, data = data, meanstructure = TRUE, fixed.x = FALSE, estimator = \"%s\"%s%s%s)",
      name, model, o$est, ps_lavaan_missing(req$missing), o$extra, more
    )
  }
  reported <- if (dist) "apim_dist" else "apim_indist"
  boot_lines <- if (B > 0) {
    c(
      "# Percentile bootstrap intervals of the effects and k",
      sprintf("set.seed(%d)", seed),
      call("fit_boot", reported, sprintf(", se = \"bootstrap\", bootstrap = %dL", B)),
      sprintf("boot_ci <- parameterEstimates(fit_boot, boot.ci.type = \"perc\", level = %s)", format(level))
    )
  }
  body <- c(
    "suppressPackageStartupMessages(library(lavaan))",
    if (!o$fiml) ps_missing_code(req$missing),
    "# APIM for distinguishable dyads: effects, variances and means free for each member",
    "apim_dist <- '", paste0("  ", ps_apim_lines(v, TRUE)), "'",
    "# APIM for indistinguishable dyads: the same with the parameters of the members held equal",
    "apim_indist <- '", paste0("  ", ps_apim_lines(v, FALSE)), "'",
    call("fit_dist", "apim_dist"),
    call("fit_indist", "apim_indist"),
    "# Omnibus test of distinguishability: do the parameters of the members differ?",
    "distinguishability <- lavTestLRT(fit_indist, fit_dist)",
    sprintf("fit <- %s  # the model reported", if (dist) "fit_dist" else "fit_indist"),
    sprintf("estimates <- parameterEstimates(fit, standardized = TRUE, level = %s)", format(level)),
    boot_lines
  )
  inputs <- list(data = fr$data)
  if (export) {
    title <- sprintf("Actor-partner interdependence model, %s dyads (lavaan)", if (dist) "distinguishable" else "indistinguishable")
    report <- c(
      "summary(fit, fit.measures = TRUE, standardized = TRUE)", "distinguishability",
      if (B > 0) "subset(boot_ci, op %in% c(\"~\", \":=\"))"
    )
    return(ps_script(title, "lavaan", inputs, body, report))
  }

  env <- ps_run(body, inputs)
  pe <- env$estimates
  bc <- if (B > 0) env$boot_ci else NULL
  effects <- if (dist) c("a1", "a2", "p1", "p2") else c("a", "p")
  ks <- if (dist) c("k1", "k2") else "k"
  cmp <- env$distinguishability
  ps_json(list(
    n = lavaan::lavInspect(env$fit, "nobs"),
    dyads = if (dist) "distinguishable" else "indistinguishable",
    latent = list(x = length(v$x1) > 1, y = length(v$y1) > 1),
    effects = lapply(effects, function(l) ps_apim_row(pe, bc, l)),
    k = lapply(ks, function(l) ps_apim_row(pe, bc, l)),
    xCor = ps_apim_cor(pe, v$lv$x[1], v$lv$x[2]),
    yCor = ps_apim_cor(pe, v$lv$y[1], v$lv$y[2]),
    fit = ps_long_fit(env$fit),
    distFit = ps_long_fit(env$fit_dist),
    indistFit = ps_long_fit(env$fit_indist),
    test = list(
      chisqDiff = unname(cmp[["Chisq diff"]][2]), dfDiff = unname(cmp[["Df diff"]][2]),
      p = unname(cmp[["Pr(>Chisq)"]][2])
    ),
    level = level, boot = B, warnings = env$.warnings, engine = ps_engine("lavaan")
  ))
}
