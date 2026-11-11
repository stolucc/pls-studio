# Shared helpers for PLS Studio's R bridges. Each bridge turns a JSON request
# into an R script (data preparation + model syntax + the package call), runs
# exactly that script, and reads the results back. ps_export() returns the same
# script with the data embedded, so users can reproduce every calculation.

`%||%` <- function(a, b) if (is.null(a)) b else a

ps_parse <- function(req_json) ps_validate(jsonlite::fromJSON(req_json, simplifyVector = TRUE, simplifyDataFrame = FALSE, simplifyMatrix = TRUE))

#' Fields that are written into R code as they are must be one of their known
#' values: requests can come from imported or shared project files.
ps_validate <- function(req) {
  # [[ ]] matches names exactly ($ would match req$estimators for req$estimator).
  one_of <- function(x, allowed, what) {
    if (!is.null(x) && !(length(x) == 1 && is.character(x) && x %in% allowed)) {
      stop(sprintf("Invalid %s in the request.", what))
    }
  }
  get <- function(x, ...) {
    for (k in c(...)) {
      if (!is.list(x)) {
        return(NULL)
      }
      x <- x[[k, exact = TRUE]]
    }
    x
  }
  cb_est <- c("ML", "MLM", "MLMV", "MLR", "GLS", "ULS", "WLS", "WLSMV", "2SLS", "RML")
  one_of(get(req, "estimator"), cb_est, "estimator")
  one_of(
    get(req, "missing"),
    c("mean", "casewise", "fiml", "mi", "pairwise", "twostage", "robusttwostage"),
    "missing-value treatment"
  )
  one_of(get(req, "probe"), c("percentiles", "meansd"), "probing method")
  one_of(get(req, "interaction"), c("product", "lms", "qml"), "latent interaction method")
  one_of(get(req, "hc"), c("none", "HC0", "HC1", "HC2", "HC3", "HC4"), "standard error type")
  one_of(get(req, "options", "scheme"), c("path", "centroid", "factor"), "weighting scheme")
  one_of(get(req, "options", "missing"), c("mean", "casewise", "fiml", "mi"), "missing-value treatment")
  for (e in get(req, "estimators")) {
    one_of(get(e, "method"), c("pls", "cb"), "estimator")
    one_of(get(e, "estimator"), cb_est, "estimator")
  }
  for (c in c(get(req, "model", "constructs"), get(req, "spec", "constructs"))) {
    one_of(get(c, "mode"), c("A", "B", "unit"), "construct mode")
    one_of(get(c, "type"), c("factor", "composite"), "construct type")
  }
  req
}

# ---- Nothing is swallowed: warnings and notes of the current call ----
# Every bridge call runs through ps_call(), which collects the warnings raised
# outside ps_run() (post-processing of a fit) and the failures of optional
# computations (ps_try); ps_json() adds them to the result's `warnings`, which
# the app shows in Messages and flags after a calculation. Notes (`notes`) are
# the app's own explanations of a result (a blank cell, a convention) and the
# packages' advisories: Messages lists them as information, nothing is flagged.
.ps_state <- new.env()
.ps_state$warnings <- character(0)
.ps_state$notes <- character(0)

#' One line for Messages: multi-line package messages joined, control characters removed.
ps_flat <- function(x) gsub("[[:cntrl:]]+", " ", gsub("\\s+", " ", trimws(x)))

ps_warning <- function(x) .ps_state$warnings <- unique(c(.ps_state$warnings, ps_flat(x)))
ps_note <- function(x) .ps_state$notes <- unique(c(.ps_state$notes, ps_flat(x)))

#' A package's advice rather than a problem with the estimates (lavaan's note on the scale of the variables).
ps_advisory <- function(m) grepl("observed variances are \\(at least\\) a factor", m)

#' Notes that say nothing about the results.
ps_irrelevant <- function(m) grepl("^package .* was built under R version", m)

#' Code that set options(warn = 2) (e.g. SEMsens's sa.aco, which drops every evaluation whose fit warns) gets its
#' warnings as errors where they are raised, as in plain R: the bridge's handlers then let a warning through to R's
#' own conversion instead of keeping and muffling it. (In webR the bridge is evaluated without webR's condition
#' capture, runtime.ts callJson, since that muffles warnings before R could convert them.)
ps_warn_is_error <- function() isTRUE(getOption("warn", 0) >= 2)

