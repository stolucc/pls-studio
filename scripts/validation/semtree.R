# Reference for the SEM tree card (independent of PLS Studio's code): semtree's lgcm data (the package's documented
# example dataset: 400 simulated cases, five occasions o1-o5, covariates agegroup, training, noise) with the linear
# latent growth curve of its documentation (intercept and slope, loadings 1 and 0-4, equal residual variances, latent
# means), written as lavaan syntax and fitted by lavaan::growth() (observed intercepts zero, latent means free); the covariates as the documentation codes them (agegroup
# ordered, training a factor, noise numeric). The tree by likelihood-ratio tests (method "naive", alpha .05, depth at
# most 3, nodes of at least 20); and a forest of 10 trees (seed 1) with its permutation variable importance.
# Also writes the example's data, public/examples/semtree/lgcm.csv.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/semtree.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(semtree)
})
data(lgcm)
lgcm <- as.data.frame(lgcm)
dir.create("public/examples/semtree", showWarnings = FALSE, recursive = TRUE)
write.csv(lgcm, "public/examples/semtree/lgcm.csv", row.names = FALSE)
d <- lgcm
d$agegroup <- ordered(d$agegroup)
d$training <- factor(d$training)
d$noise <- as.numeric(d$noise)
m <- "i =~ 1*o1 + 1*o2 + 1*o3 + 1*o4 + 1*o5
s =~ 0*o1 + 1*o2 + 2*o3 + 3*o4 + 4*o5
o1 ~~ e*o1
o2 ~~ e*o2
o3 ~~ e*o3
o4 ~~ e*o4
o5 ~~ e*o5
i ~~ s"
fit <- growth(m, data = d[, paste0("o", 1:5)])
ctrl <- semtree.control(method = "naive", alpha = 0.05, max.depth = 3, min.N = 20, verbose = FALSE, progress.bar = FALSE)
tree <- semtree(model = fit, data = d, predictors = c("agegroup", "training", "noise"), control = ctrl)
# Each node's estimates (semtree's node$params, named as coef(fit) names the free parameters: by its parameter table)
pt <- parTable(fit)
fr <- pt[pt$free > 0, ]
fr <- fr[order(fr$free), ]
stopifnot(identical(unname(tree$param_names), unname(names(coef(fit)))))
walk <- function(node) {
  me <- list(
    id = node$node_id, n = node$N, leaf = isLeaf(node), rule = if (isLeaf(node)) NULL else node$rule$name, lr = if (isLeaf(node)) NULL else node$lr,
    est = as.list(setNames(as.numeric(node$params), paste(fr$lhs, fr$op, ifelse(fr$op == "~1", "", fr$rhs))))
  )
  if (isLeaf(node)) list(me) else c(list(me), walk(node$left_child), walk(node$right_child))
}
set.seed(1)
forest <- semforest(model = fit, data = d, predictors = c("agegroup", "training", "noise"), control = semforest.control(num.trees = 10, control = ctrl))
vim <- varimp(forest)
imp <- colMeans(vim$importance, na.rm = TRUE)
out <- list(
  semtree = as.character(packageVersion("semtree")), lavaan = as.character(packageVersion("lavaan")),
  nodes = walk(tree), importance = as.list(ifelse(is.finite(imp), imp, NA))
)
dir.create("src/engine/__fixtures__/semtree", showWarnings = FALSE, recursive = TRUE)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), "src/engine/__fixtures__/semtree/reference.json")
cat("written\n")
