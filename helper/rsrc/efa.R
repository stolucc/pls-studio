# Exploratory factor analysis and principal component analysis with psych
# (Revelle): suitability (KMO, Bartlett's test), how many factors (eigenvalues,
# parallel analysis, Velicer's MAP), the solution (psych::fa or
# psych::principal; oblique rotations through GPArotation) with loadings,
# communalities, variance explained, factor correlations and, for factor
# analysis, its fit. method "lavaan": the solution from lavaan's efa() instead: maximum likelihood (WLSMV
# with polychoric correlations) with standard errors of the rotated loadings and factor correlations,
# random starts for the rotation, and the fit of every number of factors up to the one chosen (as Mplus's
# TYPE = EFA 1 4).

PS_EFA_METHODS <- c(
  pca = "Principal components (psych::principal)",
  minres = "Minimum residual (psych::fa)",
  ml = "Maximum likelihood (psych::fa)",
  pa = "Principal axis factoring (psych::fa)",
  lavaan = "Maximum likelihood with standard errors (lavaan::efa)"
)
PS_EFA_ROTATIONS <- c("none", "varimax", "quartimax", "promax", "oblimin", "geominQ", "bigeomin", "biquartimin")
PS_EFA_OBLIQUE <- c("promax", "oblimin", "geominQ", "bigeomin", "biquartimin")
# Rotations lavaan's efa() names differently (GPArotation's oblique geomin is lavaan's geomin); the bifactor
# rotations (Jennrich & Bentler 2011, 2012; Mplus BI-GEOMIN, BI-QUARTIMIN) are lavaan's only.
PS_EFA_LAVAAN_ROT <- c(
  none = "none", varimax = "varimax", quartimax = "quartimax", promax = "promax", oblimin = "oblimin",
  geominQ = "geomin", bigeomin = "bigeomin", biquartimin = "biquartimin"
)
# How the number of factors / components is chosen: given, or by a retention criterion.
PS_EFA_CRITERIA <- c(fixed = "given", parallel = "parallel analysis", kaiser = "eigenvalues > 1", map = "Velicer's MAP")

