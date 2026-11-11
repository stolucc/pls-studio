# Item-level measurement models: item response theory with ltm (Rizopoulos
# 2006: Rasch, two-parameter logistic, graded response, generalized partial
# credit) and latent class analysis with poLCA (Linzer & Lewis 2011); mirt and glca below.

ps_items_frame <- function(req) {
  items <- unlist(req$items)
  if (length(items) < 2) stop("Choose at least two items.")
  # (the latent class models' auxiliary variables come along, after the items)
  aux <- ps_aux_columns(req$aux, items)
  fr <- ps_long_frame(req, c(items, aux))
  fr$items <- unname(fr$v[items])
  fr
}

# ---- Auxiliary variables of a latent class model: the three-step approach ----
# After the classes are found (step 1) and each case is assigned to its most likely class (step 2), the
# assignments' classification errors are corrected when classes are related to other variables (step 3):
# the error matrix D[c, s] = P(assigned s | class c) from the posterior probabilities (Vermunt 2010, eq. 6),
# BCH weights w[i, c] = solve(D)[s_i, c] (Bolck, Croon & Hagenaars 2004; Vermunt 2010; Bakk & Vermunt 2016),
# the class means of distal outcomes with BCH weights (a Wald test of their equality), and covariates of class
# membership: a multinomial logit by maximum likelihood with the classification errors as known (Vermunt's ML
# three-step; Mplus's R3STEP) or with BCH weights. Standard errors are robust (sandwich), as Mplus's MLR, and
# take the step-1 estimates as known (as Mplus and Latent GOLD do).
ps_aux_columns <- function(aux, items) {
  if (is.null(aux)) return(character(0))
  cols <- c(unlist(aux$distal), unlist(aux$covariates))
  if (!length(cols)) stop("Choose distal outcomes or covariates for the three-step analysis.")
  if (!is.character(cols) || anyDuplicated(cols) || any(cols %in% items)) stop("The auxiliary variables must be distinct columns that are not items.")
  if (!is.null(aux$method) && !(length(aux$method) == 1 && aux$method %in% c("ml", "bch"))) stop("Invalid three-step method in the request.")
  cols
}
PS_LCA_AUX_FUNCTIONS <- c(
  "# Step 2 and the classification errors: modal assignment s, D[c, s] = sum_i p_ic [s_i = s] / sum_i p_ic,",
  "# and the BCH weights of each case for each class, w[i, c] = solve(D)[s_i, c] (rows sum to 1, some negative).",
  "aux_errors <- function(post) {",
  "  K <- ncol(post); s <- max.col(post, ties.method = \"first\"); M <- outer(s, seq_len(K), `==`) * 1",
  "  D <- crossprod(post, M) / colSums(post)",
  "  list(s = s, D = D, w = M %*% solve(D))",
  "}",
  "# A distal outcome's class means with BCH weights: mu_c = sum_i w_ic y_i / sum_i w_ic, the weighted ML",
  "# estimate whether or not the variances differ between classes; their sandwich covariance matrix",
  "# V[c, d] = sum_i w_ic w_id (y_i - mu_c)(y_i - mu_d) / (W_c W_d); Wald tests of equal means (all, and pairs).",
  "aux_distal <- function(y, w) {",
  "  ok <- !is.na(y); y <- y[ok]; w <- w[ok, , drop = FALSE]; K <- ncol(w)",
  "  W <- colSums(w); mu <- colSums(w * y) / W",
  "  E <- w * outer(y, mu, `-`); V <- crossprod(E) / outer(W, W)",
  "  R <- cbind(diag(K - 1), -1); d <- R %*% mu",
  "  chisq <- drop(crossprod(d, solve(R %*% V %*% t(R), d)))",
  "  pairs <- do.call(rbind, lapply(seq_len(K - 1), function(a) do.call(rbind, lapply((a + 1):K, function(b) {",
  "    x <- (mu[a] - mu[b])^2 / (V[a, a] + V[b, b] - 2 * V[a, b]); c(a = a, b = b, chisq = x, p = pchisq(x, 1, lower.tail = FALSE)) }))))",
  "  list(n = length(y), means = mu, se = sqrt(diag(V)), sd = sqrt(pmax(colSums(w * outer(y, mu, `-`)^2) / W, 0)),",
  "    chisq = chisq, df = K - 1, p = pchisq(chisq, K - 1, lower.tail = FALSE), pairs = pairs)",
  "}",
  "# Covariates of class membership: P(class c | x) = exp(x b_c) / sum_d exp(x b_d), b of the reference class 0.",
  "# ml: maximise sum_i log sum_c P(c | x_i) D[c, s_i] (Vermunt 2010); bch: maximise sum_i sum_c w_ic log P(c | x_i).",
  "# Newton-Raphson from BFGS's solution, analytic scores and Hessian; robust (sandwich) standard errors.",
  "aux_logit <- function(X, s, D, w, ref, method) {",
  "  K <- ncol(D); free <- setdiff(seq_len(K), ref); p <- ncol(X); q <- p * (K - 1)",
  "  parts <- function(b) {",
  "    B <- matrix(0, p, K); B[, free] <- b; e <- X %*% B; e <- exp(e - apply(e, 1, max)); P <- e / rowSums(e)",
  "    if (method == \"ml\") { L <- P * t(D[, s, drop = FALSE]); ll <- sum(log(rowSums(L))); Q <- L / rowSums(L); r <- rep(1, nrow(X)) }",
  "    else { r <- rowSums(w); ll <- sum(w * log(P)); Q <- w }",
  "    S <- do.call(cbind, lapply(free, function(c) X * (Q[, c] - r * P[, c])))",
  "    H <- matrix(0, q, q)",
  "    for (a in seq_along(free)) for (b in seq_along(free)) {",
  "      c1 <- free[a]; c2 <- free[b]",
  "      h <- r * P[, c1] * ((c1 == c2) - P[, c2]); if (method == \"ml\") h <- h - Q[, c1] * ((c1 == c2) - Q[, c2])",
  "      H[(a - 1) * p + seq_len(p), (b - 1) * p + seq_len(p)] <- -crossprod(X * h, X)",
  "    }",
  "    list(ll = ll, S = S, g = colSums(S), H = H)",
  "  }",
  "  o <- stats::optim(numeric(q), function(b) -parts(b)$ll, function(b) -parts(b)$g, method = \"BFGS\", control = list(maxit = 1000, reltol = 1e-14))",
  "  b <- o$par",
  "  for (it in 1:100) { f <- parts(b); step <- solve(f$H, f$g); if (max(abs(step)) < 1e-12) break",
  "    t <- 1; repeat { b1 <- b - t * step; if (parts(b1)$ll >= f$ll - 1e-12 || t < 1e-6) break; t <- t / 2 }; b <- b1 }",
  "  f <- parts(b); Hi <- solve(-f$H); V <- Hi %*% crossprod(f$S) %*% Hi",
  "  if (max(abs(f$g)) > 1e-6) warning(\"The covariates' multinomial logit did not converge.\")",
  "  list(est = matrix(b, p, K - 1, dimnames = list(colnames(X), free)), V = V, ll = f$ll, n = nrow(X), free = free,",
  "    # Wald tests that a covariate's coefficients are all 0 (K - 1 df)",
  "    wald = sapply(seq_len(p), function(j) { at <- (seq_along(free) - 1) * p + j; x <- drop(crossprod(b[at], solve(V[at, at, drop = FALSE], b[at]))); c(chisq = x, df = K - 1, p = pchisq(x, K - 1, lower.tail = FALSE)) }))",
  "}")

