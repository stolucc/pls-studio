# Generalized linear mixed models by adaptive Gauss-Hermite quadrature with GLMMadaptive
# (Rizopoulos): Poisson, negative binomial, their zero-inflated forms (with their own fixed and random
# effects in the zero part) and binomial outcomes, with random intercepts and slopes for one grouping
# (clusters, or the person in repeated measures). Data are long (one row per observation) or wide (one
# column per occasion, with time scores: Mplus's growth models for counts, i s | u1@0 u2@1 ...).

PS_GLMM_FAMILIES <- c(
  poisson = "poisson()", negbin = "GLMMadaptive::negative.binomial()", zip = "zi.poisson()",
  zinb = "zi.negative.binomial()", binomial = "binomial()"
)

PS_GLMM_DELTA <- c(
  "# Variances and covariances of the random effects with standard errors by the delta method: GLMMadaptive",
  "# estimates the log-Cholesky factor of their covariance matrix (the log variances when it is diagonal).",
  "re_table <- function(fit, V) {",
  "  D <- fit$D; q <- ncol(D); at <- grep(\"^D_\", colnames(V)); th <- if (length(at) == q * (q + 1) / 2) GLMMadaptive:::chol_transf(D) else log(diag(D))",
  "  toD <- function(th) if (length(th) == q * (q + 1) / 2) unclass(GLMMadaptive:::chol_transf(th))[seq_len(q), seq_len(q), drop = FALSE] else diag(exp(th), q)",
  "  low <- which(lower.tri(D, diag = TRUE), arr.ind = TRUE)",
  "  vec <- function(th) { M <- toD(th); M[low] }",
  "  J <- sapply(seq_along(th), function(i) { h <- 1e-6 * max(1, abs(th[i])); e <- replace(numeric(length(th)), i, h); (vec(th + e) - vec(th - e)) / (2 * h) })",
  "  Vd <- matrix(J, ncol = length(th)) %*% V[at, at, drop = FALSE] %*% t(matrix(J, ncol = length(th)))",
  "  data.frame(a = colnames(D)[low[, 2]], b = rownames(D)[low[, 1]], est = D[low], se = sqrt(pmax(diag(Vd), 0)))",
  "}"
)

