# Reference results for REBUS-PLS, from plain plspm calls (independent of PLS
# Studio's code): plspm's own example (?it.reb, simdata: Price and Quality
# predicting Satisfaction, two simulated segments) with 2 and 3 classes.
#
#   Rscript scripts/validation/rebus.R

suppressPackageStartupMessages({ library(jsonlite); library(plspm) })
root <- "src/engine/__fixtures__/rebus"
data(simdata)
write.csv(simdata, file.path(root, "simdata.csv"), row.names = FALSE)
path <- matrix(c(0, 0, 0, 0, 0, 0, 1, 1, 0), 3, 3, byrow = TRUE)
dimnames(path) <- list(c("Price", "Quality", "Satisfaction"), c("Price", "Quality", "Satisfaction"))
global <- plspm(simdata, path, list(1:5, 6:10, 11:13), modes = c("A", "A", "A"))
pdf(NULL); hc <- res.clus(global); invisible(dev.off())
out <- list(version = as.character(packageVersion("plspm")), gof = global$gof, height = rev(tail(hc$height, 12)))
for (k in 2:3) {
  r <- it.reb(global, hc, nk = k, stop.crit = 0.005, iter.max = 100)
  out[[paste0("k", k)]] <- list(gqi = r$aux[[7]], iterations = r$aux[[6]], sizes = as.integer(table(r$segments)),
    segments = as.integer(r$segments), paths = r$path.coef, gof = unname(r$quality["GoF", ]),
    groupAgreement = as.integer(table(r$segments, simdata$group)))
}
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "reference.json"))
cat("written", file.path(root, "reference.json"), "\n")
