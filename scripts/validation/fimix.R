# Reference results for FIMIX-PLS from plain package calls (independent of
# PLS Studio's code): cSEM construct scores of plspm's simdata model (two
# simulated segments), then flexmix's stepFlexmix with one Gaussian
# regression per endogenous construct, 1-3 segments, 10 starts, seed 1;
# with and without segment intercepts.
#   R_LIBS=/path/to/lib Rscript scripts/validation/fimix.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(cSEM)
  library(flexmix)
  library(plspm)
})
data(simdata)
m <- "Satisfaction ~ Price + Quality\nPrice =~ mv1 + mv2 + mv3 + mv4 + mv5\nQuality =~ mv6 + mv7 + mv8 + mv9 + mv10\nSatisfaction =~ mv11 + mv12 + mv13"
f <- csem(
  simdata[1:13],
  m,
  .PLS_weight_scheme_inner = "path",
  .disattenuate = FALSE,
  .tolerance = 1e-7,
  .iter_max = 300
)
s <- as.data.frame(getConstructScores(f)$Construct_scores)
run <- function(form) {
  set.seed(1)
  x <- stepFlexmix(
    ~1,
    data = s,
    k = 1:3,
    model = list(FLXMRglm(as.formula(form))),
    nrep = 10,
    verbose = FALSE,
    control = list(minprior = 0)
  )
  lapply(as.character(1:3), function(k) {
    mk <- getModel(x, k)
    list(k = mk@k, logLik = as.numeric(logLik(mk)), sizes = as.integer(sort(table(clusters(mk)))))
  })
}
out <- list(
  version = as.character(packageVersion("flexmix")),
  intercepts = run("Satisfaction ~ Price + Quality"),
  noIntercepts = run("Satisfaction ~ Price + Quality - 1")
)
write.csv(simdata, "src/engine/__fixtures__/fimix/simdata.csv", row.names = FALSE)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/fimix/reference.json")
cat("written\n")
