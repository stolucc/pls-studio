# Validation corpus generator.
#
# Each case is a model specified once (constructs + paths), estimated by an
# established R package, and written to src/engine/__fixtures__/validation as
# normalised JSON. src/engine/validation.test.ts runs every case through the
# TypeScript engine and compares.
#
# Run from the repo root:  Rscript scripts/validation/generate.R
# Packages: lavaan, seminr, cSEM, plspm, jsonlite.

suppressMessages({
  library(lavaan)
  library(seminr)
  library(cSEM)
  library(plspm)
  library(jsonlite)
})

root <- "src/engine/__fixtures__/validation"
dir.create(file.path(root, "data"), recursive = TRUE, showWarnings = FALSE)

versions <- list(
  lavaan = as.character(packageVersion("lavaan")),
  seminr = as.character(packageVersion("seminr")),
  cSEM = as.character(packageVersion("cSEM")),
  plspm = as.character(packageVersion("plspm")),
  R = paste(R.version$major, R.version$minor, sep = ".")
)

# ---------- datasets ----------

write_data <- function(df, name) {
  write.csv(df, file.path(root, "data", paste0(name, ".csv")), row.names = FALSE, na = "")
  name
}
data(satisfaction, package = "plspm")
DATA <- list(
  mobi = write_data(seminr::mobi, "mobi"),
  corp_rep = write_data(
    seminr::corp_rep_data[, setdiff(names(seminr::corp_rep_data), c("serviceprovider", "servicetype"))],
    "corp_rep"
  ),
  satisfaction = write_data(satisfaction[, 1:27], "satisfaction"),
  threecf = write_data(as.data.frame(cSEM::threecommonfactors), "threecommonfactors"),
  hs = write_data(lavaan::HolzingerSwineford1939[, paste0("x", 1:9)], "holzinger_swineford"),
  poldem = write_data(lavaan::PoliticalDemocracy, "political_democracy")
)

# ---------- model specification helpers ----------

cons <- function(name, indicators, type = "factor", mode = if (type == "composite") "B" else "A") {
  list(name = name, type = type, mode = mode, indicators = indicators)
}
spec <- function(constructs, paths, moderations = list(), covariances = list()) {
  list(
    constructs = constructs, paths = lapply(paths, function(p) list(from = p[1], to = p[2])),
    moderations = lapply(moderations, function(m) list(from = m[1], moderator = m[2], to = m[3])),
    covariances = lapply(covariances, function(k) list(a = k[1], b = k[2], kind = k[3]))
  )
}
items <- function(prefix, k, sep = "") paste0(prefix, sep, seq_len(k))

lavaan_syntax <- function(s) {
  mm <- vapply(s$constructs, function(c) {
    line <- paste(c$name, "=~", paste(c$indicators, collapse = " + "))
    if (length(c$indicators) == 1) line <- paste0(line, "\n", c$indicators, " ~~ 0*", c$indicators)
    line
  }, "")
  to <- unique(vapply(s$paths, `[[`, "", "to"))
  sm <- vapply(
    to,
    function(t) paste(t, "~", paste(vapply(Filter(function(p) p$to == t, s$paths), `[[`, "", "from"), collapse = " + ")),
    ""
  )
  cv <- vapply(s$covariances, function(k) paste(k$a, "~~", k$b), "")
  paste(c(mm, sm, cv), collapse = "\n")
}

csem_syntax <- function(s) {
  mm <- vapply(
    s$constructs,
    function(c) paste(c$name, if (c$type == "composite") "<~" else "=~", paste(c$indicators, collapse = " + ")),
    ""
  )
  to <- unique(vapply(s$paths, `[[`, "", "to"))
  sm <- vapply(
    to,
    function(t) paste(t, "~", paste(vapply(Filter(function(p) p$to == t, s$paths), `[[`, "", "from"), collapse = " + ")),
    ""
  )
  paste(c(mm, sm), collapse = "\n")
}

seminr_models <- function(s) {
  mm <- lapply(s$constructs, function(c) {
    if (length(c$indicators) == 1) {
      composite(c$name, single_item(c$indicators))
    } else {
      composite(c$name, c$indicators, weights = if (c$mode == "B") mode_B else mode_A)
    }
  })
  # Moderation: two-stage interaction terms plus a path from "iv*moderator".
  for (m in s$moderations) mm[[length(mm) + 1]] <- interaction_term(iv = m$from, moderator = m$moderator, method = two_stage)
  all_paths <- c(
    lapply(s$paths, function(p) c(p$from, p$to)),
    lapply(s$moderations, function(m) c(paste0(m$from, "*", m$moderator), m$to))
  )
  sm <- do.call(relationships, lapply(all_paths, function(p) paths(from = p[1], to = p[2])))
  list(mm = do.call(constructs, mm), sm = sm)
}
# Our engine names interaction constructs "iv × moderator", and "iv²" for a quadratic term.
intxn_name <- function(x) {
  vapply(x, function(v) {
    p <- strsplit(v, "*", fixed = TRUE)[[1]]
    if (length(p) == 2 && p[1] == p[2]) paste0(p[1], "\u00b2") else gsub("*", " \u00d7 ", v, fixed = TRUE)
  }, "", USE.NAMES = FALSE)
}

# ---------- normalisers ----------

