# Reference results for PLS assessment (independent of PLS Studio's code),
# with cSEM on its own ECSI example (satisfaction, satisfaction_gender):
# model selection criteria for the model and an alternative (LOY ~ SAT only),
# MICOM's compositional invariance c, Klesel's dG / dL and Chin's path
# differences between women and men, and the per-group path coefficients.
# These do not depend on random draws, so they can be compared across cSEM
# versions (native 0.6.1, webR 0.7.1). Blindfolding Q2 is checked against
# semPLS 1.0-10 (CRAN archive) on the same data, and on its ?qSquared example;
# confirmatory composite analysis against cSEM's ?ITFlex example (Henseler 2021).
#   R_LIBS=/path/to/lib Rscript scripts/validation/plsx.R

suppressPackageStartupMessages({ library(jsonlite); library(cSEM) })
m <- "EXPE ~ IMAG\nQUAL ~ EXPE\nVAL ~ EXPE + QUAL\nSAT ~ IMAG + EXPE + QUAL + VAL\nLOY ~ IMAG + SAT
IMAG <~ imag1 + imag2 + imag3\nEXPE <~ expe1 + expe2 + expe3\nQUAL <~ qual1 + qual2 + qual3 + qual4 + qual5\nVAL <~ val1 + val2 + val3
SAT =~ sat1 + sat2 + sat3 + sat4\nLOY =~ loy1 + loy2 + loy3 + loy4"
m2 <- sub("LOY ~ IMAG + SAT", "LOY ~ SAT", m, fixed = TRUE)
opts <- function(d, mm, ...) csem(d, mm, .PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300, ...)
fit <- opts(satisfaction, m); fit2 <- opts(satisfaction, m2)
msc <- function(f) lapply(calculateModelSelectionCriteria(f, .by_equation = TRUE), as.list)
g <- opts(satisfaction_gender, m, .id = "gender")
set.seed(1); mi <- testMICOM(g, .R = 30, .seed = 1, .verbose = FALSE)
md <- testMGD(g, .approach_mgd = c("Klesel", "Chin"), .R_permutation = 30, .seed = 1, .verbose = FALSE)
out <- list(version = as.character(packageVersion("cSEM")), msc = msc(fit), mscAlt = msc(fit2),
  micomC = as.list(mi$Step2$Test_statistic[[1]]), klesel = as.list(md$Klesel$Test_statistic),
  chin = as.list(md$Chin$Test_statistic[[1]][grepl(" ~ ", names(md$Chin$Test_statistic[[1]]))]),
  groups = lapply(g, function(x) { P <- x$Estimates$Path_estimates; list(SAT_VAL = P["SAT", "VAL"], LOY_SAT = P["LOY", "SAT"]) }))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference.json")
cat("written\n")

# ---- GSCA, nonlinear PLSc and redundancy analysis ----
gsca <- csem(satisfaction, m, .approach_weights = "GSCA", .PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300)
sw <- "INT ~ INV + SAT + INV.SAT\nINV =~ INV1 + INV2 + INV3 + INV4\nSAT =~ SAT1 + SAT2 + SAT3\nINT =~ INT1 + INT2"
plsc <- csem(Switching, sw, .PLS_weight_scheme_inner = "factorial", .disattenuate = TRUE, .tolerance = 1e-7, .iter_max = 300)
out2 <- list(gsca = list(SAT_VAL = gsca$Estimates$Path_estimates["SAT", "VAL"], LOY_SAT = gsca$Estimates$Path_estimates["LOY", "SAT"]),
  plsc = as.list(plsc$Estimates$Path_estimates["INT", c("INV", "SAT", "INV.SAT")]),
  redundancy = as.list(doRedundancyAnalysis(fit)))
