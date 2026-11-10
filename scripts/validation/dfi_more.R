# Native reference for the Dynamic fit cutoffs card's nnorOne (src/examples/cards/dfi.ts, dynamic-example-nnorone): the
# help page's lavaan-object example (?nnorOne: the one-factor model of X5 to X9 on its Example data, 500 replications,
# MLR, the package's fixed seeds) run in desktop R as scripts/validation/dfi.R runs the others (lavaan's test named in
# the call). Writes src/engine/__fixtures__/dfi/more.json, which cards/dfi.webr.test.ts reads beside reference.json.
#   R_LIBS_USER=~/.pls-studio-helper/library Rscript scripts/validation/dfi_more.R
suppressPackageStartupMessages({ library(lavaan); library(dynamic); library(jsonlite) })
tab <- function(m) { m <- if (is.data.frame(m)) as.matrix(m) else as.matrix(unclass(m)); list(rows = I(rownames(m)), columns = I(trimws(colnames(m))), cells = lapply(seq_len(nrow(m)), function(i) I(unname(ifelse(is.na(m[i, ]), "", as.character(m[i, ])))))) }
out <- list(); timing <- list()
run <- function(id, expr) { t0 <- Sys.time(); r <- unclass(expr); timing[[id]] <<- as.numeric(Sys.time() - t0, units = "secs"); cat(id, round(timing[[id]], 1), "s\n")
  out[[id]] <<- list(fn = class(expr), cutoffs = if (!is.null(r$cutoffs)) tab(r$cutoffs), fit = if (!is.null(r$fit)) tab(r$fit),
    equiv = if (!is.null(r$rmsea)) list(rmsea = r$rmsea, cfi = r$cfi, rmseaBins = I(c(r$eo_r, r$ct_r, r$ft_r, r$mf_r, r$pf_r)), cfiBins = I(c(r$pf_c, r$mf_c, r$ft_c, r$ct_c, r$eo_c))),
    dataNames = I(as.character(names(if (!is.null(r$indices)) r$indices else r$data))), dataRows = if (is.null(r$data) && is.null(r$indices)) 0L else nrow(if (!is.null(r$indices)) r$indices else r$data)) }
run("dynamic-example-nnorone", nnorOne(cfa("F1=~X5+ X6 + X7 + X8 + X9", data = Example, test = "standard"), data = Example))
writeLines(toJSON(list(generated = format(Sys.time()), R = R.version.string, dynamic = as.character(packageVersion("dynamic")), lavaan = as.character(packageVersion("lavaan")), seconds = timing, examples = out), auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null"), "src/engine/__fixtures__/dfi/more.json")
