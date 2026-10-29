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
  b <- ps_plsx_build(req)
  folds <- as.integer(req$folds %||% 10); reps <- as.integer(req$repetitions %||% 10); seed <- as.integer(req$seed %||% 1)
  if (folds < 2 || folds > 50 || reps < 1 || reps > 100) stop("Invalid cross-validation settings.")
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
    sprintf("mga <- testMGD(fit, .approach_mgd = %s, .R_permutation = %d, .R_bootstrap = %d, .seed = %d, .verbose = FALSE)", ps_q(approaches), R, R, seed))
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
    if (a == "Klesel") return(list(approach = a, overall = list(dG = list(statistic = x$Test_statistic[["dG"]], p = x$P_value[["dG"]]), dL = list(statistic = x$Test_statistic[["dL"]], p = x$P_value[["dL"]]))))
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
