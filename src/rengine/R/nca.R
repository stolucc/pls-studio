# Necessary condition analysis (Dul 2016; Dul, van der Laan & Kuik 2020):
# is X necessary (but not sufficient) for Y? Ceiling lines over the scatter
# (CE-FDH, a step function; CR-FDH, a regression through its corner points),
# the effect size d = ceiling zone / scope, an approximate permutation test,
# and the bottleneck table. The NCA package cannot be loaded in the browser's
# R (its dependency RSQLite is not built for WebAssembly), so its computations
# for these ceilings are written out here, as in NCA, and checked against NCA
# in desktop R. Default corner (upper left), empirical scope.

PS_NCA_FUNCTIONS <- c(
  "# CE-FDH corner points (peers): moving right, every point higher than all before it.",
  "nca_peers <- function(x, y) {",
  "  o <- order(x); xs <- x[o]; ys <- y[o]",
  "  px <- xs[1]; py <- ys[1]",
  "  for (i in seq_along(xs)[-1]) if (ys[i] > py[length(py)]) {",
  "    # (NCA: a point at practically the same x as the previous corner replaces it)",
  "    if (abs(xs[i] - px[length(px)]) <= min(abs(xs[i]), abs(px[length(px)])) / 1e6) { px <- px[-length(px)]; py <- py[-length(py)] }",
  "    px <- c(px, xs[i]); py <- c(py, ys[i])",
  "  }",
  "  cbind(X = px, Y = py)",
  "}",
  "# Area above a line y = a + b x inside the scope (upper-left corner), as NCA's p_ceiling.",
  "nca_area_above <- function(a, b, s) {",
  "  if (is.na(b) || b < 0) return(NaN)",
  "  pl <- c(s[1], b * s[1] + a); pr <- c(s[2], b * s[2] + a)",
  "  if (pl[2] > s[4] && pr[2] > s[4]) return(NaN)",
  "  if (pl[2] < s[3] && pr[2] < s[3]) return((s[2] - s[1]) * (s[4] - s[3]))",
  "  if (b == 0) return((s[2] - s[1]) * (s[4] - a))",
  "  if (pl[2] < s[3]) pl <- c((s[3] - a) / b, s[3])",
  "  if (pr[2] > s[4]) pr <- c((s[4] - a) / b, s[4])",
  "  0.5 * (pr[1] - pl[1]) * (pr[2] - pl[2]) + (s[2] - s[1]) * (s[4] - pr[2]) + (pl[1] - s[1]) * (s[4] - s[3]) - (pl[1] - s[1]) * (s[4] - pr[2])",
  "}",
  "# Effect sizes of both ceilings for one X and Y (complete pairs).",
  "nca_one <- function(x, y) {",
  "  s <- c(min(x), max(x), min(y), max(y)); area <- (s[2] - s[1]) * (s[4] - s[3])",
  "  p <- nca_peers(x, y)",
  "  ce <- if (nrow(p) > 1) sum((p[-1, 1] - s[1]) * (p[-1, 2] - p[-nrow(p), 2])) else 0",
  "  if (nrow(p) > 2) { f <- coef(lm(p[, 2] ~ p[, 1])); a <- unname(f[1]); b <- unname(f[2]); cr <- nca_area_above(a, b, s)",
  "    above <- if (is.na(b) || b < 0) NaN else sum(y - (b * x + a) > 1e-7) } else { a <- NA; b <- NA; cr <- 0; above <- 0 }",
  "  list(scope = s, area = area, peers = p, ce = ce / area, cr = cr / area, intercept = a, slope = b, above = above)",
  "}",
  "# Approximate permutation test (Dul et al. 2020), with NCA's samples: sample i drawn after set.seed(i), duplicates replaced.",
  "nca_samples <- function(h, rep) {",
  "  s <- lapply(seq_len(rep), function(i) { set.seed(i); sample(1:h, h, replace = FALSE) })",
  "  if (rep <= 720) { while (length(unique(s)) < rep) { set.seed(length(s)); s[[length(s) + 1]] <- sample(1:h, h, replace = FALSE) }; s <- unique(s) }",
  "  s",
  "}",
  "nca_p <- function(obs, sims, rep) max(1 - mean(sims < obs), 1 / rep)",
  "# Bottleneck table: the X level (percentage of its range) needed for Y levels 0, 10, ..., 100% of its range.",
  "nca_bottleneck <- function(r) {",
  "  s <- r$scope; yl <- s[3] + (0:10) / 10 * (s[4] - s[3])",
  "  pct <- function(v) ifelse(is.na(v), NA, 100 * (v - s[1]) / (s[2] - s[1]))",
  "  ce <- vapply(yl, function(v) { k <- which(r$peers[, 2] >= v)[1]; if (is.na(k)) NA_real_ else r$peers[k, 1] }, 0)",
  "  cr <- if (is.na(r$slope) || r$slope <= 0) rep(NA_real_, 11) else (yl - r$intercept) / r$slope",
  "  data.frame(y = (0:10) * 10, ce_fdh = pct(ce), cr_fdh = pct(cr))",
  "}"
)

