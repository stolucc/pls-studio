# Reference for the guided higher-order construct check (src/reporting/hoc.ts),
# which derives three statistics from the PLS results:
#   - a reflective HOC's composite reliability (rhoC) and AVE from the loadings
#     of its lower-order components (LOCs),
#   - the standardised Cronbach's alpha of the LOC scores,
#   - the VIF of each LOC among the HOC's LOCs (formative HOC).
# The packages compute the same statistics in the two-stage approach, where
# stage 2 measures the HOC by the LOC scores: cSEM's assess() and
# calculateVIFModeB() on the second stage, seminr's summary() reliability and
# item VIFs. For repeated indicators, where the packages report the HOC's
# statistics on the repeated items only, the reference is (a) cSEM's own alpha
# and Mode B VIFs on the LOC scores of the repeated-indicators fit, and (b) the
# HOC's rhoC and AVE written out from the LOC-HOC correlations, as Sarstedt et
# al. (2019) compute them by hand (no package function takes these loadings).
#   Rscript scripts/validation/hoc-check.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(cSEM)
  library(seminr)
})

# --- cSEM's ?csem example (dgp_2ndorder_cf_of_c): c4 a common factor of c1-c3.
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
two <- csem(dgp_2ndorder_cf_of_c, model, .approach_2ndorder = "2stage")
a2 <- assess(two$Second_stage, .quality_criterion = c("reliability", "ave"))
csem_two_stage <- list(
  rhoC = unname(a2$Reliability$Joereskogs_rho["c4"]),
  ave = unname(a2$AVE["c4"]),
  alpha = unname(a2$Reliability$Cronbachs_alpha["c4"])
)

# Repeated indicators, as on the help page.
model_RI <- "
c4   ~ eta1
eta2 ~ eta1 + c4
c4   ~ c1 + c2 + c3
c1   <~ y11 + y12
c2   <~ y21 + y22 + y23 + y24
c3   <~ y31 + y32 + y33 + y34 + y35 + y36 + y37 + y38
eta1 =~ y41 + y42 + y43
eta2 =~ y51 + y52 + y53
c4 =~ y11_temp + y12_temp + y21_temp + y22_temp + y23_temp + y24_temp +
      y31_temp + y32_temp + y33_temp + y34_temp + y35_temp + y36_temp +
      y37_temp + y38_temp
"
data_RI <- dgp_2ndorder_cf_of_c
coln <- c(colnames(data_RI), paste0(colnames(data_RI), "_temp"))
data_RI <- data_RI[, c(1:ncol(data_RI), 1:ncol(data_RI))]
colnames(data_RI) <- coln
ri <- csem(data_RI, model_RI)
S <- ri$Estimates$Construct_scores
locs <- c("c1", "c2", "c3")
# (a) cSEM on the LOC scores: alpha (calculateRhoT, unit weights) and the Mode B VIFs of the
# dimensions, which depend on the scores' correlations only. (cSEM needs a second construct: eta1.)
loc_scores <- as.data.frame(S[, locs])
on_scores <- csem(
  cbind(loc_scores, dgp_2ndorder_cf_of_c[, c("y41", "y42", "y43")]),
  "c4 <~ c1 + c2 + c3\neta1 =~ y41 + y42 + y43\nc4 ~ eta1",
  .disattenuate = FALSE
)
vif_ri <- calculateVIFModeB(on_scores)
# (b) rhoC and AVE from the LOC-HOC loadings (correlations of the scores), by hand.
l <- vapply(locs, function(k) cor(S[, k], S[, "c4"]), 0)
csem_repeated <- list(
  loadings = as.list(l),
  rhoC = sum(l)^2 / (sum(l)^2 + sum(1 - l^2)),
  ave = mean(l^2),
  alpha = unname(calculateRhoT(on_scores, .only_common_factors = FALSE)["c4"]),
  vif = as.list(vif_ri["c4", locs]),
  vifByLm = as.list(vapply(locs, function(k) {
    1 / (1 - summary(lm(reformulate(setdiff(locs, k), k), data = loc_scores))$r.squared)
  }, 0))
)

# --- Henseler (2021), cSEM ?Yooetal2000: BR a composite (Mode B) of the common factors QL, LO, AA.
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
csem_yoo <- list(vif = as.list(calculateVIFModeB(yoo$Second_stage)["BR", c("QL", "LO", "AA")]))

# --- seminr's higher-order demo (mobi): Satisfaction of Image and Value, two-stage.
seminr_hoc <- function(hoc_weights) {
  mm <- constructs(
    composite("Image", multi_items("IMAG", 1:5)),
    composite("Expectation", multi_items("CUEX", 1:3)),
    composite("Quality", multi_items("PERQ", 1:7)),
    composite("Value", multi_items("PERV", 1:2)),
    higher_composite("Satisfaction", dimensions = c("Image", "Value"), method = two_stage, weights = hoc_weights),
    composite("Complaints", single_item("CUSCO")),
    composite("Loyalty", multi_items("CUSL", 1:3))
  )
  sm <- relationships(
    paths(from = c("Expectation", "Quality"), to = "Satisfaction"),
    paths(from = "Satisfaction", to = c("Complaints", "Loyalty"))
  )
  estimate_pls(data = mobi, measurement_model = mm, structural_model = sm)
}
sa <- summary(seminr_hoc(mode_A))
sb <- summary(seminr_hoc(mode_B))
seminr_two_stage <- list(
  rhoC = sa$reliability["Satisfaction", "rhoC"],
  ave = sa$reliability["Satisfaction", "AVE"],
  alpha = sa$reliability["Satisfaction", "alpha"],
  vifModeB = as.list(sb$validity$vif_items$Satisfaction[c("Image", "Value")])
)

out <- list(
  cSEM = as.character(packageVersion("cSEM")),
  seminr = as.character(packageVersion("seminr")),
  csemTwoStage = csem_two_stage,
  csemRepeated = csem_repeated,
  csemYoo = csem_yoo,
  seminrTwoStage = seminr_two_stage
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/secondorder/check.json")
cat("written\n")
str(out, give.attr = FALSE)
