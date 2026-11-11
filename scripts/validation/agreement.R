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
  library(irr)
  library(irrCAC)
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

# ---- Fleiss' kappa: irr's diagnoses (Fleiss 1971), 30 patients, 6 psychiatrists, factors
# whose codes differ between raters (rater6 has no "1. Depression"): compared by label.
data(diagnoses, package = "irr")
out$diagnoses <- frame(diagnoses)
fl <- kappam.fleiss(diagnoses, detail = TRUE)
out$fleiss <- list(
  kappa = fl$value,
  z = unname(fl$statistic),
  p = fl$p.value,
  exact = kappam.fleiss(diagnoses, exact = TRUE)$value,
  # (irr prints the categories' kappas to 3 decimals)
  categoryKappa3 = unname(fl$detail[, "Kappa"]),
  categories = rownames(fl$detail)
)
# The categories' kappas by Fleiss's (1971) formula, unrounded.
ratings <- as.matrix(data.frame(lapply(diagnoses, as.character)))
m <- ncol(ratings)
n <- nrow(ratings)
cats <- sort(unique(c(ratings)))
counts <- sapply(cats, function(k) rowSums(ratings == k))
p_k <- colSums(counts) / (n * m)
kappa_k <- 1 - colSums(counts * (m - counts)) / (n * m * (m - 1) * p_k * (1 - p_k))
out$fleiss$categoryKappa <- unname(kappa_k)
out$fleiss$categoryZ <- unname(kappa_k / sqrt(2 / (n * m * (m - 1))))

# ---- Krippendorff's alpha: Krippendorff's (2011) example, 4 coders and 12 units with
# missing values (?kripp.alpha); published: nominal .743, ordinal .815, interval .849, ratio .797.
nmm <- matrix(
  c(
    1, 1, NA, 1, 2, 2, 3, 2, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 2, 3, 4, 4, 4, 4, 4,
    1, 1, 2, 1, 2, 2, 2, 2, NA, 5, 5, 5, NA, NA, 1, 1, NA, NA, 3, NA
  ),
  nrow = 4
)
units <- as.data.frame(t(nmm))
names(units) <- paste0("coder", 1:4)
out$krippendorff <- frame(units)
levels_kripp <- c("nominal", "ordinal", "interval", "ratio")
out$kripp <- lapply(setNames(levels_kripp, levels_kripp), function(l) kripp.alpha(nmm, l)$value)
out$krippPairable <- kripp.alpha(nmm)$nmatchval
# The bootstrap over the units: seed 7, 500 samples, 95% percentile interval.
set.seed(7)
boot <- numeric(500)
for (b in seq_along(boot)) {
  drawn <- sample(ncol(nmm), replace = TRUE)
  boot[b] <- kripp.alpha(nmm[, drawn, drop = FALSE], "ordinal")$value
}
boot <- boot[is.finite(boot)]
out$krippBoot <- list(
  seed = 7,
  samples = 500,
  level = "ordinal",
  ci = unname(quantile(boot, c(0.025, 0.975))),
  below667 = mean(boot < 0.667),
  below800 = mean(boot < 0.8)
)

# ---- Kendall's W: irr's anxiety, 20 subjects rated by 3 raters (?kendall)
data(anxiety, package = "irr")
out$anxiety <- frame(anxiety)
kw <- kendall(anxiety, correct = FALSE)
kwt <- kendall(anxiety, correct = TRUE)
out$kendall <- list(
  w = kw$value,
  chisq = unname(kw$statistic),
  p = kw$p.value,
  wt = kwt$value,
  chisqT = unname(kwt$statistic),
  pT = kwt$p.value
)

# ---- Gwet's AC1 and AC2: irrCAC's cac.raw4raters (Gwet 2014), 12 units, 4 raters, missing ratings
out$cacRaw4raters <- frame(cac.raw4raters)
gwet <- function(weights) {
  est <- gwet.ac1.raw(cac.raw4raters, weights = weights)$est
  bounds <- as.numeric(strsplit(gsub("[()]", "", est$conf.int), ",")[[1]])
  list(
    name = est$coeff.name,
    pa = est$pa,
    pe = est$pe,
    value = (est$pa - est$pe) / (1 - est$pe),
    value5 = est$coeff.val,
    se = est$coeff.se,
    p = est$p.value,
    # (irrCAC prints the interval to 3 decimals)
    ci3 = bounds,
    ratings = est$tot.obs
  )
}
out$gwet <- list(unweighted = gwet("unweighted"), quadratic = gwet("quadratic"))

writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null", na = "null"),
  "src/engine/__fixtures__/agreement/reference.json"
)
