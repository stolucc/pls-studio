# Reference results for the latent curve model with structured residuals (LCM-SR; Curran, Howard, Bainter, Lane &
# McGinley 2014) against the RI-CLPM, from desktop lavaan, with the LCM-SR's log-likelihood checked in OpenMx (a RAM
# model written independently of the lavaan syntax). Data: the National Longitudinal Survey of Young Women
# (sampleSelection::nlswork, NLS public-use data), the five interviews 1969-1977 two years apart: log hourly wage
# and weekly hours worked, the hours in tens (their variance is a thousand times log wage's otherwise, and lavaan
# stops at a worse optimum of the LCM-SR with equal lagged effects). Women interviewed in at least one of these years;
# missing waves by FIML.
# Also writes the examples' data, public/examples/lcmsr/nlswork-wide.csv and nlswork-long.csv.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/lcmsr.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(OpenMx)
})
data(nlswork, package = "sampleSelection")
years <- c(69, 71, 73, 75, 77)
long <- nlswork[nlswork$year %in% years, c("idcode", "year", "ln_wage", "hours")]
wide <- reshape(long, idvar = "idcode", timevar = "year", direction = "wide")
wide <- wide[order(wide$idcode), ]
d <- data.frame(id = wide$idcode)
for (t in years) d[[paste0("lnwage", t)]] <- round(wide[[paste0("ln_wage.", t)]], 6)
for (t in years) d[[paste0("hours10_", t)]] <- wide[[paste0("hours.", t)]] / 10
dir.create("public/examples/lcmsr", showWarnings = FALSE, recursive = TRUE)
write.csv(d, "public/examples/lcmsr/nlswork-wide.csv", row.names = FALSE, na = "")
# The within/between example's data (packages.ts, nls-within-between): every interview, the columns it uses.
write.csv(
  nlswork[, c("idcode", "year", "ln_wage", "hours", "age")],
  "public/examples/lcmsr/nlswork-long.csv", row.names = FALSE, na = ""
)

T <- length(years)
x <- paste0("lnwage", years)
y <- paste0("hours10_", years)
# As ps_riclpm writes them (src/rengine/R/longitudinal.R).
within <- function(equal) {
  c(
    sprintf("wx%d =~ 1*%s", 1:T, x),
    sprintf("wy%d =~ 1*%s", 1:T, y),
    sprintf("wx%d ~ %swx%d + %swy%d", 2:T, if (equal) "a*" else "", 1:(T - 1), if (equal) "b*" else "", 1:(T - 1)),
    sprintf("wy%d ~ %swx%d + %swy%d", 2:T, if (equal) "c*" else "", 1:(T - 1), if (equal) "d*" else "", 1:(T - 1)),
    sprintf("wx%d ~~ wy%d", 1:T, 1:T),
    sprintf("wx%d ~~ wx%d", 1:T, 1:T),
    sprintf("wy%d ~~ wy%d", 1:T, 1:T),
    sprintf("%s ~~ 0*%s", c(x, y), c(x, y))
  )
}
riclpm <- function(equal) {
  c(
    sprintf("RIx =~ %s", paste0("1*", x, collapse = " + ")),
    sprintf("RIy =~ %s", paste0("1*", y, collapse = " + ")),
    within(equal),
    "RIx ~~ RIx", "RIy ~~ RIy", "RIx ~~ RIy", "RIx ~~ 0*wx1", "RIx ~~ 0*wy1", "RIy ~~ 0*wx1", "RIy ~~ 0*wy1"
  )
}
growth_factors <- c("Ix", "Sx", "Iy", "Sy")
lcmsr <- function(equal) {
  c(
    sprintf("Ix =~ %s", paste0("1*", x, collapse = " + ")),
    sprintf("Sx =~ %s", paste0(0:(T - 1), "*", x, collapse = " + ")),
    sprintf("Iy =~ %s", paste0("1*", y, collapse = " + ")),
    sprintf("Sy =~ %s", paste0(0:(T - 1), "*", y, collapse = " + ")),
    within(equal),
    sprintf("%s ~ 1", growth_factors),
    sprintf("%s ~ 0*1", c(x, y)),
    unlist(lapply(1:4, function(i) sprintf("%s ~~ %s", growth_factors[i], growth_factors[i:4]))),
    sprintf("%s ~~ 0*wx1 + 0*wy1", growth_factors)
  )
}
fit <- function(m, ri) {
  lavaan(
    m, data = d, meanstructure = TRUE, int.ov.free = ri, estimator = "ML", missing = "ml"
  )
}
pick <- function(f) {
  pe <- parameterEstimates(f, standardized = TRUE)
  lvs <- c("RIx", "RIy", growth_factors, paste0("wx", 1:T), paste0("wy", 1:T))
  pe <- pe[pe$op %in% c("~1", "~~", "~") & pe$lhs %in% lvs, ]
  list(
    converged = lavInspect(f, "converged"),
    fit = as.list(fitMeasures(f, c("npar", "chisq", "df", "cfi", "rmsea", "logl"))),
    estimates = lapply(seq_len(nrow(pe)), function(i) {
      list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i], std = pe$std.all[i])
    })
  )
}
out <- list()
for (equal in c(FALSE, TRUE)) {
  key <- if (equal) "Equal" else ""
  ri <- fit(riclpm(equal), TRUE)
  gr <- fit(lcmsr(equal), FALSE)
  cmp <- lavTestLRT(ri, gr)
  out[[paste0("riclpm", key)]] <- pick(ri)
  out[[paste0("lcmsr", key)]] <- pick(gr)
  out[[paste0("comparison", key)]] <- list(
    chisqDiff = cmp[["Chisq diff"]][2], dfDiff = cmp[["Df diff"]][2], p = cmp[["Pr(>Chisq)"]][2]
  )
}

