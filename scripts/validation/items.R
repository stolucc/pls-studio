# Reference results for item response models (ltm) and latent class analysis
# (poLCA), on the packages' own example data. Pass a library path as the
# first argument to use packages installed outside the default library.
#
#   Rscript scripts/validation/items.R [library]

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressMessages({
  library(ltm)
  library(poLCA)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/items"
lsat <- as.data.frame(LSAT)
names(lsat) <- paste0("item", 1:5)
sci <- Science[c(1, 3, 4, 7)]
sci <- as.data.frame(lapply(sci, as.integer))
names(sci) <- c("comfort", "work", "future", "benefit")
data(values)
write.csv(lsat, file.path(root, "lsat.csv"), row.names = FALSE)
write.csv(sci, file.path(root, "science.csv"), row.names = FALSE)
write.csv(values, file.path(root, "values.csv"), row.names = FALSE)
# coef() rounds graded-response parameters to 3 decimals; IRT.parm() gives them unrounded.
irt <- function(f) {
  cf <- if (inherits(f, "grm")) do.call(rbind, ltm:::IRT.parm(f)$parms) else unclass(coef(f))
  list(coef = cf, logLik = as.numeric(logLik(f)), aic = AIC(f), bic = BIC(f))
}
fits <- list(rasch = irt(rasch(lsat)), twopl = irt(ltm(lsat ~ z1)), grm = irt(grm(sci)))
lca <- lapply(2:3, function(k) {
  set.seed(20261029)
  m <- poLCA(cbind(A, B, C, D) ~ 1, values, nclass = k, nrep = 10, verbose = FALSE)
  list(k = k, llik = m$llik, aic = m$aic, bic = m$bic, npar = m$npar, shares = sort(m$P))
})
write(toJSON(
  list(
    ltm = as.character(packageVersion("ltm")), poLCA = as.character(packageVersion("poLCA")),
    irt = lapply(fits, function(x) {
      x$coef <- lapply(seq_len(nrow(x$coef)), function(i) as.list(x$coef[i, ]))
      x
    }),
    irtRows = list(rasch = rownames(coef(rasch(lsat))), grm = rownames(coef(grm(sci)))), lca = lca
  ),
  auto_unbox = TRUE, digits = NA, pretty = TRUE
), file.path(root, "items.json"))
cat("written\n")