#' An optional computation (a statistic that is reported when available): if it
#' fails, `otherwise` is used and the failure is reported, with what was lost;
#' its warnings are reported too.
ps_try <- function(expr, what, otherwise = NULL) {
  withCallingHandlers(
    tryCatch(expr, error = function(e) {
      ps_warning(sprintf("%s could not be computed: %s", what, conditionMessage(e)))
      otherwise
    }),
    warning = function(w) {
      if (ps_warn_is_error()) {
        return(invisible(NULL))
      }
      m <- conditionMessage(w)
      if (!ps_irrelevant(m)) ps_warning(sprintf("%s: %s", what, m))
      invokeRestart("muffleWarning")
    }
  )
}

#' The entry point of every bridge call (browser and desktop helper): runs the
#' ps_* function with the request; warnings raised anywhere in it are kept.
#' Errors propagate (the app reports them).
ps_call <- function(fn, req, export = FALSE) {
  if (!(is.character(fn) && length(fn) == 1 && grepl("^ps_[a-z0-9_]+$", fn))) {
    stop("Invalid bridge function.")
  }
  f <- get(fn, envir = globalenv(), mode = "function")
  if (!identical(names(formals(f))[1], "req_json")) stop("Invalid bridge function.")
  .ps_state$warnings <- character(0)
  .ps_state$notes <- character(0)
  # (an analysis that sets options(warn = 2) and leaves it set must not turn the next call's warnings into errors)
  old_warn <- options(warn = getOption("warn"))
  on.exit(options(old_warn), add = TRUE)
  withCallingHandlers(if (isTRUE(export)) f(req, export = TRUE) else f(req),
    warning = function(w) {
      if (ps_warn_is_error()) {
        return(invisible(NULL))
      }
      m <- conditionMessage(w)
      if (ps_irrelevant(m)) NULL else if (ps_advisory(m)) ps_note(m) else ps_warning(m)
      invokeRestart("muffleWarning")
    }
  )
}

ps_json <- function(x) {
  if (is.list(x) && !is.data.frame(x) && (length(.ps_state$warnings) || length(.ps_state$notes) || !is.null(x$warnings))) {
    x$warnings <- I(unique(c(as.character(unlist(x$warnings)), .ps_state$warnings)))
    x$notes <- I(unique(c(as.character(unlist(x$notes)), .ps_state$notes)))
    .ps_state$warnings <- character(0)
    .ps_state$notes <- character(0)
  }
  jsonlite::toJSON(x, auto_unbox = TRUE, digits = NA, na = "null", null = "null", matrix = "rowmajor")
}

#' A syntactic name with underscores only: "Service quality" -> Service_quality.
#' (Dots are avoided because cSEM reads "A.B" as an interaction term.)
ps_ident <- function(x) {
  ascii <- suppressWarnings(iconv(x, "UTF-8", "ASCII//TRANSLIT"))
  # Some iconv builds transliterate accents as separate marks ("o for ö): drop those.
  ascii <- gsub("[\"'`^~]", "", ascii)
  y <- gsub("[^A-Za-z0-9_]+", "_", ifelse(is.na(ascii), x, ascii))
  y <- gsub("^_+|_+$", "", y)
  y[y == "" | grepl("^[0-9_]", y)] <- paste0("v_", y[y == "" | grepl("^[0-9_]", y)])
  make.unique(y, sep = "_")
}

#' Model names back to the user's names inside labels, in one pass: whole names
#' only, longest first, so "x" never touches "x2" or "max" and a name put back is
#' never renamed again. prefix = TRUE maps only a leading name (cobalt labels a
#' factor's level "educ_high").
ps_back_names <- function(x, back, prefix = FALSE) {
  if (!length(back) || !length(x)) {
    return(x)
  }
  if (anyNA(x)) {
    ok <- !is.na(x)
    x[ok] <- ps_back_names(x[ok], back, prefix)
    return(x)
  }
  keys <- names(back)[order(-nchar(names(back)))]
  alt <- paste(gsub("([.\\\\|()\\[\\]{}^$*+?])", "\\\\\\1", keys, perl = TRUE), collapse = "|")
  re <- if (prefix) {
    sprintf("^(?:%s)", alt)
  } else {
    sprintf("(?<![A-Za-z0-9._])(?:%s)(?![A-Za-z0-9._])", alt)
  }
  m <- gregexpr(re, x, perl = TRUE)
  # Each matched name replaced by the user's name
  to_user_names <- function(s) vapply(s, function(k) as.character(back[[k]]), "", USE.NAMES = FALSE)
  regmatches(x, m) <- lapply(regmatches(x, m), to_user_names)
  x
}

