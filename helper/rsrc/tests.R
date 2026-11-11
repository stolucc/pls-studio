# Basic statistical tests with base R (stats): t-tests and their rank-based
# counterparts, ANOVA and ANCOVA, repeated-measures ANOVA, MANOVA, correlations,
# contingency tables, binomial and multinomial tests. Each function writes the
# script it runs (exported as is); this file shapes the output.

#' Lines that turn a coded column into a factor with its category names (codes 1..k
#' of a text column), or with its values as levels; self-contained in the script.
ps_bt_factor_line <- function(req, fr, n) {
  vn <- fr$v[[n]]
  x <- fr$data[[vn]]
  codes <- sort(unique(x[!is.na(x)]))
  l <- unlist(req$categories[[n]])
  labels <- if (!is.null(l) && length(codes) && all(codes %in% seq_along(l))) {
    l[codes]
  } else {
    format(codes, trim = TRUE)
  }
  sprintf(
    "data$%s <- factor(data$%s, levels = c(%s), labels = %s)",
    vn,
    vn,
    paste(format(codes, digits = 15, trim = TRUE), collapse = ", "),
    ps_q(labels)
  )
}

#' A column's own name from its R name (other text, e.g. a factor name, as it is).

ps_bt_alt <- function(req) {
  a <- req$alternative %||% "two.sided"
  if (!a %in% c("two.sided", "greater", "less")) {
    stop("Invalid alternative hypothesis in the request.")
  }
  a
}
ps_bt_conf <- function(req) {
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  if (conf <= 0 || conf >= 1) stop("Invalid confidence level in the request.")
  conf
}
ps_htest <- function(h) {
  if (is.null(h)) {
    NULL
  } else {
    list(
      stat = unname(h$statistic),
      df = if (is.null(h$parameter)) NULL else unname(h$parameter),
      p = unname(h$p.value),
      ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1],
      ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2],
      estimate = if (is.null(h$estimate)) NULL else unname(h$estimate[1])
    )
  }
}
ps_shapiro <- function(x) {
  x <- x[!is.na(x)]
  if (length(x) < 3 || length(x) > 5000 || stats::sd(x) == 0) NULL else ps_htest(stats::shapiro.test(x))
}
ps_desc <- function(x) {
  x <- x[!is.na(x)]
  list(
    n = length(x),
    mean = mean(x),
    sd = if (length(x) > 1) stats::sd(x) else NULL,
    se = if (length(x) > 1) stats::sd(x) / sqrt(length(x)) else NULL,
    median = stats::median(x)
  )
}

