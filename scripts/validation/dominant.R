# Reference for dominant indicators (cSEM's .dominant_indicators): mobi with
# PERQ1 reversed (11 - PERQ1), Quality a Mode B composite; without and with
# PERQ1 as Quality's dominant indicator. Path weighting, PLS.
#   R_LIBS=/path/to/lib Rscript scripts/validation/dominant.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM) })
d <- read.csv("src/engine/__fixtures__/mobi.csv")
d$PERQ1 <- 11 - d$PERQ1
model <- "
Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
Expectation =~ CUEX1 + CUEX2 + CUEX3
Quality <~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
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
modes <- list(Image = "modeA", Expectation = "modeA", Quality = "modeB", Value = "modeA", Satisfaction = "modeA", Complaints = "modeA", Loyalty = "modeA")
pick <- function(f) list(weights = as.list(f$Estimates$Weight_estimates["Quality", paste0("PERQ", 1:7)]),
  expToQual = f$Estimates$Path_estimates["Quality", "Expectation"], qualToSat = f$Estimates$Path_estimates["Satisfaction", "Quality"])
f0 <- csem(d, model, .PLS_modes = modes, .disattenuate = FALSE, .tolerance = 1e-10)
f1 <- csem(d, model, .PLS_modes = modes, .disattenuate = FALSE, .tolerance = 1e-10, .dominant_indicators = c(Quality = "PERQ1"))
write(toJSON(list(cSEM = as.character(packageVersion("cSEM")), plain = pick(f0), dominant = pick(f1)), auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/dominant.json")
cat("written\n")
