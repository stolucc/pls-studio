# Bootstrapping with the packages' own resampling: cSEM (csem(.resample_method
# = "bootstrap")), seminr (bootstrap_model) and lavaan (bootstrapLavaan). The
# draws are summarised the same way for all (mean, SD, t = original / SD with
# df = draws - 1, percentile interval), keyed like the app's built-in bootstrap.

#' Summarise a draws matrix (rows = bootstrap samples, named columns).
#' Lines of R that define it, so exported scripts carry the same summary.
PS_BOOT_SUMMARY <- c(
  "# Each parameter over the draws where it is defined (e.g. an R\u00b2 can be undefined in an improper draw).",
  "boot_summary <- function(draws, original, confidence) {",
  "  a <- (1 - confidence) / 2",
  "  one <- function(x, o) { x <- x[is.finite(x)]; s <- stats::sd(x); t <- o / s",
  "    c(original = o, mean = mean(x), sd = s, t = t, p = 2 * stats::pt(-abs(t), df = length(x) - 1),",
  "      ci_low = unname(stats::quantile(x, a)), ci_high = unname(stats::quantile(x, 1 - a)), draws = length(x)) }",
  "  out <- t(vapply(seq_len(ncol(draws)), function(j) one(draws[, j], original[[j]]), numeric(8)))",
  "  data.frame(parameter = colnames(draws), out, row.names = NULL, check.names = FALSE)",
  "}")

# Cores for bootstrapping in desktop R. The browser's R has one core (cores
# <- 1); through the desktop helper the request asks for the helper's cores.
#' cSEM's parallel plan with req$cores processes (1 to 64; 1 = sequential).
#' cSEM draws every sample from its own seed, so the results are identical
#' for any number of cores.
ps_cores_csem <- function(req) {
  n <- suppressWarnings(as.integer(req$cores %||% 1L))
  if (length(n) != 1 || is.na(n) || n < 1) n <- 1L
  n <- min(n, 64L)
  c("# Parallel resampling in desktop R: cores > 1. cSEM's results are identical for any number of cores.",
    sprintf("cores <- %d", n),
    "plan <- if (cores == 1) \"sequential\" else if (.Platform$OS.type == \"windows\") \"multisession\" else \"multicore\"",
    "options(mc.cores = cores)  # (the number of processes of cSEM's parallel plan)")
}
#' seminr's bootstrap with req$cores processes (its results are identical for any number of cores).
ps_cores_seminr <- function(req) c(
  "# Parallel bootstrapping in desktop R: cores > 1 (seminr's results are identical for any number of cores).",
  ps_cores_csem(req)[2])
PS_CORES_LAVAAN <- c(
  "# Parallel bootstrapping in desktop R (macOS / Linux): cores > 1 is much faster, but lavaan's draws then",
  "# depend on the number of cores, so the results differ from PLS Studio's (which uses cores <- 1).",
  "cores <- 1")

