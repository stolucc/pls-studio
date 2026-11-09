# Reference results for PLSc with interaction and quadratic terms, from plain
# cSEM calls (independent of PLS Studio's code), on seminr's mobi data:
#   csem(.disattenuate = TRUE), which corrects the moments of the composites'
#   products (Dijkstra & Schermelleh-Engel 2014).
#   Rscript scripts/validation/plsc_nonlinear.R
suppressPackageStartupMessages({ library(cSEM); library(jsonlite) })
d <- read.csv("src/engine/__fixtures__/mobi.csv")
M <- c(EXPE = "EXPE =~ CUEX1 + CUEX2 + CUEX3", QUAL = "QUAL =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7",
  VAL = "VAL =~ PERV1 + PERV2", SAT = "SAT =~ CUSA1 + CUSA2 + CUSA3", LOY = "LOY =~ CUSL1 + CUSL2 + CUSL3")
fit <- function(structural) {
  used <- names(M)[vapply(names(M), function(k) grepl(k, structural), TRUE)]
  f <- csem(d, paste(c(M[used], structural), collapse = "\n"), .disattenuate = TRUE, .PLS_weight_scheme_inner = "path", .tolerance = 1e-7, .iter_max = 300)
  P <- f$Estimates$Path_estimates
  list(paths = lapply(setNames(seq_len(nrow(P)), rownames(P)), function(i) as.list(P[i, ])),
    rhoA = as.list(f$Estimates$Reliabilities), r2 = as.list(f$Estimates$R2))
}
out <- list(
  moderation = fit("SAT ~ EXPE + QUAL + EXPE.QUAL"),
  twoMod = fit("SAT ~ EXPE + QUAL + VAL + EXPE.QUAL + EXPE.VAL"),
  quadratic = fit("SAT ~ QUAL + QUAL.QUAL"),
  chain = fit("SAT ~ EXPE + QUAL + EXPE.QUAL\nLOY ~ SAT"),
  endogenous = fit("SAT ~ EXPE + QUAL\nLOY ~ SAT + EXPE + SAT.EXPE"),
  threeWay = fit("SAT ~ EXPE + QUAL + VAL + EXPE.QUAL + EXPE.VAL + QUAL.VAL + EXPE.QUAL.VAL"))
# Standard PLS with a three-way interaction, by the two-stage approach with plain seminr calls (seminr's interaction_term
# takes two constructs only): products of the stage 1 scores as single items; coefficients per unit of the product.
suppressPackageStartupMessages(library(seminr))
ms <- list(composite("EXPE", multi_items("CUEX", 1:3)), composite("QUAL", multi_items("PERQ", 1:7)), composite("VAL", multi_items("PERV", 1:2)), composite("SAT", multi_items("CUSA", 1:3)))
s1 <- suppressMessages(estimate_pls(d, do.call(constructs, ms), relationships(paths(from = c("EXPE", "QUAL", "VAL"), to = "SAT"))))
H <- s1$construct_scores
tm <- list(EQ = H[, "EXPE"] * H[, "QUAL"], EV = H[, "EXPE"] * H[, "VAL"], QV = H[, "QUAL"] * H[, "VAL"], EQV = H[, "EXPE"] * H[, "QUAL"] * H[, "VAL"])
d2 <- d; for (k in names(tm)) d2[[paste0("t", k)]] <- tm[[k]]
s2 <- suppressMessages(estimate_pls(d2, do.call(constructs, c(ms, lapply(names(tm), function(k) composite(k, single_item(paste0("t", k)))))), relationships(paths(from = c("EXPE", "QUAL", "VAL", names(tm)), to = "SAT"))))
B <- s2$path_coef[, "SAT"]
out$threeWayStandard <- list(paths = as.list(c(B[c("EXPE", "QUAL", "VAL")], unlist(lapply(names(tm), function(k) B[[k]] / sd(tm[[k]]))) |> setNames(names(tm)))), r2 = s2$rSquared["Rsq", "SAT"])
# Pre-defined weights (cSEM), and results on the original scale from plain lm() on rescaled composites: outer weights
# per raw unit, normalised to sum to 1 (Fornell's rescaling); intercept as estimated, and 0 once mean-centred.
pd <- csem(d, "EXPE <~ CUEX1 + CUEX2 + CUEX3\nSAT <~ CUSA1 + CUSA2 + CUSA3\nSAT ~ EXPE", .PLS_modes = list(EXPE = c(CUEX1 = .5, CUEX2 = .3, CUEX3 = .2)), .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300)
out$predefined <- list(weights = as.list(pd$Estimates$Weight_estimates["EXPE", paste0("CUEX", 1:3)]), weightsSAT = as.list(pd$Estimates$Weight_estimates["SAT", paste0("CUSA", 1:3)]), path = pd$Estimates$Path_estimates["SAT", "EXPE"], r2 = pd$Estimates$R2[["SAT"]])
st <- suppressMessages(estimate_pls(d, constructs(composite("EXPE", multi_items("CUEX", 1:3)), composite("QUAL", multi_items("PERQ", 1:7)), composite("SAT", multi_items("CUSA", 1:3))), relationships(paths(from = c("EXPE", "QUAL"), to = "SAT"))))
rescaled <- function(items, k) { w <- st$outer_weights[items, k] / apply(d[items], 2, sd); as.matrix(d[items]) %*% (w / sum(w)) }
Y <- data.frame(EXPE = rescaled(paste0("CUEX", 1:3), "EXPE"), QUAL = rescaled(paste0("PERQ", 1:7), "QUAL"), SAT = rescaled(paste0("CUSA", 1:3), "SAT"))
un <- coef(lm(SAT ~ EXPE + QUAL, Y)); mc <- coef(lm(SAT ~ EXPE + QUAL, as.data.frame(scale(Y, scale = FALSE))))
out$originalScale <- list(unstandardized = as.list(un), meanCentred = as.list(mc), std = as.list(st$path_coef[c("EXPE", "QUAL"), "SAT"]))
# A binary moderator: lm() with the 0/1 variable as it is, on standardised scores of the others.
sc <- as.data.frame(st$construct_scores); dd <- as.numeric(d$CUSCO >= median(d$CUSCO)); sc$D <- dd
z <- function(v) (v - mean(v)) / sd(v)
fb <- coef(lm(z(SAT) ~ z(EXPE) * D, sc))
out$binaryLm <- as.list(fb)
out$binaryMedian <- median(d$CUSCO)
write_json(out, "src/engine/__fixtures__/plsc_nonlinear/reference.json", auto_unbox = TRUE, digits = 10, pretty = TRUE)
