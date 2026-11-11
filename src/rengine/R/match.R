# Propensity score matching and related methods with MatchIt (Ho, Imai, King &
# Stuart 2011), balance by cobalt (Greifer), and the treatment effect as in
# MatchIt's vignette "Estimating effects after matching": a regression of the
# outcome on treatment in the matched data, weighted by the matching weights,
# with cluster-robust standard errors by matched set (subclass), or HC3 when
# matching is with replacement.

ps_match <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  treat <- req$treatment
  covs <- unlist(req$covariates)
  outcome <- req$outcome %||% ""
  if (!length(treat) || !length(covs)) stop("Choose the treatment and at least one covariate.")
  method <- req$method %||% "nearest"
  if (!method %in% c("nearest", "optimal", "full", "exact", "cem", "subclass", "weighting")) stop("Invalid matching method in the request.")
  if (method == "weighting") {
    return(ps_weight(req, export))
  }
  distance <- req$distance %||% "glm"
  if (!distance %in% c("glm", "mahalanobis")) stop("Invalid distance in the request.")
  link <- req$link %||% "logit"
  if (!link %in% c("logit", "probit")) stop("Invalid link in the request.")
  # The effect: the outcome on treatment in the matched data, or (dr) the outcome model with the covariates and their
  # interactions with treatment, averaged over the target group by g-computation (MatchIt's "Getting started" vignette).
  match_effect <- req$matchEffect %||% "difference"
  if (!match_effect %in% c("difference", "dr")) stop("Invalid effect model in the request.")
  estimand <- req$estimand %||% "ATT"
  if (!estimand %in% c("ATT", "ATE", "ATC")) stop("Invalid estimand in the request.")
  if (method %in% c("nearest", "optimal") && estimand == "ATE") stop("Nearest-neighbour and optimal pair matching estimate the ATT (or ATC); use full matching or subclassification for the ATE.")
  ratio <- as.integer(req$ratio %||% 1)
  caliper <- req$caliper
  if (ratio < 1 || ratio > 10) stop("Invalid matching ratio.")
  if (!is.null(caliper) && (!is.numeric(caliper) || caliper <= 0 || caliper > 5)) stop("Invalid caliper.")
  replace <- isTRUE(req$replace) && method == "nearest"
  seed <- as.integer(req$seed %||% 1)
  conf <- as.numeric(req$confidence %||% 0.95)
  cols <- unique(c(treat, covs, if (nzchar(outcome)) outcome))
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  T <- v[[treat]]
  X <- unname(v[covs])
  Y <- if (nzchar(outcome)) v[[outcome]] else NULL
  cats <- req$categories %||% list()
  fac <- unlist(lapply(covs, function(cv) {
    l <- cats[[cv]]
    if (is.null(l)) {
      NULL
    } else {
      sprintf("data$%s <- factor(data$%s, levels = seq_len(%d), labels = %s)", v[[cv]], v[[cv]], length(unlist(l)), ps_q(unlist(l)))
    }
  }))
  glm_ps <- method %in% c("nearest", "optimal", "full", "subclass") && distance == "glm"
  args <- c(
    sprintf("method = \"%s\"", method), if (method %in% c("nearest", "optimal", "full", "subclass")) sprintf("distance = \"%s\"", distance),
    if (glm_ps && link == "probit") "link = \"probit\"",
    sprintf("estimand = \"%s\"", estimand), if (method %in% c("nearest", "optimal") && ratio > 1) sprintf("ratio = %d", ratio),
    if (method == "nearest" && !is.null(caliper)) sprintf("caliper = %s", format(caliper)), if (replace) "replace = TRUE"
  )
  dr <- !is.null(Y) && match_effect == "dr"
  focal <- c(ATT = "md[md$%s == 1, ]", ATC = "md[md$%s == 0, ]", ATE = "md")[[estimand]]
  body <- c(
    sprintf("suppressPackageStartupMessages({ library(MatchIt); library(cobalt); library(sandwich); library(lmtest)%s })", if (dr) "; library(marginaleffects)" else ""),
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
    if (dr) {
      c(
        sprintf("# Treatment effect (%s): the weighted outcome model with the covariates and their interactions with treatment,", estimand),
        sprintf(
          "# averaged over the %s by g-computation; %s.", c(ATT = "treated", ATC = "controls", ATE = "whole matched sample")[[estimand]],
          if (replace) "HC3 robust standard errors (matching with replacement)" else "standard errors clustered by matched set (HC3 without matched sets)"
        ),
        sprintf("fit <- lm(%s ~ %s * (%s), data = md, weights = weights)", Y, T, paste(X, collapse = " + ")),
        sprintf(
          "est <- avg_comparisons(fit, variables = \"%s\", vcov = %s, newdata = %s, conf_level = %s)", T,
          if (replace) "\"HC3\"" else "if (\"subclass\" %in% names(md)) ~subclass else \"HC3\"", sprintf(focal, T), format(conf)
        ),
        "effect_dr <- as.data.frame(est)"
      )
    } else if (!is.null(Y)) {
      c(
        sprintf(
          "# Treatment effect (%s): weighted regression on the matched data; %s.", estimand,
          if (replace) "HC3 robust standard errors (matching with replacement)" else "standard errors clustered by matched set (HC3 without matched sets)"
        ),
        sprintf("fit <- lm(%s ~ %s, data = md, weights = weights)", Y, T),
        sprintf("vc <- %s", if (replace) "vcovHC(fit, type = \"HC3\")" else "if (\"subclass\" %in% names(md)) vcovCL(fit, cluster = ~subclass) else vcovHC(fit, type = \"HC3\")"),
        "effect <- coeftest(fit, vcov. = vc)",
        sprintf("effect_ci <- coefci(fit, vcov. = vc, level = %s)", format(conf))
      )
    }
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      sprintf("Matching (MatchIt, %s)", method), c("MatchIt", "cobalt", "sandwich", "lmtest"), inputs, body,
      c("summary(m)", "bal", "love.plot(bal, abs = TRUE, thresholds = c(m = .1))", if (dr) "est" else if (!is.null(Y)) c("effect", "effect_ci"))
    ))
  }
  env <- ps_run(body, inputs)
  b <- env$bal$Balance
  nn <- summary(env$m)$nn
  nm <- function(x) ps_back_names(x, fr$back, prefix = TRUE)
  ps_json(list(
    method = method, estimand = estimand,
    counts = lapply(seq_len(nrow(nn)), function(i) list(row = rownames(nn)[i], control = nn[i, 1], treated = nn[i, 2])),
    balance = lapply(seq_len(nrow(b)), function(i) {
      list(
        variable = if (rownames(b)[i] == "distance") "Propensity score" else nm(rownames(b)[i]), type = b$Type[i],
        diffBefore = b$Diff.Un[i], diffAfter = b$Diff.Adj[i], ratioBefore = if (is.null(b$V.Ratio.Un)) NULL else b$V.Ratio.Un[i], ratioAfter = if (is.null(b$V.Ratio.Adj)) NULL else b$V.Ratio.Adj[i]
      )
    }),
    effect = if (is.null(Y)) {
      NULL
    } else if (dr) {
      e <- env$effect_dr
      list(
        est = e$estimate[1], se = e$std.error[1], t = e$statistic[1], p = e$p.value[1],
        ciLow = e$conf.low[1], ciHigh = e$conf.high[1], n = nrow(env$md)
      )
    } else {
      list(
        est = env$effect[2, 1], se = env$effect[2, 2], t = env$effect[2, 3], p = env$effect[2, 4],
        ciLow = env$effect_ci[2, 1], ciHigh = env$effect_ci[2, 2], n = nrow(env$md)
      )
    },
    matchEffect = match_effect, link = link,
    warnings = env$.warnings, engine = ps_engine("MatchIt")
  ))
}

