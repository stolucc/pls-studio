# Reference results for latent interactions by LMS and QML (modsem), on
# modsem's example data oneInt. modsem must be installed; pass a library path
# as the first argument to use one outside the default library.
#
#   Rscript scripts/validation/modsem.R [library]

args <- commandArgs(TRUE)
if (length(args)) .libPaths(c(args[1], .libPaths()))
suppressMessages({ library(modsem); library(jsonlite) })
root <- "src/engine/__fixtures__/modsem"
write.csv(oneInt, file.path(root, "oneInt.csv"), row.names = FALSE)
m <- "X =~ x1 + x2 + x3\nZ =~ z1 + z2 + z3\nY =~ y1 + y2 + y3\nY ~ X + Z + X:Z"
res <- lapply(c(lms = "lms", qml = "qml"), function(method) {
  f <- modsem(m, oneInt, method = method)
  pe <- parameter_estimates(f); st <- standardized_estimates(f)
  s <- pe[pe$op %in% c("~", "=~"), ]
  std <- st$est[match(paste(s$lhs, s$op, s$rhs), paste(st$lhs, st$op, st$rhs))]
  list(estimates = lapply(seq_len(nrow(s)), function(i) list(lhs = s$lhs[i], op = s$op[i], rhs = s$rhs[i], est = s$est[i], se = s$std.error[i], std = std[i])))
})
write(toJSON(c(list(modsem = as.character(packageVersion("modsem")), model = m), res), auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"),
  file.path(root, "oneInt.json"))
cat("written\n")