#' Parallel bootstrap (PLS Studio's "parallel workers" option): the samples are
#' drawn in chunks (req$boot$chunkR samples with seed req$boot$chunkSeed each),
#' so the draws do not depend on how many R sessions share the work. `chunk_fn`
#' is the R code of `draw_chunk(R, seed)`, which returns list(draws, original).
#' In the app, one call draws one chunk (req$boot$part = k, returning its draws)
#' and a last call summarises all of them (req$boot$draws); the exported script
#' draws every chunk in turn.
ps_boot_chunked <- function(req) !is.null(req$boot$chunkR)
ps_boot_draw_lines <- function(req, chunk_fn) {
  R <- as.integer(req$boot$chunkR); seeds <- as.integer(req$boot$chunkSeed)
  if (!length(R) || length(R) != length(seeds) || anyNA(R) || anyNA(seeds) || any(R < 1)) stop("Invalid bootstrap chunks in the request.")
  part <- req$boot$part
  if (!is.null(req$boot$draws)) return(c("# The draws of all chunks (computed in parallel R sessions).",
    "draws <- boot_draws; original <- boot_original"))
  if (!is.null(part)) { part <- as.integer(part); if (is.na(part) || part < 1 || part > length(R)) stop("Invalid bootstrap chunk."); R <- R[part]; seeds <- seeds[part] }
  c(chunk_fn,
    sprintf("# Parallel bootstrap: the samples in %d chunk%s, chunk k drawn with its own seed, so the draws", length(R), if (length(R) > 1) "s" else ""),
    "# do not depend on the number of R sessions; the chunks can run in parallel (e.g. parallel::mclapply).",
    sprintf("chunks <- data.frame(R = c(%s), seed = c(%s))", paste(R, collapse = ", "), paste(seeds, collapse = ", ")),
    "parts <- lapply(seq_len(nrow(chunks)), function(k) draw_chunk(chunks$R[k], chunks$seed[k]))",
    "draws <- do.call(rbind, lapply(parts, `[[`, \"draws\")); original <- parts[[1]]$original")
}
#' Inputs of the summarising call: the draws of all chunks (req$boot$draws: {names, rows}) and the originals.
ps_boot_inputs <- function(req, inputs) {
  d <- req$boot$draws
  if (is.null(d)) return(inputs)
  v <- d$values
  # (a JSON array of rows arrives as a matrix, or as a list of rows when they contain nulls)
  m <- if (is.matrix(v)) v else do.call(rbind, lapply(v, function(r) as.numeric(vapply(r, function(x) if (is.null(x)) NA_real_ else as.numeric(x), 0))))
  m <- matrix(as.numeric(m), nrow = nrow(m), dimnames = list(NULL, d$names))
  c(inputs, list(boot_draws = m, boot_original = setNames(as.numeric(unlist(d$original)), d$names)))
}
#' The draws of one chunk as JSON (in-app parallel calls).
ps_boot_part_json <- function(env) {
  D <- env$draws
  ps_json(list(names = colnames(D), values = unname(lapply(seq_len(nrow(D)), function(i) unname(D[i, ]))), original = unname(env$original[colnames(D)]), warnings = ps_quiet_2ndorder(env$.warnings)))
}

