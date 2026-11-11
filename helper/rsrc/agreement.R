# Agreement of several raters, the multi-rater modes of the reliability card
# (ps_reliability in tests.R dispatches here):
# - fleiss: Fleiss' kappa with its z test and the kappa of each category (Fleiss 1971),
#   and Conger's (1980) exact kappa (irr::kappam.fleiss);
# - kripp: Krippendorff's alpha for nominal, ordinal, interval or ratio data
#   (irr::kripp.alpha), with a bootstrap interval over the units (subjects);
# - kendallw: Kendall's coefficient of concordance W, without and with the
#   correction for ties (irr::kendall).
# The data: one column per rater, one row per subject rated.

PS_AGREEMENT_TYPES <- c("fleiss", "kripp", "kendallw")
PS_KRIPP_LEVELS <- c("nominal", "ordinal", "interval", "ratio")

#' The script lines that turn the raters' columns `X` into the matrix `ratings`.
#' Category columns are compared by their labels, not their codes (two raters'
#' columns may code the same category differently): each label becomes its position
#' among the categories of all raters, in the order the raters' columns list them.
ps_agreement_ratings <- function(req, fr, vars) {
  cats <- lapply(vars, function(n) unlist(req$categories[[n]]))
  if (all(vapply(cats, is.null, TRUE))) {
    return("ratings <- as.matrix(X)")
  }
  labels_of <- function(i) {
    x <- fr$data[[fr$v[[vars[i]]]]]
    codes <- sort(unique(x[!is.na(x)]))
    l <- cats[[i]]
    if (!is.null(l) && all(codes %in% seq_along(l))) {
      return(l)
    }
    format(codes, digits = 15, trim = TRUE)
  }
  all_labels <- lapply(seq_along(vars), labels_of)
  lev <- unique(unlist(all_labels))
  recode <- vapply(seq_along(vars), function(i) {
    vn <- fr$v[[vars[i]]]
    if (is.null(cats[[i]])) {
      sprintf("X$%s <- match(format(X$%s, digits = 15, trim = TRUE), lev)", vn, vn)
    } else {
      sprintf("X$%s <- match(%s[X$%s], lev)", vn, ps_q(cats[[i]]), vn)
    }
  }, "")
  c(
    "# Categories compared by their labels: each becomes its position among all raters' categories.",
    sprintf("lev <- %s", ps_q(lev)),
    recode,
    "ratings <- as.matrix(X)"
  )
}

#' The number of bootstrap replicates of Krippendorff's alpha (0: none).
ps_kripp_boot <- function(req) {
  b <- as.integer(ps_number(req$bootstrap %||% 1000, "number of bootstrap samples"))
  if (b != 0 && (b < 100 || b > 20000)) {
    stop("The number of bootstrap samples must be 0 or between 100 and 20000.")
  }
  b
}

#' The script lines of each agreement statistic, from `ratings`.
ps_agreement_lines <- function(req, type, conf) {
  switch(type,
    fleiss = c(
      "suppressPackageStartupMessages(library(irr))",
      "fleiss <- kappam.fleiss(ratings)  # Fleiss' kappa and its z test",
      "conger <- kappam.fleiss(ratings, exact = TRUE)  # Conger's exact kappa",
      "# The kappa of each category (Fleiss 1971): x[i, j] raters put subject i in category j.",
      "m <- ncol(ratings)",
      "n <- nrow(ratings)",
      "x <- t(apply(ratings, 1, function(r) table(factor(r, levels = sort(unique(c(ratings)))))))",
      "pj <- colSums(x) / (n * m)",
      "kappaJ <- 1 - colSums(x * (m - x)) / (n * m * (m - 1) * pj * (1 - pj))",
      "zJ <- kappaJ / sqrt(2 / (n * m * (m - 1)))",
      "pJ <- 2 * pnorm(-abs(zJ))"
    ),
    kripp = {
      level <- req$krippLevel %||% "nominal"
      if (!level %in% PS_KRIPP_LEVELS) stop("Invalid level of measurement in the request.")
      boot <- ps_kripp_boot(req)
      seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
      c(
        "suppressPackageStartupMessages(library(irr))",
        "# kripp.alpha takes the raters as rows and the units (subjects) as columns.",
        sprintf("alpha <- kripp.alpha(t(ratings), method = \"%s\")", level),
        if (boot > 0) {
          c(
            "# Bootstrap over the units: subjects drawn with replacement, alpha recomputed.",
            sprintf("set.seed(%d)", seed),
            sprintf("boot <- replicate(%d, {", boot),
            "  units <- sample(nrow(ratings), replace = TRUE)",
            sprintf("  kripp.alpha(t(ratings[units, , drop = FALSE]), method = \"%s\")$value", level),
            "})",
            "boot <- boot[is.finite(boot)]",
            sprintf("alphaCI <- quantile(boot, c(%s, %s), names = FALSE)", format((1 - conf) / 2), format(1 - (1 - conf) / 2)),
            "# The share of bootstrap alphas below Krippendorff's thresholds for tentative and reliable data.",
            "below <- c(\"0.667\" = mean(boot < 0.667), \"0.8\" = mean(boot < 0.8))"
          )
        }
      )
    },
    kendallw = c(
      "suppressPackageStartupMessages(library(irr))",
      "# Kendall's W: each rater's ranking of the subjects (rows: subjects; columns: raters).",
      "w <- kendall(ratings, correct = FALSE)",
      "wt <- kendall(ratings, correct = TRUE)  # corrected for tied ranks"
    )
  )
}

