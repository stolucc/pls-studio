# Native reference for the dMACS card (src/analyses/invariance.tsx, R/invariance.R ps_dmacs): effect sizes of measurement
# non-invariance (Nye & Drasgow 2011) computed independently of the app's bridge with the dmacs package's own functions.
# dmacs (Dueber; CC0) was archived on CRAN and does not install on this R (its 0.1.0 needs MplusAutomation and is
# not in webR), so its item_dmacs(), delta_mean_item() and expected_value() are copied verbatim below from the
# development version (github.com/ddueber/dmacs, R/MeasEquiv_EffectSize_Base.R, version 0.1.0.9002), and fed the
# estimates the way its lavaan_dmacs() takes them (lavInspect "est": lambda, nu, alpha, diag(psi)). Its pooled SD
# is replaced by Nye & Drasgow's (equation 3: the square root of the pooled variance; lavaan_dmacs averages the two
# SDs), and its delta_var() is not used: in it the second and third terms of Nye & Drasgow's equation 8 are lines
# of their own (an R statement ends at the line break), so it returns only the first term. The scale's variance bias
# is computed from equations 7-9 written out instead, and every effect also from its closed form (a normal factor
# and linear items: sqrt((dnu + dlambda kappa)^2 + dlambda^2 phi) / SD) as a second check.
# Models: Holzinger & Swineford's three factors in the two schools, the lavaan tutorial's partial invariance
# (group.equal loadings and intercepts, group.partial visual=~x2 and x7~1), and the configural model.
# Writes src/engine/__fixtures__/invariance/dmacs.json; cards/invariance.webr.test.ts compares the card with it.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/dmacs.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})

# ---- dmacs 0.1.0.9002 (CC0), verbatim ----
item_dmacs <- function(LambdaR, LambdaF,
                       NuR, NuF,
                       MeanF, VarF, SD,
                       ThreshR = NULL, ThreshF = NULL,
                       ThetaR = NULL, ThetaF = NULL,
                       categorical = FALSE) {
  if (!is.null(ThreshR)) {
    categorical <- TRUE
    if (length(ThreshR) != length(ThreshF)) {
      stop("Item must have same number of thresholds in both reference and focal group")
    }
  }
  if (LambdaR == 0) {
    return(NA)
  }
  integrand <- function(z, LambdaR, LambdaF,
                        NuR, NuF,
                        ThreshR, ThreshF,
                        ThetaR, ThetaF,
                        MeanF, VarF, categorical) {
    (expected_value(LambdaF, NuF, MeanF + z * sqrt(VarF), ThreshF, ThetaF, categorical) -
      expected_value(LambdaR, NuR, MeanF + z * sqrt(VarF), ThreshR, ThetaR, categorical))^2 * dnorm(z)
  }
  sqrt(integrate(integrand, -Inf, Inf,
    LambdaR, LambdaF,
    NuR, NuF,
    ThreshR, ThreshF,
    ThetaR, ThetaF,
    MeanF, VarF,
    categorical = categorical
  )$value) / SD
}
delta_mean_item <- function(LambdaR, LambdaF,
                            NuR, NuF,
                            MeanF, VarF,
                            ThreshR = NULL, ThreshF = NULL,
                            ThetaR = NULL, ThetaF = NULL,
                            categorical = FALSE) {
  if (categorical) {
    categorical <- TRUE
    if (length(ThreshR) != length(ThreshF)) {
      stop("Item must have same number of thresholds in both reference and focal group.")
    }
  }
  if (LambdaR == 0) {
    return(NA)
  }
  integrand <- function(z, LambdaR, LambdaF,
                        NuR, NuF,
                        ThreshR, ThreshF,
                        ThetaR, ThetaF,
                        MeanF, VarF, categorical) {
    (expected_value(LambdaF, NuF, MeanF + z * sqrt(VarF), ThreshF, ThetaF, categorical) -
      expected_value(LambdaR, NuR, MeanF + z * sqrt(VarF), ThreshR, ThetaR, categorical)) * dnorm(z)
  }
  integrate(integrand, -Inf, Inf,
    LambdaR, LambdaF,
    NuR, NuF,
    ThreshR, ThreshF,
    ThetaR, ThetaF,
    MeanF, VarF,
    categorical = categorical
  )$value
}
expected_value <- function(Lambda, Nu, Eta, Thresh = NULL, Theta = NULL, categorical = FALSE) {
  if (categorical) {
    Mu <- Nu + Lambda * Eta
    max <- length(Thresh)
    Thresh[max + 1] <- Inf
    expected <- 0
    for (i in 1:max) {
      expected <- expected + i * (pnorm(Mu - Thresh[i], sd = sqrt(Theta)) -
        pnorm(Mu - Thresh[i + 1], sd = sqrt(Theta)))
    }
    expected
  } else {
    Nu + Lambda * Eta
  }
}
# ---- end of dmacs ----