#' The script lines of the three-step analysis (none without auxiliary variables): `post` the chosen model's
#' posterior probabilities (classes by size), `keep` the rows of `data` the models were fitted to, `bic` the BIC
#' of each fitted model (the lowest picks the model when no number of classes is given).
ps_lca_aux_body <- function(aux, fr, ks, post, keep, bic) {
  if (is.null(aux)) return(character(0))
  k <- aux$classes
  if (!is.null(k) && !(length(k) == 1 && is.numeric(k) && k %in% ks)) stop("The three-step analysis needs one of the fitted numbers of classes.")
  ref <- aux$reference
  if (!is.null(ref) && !(length(ref) == 1 && is.numeric(ref) && ref >= 1 && ref <= 10 && ref == round(ref))) stop("Invalid reference class in the request.")
  distal <- unname(fr$v[unlist(aux$distal)]); covs <- unname(fr$v[unlist(aux$covariates)])
  method <- aux$method %||% "ml"
  c("",
    "# ---- Auxiliary variables: three-step approach ----", PS_LCA_AUX_FUNCTIONS,
    sprintf("ks <- c(%s)", paste(deparse(ks), collapse = "")),
    if (is.null(k)) sprintf("k <- ks[which.min(ifelse(ks >= 2, %s, Inf))]  # the model with the lowest BIC (of two or more classes)", bic) else sprintf("k <- %d", as.integer(k)),
    "if (k < 2) stop(\"The three-step analysis needs a model with two or more classes.\")",
    "fit <- fits[[match(k, ks)]]",
    sprintf("post <- %s  # posterior class probabilities, classes by size", post),
    sprintf("aux <- data[%s, %s, drop = FALSE]  # the rows the classes were estimated from", keep, ps_q(c(distal, covs))),
    "e <- aux_errors(post)",
    if (length(distal)) sprintf("distal <- lapply(%s, function(v) aux_distal(as.numeric(aux[[v]]), e$w))", ps_q(distal)),
    if (length(covs)) c(
      sprintf("ref <- %s  # the reference class", if (is.null(ref)) "k" else sprintf("min(%d, k)", as.integer(ref))),
      sprintf("cv <- aux[, %s, drop = FALSE]; ok <- complete.cases(cv)  # (cases missing a covariate are left out)", ps_q(covs)),
      "X <- model.matrix(~ ., cv[ok, , drop = FALSE])",
      sprintf("covariates <- aux_logit(X, e$s[ok], e$D, e$w[ok, , drop = FALSE], ref, \"%s\")", method)))
}
PS_AUX_REPORT <- "list(classes = k, errors = e$D, distal = if (exists(\"distal\")) distal, covariates = if (exists(\"covariates\")) covariates)"
#' The three-step results for the app.
ps_lca_aux_result <- function(aux, fr, env) {
  if (is.null(aux)) return(NULL)
  back <- function(v) ps_back(v, fr$back, FALSE)
  out <- list(k = env$k, method = aux$method %||% "ml", n = nrow(env$post), D = ps_rows(env$e$D), counts = tabulate(env$e$s, env$k))
  if (!is.null(env$distal)) out$distal <- lapply(seq_along(env$distal), function(j) { d <- env$distal[[j]]
    list(name = back(unname(fr$v[unlist(aux$distal)][j])), n = d$n, means = unname(d$means), se = unname(d$se), sd = unname(d$sd), chisq = d$chisq, df = d$df, p = d$p,
      pairs = lapply(seq_len(nrow(d$pairs)), function(i) as.list(d$pairs[i, ]))) })
  if (!is.null(env$covariates)) { cv <- env$covariates; terms <- rownames(cv$est); se <- matrix(sqrt(diag(cv$V)), nrow(cv$est))
    lab <- function(t) if (t == "(Intercept)") "Intercept" else { m <- match(TRUE, startsWith(t, fr$v[unlist(aux$covariates)])); if (is.na(m)) t else paste0(back(unname(fr$v[unlist(aux$covariates)][m])), substring(t, nchar(fr$v[unlist(aux$covariates)][m]) + 1)) }
    out$covariates <- list(n = cv$n, logLik = cv$ll, reference = env$ref, terms = vapply(terms, lab, ""),
      coefs = lapply(seq_along(cv$free), function(a) list(class = cv$free[a], est = unname(cv$est[, a]), se = unname(se[, a]), p = unname(2 * pnorm(-abs(cv$est[, a] / se[, a]))))),
      wald = lapply(seq_along(terms), function(j) list(chisq = unname(cv$wald["chisq", j]), df = unname(cv$wald["df", j]), p = unname(cv$wald["p", j])))) }
  out
}

