# Item-level measurement models: item response theory with ltm (Rizopoulos
# 2006: Rasch, two-parameter logistic, graded response, generalized partial
# credit) and latent class analysis with poLCA (Linzer & Lewis 2011).

ps_items_frame <- function(req) {
  items <- unlist(req$items)
  if (length(items) < 2) stop("Choose at least two items.")
  fr <- ps_long_frame(req, items)
  fr$items <- unname(fr$v[items])
  fr
}

ps_irt <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  model <- req$model %||% "twopl"
  if (!model %in% c("rasch", "twopl", "grm", "gpcm")) stop("Invalid IRT model in the request.")
  fr <- ps_items_frame(req)
  binary <- model %in% c("rasch", "twopl")
  call <- switch(model,
    rasch = "fit <- rasch(items)",
    twopl = "fit <- ltm(items ~ z1)",
    grm = "fit <- grm(items)",
    gpcm = "fit <- gpcm(items)")
  body <- c("suppressPackageStartupMessages(library(ltm))",
    sprintf("items <- data[, %s]", ps_q(fr$items)),
    if (binary) c("# Binary items: the two observed values become 0 and 1 (lower = 0).",
      "items[] <- lapply(items, function(v) { u <- sort(unique(v[!is.na(v)])); if (length(u) != 2) stop('Rasch and 2PL models need binary items; use the graded response or partial credit model for more categories.'); as.integer(v == u[2]) })")
    else "items[] <- lapply(items, function(v) as.integer(factor(v)))  # categories 1, 2, ..., in their order",
    call,
    "# Item parameters in the IRT parameterisation: difficulty / thresholds (b) and discrimination (a).",
    "pars <- if (inherits(fit, \"grm\") || inherits(fit, \"gpcm\")) ltm:::IRT.parm(fit)$parms else coef(fit)",
    "# Item and test information over the latent trait (theta).",
    "theta <- seq(-4, 4, by = 0.1)",
    "info <- plot(fit, type = \"IIC\", z = theta, plot = FALSE)",
    "# Reliability of the trait estimates (marginal), from the expected a posteriori scores.",
    "scores <- factor.scores(fit, method = \"EAP\")$score.dat")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("Item response model (%s, ltm)", model), "ltm", inputs, body,
    c("summary(fit)", "pars", "item.fit(fit)")), collapse = "\n"))
  env <- ps_run(body, inputs)
  fit <- env$fit
  pars <- env$pars
  if (is.list(pars) && !is.data.frame(pars)) {
    rows <- names(pars)
    params <- lapply(seq_along(pars), function(i) list(item = unname(fr$back[rows[i]]), values = as.list(pars[[i]])))
  } else {
    pars <- as.matrix(pars)
    params <- lapply(seq_len(nrow(pars)), function(i) list(item = unname(fr$back[rownames(pars)[i]]), values = as.list(pars[i, ])))
  }
  info <- env$info
  ifit <- tryCatch(ltm::item.fit(fit), error = function(e) NULL)
  sd <- env$scores
  # Marginal reliability: 1 - mean posterior variance / variance of the EAP scores (+ posterior variance).
  rel <- tryCatch({ v <- mean(sd$se.z1^2); 1 - v / (stats::var(sd$z1) + v) }, error = function(e) NULL)
  ps_json(list(model = model, n = nrow(env$items), items = unname(fr$back[fr$items]),
    params = params, logLik = as.numeric(logLik(fit)), aic = AIC(fit), bic = BIC(fit), reliability = rel,
    theta = unname(info[, 1]), information = lapply(seq_len(ncol(info) - 1), function(j) unname(info[, j + 1])),
    itemFit = if (is.null(ifit)) list() else lapply(seq_along(ifit$Tobs), function(i) list(item = unname(fr$back[names(ifit$Tobs)[i]]), x2 = unname(ifit$Tobs[i]), p = unname(ifit$p.values[i]))),
    warnings = env$.warnings, engine = list(package = "ltm", version = as.character(utils::packageVersion("ltm")))))
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
    sprintf("fits <- lapply(%s, function(k) { set.seed(%d); poLCA(%s, items, nclass = k, nrep = %d, maxiter = 5000, verbose = FALSE) })",
      paste(deparse(ks), collapse = ""), seed, f, nrep),
    "# Entropy-based classification quality (1 = perfectly separated classes).",
    "entropy <- function(m) { p <- m$posterior; k <- ncol(p); if (k == 1) return(NA); 1 - sum(-p * log(pmax(p, 1e-300))) / (nrow(p) * log(k)) }")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script("Latent class analysis (poLCA)", "poLCA", inputs, body,
    c("sapply(fits, function(m) c(classes = length(m$P), llik = m$llik, AIC = m$aic, BIC = m$bic, entropy = entropy(m)))", "fits")), collapse = "\n"))
  env <- ps_run(body, inputs)
  models <- lapply(env$fits, function(m) {
    ord <- order(-m$P)  # classes ordered by size
    list(k = length(m$P), llik = m$llik, npar = m$npar, aic = m$aic, bic = m$bic, gsq = m$Gsq, entropy = env$entropy(m),
      shares = unname(m$P[ord]),
      probs = lapply(seq_along(m$probs), function(i) list(item = unname(fr$back[fr$items[i]]),
        categories = levels(factor(fr$data[[fr$items[i]]])),
        byClass = lapply(ord, function(c) unname(m$probs[[i]][c, ])))))
  })
  ps_json(list(n = nrow(env$items), items = unname(fr$back[fr$items]), models = models,
    warnings = env$.warnings, engine = list(package = "poLCA", version = as.character(utils::packageVersion("poLCA")))))
}