ps_efa <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  method <- req$method %||% "minres"
  rotation <- req$rotation %||% "oblimin"
  if (!(length(method) == 1 && method %in% names(PS_EFA_METHODS))) {
    stop("Invalid method in the request.")
  }
  if (!(length(rotation) == 1 && rotation %in% PS_EFA_ROTATIONS)) {
    stop("Invalid rotation in the request.")
  }
  vars <- unlist(req$vars)
  if (length(vars) < 3) stop("Choose at least three variables.")
  criterion <- req$criterion %||% "fixed"
  if (!(length(criterion) == 1 && criterion %in% names(PS_EFA_CRITERIA))) {
    stop("Invalid criterion for the number of factors in the request.")
  }
  k <- as.integer(ps_number(req$nfactors %||% 1, "number of factors"))
  if (criterion == "fixed" && (k < 1 || k >= length(vars))) {
    stop("The number of factors must be at least 1 and less than the number of variables.")
  }
  iter <- as.integer(ps_number(req$parallel %||% 100, "number of parallel-analysis samples"))
  if (iter < 0 || iter > 2000) stop("Invalid number of parallel-analysis samples.")
  if (criterion == "parallel" && iter == 0) {
    stop("Parallel analysis needs samples: set the number of parallel-analysis samples above 0, or choose another criterion.")
  }
  seed <- as.integer(ps_number(req$seed %||% 1, "seed"))
  # Correlations: Pearson, or for ordinal (Likert) items those of the continuous responses assumed to underlie
  # them: psych's mixedCor (cor = "mixed"): polychoric between items with at most 8 categories, tetrachoric
  # between binary ones, polyserial with a continuous variable, Pearson between continuous ones.
  correlation <- req$correlation %||% "pearson"
  if (!(length(correlation) == 1 && correlation %in% c("pearson", "polychoric"))) {
    stop("Invalid correlation type in the request.")
  }
  poly <- correlation == "polychoric"
  carg <- if (poly) ", cor = \"mixed\"" else ""
  listwise <- identical(req$deletion, "listwise") # (missing: reserved for the SEM missing-data choices)
  fr <- ps_long_frame(req, vars)
  v <- ps_lookup(fr$v, vars)
  pca <- method == "pca"
  lav <- method == "lavaan"
  if (!lav && rotation %in% c("bigeomin", "biquartimin")) {
    stop("Bifactor rotations need the lavaan extraction (maximum likelihood with standard errors).")
  }
  # lavaan: geomin's epsilon (lavaan's default 0.001; Mplus uses 0.0001 with two factors, 0.001 with three, 0.01 with
  # four or more), the standard errors' information matrix (Mplus's ML default: observed), and the smallest number
  # of factors whose fit is compared.
  eps <- req$epsilon
  if (!is.null(eps) && !(is.numeric(eps) && length(eps) == 1 && eps > 0 && eps <= 1)) {
    stop("Invalid geomin epsilon in the request.")
  }
  observed <- identical(req$information, "observed")
  # WLSMV (polychoric): standard errors as Mplus's (ps_mplus_se_lines), unless wlsmvSe is "lavaan" (lavaan 0.7's
  # observed information in the sandwich).
  if (!is.null(req$wlsmvSe) && !identical(req$wlsmvSe, "lavaan")) {
    stop("Invalid WLSMV standard errors in the request.")
  }
  mplus_se <- poly && lav && is.null(req$wlsmvSe)
  # WLSMV: the test statistic as Mplus's (mimic = "Mplus", gamma.vcov.mplus = FALSE).
  if (!is.null(req$mimic) && !identical(req$mimic, "Mplus")) {
    stop("Invalid test statistic in the request.")
  }
  mimic <- poly && lav && identical(req$mimic, "Mplus")
  from <- as.integer(ps_number(req$from %||% 1, "smallest number of factors"))
  if (from < 1) stop("Invalid smallest number of factors in the request.")
  if (rotation %in% c("bigeomin", "biquartimin") && (from < 2 || (criterion == "fixed" && k < 2))) {
    stop("A bifactor rotation needs at least two factors (a general and a specific one): compare fit from 2.")
  }
  fm <- if (pca) {
    "minres"
  } else if (lav) {
    "ml"
  } else {
    method
  }
  compare <- ps_efa_compare(req$compare, lav, carg)
  schmid <- isTRUE(req$schmid)
  if (schmid && !(method %in% c("minres", "ml", "pa"))) {
    stop("The Schmid-Leiman solution needs a psych factor extraction (minimum residual, maximum likelihood or principal axis).")
  }
  if (schmid && !(rotation %in% c("oblimin", "promax", "geominQ"))) {
    stop("The Schmid-Leiman solution needs an oblique rotation (oblimin, promax or geomin).")
  }
  if (schmid && criterion == "fixed" && k < 3) {
    stop("The Schmid-Leiman solution needs at least three factors.")
  }
  unit <- if (pca) "components" else "factors"
  # k is set in the script: the given number, or what the criterion retains (at least 1, fewer than the variables).
  kline <- switch(criterion,
    fixed = sprintf("k <- %d", k),
    parallel = sprintf("k <- %s  # retained by parallel analysis", if (pca) "parallel$ncomp" else "parallel$nfact"),
    kaiser = "k <- sum(eigenvalues > 1)  # eigenvalues above 1 (Kaiser)",
    map = "k <- which.min(map)  # Velicer's minimum average partial"
  )
  call <- if (pca) {
    sprintf("principal(X, nfactors = k, rotate = \"%s\"%s)", rotation, carg)
  } else if (lav) {
    sprintf(
      "lapply(seq(min(%d, k), k), function(m) efa(X, nfactors = m, rotation = list(\"%s\"%s), %s, output = \"lavaan\"))",
      from,
      PS_EFA_LAVAAN_ROT[[rotation]],
      if (is.null(eps)) "" else sprintf(", geomin_epsilon = %s", ps_num(eps)),
      paste(c(
        if (poly) c("ordered = names(X)[ordinal]", "estimator = \"WLSMV\"") else c("estimator = \"ML\"", "meanstructure = TRUE"),
        sprintf("missing = \"%s\"", if (listwise) "listwise" else if (poly) "pairwise" else "ml"),
        if (observed && !poly) "information = \"observed\"",
        if (mimic) c("mimic = \"Mplus\"", "gamma.vcov.mplus = FALSE"),
        if (mplus_se) "information.bread = \"expected\""
      ), collapse = ", ")
    )
  } else {
    sprintf("fa(X, nfactors = k, fm = \"%s\", rotate = \"%s\"%s)", fm, rotation, carg)
  }
  what <- if (criterion == "fixed") {
    sprintf("%d %s", k, unit)
  } else {
    sprintf("%s by %s", unit, PS_EFA_CRITERIA[[criterion]])
  }
  body <- c(
    if (lav) {
      "suppressPackageStartupMessages({ library(psych); library(GPArotation); library(lavaan) })"
    } else {
      "suppressPackageStartupMessages({ library(psych); library(GPArotation) })"
    },
    "# psych spreads parallel analysis and MAP over cores (mclapply); R in the browser cannot fork.",
    "if (grepl(\"emscripten\", R.version$platform)) options(mc.cores = 1)",
    sprintf("X <- data[, %s]", ps_q(v)),
    if (listwise) {
      "X <- X[complete.cases(X), , drop = FALSE]  # listwise deletion"
    } else if (lav && !poly) {
      "# Missing values: pairwise correlations (psych's default); full-information ML in lavaan"
    } else {
      "# Missing values: pairwise correlations (psych's default)"
    },
    "n <- nrow(X)",
    if (poly) {
      c(
        "# Polychoric (tetrachoric, polyserial) correlations; ordinal: at most 8 categories (psych's rule).",
        "ordinal <- vapply(X, function(x) length(unique(x[!is.na(x)])) <= 8, TRUE)",
        "R <- mixedCor(X)$rho"
      )
    } else {
      "R <- cor(X, use = \"pairwise.complete.obs\")"
    },
    "# Is the matrix suitable for factoring? Kaiser-Meyer-Olkin and Bartlett's test of sphericity.",
    "kmo <- KMO(R)",
    "bartlett <- cortest.bartlett(R, n = n)",
    "# How many factors: eigenvalues, parallel analysis (Horn 1965) and Velicer's MAP.",
    "eigenvalues <- eigen(R, symmetric = TRUE, only.values = TRUE)$values",
    if (iter > 0) {
      c(
        sprintf("set.seed(%d)", seed),
        sprintf(
          "parallel <- fa.parallel(X, fm = \"%s\", fa = \"%s\", n.iter = %d%s, plot = FALSE)",
          fm,
          if (pca) "pc" else "fa",
          iter,
          carg
        )
      )
    },
    sprintf("map <- VSS(X, n = %d, fm = \"%s\"%s, plot = FALSE)$map", min(8L, length(v) - 1L), fm, carg),
    sprintf("# The solution: %s, %s, rotation %s.", PS_EFA_METHODS[[method]], what, rotation),
    kline,
    if (criterion != "fixed") sprintf("k <- max(%dL, min(k, ncol(X) - 1L), na.rm = TRUE)", if (lav && rotation %in% c("bigeomin", "biquartimin")) 2L else 1L),
    if (lav) {
      c(
        sprintf(
          "# lavaan: every number of factors from %d to k, the last one the solution (standardised loadings, delta-method standard errors).",
          from
        ),
        sprintf("fits <- %s", call),
        if (mplus_se) ps_mplus_se_lines("fits"),
        "fit <- fits[[length(fits)]]",
        "std <- standardizedSolution(fit)",
        sprintf(
          "comparison <- t(sapply(fits, fitMeasures, %s))",
          if (poly) "c(\"npar\", \"chisq.scaled\", \"df.scaled\", \"pvalue.scaled\")" else "c(\"npar\", \"logl\", \"chisq\", \"df\", \"pvalue\", \"aic\", \"bic\")"
        )
      )
    } else {
      sprintf("fit <- %s", call)
    },
    compare$lines,
    if (schmid) ps_efa_schmid_lines(fm, rotation),
    if (lav) "summary(fit)" else "print(fit, sort = TRUE)"
  )
  inputs <- list(data = fr$data)
  if (export) {
    return(ps_script(
      sprintf("%s: %s, %s rotation", PS_EFA_METHODS[[method]], what, rotation),
      c("psych", "GPArotation", if (lav) "lavaan"), inputs, body, c(
        "kmo", "bartlett", if (iter > 0) "parallel", if (lav) c("comparison", "std") else "fit",
        if (!is.null(compare)) "congruence", if (schmid) "sl"
      )
    ))
  }
  env <- ps_run(body[-length(body)], inputs)
  if (lav) {
    return(ps_efa_lavaan(env, fr$back, method, rotation, criterion, correlation, poly, iter, pca))
  }
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
    method = method,
    rotation = rotation,
    oblique = rotation %in% PS_EFA_OBLIQUE,
    n = env$n,
    k = env$k,
    criterion = criterion,
    correlation = correlation,
    ordinal = if (poly) I(ps_back(names(env$ordinal)[env$ordinal], back, FALSE)) else NULL,
    variables = ps_back(rownames(L), back, FALSE),
    factors = factors,
    loadings = unname(L),
    structure = if (is.null(S)) NULL else unname(S),
    communality = unname(fit$communality[rownames(L)]),
    uniqueness = unname(fit$uniquenesses[rownames(L)]),
    complexity = unname(fit$complexity[rownames(L)]),
    ssLoadings = row("SS loadings"),
    proportion = row("Proportion Var"),
    cumulative = row("Cumulative Var"),
    phi = if (is.null(fit$Phi)) NULL else unname(fit$Phi),
    # Item x item: the observed correlations, and the residuals the solution leaves (off-diagonal;
    # psych's residual matrix, whose diagonal holds the uniquenesses).
    correlations = unname(env$R[rownames(L), rownames(L)]),
    residuals = local({
      E <- fit$residual[rownames(L), rownames(L)]
      diag(E) <- 0
      unname(E)
    }),
    kmo = list(overall = unname(env$kmo$MSA), items = unname(env$kmo$MSAi[rownames(L)])),
    bartlett = list(chisq = env$bartlett$chisq, df = env$bartlett$df, p = env$bartlett$p.value),
    eigenvalues = env$eigenvalues,
    parallel = if (is.null(par)) {
      NULL
    } else {
      list(
        observed = unname(if (pca) par$pc.values else par$fa.values),
        simulated = unname(if (pca) par$pc.sim else par$fa.sim),
        suggested = if (pca) par$ncomp else par$nfact,
        iterations = iter
      )
    },
    map = list(values = unname(env$map), suggested = which.min(env$map)),
    kaiser = sum(env$eigenvalues > 1),
    congruence = if (is.null(compare)) NULL else ps_efa_congruence(env, compare),
    schmid = if (schmid) ps_efa_schmid(env$sl, rownames(L), back) else NULL,
    fit = if (pca) {
      list(offDiagonal = stat(fit$fit.off))
    } else {
      list(
        chisq = stat(fit$STATISTIC),
        df = stat(fit$dof),
        p = stat(fit$PVAL),
        rmsea = stat(fit$RMSEA),
        rmseaLow = stat(fit$RMSEA[2]),
        rmseaHigh = stat(fit$RMSEA[3]),
        tli = stat(fit$TLI),
        bic = stat(fit$BIC),
        rms = stat(fit$rms)
      )
    },
    warnings = env$.warnings,
    engine = ps_engine("psych")
  ))
}

