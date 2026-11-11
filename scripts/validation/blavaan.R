# Native check of the Bayesian SEM card (ps_bsem in src/rengine/R/bayes.R), which
# runs in desktop R only: the app's own R code is sourced, the help page's model
# (blavaan ?bcfa, Holzinger & Swineford) is sent as the app sends it, and the
# result is compared with a direct blavaan call with the same settings and seed:
# every posterior mean, SD, interval, R-hat and n_eff, and the fit measures.
# Stops on any difference; writes src/engine/__fixtures__/blavaan/reference.json.
#   R_LIBS=<library with lavaan, blavaan, jsonlite> Rscript scripts/validation/blavaan.R
suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(blavaan)
})
for (f in c("common", "longitudinal", "regression", "tests", "lavaan", "bayes")) source(file.path("src/rengine/R", paste0(f, ".R")))
data(HolzingerSwineford1939, package = "lavaan")
x <- HolzingerSwineford1939[, paste0("x", 1:9)]
fac <- function(nm, ind) list(name = nm, type = "factor", mode = "A", indicators = ind)
req <- function(ident) {
  toJSON(list(
    kind = "cb", estimator = "ML", missing = "casewise", data = list(names = names(x), cols = unname(lapply(x, as.numeric))),
    model = list(
      constructs = list(fac("visual", paste0("x", 1:3)), fac("textual", paste0("x", 4:6)), fac("speed", paste0("x", 7:9))), paths = list(),
      covariances = list(list(a = "visual", b = "textual", kind = "construct"), list(a = "visual", b = "speed", kind = "construct"), list(a = "textual", b = "speed", kind = "construct"))
    ),
    chains = 3, burnin = 500, sample = 1000, seed = 1234, confidence = 0.95, identification = ident
  ), auto_unbox = TRUE, digits = NA)
}
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
out <- list()
for (ident in c("marker", "unit")) {
  app <- fromJSON(ps_bsem(req(ident)), simplifyVector = FALSE)
  f <- suppressWarnings(bcfa(m, data = x, n.chains = 3, burnin = 500, sample = 1000, seed = 1234, std.lv = ident == "unit", bcontrol = list(cores = 1)))
  d <- do.call(rbind, lapply(blavInspect(f, "mcmc"), as.matrix))
  direct <- lapply(colnames(d), function(p) {
    list(
      par = p, mean = mean(d[, p]), sd = sd(d[, p]), low = unname(quantile(d[, p], 0.025)), high = unname(quantile(d[, p], 0.975)),
      rhat = unname(blavInspect(f, "rhat")[p]), neff = unname(blavInspect(f, "neff")[p])
    )
  })
  fm <- blavaan:::blav_fit_measures(f)
  stopifnot(length(app$parameters) == length(direct))
  # (by name: the app writes the factor covariances explicitly, so blavaan lists the parameters in another order)
  key <- function(p) paste0(p$lhs, p$op, p$rhs)
  akeys <- vapply(app$parameters, key, "")
  for (dp in direct) {
    rev <- sub("^(.*)~~(.*)$", "\\2~~\\1", dp$par)
    i <- match(dp$par, akeys)
    if (is.na(i)) i <- match(rev, akeys)
    if (is.na(i)) stop(sprintf("%s: not among the app's parameters", dp$par))
    for (k in c("mean", "sd", "low", "high", "rhat", "neff")) {
      if (!isTRUE(all.equal(app$parameters[[i]][[k]], dp[[k]], tolerance = 1e-10))) stop(sprintf("%s %s: app %s, blavaan %s", dp$par, k, app$parameters[[i]][[k]], dp[[k]]))
    }
  }
  for (k in c("ppp", "dic", "waic", "looic", "margloglik")) {
    a <- app$fit[[c(ppp = "ppp", dic = "dic", waic = "waic", looic = "looic", margloglik = "margLogLik")[[k]]]]
    if (!isTRUE(all.equal(a, unname(fm[[k]]), tolerance = 1e-10))) stop(sprintf("fit %s: app %s, blavaan %s", k, a, fm[[k]]))
  }
  out[[ident]] <- list(converged = app$converged, maxRhat = app$maxRhat, parameters = app$parameters, direct = direct, fit = app$fit, identical = TRUE)
  cat(ident, ": app = direct blavaan (", length(direct), " parameters, fit measures); max R-hat ", format(app$maxRhat, digits = 4), "\n", sep = "")
}
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")), blavaan = as.character(packageVersion("blavaan")), rstan = as.character(packageVersion("rstan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/blavaan/reference.json")
