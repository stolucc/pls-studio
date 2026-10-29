# Reference results for exploratory factor analysis / PCA (independent of PLS
# Studio's code): psych called directly on its documented data.
#   - bfi, the 25 Big Five items: minres with oblimin (5 factors), ML with
#     varimax (5 factors, for the fit statistics), KMO, Bartlett, eigenvalues
#     and Velicer's MAP; the numbers of components the retention criteria keep
#     (eigenvalues > 1, MAP, parallel analysis with fa = "pc", 10 samples, seed 1)
#   - Harman.5 (?principal): principal components, 2, varimax
#   R_LIBS=/path/to/lib Rscript scripts/validation/efa.R

suppressPackageStartupMessages({ library(jsonlite); library(psych); library(GPArotation) })
b <- bfi[, 1:25]
R <- cor(b, use = "pairwise.complete.obs")
mr <- fa(b, 5, fm = "minres", rotate = "oblimin")
ml <- fa(b, 5, fm = "ml", rotate = "varimax")
h <- as.data.frame(Harman.5)
pc <- principal(h, 2, rotate = "varimax")
set.seed(1)
par_pc <- fa.parallel(b, fm = "minres", fa = "pc", n.iter = 10, plot = FALSE)
map <- VSS(b, n = 8, fm = "minres", plot = FALSE)$map
L <- function(f) unname(unclass(f$loadings))
out <- list(
  psych = as.character(packageVersion("psych")),
  bfi = list(n = nrow(b), kmo = KMO(R)$MSA, bartlett = cortest.bartlett(R, n = nrow(b))$chisq,
    eigenvalues = eigen(R, symmetric = TRUE, only.values = TRUE)$values,
    map = map, kaiser = sum(eigen(R, symmetric = TRUE, only.values = TRUE)$values > 1), mapK = which.min(map), parallelPc = par_pc$ncomp,
    minres = list(loadings = L(mr), communality = unname(mr$communality), phi = unname(mr$Phi), rmsea = unname(mr$RMSEA[1]), tli = mr$TLI),
    ml = list(loadings = L(ml), chisq = ml$STATISTIC, df = ml$dof, rmsea = unname(ml$RMSEA[1]), tli = ml$TLI, bic = ml$BIC)),
  harman5 = list(loadings = L(pc), communality = unname(pc$communality), cumulative = unname(pc$Vaccounted["Cumulative Var", ])))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/efa/reference.json")
cat("written\n")
