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

# Henseler (2021), cSEM ?Yooetal2000: brand equity (BR) a composite of the
# common factors QL, LO, AA; BR ~ PR + IM + DI + AD + DL. Factorial scheme,
# tolerance 1e-6, cSEM's defaults otherwise (consistent PLS), as on the help page.
model_yoo <- "
PR =~ PR1 + PR2 + PR3
IM =~ IM1 + IM2 + IM3
DI =~ DI1 + DI2 + DI3
AD =~ AD1 + AD2 + AD3
DL =~ DL1 + DL2 + DL3
AA =~ AA1 + AA2 + AA3 + AA4 + AA5 + AA6
LO =~ LO1 + LO3
QL =~ QL1 + QL2 + QL3 + QL4 + QL5 + QL6
BR <~ QL + LO + AA
BR ~ PR + IM + DI + AD + DL
"
yoo <- csem(Yooetal2000, model_yoo, .PLS_weight_scheme_inner = "factorial", .tolerance = 1e-06)
y2 <- yoo$Second_stage$Estimates
Py <- y2$Path_estimates["BR", ]; names(Py) <- sub("_temp$", "", names(Py))
out_yoo <- list(
  cSEM = as.character(packageVersion("cSEM")),
  paths = setNames(as.list(Py[c("PR", "IM", "DI", "AD", "DL")]), paste(c("PR", "IM", "DI", "AD", "DL"), "-> BR")),
  r2 = list(BR = unname(y2$R2["BR"])),
  secondOrder = list(loadings = as.list(y2$Loading_estimates["BR", c("QL", "LO", "AA")]), weights = as.list(y2$Weight_estimates["BR", c("QL", "LO", "AA")])),
  firstOrderLoadings = as.list(yoo$First_stage$Estimates$Loading_estimates["QL", paste0("QL", 1:6)]))
write(toJSON(out_yoo, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/secondorder/yoo.json")
cat("written yoo\n")

# seminr's demo seminr-pls-higher_order (mobi): Satisfaction a higher-order
# composite of Image and Value (two_stage, mode_A), Expectation + Quality ->
# Satisfaction -> Complaints, Loyalty. Once as in the demo (all Mode A), once
# with Image and Value in Mode B (the demo's second variant). seminr 2.5.0, the
# version in the app's webR repository.
suppressPackageStartupMessages(library(seminr))
stopifnot(as.character(packageVersion("seminr")) == "2.5.0")
seminr_hoc <- function(dim_weights) {
  mm <- constructs(
    composite("Image", multi_items("IMAG", 1:5), weights = dim_weights),
    composite("Expectation", multi_items("CUEX", 1:3)),
    composite("Quality", multi_items("PERQ", 1:7)),
    composite("Value", multi_items("PERV", 1:2), weights = dim_weights),
    higher_composite("Satisfaction", dimensions = c("Image", "Value"), method = two_stage, weights = mode_A),
    composite("Complaints", single_item("CUSCO")),
    composite("Loyalty", multi_items("CUSL", 1:3)))
  sm <- relationships(paths(from = c("Expectation", "Quality"), to = "Satisfaction"), paths(from = "Satisfaction", to = c("Complaints", "Loyalty")))
  fit <- estimate_pls(data = mobi, measurement_model = mm, structural_model = sm)
  P <- fit$path_coef
  list(
    paths = list(`Expectation -> Satisfaction` = P["Expectation", "Satisfaction"], `Quality -> Satisfaction` = P["Quality", "Satisfaction"],
      `Satisfaction -> Complaints` = P["Satisfaction", "Complaints"], `Satisfaction -> Loyalty` = P["Satisfaction", "Loyalty"]),
    r2 = as.list(fit$rSquared["Rsq", ]),
    secondOrder = list(loadings = as.list(fit$outer_loadings[c("Image", "Value"), "Satisfaction"]), weights = as.list(fit$outer_weights[c("Image", "Value"), "Satisfaction"])),
    firstOrderWeights = as.list(fit$outer_weights[paste0("IMAG", 1:5), "Image"]))
}
write(toJSON(list(seminr = as.character(packageVersion("seminr")), modeA = seminr_hoc(mode_A), modeB = seminr_hoc(mode_B)), auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/engine/__fixtures__/secondorder/seminr.json")
cat("written seminr\n")