# Robust (sandwich) standard errors for the 2PL and generalized partial credit models, as Mplus's MLR:
# H^-1 B H^-1, with H ltm's Hessian and B the cross-product of each person's score (the gradient of their
# marginal log-likelihood, on the Gauss-Hermite nodes of the fit). A missing response adds nothing.
PS_IRT_ROBUST <- c(
  "irt_robust <- function(fit, X, k) {",
  "  gh <- ltm:::gauher(k); z <- sqrt(2) * gh$x; w <- gh$w / sqrt(pi)",
  "  N <- nrow(X); Q <- length(z); M <- !is.na(X); X[!M] <- 1",
  "  cf <- fit$coefficients",
  "  # per item: the category probabilities at each node (Q x categories) and each person's response (1, 2, ...)",
  "  if (inherits(fit, \"gpcm\")) {",
  "    P <- lapply(cf, function(b) { K <- length(b); s <- outer(z, rep(b[K], K - 1)) + rep(b[-K], each = Q)",
  "      num <- cbind(0, t(apply(s, 1, cumsum))); e <- exp(num - apply(num, 1, max)); e / rowSums(e) })",
  "    R <- X",
  "  } else {",
  "    P <- lapply(seq_len(nrow(cf)), function(j) { p <- plogis(cf[j, 1] + cf[j, 2] * z); cbind(1 - p, p) })",
  "    R <- X + 1",
  "  }",
  "  LL <- matrix(0, N, Q)",
  "  for (j in seq_along(P)) LL[M[, j], ] <- LL[M[, j], ] + t(log(P[[j]]))[R[M[, j], j], , drop = FALSE]",
  "  L <- exp(LL - apply(LL, 1, max)) * rep(w, each = N); post <- L / rowSums(L)",
  "  S <- NULL",
  "  for (j in seq_along(P)) {",
  "    p <- P[[j]]; K <- ncol(p); r <- R[, j] - 1; m <- M[, j]",
  "    if (inherits(fit, \"gpcm\")) {",
  "      # d log P(r) / d intercept v = [r >= v] - P(u >= v); d / d slope = z (r - E(u))",
  "      sv <- lapply(seq_len(K - 1), function(v) m * rowSums(post * (outer(r >= v, rep(1, Q)) - rep(rowSums(p[, (v + 1):K, drop = FALSE]), each = N))))",
  "      sa <- m * rowSums(post * (outer(r, rep(1, Q)) - rep(as.vector(p %*% (0:(K - 1))), each = N)) * rep(z, each = N))",
  "      S <- cbind(S, do.call(cbind, sv), sa)",
  "    } else {",
  "      res <- outer(r, rep(1, Q)) - rep(p[, 2], each = N)",
  "      S <- cbind(S, m * rowSums(post * res), m * rowSums(post * res * rep(z, each = N)))",
  "    }",
  "  }",
  "  # (ltm orders the 2PL's parameters as all intercepts, then all slopes)",
  "  if (!inherits(fit, \"gpcm\")) S <- S[, c(seq(1, ncol(S), 2), seq(2, ncol(S), 2))]",
  "  H <- solve(fit$hessian)",
  "  H %*% crossprod(S) %*% H",
  "}")

ps_irt <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  model <- req$model %||% "twopl"
  if (!model %in% c("rasch", "twopl", "grm", "gpcm")) stop("Invalid IRT model in the request.")
  fr <- ps_items_frame(req)
  binary <- model %in% c("rasch", "twopl")
  # (ltm's optimisers warn "NaNs produced" while searching, also on the package's own help-page
  #  examples; the fit is unaffected, so those warnings are not kept.)
  quiet <- function(x) sprintf("fit <- withCallingHandlers(%s, warning = function(w) if (grepl(\"NaNs produced\", conditionMessage(w))) invokeRestart(\"muffleWarning\"))", x)
  # Gauss-Hermite quadrature points (ltm's GHk; its defaults are 15 to 21, too few for long tests: the
  # log-likelihood keeps changing up to some 80 points with 20 items), and robust standard errors (Mplus MLR).
  k <- req$quadrature
  if (!is.null(k) && !(is.numeric(k) && length(k) == 1 && k == round(k) && k >= 5 && k <= 100)) stop("Choose between 5 and 100 quadrature points.")
  robust <- isTRUE(req$robust)
  if (robust && !model %in% c("twopl", "gpcm")) stop("Robust standard errors are available for the 2PL and partial credit models.")
  ctl <- if (is.null(k)) "" else sprintf(", control = list(GHk = %d)", as.integer(k))
  call <- switch(model,
    rasch = quiet(sprintf("rasch(items%s)", ctl)),
    twopl = quiet(sprintf("ltm(items ~ z1%s)", ctl)),
    grm = quiet(sprintf("grm(items%s)", ctl)),
    # (fitted in its intercept parameterisation, IRT.param = FALSE, so that the Hessian is that of the logit metric)
    gpcm = quiet(sprintf("gpcm(items, IRT.param = FALSE%s)", ctl)))
  body <- c("suppressPackageStartupMessages(library(ltm))",
    sprintf("items <- data[, %s]", ps_q(fr$items)),
    if (binary) c("# Binary items: the two observed values become 0 and 1 (lower = 0).",
      "items[] <- lapply(items, function(v) { u <- sort(unique(v[!is.na(v)])); if (length(u) != 2) stop('Rasch and 2PL models need binary items; use the graded response or partial credit model for more categories.'); as.integer(v == u[2]) })")
    else "items[] <- lapply(items, function(v) as.integer(factor(v)))  # categories 1, 2, ..., in their order",
    call,
    "# Item parameters in the IRT parameterisation: difficulty / thresholds (b) and discrimination (a).",
    "pars <- if (inherits(fit, \"grm\")) ltm:::IRT.parm(fit)$parms else",
    "  if (inherits(fit, \"gpcm\")) t(sapply(fit$coefficients, function(b) { K <- length(b); c(setNames(-b[-K] / b[K], names(b)[-K]), Dscrmn = unname(b[K])) })) else",
    "  coef(fit)",
    if (model %in% c("twopl", "gpcm")) c(
      "# The same parameters in the logit metric Mplus prints: loadings (discriminations) and thresholds (steps),",
      "# a threshold being minus ltm's intercept; standard errors from the inverse Hessian.",
      "V <- solve(fit$hessian)",
      if (robust) c(PS_IRT_ROBUST, "V <- irt_robust(fit, as.matrix(items), fit$control$GHk)")),
    "# Item and test information over the latent trait (theta).",
    "theta <- seq(-4, 4, by = 0.1)",
    "info <- plot(fit, type = \"IIC\", z = theta, plot = FALSE)",
    "# Reliability of the trait estimates (marginal), from the expected a posteriori scores.",
    "scores <- factor.scores(fit, method = \"EAP\")$score.dat")
  inputs <- list(data = fr$data)
  if (export) return(ps_script(sprintf("Item response model (%s, ltm)", model), "ltm", inputs, body,
    c("summary(fit)", "pars", "item.fit(fit)")))
  env <- ps_run(body, inputs)
  fit <- env$fit
  pars <- env$pars
  if (is.list(pars) && !is.data.frame(pars)) {
    rows <- names(pars)
    params <- lapply(seq_along(pars), function(i) list(item = ps_back(rows[i], fr$back, FALSE), values = as.list(pars[[i]])))
  } else {
    pars <- as.matrix(pars)
    params <- lapply(seq_len(nrow(pars)), function(i) list(item = ps_back(rownames(pars)[i], fr$back, FALSE), values = as.list(pars[i, ])))
  }
  info <- env$info
  # (ltm's item fit is defined for dichotomous models: Rasch and 2PL.)
  ifit <- if (model %in% c("rasch", "twopl")) ps_try(ltm::item.fit(fit), "Item fit (ltm::item.fit)") else NULL
  sd <- env$scores
  # Marginal reliability: 1 - mean posterior variance / variance of the EAP scores (+ posterior variance).
  rel <- ps_try({ v <- mean(sd$se.z1^2); 1 - v / (stats::var(sd$z1) + v) }, "Marginal reliability")
  # Loadings and thresholds (steps) in the logit metric, with standard errors (robust: Mplus's MLR).
  coefficients <- NULL
  if (model %in% c("twopl", "gpcm")) {
    se <- sqrt(pmax(diag(env$V), 0)); cf <- fit$coefficients
    coefficients <- if (model == "twopl") {
      J <- nrow(cf)
      c(lapply(seq_len(J), function(j) list(item = ps_back(rownames(cf)[j], fr$back, FALSE), parameter = "loading", est = unname(cf[j, 2]), se = unname(se[J + j]))),
        lapply(seq_len(J), function(j) list(item = ps_back(rownames(cf)[j], fr$back, FALSE), parameter = "threshold 1", est = -unname(cf[j, 1]), se = unname(se[j]))))
    } else {
      at <- cumsum(c(0, lengths(cf)))
      unlist(lapply(seq_along(cf), function(j) { b <- cf[[j]]; K <- length(b); it <- ps_back(names(cf)[j], fr$back, FALSE)
        c(list(list(item = it, parameter = "loading", est = unname(b[K]), se = unname(se[at[j] + K]))),
          lapply(seq_len(K - 1), function(v) list(item = it, parameter = sprintf("step %d", v), est = -unname(b[v]), se = unname(se[at[j] + v])))) }), recursive = FALSE)
    }
  }
  ps_json(list(model = model, n = nrow(env$items), items = ps_back(fr$items, fr$back, FALSE),
    params = params, coefficients = coefficients, quadrature = k, robust = robust, logLik = as.numeric(logLik(fit)), aic = AIC(fit), bic = BIC(fit), reliability = rel,
    theta = unname(info[, 1]), information = lapply(seq_len(ncol(info) - 1), function(j) unname(info[, j + 1])),
    itemFit = if (is.null(ifit)) list() else lapply(seq_along(ifit$Tobs), function(i) list(item = ps_back(names(ifit$Tobs)[i], fr$back, FALSE), x2 = unname(ifit$Tobs[i]), p = unname(ifit$p.values[i]))),
    warnings = env$.warnings, engine = ps_engine("ltm")))
}

