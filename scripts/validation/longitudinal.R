# Reference results for latent growth curves and the RI-CLPM, from desktop
# lavaan: lavaan's Demo.growth, and a simulated two-variable panel (4 waves)
# with stable between-person differences and within-person lagged effects.
#
#   Rscript scripts/validation/longitudinal.R

suppressMessages({ library(lavaan); library(jsonlite) })
root <- "src/engine/__fixtures__/longitudinal"
g <- Demo.growth[, c("t1", "t2", "t3", "t4", "x1", "x2", "c1", "c2", "c3", "c4")]
write.csv(g, file.path(root, "demo_growth.csv"), row.names = FALSE)
pick <- function(f) {
  pe <- parameterEstimates(f, standardized = TRUE)
  pe <- pe[pe$op %in% c("~1", "~~", "~", "=~") & (pe$lhs %in% c("i", "s", "q", "RIx", "RIy", paste0("wx", 1:4), paste0("wy", 1:4)) | (pe$op == "~" & pe$lhs %in% paste0("t", 1:4))), ]
  list(fit = as.list(fitMeasures(f, c("chisq", "df", "cfi", "rmsea", "srmr"))),
    estimates = lapply(seq_len(nrow(pe)), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i], std = pe$std.all[i])))
}
linear <- growth("i =~ 1*t1 + 1*t2 + 1*t3 + 1*t4\ns =~ 0*t1 + 1*t2 + 2*t3 + 3*t4", g)
quadratic <- growth("i =~ 1*t1 + 1*t2 + 1*t3 + 1*t4\ns =~ 0*t1 + 1*t2 + 2*t3 + 3*t4\nq =~ 0*t1 + 1*t2 + 4*t3 + 9*t4", g)
basis <- growth("i =~ 1*t1 + 1*t2 + 1*t3 + 1*t4\ns =~ 0*t1 + 1*t2 + t3 + t4", g)
conditional <- growth("i =~ 1*t1 + 1*t2 + 1*t3 + 1*t4\ns =~ 0*t1 + 1*t2 + 2*t3 + 3*t4\ni + s ~ x1 + x2", g)
# The tutorial's model with time-varying covariates (each occasion on its own).
timevarying <- growth("i =~ 1*t1 + 1*t2 + 1*t3 + 1*t4\ns =~ 0*t1 + 1*t2 + 2*t3 + 3*t4\ni ~ x1 + x2\ns ~ x1 + x2\nt1 ~ c1\nt2 ~ c2\nt3 ~ c3\nt4 ~ c4", g)

# RI-CLPM data: x and y over 4 waves.
set.seed(20261029)
n <- 500; T <- 4
bx <- rnorm(n); by <- 0.4 * bx + rnorm(n, sd = sqrt(1 - 0.16))
wx <- matrix(0, n, T); wy <- matrix(0, n, T)
wx[, 1] <- rnorm(n); wy[, 1] <- 0.3 * wx[, 1] + rnorm(n, sd = sqrt(0.91))
for (t in 2:T) {
  wx[, t] <- 0.4 * wx[, t - 1] + 0.15 * wy[, t - 1] + rnorm(n, sd = 0.8)
  wy[, t] <- 0.3 * wy[, t - 1] + 0.2 * wx[, t - 1] + rnorm(n, sd = 0.8)
}
p <- data.frame(round(cbind(bx + wx, by + wy), 6)); names(p) <- c(paste0("x", 1:T), paste0("y", 1:T))
write.csv(p, file.path(root, "panel.csv"), row.names = FALSE)
ri <- function(equal, random = TRUE) {
  L <- c(if (random) c("RIx =~ 1*x1 + 1*x2 + 1*x3 + 1*x4", "RIy =~ 1*y1 + 1*y2 + 1*y3 + 1*y4"),
    sprintf("wx%d =~ 1*x%d", 1:T, 1:T), sprintf("wy%d =~ 1*y%d", 1:T, 1:T),
    sprintf("wx%d ~ %swx%d + %swy%d", 2:T, if (equal) "a*" else "", 1:(T - 1), if (equal) "b*" else "", 1:(T - 1)),
    sprintf("wy%d ~ %swx%d + %swy%d", 2:T, if (equal) "c*" else "", 1:(T - 1), if (equal) "d*" else "", 1:(T - 1)),
    "wx1 ~~ wy1", sprintf("wx%d ~~ wy%d", 2:T, 2:T), sprintf("wx%d ~~ wx%d", 1:T, 1:T), sprintf("wy%d ~~ wy%d", 1:T, 1:T),
    if (random) c("RIx ~~ RIx", "RIy ~~ RIy", "RIx ~~ RIy", "RIx ~~ 0*wx1", "RIx ~~ 0*wy1", "RIy ~~ 0*wx1", "RIy ~~ 0*wy1"),
    sprintf("x%d ~~ 0*x%d", 1:T, 1:T), sprintf("y%d ~~ 0*y%d", 1:T, 1:T))
  lavaan(paste(L, collapse = "\n"), p, meanstructure = TRUE, int.ov.free = TRUE)
}
riclpm <- ri(FALSE); riclpm_equal <- ri(TRUE); clpm <- ri(FALSE, random = FALSE)
cmp <- lavTestLRT(clpm, riclpm)
write(toJSON(list(lavaan = as.character(packageVersion("lavaan")),
  linear = pick(linear), quadratic = pick(quadratic), basis = pick(basis), conditional = pick(conditional), timeVarying = pick(timevarying),
  impliedMeansLinear = unname(fitted(linear)$mean[c("t1", "t2", "t3", "t4")]),
  riclpm = pick(riclpm), riclpmEqual = pick(riclpm_equal), clpm = pick(clpm),
  clpmVsRiclpm = list(chisqDiff = cmp[["Chisq diff"]][2], dfDiff = cmp[["Df diff"]][2], p = cmp[["Pr(>Chisq)"]][2])),
  auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "longitudinal.json"))
cat("written\n")
