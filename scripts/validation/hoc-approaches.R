# Reference for the other second-order approaches in PLS, from the packages'
# own recipes: cSEM's ?csem example run with .approach_2ndorder = "mixed"
# (the embedded two-stage approach: repeated indicators in stage 1) and its
# repeated-indicators respecification (the model with the dimensions as
# predictors of c4 and the indicators repeated under new names), and seminr's
# higher-order demo model (mobi) with repeated indicators written by hand
# (seminr has no helper for it; composite("Satisfaction", <all items of Image
# and Value>) plus the dimensions as predictors, Becker et al. 2012).
#   R_LIBS=/path/to/lib Rscript scripts/validation/hoc-approaches.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM); library(seminr) })
untemp <- function(x) { dimnames(x) <- lapply(dimnames(x), function(v) sub("_temp$", "", v)); x }
hoc_of <- function(scores, B, hoc, comps) list(
  loadings = as.list(setNames(lapply(comps, function(k) unname(cor(scores[, k], scores[, hoc]))), comps)),
  weights = as.list(setNames(lapply(comps, function(k) unname(B[hoc, k])), comps)))

# --- cSEM, embedded two-stage ("mixed").
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
mixed <- csem(dgp_2ndorder_cf_of_c, model, .approach_2ndorder = "mixed")
e2 <- mixed$Second_stage$Estimates
B <- untemp(e2$Path_estimates)
cs_mixed <- list(paths = list(`eta1 -> c4` = B["c4", "eta1"], `eta1 -> eta2` = B["eta2", "eta1"], `c4 -> eta2` = B["eta2", "c4"]),
  r2 = setNames(as.list(e2$R2), sub("_temp$", "", names(e2$R2))),
  secondOrder = list(loadings = as.list(e2$Loading_estimates["c4", c("c1", "c2", "c3")]), weights = as.list(e2$Weight_estimates["c4", c("c1", "c2", "c3")])))

# --- cSEM, repeated indicators, exactly as on the help page.
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
e <- ri$Estimates; B <- e$Path_estimates
cs_ri <- list(paths = list(`eta1 -> c4` = B["c4", "eta1"], `eta1 -> eta2` = B["eta2", "eta1"], `c4 -> eta2` = B["eta2", "c4"]),
  r2 = as.list(e$R2), secondOrder = hoc_of(e$Construct_scores, B, "c4", c("c1", "c2", "c3")),
  hocLoadings = as.list(e$Loading_estimates["c4", paste0(c("y11", "y12", "y21", "y22", "y23", "y24", paste0("y3", 1:8)), "_temp")]))

# --- seminr, repeated indicators by hand (the demo's reflective-reflective model).
mm <- constructs(
  composite("Image", multi_items("IMAG", 1:5)), composite("Expectation", multi_items("CUEX", 1:3)), composite("Quality", multi_items("PERQ", 1:7)),
  composite("Value", multi_items("PERV", 1:2)), composite("Satisfaction", c(multi_items("IMAG", 1:5), multi_items("PERV", 1:2))),
  composite("Complaints", single_item("CUSCO")), composite("Loyalty", multi_items("CUSL", 1:3)))
sm <- relationships(paths(from = c("Image", "Value", "Expectation", "Quality"), to = "Satisfaction"), paths(from = "Satisfaction", to = c("Complaints", "Loyalty")))
sr <- estimate_pls(mobi, mm, sm)
P <- sr$path_coef; rs <- sr$rSquared
sem_ri <- list(seminr = as.character(packageVersion("seminr")),
  paths = list(`Expectation -> Satisfaction` = P["Expectation", "Satisfaction"], `Quality -> Satisfaction` = P["Quality", "Satisfaction"],
    `Satisfaction -> Complaints` = P["Satisfaction", "Complaints"], `Satisfaction -> Loyalty` = P["Satisfaction", "Loyalty"]),
  r2 = list(Satisfaction = rs["Rsq", "Satisfaction"], Complaints = rs["Rsq", "Complaints"], Loyalty = rs["Rsq", "Loyalty"]),
  secondOrder = hoc_of(sr$construct_scores, t(P), "Satisfaction", c("Image", "Value")))

out <- list(cSEM = as.character(packageVersion("cSEM")), csemEmbedded = cs_mixed, csemRepeated = cs_ri, seminrRepeated = sem_ri)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/secondorder/approaches.json")
cat("written\n"); str(out, max.level = 3, give.attr = FALSE)