#' The agreement analysis: script, or run and results.
ps_agreement <- function(req, type, export) {
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two raters' columns.")
  conf <- ps_bt_conf(req)
  fr <- ps_long_frame(req, vars)
  v <- unname(unlist(fr$v[vars]))
  # Fleiss and Kendall need every rater's rating; the others use the subjects
  # with at least one rating.
  complete <- type %in% c("fleiss", "kendallw")
  keep <- if (complete) {
    sprintf("X <- data[complete.cases(data[, %s]), %s, drop = FALSE]", ps_q(v), ps_q(v))
  } else {
    sprintf("X <- data[rowSums(!is.na(data[, %s])) > 0, %s, drop = FALSE]", ps_q(v), ps_q(v))
  }
  body <- c(
    keep,
    ps_agreement_ratings(req, fr, vars),
    ps_agreement_lines(req, type, conf)
  )
  inputs <- list(data = fr$data)
  title <- c(
    fleiss = "Fleiss' kappa (irr)",
    kripp = "Krippendorff's alpha (irr)",
    kendallw = "Kendall's W (irr)"
  )[[type]]
  packages <- c("irr", "lpSolve")
  if (export) {
    report <- switch(type,
      fleiss = c("fleiss", "conger", "data.frame(kappa = kappaJ, z = zJ, p = pJ)"),
      kripp = c("alpha", if (ps_kripp_boot(req) > 0) c("alphaCI", "below")),
      kendallw = c("w", "wt")
    )
    return(ps_script(title, packages, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  out <- switch(type,
    fleiss = ps_fleiss_result(env),
    kripp = ps_kripp_result(env, req),
    kendallw = ps_kendall_result(env)
  )
  ps_json(c(
    list(type = type, vars = vars, n = nrow(env$ratings), raters = ncol(env$ratings), confidence = conf),
    out,
    list(
      warnings = env$.warnings,
      engine = ps_engine("irr")
    )
  ))
}

#' The category labels of the ratings' values (their positions in `lev`, or the values).
ps_agreement_labels <- function(env, values) {
  if (!is.null(env$lev)) env$lev[values] else format(values, digits = 15, trim = TRUE)
}

ps_fleiss_result <- function(env) {
  values <- sort(unique(c(env$ratings)))
  list(
    fleiss = list(
      kappa = env$fleiss$value,
      z = unname(env$fleiss$statistic),
      p = env$fleiss$p.value,
      exact = env$conger$value
    ),
    fleissCategories = lapply(seq_along(values), function(j) {
      list(
        category = ps_agreement_labels(env, values[j]),
        kappa = unname(env$kappaJ[j]),
        z = unname(env$zJ[j]),
        p = unname(env$pJ[j])
      )
    })
  )
}

ps_kripp_result <- function(env, req) {
  a <- env$alpha
  boot <- env$boot
  list(
    kripp = list(
      alpha = a$value,
      level = a$data.level,
      pairable = a$nmatchval,
      bootstrap = if (is.null(boot)) 0L else length(boot),
      seed = if (is.null(boot)) NULL else as.integer(req$seed %||% 1),
      ciLow = if (is.null(boot)) NULL else env$alphaCI[1],
      ciHigh = if (is.null(boot)) NULL else env$alphaCI[2],
      below667 = if (is.null(boot)) NULL else unname(env$below[1]),
      below800 = if (is.null(boot)) NULL else unname(env$below[2])
    )
  )
}

ps_kendall_result <- function(env) {
  row <- function(k, corrected) {
    list(
      corrected = corrected,
      w = k$value,
      chisq = unname(k$statistic),
      df = nrow(env$ratings) - 1,
      p = k$p.value
    )
  }
  list(kendall = list(row(env$w, FALSE), row(env$wt, TRUE)))
}