#' Model names back to the user's names, exact names (vectorised): a name with
#' no match is kept as it is (keep = TRUE) or becomes NA (keep = FALSE, as back[x]).
ps_back <- function(x, back, keep = TRUE) {
  y <- if (length(back)) unname(back[x]) else rep(NA_character_, length(x))
  if (keep) {
    miss <- is.na(y)
    y[miss] <- x[miss]
  }
  y
}

#' A JSON array of string arrays as a list of character vectors: equally long arrays arrive as a matrix
#' (one per row), others as a list.
ps_string_rows <- function(x) {
  if (is.matrix(x)) {
    lapply(seq_len(nrow(x)), function(i) as.character(x[i, ]))
  } else {
    lapply(x, function(t) as.character(unlist(t)))
  }
}

#' A term "a:b" back to the user's names, "A × B" (a piece with no match is kept).
ps_back_term <- function(t, back) paste(ps_back(strsplit(t, ":", fixed = TRUE)[[1]], back), collapse = " \u00d7 ")

#' The model's construct and indicator names back to the app's (constructs: which constructs to map).
ps_back_map <- function(b, constructs = b$n$cname) {
  construct_names <- setNames(constructs, unname(b$lname[constructs]))
  indicator_names <- setNames(b$n$all_inds, unname(b$n$iv[b$n$all_inds]))
  c(construct_names, indicator_names)
}

#' Display name of an interaction term; a construct times itself is its quadratic term (X²).
ps_int_name <- function(from, moderator) ifelse(from == moderator, paste0(from, "\u00b2"), paste(from, "\u00d7", moderator))

#' Model names for indicators and constructs; construct names are kept
#' distinct from every indicator name.
ps_names <- function(cons) {
  cname <- vapply(cons, `[[`, "", "name")
  inds <- lapply(cons, function(c) as.character(unlist(c$indicators)))
  all_inds <- unique(unlist(inds))
  iv <- setNames(ps_ident(all_inds), all_inds)
  cv <- ps_ident(cname)
  for (j in seq_along(cv)) while (cv[j] %in% iv || cv[j] %in% cv[-j]) cv[j] <- paste0(cv[j], "_lv")
  list(cname = cname, inds = inds, all_inds = all_inds, iv = iv, cv = setNames(cv, cname))
}

#' Column i of the request's data as numbers (jsonlite turns equal-length columns into a variables x rows matrix).
ps_col <- function(cols, i) as.numeric(if (is.matrix(cols)) cols[i, ] else cols[[i]])

#' Raw data for the model's indicators, as a data.frame with syntactic names.
ps_frame <- function(req, n) {
  cols <- req$data$cols
  at <- match(n$all_inds, req$data$names)
  if (anyNA(at)) {
    stop("Indicator(s) not in the dataset: ", paste(n$all_inds[is.na(at)], collapse = ", "))
  }
  df <- as.data.frame(lapply(at, function(i) ps_col(cols, i)))
  names(df) <- unname(n$iv[n$all_inds])
  df
}

#' Script lines for missing values (applied to the model's indicators).
ps_missing_code <- function(missing) {
  if (identical(missing, "fiml")) {
    c("# Missing values: full-information maximum likelihood (lavaan missing = \"ml\"); no rows dropped")
  } else if (!is.null(PS_LAVAAN_MISSING[[missing %||% ""]])) {
    sprintf("# Missing values: lavaan missing = \"%s\"; no rows dropped", PS_LAVAAN_MISSING[[missing]])
  } else if (identical(missing, "mi")) {
    c("# Missing values: multiple imputation (mice), below; no rows dropped")
  } else if (identical(missing, "mean")) {
    c(
      "# Missing values: replaced by the indicator mean",
      "for (v in names(data)) data[[v]][is.na(data[[v]])] <- mean(data[[v]], na.rm = TRUE)"
    )
  } else {
    c("# Missing values: casewise (listwise) deletion", "data <- data[complete.cases(data), , drop = FALSE]")
  }
}

