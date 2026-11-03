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
  labels <- if (!is.null(l) && length(codes) && all(codes %in% seq_along(l))) l[codes] else format(codes, trim = TRUE)
  sprintf("data$%s <- factor(data$%s, levels = c(%s), labels = %s)", vn, vn, paste(format(codes, digits = 15, trim = TRUE), collapse = ", "), ps_q(labels))
}

#' A column's own name from its R name (other text, e.g. a factor name, as it is).
ps_bt_back <- function(fr, p) if (p %in% names(fr$back)) fr$back[[p]] else p

ps_bt_alt <- function(req) {
  a <- req$alternative %||% "two.sided"
  if (!a %in% c("two.sided", "greater", "less")) stop("Invalid alternative hypothesis in the request.")
  a
}
ps_bt_conf <- function(req) {
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  if (conf <= 0 || conf >= 1) stop("Invalid confidence level in the request.")
  conf
}
ps_htest <- function(h) if (is.null(h)) NULL else list(stat = unname(h$statistic), df = if (is.null(h$parameter)) NULL else unname(h$parameter), p = unname(h$p.value),
  ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1], ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2], estimate = if (is.null(h$estimate)) NULL else unname(h$estimate[1]))
ps_shapiro <- function(x) { x <- x[!is.na(x)]; if (length(x) < 3 || length(x) > 5000 || stats::sd(x) == 0) NULL else ps_htest(stats::shapiro.test(x)) }
ps_desc <- function(x) { x <- x[!is.na(x)]; list(n = length(x), mean = mean(x), sd = if (length(x) > 1) stats::sd(x) else NULL, se = if (length(x) > 1) stats::sd(x) / sqrt(length(x)) else NULL, median = stats::median(x)) }

