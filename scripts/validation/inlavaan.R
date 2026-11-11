# Native check of the Bayesian SEM card's INLAvaan engine (ps_bsem with engine =
# "inlavaan", src/rengine/R/bayes.R): the app's own R code is sourced, models are
# sent as the app sends them, and the result is compared with a direct INLAvaan
# call with the same settings and seed: every posterior mean, SD, median and 95%
# interval, the fit measures (PPP, DIC, marginal log-likelihood, Bayesian fit
# indices), WAIC and LOO. The examples:
#   - ?acfa: Holzinger & Swineford, std.lv = TRUE (the app's unit identification)
#   - ?asem: Bollen's Political Democracy with equal loadings (labels a, b, c)
#   - the app's blavaan example (?bcfa, marker identification), also compared with
#     blavaan's MCMC posterior (src/engine/__fixtures__/blavaan/reference.json)
#   - priors on labels (MODEL PRIORS), Mplus's priors, a 90% interval, a loop and
#     plausible values: the run of each against its direct call
# Stops on any difference; writes src/engine/__fixtures__/inlavaan/reference.json.
#   R_LIBS=<library with lavaan, INLAvaan, jsonlite> Rscript scripts/validation/inlavaan.R
suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(INLAvaan)
})
for (f in c("common", "longitudinal", "regression", "tests", "lavaan", "bayes")) source(file.path("src/rengine/R", paste0(f, ".R")))
data(HolzingerSwineford1939, package = "lavaan")
data(PoliticalDemocracy, package = "lavaan")
fac <- function(nm, ind, labels = NULL) c(list(name = nm, type = "factor", mode = "A", indicators = ind), if (!is.null(labels)) list(loadingLabels = labels))
cov <- function(a, b, kind) list(a = a, b = b, kind = kind)
frame <- function(x) list(names = names(x), cols = unname(lapply(x, as.numeric)))
req <- function(x, model, ...) {
  toJSON(modifyList(list(
    kind = "cb", estimator = "ML", missing = "casewise", data = frame(x), model = model, engine = "inlavaan",
    chains = 3, burnin = 500, sample = 1000, seed = 1234, confidence = 0.95
  ), list(...)), auto_unbox = TRUE, digits = NA)
}
hs <- HolzingerSwineford1939[, paste0("x", 1:9)]
hs_model <- list(
  constructs = list(fac("visual", paste0("x", 1:3)), fac("textual", paste0("x", 4:6)), fac("speed", paste0("x", 7:9))), paths = list(),
  covariances = list(cov("visual", "textual", "construct"), cov("visual", "speed", "construct"), cov("textual", "speed", "construct"))
)
hs_syntax <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
# (the app writes the factor covariances of the diagram explicitly, after the loadings)
hs_app <- paste(hs_syntax, "visual ~~ textual\nvisual ~~ speed\ntextual ~~ speed", sep = "\n")
pd <- PoliticalDemocracy
pd_model <- list(
  constructs = list(fac("ind60", paste0("x", 1:3)), fac("dem60", paste0("y", 1:4), list(y2 = "a", y3 = "b", y4 = "c")), fac("dem65", paste0("y", 5:8), list(y6 = "a", y7 = "b", y8 = "c"))),
  paths = list(list(from = "ind60", to = "dem60"), list(from = "ind60", to = "dem65"), list(from = "dem60", to = "dem65")),
  covariances = list(cov("y1", "y5", "indicator"), cov("y2", "y4", "indicator"), cov("y2", "y6", "indicator"), cov("y3", "y7", "indicator"), cov("y4", "y8", "indicator"), cov("y6", "y8", "indicator"))
)
# ?asem's model, as on the help page
pd_syntax <- "ind60 =~ x1 + x2 + x3\ndem60 =~ y1 + a*y2 + b*y3 + c*y4\ndem65 =~ y5 + a*y6 + b*y7 + c*y8\ndem60 ~ ind60\ndem65 ~ ind60 + dem60\ny1 ~~ y5\ny2 ~~ y4 + y6\ny3 ~~ y7\ny4 ~~ y8\ny6 ~~ y8"