ps_pls_boot <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_pls_build(req, allow_hoc = TRUE, allow_mi = TRUE)
  mi <- identical(req$missing, "mi")
  if (mi && ps_boot_chunked(req)) stop("With multiple imputation the bootstrap runs in one piece per imputed data set.")
  B <- as.integer(req$boot$samples); seed <- as.integer(req$boot$seed); conf <- ps_number(req$boot$confidence, "confidence level")
  body <- b$body
  # seminr's bootstrap always starts a PSOCK cluster (worker processes), which
  # R in the browser (webR) cannot do. The exported script runs in desktop R.
  if (b$pkg == "seminr" && !export && grepl("emscripten", R.version$platform)) {
    stop("seminr's bootstrap needs worker processes, which R in the browser cannot start. Bootstrap with cSEM, or export the seminr bootstrap script and run it in R.")
  }
  if (b$pkg == "cSEM") {
    # Same call with cSEM's resampling; R² per draw via a user function.
    body <- c(ps_cores_csem(req), body)
    extract <- c(
      if (any(b$hoc)) "res <- fit$Second_stage$Information$Resamples$Estimates$Estimates1  # (two-stage: both stages are resampled together)"
      else "res <- fit$Estimates$Estimates_resample$Estimates1",
      "groups <- c(path = \"Path_estimates\", total = \"Total_effect\", indirect = \"Indirect_effect\", loading = \"Loading_estimates\", weight = \"Weight_estimates\", r2 = \"R2\")",
      "# (a model without indirect effects has none to resample)",
      "groups <- groups[vapply(groups, function(k) length(res[[k]]$Original) > 0, TRUE)]",
      "draws <- do.call(cbind, lapply(names(groups), function(g) { x <- as.matrix(res[[groups[[g]]]]$Resampled); colnames(x) <- paste0(g, \": \", names(res[[groups[[g]]]]$Original)); x }))",
      "original <- unlist(lapply(names(groups), function(g) setNames(res[[groups[[g]]]]$Original, paste0(g, \": \", names(res[[groups[[g]]]]$Original)))))")
    resample <- if (any(b$hoc)) ", .resample_method = \"bootstrap\", .R = %s, .seed = %s, .eval_plan = plan, .user_funs = list(R2 = function(.object) { r <- .object$Second_stage$Estimates$R2; setNames(r, sub(\"_temp$\", \"\", names(r))) }))"
      else ", .resample_method = \"bootstrap\", .R = %s, .seed = %s, .eval_plan = plan, .user_funs = list(R2 = function(.object) .object$Estimates$R2))"
    if (ps_boot_chunked(req)) {
      body <- c(body, ps_boot_draw_lines(req, c("draw_chunk <- function(R, seed) {",
        sprintf("  fit <- %s", sub(")$", sprintf(resample, "R", "seed"), sub("^fit <- ", "", body[length(body)]))),
        paste0("  ", extract), "  list(draws = draws, original = original)", "}")))
    } else {
      body[length(body)] <- sub(")$", sprintf(resample, B, seed), body[length(body)])
      body <- c(body, extract)
    }
  } else {
    body <- c(body,
      ps_cores_seminr(req),
      sprintf("boot <- bootstrap_model(fit, nboot = %d, seed = %d, cores = cores)", B, seed),
      "# Draws as columns \"group: row -> column\" (paths: from -> to; loadings/weights: indicator -> construct).",
      "flat <- function(a, g, keep) { d <- dim(a); out <- t(matrix(a, nrow = d[1] * d[2])); colnames(out) <- paste0(g, \": \", as.vector(outer(dimnames(a)[[1]], dimnames(a)[[2]], paste, sep = \" -> \"))); out[, as.vector(keep), drop = FALSE] }",
      "orig <- function(m, g, keep) setNames(as.vector(m)[as.vector(keep)], paste0(g, \": \", as.vector(outer(rownames(m), colnames(m), paste, sep = \" -> \")))[as.vector(keep)])",
      "P <- fit$path_coef; TE <- summary(fit)$total_effects[rownames(P), colnames(P)]",
      "kp <- P != 0; kt <- abs(TE) > 1e-12; ki <- abs(TE - P) > 1e-12; kl <- fit$outer_loadings != 0; kw <- fit$outer_weights != 0",
      "draws <- cbind(flat(boot$boot_paths, \"path\", kp), flat(boot$boot_total_paths, \"total\", kt), flat(boot$boot_total_paths - boot$boot_paths, \"indirect\", ki),",
      "  flat(boot$boot_loadings, \"loading\", kl), flat(boot$boot_weights, \"weight\", kw))",
      "original <- c(orig(P, \"path\", kp), orig(TE, \"total\", kt), orig(TE - P, \"indirect\", ki), orig(fit$outer_loadings, \"loading\", kl), orig(fit$outer_weights, \"weight\", kw))")
  }
  body <- c(body, PS_BOOT_SUMMARY, sprintf("result <- boot_summary(draws, original[colnames(draws)], confidence = %s)", format(conf)))
  title <- sprintf("Bootstrap, %d samples (%s)", B, b$pkg)
  if (mi) {
    # Multiple imputation: the bootstrap in every imputed data set (same seed), pooled by Rubin's rules.
    if (export) stop("The bootstrap with multiple imputation runs per imputed data set and is not exported as one script; export the estimation script.")
    imp <- ps_impute(req, b$inputs)
    envs <- lapply(seq_len(imp$m), function(k) ps_run(body, list(data = mice::complete(imp, k))))
    pooled <- ps_rubin(lapply(envs, function(e) e$result), conf)
    return(ps_json(list(stats = ps_boot_keys(pooled, b, req), samples = B, imputations = imp$m,
      failed = max(vapply(envs, function(e) B - sum(rowSums(is.finite(e$draws)) > 0), 0)),
      confidence = conf, warnings = unique(unlist(lapply(envs, function(e) ps_quiet_2ndorder(e$.warnings)))))))
  }
  if (export) return(paste(ps_script(title, b$pkg, b$inputs, body, "print(result, digits = 4)"), collapse = "\n"))
  if (ps_boot_chunked(req) && !is.null(req$boot$part)) return(ps_boot_part_json(ps_run(body[seq_len(grep("^result <- boot_summary", body) - 1)], b$inputs)))
  env <- ps_run(body, ps_boot_inputs(req, b$inputs))
  ps_json(list(stats = ps_boot_keys(env$result, b, req), samples = B, failed = B - sum(rowSums(is.finite(env$draws)) > 0),
    confidence = conf, warnings = ps_quiet_2ndorder(env$.warnings)))
}