#' t-tests: one sample, paired samples, independent samples (Student, Welch), with
#' the Wilcoxon signed-rank / Mann-Whitney tests, Cohen's d and the rank-biserial
#' correlation, Shapiro-Wilk and (independent samples) Levene's test.
ps_ttest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "one"
  if (!type %in% c("one", "paired", "independent")) stop("Invalid t-test type in the request.")
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  mu <- ps_number(req$testValue %||% 0, "test value")
  student <- isTRUE(req$student %||% TRUE)
  welch <- isTRUE(req$welch)
  rank <- isTRUE(req$rank)
  if (!student && !welch && !rank) stop("Choose at least one test.")
  es <- isTRUE(req$effectSizes)
  tost <- if (!is.null(req$tost)) ps_tost_bounds(req$tost)
  pairs <- if (type == "paired") ps_string_rows(req$pairs) else NULL
  vars <- if (type == "paired") unique(unlist(pairs)) else unlist(req$vars)
  if (!length(vars)) {
    stop(if (type == "paired") "Choose at least one pair of variables." else "Choose at least one variable.")
  }
  for (p in pairs) if (length(p) != 2 || p[1] == p[2]) stop("Each pair needs two different variables.")
  group <- req$group %||% ""
  if (type == "independent" && !nzchar(group)) stop("Choose the grouping variable.")
  fr <- ps_long_frame(req, unique(c(vars, if (type == "independent") group)))
  v <- fr$v
  a <- sprintf("alternative = \"%s\", conf.level = %s", alt, format(conf))
  body <- character(0)
  out <- list()
  if (type == "independent") {
    body <- c(ps_bt_factor_line(req, fr, group), sprintf("g <- data$%s", v[[group]]))
    lv <- levels(factor(fr$data[[v[[group]]]]))
    if (length(lv) != 2) {
      stop(sprintf("The grouping variable must have exactly two groups; %s has %d.", group, length(lv)))
    }
  }
  for (k in seq_along(if (type == "paired") pairs else vars)) {
    if (type == "paired") {
      p <- pairs[[k]]
      x <- sprintf("data$%s", v[[p[1]]])
      y <- sprintf("data$%s", v[[p[2]]])
      label <- paste(p, collapse = " - ")
    } else {
      x <- sprintf("data$%s", v[[vars[k]]])
      label <- vars[k]
    }
    r <- sprintf("r%d", k)
    body <- c(body, sprintf("# %s", ps_comment(label)), sprintf("%s <- list()", r))
    if (type == "one") {
      body <- c(
        body,
        sprintf("y <- %s[!is.na(%s)]", x, x),
        if (student) sprintf("%s$student <- t.test(y, mu = %s, %s)", r, format(mu, digits = 15), a),
        if (rank) sprintf("%s$rank <- wilcox.test(y, mu = %s, alternative = \"%s\", exact = FALSE)", r, format(mu, digits = 15), alt),
        sprintf("%s$d <- (mean(y) - %s) / sd(y)  # Cohen's d", r, format(mu, digits = 15)),
        sprintf(
          "nz <- sum(y != %s); %s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (nz * (nz + 1) / 2) - 1  # rank-biserial correlation",
          format(mu, digits = 15),
          r,
          r,
          r
        ),
        sprintf("%s$shapiro <- if (length(y) >= 3 && length(y) <= 5000) shapiro.test(y)", r)
      )
    } else if (type == "paired") {
      body <- c(
        body,
        sprintf("ok <- complete.cases(%s, %s); x1 <- %s[ok]; x2 <- %s[ok]; dif <- x1 - x2", x, y, x, y),
        if (student) sprintf("%s$student <- t.test(x1, x2, paired = TRUE, %s)", r, a),
        if (rank) sprintf("%s$rank <- wilcox.test(x1, x2, paired = TRUE, alternative = \"%s\", exact = FALSE)", r, alt),
        sprintf("%s$d <- mean(dif) / sd(dif)  # Cohen's d (of the differences)", r),
        sprintf(
          "nz <- sum(dif != 0); %s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (nz * (nz + 1) / 2) - 1  # rank-biserial correlation",
          r,
          r,
          r
        ),
        sprintf(
          "%s$shapiro <- if (length(dif) >= 3 && length(dif) <= 5000) shapiro.test(dif)  # normality of the differences",
          r
        )
      )
    } else {
      body <- c(
        body,
        sprintf("ok <- !is.na(%s) & !is.na(g); y <- %s[ok]; gg <- droplevels(g[ok])", x, x),
        sprintf("y1 <- y[gg == levels(gg)[1]]; y2 <- y[gg == levels(gg)[2]]"),
        if (student) sprintf("%s$student <- t.test(y1, y2, var.equal = TRUE, %s)", r, a),
        if (welch) sprintf("%s$welch <- t.test(y1, y2, var.equal = FALSE, %s)", r, a),
        if (rank) sprintf("%s$rank <- wilcox.test(y1, y2, alternative = \"%s\", exact = FALSE)", r, alt),
        sprintf("n1 <- length(y1); n2 <- length(y2)"),
        sprintf(
          "%s$d <- (mean(y1) - mean(y2)) / sqrt(((n1 - 1) * var(y1) + (n2 - 1) * var(y2)) / (n1 + n2 - 2))  # Cohen's d (pooled SD)",
          r
        ),
        sprintf(
          "%s$dWelch <- (mean(y1) - mean(y2)) / sqrt((var(y1) + var(y2)) / 2)  # Cohen's d (average variance)",
          r
        ),
        sprintf(
          "%s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (n1 * n2) - 1  # rank-biserial correlation",
          r,
          r,
          r
        ),
        sprintf(
          "%s$levene <- anova(lm(abs(y - ave(y, gg, FUN = median)) ~ gg))  # Levene's test (median-centred, Brown-Forsythe)",
          r
        ),
        sprintf(
          "%s$shapiro <- lapply(list(y1, y2), function(z) if (length(z) >= 3 && length(z) <= 5000) shapiro.test(z))",
          r
        )
      )
    }
    if (es) {
      body <- c(body, ps_es_ttest_lines(type, r, conf, alt, mu, welch, rank))
    }
    if (!is.null(tost)) {
      body <- c(body, ps_tost_ttest_lines(type, r, tost, conf, mu, welch))
    }
  }
  inputs <- list(data = fr$data)
  title <- c(one = "One-sample t-test", paired = "Paired-samples t-test", independent = "Independent-samples t-test")[[type]]
  if (export) {
    pkgs <- c(if (es) "effectsize", if (!is.null(tost)) "TOSTER")
    report <- sprintf("r%d", seq_along(if (type == "paired") pairs else vars))
    return(ps_script(title, pkgs, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(if (type == "paired") pairs else vars), function(k) {
    r <- env[[sprintf("r%d", k)]]
    d <- fr$data
    desc <- if (type == "one") {
      list(ps_desc(d[[v[[vars[k]]]]]))
    } else if (type == "paired") {
      p <- pairs[[k]]
      ok <- stats::complete.cases(d[[v[[p[1]]]]], d[[v[[p[2]]]]])
      list(ps_desc(d[[v[[p[1]]]]][ok]), ps_desc(d[[v[[p[2]]]]][ok]))
    } else {
      y <- d[[v[[vars[k]]]]]
      g <- factor(d[[v[[group]]]])
      lapply(levels(g), function(l) ps_desc(y[!is.na(g) & g == l]))
    }
    list(
      label = if (type == "paired") paste(pairs[[k]], collapse = " - ") else vars[k],
      variables = if (type == "paired") pairs[[k]] else vars[k],
      student = ps_htest(r$student),
      welch = ps_htest(r$welch),
      rank = ps_htest(r$rank),
      d = r$d,
      dWelch = r$dWelch,
      rankBiserial = r$rb,
      levene = if (!is.null(r$levene)) list(stat = r$levene$`F value`[1], df1 = r$levene$Df[1], df2 = r$levene$Df[2], p = r$levene$`Pr(>F)`[1]) else NULL,
      shapiro = if (type == "independent") lapply(r$shapiro, ps_htest) else list(ps_htest(r$shapiro)),
      descriptives = desc,
      effects = ps_es_rows(r$es),
      tost = ps_tost_result(r$tost)
    )
  })
  groups <- if (type == "independent") {
    g <- fr$data[[v[[group]]]]
    codes <- sort(unique(g[!is.na(g)]))
    l <- unlist(req$categories[[group]])
    if (!is.null(l) && all(codes %in% seq_along(l))) l[codes] else format(codes, trim = TRUE)
  } else {
    NULL
  }
  ps_json(list(
    type = type, alternative = alt, testValue = mu, confidence = conf, groups = groups, rows = rows,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' ANOVA and ANCOVA: lm with every interaction of the factors (or main effects
#' only), covariates added; type III (sum-to-zero contrasts, drop1) or type I
#' (sequential) sums of squares; eta-squared, partial eta-squared and
#' omega-squared; Levene and Shapiro-Wilk on the residuals; with one factor and no
#' covariates also Welch's ANOVA, Kruskal-Wallis and Tukey's post hoc comparisons.
ps_anova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$dependent %||% ""
  fac <- unlist(req$factors)
  cov <- unlist(req$covariates)
  if (!nzchar(y) || !length(fac)) stop("Choose the dependent variable and at least one factor.")
  ss <- req$ssType %||% "III"
  if (!ss %in% c("I", "III")) stop("Invalid type of sums of squares in the request.")
  full <- !identical(req$interactions, FALSE)
  es <- isTRUE(req$effectSizes)
  seed <- ps_number(req$seed %||% 1234, "seed")
  fr <- ps_long_frame(req, unique(c(y, fac, cov)))
  v <- fr$v
  rhs <- paste(
    c(
      paste(vapply(fac, function(n) v[[n]], ""), collapse = if (full) " * " else " + "),
      vapply(cov, function(n) v[[n]], "")
    ),
    collapse = " + "
  )
  fml <- sprintf("%s ~ %s", v[[y]], rhs)
  oneway <- length(fac) == 1 && !length(cov)
  adjust <- ps_p_adjust(req)
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(y, fac, cov)])))),
    "# Factors (their levels as the groups).",
    vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    if (ss == "III") c("# Type III sums of squares: sum-to-zero contrasts, each term dropped from the full model.", "options(contrasts = c(\"contr.sum\", \"contr.poly\"))") else "options(contrasts = c(\"contr.treatment\", \"contr.poly\"))",
    sprintf("fit <- lm(%s, data = data)", fml),
    if (ss == "III") "tab <- drop1(fit, ~ ., test = \"F\")" else "tab <- anova(fit)",
    "res <- residuals(fit)",
    "shapiro <- if (length(res) >= 3 && length(res) <= 5000) shapiro.test(res)  # normality of the residuals",
    sprintf("cells <- interaction(data[, %s], drop = TRUE)", ps_q(unname(unlist(v[fac])))),
    sprintf(
      "levene <- anova(lm(abs(data$%s - ave(data$%s, cells, FUN = median)) ~ cells))  # Levene's test (median-centred)",
      v[[y]],
      v[[y]]
    ),
    if (oneway) {
      c(
        sprintf("welch <- oneway.test(%s, data = data, var.equal = FALSE)  # Welch's ANOVA", fml),
        sprintf("kruskal <- kruskal.test(%s, data = data)", fml),
        sprintf("tukey <- TukeyHSD(aov(%s, data = data), conf.level = %s)", fml, format(ps_bt_conf(req))),
        "# After Kruskal-Wallis: pairwise Wilcoxon rank-sum tests, p adjusted by Holm's method.",
        sprintf(
          "pwRank <- pairwise.wilcox.test(data$%s, data$%s, p.adjust.method = \"holm\", exact = FALSE)",
          v[[y]],
          v[[fac[1]]]
        ),
        ps_dunn_lines(v[[y]], v[[fac[1]]], adjust)
      )
    },
    if (es) ps_es_anova_lines(ss, ps_bt_conf(req), oneway, fml, seed)
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "tab", "shapiro", "levene",
      if (oneway) c("welch", "kruskal", "tukey", "pwRank", "dunn"),
      if (es) c("es", if (oneway) "epsilon2")
    )
    pkgs <- if (es) "effectsize" else character(0)
    return(ps_script(if (length(cov)) "ANCOVA" else "ANOVA", pkgs, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  fit <- env$fit
  tab <- env$tab
  d <- env$data
  ssres <- sum(residuals(fit)^2)
  dfres <- df.residual(fit)
  msres <- ssres / dfres
  sstot <- sum((d[[v[[y]]]] - mean(d[[v[[y]]]]))^2)
  terms <- setdiff(rownames(tab), c("<none>", "Residuals"))
  back <- function(t) ps_back_term(t, fr$back)
  rows <- lapply(terms, function(t) {
    s <- if (ss == "III") tab[t, "Sum of Sq"] else tab[t, "Sum Sq"]
    df <- tab[t, "Df"]
    f <- if (ss == "III") tab[t, "F value"] else tab[t, "F value"]
    p <- tab[t, "Pr(>F)"]
    list(
      term = back(t),
      ss = s,
      df = df,
      ms = s / df,
      f = f,
      p = p,
      eta2 = s / sstot,
      partialEta2 = s / (s + ssres),
      omega2 = (s - df * msres) / (sstot + msres)
    )
  })
  cells <- split(d[[v[[y]]]], interaction(d[fac], drop = TRUE, sep = " · "))
  tk <- if (oneway) {
    m <- env$tukey[[1]]
    lapply(
      seq_len(nrow(m)),
      function(i) list(comparison = rownames(m)[i], diff = m[i, "diff"], ciLow = m[i, "lwr"], ciHigh = m[i, "upr"], p = m[i, "p adj"])
    )
  } else {
    NULL
  }
  ps_json(list(
    dependent = y,
    factors = fac,
    covariates = cov,
    ssType = ss,
    formula = fml,
    table = rows,
    residual = list(ss = ssres, df = dfres, ms = msres),
    n = nrow(d),
    levene = list(stat = env$levene$`F value`[1], df1 = env$levene$Df[1], df2 = env$levene$Df[2], p = env$levene$`Pr(>F)`[1]),
    shapiro = ps_htest(env$shapiro),
    welch = if (oneway) ps_htest(env$welch) else NULL,
    welchDf2 = if (oneway) unname(env$welch$parameter[2]) else NULL,
    kruskal = if (oneway) ps_htest(env$kruskal) else NULL,
    tukey = tk,
    pairwiseRank = if (oneway) {
      m <- env$pwRank$p.value
      Filter(
        Negate(is.null),
        unlist(
          lapply(colnames(m), function(a) lapply(rownames(m), function(b) if (!is.na(m[b, a])) list(comparison = paste(b, "-", a), pHolm = m[b, a]))),
          recursive = FALSE
        )
      )
    } else {
      NULL
    },
    dunn = if (oneway) ps_dunn_result(env),
    adjust = if (oneway) adjust,
    cells = lapply(names(cells), function(k) c(list(cell = k), ps_desc(cells[[k]]))),
    effects = ps_es_anova_result(env, fr$back),
    epsilon2 = if (!is.null(env$epsilon2)) ps_es_row("epsilon2", env$epsilon2) else NULL,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Repeated-measures ANOVA: one within-subject factor (one column per level, wide)
#' and optionally one between-subject factor. The univariate tests (aov with an
#' error stratum per subject), Mauchly's test of sphericity, the Greenhouse-Geisser
#' and Huynh-Feldt corrections (anova.mlm, test = "Spherical"); Friedman's test
#' without a between factor.
ps_rmanova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  design <- ps_rm_design(req)
  # Several between-subjects factors (car's ?Anova: treatment * gender): the multivariate linear model, type II tests (car::Anova).
  more <- as.character(unlist(req$moreBetween))
  if (length(more)) {
    between <- req$between %||% ""
    if (!nzchar(between)) stop("Choose the first between-subjects factor before further ones.")
    betweens <- c(between, more)
    if (anyDuplicated(betweens) || length(betweens) > 4) {
      stop("Choose up to four different between-subjects factors.")
    }
    if (is.null(design)) {
      within <- as.character(unlist(req$levels))
      fname <- req$factorName %||% "condition"
      if (length(within) < 2) {
        stop("Choose at least two columns: one per level of the within-subject factor.")
      }
      if (!grepl("^[A-Za-z][A-Za-z0-9_.]{0,30}$", fname) || fname %in% c("subject", "y")) {
        stop("The factor name must be a letter followed by letters, digits, _ or . (at most 31).")
      }
      design <- list(names = fname, levels = list(within), cells = within, single = TRUE)
    }
    return(ps_rmanova_car(req, design, betweens, export))
  }
  if (!is.null(design)) {
    return(ps_rmanova_multi(req, design, export))
  }
  within <- unlist(req$levels)
  between <- req$between %||% ""
  if (length(within) < 2) {
    stop("Choose at least two columns: one per level of the within-subject factor.")
  }
  fname <- req$factorName %||% "condition"
  if (!grepl("^[A-Za-z][A-Za-z0-9_.]{0,30}$", fname)) {
    stop("The factor name must be a letter followed by letters, digits, _ or . (at most 31).")
  }
  fr <- ps_long_frame(req, unique(c(within, if (nzchar(between)) between)))
  v <- fr$v
  W <- ps_q(unname(unlist(v[within])))
  bt <- nzchar(between)
  adjust <- ps_p_adjust(req)
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(within, if (bt) between)])))),
    if (bt) ps_bt_factor_line(req, fr, between),
    sprintf("Y <- as.matrix(data[, %s])", W),
    sprintf(
      "long <- data.frame(subject = factor(rep(seq_len(nrow(Y)), ncol(Y))), %s = factor(rep(%s, each = nrow(Y)), levels = %s), y = c(Y)%s)",
      fname,
      ps_q(within),
      ps_q(within),
      if (bt) sprintf(", %s = rep(data$%s, ncol(Y))", v[[between]], v[[between]]) else ""
    ),
    sprintf(
      "fit <- aov(y ~ %s%s + Error(subject/%s), data = long)",
      fname,
      if (bt) sprintf(" * %s", v[[between]]) else "",
      fname
    ),
    sprintf("mlm <- lm(Y ~ %s)", if (bt) sprintf("data$%s", v[[between]]) else "1"),
    "mauchly <- mauchly.test(mlm, X = ~ 1)",
    "spher <- anova(mlm, X = ~ 1, test = \"Spherical\")  # Greenhouse-Geisser and Huynh-Feldt corrections",
    if (!bt) c("friedman <- friedman.test(Y)", ps_conover_lines(adjust)),
    "# Post hoc: every pair of levels by a paired t-test, p adjusted by Holm's method.",
    "pairs <- combn(ncol(Y), 2, simplify = FALSE)",
    "posthoc <- lapply(pairs, function(p) t.test(Y[, p[1]], Y[, p[2]], paired = TRUE))",
    "pHolm <- p.adjust(vapply(posthoc, function(h) h$p.value, 0), method = \"holm\")"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Repeated-measures ANOVA", character(0), inputs, body, c("summary(fit)", "mauchly", "spher", if (!bt) c("friedman", "conover"), "data.frame(pair = vapply(pairs, paste, \"\", collapse = \" - \"), p = vapply(posthoc, function(h) h$p.value, 0), pHolm)")))
  }
  env <- ps_run(body, inputs)
  sm <- summary(env$fit)
  strat <- function(s) {
    t <- s[[1]]
    rn <- trimws(rownames(t))
    lapply(
      seq_len(nrow(t)),
      function(i) list(term = rn[i], ss = t[i, "Sum Sq"], df = t[i, "Df"], ms = t[i, "Mean Sq"], f = if ("F value" %in% colnames(t)) t[i, "F value"] else NULL, p = if ("Pr(>F)" %in% colnames(t)) t[i, "Pr(>F)"] else NULL)
    )
  }
  bs <- strat(sm[[grep(": subject$", names(sm))]])
  ws <- strat(sm[[grep(sprintf(": subject:%s$", fname), names(sm))]])
  ren <- function(rows) {
    lapply(rows, function(r) {
      r$term <- if (r$term == "Residuals") "Residuals" else ps_back_term(r$term, fr$back)
      r
    })
  }
  bs <- ren(bs)
  ws <- ren(ws)
  res_w <- Filter(function(r) r$term == "Residuals", ws)[[1]]$ss
  res_b <- if (length(Filter(function(r) r$term == "Residuals", bs))) {
    Filter(function(r) r$term == "Residuals", bs)[[1]]$ss
  } else {
    NULL
  }
  pe <- function(rows, res) {
    lapply(rows, function(r) {
      if (r$term != "Residuals" && !is.null(res)) r$partialEta2 <- r$ss / (r$ss + res)
      r
    })
  }
  sp <- env$spher
  # (rows of anova.mlm: (Intercept) is the within factor, the between factor its interaction with it)
  k <- ncol(env$Y) - 1
  S <- crossprod(residuals(env$mlm)) / df.residual(env$mlm)
  C <- stats::contr.poly(ncol(env$Y))
  M <- t(C) %*% S %*% C
  gg <- sum(diag(M))^2 / (k * sum(diag(M %*% M)))
  n <- df.residual(env$mlm)
  hf <- min(1, ((n + 1) * k * gg - 2) / (k * (n - k * gg)))
  corr <- lapply(
    seq_len(nrow(sp) - 1),
    function(i) list(term = if (i == 1) fname else paste(fname, "\u00d7", between), p = sp[i, "Pr(>F)"], pGG = sp[i, "G-G Pr"], pHF = sp[i, "H-F Pr"])
  )
  ps_json(list(
    factorName = fname, levels = within, between = between, n = nrow(env$Y),
    within = pe(ws, res_w), betweenTable = pe(bs, res_b),
    sphericity = list(w = unname(env$mauchly$statistic), p = env$mauchly$p.value, gg = gg, hf = hf), corrected = corr,
    friedman = if (!bt) ps_htest(env$friedman) else NULL,
    conover = if (!bt) ps_conover_result(env, within),
    adjust = if (!bt) adjust,
    posthoc = lapply(seq_along(env$pairs), function(i) {
      p <- env$pairs[[i]]
      h <- env$posthoc[[i]]
      list(
        comparison = paste(within[p[1]], "-", within[p[2]]),
        diff = unname(h$estimate),
        t = unname(h$statistic),
        df = unname(h$parameter),
        p = h$p.value,
        pHolm = env$pHolm[i]
      )
    }),
    cells = lapply(within, function(l) c(list(cell = l), ps_desc(env$Y[, v[[l]]]))),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Several within-subject factors (SPSS's and JASP's "define factors"): `factors`, each
#' a name and its level names, and `cells`, one wide column per combination of levels
#' (the first factor varying slowest, the last fastest). NULL for the one-factor design
#' (`levels`, `factorName`), which keeps its own code.
ps_rm_design <- function(req) {
  fs <- req$factors
  if (is.null(fs) || length(fs) < 2) {
    return(NULL)
  }
  if (!is.list(fs) || length(fs) > 4) stop("At most four within-subject factors.")
  nm <- vapply(fs, function(f) {
    x <- f$name
    if (is.character(x) && length(x) == 1) x else ""
  }, "")
  lv <- lapply(fs, function(f) as.character(unlist(f$levels)))
  for (k in seq_along(fs)) {
    if (!grepl("^[A-Za-z][A-Za-z0-9_.]{0,30}$", nm[k]) || nm[k] %in% c("subject", "y")) {
      stop("Each factor name must be a letter followed by letters, digits, _ or . (at most 31), and not subject or y.")
    }
    if (length(lv[[k]]) < 2 || length(lv[[k]]) > 50 || anyDuplicated(lv[[k]]) || any(!nzchar(lv[[k]]))) {
      stop(sprintf("Factor %s needs at least two distinct, named levels.", nm[k]))
    }
  }
  if (anyDuplicated(nm)) stop("The within-subject factors need different names.")
  cells <- as.character(unlist(req$cells))
  if (length(cells) != prod(lengths(lv)) || any(!nzchar(cells)) || anyDuplicated(cells)) {
    stop(sprintf("Assign a different column to each of the %d cells.", prod(lengths(lv))))
  }
  list(names = nm, levels = lv, cells = cells)
}

#' Script lines of a several-factor design: `idata` (one row per cell, in the order of
#' the cells) and `long` (one row per subject and cell; `bvar`: the between factor's R name or "").
ps_rm_design_lines <- function(design, cellsR, bvar) {
  k <- length(design$names)
  fac <- vapply(
    rev(seq_len(k)),
    function(i) sprintf("%s = factor(%s, levels = %s)", design$names[i], ps_q(design$levels[[i]]), ps_q(design$levels[[i]])),
    ""
  )
  c(
    "# The within-subject design: one row per cell (wide column), the last factor varying fastest.",
    sprintf("idata <- expand.grid(%s, KEEP.OUT.ATTRS = FALSE)[, %s]", paste(fac, collapse = ", "), ps_q(design$names)),
    sprintf("Y <- as.matrix(data[, %s])", ps_q(cellsR)),
    sprintf(
      "long <- data.frame(subject = factor(rep(seq_len(nrow(Y)), ncol(Y))), idata[rep(seq_len(ncol(Y)), each = nrow(Y)), , drop = FALSE], y = c(Y)%s)",
      if (nzchar(bvar)) sprintf(", %s = rep(data$%s, ncol(Y))", bvar, bvar) else ""
    ),
    "rownames(long) <- NULL"
  )
}

#' The within-subject effects of a design: every non-empty set of the factors, main effects first (as aov orders them).
ps_rm_effects <- function(names) {
  sets <- unlist(lapply(seq_along(names), function(m) combn(names, m, simplify = FALSE)), recursive = FALSE)
  sets
}

#' Repeated-measures ANOVA with several within-subject factors (and optionally one
#' between factor): aov with an error stratum per within effect, and for each
#' within effect the multivariate linear model's sphericity test (Mauchly) and the
#' Greenhouse-Geisser and Huynh-Feldt corrections (anova.mlm on the effect's
#' contrasts, `M` and `X` over `idata`, as car::Anova's idesign).
ps_rmanova_multi <- function(req, design, export) {
  between <- req$between %||% ""
  bt <- nzchar(between)
  fr <- ps_long_frame(req, unique(c(design$cells, if (bt) between)))
  v <- fr$v
  bvar <- if (bt) v[[between]] else ""
  if (bt && bvar %in% c("subject", "y", "idata", design$names)) {
    stop("Rename the between factor: its name is taken by a within-subject factor or the model.")
  }
  cellsR <- unname(unlist(v[design$cells]))
  effects <- ps_rm_effects(design$names)
  wf <- paste(design$names, collapse = " * ")
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(design$cells, if (bt) between)])))),
    if (bt) ps_bt_factor_line(req, fr, between),
    ps_rm_design_lines(design, cellsR, bvar),
    sprintf("fit <- aov(y ~ %s%s + Error(subject/(%s)), data = long)", wf, if (bt) sprintf(" * %s", bvar) else "", wf),
    sprintf("mlm <- lm(Y ~ %s)", if (bt) sprintf("data$%s", bvar) else "1"),
    "# Each within effect: its contrasts are the cells' space of the effect's factors (M) less that of their lower-order terms (X).",
    "effects <- list(",
    paste0("  ", vapply(effects, function(e) {
      sprintf(
        "%s = list(M = ~ %s, X = ~ %s)",
        encodeString(paste(e, collapse = ":"), quote = "`"),
        paste(e, collapse = " * "),
        if (length(e) == 1) "1" else if (length(e) == 2) paste(e, collapse = " + ") else sprintf("(%s)^%d", paste(e, collapse = " + "), length(e) - 1)
      )
    }, ""), collapse = ",\n"),
    ")",
    "spher <- lapply(effects, function(e) anova(mlm, M = e$M, X = e$X, idata = idata, test = \"Spherical\"))  # Greenhouse-Geisser and Huynh-Feldt corrections",
    "mauchly <- lapply(effects, function(e) mauchly.test(mlm, M = e$M, X = e$X, idata = idata))  # (an effect with one degree of freedom is spherical)",
    PS_RM_LEVEL_TESTS[c(1, if (!bt) 2, 3)]
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Repeated-measures ANOVA", character(0), inputs, body, c("summary(fit)", "mauchly", "spher", if (!bt) "friedman", "posthoc")))
  }
  env <- ps_run(body, inputs)
  sm <- summary(env$fit)
  back <- function(t) ps_back_term(trimws(t), fr$back)
  strat <- function(s, stratum) {
    t <- s[[1]]
    rn <- trimws(rownames(t))
    res <- if ("Residuals" %in% rn) t[which(rn == "Residuals"), "Sum Sq"] else NULL
    lapply(seq_len(nrow(t)), function(i) {
      r <- list(
        term = if (rn[i] == "Residuals") "Residuals" else back(rn[i]),
        stratum = stratum,
        ss = t[i, "Sum Sq"],
        df = t[i, "Df"],
        ms = t[i, "Mean Sq"],
        f = if ("F value" %in% colnames(t)) t[i, "F value"] else NULL,
        p = if ("Pr(>F)" %in% colnames(t)) t[i, "Pr(>F)"] else NULL
      )
      if (rn[i] != "Residuals" && !is.null(res)) r$partialEta2 <- r$ss / (r$ss + res)
      r
    })
  }
  bs <- strat(sm[[which(names(sm) == "Error: subject")]], "subject")
  ws <- unlist(lapply(effects, function(e) {
    key <- sprintf("Error: subject:%s", paste(e, collapse = ":"))
    strat(sm[[which(names(sm) == key)]], back(paste(e, collapse = ":")))
  }), recursive = FALSE)
  S <- crossprod(residuals(env$mlm)) / df.residual(env$mlm)
  n <- df.residual(env$mlm)
  proj <- function(f) {
    m <- stats::model.matrix(f, env$idata)
    m %*% solve(crossprod(m), t(m))
  }
  sph <- list()
  corr <- list()
  for (i in seq_along(effects)) {
    e <- env$effects[[i]]
    term <- back(paste(effects[[i]], collapse = ":"))
    Tm <- proj(e$M) - proj(e$X)
    k <- round(sum(diag(Tm)))
    C <- eigen(Tm, symmetric = TRUE)$vectors[, seq_len(k), drop = FALSE]
    M <- t(C) %*% S %*% C
    gg <- sum(diag(M))^2 / (k * sum(diag(M %*% M)))
    hf <- min(1, ((n + 1) * k * gg - 2) / (k * (n - k * gg)))
    if (k > 1) {
      sph[[length(sph) + 1]] <- list(term = term, df = k, w = unname(env$mauchly[[i]]$statistic), p = env$mauchly[[i]]$p.value, gg = gg, hf = hf)
    }
    sp <- env$spher[[i]]
    for (j in seq_len(nrow(sp) - 1)) corr[[length(corr) + 1]] <- list(term = if (j == 1) term else paste(term, "×", between), p = sp[j, "Pr(>F)"], pGG = sp[j, "G-G Pr"], pHF = sp[j, "H-F Pr"])
  }
  labels <- apply(
    expand.grid(rev(design$levels), KEEP.OUT.ATTRS = FALSE, stringsAsFactors = FALSE)[, rev(seq_along(design$names)), drop = FALSE],
    1,
    paste,
    collapse = " · "
  )
  ps_json(list(
    factorName = paste(design$names, collapse = " × "), levels = design$cells, between = between, n = nrow(env$Y),
    factors = lapply(seq_along(design$names), function(i) list(name = design$names[i], levels = I(design$levels[[i]]))),
    within = ws, betweenTable = bs, sphericity = NULL, sphericityTable = sph, corrected = corr, friedman = NULL,
    friedmanTable = if (!bt) ps_rm_friedman_out(env$friedman) else NULL, posthoc = ps_rm_posthoc_out(env$posthoc),
    cells = lapply(
      seq_along(design$cells),
      function(i) c(list(cell = sprintf("%s (%s)", unname(labels[i]), design$cells[i])), ps_desc(env$Y[, i]))
    ),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Script lines for the levels of each within factor (several factors): the subjects' mean over the other factors'
#' levels, then Friedman's rank test of the factor (without between factors) and every pair of its levels by a paired
#' t-test, Holm-adjusted within the factor (as JASP's post hoc tests of a within factor). Indexed: means, Friedman, post hoc.
PS_RM_LEVEL_TESTS <- c(
  "# Each within factor's levels: every subject's mean over the other factors' levels\nlvmeans <- lapply(setNames(names(idata), names(idata)), function(f) sapply(levels(idata[[f]]), function(l) rowMeans(Y[, idata[[f]] == l, drop = FALSE])))",
  "friedman <- lapply(lvmeans, friedman.test)  # Friedman's rank test of each within factor, on those means",
  "# Post hoc: every pair of a factor's levels by a paired t-test, p adjusted by Holm's method within the factor\nposthoc <- lapply(lvmeans, function(M) { pr <- combn(ncol(M), 2, simplify = FALSE); h <- lapply(pr, function(p) t.test(M[, p[1]], M[, p[2]], paired = TRUE))\n  list(levels = colnames(M), pairs = pr, tests = h, pHolm = p.adjust(vapply(h, function(x) x$p.value, 0), method = \"holm\")) })"
)
ps_rm_friedman_out <- function(fr) lapply(names(fr), function(f) list(term = f, stat = unname(fr[[f]]$statistic), df = unname(fr[[f]]$parameter), p = fr[[f]]$p.value))
ps_rm_posthoc_out <- function(ph) {
  unlist(lapply(names(ph), function(f) {
    x <- ph[[f]]
    lapply(seq_along(x$pairs), function(i) {
      p <- x$pairs[[i]]
      h <- x$tests[[i]]
      list(
        factor = f,
        comparison = sprintf("%s: %s - %s", f, x$levels[p[1]], x$levels[p[2]]),
        diff = unname(h$estimate),
        t = unname(h$statistic),
        df = unname(h$parameter),
        p = h$p.value,
        pHolm = x$pHolm[i]
      )
    })
  }), recursive = FALSE)
}

#' Repeated measures with several between-subjects factors (car's ?Anova: OBrienKaiser's treatment * gender with
#' idesign = ~ phase * hour): the multivariate linear model of the wide columns on the between factors, sum-to-zero
#' contrasts, and car::Anova's type II tests (univariate, with Mauchly's tests and the Greenhouse-Geisser and
#' Huynh-Feldt corrections). `design`: the within factors (one or several); `betweens`: the between factors' names.
ps_rmanova_car <- function(req, design, betweens, export) {
  fr <- ps_long_frame(req, unique(c(design$cells, betweens)))
  v <- fr$v
  bvars <- vapply(betweens, function(b) v[[b]], "", USE.NAMES = FALSE)
  if (any(bvars %in% c("subject", "y", "idata", "mlm", "Y", design$names))) {
    stop("Rename a between factor: its name is taken by a within-subject factor or the model.")
  }
  cellsR <- unname(unlist(v[design$cells]))
  k <- length(design$names)
  fac <- vapply(
    rev(seq_len(k)),
    function(i) sprintf("%s = factor(%s, levels = %s)", design$names[i], ps_q(design$levels[[i]]), ps_q(design$levels[[i]])),
    ""
  )
  body <- c(
    "suppressPackageStartupMessages(library(car))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(cellsR, bvars))),
    vapply(betweens, function(b) ps_bt_factor_line(req, fr, b), "", USE.NAMES = FALSE),
    "# Sum-to-zero contrasts (as car's help page sets them): the within effects are tested at the unweighted mean of the groups",
    sprintf("for (b in %s) contrasts(data[[b]]) <- contr.sum(nlevels(data[[b]]))", ps_q(bvars)),
    "# The within-subject design: one row per cell (wide column), the last factor varying fastest.",
    sprintf(
      "idata <- expand.grid(%s, KEEP.OUT.ATTRS = FALSE)[, %s, drop = FALSE]",
      paste(fac, collapse = ", "),
      ps_q(design$names)
    ),
    sprintf("Y <- as.matrix(data[, %s])", ps_q(cellsR)),
    sprintf("mlm <- lm(Y ~ %s, data = data)", paste(bvars, collapse = " * ")),
    sprintf("av <- Anova(mlm, idata = idata, idesign = ~ %s, type = 2)", paste(design$names, collapse = " * ")),
    "uni <- summary(av, multivariate = FALSE)",
    PS_RM_LEVEL_TESTS[c(1, 3)]
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Repeated-measures ANOVA", "car", inputs, body, c("uni", "posthoc")))
  }
  env <- ps_run(body, inputs)
  ut <- env$uni$univariate.tests
  rn <- rownames(ut)
  parts <- strsplit(rn, ":", fixed = TRUE)
  wn <- design$names
  name_of <- function(ps) paste(ps_back(ps, fr$back), collapse = " × ")
  rows_b <- list()
  rows_w <- list()
  corr <- list()
  sph <- list()
  res_b <- NULL
  pa <- env$uni$pval.adjustments
  st <- env$uni$sphericity.tests
  for (i in seq_along(rn)) {
    w <- parts[[i]][parts[[i]] %in% wn]
    b <- parts[[i]][!parts[[i]] %in% wn]
    ss <- ut[i, "Sum Sq"]
    df <- ut[i, "num Df"]
    ess <- ut[i, "Error SS"]
    edf <- ut[i, "den Df"]
    row <- list(
      term = name_of(c(w, b)),
      ss = ss,
      df = df,
      ms = ss / df,
      f = ut[i, "F value"],
      p = ut[i, "Pr(>F)"],
      partialEta2 = ss / (ss + ess)
    )
    if (!length(w)) {
      if (rn[i] != "(Intercept)") rows_b[[length(rows_b) + 1]] <- c(row, list(stratum = "subject"))
      res_b <- list(term = "Residuals", stratum = "subject", ss = ess, df = edf, ms = ess / edf)
      next
    }
    stratum <- name_of(w)
    rows_w[[length(rows_w) + 1]] <- c(row, list(stratum = stratum))
    if (!length(b)) {
      # (an effect's error row once, after its terms; Mauchly's test and the epsilons for effects with more than one df)
      if (!is.null(st) && rn[i] %in% rownames(st)) {
        sph[[length(sph) + 1]] <- list(term = stratum, df = df, w = st[rn[i], "Test statistic"], p = st[rn[i], "p-value"], gg = pa[rn[i], "GG eps"], hf = min(1, pa[rn[i], "HF eps"]))
      }
    }
    last <- i == length(rn) || !identical(sort(parts[[i + 1]][parts[[i + 1]] %in% wn]), sort(w))
    if (!is.null(pa) && rn[i] %in% rownames(pa)) {
      corr[[length(corr) + 1]] <- list(term = row$term, p = row$p, pGG = pa[rn[i], "Pr(>F[GG])"], pHF = pa[rn[i], "Pr(>F[HF])"])
    } else {
      corr[[length(corr) + 1]] <- list(term = row$term, p = row$p, pGG = row$p, pHF = row$p)
    }
    if (last) {
      rows_w[[length(rows_w) + 1]] <- list(term = "Residuals", stratum = stratum, ss = ess, df = edf, ms = ess / edf)
    }
  }
  single <- isTRUE(design$single)
  labels <- if (single) {
    design$cells
  } else {
    apply(
      expand.grid(rev(design$levels), KEEP.OUT.ATTRS = FALSE, stringsAsFactors = FALSE)[, rev(seq_len(k)), drop = FALSE],
      1,
      paste,
      collapse = " · "
    )
  }
  sp1 <- if (single && length(sph)) sph[[1]] else NULL
  ps_json(list(
    factorName = paste(design$names, collapse = " × "),
    levels = design$cells,
    between = paste(betweens, collapse = " × "),
    betweenFactors = I(betweens),
    n = nrow(env$Y),
    ssType = "II",
    factors = if (!single) lapply(seq_len(k), function(i) list(name = design$names[i], levels = I(design$levels[[i]]))) else NULL,
    within = rows_w,
    betweenTable = c(rows_b, if (!is.null(res_b)) list(res_b)),
    sphericity = if (single) (if (is.null(sp1)) NULL else sp1[c("w", "p", "gg", "hf")]) else NULL,
    sphericityTable = if (!single) sph else NULL,
    corrected = corr,
    friedman = NULL,
    posthoc = ps_rm_posthoc_out(env$posthoc),
    cells = lapply(
      seq_along(design$cells),
      function(i) c(list(cell = if (single) design$cells[i] else sprintf("%s (%s)", unname(labels[i]), design$cells[i])), ps_desc(env$Y[, i]))
    ),
    warnings = env$.warnings, engine = ps_engine("car")
  ))
}

#' MANOVA: summary.manova with Pillai's trace, Wilks' lambda, Hotelling-Lawley
#' trace and Roy's largest root for each term.
ps_manova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  ys <- unlist(req$dependents)
  fac <- unlist(req$factors)
  if (length(ys) < 2 || !length(fac)) {
    stop("Choose at least two dependent variables and one factor.")
  }
  full <- !identical(req$interactions, FALSE)
  fr <- ps_long_frame(req, unique(c(ys, fac)))
  v <- fr$v
  fml <- sprintf(
    "cbind(%s) ~ %s",
    paste(unname(unlist(v[ys])), collapse = ", "),
    paste(unname(unlist(v[fac])), collapse = if (full) " * " else " + ")
  )
  tests <- c("Pillai", "Wilks", "Hotelling-Lawley", "Roy")
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(ys, fac)])))),
    vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    sprintf("fit <- manova(%s, data = data)", fml),
    sprintf("res <- lapply(%s, function(t) summary(fit, test = t)$stats)", ps_q(tests))
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("MANOVA", character(0), inputs, body, "res"))
  }
  env <- ps_run(body, inputs)
  back <- function(t) ps_back_term(trimws(t), fr$back)
  out <- lapply(seq_along(tests), function(i) {
    s <- env$res[[i]]
    rn <- setdiff(trimws(rownames(s)), "Residuals")
    list(test = tests[i], rows = lapply(rn, function(t) {
      j <- which(trimws(rownames(s)) == t)
      list(term = back(t), df = s[j, 1], value = s[j, 2], f = s[j, 3], df1 = s[j, 4], df2 = s[j, 5], p = s[j, 6])
    }))
  })
  ps_json(list(dependents = ys, factors = fac, n = nrow(env$data), tests = out, warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' Correlation matrix: Pearson, Spearman or Kendall, each pair by cor.test (with a
#' confidence interval for Pearson's r); pairwise or listwise deletion. "polychoric":
#' ps_polychoric.
ps_correlation <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two variables.")
  method <- req$method %||% "pearson"
  if (!method %in% c("pearson", "spearman", "kendall", "polychoric")) {
    stop("Invalid correlation method in the request.")
  }
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  listwise <- identical(req$deletion, "listwise")
  fr <- ps_long_frame(req, vars)
  v <- fr$v
  if (method == "polychoric") {
    return(ps_polychoric(fr, vars, alt, conf, listwise, export))
  }
  exact <- isTRUE(req$exact) && method %in% c("spearman", "kendall")
  bound <- if (!is.null(req$tostBound)) ps_tost_cor_bound(req$tostBound)
  body <- c(
    if (listwise) sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[vars])))),
    sprintf("vars <- %s", ps_q(unname(unlist(v[vars])))),
    "pairs <- combn(vars, 2, simplify = FALSE)",
    if (exact) {
      c(
        sprintf(
          "# Exact p-values (exact = TRUE) where they exist: no ties, and at most %d cases; otherwise the normal approximation.",
          if (method == "kendall") 200 else 1289
        ),
        sprintf(
          "exact <- vapply(pairs, function(p) { ok <- complete.cases(data[[p[1]]], data[[p[2]]]); x <- data[[p[1]]][ok]; y <- data[[p[2]]][ok]; !anyDuplicated(x) && !anyDuplicated(y) && sum(ok) <= %d }, TRUE)",
          if (method == "kendall") 200 else 1289
        ),
        sprintf(
          "tests <- lapply(seq_along(pairs), function(i) { p <- pairs[[i]]; cor.test(data[[p[1]]], data[[p[2]]], method = \"%s\", alternative = \"%s\", exact = exact[i]) })",
          method,
          alt
        )
      )
    } else {
      sprintf(
        "tests <- lapply(pairs, function(p) cor.test(data[[p[1]]], data[[p[2]]], method = \"%s\", alternative = \"%s\"%s))",
        method,
        alt,
        if (method == "pearson") sprintf(", conf.level = %s", format(conf)) else ", exact = FALSE"
      )
    },
    "n <- vapply(pairs, function(p) sum(complete.cases(data[[p[1]]], data[[p[2]]])), 0)",
    if (!is.null(bound)) ps_tost_cor_lines(method, bound, conf)
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "setNames(tests, vapply(pairs, paste, \"\", collapse = \" ~ \"))",
      if (!is.null(bound)) "tost"
    )
    pkgs <- if (!is.null(bound)) "TOSTER" else character(0)
    return(ps_script(sprintf("Correlations (%s)", method), pkgs, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(env$pairs), function(i) {
    p <- env$pairs[[i]]
    h <- env$tests[[i]]
    list(
      a = fr$back[[p[1]]],
      b = fr$back[[p[2]]],
      r = unname(h$estimate),
      p = h$p.value,
      n = env$n[i],
      stat = unname(h$statistic),
      ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1],
      ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2],
      exact = if (exact) env$exact[i] else NULL,
      tost = if (!is.null(bound)) ps_tost_cor_result(env$tost[[i]]) else NULL
    )
  })
  ps_json(list(
    method = method,
    alternative = alt,
    confidence = conf,
    deletion = if (listwise) "listwise" else "pairwise",
    vars = vars,
    pairs = rows,
    exact = if (exact) TRUE else NULL,
    tostBound = bound,
    warnings = env$.warnings,
    engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Correlations of ordinal (Likert) variables: those of the continuous responses assumed to underlie the
#' categories, by lavaan (lavCor, as CB-SEM with ordinal indicators): polychoric between two ordinal
#' variables (tetrachoric when both are binary), polyserial between an ordinal and a continuous one,
#' Pearson between continuous ones; standard errors, z tests and Wald confidence intervals from the
#' standardised solution. Ordinal: integer values, at most 8 categories (psych's rule, as the EFA card).
#' For each pair of ordinal variables, a test of the bivariate normal model the polychoric correlation
#' assumes: the observed two-way table against the one it implies (lavTables; Pearson X2, LR G2).
ps_polychoric <- function(fr, vars, alt, conf, listwise, export) {
  v <- fr$v
  col <- unname(unlist(v[vars]))
  ordinal <- vapply(col, function(k) {
    x <- fr$data[[k]]
    x <- x[!is.na(x)]
    length(x) > 0 && all(x == round(x)) && length(unique(x)) <= 8
  }, TRUE)
  if (!any(ordinal)) {
    stop("No variable has at most 8 categories (integer values), so there is nothing ordinal to correlate: choose Pearson, Spearman or Kendall.")
  }
  bin <- vapply(col, function(k) length(unique(stats::na.omit(fr$data[[k]]))) == 2, TRUE)
  body <- c(
    "suppressPackageStartupMessages(library(lavaan))",
    sprintf("vars <- %s", ps_q(col)),
    sprintf("ordinal <- %s  # integer values, at most 8 categories", ps_q(col[ordinal])),
    if (listwise) "data <- data[complete.cases(data[, vars]), ]",
    "# (continuous variables standardised, so that every estimate is a correlation)",
    "for (k in setdiff(vars, ordinal)) data[[k]] <- as.numeric(scale(data[[k]]))",
    sprintf(
      "fit <- lavCor(data[, vars], ordered = ordinal, se = \"standard\", output = \"fit\", missing = \"%s\")",
      if (listwise) "listwise" else "pairwise"
    ),
    sprintf("est <- standardizedSolution(fit, level = %s)", format(conf)),
    "est <- est[est$op == \"~~\" & est$lhs != est$rhs, ]",
    "n <- vapply(seq_len(nrow(est)), function(i) sum(complete.cases(data[[est$lhs[i]]], data[[est$rhs[i]]])), 0)",
    if (sum(ordinal) >= 2) {
      "normality <- lavTables(fit, dimension = 2L, type = \"table\", statistic = c(\"X2\", \"G2\"), p_value = TRUE)"
    }
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Polychoric correlations (lavaan)", "lavaan", inputs, body, c("est", if (sum(ordinal) >= 2) "normality")))
  }
  env <- ps_run(body, inputs)
  e <- env$est
  z <- e$est.std / e$se
  p <- switch(alt,
    two.sided = 2 * stats::pnorm(-abs(z)),
    greater = stats::pnorm(-z),
    less = stats::pnorm(z)
  )
  kind <- function(a, b) {
    oa <- ordinal[[a]]
    ob <- ordinal[[b]]
    if (oa && ob) {
      if (bin[[a]] && bin[[b]]) "tetrachoric" else "polychoric"
    } else if (oa || ob) "polyserial" else "pearson"
  }
  rows <- lapply(seq_len(nrow(e)), function(i) {
    list(
      a = fr$back[[e$lhs[i]]], b = fr$back[[e$rhs[i]]], r = e$est.std[i], p = p[i], n = env$n[i], stat = z[i],
      se = e$se[i], ciLow = e$ci.lower[i], ciHigh = e$ci.upper[i], kind = kind(e$lhs[i], e$rhs[i])
    )
  })
  nt <- env$normality
  ps_json(list(
    method = "polychoric",
    alternative = alt,
    confidence = conf,
    deletion = if (listwise) "listwise" else "pairwise",
    vars = vars,
    pairs = rows,
    ordinal = I(unname(vapply(col[ordinal], function(k) fr$back[[k]], ""))),
    normality = if (is.null(nt)) {
      list()
    } else {
      lapply(seq_len(nrow(nt)), function(i) {
        list(
          a = fr$back[[as.character(nt$lhs[i])]],
          b = fr$back[[as.character(nt$rhs[i])]],
          df = as.numeric(nt$df[i]),
          x2 = as.numeric(nt$X2[i]),
          x2p = as.numeric(nt$X2.pval[i]),
          g2 = as.numeric(nt$G2[i]),
          g2p = as.numeric(nt$G2.pval[i])
        )
      })
    },
    warnings = env$.warnings, engine = ps_engine("lavaan")
  ))
}

#' Contingency table: counts (or a column of frequencies), expected counts, the
#' Pearson chi-square (and with continuity correction for 2 x 2), the
#' likelihood-ratio G, Fisher's exact test, Cramer's V, and for 2 x 2 phi and the
#' odds ratio with its confidence interval.
ps_contingency <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  rv <- req$rows %||% ""
  cv <- req$columns %||% ""
  wv <- req$counts %||% ""
  if (!nzchar(rv) || !nzchar(cv) || rv == cv) {
    stop("Choose two different variables for the rows and the columns.")
  }
  conf <- ps_bt_conf(req)
  es <- isTRUE(req$effectSizes)
  paired <- isTRUE(req$paired)
  fr <- ps_long_frame(req, unique(c(rv, cv, if (nzchar(wv)) wv)))
  v <- fr$v
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(rv, cv, if (nzchar(wv)) wv)])))),
    ps_bt_factor_line(req, fr, rv),
    ps_bt_factor_line(req, fr, cv),
    if (paired) ps_mcnemar_lines(v[[rv]], v[[cv]], if (nzchar(wv)) v[[wv]] else ""),
    sprintf("tab <- xtabs(%s~ %s + %s, data = data)", if (nzchar(wv)) paste0(v[[wv]], " ") else "", v[[rv]], v[[cv]]),
    "chi <- chisq.test(tab, correct = FALSE)",
    "chiYates <- if (all(dim(tab) == 2)) chisq.test(tab, correct = TRUE)",
    "E <- chi$expected",
    "G2 <- 2 * sum(ifelse(tab > 0, tab * log(tab / E), 0)); pG2 <- pchisq(G2, chi$parameter, lower.tail = FALSE)  # likelihood ratio",
    sprintf(
      "fisher <- tryCatch(fisher.test(tab, conf.level = %s, workspace = 2e7), error = function(e) NULL)  # (NULL when the table is too large for the exact test)",
      format(conf)
    ),
    "cramerV <- sqrt(unname(chi$statistic) / (sum(tab) * (min(dim(tab)) - 1)))",
    "if (all(dim(tab) == 2)) {",
    "  phi <- (tab[1, 1] * tab[2, 2] - tab[1, 2] * tab[2, 1]) / sqrt(prod(rowSums(tab)) * prod(colSums(tab)))",
    "  or <- (tab[1, 1] * tab[2, 2]) / (tab[1, 2] * tab[2, 1])  # sample odds ratio; Wald interval on the log scale",
    sprintf("  orCI <- exp(log(or) + c(-1, 1) * qnorm(1 - (1 - %s) / 2) * sqrt(sum(1 / tab)))", format(conf)),
    "}",
    if (es) ps_es_contingency_lines(conf)
  )
  inputs <- list(data = fr$data)
  if (export) {
    paired_report <- c("ptab", "if (length(lev) == 2) list(mcnemar, mcnemarCC, mcnemarExact) else c(stat = bowkerStat, df = bowkerDf, p = bowkerP)")
    report <- c("tab", "chi", "chiYates", "c(G2 = G2, p = pG2)", "fisher", "cramerV", if (paired) paired_report, if (es) "es")
    pkgs <- if (es) "effectsize" else character(0)
    return(ps_script("Contingency table", pkgs, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  tab <- env$tab
  two <- all(dim(tab) == 2)
  ps_json(list(
    rows = rv,
    columns = cv,
    rowLevels = rownames(tab),
    colLevels = colnames(tab),
    counts = lapply(seq_len(nrow(tab)), function(i) unname(as.numeric(tab[i, ]))),
    expected = lapply(seq_len(nrow(tab)), function(i) unname(env$E[i, ])),
    n = sum(tab),
    chisq = ps_htest(env$chi),
    yates = ps_htest(env$chiYates),
    likelihoodRatio = list(stat = env$G2, df = unname(env$chi$parameter), p = env$pG2),
    fisher = ps_htest(env$fisher),
    cramerV = env$cramerV,
    phi = if (two) env$phi else NULL,
    oddsRatio = if (two) list(est = env$or, ciLow = env$orCI[1], ciHigh = env$orCI[2]) else NULL,
    effects = if (es) ps_es_rows(Filter(Negate(is.null), env$es)) else NULL,
    paired = if (paired) ps_mcnemar_result(env),
    confidence = conf,
    warnings = env$.warnings,
    engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Binomial test (each category against the rest, exact Clopper-Pearson interval)
#' and the multinomial goodness-of-fit chi-square (equal or given proportions).
ps_freqtest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  if (identical(req$type, "cochran")) {
    return(ps_cochran(req, export))
  }
  x <- req$variable %||% ""
  if (!nzchar(x)) stop("Choose the variable.")
  type <- req$type %||% "binomial"
  if (!type %in% c("binomial", "multinomial")) stop("Invalid test in the request.")
  alt <- ps_bt_alt(req)
  conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, x)
  v <- fr$v
  body <- c(
    sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[x]]),
    ps_bt_factor_line(req, fr, x),
    sprintf("counts <- table(data$%s)", v[[x]])
  )
  if (type == "binomial") {
    p0 <- ps_number(req$testValue %||% 0.5, "test proportion")
    if (p0 <= 0 || p0 >= 1) stop("The test proportion must be between 0 and 1.")
    body <- c(
      body,
      sprintf(
        "tests <- lapply(counts, function(k) binom.test(k, sum(counts), p = %s, alternative = \"%s\", conf.level = %s))",
        format(p0, digits = 15),
        alt,
        format(conf)
      )
    )
  } else {
    lv <- levels(factor(fr$data[[v[[x]]]]))
    props <- unlist(req$proportions)
    if (length(props) && (length(props) != length(lv) || any(!is.finite(props)) || any(props <= 0))) {
      stop(sprintf("Give one positive expected proportion per category (%d).", length(lv)))
    }
    body <- c(
      body,
      sprintf(
        "gof <- chisq.test(counts%s)",
        if (length(props)) sprintf(", p = c(%s), rescale.p = TRUE", paste(format(props, digits = 15), collapse = ", ")) else ""
      )
    )
  }
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(if (type == "binomial") "Binomial test" else "Multinomial test", character(0), inputs, body, c("counts", if (type == "binomial") "tests" else "gof")))
  }
  env <- ps_run(body, inputs)
  ct <- env$counts
  ps_json(list(
    type = type,
    variable = x,
    levels = names(ct),
    counts = unname(as.numeric(ct)),
    n = sum(ct),
    alternative = alt,
    confidence = conf,
    binomial = if (type == "binomial") unname(lapply(env$tests, function(h) c(ps_htest(h), list(proportion = unname(h$estimate))))) else NULL,
    testValue = if (type == "binomial") p0 else NULL,
    multinomial = if (type == "multinomial") c(ps_htest(env$gof), list(expected = unname(env$gof$expected))) else NULL,
    warnings = env$.warnings,
    engine = list(package = "stats", version = as.character(getRversion()))
  ))
}

