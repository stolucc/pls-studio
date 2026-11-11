# Reference for the examples from Kline (2023), Principles and Practice of
# Structural Equation Modeling, 5th ed.: the correlation matrices and standard
# deviations of his companion files (guilford.com/add/kline), fitted with lavaan
# as his scripts do (sample.cov.rescale = FALSE where they say so; single indicators with a known
# reliability). Writes src/engine/__fixtures__/textbook/kline.json; the webR test
# compares the app's estimates with it and the chi-squares with Kline's output.
#   Rscript scripts/validation/kline.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
cov_of <- function(lower, names, sds) lavaan::cor2cov(lavaan::getCov(lower, names = names), sds = sds)
fit_one <- function(model, S, n, ..., groups = NULL) {
  # (as the app: disturbances covary only when the diagram says so)
  f <- lavaan::sem(model, sample.cov = S, sample.nobs = n, auto.cov.y = FALSE, ...)
  pe <- parameterEstimates(f, standardized = TRUE)
  keep <- pe$op %in% c("=~", "~", "~~", "~1", ":=")
  list(
    chisq = unname(fitMeasures(f, "chisq")),
    df = unname(fitMeasures(f, "df")),
    pvalue = unname(fitMeasures(f, "pvalue")),
    cfi = unname(fitMeasures(f, "cfi")),
    rmsea = unname(fitMeasures(f, "rmsea")),
    srmr = unname(fitMeasures(f, "srmr")),
    estimates = lapply(
      which(keep),
      function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], group = if ("group" %in% names(pe)) pe$group[i] else 1, est = pe$est[i], se = pe$se[i], std = pe$std.all[i])
    )
  )
}
out <- list()
# Roth et al. (1989), ch. 9: N = 373 (Kline: sample.cov.rescale = FALSE, chi-square 11.107 on 5 df)
S <- cov_of(
  " 1.00 \n -.03 1.00 \n .39 .07 1.00 \n -.05 -.23 -.13 1.00 \n -.08 -.16 -.29 .34 1.00",
  c("exercise", "hardy", "fitness", "stress", "illness"),
  c(66.50, 38.00, 18.40, 33.50, 62.48)
)
out$roth <- fit_one(
  "fitness ~ a*exercise\nstress ~ c*hardy\nillness ~ b*fitness + d*stress\nab := a*b\ncd := c*d",
  S,
  373,
  fixed.x = FALSE,
  sample.cov.rescale = FALSE
)
out$roth$kline <- list(chisq = 11.107, df = 5, note = "sample.cov.rescale = FALSE")
# Kaufman & Kaufman (1983) KABC-I, ch. 14: N = 200, chi-square 38.325 on 19 df
S <- cov_of(
  " 1.00 \n .39 1.00 \n .35 .67 1.00 \n .21 .11 .16 1.00 \n .32 .27 .29 .38 1.00 \n .40 .29 .28 .30 .47 1.00 \n .39 .32 .30 .31 .42 .41 1.00 \n .39 .29 .37 .42 .58 .51 .42 1.00",
  c("hm", "nr", "wo", "gc", "tr", "sm", "ma", "ps"),
  c(3.40, 2.40, 2.90, 2.70, 2.70, 4.20, 2.80, 3.00)
)
out$kabc <- fit_one("Sequential =~ hm + nr + wo\nSimultaneous =~ gc + tr + sm + ma + ps", S, 200)
out$kabc$kline <- list(chisq = 38.325, df = 19)
# Sabatelli & Bartle-Haring (2003), ch. 14 (a Heywood case): N = 103, chi-square 4.688 on 4 df
S <- cov_of(
  " 1.000 \n .740 1.000 \n .265 .422 1.000 \n .305 .401 .791 1.000 \n .315 .351 .662 .587 1.000",
  c("problems", "intimacy", "father", "mother", "both"),
  c(32.936, 22.749, 13.390, 13.679, 14.382)
)
out$sabatelli <- fit_one("Marital =~ problems + intimacy\nFOE =~ father + mother + both", S, 103)
out$sabatelli$kline <- list(chisq = 4.688, df = 4)
# Worland et al. (1984), ch. 15 (step 2a of two-step modelling): N = 158, chi-square 37.320 on 39 df
S <- cov_of(
  "1.00 \n .70 1.00 \n .65 .60 1.00 \n .55 .50 .45 1.00 \n .50 .45 .40 .70 1.00 \n .35 .35 .30 .55 .50 1.00 \n .30 .30 .30 .50 .45 .44 1.00 \n .25 .20 .22 .41 .28 .34 .40 1.00 \n .35 .32 .32 .48 .45 .42 .60 .45 1.00 \n -.25 -.24 -.22 -.21 -.18 -.15 -.15 -.12 -.17 1.00 \n -.22 -.26 -.30 -.25 -.22 -.18 -.17 -.14 -.20 .42 1.00",
  c("verbal", "visual", "memory", "read", "math", "spell", "motive", "harmony", "stable", "parent", "ses"),
  c(13.75, 14.80, 12.60, 14.90, 15.25, 13.85, 9.50, 11.10, 8.70, 12.00, 8.50)
)
out$worland <- fit_one(
  "Cognitive =~ verbal + visual + memory\nAchievement =~ read + math + spell\nAdjustment =~ motive + harmony + stable\nRisk =~ parent + ses\nAchievement ~ Cognitive + Risk\nAdjustment ~ Cognitive + Risk",
  S,
  158
)
out$worland$kline <- list(chisq = 37.320, df = 39)
# Romney et al. (1992), ch. 11 (two non-nested path models): N = 469 (Kline: rescale = FALSE; 40.488 on 5 df and 3.245 on 3 df)
S <- cov_of(
  " 1.00 \n .53 1.00 \n .15 .18 1.00 \n .52 .29 -.05 1.00 \n .30 .34 .23 .09 1.00",
  c("morale", "symptoms", "dysfunction", "relations", "ses"),
  c(3.75, 17.00, 19.50, 3.50, 24.70)
)
out$romneySomatic <- fit_one(
  "morale ~ ses + dysfunction\nrelations ~ morale\nsymptoms ~ morale",
  S,
  469,
  fixed.x = FALSE,
  sample.cov.rescale = FALSE
)
out$romneySomatic$kline <- list(chisq = 40.488, df = 5, note = "sample.cov.rescale = FALSE")
out$romneyMedical <- fit_one(
  "ses ~ symptoms + dysfunction\nmorale ~ symptoms + ses\nrelations ~ dysfunction + morale",
  S,
  469,
  fixed.x = FALSE,
  sample.cov.rescale = FALSE
)
out$romneyMedical$kline <- list(chisq = 3.245, df = 3, note = "sample.cov.rescale = FALSE")
# Lynam et al. (1993), ch. 12: two groups with means, coefficients equal except delinq ~ achieve (Kline's lynam2: 6.107 on 6 df)
nm <- c("ses", "effort", "viq", "achieve", "delinq")
black <- cov_of(
  " 1.00 \n .08 1.00 \n .28 .30 1.00 \n .05 .21 .50 1.00 \n -.11 -.17 -.26 -.33 1.00",
  nm,
  c(10.58, 1.35, 13.62, .79, 1.63)
)
white <- cov_of(
  " 1.00 \n .25 1.00 \n .37 .40 1.00 \n .27 .28 .61 1.00 \n -.11 -.20 -.31 -.21 1.00",
  nm,
  c(11.53, 1.32, 16.32, .96, 1.45)
)
out$lynam <- fit_one("achieve ~ ses + effort + viq\ndelinq ~ achieve + ses + effort + viq", list(Black = black, White = white), list(Black = 214, White = 181),
  sample.mean = list(
    Black = setNames(c(31.96, -.01, 93.76, 2.51, 1.40), nm),
    White = setNames(c(34.64, .05, 104.18, 2.88, 1.22), nm)
  ),
  group.equal = "regressions", group.partial = "delinq ~ achieve", fixed.x = FALSE, meanstructure = TRUE
)
out$lynam$kline <- list(chisq = 6.107, df = 6)
# Robbins et al. (2012), ch. 19 (a causal loop): N = 64, chi-square 5.896 on 5 df
S <- cov_of(
  " 1.000 \n .933 1.000 \n .767 .738 1.000 \n .760 .737 .614 1.000 \n .820 .760 .664 .867 1.000 \n .454 .466 .372 .368 .375 1.000 \n .469 .480 .380 .457 .351 .498 1.000",
  c("rule", "legal", "corrupt", "bandwidth", "internet", "trust", "monarchy"),
  c(1.008, 1.931, 1.424, 2.585, 1.569, .138, .394)
)
out$robbins <- fit_one(
  "InfoTech =~ bandwidth + internet\nInstitQual =~ legal + corrupt\nInstitQual ~ trust + InfoTech\ntrust ~ InstitQual + monarchy\nInstitQual ~~ trust\nmonarchy ~~ InfoTech",
  S,
  64
)
out$robbins$kline <- list(chisq = 5.896, df = 5)
# Sauve et al., ch. 15 (partial SR model; sumd a single indicator with reliability .76): N = 193, chi-square 9.885 on 12 df
S <- cov_of(
  "1.000 \n .753 1.000 \n .329 .334 1.000 \n .316 .307 .672 1.000 \n .398 .347 .411 .451 1.000 \n .430 .439 .526 .532 .470 1.000 \n -.144 -.155 -.215 -.108 -.146 -.143 1.000",
  c("isl", "islr", "gml", "gmr", "ocl", "cpal", "sumd"),
  c(4.713, 2.670, 1.664, 1.009, .116, .121, 1.225)
)
theta <- .360 # as Kline's script (the app: reliability 1 - .360 / 1.225^2)
out$sauve <- fit_one(
  sprintf(
    "Cognitive =~ isl + islr + gml + ocl + cpal + gmr\nisl ~~ islr\ngml ~~ gmr\nSUMD =~ sumd\nsumd ~~ %s*sumd\nSUMD ~ Cognitive",
    theta
  ),
  S,
  193
)
out$sauve$kline <- list(chisq = 9.885, df = 12, note = "sumd error variance fixed at .360")
out$versions <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/kline.json")
for (k in setdiff(names(out), "versions")) cat(sprintf("%-14s chisq %8.3f df %2d cfi %.4f (Kline %8.3f df %2d)\n", k, out[[k]]$chisq, out[[k]]$df, out[[k]]$cfi, out[[k]]$kline$chisq, out[[k]]$kline$df))
