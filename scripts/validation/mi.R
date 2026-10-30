# Reference for multiple imputation (mice, predictive mean matching), pooled:
#   - CB-SEM: lavaan.mi::sem.mi, Rubin's rules (HS three-factor CFA, 30 cases
#     missing x1 and 30 missing x5, m = 5, seed 1)
#   - PLS: cSEM in each imputed data set, estimates averaged (satisfaction,
#     25 cases missing expe1 and 25 missing qual2, m = 5, seed 3)
#   R_LIBS=/path/to/lib Rscript scripts/validation/mi.R

suppressPackageStartupMessages({ library(jsonlite); library(lavaan); library(lavaan.mi); library(mice); library(cSEM) })
d <- HolzingerSwineford1939[, paste0("x", 1:9)]
set.seed(1); d[sample(301, 30), "x1"] <- NA; d[sample(301, 30), "x5"] <- NA
imp <- mice(d, m = 5, seed = 1, printFlag = FALSE)
f <- sem.mi("visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9", data = imp)
pp <- parameterEstimates.mi(f); ld <- pp[pp$op == "=~" & pp$se > 0, ]
# The same with the two schools as groups, loadings equal (metric invariance).
dg <- HolzingerSwineford1939[, c(paste0("x", 1:9), "school")]
dg$x1[is.na(d$x1)] <- NA; dg$x5[is.na(d$x5)] <- NA
gimp <- mice(dg, m = 5, seed = 1, printFlag = FALSE)
fg <- sem.mi("visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9", data = gimp, group = "school", group.equal = "loadings")
pg <- parameterEstimates.mi(fg); lg <- pg[pg$op == "=~" & pg$se > 0, ]
s <- satisfaction[, c(paste0("expe", 1:3), paste0("qual", 1:3), paste0("sat", 1:3))]
set.seed(2); s[sample(250, 25), "expe1"] <- NA; s[sample(250, 25), "qual2"] <- NA
simp <- mice(s, m = 5, seed = 3, printFlag = FALSE)
m <- "EXPE =~ expe1 + expe2 + expe3\nQUAL <~ qual1 + qual2 + qual3\nSAT =~ sat1 + sat2 + sat3\nQUAL ~ EXPE\nSAT ~ EXPE + QUAL"
P <- Reduce(`+`, lapply(1:5, function(k) csem(complete(simp, k), m, .PLS_modes = list(EXPE = "modeA", QUAL = "modeB", SAT = "modeA"), .disattenuate = FALSE, .tolerance = 1e-7)$Estimates$Path_estimates)) / 5
out <- list(mice = as.character(packageVersion("mice")), lavaan.mi = as.character(packageVersion("lavaan.mi")),
  cb = list(loadings = setNames(as.list(ld$est), paste(ld$lhs, ld$rhs)), se = setNames(as.list(ld$se), paste(ld$lhs, ld$rhs)),
    chisq = unname(fitMeasures(f)["chisq"]), cfi = unname(fitMeasures(f)["cfi"]), vcovDiag = as.list(diag(unclass(vcov(f)))),
    hsMissing = list(x1 = which(is.na(d$x1)), x5 = which(is.na(d$x5))), firstImputedX1 = complete(imp, 1)$x1[which(is.na(d$x1))[1:5]]),
  groups = list(labels = lavInspect(fg, "group.label"), loadings = lapply(split(lg, lg$group), function(x) setNames(as.list(x$est), paste(x$lhs, x$rhs))),
    se = lapply(split(lg, lg$group), function(x) setNames(as.list(x$se), paste(x$lhs, x$rhs))), chisq = unname(fitMeasures(fg)["chisq"]), df = unname(fitMeasures(fg)["df"])),
  pls = list(paths = list(`EXPE -> QUAL` = P["QUAL", "EXPE"], `EXPE -> SAT` = P["SAT", "EXPE"], `QUAL -> SAT` = P["SAT", "QUAL"]),
    satMissing = list(expe1 = which(is.na(s$expe1)), qual2 = which(is.na(s$qual2)))))
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/mi/reference.json")
cat("written\n")