# The lavaan solution (ps_efa with method "lavaan"): standardised loadings, factor correlations and residual
# variances with their standard errors, the fit of the solution and of each smaller number of factors, and the
# correlations lavaan analysed (Pearson, or polychoric with WLSMV) with the residuals the solution leaves.
ps_efa_lavaan <- function(env, back, method, rotation, criterion, correlation, poly, iter, pca) {
  fit <- env$fit
  std <- env$std
  ov <- lavaan::lavNames(fit, "ov")
  lv <- lavaan::lavNames(fit, "lv")
  pick <- function(op, l, r, col) {
    i <- which(std$op == op & std$lhs == l & std$rhs == r)
    if (length(i)) std[[col]][i[1]] else NA_real_
  }
  grid <- function(col) outer(ov, lv, Vectorize(function(o, f) pick("=~", f, o, col)))
  L <- grid("est.std")
  Lse <- grid("se")
  pair <- function(col) {
    outer(lv, lv, Vectorize(function(a, b) {
      x <- pick("~~", a, b, col)
      if (is.na(x)) pick("~~", b, a, col) else x
    }))
  }
  Phi <- pair("est.std")
  Phise <- pair("se")
  oblique <- rotation %in% PS_EFA_OBLIQUE
  u <- vapply(ov, function(o) pick("~~", o, o, "est.std"), 0)
  use <- vapply(ov, function(o) pick("~~", o, o, "se"), 0)
  ss <- if (oblique) diag(Phi %*% crossprod(L)) else colSums(L^2)
  S <- lavaan::lavInspect(fit, "sampstat")$cov
  Sigma <- lavaan::lavInspect(fit, "implied")$cov
  R <- stats::cov2cor(S[ov, ov])
  E <- R - stats::cov2cor(Sigma[ov, ov])
  diag(E) <- 0
  fm <- function(f, x) {
    v <- suppressWarnings(lavaan::fitMeasures(f, x))
    v <- v[!is.na(v)]
    if (length(v)) unname(v[1]) else NULL
  }
  # Robust (scaled and shifted) statistics with WLSMV, as Mplus prints.
  rob <- function(x) if (poly) c(paste0(x, ".scaled"), x) else x
  fits <- function(f) {
    list(
      npar = fm(f, "npar"),
      chisq = fm(f, rob("chisq")),
      df = fm(f, rob("df")),
      p = fm(f, rob("pvalue")),
      rmsea = fm(f, rob("rmsea")),
      rmseaLow = fm(f, rob("rmsea.ci.lower")),
      rmseaHigh = fm(f, rob("rmsea.ci.upper")),
      cfi = fm(f, rob("cfi")),
      tli = fm(f, rob("tli")),
      srmr = fm(f, "srmr"),
      logl = if (poly) NULL else fm(f, "logl"),
      aic = if (poly) NULL else fm(f, "aic"),
      bic = if (poly) NULL else fm(f, "bic")
    )
  }
  ks <- vapply(env$fits, function(f) length(lavaan::lavNames(f, "lv")), 1L)
  comparison <- lapply(seq_along(env$fits), function(i) c(list(k = ks[i]), fits(env$fits[[i]])))
  par <- env$parallel
  ps_json(list(
    method = method,
    rotation = rotation,
    oblique = oblique,
    n = lavaan::lavInspect(fit, "nobs"),
    k = env$k,
    criterion = criterion,
    correlation = correlation,
    estimator = if (poly) "WLSMV" else "ML",
    ordinal = if (poly) I(ps_back(names(env$ordinal)[env$ordinal], back, FALSE)) else NULL,
    variables = ps_back(ov, back, FALSE),
    factors = lv,
    loadings = unname(L),
    structure = if (oblique && length(lv) > 1) unname(L %*% Phi) else NULL,
    communality = unname(1 - u),
    uniqueness = unname(u),
    complexity = unname(rowSums(L^2)^2 / rowSums(L^4)),
    ssLoadings = unname(ss),
    proportion = unname(ss / length(ov)),
    cumulative = unname(cumsum(ss) / length(ov)),
    phi = if (length(lv) > 1) unname(Phi) else NULL,
    se = list(loadings = unname(Lse), phi = if (length(lv) > 1) unname(Phise) else NULL, uniqueness = unname(use)),
    correlations = unname(R),
    residuals = unname(E),
    kmo = list(overall = unname(env$kmo$MSA), items = unname(env$kmo$MSAi[ov])),
    bartlett = list(chisq = env$bartlett$chisq, df = env$bartlett$df, p = env$bartlett$p.value),
    eigenvalues = eigen(R, symmetric = TRUE, only.values = TRUE)$values,
    parallel = if (is.null(par)) NULL else list(observed = unname(par$fa.values), simulated = unname(par$fa.sim), suggested = par$nfact, iterations = iter),
    map = list(values = unname(env$map), suggested = which.min(env$map)),
    kaiser = sum(env$eigenvalues > 1),
    fit = fits(fit),
    comparison = comparison,
    warnings = env$.warnings,
    engine = ps_engine("lavaan")
  ))
}