#' The direct call: the help page's model, the same seed before the fit and before each later step.
direct <- function(syntax, x, std.lv, nsamp = 1000, seed = 1234, model = syntax, dp = priors_for()) {
  set.seed(seed)
  f <- suppressWarnings(asem(model, data = x, std.lv = std.lv, dp = dp, nsamp = nsamp, verbose = FALSE))
  set.seed(seed)
  fm <- fitMeasures(f)
  list(fit = f, s = get_inlavaan_internal(f)$summary, pt = parTable(f), fm = fm, waic = waic(f), loo = loo(f))
}
key <- function(lhs, op, rhs) if (op == "~~" && lhs > rhs) paste0(rhs, op, lhs) else paste0(lhs, op, rhs)
#' Every parameter of the app's reply against the direct fit's summary (by lhs op rhs), and the fit measures. The
#' posterior summaries come from the marginals (deterministic); PPP, DIC and the Bayesian fit indices from posterior
#' draws, which follow the order of the parameters: with the help page's own syntax (`mc`) they agree within their
#' Monte Carlo error, with the syntax the app writes exactly.
compare <- function(app, d, tol = 1e-6, mc = FALSE) {
  pt <- d$pt[d$pt$free > 0, ]
  dk <- mapply(key, pt$lhs, pt$op, pt$rhs)
  akeys <- vapply(app$parameters, function(p) key(p$lhs, p$op, p$rhs), "")
  if (length(akeys) != length(dk)) stop(sprintf("app %d parameters, INLAvaan %d", length(akeys), length(dk)))
  worst <- 0
  for (i in seq_along(dk)) {
    a <- app$parameters[[match(dk[i], akeys)]]
    if (is.null(a)) stop(sprintf("%s: not among the app's parameters", dk[i]))
    k <- pt$free[i]
    for (m in list(c("mean", "Mean"), c("sd", "SD"), c("median", "50%"), c("low", "2.5%"), c("high", "97.5%"))) {
      dv <- d$s[k, m[2]]
      diff <- abs(a[[m[1]]] - dv) / max(1, abs(dv))
      # (INLAvaan summarises a covariance from draws of its correlation and the two variances)
      if (mc && pt$op[i] == "~~" && pt$lhs[i] != pt$rhs[i]) {
        if (abs(a[[m[1]]] - dv) > 0.2 * d$s[k, "SD"]) stop(sprintf("%s %s: app %s, INLAvaan %s (beyond Monte Carlo error)", dk[i], m[1], a[[m[1]]], dv))
        next
      }
      worst <- max(worst, diff)
      if (diff > tol) stop(sprintf("%s %s: app %s, INLAvaan %s", dk[i], m[1], a[[m[1]]], dv))
    }
  }
  fmk <- c(ppp = "ppp", dic = "dic", pDic = "p_dic", margLogLik = "margloglik", brmsea = "BRMSEA", bgammahat = "BGammaHat", bcfi = "BCFI", btli = "BTLI")
  for (k in names(fmk)) {
    a <- app$fit[[k]]
    dv <- unname(d$fm[[fmk[[k]]]])
    diff <- abs(a - dv) / max(1, abs(dv))
    if (mc && k != "margLogLik") {
      if (!isTRUE(abs(a - dv) <= if (k %in% c("dic", "pDic")) 0.5 else 0.05)) stop(sprintf("fit %s: app %s, INLAvaan %s (beyond Monte Carlo error)", k, a, dv))
      next
    }
    worst <- max(worst, diff)
    if (!isTRUE(diff <= tol)) stop(sprintf("fit %s: app %s, INLAvaan %s", k, a, dv))
  }
  for (k in list(c("waic", "waic", "waic"), c("looic", "loo", "looic"))) {
    a <- app$fit[[k[1]]]
    dv <- unname(d[[k[2]]]$estimates[k[3], "Estimate"])
    diff <- abs(a - dv) / max(1, abs(dv))
    worst <- max(worst, diff)
    if (!isTRUE(diff <= tol)) stop(sprintf("fit %s: app %s, INLAvaan %s", k[1], a, dv))
  }
  worst
}
run <- function(r) {
  t <- system.time(out <- fromJSON(ps_bsem(r), simplifyVector = FALSE))
  out$elapsed <- unname(t["elapsed"])
  out
}
out <- list()