ps_lca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  f <- sprintf("cbind(%s) ~ 1", paste(fr$items, collapse = ", "))
  body <- c("suppressPackageStartupMessages(library(poLCA))",
    sprintf("items <- data[, %s]", ps_q(fr$items)),
    "items[] <- lapply(items, function(v) as.integer(factor(v)))  # poLCA needs categories 1, 2, ...",
    sprintf("# Latent class models with %s classes; %d random starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), nrep),
    "# (A best start that stops at the iteration limit, as on a flat likelihood, is continued to convergence.)",
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); m <- poLCA(%s, items, nclass = k, nrep = %d, maxiter = 5000, verbose = FALSE)",
      paste(deparse(ks), collapse = ""), seed, f, nrep),
    sprintf("  if (m$numiter >= 5000) m <- poLCA(%s, items, nclass = k, probs.start = m$probs, maxiter = 100000, verbose = FALSE)", f),
    "  if (m$numiter >= 100000) warning(sprintf(\"The %d-class model did not converge in 100000 iterations.\", k))",
    "  m })",
    "# Entropy-based classification quality (1 = perfectly separated classes).",
    "entropy <- function(m) { p <- m$posterior; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }",
    ps_lca_aux_body(req$aux, fr, ks, "fit$posterior[, order(-fit$P), drop = FALSE]", sprintf("complete.cases(data[, %s])", ps_q(fr$items)), "sapply(fits, function(m) m$bic)"))
  inputs <- list(data = fr$data)
  if (export) return(ps_script("Latent class analysis (poLCA)", "poLCA", inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$P), llik = m$llik, AIC = m$aic, BIC = m$bic, entropy = entropy(m)))", "fits", PS_AUX_REPORT[!is.null(req$aux)])))
  env <- ps_run(body, inputs)
  models <- lapply(env$fits, function(m) {
    ord <- order(-m$P)  # classes ordered by size
    list(k = length(m$P), llik = m$llik, npar = m$npar, aic = m$aic, bic = m$bic, gsq = m$Gsq, entropy = env$entropy(m),
      shares = unname(m$P[ord]),
      probs = lapply(seq_along(m$probs), function(i) list(item = ps_back(fr$items[i], fr$back, FALSE),
        categories = levels(factor(fr$data[[fr$items[i]]])),
        byClass = lapply(ord, function(c) unname(m$probs[[i]][c, ])))))
  })
  ps_json(list(n = nrow(env$items), items = ps_back(fr$items, fr$back, FALSE), models = models, aux = ps_lca_aux_result(req$aux, fr, env),
    warnings = env$.warnings, engine = ps_engine("poLCA")))
}

# Latent profile analysis (continuous indicators) and latent class growth analysis (ordered
# categorical repeated measures): the mixtures Mplus fits with TYPE = MIXTURE, written out in base R
# (no package in the browser fits them with Mplus's constraints). Both maximise the likelihood from
# several random starts and keep the best.
PS_LPA_FUNCTIONS <- c(
  "# A mixture of multivariate normal distributions, fitted by EM. structure: EEI = variances equal across",
  "# classes, no covariances (Mplus's default); VVI = class-specific variances; EEE = covariances, equal",
  "# across classes; VVV = class-specific covariance matrices.",
  "lpa_fit <- function(Y, k, structure, nrep, maxiter = 5000, tol = 1e-10) {",
  "  Y <- as.matrix(Y); n <- nrow(Y); p <- ncol(Y)",
  "  equal <- structure %in% c(\"EEI\", \"EEE\"); diagonal <- structure %in% c(\"EEI\", \"VVI\")",
  "  dens <- function(mu, S) { R <- chol(S); z <- backsolve(R, t(Y) - mu, transpose = TRUE); -0.5 * colSums(z^2) - sum(log(diag(R))) - 0.5 * p * log(2 * pi) }",
  "  mstep <- function(post) {",
  "    w <- colSums(post)",
  "    mu <- lapply(seq_len(k), function(c) colSums(post[, c] * Y) / w[c])",
  "    S <- lapply(seq_len(k), function(c) { D <- t(Y) - mu[[c]]; (D %*% (post[, c] * t(D))) / w[c] })",
  "    if (equal) S <- rep(list(Reduce(`+`, lapply(seq_len(k), function(c) S[[c]] * w[c])) / n), k)",
  "    if (diagonal) S <- lapply(S, function(s) diag(diag(s), p))",
  "    list(pi = w / n, mu = mu, S = S)",
  "  }",
  "  run <- function(post) {",
  "    ll0 <- -Inf",
  "    for (it in seq_len(maxiter)) {",
  "      th <- mstep(post)",
  "      lp <- vapply(seq_len(k), function(c) log(th$pi[c]) + dens(th$mu[[c]], th$S[[c]]), numeric(n))",
  "      lp <- matrix(lp, n); m <- apply(lp, 1, max); lse <- m + log(rowSums(exp(lp - m)))",
  "      post <- exp(lp - lse); ll <- sum(lse)",
  "      if (abs(ll - ll0) < tol * abs(ll)) break",
  "      ll0 <- ll",
  "    }",
  "    c(th, list(ll = ll, post = post, iterations = it))",
  "  }",
  "  best <- NULL",
  "  for (r in seq_len(if (k == 1) 1 else nrep)) {",
  "    # Starts: k-means, then k random cases as centres, each case assigned to the nearest.",
  "    cl <- if (k == 1) rep(1L, n) else if (r == 1) stats::kmeans(Y, k, nstart = 5)$cluster",
  "      else { C <- Y[sample(n, k), , drop = FALSE]; max.col(-vapply(seq_len(k), function(c) colSums((t(Y) - C[c, ])^2), numeric(n)), ties.method = \"first\") }",
  "    if (any(tabulate(cl, k) <= p)) next",
  "    f <- tryCatch(run(outer(cl, seq_len(k), `==`) * 1), error = function(e) NULL)",
  "    if (!is.null(f) && is.finite(f$ll) && (is.null(best) || f$ll > best$ll)) best <- f",
  "  }",
  "  if (is.null(best)) stop(sprintf(\"No start of the %d-class model converged (a class became too small or singular).\", k))",
  "  best$npar <- (k - 1) + k * p + (if (diagonal) p else p * (p + 1) / 2) * (if (equal) 1 else k)",
  "  best",
  "}")

