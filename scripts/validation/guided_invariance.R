# Native reference for the guided measurement invariance card (src/analyses/guidedInvariance.tsx), run in desktop R
# independently of the app's bridge (R/invariance.R, ps_guided_invariance):
#  - ordinal items: semTools' own example of ?measEq.syntax (datCat, 5-category items u1-u8, groups g), written
#    for groups only (the help page also treats u1-u4 / u5-u8 as one factor at two occasions; here two factors), with
#    Wu & Estabrook's (2016) identification: syntax from measEq.syntax, fitted by cfa() in a separate step as the help
#    page recommends, all steps compared in one lavTestLRT call; delta and theta parameterisations, the scalar model
#    with u3's intercept freed (partial invariance), its latent means and score tests;
#  - continuous items: HolzingerSwineford1939 by school (lavaan's tutorial), plain lavaan group.equal / group.partial
#    with std.lv = TRUE (no semTools), ML and MLR; score tests by lavTestScore; dMACS integrated numerically as the
#    dmacs package does;
#  - binary items (HolzingerSwineford1939 split at the medians): the scalar model as lavaan's own group.equal writes
#    it for categorical data (thresholds and loadings equal, intercepts 0 and scale factors 1 in every group, latent
#    means free), which is the card's binary scalar model.
# Writes src/engine/__fixtures__/invariance/guided.json; rengine/guidedInvariance.webr.test.ts compares the card with it.
#   Rscript scripts/validation/guided_invariance.R
suppressPackageStartupMessages({
  library(lavaan)
  library(semTools)
  library(jsonlite)
})
out <- list()
fit_row <- function(fit, cfi = "cfi.scaled", rmsea = "rmsea.scaled", chisq = "chisq.scaled") {
  m <- fitMeasures(fit)
  list(chisq = unname(m[chisq]), df = unname(m["df"]), cfi = unname(m[cfi]), rmsea = unname(m[rmsea]),
    srmr = unname(m["srmr"]))
}
lrt_rows <- function(l) {
  list(chisqDiff = unname(l[["Chisq diff"]][-1]), dfDiff = unname(l[["Df diff"]][-1]),
    p = unname(l[["Pr(>Chisq)"]][-1]))
}

# ---- Ordinal: semTools ?measEq.syntax (datCat) ----
data(datCat, package = "semTools")
mod.cat <- " FU1 =~ u1 + u2 + u3 + u4
             FU2 =~ u5 + u6 + u7 + u8 "
ord <- paste0("u", 1:8)
ordinal_case <- function(parameterization, strict) {
  meq <- function(equal, partial = "") {
    s <- measEq.syntax(configural.model = mod.cat, data = datCat, ordered = ord, parameterization = parameterization,
      ID.fac = "std.lv", ID.cat = "Wu.Estabrook.2016", group = "g", group.equal = equal, group.partial = partial)
    cfa(as.character(s), data = datCat, group = "g", ordered = ord, parameterization = parameterization)
  }
  fit.config <- meq("")
  fit.thresh <- meq("thresholds")
  fit.metric <- meq(c("thresholds", "loadings"))
  fit.scalar <- meq(c("thresholds", "loadings", "intercepts"), "u3 ~ 1")
  fits <- list(fit.config, fit.thresh, fit.metric, fit.scalar)
  if (strict) fits[[5]] <- meq(c("thresholds", "loadings", "intercepts", "residuals"), "u3 ~ 1")
  lrt <- do.call(lavTestLRT, unname(fits))
  pe <- parameterEstimates(fit.scalar)
  m <- pe[pe$op == "~1" & pe$lhs %in% c("FU1", "FU2") & pe$group == 2, ]
  # score tests of the metric step's loadings (two groups: one constraint each, univariate = releasing it)
  st <- lavTestScore(fit.metric)$uni
  pt <- parTable(fit.metric)
  item_of <- function(pl) pt$rhs[pt$plabel == pl]
  loads <- st[vapply(st$lhs, function(pl) pt$op[pt$plabel == pl] == "=~", TRUE), ]
  # the intercepts of Wu & Estabrook's scalar model are fixed at 0 in both groups: modification indices (u3 freed)
  mi <- suppressWarnings(modindices(fit.scalar, op = "~1", free.remove = FALSE, sort. = FALSE, minimum.value = 0))
  mi <- mi[mi$group == 2 & mi$lhs %in% ord, ]
  list(
    fit = lapply(fits, fit_row),
    lrt = lrt_rows(lrt),
    meanEst = m$est, meanSe = m$se, meanZ = m$z, meanLo = m$ci.lower, meanHi = m$ci.upper,
    metricScoreItems = I(vapply(loads$lhs, item_of, "")), metricScore = loads$X2.scaled,
    scalarMiItems = I(mi$lhs), scalarMi = mi$mi
  )
}
out$catDelta <- ordinal_case("delta", FALSE)
out$catTheta <- ordinal_case("theta", TRUE)