ps_glmm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  family <- req$family %||% "poisson"
  if (!family %in% names(PS_GLMM_FAMILIES)) stop("Invalid family in the request.")
  zi <- family %in% c("zip", "zinb")
  layout <- req$layout %||% "long"
  if (!layout %in% c("long", "wide")) stop("Invalid data layout in the request.")
  predictors <- unlist(req$predictors) %||% character(0)
  categorical <- unlist(req$categorical) %||% character(0)
  slopes <- unlist(req$slopes) %||% character(0)
  zif <- unlist(req$ziPredictors) %||% character(0)
  zir <- isTRUE(req$ziRandom)
  if (!zi && (length(zif) || zir)) stop("Zero-part effects need a zero-inflated family.")
  k <- req$quadrature %||% 11
  if (!(is.numeric(k) && length(k) == 1 && k == round(k) && k >= 1 && k <= 51)) {
    stop("Choose between 1 and 51 quadrature points.")
  }
  robust <- isTRUE(req$robust)
  trials <- req$trials
  if (!is.null(trials) && (family != "binomial" || layout != "long")) {
    stop("Trials apply to a binomial outcome in long data.")
  }
  if (layout == "wide") {
    occ <- unlist(req$occasions)
    times <- as.numeric(unlist(req$times))
    if (length(occ) < 2 || length(times) != length(occ) || any(!is.finite(times))) {
      stop("Give at least two occasions, each with a time score.")
    }
    if (length(categorical)) stop("Categorical covariates are available with long data.")
    fr <- ps_long_frame(req, c(occ, predictors))
    vo <- unname(fr$v[occ])
    vp <- unname(fr$v[predictors])
    if (any(vp %in% c("id", "time", "y"))) {
      stop("In wide data a covariate cannot be named id, time or y (the long data's columns).")
    }
    # (in wide data the predictors are time and time-invariant covariates; "time" names the time scores)
    nm <- c(time = "time", setNames(vp, predictors))
    fixed <- c("time", vp)
    rs <- unname(nm[slopes])
    zf <- unname(nm[zif])
    if (anyNA(rs) || anyNA(zf)) {
      stop("Random slopes and zero-part predictors must be among the predictors.")
    }
    prep <- c(
      "# Wide data (one column per occasion) to long: one row per person and occasion.",
      sprintf("y_wide <- as.matrix(data[, %s]); times <- %s", ps_q(vo), paste(deparse(times), collapse = "")),
      "d <- data.frame(id = rep(seq_len(nrow(data)), each = ncol(y_wide)), time = rep(times, nrow(data)), y = as.vector(t(y_wide)))",
      if (length(vp)) sprintf("d[%s] <- data[rep(seq_len(nrow(data)), each = ncol(y_wide)), %s]", ps_q(vp), ps_q(vp)),
      "d <- d[complete.cases(d), , drop = FALSE]  # (a missing occasion is left out of that person's likelihood)"
    )
    yv <- "y"
    idv <- "id"
  } else {
    outcome <- req$outcome
    cluster <- req$cluster
    if (!is.character(outcome) || !is.character(cluster) || outcome == cluster || any(c(outcome, cluster) %in% predictors)) {
      stop("Choose the outcome, the cluster column and different predictors.")
    }
    if (!all(categorical %in% predictors) || !all(slopes %in% setdiff(predictors, categorical)) || !all(zif %in% predictors)) {
      stop("Invalid predictors in the request.")
    }
    fr <- ps_long_frame(req, c(outcome, cluster, predictors, trials))
    yv <- unname(fr$v[outcome])
    idv <- unname(fr$v[cluster])
    vp <- unname(fr$v[predictors])
    fixed <- vp
    rs <- unname(fr$v[slopes])
    zf <- unname(fr$v[zif])
    prep <- c(
      sprintf("d <- data[complete.cases(data), , drop = FALSE]  # cases with every variable"),
      if (length(categorical)) {
        sprintf(
          "for (v in %s) d[[v]] <- factor(d[[v]])  # categorical predictors: dummies against the first category",
          ps_q(unname(fr$v[categorical]))
        )
      }
    )
  }
  if (family %in% c("poisson", "negbin", "zip", "zinb")) {
    prep <- c(
      prep,
      sprintf(
        "if (any(d[[\"%s\"]] < 0 | d[[\"%s\"]] != round(d[[\"%s\"]]))) stop(\"A count outcome takes the values 0, 1, 2, ...\")",
        yv,
        yv,
        yv
      )
    )
  }
  if (family == "binomial" && is.null(trials)) {
    prep <- c(
      prep,
      sprintf(
        "u <- sort(unique(d[[\"%s\"]])); if (length(u) != 2) stop(\"A binomial outcome without trials must be binary.\"); d[[\"%s\"]] <- as.integer(d[[\"%s\"]] == u[2])",
        yv,
        yv,
        yv
      )
    )
  }
  lhs <- if (!is.null(trials)) sprintf("cbind(%s, %s - %s)", yv, fr$v[[trials]], yv) else yv
  rhs <- function(v) if (length(v)) paste(v, collapse = " + ") else "1"
  call <- sprintf(
    "fit <- mixed_model(fixed = %s ~ %s, random = ~ %s | %s, data = d, family = %s%s, nAGQ = %d, control = list(tol1 = 1e-8, tol2 = 1e-8, tol3 = 1e-12))",
    lhs,
    rhs(fixed),
    rhs(rs),
    idv,
    PS_GLMM_FAMILIES[[family]],
    if (zi) sprintf(", zi_fixed = ~ %s%s", rhs(zf), if (zir) sprintf(", zi_random = ~ 1 | %s", idv) else "") else "",
    as.integer(k)
  )
  body <- c(
    "suppressPackageStartupMessages(library(GLMMadaptive))", prep,
    sprintf(
      "# Adaptive Gauss-Hermite quadrature with %d points per random effect; maximum likelihood (with tighter",
      as.integer(k)
    ),
    "# convergence criteria than GLMMadaptive's defaults, which stop up to 0.001 short of the maximum on flat likelihoods).",
    call,
    sprintf(
      "V <- vcov(fit%s)  # %s",
      if (robust) ", sandwich = TRUE" else "",
      if (robust) "robust (sandwich) standard errors, as Mplus's MLR" else "standard errors from the inverse Hessian"
    ),
    PS_GLMM_DELTA,
    "re <- re_table(fit, V)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      sprintf("Generalized linear mixed model (%s, GLMMadaptive)", family), "GLMMadaptive", inputs, body,
      c("summary(fit)", "re", "logLik(fit)")
    ))
  }
  env <- ps_run(body, inputs)
  fit <- env$fit
  V <- env$V
  term <- function(x) {
    b <- sub("^zi_", "", x)
    if (b == "(Intercept)") {
      "Intercept"
    } else if (b %in% names(fr$back)) {
      unname(fr$back[b])
    } else {
      m <- names(fr$back)[startsWith(b, names(fr$back))]
      if (length(m)) paste0(fr$back[m[1]], " = ", substring(b, nchar(m[1]) + 1)) else b
    }
  }
  tab <- function(beta, at) {
    lapply(seq_along(beta), function(i) {
      se <- sqrt(max(V[at[i], at[i]], 0))
      z <- unname(beta[i]) / se
      list(term = term(names(beta)[i]), est = unname(beta[i]), se = se, z = z, p = 2 * stats::pnorm(-abs(z)))
    })
  }
  b <- fixef(fit)
  fixedTab <- tab(b, match(names(b), colnames(V)))
  zeroTab <- if (zi) {
    g <- fixef(fit, sub_model = "zero_part")
    tab(g, match(paste0("zi_", names(g)), colnames(V)))
  } else {
    NULL
  }
  re <- env$re
  random <- lapply(seq_len(nrow(re)), function(i) {
    list(
      a = term(re$a[i]), b = if (re$a[i] == re$b[i]) NULL else term(re$b[i]),
      zeroA = startsWith(re$a[i], "zi_"), zeroB = startsWith(re$b[i], "zi_"), est = re$est[i], se = re$se[i]
    )
  })
  phi <- if (!is.null(fit$phis)) {
    at <- grep("^phi_", colnames(V))
    list(est = unname(fit$phis[1]), se = sqrt(max(V[at[1], at[1]], 0)))
  } else {
    NULL
  }
  ll <- logLik(fit)
  ps_json(list(
    family = family,
    layout = layout,
    n = nrow(env$d),
    clusters = length(unique(env$d[[idv]])),
    quadrature = as.integer(k),
    robust = robust,
    fixed = fixedTab,
    zero = zeroTab,
    random = random,
    logPhi = phi,
    logLik = as.numeric(ll),
    npar = attr(ll, "df"),
    aic = stats::AIC(fit),
    bic = stats::BIC(fit),
    converged = isTRUE(fit$converged),
    warnings = env$.warnings,
    engine = ps_engine("GLMMadaptive")
  ))
}
