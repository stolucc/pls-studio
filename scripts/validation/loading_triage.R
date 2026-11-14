# Reference for the loading triage (Loadings & weights tab): the reliability and AVE of a
# model re-estimated without one reflective indicator, by plain seminr and cSEM calls on
# the model written out by hand without that indicator. Two documented examples:
#   - the ECSI model on seminr's mobi (seminr demo "seminr-pls-ecsi"; the app's
#     "Mobile phone satisfaction" example), Mode A everywhere;
#   - the extended corporate reputation model on seminr's corp_rep_data (Hair et al. 2021,
#     PLS-SEM Using R, chapter 5; the app's "Corporate reputation" example), -99 missing,
#     mean replacement.
# Path weighting, PLS (not PLSc), tolerance 1e-10.
#   R_LIBS=/path/to/lib Rscript scripts/validation/loading_triage.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(seminr)
  library(cSEM)
})

# ---- the two models: constructs (name, items, mode) and paths
mobi_blocks <- list(
  list("Image", paste0("IMAG", 1:5), "A"),
  list("Expectation", paste0("CUEX", 1:3), "A"),
  list("Quality", paste0("PERQ", 1:7), "A"),
  list("Value", paste0("PERV", 1:2), "A"),
  list("Satisfaction", paste0("CUSA", 1:3), "A"),
  list("Complaints", "CUSCO", "A"),
  list("Loyalty", paste0("CUSL", 1:3), "A")
)
mobi_paths <- list(
  c("Image", "Expectation"), c("Image", "Satisfaction"), c("Image", "Loyalty"),
  c("Expectation", "Quality"), c("Expectation", "Value"), c("Expectation", "Satisfaction"),
  c("Quality", "Value"), c("Quality", "Satisfaction"),
  c("Value", "Satisfaction"),
  c("Satisfaction", "Complaints"), c("Satisfaction", "Loyalty"),
  c("Complaints", "Loyalty")
)
corp_blocks <- list(
  list("QUAL", paste0("qual_", 1:8), "B"),
  list("PERF", paste0("perf_", 1:5), "B"),
  list("CSOR", paste0("csor_", 1:5), "B"),
  list("ATTR", paste0("attr_", 1:3), "B"),
  list("COMP", paste0("comp_", 1:3), "A"),
  list("LIKE", paste0("like_", 1:3), "A"),
  list("CUSA", "cusa", "A"),
  list("CUSL", paste0("cusl_", 1:3), "A")
)
corp_paths <- c(
  lapply(c("QUAL", "PERF", "CSOR", "ATTR"), function(f) c(f, "COMP")),
  lapply(c("QUAL", "PERF", "CSOR", "ATTR"), function(f) c(f, "LIKE")),
  list(c("COMP", "CUSA"), c("COMP", "CUSL"), c("LIKE", "CUSA"), c("LIKE", "CUSL")),
  list(c("CUSA", "CUSL"))
)

without <- function(blocks, item) {
  lapply(blocks, function(b) list(b[[1]], setdiff(b[[2]], item), b[[3]]))
}

# ---- seminr: composites weighted by mode A / mode B, single items as single_item()
fit_seminr <- function(data, blocks, paths, na = NULL) {
  mm_list <- lapply(blocks, function(b) {
    if (length(b[[2]]) == 1) {
      composite(b[[1]], single_item(b[[2]]))
    } else if (b[[3]] == "B") {
      composite(b[[1]], b[[2]], weights = mode_B)
    } else {
      composite(b[[1]], b[[2]], weights = mode_A)
    }
  })
  mm <- do.call(constructs, mm_list)
  sm <- do.call(relationships, lapply(paths, function(p) paths(from = p[1], to = p[2])))
  args <- list(
    data = data,
    measurement_model = mm,
    structural_model = sm,
    inner_weights = path_weighting,
    maxIt = 1000,
    stopCriterion = 10
  )
  if (!is.null(na)) args$missing_value <- na
  m <- suppressMessages(do.call(estimate_pls, args))
  rel <- summary(m)$reliability
  lapply(setNames(nm = rownames(rel)), function(k) {
    list(alpha = rel[k, "alpha"], rhoC = rel[k, "rhoC"], rhoA = rel[k, "rhoA"], ave = rel[k, "AVE"])
  })
}

# ---- cSEM: Mode A blocks as common factors (=~), Mode B as composites (<~); no disattenuation
fit_csem <- function(data, blocks, paths) {
  lines <- vapply(blocks, function(b) {
    op <- if (b[[3]] == "B") "<~" else "=~"
    paste(b[[1]], op, paste(b[[2]], collapse = " + "))
  }, "")
  targets <- unique(vapply(paths, `[`, "", 2))
  inner <- vapply(targets, function(t) {
    from <- vapply(Filter(function(p) p[2] == t, paths), `[`, "", 1)
    paste(t, "~", paste(from, collapse = " + "))
  }, "")
  model <- paste(c(lines, inner), collapse = "\n")
  used <- unlist(lapply(blocks, `[[`, 2))
  fit <- csem(
    data[, used],
    model,
    .disattenuate = FALSE,
    .PLS_weight_scheme_inner = "path",
    .tolerance = 1e-10,
    .iter_max = 1000
  )
  a <- assess(fit, .quality_criterion = c("reliability", "ave"))
  names_k <- vapply(blocks, `[[`, "", 1)
  lapply(setNames(nm = names_k), function(k) {
    list(rhoC = unname(a$Reliability$Joereskogs_rho[k]), ave = unname(a$AVE[k]))
  })
}

mean_replace <- function(d) {
  for (v in names(d)) {
    x <- d[[v]]
    x[x == -99] <- NA
    x[is.na(x)] <- mean(x, na.rm = TRUE)
    d[[v]] <- x
  }
  d
}

cases <- list(
  list(
    id = "mobi",
    data = seminr::mobi,
    na = NULL,
    blocks = mobi_blocks,
    paths = mobi_paths,
    remove = c("IMAG2", "IMAG3", "CUEX3", "CUSL2", "PERQ2")
  ),
  list(
    id = "corprep",
    data = seminr::corp_rep_data,
    na = -99,
    blocks = corp_blocks,
    paths = corp_paths,
    remove = c("comp_2", "like_3", "cusl_3")
  )
)

out <- list(
  seminr = as.character(packageVersion("seminr")),
  cSEM = as.character(packageVersion("cSEM"))
)
for (cs in cases) {
  csem_data <- if (is.null(cs$na)) cs$data else mean_replace(cs$data)
  runs <- c(list(list(removed = "")), lapply(cs$remove, function(r) list(removed = r)))
  out[[cs$id]] <- lapply(runs, function(run) {
    blocks <- if (run$removed == "") cs$blocks else without(cs$blocks, run$removed)
    list(
      removed = run$removed,
      seminr = fit_seminr(cs$data, blocks, cs$paths, cs$na),
      cSEM = fit_csem(csem_data, blocks, cs$paths)
    )
  })
}
dir.create("src/measurement/__fixtures__", showWarnings = FALSE, recursive = TRUE)
writeLines(
  toJSON(out, digits = NA, auto_unbox = TRUE, pretty = TRUE),
  "src/measurement/__fixtures__/loading_triage.json"
)