#' Inverse probability weighting with WeightIt (Greifer): propensity scores by
#' logistic regression, weights for the estimand, balance by cobalt, and the
#' effect as in WeightIt's vignette "Estimating effects after weighting":
#' lm_weightit (standard errors that account for estimating the weights), either
#' the outcome on treatment (IPW) or with the covariates and their interactions
#' with treatment, averaged by g-computation (marginaleffects::avg_comparisons):
#' doubly robust, consistent if either the propensity or the outcome model is right.
ps_weight <- function(req, export = FALSE) {
  treat <- req$treatment
  covs <- unlist(req$covariates)
  outcome <- req$outcome %||% ""
  estimand <- req$estimand %||% "ATT"
  if (!estimand %in% c("ATT", "ATE", "ATC")) stop("Invalid estimand in the request.")
  effect_model <- req$effectModel %||% "dr"
  if (!effect_model %in% c("ipw", "dr")) stop("Invalid effect model in the request.")
  # The weights: from a logistic propensity score (glm), or entropy balancing (ebal; Hainmueller 2012).
  wmethod <- req$weightMethod %||% "glm"
  if (!wmethod %in% c("glm", "ebal")) stop("Invalid weighting method in the request.")
  conf <- as.numeric(req$confidence %||% 0.95)
  cols <- unique(c(treat, covs, if (nzchar(outcome)) outcome))
  fr <- ps_long_frame(req, cols)
  v <- fr$v
  T <- v[[treat]]
  X <- unname(v[covs])
  Y <- if (nzchar(outcome)) v[[outcome]] else NULL
  cats <- req$categories %||% list()
  fac <- unlist(lapply(covs, function(cv) {
    l <- cats[[cv]]
    if (is.null(l)) {
      NULL
    } else {
      sprintf("data$%s <- factor(data$%s, levels = seq_len(%d), labels = %s)", v[[cv]], v[[cv]], length(unlist(l)), ps_q(unlist(l)))
    }
  }))
  focal <- c(ATT = "data[data$%s == 1, ]", ATC = "data[data$%s == 0, ]", ATE = "data")[[estimand]]
  body <- c(
    "suppressPackageStartupMessages({ library(WeightIt); library(cobalt); library(marginaleffects) })",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(T, X, Y))),
    sprintf("# Treatment: the higher of the two values of %s is \"treated\".", ps_comment(treat)),
    sprintf("vals <- sort(unique(data$%s)); if (length(vals) != 2) stop(\"The treatment must have exactly two values.\")", T),
    sprintf("data$%s <- as.integer(data$%s == vals[2])", T, T),
    if (length(fac)) c("# Text (categorical) covariates as factors.", fac),
    if (wmethod == "ebal") {
      sprintf("# Entropy balancing (Hainmueller 2012): weights that balance the covariates' means exactly, for the %s.", estimand)
    } else {
      sprintf("# Propensity scores by logistic regression; weights for the %s.", estimand)
    },
    sprintf("W <- weightit(%s ~ %s, data = data, method = \"%s\", estimand = \"%s\")", T, paste(X, collapse = " + "), wmethod, estimand),
    "ess <- summary(W)$effective.sample.size",
    "# Balance before and after weighting: standardised mean differences (|d| < .1) and variance ratios.",
    "bal <- bal.tab(W, un = TRUE, stats = c(\"mean.diffs\", \"variance.ratios\"), binary = \"std\", continuous = \"std\")",
    if (!is.null(Y)) {
      c(
        if (effect_model == "ipw") {
          c(
            "# Effect (IPW): the weighted regression of the outcome on treatment; SEs account for the estimated weights.",
            sprintf("fit <- lm_weightit(%s ~ %s, data = data, weightit = W)", Y, T),
            sprintf("est <- avg_comparisons(fit, variables = \"%s\", conf_level = %s)", T, format(conf))
          )
        } else {
          c(
            "# Effect (doubly robust): the weighted outcome model with the covariates and their interactions with",
            "# treatment, averaged over the target population by g-computation; SEs account for the estimated weights.",
            sprintf("fit <- lm_weightit(%s ~ %s * (%s), data = data, weightit = W)", Y, T, paste(X, collapse = " + ")),
            sprintf("est <- avg_comparisons(fit, variables = \"%s\", newdata = %s, conf_level = %s)", T, sprintf(focal, T), format(conf))
          )
        },
        "effect <- as.data.frame(est)"
      )
    }
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      sprintf("Inverse probability weighting (WeightIt, %s)", if (effect_model == "dr") "doubly robust" else "IPW"),
      c("WeightIt", "cobalt", "marginaleffects"), inputs, body, c("summary(W)", "bal", "love.plot(bal, abs = TRUE, thresholds = c(m = .1))", if (!is.null(Y)) "est")
    ))
  }
  env <- ps_run(body, inputs)
  b <- env$bal$Balance
  nm <- function(x) ps_back_names(x, fr$back, prefix = TRUE)
  ess <- env$ess
  e <- env$effect
  ps_json(list(
    method = "weighting", estimand = estimand, effectModel = effect_model, weightMethod = wmethod,
    counts = lapply(seq_len(nrow(ess)), function(i) list(row = if (rownames(ess)[i] == "Weighted") "Effective sample size" else rownames(ess)[i], control = ess[i, "Control"], treated = ess[i, "Treated"])),
    balance = lapply(seq_len(nrow(b)), function(i) {
      list(
        variable = if (rownames(b)[i] == "prop.score") "Propensity score" else nm(rownames(b)[i]), type = b$Type[i],
        diffBefore = b$Diff.Un[i], diffAfter = b$Diff.Adj[i], ratioBefore = if (is.null(b$V.Ratio.Un)) NULL else b$V.Ratio.Un[i], ratioAfter = if (is.null(b$V.Ratio.Adj)) NULL else b$V.Ratio.Adj[i]
      )
    }),
    weights = list(max = max(env$W$weights), treatedRange = range(env$W$weights[env$data[[T]] == 1]), controlRange = range(env$W$weights[env$data[[T]] == 0])),
    effect = if (is.null(Y)) {
      NULL
    } else {
      list(
        est = e$estimate[1], se = e$std.error[1], t = e$statistic[1], p = e$p.value[1],
        ciLow = e$conf.low[1], ciHigh = e$conf.high[1], n = nrow(env$data)
      )
    },
    warnings = env$.warnings, engine = ps_engine("WeightIt")
  ))
}