# Robustness checks (Dul 2026, ch. 4; SmartPLS 4.1.1.8): potential outliers as
# NCA 5's nca_outliers() finds them with k = 1, i.e. single cases whose removal
# changes the effect size of a ceiling by at least 0.01 %.
PS_NCA_OUTLIER_FUNCTIONS <- c(
  "# Candidate cases (positions in x, y): the corner points (peers) in their order,",
  "# then a case that alone takes the minimum or maximum of X or Y (the scope).",
  "nca_candidates <- function(x, y, r) {",
  "  peers <- unlist(lapply(seq_len(nrow(r$peers)), function(j) {",
  "    which(x == r$peers[j, 1] & y == r$peers[j, 2])",
  "  }))",
  "  edges <- list(x == min(x), x == max(x), y == min(y), y == max(y))",
  "  alone <- unlist(lapply(edges, function(v) if (sum(v) == 1) which(v)))",
  "  unique(c(peers, alone))",
  "}",
  "# Potential outliers of one ceiling ('ce' or 'cr'), ordered as nca_outliers().",
  "nca_outliers_one <- function(x, y, r, ceiling) {",
  "  d0 <- r[[ceiling]]",
  "  rows <- lapply(nca_candidates(x, y, r), function(i) {",
  "    q <- nca_one(x[-i], y[-i])",
  "    d1 <- q[[ceiling]]",
  "    change <- if (is.na(d1)) 0 else d1 - d0",
  "    # (NCA: a change from a zero effect size is 0 % or infinite)",
  "    if (d0 < 1e-10) {",
  "      percent <- if (change < 1e-10) 0 else Inf",
  "    } else {",
  "      percent <- 100 * change / d0",
  "    }",
  "    if (round(abs(percent), 2) < 0.01) return(NULL)",
  "    data.frame(",
  "      at = i,",
  "      d = d1,",
  "      change = change,",
  "      percent = percent,",
  "      ceiling = any(x[i] == r$peers[, 1] & y[i] == r$peers[, 2]),",
  "      scope = !all(c(q$area, q$scope) == c(r$area, r$scope))",
  "    )",
  "  })",
  "  out <- do.call(rbind, rows)",
  "  if (is.null(out)) return(NULL)",
  "  out[order(-abs(out$percent), -abs(out$change)), ]",
  "}",
  "# Effect sizes and p-values of both ceilings with case i removed.",
  "nca_without <- function(x, y, i, rep) {",
  "  q <- nca_one(x[-i], y[-i])",
  "  out <- c(n = length(x) - 1, ce_fdh = q$ce, cr_fdh = q$cr, p_ce_fdh = NA, p_cr_fdh = NA)",
  "  if (rep > 0) {",
  "    sims <- lapply(nca_samples(length(x) - 1, rep), function(sm) {",
  "      s <- nca_one(x[-i], y[-i][sm])",
  "      c(s$ce, s$cr)",
  "    })",
  "    sims <- do.call(rbind, sims)",
  "    out[\"p_ce_fdh\"] <- nca_p(q$ce, sims[, 1][!is.na(sims[, 1])], rep)",
  "    out[\"p_cr_fdh\"] <- nca_p(q$cr, sims[, 2][!is.na(sims[, 2])], rep)",
  "  }",
  "  out",
  "}"
)

