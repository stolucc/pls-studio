# Reference for the agreement modes of the reliability card (src/rengine/R/tests.R and
# src/rengine/R/agreement.R): direct calls to psych, irr and irrCAC on their own
# datasets, written without the app's code. Writes
# src/engine/__fixtures__/agreement/reference.json (the data and the results); the
# webR test src/rengine/agreement.webr.test.ts runs the card on the data and compares.
#   Rscript scripts/validation/agreement.R
# The packages come from the helper's library (PS_HELPER_LIBRARY or ~/.pls-studio-helper/library).
local({
  lib <- Sys.getenv("PS_HELPER_LIBRARY", path.expand("~/.pls-studio-helper/library"))
  if (dir.exists(lib)) .libPaths(c(lib, .libPaths()))
})
suppressPackageStartupMessages({
  library(jsonlite)
  library(psych)
})

frame <- function(df) {
  list(
    names = names(df),
    cols = unname(lapply(df, function(x) {
      if (is.factor(x)) as.integer(x) else as.numeric(x)
    })),
    categories = Filter(Negate(is.null), lapply(df, function(x) {
      if (is.factor(x)) levels(x)
    }))
  )
}

out <- list()

# ---- Standard error of measurement: SD of the scale score * sqrt(1 - reliability)
# The neuroticism items of psych's bfi, the complete cases among the first 300 people.
att <- na.omit(bfi[1:300, c("N1", "N2", "N3", "N4", "N5")])
rownames(att) <- NULL
out$neuroticism <- frame(att)
a <- alpha(att, check.keys = FALSE)
o <- suppressWarnings(suppressMessages(omega(att, nfactors = 1, plot = FALSE)))
g <- glb.fa(cor(att))
score_sd <- sd(rowMeans(att))
out$scaleSem <- list(
  scoreSd = score_sd,
  alpha = score_sd * sqrt(1 - a$total$raw_alpha),
  omega = score_sd * sqrt(1 - o$omega.tot),
  glb = score_sd * sqrt(1 - g$glb)
)

# Shrout & Fleiss (1979): six subjects rated by four judges (?ICC)
sf <- data.frame(
  j1 = c(9, 6, 8, 7, 10, 6),
  j2 = c(2, 1, 4, 1, 5, 2),
  j3 = c(5, 3, 6, 2, 6, 4),
  j4 = c(8, 2, 8, 6, 9, 7)
)
out$shroutFleiss <- frame(sf)
icc <- ICC(sf, lmer = FALSE)$results
sd_all <- sd(unlist(sf))
sd_means <- sd(rowMeans(sf))
k_forms <- grepl("k$", icc$type)
out$iccSem <- list(
  type = as.character(icc$type),
  sem = ifelse(k_forms, sd_means, sd_all) * sqrt(1 - icc$ICC)
)

writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"),
  "src/engine/__fixtures__/agreement/reference.json"
)
