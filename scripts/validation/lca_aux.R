# Data for the three-step analysis of auxiliary variables of latent classes (analyses/items.tsx, R/items.R):
# poLCA's `election` data (2000 American National Election Study, as shipped with poLCA, GPL-2), the six Gore
# items (categories 1-4), covariates PARTY and GENDER, distal outcomes EDUC and AGE; complete cases. The reference
# results come from an independent implementation, StepMix (Python; Morin et al. 2023), run on this file by
# scripts/validation/lca_aux.py.
#
#   Rscript scripts/validation/lca_aux.R [library]
#   python scripts/validation/lca_aux.py      (in an environment with stepmix 3.0.0)

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressMessages(library(poLCA))
data(election)
items <- c("MORALG", "CARESG", "KNOWG", "LEADG", "DISHONG", "INTELG")
d <- election[, c(items, "PARTY", "GENDER", "EDUC", "AGE")]
d[items] <- lapply(d[items], as.integer)
d <- d[complete.cases(d), ]
write.csv(d, "src/engine/__fixtures__/lcaaux/election.csv", row.names = FALSE)
cat(nrow(d), "rows written\n")
