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
    if (!is.null(x) && !(length(x) == 1 && is.character(x) && x %in% allowed)) stop(sprintf("Invalid %s in the request.", what))
  }
  get <- function(x, ...) { for (k in c(...)) { if (!is.list(x)) return(NULL); x <- x[[k, exact = TRUE]] }; x }
  cb_est <- c("ML", "MLM", "MLMV", "MLR", "GLS", "ULS", "2SLS")
  one_of(get(req, "estimator"), cb_est, "estimator")
  one_of(get(req, "missing"), c("mean", "casewise"), "missing-value treatment")
  one_of(get(req, "probe"), c("percentiles", "meansd"), "probing method")
  one_of(get(req, "hc"), c("none", "HC0", "HC1", "HC2", "HC3", "HC4"), "standard error type")
  one_of(get(req, "options", "scheme"), c("path", "centroid", "factor"), "weighting scheme")
  one_of(get(req, "options", "missing"), c("mean", "casewise"), "missing-value treatment")
  for (e in get(req, "estimators")) { one_of(get(e, "method"), c("pls", "cb"), "estimator"); one_of(get(e, "estimator"), cb_est, "estimator") }
  for (c in c(get(req, "model", "constructs"), get(req, "spec", "constructs"))) {
    one_of(get(c, "mode"), c("A", "B"), "construct mode")
    one_of(get(c, "type"), c("factor", "composite"), "construct type")
  }
  req
}

ps_json <- function(x) jsonlite::toJSON(x, auto_unbox = TRUE, digits = NA, na = "null", null = "null", matrix = "rowmajor")

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

#' Raw data for the model's indicators, as a data.frame with syntactic names.
ps_frame <- function(req, n) {
  cols <- req$data$cols
  at <- match(n$all_inds, req$data$names)
  if (anyNA(at)) stop("Indicator(s) not in the dataset: ", paste(n$all_inds[is.na(at)], collapse = ", "))
  # jsonlite turns equal-length columns into a (variables x rows) matrix.
  col <- function(i) as.numeric(if (is.matrix(cols)) cols[i, ] else cols[[i]])
  df <- as.data.frame(lapply(at, col))
  names(df) <- unname(n$iv[n$all_inds])
  df
}

#' Script lines for missing values (applied to the model's indicators).
ps_missing_code <- function(missing) {
  if (identical(missing, "mean")) c("# Missing values: replaced by the indicator mean",
    "for (v in names(data)) data[[v]][is.na(data[[v]])] <- mean(data[[v]], na.rm = TRUE)")
  else c("# Missing values: casewise (listwise) deletion", "data <- data[complete.cases(data), , drop = FALSE]")
}

#' A single finite number as R code; anything else is refused (values come from project files).
ps_num <- function(x) {
  if (!(is.numeric(x) && length(x) == 1 && is.finite(x))) stop("Invalid fixed value in the request.")
  format(x, digits = 15)
}

#' Quote a character vector as R code (backslashes, quotes and control characters escaped).
ps_q <- function(x) paste0("c(", paste(encodeString(as.character(x), quote = '"'), collapse = ", "), ")")

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
    warning = function(w) { warn <<- c(warn, gsub("\\s+", " ", trimws(conditionMessage(w)))); invokeRestart("muffleWarning") })
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

#' The full, self-contained script: header, embedded inputs, the script that ran, a report.
ps_script <- function(title, packages, inputs, body, report) {
  emb <- unlist(lapply(names(inputs), function(nm) {
    v <- inputs[[nm]]
    if (is.data.frame(v)) ps_embed_frame(nm, v)
    else if (is.matrix(v)) { if (is.null(rownames(v))) dimnames(v) <- list(seq_len(nrow(v)), seq_len(ncol(v))); ps_embed_matrix(nm, v) }
    else sprintf("%s <- %s", nm, deparse(v))
  }))
  vers <- vapply(packages, function(p) sprintf("%s %s", p, as.character(utils::packageVersion(p))), "")
  c(sprintf("# %s", ps_comment(title)),
    sprintf("# Generated by PLS Studio on %s with %s (%s).", format(Sys.Date()), paste(vers, collapse = ", "), R.version.string),
    "# Running this script reproduces the calculation exactly.",
    "",
    sprintf("# install.packages(%s)", ps_q(packages)),
    "",
    "# ---- Data used (model variables only) ----",
    emb, "",
    "# ---- Calculation (as run by PLS Studio) ----",
    body, "",
    "# ---- Report ----",
    report)
}

#' A dataset shipped with an R package, as numeric columns (factors and text are left out).
#' `na`: codes that mean "missing" in this dataset (e.g. -99).
ps_dataset <- function(req_json) {
  req <- ps_parse(req_json)
  e <- new.env()
  utils::data(list = req$name, package = req$package, envir = e)
  d <- as.data.frame(e[[req$name]])
  d <- d[vapply(d, is.numeric, TRUE)]
  for (v in names(d)) d[[v]][d[[v]] %in% unlist(req$na)] <- NA
  ps_json(list(names = names(d), cols = unname(lapply(d, function(x) unname(as.numeric(x)))), n = nrow(d)))
}
