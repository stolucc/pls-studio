# Validity checks in base R and psych: common method bias (Harman's single-factor
# test, Podsakoff et al. 2003; full-collinearity VIFs, Kock 2015) and the content
# validity index of an item x expert rating matrix (Lynn 1986; Polit & Beck 2006;
# Polit, Beck & Owen 2007). Each function writes the script it runs (exported as
# is); this file shapes the output.

#' Common method bias.
#' - harman: one unrotated component (psych::principal) or factor (psych::fa, minres) of all
#'   the variables, and the share of the total variance it accounts for; the eigenvalues of
#'   the correlation matrix and how many exceed 1.
#' - vif: full-collinearity VIFs: each variable regressed on all the others, VIF = 1 / (1 - R²),
#'   read from the inverse of the correlation matrix.
#' The variables are data columns, the model's indicators, or the PLS construct scores (the
#' client sends whichever as `data`). Complete cases only.
ps_cmb <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  type <- req$type %||% "harman"
  if (!type %in% c("harman", "vif")) stop("Invalid common method bias test in the request.")
  extraction <- req$extraction %||% "pca"
  if (!extraction %in% c("pca", "fa")) stop("Invalid extraction in the request.")
  vars <- unlist(req$vars)
  need <- if (type == "harman") 3 else 2
  if (length(vars) < need) stop(sprintf("Choose at least %d variables.", need))
  fr <- ps_long_frame(req, vars)
  v <- ps_lookup(fr$v, vars)
  body <- c(
    sprintf("X <- data[complete.cases(data[, %s]), %s, drop = FALSE]", ps_q(v), ps_q(v)),
    "R <- cor(X)"
  )
  body <- c(body, if (type == "harman") {
    c(
      "ev <- eigen(R, symmetric = TRUE, only.values = TRUE)$values  # eigenvalues of the correlation matrix",
      "suppressPackageStartupMessages(library(psych))",
      if (extraction == "pca") {
        "h <- principal(X, nfactors = 1, rotate = \"none\")  # one unrotated principal component (Harman's test as most papers run it)"
      } else {
        "h <- fa(X, nfactors = 1, fm = \"minres\", rotate = \"none\")  # one unrotated common factor (minimum residual)"
      },
      "share <- h$Vaccounted[\"Proportion Var\", 1]  # the share of the total variance the single factor accounts for"
    )
  } else {
    c(
      "# Full-collinearity VIFs (Kock 2015): each variable on all the others; the diagonal of the inverse correlation matrix is 1 / (1 - R²).",
      "vif <- diag(solve(R))",
      "r2 <- 1 - 1 / vif"
    )
  })
  inputs <- list(data = fr$data)
  title <- if (type == "harman") {
    "Harman's single-factor test (psych)"
  } else {
    "Full-collinearity VIFs (Kock 2015)"
  }
  if (export) {
    return(ps_script(
      title, if (type == "harman") "psych" else character(0), inputs, body,
      if (type == "harman") c("ev", "share", "h$loadings") else "data.frame(VIF = vif, R2 = r2)"
    ))
  }
  env <- ps_run(body, inputs)
  n <- nrow(env$X)
  out <- if (type == "harman") {
    ev <- env$ev
    ld <- unname(env$h$loadings[, 1])
    list(
      extraction = extraction, share = unname(env$share), ssLoadings = unname(env$h$Vaccounted["SS loadings", 1]),
      eigenvalues = I(ev), proportions = I(ev / length(ev)), kaiser = sum(ev > 1),
      loadings = lapply(seq_along(vars), function(i) list(variable = vars[i], loading = ld[i]))
    )
  } else {
    list(
      rows = lapply(
        seq_along(vars),
        function(i) list(variable = vars[i], vif = unname(env$vif[i]), r2 = unname(env$r2[i]))
      ),
      maxVif = max(env$vif)
    )
  }
  ps_json(c(list(type = type, vars = I(vars), n = n), out, list(
    warnings = env$.warnings,
    engine = if (type == "harman") ps_engine("psych") else list(package = "stats", version = as.character(getRversion()))
  )))
}

