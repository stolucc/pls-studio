# PLS Studio helper: one R worker process. Sources PLS Studio's R bridge
# (the same files the browser's R runs), then answers requests: one JSON
# request per line on stdin, one reply per line on stdout, marked so that
# anything else written to stdout is ignored. Only the bridge's ps_*
# functions can be called, with the request (JSON text) as their argument;
# no R code is accepted from the request.
#   Rscript --vanilla worker.R <bridge directory>

local({
  lib <- Sys.getenv("PS_HELPER_LIBRARY")
  if (nzchar(lib)) .libPaths(c(lib, .libPaths()))
})
MARK <- "\x1ePSH\x1e"
out <- stdout()
reply <- function(x) {
  cat(MARK, as.character(jsonlite::toJSON(x, auto_unbox = TRUE, null = "null", digits = NA)), "\n", sep = "", file = out)
  flush(out)
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  cat(MARK, "{\"ready\":false,\"message\":\"The R package jsonlite is not installed.\"}\n", sep = "", file = out)
  quit(save = "no", status = 1)
}
`%||%` <- function(a, b) if (is.null(a)) b else a
for (f in sort(list.files(commandArgs(trailingOnly = TRUE)[1], "\\.R$", full.names = TRUE))) sys.source(f, envir = globalenv())
# The callable functions: the bridge's ps_* functions, fixed now (before any request).
PS_HELPER_CALLABLE <- Filter(function(n) is.function(get(n, envir = globalenv())), grep("^ps_[a-z0-9_]+$", ls(globalenv()), value = TRUE))
lockBinding("PS_HELPER_CALLABLE", globalenv())
reply(list(ready = TRUE, r = R.version.string, pid = Sys.getpid()))

con <- file("stdin", open = "r")
repeat {
  line <- readLines(con, n = 1, warn = FALSE)
  if (!length(line)) break
  msg <- tryCatch(jsonlite::fromJSON(line, simplifyVector = FALSE), error = function(e) NULL)
  id <- if (is.list(msg) && is.character(msg$id)) msg$id else ""
  if (!is.list(msg) || !is.character(msg$fn) || length(msg$fn) != 1) { reply(list(id = id, ok = FALSE, kind = "bad_request", message = "Malformed request.")); next }
  if (identical(msg$fn, "ps_helper_packages")) {
    pk <- unlist(msg$packages)
    pk <- pk[grepl("^[A-Za-z][A-Za-z0-9.]{0,63}$", pk)]
    v <- lapply(pk, function(p) tryCatch(as.character(utils::packageVersion(p)), error = function(e) NULL))
    reply(list(id = id, ok = TRUE, versions = setNames(v, pk)))
    next
  }
  if (!(msg$fn %in% PS_HELPER_CALLABLE)) { reply(list(id = id, ok = FALSE, kind = "bad_request", message = "Unknown function.")); next }
  pk <- unlist(msg$packages)
  if (length(pk)) {
    pk <- pk[grepl("^[A-Za-z][A-Za-z0-9.]{0,63}$", pk)]
    missing <- pk[!vapply(pk, requireNamespace, TRUE, quietly = TRUE)]
    if (length(missing)) { reply(list(id = id, ok = FALSE, kind = "missing_packages", packages = I(missing))); next }
  }
  if (!is.character(msg$req) || length(msg$req) != 1) { reply(list(id = id, ok = FALSE, kind = "bad_request", message = "Malformed request.")); next }
  res <- tryCatch({
    f <- get(msg$fn, envir = globalenv(), mode = "function")
    # Package output on stdout (print, cat) is captured and dropped: stdout carries the replies.
    v <- NULL
    utils::capture.output(v <- if (isTRUE(msg$export)) f(msg$req, export = TRUE) else f(msg$req))
    list(id = id, ok = TRUE, result = paste(as.character(v), collapse = "\n"))
  }, error = function(e) list(id = id, ok = FALSE, kind = "r_error", message = conditionMessage(e)))
  reply(res)
}
