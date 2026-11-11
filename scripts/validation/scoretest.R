# Native reference for the Score-based invariance test card (src/analyses/scoretest.tsx, R/scoretest.R): strucchange's
# sctest on lavaan fits, written independently of the bridge. Writes src/engine/__fixtures__/scoretest/reference.json;
# src/examples/cards/scoretest.webr.test.ts compares the card with it.
#   1. The published example (Wang, Merkle & Zeileis 2014, Frontiers in Psychology 5:438, the strucchange/lavaan code
#      printed there; the same analysis as Merkle, Fan & Zeileis 2014, Psychometrika, section 5): GQ-6 one-factor model
#      of psychotools' YouthGratitude, complete cases (n = 1327), six age groups with equal loadings, the four loadings
#      tested along age group, set.seed(1090) before each test. Published p: LMuo .05018, DM .03804, CvM .11557,
#      maxLM .00414, WDMo .0588, maxLMo .0970 (statistics LMuo 31.4; WDMo 2.91 and maxLMo 11.16 in MFZ 2014).
#      lavaan 0.7 keeps the equality-constrained copies in coef() and vcov(), so the printed vcov = "info"
#      (solve(vcov(fit) * nobs(fit))) is singular; the information is taken in the parameters of lavaan's scores
#      instead, with lavaan's own reduction matrix (lav_con_r2k), which is what the printed code computed with
#      lavaan 0.4-14.
#   2. The home-screen example (src/examples/cards/scoretest.ts): the same model on all 1405 rows as psychotools ships them.
#   3. A continuous covariate without constraints: the three-factor CFA of lavaan's ?cfa (Holzinger & Swineford), along
#      ageyr, with strucchange's own vcov = "info".
#   Rscript scripts/validation/scoretest.R    (strucchange, psychotools in the helper's library: R_LIBS_USER=~/.pls-studio-helper/library)
suppressPackageStartupMessages({
  library(lavaan)
  library(strucchange)
  library(jsonlite)
})
data("YouthGratitude", package = "psychotools")
gq6 <- "f1 =~ gq6_1 + gq6_2 + gq6_3 + gq6_4 + gq6_5"
infoK <- function(fit) {
  K <- lavaan:::lav_con_r2k(fit@Model)
  function(x, ...) t(K) %*% lavInspect(x, "information") %*% K
}
tests <- function(fit, z, parm, vcov, fns, seed = 1090) {
  setNames(lapply(fns, function(f) {
    set.seed(seed)
    r <- if (identical(vcov, "info")) sctest(fit, order.by = z, parm = parm, vcov = "info", functional = f) else sctest(fit, order.by = z, parm = parm, vcov = vcov, sandwich = FALSE, functional = f)
    list(statistic = unname(r$statistic), p = unname(r$p.value))
  }), fns)
}
ALL <- c("LMuo", "DM", "CvM", "maxLM", "WDMo", "maxLMo")

# 1. Published
compcases <- apply(YouthGratitude[, 4:28], 1, function(x) all(x %in% 1:9))
yg <- YouthGratitude[compcases, ]
restr <- cfa(gq6, data = yg, group = "agegroup", meanstructure = TRUE, group.equal = "loadings")
full <- cfa(gq6, data = yg, group = "agegroup", meanstructure = TRUE)
lrt <- anova(full, restr)
published <- list(
  n = nrow(yg), rows = I(which(compcases)), lrt = list(chisq = lrt[["Chisq diff"]][2], df = lrt[["Df diff"]][2], p = lrt[["Pr(>Chisq)"]][2]),
  tests = tests(restr, yg$agegroup, 1:4, infoK(restr), ALL)
)
str(published$tests)

# 2. The example, all rows; the app's seed (1234, Model settings' default) for maxLMo's simulated critical values
ex <- cfa(gq6, data = YouthGratitude, group = "agegroup", meanstructure = TRUE, group.equal = "loadings")
example <- list(
  n = nobs(ex), tests = tests(ex, YouthGratitude$agegroup, 1:4, infoK(ex), ALL, seed = 1234),
  loadings = tests(ex, YouthGratitude$agegroup, 1:4, infoK(ex), c("WDMo", "LMuo"), seed = 1234),
  # every free parameter (the reduced parameters: 4 shared loadings, then each group's own)
  all = tests(ex, YouthGratitude$agegroup, NULL, infoK(ex), c("LMuo", "WDMo"), seed = 1234), npar = ncol(estfun(ex))
)
str(example$tests)

# 3. Continuous covariate, Holzinger & Swineford
hs <- HolzingerSwineford1939
hsfit <- cfa("visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9", data = hs)
pt <- parTable(hsfit)
load <- which(pt$op[pt$free > 0] == "=~")
hsref <- list(
  n = nobs(hsfit), loadings = tests(hsfit, hs$ageyr, load, "info", c("DM", "CvM", "maxLM")),
  all = tests(hsfit, hs$ageyr, NULL, "info", c("DM", "CvM", "maxLM")),
  variances = tests(hsfit, hs$ageyr, which(pt$op[pt$free > 0] == "~~" & pt$lhs[pt$free > 0] == pt$rhs[pt$free > 0] & pt$lhs[pt$free > 0] %in% lavNames(hsfit, "ov")), "info", c("DM", "CvM", "maxLM")),
  # ordinal: grade (7, 8) as a two-category covariate is too coarse; ageyr's six values as ordinal categories
  ordinal = tests(hsfit, factor(hs$ageyr), load, "info", c("WDMo", "maxLMo", "LMuo"), seed = 1234),
  dmComponents = {
    g <- gefp(hsfit, fit = NULL, order.by = hs$ageyr, parm = load, vcov = function(x, ...) solve(vcov(x) * nobs(x)), sandwich = FALSE)
    I(unname(apply(abs(as.matrix(g$process)), 2, max)))
  }
)
str(hsref$loadings)

dir.create("src/engine/__fixtures__/scoretest", showWarnings = FALSE, recursive = TRUE)
writeLines(
  toJSON(list(
    generated = format(Sys.time()), R = R.version.string, strucchange = as.character(packageVersion("strucchange")), lavaan = as.character(packageVersion("lavaan")),
    psychotools = as.character(packageVersion("psychotools")), published = published, example = example, hs = hsref
  ), auto_unbox = TRUE, pretty = TRUE, digits = NA, null = "null", na = "null"),
  "src/engine/__fixtures__/scoretest/reference.json"
)
cat("written\n")