#' lavaan's missing-data options for the app's choices (CB-SEM): FIML, pairwise
#' deletion, and the two-stage approach (Savalei & Bentler 2009), plain or robust.
PS_LAVAAN_MISSING <- list(
  fiml = "ml",
  pairwise = "pairwise",
  twostage = "two.stage",
  robusttwostage = "robust.two.stage"
)
#' The lavaan argument for the choice ("" for deletion or mean replacement done beforehand).
ps_lavaan_missing <- function(missing) {
  m <- PS_LAVAAN_MISSING[[missing %||% ""]]
  if (is.null(m)) "" else sprintf(", missing = \"%s\"", m)
}

#' A single finite number as R code; anything else is refused (values come from project files).
ps_num <- function(x) {
  if (!(is.numeric(x) && length(x) == 1 && is.finite(x))) {
    stop("Invalid fixed value in the request.")
  }
  format(x, digits = 15)
}

#' A parameter label or defined-parameter name as R code; anything else is refused.
ps_label <- function(x) {
  if (!(is.character(x) && length(x) == 1 && grepl("^[A-Za-z][A-Za-z0-9_]{0,30}$", x))) {
    stop("Invalid parameter label in the request.")
  }
  x
}

#' Arithmetic over labels (as printed by the app's parser): letters, digits, _ . + - * / ^ ( ) and spaces,
#' and no name or number directly followed by "(" (no function calls).
ps_expr <- function(x) {
  ok <- is.character(x) && length(x) == 1 && nchar(x) <= 2000 &&
    grepl("^[A-Za-z0-9_ .+*/^()-]+$", x) && # only the allowed characters
    !grepl("[A-Za-z0-9_.][[:space:]]*\\(", x) # no function calls
  if (!ok) stop("Invalid expression in the request.")
  x
}

#' Quote a character vector as R code (backslashes, quotes and control characters escaped).
ps_q <- function(x) paste0("c(", paste(encodeString(as.character(x), quote = '"'), collapse = ", "), ")")

#' Syntactic names of the requested variables (`map`: request name -> R name);
#' a name that is not in the map is an error (it would otherwise become NA in the code).
ps_lookup <- function(map, x, what = "variable") {
  x <- unlist(x)
  if (!length(x)) {
    return(character(0))
  }
  if (!is.character(x) || anyNA(match(x, names(map)))) {
    stop(sprintf("Unknown %s in the request.", what))
  }
  unname(map[x])
}

#' A number from the request that is written into R code (format(), %s): one
#' finite number, or an error (a string would otherwise become code).
ps_number <- function(x, what = "number") {
  if (!is.numeric(x) || length(x) != 1 || !is.finite(x)) {
    stop(sprintf("Invalid %s in the request.", what))
  }
  x
}

#' Text for a "# ..." comment line: no line breaks or other control characters.
ps_comment <- function(x) gsub("[[:cntrl:]]+", " ", x)

#' Text for inside a '...' R string literal.
ps_sq <- function(x) gsub("'", "\\\\'", gsub("\\\\", "\\\\\\\\", x))

#' Run script lines in an environment holding the inputs; collect warnings.
ps_run <- function(lines, inputs) {
  env <- list2env(inputs, envir = new.env(parent = globalenv()))
  warn <- character(0)
  withCallingHandlers(eval(parse(text = paste(lines, collapse = "\n")), envir = env),
    # Multi-line messages ("lavaan WARNING:\n  could not ...") become one line.
    warning = function(w) {
      if (ps_warn_is_error()) {
        return(invisible(NULL))
      }
      m <- ps_flat(conditionMessage(w))
      # R's note that a package was built under a newer R (desktop R) says nothing about the results.
      if (ps_irrelevant(m)) NULL else if (ps_advisory(m)) ps_note(m) else warn <<- c(warn, m)
      invokeRestart("muffleWarning")
    }
  )
  env$.warnings <- unique(warn)
  env
}