#' Cohen's kappa weights: psych's default (squared distances), linear distances, or a
#' matrix (one row per category of the first rater): agreement weights, or
#' disagreement weights when its diagonal is zero (Cohen 1968), converted to agreement weights.
ps_kappa_weights <- function(req, k) {
  w <- req$kappaWeights %||% "squared"
  if (!w %in% c("squared", "linear", "custom")) stop("Invalid kappa weights in the request.")
  if (w != "custom") {
    return(character(0))
  }
  m <- req$weightMatrix
  if (!is.matrix(m) || !is.numeric(m) || nrow(m) != ncol(m) || nrow(m) < 2 || any(!is.finite(m))) {
    stop("The kappa weights must be a square matrix of numbers.")
  }
  if (!is.null(k) && nrow(m) != k) {
    stop(sprintf("The weight matrix has %d rows; the table has %d categories.", nrow(m), k))
  }
  c(
    "# Weights (rows: the first rater's categories).",
    sprintf(
      "W <- matrix(c(%s), nrow = %d, byrow = TRUE)",
      paste(format(c(t(m)), digits = 15), collapse = ", "),
      nrow(m)
    ),
    "# A zero diagonal: disagreement weights (Cohen 1968), taken as the agreement weights 1 - W / max(W). The weighted kappa is the same,",
    "# and psych's standard error is the one for agreement weights (Fleiss, Cohen & Everitt 1969).",
    "if (all(diag(W) == 0) && max(W) > 0) W <- 1 - W / max(W)"
  )
}
ps_kappa_args <- function(req) {
  switch(req$kappaWeights %||% "squared",
    squared = "",
    linear = ", w.exp = 1",
    custom = ", w = W"
  )
}

