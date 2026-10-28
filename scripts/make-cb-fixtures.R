# Reference output for the CB-SEM engine. Run from the repo root:
#   Rscript scripts/make-cb-fixtures.R
suppressMessages(library(lavaan))
out <- "src/engine/__fixtures__"
mobi <- read.csv(file.path(out, "mobi.csv"))

models <- list(
  # Full mobi model; single-indicator construct gets a fixed zero error variance.
  mobi_cb = '
    Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
    Expectation =~ CUEX1 + CUEX2 + CUEX3
    Quality =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
    Value =~ PERV1 + PERV2
    Satisfaction =~ CUSA1 + CUSA2 + CUSA3
    Complaints =~ CUSCO
    CUSCO ~~ 0*CUSCO
    Loyalty =~ CUSL1 + CUSL2 + CUSL3
    Expectation ~ Image
    Quality ~ Expectation
    Value ~ Expectation + Quality
    Satisfaction ~ Image + Expectation + Quality + Value
    Complaints ~ Satisfaction
    Loyalty ~ Image + Satisfaction + Complaints',
  # Two correlated exogenous factors and a mediator.
  small_cb = '
    Image =~ IMAG1 + IMAG2 + IMAG3 + IMAG4 + IMAG5
    Quality =~ PERQ1 + PERQ2 + PERQ3 + PERQ4 + PERQ5 + PERQ6 + PERQ7
    Satisfaction =~ CUSA1 + CUSA2 + CUSA3
    Value =~ PERV1 + PERV2
    Value ~ Quality
    Satisfaction ~ Image + Quality + Value'
)

for (name in names(models)) {
  fit <- sem(models[[name]], data = mobi, estimator = "ML")
  pe <- parameterEstimates(fit, standardized = TRUE)
  pe <- pe[pe$op %in% c("=~", "~", "~~"), c("lhs", "op", "rhs", "est", "se", "z", "pvalue", "std.all")]
  fm <- as.list(fitMeasures(fit, c("npar", "chisq", "df", "pvalue", "baseline.chisq", "baseline.df",
    "cfi", "tli", "rmsea", "rmsea.ci.lower", "rmsea.ci.upper", "rmsea.pvalue", "srmr", "aic", "bic", "logl")))
  res <- list(
    params = pe,
    fit = lapply(fm, as.numeric),
    r2 = as.list(inspect(fit, "r2")),
    iterations = lavInspect(fit, "iterations"),
    n = lavInspect(fit, "nobs"))
  jsonlite::write_json(res, file.path(out, paste0(name, ".json")), digits = NA, auto_unbox = TRUE, pretty = TRUE)
  cat(name, "chisq", fm$chisq, "df", fm$df, "cfi", fm$cfi, "\n")
}

# chi-square and noncentral chi-square references
cs <- expand.grid(x = c(0.5, 3, 12.7, 40), df = c(1, 5, 30))
cs$p <- pchisq(cs$x, cs$df)
cs$pnc <- pchisq(cs$x, cs$df, ncp = 4.5)
jsonlite::write_json(cs, file.path(out, "chisq.json"), digits = NA, pretty = TRUE)
