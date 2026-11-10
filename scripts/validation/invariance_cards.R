# Native reference for the measurement invariance cards (src/analyses/invariance.tsx): each package's documented
# workflow run in desktop R as its help page writes it, independently of the app's bridge (R/invariance.R).
# Writes src/engine/__fixtures__/invariance/reference.json; cards/invariance.webr.test.ts and
# rengine/invariance.webr.test.ts compare the cards' results with it.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/invariance_cards.R
suppressPackageStartupMessages({ library(lavaan); library(sirt); library(jsonlite) })
out <- list()
rows <- function(m) lapply(seq_len(nrow(m)), function(g) unname(as.numeric(m[g, ])))

# ---- Alignment: sirt ?invariance.alignment, example 2 (data.inv4gr), as the help page extracts the parameters ----
data(data.inv4gr, package = "sirt")
dat <- data.inv4gr
model1 <- "F =~ I01 + I02 + I03 + I04 + I05 + I06 + I07 + I08 + I09 + I10 + I11
  F ~~ 1*F"
# (the help page fits the configural model through semTools::measurementInvariance(std.lv = TRUE), which is cfa() by group)
fit <- cfa(model1, data = dat, group = "group", std.lv = TRUE)
ipars <- parameterEstimates(fit)
lambda <- matrix(ipars[ipars$op == "=~", "est"], nrow = 4, byrow = TRUE)
nu <- matrix(ipars[ipars$op == "~1" & ipars$se != 0, "est"], nrow = 4, byrow = TRUE)
colnames(lambda) <- colnames(nu) <- colnames(dat)[-1]
mod1 <- invariance.alignment(lambda = lambda, nu = nu)
cons <- invariance_alignment_constraints(mod1, lambda_parm_tol = .2, nu_parm_tol = .4)
cons05 <- invariance_alignment_constraints(mod1, lambda_parm_tol = .05, nu_parm_tol = .1)
# √N weights (Asparouhov & Muthen): equal groups here, so the same alignment
mod1w <- invariance.alignment(lambda = lambda, nu = nu, wgt = matrix(sqrt(1000), 4, 11))
# least squares (power 2), help page example 1's model 1
mod2 <- invariance.alignment(lambda = lambda, nu = nu, align.pow = c(2, 2))
al <- function(m) list(mean = m$pars$alpha0, sd = m$pars$psi0, r2 = unname(m$es.invariance["R2", ]), rbar = unname(m$es.invariance["rbar", ]),
  sqrtU2 = unname(m$es.invariance["sqrtU2", ]), lambdaAligned = rows(m$lambda.aligned), nuAligned = rows(m$nu.aligned), fopt = m$fopt)
out$alignment <- list(chisq = unname(fitMeasures(fit, "chisq")), df = unname(fitMeasures(fit, "df")), lambda = rows(lambda), nu = rows(nu),
  default = al(mod1), weighted = al(mod1w), leastSquares = al(mod2),
  noninvariant = list(lambda = cons$lambda_list$prop_noninvariance / 100, nu = cons$nu_list$prop_noninvariance / 100),
  noninvariant05 = list(lambda = cons05$lambda_list$prop_noninvariance / 100, nu = cons05$nu_list$prop_noninvariance / 100,
    lambdaUnique = unname(cons05$lambda_list$N_unique_parm_items), nuUnique = unname(cons05$nu_list$N_unique_parm_items)))

writeLines(toJSON(list(generated = format(Sys.time()), R = R.version.string, lavaan = as.character(packageVersion("lavaan")),
  sirt = as.character(packageVersion("sirt")), cases = out), auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null", na = "null"),
  "src/engine/__fixtures__/invariance/reference.json")
cat("written\n")
