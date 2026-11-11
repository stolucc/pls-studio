# Reference results for the Meta-analysis card (R/meta.R): metafor called directly, as its help pages do, on the
# datasets of metadat: dat.bcg (?rma: risk ratios, the random-effects model and the meta-regression on ablat and
# year), dat.normand1999 (standardised and raw mean differences), dat.molloy2014 (Fisher's z of correlations),
# dat.pritz1997 (proportions) and dat.konstantopoulos2011 (?rma.mv: the three-level model). Each case records the data
# it used (numeric columns), so the test builds the same dataset without R.
#
#   Rscript scripts/validation/meta.R [library]

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressPackageStartupMessages({
  library(metafor)
  library(jsonlite)
})

columns <- function(d) {
  list(names = names(d), cols = unname(lapply(d, as.numeric)))
}

coefs <- function(res) {
  cs <- coef(summary(res))
  lapply(seq_len(nrow(cs)), function(i) {
    list(
      term = rownames(cs)[i],
      est = cs$estimate[i],
      se = cs$se[i],
      p = cs$pval[i],
      ciLow = cs$ci.lb[i],
      ciHigh = cs$ci.ub[i]
    )
  })
}

pred <- function(p) {
  list(
    est = as.numeric(p$pred),
    ciLow = as.numeric(p$ci.lb),
    ciHigh = as.numeric(p$ci.ub),
    piLow = as.numeric(p$pi.lb %||% p$ci.lb),
    piHigh = as.numeric(p$pi.ub %||% p$ci.ub)
  )
}

regtest_ref <- function(r) {
  list(stat = r$zval, p = r$pval, est = unname(r$est), ciLow = unname(r$ci.lb), ciHigh = unname(r$ci.ub))
}

#' One model: its coefficients, heterogeneity, Q tests and (without moderators) the pooled estimate.
record <- function(res, dat, transf = NULL) {
  out <- list(
    k = res$k,
    yi = as.numeric(dat$yi),
    vi = as.numeric(dat$vi),
    weights = as.numeric(weights(res)),
    coefs = coefs(res),
    Q = res$QE,
    Qp = res$QEp,
    logLik = as.numeric(logLik(res))
  )
  if (inherits(res, "rma.mv")) {
    out$sigma2 <- res$sigma2
  } else {
    out$tau2 <- res$tau2
    out$I2 <- res$I2
    out$H2 <- res$H2
    if (res$method != "FE") {
      out$tau2se <- res$se.tau2
      ci <- confint(res)$random
      out$ci <- list(
        tau2 = as.numeric(ci[1, ]),
        tau = as.numeric(ci[2, ]),
        I2 = as.numeric(ci[3, ]),
        H2 = as.numeric(ci[4, ])
      )
    }
  }
  if (res$int.only) {
    out$pooled <- pred(predict(res))
    if (!is.null(transf)) out$pooledBack <- pred(predict(res, transf = transf))
  } else {
    out$QM <- res$QM
    out$QMp <- res$QMp
    if (!is.null(res$R2)) out$R2 <- res$R2
  }
  out
}

# ---- dat.bcg (?rma) ----
bcg <- dat.bcg
# alloc as its codes in level order (alternate = 1, random = 2, systematic = 3), as the app codes a text column
bcg$alloc <- as.integer(factor(bcg$alloc))
bcg_cols <- bcg[, c("trial", "year", "tpos", "tneg", "cpos", "cneg", "ablat", "alloc")]
dat <- escalc(measure = "RR", ai = tpos, bi = tneg, ci = cpos, di = cneg, data = bcg)
res <- rma(yi, vi, data = dat)
bcg_re <- record(res, dat, exp)
tf <- trimfill(res)
bcg_re$bias <- list(
  egger = regtest_ref(regtest(res)),
  rank = list(tau = unname(ranktest(res)$tau), p = unname(ranktest(res)$pval)),
  trimfill = list(
    k0 = tf$k0,
    side = tf$side,
    est = as.numeric(tf$beta),
    se = tf$se,
    ciLow = tf$ci.lb,
    ciHigh = tf$ci.ub,
    filled = as.numeric(tf$yi[tf$fill])
  ),
  pet = regtest_ref(regtest(res, model = "lm", predictor = "sei")),
  peese = regtest_ref(regtest(res, model = "lm", predictor = "vi"))
)
inf <- influence(res)$inf
loo <- leave1out(res)
bcg_re$influence <- list(
  rstudent = inf$rstudent,
  dffits = inf$dffits,
  cook = inf$cook.d,
  covr = inf$cov.r,
  tau2del = inf$tau2.del,
  hat = inf$hat,
  influential = as.logical(influence(res)$is.infl)
)
bcg_re$leaveOneOut <- list(est = loo$estimate, se = loo$se, tau2 = loo$tau2, I2 = loo$I2)

