# Reference results for the bifactor example, from plain lavaan calls with the settings of the study's own code
# (09_bifactor.R in the deposit, 10.5281/zenodo.23301690): MLR, FIML, unit factor variances, orthogonal factors.
#   Rscript scripts/validation/bifactor_cpb.R
suppressPackageStartupMessages({
  library(lavaan)
  library(jsonlite)
})
d <- read.csv("public/examples/samples/bifactor_cpb.csv")
items <- names(d)
spec <- list(
  IS = c("IS1", "IS2", "IS3"),
  ISH = c("ISH1", "ISH2", "ISH3", "ISH4"),
  RB = c("RB1", "RB2", "RB3", "RB4"),
  PI = c("PI1", "PI3", "PI5")
)
model <- paste(
  c(
    paste("GEN =~", paste(items, collapse = " + ")),
    mapply(function(n, i) paste(n, "=~", paste(i, collapse = " + ")), names(spec), spec)
  ),
  collapse = "\n"
)
f <- suppressWarnings(cfa(model, data = d, estimator = "MLR", missing = "fiml", std.lv = TRUE, orthogonal = TRUE))
s <- standardizedSolution(f)
L <- s[s$op == "=~", ]
g <- setNames(L$est.std[L$lhs == "GEN"], L$rhs[L$lhs == "GEN"])
S <- L[L$lhs != "GEN", ]
sp <- setNames(S$est.std, S$rhs)[names(g)]
fac <- setNames(S$lhs, S$rhs)[names(g)]
resid <- 1 - g^2 - sp^2
parts <- sum(sapply(split(sp, fac), function(x) sum(x)^2))
est <- parameterEstimates(f)
le <- est[est$op == "=~", ]
out <- list(
  n = nobs(f),
  converged = lavInspect(f, "converged"),
  proper = lavInspect(f, "post.check"),
  fit = as.list(fitMeasures(f, c("chisq", "df", "chisq.scaled", "pvalue.scaled", "cfi.robust", "tli.robust", "rmsea.robust", "srmr", "logl", "npar"))),
  estimates = lapply(
    seq_len(nrow(le)),
    function(i) list(lhs = le$lhs[i], rhs = le$rhs[i], est = le$est[i], se = le$se[i], std = L$est.std[i])
  ),
  indices = list(
    ECV = sum(g^2) / (sum(g^2) + sum(sp^2)),
    omega = (sum(g)^2 + parts) / (sum(g)^2 + parts + sum(resid)),
    omegaH = sum(g)^2 / (sum(g)^2 + parts + sum(resid))
  ),
  syntax = model
)
write_json(out, "src/engine/__fixtures__/samples/bifactor_cpb.json", auto_unbox = TRUE, digits = 10, pretty = TRUE)
