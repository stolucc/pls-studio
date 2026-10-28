# Reference values for Vale-Maurelli (1983) non-normal data generation.
# Fleishman (1978) coefficients are solved to high precision (residual < 1e-12)
# and compared with lavaan's lav_fleishman1978 start; intermediate correlations
# are the real root in [-1, 1] of the Vale-Maurelli cubic (polyroot).
# Run from the repo root: Rscript scripts/make-vm-fixtures.R
suppressMessages(library(jsonlite))
out <- "src/engine/__fixtures__/vale-maurelli.json"

eqs <- function(x, sk, ku) {
  b <- x[1]; c <- x[2]; d <- x[3]
  c(b*b + 6*b*d + 2*c*c + 15*d*d - 1,
    2*c*(b*b + 24*b*d + 105*d*d + 2) - sk,
    24*(b*d + c*c*(1 + b*b + 28*b*d) + d*d*(12 + 48*b*d + 141*c*c + 225*d*d)) - ku)
}
jac <- function(x, sk, ku, h = 1e-7) sapply(1:3, function(k) { e <- replace(numeric(3), k, h); (eqs(x + e, sk, ku) - eqs(x - e, sk, ku)) / (2*h) })
fleishman <- function(sk, ku) {
  x <- nlminb(c(1, 0, 0), function(x) sum(eqs(x, sk, ku)^2), scale = 10, control = list(rel.tol = 1e-14))$par
  for (i in 1:50) x <- x - solve(jac(x, sk, ku), eqs(x, sk, ku))   # Newton refinement
  stopifnot(max(abs(eqs(x, sk, ku))) < 1e-12)
  c(a = -x[2], b = x[1], c = x[2], d = x[3])
}
cases <- list(c(0, 0), c(1, 1), c(1, 3), c(2, 7), c(-1.5, 5), c(0.5, -0.5), c(0, 3))
fl <- lapply(cases, function(k) { f <- fleishman(k[1], k[2]); list(skew = k[1], kurt = k[2], a = f[["a"]], b = f[["b"]], c = f[["c"]], d = f[["d"]]) })

inter <- function(f1, f2, r) {
  co <- c(-r, f1$b*f2$b + 3*f1$b*f2$d + 3*f1$d*f2$b + 9*f1$d*f2$d, 2*f1$c*f2$c, 6*f1$d*f2$d)
  z <- polyroot(co); z <- Re(z[abs(Im(z)) < 1e-9]); z <- z[z >= -1 & z <= 1]
  z[which.min(abs(z - r))]
}
pairs <- list(list(1, 2, 0.5), list(3, 4, 0.6), list(4, 5, -0.3), list(2, 2, 0.8), list(6, 7, 0.4))
ic <- lapply(pairs, function(p) list(i = p[[1]] - 1, j = p[[2]] - 1, r = p[[3]], rho = inter(fl[[p[[1]]]], fl[[p[[2]]]], p[[3]])))
write_json(list(fleishman = fl, intermediate = ic, R = paste(R.version$major, R.version$minor, sep = ".")), out, digits = NA, auto_unbox = TRUE, pretty = TRUE)
cat("wrote", out, "\n")
