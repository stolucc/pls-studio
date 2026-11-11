# Reference results for the endogeneity methods, from plain package calls
# (independent of PLS Studio's code), on the packages' own examples:
#   REndo copulaCorrection (dataCopCont2, two continuous endogenous regressors:
#     control function + bootstrap), hetErrorsIV (dataHetIV), higherMomentsIV
#     (dataHigherMoments), latentIV (dataLatentIV) -- the help pages' models;
#   ivreg on Kmenta (?ivreg), sampleSelection on Mroz87 (?selection, without
#     the squared terms).
# Also writes REndo's example datasets for the app (REndo cannot run in the
# browser's R, so its data ship with the app):
#   R_LIBS=/path/to/lib Rscript scripts/validation/endo.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(REndo)
  library(ivreg)
  library(sampleSelection)
})
root <- "src/engine/__fixtures__/endo"
pub <- "public/examples/rendo"
tab <- function(m, ci = NULL) lapply(seq_len(nrow(m)), function(i) list(term = rownames(m)[i], est = m[i, 1], se = m[i, 2], p = m[i, 4]))
out <- list(versions = c(REndo = as.character(packageVersion("REndo")), ivreg = as.character(packageVersion("ivreg")), sampleSelection = as.character(packageVersion("sampleSelection"))))
for (n in c("dataCopCont2", "dataHetIV", "dataHigherMoments", "dataLatentIV")) {
  e <- new.env()
  data(list = n, package = "REndo", envir = e)
  write.csv(e[[n]], file.path(pub, paste0(n, ".csv")), row.names = FALSE)
}

data(dataCopCont2, package = "REndo")
set.seed(1)
cc <- copulaCorrection(y ~ X1 + X2 + P1 + P2 | continuous(P1, P2), data = dataCopCont2, num.boots = 200, verbose = FALSE)
out$copula <- list(
  coef = as.list(coef(cc)), bootSd = as.list(apply(cc$boots.params, 1, sd)),
  summary = lapply(seq_len(nrow(coef(summary(cc)))), function(i) {
    m <- coef(summary(cc))
    list(term = rownames(m)[i], est = m[i, 1], se = m[i, 2], ciLow = m[i, 3], ciHigh = m[i, 4])
  })
)
data(dataHetIV, package = "REndo")
het <- hetErrorsIV(y ~ X1 + X2 + P | P | IIV(X1, X2), data = dataHetIV, verbose = FALSE)
out$het <- list(coef = tab(coef(summary(het))), diagnostics = unclass(summary(het)$diagnostics))
data(dataHigherMoments, package = "REndo")
hm <- higherMomentsIV(y ~ X1 + X2 + P | P | IIV(iiv = gp, g = x2, X1, X2) + IIV(iiv = yp), data = dataHigherMoments, verbose = FALSE)
out$hm <- list(coef = tab(coef(summary(hm))))
data(dataLatentIV, package = "REndo")
liv <- latentIV(y ~ P, data = dataLatentIV, verbose = FALSE)
out$liv <- list(
  coef = lapply(seq_len(nrow(coef(summary(liv)))), function(i) {
    m <- coef(summary(liv))
    list(term = rownames(m)[i], est = m[i, 1], se = m[i, 2], p = m[i, 4])
  }),
  logLik = as.numeric(logLik(liv))
)
data(Kmenta, package = "ivreg")
iv <- ivreg(Q ~ P + D | D + F + A, data = Kmenta)
s <- summary(iv, diagnostics = TRUE)
out$iv <- list(coef = tab(coef(s)), diagnostics = lapply(seq_len(nrow(s$diagnostics)), function(i) list(test = rownames(s$diagnostics)[i], stat = s$diagnostics[i, 3], p = s$diagnostics[i, 4])))
data(Mroz87, package = "sampleSelection")
for (m in "2step") { # (ML without the squared terms runs into the boundary: rho near 1)
  h <- selection(lfp ~ age + faminc + kids5 + educ, wage ~ exper + educ + city, data = Mroz87, method = m)
  out[[paste0("heckman_", m)]] <- list(coef = tab(summary(h)$estimate))
}
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "reference.json"))
cat("written\n")