#' Embed an object in a script as R code that recreates it.
ps_embed_frame <- function(name, df) {
  tc <- textConnection("csv", "w", local = TRUE)
  utils::write.csv(df, tc, row.names = FALSE)
  close(tc)
  c(sprintf("%s <- read.csv(text = '", name), ps_sq(csv), "')")
}
ps_embed_matrix <- function(name, m) {
  tc <- textConnection("csv", "w", local = TRUE)
  utils::write.csv(m, tc)
  close(tc)
  c(sprintf("%s <- as.matrix(read.csv(text = '", name), ps_sq(csv), "', row.names = 1, check.names = FALSE))")
}

#' The full, self-contained script (one text): header, embedded inputs, the script that ran, a report.
ps_script <- function(title, packages, inputs, body, report) {
  emb <- unlist(lapply(names(inputs), function(nm) {
    v <- inputs[[nm]]
    if (is.data.frame(v)) {
      ps_embed_frame(nm, v)
    } else if (is.matrix(v)) {
      if (is.null(rownames(v))) dimnames(v) <- list(seq_len(nrow(v)), seq_len(ncol(v)))
      ps_embed_matrix(nm, v)
    }
    # A stacked model: one matrix per group, then the named list lavaan takes.
    else if (is.list(v) && length(v) && all(vapply(v, is.matrix, TRUE))) {
      c(
        unlist(lapply(seq_along(v), function(i) ps_embed_matrix(sprintf("%s_%d", nm, i), v[[i]]))),
        sprintf(
          "%s <- list(%s)",
          nm,
          paste(sprintf("%s = %s_%d", encodeString(names(v), quote = '"'), nm, seq_along(v)), collapse = ", ")
        )
      )
    } else {
      sprintf("%s <- %s", nm, paste(deparse(v, width.cutoff = 500), collapse = ""))
    }
  }))
  vers <- vapply(packages, function(p) sprintf("%s %s", p, as.character(utils::packageVersion(p))), "")
  paste(c(
    sprintf("# %s", ps_comment(title)),
    if (length(packages)) {
      sprintf(
        "# Generated by PLS Studio on %s with %s (%s).",
        format(Sys.Date()),
        paste(vers, collapse = ", "),
        R.version.string
      )
    } else {
      sprintf(
        "# Generated by PLS Studio on %s with %s; base R only, no packages needed.",
        format(Sys.Date()),
        R.version.string
      )
    },
    "# Running this script reproduces the calculation exactly.",
    "",
    if (length(packages)) c(sprintf("# install.packages(%s)", ps_q(packages)), ""),
    "# ---- Data used (model variables only) ----",
    emb, "",
    "# ---- Calculation (as run by PLS Studio) ----",
    body, "",
    "# ---- Report ----",
    report
  ), collapse = "\n")
}

#' The result's `engine`: the package that computed it and its version, and the versions of further packages it
#' ran on (lavaan = "lavaan").
ps_engine <- function(package, ...) {
  c(
    list(package = package, version = as.character(utils::packageVersion(package))),
    lapply(list(...), function(p) as.character(utils::packageVersion(p)))
  )
}

#' A matrix as rows of numbers (JSON; NA as null).
ps_rows <- function(m) lapply(seq_len(nrow(m)), function(i) I(unname(as.numeric(m[i, ]))))

#' R in the browser (webR), where packages without a WebAssembly build (OpenMx, Stan) are missing.
ps_in_browser <- function() grepl("emscripten", R.version$platform)

#' A dataset shipped with an R package, as numeric columns (factors as their codes, text left out).
#' `na`: codes that mean "missing" in this dataset (e.g. -99).
ps_dataset <- function(req_json) {
  req <- ps_parse(req_json)
  e <- new.env()
  # (a dataset stored inside another data file, e.g. survival's aml in "cancer", is found among the package's lazy data)
  suppressWarnings(utils::data(list = req$name, package = req$package, envir = e))
  if (is.null(e[[req$name]])) {
    lazy <- getNamespaceInfo(asNamespace(req$package), "lazydata")
    if (!exists(req$name, envir = lazy, inherits = FALSE)) {
      stop(sprintf("Data set %s not found in package %s.", req$name, req$package))
    }
    e[[req$name]] <- get(req$name, envir = lazy, inherits = FALSE)
  }
  d <- as.data.frame(e[[req$name]])
  # Factors (e.g. groups, ordered items) become their codes 1, 2, ... in level order.
  levels <- list()
  for (v in names(d)) {
    if (is.factor(d[[v]]) || is.logical(d[[v]])) {
      if (is.factor(d[[v]])) levels[[v]] <- levels(d[[v]])
      d[[v]] <- as.integer(d[[v]])
    }
  }
  d <- d[vapply(d, is.numeric, TRUE)]
  for (v in names(d)) d[[v]][d[[v]] %in% unlist(req$na)] <- NA
  ps_json(list(names = names(d), cols = unname(lapply(d, function(x) unname(as.numeric(x)))), n = nrow(d), levels = levels))
}

