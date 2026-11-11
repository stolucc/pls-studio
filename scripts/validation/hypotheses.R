# Reference for the informative-hypotheses card (GORICA by restriktor, Bayes factors by bain), run natively:
#  - restriktor's tutorial vignette("Tutorial_GORICA_restriktor_lavaan"), its SEM example: Bollen's Political
#    Democracy model with the two paths into dem65 labelled, H1: abs(beta_dem65_dem60) > abs(beta_dem65_ind60)
#    against its complement, standardised, set.seed(100); and the same through semTools::goricaSEM (the wrapper)
#    and through goric() on the estimates and their covariance matrix (the numeric route);
#  - semTools' ?goricaSEM example: the democracy loadings labelled per year, H1: a1 > a2, b1 > b2, c1 > c2 against
#    the complement, unstandardised;
#  - bain's vignette("Introduction_to_bain"), its latent regression of the sesamesim data (A on B, age and peabody,
#    std.lv = TRUE), the three hypotheses, fraction = 1, standardize = TRUE, set.seed(100) — once with bain's own
#    parameter names (A~B) and once with the paths labelled as the app needs (b_B, b_peabody, b_age);
#  - several hypotheses with a linear combination against the unconstrained hypothesis, and bain with fraction 2.
#   R_LIBS=/path/to/helper/library Rscript scripts/validation/hypotheses.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(lavaan)
  library(restriktor)
  library(bain)
  library(semTools)
})
g_out <- function(g) list(models = g$result$model, loglik = g$result$loglik, penalty = g$result$penalty, gorica = g$result$gorica, weights = g$result$gorica.weights, ratio = unname(g$ratio.gw))
b_out <- function(b) {
  f <- b$fit
  list(
    rows = rownames(f),
    fit = f$Fit,
    com = f$Com,
    bfu = f$BF.u,
    bfc = f$BF.c,
    pmpa = f$PMPa,
    pmpb = f$PMPb,
    pmpc = f$PMPc,
    matrix = unname(b$BFmatrix)
  )
}

# ---- restriktor tutorial: SEM ----
model_sem <- "
  ind60 =~ x1 + x2 + x3
  dem60 =~ y1 + y2 + y3 + y4
  dem65 =~ y5 + y6 + y7 + y8
  dem60 ~ ind60
  dem65 ~ beta_dem65_ind60*ind60 + beta_dem65_dem60*dem60
  y1 ~~ y5
  y2 ~~ y4 + y6
  y3 ~~ y7
  y4 ~~ y8
  y6 ~~ y8
"
H1_sem <- "abs(beta_dem65_dem60) > abs(beta_dem65_ind60)"
fit_sem <- sem(model_sem, data = PoliticalDemocracy)
set.seed(100)
tut <- goric(fit_sem, hypotheses = list(H1_sem = H1_sem), standardized = TRUE)
set.seed(100)
wrap <- goricaSEM(
  fit_sem,
  hypotheses = list(H1_sem = H1_sem),
  standardized = TRUE,
  comparison = "complement",
  type = "gorica"
)
std <- standardizedSolution(fit_sem)
keep <- std$label %in% c("beta_dem65_ind60", "beta_dem65_dem60")
est <- setNames(std$est.std[keep], std$label[keep])
V <- lavInspect(fit_sem, "vcov.std.all")[names(est), names(est)]
set.seed(100)
numeric <- goric(est, VCOV = V, hypotheses = list(H1_sem = H1_sem), comparison = "complement", type = "gorica")

# ---- semTools ?goricaSEM ----
model_gs <- "
  ind60 =~ x1 + x2 + x3
  dem60 =~ y1 + a1*y2 + b1*y3 + c1*y4
  dem65 =~ y5 + a2*y6 + b2*y7 + c2*y8
  dem60 ~ ind60
  dem65 ~ ind60 + dem60
  y1 ~~ y5
  y2 ~~ y4 + y6
  y3 ~~ y7
  y4 ~~ y8
  y6 ~~ y8
"
fit_gs <- sem(model_gs, data = PoliticalDemocracy)
set.seed(100)
gs <- goricaSEM(
  fit_gs,
  hypotheses = list(H1 = "a1 > a2; b1 > b2; c1 > c2"),
  standardized = FALSE,
  comparison = "complement",
  type = "gorica"
)
# several hypotheses (one with a linear combination) against the unconstrained hypothesis
set.seed(100)
several <- goric(
  fit_gs,
  hypotheses = list(H1 = "a1 > a2; b1 > b2; c1 > c2", H2 = "a1 = a2; b1 = b2", H3 = "2*a1 - a2 > 1.5"),
  comparison = "unconstrained",
  type = "gorica",
  standardized = FALSE
)

# ---- bain vignette: latent regression ----
model2 <- "
    A  =~ Ab + Al + Af + An + Ar + Ac
    B =~ Bb + Bl + Bf + Bn + Br + Bc
    A ~ B + age + peabody
"
fit2 <- sem(model2, data = sesamesim, std.lv = TRUE)
hypotheses2 <- "A~B > A~peabody = A~age = 0;
               A~B > A~peabody > A~age = 0;
A~B > A~peabody > A~age > 0"
set.seed(100)
y1 <- bain(fit2, hypotheses2, fraction = 1, standardize = TRUE)
fit2l <- sem(
  sub("A ~ B + age + peabody", "A ~ b_B*B + b_age*age + b_peabody*peabody", model2, fixed = TRUE),
  data = sesamesim,
  std.lv = TRUE
)
set.seed(100)
y1l <- bain(
  fit2l,
  gsub("A~peabody", "b_peabody", gsub("A~age", "b_age", gsub("A~B", "b_B", hypotheses2))),
  fraction = 1,
  standardize = TRUE
)
# the marker scaling the app uses instead of std.lv: standardised results do not depend on it
fit2m <- sem(
  sub("A ~ B + age + peabody", "A ~ b_B*B + b_age*age + b_peabody*peabody", model2, fixed = TRUE),
  data = sesamesim
)
set.seed(100)
y1m <- bain(
  fit2m,
  "b_B > b_peabody = b_age = 0; b_B > b_peabody > b_age = 0; b_B > b_peabody > b_age > 0",
  fraction = 1,
  standardize = TRUE
)
# unstandardised, fraction 2
set.seed(100)
y2 <- bain(fit2m, "b_B > b_peabody > b_age; b_B > 0 & b_peabody = 0", fraction = 2, standardize = FALSE)

write(toJSON(list(
  versions = list(
    lavaan = as.character(packageVersion("lavaan")),
    restriktor = as.character(packageVersion("restriktor")),
    bain = as.character(packageVersion("bain")),
    semTools = as.character(packageVersion("semTools"))
  ),
  tutorial = g_out(tut), wrapper = g_out(wrap), numeric = g_out(numeric), estimates = as.list(est),
  goricaSEM = g_out(gs), several = g_out(several),
  bain = b_out(y1), bainLabelled = b_out(y1l), bainMarker = b_out(y1m), bainUnstd = b_out(y2)
), auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/hypotheses.json")
print(tut)
print(gs)
print(several)
print(y1)
print(y2)
cat("written\n")
