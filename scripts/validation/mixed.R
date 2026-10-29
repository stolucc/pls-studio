# Reference results for mixed models, from plain package calls (independent of
# PLS Studio's code): lme4 + lmerTest (sleepstudy, random intercepts and
# slopes; R-squared by performance::r2_nakagawa) and lcmm (data_hlme, growth
# mixture models with gridsearch). Native R; packages may be installed in a
# separate library:
#
#   R_LIBS=/path/to/lib Rscript scripts/validation/mixed.R

suppressPackageStartupMessages({ library(jsonlite); library(lmerTest); library(lcmm); library(performance) })
root <- "src/engine/__fixtures__/mixed"
dir.create(root, showWarnings = FALSE, recursive = TRUE)

# ---- lme4: ?lmer, sleepstudy ----
ss <- lme4::sleepstudy
ss$Subject <- as.integer(as.character(ss$Subject))
write.csv(ss, file.path(root, "sleepstudy.csv"), row.names = FALSE)
null <- lmer(Reaction ~ 1 + (1 | Subject), ss)
fit <- lmer(Reaction ~ Days + (Days | Subject), ss)
fit_ri <- lmer(Reaction ~ Days + (1 | Subject), ss)
co <- summary(fit)$coefficients
vc <- as.data.frame(VarCorr(fit))
v0 <- as.data.frame(VarCorr(null))
lrt <- anova(fit_ri, fit, refit = FALSE)
r2 <- r2_nakagawa(fit)
lmm <- list(versions = c(lme4 = as.character(packageVersion("lme4")), lmerTest = as.character(packageVersion("lmerTest"))),
  fixed = lapply(seq_len(nrow(co)), function(i) list(term = rownames(co)[i], est = co[i, 1], se = co[i, 2], df = co[i, 3], t = co[i, 4], p = co[i, 5])),
  random = lapply(seq_len(nrow(vc)), function(i) list(grp = vc$grp[i], var1 = vc$var1[i], var2 = vc$var2[i], vcov = vc$vcov[i], sdcor = vc$sdcor[i])),
  icc = v0$vcov[1] / sum(v0$vcov), r2 = list(marginal = unname(r2$R2_marginal), conditional = unname(r2$R2_conditional)),
  logLik = as.numeric(logLik(fit)), aic = AIC(fit), bic = BIC(fit),
  slopeTest = list(chisq = lrt$Chisq[2], df = lrt$Df[2], p = lrt$`Pr(>Chisq)`[2]))

# ---- lcmm: ?hlme, data_hlme (Y ~ Time + X1, class-specific Time, random intercept and slope) ----
d <- data_hlme
write.csv(d, file.path(root, "data_hlme.csv"), row.names = FALSE)
long <- data.frame(id = d$ID, time = d$Time, y = d$Y, X1 = d$X1)
fits <- list()
fits[["1"]] <- hlme(y ~ time + X1, random = ~ time, subject = "id", ng = 1, data = long)
set.seed(1)
for (k in 2:3) fits[[as.character(k)]] <- eval(bquote(gridsearch(rep = 50, maxiter = 30, minit = fits[["1"]],
  hlme(y ~ time + X1, mixture = ~ time, random = ~ time, subject = "id", ng = .(k), data = long))))
gmm <- list(version = as.character(packageVersion("lcmm")),
  models = lapply(fits, function(m) list(k = m$ng, logLik = m$loglik, npar = length(m$best), bic = m$BIC,
    shares = as.numeric(table(factor(m$pprob$class, levels = seq_len(m$ng)))) / nrow(m$pprob))))
write(toJSON(list(lmm = lmm, gmm = gmm), auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "reference.json"))
cat("written", file.path(root, "reference.json"), "\n")