#' t-tests: one sample, paired samples, independent samples (Student, Welch), with
#' the Wilcoxon signed-rank / Mann-Whitney tests, Cohen's d and the rank-biserial
#' correlation, Shapiro-Wilk and (independent samples) Levene's test.
ps_ttest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "one"
  if (!type %in% c("one", "paired", "independent")) stop("Invalid t-test type in the request.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  mu <- ps_number(req$testValue %||% 0, "test value")
  student <- isTRUE(req$student %||% TRUE); welch <- isTRUE(req$welch); rank <- isTRUE(req$rank)
  if (!student && !welch && !rank) stop("Choose at least one test.")
  pairs <- if (type == "paired") { p <- req$pairs; if (is.matrix(p)) lapply(seq_len(nrow(p)), function(i) as.character(p[i, ])) else lapply(p, function(t) as.character(unlist(t))) } else NULL
  vars <- if (type == "paired") unique(unlist(pairs)) else unlist(req$vars)
  if (!length(vars)) stop(if (type == "paired") "Choose at least one pair of variables." else "Choose at least one variable.")
  for (p in pairs) if (length(p) != 2 || p[1] == p[2]) stop("Each pair needs two different variables.")
  group <- req$group %||% ""
  if (type == "independent" && !nzchar(group)) stop("Choose the grouping variable.")
  fr <- ps_long_frame(req, unique(c(vars, if (type == "independent") group)))
  v <- fr$v
  a <- sprintf("alternative = \"%s\", conf.level = %s", alt, format(conf))
  body <- character(0); out <- list()
  if (type == "independent") {
    body <- c(ps_bt_factor_line(req, fr, group), sprintf("g <- data$%s", v[[group]]))
    lv <- levels(factor(fr$data[[v[[group]]]]))
    if (length(lv) != 2) stop(sprintf("The grouping variable must have exactly two groups; %s has %d.", group, length(lv)))
  }
  for (k in seq_along(if (type == "paired") pairs else vars)) {
    if (type == "paired") { p <- pairs[[k]]; x <- sprintf("data$%s", v[[p[1]]]); y <- sprintf("data$%s", v[[p[2]]]); label <- paste(p, collapse = " - ") }
    else { x <- sprintf("data$%s", v[[vars[k]]]); label <- vars[k] }
    r <- sprintf("r%d", k)
    body <- c(body, sprintf("# %s", ps_comment(label)), sprintf("%s <- list()", r))
    if (type == "one") body <- c(body,
      sprintf("y <- %s[!is.na(%s)]", x, x),
      if (student) sprintf("%s$student <- t.test(y, mu = %s, %s)", r, format(mu, digits = 15), a),
      if (rank) sprintf("%s$rank <- wilcox.test(y, mu = %s, alternative = \"%s\", exact = FALSE)", r, format(mu, digits = 15), alt),
      sprintf("%s$d <- (mean(y) - %s) / sd(y)  # Cohen's d", r, format(mu, digits = 15)),
      sprintf("nz <- sum(y != %s); %s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (nz * (nz + 1) / 2) - 1  # rank-biserial correlation", format(mu, digits = 15), r, r, r),
      sprintf("%s$shapiro <- if (length(y) >= 3 && length(y) <= 5000) shapiro.test(y)", r))
    else if (type == "paired") body <- c(body,
      sprintf("ok <- complete.cases(%s, %s); x1 <- %s[ok]; x2 <- %s[ok]; dif <- x1 - x2", x, y, x, y),
      if (student) sprintf("%s$student <- t.test(x1, x2, paired = TRUE, %s)", r, a),
      if (rank) sprintf("%s$rank <- wilcox.test(x1, x2, paired = TRUE, alternative = \"%s\", exact = FALSE)", r, alt),
      sprintf("%s$d <- mean(dif) / sd(dif)  # Cohen's d (of the differences)", r),
      sprintf("nz <- sum(dif != 0); %s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (nz * (nz + 1) / 2) - 1  # rank-biserial correlation", r, r, r),
      sprintf("%s$shapiro <- if (length(dif) >= 3 && length(dif) <= 5000) shapiro.test(dif)  # normality of the differences", r))
    else body <- c(body,
      sprintf("ok <- !is.na(%s) & !is.na(g); y <- %s[ok]; gg <- droplevels(g[ok])", x, x),
      sprintf("y1 <- y[gg == levels(gg)[1]]; y2 <- y[gg == levels(gg)[2]]"),
      if (student) sprintf("%s$student <- t.test(y1, y2, var.equal = TRUE, %s)", r, a),
      if (welch) sprintf("%s$welch <- t.test(y1, y2, var.equal = FALSE, %s)", r, a),
      if (rank) sprintf("%s$rank <- wilcox.test(y1, y2, alternative = \"%s\", exact = FALSE)", r, alt),
      sprintf("n1 <- length(y1); n2 <- length(y2)"),
      sprintf("%s$d <- (mean(y1) - mean(y2)) / sqrt(((n1 - 1) * var(y1) + (n2 - 1) * var(y2)) / (n1 + n2 - 2))  # Cohen's d (pooled SD)", r),
      sprintf("%s$dWelch <- (mean(y1) - mean(y2)) / sqrt((var(y1) + var(y2)) / 2)  # Cohen's d (average variance)", r),
      sprintf("%s$rb <- if (!is.null(%s$rank)) 2 * unname(%s$rank$statistic) / (n1 * n2) - 1  # rank-biserial correlation", r, r, r),
      sprintf("%s$levene <- anova(lm(abs(y - ave(y, gg, FUN = median)) ~ gg))  # Levene's test (median-centred, Brown-Forsythe)", r),
      sprintf("%s$shapiro <- lapply(list(y1, y2), function(z) if (length(z) >= 3 && length(z) <= 5000) shapiro.test(z))", r))
  }
  inputs <- list(data = fr$data)
  title <- c(one = "One-sample t-test", paired = "Paired-samples t-test", independent = "Independent-samples t-test")[[type]]
  if (export) return(paste(ps_script(title, character(0), inputs, body, sprintf("r%d", seq_along(if (type == "paired") pairs else vars))), collapse = "\n"))
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(if (type == "paired") pairs else vars), function(k) {
    r <- env[[sprintf("r%d", k)]]
    d <- fr$data
    desc <- if (type == "one") list(ps_desc(d[[v[[vars[k]]]]]))
      else if (type == "paired") { p <- pairs[[k]]; ok <- stats::complete.cases(d[[v[[p[1]]]]], d[[v[[p[2]]]]]); list(ps_desc(d[[v[[p[1]]]]][ok]), ps_desc(d[[v[[p[2]]]]][ok])) }
      else { y <- d[[v[[vars[k]]]]]; g <- factor(d[[v[[group]]]]); lapply(levels(g), function(l) ps_desc(y[!is.na(g) & g == l])) }
    list(label = if (type == "paired") paste(pairs[[k]], collapse = " - ") else vars[k], variables = if (type == "paired") pairs[[k]] else vars[k],
      student = ps_htest(r$student), welch = ps_htest(r$welch), rank = ps_htest(r$rank), d = r$d, dWelch = r$dWelch, rankBiserial = r$rb,
      levene = if (!is.null(r$levene)) list(stat = r$levene$`F value`[1], df1 = r$levene$Df[1], df2 = r$levene$Df[2], p = r$levene$`Pr(>F)`[1]) else NULL,
      shapiro = if (type == "independent") lapply(r$shapiro, ps_htest) else list(ps_htest(r$shapiro)), descriptives = desc)
  })
  groups <- if (type == "independent") { g <- fr$data[[v[[group]]]]; codes <- sort(unique(g[!is.na(g)])); l <- unlist(req$categories[[group]]); if (!is.null(l) && all(codes %in% seq_along(l))) l[codes] else format(codes, trim = TRUE) } else NULL
  ps_json(list(type = type, alternative = alt, testValue = mu, confidence = conf, groups = groups, rows = rows,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' ANOVA and ANCOVA: lm with every interaction of the factors (or main effects
#' only), covariates added; type III (sum-to-zero contrasts, drop1) or type I
#' (sequential) sums of squares; eta-squared, partial eta-squared and
#' omega-squared; Levene and Shapiro-Wilk on the residuals; with one factor and no
#' covariates also Welch's ANOVA, Kruskal-Wallis and Tukey's post hoc comparisons.
ps_anova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  y <- req$dependent %||% ""; fac <- unlist(req$factors); cov <- unlist(req$covariates)
  if (!nzchar(y) || !length(fac)) stop("Choose the dependent variable and at least one factor.")
  ss <- req$ssType %||% "III"
  if (!ss %in% c("I", "III")) stop("Invalid type of sums of squares in the request.")
  full <- !identical(req$interactions, FALSE)
  fr <- ps_long_frame(req, unique(c(y, fac, cov)))
  v <- fr$v
  rhs <- paste(c(paste(vapply(fac, function(n) v[[n]], ""), collapse = if (full) " * " else " + "), vapply(cov, function(n) v[[n]], "")), collapse = " + ")
  fml <- sprintf("%s ~ %s", v[[y]], rhs)
  oneway <- length(fac) == 1 && !length(cov)
  body <- c(sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(y, fac, cov)])))),
    "# Factors (their levels as the groups).", vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    if (ss == "III") c("# Type III sums of squares: sum-to-zero contrasts, each term dropped from the full model.", "options(contrasts = c(\"contr.sum\", \"contr.poly\"))") else "options(contrasts = c(\"contr.treatment\", \"contr.poly\"))",
    sprintf("fit <- lm(%s, data = data)", fml),
    if (ss == "III") "tab <- drop1(fit, ~ ., test = \"F\")" else "tab <- anova(fit)",
    "res <- residuals(fit)",
    "shapiro <- if (length(res) >= 3 && length(res) <= 5000) shapiro.test(res)  # normality of the residuals",
    sprintf("cells <- interaction(data[, %s], drop = TRUE)", ps_q(unname(unlist(v[fac])))),
    sprintf("levene <- anova(lm(abs(data$%s - ave(data$%s, cells, FUN = median)) ~ cells))  # Levene's test (median-centred)", v[[y]], v[[y]]),
    if (oneway) c(sprintf("welch <- oneway.test(%s, data = data, var.equal = FALSE)  # Welch's ANOVA", fml),
      sprintf("kruskal <- kruskal.test(%s, data = data)", fml),
      sprintf("tukey <- TukeyHSD(aov(%s, data = data), conf.level = %s)", fml, format(ps_bt_conf(req))),
      "# After Kruskal-Wallis: pairwise Wilcoxon rank-sum tests, p adjusted by Holm's method.",
      sprintf("pwRank <- pairwise.wilcox.test(data$%s, data$%s, p.adjust.method = \"holm\", exact = FALSE)", v[[y]], v[[fac[1]]])))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(if (length(cov)) "ANCOVA" else "ANOVA", character(0), inputs, body, c("tab", "shapiro", "levene", if (oneway) c("welch", "kruskal", "tukey", "pwRank"))), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit; tab <- env$tab; d <- env$data
  ssres <- sum(residuals(fit)^2); dfres <- df.residual(fit); msres <- ssres / dfres
  sstot <- sum((d[[v[[y]]]] - mean(d[[v[[y]]]]))^2)
  terms <- setdiff(rownames(tab), c("<none>", "Residuals"))
  back <- function(t) paste(vapply(strsplit(t, ":", fixed = TRUE)[[1]], function(p) ps_bt_back(fr, p), ""), collapse = " \u00d7 ")
  rows <- lapply(terms, function(t) {
    s <- if (ss == "III") tab[t, "Sum of Sq"] else tab[t, "Sum Sq"]; df <- tab[t, "Df"]
    f <- if (ss == "III") tab[t, "F value"] else tab[t, "F value"]; p <- tab[t, "Pr(>F)"]
    list(term = back(t), ss = s, df = df, ms = s / df, f = f, p = p, eta2 = s / sstot, partialEta2 = s / (s + ssres), omega2 = (s - df * msres) / (sstot + msres))
  })
  cells <- split(d[[v[[y]]]], interaction(d[fac], drop = TRUE, sep = " · "))
  tk <- if (oneway) { m <- env$tukey[[1]]; lapply(seq_len(nrow(m)), function(i) list(comparison = rownames(m)[i], diff = m[i, "diff"], ciLow = m[i, "lwr"], ciHigh = m[i, "upr"], p = m[i, "p adj"])) } else NULL
  ps_json(list(dependent = y, factors = fac, covariates = cov, ssType = ss, formula = fml,
    table = rows, residual = list(ss = ssres, df = dfres, ms = msres), n = nrow(d),
    levene = list(stat = env$levene$`F value`[1], df1 = env$levene$Df[1], df2 = env$levene$Df[2], p = env$levene$`Pr(>F)`[1]), shapiro = ps_htest(env$shapiro),
    welch = if (oneway) ps_htest(env$welch) else NULL, welchDf2 = if (oneway) unname(env$welch$parameter[2]) else NULL,
    kruskal = if (oneway) ps_htest(env$kruskal) else NULL, tukey = tk,
    pairwiseRank = if (oneway) { m <- env$pwRank$p.value; Filter(Negate(is.null), unlist(lapply(colnames(m), function(a) lapply(rownames(m), function(b) if (!is.na(m[b, a])) list(comparison = paste(b, "-", a), pHolm = m[b, a]))), recursive = FALSE)) } else NULL,
    cells = lapply(names(cells), function(k) c(list(cell = k), ps_desc(cells[[k]]))),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' Repeated-measures ANOVA: one within-subject factor (one column per level, wide)
#' and optionally one between-subject factor. The univariate tests (aov with an
#' error stratum per subject), Mauchly's test of sphericity, the Greenhouse-Geisser
#' and Huynh-Feldt corrections (anova.mlm, test = "Spherical"); Friedman's test
#' without a between factor.
ps_rmanova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  within <- unlist(req$levels); between <- req$between %||% ""
  if (length(within) < 2) stop("Choose at least two columns: one per level of the within-subject factor.")
  fname <- req$factorName %||% "condition"
  if (!grepl("^[A-Za-z][A-Za-z0-9_.]{0,30}$", fname)) stop("The factor name must be a letter followed by letters, digits, _ or . (at most 31).")
  fr <- ps_long_frame(req, unique(c(within, if (nzchar(between)) between)))
  v <- fr$v
  W <- ps_q(unname(unlist(v[within])))
  bt <- nzchar(between)
  body <- c(sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(within, if (bt) between)])))),
    if (bt) ps_bt_factor_line(req, fr, between),
    sprintf("Y <- as.matrix(data[, %s])", W),
    sprintf("long <- data.frame(subject = factor(rep(seq_len(nrow(Y)), ncol(Y))), %s = factor(rep(%s, each = nrow(Y)), levels = %s), y = c(Y)%s)",
      fname, ps_q(within), ps_q(within), if (bt) sprintf(", %s = rep(data$%s, ncol(Y))", v[[between]], v[[between]]) else ""),
    sprintf("fit <- aov(y ~ %s%s + Error(subject/%s), data = long)", fname, if (bt) sprintf(" * %s", v[[between]]) else "", fname),
    sprintf("mlm <- lm(Y ~ %s)", if (bt) sprintf("data$%s", v[[between]]) else "1"),
    "mauchly <- mauchly.test(mlm, X = ~ 1)",
    "spher <- anova(mlm, X = ~ 1, test = \"Spherical\")  # Greenhouse-Geisser and Huynh-Feldt corrections",
    if (!bt) "friedman <- friedman.test(Y)",
    "# Post hoc: every pair of levels by a paired t-test, p adjusted by Holm's method.",
    "pairs <- combn(ncol(Y), 2, simplify = FALSE)",
    "posthoc <- lapply(pairs, function(p) t.test(Y[, p[1]], Y[, p[2]], paired = TRUE))",
    "pHolm <- p.adjust(vapply(posthoc, function(h) h$p.value, 0), method = \"holm\")")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Repeated-measures ANOVA", character(0), inputs, body, c("summary(fit)", "mauchly", "spher", if (!bt) "friedman", "data.frame(pair = vapply(pairs, paste, \"\", collapse = \" - \"), p = vapply(posthoc, function(h) h$p.value, 0), pHolm)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  sm <- summary(env$fit)
  strat <- function(s) { t <- s[[1]]; rn <- trimws(rownames(t)); lapply(seq_len(nrow(t)), function(i) list(term = rn[i], ss = t[i, "Sum Sq"], df = t[i, "Df"], ms = t[i, "Mean Sq"], f = if ("F value" %in% colnames(t)) t[i, "F value"] else NULL, p = if ("Pr(>F)" %in% colnames(t)) t[i, "Pr(>F)"] else NULL)) }
  bs <- strat(sm[[grep(": subject$", names(sm))]]); ws <- strat(sm[[grep(sprintf(": subject:%s$", fname), names(sm))]])
  ren <- function(rows) lapply(rows, function(r) { r$term <- if (r$term == "Residuals") "Residuals" else paste(vapply(strsplit(r$term, ":", fixed = TRUE)[[1]], function(p) ps_bt_back(fr, p), ""), collapse = " \u00d7 "); r })
  bs <- ren(bs); ws <- ren(ws)
  res_w <- Filter(function(r) r$term == "Residuals", ws)[[1]]$ss
  res_b <- if (length(Filter(function(r) r$term == "Residuals", bs))) Filter(function(r) r$term == "Residuals", bs)[[1]]$ss else NULL
  pe <- function(rows, res) lapply(rows, function(r) { if (r$term != "Residuals" && !is.null(res)) r$partialEta2 <- r$ss / (r$ss + res); r })
  sp <- env$spher
  # (rows of anova.mlm: (Intercept) is the within factor, the between factor its interaction with it)
  k <- ncol(env$Y) - 1
  S <- crossprod(residuals(env$mlm)) / df.residual(env$mlm)
  C <- stats::contr.poly(ncol(env$Y)); M <- t(C) %*% S %*% C
  gg <- sum(diag(M))^2 / (k * sum(diag(M %*% M))); n <- df.residual(env$mlm)
  hf <- min(1, ((n + 1) * k * gg - 2) / (k * (n - k * gg)))
  corr <- lapply(seq_len(nrow(sp) - 1), function(i) list(term = if (i == 1) fname else paste(fname, "\u00d7", between), p = sp[i, "Pr(>F)"], pGG = sp[i, "G-G Pr"], pHF = sp[i, "H-F Pr"]))
  ps_json(list(factorName = fname, levels = within, between = between, n = nrow(env$Y),
    within = pe(ws, res_w), betweenTable = pe(bs, res_b),
    sphericity = list(w = unname(env$mauchly$statistic), p = env$mauchly$p.value, gg = gg, hf = hf), corrected = corr,
    friedman = if (!bt) ps_htest(env$friedman) else NULL,
    posthoc = lapply(seq_along(env$pairs), function(i) { p <- env$pairs[[i]]; h <- env$posthoc[[i]]
      list(comparison = paste(within[p[1]], "-", within[p[2]]), diff = unname(h$estimate), t = unname(h$statistic), df = unname(h$parameter), p = h$p.value, pHolm = env$pHolm[i]) }),
    cells = lapply(within, function(l) c(list(cell = l), ps_desc(env$Y[, v[[l]]]))),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' MANOVA: summary.manova with Pillai's trace, Wilks' lambda, Hotelling-Lawley
#' trace and Roy's largest root for each term.
ps_manova <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  ys <- unlist(req$dependents); fac <- unlist(req$factors)
  if (length(ys) < 2 || !length(fac)) stop("Choose at least two dependent variables and one factor.")
  full <- !identical(req$interactions, FALSE)
  fr <- ps_long_frame(req, unique(c(ys, fac)))
  v <- fr$v
  fml <- sprintf("cbind(%s) ~ %s", paste(unname(unlist(v[ys])), collapse = ", "), paste(unname(unlist(v[fac])), collapse = if (full) " * " else " + "))
  tests <- c("Pillai", "Wilks", "Hotelling-Lawley", "Roy")
  body <- c(sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(ys, fac)])))),
    vapply(fac, function(n) ps_bt_factor_line(req, fr, n), ""),
    sprintf("fit <- manova(%s, data = data)", fml),
    sprintf("res <- lapply(%s, function(t) summary(fit, test = t)$stats)", ps_q(tests)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("MANOVA", character(0), inputs, body, "res"), collapse = "\n"))
  env <- ps_run(body, inputs)
  back <- function(t) paste(vapply(strsplit(trimws(t), ":", fixed = TRUE)[[1]], function(p) ps_bt_back(fr, p), ""), collapse = " \u00d7 ")
  out <- lapply(seq_along(tests), function(i) { s <- env$res[[i]]; rn <- setdiff(trimws(rownames(s)), "Residuals")
    list(test = tests[i], rows = lapply(rn, function(t) { j <- which(trimws(rownames(s)) == t); list(term = back(t), df = s[j, 1], value = s[j, 2], f = s[j, 3], df1 = s[j, 4], df2 = s[j, 5], p = s[j, 6]) })) })
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
  if (!method %in% c("pearson", "spearman", "kendall", "polychoric")) stop("Invalid correlation method in the request.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  listwise <- identical(req$deletion, "listwise")
  fr <- ps_long_frame(req, vars)
  v <- fr$v
  if (method == "polychoric") return(ps_polychoric(fr, vars, alt, conf, listwise, export))
  body <- c(if (listwise) sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[vars])))),
    sprintf("vars <- %s", ps_q(unname(unlist(v[vars])))),
    "pairs <- combn(vars, 2, simplify = FALSE)",
    sprintf("tests <- lapply(pairs, function(p) cor.test(data[[p[1]]], data[[p[2]]], method = \"%s\", alternative = \"%s\"%s))", method, alt,
      if (method == "pearson") sprintf(", conf.level = %s", format(conf)) else ", exact = FALSE"),
    "n <- vapply(pairs, function(p) sum(complete.cases(data[[p[1]]], data[[p[2]]])), 0)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Correlations (%s)", method), character(0), inputs, body, "setNames(tests, vapply(pairs, paste, \"\", collapse = \" ~ \"))"), collapse = "\n"))
  env <- ps_run(body, inputs)
  rows <- lapply(seq_along(env$pairs), function(i) { p <- env$pairs[[i]]; h <- env$tests[[i]]
    list(a = fr$back[[p[1]]], b = fr$back[[p[2]]], r = unname(h$estimate), p = h$p.value, n = env$n[i], stat = unname(h$statistic),
      ciLow = if (is.null(h$conf.int)) NULL else h$conf.int[1], ciHigh = if (is.null(h$conf.int)) NULL else h$conf.int[2]) })
  ps_json(list(method = method, alternative = alt, confidence = conf, deletion = if (listwise) "listwise" else "pairwise", vars = vars, pairs = rows,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
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
  ordinal <- vapply(col, function(k) { x <- fr$data[[k]]; x <- x[!is.na(x)]; length(x) > 0 && all(x == round(x)) && length(unique(x)) <= 8 }, TRUE)
  if (!any(ordinal)) stop("No variable has at most 8 categories (integer values), so there is nothing ordinal to correlate: choose Pearson, Spearman or Kendall.")
  bin <- vapply(col, function(k) length(unique(stats::na.omit(fr$data[[k]]))) == 2, TRUE)
  body <- c("suppressPackageStartupMessages(library(lavaan))",
    sprintf("vars <- %s", ps_q(col)),
    sprintf("ordinal <- %s  # integer values, at most 8 categories", ps_q(col[ordinal])),
    if (listwise) "data <- data[complete.cases(data[, vars]), ]",
    "# (continuous variables standardised, so that every estimate is a correlation)",
    "for (k in setdiff(vars, ordinal)) data[[k]] <- as.numeric(scale(data[[k]]))",
    sprintf("fit <- lavCor(data[, vars], ordered = ordinal, se = \"standard\", output = \"fit\", missing = \"%s\")", if (listwise) "listwise" else "pairwise"),
    sprintf("est <- standardizedSolution(fit, level = %s)", format(conf)),
    "est <- est[est$op == \"~~\" & est$lhs != est$rhs, ]",
    "n <- vapply(seq_len(nrow(est)), function(i) sum(complete.cases(data[[est$lhs[i]]], data[[est$rhs[i]]])), 0)",
    if (sum(ordinal) >= 2) "normality <- lavTables(fit, dimension = 2L, type = \"table\", statistic = c(\"X2\", \"G2\"), p_value = TRUE)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Polychoric correlations (lavaan)", "lavaan", inputs, body, c("est", if (sum(ordinal) >= 2) "normality")), collapse = "\n"))
  env <- ps_run(body, inputs)
  e <- env$est
  z <- e$est.std / e$se
  p <- switch(alt, two.sided = 2 * stats::pnorm(-abs(z)), greater = stats::pnorm(-z), less = stats::pnorm(z))
  kind <- function(a, b) { oa <- ordinal[[a]]; ob <- ordinal[[b]]
    if (oa && ob) { if (bin[[a]] && bin[[b]]) "tetrachoric" else "polychoric" } else if (oa || ob) "polyserial" else "pearson" }
  rows <- lapply(seq_len(nrow(e)), function(i) list(a = fr$back[[e$lhs[i]]], b = fr$back[[e$rhs[i]]], r = e$est.std[i], p = p[i], n = env$n[i], stat = z[i],
    se = e$se[i], ciLow = e$ci.lower[i], ciHigh = e$ci.upper[i], kind = kind(e$lhs[i], e$rhs[i])))
  nt <- env$normality
  ps_json(list(method = "polychoric", alternative = alt, confidence = conf, deletion = if (listwise) "listwise" else "pairwise", vars = vars, pairs = rows,
    ordinal = I(unname(vapply(col[ordinal], function(k) fr$back[[k]], ""))),
    normality = if (is.null(nt)) list() else lapply(seq_len(nrow(nt)), function(i) list(a = fr$back[[as.character(nt$lhs[i])]], b = fr$back[[as.character(nt$rhs[i])]],
      df = as.numeric(nt$df[i]), x2 = as.numeric(nt$X2[i]), x2p = as.numeric(nt$X2.pval[i]), g2 = as.numeric(nt$G2[i]), g2p = as.numeric(nt$G2.pval[i]))),
    warnings = env$.warnings, engine = list(package = "lavaan", version = as.character(utils::packageVersion("lavaan")))))
}