mat_long <- function(M, rows_are = c("from", "to")) {
  rows_are <- match.arg(rows_are)
  out <- list()
  for (i in rownames(M)) {
    for (j in colnames(M)) {
      if (!is.na(M[i, j]) && M[i, j] != 0) {
        out[[length(out) + 1]] <- if (rows_are == "from") list(from = i, to = j, est = M[i, j]) else list(from = j, to = i, est = M[i, j])
      }
    }
  }
  out
}
lower_long <- function(M) {
  out <- list()
  n <- rownames(M)
  for (i in seq_along(n)) {
    for (j in seq_len(i - 1)) {
      v <- M[n[i], n[j]]
      if (is.na(v) || v == 0) v <- M[n[j], n[i]]
      out[[length(out) + 1]] <- list(a = n[i], b = n[j], v = v)
    }
  }
  out
}

# CASES="regex" (environment) writes only the matching cases, leaving the others as recorded.
write_case <- function(case) {
  only <- Sys.getenv("CASES")
  if (nzchar(only) && !grepl(only, case$name)) {
    return(invisible())
  }
  case$versions <- versions
  write_json(
    case,
    file.path(root, paste0(case$name, ".json")),
    digits = NA,
    auto_unbox = TRUE,
    pretty = TRUE,
    null = "null",
    na = "null"
  )
  cat(sprintf("%-34s ok\n", case$name))
}

# ---------- PLS via seminr ----------

seminr_case <- function(name, dataset, s, missing_token = NULL) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  mod <- seminr_models(s)
  est <- suppressMessages(estimate_pls(df, mod$mm, mod$sm, missing_value = if (is.null(missing_token)) NA else missing_token))
  # seminr 2.3.x's summary() fails for quadratic terms; such cases then record no reliability.
  sm <- tryCatch(summary(est), error = function(e) NULL)
  ld <- est$outer_loadings
  wt <- est$outer_weights
  per_item <- function(M) {
    out <- list()
    for (c in s$constructs) for (i in c$indicators) out[[length(out) + 1]] <- list(construct = c$name, indicator = i, est = M[i, c$name])
    out
  }
  rel <- if (is.null(sm)) {
    NULL
  } else {
    sm$reliability[vapply(s$constructs, `[[`, "", "name"), , drop = FALSE]
  }
  relc <- function(k) if (is.null(rel)) NULL else as.list(rel[, k])
  pc <- est$path_coef
  rownames(pc) <- intxn_name(rownames(pc))
  colnames(pc) <- intxn_name(colnames(pc))
  r2 <- est$rSquared["Rsq", , drop = FALSE]
  r2 <- setNames(as.numeric(r2), intxn_name(colnames(r2)))
  write_case(list(
    name = name, source = "seminr", kind = "pls", dataset = dataset, missingTokens = missing_token,
    options = list(scheme = "path", consistent = FALSE, missing = "mean"),
    model = s,
    expected = list(
      paths = mat_long(pc, "from"),
      loadings = per_item(ld), weights = per_item(wt),
      r2 = as.list(r2),
      alpha = relc("alpha"), rhoC = relc("rhoC"), ave = relc("AVE"), rhoA = relc("rhoA"),
      htmt = if (length(s$moderations) || is.null(sm)) NULL else lower_long(sm$validity$htmt)
    ),
    tolerance = 1e-5
  ))
}

# ---------- PLS via plspm (independent implementation, all three schemes) ----------

plspm_case <- function(name, dataset, s, scheme) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  nm <- vapply(s$constructs, `[[`, "", "name")
  P <- matrix(0, length(nm), length(nm), dimnames = list(nm, nm))
  for (p in s$paths) P[p$to, p$from] <- 1
  blocks <- lapply(s$constructs, `[[`, "indicators")
  modes <- vapply(s$constructs, `[[`, "", "mode")
  fit <- plspm(df, P, blocks, modes = modes, scheme = scheme, tol = 1e-10, maxiter = 1000)
  om <- fit$outer_model
  item <- function(col) lapply(seq_len(nrow(om)), function(i) list(construct = as.character(om$block[i]), indicator = as.character(om$name[i]), est = om[[col]][i]))
  write_case(list(
    name = name, source = "plspm", kind = "pls", dataset = dataset,
    options = list(scheme = scheme, consistent = FALSE, missing = "mean"),
    model = s,
    expected = list(
      paths = mat_long(fit$path_coefs, "to"),
      loadings = item("loading"),
      r2 = as.list(setNames(fit$inner_summary$R2, rownames(fit$inner_summary))[fit$inner_summary$Type == "Endogenous"])
    ),
    # plspm stops on a relative weight change of 1e-10; agreement to ~1e-6.
    tolerance = 1e-5
  ))
}

# ---------- PLSc / composites via cSEM ----------

