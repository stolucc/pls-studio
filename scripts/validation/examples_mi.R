# Data for the lavaan.mi homescreen example: lavaan's HolzingerSwineford1939 with
# missing values imposed exactly as on lavaan.mi's ?HS20imps help page (x5: the
# lowest 30% deleted, MNAR; x9: deleted for the youngest 30%, MAR on age). The
# help page then imputes with Amelia; the app imputes with mice.
#   R_LIBS=/path/to/lib Rscript scripts/validation/examples_mi.R

suppressPackageStartupMessages(library(lavaan))
HSMiss <- HolzingerSwineford1939[, c(paste("x", 1:9, sep = ""), "ageyr", "agemo", "school")]
set.seed(123)
HSMiss$x5 <- ifelse(HSMiss$x5 <= quantile(HSMiss$x5, .3), NA, HSMiss$x5)
age <- HSMiss$ageyr + HSMiss$agemo / 12
HSMiss$x9 <- ifelse(age <= quantile(age, .3), NA, HSMiss$x9)
write.csv(HSMiss, "public/examples/mi/HSMiss.csv", row.names = FALSE, na = "")
cat("written", sum(is.na(HSMiss$x5)), sum(is.na(HSMiss$x9)), "\n")
