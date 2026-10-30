# Data screening: univariate distributions (psych::describe), multivariate
# normality (Mardia's test, psych::mardia), multivariate outliers (Mahalanobis
# distances against the chi-square distribution), and, for a CB-SEM model, case
# influence by leave-one-out refits (semfindr: generalized Cook's distance,
# change in fit).

ps_screen <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  vars <- unlist(req$vars)
  if (length(vars) < 2) stop("Choose at least two variables.")
  alpha <- ps_number(req$alpha %||% 0.001, "outlier significance level")
  if (alpha <= 0 || alpha >= 0.5) stop("Invalid outlier significance level.")
  fr <- ps_long_frame(req, vars)
  v <- ps_lookup(fr$v, vars)
  body <- c(
    "suppressPackageStartupMessages(library(psych))",
    sprintf("X <- data[, %s]", ps_q(v)),
    "# Univariate: mean, SD, skewness and excess kurtosis (psych's type 3), missing values.",
    "desc <- describe(X)",
    "missing <- colSums(is.na(X))",
    "# Mardia's multivariate skewness and kurtosis (complete cases).",
    "Xc <- X[complete.cases(X), , drop = FALSE]",
    "mard <- mardia(Xc, plot = FALSE)",
    "# Mahalanobis distance of each complete case from the centroid; p from chi-square with",
    sprintf("# df = number of variables. Cases with p < %s are flagged (Tabachnick & Fidell).", format(alpha)),
    "d2 <- mahalanobis(Xc, colMeans(Xc), cov(Xc))",
    "p <- pchisq(d2, df = ncol(Xc), lower.tail = FALSE)",
    "rows <- as.integer(rownames(Xc))",
    sprintf("flagged <- rows[p < %s]", format(alpha)))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Data screening (psych)", "psych", inputs, body, c("desc", "mard", "flagged")), collapse = "\n"))
  env <- ps_run(body, inputs)
  d <- env$desc; m <- env$mard
  ps_json(list(
    variables = unname(fr$back[rownames(d)]),
    describe = lapply(seq_len(nrow(d)), function(i) list(n = d$n[i], missing = unname(env$missing[i]), mean = d$mean[i], sd = d$sd[i],
      median = d$median[i], min = d$min[i], max = d$max[i], skew = d$skew[i], kurtosis = d$kurtosis[i])),
    mardia = list(n = m$n.obs, p = m$n.var, b1p = m$b1p, b2p = m$b2p, skew = m$skew, smallSkew = m$small.skew, pSkew = m$p.skew,
      pSmall = m$p.small, kurtosis = m$kurtosis, pKurt = m$p.kurt, df = m$n.var * (m$n.var + 1) * (m$n.var + 2) / 6),
    cases = list(rows = env$rows, d2 = unname(env$d2), p = unname(env$p)), alpha = alpha, df = length(vars),
    warnings = env$.warnings, engine = list(package = "psych", version = as.character(utils::packageVersion("psych")))))
}

#' Case influence on a CB-SEM model: the model refitted without each case in turn
#' (semfindr::lavaan_rerun), then generalized Cook's distance, Mahalanobis distance
#' and the change in chi-square and fit indices (semfindr::influence_stat).
ps_influence <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (b$matrix_input) stop("Case influence needs raw data; this dataset is a covariance matrix.")
  if (isTRUE(b$robust)) stop("Case influence refits the model by ML; choose ML or MLR (robust ML already down-weights influential cases).")
  if (!is.null(b$modsem)) stop("Case influence is not available for LMS / QML models.")
  if (!is.null(b$cluster_var)) stop("Case influence is not available for two-level models.")
  cores <- as.integer(req$cores %||% 1L)
  if (is.na(cores) || cores < 1L || cores > 64L) stop("Invalid number of cores.")
  # (forking is unavailable in R in the browser)
  par <- cores > 1L && !grepl("emscripten", R.version$platform)
  body <- c(b$body,
    "suppressPackageStartupMessages(library(semfindr))",
    "# Leave-one-out: the model refitted without each case (semfindr), then the influence statistics.",
    sprintf("rerun <- lavaan_rerun(fit, parallel = %s, progress = FALSE%s)", if (par) "TRUE" else "FALSE", if (par) sprintf(", ncores = %d", cores) else ""),
    "infl <- influence_stat(rerun)",
    "rows <- as.integer(rownames(data))[as.integer(rownames(infl))]")
  inputs <- b$inputs
  if (export) return(paste(ps_script("Case influence (semfindr)", c("lavaan", "semfindr"), inputs, body, "head(infl[order(-infl[, \"gcd\"]), c(\"gcd\", \"md\", \"chisq\")], 10)"), collapse = "\n"))
  env <- ps_run(body, inputs)
  infl <- env$infl
  col <- function(k) if (k %in% colnames(infl)) unname(infl[, k]) else rep(NA_real_, nrow(infl))
  ps_json(list(rows = env$rows, gcd = col("gcd"), md = col("md"), chisq = col("chisq"), cfi = col("cfi"), rmsea = col("rmsea"), tli = col("tli"),
    warnings = env$.warnings, engine = list(package = "semfindr", version = as.character(utils::packageVersion("semfindr")))))
}
