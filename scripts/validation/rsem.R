# Reference for robust ML (Yuan & Zhang 2012; rsem): the three-factor CFA on
# HolzingerSwineford1939 x1-x9 with x1 missing in rows 3 and 10, rsem's steps
# as in rsem.lavaan (varphi = 0.1): robust moments by EM, ML fit (mimic EQS),
# robust standard errors, TRML and the case weights.
#   R_LIBS=/path/to/lib Rscript scripts/validation/rsem.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(rsem)
})
X <- data.matrix(HolzingerSwineford1939[, paste0("x", 1:9)])
X[c(3, 10), "x1"] <- NA
m <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
invisible(capture.output(a <- rsem.lavaan(X, m, varphi = 0.1)))
pe <- parameterEstimates(a$lavaan)
pt <- parTable(a$lavaan)
se <- a$se$se[[1]][pt$free[pt$free > 0 & pt$op == "=~"]]
ld <- pe[pe$op == "=~" & pt$free > 0, ]
pat <- rsem.pattern(X)
w <- numeric(nrow(X))
w[order(as.vector(is.na(X) %*% 2^(seq_len(ncol(X)) - 1)))] <- a$musig$weight$w1
stopifnot(all.equal(sort(w), sort(a$musig$weight$w1)))
low <- order(w)[1:5]
out <- list(
  rsem = as.character(packageVersion("rsem")), lavaan = as.character(packageVersion("lavaan")),
  loadings = setNames(as.list(ld$est), paste(ld$lhs, ld$rhs)), se = setNames(as.list(se), paste(ld$lhs, ld$rhs)),
  trml = setNames(as.list(a$fit$TRML[[1]]), c("stat", "df", "p")),
  lowest = list(rows = low, weights = w[low])
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/rsem/reference.json")
cat("written\n")
