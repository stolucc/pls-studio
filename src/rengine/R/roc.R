# ROC analysis with pROC (Robin et al. 2011): the ROC curve of a predictor (a data column, or the fitted probabilities
# of a logistic regression on chosen predictors) for a binary outcome, its AUC with a DeLong or bootstrap confidence
# interval, the optimal cut-point (Youden's J or the point closest to the top-left corner) with sensitivity,
# specificity, PPV and NPV, the partial AUC over a range of specificity or sensitivity, and the comparison of two ROC
# curves by DeLong's test: two predictors on the same cases (paired) or one predictor in two groups (unpaired).
# Estimation is pROC's; this file writes the script and shapes the output.

#' One ROC curve's points (1 - specificity, sensitivity), from the curve's start to its end.
ps_roc_points <- function(r) {
  list(fpr = I(1 - r$specificities), tpr = I(r$sensitivities))
}

#' The cut-points coords() returns (several rows when tied).
ps_roc_cuts <- function(cut) {
  cut <- as.data.frame(cut)
  lapply(seq_len(nrow(cut)), function(i) {
    list(
      threshold = cut$threshold[i],
      sensitivity = cut$sensitivity[i],
      specificity = cut$specificity[i],
      ppv = cut$ppv[i],
      npv = cut$npv[i],
      accuracy = cut$accuracy[i],
      # (coords' youden is sensitivity + specificity: Youden's J is that minus 1)
      youden = cut$sensitivity[i] + cut$specificity[i] - 1
    )
  })
}

