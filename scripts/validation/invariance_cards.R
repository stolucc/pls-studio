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

# ---- MNLFA: mnlfa ?mnlfa, example 1, model 4 as written; and a 2PL with a three-level categorical covariate ----
suppressPackageStartupMessages(library(mnlfa))
data(data.mnlfa01, package = "mnlfa")
dat <- data.mnlfa01
items <- grep("I[0-9]", colnames(dat), value = TRUE)
formula_mean <- ~0 + female + age
formula_sd <- ~1
formula_int <- ~1
formula_int <- mnlfa::mnlfa_expand_to_list(x = formula_int, names_list = items)
mod_items <- c(4, 5, 6, 7)
for (ii in mod_items) formula_int[[ii]] <- ~1 + female + age
formula_slo <- ~1
mod4 <- mnlfa::mnlfa(dat = dat, items, item_type = "1PL", formula_int = formula_int, formula_slo = formula_slo, formula_mean = formula_mean, formula_sd = formula_sd, verbose = FALSE)
mn <- function(m) list(parm = as.character(m$item$parm), est = m$item$est, trait = as.character(m$trait$par), traitEst = m$trait$est,
  deviance = m$ic$deviance, npar = m$ic$np, aic = m$ic$AIC, bic = m$ic$BIC, iter = m$iter)
# 2PL: a three-level grouping (rows 1, 2, 3, 1, 2, 3, ...) as a factor, moderating the slopes of I1-I3 and the factor
# mean; age moderating the intercepts of I1-I3 and the log SD (here written with R's own dummy coding).
dat$grp <- factor(rep(1:3, length.out = nrow(dat)))
dat$grp2 <- as.numeric(dat$grp == 2); dat$grp3 <- as.numeric(dat$grp == 3)  # (the mean has no intercept: dummies, not ~0 + grp)
fi <- mnlfa::mnlfa_expand_to_list(x = ~1, names_list = items); fs <- fi
for (ii in 1:3) { fi[[ii]] <- ~1 + age; fs[[ii]] <- ~1 + grp }
mod2pl <- mnlfa::mnlfa(dat = dat, items, item_type = "2PL", formula_int = fi, formula_slo = fs, formula_mean = ~0 + grp2 + grp3,
  formula_sd = ~0 + age, verbose = FALSE)
out$mnlfa <- list(model4 = mn(mod4), twoPL = mn(mod2pl))

# ---- Longitudinal invariance: PoliticalDemocracy, democracy 1960 (y1-y4) and 1965 (y5-y8), written out by hand ----
# The four levels as plain lavaan syntax (no semTools), factor standardised at 1960, each item's residuals correlated.
pd <- PoliticalDemocracy
lv <- function(eqL, eqI, eqR) paste(c(
  sprintf("d60 =~ NA*y1 + %sy1 + %sy2 + %sy3 + %sy4", if (eqL) "l1*" else "", if (eqL) "l2*" else "", if (eqL) "l3*" else "", if (eqL) "l4*" else ""),
  sprintf("d65 =~ NA*y5 + %sy5 + %sy6 + %sy7 + %sy8", if (eqL) "l1*" else "", if (eqL) "l2*" else "", if (eqL) "l3*" else "", if (eqL) "l4*" else ""),
  "d60 ~~ 1*d60", if (eqL) "d65 ~~ d65" else "d65 ~~ 1*d65", "d60 ~~ d65",
  "d60 ~ 0*1", if (eqI) "d65 ~ 1" else "d65 ~ 0*1",
  sprintf("y%d ~ %s1", 1:4, if (eqI) paste0("i", 1:4, "*") else ""), sprintf("y%d ~ %s1", 5:8, if (eqI) paste0("i", 1:4, "*") else ""),
  sprintf("y%d ~~ %sy%d", 1:4, if (eqR) paste0("r", 1:4, "*") else "", 1:4), sprintf("y%d ~~ %sy%d", 5:8, if (eqR) paste0("r", 1:4, "*") else "", 5:8),
  sprintf("y%d ~~ y%d", 1:4, 5:8)), collapse = "\n")
for (est in c("ML", "MLR")) {
  fits <- list(configural = lavaan(lv(FALSE, FALSE, FALSE), pd, estimator = est), metric = lavaan(lv(TRUE, FALSE, FALSE), pd, estimator = est),
    scalar = lavaan(lv(TRUE, TRUE, FALSE), pd, estimator = est), strict = lavaan(lv(TRUE, TRUE, TRUE), pd, estimator = est))
  lrt <- lavTestLRT(fits$configural, fits$metric, fits$scalar, fits$strict)
  pick <- function(f, a, b) unname(if (est == "MLR") fitMeasures(f, b) else fitMeasures(f, a))
  pe <- parameterEstimates(fits$scalar)
  out[[paste0("longInvariance", est)]] <- list(chisq = sapply(fits, pick, "chisq", "chisq.scaled"), df = sapply(fits, function(f) unname(fitMeasures(f, "df"))),
    cfi = sapply(fits, pick, "cfi", "cfi.robust"), rmsea = sapply(fits, pick, "rmsea", "rmsea.robust"), srmr = sapply(fits, function(f) unname(fitMeasures(f, "srmr"))),
    chisqDiff = unname(lrt[["Chisq diff"]][2:4]), p = unname(lrt[["Pr(>Chisq)"]][2:4]),
    scalarMean = pe$est[pe$lhs == "d65" & pe$op == "~1"], scalarMeanSe = pe$se[pe$lhs == "d65" & pe$op == "~1"], scalarVar = pe$est[pe$lhs == "d65" & pe$op == "~~" & pe$rhs == "d65"])
}

writeLines(toJSON(list(generated = format(Sys.time()), R = R.version.string, lavaan = as.character(packageVersion("lavaan")),
  sirt = as.character(packageVersion("sirt")), mnlfa = as.character(packageVersion("mnlfa")), cases = out), auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null", na = "null"),
  "src/engine/__fixtures__/invariance/reference.json")
cat("written\n")
