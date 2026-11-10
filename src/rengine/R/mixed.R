# Mixed (multilevel) models: linear mixed models with random intercepts and
# slopes for observed variables (lme4, Bates et al. 2015; Satterthwaite
# degrees of freedom by lmerTest, Kuznetsova et al. 2017), and growth mixture
# models (latent class linear mixed models, lcmm::hlme; Proust-Lima et al. 2017).

#' Linear mixed model: outcome on predictors, clustered, with random intercepts
#' and optional random slopes; within / between decomposition on request.
ps_lmm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  # Wide repeated measures, several outcomes, more cluster levels, interaction terms, uncorrelated slopes, a residual
  # variance per occasion or robust standard errors: the general version below (nlme where lme4 cannot).
  if (!is.null(req$repeated) || length(req$outcomes) || length(req$levels) || length(req$independent) || length(req$interactions) || !is.null(req$residuals) || !is.null(req$se))
    return(ps_lmm_ext(req, export))
  y <- req$outcome; xs <- unlist(req$predictors); cl <- req$cluster; slopes <- unlist(req$slopes)
  if (!length(y) || !length(cl)) stop("Choose an outcome and a cluster column.")
  if (y %in% c(xs, cl) || cl %in% xs) stop("The outcome, predictors and cluster column must be different columns.")
  if (!all(slopes %in% xs)) stop("Random slopes need predictors in the model.")
  center <- req$center %||% "none"
  if (!center %in% c("none", "grand", "cluster")) stop("Invalid centring in the request.")
  reml <- !identical(req$estimation, "ML")
  fr <- ps_long_frame(req, c(y, xs, cl))
  v <- fr$v; Y <- v[[y]]; C <- v[[cl]]; X <- unname(v[xs]); S <- unname(v[slopes])
  # Cluster means of the predictors (between effects), named <x>_cm.
  cm <- if (center == "cluster" && length(X)) ps_ident(c(unname(v), paste0(X, "_cm")))[length(v) + seq_along(X)] else character(0)
  fixed <- c(X, cm)
  rhs <- if (length(fixed)) paste(fixed, collapse = " + ") else "1"
  ran <- sprintf("(%s | %s)", if (length(S)) paste(c("1", S), collapse = " + ") else "1", C)
  f_full <- sprintf("%s ~ %s + %s", Y, rhs, ran)
  body <- c("suppressPackageStartupMessages(library(lmerTest))  # lme4 with Satterthwaite degrees of freedom",
    "# Cases complete on the model's variables.",
    sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(Y, X, C))),
    if (center == "grand" && length(X)) c("# Predictors centred at their grand mean.",
      sprintf("data$%s <- data$%s - mean(data$%s)", X, X, X)),
    if (center == "cluster" && length(X)) c("# Within / between: each predictor split into its cluster mean (between) and the deviation from it (within).",
      sprintf("data$%s <- ave(data$%s, data$%s)", cm, X, C), sprintf("data$%s <- data$%s - data$%s", X, X, cm)),
    "# Intraclass correlation from the model without predictors.",
    sprintf("null <- lmer(%s ~ 1 + (1 | %s), data = data, REML = %s)", Y, C, reml),
    "vc0 <- as.data.frame(VarCorr(null)); icc <- vc0$vcov[1] / sum(vc0$vcov)",
    sprintf("fit <- lmer(%s, data = data, REML = %s)", f_full, reml),
    "coefs <- summary(fit)$coefficients  # estimate, SE, df (Satterthwaite), t, p",
    "ci <- confint(fit, parm = \"beta_\", method = \"Wald\")",
    if (length(S)) c("# Do the random slopes improve the model? (Variances on the boundary: conservative test.)",
      sprintf("fit_ri <- lmer(%s ~ %s + (1 | %s), data = data, REML = %s)", Y, rhs, C, reml),
      "slope_test <- anova(fit_ri, fit, refit = FALSE)"),
    "# R-squared (Nakagawa & Schielzeth 2013; random slopes: Johnson 2014): fixed effects (marginal), fixed + random (conditional).",
    "vf <- var(as.vector(model.matrix(fit) %*% fixef(fit)))",
    sprintf("Zr <- model.matrix(~ %s, data = data); Sg <- VarCorr(fit)[[1]]", if (length(S)) paste(S, collapse = " + ") else "1"),
    "vr <- mean(rowSums((Zr %*% Sg) * Zr)); ve <- sigma(fit)^2",
    "r2 <- c(marginal = vf / (vf + vr + ve), conditional = (vf + vr) / (vf + vr + ve))")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Multilevel regression (lme4%s)", if (length(S)) ", random slopes" else ""), c("lme4", "lmerTest"), inputs, body,
    c("summary(fit)", "icc", "r2", if (length(S)) "slope_test")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  nm <- function(x) {
    out <- ps_back(x, fr$back)
    at <- match(x, cm); out[!is.na(at)] <- paste0(xs[at[!is.na(at)]], " (cluster mean)")
    unname(ifelse(x == "(Intercept)", "Intercept", out))
  }
  co <- env$coefs; ci <- env$ci
  vc <- as.data.frame(lme4::VarCorr(fit))
  focal <- if (length(S)) S[1] else if (length(X)) X[1] else NULL
  cc <- stats::coef(fit)[[1]]
  st <- env$slope_test
  ps_json(list(n = nrow(env$data), clusters = length(unique(env$data[[C]])), reml = reml, icc = env$icc,
    fixed = lapply(seq_len(nrow(co)), function(i) list(term = nm(rownames(co)[i]), est = co[i, 1], se = co[i, 2], df = co[i, 3], t = co[i, 4], p = co[i, 5],
      ciLow = ci[rownames(co)[i], 1], ciHigh = ci[rownames(co)[i], 2])),
    random = lapply(seq_len(nrow(vc)), function(i) list(group = if (vc$grp[i] == "Residual") "Residual" else nm(vc$grp[i]),
      a = if (is.na(vc$var1[i])) NULL else nm(vc$var1[i]), b = if (is.na(vc$var2[i])) NULL else nm(vc$var2[i]), variance = vc$vcov[i], sd = vc$sdcor[i])),
    r2 = as.list(env$r2), logLik = as.numeric(stats::logLik(fit)), aic = stats::AIC(fit), bic = stats::BIC(fit), singular = lme4::isSingular(fit),
    slopeTest = if (is.null(st)) NULL else list(chisq = st$Chisq[2], df = st$Df[2], p = st$`Pr(>Chisq)`[2]),
    # Cluster-specific lines of the focal predictor (other predictors at 0), for the chart.
    lines = if (is.null(focal)) NULL else list(predictor = nm(focal), range = range(env$data[[focal]]),
      intercepts = unname(cc[, "(Intercept)"]), slopes = unname(cc[, focal]),
      fixed = c(unname(lme4::fixef(fit)["(Intercept)"]), unname(lme4::fixef(fit)[focal]))),
    warnings = env$.warnings, engine = list(package = "lme4", version = as.character(utils::packageVersion("lme4")))))
}

