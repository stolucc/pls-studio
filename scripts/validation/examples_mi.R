# Data for the lavaan.mi homescreen example: lavaan's HolzingerSwineford1939 with
# missing values imposed exactly as on lavaan.mi's ?HS20imps help page (x5: the
# lowest 30% deleted, MNAR; x9: deleted for the youngest 30%, MAR on age). The
# help page then imputes with Amelia (seed 456), as the app does.
#   R_LIBS=/path/to/lib Rscript scripts/validation/examples_mi.R

suppressPackageStartupMessages(library(lavaan))
HSMiss <- HolzingerSwineford1939[, c(paste("x", 1:9, sep = ""), "ageyr", "agemo", "school")]
set.seed(123)
HSMiss$x5 <- ifelse(HSMiss$x5 <= quantile(HSMiss$x5, .3), NA, HSMiss$x5)
age <- HSMiss$ageyr + HSMiss$agemo / 12
HSMiss$x9 <- ifelse(age <= quantile(age, .3), NA, HSMiss$x9)
write.csv(HSMiss, "public/examples/mi/HSMiss.csv", row.names = FALSE, na = "")
cat("written", sum(is.na(HSMiss$x5)), sum(is.na(HSMiss$x9)), "\n")

# The two imputation examples' sources, verbatim, for the webR test (src/engine/__fixtures__/mi/examples.json):
# ?HS20imps (Amelia, seed 456) and ?lavaan.mi's cfa.mi; ?pool.r.squared (mice, seed 16117) and lm(chl ~ age + hyp + bmi).
# The pooled point estimates are the means over the imputations (Rubin's rules); lavaan.mi is not needed for them.
suppressPackageStartupMessages({
  library(Amelia)
  library(mice)
  library(jsonlite)
})
set.seed(456)
HS20imps <- amelia(HSMiss, m = 20, noms = "school", p2s = FALSE)$imputations
HS.model <- " visual  =~ x1 + x2 + x3\n textual =~ x4 + x5 + x6\n speed   =~ x7 + x8 + x9 "
pe <- lapply(HS20imps, function(d) {
  p <- parameterEstimates(cfa(HS.model, data = d))
  setNames(p$est, paste(p$lhs, p$op, p$rhs))
})
hs <- Reduce(`+`, pe) / length(pe)
imp <- mice(nhanes, print = FALSE, seed = 16117)
pooled <- summary(pool(with(imp, lm(chl ~ age + hyp + bmi))))
out <- list(
  hs = as.list(hs), nhanes = as.list(setNames(pooled$estimate, as.character(pooled$term))),
  versions = list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")), Amelia = as.character(packageVersion("Amelia")), mice = as.character(packageVersion("mice")))
)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/mi/examples.json")
print(round(unlist(out$nhanes), 4))
print(round(hs[grep("=~", names(hs))], 4))
