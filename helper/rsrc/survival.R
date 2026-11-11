# Kaplan-Meier survival curves with survival (Therneau): the estimates with
# pointwise confidence intervals, median survival with its interval, the
# numbers at risk at chosen times, and tests of equal survival between groups
# (survdiff: the log-rank test, rho = 0, and the Peto & Peto modification of
# the Gehan-Wilcoxon test, rho = 1).

ps_km <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  time <- req[["time", exact = TRUE]] %||% ""
  status <- req[["status", exact = TRUE]] %||% ""
  group <- req[["group", exact = TRUE]] %||% ""
  if (!nzchar(time) || !nzchar(status)) stop("Choose the time and status columns.")
  if (time == status || group %in% c(time, status)) {
    stop("The time, status and group columns must differ.")
  }
  status_censored <- isTRUE(req$statusCensored)
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  if (conf <= 0.5 || conf >= 1) stop("Invalid confidence level in the request.")
  conf_type <- req[["confType", exact = TRUE]] %||% "log"
  if (!(is.character(conf_type) && length(conf_type) == 1 &&
    conf_type %in% c("log", "log-log", "plain"))) {
    stop("Invalid confidence interval type in the request.")
  }
  cols <- c(time, status, if (nzchar(group)) group)
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  levels_of <- req$categories %||% list()
  if (!is.null(levels_of[[time]]) || !is.null(levels_of[[status]])) {
    stop("The time and status columns must be numeric.")
  }
  st <- fr$data[[v[[status]]]]
  if (!all(st %in% c(0, 1, NA))) stop("The status column must be coded 0/1.")
  if (any(fr$data[[v[[time]]]] < 0, na.rm = TRUE)) stop("Survival times must not be negative.")
  # Risk table times: as given, or a pretty grid from 0 to the longest time.
  times <- vapply(as.list(unlist(req$riskTimes)), function(x) ps_number(x, "risk table time"), 0)
  if (length(times) > 50 || any(times < 0)) {
    stop("At most 50 risk table times, none negative.")
  }
  times_code <- if (length(times)) {
    sprintf("c(%s)", paste(format(sort(unique(times)), digits = 15, trim = TRUE), collapse = ", "))
  } else {
    sprintf("pretty(c(0, max(data$%s)), n = 5)", v[[time]])
  }
  rhs <- if (nzchar(group)) v[[group]] else "1"
  event <- sprintf("data$%s == %d", v[[status]], if (status_censored) 0L else 1L)
  group_line <- if (!nzchar(group)) {
    NULL
  } else if (!is.null(levels_of[[group]])) {
    sprintf(
      "data$%s <- ps_km_labelled(data$%s, %s)",
      v[[group]],
      v[[group]],
      ps_q(unlist(levels_of[[group]]))
    )
  } else {
    sprintf("data$%s <- factor(data$%s)", v[[group]], v[[group]])
  }
  surv <- sprintf("Surv(%s, .event)", v[[time]])
  body <- c(
    "suppressPackageStartupMessages(library(survival))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    if (!is.null(levels_of[[group]])) PS_KM_LABELLED_LINES,
    group_line,
    sprintf(
      "data$.event <- as.integer(%s)  # 1 = event%s",
      event,
      if (status_censored) " (the column codes 1 = censored)" else ""
    ),
    "# Kaplan-Meier estimates with pointwise confidence intervals",
    sprintf(
      "fit <- survfit(%s ~ %s, data = data, conf.int = %s, conf.type = \"%s\")",
      surv,
      rhs,
      format(conf, digits = 15),
      conf_type
    ),
    "km_table <- summary(fit)$table  # n, events, median survival and its interval",
    "# Numbers at risk at the risk table's times",
    sprintf("risk_times <- %s", times_code),
    "risk <- summary(fit, times = risk_times, extend = TRUE)",
    if (nzchar(group)) {
      c(
        "# Tests of equal survival: log-rank (rho = 0) and Peto & Peto's Gehan-Wilcoxon (rho = 1)",
        sprintf("logrank <- survdiff(%s ~ %s, data = data, rho = 0)", surv, rhs),
        sprintf("peto <- survdiff(%s ~ %s, data = data, rho = 1)", surv, rhs)
      )
    }
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "print(fit)",
      "summary(fit)",
      "risk",
      if (nzchar(group)) c("logrank", "peto")
    )
    return(ps_script("Kaplan-Meier survival (survival::survfit, survdiff)", "survival", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  fit <- env$fit
  tab <- env$km_table
  if (!is.matrix(tab)) tab <- matrix(tab, nrow = 1, dimnames = list("All", names(tab)))
  # Each stratum's name: the group's level (survfit writes "group=level").
  strata_names <- if (is.null(fit$strata)) {
    "All"
  } else {
    sub("^[^=]*=", "", names(fit$strata))
  }
  sizes <- if (is.null(fit$strata)) length(fit$time) else unname(fit$strata)
  ends <- cumsum(sizes)
  starts <- ends - sizes + 1
  col <- function(m, name) if (name %in% colnames(m)) unname(m[, name]) else rep(NA_real_, nrow(m))
  medians <- col(tab, "median")
  lows <- col(tab, sprintf("%s.LCL", format(conf)))
  highs <- col(tab, sprintf("%s.UCL", format(conf)))
  if (all(is.na(lows))) lows <- col(tab, grep("LCL$", colnames(tab), value = TRUE)[1])
  if (all(is.na(highs))) highs <- col(tab, grep("UCL$", colnames(tab), value = TRUE)[1])
  risk <- env$risk
  risk_strata <- if (is.null(risk$strata)) {
    rep("All", length(risk$time))
  } else {
    sub("^[^=]*=", "", as.character(risk$strata))
  }
  strata <- lapply(seq_along(strata_names), function(i) {
    k <- seq(starts[i], ends[i])
    at <- risk_strata == strata_names[i]
    list(
      name = strata_names[i],
      n = unname(col(tab, "records")[i]),
      events = unname(col(tab, "events")[i]),
      median = medians[i],
      medianLow = lows[i],
      medianHigh = highs[i],
      time = I(fit$time[k]),
      surv = I(fit$surv[k]),
      lower = I(fit$lower[k]),
      upper = I(fit$upper[k]),
      nRisk = I(fit$n.risk[k]),
      nEvent = I(fit$n.event[k]),
      nCensor = I(fit$n.censor[k]),
      riskAt = I(risk$n.risk[at])
    )
  })
  test <- function(sd) {
    if (is.null(sd)) {
      return(NULL)
    }
    df <- length(sd$n) - 1
    list(
      chisq = sd$chisq,
      df = df,
      p = pchisq(sd$chisq, df, lower.tail = FALSE),
      observed = I(unname(as.numeric(sd$obs))),
      expected = I(unname(as.numeric(sd$exp)))
    )
  }
  ps_json(list(
    confidence = conf,
    confType = conf_type,
    n = nrow(env$data),
    strata = strata,
    riskTimes = I(env$risk_times),
    logrank = test(env$logrank),
    peto = test(env$peto),
    warnings = env$.warnings,
    engine = ps_engine("survival")
  ))
}

#' Script lines: a coded column as a factor with its labels (codes 1..k, or the sorted values of a recoded column).
PS_KM_LABELLED_LINES <- c(
  "ps_km_labelled <- function(x, labels) {",
  "  k <- length(labels)",
  "  if (all(x %in% seq_len(k))) {",
  "    return(factor(x, levels = seq_len(k), labels = labels))",
  "  }",
  "  u <- sort(unique(x))",
  "  if (length(u) == k) factor(x, levels = u, labels = labels) else factor(x)",
  "}"
)