csem_case <- function(name, dataset, s, consistent) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  r <- csem(df, csem_syntax(s), .disattenuate = consistent, .tolerance = 1e-12, .iter_max = 1000)
  e <- r$Estimates
  ld <- e$Loading_estimates
  wt <- e$Weight_estimates
  per_item <- function(M) {
    out <- list()
    for (c in s$constructs) for (i in c$indicators) out[[length(out) + 1]] <- list(construct = c$name, indicator = i, est = M[c$name, i])
    out
  }
  factors <- vapply(Filter(function(c) c$type == "factor" && length(c$indicators) > 1, s$constructs), `[[`, "", "name")
  htmt <- if (length(factors) > 1) calculateHTMT(r)$htmts else NULL
  htmt2 <- if (length(factors) > 1) calculateHTMT(r, .type_htmt = "htmt2")$htmts else NULL
  write_case(list(
    name = name, source = "cSEM", kind = "pls", dataset = dataset,
    options = list(scheme = "path", consistent = consistent, missing = "mean"),
    model = s,
    expected = list(
      paths = mat_long(e$Path_estimates, "to"),
      loadings = per_item(ld), weights = per_item(wt),
      r2 = as.list(e$R2),
      # Without disattenuation cSEM stores 1s here (no correction applied), not rho_A.
      rhoA = if (consistent) as.list(e$Reliabilities[factors]) else NULL,
      constructCor = lower_long(e$Construct_VCV),
      htmt = if (is.null(htmt)) NULL else lower_long(htmt[factors, factors]),
      htmt2 = if (is.null(htmt2)) NULL else lower_long(htmt2[factors, factors]),
      fit = list(
        estimated = list(srmr = calculateSRMR(r), dULS = calculateDL(r), dG = calculateDG(r) * log(10)^2),
        saturated = list(
          srmr = calculateSRMR(r, .saturated = TRUE),
          dULS = calculateDL(r, .saturated = TRUE),
          dG = calculateDG(r, .saturated = TRUE) * log(10)^2
        )
      )
    ),
    tolerance = 1e-5
  ))
}

# ---------- IPMA via cSEM ----------
# cSEM's doIPMA() works on the raw indicator scale. The usual 0-100 rescaling
# (Ringle & Sarstedt 2016) is linear per indicator, so the rescaled IPMA is
# cSEM's IPMA on pre-rescaled data.
ipma_case <- function(name, dataset, s, target, rescale = NULL) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  used <- unlist(lapply(s$constructs, `[[`, "indicators"))
  if (!is.null(rescale)) {
    for (v in used) {
      lo <- if (is.null(rescale$min)) min(df[[v]]) else rescale$min
      hi <- if (is.null(rescale$max)) max(df[[v]]) else rescale$max
      df[[v]] <- (df[[v]] - lo) / (hi - lo) * 100
    }
  }
  r <- suppressWarnings(csem(df, csem_syntax(s), .disattenuate = FALSE, .tolerance = 1e-12, .iter_max = 1000))
  ip <- suppressWarnings(doIPMA(r))
  ci <- ip$Construct
  ii <- ip$Indicator
  write_case(list(
    name = name, source = "cSEM", kind = "ipma", dataset = dataset,
    options = list(
      scheme = "path", consistent = FALSE, missing = "mean", target = target,
      rescale = !is.null(rescale), min = rescale$min, max = rescale$max
    ),
    model = s,
    expected = list(
      constructs = lapply(
        setdiff(colnames(ci$Importance), target),
        function(k) list(name = k, importance = ci$Importance[target, k], performance = ci$Performance[[k]])
      ),
      targetPerformance = ci$Performance[[target]],
      indicators = lapply(
        colnames(ii$Importance),
        function(k) list(name = k, importance = ii$Importance[target, k], performance = ii$Performance[[k]])
      )
    ),
    tolerance = 1e-5
  ))
}

# ---------- CB-SEM via lavaan ----------

FIT_NAMES <- c(
  "npar",
  "chisq",
  "df",
  "pvalue",
  "chisq.scaled",
  "df.scaled",
  "pvalue.scaled",
  "chisq.scaling.factor",
  "chisq.shift.parameter",
  "baseline.chisq",
  "baseline.df",
  "baseline.chisq.scaled",
  "cfi",
  "tli",
  "cfi.scaled",
  "tli.scaled",
  "cfi.robust",
  "tli.robust",
  "rmsea",
  "rmsea.ci.lower",
  "rmsea.ci.upper",
  "rmsea.pvalue",
  "rmsea.scaled",
  "rmsea.robust",
  "srmr",
  "logl",
  "aic",
  "bic"
)

lavaan_case <- function(name, dataset, s, estimator = "ML", tol = 1e-5) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  fit <- sem(lavaan_syntax(s), data = df, estimator = estimator)
  if (!lavInspect(fit, "converged")) stop(name, ": lavaan did not converge")
  pe <- parameterEstimates(fit, standardized = TRUE)
  pe <- pe[pe$op %in% c("=~", "~", "~~"), ]
  params <- lapply(seq_len(nrow(pe)), function(i) {
    list(
      lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i],
      se = if (pe$se[i] == 0) NULL else pe$se[i], z = if (is.na(pe$z[i])) NULL else pe$z[i],
      p = if (is.na(pe$pvalue[i])) NULL else pe$pvalue[i], std = pe$std.all[i]
    )
  })
  fm <- fitMeasures(fit)
  fm <- as.list(fm[intersect(FIT_NAMES, names(fm))])
  write_case(list(
    name = name, source = "lavaan", kind = "cb", dataset = dataset,
    options = list(estimator = estimator, missing = "casewise"),
    model = s,
    expected = list(
      params = params,
      fit = lapply(fm, as.numeric),
      r2 = as.list(inspect(fit, "r2")),
      n = lavInspect(fit, "nobs")
    ),
    tolerance = tol
  ))
}

# ================= cases =================

