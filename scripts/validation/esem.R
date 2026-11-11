# Reference results for exploratory SEM (ESEM) blocks, from desktop lavaan
# (efa() blocks, Asparouhov & Muthén 2009): Holzinger & Swineford (1939).
#
#   Rscript scripts/validation/esem.R

suppressMessages({
  library(lavaan)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/esem"
hs <- HolzingerSwineford1939[, paste0("x", 1:9)]
block <- 'efa("b1")*visual + efa("b1")*textual + efa("b1")*speed =~ x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9'
target <- matrix(0, 9, 3, dimnames = list(paste0("x", 1:9), c("visual", "textual", "speed")))
target[1:3, 1] <- NA
target[4:6, 2] <- NA
target[7:9, 3] <- NA
structural <- 'efa("b1")*visual + efa("b1")*textual =~ x1 + x2 + x3 + x4 + x5 + x6\nspeed =~ x7 + x8 + x9\nspeed ~ visual + textual'
fits <- list(
  geomin = sem(block, hs, rotation = "geomin"),
  oblimin = sem(block, hs, rotation = "oblimin"),
  target = sem(block, hs, rotation = "target", rotation.args = list(target = target)),
  structural = sem(structural, hs, rotation = "geomin")
)
out <- lapply(fits, function(f) {
  pe <- parameterEstimates(f, standardized = TRUE)
  l <- pe[pe$op %in% c("=~", "~"), ]
  list(
    fit = as.list(fitMeasures(f, c("chisq", "df", "cfi", "rmsea"))),
    estimates = lapply(seq_len(nrow(l)), function(i) list(lhs = l$lhs[i], op = l$op[i], rhs = l$rhs[i], est = l$est[i], se = l$se[i], std = l$std.all[i])),
    factorCor = unname(lavInspect(f, "cor.lv"))
  )
})
write(toJSON(c(list(lavaan = as.character(packageVersion("lavaan"))), out), auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "hs_esem.json"))
cat("written\n")
