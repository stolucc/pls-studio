suppressMessages(library(seminr))
out <- "src/engine/__fixtures__"  # run from the repo root: Rscript scripts/make-fixtures.R
write.csv(mobi, file.path(out, "mobi.csv"), row.names = FALSE)
sm <- relationships(
  paths(from = "Image", to = c("Expectation", "Satisfaction", "Loyalty")),
  paths(from = "Expectation", to = c("Quality", "Value", "Satisfaction")),
  paths(from = "Quality", to = c("Value", "Satisfaction")),
  paths(from = "Value", to = c("Satisfaction")),
  paths(from = "Satisfaction", to = c("Complaints", "Loyalty")),
  paths(from = "Complaints", to = "Loyalty"))
mk <- function(qualityMode) constructs(
  composite("Image", multi_items("IMAG", 1:5)),
  composite("Expectation", multi_items("CUEX", 1:3)),
  composite("Quality", multi_items("PERQ", 1:7), weights = qualityMode),
  composite("Value", multi_items("PERV", 1:2)),
  composite("Satisfaction", multi_items("CUSA", 1:3)),
  composite("Complaints", single_item("CUSCO")),
  composite("Loyalty", multi_items("CUSL", 1:3)))
m2l <- function(m) lapply(seq_len(nrow(m)), function(i) setNames(as.list(unclass(m)[i, ]), colnames(m))) |> setNames(rownames(m))
dump <- function(model, name) {
  s <- summary(model)
  res <- list(
    pathCoef = m2l(model$path_coef),
    loadings = m2l(model$outer_loadings),
    weights = m2l(model$outer_weights),
    rSquared = m2l(model$rSquared),
    reliability = m2l(s$reliability),
    htmt = m2l(s$validity$htmt),
    fl = m2l(s$validity$fl_criteria),
    fSquare = m2l(s$fSquare),
    totalEffects = m2l(s$total_effects),
    vifItems = lapply(s$validity$vif_items, as.list),
    vifAntecedents = lapply(s$vif_antecedents, as.list),
    iterations = model$iterations)
  jsonlite::write_json(res, file.path(out, paste0(name, ".json")), digits = NA, auto_unbox = TRUE, pretty = TRUE)
}
dump(estimate_pls(mobi, mk(mode_A), sm), "mobi_modeA")
dump(estimate_pls(mobi, mk(mode_B), sm), "mobi_modeB")
# t-distribution reference values
tv <- expand.grid(t = c(0.5, 1.96, 2.5, 4), df = c(4, 30, 499))
tv$p <- 2 * pt(-abs(tv$t), tv$df)
jsonlite::write_json(tv, file.path(out, "tdist.json"), digits = NA, pretty = TRUE)
cat("seminr", as.character(packageVersion("seminr")), "\n")
