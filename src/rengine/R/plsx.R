# PLS-SEM assessment with cSEM (Rademaker & Schuberth): out-of-sample
# prediction (PLSpredict; Shmueli et al. 2016, 2019), model comparison by
# information criteria (Sharma et al. 2019, 2021) and the cross-validated
# predictive ability test (CVPAT; Liengaard et al. 2021), measurement
# invariance of composites (MICOM; Henseler, Ringle & Sarstedt 2016) and
# multigroup analysis (testMGD: Henseler, Chin, Sarstedt, Keil, Nitzl and
# Klesel's overall test).

#' The cSEM build of a request (whatever PLS package the app uses).
ps_plsx_build <- function(req) { req$package <- "cSEM"; ps_pls_build(req) }

#' Construct and indicator names back to the app's names.
ps_plsx_back <- function(b) {
  cv <- b$n$cv
  c(setNames(names(cv), unname(cv)), setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds])))
}
#' "TO ~ FROM" (cSEM's parameter names) as from / to in the app's names.
ps_plsx_path <- function(s, back) {
  p <- strsplit(s, " ~ ", fixed = TRUE)[[1]]
  list(from = unname(back[p[2]]), to = unname(back[p[1]]))
}

ps_pls_predict <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  folds <- as.integer(req$folds %||% 10); reps <- as.integer(req$repetitions %||% 10); seed <- as.integer(req$seed %||% 1)
  if (folds < 2 || folds > 50 || reps < 1 || reps > 100) stop("Invalid cross-validation settings.")
  engine <- req$engine %||% "cSEM"
  if (!engine %in% c("cSEM", "seminr")) stop("Invalid PLSpredict engine in the request.")
  if (identical(engine, "seminr")) return(ps_pls_predict_seminr(req, folds, reps, seed, export))
  b <- ps_plsx_build(req)
  body <- c(b$body,
    sprintf("# PLSpredict (Shmueli et al. 2019): %d-fold cross-validation, repeated %d times; benchmark: a linear", folds, reps),
    "# regression of each endogenous indicator on all exogenous indicators (LM). Q2_predict > 0: better than the training means.",
    "# Each repetition with its own seed (cSEM's .r > 1 cannot be made reproducible); the metrics are averaged.",
    sprintf("runs <- lapply(seq_len(%d), function(k) predict(fit, .benchmark = \"lm\", .cv_folds = %d, .r = 1, .seed = %d + k, .handle_inadmissibles = \"ignore\")$Prediction_metrics)", reps, folds, seed),
    "cols <- c(\"MAE_target\", \"MAE_benchmark\", \"RMSE_target\", \"RMSE_benchmark\", \"Q2_predict\")",
    "metrics <- data.frame(Name = runs[[1]]$Name, Reduce(`+`, lapply(runs, function(r) as.matrix(r[, cols]))) / length(runs))")
  if (export) return(paste(ps_script("PLSpredict (cSEM)", "cSEM", b$inputs, body, "metrics[, c(\"Name\", \"MAE_target\", \"MAE_benchmark\", \"RMSE_target\", \"RMSE_benchmark\", \"Q2_predict\")]"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_plsx_back(b); m <- env$metrics
  owner <- function(i) { j <- which(vapply(b$n$inds, function(x) back[[i]] %in% x, TRUE))[1]; b$n$cname[j] }
  ps_json(list(folds = folds, repetitions = reps,
    indicators = lapply(seq_len(nrow(m)), function(i) list(indicator = unname(back[m$Name[i]]), construct = owner(m$Name[i]),
      maePls = m$MAE_target[i], maeLm = m$MAE_benchmark[i], rmsePls = m$RMSE_target[i], rmseLm = m$RMSE_benchmark[i], q2 = m$Q2_predict[i])),
    warnings = env$.warnings, engine = list(package = "cSEM", version = as.character(utils::packageVersion("cSEM")))))
}

#' PLSpredict as seminr's predict_pls (?predict_pls): its folds and repetitions (the predictions averaged over the
#' repetitions, then the errors), its PLS predictions from the exogenous constructs (predict_EA) or from each construct's
#' direct antecedents (predict_DA), and its linear benchmark: each endogenous construct's items regressed on the items of
#' the same predictors (the exogenous constructs, or the direct antecedents). Q2predict against the sample mean.
ps_pls_predict_seminr <- function(req, folds, reps, seed, export) {
  technique <- req$technique %||% "EA"
  if (!technique %in% c("EA", "DA")) stop("Invalid PLSpredict technique in the request.")
  req$package <- "seminr"
  b <- ps_pls_build(req)
  # Mean replacement as seminr's own (estimate_pls(missing = mean_replacement)): predict_pls then replaces the missing values
  # of each training fold by that fold's means, as on the help page, rather than the whole sample's beforehand.
  if (identical(req$missing %||% "mean", "mean")) {
    mean_lines <- ps_missing_code("mean")
    fit_at <- grep("^fit <- estimate_pls\\(", b$body)
    if (length(fit_at) == 1 && all(mean_lines %in% b$body)) {
      b$body <- b$body[!b$body %in% mean_lines]
      fit_at <- grep("^fit <- estimate_pls\\(", b$body)
      b$body[fit_at] <- sub("\\)$", ", missing = mean_replacement, missing_value = NA)   # missing values: each fold's means", b$body[fit_at])
    }
  }
  body <- c(b$body,
    sprintf("# PLSpredict as seminr's predict_pls: %d-fold cross-validation, %d repetitions (the predictions averaged), predicting", folds, reps),
    sprintf("# from %s; the linear benchmark regresses each endogenous construct's items on the same predictors' items.", if (technique == "EA") "the exogenous constructs (predict_EA)" else "each construct's direct antecedents (predict_DA)"),
    sprintf("set.seed(%d)", seed),
    sprintf("pred <- predict_pls(fit, technique = predict_%s, noFolds = %d, reps = %d)", technique, folds, reps),
    "s <- summary(pred)",
    "# Q2predict: 1 - the out-of-sample squared error over that of the sample mean",
    "act <- as.matrix(pred$items$item_actuals[, colnames(s$PLS_out_of_sample), drop = FALSE])",
    "res <- as.matrix(pred$items$PLS_out_of_sample_residuals[, colnames(s$PLS_out_of_sample), drop = FALSE])",
    "q2 <- 1 - colSums(res^2) / colSums(sweep(act, 2, colMeans(act))^2)")
  if (export) return(paste(ps_script("PLSpredict (seminr)", "seminr", b$inputs, body, c("s$PLS_out_of_sample", "s$LM_out_of_sample", "q2")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  s <- env$s; items <- colnames(s$PLS_out_of_sample)
  back <- c(setNames(names(b$n$iv), unname(b$n$iv)))
  owner <- function(i) b$n$cname[which(vapply(b$n$inds, function(x) back[[i]] %in% x, TRUE))[1]]
  ps_json(list(folds = folds, repetitions = reps, predictEngine = "seminr", technique = technique,
    indicators = lapply(items, function(i) list(indicator = unname(back[[i]]), construct = owner(i),
      maePls = s$PLS_out_of_sample["MAE", i], maeLm = s$LM_out_of_sample["MAE", i], rmsePls = s$PLS_out_of_sample["RMSE", i], rmseLm = s$LM_out_of_sample["RMSE", i], q2 = unname(env$q2[i]))),
    warnings = env$.warnings, engine = list(package = "seminr", version = as.character(utils::packageVersion("seminr")))))
}

ps_pls_compare <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  alt <- req; alt$model <- req$alternative
  same <- function(m) vapply(m$constructs, function(c) paste(c$name, paste(sort(unlist(c$indicators)), collapse = ","), sep = ":"), "")
  if (!setequal(same(req$model), same(alt$model))) stop("The alternative model must have the same constructs and indicators; only the paths may differ.")
  b <- ps_plsx_build(req); b2 <- ps_plsx_build(alt)
  seed <- as.integer(req$seed %||% 1)
  start <- which(b2$body == "model <- '")
  alt_lines <- b2$body[start:length(b2$body)]
  alt_lines[1] <- "model_alt <- '"
  alt_lines[length(alt_lines)] <- sub("^fit <- csem\\(data, model,", "fit_alt <- csem(data, model_alt,", alt_lines[length(alt_lines)])
  body <- c(b$body, "# The alternative model: the same measurement, other paths.", alt_lines,
    "# Information criteria per endogenous construct (Sharma et al.): lower is better; BIC and GM are recommended.",
    "msc <- calculateModelSelectionCriteria(fit, .by_equation = TRUE)",
    "msc_alt <- calculateModelSelectionCriteria(fit_alt, .by_equation = TRUE)",
    "# CVPAT (Liengaard et al. 2021): do the two models differ in their out-of-sample prediction loss?",
    sprintf("cvpat <- testCVPAT(fit, fit_alt, .seed = %d, .handle_inadmissibles = \"ignore\")", seed),
    "loss <- function(k) { r <- cvpat$Information[[k]]$Residuals_target[[1]]; mean(as.matrix(r)^2, na.rm = TRUE) }",
    "losses <- c(loss(1), loss(2))")
  if (export) return(paste(ps_script("Model comparison (cSEM)", "cSEM", b$inputs, body, c("msc", "msc_alt", "cvpat")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_plsx_back(b)
  crit <- function(ms) lapply(names(ms), function(k) list(criterion = k, byConstruct = as.list(setNames(unname(ms[[k]]), unname(back[names(ms[[k]])])))))
  ps_json(list(criteria = crit(env$msc), criteriaAlt = crit(env$msc_alt),
    cvpat = list(statistic = env$cvpat$test_statistic, p = env$cvpat$p_value, df = env$cvpat$`degrees of freedom`, loss = env$losses[1], lossAlt = env$losses[2]),
    warnings = env$.warnings, engine = list(package = "cSEM", version = as.character(utils::packageVersion("cSEM")))))
}

ps_pls_groups <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_plsx_build(req)
  R <- as.integer(req$samples %||% 499); seed <- as.integer(req$seed %||% 1)
  if (R < 20 || R > 5000) stop("Invalid number of permutations.")
  approaches <- unlist(req$approaches %||% c("Henseler", "Chin", "Klesel"))
  if (!all(approaches %in% c("Henseler", "Chin", "Sarstedt", "Keil", "Nitzl", "Klesel"))) stop("Invalid multigroup approach in the request.")
  at <- match(req$group, req$data$names)
  if (is.na(at)) stop("The grouping column is not in the dataset.")
  cols <- req$data$cols
  gcol <- as.numeric(if (is.matrix(cols)) cols[at, ] else cols[[at]])
  gv <- ps_ident(c(names(b$inputs$data), "group"))[ncol(b$inputs$data) + 1]
  b$inputs$data[[gv]] <- gcol
  labels <- unlist(req$groupLabels)
  last <- length(b$body)
  b$body[last] <- sub("\\)$", sprintf(", .id = \"%s\")", gv), b$body[last])
  body <- c(b$body[seq_len(last - 1)],
    sprintf("data <- data[!is.na(data$%s), ]", gv),
    if (length(labels)) sprintf("data$%s <- factor(data$%s, levels = seq_len(%d), labels = %s)", gv, gv, length(labels), ps_q(labels)),
    "# One PLS model per group (cSEM's .id).", b$body[last],
    "# MICOM (Henseler, Ringle & Sarstedt 2016): step 2, compositional invariance (c close to 1); step 3, equal means and variances.",
    sprintf("set.seed(%d)  # (testMICOM needs an initialised random number generator)", seed),
    sprintf("micom <- testMICOM(fit, .R = %d, .seed = %d, .verbose = FALSE)", R, seed),
    "# Multigroup analysis: differences between the groups' parameters.",
    ps_cores_csem(req),
    sprintf("mga <- testMGD(fit, .approach_mgd = %s, .R_permutation = %d, .R_bootstrap = %d, .seed = %d, .eval_plan = plan, .verbose = FALSE)", ps_q(approaches), R, R, seed))
  if (export) return(paste(ps_script("Group comparison: MICOM and multigroup analysis (cSEM)", "cSEM", b$inputs, body, c("micom", "mga")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_plsx_back(b)
  nm <- function(x) { y <- back[x]; ifelse(is.na(y), x, y) }
  mi <- env$micom
  first <- function(x) x[[1]]
  step3 <- function(part) { s <- mi$Step3[[part]]; list(statistic = as.list(setNames(unname(first(s$Test_statistic)), nm(names(first(s$Test_statistic))))),
    p = as.list(setNames(unname(first(first(s$P_value))), nm(names(first(first(s$P_value)))))) ) }
  pathRows <- function(stat, p) {
    keep <- grepl(" ~ ", names(p), fixed = TRUE)
    lapply(which(keep), function(i) c(ps_plsx_path(names(p)[i], back), list(statistic = if (is.null(stat) || is.na(stat[i])) NULL else unname(stat[i]), p = unname(p[i]))))
  }
  mga <- lapply(approaches, function(a) {
    x <- env$mga[[a]]
    # (d_G with the natural logarithm, as elsewhere in the app; the p-value does not depend on the base)
    if (a == "Klesel") return(list(approach = a, overall = list(dG = list(statistic = log(10)^2 * x$Test_statistic[["dG"]], p = x$P_value[["dG"]]), dL = list(statistic = x$Test_statistic[["dL"]], p = x$P_value[["dL"]]))))
    # Sarstedt et al.: one test across all groups per parameter; the others per pair of groups.
    if (a == "Sarstedt") return(list(approach = a, comparisons = list(list(groups = "all", paths = pathRows(x$Test_statistic, first(x$P_value))))))
    comps <- names(x$Test_statistic)
    list(approach = a, comparisons = lapply(comps, function(k) list(groups = k, paths = pathRows(x$Test_statistic[[k]], first(x$P_value)[[k]]))))
  })
  per_group <- lapply(names(env$fit), function(g) {
    P <- env$fit[[g]]$Estimates$Path_estimates
    list(group = g, n = nrow(env$fit[[g]]$Information$Data), paths = lapply(req$model$paths, function(p) list(from = p$from, to = p$to, est = P[b$n$cv[[p$to]], b$n$cv[[p$from]]])))
  })
  ps_json(list(groups = per_group,
    micom = list(c = as.list(setNames(unname(first(mi$Step2$Test_statistic)), nm(names(first(mi$Step2$Test_statistic))))),
      cP = as.list(setNames(unname(first(first(mi$Step2$P_value))), nm(names(first(first(mi$Step2$P_value)))))),
      mean = step3("Mean"), variance = step3("Var"), admissible = mi$Information$Number_admissibles, runs = mi$Information$Total_runs),
    mga = mga, samples = R,
    warnings = env$.warnings, engine = list(package = "cSEM", version = as.character(utils::packageVersion("cSEM")))))
}

#' CTA-PLS (Gudergan, Ringle, Wende & Will 2008): confirmatory tetrad
#' analysis. In a reflective (common factor) block, every tetrad
#' t = s_gh s_ij - s_gi s_hj of the indicator covariances vanishes; a
#' tetrad that differs from zero speaks against the reflective model. Per
#' block with at least four indicators: a set of p(p-3)/2 non-redundant
#' tetrads (added one by one while the Jacobian's rank under a one-factor
#' model grows; Bollen & Ting 1993), bootstrap standard errors and
#' bias-corrected intervals, Bonferroni-adjusted within the block. No R
#' package implements it; written out here.
PS_CTA_FUNCTIONS <- c(
  "# All tetrads of p indicators (three per set of four): t = s[g,h] s[i,j] - s[g,i] s[h,j].",
  "cta_all <- function(p) { q <- utils::combn(p, 4); do.call(rbind, lapply(seq_len(ncol(q)), function(k) { a <- q[, k]",
  "  rbind(a[c(1, 2, 3, 4)], a[c(1, 3, 4, 2)], a[c(1, 4, 2, 3)]) })) }",
  "cta_value <- function(S, t) S[t[1], t[2]] * S[t[3], t[4]] - S[t[1], t[3]] * S[t[2], t[4]]",
  "# Non-redundant set: keep a tetrad if it raises the rank of the Jacobian (derivatives by the covariances) under a one-factor model.",
  "cta_nonredundant <- function(p) {",
  "  all <- cta_all(p); pairs <- utils::combn(p, 2); idx <- function(a, b) which(pairs[1, ] == min(a, b) & pairs[2, ] == max(a, b))",
  "  lam <- seq(0.55, 0.95, length.out = p); S <- outer(lam, lam)",
  "  grad <- function(t) { g <- numeric(ncol(pairs)); g[idx(t[1], t[2])] <- g[idx(t[1], t[2])] + S[t[3], t[4]]; g[idx(t[3], t[4])] <- g[idx(t[3], t[4])] + S[t[1], t[2]]",
  "    g[idx(t[1], t[3])] <- g[idx(t[1], t[3])] - S[t[2], t[4]]; g[idx(t[2], t[4])] <- g[idx(t[2], t[4])] - S[t[1], t[3]]; g }",
  "  keep <- integer(0); J <- NULL",
  "  for (k in seq_len(nrow(all))) { J2 <- rbind(J, grad(all[k, ])); if (qr(J2)$rank > length(keep)) { keep <- c(keep, k); J <- J2 }; if (length(keep) == p * (p - 3) / 2) break }",
  "  all[keep, , drop = FALSE]",
  "}",
  "# Bias-corrected bootstrap interval (Efron 1987) at level 1 - alpha.",
  "cta_bc <- function(boot, est, alpha) { z0 <- stats::qnorm(mean(boot < est)); q <- stats::pnorm(2 * z0 + stats::qnorm(c(alpha / 2, 1 - alpha / 2))); unname(stats::quantile(boot, q, na.rm = TRUE)) }")

ps_cta <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  B <- as.integer(req$samples %||% 1000); seed <- as.integer(req$seed %||% 1); alpha <- as.numeric(req$alpha %||% 0.05)
  if (B < 50 || B > 20000 || !is.finite(alpha) || alpha <= 0 || alpha >= 0.5) stop("Invalid CTA settings.")
  n <- ps_names(req$model$constructs)
  blocks <- Filter(function(j) length(n$inds[[j]]) >= 4, seq_along(n$inds))
  if (!length(blocks)) stop("CTA-PLS needs constructs with at least four indicators.")
  frame <- ps_frame(req, n)
  body <- c(PS_CTA_FUNCTIONS, ps_missing_code(req$missing),
    sprintf("blocks <- list(%s)", paste(vapply(blocks, function(j) sprintf("%s = %s", n$cv[[n$cname[j]]], ps_q(unname(n$iv[n$inds[[j]]]))), ""), collapse = ", ")),
    sprintf("set.seed(%d)", seed),
    sprintf("boot_rows <- replicate(%d, sample.int(nrow(data), replace = TRUE), simplify = FALSE)", B),
    "cta <- lapply(blocks, function(items) {",
    "  X <- as.matrix(data[, items]); tet <- cta_nonredundant(length(items)); S <- stats::cov(X)",
    "  est <- apply(tet, 1, function(t) cta_value(S, t))",
    "  boot <- t(sapply(boot_rows, function(r) { Sb <- stats::cov(X[r, , drop = FALSE]); apply(tet, 1, function(t) cta_value(Sb, t)) }))",
    "  if (nrow(tet) == 1) boot <- t(boot)",
    "  se <- apply(boot, 2, stats::sd); m <- nrow(tet)",
    sprintf("  ci <- t(sapply(seq_len(m), function(k) cta_bc(boot[, k], est[k], %s / m)))  # Bonferroni within the block", format(alpha)),
    "  data.frame(tetrad = apply(tet, 1, function(t) paste(items[t], collapse = \",\")), est = est, se = se, t = est / se,",
    "    p = 2 * stats::pnorm(-abs(est / se)), low = ci[, 1], high = ci[, 2], differs = ci[, 1] > 0 | ci[, 2] < 0)",
    "})")
  inputs <- list(data = frame)
  if (export) return(paste(ps_script("Confirmatory tetrad analysis (CTA-PLS)", "stats", inputs, body, "cta"), collapse = "\n"))
  env <- ps_run(body, inputs)
  back_i <- setNames(n$all_inds, unname(n$iv[n$all_inds]))
  back_c <- setNames(n$cname, unname(n$cv))
  ps_json(list(samples = B, alpha = alpha, blocks = lapply(names(env$cta), function(k) { d <- env$cta[[k]]
    list(construct = unname(back_c[k]), tetrads = lapply(seq_len(nrow(d)), function(i) list(
      tetrad = paste(unname(back_i[strsplit(d$tetrad[i], ",", fixed = TRUE)[[1]]]), collapse = ", "),
      est = d$est[i], se = d$se[i], t = d$t[i], p = d$p[i], low = d$low[i], high = d$high[i], differs = isTRUE(d$differs[i])))) }),
    warnings = env$.warnings, engine = list(package = "R (CTA-PLS as Gudergan et al. 2008)", version = as.character(getRversion()))))
}

#' Blindfolding (Stone 1974; Geisser 1974; Chin 1998): Q-squared, the
#' cross-validated redundancy of each endogenous reflective construct. Every
#' D-th data point of its block is omitted in turn (cell-wise, column by
#' column), replaced by the column mean, the model re-estimated, and the
#' omitted values predicted from the predecessor constructs' scores (loading
#' x predicted score). On standardised indicators, as semPLS. Q2 = 1 - SSE / SSO.
#' As semPLS's qSquared (Monecke & Leisch 2012) with mean imputation.
PS_BLINDFOLD_FUNCTIONS <- c(
  "blindfold <- function(data, block, endo, D) {",
  "  data <- as.data.frame(scale(data))  # standardised indicators",
  "  X <- as.matrix(data[, block, drop = FALSE]); SSE <- 0; SSO <- 0",
  "  for (j in seq_len(D)) {",
  "    blind <- matrix(FALSE, nrow(X), ncol(X)); blind[seq(j, length(X), by = D)] <- TRUE",
  "    Xb <- X; Xb[blind] <- NA",
  "    d <- data; d[, block] <- Xb",
  "    m <- colMeans(d, na.rm = TRUE); for (v in names(d)) d[[v]][is.na(d[[v]])] <- m[[v]]  # mean replacement",
  "    f <- blind_estimate(d); e <- f$Estimates",
  "    S <- e$Construct_scores; pred <- S[, setdiff(colnames(S), endo), drop = FALSE] %*% e$Path_estimates[endo, setdiff(colnames(S), endo)]",
  "    for (l in seq_along(block)) {",
  "      rows <- which(blind[, l]); if (!length(rows)) next",
  "      xhat <- pred[rows] * e$Loading_estimates[endo, block[l]] * stats::sd(d[[block[l]]]) + mean(d[[block[l]]])",
  "      SSE <- SSE + sum((X[rows, l] - xhat)^2, na.rm = TRUE)",
  "      SSO <- SSO + sum((X[rows, l] - mean(Xb[, l], na.rm = TRUE))^2, na.rm = TRUE)",
  "    }",
  "  }",
  "  c(SSE = SSE, SSO = SSO, Q2 = 1 - SSE / SSO)",
  "}")

ps_blindfold <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  D <- as.integer(req$distance %||% 7)
  if (D < 2 || D > 50) stop("Invalid omission distance.")
  b <- ps_plsx_build(req)
  cons <- req$model$constructs
  ends <- unique(vapply(req$model$paths, function(p) p$to, ""))
  refl <- vapply(cons, function(c) c$name %in% ends && identical(c$mode %||% "A", "A") && length(unlist(c$indicators)) > 0, TRUE)
  if (!any(refl)) stop("Blindfolding needs endogenous constructs with reflective (Mode A) indicators.")
  fit_line <- grep("^fit <- csem\\(data,", b$body, value = TRUE)[1]
  body <- c(b$body,
    sprintf("blind_estimate <- function(d) %s", sub("^fit <- ", "", sub("csem(data,", "csem(d,", fit_line, fixed = TRUE))),
    PS_BLINDFOLD_FUNCTIONS,
    sprintf("# Omission distance D = %d; every D-th cell of the block (column by column) is omitted in round j.", D),
    sprintf("targets <- list(%s)", paste(vapply(which(refl), function(j) sprintf("%s = %s", b$n$cv[[cons[[j]]$name]], ps_q(unname(b$n$iv[unlist(cons[[j]]$indicators)]))), ""), collapse = ", ")),
    sprintf("q2 <- t(sapply(names(targets), function(k) blindfold(data, targets[[k]], k, %d)))", D))
  if (export) return(paste(ps_script(sprintf("Blindfolding, D = %d (cSEM)", D), "cSEM", b$inputs, body, "q2"), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- setNames(names(b$n$cv), unname(b$n$cv))
  q <- env$q2
  ps_json(list(distance = D, n = nrow(b$inputs$data), divisible = nrow(b$inputs$data) %% D == 0,
    constructs = lapply(rownames(q), function(k) list(construct = unname(back[k]), sse = q[k, "SSE"], sso = q[k, "SSO"], q2 = q[k, "Q2"])),
    warnings = env$.warnings, engine = list(package = "cSEM (blindfolding as semPLS)", version = as.character(utils::packageVersion("cSEM")))))
}

#' Confirmatory composite analysis (CCA; Schuberth, Henseler & Dijkstra 2018;
#' Henseler 2021): every construct as a composite (emergent variable) of its
#' indicators, weights estimated with the structural model ignored (all
#' composites freely correlated), the bootstrap test of overall fit of the
#' saturated model (Beran & Srivastava 1985; cSEM's testOMF), and the weights,
#' loadings, Mode B VIFs and composite correlations to assess the composites.
ps_cca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  B <- as.integer(req$samples %||% 499); seed <- as.integer(req$seed %||% 1); alpha <- as.numeric(req$alpha %||% 0.05)
  if (B < 20 || B > 5000 || !is.finite(alpha) || alpha <= 0 || alpha >= 0.5) stop("Invalid CCA settings.")
  req$model$constructs <- lapply(req$model$constructs, function(c) { c$type <- "composite"; c })
  req$options$consistent <- FALSE
  b <- ps_plsx_build(req)
  fit_line <- grep("^fit <- csem\\(data,", b$body, value = TRUE)[1]
  if (identical(req$options$approach %||% "PLS-PM", "PLS-PM")) fit_line <- sub("\\)$", ", .PLS_ignore_structural_model = TRUE)", fit_line)
  body <- c(setdiff(b$body, grep("^fit <- csem\\(data,", b$body, value = TRUE)),
    "# Confirmatory composite analysis: all constructs are composites; the weights ignore the structural model (saturated).",
    fit_line,
    "# Overall model fit of the saturated composite model: bootstrap test (Beran & Srivastava 1985).",
    sprintf("set.seed(%d)", seed),
    sprintf("omf <- testOMF(fit, .R = %d, .seed = %d, .alpha = c(0.05, 0.01), .saturated = TRUE)", B, seed),
    "# The composites: weights and loadings with bootstrap percentile intervals, VIFs of the Mode B weights.",
    ps_cores_csem(req),
    sprintf("boot <- %s", sub("\\)$", sprintf(", .resample_method = \"bootstrap\", .R = %d, .seed = %d, .eval_plan = plan)", B, seed), sub("^fit <- ", "", fit_line))),
    sprintf("est <- summarize(boot, .alpha = %s, .ci = \"CI_percentile\")$Estimates", format(alpha)),
    "vif <- calculateVIFModeB(fit)",
    "cor_composites <- fit$Estimates$Construct_VCV")
  if (export) return(paste(ps_script("Confirmatory composite analysis (cSEM)", "cSEM", b$inputs, body,
    c("omf", "est$Weight_estimates", "est$Loading_estimates", "vif", "cor_composites")), collapse = "\n"))
  env <- ps_run(body, b$inputs)
  back <- ps_plsx_back(b)
  omf <- env$omf
  tab <- function(d) lapply(seq_len(nrow(d)), function(i) { p <- strsplit(d$Name[i], " (<~|=~) ")[[1]]
    list(construct = unname(back[p[1]]), indicator = unname(back[p[2]]), est = d$Estimate[i], se = d$Std_err[i], p = d$p_value[i],
      low = d[[grep("L$", names(d))[1]]][i], high = d[[grep("U$", names(d))[1]]][i]) })
  vif <- env$vif
  vifs <- if (is.null(vif) || !length(vif)) list() else unlist(lapply(rownames(vif), function(k) { v <- vif[k, ]; v <- v[is.finite(v) & v != 0]
    lapply(names(v), function(i) list(construct = unname(back[k]), indicator = unname(back[i]), vif = unname(v[i]))) }), recursive = FALSE)
  R <- env$cor_composites
  ps_json(list(samples = B, alpha = alpha, admissible = omf$Information$Number_admissibles,
    # (d_G with the natural logarithm, as Dijkstra & Henseler 2015 and the app's Fit tab; cSEM prints it with log base 10)
    fit = lapply(names(omf$Test_statistic), function(k) { s <- if (k == "dG") log(10)^2 else 1
      list(measure = k, statistic = s * unname(omf$Test_statistic[k]), q95 = s * unname(omf$Critical_value[k, "95%"]), q99 = s * unname(omf$Critical_value[k, "99%"])) }),
    weights = tab(env$est$Weight_estimates), loadings = tab(env$est$Loading_estimates), vif = vifs,
    composites = unname(back[rownames(R)]), correlations = unname(R),
    warnings = env$.warnings, engine = list(package = "cSEM", version = as.character(utils::packageVersion("cSEM")))))
}
