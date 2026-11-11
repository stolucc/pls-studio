# Polynomial regression with response surface analysis (Edwards & Parry 1993;
# Shanock, Baran, Gentry, Pattison & Heggestad 2010): does the fit (congruence)
# or misfit of two predictors X and Y matter for an outcome Z?
#   Z = b0 + b1 X + b2 Y + b3 X^2 + b4 XY + b5 Y^2 (+ controls)
# Surface along the line of congruence (X = Y): slope a1 = b1 + b2, curvature
# a2 = b3 + b4 + b5; along the line of incongruence (X = -Y): slope a3 = b1 - b2,
# curvature a4 = b3 - b4 + b5; a5 = b3 - b5 (Humberg et al. 2019).
# Two estimations: OLS with t-tests (Shanock et al.; the stepwise R-squared
# change), or lavaan with ML / MLR exactly as the RSA package (Schönbrodt &
# Humberg), which also gives the stationary point and the principal axes.

ps_rsa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  z <- req$outcome
  xn <- req$x
  yn <- req$y
  ctrl <- unlist(req$controls)
  if (!length(z) || !length(xn) || !length(yn)) stop("Choose the outcome and the two predictors X and Y.")
  if (length(unique(c(z, xn, yn, ctrl))) != 2 + 1 + length(ctrl)) stop("Outcome, predictors and controls must be different columns.")
  est <- req$estimation %||% "OLS"
  if (!est %in% c("OLS", "ML", "MLR")) stop("Invalid estimation in the request.")
  center <- req$center %||% "mean"
  if (!center %in% c("none", "mean", "midpoint")) stop("Invalid centring in the request.")
  mid <- as.numeric(req$midpoint %||% 0)
  if (center == "midpoint" && !is.finite(mid)) stop("Give the scale midpoint.")
  conf <- as.numeric(req$confidence %||% 0.95)
  fr <- ps_long_frame(req, c(z, xn, yn, ctrl))
  v <- fr$v
  Z <- v[[z]]
  X <- v[[xn]]
  Y <- v[[yn]]
  C <- unname(v[ctrl])
  terms <- c("rsaX", "rsaY", "rsaX2", "rsaXY", "rsaY2")
  if (any(terms %in% v) || "block" %in% v) stop("Rename the columns called rsaX, rsaY, rsaX2, rsaXY, rsaY2 or block: the analysis uses these names.")
  ctr <- switch(center,
    none = c("# X and Y as measured (no centring)."),
    mean = c(
      "# X and Y centred at their common (pooled) mean, so that the line of congruence keeps X = Y.",
      sprintf("m <- mean(c(data$%s, data$%s))", X, Y), sprintf("data$rsaX <- data$%s - m; data$rsaY <- data$%s - m", X, Y)
    ),
    midpoint = c(sprintf("# X and Y centred at the scale midpoint (%s).", format(mid)), sprintf("data$rsaX <- data$%s - %s; data$rsaY <- data$%s - %s", X, format(mid), Y, format(mid)))
  )
  if (center == "none") ctr <- c(ctr, sprintf("data$rsaX <- data$%s; data$rsaY <- data$%s", X, Y))
  body <- c(
    if (est == "OLS") character(0) else "suppressPackageStartupMessages(library(lavaan))",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(Z, X, Y, C))),
    ctr,
    "data$rsaX2 <- data$rsaX^2; data$rsaXY <- data$rsaX * data$rsaY; data$rsaY2 <- data$rsaY^2"
  )
  rhs <- function(...) {
    t <- c(...)
    if (length(t)) paste(t, collapse = " + ") else "1"
  }
  if (est == "OLS") {
    body <- c(
      body,
      "# Stepwise (Shanock et al. 2010): controls, then X and Y, then the quadratic terms; F tests of the R-squared change.",
      sprintf("m0 <- lm(%s ~ %s, data = data)", Z, rhs(C)),
      sprintf("m1 <- lm(%s ~ %s, data = data)", Z, rhs(C, "rsaX", "rsaY")),
      sprintf("fit <- lm(%s ~ %s, data = data)", Z, rhs(C, terms)),
      "steps <- anova(m0, m1, fit)",
      "b <- coef(fit)[c(\"rsaX\", \"rsaY\", \"rsaX2\", \"rsaXY\", \"rsaY2\")]; V <- vcov(fit)[names(b), names(b)]",
      "# Surface parameters: linear combinations of b1..b5 with their standard errors.",
      "K <- rbind(a1 = c(1, 1, 0, 0, 0), a2 = c(0, 0, 1, 1, 1), a3 = c(1, -1, 0, 0, 0), a4 = c(0, 0, 1, -1, 1), a5 = c(0, 0, 1, 0, -1))",
      "a <- drop(K %*% b); se <- sqrt(diag(K %*% V %*% t(K))); t <- a / se",
      "surface <- cbind(est = a, se = se, t = t, p = 2 * pt(-abs(t), df.residual(fit)))",
      sprintf("ci <- cbind(a - qt(%s, df.residual(fit)) * se, a + qt(%s, df.residual(fit)) * se)", format(1 - (1 - conf) / 2), format(1 - (1 - conf) / 2))
    )
  } else {
    lab <- paste0("b", 1:5, "*", terms)
    model <- c(
      sprintf("%s ~ %s", Z, paste(c(lab, C), collapse = " + ")), sprintf("%s ~ b0*1", Z),
      "a1 := b1+b2", "a2 := b3+b4+b5", "a3 := b1-b2", "a4 := b3-b4+b5", "a5 := b3-b5",
      "X0 := (b2*b4-2*b1*b5)/(4*b3*b5-b4^2)", "Y0 := (b1*b4-2*b2*b3)/(4*b3*b5-b4^2)",
      "p11 := (b5-b3+sqrt(((b3-b5)^2)+(b4^2)))/b4", "p10 := Y0-p11*X0",
      "p21 := (b5-b3-sqrt((b3-b5)^2+b4^2))/b4", "p20 := Y0-p21*X0"
    )
    body <- c(
      body,
      sprintf("# The full polynomial model as the RSA package fits it (lavaan, %s, fixed.x).", est),
      "model <- '", paste0("  ", model), "'",
      sprintf("fit <- sem(model, data = data, estimator = \"%s\", se = \"%s\", fixed.x = TRUE, meanstructure = TRUE)", est, if (est == "MLR") "robust" else "standard"),
      sprintf("pe <- parameterEstimates(fit, level = %s)", format(conf)),
      "b <- setNames(pe$est[match(paste0(\"b\", 1:5), pe$label)], c(\"rsaX\", \"rsaY\", \"rsaX2\", \"rsaXY\", \"rsaY2\"))"
    )
  }
  body <- c(
    body,
    "# Block variable (Edwards & Cable 2009): the polynomial's combined prediction, a single predictor for path models.",
    "data$block <- drop(as.matrix(data[, names(b)]) %*% b)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      "Polynomial regression and response surface analysis", if (est == "OLS") "stats" else "lavaan", inputs, body,
      if (est == "OLS") c("summary(fit)", "steps", "surface") else c("summary(fit, rsquare = TRUE)", "pe[pe$op == \":=\", ]")
    ))
  }
  env <- ps_run(body, inputs)
  d <- env$data
  back <- c(fr$back, rsaX = paste(xn), rsaY = paste(yn), rsaX2 = paste0(xn, "\u00b2"), rsaXY = paste(xn, "\u00d7", yn), rsaY2 = paste0(yn, "\u00b2"))
  nm <- function(x) ifelse(x == "(Intercept)", "Intercept", ps_back(x, back))
  if (est == "OLS") {
    co <- stats::coef(summary(env$fit))
    cc <- stats::confint(env$fit, level = conf)
    coefs <- lapply(seq_len(nrow(co)), function(i) list(term = unname(nm(rownames(co)[i])), est = co[i, 1], se = co[i, 2], stat = co[i, 3], p = co[i, 4], ciLow = cc[i, 1], ciHigh = cc[i, 2]))
    s <- env$surface
    surface <- lapply(rownames(s), function(k) list(name = k, est = s[k, "est"], se = s[k, "se"], stat = s[k, "t"], p = s[k, "p"], ciLow = env$ci[k, 1], ciHigh = env$ci[k, 2]))
    r2 <- vapply(list(env$m0, env$m1, env$fit), function(m) summary(m)$r.squared, 0)
    st <- env$steps
    steps <- lapply(1:3, function(i) {
      list(
        step = c(if (length(C)) "Controls" else "Intercept only", "+ X and Y", "+ quadratic terms")[i], r2 = r2[i],
        dr2 = if (i == 1) NULL else r2[i] - r2[i - 1], f = if (i == 1) NULL else st$F[i], df1 = if (i == 1) NULL else st$Df[i], p = if (i == 1) NULL else st$`Pr(>F)`[i]
      )
    })
    if (!length(C)) steps <- steps[-1]
    fitstats <- list(r2 = r2[3], adjR2 = summary(env$fit)$adj.r.squared, n = stats::nobs(env$fit))
  } else {
    pe <- env$pe
    reg <- pe[pe$op %in% c("~", "~1") & pe$lhs == Z, ]
    coefs <- lapply(seq_len(nrow(reg)), function(i) list(term = if (reg$op[i] == "~1") "Intercept" else unname(nm(reg$rhs[i])), est = reg$est[i], se = reg$se[i], stat = reg$z[i], p = reg$pvalue[i], ciLow = reg$ci.lower[i], ciHigh = reg$ci.upper[i]))
    dp <- pe[pe$op == ":=", ]
    surface <- lapply(seq_len(nrow(dp)), function(i) list(name = dp$lhs[i], est = dp$est[i], se = dp$se[i], stat = dp$z[i], p = dp$pvalue[i], ciLow = dp$ci.lower[i], ciHigh = dp$ci.upper[i]))
    steps <- list()
    fitstats <- list(r2 = unname(lavaan::lavInspect(env$fit, "r2")[[Z]]), n = lavaan::lavInspect(env$fit, "nobs"))
  }
  # The surface over the observed range of X and Y (controls at their means), for the plot.
  b <- env$b
  cf <- function(k) if (est == "OLS") stats::coef(env$fit)[[k]] else env$pe$est[(env$pe$op == "~" & env$pe$rhs == k) | (k == "(Intercept)" & env$pe$op == "~1" & env$pe$lhs == Z)][1]
  b0 <- cf("(Intercept)")
  cadj <- sum(vapply(C, function(k) cf(k) * mean(d[[k]]), 0))
  rng <- range(c(d$rsaX, d$rsaY))
  gx <- seq(rng[1], rng[2], length.out = 21)
  zz <- outer(gx, gx, function(x, y) b0 + cadj + b[["rsaX"]] * x + b[["rsaY"]] * y + b[["rsaX2"]] * x^2 + b[["rsaXY"]] * x * y + b[["rsaY2"]] * y^2)
  pts <- utils::head(d[, c("rsaX", "rsaY")], 2000)
  ps_json(list(
    estimation = est, center = center, coefficients = coefs, surface = surface, steps = steps, fit = fitstats,
    grid = gx, z = lapply(seq_len(nrow(zz)), function(i) unname(zz[i, ])), points = list(x = pts$rsaX, y = pts$rsaY),
    block = unname(d$block), rows = as.integer(rownames(d)), nTotal = nrow(fr$data),
    warnings = env$.warnings, engine = list(
      package = if (est == "OLS") "stats" else "lavaan",
      version = as.character(utils::packageVersion(if (est == "OLS") "stats" else "lavaan"))
    )
  ))
}