ps_nca <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  xs <- unlist(req$x)
  yn <- req$y
  if (!length(xs) || !length(yn) || yn %in% xs) stop("Choose the outcome Y and at least one condition X (different columns).")
  rep <- as.integer(req$permutations %||% 1000)
  if (rep < 0 || rep > 20000) stop("Invalid number of permutations.")
  outliers <- isTRUE(req$outliers)
  fr <- ps_long_frame(req, c(xs, yn))
  v <- fr$v
  X <- unname(v[xs])
  Y <- v[[yn]]
  body <- c(
    PS_NCA_FUNCTIONS,
    if (outliers) PS_NCA_OUTLIER_FUNCTIONS,
    sprintf("conditions <- %s", ps_q(X)),
    "res <- lapply(conditions, function(xn) {",
    sprintf("  ok <- complete.cases(data[, c(xn, \"%s\")]); x <- data[[xn]][ok]; y <- data[[\"%s\"]][ok]", Y, Y),
    "  r <- nca_one(x, y)",
    if (rep > 0) {
      c(
        sprintf("  sims <- lapply(nca_samples(length(y), %d), function(sm) { q <- nca_one(x, y[sm]); c(q$ce, q$cr) })", rep),
        "  sims <- do.call(rbind, sims)",
        sprintf("  r$p <- c(ce_fdh = nca_p(r$ce, sims[, 1][!is.na(sims[, 1])], %d), cr_fdh = nca_p(r$cr, sims[, 2][!is.na(sims[, 2])], %d))", rep, rep)
      )
    },
    "  r$bottleneck <- nca_bottleneck(r); r$n <- length(y); r$x <- x; r$y <- y",
    if (outliers) ps_nca_outlier_lines(rep),
    "  r",
    "})",
    "names(res) <- conditions"
  )
  inputs <- list(data = fr$data)
  report <- c(
    "t(sapply(res, function(r) c(d_ce_fdh = r$ce, d_cr_fdh = r$cr, p = if (is.null(r$p)) NA else r$p)))",
    "lapply(res, `[[`, \"bottleneck\")"
  )
  if (outliers) {
    # (outlier positions `at` count the complete pairs; `rows` maps them to data rows)
    report <- c(report, "lapply(res, `[[`, \"outliers\")", "lapply(res, `[[`, \"without\")")
  }
  if (export) {
    title <- "Necessary condition analysis (as the NCA package)"
    return(ps_script(title, "stats", inputs, body, report))
  }
  env <- ps_run(body, inputs)
  out <- lapply(env$res, function(r) {
    list(
      n = r$n, scope = r$scope, ceFdh = r$ce, crFdh = r$cr, intercept = if (is.na(r$intercept)) NULL else r$intercept, slope = if (is.na(r$slope)) NULL else r$slope,
      accuracy = if (is.nan(r$above)) NULL else 100 * (r$n - r$above) / r$n,
      p = if (is.null(r$p)) NULL else as.list(r$p),
      peers = list(x = unname(r$peers[, 1]), y = unname(r$peers[, 2])),
      points = list(x = utils::head(r$x, 3000), y = utils::head(r$y, 3000)),
      bottleneck = lapply(seq_len(nrow(r$bottleneck)), function(i) list(y = r$bottleneck$y[i], ceFdh = r$bottleneck$ce_fdh[i], crFdh = r$bottleneck$cr_fdh[i])),
      robustness = if (outliers) ps_nca_robustness_json(r)
    )
  })
  names(out) <- ps_back(names(env$res), fr$back, FALSE)
  ps_json(list(
    y = yn, permutations = rep, conditions = lapply(names(out), function(k) c(list(x = k), out[[k]])),
    warnings = env$.warnings, engine = list(package = "R (as NCA)", version = as.character(getRversion()))
  ))
}

#' Script lines (inside the per-condition loop) for the robustness checks: the
#' potential outliers of both ceilings, and the effect sizes and p-values
#' without the most influential outlier of each ceiling.
ps_nca_outlier_lines <- function(rep) {
  c(
    "  # Row numbers of the cases in the data (complete pairs only)",
    "  r$rows <- which(ok)",
    "  r$outliers <- list(ce_fdh = nca_outliers_one(x, y, r, \"ce\"), cr_fdh = nca_outliers_one(x, y, r, \"cr\"))",
    "  top <- unique(unlist(lapply(r$outliers, function(o) if (!is.null(o)) o$at[1])))",
    sprintf("  r$without <- lapply(top, function(i) c(at = i, nca_without(x, y, i, %d)))", rep)
  )
}

#' The robustness results of one condition for the app (positions -> row numbers).
ps_nca_robustness_json <- function(r) {
  table <- function(o) {
    if (is.null(o)) {
      return(list())
    }
    lapply(seq_len(nrow(o)), function(i) {
      list(
        case = r$rows[o$at[i]],
        d = if (is.na(o$d[i])) NULL else o$d[i],
        change = o$change[i],
        percent = if (is.finite(o$percent[i])) o$percent[i] else NULL,
        ceiling = o$ceiling[i],
        scope = o$scope[i]
      )
    })
  }
  num <- function(v) if (is.na(v)) NULL else unname(v)
  without <- lapply(r$without, function(w) {
    list(
      case = r$rows[w[["at"]]],
      n = w[["n"]],
      ceFdh = num(w[["ce_fdh"]]),
      crFdh = num(w[["cr_fdh"]]),
      p = if (is.na(w[["p_ce_fdh"]])) NULL else list(ce_fdh = w[["p_ce_fdh"]], cr_fdh = w[["p_cr_fdh"]])
    )
  })
  list(outliers = list(ceFdh = table(r$outliers$ce_fdh), crFdh = table(r$outliers$cr_fdh)), without = without)
}
