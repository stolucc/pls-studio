# Reference results for the reliability card's Bayesian estimates (independent of PLS Studio's code): Bayesrel
# called directly on its documented data, asrm (the Altman Self-Rating Mania scale, 5 items, n = 78; ?asrm,
# ?strel), with the card's settings: 3 chains of 1000 iterations, burn-in 50, 95% credible intervals, seed 1.
# Then the greatest lower bound too (a second run, seed 1). Same seed, same draws: the card must match exactly.
#   R_LIBS=/path/to/lib Rscript scripts/validation/bayesrel.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(Bayesrel)
})
X <- asrm
summarise <- function(br, estimates) {
  lapply(setNames(estimates, estimates), function(e) {
    key <- paste0("Bayes_", e)
    list(mean = br$Bayes$est[[key]], low = br$Bayes$cred$low[[key]], high = br$Bayes$cred$up[[key]])
  })
}
three <- c("alpha", "lambda2", "omega")
set.seed(1)
br <- strel(X, estimates = three, interval = 0.95, n.iter = 1000, n.burnin = 50, n.chains = 3, freq = FALSE)
four <- c("alpha", "lambda2", "glb", "omega")
set.seed(1)
brGlb <- suppressWarnings(strel(X, estimates = four, interval = 0.95, n.iter = 1000, n.burnin = 50, n.chains = 3,
  freq = FALSE))
out <- list(
  Bayesrel = as.character(packageVersion("Bayesrel")),
  n = nrow(X),
  withoutGlb = summarise(br, three),
  withGlb = summarise(brGlb, four))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/bayesrel/asrm.json")
cat("written\n")
