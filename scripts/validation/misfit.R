# Native reference for the CB-SEM "Diagnose misfit" panel (src/rengine/misfit.webr.test.ts): direct lavaan
# and semTools calls, as the panel should reproduce them.
#  - modification indices (lavaan::modindices) of the operators =~, ~ and ~~, ranked by |sepc.all|
#    (the 150 largest), with their MI, EPC and SEPC;
#  - residual correlations (lavaan::lavResiduals, type "cor.bollen") and their z-statistics, the 20 largest |z|
#    per group;
#  - the decision of Saris, Satorra & van der Veld (2009) per fixed parameter, semTools::epcEquivFit's
#    decision.pow at its defaults (which the app recomputes from MI and SEPC).
# Models: the Holzinger-Swineford CFA (lavaan's ?cfa), the same by school (two groups; school coded as the app
# codes a factor column, 1 = Grant-White, 2 = Pasteur), and the Political Democracy SEM (lavaan's ?sem).
# Run: Rscript scripts/validation/misfit.R  (writes src/engine/__fixtures__/misfit/reference.json)
suppressPackageStartupMessages({
  library(lavaan)
  library(semTools)
  library(jsonlite)
})

hs_model <- "visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9"
hs <- HolzingerSwineford1939
hs$school <- as.integer(hs$school)
pd_model <- "
  ind60 =~ x1 + x2 + x3
  dem60 =~ y1 + y2 + y3 + y4
  dem65 =~ y5 + y6 + y7 + y8
  dem60 ~ ind60
  dem65 ~ ind60 + dem60
  y1 ~~ y5
  y2 ~~ y4 + y6
  y3 ~~ y7
  y4 ~~ y8
  y6 ~~ y8
"

reference <- function(fit) {
  labels <- lavInspect(fit, "group.label")
  group_of <- function(mi) {
    if (!length(labels) || !("group" %in% names(mi))) {
      return(rep(NA_character_, nrow(mi)))
    }
    as.character(labels[mi$group])
  }
  mi <- modindices(fit)
  mi <- mi[mi$op %in% c("=~", "~", "~~") & is.finite(mi$sepc.all), ]
  mi <- head(mi[order(-abs(mi$sepc.all)), ], 150)
  e <- epcEquivFit(fit)
  e_key <- paste(e$lhs, e$op, e$rhs, e$group)
  mi_group_index <- if ("group" %in% names(mi)) mi$group else rep(1, nrow(mi))
  decision <- e$decision.pow[match(paste(mi$lhs, mi$op, mi$rhs, mi_group_index), e_key)]
  res <- lavResiduals(fit, type = "cor.bollen", summary = FALSE)
  blocks <- if (!is.null(res$cov)) list(res) else res
  residuals <- lapply(blocks, function(r) {
    low <- which(lower.tri(r$cov), arr.ind = TRUE)
    d <- data.frame(
      a = colnames(r$cov)[low[, 2]],
      b = rownames(r$cov)[low[, 1]],
      r = r$cov[low],
      z = r$cov.z[low]
    )
    head(d[order(-abs(d$z)), ], 20)
  })
  list(
    groups = as.character(labels),
    miCount = nrow(modindices(fit)[modindices(fit)$op %in% c("=~", "~", "~~") &
      is.finite(modindices(fit)$sepc.all), ]),
    mi = data.frame(
      lhs = mi$lhs,
      op = mi$op,
      rhs = mi$rhs,
      group = group_of(mi),
      mi = mi$mi,
      epc = mi$epc,
      sepc = mi$sepc.all,
      decision = decision
    ),
    residuals = unname(residuals)
  )
}

out <- list(
  versions = list(
    lavaan = as.character(packageVersion("lavaan")),
    semTools = as.character(packageVersion("semTools")),
    R = R.version.string
  ),
  hs = reference(cfa(hs_model, data = hs)),
  hsSchool = reference(cfa(hs_model, data = hs, group = "school")),
  pd = reference(sem(pd_model, data = PoliticalDemocracy))
)
dir.create("src/engine/__fixtures__/misfit", showWarnings = FALSE, recursive = TRUE)
writeLines(
  toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null", dataframe = "rows"),
  "src/engine/__fixtures__/misfit/reference.json"
)
str(out, max.level = 2)
