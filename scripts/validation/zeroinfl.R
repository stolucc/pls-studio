# Reference for the regression card's zero-inflated and hurdle count models
# (src/rengine/regression.webr.test.ts): pscl's documented examples on
# bioChemists (?zeroinfl, ?hurdle) and a zero part with its own predictors and
# sandwich (HC0) errors, run natively. Vuong's test is read from pscl::vuong's
# printed table (vuong returns nothing).
#   Rscript scripts/validation/zeroinfl.R
suppressPackageStartupMessages({ library(pscl); library(MASS); library(sandwich); library(jsonlite) })
data("bioChemists", package = "pscl")
nb <- glm.nb(art ~ ., data = bioChemists); pois <- glm(art ~ ., data = bioChemists, family = poisson)
m <- list(
  zinb2 = list(fit = zeroinfl(art ~ . | ., data = bioChemists, dist = "negbin"), std = nb),
  zip2 = list(fit = zeroinfl(art ~ . | ., data = bioChemists), std = pois),
  zinb = list(fit = zeroinfl(art ~ . | 1, data = bioChemists, dist = "negbin"), std = nb),
  hnb1 = list(fit = hurdle(art ~ ., data = bioChemists, dist = "negbin"), std = nb),
  hp1 = list(fit = hurdle(art ~ ., data = bioChemists), std = pois),
  # (a zero part with its own predictors, and robust errors: sandwich::sandwich)
  hp_own = list(fit = hurdle(art ~ fem + mar + kid5 + phd + ment | kid5 + ment, data = bioChemists, dist = "poisson", zero.dist = "binomial"), std = pois, hc0 = TRUE),
  zinb_own = list(fit = zeroinfl(art ~ fem + mar + kid5 + phd + ment | kid5 + ment, data = bioChemists, dist = "negbin"), std = nb, hc0 = TRUE))
vuong_table <- function(m1, m2) {
  op <- options(digits = 15); on.exit(options(op))  # (the table printed at full precision)
  out <- capture.output(vuong(m1, m2))
  num <- function(lab) as.numeric(strsplit(trimws(sub(lab, "", grep(paste0("^", lab), out, value = TRUE))), " +")[[1]][1])
  list(raw = num("Raw"), aic = num("AIC-corrected"), bic = num("BIC-corrected"))
}
out <- lapply(m, function(x) { f <- x$fit
  vc <- if (isTRUE(x$hc0)) sandwich(f) else vcov(f)
  Filter(Negate(is.null), list(coefficients = lapply(names(coef(f)), function(t) list(term = t, est = unname(coef(f)[t]), se = unname(sqrt(vc[t, t])))),
    logLik = as.numeric(logLik(f)), aic = AIC(f), bic = BIC(f), npar = attr(logLik(f), "df"),
    theta = if (!is.null(f$theta)) unname(f$theta[1]), thetaSe = if (!is.null(f$theta) && !isTRUE(x$hc0)) unname(f$theta[1] * f$SE.logtheta[1]),
    vuong = vuong_table(f, x$std), zeros = sum(f$y == 0), zerosPredicted = sum(predict(f, type = "prob")[, 1]), zerosStandard = sum(predprob(x$std)[, 1]))) })  # (no theta for Poisson models, no SE of theta with the sandwich)
out$versions <- list(R = R.version.string, pscl = as.character(packageVersion("pscl")), MASS = as.character(packageVersion("MASS")), sandwich = as.character(packageVersion("sandwich")))
dir.create("src/engine/__fixtures__/regression", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/regression/pscl.json")
cat("written\n"); for (k in names(m)) cat(k, ": logLik", format(as.numeric(logLik(m[[k]]$fit)), digits = 10), " vuong", unlist(out[[k]]$vuong), "\n")