#' Content validity index of an item x expert matrix of relevance ratings (one row per item,
#' one column per expert; `threshold`: a rating at or above it counts as relevant, 3 on the
#' usual 1-4 scale). Per item: the experts who rated it (N), how many found it relevant (A),
#' I-CVI = A / N (Lynn 1986), the probability of chance agreement pc = C(N, A) 0.5^N and the
#' modified kappa k* = (I-CVI - pc) / (1 - pc) (Polit, Beck & Owen 2007). For the scale:
#' S-CVI/Ave (the mean I-CVI) and S-CVI/UA (the share of items every expert found relevant)
#' (Polit & Beck 2006), and the proportion of items each expert found relevant.
ps_cvi <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  experts <- unlist(req$raters)
  if (length(experts) < 2) stop("Choose at least two experts' columns.")
  item <- req$item %||% ""
  if (!is.character(item) || length(item) != 1) stop("Invalid item column in the request.")
  if (nzchar(item) && item %in% experts) stop("The item column cannot be a rater's ratings.")
  threshold <- ps_number(req$threshold %||% 3, "relevance threshold")
  fr <- ps_long_frame(req, c(if (nzchar(item)) item, experts))
  v <- ps_lookup(fr$v, experts)
  body <- c(
    sprintf("X <- data[, %s, drop = FALSE]  # one row per item, one column per expert", ps_q(v)),
    "X <- X[rowSums(!is.na(X)) > 0, , drop = FALSE]  # (items nobody rated are dropped)",
    sprintf(
      "rel <- X >= %s  # relevant: rated %s or higher",
      format(threshold, digits = 15),
      format(threshold, digits = 15)
    ),
    "N <- rowSums(!is.na(rel))  # experts who rated the item",
    "A <- rowSums(rel, na.rm = TRUE)  # experts who found it relevant",
    "icvi <- A / N  # item-level CVI (Lynn 1986)",
    "pc <- choose(N, A) * 0.5^N  # probability of A of N experts agreeing by chance (Polit, Beck & Owen 2007)",
    "kappa <- (icvi - pc) / (1 - pc)  # modified kappa k*",
    "scviAve <- mean(icvi)  # S-CVI/Ave: the mean I-CVI",
    "scviUA <- mean(A == N)  # S-CVI/UA: items every expert found relevant",
    "expertProportion <- colMeans(rel, na.rm = TRUE)  # the share of items each expert found relevant"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      "Content validity index", character(0), inputs, body,
      c("data.frame(N, A, icvi, pc, kappa)", "c(scviAve = scviAve, scviUA = scviUA)", "expertProportion")
    ))
  }
  env <- ps_run(body, inputs)
  if (!nrow(env$X)) stop("No item has a rating.")
  kept <- as.integer(rownames(env$X))
  labels <- if (nzchar(item)) {
    x <- fr$data[[fr$v[[item]]]][kept]
    l <- unlist(req$categories[[item]])
    # The item column's category labels when every value has one, else the values themselves
    has_labels <- !is.null(l) && all(is.na(x) | x %in% seq_along(l))
    named <- if (has_labels) l[x] else format(x, trim = TRUE)
    ifelse(is.na(x), sprintf("Item %d", kept), named)
  } else {
    sprintf("Item %d", kept)
  }
  ps_json(list(
    experts = I(experts), threshold = threshold, nItems = nrow(env$X),
    items = lapply(
      seq_len(nrow(env$X)),
      function(i) list(item = labels[i], n = unname(env$N[i]), agree = unname(env$A[i]), icvi = unname(env$icvi[i]), pc = unname(env$pc[i]), kappa = unname(env$kappa[i]))
    ),
    scviAve = env$scviAve, scviUA = env$scviUA,
    expertProportions = lapply(
      seq_along(experts),
      function(j) list(expert = experts[j], proportion = unname(env$expertProportion[j]), rated = sum(!is.na(env$X[[j]])))
    ),
    warnings = env$.warnings, engine = list(package = "stats", version = as.character(getRversion()))
  ))
}
