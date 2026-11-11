# Reference results for two-level CB-SEM, from desktop lavaan: lavaan's
# Demo.twolevel (cluster = "cluster").
#
#   Rscript scripts/validation/twolevel.R

suppressMessages({
  library(lavaan)
  library(jsonlite)
})
root <- "src/engine/__fixtures__/twolevel"
d <- Demo.twolevel[, c("y1", "y2", "y3", "x1", "x2", "cluster")]
write.csv(d, file.path(root, "demo_twolevel.csv"), row.names = FALSE)
same <- "level: 1\n  f =~ y1 + y2 + y3\n  f ~ x1 + x2\nlevel: 2\n  f_b =~ y1 + y2 + y3\n  f_b ~ x1 + x2"
sat <- "level: 1\n  f =~ y1 + y2 + y3\n  f ~ x1 + x2\nlevel: 2\n  y1 ~~ y1 + y2 + y3 + x1 + x2\n  y2 ~~ y2 + y3 + x1 + x2\n  y3 ~~ y3 + x1 + x2\n  x1 ~~ x1 + x2\n  x2 ~~ x2"
out <- lapply(list(same = same, saturated = sat), function(m) {
  f <- sem(m, d, cluster = "cluster")
  pe <- parameterEstimates(f, standardized = TRUE)
  pe <- pe[pe$op %in% c("=~", "~"), ]
  list(
    fit = as.list(fitMeasures(f, c("chisq", "df", "cfi", "rmsea", "srmr_within", "srmr_between"))),
    estimates = lapply(seq_len(nrow(pe)), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], level = pe$level[i], est = pe$est[i], se = pe$se[i], std = pe$std.all[i])),
    icc = as.list(lavInspect(f, "icc"))
  )
})
write(toJSON(c(list(lavaan = as.character(packageVersion("lavaan"))), out), auto_unbox = TRUE, digits = NA, pretty = TRUE), file.path(root, "demo_twolevel.json"))
cat("written\n")
