# Native reference for the regularised SEM card (src/rengine/search.webr.test.ts): lslx's own documented example,
# "Semi-Confirmatory Factor Analysis" on ?lslx (Holzinger & Swineford, lavaan): the three factors with unit
# variances, every cross-loading penalised, MCP over lambda_grid = seq(.02, .60, .02) and delta_grid =
# c(1.5, 3.0, Inf), the penalty level chosen by BIC. Run exactly as the help page does; the card runs the same model
# from the canvas (factors scaled by their variance, cross-loadings penalised), converged tightly (below).
# Run: Rscript scripts/validation/lslx.R  (writes src/engine/__fixtures__/search/lslx.json)
suppressPackageStartupMessages({ library(lslx); library(jsonlite) })
model_fa <- "visual  :=> x1 + x2 + x3
             textual :=> x4 + x5 + x6
             speed   :=> x7 + x8 + x9
             visual  :~> x4 + x5 + x6 + x7 + x8 + x9
             textual :~> x1 + x2 + x3 + x7 + x8 + x9
             speed   :~> x1 + x2 + x3 + x4 + x5 + x6
             visual  <=> 1 * visual
             textual <=> 1 * textual
             speed   <=> 1 * speed"
lslx_fa <- lslx$new(model = model_fa, data = lavaan::HolzingerSwineford1939, verbose = FALSE)
lslx_fa$fit(penalty_method = "mcp", lambda_grid = seq(.02, .60, .02), delta_grid = c(1.5, 3.0, Inf), verbose = FALSE)
documented <- list(selected = unname(lslx_fa$extract_penalty_level(selector = "bic")), chisq = lslx_fa$test_lr(selector = "bic")["unadjusted", "statistic"])
# The same fit converged tightly (the card's tol_out = 1e-8): at lslx's default tolerance, 1e-3, and 100 iterations,
# the estimates move in the third decimal with the order of the model syntax; tightly converged they agree to 1e-7.
lslx_fa$fit(penalty_method = "mcp", lambda_grid = seq(.02, .60, .02), delta_grid = c(1.5, 3.0, Inf), verbose = FALSE, tol_out = 1e-8, iter_out_max = 1000)
sel <- lslx_fa$extract_penalty_level(selector = "bic")
est <- lslx_fa$test_coefficient(selector = "bic")
lr <- lslx_fa$test_lr(selector = "bic")
spec <- lslx_fa$extract_specification()
keep <- spec$type != "fixed" & spec$right != "1"
out <- list(versions = list(lslx = as.character(packageVersion("lslx")), R = R.version.string), documented = documented, selected = unname(sel),
  test = list(chisq = lr["unadjusted", "statistic"], df = lr["unadjusted", "df"]), fitIndex = as.list(lslx_fa$extract_fit_index(selector = "bic")),
  coefficients = lapply(rownames(spec)[keep], function(r) list(name = r, type = spec[r, "type"], est = est[r, "estimate"], se = est[r, "standard_error"])))
dir.create("src/engine/__fixtures__/search", showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/search/lslx.json")
print(sel); print(lr); lslx_fa$summarize(selector = "bic")