#' Read an SPSS (.sav, .zsav), Stata (.dta) or Excel (.xlsx, .xls) file:
#' the file's bytes (base64) from the browser, or an example file shipped in a
#' package (req$package_file = list(package, path): plain path segments only).
#' Numeric columns stay numeric (value labels dropped, so Likert items keep
#' their numbers; SPSS user-missing values become NA); factors become codes with their levels; text columns are returned
#' as text (coded like CSV text columns in the app); other types are listed as
#' excluded. Excel: the sheet by name or the first one; every sheet name is returned.
ps_read_data <- function(req_json) {
  req <- ps_parse(req_json)
  format <- req[["format", exact = TRUE]]
  if (!is.character(format) || length(format) != 1L || !format %in% c("sav", "zsav", "dta", "xlsx", "xls")) {
    stop("Unsupported file type.")
  }
  pf <- req[["package_file", exact = TRUE]]
  if (!is.null(pf)) {
    parts <- strsplit(as.character(pf$path), "/", fixed = TRUE)[[1]]
    if (!is.character(pf$package) || !grepl("^[A-Za-z][A-Za-z0-9.]*$", pf$package) ||
      !length(parts) || any(!grepl("^[A-Za-z0-9_][A-Za-z0-9._-]*$", parts))) {
      stop("Invalid example file.")
    }
    path <- do.call(system.file, c(as.list(parts), package = pf$package))
    if (!nzchar(path)) stop("The example file is not in the package.")
  } else {
    bytes <- jsonlite::base64_dec(as.character(req[["data", exact = TRUE]]))
    if (length(bytes) > 50 * 1024^2) stop("The file is larger than 50 MB.")
    path <- tempfile(fileext = paste0(".", format))
    on.exit(unlink(path), add = TRUE)
    writeBin(bytes, path)
  }
  sheets <- character(0)
  if (format %in% c("xlsx", "xls")) {
    sheets <- readxl::excel_sheets(path)
    sheet <- req[["sheet", exact = TRUE]]
    if (is.null(sheet) || !(sheet %in% sheets)) sheet <- sheets[1]
    d <- readxl::read_excel(path, sheet = sheet, guess_max = 10000)
  } else {
    # Value-labelled variables (Likert items, group codes) keep their numbers (labels dropped below).
    # SPSS user-missing values are read as their values and sent with their codes (masked in the app).
    d <- if (format == "dta") haven::read_dta(path) else haven::read_sav(path, user_na = TRUE)
  }
  d <- as.data.frame(d)
  cols <- list()
  excluded <- list()
  for (v in names(d)) {
    x <- d[[v]]
    # Value labels of numeric codes (SPSS/Stata), sent beside the numbers.
    labels <- NULL
    missing <- NULL
    if (inherits(x, "haven_labelled")) {
      l <- attr(x, "labels", exact = TRUE)
      if (is.numeric(l) && length(l)) {
        labels <- lapply(seq_along(l), function(k) list(value = unname(l[[k]]), label = names(l)[k]))
      }
      na_values <- attr(x, "na_values", exact = TRUE)
      na_range <- attr(x, "na_range", exact = TRUE)
      if (is.numeric(na_values) || is.numeric(na_range)) {
        missing <- list(
          values = I(as.numeric(na_values)),
          ranges = if (is.numeric(na_range) && length(na_range) == 2) list(I(as.numeric(na_range))) else list()
        )
      }
      x <- if (inherits(x, "haven_labelled_spss")) haven::zap_labels(x, user_na = TRUE) else haven::zap_labels(x)
      x <- as.numeric(x)
    }
    if (is.logical(x)) x <- as.numeric(x)
    if (is.factor(x)) {
      cols[[v]] <- list(kind = "factor", codes = as.integer(x), levels = levels(x))
    } else if (is.numeric(x) && !inherits(x, c("Date", "POSIXt", "difftime"))) {
      cols[[v]] <- list(kind = "number", values = unname(as.numeric(x)), labels = labels, missing = missing)
    } else if (is.character(x)) {
      cols[[v]] <- list(kind = "text", values = unname(x))
    } else {
      excluded[[length(excluded) + 1L]] <- list(name = v, reason = paste("unsupported column type", class(x)[1]))
    }
  }
  ps_json(list(names = names(cols), cols = unname(cols), n = nrow(d), sheets = I(sheets), excluded = excluded))
}

