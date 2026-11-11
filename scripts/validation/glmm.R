# Reference for the GLMM card's negative binomial and zero-inflated negative binomial families
# (src/rengine/glmm.webr.test.ts): the data of GLMMadaptive's vignette "Zero-Inflated and Two-Part Mixed Effects
# Models" (simulated with its seed: counts with a random intercept per subject, then structural zeros), written as
# a CSV; GLMMadaptive::mixed_model fitted natively as the card calls it (11 quadrature points, its tolerances), with
# negative.binomial() on the counts before the zeros were added and zi.negative.binomial() on the counts with them.
# (The card takes main effects: sex as a 0/1 column, without the vignette's sex × time interaction.)
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/glmm.R
suppressPackageStartupMessages({
  library(GLMMadaptive)
  library(jsonlite)
})
set.seed(1234)
n <- 100
K <- 8
t_max <- 5
DF <- data.frame(
  id = rep(seq_len(n), each = K), time = c(replicate(n, c(0, sort(runif(K - 1, 0, t_max))))),
  sex = rep(gl(2, n / 2, labels = c("male", "female")), each = K)
)
X <- model.matrix(~ sex * time, data = DF)
X_zi <- model.matrix(~sex, data = DF)
betas <- c(1.5, 0.05, 0.05, -0.03)
shape <- 2
gammas <- c(-1.5, 0.5)
D11 <- 0.5
b <- rnorm(n, sd = sqrt(D11))
eta_y <- drop(X %*% betas + b[DF$id])
eta_zi <- drop(X_zi %*% gammas)
DF$nb <- rnbinom(n * K, size = shape, mu = exp(eta_y))
DF$y <- DF$nb
DF$y[as.logical(rbinom(n * K, size = 1, prob = plogis(eta_zi)))] <- 0
DF$female <- as.integer(DF$sex == "female")
d <- DF[, c("id", "time", "female", "nb", "y")]
write.csv(d, "src/engine/__fixtures__/glmm/zinb.csv", row.names = FALSE)
ctl <- list(tol1 = 1e-8, tol2 = 1e-8, tol3 = 1e-12)
fits <- list(
  negbin = mixed_model(
    fixed = nb ~ female + time,
    random = ~ 1 | id,
    data = d,
    family = negative.binomial(),
    nAGQ = 11,
    control = ctl
  ),
  zinb = mixed_model(
    fixed = y ~ female + time,
    random = ~ 1 | id,
    data = d,
    family = zi.negative.binomial(),
    zi_fixed = ~female,
    nAGQ = 11,
    control = ctl
  )
)
tab <- function(s) lapply(seq_len(nrow(s)), function(i) list(term = rownames(s)[i], est = s[i, 1], se = s[i, 2]))
out <- lapply(fits, function(f) {
  s <- summary(f)
  list(
    fixed = tab(s$coef_table),
    zero = if (!is.null(s$coef_table_zi)) tab(s$coef_table_zi) else NULL,
    D = f$D[1, 1],
    logPhi = unname(f$phis),
    logLik = as.numeric(logLik(f)),
    aic = AIC(f),
    bic = BIC(f),
    converged = f$converged
  )
})
out$versions <- list(R = R.version.string, GLMMadaptive = as.character(packageVersion("GLMMadaptive")))
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"),
  "src/engine/__fixtures__/glmm/reference.json"
)
cat("written\n")
