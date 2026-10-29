# Reference results for PLS assessment (independent of PLS Studio's code),
# with cSEM on its own ECSI example (satisfaction, satisfaction_gender):
# model selection criteria for the model and an alternative (LOY ~ SAT only),
# MICOM's compositional invariance c, Klesel's dG / dL and Chin's path
# differences between women and men, and the per-group path coefficients.
# These do not depend on random draws, so they can be compared across cSEM
# versions (native 0.6.1, webR 0.7.1).
#   R_LIBS=/path/to/lib Rscript scripts/validation/plsx.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM) })
m <- "EXPE ~ IMAG\nQUAL ~ EXPE\nVAL ~ EXPE + QUAL\nSAT ~ IMAG + EXPE + QUAL + VAL\nLOY ~ IMAG + SAT
IMAG <~ imag1 + imag2 + imag3\nEXPE <~ expe1 + expe2 + expe3\nQUAL <~ qual1 + qual2 + qual3 + qual4 + qual5\nVAL <~ val1 + val2 + val3
SAT =~ sat1 + sat2 + sat3 + sat4\nLOY =~ loy1 + loy2 + loy3 + loy4"
m2 <- sub("LOY ~ IMAG + SAT", "LOY ~ SAT", m, fixed = TRUE)
opts <- function(d, mm, ...) csem(d, mm, .PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300, ...)
fit <- opts(satisfaction, m); fit2 <- opts(satisfaction, m2)
msc <- function(f) lapply(calculateModelSelectionCriteria(f, .by_equation = TRUE), as.list)
g <- opts(satisfaction_gender, m, .id = "gender")
set.seed(1); mi <- testMICOM(g, .R = 30, .seed = 1, .verbose = FALSE)
md <- testMGD(g, .approach_mgd = c("Klesel", "Chin"), .R_permutation = 30, .seed = 1, .verbose = FALSE)
out <- list(version = as.character(packageVersion("cSEM")), msc = msc(fit), mscAlt = msc(fit2),
  micomC = as.list(mi$Step2$Test_statistic[[1]]), klesel = as.list(md$Klesel$Test_statistic),
  chin = as.list(md$Chin$Test_statistic[[1]][grepl(" ~ ", names(md$Chin$Test_statistic[[1]]))]),
  groups = lapply(g, function(x) { P <- x$Estimates$Path_estimates; list(SAT_VAL = P["SAT", "VAL"], LOY_SAT = P["LOY", "SAT"]) }))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference.json")
cat("written\n")