write(toJSON(out2, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference2.json")
cat("written 2\n")

# ---- PCA and unit (sum score) weights ----
out3 <- lapply(c("PCA", "unit"), function(a) { f <- csem(satisfaction, m, .approach_weights = a, .PLS_weight_scheme_inner = "path", .disattenuate = FALSE, .tolerance = 1e-7, .iter_max = 300)
  list(SAT_VAL = f$Estimates$Path_estimates["SAT", "VAL"], LOY_SAT = f$Estimates$Path_estimates["LOY", "SAT"]) })
names(out3) <- c("PCA", "unit")
write(toJSON(out3, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference3.json")
cat("written 3\n")

# ---- Blindfolding: Q2 as semPLS's qSquared (mean replacement, cell-wise omission, D = 7) ----
# semPLS 1.0-10 (CRAN archive) is needed here only, as the reference.
library(semPLS)
sm <- rbind(c("IMAG", "EXPE"), c("EXPE", "QUAL"), c("EXPE", "VAL"), c("QUAL", "VAL"), c("IMAG", "SAT"), c("EXPE", "SAT"),
  c("QUAL", "SAT"), c("VAL", "SAT"), c("IMAG", "LOY"), c("SAT", "LOY"))
blocks <- list(IMAG = paste0("imag", 1:3), EXPE = paste0("expe", 1:3), QUAL = paste0("qual", 1:5), VAL = paste0("val", 1:3), SAT = paste0("sat", 1:4), LOY = paste0("loy", 1:4))
mm <- do.call(rbind, lapply(names(blocks), function(k) cbind(k, blocks[[k]])))
sd_ <- as.data.frame(satisfaction)[, unlist(blocks)]
colnames(sm) <- colnames(mm) <- c("source", "target"); dimnames(mm) <- list(NULL, c("source", "target"))
# (semPLS's plsm tests class(m) != "matrix", which fails since R 4.0, where a matrix is also an "array".)
plsm4 <- semPLS::plsm
body(plsm4) <- parse(text = gsub('class\\((strucmod|measuremod)\\) != "matrix"', '!is.matrix(\\1)', paste(deparse(body(plsm4)), collapse = "\n")))[[1]]
pm <- plsm4(sd_, strucmod = sm, measuremod = mm)
sp <- sempls(pm, sd_, wscheme = "pathWeighting", maxit = 1000, tol = 1e-10, verbose = FALSE)
meanimp <- function(d) { for (v in seq_len(ncol(d))) d[is.na(d[, v]), v] <- mean(d[, v], na.rm = TRUE); d }
q <- qSquared(sp, d = 7, impfun = meanimp, dlines = FALSE, wscheme = "pathWeighting", maxit = 1000, tol = 1e-10)
# The homescreen example: semPLS's ?qSquared (ECSImobi on mobi, centroid scheme, d = 4), with mean replacement.
data(mobi); data(ECSImobi)
ecsi <- sempls(model = ECSImobi, data = mobi, wscheme = "centroid", maxit = 1000, tol = 1e-10, verbose = FALSE)
qm <- qSquared(ecsi, d = 4, impfun = meanimp, dlines = FALSE, wscheme = "centroid", maxit = 1000, tol = 1e-10)
keep <- function(q) as.list(setNames(q[, 1], rownames(q))[!is.na(q[, 1])])
out4 <- list(semPLS = as.character(packageVersion("semPLS")), q2 = keep(q), mobi = keep(qm))
write(toJSON(out4, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference4.json")
cat("written 4\n")

# ---- Confirmatory composite analysis: cSEM's ?ITFlex example (Henseler 2021), verbatim ----
model_IT_Fex <- "
# Composite models
ITComp  <~ ITCOMP1 + ITCOMP2 + ITCOMP3 + ITCOMP4
Modul   <~ MOD1 + MOD2 + MOD3 + MOD4
ITConn  <~ ITCONN1 + ITCONN2 + ITCONN3 + ITCONN4
ITPers  <~ ITPSF1 + ITPSF2 + ITPSF3 + ITPSF4

# Saturated structural model
ITPers ~ ITComp + Modul + ITConn
Modul  ~ ITComp + ITConn
ITConn ~ ITComp
"
it_out <- csem(.data = ITFlex, .model = model_IT_Fex, .PLS_weight_scheme_inner = "factorial", .tolerance = 1e-06, .PLS_ignore_structural_model = TRUE)
set.seed(1); it_omf <- testOMF(it_out, .R = 20, .seed = 1)  # the test statistics do not depend on the draws
W <- it_out$Estimates$Weight_estimates; V <- calculateVIFModeB(it_out)
out5 <- list(statistic = as.list(it_omf$Test_statistic),
  weights = lapply(setNames(rownames(W), rownames(W)), function(k) as.list(W[k, W[k, ] != 0])),
  vif = lapply(setNames(rownames(V), rownames(V)), function(k) as.list(V[k, V[k, ] != 0])),
  correlations = as.list(as.data.frame(it_out$Estimates$Construct_VCV)))
write(toJSON(out5, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/plsx/reference5.json")
cat("written 5\n")