mobi_spec <- function(qualityType = "factor") {
  spec(
    list(
      cons("Image", items("IMAG", 5)),
      cons("Expectation", items("CUEX", 3)),
      cons("Quality", items("PERQ", 7), qualityType),
      cons("Value", items("PERV", 2)),
      cons("Satisfaction", items("CUSA", 3)),
      cons("Complaints", "CUSCO"),
      cons("Loyalty", items("CUSL", 3))
    ),
    list(
      c("Image", "Expectation"),
      c("Image", "Satisfaction"),
      c("Image", "Loyalty"),
      c("Expectation", "Quality"),
      c("Expectation", "Value"),
      c("Expectation", "Satisfaction"),
      c("Quality", "Value"),
      c("Quality", "Satisfaction"),
      c("Value", "Satisfaction"),
      c("Satisfaction", "Complaints"),
      c("Satisfaction", "Loyalty"),
      c("Complaints", "Loyalty")
    )
  )
}

corp_rep_spec <- spec(
  list(
    cons("QUAL", items("qual_", 8), "composite"),
    cons("PERF", items("perf_", 5), "composite"),
    cons("CSOR", items("csor_", 5), "composite"),
    cons("ATTR", items("attr_", 3), "composite"),
    cons("COMP", items("comp_", 3)),
    cons("LIKE", items("like_", 3)),
    cons("CUSA", "cusa"),
    cons("CUSL", items("cusl_", 3))
  ),
  list(
    c("QUAL", "COMP"), c("QUAL", "LIKE"), c("PERF", "COMP"), c("PERF", "LIKE"), c("CSOR", "COMP"), c("CSOR", "LIKE"),
    c("ATTR", "COMP"), c("ATTR", "LIKE"), c("COMP", "CUSA"), c("COMP", "CUSL"), c("LIKE", "CUSA"), c("LIKE", "CUSL"),
    c("CUSA", "CUSL")
  )
)

sat_spec <- function(type = "factor") {
  spec(
    list(
      cons("IMAG", items("imag", 5), type), cons("EXPE", items("expe", 5), type), cons("QUAL", items("qual", 5), type),
      cons("VAL", items("val", 4), type), cons("SAT", items("sat", 4), type), cons("LOY", items("loy", 4), type)
    ),
    list(
      c("IMAG", "EXPE"), c("IMAG", "SAT"), c("IMAG", "LOY"), c("EXPE", "QUAL"), c("EXPE", "VAL"), c("EXPE", "SAT"),
      c("QUAL", "VAL"), c("QUAL", "SAT"), c("VAL", "SAT"), c("SAT", "LOY")
    )
  )
}
# plspm runs every block in Mode A by default; keep modes explicit.
sat_spec_A <- sat_spec("factor")

threecf_spec <- spec(
  list(cons("eta1", items("y1", 3)), cons("eta2", items("y2", 3)), cons("eta3", items("y3", 3))),
  list(c("eta1", "eta2"), c("eta1", "eta3"), c("eta2", "eta3"))
)

hs_spec <- spec(
  list(cons("visual", c("x1", "x2", "x3")), cons("textual", c("x4", "x5", "x6")), cons("speed", c("x7", "x8", "x9"))),
  list()
)

poldem_spec <- spec(
  list(
    cons("ind60", c("x1", "x2", "x3")),
    cons("dem60", c("y1", "y2", "y3", "y4")),
    cons("dem65", c("y5", "y6", "y7", "y8"))
  ),
  list(c("ind60", "dem60"), c("ind60", "dem65"), c("dem60", "dem65"))
)

mobi_cb_small <- spec(
  list(
    cons("Image", items("IMAG", 5)),
    cons("Quality", items("PERQ", 7)),
    cons("Satisfaction", items("CUSA", 3)),
    cons("Value", items("PERV", 2))
  ),
  list(c("Quality", "Value"), c("Image", "Satisfaction"), c("Quality", "Satisfaction"), c("Value", "Satisfaction"))
)

cat("--- PLS (seminr)\n")
seminr_case("pls_seminr_mobi_A", DATA$mobi, mobi_spec("factor"))
seminr_case("pls_seminr_mobi_B", DATA$mobi, mobi_spec("composite"))
seminr_case("pls_seminr_corp_rep", DATA$corp_rep, corp_rep_spec, missing_token = "-99")

seminr_case("pls_seminr_moderation_mobi", DATA$mobi, spec(
  list(
    cons("Image", items("IMAG", 5)),
    cons("Expectation", items("CUEX", 3)),
    cons("Value", items("PERV", 2)),
    cons("Satisfaction", items("CUSA", 3))
  ),
  list(c("Image", "Satisfaction"), c("Expectation", "Satisfaction"), c("Value", "Satisfaction")),
  list(c("Image", "Expectation", "Satisfaction"))
))
# Quadratic effect: Image² on Satisfaction (seminr two-stage, as interaction_term(Image, Image)).
seminr_case("pls_seminr_quadratic_mobi", DATA$mobi, spec(
  list(cons("Image", items("IMAG", 5)), cons("Expectation", items("CUEX", 3)), cons("Satisfaction", items("CUSA", 3))),
  list(c("Image", "Satisfaction"), c("Expectation", "Satisfaction")),
  list(c("Image", "Image", "Satisfaction"))
))
corp_rep_mod <- corp_rep_spec
corp_rep_mod$constructs[[length(corp_rep_mod$constructs) + 1]] <- cons("SC", items("switch_", 4))
corp_rep_mod$paths[[length(corp_rep_mod$paths) + 1]] <- list(from = "SC", to = "CUSL")
corp_rep_mod$moderations <- list(list(from = "CUSA", moderator = "SC", to = "CUSL"))
seminr_case("pls_seminr_moderation_corp_rep", DATA$corp_rep, corp_rep_mod, missing_token = "-99")