# ---- Multilevel regression: wide repeated measures, several outcomes, more cluster levels, MLR ----
# The script functions: the covariance matrices of a fit (lme4 or nlme) as blocks, and the marginal likelihood
# written with them (V = Z G Z' within each unit of each level, plus the residual variances), whose scores and
# observed information give Mplus's MLR standard errors: the sandwich over the top-level clusters, with every
# parameter as Mplus has it (fixed effects, variances, covariances).
PS_LMM_FUNCTIONS <- strsplit(r"---(# The random effects of a fit as blocks: grouping (unit ids), columns Z, covariance matrix G, covariances free
# (symm) or zero (diag); the residual variances last, one per group of rows (nlme's varIdent).
lmm_blocks <- function(fit, d, resid_by = NULL) {
  zmat <- function(nms) do.call(cbind, lapply(nms, function(nm) if (nm == "(Intercept)") rep(1, nrow(d)) else as.numeric(d[[nm]])))
  if (inherits(fit, "merMod")) {
    cn <- lme4::getME(fit, "cnms"); vc <- lme4::VarCorr(fit)
    out <- lapply(seq_along(cn), function(i) list(level = names(cn)[i], f = d[[names(cn)[i]]], Z = zmat(cn[[i]]), names = cn[[i]],
      G = unname(as.matrix(vc[[i]])), type = if (length(cn[[i]]) > 1) "symm" else "diag"))
    return(c(out, list(list(level = "Residual", f = seq_len(nrow(d)), Z = matrix(1, nrow(d)), names = "Residual", G = matrix(stats::sigma(fit)^2), type = "diag"))))
  }
  s2 <- fit$sigma^2; re <- fit$modelStruct$reStruct; out <- list()
  for (g in names(re)) {
    pd <- re[[g]]
    for (p in if (inherits(pd, "pdBlocked")) lapply(seq_along(pd), function(k) pd[[k]]) else list(pd)) {
      G <- as.matrix(p) * s2; nms <- rownames(G)
      out[[length(out) + 1]] <- list(level = g, f = d[[g]], Z = zmat(nms), names = nms, G = unname(G), type = if (inherits(p, "pdDiag")) "diag" else "symm")
    }
  }
  vs <- fit$modelStruct$varStruct
  res <- if (is.null(vs)) list(level = "Residual", f = seq_len(nrow(d)), Z = matrix(1, nrow(d)), names = "Residual", G = matrix(s2), type = "diag") else {
    gr <- attr(vs, "groupNames"); w <- stats::coef(vs, unconstrained = FALSE, allCoef = TRUE)[gr]
    list(level = "Residual", f = seq_len(nrow(d)), Z = sapply(gr, function(x) as.numeric(as.character(d[[resid_by]]) == x)), names = gr, G = diag(s2 * w^2, length(gr)), type = "diag")
  }
  c(out, list(res))
}
# Log-likelihood, scores (per top-level cluster) and observed information of the fixed effects and the covariance parameters.
mlr_info <- function(y, X, beta, top, blocks) {
  th <- do.call(rbind, lapply(seq_along(blocks), function(b) { q <- ncol(blocks[[b]]$Z)
    ix <- which(lower.tri(diag(q), diag = TRUE), arr.ind = TRUE); if (blocks[[b]]$type == "diag") ix <- ix[ix[, 1] == ix[, 2], , drop = FALSE]
    cbind(b = b, u = ix[, 1], v = ix[, 2]) }))
  p <- ncol(X); K <- nrow(th); np <- p + K
  est <- c(beta, mapply(function(b, u, v) blocks[[b]]$G[u, v], th[, "b"], th[, "u"], th[, "v"]))
  names(est) <- c(names(beta), mapply(function(b, u, v) { B <- blocks[[b]]; paste0(B$level, ": ", if (u == v) B$names[u] else paste(B$names[v], "with", B$names[u])) }, th[, "b"], th[, "u"], th[, "v"]))
  # Each covariance parameter's derivative of V is a sum of terms A B' (A, B: one column of a block's Z, per unit).
  co <- unique(rbind(th[, c("b", "u")], `colnames<-`(th[, c("b", "v")], c("b", "u"))))
  cid <- function(b, u) which(co[, 1] == b & co[, 2] == u)
  terms <- lapply(seq_len(K), function(k) { a <- cid(th[k, "b"], th[k, "u"]); c2 <- cid(th[k, "b"], th[k, "v"]); if (a == c2) list(c(a, a)) else list(c(a, c2), c(c2, a)) })
  H <- matrix(0, np, np); tops <- split(seq_along(top), factor(top, levels = unique(top))); S <- matrix(0, length(tops), np); ll <- 0
  for (j in seq_along(tops)) {
    r <- tops[[j]]; n <- length(r); Xj <- X[r, , drop = FALSE]
    V <- matrix(0, n, n)
    for (B in blocks) { f <- B$f[r]; Z <- B$Z[r, , drop = FALSE]; V <- V + outer(f, f, "==") * (Z %*% B$G %*% t(Z)) }
    R <- chol(V); Vi <- chol2inv(R)
    e <- as.vector(y[r] - Xj %*% beta); w <- as.vector(Vi %*% e)
    ll <- ll - sum(log(diag(R))) - 0.5 * sum(e * w) - 0.5 * n * log(2 * pi)
    cols <- lapply(seq_len(nrow(co)), function(i) { B <- blocks[[co[i, 1]]]; z <- B$Z[r, co[i, 2]]; nz <- which(z != 0)
      list(rows = nz, f = match(B$f[r][nz], unique(B$f[r][nz])), z = z[nz]) })
    Aw <- lapply(cols, function(cc) as.vector(rowsum(w[cc$rows] * cc$z, cc$f, reorder = FALSE)))
    Q <- lapply(cols, function(cc) t(rowsum(t(Vi[, cc$rows, drop = FALSE]) * cc$z, cc$f, reorder = FALSE)))
    XA <- lapply(Q, function(q) crossprod(Xj, q))
    Tc <- list(); Tm <- function(b, a) { k <- paste(b, a); if (is.null(Tc[[k]])) { cb <- cols[[b]]; Tc[[k]] <<- rowsum(Q[[a]][cb$rows, , drop = FALSE] * cb$z, cb$f, reorder = FALSE) }; Tc[[k]] }
    S[j, ] <- c(crossprod(Xj, w), vapply(terms, function(tk) sum(vapply(tk, function(t) -0.5 * sum(diag(Tm(t[2], t[1]))) + 0.5 * sum(Aw[[t[1]]] * Aw[[t[2]]]), 0)), 0))
    Hj <- matrix(0, np, np); Hj[1:p, 1:p] <- -crossprod(Xj, Vi %*% Xj)
    for (k in seq_len(K)) {
      Hj[1:p, p + k] <- Hj[p + k, 1:p] <- -Reduce(`+`, lapply(terms[[k]], function(t) XA[[t[1]]] %*% Aw[[t[2]]]))
      for (l in seq_len(k)) {
        v <- 0
        for (t in terms[[k]]) for (s in terms[[l]]) { T1 <- Tm(t[2], s[1]); v <- v + 0.5 * sum(T1 * t(Tm(s[2], t[1]))) - sum(Aw[[t[1]]] * (T1 %*% Aw[[s[2]]])) }
        Hj[p + k, p + l] <- Hj[p + l, p + k] <- v
      }
    }
    H <- H + Hj
  }
  list(est = est, th = th, ll = ll, score = colSums(S), scores = S, H = H)
}
# Mplus's MLR: the estimates at the maximum (Newton steps from the package's solution while the scores are not
# yet zero), the model-based standard errors from the observed information, the robust ones from the sandwich.
mlr_fit <- function(y, X, beta, top, blocks, steps = 5) {
  put <- function(blocks, th, v) { for (k in seq_len(nrow(th))) { b <- th[k, 1]; u <- th[k, 2]; w <- th[k, 3]; blocks[[b]]$G[u, w] <- blocks[[b]]$G[w, u] <- v[k] }; blocks }
  m <- mlr_info(y, X, beta, top, blocks); ll0 <- m$ll; n <- 0
  while (n < steps && max(abs(m$score)) > 1e-4) {
    step <- tryCatch(solve(-m$H, m$score), error = function(e) NULL); if (is.null(step)) break
    better <- NULL
    for (h in 2^-(0:5)) { v <- m$est + h * step
      t2 <- tryCatch(mlr_info(y, X, v[seq_len(ncol(X))], top, put(blocks, m$th, v[-seq_len(ncol(X))])), error = function(e) NULL)
      if (!is.null(t2) && t2$ll >= m$ll - 1e-9) { better <- list(m = t2, beta = v[seq_len(ncol(X))], blocks = put(blocks, m$th, v[-seq_len(ncol(X))])); break } }
    if (is.null(better)) break
    m <- better$m; beta <- better$beta; blocks <- better$blocks; n <- n + 1
  }
  Ii <- solve(-m$H)
  list(est = m$est, beta = beta, blocks = blocks, th = m$th, ll = m$ll, gain = m$ll - ll0, steps = n, clusters = nrow(m$scores),
    model = sqrt(diag(Ii)), robust = sqrt(diag(Ii %*% crossprod(m$scores) %*% Ii)))
}
# R-squared (Nakagawa & Schielzeth 2013; Johnson 2014): the variance of the fixed part, the mean variance of the
# random effects and of the residuals over the rows.
lmm_r2 <- function(X, beta, blocks) {
  vf <- stats::var(as.vector(X %*% beta))
  part <- vapply(blocks, function(B) mean(rowSums((B$Z %*% B$G) * B$Z)), 0)
  res <- vapply(blocks, function(B) identical(B$level, "Residual"), TRUE)
  vr <- sum(part[!res]); ve <- sum(part[res])
  c(marginal = vf / (vf + vr + ve), conditional = (vf + vr) / (vf + vr + ve))
})---", "\n")[[1]]

