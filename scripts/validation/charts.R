# Reference for the chart card's box plots and bar charts (src/analyses/charts.test.tsx): R's airquality, Ozone by
# Month (37 missing values; outliers in some months). Box plot: quartiles by quantile(type = 7) (R's default), Tukey
# whiskers at the most extreme values within 1.5 IQR of the quartiles, the values beyond them; bar chart: table().
#   Rscript scripts/validation/charts.R
suppressPackageStartupMessages(library(jsonlite))
d <- airquality[, c("Ozone", "Month")]
write.csv(d, "src/engine/__fixtures__/charts/airquality.csv", row.names = FALSE, na = "")
box <- lapply(split(d$Ozone, d$Month), function(x) {
  x <- sort(x[!is.na(x)])
  q <- unname(quantile(x, c(0.25, 0.5, 0.75), type = 7))
  f <- 1.5 * (q[3] - q[1])
  inside <- x[x >= q[1] - f & x <= q[3] + f]
  list(n = length(x), q1 = q[1], median = q[2], q3 = q[3], lo = min(inside), hi = max(inside), outliers = x[x < q[1] - f | x > q[3] + f])
})
tab <- table(d$Month)
out <- list(box = box, counts = as.list(setNames(as.integer(tab), names(tab))), versions = list(R = R.version.string))
writeLines(toJSON(out, auto_unbox = FALSE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/charts/reference.json")
cat("written\n")
