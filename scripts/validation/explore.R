# Reference for the descriptives card (src/rengine/R/explore.R), written without the app's code:
# psych::describe (type = 2: skewness and kurtosis as SPSS defines them), base R's quantile(),
# t-based CIs and table(), nortest's Lilliefors and Anderson-Darling tests and shapiro.test, on R's
# ToothGrowth (len by supp) and airquality (Ozone by Month, 37 missing values). SPSS's standard
# errors of skewness and kurtosis are written out here.
# Writes src/engine/__fixtures__/explore/reference.json; src/rengine/explore.webr.test.ts compares.
#   Rscript scripts/validation/explore.R   (with nortest and psych installed)
suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
  library(nortest)
})

se_skew <- function(n) sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)))
se_kurt <- function(n) 2 * se_skew(n) * sqrt((n^2 - 1) / ((n - 3) * (n + 5)))

reference <- function(x, probs, type) {
  missing <- sum(is.na(x))
  x <- x[!is.na(x)]
  d <- describe(x, type = 2, quant = c(0.25, 0.75), IQR = TRUE)
  n <- length(x)
  half <- qt(0.975, n - 1) * sd(x) / sqrt(n)
  counts <- table(x)
  list(
    n = d$n,
    missing = missing,
    mean = d$mean,
    sd = d$sd,
    se = d$se,
    ciLow = d$mean - half,
    ciHigh = d$mean + half,
    median = d$median,
    q1 = quantile(x, 0.25, type = type, names = FALSE),
    q3 = quantile(x, 0.75, type = type, names = FALSE),
    percentiles = quantile(x, probs, type = type, names = FALSE),
    min = d$min,
    max = d$max,
    range = d$range,
    skewness = d$skew,
    seSkewness = se_skew(n),
    kurtosis = d$kurtosis,
    seKurtosis = se_kurt(n),
    cv = d$sd / d$mean,
    mode = min(as.numeric(names(counts)[counts == max(counts)])),
    modes = sum(counts == max(counts)),
    shapiro = unname(c(shapiro.test(x)$statistic, shapiro.test(x)$p.value)),
    lilliefors = unname(c(lillie.test(x)$statistic, lillie.test(x)$p.value)),
    anderson = unname(c(ad.test(x)$statistic, ad.test(x)$p.value))
  )
}

frame <- function(df) {
  list(
    names = names(df),
    cols = unname(lapply(df, function(x) if (is.factor(x)) as.integer(x) else as.numeric(x))),
    categories = Filter(Negate(is.null), lapply(df, function(x) if (is.factor(x)) levels(x)))
  )
}

tg <- ToothGrowth
aq <- airquality[, c("Ozone", "Month")]
probs <- c(0.05, 0.1, 0.9, 0.95)
dose_counts <- lapply(split(tg$dose, tg$supp), function(x) as.vector(table(x)))
out <- list(
  toothgrowth = frame(tg),
  airquality = frame(aq),
  probs = probs * 100,
  # Type 7 (R, JASP) by supp; type 6 (SPSS) over all rows.
  len = lapply(split(tg$len, tg$supp), reference, probs = probs, type = 7),
  lenType6 = reference(tg$len, probs, 6),
  ozone = lapply(split(aq$Ozone, aq$Month), reference, probs = probs, type = 7),
  doseCounts = dose_counts,
  monthCounts = as.vector(table(aq$Month)),
  versions = list(
    R = R.version.string,
    psych = as.character(packageVersion("psych")),
    nortest = as.character(packageVersion("nortest"))
  )
)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, na = "null", pretty = TRUE),
  "src/engine/__fixtures__/explore/reference.json"
)
cat("written\n")
