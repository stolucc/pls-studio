# Reference results for the dynamic panel card (analyses/dpm.tsx, R ps_dpm) on its example (packages.ts:
# dpm-wages): the dpm package's own example, which replicates Allison, Williams & Moral-Benito (2017): weeks worked
# on last year's union membership (predetermined) and log wage, education constant, with a fixed effect (alpha)
# and equal error variances, observed information; Cornwell & Rupert's PSID wage panel (panelr::WageData, 595 men,
# 1976-1982). dpm and panelr are not part of the app: install them in a library of their own.
#   R_LIBS=/path/to/scratch/library:/path/to/helper/library Rscript scripts/validation/dpm.R
# Writes public/examples/dpm/wages-wide.csv and src/engine/__fixtures__/dpm/reference.json.

suppressPackageStartupMessages({
  library(dpm)
  library(panelr)
  library(lavaan)
  library(jsonlite)
})
data("WageData", package = "panelr")
w <- as.data.frame(WageData)[, c("id", "t", "wks", "union", "lwage", "ed")]
wide <- reshape(w[, c("id", "t", "wks", "union", "lwage")], idvar = "id", timevar = "t", direction = "wide", sep = "_")
wide$ed <- w$ed[match(wide$id, w$id)]
wide <- wide[order(wide$id), c("id", paste0("wks_", 1:7), paste0("union_", 1:7), paste0("lwage_", 1:7), "ed")]
write.csv(wide, "public/examples/dpm/wages-wide.csv", row.names = FALSE)

wages <- panel_data(WageData, id = id, wave = t)
fit <- dpm(wks ~ pre(lag(union)) + lag(lwage) | ed, data = wages, error.inv = TRUE, information = "observed")
pe <- parameterEstimates(as(fit, "lavaan"))
lab <- function(l) pe[pe$label == l, ][1, ]
row <- function(l) list(est = lab(l)$est, se = lab(l)$se)
fm <- lavaan::fitMeasures(as(fit, "lavaan"), c("chisq", "df", "cfi", "rmsea"))
out <- list(
  generated = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  R = R.version.string,
  dpm = as.character(packageVersion("dpm")),
  lavaan = as.character(packageVersion("lavaan")),
  n = nobs(as(fit, "lavaan")),
  syntax = fit@mod_string,
  wksLag = row("p1"), unionLag = row("en1"), lwageLag = row("ex1"), ed = row("c1"),
  errorVariance = row("v"),
  alphaVariance = list(est = pe$est[pe$lhs == "alpha" & pe$op == "~~" & pe$rhs == "alpha"],
    se = pe$se[pe$lhs == "alpha" & pe$op == "~~" & pe$rhs == "alpha"]),
  fit = as.list(unname(fm)) |> setNames(names(fm))
)
write_json(out, "src/engine/__fixtures__/dpm/reference.json", digits = NA, auto_unbox = TRUE, pretty = TRUE)
print(pe[pe$label %in% c("p1", "en1", "ex1", "c1", "v"), c("label", "est", "se", "z")][c(1, 2, 3, 4, 5) * 1, ], digits = 8)
print(fm, digits = 8)