#' Contingency table: counts (or a column of frequencies), expected counts, the
#' Pearson chi-square (and with continuity correction for 2 x 2), the
#' likelihood-ratio G, Fisher's exact test, Cramer's V, and for 2 x 2 phi and the
#' odds ratio with its confidence interval.
ps_contingency <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  rv <- req$rows %||% ""; cv <- req$columns %||% ""; wv <- req$counts %||% ""
  if (!nzchar(rv) || !nzchar(cv) || rv == cv) stop("Choose two different variables for the rows and the columns.")
  conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, unique(c(rv, cv, if (nzchar(wv)) wv)))
  v <- fr$v
  body <- c(sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[c(rv, cv, if (nzchar(wv)) wv)])))),
    ps_bt_factor_line(req, fr, rv), ps_bt_factor_line(req, fr, cv),
    sprintf("tab <- xtabs(%s~ %s + %s, data = data)", if (nzchar(wv)) paste0(v[[wv]], " ") else "", v[[rv]], v[[cv]]),
    "chi <- chisq.test(tab, correct = FALSE)",
    "chiYates <- if (all(dim(tab) == 2)) chisq.test(tab, correct = TRUE)",
    "E <- chi$expected",
    "G2 <- 2 * sum(ifelse(tab > 0, tab * log(tab / E), 0)); pG2 <- pchisq(G2, chi$parameter, lower.tail = FALSE)  # likelihood ratio",
    sprintf("fisher <- tryCatch(fisher.test(tab, conf.level = %s, workspace = 2e7), error = function(e) NULL)  # (NULL when the table is too large for the exact test)", format(conf)),
    "cramerV <- sqrt(unname(chi$statistic) / (sum(tab) * (min(dim(tab)) - 1)))",
    "if (all(dim(tab) == 2)) {",
    "  phi <- (tab[1, 1] * tab[2, 2] - tab[1, 2] * tab[2, 1]) / sqrt(prod(rowSums(tab)) * prod(colSums(tab)))",
    "  or <- (tab[1, 1] * tab[2, 2]) / (tab[1, 2] * tab[2, 1])  # sample odds ratio; Wald interval on the log scale",
    sprintf("  orCI <- exp(log(or) + c(-1, 1) * qnorm(1 - (1 - %s) / 2) * sqrt(sum(1 / tab)))", format(conf)),
    "}")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Contingency table", character(0), inputs, body, c("tab", "chi", "chiYates", "c(G2 = G2, p = pG2)", "fisher", "cramerV")), collapse = "\n"))
  env <- ps_run(body, inputs)
  tab <- env$tab
  two <- all(dim(tab) == 2)
  ps_json(list(rows = rv, columns = cv, rowLevels = rownames(tab), colLevels = colnames(tab), counts = lapply(seq_len(nrow(tab)), function(i) unname(as.numeric(tab[i, ]))),
    expected = lapply(seq_len(nrow(tab)), function(i) unname(env$E[i, ])), n = sum(tab),
    chisq = ps_htest(env$chi), yates = ps_htest(env$chiYates), likelihoodRatio = list(stat = env$G2, df = unname(env$chi$parameter), p = env$pG2),
    fisher = ps_htest(env$fisher), cramerV = env$cramerV,
    phi = if (two) env$phi else NULL, oddsRatio = if (two) list(est = env$or, ciLow = env$orCI[1], ciHigh = env$orCI[2]) else NULL, confidence = conf,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
}

#' Binomial test (each category against the rest, exact Clopper-Pearson interval)
#' and the multinomial goodness-of-fit chi-square (equal or given proportions).
ps_freqtest <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  x <- req$variable %||% ""
  if (!nzchar(x)) stop("Choose the variable.")
  type <- req$type %||% "binomial"
  if (!type %in% c("binomial", "multinomial")) stop("Invalid test in the request.")
  alt <- ps_bt_alt(req); conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, x)
  v <- fr$v
  body <- c(sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[x]]), ps_bt_factor_line(req, fr, x), sprintf("counts <- table(data$%s)", v[[x]]))
  if (type == "binomial") {
    p0 <- ps_number(req$testValue %||% 0.5, "test proportion")
    if (p0 <= 0 || p0 >= 1) stop("The test proportion must be between 0 and 1.")
    body <- c(body, sprintf("tests <- lapply(counts, function(k) binom.test(k, sum(counts), p = %s, alternative = \"%s\", conf.level = %s))", format(p0, digits = 15), alt, format(conf)))
  } else {
    lv <- levels(factor(fr$data[[v[[x]]]]))
    props <- unlist(req$proportions)
    if (length(props) && (length(props) != length(lv) || any(!is.finite(props)) || any(props <= 0))) stop(sprintf("Give one positive expected proportion per category (%d).", length(lv)))
    body <- c(body, sprintf("gof <- chisq.test(counts%s)", if (length(props)) sprintf(", p = c(%s), rescale.p = TRUE", paste(format(props, digits = 15), collapse = ", ")) else ""))
  }
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(if (type == "binomial") "Binomial test" else "Multinomial test", character(0), inputs, body, c("counts", if (type == "binomial") "tests" else "gof")), collapse = "\n"))
  env <- ps_run(body, inputs)
  ct <- env$counts
  ps_json(list(type = type, variable = x, levels = names(ct), counts = unname(as.numeric(ct)), n = sum(ct), alternative = alt, confidence = conf,
    binomial = if (type == "binomial") unname(lapply(env$tests, function(h) c(ps_htest(h), list(proportion = unname(h$estimate))))) else NULL,
    testValue = if (type == "binomial") p0 else NULL,
    multinomial = if (type == "multinomial") c(ps_htest(env$gof), list(expected = unname(env$gof$expected))) else NULL,
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))))
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
  if (!type %in% c("scale", "icc", "kappa", "blandaltman")) stop("Invalid reliability analysis in the request.")
  vars <- unlist(req$vars)
  need <- c(scale = 2, icc = 2, kappa = 2, blandaltman = 2)[[type]]
  if (length(vars) < need) stop(sprintf("Choose at least %d variables.", need))
  if (type %in% c("kappa", "blandaltman") && length(vars) != 2) stop("Choose exactly two variables (the two raters or methods).")
  conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  body <- c(sprintf("X <- data[complete.cases(data[, %s]), %s, drop = FALSE]", ps_q(v), ps_q(v)))
  body <- c(body, switch(type,
    scale = c("suppressPackageStartupMessages(library(psych))",
      "a <- alpha(X, check.keys = FALSE)  # Cronbach's alpha, item statistics, alpha if an item is dropped",
      "# Omega total of one factor (omega hierarchical is not reported: its one-factor warnings do not concern omega total).",
      "o <- suppressWarnings(suppressMessages(omega(X, nfactors = 1, plot = FALSE)))",
      "g <- glb.fa(cor(X))  # greatest lower bound (psych's factor-analytic estimate)"),
    icc = c("suppressPackageStartupMessages(library(psych))", sprintf("icc <- ICC(X, lmer = FALSE, alpha = %s)  # rows: subjects; columns: raters", format(1 - conf))),
    kappa = c("suppressPackageStartupMessages(library(psych))", sprintf("k <- cohen.kappa(X, alpha = %s)  # weighted: squared distances between categories", format(1 - conf))),
    blandaltman = c("d <- X[[1]] - X[[2]]; m <- (X[[1]] + X[[2]]) / 2",
      "bias <- mean(d); s <- sd(d); n <- length(d)",
      "loa <- bias + c(-1, 1) * 1.96 * s  # limits of agreement",
      sprintf("biasCI <- bias + c(-1, 1) * qt(1 - (1 - %s) / 2, n - 1) * s / sqrt(n)", format(conf)))))
  inputs <- list(data = fr$data)
  title <- c(scale = "Scale reliability (psych)", icc = "Intraclass correlation (psych)", kappa = "Cohen's kappa (psych)", blandaltman = "Bland-Altman agreement")[[type]]
  if (export) return(paste(ps_script(title, if (type == "blandaltman") character(0) else c("psych", "GPArotation")[seq_len(if (type == "scale") 2 else 1)], inputs, body,
    switch(type, scale = c("a", "o$omega.tot", "g$glb"), icc = "icc", kappa = "k", blandaltman = c("c(bias = bias, sd = s, lower = loa[1], upper = loa[2])", "biasCI"))), collapse = "\n"))
  env <- ps_run(body, inputs)
  n <- nrow(env$X)
  out <- switch(type,
    scale = { a <- env$a; tot <- a$total; dr <- a$alpha.drop; is <- a$item.stats
      list(alpha = tot$raw_alpha, stdAlpha = tot$std.alpha, averageR = tot$average_r, omegaTotal = env$o$omega.tot, glb = env$g$glb, mean = tot$mean, sd = tot$sd,
        items = lapply(seq_len(nrow(dr)), function(i) list(item = vars[i], alphaIfDropped = dr$raw_alpha[i], itemRest = is$r.drop[i], mean = is$mean[i], sd = is$sd[i]))) },
    icc = { r <- env$icc$results
      list(icc = lapply(seq_len(nrow(r)), function(i) list(type = as.character(r$type[i]), icc = r$ICC[i], f = r$F[i], df1 = r$df1[i], df2 = r$df2[i], p = r$p[i], ciLow = r[i, "lower bound"], ciHigh = r[i, "upper bound"]))) },
    kappa = { cf <- env$k$confid
      list(kappa = list(est = cf[1, 2], ciLow = cf[1, 1], ciHigh = cf[1, 3]), weighted = list(est = cf[2, 2], ciLow = cf[2, 1], ciHigh = cf[2, 3]), agreement = env$k$agree, categories = nrow(env$k$agree)) },
    blandaltman = { keep <- if (n > 5000) seq(1, n, length.out = 5000) else seq_len(n)
      list(bias = env$bias, sd = env$s, lower = env$loa[1], upper = env$loa[2], biasCiLow = env$biasCI[1], biasCiHigh = env$biasCI[2], points = list(mean = unname(env$m[keep]), diff = unname(env$d[keep]))) })
  if (type == "kappa") out$agreement <- NULL
  ps_json(c(list(type = type, vars = vars, n = n, confidence = conf), out, list(warnings = env$.warnings,
    engine = if (type == "blandaltman") list(package = "stats", version = as.character(getRversion())) else list(package = "psych", version = as.character(utils::packageVersion("psych"))))))
}