#' Multiple imputation settings from the request: number of imputations and seed.
ps_mi_settings <- function(req) {
  mi <- req[["mi", exact = TRUE]] # ([[ ]]: req$mi would partially match req$missing)
  m <- as.integer(ps_number(mi[["m", exact = TRUE]] %||% 20, "number of imputations"))
  seed <- as.integer(ps_number(mi[["seed", exact = TRUE]] %||% 1, "imputation seed"))
  if (is.na(m) || m < 2L || m > 200L) stop("The number of imputations must be between 2 and 200.")
  method <- mi[["method", exact = TRUE]] %||% "mice"
  if (!(is.character(method) && length(method) == 1 && method %in% c("mice", "amelia", "micenorm", "joint"))) {
    stop("Invalid imputation method in the request.")
  }
  # (auxiliary and nominal columns: names, checked against the data by the caller)
  aux <- as.character(unlist(mi[["auxiliary", exact = TRUE]]))
  noms <- as.character(unlist(mi[["nominal", exact = TRUE]]))
  list(m = m, seed = seed, method = method, auxiliary = aux, nominal = noms)
}

#' Joint imputation under the unrestricted (H1) model, as Mplus's DATA IMPUTATION (Asparouhov & Muthen 2010): data
#' augmentation (Tanner & Wong 1987; Schafer 1997, ch. 5) for a multivariate normal model with flat priors on the means
#' and the covariance matrix (Mplus's defaults for H1), categorical (ordered) variables through latent normal responses
#' with thresholds (Albert & Chib 1993; the first threshold 0, the latent response's variance kept at 1 by parameter
#' expansion). The imputed data sets are taken every `thin` iterations after `burn`. A script writes this function out.
ps_joint_impute <- function(data, m, seed, categorical = character(0), burn = 1000, thin = 100) {
  set.seed(seed)
  X <- as.matrix(data)
  n <- nrow(X)
  p <- ncol(X)
  vn <- colnames(X)
  cat_j <- match(categorical, vn)
  miss <- is.na(X)
  if (anyNA(cat_j)) stop("A categorical variable of the imputation is not among its variables.")
  if (any(colSums(!miss) < 2)) {
    stop("Every variable of the imputation needs at least two observed values.")
  }
  lev <- lapply(seq_len(p), function(j) if (j %in% cat_j) sort(unique(X[!miss[, j], j])) else NULL)
  for (j in cat_j) if (length(lev[[j]]) < 2 || length(lev[[j]]) > 10) stop("A categorical variable of the imputation needs 2 to 10 categories.")
  code <- lapply(seq_len(p), function(j) if (j %in% cat_j) match(X[, j], lev[[j]]) else NULL)
  # thresholds from the observed proportions, the first at 0 (the latent mean carries the location)
  tau <- lapply(seq_len(p), function(j) {
    if (j %in% cat_j) {
      q <- stats::qnorm(cumsum(tabulate(code[[j]], length(lev[[j]])))[-length(lev[[j]])] / sum(!miss[, j]))
      q - q[1]
    } else {
      NULL
    }
  })
  W <- X
  for (j in seq_len(p)) {
    if (j %in% cat_j) {
      t <- c(tau[[j]][1] - 1, tau[[j]], tau[[j]][length(tau[[j]])] + 1)
      k <- code[[j]]
      W[, j] <- ifelse(is.na(k), 0, (t[k] + t[k + 1]) / 2)
    } else {
      W[miss[, j], j] <- mean(X[, j], na.rm = TRUE)
    }
  }
  # a normal truncated to (a, b), by the inverse distribution function
  rtn <- function(mu, s, a, b) {
    pa <- stats::pnorm(a, mu, s)
    pb <- stats::pnorm(b, mu, s)
    x <- stats::qnorm(pmin(pmax(pa + stats::runif(length(mu)) * pmax(pb - pa, 0), 1e-300), 1 - 1e-16), mu, s)
    pmin(pmax(x, a), b)
  }
  mu <- colMeans(W)
  S <- crossprod(sweep(W, 2, mu)) / n
  keep <- burn + thin * seq_len(m)
  out <- vector("list", m)
  for (it in seq_len(max(keep))) {
    # the missing values (and every latent response) given the others, one variable at a time
    for (j in seq_len(p)) {
      upd <- if (j %in% cat_j) rep(TRUE, n) else miss[, j]
      if (!any(upd)) next
      b <- solve(S[-j, -j], S[-j, j])
      s <- sqrt(max(S[j, j] - sum(S[j, -j] * b), 1e-12))
      cm <- mu[j] + drop(sweep(W[upd, -j, drop = FALSE], 2, mu[-j]) %*% b)
      if (j %in% cat_j) {
        t <- c(-Inf, tau[[j]], Inf)
        k <- code[[j]]
        o <- !is.na(k)
        w <- stats::rnorm(n, cm, s)
        w[o] <- rtn(cm[o], s, t[k[o]], t[k[o] + 1])
        W[, j] <- w
        # the other thresholds: uniform between the neighbouring categories' latent responses
        nt <- length(tau[[j]])
        if (nt > 1) {
          for (h in 2:nt) {
            lo <- max(W[o & k == h, j], tau[[j]][h - 1])
            hi <- min(W[o & k == h + 1, j], if (h < nt) tau[[j]][h + 1] else Inf)
            if (hi > lo) tau[[j]][h] <- stats::runif(1, lo, hi)
          }
        }
      } else {
        W[upd, j] <- stats::rnorm(sum(upd), cm, s)
      }
    }
    # the means and covariance matrix from their posterior given the completed data (flat prior)
    wb <- colMeans(W)
    S <- solve(stats::rWishart(1, n - 1, solve(crossprod(sweep(W, 2, wb))))[, , 1])
    mu <- wb + drop(t(chol(S / n)) %*% stats::rnorm(p))
    # (the latent responses back to variance 1: their scale is not identified)
    for (j in cat_j) {
      sj <- sqrt(S[j, j])
      W[, j] <- W[, j] / sj
      mu[j] <- mu[j] / sj
      tau[[j]] <- tau[[j]] / sj
      S[j, ] <- S[j, ] / sj
      S[, j] <- S[, j] / sj
    }
    if (it %in% keep) {
      D <- as.data.frame(W)
      names(D) <- vn
      for (j in cat_j) D[[j]] <- lev[[j]][findInterval(W[, j], tau[[j]]) + 1L]
      for (j in setdiff(seq_len(p), cat_j)) D[[j]][!miss[, j]] <- X[!miss[, j], j]
      out[[match(it, keep)]] <- D
    }
  }
  out
}

#' The lines of a script that define ps_joint_impute (a replication runs the same imputation).
ps_joint_impute_lines <- function() {
  c(
    "# Joint imputation under the unrestricted (H1) model (data augmentation; categorical variables through latent normal responses)",
    paste("ps_joint_impute <-", paste(deparse(ps_joint_impute, width.cutoff = 120L), collapse = "\n"))
  )
}

#' Versions of R and of the requested packages (NA when not installed), for a replication package's README.
ps_versions <- function(req_json) {
  req <- ps_parse(req_json)
  pkgs <- unique(unlist(req$packages))
  pkgs <- pkgs[grepl("^[A-Za-z][A-Za-z0-9.]*$", pkgs)]
  v <- vapply(pkgs, function(p) tryCatch(as.character(utils::packageVersion(p)), error = function(e) NA_character_), "")
  ps_json(list(r = R.version.string, platform = R.version$platform, packages = lapply(seq_along(pkgs), function(i) list(name = pkgs[i], version = unname(v[i])))))
}