ps_lmm_ext <- function(req, export) {
  str <- function(x) as.character(x %||% "")
  y <- str(req$outcome); xs <- as.character(unlist(req$predictors)); cl <- str(req$cluster)
  slopes <- as.character(unlist(req$slopes)); indep <- as.character(unlist(req$independent))
  # (equally long terms arrive as a matrix, one term per row)
  ints <- if (is.matrix(req$interactions)) lapply(seq_len(nrow(req$interactions)), function(i) as.character(req$interactions[i, ])) else lapply(req$interactions %||% list(), function(t) as.character(unlist(t)))
  lv <- lapply(req$levels %||% list(), function(l) list(cluster = str(l$cluster), slopes = as.character(unlist(l$slopes)), occasions = isTRUE(l$occasions)))
  outs <- lapply(req$outcomes %||% list(), function(o) list(outcome = str(o$outcome), predictors = as.character(unlist(o$predictors)), slopes = as.character(unlist(o$slopes))))
  rp <- req$repeated; wide <- !is.null(rp); stacked <- length(outs) > 0
  center <- req$center %||% "none"
  if (!center %in% c("none", "grand", "cluster")) stop("Invalid centring in the request.")
  reml <- !identical(req$estimation, "ML")
  se <- req$se %||% "model"; if (!se %in% c("model", "robust")) stop("Invalid standard errors in the request.")
  robust <- se == "robust"
  resid <- req$residuals %||% "equal"; if (!resid %in% c("equal", "occasion")) stop("Invalid residual variances in the request.")
  if (robust && reml) stop("Robust standard errors (Mplus's MLR) go with ML estimation.")
  if (wide && stacked) stop("Repeated measures in columns and several outcomes are alternatives.")
  if (center != "none" && (wide || stacked || length(lv))) stop("Centring is available with one row per observation and one cluster level; centre the predictors as computed columns.")
  if (resid == "occasion" && !wide) stop("A residual variance per occasion needs repeated measures in columns.")
  if (any(vapply(lv, function(l) l$occasions, TRUE)) && !wide) stop("A variance per occasion at a cluster level needs repeated measures in columns.")
  if (stacked && (length(lv) || length(ints))) stop("Several outcomes are modelled with one cluster level and without interaction terms (add products as computed columns).")
  if (!nzchar(y)) stop("Choose the outcome.")
  if (!wide && !nzchar(cl)) stop("Choose the cluster column.")
  if (wide && nzchar(cl)) stop("With repeated measures in columns each row is a person: clusters of persons are a level above.")
  for (t in ints) if (length(t) < 2) stop("An interaction term needs two or more variables.")
  # The variables: data columns, and the names the long data create (outcome, time, time-varying covariates).
  created <- character(0); ms <- character(0); times <- numeric(0); tname <- ""; vary <- list()
  if (wide) {
    ms <- as.character(unlist(rp$measures)); times <- as.numeric(unlist(rp$times)); tname <- str(rp$time %||% "time")
    vary <- lapply(rp$varying %||% list(), function(v) list(name = str(v$name), columns = as.character(unlist(v$columns))))
    if (length(ms) < 2) stop("Repeated measures need two or more occasions.")
    if (length(times) != length(ms) || any(!is.finite(times))) stop("Give one time score per occasion.")
    for (v in vary) if (length(v$columns) != length(ms)) stop(sprintf("The time-varying covariate %s needs one column per occasion.", v$name))
    created <- c(y, tname, vapply(vary, `[[`, "", "name"))
    if (anyDuplicated(created) || any(!nzchar(created))) stop("The outcome, the time and the time-varying covariates need different names.")
  }
  if (stacked) {
    created <- character(0)
    for (o in outs) if (!nzchar(o$outcome)) stop("Choose every outcome.")
  }
  allout <- if (stacked) c(list(list(outcome = y, predictors = xs, slopes = slopes)), outs) else NULL
  lv_cols <- vapply(lv, `[[`, "", "cluster")
  if (any(!nzchar(lv_cols))) stop("Choose the cluster column of every level.")
  cols <- unique(c(if (wide) c(ms, unlist(lapply(vary, `[[`, "columns"))) else y,
    if (stacked) unlist(lapply(allout, function(o) c(o$outcome, o$predictors))),
    setdiff(c(xs, unlist(ints)), created), if (nzchar(cl)) cl, lv_cols))
  if (any(created %in% cols)) stop("The outcome, time and time-varying covariates of the long data need names that are not columns in the model.")
  for (s in c(slopes, unlist(lapply(lv, `[[`, "slopes")))) if (!s %in% c(xs, if (stacked) unlist(lapply(outs, `[[`, "predictors")))) stop("Random slopes need predictors in the model.")
  if (stacked) for (o in allout) if (!all(o$slopes %in% o$predictors)) stop("Random slopes need predictors of their outcome.")
  if (!stacked && y %in% c(xs, cl, lv_cols)) stop("The outcome, predictors and cluster columns must be different columns.")
  if (any(c(cl, lv_cols) %in% c(xs, unlist(ints))) || anyDuplicated(c(if (nzchar(cl)) cl, lv_cols))) stop("The outcome, predictors and cluster columns must be different columns.")
  fr <- ps_long_frame(req, cols)
  id_of <- c(fr$v)
  fresh <- function(x) { v <- ps_ident(c(unname(id_of), x))[length(id_of) + seq_along(x)]; id_of[x] <<- v; v }
  # ---- the long data ----
  occ <- character(0); occ_name <- character(0)
  if (wide) {
    ids <- fresh(c(created, ".person", ".occasion"))
    Yi <- ids[1]; Ti <- ids[2]; Vi_ <- ids[2 + seq_along(vary)]; Pi <- ids[length(ids) - 1]; Oi <- ids[length(ids)]
    keep <- setdiff(cols, c(ms, unlist(lapply(vary, `[[`, "columns"))))
    prep <- c("# Repeated measures in columns: one row per person and occasion (wide to long).",
      sprintf("times <- %s", paste(deparse(times), collapse = "")),
      sprintf("measures <- %s", ps_q(fr$v[ms])),
      vapply(seq_along(vary), function(k) sprintf("%s_cols <- %s", Vi_[k], ps_q(fr$v[vary[[k]]$columns])), ""),
      "long <- do.call(rbind, lapply(seq_along(times), function(t) data.frame(",
      sprintf("  %s = seq_len(nrow(data)), %s = t, %s = times[t], %s = data[[measures[t]]]%s%s)))", Pi, Oi, Ti, Yi,
        paste(vapply(seq_along(vary), function(k) sprintf(", %s = data[[%s_cols[t]]]", Vi_[k], Vi_[k]), ""), collapse = ""),
        paste(vapply(keep, function(x) sprintf(", %s = data$%s", fr$v[[x]], fr$v[[x]]), ""), collapse = "")),
      sprintf("long <- long[order(long$%s, long$%s), ]", Pi, Oi))
    if (resid == "occasion" || any(vapply(lv, function(l) l$occasions, TRUE))) {
      occ <- fresh(paste0(".occ", seq_along(ms))); occ_name <- ms
      prep <- c(prep, "# Occasion indicators (a variance per occasion)", sprintf("long$%s <- as.numeric(long$%s == %d)", occ, Oi, seq_along(ms)))
    }
    y_id <- Yi
  } else if (stacked) {
    ids <- fresh(c(".case", ".outcome", ".y")); Ci <- ids[1]; Oi <- ids[2]; Yi <- ids[3]
    # One intercept column and one column per predictor of each outcome (the predictor on that outcome's rows, 0 elsewhere).
    tcol <- lapply(allout, function(o) fresh(paste(o$outcome, c("Intercept", o$predictors), sep = "_")))
    tdisp <- unlist(lapply(allout, function(o) paste0(o$outcome, ": ", c("Intercept", o$predictors))))
    names(tdisp) <- unlist(tcol)
    rows <- vapply(seq_along(allout), function(k) {
      o <- allout[[k]]
      vals <- unlist(lapply(seq_along(allout), function(m) { om <- allout[[m]]
        if (m != k) rep("0", 1 + length(om$predictors)) else c("1", sprintf("data$%s", fr$v[om$predictors])) }))
      sprintf("  data.frame(%s = seq_len(nrow(data)), %s = data$%s, %s = %d, %s = data$%s, %s)", Ci, fr$v[[cl]], fr$v[[cl]], Oi, k, Yi, fr$v[[o$outcome]],
        paste(sprintf("%s = %s", unlist(tcol), vals), collapse = ", "))
    }, "")
    prep <- c("# Outcomes stacked: one row per case and outcome. Each outcome has its own intercept and effects: the column",
      "# <outcome>_<predictor> is the predictor on that outcome's rows and 0 on the others.",
      "long <- rbind(", paste0(rows, c(rep(",", length(rows) - 1), "")), ")",
      sprintf("long <- long[order(long$%s, long$%s, long$%s), ]", fr$v[[cl]], Ci, Oi))
    y_id <- Yi
  } else {
    prep <- "long <- data"
    y_id <- fr$v[[y]]
  }
  idv <- function(x) unname(id_of[x])
  # ---- the levels, lowest first: units nested in the units above (unique ids) ----
  base <- if (wide) list(col = Pi, name = "Person", slopes = slopes, occasions = FALSE) else list(col = fr$v[[cl]], name = cl, slopes = if (stacked) NULL else slopes, occasions = FALSE)
  levs <- c(list(base), lapply(lv, function(l) list(col = fr$v[[l$cluster]], name = l$cluster, slopes = l$slopes, occasions = l$occasions)))
  H <- length(levs)
  gid <- fresh(paste0(".level", seq_len(H)))
  nest <- c(if (H > 0) vapply(rev(seq_len(H)), function(h) if (h == H) sprintf("long$%s <- long$%s", gid[h], levs[[h]]$col)
    else sprintf("long$%s <- as.integer(factor(paste(%s)))", gid[h], paste(sprintf("long$%s", vapply(levs[h:H], `[[`, "", "col")), collapse = ", ")), ""))
  # ---- fixed and random terms ----
  cm <- character(0)
  if (stacked) {
    fixed <- c("0", unlist(tcol))
  } else {
    if (center == "cluster" && length(xs)) cm <- fresh(paste0(xs, "_cm"))
    fixed <- c(idv(xs), cm, vapply(ints, function(t) paste(idv(t), collapse = ":"), ""))
    if (!length(fixed)) fixed <- "1"
  }
  term_ids <- function(h) {
    L <- levs[[h]]
    if (stacked && h == 1) {
      sl <- unlist(lapply(seq_along(allout), function(k) { o <- allout[[k]]; tcol[[k]][1 + match(o$slopes, o$predictors)] }))
      pr <- unlist(lapply(seq_along(allout), function(k) { o <- allout[[k]]; o$slopes }))
      list(corr = c(vapply(tcol, `[`, "", 1), sl[!pr %in% indep]), ind = sl[pr %in% indep], int = FALSE)
    } else list(corr = idv(L$slopes[!L$slopes %in% indep]), ind = idv(L$slopes[L$slopes %in% indep]), int = TRUE)
  }
  nlme <- stacked || resid == "occasion" || any(vapply(levs, function(l) isTRUE(l$occasions), TRUE))
  if (nlme) {
    pd <- vapply(rev(seq_len(H)), function(h) {
      t <- term_ids(h)
      parts <- c(sprintf("pdSymm(~ %s)", paste(c(if (t$int) "1" else "0", t$corr), collapse = " + ")),
        if (length(t$ind)) sprintf("pdDiag(~ 0 + %s)", paste(t$ind, collapse = " + ")),
        if (isTRUE(levs[[h]]$occasions)) sprintf("pdDiag(~ 0 + %s)", paste(occ, collapse = " + ")))
      sprintf("%s = %s", gid[h], if (length(parts) == 1) parts else sprintf("pdBlocked(list(%s))", paste(parts, collapse = ", ")))
    }, "")
    wts <- if (stacked) Oi else if (resid == "occasion") Oi else NULL
    call <- sprintf("fit <- lme(%s ~ %s, random = list(%s)%s, data = long, method = \"%s\", control = lmeControl(maxIter = 500, msMaxIter = 500, msMaxEval = 2000))",
      y_id, paste(fixed, collapse = " + "), paste(pd, collapse = ", "), if (!is.null(wts)) sprintf(", weights = varIdent(form = ~ 1 | %s)", wts) else "", if (reml) "REML" else "ML")
  } else {
    ran <- unlist(lapply(seq_len(H), function(h) { t <- term_ids(h)
      c(sprintf("(%s | %s)", paste(c("1", t$corr), collapse = " + "), gid[h]), vapply(t$ind, function(s) sprintf("(0 + %s | %s)", s, gid[h]), "")) }))
    call <- sprintf("fit <- lmer(%s ~ %s + %s, data = long, REML = %s)", y_id, paste(fixed, collapse = " + "), paste(ran, collapse = " + "), reml)
  }
  model_vars <- unique(c(y_id, if (stacked) unlist(tcol) else idv(c(xs, unlist(ints))), vapply(levs, `[[`, "", "col")))
  wts_col <- if (nlme && (stacked || resid == "occasion")) Oi else NULL
  top <- gid[H]
  xform <- sprintf("~ %s", paste(fixed, collapse = " + "))
  body <- c(if (nlme) "suppressPackageStartupMessages(library(nlme))  # linear mixed models with variance functions and blocked covariance matrices"
      else "suppressPackageStartupMessages(library(lmerTest))  # lme4 with Satterthwaite degrees of freedom",
    PS_LMM_FUNCTIONS, prep,
    "# Rows complete on the model's variables.",
    sprintf("long <- long[complete.cases(long[, %s]), ]", ps_q(model_vars)),
    if (center == "grand" && length(xs)) c("# Predictors centred at their grand mean.", sprintf("long$%s <- long$%s - mean(long$%s)", idv(xs), idv(xs), idv(xs))),
    if (length(cm)) c("# Within / between: each predictor split into its cluster mean (between) and the deviation from it (within).",
      sprintf("long$%s <- ave(long$%s, long$%s)", cm, idv(xs), fr$v[[cl]]), sprintf("long$%s <- long$%s - long$%s", idv(xs), idv(xs), cm)),
    if (H > 0) c("# Units of each level, nested in those above (unique ids).", nest),
    if (!stacked && !wide && H == 1) c("# Intraclass correlation from the model without predictors.",
      sprintf("null <- lmer(%s ~ 1 + (1 | %s), data = long, REML = %s)", y_id, gid[1], reml),
      "vc0 <- as.data.frame(VarCorr(null)); icc <- vc0$vcov[1] / sum(vc0$vcov)"),
    call,
    if (nlme) "coefs <- summary(fit)$tTable  # estimate, SE, df, t, p" else c("coefs <- summary(fit)$coefficients  # estimate, SE, df (Satterthwaite), t, p",
      "ci <- confint(fit, parm = \"beta_\", method = \"Wald\")"),
    sprintf("X <- model.matrix(%s, long); beta <- %s", xform, if (nlme) "nlme::fixef(fit)" else "lme4::fixef(fit)"),
    sprintf("blocks <- lmm_blocks(fit, long%s)", if (!is.null(wts_col)) sprintf(", \"%s\"", wts_col) else ""),
    if (robust) c("# Mplus's MLR: robust standard errors (sandwich over the top-level clusters) of every parameter.",
      sprintf("mlr <- mlr_fit(long$%s, X, beta, long$%s, blocks)", y_id, top),
      "beta <- mlr$beta; blocks <- mlr$blocks"),
    if (!stacked) "r2 <- lmm_r2(X, beta, blocks)")
  inputs <- list(data = fr$data)
  pkg <- if (nlme) "nlme" else "lme4"
  if (export) return(paste(ps_script(sprintf("Multilevel regression (%s)", pkg), if (nlme) "nlme" else c("lme4", "lmerTest"), inputs, body,
    c("summary(fit)", if (robust) "data.frame(estimate = mlr$est, se_model = mlr$model, se_mlr = mlr$robust)  # every parameter, Mplus's MLR standard errors", if (!stacked) "r2")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit; d <- env$long
  # Display names: the variables, created columns, cluster levels.
  back <- c(setNames(names(id_of), unname(id_of)))
  disp <- function(x) {
    out <- x
    for (i in seq_along(x)) {
      v <- x[i]
      out[i] <- if (v == "(Intercept)") "Intercept"
        else if (stacked && v %in% names(tdisp)) tdisp[[v]]
        else if (v %in% occ) occ_name[match(v, occ)]
        else if (v %in% cm) paste0(back[[xs[match(v, cm)]]] %||% v, " (cluster mean)")
        else if (grepl(":", v, fixed = TRUE)) ps_back_term(v, back)
        else ps_back(v, back)
    }
    unname(out)
  }
  lev_name <- setNames(vapply(levs, `[[`, "", "name"), gid)
  co <- env$coefs; beta <- env$beta; blocks <- env$blocks
  mlr <- env$mlr; p <- length(beta)
  fixed_out <- lapply(seq_len(p), function(i) {
    est <- unname(beta[i])
    if (robust) { s <- mlr$robust[i]; z <- est / s
      list(term = disp(names(beta)[i]), est = est, se = s, df = NULL, t = z, p = 2 * stats::pnorm(-abs(z)), ciLow = est - stats::qnorm(0.975) * s, ciHigh = est + stats::qnorm(0.975) * s)
    } else {
      s <- co[i, 2]; df <- co[i, 3]
      ci <- if (nlme) est + c(-1, 1) * stats::qt(0.975, df) * s else env$ci[rownames(co)[i], ]
      list(term = disp(rownames(co)[i]), est = est, se = s, df = df, t = co[i, 4], p = co[i, 5], ciLow = ci[1], ciHigh = ci[2])
    }
  })
  # Variance components: higher levels first, the residual last; standard errors (MLR) where computed.
  th_se <- function(b, u, v) if (robust) { k <- which(mlr$th[, 1] == b & mlr$th[, 2] == u & mlr$th[, 3] == v); if (length(k)) mlr$robust[p + k] else NULL } else NULL
  ord <- order(vapply(blocks, function(B) if (identical(B$level, "Residual")) Inf else -match(B$level, gid), 0))
  random <- list()
  for (b in ord) {
    B <- blocks[[b]]; resid_b <- identical(B$level, "Residual"); q <- ncol(B$Z)
    grp <- if (resid_b) "Residual" else lev_name[[B$level]]
    for (u in seq_len(q)) {
      a <- if (resid_b) (if (q > 1) (if (stacked) allout[[as.integer(B$names[u])]]$outcome else ms[as.integer(B$names[u])]) else NULL) else disp(B$names[u])
      random[[length(random) + 1]] <- list(group = grp, a = a, b = NULL, variance = B$G[u, u], sd = sqrt(max(B$G[u, u], 0)), se = th_se(b, u, u))
    }
    if (B$type == "symm" && q > 1) for (v in seq_len(q - 1)) for (u in (v + 1):q)
      random[[length(random) + 1]] <- list(group = grp, a = disp(B$names[v]), b = disp(B$names[u]), variance = B$G[u, v], sd = B$G[u, v] / sqrt(B$G[u, u] * B$G[v, v]), se = th_se(b, u, v))
  }
  K <- sum(vapply(blocks, function(B) { q <- ncol(B$Z); if (B$type == "diag") q else q * (q + 1) / 2 }, 0))
  ll <- if (robust) mlr$ll else as.numeric(stats::logLik(fit))
  npar <- p + K
  # BIC with the number of cases (rows of the data): wide repeated measures and stacked outcomes count persons, as Mplus.
  ncase <- if (wide) length(unique(d[[Pi]])) else if (stacked) length(unique(d[[Ci]])) else nrow(d)
  if (robust && mlr$steps > 0 && mlr$gain > 1e-4) ps_note(sprintf("The %s solution was refined by %d Newton step%s to the maximum of the likelihood (log-likelihood %+.4f).", pkg, mlr$steps, if (mlr$steps > 1) "s" else "", mlr$gain))
  ps_json(list(n = nrow(d), clusters = length(unique(d[[gid[1]]])), reml = reml, icc = env$icc,
    levels = lapply(seq_len(H), function(h) list(name = levs[[h]]$name, units = length(unique(d[[gid[h]]])))),
    fixed = fixed_out, random = random, robust = robust, npar = npar, cases = ncase,
    r2 = if (stacked) NULL else as.list(env$r2), logLik = ll, aic = -2 * ll + 2 * npar, bic = -2 * ll + npar * log(ncase),
    singular = if (nlme) FALSE else lme4::isSingular(fit), slopeTest = NULL, lines = NULL,
    warnings = env$.warnings, engine = list(package = pkg, version = as.character(utils::packageVersion(pkg)))))
}

#' Growth mixture model (latent class linear mixed model, lcmm::hlme) for 1..K
#' classes, from wide (one column per occasion) or long data (subject, time, outcome).
ps_gmm <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  long <- identical(req$format, "long")
  covs <- unlist(req$covariates)
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic")) stop("Invalid trajectory shape in the request.")
  random <- req$random %||% "intercept"
  if (!random %in% c("none", "intercept", "slope")) stop("Invalid random effects in the request.")
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 6)) stop("Choose between 1 and 6 classes.")
  if (!1L %in% ks) ks <- sort(unique(c(1L, ks)))  # the one-class model starts the others
  nrep <- as.integer(req$nrep %||% 20); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of random starts.")
  if (long) {
    if (!length(req$subject) || !length(req$time) || !length(req$outcome)) stop("Long data need a subject, a time and an outcome column.")
    fr <- ps_long_frame(req, c(req$subject, req$time, req$outcome, covs))
    prep <- c(sprintf("long <- data.frame(id = data$%s, time = data$%s, y = data$%s%s)", fr$v[[req$subject]], fr$v[[req$time]], fr$v[[req$outcome]],
      if (length(covs)) paste0(", ", paste(sprintf("%s = data$%s", fr$v[covs], fr$v[covs]), collapse = ", ")) else ""))
  } else {
    measures <- unlist(req$measures); times <- as.numeric(unlist(req$times))
    if (length(measures) < 3) stop("A growth mixture model needs at least three occasions.")
    if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per occasion.")
    fr <- ps_long_frame(req, c(measures, covs))
    m <- unname(fr$v[measures])
    prep <- c("# Wide to long: one row per person and occasion.",
      sprintf("long <- data.frame(id = rep(seq_len(nrow(data)), times = %d), time = rep(%s, each = nrow(data)),", length(m), paste(deparse(times), collapse = "")),
      sprintf("  y = unlist(data[, %s], use.names = FALSE)%s)", ps_q(m),
        if (length(covs)) paste0(", ", paste(sprintf("%s = rep(data$%s, times = %d)", fr$v[covs], fr$v[covs], length(m)), collapse = ", ")) else ""))
  }
  cv <- unname(fr$v[covs])
  traj <- if (shape == "quadratic") "time + I(time^2)" else "time"
  fixed <- sprintf("y ~ %s%s", traj, if (length(cv)) paste0(" + ", paste(cv, collapse = " + ")) else "")
  ran <- switch(random, none = "~ -1", intercept = "~ 1", slope = "~ time")
  call <- function(k) sprintf("hlme(%s,%s random = %s, subject = \"id\", ng = %d, data = long)", fixed,
    if (k > 1) sprintf(" mixture = ~ %s,", traj) else "", ran, k)
  body <- c("suppressPackageStartupMessages(library(lcmm))", prep,
    "long <- long[complete.cases(long), ]",
    "# Enough persons for classes (the id must identify persons). Two rows of one person at the same",
    "# time are allowed (e.g. times in whole weeks) but often mean the id column is not the person.",
    # (The column name is written as an escaped R string literal.)
    sprintf("if (anyDuplicated(long[, c(\"id\", \"time\")])) warning(%s)", encodeString(ps_comment(if (long) sprintf(
      "Some persons have two rows at the same time. If that is not expected, the person column %s may not identify persons.", req$subject)
      else "Two occasions have the same time score."), quote = '"')),
    "if (length(unique(long$id)) < 10) stop(sprintf(\"Only %d persons: a growth mixture model needs many persons (the person column must identify them).\", length(unique(long$id))))",
    "fits <- list()",
    sprintf("fits[[\"1\"]] <- %s", call(1)),
    if (any(ks > 1)) c(sprintf("# More classes: %d random starts from the one-class solution (lcmm::gridsearch), the best kept.", nrep),
      sprintf("set.seed(%d)", seed),
      vapply(ks[ks > 1], function(k) sprintf("fits[[\"%d\"]] <- gridsearch(rep = %d, maxiter = 30, minit = fits[[\"1\"]], %s)", k, nrep, call(k)), "")),
    "# Classification quality: relative entropy (1 = perfectly separated classes).",
    "entropy <- function(m) { k <- m$ng; if (k == 1) return(NA); p <- as.matrix(m$pprob[, paste0(\"prob\", 1:k)]); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }",
    "# Sample-size adjusted BIC (Sclove 1987).",
    "sabic <- function(m) -2 * m$loglik + length(m$best) * log((m$ns + 2) / 24)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Growth mixture model (lcmm::hlme)", "lcmm", inputs, body,
    c("summarytable(fits[[1]], fits[-1], which = c(\"G\", \"loglik\", \"npm\", \"BIC\", \"SABIC\", \"entropy\", \"%class\"))", "lapply(fits, summary)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  grid <- seq(min(env$long$time), max(env$long$time), length.out = 41)
  nd <- data.frame(time = grid)
  for (c in cv) nd[[c]] <- mean(env$long[[c]])
  obs_times <- sort(unique(env$long$time))
  # Covariate names back, as whole words only (a covariate "x" must not change "max").
  back <- function(x) ps_back_names(x, fr$back[cv])
  models <- lapply(as.character(ks), function(k) {
    m <- env$fits[[k]]; g <- m$ng
    cls <- m$pprob$class
    pr <- lcmm::predictY(m, newdata = nd, var.time = "time")$pred
    se <- ps_try(sqrt(diag(lcmm::VarCov(m))), sprintf("Standard errors of the %d-class model (lcmm::VarCov)", g), otherwise = rep(NA_real_, length(m$best)))
    est <- m$best; z <- est / se[seq_along(est)]
    # The first ng - 1 parameters are class membership (multinomial logit, last class the reference); lcmm names them like trajectory intercepts.
    pn <- names(est); if (g > 1) pn[seq_len(g - 1)] <- sprintf("membership: class %d vs %d", seq_len(g - 1), g)
    # Observed means per occasion of the people in each class (modal class), when occasions are few.
    obs <- if (length(obs_times) <= 20) lapply(seq_len(g), function(c) {
      ids <- m$pprob$id[cls == c]; d <- env$long[env$long$id %in% ids, ]
      unname(vapply(obs_times, function(t) { x <- d$y[d$time == t]; if (length(x)) mean(x) else NA_real_ }, 0))
    }) else NULL
    list(k = g, logLik = m$loglik, npar = length(m$best), aic = m$AIC, bic = m$BIC, sabic = env$sabic(m), entropy = env$entropy(m),
      converged = m$conv == 1, shares = unname(vapply(seq_len(g), function(c) mean(cls == c), 0)),
      params = lapply(seq_along(est), function(i) list(name = back(pn[i]), est = unname(est[i]), se = unname(se[i]),
        p = if (is.finite(z[i])) 2 * stats::pnorm(-abs(unname(z[i]))) else NULL)),
      trajectories = lapply(seq_len(g), function(c) unname(pr[, if (g == 1) 1 else paste0("Ypred_class", c)])), observed = obs)
  })
  ps_json(list(n = length(unique(env$long$id)), observations = nrow(env$long), times = grid, observedTimes = obs_times, models = models,
    warnings = env$.warnings, engine = list(package = "lcmm", version = as.character(utils::packageVersion("lcmm")))))
}

# Growth mixture model of wide data with a residual variance per occasion (Mplus's default for
# TYPE = MIXTURE: i s | y1@0 y2@1 ...; i s ON x; c ON w), a likelihood written out in base R:
# within class c, y | x ~ N(L (a_c + G x), L Psi L' + diag(theta)); P(c | w) multinomial logit.
# The growth factor means differ across classes; G, Psi and theta are equal across classes.
PS_GMM_WIDE_FUNCTIONS <- c(
  "gmm_wide_fit <- function(Y, times, X, W, k, shape, random, nrep) {",
  "  Y <- as.matrix(Y); X <- as.matrix(X); W <- as.matrix(W); n <- nrow(Y); nt <- ncol(Y); q <- ncol(X); r <- ncol(W)",
  "  L <- cbind(1, times, if (shape == \"quadratic\") times^2); f <- ncol(L)",
  "  nr <- switch(random, none = 0, intercept = 1, slope = f)  # growth factors that vary within class",
  "  nv <- nr * (nr + 1) / 2",
  "  # Natural parameters: class means a (f x k), G (f x q), Psi (lower triangle), theta, membership logits (k - 1 x (1 + r)).",
  "  unpack <- function(th) {",
  "    o <- 0; take <- function(m) { v <- th[o + seq_len(m)]; o <<- o + m; v }",
  "    a <- matrix(take(f * k), f); G <- matrix(take(f * q), f); P <- matrix(0, f, f)",
  "    if (nr) { Pr <- matrix(0, nr, nr); Pr[lower.tri(Pr, diag = TRUE)] <- take(nv); Pr <- Pr + t(Pr) - diag(diag(Pr), nr); P[seq_len(nr), seq_len(nr)] <- Pr }",
  "    theta <- take(nt); B <- rbind(matrix(take((k - 1) * (1 + r)), k - 1, 1 + r), 0)",
  "    list(a = a, G = G, Psi = P, theta = theta, B = B)",
  "  }",
  "  loglik <- function(th, post = FALSE) {",
  "    p <- unpack(th); if (any(p$theta <= 0)) return(-Inf)",
  "    S <- L %*% p$Psi %*% t(L) + diag(p$theta, nt); R <- tryCatch(chol(S), error = function(e) NULL); if (is.null(R)) return(-Inf)",
  "    if (nr && any(eigen(p$Psi[seq_len(nr), seq_len(nr), drop = FALSE], symmetric = TRUE, only.values = TRUE)$values < -1e-10)) return(-Inf)",
  "    lw <- cbind(1, W) %*% t(p$B); lw <- lw - apply(lw, 1, max); lw <- lw - log(rowSums(exp(lw)))",
  "    XG <- X %*% t(p$G)",
  "    lp <- vapply(seq_len(k), function(c) { mu <- sweep(XG, 2, p$a[, c], `+`) %*% t(L)",
  "      z <- backsolve(R, t(Y - mu), transpose = TRUE); -0.5 * colSums(z^2) - sum(log(diag(R))) - 0.5 * nt * log(2 * pi) }, numeric(n))",
  "    lp <- matrix(lp, n) + lw; m <- apply(lp, 1, max); lse <- m + log(rowSums(exp(lp - m)))",
  "    if (post) exp(lp - lse) else sum(lse)",
  "  }",
  "  # Optimised on a scale without bounds: log residual variances, the covariance matrix by its Cholesky factor.",
  "  nat <- function(u) { o <- f * k + f * q; th <- u",
  "    if (nr) { C <- matrix(0, nr, nr); C[lower.tri(C, diag = TRUE)] <- u[o + seq_len(nv)]; diag(C) <- exp(diag(C)); Pr <- C %*% t(C); th[o + seq_len(nv)] <- Pr[lower.tri(Pr, diag = TRUE)] }",
  "    o <- o + nv; th[o + seq_len(nt)] <- exp(u[o + seq_len(nt)]); th }",
  "  fn <- function(u) { v <- -loglik(nat(u)); if (is.finite(v)) v else 1e300 }",
  "  # Starts: each person's least-squares growth factors, regressed on the covariates; their residuals clustered.",
  "  bi <- t(solve(crossprod(L), t(L) %*% t(Y))); X1 <- cbind(1, X); cf <- qr.solve(X1, bi); res <- bi - X1 %*% cf",
  "  th0 <- log(pmax(colMeans((Y - bi %*% t(L))^2), 1e-3 * stats::var(as.vector(Y))) + 0.1 * stats::var(as.vector(Y)) / nt)",
  "  ch0 <- if (nr) { C <- t(chol(stats::cov(res[, seq_len(nr), drop = FALSE]) * 0.5 + diag(1e-3, nr))); diag(C) <- log(diag(C)); C[lower.tri(C, diag = TRUE)] } else NULL",
  "  best <- NULL",
  "  for (s in seq_len(if (k == 1) 1 else nrep)) {",
  "    cl <- if (k == 1) rep(1L, n) else stats::kmeans(res, k, nstart = 1, iter.max = 50)$cluster",
  "    a0 <- vapply(seq_len(k), function(c) cf[1, ] + colMeans(res[cl == c, , drop = FALSE]), numeric(f))",
  "    u0 <- c(a0, t(cf[-1, , drop = FALSE]), ch0, th0, if (k > 1) stats::rnorm((k - 1) * (1 + r), 0, 0.3))",
  "    o <- tryCatch(stats::optim(u0, fn, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-12)), error = function(e) NULL)",
  "    if (!is.null(o) && o$value < 1e300 && (is.null(best) || o$value < best$value)) best <- o",
  "  }",
  "  if (is.null(best)) stop(sprintf(\"No start of the %d-class model converged.\", k))",
  "  # The best start is restarted until the log-likelihood stops improving (BFGS stops early on flat ridges).",
  "  for (i in 1:20) { o <- stats::optim(best$par, fn, method = \"BFGS\", control = list(maxit = 5000, reltol = 1e-14)); done <- best$value - o$value < 1e-9; if (o$value < best$value) best <- o; if (done) break }",
  "  est <- nat(best$par)",
  "  # Standard errors from the observed information (numerical Hessian at the maximum).",
  "  se <- tryCatch(sqrt(diag(solve(stats::optimHess(est, function(t) { v <- -loglik(t); if (is.finite(v)) v else 1e300 })))), error = function(e) rep(NA_real_, length(est)), warning = function(w) rep(NA_real_, length(est)))",
  "  list(ll = -best$value, npar = length(est), est = est, se = se, p = unpack(est), post = loglik(est, post = TRUE), converged = best$convergence == 0, f = f, nr = nr)",
  "}")

ps_gmm_wide <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  covs <- unlist(req$covariates); memb <- unlist(req$membership)
  shape <- req$shape %||% "linear"
  if (!shape %in% c("linear", "quadratic")) stop("Invalid trajectory shape in the request.")
  random <- req$random %||% "slope"
  if (!random %in% c("none", "intercept", "slope")) stop("Invalid random effects in the request.")
  ks <- as.integer(unlist(req$classes))
  if (!length(ks) || any(ks < 1 | ks > 6)) stop("Choose between 1 and 6 classes.")
  nrep <- as.integer(req$nrep %||% 20); seed <- as.integer(req$seed %||% 1)
  if (nrep < 1 || nrep > 100) stop("Invalid number of random starts.")
  measures <- unlist(req$measures); times <- as.numeric(unlist(req$times))
  if (length(measures) < 3) stop("A growth mixture model needs at least three occasions.")
  if (length(times) != length(measures) || any(!is.finite(times))) stop("Give one time score per occasion.")
  fr <- ps_long_frame(req, unique(c(measures, covs, memb)))
  m <- unname(fr$v[measures]); cv <- unname(fr$v[covs]); wv <- unname(fr$v[memb])
  body <- c(PS_GMM_WIDE_FUNCTIONS,
    sprintf("d <- data[complete.cases(data[, %s]), , drop = FALSE]  # persons with every occasion and covariate", ps_q(unique(c(m, cv, wv)))),
    sprintf("Y <- d[, %s]; X <- d[, %s, drop = FALSE]; W <- d[, %s, drop = FALSE]", ps_q(m), if (length(cv)) ps_q(cv) else "integer(0)", if (length(wv)) ps_q(wv) else "integer(0)"),
    sprintf("times <- %s", paste(deparse(times), collapse = "")),
    sprintf("# %s classes; %d random starts each (k-means of the persons' growth factors), the best kept.", paste(ks, collapse = ", "), nrep),
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); gmm_wide_fit(Y, times, X, W, k, \"%s\", \"%s\", %d) })", paste(deparse(ks), collapse = ""), seed, shape, random, nrep),
    "entropy <- function(m) { p <- m$post; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Growth mixture model, a residual variance per occasion", character(0), inputs, body,
    c("sapply(fits, function(m) c(classes = ncol(m$post), llik = m$ll, npar = m$npar, BIC = -2 * m$ll + m$npar * log(nrow(Y)), entropy = env_entropy <- entropy(m)))",
      "lapply(fits, `[[`, \"p\")")), collapse = "\n"))
  env <- ps_run(body, inputs)
  n <- nrow(env$Y); nt <- length(m)
  fac <- c("intercept", "slope", "quadratic")
  grid <- seq(min(times), max(times), length.out = 41)
  xbar <- if (length(cv)) colMeans(as.matrix(env$X)) else numeric(0)
  models <- lapply(env$fits, function(fit) {
    p <- fit$p; k <- ncol(fit$post); f <- fit$f; nr <- fit$nr
    shares <- colMeans(fit$post); ord <- order(-shares); ref <- ord[k]
    # Parameter names in the order of the estimates (unpack), with the classes renumbered by size.
    cls <- match(seq_len(k), ord)
    nm <- c(as.vector(outer(fac[seq_len(f)], seq_len(k), function(a, c) sprintf("class %d: %s mean", cls[c], a))),
      as.vector(outer(fac[seq_len(f)], covs, function(a, x) sprintf("%s ~ %s", a, x))),
      if (nr) { ix <- which(lower.tri(diag(nr), diag = TRUE), arr.ind = TRUE); ifelse(ix[, 1] == ix[, 2], sprintf("variance: %s", fac[ix[, 1]]), sprintf("covariance: %s, %s", fac[ix[, 2]], fac[ix[, 1]])) },
      sprintf("residual variance: %s", measures),
      if (k > 1) as.vector(outer(seq_len(k - 1), c("intercept", memb), function(c, x) sprintf("membership: class %d vs %d: %s", cls[c], cls[k], x))))
    est <- fit$est; se <- fit$se
    keep <- if (k > 1) TRUE else !grepl("^membership", nm)
    # The membership logits against the smallest class (the last): re-expressed when the reference differs.
    B <- p$B; Bs <- sweep(B, 2, B[ref, ], `-`)
    mb <- if (k > 1) lapply(setdiff(ord, ref), function(c) list(name = sprintf("membership: class %d vs %d", cls[c], k), est = unname(Bs[c, ]), terms = c("intercept", memb))) else list()
    params <- lapply(which(keep & !grepl("^membership", nm)), function(i) {
      z <- est[i] / se[i]; list(name = nm[i], est = unname(est[i]), se = if (is.finite(se[i])) unname(se[i]) else NULL, p = if (is.finite(z)) 2 * stats::pnorm(-abs(unname(z))) else NULL) })
    for (b in mb) for (j in seq_along(b$terms)) params[[length(params) + 1]] <- list(name = sprintf("%s: %s", b$name, b$terms[j]), est = b$est[j], se = NULL, p = NULL)
    Lg <- cbind(1, grid, if (f == 3) grid^2)
    cl <- max.col(fit$post, ties.method = "first")
    list(k = k, logLik = fit$ll, npar = fit$npar, aic = -2 * fit$ll + 2 * fit$npar, bic = -2 * fit$ll + fit$npar * log(n), sabic = -2 * fit$ll + fit$npar * log((n + 2) / 24),
      entropy = env$entropy(fit), converged = fit$converged, shares = unname(shares[ord]), params = params,
      trajectories = lapply(ord, function(c) unname(as.vector(Lg %*% (p$a[, c] + if (length(xbar)) p$G %*% xbar else 0)))),
      observed = lapply(ord, function(c) unname(colMeans(as.matrix(env$Y)[cl == c, , drop = FALSE]))))
  })
  ps_json(list(n = n, observations = n * nt, times = grid, observedTimes = times, models = models,
    warnings = env$.warnings, engine = list(package = "R", version = paste(R.version$major, R.version$minor, sep = "."))))
}