HS.model <- " visual  =~ x1 + x2 + x3
              textual =~ x4 + x5 + x6
              speed   =~ x7 + x8 + x9 "
dat <- HolzingerSwineford1939
partial <- cfa(
  HS.model,
  data = dat,
  group = "school",
  group.equal = c("loadings", "intercepts"),
  group.partial = c("visual=~x2", "x7~1")
)
configural <- cfa(HS.model, data = dat, group = "school")

effects <- function(fit, RefGroup, sdtype) {
  est <- lavInspect(fit, "est")
  groups <- lavInspect(fit, "group.label")
  obs <- lavInspect(fit, "data")
  r <- match(RefGroup, groups)
  f <- setdiff(seq_along(groups), r)
  sd_of <- function(g) apply(obs[[g]], 2, sd)
  n_of <- function(g) nrow(obs[[g]])
  SD <- if (sdtype == "pooled") {
    sqrt(((n_of(r) - 1) * sd_of(r)^2 + (n_of(f) - 1) * sd_of(f)^2) / (n_of(r) + n_of(f) - 2))
  } else {
    sd_of(r)
  }
  items <- list()
  scales <- list()
  for (k in colnames(est[[r]]$lambda)) {
    LR <- est[[r]]$lambda[, k]
    LF <- est[[f]]$lambda[, k]
    on <- names(LR)[LR != 0]
    m <- est[[f]]$alpha[k, 1]
    v <- est[[f]]$psi[k, k]
    for (i in on) {
      lR <- LR[[i]]
      lF <- LF[[i]]
      nR <- est[[r]]$nu[i, 1]
      nF <- est[[f]]$nu[i, 1]
      d <- item_dmacs(lR, lF, nR, nF, m, v, SD[[i]])
      mb <- delta_mean_item(lR, lF, nR, nF, m, v)
      closed <- sqrt(((nF - nR) + (lF - lR) * m)^2 + (lF - lR)^2 * v) / SD[[i]]
      items[[length(items) + 1]] <- list(
        factor = k,
        item = i,
        lambdaRef = lR,
        lambdaFocal = lF,
        nuRef = nR,
        nuFocal = nF,
        sd = SD[[i]],
        dmacs = d,
        dmacsClosed = closed,
        meanBias = mb,
        meanBiasClosed = (nF - nR) + (lF - lR) * m,
        signed = mb / SD[[i]],
        varBias = v * (lF^2 - lR^2)
      )
    }
    # Nye & Drasgow (2011), equations 7-9: the bias in each covariance of two items, summed over all pairs
    dl <- LF[on] - LR[on]
    lr <- LR[on]
    dcov <- outer(
      seq_along(on),
      seq_along(on),
      function(i, j) lr[j] * dl[i] * v + lr[i] * dl[j] * v + dl[i] * dl[j] * v
    )
    scales[[length(scales) + 1]] <- list(
      factor = k,
      items = length(on),
      kappa = m,
      phi = v,
      meanBias = sum(vapply(items[vapply(items, function(x) x$factor == k, TRUE)], function(x) x$meanBias, 0)),
      varBias = sum(dcov)
    )
  }
  list(
    reference = groups[r],
    focal = groups[f],
    n = unname(lavInspect(fit, "nobs")),
    groups = groups,
    items = items,
    scales = scales
  )
}
out <- list(
  lavaan = as.character(packageVersion("lavaan")),
  R = paste(R.version$major, R.version$minor, sep = "."),
  dmacs = "0.1.0.9002 (github.com/ddueber/dmacs, functions copied)",
  partialPasteur = effects(partial, "Pasteur", "pooled"),
  partialGrantWhite = effects(partial, "Grant-White", "reference"),
  configural = effects(configural, "Pasteur", "pooled")
)
dir <- file.path("src", "engine", "__fixtures__", "invariance")
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(dir, "dmacs.json"))
cat("Wrote", file.path(dir, "dmacs.json"), "\n")