#' Cohen's kappa of an agreement table: the two raters' categories as rows and columns,
#' one row of data per cell with its count or proportion (`counts`; none: one row per
#' subject). Proportions are scaled to `nObs` subjects for the standard errors
#' (psych's n.obs).
ps_kappa_table <- function(req, export) {
  kt <- req$kappaTable
  rv <- kt$rows %||% ""
  cv <- kt$columns %||% ""
  wv <- kt$counts %||% ""
  if (!is.character(rv) || !is.character(cv) || !is.character(wv) || !nzchar(rv) || !nzchar(cv) || rv == cv) {
    stop("Choose the two raters' variables for the rows and the columns.")
  }
  nobs <- kt$nObs
  if (!is.null(nobs)) {
    nobs <- ps_number(nobs, "number of subjects")
    if (nobs < 2 || nobs > 1e9) stop("The number of subjects must be at least 2.")
  }
  conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, unique(c(rv, cv, if (nzchar(wv)) wv)))
  v <- fr$v
  if (is.null(nobs) && nzchar(wv)) {
    w <- fr$data[[v[[wv]]]]
    if (abs(sum(w[stats::complete.cases(fr$data)], na.rm = TRUE) - 1) < 1e-6) {
      stop("The table holds proportions: give the number of subjects rated, for the standard errors.")
    }
  }
  codes <- sort(unique(c(fr$data[[v[[rv]]]], fr$data[[v[[cv]]]])))
  codes <- codes[!is.na(codes)]
  if (length(codes) < 2) stop("The raters use fewer than two categories.")
  l <- unlist(req$categories[[rv]]) %||% unlist(req$categories[[cv]])
  labels <- if (!is.null(l) && all(codes %in% seq_along(l))) {
    l[codes]
  } else {
    format(codes, trim = TRUE)
  }
  lev <- sprintf(
    "levels = c(%s), labels = %s",
    paste(format(codes, digits = 15, trim = TRUE), collapse = ", "),
    ps_q(labels)
  )
  body <- c(
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(rv, cv, if (nzchar(wv)) wv)])))),
    "# Both raters on the same categories (either rater's), so that the table is square.",
    sprintf("data$%s <- factor(data$%s, %s)", v[[rv]], v[[rv]], lev),
    sprintf("data$%s <- factor(data$%s, %s)", v[[cv]], v[[cv]], lev),
    sprintf(
      "tab <- unclass(xtabs(%s~ %s + %s, data = data))  # rows: the first rater; columns: the second",
      if (nzchar(wv)) paste0(v[[wv]], " ") else "",
      v[[rv]],
      v[[cv]]
    ),
    if (!is.null(nobs)) sprintf("tab <- tab / sum(tab) * %s  # proportions (or counts) scaled to the number of subjects", format(nobs, digits = 15)),
    "suppressPackageStartupMessages(library(psych))",
    ps_kappa_weights(req, length(codes)),
    sprintf("k <- cohen.kappa(tab%s, alpha = %s)", ps_kappa_args(req), format(1 - conf))
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("Cohen's kappa of an agreement table (psych)", "psych", inputs, body, c("tab", "k")))
  }
  env <- ps_run(body, inputs)
  cf <- env$k$confid
  ps_json(list(
    type = "kappa",
    vars = c(rv, cv),
    n = sum(env$tab),
    confidence = conf,
    table = TRUE,
    kappa = list(est = cf[1, 2], ciLow = cf[1, 1], ciHigh = cf[1, 3]),
    weighted = list(est = cf[2, 2], ciLow = cf[2, 1], ciHigh = cf[2, 3]),
    categories = length(codes),
    weights = req$kappaWeights %||% "squared",
    levels = I(labels),
    counts = lapply(seq_len(nrow(env$tab)), function(i) unname(as.numeric(env$tab[i, ]))),
    warnings = env$.warnings,
    engine = ps_engine("psych")
  ))
}