# 1. ?acfa (std.lv = TRUE) and 2. ?asem: the app equals INLAvaan
app <- run(req(hs, hs_model, identification = "unit"))
compare(app, direct(hs_syntax, hs, TRUE), mc = TRUE)
w <- compare(app, direct(hs_app, hs, TRUE))
out$acfa <- list(parameters = app$parameters, fit = app$fit, diagnostics = app$diagnostics, converged = app$converged, maxRelDiff = w, elapsed = app$elapsed)
cat(sprintf("?acfa (HS, std.lv): app = INLAvaan, %d parameters, largest relative difference %.2g; %.1f s\n", length(app$parameters), w, app$elapsed))
app <- run(req(pd, pd_model, identification = "marker"))
w <- compare(app, direct(pd_syntax, pd, FALSE))
out$asem <- list(parameters = app$parameters, fit = app$fit, diagnostics = app$diagnostics, converged = app$converged, maxRelDiff = w, elapsed = app$elapsed)
cat(sprintf("?asem (Political Democracy, labels a b c): app = INLAvaan, %d parameters, largest relative difference %.2g; %.1f s\n", length(app$parameters), w, app$elapsed))

# 3. The app's blavaan example (?bcfa, marker identification): the app equals INLAvaan; and INLAvaan's posterior
#    against blavaan's MCMC (3 chains x 1,000 draws, both identifications): means within 0.2 posterior SD, SDs
#    within 20% (INLAvaan's are narrower for the skewed loadings of a marker-identified factor: speed =~ x9 0.84).
app <- run(req(hs, hs_model, identification = "marker"))
compare(app, direct(hs_syntax, hs, FALSE), mc = TRUE)
w <- compare(app, direct(hs_app, hs, FALSE))
out$bcfa <- list(parameters = app$parameters, fit = app$fit, converged = app$converged, maxRelDiff = w, elapsed = app$elapsed)
cat(sprintf("blavaan's example (HS, markers): app = INLAvaan (%.2g)\n", w))
blav <- fromJSON("src/engine/__fixtures__/blavaan/reference.json", simplifyVector = FALSE)
for (ident in c("marker", "unit")) {
  inla <- if (ident == "marker") app else out$acfa
  mc <- blav[[ident]]$parameters
  mk <- vapply(mc, function(p) key(p$lhs, p$op, p$rhs), "")
  vs <- lapply(inla$parameters, function(p) {
    m <- mc[[match(key(p$lhs, p$op, p$rhs), mk)]]
    list(par = key(p$lhs, p$op, p$rhs), inla = p$mean, mcmc = m$mean, inlaSd = p$sd, mcmcSd = m$sd, z = (p$mean - m$mean) / m$sd, sdRatio = p$sd / m$sd)
  })
  z <- max(abs(vapply(vs, `[[`, 0, "z")))
  ratio <- range(vapply(vs, `[[`, 0, "sdRatio"))
  if (z > 0.2 || ratio[1] < 0.8 || ratio[2] > 1.2) stop(sprintf("INLAvaan vs blavaan (%s): largest |mean difference| %.3f SD, SD ratios %.3f to %.3f", ident, z, ratio[1], ratio[2]))
  out$vsMcmc[[ident]] <- list(parameters = vs, maxZ = z, sdRatio = ratio)
  cat(sprintf("  vs blavaan MCMC (%s): means within %.3f posterior SD, SD ratios %.3f to %.3f\n", ident, z, ratio[1], ratio[2]))
}