ps_lpa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  structure <- req$structure %||% "EEI"
  if (!structure %in% c("EEI", "VVI", "EEE", "VVV")) stop("Invalid variance structure in the request.")
  body <- c(PS_LPA_FUNCTIONS,
    sprintf("Y <- data[, %s]", ps_q(fr$items)),
    "Y <- Y[complete.cases(Y), , drop = FALSE]  # cases with every indicator",
    sprintf("# Latent profile models with %s classes (%s); %d starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), structure, nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); lpa_fit(Y, k, \"%s\", %d) })", paste(deparse(ks), collapse = ""), seed, structure, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }",
    ps_lca_aux_body(req$aux, fr, ks, "fit$post[, order(-fit$pi), drop = FALSE]", sprintf("complete.cases(data[, %s])", ps_q(fr$items)), "sapply(fits, function(m) -2 * m$ll + m$npar * log(nrow(Y)))"))
  inputs <- list(data = fr$data)
  if (export) return(ps_script(sprintf("Latent profile analysis (%s)", structure), character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$pi), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(Y)), entropy = entropy(m)))",
      "lapply(fits, function(m) list(proportions = m$pi, means = do.call(rbind, m$mu), covariances = m$S))", PS_AUX_REPORT[!is.null(req$aux)])))
  env <- ps_run(body, inputs)
  n <- nrow(env$Y)
  models <- lapply(env$fits, function(m) {
    ord <- order(-m$pi)
    list(k = length(m$pi), llik = m$ll, npar = m$npar, aic = -2 * m$ll + 2 * m$npar, bic = -2 * m$ll + m$npar * log(n), gsq = NULL,
      entropy = env$entropy(m), shares = unname(m$pi[ord]),
      means = lapply(ord, function(c) unname(m$mu[[c]])),
      cov = lapply(ord, function(c) unname(m$S[[c]])), probs = list())
  })
  ps_json(list(n = n, items = ps_back(fr$items, fr$back, FALSE), models = models, structure = structure, aux = ps_lca_aux_result(req$aux, fr, env),
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}

PS_LCGA_FUNCTIONS <- c(
  "# Latent class growth analysis of an ordered categorical outcome (Mplus: i s | u1@t1 ...; TYPE = MIXTURE):",
  "# within class c, P(u_t <= j) = plogis(tau_j - (i_c + s_c * t)), thresholds equal over time and classes,",
  "# no growth factor variance within class, the intercept of the last class fixed at 0.",
  "lcga_fit <- function(U, times, k, nrep) {",
  "  U <- as.matrix(U); n <- nrow(U); nt <- ncol(U)",
  "  lev <- sort(unique(as.vector(U[!is.na(U)]))); K <- length(lev)",
  "  if (K < 2) stop(\"The outcome has a single category.\")",
  "  cell <- cbind(match(U, lev), rep(seq_len(nt), each = n))",
  "  unpack <- function(th) {",
  "    tau <- cumsum(c(th[1], exp(th[seq_len(K - 2) + 1]))); o <- K - 1",
  "    i <- c(th[o + seq_len(k - 1)], 0); o <- o + k - 1",
  "    s <- th[o + seq_len(k)]; o <- o + k",
  "    list(tau = tau, i = i, s = s, logit = c(th[o + seq_len(k - 1)], 0))",
  "  }",
  "  probs <- function(p, c) { cum <- plogis(outer(p$tau, p$i[c] + p$s[c] * times, `-`)); rbind(cum, 1) - rbind(0, cum) }",
  "  loglik <- function(th) {",
  "    p <- unpack(th)",
  "    lp <- vapply(seq_len(k), function(c) rowSums(matrix(log(probs(p, c)[cell]), n), na.rm = TRUE), numeric(n))",
  "    lw <- p$logit - max(p$logit); lw <- lw - log(sum(exp(lw)))",
  "    lp <- sweep(matrix(lp, n), 2, lw, `+`); m <- apply(lp, 1, max)",
  "    list(ll = sum(m + log(rowSums(exp(lp - m)))), post = exp(lp - m - log(rowSums(exp(lp - m)))))",
  "  }",
  "  f <- function(th) { v <- -loglik(th)$ll; if (is.finite(v)) v else 1e300 }",
  "  cp <- cumsum(table(factor(U, levels = lev)))[-K] / sum(!is.na(U))",
  "  best <- NULL",
  "  for (r in seq_len(nrep)) {",
  "    st <- c(qlogis(cp[1]), log(pmax(diff(qlogis(cp)), 0.1)), stats::rnorm(k - 1, 0, 2), stats::rnorm(k, 0, 1), stats::rnorm(k - 1, 0, 1))",
  "    o <- tryCatch(stats::optim(st, f, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-12)), error = function(e) NULL)",
  "    if (!is.null(o) && (is.null(best) || o$value < best$value)) best <- o",
  "  }",
  "  p <- unpack(best$par); l <- loglik(best$par)",
  "  pi <- exp(p$logit) / sum(exp(p$logit))",
  "  # Classes by size (largest first); the last (smallest) is the reference whose intercept is 0.",
  "  ord <- order(-pi); ref <- ord[k]",
  "  list(ll = l$ll, npar = (K - 1) + 3 * k - 2, converged = best$convergence == 0, levels = lev, pi = pi[ord], post = l$post[, ord, drop = FALSE],",
  "    thresholds = p$tau - p$i[ref], intercepts = p$i[ord] - p$i[ref], slopes = p$s[ord],",
  "    probs = lapply(ord, function(c) probs(p, c)))",
  "}")

ps_lcga <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  fr <- ps_items_frame(req)
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  times <- as.numeric(unlist(req$times))
  if (length(times) != length(fr$items) || any(!is.finite(times))) stop("Give one time score per occasion.")
  body <- c(PS_LCGA_FUNCTIONS,
    sprintf("U <- data[, %s]", ps_q(fr$items)),
    "U <- U[rowSums(!is.na(U)) > 0, , drop = FALSE]  # (a missing occasion is left out of that person's likelihood)",
    sprintf("times <- %s", paste(deparse(times), collapse = "")),
    sprintf("# Latent class growth models with %s classes; %d random starts each (the best log-likelihood is kept).", paste(ks, collapse = ", "), nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); lcga_fit(U, times, k, %d) })", paste(deparse(ks), collapse = ""), seed, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }",
    ps_lca_aux_body(req$aux, fr, ks, "fit$post", sprintf("rowSums(!is.na(data[, %s])) > 0", ps_q(fr$items)), "sapply(fits, function(m) -2 * m$ll + m$npar * log(nrow(U)))"))
  inputs <- list(data = fr$data)
  if (export) return(ps_script("Latent class growth analysis (ordered categorical outcome)", character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$pi), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(U)), entropy = entropy(m)))",
      "lapply(fits, function(m) m[c(\"pi\", \"thresholds\", \"intercepts\", \"slopes\")])", PS_AUX_REPORT[!is.null(req$aux)])))
  env <- ps_run(body, inputs)
  n <- nrow(env$U)
  models <- lapply(env$fits, function(m) {
    k <- length(m$pi)
    if (!m$converged) ps_warning(sprintf("The %d-class growth model did not converge.", k))
    list(k = k, llik = m$ll, npar = m$npar, aic = -2 * m$ll + 2 * m$npar, bic = -2 * m$ll + m$npar * log(n), gsq = NULL,
      entropy = env$entropy(m), shares = unname(m$pi),
      growth = list(thresholds = unname(m$thresholds), intercepts = unname(m$intercepts), slopes = unname(m$slopes)),
      probs = lapply(seq_along(fr$items), function(t) list(item = ps_back(fr$items[t], fr$back, FALSE), categories = as.character(m$levels),
        byClass = lapply(seq_len(k), function(c) unname(m$probs[[c]][, t])))))
  })
  ps_json(list(n = n, items = ps_back(fr$items, fr$back, FALSE), models = models, times = times, aux = ps_lca_aux_result(req$aux, fr, env),
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}

# Item response models that need mirt (Chalmers 2012): the three- and four-parameter logistic models, with
# normal priors on the logits of the lower and upper asymptotes (as Mplus's MODEL PRIORS), and the mixture
# 2PL model (latent classes with class-specific item parameters; Mplus TYPE = MIXTURE with a factor).
# The parameters are those Mplus prints (factor variance 1): loading a, threshold -d, and for the asymptotes
# Mplus's u$2 = -logit(g) and u$3 = -logit(upper).
PS_MIRT_ROBUST <- c(
  "# Robust (sandwich) standard errors, as Mplus's MLR: V H^-1 B V, with V the inverse of mirt's (Oakes) information,",
  "# which includes the priors, and B the cross-product of each person's score (the gradient of their marginal",
  "# log-likelihood, on mirt's quadrature nodes). A missing response adds nothing.",
  "mirt_robust <- function(fit, X) {",
  "  z <- as.vector(fit@Model$Theta); w <- fit@Internals$Prior[[1]]; w <- w / sum(w)",
  "  N <- nrow(X); Q <- length(z); M <- !is.na(X); X[!M] <- 0",
  "  sv <- mod2values(fit); sv <- sv[sv$est & sv$item %in% colnames(X), ]",
  "  cf <- coef(fit, IRTpars = FALSE, simplify = TRUE)$items",
  "  P <- lapply(seq_len(ncol(X)), function(j) { g <- cf[j, \"g\"]; u <- cf[j, \"u\"]; s <- plogis(cf[j, \"a1\"] * z + cf[j, \"d\"]); list(s = s, g = g, u = u, p = g + (u - g) * s) })",
  "  LL <- matrix(0, N, Q)",
  "  for (j in seq_along(P)) LL <- LL + M[, j] * (outer(X[, j], log(P[[j]]$p)) + outer(1 - X[, j], log(1 - P[[j]]$p)))",
  "  L <- exp(LL - apply(LL, 1, max)) * rep(w, each = N); post <- L / rowSums(L)",
  "  S <- sapply(seq_len(nrow(sv)), function(r) {",
  "    j <- match(sv$item[r], colnames(X)); q <- P[[j]]; ds <- q$s * (1 - q$s)",
  "    dp <- switch(sv$name[r], a1 = (q$u - q$g) * ds * z, d = (q$u - q$g) * ds, g = q$g * (1 - q$g) * (1 - q$s), u = q$u * (1 - q$u) * q$s)",
  "    res <- (outer(X[, j], rep(1, Q)) - rep(q$p, each = N)) / rep(q$p * (1 - q$p), each = N)",
  "    M[, j] * rowSums(post * res * rep(dp, each = N))",
  "  })",
  "  colnames(S) <- paste(sv$name, sv$parnum, sep = \".\")",
  "  V <- vcov(fit); S <- S[, colnames(V)]",
  "  V %*% crossprod(S) %*% V",
  "}")

PS_MIRT_MIXTURE <- c(
  "# The mixture 2PL model (EM to a change below 1e-5, up to 5000 cycles) from several starts, keeping the best log-likelihood: the first starts each class's",
  "# intercepts from k-means clusters of the response patterns, the others from mirt's random values.",
  "mirt_mixture <- function(items, k, nrep, quadpts) {",
  "  dentype <- sprintf(\"mixture-%d\", k)",
  "  sv <- multipleGroup(items, 1, dentype = dentype, pars = \"values\")",
  "  X <- as.matrix(items); X[is.na(X)] <- 0.5",
  "  cl <- stats::kmeans(X, k, nstart = 10)$cluster",
  "  for (c in seq_len(k)) for (j in colnames(items)) {",
  "    p <- mean(items[cl == c, j], na.rm = TRUE)",
  "    sv$value[sv$group == sprintf(\"MIXTURE_%d\", c) & sv$item == j & sv$name == \"d\"] <- qlogis(min(max(p, 0.02), 0.98))",
  "  }",
  "  # (each start's warnings are kept with it: only the best start's are reported)",
  "  one <- function(...) { w <- character(0); f <- tryCatch(withCallingHandlers(multipleGroup(items, 1, dentype = dentype, quadpts = quadpts, TOL = 1e-5,",
  "    technical = list(NCYCLES = 5000), verbose = FALSE, ...), warning = function(x) { w <<- c(w, conditionMessage(x)); invokeRestart(\"muffleWarning\") }), error = function(e) NULL)",
  "    if (!is.null(f)) attr(f, \"warn\") <- w; f }",
  "  fits <- c(list(one(pars = sv)), lapply(seq_len(nrep - 1), function(r) one(GenRandomPars = TRUE)))",
  "  fits <- Filter(Negate(is.null), fits)",
  "  if (!length(fits)) stop(\"No start of the mixture model converged.\")",
  "  best <- fits[[which.max(vapply(fits, logLik, 0))]]",
  "  for (w in attr(best, \"warn\")) warning(w, call. = FALSE)",
  "  best",
  "}")

ps_mirt <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  model <- req$model %||% "threepl"
  if (!model %in% c("threepl", "fourpl", "mixture")) stop("Invalid IRT model in the request.")
  items <- unlist(req$items)
  if (length(items) < 2) stop("Choose at least two items.")
  freq <- req$freq
  if (!is.null(freq) && (!is.character(freq) || length(freq) != 1 || freq %in% items)) stop("Invalid frequency column in the request.")
  fr <- ps_long_frame(req, c(items, freq))
  vi <- unname(fr$v[items])
  k <- req$quadrature %||% 61
  if (!(is.numeric(k) && length(k) == 1 && k == round(k) && k >= 5 && k <= 201)) stop("Choose between 5 and 201 quadrature points.")
  robust <- isTRUE(req$robust)
  if (robust && model == "mixture") stop("Robust standard errors are available for the 3PL and 4PL models.")
  prior <- function(p, what) {
    if (is.null(p)) return(NULL)
    p <- as.numeric(unlist(p))
    if (length(p) != 2 || !all(is.finite(p)) || p[2] <= 0) stop(sprintf("Invalid prior for the %s in the request.", what))
    p
  }
  pg <- prior(req$priorG, "lower asymptote"); pu <- prior(req$priorU, "upper asymptote")
  if (!is.null(pu) && model != "fourpl") stop("A prior on the upper asymptote needs the 4PL model.")
  if (!is.null(pg) && model == "mixture") stop("Priors are available for the 3PL and 4PL models.")
  guess <- unlist(req$guessItems)
  if (!is.null(guess) && (model != "threepl" || !all(guess %in% items))) stop("Invalid items with a guessing parameter in the request.")
  classes <- as.integer(req$classes %||% 2)
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (model == "mixture" && (classes < 2 || classes > 5 || nrep < 1 || nrep > 100)) stop("Choose between 2 and 5 classes.")
  types <- if (model == "fourpl") rep("4PL", length(items)) else if (model == "mixture") rep("2PL", length(items)) else ifelse(items %in% (guess %||% items), "3PL", "2PL")
  body <- c("suppressPackageStartupMessages(library(mirt))",
    sprintf("items <- data[, %s]", ps_q(vi)),
    if (!is.null(freq)) c("# Each row stands for as many respondents as its frequency (mirt's expand.table).",
      sprintf("items <- items[rep(seq_len(nrow(items)), data[[%s]]), , drop = FALSE]; rownames(items) <- NULL", encodeString(unname(fr$v[freq]), quote = '"'))),
    "# Binary items: the two observed values become 0 and 1 (lower = 0).",
    "items[] <- lapply(items, function(v) { u <- sort(unique(v[!is.na(v)])); if (length(u) != 2) stop('The 3PL, 4PL and mixture models need binary items.'); as.integer(v == u[2]) })")
  if (model == "mixture") {
    body <- c(body, PS_MIRT_MIXTURE,
      sprintf("# %d latent classes, each with its own loadings and thresholds (factor mean 0 and variance 1 in each); %d starts.", classes, nrep),
      sprintf("set.seed(%d)", seed),
      sprintf("fit <- mirt_mixture(items, %d, %d, %d)", classes, nrep, as.integer(k)))
  } else {
    pri <- c(if (!is.null(pg)) sprintf("sv$parnum[sv$name == \"g\" & sv$est], \"norm\", %s, %s", format(pg[1], digits = 15), format(pg[2], digits = 15)),
      if (!is.null(pu)) sprintf("sv$parnum[sv$name == \"u\" & sv$est], \"norm\", %s, %s", format(pu[1], digits = 15), format(pu[2], digits = 15)))
    body <- c(body,
      sprintf("itemtype <- %s", paste(deparse(types, width.cutoff = 500), collapse = "")),
      if (length(pri)) c("# Normal priors on the logits of the asymptotes (mirt stores g and u as logits; Mplus: MODEL PRIORS on u$2 = -logit(g), u$3 = -logit(u)).",
        "sv <- mirt(items, 1, itemtype = itemtype, pars = \"values\")",
        "pp <- function(at, ...) lapply(at, function(p) c(p, ...))",
        sprintf("prior <- c(%s)", paste(sprintf("pp(%s)", pri), collapse = ", "))),
      "# (EM to a change below 1e-6, up to 5000 cycles: mirt's default of 500 stops short on flat likelihoods)",
      sprintf("fit <- mirt(items, 1, itemtype = itemtype%s, quadpts = %d, TOL = 1e-6, technical = list(NCYCLES = 5000), SE = TRUE, verbose = FALSE)", if (length(pri)) ", parprior = prior" else "", as.integer(k)),
      "# Standard errors from the observed information (Oakes; with the priors).",
      "V <- vcov(fit)",
      if (robust) c(PS_MIRT_ROBUST, "V <- mirt_robust(fit, as.matrix(items))"))
  }
  inputs <- list(data = fr$data)
  if (export) return(ps_script(sprintf("Item response model (%s, mirt)", c(threepl = "3PL", fourpl = "4PL", mixture = "mixture 2PL")[[model]]), "mirt", inputs, body,
    c("fit", "coef(fit, IRTpars = TRUE, simplify = TRUE)", if (model != "mixture") "sqrt(diag(V))")))
  set.seed(seed)
  env <- ps_run(body, inputs)
  fit <- env$fit
  logit <- function(p) if (is.finite(p) && p > 0 && p < 1) qlogis(p) else NA_real_
  # Mplus's metric: loading a, threshold -d, u$2 = -logit(g), u$3 = -logit(u).
  rows <- function(cf, se, cls = NULL) unlist(lapply(rownames(cf), function(it) {
    s <- function(nm) { v <- se[[paste(it, nm)]]; if (is.null(v) || !is.finite(v)) NA_real_ else v }
    one <- function(parameter, est, sv) c(list(item = ps_back(it, fr$back, FALSE), parameter = parameter, est = est, se = sv), if (!is.null(cls)) list(class = cls))
    c(list(one("loading", unname(cf[it, "a1"]), s("a1")), one("threshold 1", -unname(cf[it, "d"]), s("d"))),
      if (types[match(it, vi)] %in% c("3PL", "4PL")) list(one("threshold 2 (lower asymptote)", -logit(cf[it, "g"]), s("g"))),
      if (model == "fourpl") list(one("threshold 3 (upper asymptote)", -logit(cf[it, "u"]), s("u"))))
  }), recursive = FALSE)
  irt <- function(cf, suffix = "") lapply(rownames(cf), function(it) list(item = paste0(ps_back(it, fr$back, FALSE), suffix),
    values = as.list(c(Dscrmn = unname(cf[it, "a"]), Dffclt = unname(cf[it, "b"]), if (types[match(it, vi)] %in% c("3PL", "4PL")) c(Gussng = unname(cf[it, "g"])), if (model == "fourpl") c(Upper = unname(cf[it, "u"]))))))
  classes_out <- NULL
  if (model == "mixture") {
    cfs <- coef(fit, IRTpars = FALSE, simplify = TRUE); irts <- coef(fit, IRTpars = TRUE, simplify = TRUE)
    shares <- vapply(cfs, function(x) as.numeric(unlist(x$class_proportion))[1], 0)
    ord <- order(-shares)  # classes by size
    coefficients <- unlist(lapply(seq_along(ord), function(c) rows(cfs[[ord[c]]]$items, list(), c)), recursive = FALSE)
    params <- unlist(lapply(seq_along(ord), function(c) irt(irts[[ord[c]]]$items, sprintf(" (class %d)", c))), recursive = FALSE)
    classes_out <- unname(shares[ord])
    theta <- numeric(0); info <- list(); rel <- NULL
  } else {
    cf <- coef(fit, IRTpars = FALSE, simplify = TRUE)$items
    V <- env$V; sv <- mod2values(fit); sv <- sv[sv$est & sv$item %in% rownames(cf), ]
    se <- setNames(as.list(sqrt(pmax(diag(V)[paste(sv$name, sv$parnum, sep = ".")], 0))), paste(sv$item, sv$name))
    coefficients <- rows(cf, se)
    params <- irt(coef(fit, IRTpars = TRUE, simplify = TRUE)$items)
    theta <- seq(-4, 4, by = 0.1)
    info <- lapply(seq_along(items), function(j) unname(as.numeric(iteminfo(extract.item(fit, j), matrix(theta)))))
    rel <- ps_try(unname(marginal_rxx(fit)), "Marginal reliability")
  }
  lp <- ps_try(unname(extract.mirt(fit, "logPrior")), "Log prior")
  ps_json(list(model = model, n = nrow(env$items), items = ps_back(vi, fr$back, FALSE),
    params = params, coefficients = coefficients, quadrature = as.integer(k), robust = robust,
    logLik = as.numeric(logLik(fit)), logPrior = if (length(pg) || length(pu)) lp else NULL, npar = extract.mirt(fit, "nest"),
    aic = extract.mirt(fit, "AIC"), bic = extract.mirt(fit, "BIC"), reliability = rel, classes = classes_out,
    theta = theta, information = info, itemFit = list(),
    warnings = env$.warnings, engine = ps_engine("mirt")))
}