ps_roc <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  response <- req$response
  if (!(is.character(response) && length(response) == 1 && nzchar(response))) {
    stop("Choose the outcome column.")
  }
  source <- req$source %||% "column"
  if (!source %in% c("column", "logistic")) stop("Invalid predictor source in the request.")
  predictor <- req$predictor %||% ""
  predictors <- as.character(unlist(req$predictors))
  if (source == "column" && !nzchar(predictor)) stop("Choose the predictor column.")
  if (source == "logistic" && !length(predictors)) {
    stop("Choose the predictors of the logistic regression.")
  }
  direction <- req$direction %||% "auto"
  if (!direction %in% c("auto", "<", ">")) stop("Invalid direction in the request.")
  ci_method <- req$ciMethod %||% "delong"
  if (!ci_method %in% c("delong", "bootstrap")) stop("Invalid interval method in the request.")
  boot_n <- as.integer(ps_number(req$bootN %||% 2000, "number of bootstrap samples"))
  if (boot_n < 100 || boot_n > 1e5) stop("Invalid number of bootstrap samples in the request.")
  seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
  best_method <- req$cutpoint %||% "youden"
  if (!best_method %in% c("youden", "closest.topleft")) stop("Invalid cut-point method in the request.")
  compare <- req$compare %||% "none"
  if (!compare %in% c("none", "paired", "groups")) stop("Invalid comparison in the request.")
  predictor2 <- req$predictor2 %||% ""
  group <- req$group %||% ""
  if (compare == "paired" && !nzchar(predictor2)) stop("Choose the second predictor.")
  if (compare == "groups" && !nzchar(group)) stop("Choose the grouping column.")
  pauc <- req$pauc
  conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  positive <- req$positive
  if (!is.null(positive)) positive <- ps_number(positive, "positive outcome value")

  cols <- unique(c(
    response,
    if (source == "column") predictor else predictors,
    if (compare == "paired") predictor2,
    if (compare == "groups") group
  ))
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  y <- v[[response]]
  x <- if (source == "column") v[[predictor]] else ".predicted"
  # The outcome's two values: controls first, cases (the positive value) second.
  levels_line <- if (is.null(positive)) {
    "lv <- values  # controls: the lower value; cases: the higher"
  } else {
    sprintf("lv <- c(values[values != %s], %s)  # controls, then cases", ps_num(positive), ps_num(positive))
  }
  roc_call <- function(rows, pred, dir) {
    sprintf(
      "roc(data$%s%s, data$%s%s, levels = lv, direction = \"%s\", quiet = TRUE)",
      y,
      rows,
      pred,
      rows,
      dir
    )
  }
  ci_line <- if (ci_method == "delong") {
    sprintf("auc_ci <- ci.auc(curve, conf.level = %s, method = \"delong\")", ps_num(conf))
  } else {
    c(
      sprintf("set.seed(%d)", seed),
      sprintf(
        "auc_ci <- ci.auc(curve, conf.level = %s, method = \"bootstrap\", boot.n = %d, boot.stratified = TRUE)",
        ps_num(conf),
        boot_n
      )
    )
  }
  pauc_lines <- NULL
  if (!is.null(pauc)) {
    focus <- pauc$focus %||% "specificity"
    if (!focus %in% c("specificity", "sensitivity")) stop("Invalid partial AUC focus in the request.")
    from <- ps_number(pauc$from, "partial AUC range")
    to <- ps_number(pauc$to, "partial AUC range")
    if (from < 0 || to > 1 || from >= to) stop("Invalid partial AUC range in the request.")
    correct <- isTRUE(pauc$correct)
    pauc_args <- sprintf(
      "partial.auc = c(%s, %s), partial.auc.focus = \"%s\", partial.auc.correct = %s",
      ps_num(to),
      ps_num(from),
      focus,
      if (correct) "TRUE" else "FALSE"
    )
    pauc_lines <- c(
      sprintf("# Partial AUC: %s from %s to %s", focus, ps_num(from), ps_num(to)),
      sprintf("partial <- auc(curve, %s)", pauc_args),
      if (ci_method == "bootstrap") {
        c(
          sprintf("set.seed(%d)", seed),
          sprintf(
            "partial_ci <- ci.auc(partial, conf.level = %s, method = \"bootstrap\", boot.n = %d, boot.stratified = TRUE)",
            ps_num(conf),
            boot_n
          )
        )
      }
    )
  }
  compare_lines <- NULL
  if (compare == "paired") {
    compare_lines <- c(
      "# The second predictor on the same cases: DeLong's test for two correlated ROC curves",
      sprintf("curve2 <- %s", roc_call("", v[[predictor2]], "auto")),
      "test <- roc.test(curve, curve2, method = \"delong\", paired = TRUE)"
    )
  } else if (compare == "groups") {
    compare_lines <- c(
      sprintf("# The predictor in each group of %s: DeLong's test for two independent ROC curves", ps_comment(group)),
      sprintf("groups <- sort(unique(data$%s))", v[[group]]),
      "if (length(groups) != 2) stop(\"The grouping column must have exactly two values.\")",
      sprintf("in_1 <- data$%s == groups[1]", v[[group]]),
      sprintf("curve_1 <- %s", roc_call("[in_1]", x, "auto")),
      sprintf("curve_2 <- %s", roc_call("[!in_1]", x, "auto")),
      "test <- roc.test(curve_1, curve_2, method = \"delong\", paired = FALSE)"
    )
  }
  body <- c(
    "suppressPackageStartupMessages(library(pROC))",
    sprintf("data <- data[complete.cases(data[, %s]), , drop = FALSE]", ps_q(unname(v[cols]))),
    sprintf("values <- sort(unique(data$%s))", y),
    "if (length(values) != 2) stop(\"The outcome must have exactly two values.\")",
    levels_line,
    if (source == "logistic") {
      c(
        "# The predictor: the fitted probabilities of a logistic regression",
        sprintf(
          "fit <- glm(I(%s == lv[2]) ~ %s, family = binomial, data = data)",
          y,
          paste(unname(v[predictors]), collapse = " + ")
        ),
        "data$.predicted <- fitted(fit)"
      )
    },
    "# The ROC curve",
    sprintf("curve <- %s", roc_call("", x, if (source == "logistic") "<" else direction)),
    ci_line,
    "auc_se <- sqrt(pROC::var(curve))  # DeLong's standard error of the AUC",
    sprintf(
      "best <- coords(curve, \"best\", best.method = \"%s\", ret = c(\"threshold\", \"sensitivity\", \"specificity\", \"ppv\", \"npv\", \"accuracy\"), transpose = FALSE)",
      best_method
    )
  )
  report <- c(
    "curve",
    "auc_ci",
    "best",
    if (!is.null(pauc)) c("partial", if (ci_method == "bootstrap") "partial_ci"),
    if (compare != "none") "test",
    "plot(curve, print.auc = TRUE)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script("ROC analysis (pROC)", "pROC", inputs, c(body, pauc_lines, compare_lines), report))
  }
  env <- ps_run(c(body, pauc_lines, compare_lines), inputs)
  curve <- env$curve
  ci <- as.numeric(env$auc_ci)
  out <- list(
    n = nrow(env$data),
    cases = length(curve$cases),
    controls = length(curve$controls),
    levels = I(as.numeric(env$lv)),
    direction = curve$direction,
    auc = as.numeric(curve$auc),
    aucSe = env$auc_se,
    aucCi = list(low = ci[1], high = ci[3]),
    ciMethod = ci_method,
    curve = ps_roc_points(curve),
    best = ps_roc_cuts(env$best),
    cutpoint = best_method,
    warnings = env$.warnings,
    engine = ps_engine("pROC")
  )
  if (source == "logistic") {
    cs <- stats::coef(summary(env$fit))
    out$logistic <- lapply(seq_len(nrow(cs)), function(i) {
      list(
        term = ps_back_names(rownames(cs)[i], fr$back),
        est = cs[i, 1],
        se = cs[i, 2],
        z = cs[i, 3],
        p = cs[i, 4]
      )
    })
  }
  if (!is.null(pauc)) {
    pci <- if (is.null(env$partial_ci)) NULL else as.numeric(env$partial_ci)
    out$partial <- list(
      value = as.numeric(env$partial),
      ciLow = if (is.null(pci)) NULL else pci[1],
      ciHigh = if (is.null(pci)) NULL else pci[3]
    )
  }
  if (compare != "none") {
    test <- env$test
    second <- if (compare == "paired") list(env$curve2) else list(env$curve_1, env$curve_2)
    out$comparison <- list(
      type = compare,
      statistic = unname(test$statistic),
      df = if (is.null(test$parameter)) NULL else unname(test$parameter),
      p = test$p.value,
      aucs = I(unname(as.numeric(test$estimate))),
      ciLow = if (is.null(test$conf.int)) NULL else test$conf.int[1],
      ciHigh = if (is.null(test$conf.int)) NULL else test$conf.int[2],
      groups = if (compare == "groups") I(as.numeric(env$groups)) else NULL,
      curves = lapply(second, ps_roc_points)
    )
  }
  ps_json(out)
}