cat("--- PLS (plspm)\n")
for (scheme in c("path", "factor", "centroid")) plspm_case(paste0("pls_plspm_satisfaction_", scheme), DATA$satisfaction, sat_spec_A, scheme)

cat("--- PLSc / composites (cSEM)\n")
csem_case("plsc_csem_threecommonfactors", DATA$threecf, threecf_spec, TRUE)
csem_case("plsc_csem_satisfaction", DATA$satisfaction, sat_spec("factor"), TRUE)
mobi_mixed <- mobi_spec("composite")
mobi_mixed$constructs <- mobi_mixed$constructs[-6] # drop single-item Complaints
mobi_mixed$paths <- Filter(function(p) p$from != "Complaints" && p$to != "Complaints", mobi_mixed$paths)
csem_case("plsc_csem_mobi_mixed", DATA$mobi, mobi_mixed, TRUE)
csem_case("composite_csem_satisfaction", DATA$satisfaction, sat_spec("composite"), TRUE)
csem_case("pls_csem_threecommonfactors", DATA$threecf, threecf_spec, FALSE)

# ---------- CB-SEM moderation (latent interaction, product indicators) ----------
# Marsh, Wen & Hau (2004) matched-pair product indicators of mean-centred items,
# estimated by ML. Our engine names products "a×b" and the factor "X × M";
# lavaan needs syntactic names, which are mapped back when writing the case.
cb_moderation_case <- function(name, dataset, s, estimator = "ML", at = c(-1, 0, 0.5, 1), tolerance = 1e-5) {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  used <- unlist(lapply(s$constructs, `[[`, "indicators"))
  df <- df[complete.cases(df[, used]), ]
  ind <- function(n) Filter(function(c) c$name == n, s$constructs)[[1]]$indicators
  mo <- s$moderations[[1]]
  xi <- ind(mo$from)
  mi <- ind(mo$moderator)
  k <- min(length(xi), length(mi))
  prods <- character(0)
  for (i in seq_len(k)) {
    nm <- paste0(xi[i], ".X.", mi[i])
    df[[nm]] <- (df[[xi[i]]] - mean(df[[xi[i]]])) * (df[[mi[i]]] - mean(df[[mi[i]]]))
    prods <- c(prods, nm)
  }
  fac <- "INTXN"
  base <- lavaan_syntax(list(constructs = s$constructs, paths = Filter(function(p) p$to != mo$to, s$paths)))
  preds <- vapply(Filter(function(p) p$to == mo$to, s$paths), `[[`, "", "from")
  lab <- function(p) if (p == mo$from) "bx*" else ""
  syntax <- paste(base,
    paste(fac, "=~", paste(prods, collapse = " + ")),
    paste(mo$to, "~", paste(c(paste0(vapply(preds, lab, ""), preds), paste0("bint*", fac)), collapse = " + ")),
    # Slope of the predictor at moderator value m; for a quadratic term (X²) it is bx + 2·bint·m.
    paste(
      sprintf("ce%d := bx + %sbint*(%s)", seq_along(at), if (mo$from == mo$moderator) "2*" else "", format(at)),
      collapse = "\n"
    ),
    sep = "\n"
  )
  fit <- sem(syntax, data = df, estimator = estimator)
  if (!lavInspect(fit, "converged")) stop(name, ": lavaan did not converge")
  rn <- function(x) {
    x <- gsub(".X.", "\u00d7", x, fixed = TRUE)
    x[x == fac] <- if (mo$from == mo$moderator) paste0(mo$from, "\u00b2") else paste(mo$from, "\u00d7", mo$moderator)
    x
  }
  pe <- parameterEstimates(fit, standardized = TRUE)
  cond <- pe[pe$op == ":=", ]
  pe <- pe[pe$op %in% c("=~", "~", "~~"), ]
  params <- lapply(seq_len(nrow(pe)), function(i) {
    list(
      lhs = rn(pe$lhs[i]), op = pe$op[i], rhs = rn(pe$rhs[i]), est = pe$est[i],
      se = if (pe$se[i] == 0) NULL else pe$se[i], z = if (is.na(pe$z[i])) NULL else pe$z[i],
      p = if (is.na(pe$pvalue[i])) NULL else pe$pvalue[i], std = pe$std.all[i]
    )
  })
  fm <- fitMeasures(fit)
  fm <- as.list(fm[intersect(FIT_NAMES, names(fm))])
  write_case(list(
    name = name, source = "lavaan", kind = "cb", dataset = dataset,
    options = list(estimator = estimator, missing = "casewise"),
    model = s,
    expected = list(
      params = params,
      fit = lapply(fm, as.numeric),
      r2 = setNames(as.list(inspect(fit, "r2")), rn(names(inspect(fit, "r2")))),
      n = lavInspect(fit, "nobs"),
      conditional = lapply(seq_along(at), function(i) list(m = at[i], est = cond$est[i], se = cond$se[i]))
    ),
    tolerance = tolerance
  ))
}