# ---- Continuous: HolzingerSwineford1939 by school, plain lavaan ----
HS <- HolzingerSwineford1939
hs.model <- " visual =~ x1 + x2 + x3
              textual =~ x4 + x5 + x6
              speed =~ x7 + x8 + x9 "
continuous_case <- function(est) {
  partial <- c("x3 ~ 1", "x7 ~ 1")
  hs <- function(equal, gp = "") {
    cfa(hs.model, data = HS, group = "school", std.lv = TRUE, meanstructure = TRUE, estimator = est,
      group.equal = equal, group.partial = gp)
  }
  fits <- list(
    hs(character(0)), hs("loadings"), hs(c("loadings", "intercepts"), partial),
    hs(c("loadings", "intercepts", "residuals"), partial)
  )
  idx <- if (est == "MLR") c("cfi.robust", "rmsea.robust", "chisq.scaled") else c("cfi", "rmsea", "chisq")
  lrt <- do.call(lavTestLRT, unname(fits))
  sc <- fits[[3]]
  pe <- parameterEstimates(sc)
  m <- pe[pe$op == "~1" & pe$lhs %in% c("visual", "textual", "speed") & pe$group == 2, ]
  st <- lavTestScore(fits[[2]])$uni
  pt <- parTable(fits[[2]])
  item_of <- function(pl) pt$rhs[pt$plabel == pl]
  # dMACS of x3 and x7 (intercepts freed), focal group 2 against group 1, as the dmacs package integrates it
  E <- lavInspect(sc, "est")
  kappa <- lavInspect(sc, "mean.lv")
  phi <- lavInspect(sc, "cov.lv")
  obs <- lavInspect(sc, "data")
  dm <- sapply(list(c("x3", "visual"), c("x7", "speed")), function(x) {
    i <- x[1]
    k <- x[2]
    lR <- E[[1]]$lambda[i, k]
    lF <- E[[2]]$lambda[i, k]
    nR <- E[[1]]$nu[i, 1]
    nF <- E[[2]]$nu[i, 1]
    sdp <- sqrt(((nrow(obs[[1]]) - 1) * var(obs[[1]][, i]) + (nrow(obs[[2]]) - 1) * var(obs[[2]][, i])) /
      (nrow(obs[[1]]) + nrow(obs[[2]]) - 2))
    f <- function(z) ((nF + lF * (kappa[[2]][k] + z * sqrt(phi[[2]][k, k]))) -
      (nR + lR * (kappa[[2]][k] + z * sqrt(phi[[2]][k, k]))))^2 * dnorm(z)
    sqrt(integrate(f, -Inf, Inf, rel.tol = 1e-10)$value) / sdp
  })
  list(
    fit = lapply(fits, fit_row, cfi = idx[1], rmsea = idx[2], chisq = idx[3]),
    lrt = lrt_rows(lrt),
    meanEst = m$est, meanSe = m$se, meanZ = m$z,
    metricScoreItems = I(vapply(st$lhs, item_of, "")),
    metricScore = if (est == "MLR") st$X2.scaled else st$X2,
    dmacs = dm
  )
}
out$hsML <- continuous_case("ML")
out$hsMLR <- continuous_case("MLR")

# ---- Binary: HolzingerSwineford1939 at the medians, lavaan's categorical group.equal ----
HSb <- HS
for (v in paste0("x", 1:9)) HSb[[v]] <- as.integer(HSb[[v]] > median(HSb[[v]]))
fb <- cfa(hs.model, data = HSb, group = "school", ordered = paste0("x", 1:9), std.lv = TRUE,
  group.equal = c("thresholds", "loadings", "intercepts"))
peb <- parameterEstimates(fb)
mb <- peb[peb$op == "~1" & peb$lhs %in% c("visual", "textual", "speed") & peb$group == 2, ]
out$hsBinaryScalar <- c(fit_row(fb), list(meanEst = mb$est, meanSe = mb$se))

writeLines(
  toJSON(list(
    generated = format(Sys.time()), R = R.version.string, lavaan = as.character(packageVersion("lavaan")),
    semTools = as.character(packageVersion("semTools")), cases = out
  ), auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null", na = "null"),
  "src/engine/__fixtures__/invariance/guided.json"
)
cat("written\n")
