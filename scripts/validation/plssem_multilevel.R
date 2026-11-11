# Reference for the Multilevel PLS-SEM card (independent of PLS Studio's code): plssem 0.2.0 called directly on its
# randomSlopes data (3000 simulated cases in 200 clusters) with the two models of its "Multilevel Models with plssem"
# vignette: the two-level model (random intercepts: within, fw =~ y1 + y2 + y3 regressed on x1-x3; between,
# fb =~ y1 + y2 + y3 regressed on w1 and w2) and the random-slopes model (the slopes of x1 and x2, s1 and s2, latent
# variables at level 2 regressed on w1 and w2). The vignette's chunks are not evaluated in the shipped package, so it
# prints no numbers to compare with: the reference is plssem itself. MC-PLSc is a Monte Carlo estimator, its
# estimates depend on the seed (about 0.005 between seeds): every run here sets one, and the app sets the same.
# Per model: parameter estimates by level, R-squared, ICCs, random-slope SDs and plssem's fit measures (simulated
# after the fit in the same random stream). The random-intercept model also with the cluster bootstrap (R = 100).
# And the two-level model on randomSlopesOrdered (the same design with 5-7 ordered categories) with every model variable
# ordered (MC-OrdPLSc; the vignette also lists the cluster column, which plssem does not treat as a variable).
# Also writes the example's data, public/examples/plssem/randomSlopes.csv, and the ordinal data as numeric codes,
# src/engine/__fixtures__/plssem/randomSlopesOrdered.csv (the references use the data read back, as the app does).
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/plssem_multilevel.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(plssem)
})
dir.create("public/examples/plssem", showWarnings = FALSE, recursive = TRUE)
write.csv(randomSlopes, "public/examples/plssem/randomSlopes.csv", row.names = FALSE)
d <- read.csv("public/examples/plssem/randomSlopes.csv")

two_level_model <- "
  level: 1
    fw =~ y1 + y2 + y3
    fw ~ x1 + x2 + x3
  level: 2
    fb =~ y1 + y2 + y3
    fb ~ w1 + w2
"
slopes_model <- '
  level: 1
    fw =~ y1 + y2 + y3
    fw ~ rv("s1")*x1 + rv("s2")*x2 + x3
  level: 2
    fb =~ y1 + y2 + y3
    fb ~ w1 + w2
    s1 + s2 ~ w1 + w2
'
num <- function(x) ifelse(is.finite(x), x, NA)
run <- function(model, seed, ..., data = d) {
  set.seed(seed)
  fit <- pls(model, data = data, cluster = "cluster", verbose = FALSE, ...)
  pe <- parameter_estimates(fit)
  fm <- suppressMessages(fit_measures(fit))
  lv <- summary(fit, fit = FALSE)$levels
  list(
    seed = seed,
    est = lapply(
      seq_len(nrow(pe)),
      function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], level = pe$level[i], est = num(pe$est[i]), se = num(pe$se[i]))
    ),
    r2 = lapply(lv, function(l) as.list(l$r2.etas)), r2Indicators = lapply(lv, function(l) as.list(l$r2.inds)),
    icc = as.list(fit@params$icc), rsd = as.list(fit@params$rsd),
    fit = lapply(fm, function(f) lapply(f, num)), iterations = fit@status$iterations
  )
}
dir.create("src/engine/__fixtures__/plssem", showWarnings = FALSE, recursive = TRUE)
ord <- as.data.frame(lapply(randomSlopesOrdered, function(x) as.numeric(as.character(x))))
write.csv(ord, "src/engine/__fixtures__/plssem/randomSlopesOrdered.csv", row.names = FALSE)
ord <- read.csv("src/engine/__fixtures__/plssem/randomSlopesOrdered.csv")
vars <- setdiff(names(ord), "cluster")
out <- list(
  plssem = as.character(packageVersion("plssem")),
  twoLevel = run(two_level_model, 1),
  randomSlopes = run(slopes_model, 1),
  twoLevelBoot = run(two_level_model, 7, bootstrap = TRUE, boot.R = 100),
  twoLevelOrdered = run(two_level_model, 1, ordered = vars, data = ord)
)
# (listing the cluster column as well, as the vignette does, changes nothing)
set.seed(1)
asVignette <- parameter_estimates(pls(two_level_model, data = randomSlopesOrdered, cluster = "cluster", ordered = colnames(randomSlopesOrdered), verbose = FALSE))
cat(
  "ordinal model, as the vignette calls it vs the reference:",
  max(abs(asVignette$est - vapply(out$twoLevelOrdered$est, `[[`, 0, "est"))),
  "\n"
)
# (the seed matters: another seed moves the estimates by about 0.005)
set.seed(2)
other <- parameter_estimates(pls(two_level_model, data = d, cluster = "cluster", verbose = FALSE))
cat("largest change with seed 2 instead of 1:", max(abs(other$est - vapply(out$twoLevel$est, `[[`, 0, "est"))), "\n")
write(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  "src/engine/__fixtures__/plssem/multilevel.json"
)
cat("written\n")