#' Map package parameter names to the app's bootstrap keys (path:from:to, loading:indicator, …).
ps_boot_keys <- function(r, b, req) {
  n <- b$n
  lv <- c(setNames(n$cname, b$cv), setNames(vapply(b$mods, function(m) ps_int_name(m$from, m$moderator), ""), b$int_l))
  ind <- setNames(n$all_inds, unname(n$iv[n$all_inds]))
  out <- list()
  for (i in seq_len(nrow(r))) {
    g <- sub(":.*", "", r$parameter[i]); x <- sub("^[a-z0-9]+: ", "", r$parameter[i])
    if (b$pkg == "cSEM") {
      parts <- strsplit(x, " (~|=~|<~) ")[[1]]
      lhs <- parts[1]; rhs <- parts[2]
      if (g == "r2") { lhs <- x; rhs <- NA }
    } else {
      parts <- strsplit(x, " -> ")[[1]]
      # seminr: [from, to] for paths; [indicator, construct] for loadings/weights.
      if (g %in% c("loading", "weight")) { lhs <- parts[2]; rhs <- parts[1] } else { lhs <- parts[2]; rhs <- parts[1] }
    }
    # Skip package-internal entries (e.g. seminr's "X*M_intxn" pseudo-indicator).
    if (!(lhs %in% names(lv)) || (!is.na(rhs) && !(rhs %in% c(names(lv), names(ind))))) next
    # A second-order construct's loading / weight on a component (cSEM: "H =~ C", "H <~ C").
    if (g %in% c("loading", "weight") && !is.na(rhs) && rhs %in% names(lv)) {
      out[[length(out) + 1]] <- c(list(key = sprintf("%s:%s:%s", if (g == "loading") "hoLoading" else "hoWeight", lv[[lhs]], lv[[rhs]]),
        label = if (g == "loading") sprintf("%s → %s", lv[[lhs]], lv[[rhs]]) else sprintf("%s → %s", lv[[rhs]], lv[[lhs]])),
        list(group = g, original = r$original[i], mean = r$mean[i], sd = r$sd[i], t = r$t[i], p = r$p[i], ciLow = r$ci_low[i], ciHigh = r$ci_high[i]))
      next
    }
    key <- switch(g,
      path = , total = , indirect = { f <- lv[[rhs]]; t <- lv[[lhs]]; list(key = sprintf("%s:%s:%s", g, f, t), label = sprintf("%s → %s", f, t)) },
      loading = list(key = sprintf("loading:%s", ind[[rhs]]), label = sprintf("%s → %s", lv[[lhs]], ind[[rhs]])),
      weight = list(key = sprintf("weight:%s", ind[[rhs]]), label = sprintf("%s → %s", ind[[rhs]], lv[[lhs]])),
      r2 = list(key = sprintf("r2:%s", lv[[lhs]]), label = lv[[lhs]]))
    out[[length(out) + 1]] <- c(key, list(group = g, original = r$original[i], mean = r$mean[i], sd = r$sd[i], t = r$t[i], p = r$p[i], ciLow = r$ci_low[i], ciHigh = r$ci_high[i]))
  }
  out
}

#' The draws of a lavaan / modsem bootstrap: `draw` is the R code of one run of
#' R samples from seed `seed` (a matrix, a row per sample); all B at once, or in
#' chunks (parallel option).
ps_cb_draws <- function(req, setup, expr, B, seed) {
  if (ps_boot_chunked(req)) return(ps_boot_draw_lines(req, c("draw_chunk <- function(R, seed) {", paste0("  ", setup),
    paste0(c("  draws <- ", rep("  ", length(expr) - 1)), expr), "  list(draws = draws, original = original)", "}")))
  c(sprintf("R <- %d; seed <- %d", B, seed), setup, paste0(c("draws <- ", rep("", length(expr) - 1)), expr))
}

