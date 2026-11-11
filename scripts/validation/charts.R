# Reference for the chart card's box plots and bar charts (src/analyses/charts.test.tsx): R's airquality, Ozone by
# Month (37 missing values; outliers in some months). Box plot: quartiles by quantile(type = 7) (R's default), Tukey
# whiskers at the most extreme values within 1.5 IQR of the quartiles, the values beyond them; bar chart: table().
# The descriptives card's plots: the kernel density (Gaussian kernel, bw.nrd0, evaluated exactly at density()'s
# range ends and in between) and the normal Q-Q plot (qqnorm's ppoints, qqline's quartile line) of Ozone.
#   Rscript scripts/validation/charts.R
suppressPackageStartupMessages(library(jsonlite))
d <- airquality[, c("Ozone", "Month")]
write.csv(d, "src/engine/__fixtures__/charts/airquality.csv", row.names = FALSE, na = "")
box <- lapply(split(d$Ozone, d$Month), function(x) {
  x <- sort(x[!is.na(x)])
  q <- unname(quantile(x, c(0.25, 0.5, 0.75), type = 7))
  f <- 1.5 * (q[3] - q[1])
  inside <- x[x >= q[1] - f & x <= q[3] + f]
  list(
    n = length(x),
    q1 = q[1],
    median = q[2],
    q3 = q[3],
    lo = min(inside),
    hi = max(inside),
    outliers = x[x < q[1] - f | x > q[3] + f]
  )
})
tab <- table(d$Month)
# Kernel density: density()'s bandwidth and range, the estimate evaluated exactly (density() bins the data).
oz <- d$Ozone[!is.na(d$Ozone)]
bw <- bw.nrd0(oz)
grid <- seq(min(oz) - 3 * bw, max(oz) + 3 * bw, length.out = 128)
kde <- vapply(grid, function(t) mean(dnorm((t - oz) / bw)) / bw, 0)
qq <- qqnorm(oz, plot.it = FALSE)
q <- quantile(oz, c(0.25, 0.75), names = FALSE)
z <- qnorm(c(0.25, 0.75))
slope <- diff(q) / diff(z)
small <- oz[1:8]
density_ref <- list(bw = bw, x = grid, y = kde)
qq_ref <- list(
  theoretical = sort(qq$x),
  sample = sort(qq$y),
  slope = slope,
  intercept = q[1] - slope * z[1],
  small = sort(qqnorm(small, plot.it = FALSE)$x)
)
out <- list(density = density_ref, qq = qq_ref, box = box, counts = as.list(setNames(as.integer(tab), names(tab))), versions = list(R = R.version.string))
writeLines(toJSON(out, auto_unbox = FALSE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/charts/reference.json")
cat("written\n")
