# Reference results for PATHMOX from genpathmox (independent of PLS Studio's
# code): the help page's example (?pls.pathmox, csibank: Spanish bank
# customers, segmentation by gender, age and education (ordered),
# occupation and region; PLSc, path scheme, alpha .05, depth 2).
#   R_LIBS=/path/to/lib Rscript scripts/validation/pathmox.R

suppressPackageStartupMessages({ library(jsonlite); library(genpathmox) })
data(csibank)
m <- "VAL ~ QUAL\nSAT ~ IMAG + QUAL + VAL\nLOY ~ IMAG + SAT\nQUAL <~ qual1 + qual2 + qual3 + qual4 + qual5 + qual6 + qual7\nIMAG =~ imag1 + imag2 + imag3 + imag4 + imag5 + imag6\nVAL =~ val1 + val2 + val3 + val4\nSAT =~ sat1 + sat2 + sat3\nLOY =~ loy1 + loy2 + loy3"
cv <- csibank[, 1:5]
cv$Age <- factor(cv$Age, levels = c("<=25", "26-35", "36-45", "46-55", "56-65", ">=66"), ordered = TRUE)
cv$Education <- factor(cv$Education, levels = c("Unfinished", "Elementary", "Highschool", "Undergrad", "Graduated"), ordered = TRUE)
p <- pls.pathmox(.model = m, .data = csibank, .catvar = cv, .alpha = 0.05, .deep = 2, .tree = FALSE)
out <- list(version = as.character(packageVersion("genpathmox")), sizes = p$MOX$size, variables = as.character(p$MOX$variable), categories = as.character(p$MOX$category),
  splitF = p$Fg.r[["F value"]], importance = setNames(as.list(p$var_imp$ranking), p$var_imp$variable), terminal = unname(p$terminal_paths))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/pathmox/reference.json")
cat("written\n")