# Tucker's congruence coefficients (psych::factor.congruence) between the solution and a second one of the same
# data and number of factors: another extraction and / or rotation. `spec` is the request's
# compare = list(method, rotation); NULL when absent. Returns the script lines and the choice.
ps_efa_compare <- function(spec, lav, carg) {
  if (is.null(spec)) {
    return(NULL)
  }
  if (lav) stop("The congruence comparison needs a psych extraction for the solution, not lavaan.")
  if (!is.list(spec)) stop("Invalid comparison in the request.")
  method <- spec$method
  rotation <- spec$rotation
  psych_methods <- setdiff(names(PS_EFA_METHODS), "lavaan")
  psych_rotations <- setdiff(PS_EFA_ROTATIONS, c("bigeomin", "biquartimin"))
  if (!(is.character(method) && length(method) == 1 && method %in% psych_methods)) {
    stop("Invalid extraction for the comparison in the request.")
  }
  if (!(is.character(rotation) && length(rotation) == 1 && rotation %in% psych_rotations)) {
    stop("Invalid rotation for the comparison in the request.")
  }
  call <- if (method == "pca") {
    sprintf("principal(X, nfactors = k, rotate = \"%s\"%s)", rotation, carg)
  } else {
    sprintf("fa(X, nfactors = k, fm = \"%s\", rotate = \"%s\"%s)", method, rotation, carg)
  }
  lines <- c(
    sprintf(
      "# A second solution to compare with: %s, rotation %s, the same number of factors.",
      PS_EFA_METHODS[[method]], rotation
    ),
    sprintf("fit2 <- %s", call),
    "# Tucker's congruence coefficients: rows the solution's factors, columns the second solution's.",
    "congruence <- factor.congruence(fit, fit2, digits = 15)"
  )
  list(method = method, rotation = rotation, lines = lines)
}

