# Reference for the MCAR tests of the missing-data card (independent of PLS Studio's code): misty's ?na.test examples
# on R's airquality data (153 days, 44 missing values in Ozone and Solar.R):
#   - Example 1, na.test(airquality): Little's (1988) MCAR test, misty's own statistic, and each pattern's share
#     n_j (ybar_j - mu)' Sigma_j^-1 (ybar_j - mu) by Little's formula from mvnmle::mlest (the shares sum to the statistic)
#   - Example 2, na.test(airquality, print = "jamjal"): Jamshidian & Jalal's (2010) Hawkins and Anderson-Darling tests
#     (misty's default seed, 42)
#   - the same two tests by MissMech::TestMCARNormality, the original implementation misty ports: with misty's 20
#     imputations and seed (imputation.number = 20, seed = 42), the medians of its per-imputation p-values are misty's
#     (misty pools by the median); MissMech's default single imputation (seed 110) is printed too, to show how much one
#     imputation can move them
# Writes src/engine/__fixtures__/mcar/airquality.json.
#   Rscript scripts/validation/mcar.R   (with misty, mvnmle, MissMech and jsonlite in the library)

suppressPackageStartupMessages({ library(jsonlite); library(misty); library(mvnmle) })
X <- data.matrix(airquality)
little <- na.test(airquality, print = "little", output = FALSE)$result$little
jj <- na.test(airquality, print = "jamjal", output = FALSE)$result

# Little's d2 by pattern, from the ML estimates (Little 1988, eq. 5)
ml <- suppressWarnings(mlest(X))
key <- apply(is.na(X), 1, function(m) paste(as.integer(m), collapse = ""))
by_pattern <- lapply(sort(unique(key)), function(k) {
  i <- which(key == k); o <- !is.na(X[i[1], ])
  dev <- colMeans(X[i, o, drop = FALSE]) - ml$muhat[o]
  list(key = k, n = length(i), k = sum(o), d2 = length(i) * drop(t(dev) %*% solve(ml$sigmahat[o, o]) %*% dev))
})
cat(sprintf("Little: chi2 = %.10f, df = %d, p = %.10g; by pattern sum = %.10f\n", little$statistic, little$df, little$p, sum(vapply(by_pattern, `[[`, 0, "d2"))))
print(jj$hawkins); print(jj$anderson)

mm <- if (requireNamespace("MissMech", quietly = TRUE)) {
  t20 <- MissMech::TestMCARNormality(airquality, imputation.number = 20, seed = 42)
  t1 <- MissMech::TestMCARNormality(airquality)
  cat(sprintf("MissMech, 20 imputations, seed 42: median p Hawkins %.10g, Anderson-Darling %.10g; one imputation (seed 110): %.10g, %.10g\n",
    median(t20$pvalcomb), median(t20$pnormality), t1$pvalcomb, t1$pnormality))
  list(version = as.character(packageVersion("MissMech")), hawkinsP = median(t20$pvalcomb), andersonP = median(t20$pnormality), patterns = t20$g,
    single = list(hawkinsP = t1$pvalcomb, andersonP = t1$pnormality))
} else NULL

out <- list(R = R.version.string, misty = as.character(packageVersion("misty")), mvnmle = as.character(packageVersion("mvnmle")),
  little = list(n = little$no.cases, incomplete = little$no.incomplete, patterns = little$no.pattern, chisq = little$statistic, df = little$df, p = little$p,
    byPattern = by_pattern),
  jamjal = list(n = jj$hawkins$no.cases, incomplete = jj$hawkins$no.incomplete, patterns = jj$hawkins$no.pattern, patternN = jj$jamjal$n.pattern,
    hawkins = list(stat = jj$hawkins$statistic, df = jj$hawkins$df, p = jj$hawkins$p), anderson = list(stat = jj$anderson$statistic, p = jj$anderson$p)),
  MissMech = mm)
dir.create("src/engine/__fixtures__/mcar", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/mcar/airquality.json")