#' Reliability and agreement (psych; Bland-Altman in base R):
#' - scale: Cronbach's alpha with item statistics (psych::alpha), McDonald's
#'   omega total of a one-factor model (psych::omega) and the greatest lower
#'   bound (psych::glb.fa, of the correlation matrix);
#' - icc: the six intraclass correlations of Shrout & Fleiss (psych::ICC);
#' - kappa: Cohen's kappa, unweighted and weighted, of two raters (psych::cohen.kappa);
#' - blandaltman: the mean difference of two methods and its limits of agreement.
ps_reliability <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "scale"
  if (type %in% PS_AGREEMENT_TYPES) {
    return(ps_agreement(req, type, export))
  }
  if (!type %in% c("scale", "icc", "kappa", "blandaltman")) {
    stop("Invalid reliability analysis in the request.")
  }
  if (type == "kappa" && is.list(req$kappaTable)) {
    return(ps_kappa_table(req, export))
  }
  vars <- unlist(req$vars)
  need <- c(scale = 2, icc = 2, kappa = 2, blandaltman = 2)[[type]]
  if (length(vars) < need) stop(sprintf("Choose at least %d variables.", need))
  if (type %in% c("kappa", "blandaltman") && length(vars) != 2) {
    stop("Choose exactly two variables (the two raters or methods).")
  }
  conf <- ps_bt_conf(req)
  bayes <- if (type == "scale" && isTRUE(req$bayes)) {
    ps_bayesrel_options(req, length(vars))
  } else {
    NULL
  }
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  body <- c(sprintf("X <- data[complete.cases(data[, %s]), %s, drop = FALSE]", ps_q(v), ps_q(v)))
  body <- c(body, switch(type,
    scale = c(
      "suppressPackageStartupMessages(library(psych))",
      "a <- alpha(X, check.keys = FALSE)  # Cronbach's alpha, item statistics, alpha if an item is dropped",
      "# Omega total of one factor (omega hierarchical is not reported: its one-factor warnings do not concern omega total).",
      "o <- suppressWarnings(suppressMessages(omega(X, nfactors = 1, plot = FALSE)))",
      "g <- glb.fa(cor(X))  # greatest lower bound (psych's factor-analytic estimate)",
      "# Standard error of measurement of the scale score (the item mean, as psych scores it): SD * sqrt(1 - reliability).",
      "scoreSd <- sd(rowMeans(X))",
      "sem <- scoreSd * sqrt(1 - c(alpha = a$total$raw_alpha, omega = o$omega.tot, glb = g$glb))",
      if (!is.null(bayes)) ps_bayesrel_lines(bayes, conf)
    ),
    icc = c(
      "suppressPackageStartupMessages(library(psych))",
      sprintf("icc <- ICC(X, lmer = FALSE, alpha = %s)  # rows: subjects; columns: raters", format(1 - conf)),
      "# Standard error of measurement, SD * sqrt(1 - ICC): the SD of all ratings for a single rater,",
      "# the SD of the subjects' mean ratings for the mean of k raters.",
      "sdSingle <- sd(unlist(X))",
      "sdMean <- sd(rowMeans(X))",
      "iccSd <- ifelse(grepl(\"k$\", icc$results$type), sdMean, sdSingle)",
      "iccSem <- iccSd * sqrt(1 - icc$results$ICC)"
    ),
    kappa = c(
      "suppressPackageStartupMessages(library(psych))", ps_kappa_weights(req, NULL),
      sprintf(
        "k <- cohen.kappa(X%s, alpha = %s)%s",
        ps_kappa_args(req),
        format(1 - conf),
        if (identical(req$kappaWeights %||% "squared", "squared")) "  # weighted: squared distances between categories" else ""
      )
    ),
    blandaltman = c(
      "d <- X[[1]] - X[[2]]; m <- (X[[1]] + X[[2]]) / 2",
      "bias <- mean(d); s <- sd(d); n <- length(d)",
      "loa <- bias + c(-1, 1) * 1.96 * s  # limits of agreement",
      sprintf("biasCI <- bias + c(-1, 1) * qt(1 - (1 - %s) / 2, n - 1) * s / sqrt(n)", format(conf))
    )
  ))
  inputs <- list(data = fr$data)
  title <- c(scale = "Scale reliability (psych)", icc = "Intraclass correlation (psych)", kappa = "Cohen's kappa (psych)", blandaltman = "Bland-Altman agreement")[[type]]
  packages <- if (type == "blandaltman") character(0) else c("psych", "GPArotation")[seq_len(if (type == "scale") 2 else 1)]
  if (!is.null(bayes)) packages <- c(packages, "Bayesrel", "coda")
  if (export) {
    return(ps_script(
      title, packages, inputs, body,
      switch(type,
        scale = c("a", "o$omega.tot", "g$glb", "sem", if (!is.null(bayes)) c("summary(br)", "rhat", "ess")),
        icc = c("icc", "data.frame(type = icc$results$type, sem = iccSem)"),
        kappa = "k",
        blandaltman = c("c(bias = bias, sd = s, lower = loa[1], upper = loa[2])", "biasCI")
      )
    ))
  }
  env <- ps_run(body, inputs)
  n <- nrow(env$X)
  out <- switch(type,
    scale = {
      a <- env$a
      tot <- a$total
      dr <- a$alpha.drop
      is <- a$item.stats
      list(
        alpha = tot$raw_alpha,
        stdAlpha = tot$std.alpha,
        averageR = tot$average_r,
        omegaTotal = env$o$omega.tot,
        glb = env$g$glb,
        mean = tot$mean,
        sd = tot$sd,
        scoreSd = env$scoreSd,
        sem = as.list(env$sem),
        items = lapply(
          seq_len(nrow(dr)),
          function(i) list(item = vars[i], alphaIfDropped = dr$raw_alpha[i], itemRest = is$r.drop[i], mean = is$mean[i], sd = is$sd[i])
        ),
        bayes = if (is.null(bayes)) NULL else ps_bayesrel_result(env, bayes, conf)
      )
    },
    icc = {
      r <- env$icc$results
      rows <- lapply(seq_len(nrow(r)), function(i) {
        list(
          type = as.character(r$type[i]),
          icc = r$ICC[i],
          f = r$F[i],
          df1 = r$df1[i],
          df2 = r$df2[i],
          p = r$p[i],
          ciLow = r[i, "lower bound"],
          ciHigh = r[i, "upper bound"],
          sem = env$iccSem[i]
        )
      })
      list(icc = rows, sdSingle = env$sdSingle, sdMean = env$sdMean)
    },
    kappa = {
      cf <- env$k$confid
      list(
        kappa = list(est = cf[1, 2], ciLow = cf[1, 1], ciHigh = cf[1, 3]),
        weighted = list(est = cf[2, 2], ciLow = cf[2, 1], ciHigh = cf[2, 3]),
        agreement = env$k$agree,
        categories = nrow(env$k$agree)
      )
    },
    blandaltman = {
      keep <- if (n > 5000) seq(1, n, length.out = 5000) else seq_len(n)
      list(
        bias = env$bias,
        sd = env$s,
        lower = env$loa[1],
        upper = env$loa[2],
        biasCiLow = env$biasCI[1],
        biasCiHigh = env$biasCI[2],
        points = list(mean = unname(env$m[keep]), diff = unname(env$d[keep]))
      )
    }
  )
  if (type == "kappa") out$agreement <- NULL
  ps_json(c(list(type = type, vars = vars, n = n, confidence = conf), out, list(
    warnings = env$.warnings,
    engine = if (type == "blandaltman") list(package = "stats", version = as.character(getRversion())) else ps_engine("psych")
  )))
}