# Every tau² estimator on the same data
methods <- c("FE", "ML", "DL", "PM", "HE", "SJ", "EB", "HS")
bcg_methods <- setNames(lapply(methods, function(m) record(rma(yi, vi, data = dat, method = m), dat)), methods)

ref <- list(
  metafor = as.character(packageVersion("metafor")),
  bcg = list(data = columns(bcg_cols), re = bcg_re, methods = bcg_methods),
  # ?rma: the mixed-effects meta-regression on absolute latitude and year
  bcgMods = record(rma(yi, vi, mods = ~ ablat + year, data = dat), dat),
  # the same with the Knapp-Hartung adjustment
  bcgKnha = record(rma(yi, vi, mods = ~ ablat + year, data = dat, test = "knha"), dat),
  # a categorical moderator (the allocation method)
  bcgAlloc = record(rma(yi, vi, mods = ~ factor(alloc), data = dat), dat),
  # the effect sizes given with their standard errors (measure GEN)
  bcgGen = record(rma(yi = dat$yi, sei = sqrt(dat$vi), method = "REML"), dat),
  bcgOR = {
    d <- escalc(measure = "OR", ai = tpos, bi = tneg, ci = cpos, di = cneg, data = bcg)
    record(rma(yi, vi, data = d), d, exp)
  },
  bcgRD = {
    d <- escalc(measure = "RD", ai = tpos, bi = tneg, ci = cpos, di = cneg, data = bcg)
    record(rma(yi, vi, data = d, method = "DL"), d)
  }
)

# ---- dat.normand1999: standardised (Hedges' g) and raw mean differences ----
normand <- dat.normand1999[, c("study", "n1i", "m1i", "sd1i", "n2i", "m2i", "sd2i")]
d_smd <- escalc(measure = "SMD", m1i = m1i, sd1i = sd1i, n1i = n1i, m2i = m2i, sd2i = sd2i, n2i = n2i, data = normand)
d_md <- escalc(measure = "MD", m1i = m1i, sd1i = sd1i, n1i = n1i, m2i = m2i, sd2i = sd2i, n2i = n2i, data = normand)
ref$normand <- list(
  data = columns(normand),
  smd = record(rma(yi, vi, data = d_smd), d_smd),
  smdFE = record(rma(yi, vi, data = d_smd, method = "FE"), d_smd),
  md = record(rma(yi, vi, data = d_md, method = "DL"), d_md)
)

# ---- dat.molloy2014: correlations as Fisher's z, back-transformed to r ----
molloy <- dat.molloy2014[, c("year", "ni", "ri", "meanage", "quality")]
d_z <- escalc(measure = "ZCOR", ri = ri, ni = ni, data = molloy)
ref$molloy <- list(
  data = columns(molloy),
  zcor = record(rma(yi, vi, data = d_z), d_z, transf.ztor),
  zcorPM = record(rma(yi, vi, data = d_z, method = "PM"), d_z, transf.ztor)
)

# ---- dat.pritz1997: proportions (logit and raw) ----
pritz <- dat.pritz1997[, c("study", "xi", "ni")]
d_plo <- escalc(measure = "PLO", xi = xi, ni = ni, data = pritz)
d_pr <- escalc(measure = "PR", xi = xi, ni = ni, data = pritz)
ref$pritz <- list(
  data = columns(pritz),
  plo = record(rma(yi, vi, data = d_plo), d_plo, transf.ilogit),
  pr = record(rma(yi, vi, data = d_pr, method = "FE"), d_pr)
)

# ---- dat.konstantopoulos2011 (?rma.mv): schools nested in districts ----
kon <- as.data.frame(dat.konstantopoulos2011)[, c("district", "school", "study", "year", "yi", "vi")]
ref$konstantopoulos <- list(
  data = columns(kon),
  threeLevel = record(rma.mv(yi, vi, random = ~ 1 | district / school, data = kon), kon),
  threeLevelYear = record(
    rma.mv(yi, vi, mods = ~ year, random = ~ 1 | district / school, data = kon, method = "ML"),
    kon
  )
)
# (the multilevel I² of each level, as the metafor FAQ computes it)
mv <- rma.mv(yi, vi, random = ~ 1 | district / school, data = kon)
W <- diag(1 / kon$vi)
X <- model.matrix(mv)
P <- W - W %*% X %*% solve(t(X) %*% W %*% X) %*% t(X) %*% W
ref$konstantopoulos$threeLevel$I2 <- 100 * mv$sigma2 / (sum(mv$sigma2) + (mv$k - mv$p) / sum(diag(P)))

dir.create("src/engine/__fixtures__/meta", showWarnings = FALSE)
write(
  toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  "src/engine/__fixtures__/meta/reference.json"
)
cat("written\n")
