# Exploratory factor analysis and principal component analysis with psych
# (Revelle): suitability (KMO, Bartlett's test), how many factors (eigenvalues,
# parallel analysis, Velicer's MAP), the solution (psych::fa or
# psych::principal; oblique rotations through GPArotation) with loadings,
# communalities, variance explained, factor correlations and, for factor
# analysis, its fit.

PS_EFA_METHODS <- c(pca = "Principal components (psych::principal)", minres = "Minimum residual (psych::fa)",
  ml = "Maximum likelihood (psych::fa)", pa = "Principal axis factoring (psych::fa)")
PS_EFA_ROTATIONS <- c("none", "varimax", "quartimax", "promax", "oblimin", "geominQ")
PS_EFA_OBLIQUE <- c("promax", "oblimin", "geominQ")
# How the number of factors / components is chosen: given, or by a retention criterion.
PS_EFA_CRITERIA <- c(fixed = "given", parallel = "parallel analysis", kaiser = "eigenvalues > 1", map = "Velicer's MAP")

ps_efa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  method <- req$method %||% "minres"
  rotation <- req$rotation %||% "oblimin"
  if (!(length(method) == 1 && method %in% names(PS_EFA_METHODS))) stop("Invalid method in the request.")
  if (!(length(rotation) == 1 && rotation %in% PS_EFA_ROTATIONS)) stop("Invalid rotation in the request.")
  vars <- unlist(req$vars)
  if (length(vars) < 3) stop("Choose at least three variables.")
  criterion <- req$criterion %||% "fixed"
  if (!(length(criterion) == 1 && criterion %in% names(PS_EFA_CRITERIA))) stop("Invalid criterion for the number of factors in the request.")
  k <- as.integer(ps_number(req$nfactors %||% 1, "number of factors"))
  if (criterion == "fixed" && (k < 1 || k >= length(vars))) stop("The number of factors must be at least 1 and less than the number of variables.")
  iter <- as.integer(ps_number(req$parallel %||% 100, "number of parallel-analysis samples"))
  if (iter < 0 || iter > 2000) stop("Invalid number of parallel-analysis samples.")
  if (criterion == "parallel" && iter == 0) stop("Parallel analysis needs samples: set the number of parallel-analysis samples above 0, or choose another criterion.")
  seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
  listwise <- identical(req$deletion, "listwise")  # (missing: reserved for the SEM missing-data choices)
  fr <- ps_long_frame(req, vars)
  v <- ps_lookup(fr$v, vars)
  pca <- method == "pca"
  fm <- if (pca) "minres" else method
  unit <- if (pca) "components" else "factors"
  # k is set in the script: the given number, or what the criterion retains (at least 1, fewer than the variables).
  kline <- switch(criterion,
    fixed = sprintf("k <- %d", k),
    parallel = sprintf("k <- %s  # retained by parallel analysis", if (pca) "parallel$ncomp" else "parallel$nfact"),
    kaiser = "k <- sum(eigenvalues > 1)  # eigenvalues above 1 (Kaiser)",
    map = "k <- which.min(map)  # Velicer's minimum average partial")
  call <- if (pca) sprintf("principal(X, nfactors = k, rotate = \"%s\")", rotation)
    else sprintf("fa(X, nfactors = k, fm = \"%s\", rotate = \"%s\")", fm, rotation)
  what <- if (criterion == "fixed") sprintf("%d %s", k, unit) else sprintf("%s by %s", unit, PS_EFA_CRITERIA[[criterion]])
  body <- c(
    "suppressPackageStartupMessages({ library(psych); library(GPArotation) })",
    "# psych spreads parallel analysis and MAP over cores (mclapply); R in the browser cannot fork.",
    "if (grepl(\"emscripten\", R.version$platform)) options(mc.cores = 1)",
    sprintf("X <- data[, %s]", ps_q(v)),
    if (listwise) "X <- X[complete.cases(X), , drop = FALSE]  # listwise deletion" else "# Missing values: pairwise correlations (psych's default)",
    "n <- nrow(X)",
    "R <- cor(X, use = \"pairwise.complete.obs\")",
    "# Is the matrix suitable for factoring? Kaiser-Meyer-Olkin and Bartlett's test of sphericity.",
    "kmo <- KMO(R)",
    "bartlett <- cortest.bartlett(R, n = n)",
    "# How many factors: eigenvalues, parallel analysis (Horn 1965) and Velicer's MAP.",
    "eigenvalues <- eigen(R, symmetric = TRUE, only.values = TRUE)$values",
    if (iter > 0) c(sprintf("set.seed(%d)", seed),
      sprintf("parallel <- fa.parallel(X, fm = \"%s\", fa = \"%s\", n.iter = %d, plot = FALSE)", fm, if (pca) "pc" else "fa", iter)),
    sprintf("map <- VSS(X, n = %d, fm = \"%s\", plot = FALSE)$map", min(8L, length(v) - 1L), fm),
    sprintf("# The solution: %s, %s, rotation %s.", PS_EFA_METHODS[[method]], what, rotation),
    kline,
    if (criterion != "fixed") "k <- max(1L, min(k, ncol(X) - 1L), na.rm = TRUE)",
    sprintf("fit <- %s", call),
    "print(fit, sort = TRUE)")
  inputs <- list(data = fr$data)
  if (export) return(paste(ps_script(sprintf("%s: %s, %s rotation", PS_EFA_METHODS[[method]], what, rotation),
    c("psych", "GPArotation"), inputs, body, c("kmo", "bartlett", if (iter > 0) "parallel", "fit")), collapse = "\n"))
  env <- ps_run(body[-length(body)], inputs)
  fit <- env$fit
  back <- fr$back
  L <- unclass(fit$loadings)
  factors <- colnames(L)
  S <- if (rotation %in% PS_EFA_OBLIQUE && !is.null(fit$Structure)) unclass(fit$Structure) else NULL
  va <- fit$Vaccounted
  row <- function(nm) if (!is.null(va) && nm %in% rownames(va)) unname(va[nm, ]) else NULL
  stat <- function(x) if (is.null(x) || length(x) == 0 || !is.finite(x[1])) NULL else unname(x[1])
  par <- env$parallel
  ps_json(list(
    method = method, rotation = rotation, oblique = rotation %in% PS_EFA_OBLIQUE, n = env$n, k = env$k, criterion = criterion,
    variables = unname(back[rownames(L)]), factors = factors,
    loadings = unname(L), structure = if (is.null(S)) NULL else unname(S),
    communality = unname(fit$communality[rownames(L)]), uniqueness = unname(fit$uniquenesses[rownames(L)]),
    complexity = unname(fit$complexity[rownames(L)]),
    ssLoadings = row("SS loadings"), proportion = row("Proportion Var"), cumulative = row("Cumulative Var"),
    phi = if (is.null(fit$Phi)) NULL else unname(fit$Phi),
    # Item x item: the observed correlations, and the residuals the solution leaves (off-diagonal;
    # psych's residual matrix, whose diagonal holds the uniquenesses).
    correlations = unname(env$R[rownames(L), rownames(L)]),
    residuals = local({ E <- fit$residual[rownames(L), rownames(L)]; diag(E) <- 0; unname(E) }),
    kmo = list(overall = unname(env$kmo$MSA), items = unname(env$kmo$MSAi[rownames(L)])),
    bartlett = list(chisq = env$bartlett$chisq, df = env$bartlett$df, p = env$bartlett$p.value),
    eigenvalues = env$eigenvalues,
    parallel = if (is.null(par)) NULL else list(
      observed = unname(if (pca) par$pc.values else par$fa.values), simulated = unname(if (pca) par$pc.sim else par$fa.sim),
      suggested = if (pca) par$ncomp else par$nfact, iterations = iter),
    map = list(values = unname(env$map), suggested = which.min(env$map)),
    kaiser = sum(env$eigenvalues > 1),
    fit = if (pca) list(offDiagonal = stat(fit$fit.off)) else list(
      chisq = stat(fit$STATISTIC), df = stat(fit$dof), p = stat(fit$PVAL), rmsea = stat(fit$RMSEA), rmseaLow = stat(fit$RMSEA[2]), rmseaHigh = stat(fit$RMSEA[3]),
      tli = stat(fit$TLI), bic = stat(fit$BIC), rms = stat(fit$rms)),
    warnings = env$.warnings,
    engine = list(package = "psych", version = as.character(utils::packageVersion("psych")))))
}
