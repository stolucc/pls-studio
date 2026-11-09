# Fuzzy-set (and crisp-set) qualitative comparative analysis with the QCA
# package (Dușa): calibration by the direct method (QCA::calibrate, Ragin
# 2008), the analysis of necessity (QCA::pof: consistency, coverage and
# relevance of necessity of every condition and its negation), the truth
# table (QCA::truthTable with the frequency, consistency and PRI cut-offs) and
# the Boolean minimisation (QCA::minimize: conservative, parsimonious, and
# intermediate with directional expectations). Nothing is reimplemented: the
# script below is the package's own calls, exported as the R script.

# A condition's name in the user's words: terms are "DEV*~URB" over syntactic names.
qca_back_term <- function(term, back) {
  parts <- strsplit(term, "*", fixed = TRUE)[[1]]
  neg <- startsWith(parts, "~")
  nm <- sub("^~", "", parts)
  paste0(ifelse(neg, "~", ""), unname(ifelse(nm %in% names(back), back[nm], nm)), collapse = "*")
}

qca_na_null <- function(x) if (length(x) != 1 || is.na(x)) NULL else unname(x)

# The models of one minimize() result (or one C_P entry of its intermediate solutions): QCA keeps a
# single model's parameters in IC$incl.cov / IC$sol.incl.cov, several models' in IC$individual.
qca_models <- function(m, back) {
  if (is.null(m) || !length(m$solution)) return(list())
  ic <- m$IC
  overall <- if (!is.null(ic$overall)) ic$overall$incl.cov else ic$incl.cov
  pims <- as.data.frame(m$pims)
  one <- function(terms, inc, sol) {
    mem <- apply(pims[, terms, drop = FALSE], 1, max)
    list(
      terms = lapply(terms, function(t) list(term = qca_back_term(t, back), inclS = unname(inc[t, "inclS"]), PRI = unname(inc[t, "PRI"]), covS = unname(inc[t, "covS"]),
        covU = qca_na_null(inc[t, "covU"]), cases = if (!is.null(overall) && "cases" %in% names(overall) && t %in% rownames(overall)) as.character(overall[t, "cases"]) else "")),
      inclS = unname(sol$inclS[1]), PRI = unname(sol$PRI[1]), covS = unname(sol$covS[1]),
      membership = unname(utils::head(as.numeric(mem), 3000)))
  }
  if (!is.null(ic$individual)) lapply(seq_along(m$solution), function(i) one(m$solution[[i]], ic$individual[[i]]$incl.cov, ic$individual[[i]]$sol.incl.cov))
  else list(one(m$solution[[1]], ic$incl.cov, ic$sol.incl.cov))
}