ps_cb_boot <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  b <- ps_cb_build(req)
  if (isTRUE(b$robust)) stop("Robust ML (rsem) has its own robust standard errors; the bootstrap resamples the raw data with ML or MLR.")
  if (isTRUE(b$mi)) stop("With multiple imputation the standard errors are pooled by Rubin's rules; the bootstrap is not combined with it.")
  if (b$matrix_input) stop("Bootstrapping needs raw data; this dataset is a covariance matrix.")
  B <- as.integer(req$boot$samples); seed <- as.integer(req$boot$seed); conf <- ps_number(req$boot$confidence, "confidence level")
  if (!is.null(b$modsem)) return(ps_cb_boot_modsem(b, B, seed, conf, export, req))
  body <- c(b$body,
    "# Standardised paths, total and indirect effects, loadings and R² of one fitted model;",
    "# with several groups or levels (blocks) each statistic is named \"... @block\".",
    "std_stats <- function(f, keep = NULL) {",
    "  # parameterEstimates keeps the group / level columns (standardizedSolution drops them for two-level models).",
    "  ss_all <- parameterEstimates(f, se = FALSE, standardized = TRUE); ss_all$est.std <- ss_all$std.all",
    "  nb <- lavInspect(f, \"ngroups\") * lavInspect(f, \"nlevels\"); r2_all <- lavInspect(f, \"r2\")",
    "  v <- unlist(lapply(seq_len(nb), function(bk) {",
    "  # The block of each row: its group or its level (standardizedSolution names whichever applies).",
    "  blk <- if (\"block\" %in% names(ss_all)) ss_all$block else if (\"group\" %in% names(ss_all) && max(ss_all$group) > 1) ss_all$group else if (\"level\" %in% names(ss_all)) ss_all$level else rep(1L, nrow(ss_all))",
    "  ss <- if (nb > 1) ss_all[blk == bk, ] else ss_all",
    "  lv <- lavNames(f, \"lv\"); reg <- ss[ss$op == \"~\", ]",
    "  vars <- unique(c(lv, reg$lhs, reg$rhs))",
    "  Bm <- matrix(0, length(vars), length(vars), dimnames = list(vars, vars))  # [from, to]",
    "  for (i in seq_len(nrow(reg))) Bm[reg$rhs[i], reg$lhs[i]] <- reg$est.std[i]",
    "  Tm <- solve(diag(length(vars)) - Bm) - diag(length(vars)); dimnames(Tm) <- dimnames(Bm)",
    "  tot <- which(abs(Tm) > 1e-12, arr.ind = TRUE); ind <- which(abs(Tm - Bm) > 1e-12, arr.ind = TRUE)",
    "  ld <- ss[ss$op == \"=~\" & !(ss$rhs %in% lv), ]; wt <- ss[ss$op == \"<~\", ]  # loadings; composite weights",
    "  r2 <- if (nb > 1) r2_all[[bk]] else r2_all; r2 <- r2[names(r2) %in% unique(reg$lhs)]",
    "  # (paste0 turns an empty vector into one empty string: name only non-empty groups)",
    "  lab <- function(g, a, b = NULL) if (length(a)) paste0(g, \": \", a, if (!is.null(b)) paste0(\" -> \", b)) else character(0)",
    "  v <- c(setNames(reg$est.std, lab(\"path\", reg$rhs, reg$lhs)),",
    "    setNames(Tm[tot], lab(\"total\", vars[tot[, 1]], vars[tot[, 2]])),",
    "    setNames((Tm - Bm)[ind], lab(\"indirect\", vars[ind[, 1]], vars[ind[, 2]])),",
    "    setNames(ld$est.std, lab(\"loading\", ld$lhs, ld$rhs)),",
    "    setNames(wt$est.std, lab(\"weight\", wt$lhs, wt$rhs)),",
    "    setNames(unname(r2), lab(\"r2\", names(r2))))",
    "  if (nb > 1 && length(v)) names(v) <- paste0(names(v), \" @\", bk)",
    "  v",
    "  }))",
    "  # Every draw reports the original's parameters, in the same order.",
    "  if (is.null(keep)) v else setNames(v[keep], keep)",
    "}",
    "original <- std_stats(fit)",
    if (!is.null(b$cluster_var)) c(
      "# Two-level model: lavaan does not bootstrap multilevel models, so whole clusters are resampled",
      "# with replacement (each drawn cluster gets a new id) and the model is refitted.",
      sprintf("refit <- function(d) %s", sub("data = data", "data = d", sub("^fit <- ", "", b$call), fixed = TRUE)),
      sprintf("cl <- data[[\"%s\"]]; boot_errors <- character(0)", b$cluster_var),
      if (!is.null(b$group_var)) c("# With groups, clusters are resampled within their group (so every group keeps its number of clusters).",
        sprintf("strata <- split(unique(cl), data[[\"%s\"]][match(unique(cl), cl)])", b$group_var))
      else "strata <- list(unique(cl))",
      ps_cb_draws(req, "set.seed(seed)", c(
        "t(vapply(seq_len(R), function(r) {",
        "  s <- unlist(lapply(strata, function(ids) ids[sample.int(length(ids), replace = TRUE)]), use.names = FALSE)",
        sprintf("  d <- do.call(rbind, lapply(seq_along(s), function(k) { x <- data[cl == s[k], , drop = FALSE]; x[[\"%s\"]] <- k; x }))", b$cluster_var),
        "  tryCatch(std_stats(refit(d), names(original)),",
        "    error = function(e) { boot_errors <<- c(boot_errors, conditionMessage(e)); rep(NA_real_, length(original)) })",
        "}, numeric(length(original))))"), B, seed),
      sprintf("if (length(boot_errors)) warning(sprintf(\"%%d of %d cluster resamples failed, e.g.: %%s\", length(boot_errors), boot_errors[1]))", B))
    else c(PS_CORES_LAVAAN,
      ps_cb_draws(req, NULL, c(
        "bootstrapLavaan(fit, R = R, FUN = function(f) std_stats(f, names(original)), iseed = seed,",
        "  parallel = if (cores > 1) \"multicore\" else \"no\", ncpus = cores)"), B, seed)),
    "colnames(draws) <- names(original)",
    PS_BOOT_SUMMARY,
    sprintf("result <- boot_summary(draws, original, confidence = %s)", format(conf)))
  if (export) return(paste(ps_script(sprintf("Bootstrap, %d samples (lavaan)", B), "lavaan", b$inputs, body, "print(result, digits = 4)"), collapse = "\n"))
  if (ps_boot_chunked(req) && !is.null(req$boot$part)) return(ps_boot_part_json(ps_run(body[seq_len(grep("^result <- boot_summary", body) - 1)], b$inputs)))
  env <- ps_run(body, ps_boot_inputs(req, b$inputs))
  constructs <- c(b$n$cname, b$int_names)
  back <- c(setNames(constructs, unname(b$lname[constructs])), setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds])))
  r <- env$result
  # Several groups or levels: statistics per block ("... @2"), between-level factors named *_b.
  back <- c(back, setNames(constructs, paste0(unname(b$lname[constructs]), "_b")))
  blocks <- if (!is.null(b$cluster_var) && is.null(b$group_var)) c("Within", "Between") else NULL
  stats <- lapply(seq_len(nrow(r)), function(i) {
    par <- r$parameter[i]
    block <- if (grepl(" @[0-9]+$", par)) as.integer(sub(".* @", "", par)) else NULL
    par <- sub(" @[0-9]+$", "", par)
    g <- sub(":.*", "", par); parts <- strsplit(sub("^[a-z0-9]+: ", "", par), " -> ")[[1]]
    a <- unname(back[parts[1]]); z <- if (length(parts) > 1) unname(back[parts[2]]) else NA
    k <- switch(g, path = , total = , indirect = list(key = sprintf("%s:%s:%s", g, a, z), label = sprintf("%s → %s", a, z)),
      loading = list(key = sprintf("loading:%s", z), label = sprintf("%s → %s", a, z)),
      weight = list(key = sprintf("weight:%s", z), label = sprintf("%s → %s", z, a)),
      r2 = list(key = sprintf("r2:%s", a), label = a))
    c(k, list(group = g, block = block, original = r$original[i], mean = r$mean[i], sd = r$sd[i], t = r$t[i], p = r$p[i], ciLow = r$ci_low[i], ciHigh = r$ci_high[i]))
  })
  ps_json(list(stats = stats, samples = B, blocks = blocks, failed = B - sum(rowSums(is.finite(env$draws)) > 0), confidence = conf, warnings = ps_quiet_2ndorder(env$.warnings)))
}