# ---- Bayesian scale reliability (Bayesrel; Pfadt, van den Bergh, Sijtsma, Moshagen & Wagenmakers 2022)
# Coefficient alpha, Guttman's lambda-2, McDonald's omega (and optionally the greatest lower bound, which is slow:
# a glb per posterior draw) with posterior means and credible intervals from Bayesrel::strel: an inverse-Wishart
# posterior of the covariance matrix (alpha, lambda-2, glb) and a Bayesian one-factor model (omega), sampled in
# chains after a burn-in, seeded. R-hat and effective sample sizes from coda.

PS_BAYESREL_CHAINS <- 3L
PS_BAYESREL_BURNIN <- 50L

#' The request's Bayesian options, validated: the seed, the iterations per chain, the estimates.
ps_bayesrel_options <- function(req, items) {
  if (items < 3) stop("Bayesian reliability needs at least three items.")
  seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
  iter <- as.integer(ps_number(req$iterations %||% 1000, "number of iterations"))
  if (iter < 100 || iter > 20000) stop("The number of iterations must be between 100 and 20000.")
  estimates <- c("alpha", "lambda2", if (isTRUE(req$bayesGlb)) "glb", "omega")
  list(seed = seed, iter = iter, estimates = estimates)
}

#' The script lines: strel with a seed, then the convergence diagnostics of each estimate's chains.
ps_bayesrel_lines <- function(b, conf) {
  c(
    "# Bayesian reliability (Bayesrel::strel): posterior means and credible intervals.",
    "suppressPackageStartupMessages(library(Bayesrel))",
    sprintf("set.seed(%d)", b$seed),
    sprintf(
      "br <- strel(X, estimates = %s, interval = %s, n.iter = %d, n.burnin = %d, n.chains = %d, freq = FALSE)",
      ps_q(b$estimates), format(conf, digits = 15), b$iter, PS_BAYESREL_BURNIN, PS_BAYESREL_CHAINS
    ),
    "# Convergence: the chains of each estimate (Bayesrel keeps them as chains x draws, or draws x chains).",
    sprintf("chains <- function(s) { s <- unclass(s); if (nrow(s) != %dL) s <- t(s);", PS_BAYESREL_CHAINS),
    "  coda::mcmc.list(lapply(seq_len(nrow(s)), function(i) coda::mcmc(s[i, ]))) }",
    "rhat <- vapply(br$Bayes$samp, function(s) unname(coda::gelman.diag(chains(s), autoburnin = FALSE)$psrf[1, 1]), 0)",
    "ess <- vapply(br$Bayes$samp, function(s) unname(coda::effectiveSize(chains(s))), 0)"
  )
}

#' The posterior summaries from the run: per estimate, its mean, credible interval, R-hat and effective sample size.
ps_bayesrel_result <- function(env, b, conf) {
  br <- env$br
  rows <- lapply(b$estimates, function(e) {
    key <- paste0("Bayes_", e)
    list(
      estimate = e,
      mean = br$Bayes$est[[key]],
      low = br$Bayes$cred$low[[key]],
      high = br$Bayes$cred$up[[key]],
      rhat = unname(env$rhat[[key]]),
      ess = unname(env$ess[[key]])
    )
  })
  list(
    estimates = rows,
    interval = conf,
    iterations = b$iter,
    burnin = PS_BAYESREL_BURNIN,
    chains = PS_BAYESREL_CHAINS,
    seed = b$seed,
    version = as.character(utils::packageVersion("Bayesrel"))
  )
}
