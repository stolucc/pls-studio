# Native reference for the Dynamic fit cutoffs card (src/examples/cards/dfi.ts): the dynamic package's help-page
# examples run in desktop R exactly as the help pages run them (the package draws with fixed seeds of its own), with
# lavaan's test named in the call where the fit is by ML (lavaan 0.7 leaves fit@Options$test unresolved otherwise,
# which DDDFI, likert* and nnor* cannot read; the fit is the same). Writes src/engine/__fixtures__/dfi/reference.json;
# cards/dfi.webr.test.ts compares the card's tables with it cell by cell.
#   Rscript scripts/validation/dfi.R            (needs dynamic in the helper's library: R_LIBS_USER=~/.pls-studio-helper/library)
suppressPackageStartupMessages({ library(lavaan); library(dynamic); library(jsonlite) })
tab <- function(m) { m <- if (is.data.frame(m)) as.matrix(m) else as.matrix(unclass(m)); list(rows = I(rownames(m)), columns = I(trimws(colnames(m))), cells = lapply(seq_len(nrow(m)), function(i) I(unname(ifelse(is.na(m[i, ]), "", as.character(m[i, ])))))) }
out <- list(); timing <- list()
run <- function(id, expr) { t0 <- Sys.time(); r <- unclass(expr); timing[[id]] <<- as.numeric(Sys.time() - t0, units = "secs"); cat(id, round(timing[[id]], 1), "s\n")
  out[[id]] <<- list(fn = class(expr), cutoffs = if (!is.null(r$cutoffs)) tab(r$cutoffs), fit = if (!is.null(r$fit)) tab(r$fit),
    equiv = if (!is.null(r$rmsea)) list(rmsea = r$rmsea, cfi = r$cfi, rmseaBins = I(c(r$eo_r, r$ct_r, r$ft_r, r$mf_r, r$pf_r)), cfiBins = I(c(r$pf_c, r$mf_c, r$ft_c, r$ct_c, r$eo_c))),
    dataNames = I(as.character(names(if (!is.null(r$indices)) r$indices else r$data))), dataRows = if (is.null(r$data) && is.null(r$indices)) 0L else nrow(if (!is.null(r$indices)) r$indices else r$data)) }
dat <- HolzingerSwineford1939
hs3 <- "F1 =~ x1 + x2 + x3\nF2 =~ x4 + x5 + x6\nF3 =~ x7 + x8 + x9"
fit3 <- cfa(hs3, dat, test = "standard")
run("dynamic-hs-cfahb", cfaHB(fit3))
run("dynamic-hs-cfaone", cfaOne(cfa("F1 =~ x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9", dat, test = "standard")))
run("dynamic-hs-exactfit", exactFit(fit3))
run("dynamic-hs-equivtest", equivTest(fit3))
out[["dynamic-hs-equivtest-manual"]] <- { r <- unclass(equivTest(301, 85.306, 24, 918.852, 9, manual = TRUE)); list(rmsea = r$rmsea, cfi = r$cfi) }
run("dynamic-holzinger-dddfi", DDDFI(cfa(hs3, data = Holzinger, test = "standard")))
run("dynamic-example-catone", catOne(cfa("F1=~X5+ X6 + X7 + X8 + X9", data = Example, ordered = TRUE)))
run("dynamic-example-cathb", catHB(cfa("F1=~X1 + X2 +X3\nF2=~X6 + X7 + X8 + X9\nF1~~F2", data = Example, ordered = TRUE)))
run("dynamic-example-likertone", likertOne(cfa("F1=~X5+ X6 + X7 + X8 + X9", data = Example, test = "standard"), data = Example))
fit2 <- cfa("F1=~X2 + X3 + X4\nF2=~X6 + X7 + X8\nF1~~F2", data = Example, test = "standard")
run("dynamic-example-likerthb", likertHB(fit2, data = Example))
run("dynamic-example-nnorhb", nnorHB(fit2, data = Example))
writeLines(toJSON(list(generated = format(Sys.time()), R = R.version.string, dynamic = as.character(packageVersion("dynamic")), lavaan = as.character(packageVersion("lavaan")), seconds = timing, examples = out), auto_unbox = TRUE, pretty = TRUE, null = "null", na = "null"), "src/engine/__fixtures__/dfi/reference.json")
cat("written\n")