#' Bootstrap of a latent-interaction model estimated by LMS or QML (modsem).
#' modsem has no bootstrap of its own, so cases are resampled with replacement
#' and the model refitted; the statistics are modsem's standardised estimates.
ps_cb_boot_modsem <- function(b, B, seed, conf, export, req) {
  fit_line <- b$body[length(b$body)]
  body <- c(b$body,
    "# Standardised paths (the interaction X:Z included), total and indirect effects, loadings",
    "# and R\u00b2 of one fitted model, from modsem's standardized_estimates().",
    "std_stats <- function(f, keep = NULL) {",
    "  ss <- standardized_estimates(f)",
    "  reg <- ss[ss$op == \"~\", ]; ld <- ss[ss$op == \"=~\", ]",
    "  vars <- unique(c(ld$lhs, reg$lhs, reg$rhs))",
    "  Bm <- matrix(0, length(vars), length(vars), dimnames = list(vars, vars))  # [from, to]",
    "  for (i in seq_len(nrow(reg))) Bm[reg$rhs[i], reg$lhs[i]] <- reg$est[i]",
    "  Tm <- solve(diag(length(vars)) - Bm) - diag(length(vars)); dimnames(Tm) <- dimnames(Bm)",
    "  tot <- which(abs(Tm) > 1e-12, arr.ind = TRUE); ind <- which(abs(Tm - Bm) > 1e-12, arr.ind = TRUE)",
    "  # R\u00b2: one minus the standardised residual variance of each outcome.",
    "  en <- unique(reg$lhs)",
    "  r2 <- vapply(en, function(v) { r <- ss[ss$op == \"~~\" & ss$lhs == v & ss$rhs == v, ]; if (nrow(r)) 1 - r$est[1] else NA_real_ }, 0)",
    "  lab <- function(g, a, b = NULL) if (length(a)) paste0(g, \": \", a, if (!is.null(b)) paste0(\" -> \", b)) else character(0)",
    "  v <- c(setNames(reg$est, lab(\"path\", reg$rhs, reg$lhs)),",
    "    setNames(Tm[tot], lab(\"total\", vars[tot[, 1]], vars[tot[, 2]])),",
    "    setNames((Tm - Bm)[ind], lab(\"indirect\", vars[ind[, 1]], vars[ind[, 2]])),",
    "    setNames(ld$est, lab(\"loading\", ld$lhs, ld$rhs)),",
    "    setNames(unname(r2), lab(\"r2\", en)))",
    "  if (is.null(keep)) v else setNames(v[keep], keep)",
    "}",
    "original <- std_stats(fit)",
    "# modsem has no bootstrap of its own: cases are resampled with replacement and the model refitted.",
    "# (LMS refits are slow: expect seconds per sample.)",
    sprintf("refit <- function(d) %s", sub("data = data", "data = d", sub("^fit <- ", "", fit_line), fixed = TRUE)),
    "boot_errors <- character(0); boot_warnings <- character(0)",
    ps_cb_draws(req, "set.seed(seed)", c(
      "t(vapply(seq_len(R), function(r) {",
      "  d <- data[sample.int(nrow(data), replace = TRUE), , drop = FALSE]",
      "  # Warnings of single refits are counted, not repeated for every sample.",
      "  withCallingHandlers(tryCatch(std_stats(refit(d), names(original)),",
      "    error = function(e) { boot_errors <<- c(boot_errors, conditionMessage(e)); rep(NA_real_, length(original)) }),",
      "    warning = function(w) { boot_warnings <<- c(boot_warnings, conditionMessage(w)); invokeRestart(\"muffleWarning\") })",
      "}, numeric(length(original))))"), B, seed),
    sprintf("if (length(boot_errors)) warning(sprintf(\"%%d of %d bootstrap refits failed, e.g.: %%s\", length(boot_errors), boot_errors[1]))", B),
    "if (length(boot_warnings)) warning(sprintf(\"%d warnings in the bootstrap refits, e.g.: %s\", length(boot_warnings), boot_warnings[1]))",
    "colnames(draws) <- names(original)",
    PS_BOOT_SUMMARY,
    sprintf("result <- boot_summary(draws, original, confidence = %s)", format(conf)))
  title <- sprintf("Bootstrap, %d samples (%s, modsem)", B, toupper(b$modsem))
  if (export) return(paste(ps_script(title, c("modsem", "lavaan"), b$inputs, body, "print(result, digits = 4)"), collapse = "\n"))
  if (ps_boot_chunked(req) && !is.null(req$boot$part)) return(ps_boot_part_json(ps_run(body[seq_len(grep("^result <- boot_summary", body) - 1)], b$inputs)))
  env <- ps_run(body, ps_boot_inputs(req, b$inputs))
  constructs <- c(b$n$cname, b$int_names)
  back <- c(setNames(constructs, unname(b$lname[constructs])), setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds])))
  r <- env$result
  stats <- lapply(seq_len(nrow(r)), function(i) {
    par <- r$parameter[i]
    g <- sub(":.*", "", par); parts <- strsplit(sub("^[a-z0-9]+: ", "", par), " -> ")[[1]]
    a <- unname(back[parts[1]]); z <- if (length(parts) > 1) unname(back[parts[2]]) else NA
    if (is.na(a) || (length(parts) > 1 && is.na(z))) return(NULL)
    k <- switch(g, path = , total = , indirect = list(key = sprintf("%s:%s:%s", g, a, z), label = sprintf("%s → %s", a, z)),
      loading = list(key = sprintf("loading:%s", z), label = sprintf("%s → %s", a, z)),
      r2 = list(key = sprintf("r2:%s", a), label = a))
    c(k, list(group = g, original = r$original[i], mean = r$mean[i], sd = r$sd[i], t = r$t[i], p = r$p[i], ciLow = r$ci_low[i], ciHigh = r$ci_high[i]))
  })
  ps_json(list(stats = Filter(Negate(is.null), stats), samples = B, failed = B - sum(rowSums(is.finite(env$draws)) > 0),
    confidence = conf, warnings = ps_quiet_2ndorder(env$.warnings)))
}

