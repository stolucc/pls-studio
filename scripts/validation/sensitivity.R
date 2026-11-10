# References for the sensitivity cards (independent of PLS Studio's code), the packages' own documented examples:
#   - SEMsens, ?sa.aco: the help page's data (simulateData with set.seed(10), N = 1000, standardised; written to
#     public/examples/semsens/sa_aco.csv, which the example ships), model, sensitivity model (a phantom on x, m and y),
#     paths of interest and settings (opt.fun = 3, k = 5, max.iter = 10), with seed = 1 for sa.aco (the help page
#     draws on from the data's seed); sens.tables(sort = FALSE) and every evaluation's standardised estimates
#   - mediation, ?medsens, Example 1: the JOBS II field experiment (jobs), job_seek ~ treat + econ_hard + sex + age and
#     depress2 ~ treat + job_seek + econ_hard + sex + age, mediate(sims = 50) and medsens(rho.by = .1, eps = .01,
#     effect.type = "both"); medsens's curves for two linear models do not depend on mediate's simulations
# Writes src/engine/__fixtures__/sensitivity/reference.json.
#   Rscript scripts/validation/sensitivity.R   (with lavaan, SEMsens, mediation and jsonlite in the library)

suppressPackageStartupMessages({ library(jsonlite); library(lavaan); library(SEMsens); library(mediation) })

# ---- SEMsens, ?sa.aco ----
sim.model <- ' x =~ x1 + 0.8*x2 + 1.2*x3
               y =~ y1 + 0.5*y2 + 1.5*y3
               m ~ 0.5*x
               y ~ 0.5*x + 0.8*m'
set.seed(10)
data <- simulateData(sim.model, sample.nobs = 1000L)
data <- data.frame(apply(data, 2, scale))
csv <- "public/examples/semsens/sa_aco.csv"
if (!file.exists(csv)) { dir.create(dirname(csv), showWarnings = FALSE, recursive = TRUE); write.csv(data, csv, row.names = FALSE) }
data <- read.csv(csv)  # (as the app reads it: 15 significant digits)
model <- 'x =~ x1 + x2 + x3
          y =~ y1 + y2 + y3
          m ~ x
          y ~ x + m'
sens.model <- 'x =~ x1 + x2 + x3
              y =~ y1 + y2 + y3
              m ~ x
              y ~ x + m
              x ~ phantom1*phantom
              m ~ phantom2*phantom
              y ~ phantom3*phantom
              phantom =~ 0
              phantom ~~ 1*phantom'
paths <- 'm ~ x
          y ~ x + m'
my.sa <- sa.aco(data, model = model, sens.model = sens.model, opt.fun = 3, k = 5, paths = paths, max.iter = 10, seed = 1, verbose = FALSE)
tables <- sens.tables(my.sa, sort = FALSE)
print(tables)
mr <- my.sa$model.results
draw <- function(k) vapply(sort(unique(mr$evals)), function(e) mr$est.std[mr$evals == e & paste0(mr$lhs, mr$op, mr$rhs) == k][1], 0)
tab <- function(m) lapply(rownames(m), function(r) list(row = r, values = unname(as.numeric(m[r, ]))))
semsens <- list(n.eval = my.sa$n.eval, n.iter = my.sa$n.iter, max.y = my.sa$max.y,
  sens.summary = tab(tables$sens.summary), phan.paths = tab(tables$phan.paths), phan.min = tab(tables$phan.min), phan.max = tab(tables$phan.max), p.paths = tab(tables$p.paths),
  draws = lapply(c("m~x", "y~x", "y~m", "x~phantom", "m~phantom", "y~phantom"), function(k) list(path = k, est = draw(k))))

# ---- mediation, ?medsens Example 1 ----
data(jobs)
b <- lm(job_seek ~ treat + econ_hard + sex + age, data = jobs)
c <- lm(depress2 ~ treat + job_seek + econ_hard + sex + age, data = jobs)
set.seed(1)
med.cont <- mediate(b, c, treat = "treat", mediator = "job_seek", sims = 50)
sens.cont <- medsens(med.cont, rho.by = .1, eps = .01, effect.type = "both")
summary(sens.cont)
medsens <- with(sens.cont, list(rho = rho, d0 = as.numeric(d0), lower.d0 = as.numeric(lower.d0), upper.d0 = as.numeric(upper.d0),
  z0 = as.numeric(z0), lower.z0 = as.numeric(lower.z0), upper.z0 = as.numeric(upper.z0), R2star.prod = R2star.prod, R2tilde.prod = R2tilde.prod,
  err.cr.d = err.cr.d, err.cr.z = err.cr.z, R2star.d.thresh = R2star.d.thresh, R2tilde.d.thresh = R2tilde.d.thresh,
  R2star.z.thresh = R2star.z.thresh, R2tilde.z.thresh = R2tilde.z.thresh, r.square.m = r.square.m, r.square.y = r.square.y, n = nobs(c)))

out <- list(R = R.version.string, lavaan = as.character(packageVersion("lavaan")), SEMsens = as.character(packageVersion("SEMsens")),
  mediation = as.character(packageVersion("mediation")), semsens = semsens, medsens = medsens)
dir.create("src/engine/__fixtures__/sensitivity", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), "src/engine/__fixtures__/sensitivity/reference.json")