# 4. The card's options: priors on labels, Mplus's priors, a 90% interval, a loop, plausible values
hsl <- hs_model
hsl$constructs[[1]]$loadingLabels <- list(x2 = "l2", x3 = "l3")
app <- run(req(hs, hsl, identification = "marker", labelPriors = list(list(labels = c("l2", "l3"), mean = 0.5, variance = 0.01))))
pt <- lavaanify("visual =~ x1 + l2*x2 + l3*x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nvisual ~~ textual\nvisual ~~ speed\ntextual ~~ speed", auto.var = TRUE, auto.fix.first = TRUE)
pt$prior <- ""
pt$prior[pt$label %in% c("l2", "l3")] <- "normal(0.5,0.1)"
d <- direct(NULL, hs, FALSE, model = pt)
w1 <- compare(app, d)
l2 <- app$parameters[[which(vapply(app$parameters, function(p) identical(p$label, "l2"), TRUE))]]
if (l2$prior != "normal(0.5,0.1)") stop("the prior on l2 was not used")
cat("(a loop on a model without the label is refused: ", tryCatch(
  {
    run(req(hs, hs_model, identification = "marker", loop = list(name = "q", expr = "l2 * m", variable = "m", from = 0, to = 1, by = 0.5)))
    "not refused"
  },
  error = function(e) "refused"
), ")\n", sep = "")
mp <- run(req(hs, hsl, identification = "marker", priors = "mplus", confidence = 0.9, loop = list(name = "q", expr = "l2 * m", variable = "m", from = 0, to = 1, by = 0.5), plausible = 10))
# (the direct call for Mplus's priors: the same parameter table)
pt0 <- parTable(asem("visual =~ x1 + l2*x2 + l3*x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nvisual ~~ textual\nvisual ~~ speed\ntextual ~~ speed",
  data = hs, auto.cov.y = FALSE, std.lv = FALSE,
  dp = priors_for(nu = "normal(0,1000)", alpha = "normal(0,1000)", lambda = "normal(0,1000)", beta = "normal(0,1000)"), do.fit = FALSE, verbose = FALSE
))
dpm <- priors_for(nu = "normal(0,1000)", alpha = "normal(0,1000)", lambda = "normal(0,1000)", beta = "normal(0,1000)")
pt0 <- pt0[, c("id", "lhs", "op", "rhs", "user", "block", "group", "free", "ustart", "exo", "label", "plabel", "prior")]
pt0$prior[is.na(pt0$prior)] <- ""
cv <- pt0$free > 0 & pt0$op == "~~" & pt0$lhs != pt0$rhs
for (i in which(pt0$free > 0 & pt0$op == "~~" & pt0$lhs == pt0$rhs)) pt0$prior[i] <- sprintf("gamma(%s,1e-4)", 1 + sum(cv & (pt0$lhs == pt0$lhs[i] | pt0$rhs == pt0$lhs[i])) / 2)
dm <- direct(NULL, hs, FALSE, model = pt0, dp = dpm)
set.seed(1234)
dr <- as.data.frame(sampling(dm$fit, nsamp = 1000))
k2 <- dm$pt$free[dm$pt$label == "l2"][1]
lo <- mp$parameters[[which(vapply(mp$parameters, function(p) identical(p$label, "l2"), TRUE))]]
if (abs(lo$mean - dm$s[k2, "Mean"]) > 1e-6 || abs(lo$low - quantile(dr$l2, 0.05)) > 1e-6 || abs(lo$high - quantile(dr$l2, 0.95)) > 1e-6) stop("Mplus's priors / 90% interval differ from the direct call")
if (abs(mp$loop$median[[3]] - median(dr$l2)) > 1e-6 || mp$plausible$draws != 10 || length(mp$plausible$factors) != 3) stop("loop or plausible values differ")
out$options <- list(labelPriors = list(maxRelDiff = w1, l2 = l2), mplus = list(
  l2 = lo, direct = list(mean = dm$s[k2, "Mean"], low = unname(quantile(dr$l2, 0.05)), high = unname(quantile(dr$l2, 0.95))),
  loop = mp$loop, plausible = mp$plausible, priors = vapply(mp$parameters, function(p) p$prior %||% "", "")
))
cat(sprintf("priors on labels: app = INLAvaan (%.2g); Mplus's priors, 90%% interval from draws, loop, plausible values: as the direct call\n", w1))
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")), INLAvaan = as.character(packageVersion("INLAvaan")))
dir.create("src/engine/__fixtures__/inlavaan", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"), "src/engine/__fixtures__/inlavaan/reference.json")
