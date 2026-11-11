# Descriptives / Explore (JASP's Descriptives, SPSS's Descriptives, Frequencies and
# Explore): descriptive statistics of chosen variables, optionally split by a grouping
# column; frequency tables of categorical variables; normality tests (Shapiro-Wilk,
# Kolmogorov-Smirnov with the Lilliefors correction and Anderson-Darling, nortest).
# Each run builds the script it runs (exported as is); this file shapes the output.

#' The functions the exported script defines: skewness and excess kurtosis as SPSS, SAS
#' and psych::describe(type = 2) define them (G1 and G2, the sample-size adjusted
#' moment coefficients) with SPSS's standard errors, one variable's descriptives, its
#' normality tests and a frequency table.
PS_EXPLORE_FUNCTIONS <- c(
  "# Skewness G1 and excess kurtosis G2 (type 2: SPSS, SAS, psych::describe(type = 2)).",
  "skewness_g1 <- function(x) {",
  "  n <- length(x)",
  "  m <- x - mean(x)",
  "  g1 <- mean(m^3) / mean(m^2)^1.5",
  "  g1 * sqrt(n * (n - 1)) / (n - 2)",
  "}",
  "kurtosis_g2 <- function(x) {",
  "  n <- length(x)",
  "  m <- x - mean(x)",
  "  g2 <- mean(m^4) / mean(m^2)^2 - 3",
  "  ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3))",
  "}",
  "# Their standard errors (SPSS's formulas).",
  "se_skewness <- function(n) sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))",
  "se_kurtosis <- function(n) 2 * se_skewness(n) * sqrt((n^2 - 1) / ((n - 3) * (n + 5)))",
  "",
  "# One variable (or one group of it): missing values left out.",
  "describe_one <- function(x, probs, type, conf) {",
  "  missing <- sum(is.na(x))",
  "  x <- x[!is.na(x)]",
  "  n <- length(x)",
  "  if (n == 0) {",
  "    return(list(n = 0, missing = missing))",
  "  }",
  "  s <- if (n > 1) sd(x) else NA",
  "  se <- s / sqrt(n)",
  "  half <- if (n > 1) qt(1 - (1 - conf) / 2, n - 1) * se else NA",
  "  q <- quantile(x, c(0.25, 0.5, 0.75), type = type, names = FALSE)",
  "  counts <- table(x)",
  "  modes <- as.numeric(names(counts)[counts == max(counts)])",
  "  list(",
  "    n = n,",
  "    missing = missing,",
  "    mean = mean(x),",
  "    sd = s,",
  "    se = se,",
  "    ci_low = mean(x) - half,",
  "    ci_high = mean(x) + half,",
  "    median = median(x),",
  "    q1 = q[1],",
  "    q3 = q[3],",
  "    iqr = q[3] - q[1],",
  "    percentiles = quantile(x, probs, type = type, names = FALSE),",
  "    min = min(x),",
  "    max = max(x),",
  "    range = max(x) - min(x),",
  "    skewness = if (n > 2) skewness_g1(x) else NA,",
  "    se_skewness = if (n > 2) se_skewness(n) else NA,",
  "    kurtosis = if (n > 3) kurtosis_g2(x) else NA,",
  "    se_kurtosis = if (n > 3) se_kurtosis(n) else NA,",
  "    cv = s / mean(x),",
  "    mode = min(modes),",
  "    modes = length(modes)",
  "  )",
  "}",
  "",
  "# Frequency table of a factor: counts, percent of all rows, valid percent, cumulative percent.",
  "frequencies_one <- function(x) {",
  "  counts <- table(x, useNA = \"no\")",
  "  valid <- sum(counts)",
  "  list(",
  "    levels = names(counts),",
  "    counts = as.vector(counts),",
  "    percent = 100 * as.vector(counts) / length(x),",
  "    valid_percent = 100 * as.vector(counts) / valid,",
  "    cumulative = cumsum(100 * as.vector(counts) / valid),",
  "    missing = sum(is.na(x)),",
  "    total = length(x)",
  "  )",
  "}"
)

#' The normality-test function of the script (nortest only when it is used).
PS_EXPLORE_NORMALITY <- c(
  "",
  "# Normality tests where their sample sizes allow them; NULL for a constant variable.",
  "normality_one <- function(x) {",
  "  x <- x[!is.na(x)]",
  "  n <- length(x)",
  "  if (n < 3 || sd(x) == 0) {",
  "    return(list(n = n))",
  "  }",
  "  list(",
  "    n = n,",
  "    shapiro = if (n <= 5000) shapiro.test(x),",
  "    lilliefors = if (n > 4) nortest::lillie.test(x),",
  "    anderson = if (n > 7) nortest::ad.test(x)",
  "  )",
  "}"
)

#' Percentiles from the request: numbers strictly between 0 and 100, at most 20.
ps_explore_percentiles <- function(x) {
  p <- as.numeric(unlist(x))
  if (length(p) > 20 || anyNA(p) || any(p <= 0 | p >= 100)) {
    stop("Percentiles must be numbers between 0 and 100 (at most 20).")
  }
  sort(unique(p))
}

#' A test result for the reply (NULL stays NULL).
ps_explore_test <- function(h) {
  if (is.null(h)) {
    return(NULL)
  }
  list(stat = unname(h$statistic), p = unname(h$p.value))
}