#' cSEM's two-stage approach always corrects a second-order common factor in stage 2
#' and warns that it set .disattenuate; the script says so, the app does not repeat it.
ps_quiet_2ndorder <- function(w) grep("`.disattenuate = FALSE` is set to `TRUE`", w, value = TRUE, invert = TRUE, fixed = TRUE)

#' Rubin's rules for bootstrap results from m imputed data sets (one boot_summary table each):
#' the estimate is the mean of the m estimates; its variance T = W + (1 + 1/m) B, with W the mean
#' bootstrap variance and B the variance of the estimates between imputations; t with Rubin's (1987)
#' degrees of freedom, and the interval estimate +- t quantile * sqrt(T).
ps_rubin <- function(rs, confidence) {
  m <- length(rs)
  params <- Reduce(intersect, lapply(rs, function(r) r$parameter))
  rows <- lapply(params, function(p) {
    q <- vapply(rs, function(r) r$original[r$parameter == p][1], 0)
    u <- vapply(rs, function(r) r$sd[r$parameter == p][1]^2, 0)
    bm <- vapply(rs, function(r) r$mean[r$parameter == p][1], 0)
    qbar <- mean(q); W <- mean(u); Bv <- stats::var(q); Tv <- W + (1 + 1 / m) * Bv
    rr <- (1 + 1 / m) * Bv / W
    df <- if (!is.finite(rr) || rr <= 0) Inf else (m - 1) * (1 + 1 / rr)^2
    t <- qbar / sqrt(Tv); h <- stats::qt((1 + confidence) / 2, df) * sqrt(Tv)
    data.frame(parameter = p, original = qbar, mean = mean(bm), sd = sqrt(Tv), t = t, p = 2 * stats::pt(-abs(t), df), ci_low = qbar - h, ci_high = qbar + h)
  })
  do.call(rbind, rows)
}
