# Native reference for the CB-SEM admissibility check (src/rengine/admissibility.webr.test.ts):
# deliberately improper solutions, examined by direct lavaan calls (eigen() of lavInspect's
# matrices, parameterEstimates' Wald intervals, lavTables' observed frequencies), independently of
# the app's R bridge.
#  - sabatelli: Kline's Heywood case (Sabatelli & Bartle-Haring 2003, N = 103, covariance input):
#    a negative residual variance;
#  - overfactored: Holzinger-Swineford with the visual factor split in two (vA: x1, x2; vB: x3, x9)
#    and speed on x7, x8: a latent correlation beyond 1, cov.lv not positive definite;
#  - overfactored_groups: the same by school with equal loadings (metric invariance): per-group
#    matrices and vcov with one zero eigenvalue per equality constraint;
#  - proper: the ?cfa model (admissible);
#  - ordinal: the HS items cut into five equal-width categories (x1-x6), two factors, WLSMV: the
#    pairs with empty cells in their two-way tables (table() by hand).
# Run: Rscript scripts/validation/admissibility.R  (writes src/engine/__fixtures__/admissibility/reference.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})

#' Eigenvalue range of one symmetric matrix (a list of them per block in a multiple-group fit).
spectrum <- function(m) {
  e <- eigen(unclass(m), symmetric = TRUE, only.values = TRUE)$values
  list(min = min(e), max = max(e))
}
per_block <- function(x) if (is.matrix(x)) list(x) else x

#' Everything the test compares, from one fit.
describe <- function(fit) {
  pe <- parameterEstimates(fit, level = 0.95)
  neg <- pe[pe$op == "~~" & pe$lhs == pe$rhs & pe$est < 0, ]
  vc <- unclass(lavInspect(fit, "vcov"))
  ev <- sort(eigen(vc, symmetric = TRUE, only.values = TRUE)$values)
  pt <- parTable(fit)
  neq <- sum(pt$op == "==")
  cl <- per_block(lavInspect(fit, "cor.lv"))
  list(
    blocks = lapply(seq_along(per_block(lavInspect(fit, "cov.lv"))), function(b) {
      list(
        implied = spectrum(per_block(lavInspect(fit, "cov.ov"))[[b]]),
        latent = spectrum(per_block(lavInspect(fit, "cov.lv"))[[b]]),
        theta = spectrum(per_block(lavInspect(fit, "theta"))[[b]]),
        maxLatentCor = {
          r <- unclass(cl[[b]])
          max(abs(r[upper.tri(r)]))
        }
      )
    }),
    negative = lapply(seq_len(nrow(neg)), function(i) {
      list(
        name = neg$lhs[i], group = if ("group" %in% names(neg)) neg$group[i] else 1,
        est = neg$est[i], se = neg$se[i], low = neg$ci.lower[i], high = neg$ci.upper[i]
      )
    }),
    vcov = list(
      constraints = neq,
      dropped = if (neq) ev[seq_len(neq)] else numeric(0),
      min = ev[neq + 1], max = max(ev)
    ),
    postCheck = suppressWarnings(lavInspect(fit, "post.check"))
  )
}
quiet <- function(expr) suppressWarnings(expr)
out <- list()

# Sabatelli & Bartle-Haring (2003), Kline ch. 14 (as scripts/validation/kline.R)
S <- lavaan::cor2cov(
  lavaan::getCov(
    " 1.000 \n .740 1.000 \n .265 .422 1.000 \n .305 .401 .791 1.000 \n .315 .351 .662 .587 1.000",
    names = c("problems", "intimacy", "father", "mother", "both")
  ),
  sds = c(32.936, 22.749, 13.390, 13.679, 14.382)
)
out$sabatelli <- describe(quiet(sem(
  "Marital =~ problems + intimacy\nFOE =~ father + mother + both",
  sample.cov = S, sample.nobs = 103
)))

hs <- HolzingerSwineford1939
over <- "vA =~ x1 + x2\nvB =~ x3 + x9\ntx =~ x4 + x5 + x6\nsp =~ x7 + x8"
out$overfactored <- describe(quiet(cfa(over, data = hs)))
out$overfactored_groups <- describe(quiet(cfa(over, data = hs, group = "school", group.equal = "loadings")))
out$proper <- describe(cfa("visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9", data = hs))

# Ordinal: x1-x6 cut into five equal-width categories; the pairs with empty cells, by table().
ord <- hs[, paste0("x", 1:6)]
for (v in names(ord)) ord[[v]] <- cut(ord[[v]], 5, labels = FALSE)
items <- names(ord)
pairs <- list()
for (i in 1:5) {
  for (j in (i + 1):6) {
    # (the categories each variable has, as lavTables tabulates them)
    t <- table(ord[[i]], ord[[j]])
    if (any(t == 0)) {
      pairs[[length(pairs) + 1]] <- list(a = items[i], b = items[j], cells = length(t), empty = sum(t == 0), sparse = sum(t < 5))
    }
  }
}
fit_o <- quiet(cfa("a =~ x1 + x2 + x3\nb =~ x4 + x5 + x6", data = ord, ordered = items))
R <- cov2cor(unclass(lavInspect(fit_o, "sampstat")$cov))
for (k in seq_along(pairs)) pairs[[k]]$r <- R[pairs[[k]]$a, pairs[[k]]$b]
out$ordinal <- list(data = ord, pairs = pairs, fit = describe(fit_o))

dir <- file.path("src", "engine", "__fixtures__", "admissibility")
dir.create(dir, recursive = TRUE, showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(dir, "reference.json"))
cat("wrote", file.path(dir, "reference.json"), "\n")