# The LCM-SR with equal lagged effects as an OpenMx RAM model: growth factors (means free, covariances free, zero
# covariances with the first within-person deviations), within-person deviations with lagged paths labelled equal
# over time, observed scores without residuals or intercepts.
wx <- paste0("wx", 1:T)
wy <- paste0("wy", 1:T)
ram <- mxModel(
  "LCMSR", type = "RAM", manifestVars = c(x, y), latentVars = c(growth_factors, wx, wy),
  mxData(d[, c(x, y)], type = "raw"),
  mxPath(from = "Ix", to = x, values = 1, free = FALSE),
  mxPath(from = "Sx", to = x, values = 0:(T - 1), free = FALSE),
  mxPath(from = "Iy", to = y, values = 1, free = FALSE),
  mxPath(from = "Sy", to = y, values = 0:(T - 1), free = FALSE),
  mxPath(from = wx, to = x, values = 1, free = FALSE),
  mxPath(from = wy, to = y, values = 1, free = FALSE),
  mxPath(from = wx[-T], to = wx[-1], labels = "a", values = 0.2),
  mxPath(from = wy[-T], to = wx[-1], labels = "b", values = 0),
  mxPath(from = wx[-T], to = wy[-1], labels = "c", values = 0),
  mxPath(from = wy[-T], to = wy[-1], labels = "d", values = 0.2),
  mxPath(from = wx, to = wy, arrows = 2, values = 0),
  mxPath(from = c(wx, wy), arrows = 2, values = c(rep(0.05, T), rep(1, T))),
  mxPath(from = growth_factors, arrows = 2, values = c(0.1, 0.005, 0.3, 0.05)),
  mxPath(from = growth_factors, arrows = 2, connect = "unique.bivariate", values = 0),
  mxPath(from = "one", to = growth_factors, values = c(1.5, 0, 3.7, 0)),
  mxPath(from = c(x, y), arrows = 2, values = 0, free = FALSE)
)
mx <- mxTryHard(ram, extraTries = 10, silent = TRUE)
out$openmxLcmsrEqual <- list(
  logl = -mx$output$fit / 2,
  status = mx$output$status$code,
  lagged = as.list(omxGetParameters(mx)[c("a", "b", "c", "d")])
)
stopifnot(abs(out$openmxLcmsrEqual$logl - out$lcmsrEqual$fit$logl) < 1e-3)

dir.create("src/engine/__fixtures__/lcmsr", showWarnings = FALSE, recursive = TRUE)
write(
  toJSON(
    c(list(n = nrow(d), lavaan = as.character(packageVersion("lavaan")),
           OpenMx = as.character(packageVersion("OpenMx"))), out),
    auto_unbox = TRUE, digits = NA, pretty = TRUE
  ),
  "src/engine/__fixtures__/lcmsr/reference.json"
)
