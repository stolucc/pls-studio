# Injection check for the R bridge (src/rengine/R). Bridge functions write R
# code that contains values from the request (column, construct and group
# names, options, numbers). Requests can come from imported or shared project
# files, and with the desktop helper (helper/) that code runs in the user's
# own R, so no request value may ever become R code.
#
# This script replays recorded bridge calls (from the webR tests:
#   PS_RECORD_REQUESTS=calls.jsonl WEBR_TESTS=1 npx vitest run webr.test)
# with every string and number of the request replaced, one at a time, by a
# payload that breaks out of any quoting and calls PWNED_CANARY(). For every
# variant it checks the code the bridge generates, both the exported script
# (export = TRUE) and the code it would run (ps_run, replaced by a stub that
# only parses): the code must parse, and PWNED_CANARY must not appear in it
# as code (inside a string it is harmless). Nothing is executed.
#
#   R_LIBS=<lib with the packages> Rscript scripts/security/replay-injection.R calls.jsonl [max per function] [function regex]

suppressPackageStartupMessages(library(jsonlite))
`%||%` <- function(a, b) if (is.null(a)) b else a
args <- commandArgs(trailingOnly = TRUE)
max_per_fn <- if (length(args) > 1) as.integer(args[2]) else 6L
only <- if (length(args) > 2) args[3] else ""  # optional: a regular expression of function names
for (f in sort(list.files("src/rengine/R", "\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())

STRING_PAYLOAD <- "a\"'`); PWNED_CANARY(); #\nPWNED_CANARY() ;(\"'` \\\"); PWNED_CANARY(); (\\\""
NUMBER_PAYLOAD <- "1); PWNED_CANARY(); (1"

#' Does the code contain PWNED_CANARY as code? NA when it does not parse.
injected <- function(code) {
  ex <- tryCatch(parse(text = code, keep.source = FALSE), error = function(e) NULL)
  if (is.null(ex)) return(NA)
  "PWNED_CANARY" %in% all.names(ex)
}

# ps_run replaced by a stub that hands its code back instead of running it.
generated <- NULL
ps_run <- function(lines, inputs) { generated <<- c(generated, paste(lines, collapse = "\n")); stop("__stub__") }

#' Every leaf path of a parsed request; long numeric vectors (data columns) by their first element only.
leaves <- function(x, path = list()) {
  if (is.list(x)) return(unlist(lapply(seq_along(x), function(i) leaves(x[[i]], c(path, if (!is.null(names(x)) && nzchar(names(x)[i])) names(x)[i] else i))), recursive = FALSE))
  if (is.character(x)) return(lapply(seq_along(x), function(i) list(path = path, i = i, kind = "string")))
  if (is.numeric(x)) return(lapply(if (length(x) > 3) 1L else seq_along(x), function(i) list(path = path, i = i, kind = "number")))
  list()
}
set_leaf <- function(x, path, i, value) {
  if (!length(path)) { if (is.character(value) && !is.character(x)) x <- as.list(x); x[[i]] <- value; return(x) }
  x[[path[[1]]]] <- set_leaf(x[[path[[1]]]], path[-1], i, value); x
}

#' Data columns cut to their first 30 values (the code written does not depend on the number of rows).
truncate_data <- function(x) {
  if (!is.list(x)) return(x)
  if (!is.null(names(x)) && "cols" %in% names(x) && is.list(x$cols)) x$cols <- lapply(x$cols, function(c) if (is.list(c) && length(c) > 30) c[1:30] else c)
  lapply(x, truncate_data) -> y; names(y) <- names(x); y
}

check <- function(fn, req_json) {
  f <- get(fn)
  out <- character(0)
  generated <<- NULL
  s <- tryCatch(f(req_json, export = TRUE), error = function(e) NULL)
  if (is.character(s)) out <- c(out, paste(s, collapse = "\n"))
  generated <<- NULL
  tryCatch(f(req_json), error = function(e) NULL)
  c(out, generated)
}

calls <- lapply(readLines(args[1]), fromJSON, simplifyVector = FALSE)
calls <- Filter(function(k) grepl("^ps_[a-z0-9_]+\\(req\\)$", k$call), calls)
fns <- sub("\\(req\\)$", "", vapply(calls, `[[`, "", "call"))
if (nzchar(only)) { keep <- grepl(only, fns); calls <- calls[keep]; fns <- fns[keep] }
one_fn <- function(fn) {
  findings <- list(); tested <- 0; no_code <- FALSE
  if (!exists(fn, mode = "function")) return(list(findings = findings, tested = 0, no_code = FALSE))
  reqs <- head(unique(vapply(calls[fns == fn], `[[`, "", "req")), max_per_fn)
  for (rj in reqs) {
    base <- truncate_data(fromJSON(rj, simplifyVector = FALSE))
    rj <- toJSON(base, auto_unbox = TRUE, digits = NA, null = "null")
    if (!length(check(fn, rj))) { no_code <- TRUE; next }
    for (lf in leaves(base)) {
      variant <- set_leaf(base, lf$path, lf$i, if (lf$kind == "string") STRING_PAYLOAD else NUMBER_PAYLOAD)
      vj <- toJSON(variant, auto_unbox = TRUE, digits = NA, null = "null")
      for (code in check(fn, vj)) {
        tested <- tested + 1
        bad <- injected(code)
        if (is.na(bad) || bad) findings[[length(findings) + 1]] <- data.frame(fn = fn, field = paste(c(unlist(lf$path), lf$i), collapse = "/"),
          kind = if (is.na(bad)) "does not parse" else "INJECTED")
      }
    }
  }
  message(sprintf("%-16s %6d scripts checked, %d findings", fn, tested, length(findings)))
  list(findings = findings, tested = tested, no_code = no_code)
}
res <- parallel::mclapply(sort(unique(fns)), one_fn, mc.cores = max(1L, parallel::detectCores() - 1L), mc.preschedule = FALSE)
names(res) <- sort(unique(fns))
failed <- vapply(res, inherits, TRUE, "try-error")
if (any(failed)) cat("Replay failed for:", names(res)[failed], "\n")
res <- res[!failed]
cat(sprintf("%d generated scripts checked for %d functions.\n", sum(vapply(res, `[[`, 0, "tested")), length(res)))
no_code <- names(res)[vapply(res, `[[`, TRUE, "no_code")]
if (length(no_code)) cat("No code generated for a recorded request (check coverage):", paste(no_code, collapse = ", "), "\n")
findings <- unlist(lapply(res, `[[`, "findings"), recursive = FALSE)
if (length(findings)) {
  print(unique(do.call(rbind, findings)), row.names = FALSE)
  quit(status = 1)
}
cat("No injection found.\n")
