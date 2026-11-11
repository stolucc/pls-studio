# Reference for the difference-in-differences card (src/rengine/did.webr.test.ts):
# did's ?aggte example on mpdta (staggered adoption, never-treated controls) and
# fixest's ?i example on base_did (two-way fixed effects, event study around period 5).
#   R_LIBS=<lib> Rscript scripts/validation/did.R
suppressPackageStartupMessages({
  library(did)
  library(fixest)
  library(jsonlite)
})
set.seed(1)
out <- att_gt(
  yname = "lemp",
  tname = "year",
  idname = "countyreal",
  gname = "first.treat",
  xformla = NULL,
  data = mpdta,
  control_group = "nevertreated",
  alp = 0.05
)
simple <- aggte(out, type = "simple")
dyn <- aggte(out, type = "dynamic")
base_did$post2 <- as.integer(base_did$period >= 6)
est <- feols(y ~ treat:post + x1 | id + period, data = base_did, cluster = ~id)
es <- feols(y ~ i(period, treat, ref = 5) + x1 | id + period, data = base_did, cluster = ~id)
ce <- coeftable(es)
rows <- grep("^period::", rownames(ce))
out_json <- list(
  versions = list(did = as.character(packageVersion("did")), fixest = as.character(packageVersion("fixest"))),
  mpdta = list(
    att = simple$overall.att,
    se = simple$overall.se,
    groupTime = lapply(seq_along(out$att), function(i) list(group = out$group[i], time = out$t[i], est = out$att[i])),
    dynamic = lapply(seq_along(dyn$egt), function(i) list(rel = dyn$egt[i], est = dyn$att.egt[i])),
    Wpval = out$Wpval
  ),
  base_did = list(
    att = unname(coef(est)["treat:post"]), se = unname(se(est)["treat:post"]),
    event = lapply(
      rows,
      function(r) list(time = as.numeric(sub("^period::([0-9]+):.*$", "\\1", rownames(ce)[r])), est = ce[r, 1], se = ce[r, 2])
    )
  )
)
dir.create("src/engine/__fixtures__/did", showWarnings = FALSE)
writeLines(
  toJSON(out_json, auto_unbox = TRUE, digits = NA, pretty = TRUE),
  "src/engine/__fixtures__/did/reference.json"
)
cat("written; mpdta ATT", simple$overall.att, "se", simple$overall.se, "; base_did ATT", coef(est)["treat:post"], "\n")