cat("--- CB-SEM moderation (lavaan)\n")
hs_mod <- spec(
  list(cons("visual", c("x1", "x2", "x3")), cons("textual", c("x4", "x5", "x6")), cons("speed", c("x7", "x8", "x9"))),
  list(c("visual", "speed"), c("textual", "speed")), list(c("visual", "textual", "speed"))
)
for (est in c("ML", "MLR")) cb_moderation_case(paste0("cbmod_lavaan_hs_", tolower(est)), DATA$hs, hs_mod, est)
# (A mobi Image x Expectation model was tried and dropped: its global ML optimum
# is improper (negative interaction-factor variance) and lavaan stops in a
# proper local optimum, so it is not a sound reference.)
# Quadratic effect: visual² (squared centred indicators) on speed.
cb_moderation_case("cbquad_lavaan_hs_ml", DATA$hs, spec(
  list(cons("visual", c("x1", "x2", "x3")), cons("textual", c("x4", "x5", "x6")), cons("speed", c("x7", "x8", "x9"))),
  list(c("visual", "speed"), c("textual", "speed")), list(c("visual", "visual", "speed"))
), "ML",
at = c(-1, 0, 1),
# Squared indicators are strongly kurtotic: SEs at the optimum agree to ~3e-5 (estimates to 1e-6).
tolerance = 1e-4
)
cb_moderation_case("cbmod_lavaan_threecf_ml", DATA$threecf, spec(
  list(cons("eta1", items("y1", 3)), cons("eta2", items("y2", 3)), cons("eta3", items("y3", 3))),
  list(c("eta1", "eta3"), c("eta2", "eta3")), list(c("eta1", "eta2", "eta3"))
))

# ---------- Monte Carlo CIs for indirect effects (semTools) ----------
mcci_case <- function(name, dataset, s, indirect, estimator = "ML") {
  df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
  # Label every regression a_<from>_<to> and define each requested indirect effect.
  mm <- vapply(s$constructs, function(c) paste(c$name, "=~", paste(c$indicators, collapse = " + ")), "")
  to <- unique(vapply(s$paths, `[[`, "", "to"))
  sm <- vapply(
    to,
    function(t) paste(t, "~", paste(vapply(Filter(function(p) p$to == t, s$paths), function(p) paste0("a_", p$from, "_", t, "*", p$from), ""), collapse = " + ")),
    ""
  )
  defs <- vapply(indirect, function(d) paste0("ind_", d$from, "_", d$to, " := ", d$expr), "")
  fit <- sem(paste(c(mm, sm, defs), collapse = "\n"), data = df, estimator = estimator)
  set.seed(20261027)
  ci <- semTools::monteCarloCI(fit, nRep = 200000, level = 0.95)
  write_case(list(
    name = name, source = "semTools", kind = "mcci", dataset = dataset,
    options = list(estimator = estimator, missing = "casewise", draws = 200000),
    model = s,
    expected = list(indirect = lapply(seq_along(indirect), function(i) {
      list(
        from = indirect[[i]]$from, to = indirect[[i]]$to,
        est = ci[i, "est"], ciLow = ci[i, "ci.lower"], ciHigh = ci[i, "ci.upper"]
      )
    })),
    tolerance = 0.01
  ))
}

cat("--- Monte Carlo CIs (semTools)\n")
mcci_case(
  "mcci_semtools_poldem", DATA$poldem, poldem_spec,
  list(list(from = "ind60", to = "dem65", expr = "a_ind60_dem60*a_dem60_dem65"))
)
mcci_case(
  "mcci_semtools_mobi_mlr", DATA$mobi, mobi_cb_small,
  list(list(from = "Quality", to = "Satisfaction", expr = "a_Quality_Value*a_Value_Satisfaction")), "MLR"
)

# ---------- Stol, Schaarschmidt & Goldblit (2022), EMSE: matrix input ----------
# Covariance + NACOV matrices from the replication package (Zenodo 6322761,
# CC BY 4.0), N = 155. Models are the paper's lavaan models verbatim; the
# second-order factor and observed covariates (fixed.x) exercise those features.
emse_case <- function(name, which, syntax, s, estimator, indirect = NULL) {
  S <- as.matrix(read.csv(file.path(root, "data", paste0("emse-", which, "-s.csv")), header = TRUE, row.names = 1))
  NAC <- as.matrix(read.csv(file.path(root, "data", paste0("emse-", which, "-nacov.csv")), header = FALSE))
  fit <- sem(
    syntax,
    sample.cov = S,
    sample.nobs = 155,
    NACOV = if (estimator == "ML") NULL else NAC,
    estimator = estimator
  )
  if (!lavInspect(fit, "converged")) stop(name, ": lavaan did not converge")
  pe <- parameterEstimates(fit, standardized = TRUE)
  defs <- pe[pe$op == ":=", ]
  pe <- pe[pe$op %in% c("=~", "~", "~~"), ]
  params <- lapply(seq_len(nrow(pe)), function(i) {
    list(
      lhs = pe$lhs[i], op = pe$op[i], rhs = pe$rhs[i], est = pe$est[i],
      se = if (is.na(pe$se[i]) || pe$se[i] == 0) NULL else pe$se[i], z = if (is.na(pe$z[i])) NULL else pe$z[i],
      p = if (is.na(pe$pvalue[i])) NULL else pe$pvalue[i], std = pe$std.all[i]
    )
  })
  fm <- fitMeasures(fit)
  fm <- as.list(fm[intersect(FIT_NAMES, names(fm))])
  write_case(list(
    name = name, source = "lavaan", kind = "cb", dataset = paste0("emse-", which),
    matrix = list(s = paste0("emse-", which, "-s.csv"), nacov = paste0("emse-", which, "-nacov.csv"), n = 155),
    options = list(estimator = estimator, missing = "casewise"),
    model = s,
    expected = list(
      params = params,
      fit = lapply(fm, as.numeric),
      r2 = as.list(inspect(fit, "r2")),
      n = 155,
      indirectUnstd = if (nrow(defs)) lapply(seq_len(nrow(defs)), function(i) c(indirect[[i]], list(est = defs$est[i]))) else NULL
    ),
    tolerance = 1e-5
  ))
}