ps_qca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  conds <- as.character(unlist(req$conditions)); yn <- req$outcome
  if (!length(conds) || !length(yn) || yn %in% conds) stop("Choose the outcome and at least one condition (different columns).")
  if (length(conds) > 12) stop("At most 12 conditions.")
  negate <- isTRUE(req$negate)
  n_cut <- ps_number(req$nCut %||% 1, "frequency cut-off"); incl_cut <- ps_number(req$inclCut %||% 0.8, "consistency cut-off"); pri_cut <- ps_number(req$priCut %||% 0, "PRI cut-off")
  if (n_cut < 1 || incl_cut <= 0 || incl_cut > 1 || pri_cut < 0 || pri_cut > 1) stop("Invalid cut-offs: n.cut >= 1, 0 < incl.cut <= 1, 0 <= pri.cut <= 1.")
  sort_by <- req$sortBy %||% "OUT, incl"
  if (!(is.character(sort_by) && length(sort_by) == 1 && sort_by %in% c("OUT, incl", "OUT, incl, n", "incl, n", "incl", "OUT", "n"))) stop("Invalid sort order in the request.")
  dir_exp <- as.character(unlist(req$dirExp %||% rep("-", length(conds))))
  if (length(dir_exp) != length(conds) || !all(dir_exp %in% c("1", "0", "-"))) stop("Invalid directional expectations in the request.")
  fr <- ps_long_frame(req, c(conds, yn))
  v <- fr$v; X <- unname(v[conds]); Y <- v[[yn]]
  labels <- as.character(unlist(req$labels))
  if (length(labels) && length(labels) != nrow(fr$data)) stop("Case labels must have one entry per row.")
  # Calibration per variable: the direct method with its three anchors, or the column as it is (already fuzzy or crisp).
  cal_lines <- character(0)
  cal_out <- list()
  for (nm in c(conds, yn)) {
    k <- req$calibration[[nm]]
    method <- k$method %||% "none"
    if (!(is.character(method) && length(method) == 1 && method %in% c("none", "direct"))) stop("Invalid calibration method in the request.")
    if (method == "direct") {
      e <- ps_number(k$e, "full non-membership anchor"); cc <- ps_number(k$c, "crossover anchor"); i <- ps_number(k$i, "full membership anchor")
      if (!((e < cc && cc < i) || (e > cc && cc > i))) stop(sprintf("The anchors of %s must be in order (full non-membership, crossover, full membership).", nm))
      cal_lines <- c(cal_lines, sprintf("cal$%s <- calibrate(data$%s, type = \"fuzzy\", thresholds = \"e=%s, c=%s, i=%s\")", v[[nm]], v[[nm]], format(e, digits = 15), format(cc, digits = 15), format(i, digits = 15)))
      cal_out[[nm]] <- list(variable = nm, method = "direct", e = e, c = cc, i = i)
    } else {
      cal_lines <- c(cal_lines, sprintf("cal$%s <- data$%s  # already calibrated", v[[nm]], v[[nm]]))
      cal_out[[nm]] <- list(variable = nm, method = "none")
    }
  }
  y_expr <- if (negate) sprintf("1 - cal$%s", Y) else sprintf("cal$%s", Y)
  body <- c(
    "suppressPackageStartupMessages(library(QCA))",
    sprintf("data <- data[complete.cases(data[, %s]), , drop = FALSE]", ps_q(c(X, Y))),
    if (length(labels)) "rownames(data) <- make.unique(labels[as.integer(rownames(data))], sep = \"_\")",
    "# ---- Calibration (Ragin 2008: direct method, logistic, three anchors) ----",
    "cal <- data.frame(row.names = rownames(data))",
    cal_lines,
    sprintf("conditions <- %s", ps_q(X)),
    sprintf("outcome <- \"%s%s\"", if (negate) "~" else "", Y),
    "# ---- Analysis of necessity: each condition and its negation (consistency inclN, relevance RoN, coverage covN) ----",
    sprintf("nec <- pof(cal[, conditions, drop = FALSE], %s)", y_expr),
    sprintf("nec_neg <- pof(1 - cal[, conditions, drop = FALSE], %s)", y_expr),
    "# ---- Truth table ----",
    sprintf("tt <- truthTable(cal, outcome = outcome, conditions = conditions, incl.cut = %s, n.cut = %d, pri.cut = %s, sort.by = \"%s\", show.cases = TRUE)",
      format(incl_cut, digits = 15), as.integer(n_cut), format(pri_cut, digits = 15), sort_by),
    "# ---- Minimisation: conservative (complex), parsimonious, intermediate ----",
    "try_min <- function(expr) tryCatch(expr, error = function(e) { warning(conditionMessage(e)); NULL })",
    "sol_c <- try_min(minimize(tt, details = TRUE))",
    "sol_p <- try_min(minimize(tt, include = \"?\", details = TRUE))",
    if (any(dir_exp != "-")) sprintf("sol_i <- try_min(minimize(tt, include = \"?\", dir.exp = \"%s\", details = TRUE))", paste(dir_exp, collapse = ",")) else "sol_i <- NULL  # no directional expectations: the intermediate solution is the parsimonious one")
  inputs <- list(data = fr$data)
  if (length(labels)) inputs$labels <- labels
  if (export) return(paste(ps_script("Fuzzy-set QCA (QCA package)", "QCA", inputs, body,
    c("nec", "nec_neg", "tt", "sol_c", "sol_p", "if (!is.null(sol_i)) sol_i")), collapse = "\n"))
  env <- ps_run(body, inputs)
  back <- fr$back
  # The truth table as printed: QCA's row order, the observed configurations (n > 0); remainders are counted.
  tt <- env$tt
  rows <- tt$tt[tt$rowsorder, , drop = FALSE]
  num <- function(x) suppressWarnings(as.numeric(as.character(x)))
  obs <- rows[rows$n > 0, , drop = FALSE]
  tt_rows <- lapply(seq_len(nrow(obs)), function(r) list(id = rownames(obs)[r], values = as.integer(unlist(obs[r, X])), out = as.character(obs$OUT[r]), n = as.integer(obs$n[r]),
    incl = qca_na_null(num(obs$incl[r])), pri = qca_na_null(num(obs$PRI[r])), cases = if ("cases" %in% names(obs)) as.character(obs$cases[r]) else ""))
  nec_rows <- function(p, neg) { ic <- p$incl.cov; lapply(seq_len(nrow(ic)), function(r) list(condition = paste0(if (neg) "~" else "", back[[sub("^~", "", rownames(ic)[r])]]), inclN = unname(ic$inclN[r]), RoN = unname(ic$RoN[r]), covN = unname(ic$covN[r]))) }
  necessity <- c(nec_rows(env$nec, FALSE), nec_rows(env$nec_neg, TRUE))
  solution <- function(m, kind) {
    if (is.null(m)) return(NULL)
    if (kind == "intermediate") {
      models <- list()
      for (nm in names(m$i.sol)) { s <- m$i.sol[[nm]]; ms <- qca_models(s, back); for (k in seq_along(ms)) { ms[[k]]$label <- sprintf("%s M%d", nm, k); models[[length(models) + 1]] <- ms[[k]] } }
      ec <- sum(vapply(m$i.sol, function(s) if (is.null(s$EC)) 0L else nrow(s$EC), 0L))
      return(list(kind = kind, models = models, essential = character(0), counterfactuals = ec))
    }
    ms <- qca_models(m, back)
    for (k in seq_along(ms)) ms[[k]]$label <- sprintf("M%d", k)
    list(kind = kind, models = ms, essential = vapply(as.character(m$essential), qca_back_term, "", back = back),
      counterfactuals = if (kind == "parsimonious" && length(m$SA)) nrow(m$SA[[1]]) else 0L)
  }
  y <- if (negate) 1 - env$cal[[Y]] else env$cal[[Y]]
  cal_summary <- lapply(c(conds, yn), function(nm) { k <- cal_out[[nm]]; x <- env$cal[[v[[nm]]]]; c(k, list(min = min(x), max = max(x), above = sum(x > 0.5), crisp = all(x %in% c(0, 1)))) })
  ps_json(list(outcome = yn, negated = negate, conditions = conds, n = nrow(env$cal),
    labels = if (length(labels)) utils::head(rownames(env$cal), 3000) else NULL,
    calibration = cal_summary, necessity = necessity,
    truthTable = list(rows = tt_rows, remainders = sum(rows$n == 0), nCut = n_cut, inclCut = incl_cut, priCut = pri_cut, sortBy = sort_by,
      counts = list(out1 = sum(obs$OUT == "1"), out0 = sum(obs$OUT == "0"), contradictions = sum(obs$OUT == "C"))),
    expectations = dir_exp,
    solutions = list(complex = solution(env$sol_c, "complex"), parsimonious = solution(env$sol_p, "parsimonious"), intermediate = solution(env$sol_i, "intermediate")),
    outcomeValues = utils::head(as.numeric(y), 3000),
    warnings = env$.warnings, engine = list(package = "QCA", version = as.character(utils::packageVersion("QCA")))))
}
