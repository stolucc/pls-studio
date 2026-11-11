# Partial and semi-partial (part) correlations with ppcor (Kim 2015): each
# pair of the chosen variables controlling for the chosen control variables,
# or, with none chosen, for all the other variables of the set (ppcor's
# pcor() and spcor() matrices). Pearson, Spearman or Kendall; listwise
# deletion, as ppcor requires complete data.

ps_pcor <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unique(as.character(unlist(req$vars)))
  controls <- unique(as.character(unlist(req$controls)))
  method <- req[["method", exact = TRUE]] %||% "pearson"
  if (!(is.character(method) && length(method) == 1 &&
    method %in% c("pearson", "spearman", "kendall"))) {
    stop("Invalid correlation method in the request.")
  }
  if (length(vars) < 2) stop("Choose at least two variables.")
  if (any(controls %in% vars)) stop("A control variable cannot also be one of the variables.")
  if (!length(controls) && length(vars) < 3) {
    stop("Choose control variables, or at least three variables (each pair controlling for the others).")
  }
  cols <- c(vars, controls)
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  body <- c(
    "suppressPackageStartupMessages(library(ppcor))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(unname(unlist(v[cols])))),
    sprintf("vars <- %s", ps_q(unname(unlist(v[vars])))),
    sprintf(
      "controls <- %s",
      if (length(controls)) ps_q(unname(unlist(v[controls]))) else "character(0)"
    ),
    "pairs <- combn(vars, 2, simplify = FALSE)",
    "# What each pair is controlled for: the control variables, or (none chosen) the other variables",
    "given <- function(p) if (length(controls)) controls else setdiff(vars, p)",
    "# Partial correlation: both variables adjusted for the controls",
    "partial <- lapply(pairs, function(p) {",
    sprintf(
      "  pcor.test(data[[p[1]]], data[[p[2]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})",
    "# Semi-partial (part) correlations: the controls removed from the second variable only (spcor.test),",
    "# in both directions",
    "semi_ab <- lapply(pairs, function(p) {",
    sprintf(
      "  spcor.test(data[[p[1]]], data[[p[2]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})",
    "semi_ba <- lapply(pairs, function(p) {",
    sprintf(
      "  spcor.test(data[[p[2]]], data[[p[1]]], data[, given(p), drop = FALSE], method = \"%s\")",
      method
    ),
    "})"
  )
  inputs <- list(data = fr$data)
  if (export) {
    report <- c(
      "names(partial) <- vapply(pairs, paste, \"\", collapse = \" ~ \")",
      "do.call(rbind, partial)",
      "do.call(rbind, semi_ab)",
      "do.call(rbind, semi_ba)"
    )
    title <- sprintf("Partial and semi-partial correlations (ppcor, %s)", method)
    return(ps_script(title, "ppcor", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  test_row <- function(t) {
    list(r = t$estimate, stat = t$statistic, p = t$p.value)
  }
  back <- function(x) unname(vapply(x, function(n) fr$back[[n]], ""))
  rows <- lapply(seq_along(env$pairs), function(i) {
    p <- env$pairs[[i]]
    list(
      a = fr$back[[p[1]]],
      b = fr$back[[p[2]]],
      given = I(back(env$given(p))),
      n = env$partial[[i]]$n,
      gp = env$partial[[i]]$gp,
      partial = test_row(env$partial[[i]]),
      semiAB = test_row(env$semi_ab[[i]]),
      semiBA = test_row(env$semi_ba[[i]])
    )
  })
  ps_json(list(
    method = method,
    vars = I(vars),
    controls = I(controls),
    n = nrow(env$data),
    pairs = rows,
    warnings = env$.warnings,
    engine = ps_engine("ppcor")
  ))
}
