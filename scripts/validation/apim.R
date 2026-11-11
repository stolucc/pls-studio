# Reference for the APIM card (dyadic actor-partner interdependence model, lavaan), run natively:
#  - the latent APIM as Sakaluk's dySEM 1.4.1 writes it (scriptAPIM, est_k = TRUE, includeMeanStruct = TRUE) on
#    dySEM's commitmentM data (282 mixed-sex couples; satisfaction -> commitment, five items each): indistinguishable
#    dyads with dySEM's default constraints, and distinguishable dyads with only the items' loadings and intercepts
#    held equal across partners; both fitted with lavaan::cfa as dySEM's documentation does, and their LR test;
#  - the observed APIM on the partners' mean scores, written out by hand as Kenny, Kashy & Cook (2006, ch. 7) give it
#    (distinguishable: saturated; indistinguishable: equal actor and partner effects, X means and variances, Y
#    intercepts and residual variances), with k and its percentile bootstrap interval (1000 samples, seed 1234).
# It also writes the example data, public/examples/dyadic/commitmentM.csv (dySEM's data, GPL-3).
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/apim.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(dySEM)
})
write.csv(commitmentM, "public/examples/dyadic/commitmentM.csv", row.names = FALSE, na = "")
dvn <- scrapeVarCross(
  dat = commitmentM, x_order = "sip", x_stem = "sat.g", x_delim2 = "_", distinguish_1 = "f", distinguish_2 = "m",
  y_order = "sip", y_stem = "com", y_delim2 = "_", verbose = FALSE
)
s_ind <- scriptAPIM(dvn, lvxname = "Sat", lvyname = "Com", est_k = TRUE, includeMeanStruct = TRUE)
s_dis <- scriptAPIM(dvn,
  lvxname = "Sat",
  lvyname = "Com",
  est_k = TRUE,
  includeMeanStruct = TRUE,
  constr_dy_x_meas = c("loadings", "intercepts"),
  constr_dy_x_struct = "none",
  constr_dy_y_meas = c("loadings", "intercepts"),
  constr_dy_y_struct = "none",
  constr_dy_xy_struct = "none"
)
f_ind <- cfa(s_ind, data = commitmentM)
f_dis <- cfa(s_dis, data = commitmentM)
lrt <- lavTestLRT(f_ind, f_dis)
out <- function(f) {
  pe <- parameterEstimates(f, standardized = TRUE)
  fm <- fitMeasures(f, c("chisq", "df", "cfi", "rmsea", "srmr"))
  keep <- pe$op %in% c("~", ":=") & !duplicated(pe$label)
  list(
    fit = as.list(fm),
    n = lavInspect(f, "nobs"),
    params = setNames(lapply(which(keep), function(i) list(est = pe$est[i], se = pe$se[i], std = pe$std.all[i], low = pe$ci.lower[i], high = pe$ci.upper[i])), pe$label[keep]),
    xCor = subset(pe, op == "~~" & lhs %in% c("Satf", "sat_f") & rhs %in% c("Satm", "sat_m"))$std.all,
    yCor = subset(pe, op == "~~" & lhs %in% c("Comf", "com_f") & rhs %in% c("Comm", "com_m"))$std.all
  )
}
# ---- observed: the partners' mean scores (Kenny, Kashy & Cook 2006, ch. 7) ----
d <- data.frame(
  sat_f = rowMeans(commitmentM[paste0("sat.g", 1:5, "_f")]), sat_m = rowMeans(commitmentM[paste0("sat.g", 1:5, "_m")]),
  com_f = rowMeans(commitmentM[paste0("com", 1:5, "_f")]), com_m = rowMeans(commitmentM[paste0("com", 1:5, "_m")])
)
o_dis <- "
  com_f ~ a1*sat_f + p1*sat_m
  com_m ~ a2*sat_m + p2*sat_f
  sat_f ~~ sat_m
  com_f ~~ com_m
  k1 := p1/a1
  k2 := p2/a2
"
o_ind <- "
  com_f ~ a*sat_f + p*sat_m
  com_m ~ a*sat_m + p*sat_f
  sat_f ~~ vx*sat_f
  sat_m ~~ vx*sat_m
  sat_f ~ mx*1
  sat_m ~ mx*1
  com_f ~~ vy*com_f
  com_m ~~ vy*com_m
  com_f ~ my*1
  com_m ~ my*1
  sat_f ~~ sat_m
  com_f ~~ com_m
  k := p/a
"
g_dis <- sem(o_dis, data = d, meanstructure = TRUE, fixed.x = FALSE)
g_ind <- sem(o_ind, data = d, meanstructure = TRUE, fixed.x = FALSE)
glrt <- lavTestLRT(g_ind, g_dis)
set.seed(1234)
g_boot <- sem(o_ind, data = d, meanstructure = TRUE, fixed.x = FALSE, se = "bootstrap", bootstrap = 1000L)
bci <- parameterEstimates(g_boot, boot.ci.type = "perc", level = 0.95)
# (FIML on the latent model: the 16 couples with missing items kept)
f_dis_fiml <- cfa(s_dis, data = commitmentM, missing = "ml")
write(toJSON(
  list(
    versions = list(lavaan = as.character(packageVersion("lavaan")), dySEM = as.character(packageVersion("dySEM"))),
    latent = list(
      dist = out(f_dis),
      indist = out(f_ind),
      fimlDist = out(f_dis_fiml),
      test = list(chisqDiff = lrt[["Chisq diff"]][2], dfDiff = lrt[["Df diff"]][2], p = lrt[["Pr(>Chisq)"]][2])
    ),
    observed = list(
      dist = out(g_dis),
      indist = out(g_ind),
      test = list(chisqDiff = glrt[["Chisq diff"]][2], dfDiff = glrt[["Df diff"]][2], p = glrt[["Pr(>Chisq)"]][2]),
      boot = setNames(lapply(c("a", "p", "k"), function(l) {
        i <- which(bci$label == l)[1]
        list(low = bci$ci.lower[i], high = bci$ci.upper[i])
      }), c("a", "p", "k"))
    )
  ),
  auto_unbox = TRUE, digits = NA, pretty = TRUE
), "src/engine/__fixtures__/apim.json")
print(lrt)
print(glrt)
print(subset(bci, label %in% c("a", "p", "k")))
cat("written\n")
