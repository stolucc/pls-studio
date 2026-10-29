# Propensity score matching and related methods with MatchIt (Ho, Imai, King &
# Stuart 2011), balance by cobalt (Greifer), and the treatment effect as in
# MatchIt's vignette "Estimating effects after matching": a regression of the
# outcome on treatment in the matched data, weighted by the matching weights,
# with cluster-robust standard errors by matched set (subclass), or HC3 when
# matching is with replacement.

ps_match <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  treat <- req$treatment; covs <- unlist(req$covariates); outcome <- req$outcome %||% ""
  if (!length(treat) || !length(covs)) stop("Choose the treatment and at least one covariate.")
  method <- req$method %||% "nearest"
  if (!method %in% c("nearest", "optimal", "full", "exact", "cem", "subclass")) stop("Invalid matching method in the request.")
  distance <- req$distance %||% "glm"
  if (!distance %in% c("glm", "mahalanobis")) stop("Invalid distance in the request.")
  estimand <- req$estimand %||% "ATT"
  if (!estimand %in% c("ATT", "ATE", "ATC")) stop("Invalid estimand in the request.")
  if (method %in% c("nearest", "optimal") && estimand == "ATE") stop("Nearest-neighbour and optimal pair matching estimate the ATT (or ATC); use full matching or subclassification for the ATE.")
  ratio <- as.integer(req$ratio %||% 1); caliper <- req$caliper
  if (ratio < 1 || ratio > 10) stop("Invalid matching ratio.")
  if (!is.null(caliper) && (!is.numeric(caliper) || caliper <= 0 || caliper > 5)) stop("Invalid caliper.")
  replace <- isTRUE(req$replace) && method == "nearest"
  seed <- as.integer(req$seed %||% 1); conf <- as.numeric(req$confidence %||% 0.95)
  cols <- unique(c(treat, covs, if (nzchar(outcome)) outcome))
  fr <- ps_long_frame(req, cols)
  v <- fr$v; T <- v[[treat]]; X <- unname(v[covs]); Y <- if (nzchar(outcome)) v[[outcome]] else NULL
  cats <- req$categories %||% list()
  fac <- unlist(lapply(covs, function(cv) { l <- cats[[cv]]; if (is.null(l)) NULL else
    sprintf("data$%s <- factor(data$%s, levels = seq_len(%d), labels = %s)", v[[cv]], v[[cv]], length(unlist(l)), ps_q(unlist(l))) }))
  args <- c(sprintf("method = \"%s\"", method), if (method %in% c("nearest", "optimal", "full", "subclass")) sprintf("distance = \"%s\"", distance),
    sprintf("estimand = \"%s\"", estimand), if (method %in% c("nearest", "optimal") && ratio > 1) sprintf("ratio = %d", ratio),
    if (method == "nearest" && !is.null(caliper)) sprintf("caliper = %s", format(caliper)), if (replace) "replace = TRUE")
  body <- c("suppressPackageStartupMessages({ library(MatchIt); library(cobalt); library(sandwich); library(lmtest) })",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(T, X))),
    sprintf("# Treatment: the higher of the two values of %s is \"treated\".", ps_comment(treat)),
    sprintf("vals <- sort(unique(data$%s)); if (length(vals) != 2) stop(\"The treatment must have exactly two values.\")", T),
    sprintf("data$%s <- as.integer(data$%s == vals[2])", T, T),
    if (length(fac)) c("# Text (categorical) covariates as factors.", fac),
    sprintf("set.seed(%d)", seed),
    sprintf("m <- matchit(%s ~ %s, data = data, %s)", T, paste(X, collapse = " + "), paste(args, collapse = ", ")),
    "# Balance before and after: standardised mean differences (|d| < .1 is the usual target) and variance ratios.",
    "bal <- bal.tab(m, un = TRUE, stats = c(\"mean.diffs\", \"variance.ratios\"), binary = \"std\", continuous = \"std\")",
    "md <- match.data(m)",
    if (!is.null(Y)) c(
      sprintf("# Treatment effect (%s): weighted regression on the matched data; %s.", estimand,
        if (replace) "HC3 robust standard errors (matching with replacement)" else "standard errors clustered by matched set (HC3 without matched sets)"),
      sprintf("fit <- lm(%s ~ %s, data = md, weights = weights)", Y, T),
      sprintf("vc <- %s", if (replace) "vcovHC(fit, type = \"HC3\")" else "if (\"subclass\" %in% names(md)) vcovCL(fit, cluster = ~subclass) else vcovHC(fit, type = \"HC3\")"),
      "effect <- coeftest(fit, vcov. = vc)",
      sprintf("effect_ci <- coefci(fit, vcov. = vc, level = %s)", format(conf))))
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Matching (MatchIt, %s)", method), c("MatchIt", "cobalt", "sandwich", "lmtest"), inputs, body,
    c("summary(m)", "bal", "love.plot(bal, abs = TRUE, thresholds = c(m = .1))", if (!is.null(Y)) c("effect", "effect_ci"))), collapse = "\n"))
  env <- ps_run(body, inputs)
  b <- env$bal$Balance
  nn <- summary(env$m)$nn
  nm <- function(x) { for (k in names(fr$back)) x <- sub(paste0("^", k), fr$back[[k]], x); x }
  ps_json(list(method = method, estimand = estimand,
    counts = lapply(seq_len(nrow(nn)), function(i) list(row = rownames(nn)[i], control = nn[i, 1], treated = nn[i, 2])),
    balance = lapply(seq_len(nrow(b)), function(i) list(variable = if (rownames(b)[i] == "distance") "Propensity score" else nm(rownames(b)[i]), type = b$Type[i],
      diffBefore = b$Diff.Un[i], diffAfter = b$Diff.Adj[i], ratioBefore = if (is.null(b$V.Ratio.Un)) NULL else b$V.Ratio.Un[i], ratioAfter = if (is.null(b$V.Ratio.Adj)) NULL else b$V.Ratio.Adj[i])),
    effect = if (is.null(Y)) NULL else list(est = env$effect[2, 1], se = env$effect[2, 2], t = env$effect[2, 3], p = env$effect[2, 4],
      ciLow = env$effect_ci[2, 1], ciHigh = env$effect_ci[2, 2], n = nrow(env$md)),
    warnings = env$.warnings, engine = list(package = "MatchIt", version = as.character(utils::packageVersion("MatchIt")))))
}