emse_sem_syntax <- "
 desire =~ num_want_learn_languages + num_want_learn_skills
 part   =~ num_challenges_solved    + num_meetings_attended + has_chatroom_handle
 id     =~ ID1 + ID2
 hc     =~ HC1 + HC2 + HC3
 js     =~ JS1 + JS2 + JS4
 engag  =~ id  + hc
 part   ~ desire         + age + ismale + tenure_s
 engag  ~ p*part         + age + ismale + tenure_s
 js     ~ j*engag + part + age + ismale + tenure_s
 ind_js := p*j"
cov_ <- function(n) list(name = n, type = "factor", mode = "A", indicators = n, covariate = TRUE)
emse_sem_spec <- list(
  constructs = list(
    cons("desire", c("num_want_learn_languages", "num_want_learn_skills")),
    cons("part", c("num_challenges_solved", "num_meetings_attended", "has_chatroom_handle")),
    cons("id", c("ID1", "ID2")), cons("hc", c("HC1", "HC2", "HC3")), cons("js", c("JS1", "JS2", "JS4")),
    list(name = "engag", type = "factor", mode = "A", indicators = list(), components = c("id", "hc")),
    cov_("age"), cov_("ismale"), cov_("tenure_s")
  ),
  paths = lapply(list(
    c("desire", "part"), c("age", "part"), c("ismale", "part"), c("tenure_s", "part"),
    c("part", "engag"), c("age", "engag"), c("ismale", "engag"), c("tenure_s", "engag"),
    c("engag", "js"), c("part", "js"), c("age", "js"), c("ismale", "js"), c("tenure_s", "js")
  ), function(p) list(from = p[1], to = p[2])),
  moderations = list()
)

emse_cfa_syntax <- "
 desire        =~ num_want_learn_languages + num_want_learn_skills
 expertise     =~ num_knows_languages      + num_has_skills
 participation =~ num_meetings_attended    + has_chatroom_handle + num_challenges_solved
 id            =~ ID1 + ID2
 hc            =~ HC1 + HC2 + HC3
 js            =~ JS1 + JS2 + JS4
 engagement    =~ id  + hc"
emse_cfa_spec <- list(
  constructs = list(
    cons("desire", c("num_want_learn_languages", "num_want_learn_skills")),
    cons("expertise", c("num_knows_languages", "num_has_skills")),
    cons("participation", c("num_meetings_attended", "has_chatroom_handle", "num_challenges_solved")),
    cons("id", c("ID1", "ID2")), cons("hc", c("HC1", "HC2", "HC3")), cons("js", c("JS1", "JS2", "JS4")),
    list(name = "engagement", type = "factor", mode = "A", indicators = list(), components = c("id", "hc"))
  ),
  paths = list(), moderations = list()
)

cat("--- Stol et al. (2022) replication matrices\n")
emse_case("emse_sem_ml", "sem", emse_sem_syntax, emse_sem_spec, "ML", list(list(from = "part", to = "js")))
emse_case("emse_sem_mlm", "sem", emse_sem_syntax, emse_sem_spec, "MLM", list(list(from = "part", to = "js")))
emse_case("emse_cfa_mlm", "cfa", emse_cfa_syntax, emse_cfa_spec, "MLM")
# HTMT on the matrix (semTools), first-order factors only, as in the paper.
local({
  S <- as.matrix(read.csv(file.path(root, "data", "emse-htmt-s.csv"), header = TRUE, row.names = 1))
  # semTools >= 0.5-6 defaults to HTMT2; record both variants explicitly.
  hm <- "
 desire        =~ num_want_learn_languages + num_want_learn_skills
 expertise     =~ num_knows_languages + num_has_skills
 participation =~ num_challenges_solved + num_meetings_attended + has_chatroom_handle
 id            =~ ID1 + ID2
 hc            =~ HC1 + HC2 + HC3
 js            =~ JS1 + JS2 + JS4"
  h <- semTools::htmt(hm, sample.cov = S, htmt2 = FALSE)
  h2 <- semTools::htmt(hm, sample.cov = S, htmt2 = TRUE)
  write_case(list(
    name = "emse_htmt", source = "semTools", kind = "htmt", dataset = "emse-htmt",
    matrix = list(s = "emse-htmt-s.csv", n = 155),
    options = list(), model = list(constructs = emse_cfa_spec$constructs[1:6], paths = list(), moderations = list()),
    expected = list(htmt = lower_long(h), htmt2 = lower_long(h2)), tolerance = 1e-6
  ))
})

