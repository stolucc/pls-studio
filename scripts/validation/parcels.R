# Reference results for parcels, from plain lavaan and semTools calls (independent of PLS Studio's code), on the Big Five
# items of psych::bfi (shipped as public/examples/samples/bfi.csv), negatively keyed items reversed (7 − x):
#   item-to-construct balance (Little et al. 2002): items ranked by their standardised loading in a one-factor model of
#     the factor, dealt to the parcels in serpentine order (1, 2, 3, 3, 2, ...); a parcel is the items' mean;
#   the five-factor CFA on the items and on those parcels (lavaan ML, complete cases);
#   semTools::parcelAllocation: the spread of fit over random allocations (Sterba & MacCallum 2010).
#   Rscript scripts/validation/parcels.R
suppressPackageStartupMessages({
  library(lavaan)
  library(semTools)
  library(jsonlite)
})
d <- read.csv("public/examples/samples/bfi.csv")
reversed <- c("A1", "C4", "C5", "E1", "E2", "O2", "O5")
for (k in reversed) d[[paste0(k, "r")]] <- 7 - d[[k]]
F <- c("A", "C", "E", "N", "O")
items <- setNames(lapply(F, function(f) ifelse(paste0(f, 1:5) %in% reversed, paste0(f, 1:5, "r"), paste0(f, 1:5))), F)
k <- 3
balance <- function(f) {
  fit <- cfa(paste(f, "=~", paste(items[[f]], collapse = " + ")), d, std.lv = TRUE, missing = "listwise")
  s <- standardizedSolution(fit)
  l <- setNames(s$est.std[s$op == "=~"], s$rhs[s$op == "=~"])
  ord <- names(sort(l, decreasing = TRUE))
  slot <- rep(c(seq_len(k), rev(seq_len(k))), length.out = length(ord))
  list(loadings = as.list(l), parcels = lapply(seq_len(k), function(p) I(ord[slot == p])))
}
bal <- setNames(lapply(F, balance), F)
cc <- d[complete.cases(d[unlist(items)]), ]
pd <- cc
for (f in F) for (p in seq_len(k)) pd[[sprintf("%s_P%d", f, p)]] <- rowMeans(cc[, as.character(bal[[f]]$parcels[[p]]), drop = FALSE])
mi <- paste(sapply(F, function(f) paste(f, "=~", paste(items[[f]], collapse = " + "))), collapse = "\n")
mp <- paste(sapply(F, function(f) paste(f, "=~", paste(sprintf("%s_P%d", f, seq_len(k)), collapse = " + "))), collapse = "\n")
fi <- cfa(mi, cc)
fp <- cfa(mp, pd)
fm <- function(fit) c(as.list(fitMeasures(fit, c("chisq", "df", "cfi", "tli", "rmsea", "srmr"))), proper = lavInspect(fit, "post.check"))
std <- standardizedSolution(fp)
covs <- std[std$op == "~~" & std$lhs != std$rhs & std$lhs %in% F & std$rhs %in% F, ]
# semTools needs at least two items per parcel: its random allocations use two parcels per factor (three and two items),
# and the same balanced split for the app's comparison.
bal2 <- setNames(lapply(F, function(f) {
  o <- names(sort(unlist(bal[[f]]$loadings), decreasing = TRUE))
  slot <- rep(c(1, 2, 2, 1), length.out = length(o))
  lapply(1:2, function(p) I(o[slot == p]))
}), F)
mp2 <- paste(sapply(F, function(f) paste(f, "=~", paste(sprintf("%s_Q%d", f, 1:2), collapse = " + "))), collapse = "\n")
pa <- suppressWarnings(suppressMessages(parcelAllocation(
  model = mp2, data = cc, parcel.names = unlist(lapply(F, function(f) sprintf("%s_Q%d", f, 1:2))),
  item.syntax = mi, nAlloc = 100, iseed = 12345, fun = "cfa", show.progress = FALSE, do.fit = TRUE
)))
fs <- as.data.frame(pa$Fit)
out <- list(
  n = nrow(cc), reversed = reversed, items = items, balance = bal, itemFit = fm(fi), fit = fm(fp),
  covariances = lapply(seq_len(nrow(covs)), function(i) list(lhs = covs$lhs[i], rhs = covs$rhs[i], std = covs$est.std[i])),
  balance2 = bal2, allocation2 = lapply(split(fs, rownames(fs)), function(r) as.list(r[c("Avg", "SD", "Min", "Max")]))
)
write_json(out, "src/engine/__fixtures__/parcels/reference.json", auto_unbox = TRUE, digits = 10, pretty = TRUE)