#' Descriptives / Explore. Request: vars (numeric columns), frequencies (columns for
#' frequency tables), group (optional), percentiles, quantileType (6 or 7), normality,
#' confidence, categories (the category names of text columns), data.
ps_explore <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- as.character(unlist(req$vars))
  freqs <- as.character(unlist(req$frequencies))
  group <- req$group %||% ""
  if (!length(vars) && !length(freqs)) {
    stop("Choose at least one variable.")
  }
  type <- ps_number(req$quantileType %||% 7, "quantile type")
  if (!type %in% c(6, 7)) stop("Invalid quantile type in the request.")
  conf <- ps_bt_conf(req)
  probs <- ps_explore_percentiles(req$percentiles) / 100
  normality <- isTRUE(req$normality) && length(vars) > 0
  if (nzchar(group) && group %in% c(vars, freqs)) {
    stop("The grouping variable cannot also be described.")
  }
  fr <- ps_long_frame(req, unique(c(vars, freqs, if (nzchar(group)) group)))
  v <- fr$v
  # (rows without a group are left out; without a grouping variable, one group of all rows)
  group_lines <- if (nzchar(group)) {
    c(
      ps_bt_factor_line(req, fr, group),
      sprintf("dropped <- sum(is.na(data$%s))", v[[group]]),
      sprintf("data <- data[!is.na(data$%s), , drop = FALSE]", v[[group]]),
      sprintf("g <- data$%s", v[[group]])
    )
  } else {
    c("dropped <- 0", "g <- factor(rep(\"All\", nrow(data)))")
  }
  freq_lines <- unlist(lapply(freqs, function(n) ps_bt_factor_line(req, fr, n)))
  probs_text <- paste(format(probs, digits = 15, trim = TRUE), collapse = ", ")
  body <- c(
    PS_EXPLORE_FUNCTIONS,
    if (normality) PS_EXPLORE_NORMALITY,
    "",
    "# The groups.",
    group_lines,
    if (length(freqs)) c("# Categorical variables: factors with their category names.", freq_lines),
    "",
    if (length(probs)) sprintf("probs <- c(%s)", probs_text) else "probs <- numeric(0)",
    if (length(vars)) {
      c(
        "descriptives <- lapply(",
        sprintf("  data[%s],", ps_q(unname(unlist(v[vars])))),
        sprintf(
          "  function(x) lapply(split(x, g), describe_one, probs = probs, type = %d, conf = %s)",
          as.integer(type),
          format(conf, digits = 15)
        ),
        ")"
      )
    },
    if (normality) {
      c(
        "normality <- lapply(",
        sprintf("  data[%s],", ps_q(unname(unlist(v[vars])))),
        "  function(x) lapply(split(x, g), normality_one)",
        ")"
      )
    },
    if (length(freqs)) {
      c(
        "frequencies <- lapply(",
        sprintf("  data[%s],", ps_q(unname(unlist(v[freqs])))),
        "  function(x) lapply(split(x, g), frequencies_one)",
        ")"
      )
    }
  )
  inputs <- list(data = fr$data)
  report <- c(
    if (length(vars)) "descriptives",
    if (normality) "normality",
    if (length(freqs)) "frequencies"
  )
  if (export) {
    pkgs <- if (normality) "nortest" else character(0)
    return(ps_script("Descriptives", pkgs, inputs, body, report))
  }
  env <- ps_run(body, inputs)
  groups <- levels(env$g)
  stats <- unlist(lapply(vars, function(n) {
    lapply(groups, function(l) {
      d <- env$descriptives[[v[[n]]]][[l]]
      d$percentiles <- I(d$percentiles)
      # (the reply's names in the app's style: ci_low -> ciLow)
      names(d) <- gsub("_([a-z])", "\\U\\1", names(d), perl = TRUE)
      c(list(variable = n, group = l), d)
    })
  }), recursive = FALSE)
  norm <- if (normality) {
    unlist(lapply(vars, function(n) {
      lapply(groups, function(l) {
        t <- env$normality[[v[[n]]]][[l]]
        list(
          variable = n,
          group = l,
          n = t$n,
          shapiro = ps_explore_test(t$shapiro),
          lilliefors = ps_explore_test(t$lilliefors),
          anderson = ps_explore_test(t$anderson)
        )
      })
    }), recursive = FALSE)
  }
  tables <- unlist(lapply(freqs, function(n) {
    lapply(groups, function(l) {
      f <- env$frequencies[[v[[n]]]][[l]]
      list(
        variable = n,
        group = l,
        levels = I(f$levels),
        counts = I(f$counts),
        percent = I(f$percent),
        validPercent = I(f$valid_percent),
        cumulative = I(f$cumulative),
        missing = f$missing,
        total = f$total
      )
    })
  }), recursive = FALSE)
  ps_json(list(
    vars = I(vars),
    frequencyVars = I(freqs),
    group = group,
    groups = I(if (nzchar(group)) groups else character(0)),
    droppedRows = env$dropped,
    quantileType = type,
    percentiles = I(probs * 100),
    confidence = conf,
    stats = stats,
    normality = norm,
    frequencies = tables,
    warnings = env$.warnings,
    engine = if (normality) ps_engine("nortest") else ps_engine("stats")
  ))
}