# ---------- MIIV-2SLS (Bollen 1996) via MIIVsem ----------
suppressMessages(library(MIIVsem))
versions$MIIVsem <- as.character(packageVersion("MIIVsem"))
miiv_case <- function(name, dataset, s, syntax = lavaan_syntax(s), matrix = NULL) {
  if (is.null(matrix)) {
    df <- read.csv(file.path(root, "data", paste0(dataset, ".csv")))
    fit <- miive(syntax, df)
    n <- nrow(df)
  } else {
    S <- as.matrix(read.csv(file.path(root, "data", matrix$s), header = TRUE, row.names = 1))
    # Means are not in the replication package; they only affect intercepts, not slopes.
    fit <- miive(syntax, sample.cov = S, sample.mean = setNames(rep(0, ncol(S)), colnames(S)), sample.nobs = matrix$n)
    n <- matrix$n
  }
  et <- estimatesTable(fit)
  eqs <- lapply(fit$eqn, function(e) {
    cf <- e$coefficients[!grepl("~1$", names(e$coefficients))]
    list(
      dv = e$DVobs,
      regressors = e$IVobs,
      instruments = e$MIIVs,
      lhs = e$DVlat,
      rhs = e$IVlat,
      coefficients = lapply(names(cf), function(k) list(name = k, est = cf[[k]])),
      sigma2 = as.numeric(e$sigma),
      sargan = if (is.null(e$sargan)) NULL else as.numeric(e$sargan),
      sarganDf = if (is.null(e$sargan.df)) NULL else as.numeric(e$sargan.df),
      sarganP = if (is.null(e$sargan.p)) NULL else as.numeric(e$sargan.p)
    )
  })
  et <- et[et$op %in% c("=~", "~") & et$se > 0, ]
  params <- lapply(
    seq_len(nrow(et)),
    function(i) list(lhs = et$lhs[i], op = et$op[i], rhs = et$rhs[i], est = et$est[i], se = et$se[i], z = et$z[i], p = et$pvalue[i])
  )
  write_case(list(
    name = name, source = "MIIVsem", kind = "miiv", dataset = dataset, matrix = matrix,
    options = list(estimator = "2SLS", missing = "casewise"), model = s,
    expected = list(n = n, equations = eqs, params = params), tolerance = 1e-6
  ))
}

cat("--- MIIV-2SLS (MIIVsem)\n")
miiv_case("miiv_miivsem_hs", DATA$hs, hs_spec)
miiv_case("miiv_miivsem_poldem", DATA$poldem, poldem_spec)
miiv_case("miiv_miivsem_mobi", DATA$mobi, mobi_cb_small)
# The paper's SEM without path labels / defined parameter (MIIVsem needs neither).
emse_sem_plain <- "
 desire =~ num_want_learn_languages + num_want_learn_skills
 part   =~ num_challenges_solved    + num_meetings_attended + has_chatroom_handle
 id     =~ ID1 + ID2
 hc     =~ HC1 + HC2 + HC3
 js     =~ JS1 + JS2 + JS4
 engag  =~ id  + hc
 part   ~ desire + age + ismale + tenure_s
 engag  ~ part   + age + ismale + tenure_s
 js     ~ engag  + part + age + ismale + tenure_s"
miiv_case("miiv_miivsem_emse", "emse-sem", emse_sem_spec, emse_sem_plain,
  matrix = list(s = "emse-sem-s.csv", n = 155)
)

# ---------- covariances: correlated errors and disturbances ----------
# Bollen's (1989) industrialisation and democracy model with its six correlated
# measurement errors, the canonical example (lavaan tutorial).
poldem_bollen <- spec(
  poldem_spec$constructs, list(c("ind60", "dem60"), c("ind60", "dem65"), c("dem60", "dem65")), list(),
  list(
    c("y1", "y5", "indicator"), c("y2", "y4", "indicator"), c("y2", "y6", "indicator"),
    c("y3", "y7", "indicator"), c("y4", "y8", "indicator"), c("y6", "y8", "indicator")
  )
)
# Two endogenous factors with correlated disturbances (no path between them).
poldem_dist <- spec(
  poldem_spec$constructs, list(c("ind60", "dem60"), c("ind60", "dem65")), list(),
  list(c("dem60", "dem65", "construct"), c("y1", "y5", "indicator"))
)
cat("--- covariances (lavaan)\n")
for (est in c("ML", "MLM", "MLR", "GLS")) lavaan_case(paste0("cov_lavaan_bollen_", tolower(est)), DATA$poldem, poldem_bollen, est)
lavaan_case("cov_lavaan_disturbance_ml", DATA$poldem, poldem_dist, "ML")
miiv_case("cov_miivsem_bollen", DATA$poldem, poldem_bollen)

cat("--- IPMA (cSEM)\n")
ipma_case("ipma_csem_satisfaction_raw", DATA$satisfaction, sat_spec("factor"), "LOY")
ipma_case("ipma_csem_satisfaction_rescaled", DATA$satisfaction, sat_spec("factor"), "LOY", rescale = list())
ipma_case("ipma_csem_mobi_bounds", DATA$mobi, spec(
  list(
    cons("Image", items("IMAG", 5)),
    cons("Expectation", items("CUEX", 3)),
    cons("Satisfaction", items("CUSA", 3)),
    cons("Loyalty", items("CUSL", 3))
  ),
  list(
    c("Image", "Expectation"),
    c("Image", "Satisfaction"),
    c("Expectation", "Satisfaction"),
    c("Satisfaction", "Loyalty"),
    c("Image", "Loyalty")
  )
),
"Loyalty",
rescale = list(min = 1, max = 10)
)

cat("--- CB-SEM (lavaan)\n")
for (est in c("ML", "MLM", "MLMV", "MLR", "GLS", "ULS")) {
  lavaan_case(paste0("cb_lavaan_hs_", tolower(est)), DATA$hs, hs_spec, est)
  lavaan_case(paste0("cb_lavaan_poldem_", tolower(est)), DATA$poldem, poldem_spec, est)
  lavaan_case(paste0("cb_lavaan_threecf_", tolower(est)), DATA$threecf, threecf_spec, est)
  lavaan_case(paste0("cb_lavaan_mobi_", tolower(est)), DATA$mobi, mobi_cb_small, est)
}
