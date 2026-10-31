# Reference for sampling clusters (cluster-robust standard errors; Mplus TYPE =
# COMPLEX): lavaan's cluster = in a single-level model on Demo.twolevel, ML and
# MLR (src/rengine/complex.webr.test.ts).
#   R_LIBS=<lib> Rscript scripts/validation/complex.R
suppressPackageStartupMessages({ library(lavaan); library(jsonlite) })
model <- "fw =~ y1 + y2 + y3\nfw ~ x1 + x2 + x3"
one <- function(est) {
  fit <- sem(model, data = Demo.twolevel, cluster = "cluster", estimator = est)
  pe <- parameterEstimates(fit)
  pe <- pe[pe$op %in% c("=~", "~"), ]
  fm <- fitMeasures(fit)
  list(se = fit@Options$se, test = fit@Options$test,
    estimates = lapply(seq_len(nrow(pe)), function(i) list(lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i], se = pe$se[i])),
    chisq = unname(fm["chisq"]), df = unname(fm["df"]), chisqScaled = unname(fm["chisq.scaled"]), pScaled = unname(fm["pvalue.scaled"]),
    cfi = unname(fm["cfi"]), srmr = unname(fm["srmr"]))
}
plain <- sem(model, data = Demo.twolevel); pp <- parameterEstimates(plain); pp <- pp[pp$op %in% c("=~", "~"), ]
out <- list(versions = list(lavaan = as.character(packageVersion("lavaan")), R = R.version.string), ML = one("ML"), MLR = one("MLR"),
  plainSE = setNames(as.list(pp$se), paste(pp$lhs, pp$op, pp$rhs)))
dir.create("src/engine/__fixtures__/complex", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/complex/reference.json")
cat("written\n")
