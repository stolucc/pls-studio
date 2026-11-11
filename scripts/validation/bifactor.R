# Reference results for bifactor ESEM blocks (bi-geomin, bi-quartimin; oblique and orthogonal),
# from desktop lavaan: Thurstone's nine ability tests (psych::Thurstone, Bechtoldt 1961, n = 213),
# a general factor and three specific ones (verbal, word fluency, reasoning).
#
#   Rscript scripts/validation/bifactor.R
#
# lavaan orders the rotated columns by its own rule, so each column is named here independently of
# the app: the general factor is the column with the largest sum of squared loadings, each specific
# factor the remaining column with the largest squared loadings on its three tests. The bifactor
# indices are computed from the standardised solution (Rodriguez, Reise & Haviland 2016), and for the
# orthogonal bi-geomin solution also by psych::omegaFromSem (an independent implementation; it counts
# each test's loading on its own specific factor only, so with ESEM's cross-loadings its omega
# (.9326 against .9332) and omega hierarchical (.785 against .789) differ slightly).

suppressMessages({
  library(lavaan)
  library(psych)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/esem"
S <- psych::Thurstone
v <- colnames(S)
groups <- list(verbal = v[1:3], fluency = v[4:6], reasoning = v[7:9])
m <- sprintf('efa("b1")*c1 + efa("b1")*c2 + efa("b1")*c3 + efa("b1")*c4 =~ %s', paste(v, collapse = " + "))

one <- function(rot, orth) {
  # (gpa.tol as the app: at lavaan's default the bifactor loadings vary in the third decimal with the random starts)
  f <- sem(m, sample.cov = S, sample.nobs = 213, rotation = rot, rotation.args = list(orthogonal = orth, gpa.tol = 1e-8))
  std <- lavInspect(f, "std")
  L <- std$lambda
  ss <- colSums(L^2)
  gen <- names(which.max(ss))
  rest <- setdiff(colnames(L), gen)
  name <- c(setNames("g", gen))
  for (s in names(groups)) {
    col <- rest[which.max(colSums(L[groups[[s]], rest, drop = FALSE]^2))]
    name[col] <- s
    rest <- setdiff(rest, col)
  }
  colnames(L) <- name[colnames(L)]
  L <- L[, c("g", names(groups))]
  P <- lavInspect(f, "cor.lv")
  dimnames(P) <- list(name[rownames(P)], name[colnames(P)])
  P <- P[colnames(L), colnames(L)]
  C <- L %*% P %*% t(L)
  Sig <- C + std$theta
  part <- function(ii, k) {
    tot <- sum(Sig[ii, ii])
    c(omega = sum(C[ii, ii]) / tot, omegaH = sum(L[ii, k])^2 * P[k, k] / tot)
  }
  all <- part(v, "g")
  list(
    fit = as.list(fitMeasures(f, c("chisq", "df"))),
    loadings = lapply(colnames(L), function(k) list(factor = k, std = unname(L[, k]))),
    factorCor = unname(P),
    bifactor = list(
      general = "g", items = length(v), ecv = sum(L[, "g"]^2) / sum(L^2), omega = unname(all["omega"]), omegaH = unname(all["omegaH"]),
      specific = lapply(names(groups), function(s) {
        x <- part(groups[[s]], s)
        list(factor = s, omega = unname(x["omega"]), omegaHS = unname(x["omegaH"]), items = 3L)
      })
    )
  )
}

out <- list(
  lavaan = as.character(packageVersion("lavaan")), indicators = v, S = unname(S), groups = groups,
  bigeomin = one("bigeomin", FALSE), bigeomin_orthogonal = one("bigeomin", TRUE),
  biquartimin = one("biquartimin", FALSE), biquartimin_orthogonal = one("biquartimin", TRUE)
)

# psych's own computation for the orthogonal bi-geomin solution
f <- sem(m, sample.cov = S, sample.nobs = 213, rotation = "bigeomin", rotation.args = list(orthogonal = TRUE, gpa.tol = 1e-8))
o <- suppressWarnings(psych::omegaFromSem(f, m, plot = FALSE))
out$psych <- list(omegaH = o$omega, omega = o$omega.tot)

write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "thurstone_bifactor.json"))
cat("written\n")