# Multilevel latent class analysis with glca (Kim, Jeon, Chung & Lee): classes of people (within) whose
# shares differ between classes of clusters (between; Vermunt's nonparametric multilevel LCA, Mplus's
# TYPE = TWOLEVEL MIXTURE with a between-level class variable, as in its example 10.7). The item
# probabilities are equal across cluster classes.
ps_mlca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  items <- unlist(req$items)
  if (length(items) < 2) stop("Choose at least two items.")
  cluster <- req$cluster
  if (!is.character(cluster) || length(cluster) != 1 || cluster %in% items) stop("Choose the cluster column (not one of the items).")
  if (!is.null(req$aux)) stop("The three-step analysis of auxiliary variables is not available for multilevel latent classes.")
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 10)) stop("Choose between 1 and 10 classes.")
  w <- as.integer(req$clusterClasses %||% 2)
  if (length(w) != 1 || w < 1 || w > 10) stop("Choose between 1 and 10 classes of clusters.")
  nrep <- as.integer(req$nrep %||% 10); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of starts.")
  fr <- ps_long_frame(req, c(items, cluster))
  vi <- unname(fr$v[items]); vc <- unname(fr$v[cluster])
  f <- sprintf("item(%s) ~ 1", paste(vi, collapse = ", "))
  body <- c("suppressPackageStartupMessages(library(glca))",
    sprintf("d <- data[, %s]", ps_q(c(vi, vc))),
    sprintf("d <- d[!is.na(d[[%s]]), , drop = FALSE]  # (a person without a cluster is left out)", encodeString(vc, quote = '"')),
    sprintf("for (v in %s) d[[v]] <- as.integer(factor(d[[v]]))  # glca needs categories 1, 2, ...", ps_q(vi)),
    sprintf("# %s classes of people within %d classes of clusters; %d random starts each (glca keeps the best).", paste(ks, collapse = ", "), w, nrep),
    sprintf("fits <- lapply(%s, function(k) glca(%s, group = %s, data = d, nclass = k, ncluster = %d, n.init = %d, seed = %d, verbose = FALSE))",
      paste(deparse(ks), collapse = ""), f, vc, w, nrep, seed))
  inputs <- list(data = fr$data)
  if (export) return(ps_script("Multilevel latent class analysis (glca)", "glca", inputs, body,
    c("lapply(fits, summary)")))
  env <- ps_run(body, inputs)
  models <- lapply(env$fits, function(m) {
    delta <- as.numeric(m$param$delta); gamma <- matrix(m$param$gamma, nrow = length(delta))
    shares <- as.numeric(delta %*% gamma)
    ord <- order(-shares); cord <- order(-delta)  # classes and cluster classes by size
    list(k = ncol(gamma), llik = m$gof$loglik, npar = m$model$npar, aic = m$gof$AIC, bic = m$gof$BIC, gsq = m$gof$Gsq, entropy = m$gof$entropy,
      shares = shares[ord],
      probs = lapply(seq_along(vi), function(i) list(item = ps_back(vi[i], fr$back, FALSE),
        categories = levels(factor(fr$data[[vi[i]]])),
        byClass = lapply(ord, function(c) unname(m$param$rho[[i]][c, ])))),
      clusters = list(shares = delta[cord], byCluster = lapply(cord, function(b) unname(gamma[b, ord]))))
  })
  ps_json(list(n = nrow(env$d), clusters = length(unique(env$d[[vc]])), items = ps_back(vi, fr$back, FALSE), models = models, cluster = cluster, clusterClasses = w,
    warnings = env$.warnings, engine = ps_engine("glca")))
}
