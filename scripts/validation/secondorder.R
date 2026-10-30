# Reference for second-order constructs in PLS (cSEM's two-stage approach),
# cSEM's documented example (?csem, dgp_2ndorder_cf_of_c): c4 a common factor
# of the composites c1, c2, c3; c4 ~ eta1; eta2 ~ eta1 + c4. cSEM's defaults
# (consistent PLS), and a 100-sample bootstrap (seed 1) for standard errors.
#   R_LIBS=/path/to/lib Rscript scripts/validation/secondorder.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM) })
model <- "
c4   ~ eta1
eta2 ~ eta1 + c4
c1   <~ y11 + y12
c2   <~ y21 + y22 + y23 + y24
c3   <~ y31 + y32 + y33 + y34 + y35 + y36 + y37 + y38
eta1 =~ y41 + y42 + y43
eta2 =~ y51 + y52 + y53
c4   =~ c1 + c2 + c3
"
fit <- csem(dgp_2ndorder_cf_of_c, model, .approach_2ndorder = "2stage")
e2 <- fit$Second_stage$Estimates
B <- e2$Path_estimates; dimnames(B) <- lapply(dimnames(B), function(x) sub("_temp$", "", x))
W1 <- fit$First_stage$Estimates$Weight_estimates
boot <- csem(dgp_2ndorder_cf_of_c, model, .approach_2ndorder = "2stage", .resample_method = "bootstrap", .R = 100, .seed = 1)
s <- summarize(boot)$Second_stage$Estimates
se <- function(tab, name) tab$Std_err[tab$Name == name]
out <- list(
  cSEM = as.character(packageVersion("cSEM")),
  paths = list(`eta1 -> c4` = B["c4", "eta1"], `eta1 -> eta2` = B["eta2", "eta1"], `c4 -> eta2` = B["eta2", "c4"]),
  r2 = setNames(as.list(e2$R2), sub("_temp$", "", names(e2$R2))),
  secondOrder = list(loadings = as.list(e2$Loading_estimates["c4", c("c1", "c2", "c3")]), weights = as.list(e2$Weight_estimates["c4", c("c1", "c2", "c3")])),
  firstOrderWeights = as.list(W1["c2", paste0("y2", 1:4)]),
  vifModeB = as.list(calculateVIFModeB(fit$First_stage)["c2", paste0("y2", 1:4)]),
  bootSE = list(`eta1 -> c4` = se(s$Path_estimates, "c4 ~ eta1"), `c4 -> eta2` = se(s$Path_estimates, "eta2 ~ c4"), `c4 =~ c1` = se(s$Loading_estimates, "c4 =~ c1")))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/secondorder/reference.json")
cat("written\n")
