# Reference results for the model-implied latent moments (Mplus TECH4) from desktop lavaan,
# computed independently of the app: the moments of the endogenous factor written out as defined
# (:=) parameters, whose standard errors lavaan computes by the delta method.
# Holzinger & Swineford (1939) by school, scalar invariance, speed regressed on visual and textual.
#
#   Rscript scripts/validation/tech4.R

suppressMessages({ library(lavaan); library(jsonlite) })
root <- "src/engine/__fixtures__/means"
hs <- read.csv("src/engine/__fixtures__/multigroup/hs_school.csv")
m <- '
  visual =~ x1 + x2 + x3
  textual =~ x4 + x5 + x6
  speed =~ x7 + x8 + x9
  speed ~ c(p1, b1)*visual + c(p2, b2)*textual
  visual ~~ c(q1, v1)*visual
  textual ~~ c(q2, v2)*textual
  visual ~~ c(q3, c12)*textual
  speed ~~ c(q4, z)*speed
  visual ~ c(0, NA)*1 + c(r1, m1)*1
  textual ~ c(0, NA)*1 + c(r2, m2)*1
  speed ~ c(0, NA)*1 + c(r3, a)*1
  var_speed := b1^2*v1 + b2^2*v2 + 2*b1*b2*c12 + z
  cov_visual_speed := b1*v1 + b2*c12
  cov_textual_speed := b1*c12 + b2*v2
  mean_speed := a + b1*m1 + b2*m2
  cor_visual_speed := (b1*v1 + b2*c12) / sqrt((b1^2*v1 + b2^2*v2 + 2*b1*b2*c12 + z) * v1)
  # group 1: the same moments, latent means fixed at 0
  var_speed_1 := p1^2*q1 + p2^2*q2 + 2*p1*p2*q3 + q4
'
fit <- sem(m, data = hs, group = "school", group.equal = c("loadings", "intercepts"))
pe <- parameterEstimates(fit)
d <- pe[pe$op == ":=", ]
out <- list(lavaan = as.character(packageVersion("lavaan")),
  defined = setNames(lapply(seq_len(nrow(d)), function(i) list(est = d$est[i], se = d$se[i])), d$lhs),
  mean_visual = list(est = pe$est[pe$label == "m1"], se = pe$se[pe$label == "m1"]),
  covLv = lapply(lavInspect(fit, "cov.lv"), unname), meanLv = lapply(lavInspect(fit, "mean.lv"), unname))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "tech4.json"))
cat("written\n")
