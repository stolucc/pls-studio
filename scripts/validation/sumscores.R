# Reference for sum scores per construct (unit weights; Henseler 2021, ADANCO):
# the ECSI model on seminr's mobi data with Quality and Loyalty as sum scores,
# the other constructs Mode A, path weighting, estimated by cSEM directly; once
# as PLS and once with PLSc (which corrects the Mode A common factors only).
#   R_LIBS=/path/to/lib Rscript scripts/validation/sumscores.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM) })
d <- read.csv("src/engine/__fixtures__/mobi.csv")
model <- "
Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
Expectation =~ CUEX1 + CUEX2 + CUEX3
Quality =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
Value =~ PERV1 + PERV2
Satisfaction =~ CUSA1 + CUSA2 + CUSA3
Complaints =~ CUSCO
Loyalty =~ CUSL1 + CUSL2 + CUSL3
Expectation ~ Image
Quality ~ Expectation
Value ~ Expectation + Quality
Satisfaction ~ Image + Expectation + Quality + Value
Complaints ~ Satisfaction
Loyalty ~ Image + Satisfaction + Complaints
"
modes <- list(Image = "modeA", Expectation = "modeA", Quality = "unit", Value = "modeA", Satisfaction = "modeA", Complaints = "modeA", Loyalty = "unit")
fit <- csem(d, model, .PLS_modes = modes, .PLS_weight_scheme_inner = "path", .tolerance = 1e-7, .disattenuate = FALSE)
plsc <- csem(d, model, .PLS_modes = modes, .PLS_weight_scheme_inner = "path", .tolerance = 1e-7, .disattenuate = TRUE)
paths <- function(B) lapply(setNames(rownames(B), rownames(B)), function(to) { nz <- B[to, ] != 0; as.list(setNames(B[to, nz], colnames(B)[nz])) })
e <- fit$Estimates
W <- e$Weight_estimates
B <- e$Path_estimates
out <- list(
  cSEM = as.character(packageVersion("cSEM")),
  weights = setNames(lapply(colnames(W), function(i) unname(W[W[, i] != 0, i])), colnames(W)),
  pathCoef = paths(B),
  r2 = as.list(e$R2),
  plsc = list(pathCoef = paths(plsc$Estimates$Path_estimates), reliability = as.list(plsc$Estimates$Reliabilities)))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/mobi_unit.json")
cat("written\n")