# The comparison's results from the run environment: the congruence matrix and the second solution's loadings.
ps_efa_congruence <- function(env, compare) {
  L2 <- unclass(env$fit2$loadings)
  list(
    method = compare$method,
    rotation = compare$rotation,
    factors = colnames(L2),
    coefficients = unname(env$congruence),
    loadings = unname(L2)
  )
}

# Second-order factor analysis by the Schmid-Leiman transformation (psych::omega, which calls psych::schmid):
# the oblique solution's factor correlations are factored by one general (second-order) factor, and the
# general and group factors are then made orthogonal. omega also gives omega hierarchical and total, and the
# explained common variance. It needs three or more factors (with two the general factor is not identified).
ps_efa_schmid_lines <- function(fm, rotation) {
  c(
    "# Schmid-Leiman: one general factor behind the factors, then general and group factors made orthogonal;",
    "# omega hierarchical / total and the explained common variance (psych::omega; three or more factors).",
    sprintf(
      "sl <- if (k >= 3) omega(R, nfactors = k, fm = \"%s\", rotate = \"%s\", n.obs = n, plot = FALSE) else NULL",
      fm, rotation
    )
  )
}

# The Schmid-Leiman results (NULL when the number of factors retained is below three): the second-order
# loadings, the orthogonalised loadings of the variables (in the solution's variable order), the explained
# common variance, the omegas, the omegas of each group factor, and the items omega reversed (key -1).
ps_efa_schmid <- function(om, variables, back) {
  if (is.null(om)) {
    return(list(available = FALSE))
  }
  S <- om$schmid$sl
  # (omega marks the items it reversed with a trailing "-")
  rownames(S) <- sub("-$", "", rownames(S))
  S <- S[variables, , drop = FALSE]
  groups <- grep("\\*$", colnames(S), value = TRUE)
  og <- om$omega.group
  list(
    available = TRUE,
    firstOrder = colnames(om$schmid$oblique),
    secondOrder = unname(as.numeric(om$schmid$gloading)),
    groups = groups,
    general = unname(S[, "g"]),
    group = unname(S[, groups, drop = FALSE]),
    h2 = unname(S[, "h2"]),
    u2 = unname(S[, "u2"]),
    p2 = unname(S[, "p2"]),
    ecv = unname(om$ECV[1]),
    omegaH = om$omega_h,
    omegaTotal = om$omega.tot,
    omegaLimit = om$omega.lim,
    alpha = om$alpha,
    omegaGroup = lapply(rownames(og), function(nm) {
      list(name = nm, total = og[nm, "total"], general = og[nm, "general"], group = og[nm, "group"])
    }),
    reversed = I(ps_back(names(om$key)[om$key < 0], back, FALSE))
  )
}
