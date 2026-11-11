# Reference results for multiple-group CB-SEM and measurement invariance, from
# desktop lavaan: Holzinger & Swineford (1939) by school (1 = Pasteur,
# 2 = Grant-White), the classic invariance example (lavaan tutorial).
#
#   Rscript scripts/validation/multigroup.R

suppressMessages({
  library(lavaan)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/multigroup"
hs <- HolzingerSwineford1939
d <- data.frame(hs[, paste0("x", 1:9)], school = as.integer(hs$school == "Grant-White") + 1L)
write.csv(d, file.path(root, "hs_school.csv"), row.names = FALSE)
model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
fits <- list(
  configural = cfa(model, d, group = "school"),
  metric = cfa(model, d, group = "school", group.equal = "loadings"),
  scalar = cfa(model, d, group = "school", group.equal = c("loadings", "intercepts")),
  strict = cfa(model, d, group = "school", group.equal = c("loadings", "intercepts", "residuals"))
)
partial <- cfa(model, d, group = "school", group.equal = c("loadings", "intercepts"), group.partial = c("x3~1", "x7~1"))
fm <- function(f) as.list(fitMeasures(f, c("chisq", "df", "cfi", "rmsea", "srmr")))
lrt <- lavTestLRT(fits$configural, fits$metric, fits$scalar, fits$strict)
pe <- parameterEstimates(fits$scalar)
means <- pe[pe$op == "~1" & pe$lhs %in% c("visual", "textual", "speed") & pe$group == 2, c("lhs", "est", "se")]
mi <- modindices(fits$configural, sort. = TRUE, maximum.number = 3)
st <- lavTestScore(fits$scalar)$uni
top <- st[which.max(st$X2), ]
pt <- parTable(fits$scalar)
write(toJSON(
  list(
    lavaan = as.character(packageVersion("lavaan")), model = model,
    levels = lapply(fits, fm), partial = fm(partial),
    lrt = list(chisqDiff = unname(lrt[["Chisq diff"]][-1]), dfDiff = unname(lrt[["Df diff"]][-1]), p = unname(lrt[["Pr(>Chisq)"]][-1])),
    latentMeansGroup2 = lapply(seq_len(nrow(means)), function(i) as.list(means[i, ])),
    loadingGroup2Configural = parameterEstimates(fits$configural)[with(parameterEstimates(fits$configural), lhs == "visual" & op == "=~" & rhs == "x2" & group == 2), "est"],
    topModindex = list(lhs = mi$lhs[1], op = mi$op[1], rhs = mi$rhs[1], mi = mi$mi[1]),
    topScore = list(param = paste(pt$lhs[pt$plabel == top$lhs], pt$op[pt$plabel == top$lhs]), x2 = top$X2)
  ),
  auto_unbox = TRUE, digits = NA, pretty = TRUE
), file.path(root, "hs_school.json"))
cat("written\n")
