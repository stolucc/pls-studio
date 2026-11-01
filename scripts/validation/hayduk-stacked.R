# Reference for the stacked (two-group) smoking model of Hayduk (1987), ch. 9,
# Figures 9.1 and 9.2: younger (N = 213) and older (N = 219) respondents, the
# same seven single-indicator model as chapter 4 plus age -> antismoking acts,
# error variances fixed at the assessed proportions of each group's variances,
# structural coefficients equal across groups except the heavy arrows of
# Figure 9.1. Native lavaan; src/examples/textbook.webr.test.ts compares.
#   Rscript scripts/validation/hayduk-stacked.R
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
nm <- c("S-current", "S-p-strain", "AS-views", "AS-acts", "Sex", "Age", "Education", "R-attend", "R-import")
lower <- function(v) { p <- 9; M <- matrix(0, p, p, dimnames = list(nm, nm)); k <- 1; for (i in 1:p) for (j in 1:i) { M[i, j] <- M[j, i] <- v[k]; k <- k + 1 }; M }
# Figure 9.2: younger respondents, upper-right triangle (covariances), variances from the table above it
young <- lower(c(0.251,
  0.636, 1.974,
  -0.332, -1.118, 4.088,
  -0.158, -0.401, 0.527, 1.359,
  -0.009, -0.035, 0.193, 0.091, 0.250,
  -0.151, -0.586, 0.113, 0.270, 0.042, 15.68,
  -0.304, -0.983, 0.682, 0.568, 0.053, 2.311, 5.030,
  -0.164, -0.616, 0.339, -0.179, 0.107, 0.540, 0.442, 4.171,
  -0.025, -0.178, 0.183, -0.255, 0.055, 0.849, 0.162, 2.690, 4.723))
# older respondents, lower-left triangle
old <- lower(c(0.243,
  0.631, 2.046,
  -0.114, -0.306, 2.273,
  -0.016, -0.024, 0.106, 1.245,
  -0.009, -0.044, 0.099, 0.002, 0.251,
  -0.820, -2.058, -0.065, -1.602, -0.222, 173.51,
  -0.141, -0.414, 0.274, 0.125, -0.011, -10.433, 8.642,
  -0.182, -0.504, 0.404, -0.079, 0.151, 2.533, 0.261, 4.727,
  -0.096, -0.269, 0.502, 0.160, 0.225, 6.089, -0.398, 2.760, 3.853))
v <- c("Sex", "Age", "Education", "R-attend", "S-current", "AS-views", "AS-acts"); prop <- c(.01, .05, .10, .10, .10, .05, .05)
safe <- c(Sex = "Sex", Age = "Age", Education = "Education", `R-attend` = "R_attend", `S-current` = "S_current", `AS-views` = "AS_views", `AS-acts` = "AS_acts")
S <- lapply(list(younger = young, older = old), function(M) { M <- M[v, v]; dimnames(M) <- list(safe[v], safe[v]); M })
theta <- sapply(S, function(M) prop * diag(M))
m <- paste(c(sprintf("%s_f =~ 1*%s", safe, safe),
  sprintf("%s ~~ c(%s, %s)*%s", safe, theta[, 1], theta[, 2], safe),
  "S_current_f ~ Sex_f + Age_f + Education_f + R_attend_f",
  "AS_views_f ~ S_current_f + Sex_f + Age_f + Education_f + R_attend_f",
  "AS_acts_f ~ S_current_f + AS_views_f + Sex_f + Age_f + Education_f + R_attend_f"), collapse = "\n")
heavy <- c("AS_acts_f~Sex_f", "S_current_f~Age_f", "AS_views_f~Age_f", "AS_acts_f~Age_f", "S_current_f~Education_f", "AS_views_f~Education_f", "AS_acts_f~Education_f", "AS_views_f~S_current_f", "AS_acts_f~S_current_f")
fit <- sem(m, sample.cov = S, sample.nobs = c(213, 219), group.equal = "regressions", group.partial = heavy)
free <- sem(m, sample.cov = S, sample.nobs = c(213, 219))
pe <- parameterEstimates(fit)
reg <- pe[pe$op == "~", ]
name <- function(x) names(safe)[match(sub("_f$", "", x), safe)]
out <- list(chisq = unname(fitMeasures(fit, "chisq")), df = unname(fitMeasures(fit, "df")), pvalue = unname(fitMeasures(fit, "pvalue")),
  configural = list(chisq = unname(fitMeasures(free, "chisq")), df = unname(fitMeasures(free, "df"))),
  lrt = { a <- lavTestLRT(free, fit); list(chisq = a[["Chisq diff"]][2], df = a[["Df diff"]][2], p = a[["Pr(>Chisq)"]][2]) },
  groups = c("younger", "older"),
  regressions = lapply(seq_len(nrow(reg)), function(i) list(to = name(reg$lhs[i]), from = name(reg$rhs[i]), group = reg$group[i], est = reg$est[i], se = reg$se[i])),
  psi = lapply(c("S_current_f", "AS_views_f", "AS_acts_f"), function(x) { r <- pe[pe$op == "~~" & pe$lhs == x & pe$rhs == x, ]; list(construct = name(x), est = r$est) }),
  versions = list(R = R.version.string, lavaan = as.character(packageVersion("lavaan"))))
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/textbook/hayduk_stacked.json")
cat(sprintf("stacked: chisq %.3f df %d p %.3f; configural chisq %.3f df %d; LRT of the equalities chisq %.3f df %d p %.3f\n", out$chisq, out$df, out$pvalue, out$configural$chisq, out$configural$df, out$lrt$chisq, out$lrt$df, out$lrt$p))
print(reg[, c("lhs", "rhs", "group", "est", "se")], digits = 3, row.names = FALSE)
