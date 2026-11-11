# Piecewise SEM (Shipley 2000, 2009; Lefcheck 2016) of an observed-variable path model with piecewiseSEM: each
# endogenous variable's equation fitted on its own (lm, or glm with a binomial or Poisson family; with a grouping column
# lmer / glmer with a random intercept), the basis set of independence claims the path diagram implies (d-separation),
# each claim's test, Shipley's Fisher's C, the AIC and AICc of the model, and coefficients standardised by
# piecewiseSEM's rules (for binomial outcomes the latent-theoretic or the observation-empirical approach; Grace et al.
# 2018). coefs(), fisherC() and the AIC of summary() round their numbers (to 4 and 3 decimals): the script takes the
# same quantities unrounded, from dSep(), piecewiseSEM's own standardisation (stdCoefs) and the equations' AIC.

PS_PSEM_FAMILIES <- c(gaussian = "", binomial = "binomial(link = \"logit\")", poisson = "poisson(link = \"log\")")

ps_psem <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  eqs <- req$equations
  if (!length(eqs)) stop("Draw paths between observed variables on the canvas first.")
  ys <- vapply(eqs, function(e) as.character(e$y), "")
  xs <- lapply(eqs, function(e) as.character(unlist(e$x)))
  fam <- vapply(eqs, function(e) as.character(e$family %||% "gaussian"), "")
  if (anyDuplicated(ys) || any(lengths(xs) == 0)) {
    stop("Each outcome needs one equation with at least one predictor.")
  }
  if (!all(fam %in% names(PS_PSEM_FAMILIES))) stop("Invalid family in the request.")
  isolated <- as.character(unlist(req$isolated))
  cr <- req$correlations %||% list() # (pairs; JSON's array of pairs arrives as a matrix)
  cors <- if (is.matrix(cr)) lapply(seq_len(nrow(cr)), function(i) as.character(cr[i, ])) else lapply(cr, function(p) as.character(unlist(p)))
  if (any(lengths(cors) != 2)) stop("Invalid correlated errors in the request.")
  std <- req$standardizeType %||% "latent.linear"
  if (!(length(std) == 1 && std %in% c("latent.linear", "Menard.OE"))) {
    stop("Invalid standardisation in the request.")
  }
  group <- req$group
  vars <- unique(c(ys, unlist(xs), isolated, unlist(cors)))
  if (!is.null(group) && !(is.character(group) && length(group) == 1 && !group %in% vars)) {
    stop("The grouping column must be a column that is not a variable of the model.")
  }
  fr <- ps_long_frame(req, c(vars, group))
  v <- fr$v
  g <- if (is.null(group)) NULL else v[[group]]
  eq_line <- function(i) {
    f <- sprintf("%s ~ %s%s", v[[ys[i]]], paste(v[xs[[i]]], collapse = " + "), if (is.null(g)) "" else sprintf(" + (1 | %s)", g))
    fn <- if (fam[i] == "gaussian") (if (is.null(g)) "lm" else "lmer") else if (is.null(g)) "glm" else "glmer"
    sprintf("  %s(%s%s, data = data)", fn, f, if (fam[i] == "gaussian") "" else sprintf(", family = %s", PS_PSEM_FAMILIES[[fam[i]]]))
  }
  extras <- c(if (length(isolated)) sprintf("%s ~ 1", v[isolated]), vapply(cors, function(p) sprintf("%s %%~~%% %s", v[[p[1]]], v[[p[2]]]), ""))
  body <- c(
    sprintf("suppressPackageStartupMessages({ library(piecewiseSEM)%s })", if (is.null(g)) "" else "; library(lme4)"),
    "# (lme4 2.x warns that piecewiseSEM still imports lme4's nobars(), which moved to reformulas: nothing about the results)",
    "quiet <- function(expr) withCallingHandlers(expr, warning = function(w) if (grepl(\"moved to the reformulas package\", conditionMessage(w), fixed = TRUE)) invokeRestart(\"muffleWarning\"))",
    "data <- data[complete.cases(data), , drop = FALSE]  # every equation on the same cases",
    "rownames(data) <- NULL  # (piecewiseSEM's observation-empirical standardisation finds the cases by their row names as numbers)",
    if (!is.null(g)) sprintf("data$%s <- factor(data$%s)  # the grouping column: a random intercept in every equation", g, g),
    "# One model per endogenous variable",
    "eqs <- quiet(list(", paste(vapply(seq_along(ys), eq_line, ""), collapse = ",\n"), "))",
    if (length(extras)) {
      c(
        sprintf("# %s", paste(c(if (length(isolated)) "variables in no path (tested for independence)", if (length(cors)) "correlated errors (%~~%: left out of the basis set)"), collapse = "; ")),
        sprintf("extras <- list(%s)", paste(extras, collapse = ", "))
      )
    } else {
      "extras <- list()"
    },
    "model <- quiet(do.call(psem, c(eqs, extras, list(data = data))))",
    "# Tests of directed separation: each independence claim of the basis set, given the claim's conditioning variables",
    "dsep <- quiet(dSep(model, conditioning = TRUE, .progressBar = FALSE))",
    "# Shipley's Fisher's C = -2 sum log p over the k claims, chi-squared with 2k df (as fisherC(), unrounded)",
    "ps <- dsep$P.Value; if (any(ps == 0)) ps <- ps + 1e-20",
    "fisher <- c(C = -2 * sum(log(ps)), df = 2 * length(ps)); fisher[\"p\"] <- 1 - pchisq(fisher[[\"C\"]], fisher[[\"df\"]])",
    "# AIC and AICc of the model: the sum over its equations (as summary(model)$AIC, unrounded); K parameters, n cases",
    "ic <- c(AIC = sum(sapply(eqs, AIC)), AICc = sum(sapply(eqs, MuMIn::AICc)), K = sum(sapply(eqs, function(m) attr(logLik(m), \"df\"))), n = min(sapply(eqs, nobs)))",
    sprintf("# Path coefficients and their standardised values (as coefs(model, standardize.type = \"%s\"), unrounded)", std),
    sprintf("coefficients <- quiet(piecewiseSEM:::stdCoefs(model, data, \"scale\", \"%s\", \"F\", \"II\", FALSE))", std),
    "r2 <- quiet(rsquared(model))"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      "Piecewise SEM (piecewiseSEM)", c("piecewiseSEM", if (!is.null(g)) "lme4"), inputs, body,
      c("dsep", "fisher", "ic", "coefficients", "r2")
    ))
  }
  env <- ps_run(body, inputs)
  back <- function(x) ps_back(x, fr$back, FALSE)
  terms <- function(s) back(trimws(strsplit(s, "+", fixed = TRUE)[[1]]))
  d <- env$dsep
  claims <- if (is.null(d) || !NROW(d)) {
    list()
  } else {
    lapply(seq_len(nrow(d)), function(i) {
      lr <- strsplit(as.character(d$Independ.Claim[i]), "~", fixed = TRUE)[[1]]
      rhs <- terms(lr[2])
      list(y = back(trimws(lr[1])), x = rhs[1], given = I(rhs[-1]), df = d$DF[i], stat = d$Crit.Value[i], p = d$P.Value[i])
    })
  }
  cf <- env$coefficients
  num <- function(x) suppressWarnings(as.numeric(x))
  coefs <- lapply(seq_len(nrow(cf)), function(i) {
    cor <- startsWith(as.character(cf$Response[i]), "~~")
    list(
      response = back(sub("^~~", "", cf$Response[i])), predictor = back(sub("^~~", "", cf$Predictor[i])), correlation = cor,
      est = num(cf$Estimate[i]), se = num(cf$Std.Error[i]), df = num(cf$DF[i]), stat = num(cf$Crit.Value[i]), p = num(cf$P.Value[i]), std = num(cf$Std.Estimate[i])
    )
  })
  r2 <- env$r2
  rsq <- lapply(seq_len(nrow(r2)), function(i) {
    list(
      response = back(r2$Response[i]), family = as.character(r2$family[i]), link = as.character(r2$link[i]), method = as.character(r2$method[i]),
      r2 = if (!is.null(r2$R.squared)) num(r2$R.squared[i]) else NULL, marginal = if (!is.null(r2$Marginal)) num(r2$Marginal[i]) else NULL, conditional = if (!is.null(r2$Conditional)) num(r2$Conditional[i]) else NULL
    )
  })
  ps_json(list(
    n = nrow(env$data), claims = claims, fisherC = unname(env$fisher[["C"]]), df = unname(env$fisher[["df"]]), p = if (length(claims)) unname(env$fisher[["p"]]) else NULL,
    aic = unname(env$ic[["AIC"]]), aicc = unname(env$ic[["AICc"]]), k = unname(env$ic[["K"]]), coefs = coefs, r2 = rsq, standardizeType = std,
    group = if (is.null(group)) NULL else group, warnings = env$.warnings, engine = ps_engine("piecewiseSEM", lme4 = "lme4")
  ))
}
