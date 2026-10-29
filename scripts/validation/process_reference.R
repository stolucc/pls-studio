# Reference results for the conditional process (PROCESS-model) method.
#
# Runs every model number of Andrew Hayes's PROCESS for R on one simulated
# dataset and writes, per model, what PROCESS estimated: the terms and OLS
# coefficients of every equation, the conditional direct effects, the
# conditional indirect effects at the moderator values PROCESS probes, and the
# indices of (partial / moderated) moderated mediation. src/process tests
# check our model templates and R pipeline against these numbers.
#
# PROCESS is not distributed with PLS Studio (its licence forbids it). Download
# it yourself from processmacro.org and pass the path of its process.R:
#
#   Rscript scripts/validation/process_reference.R ~/Downloads/process.R
#
# Optional second argument: a regular expression selecting model numbers.

suppressMessages(library(jsonlite))

args <- commandArgs(TRUE)
if (!length(args) || !file.exists(args[1])) stop("Pass the path of PROCESS's process.R.")
local({ source(args[1], local = TRUE); process <<- process })
only <- if (length(args) > 1) args[2] else "."

root <- "src/process/__fixtures__/reference"
dir.create(root, recursive = TRUE, showWarnings = FALSE)

# ---------- data: every role of every template, with real effects ----------

set.seed(20261029)
n <- 300
d <- data.frame(x = rnorm(n), w = rnorm(n), z = rnorm(n), c1 = rnorm(n))
d$m1 <- 0.45 * d$x + 0.25 * d$x * d$w + 0.1 * d$x * d$z + 0.1 * d$c1 + rnorm(n)
d$m2 <- 0.35 * d$x + 0.3 * d$m1 + 0.2 * d$m1 * d$w + rnorm(n)
d$m3 <- 0.25 * d$x + 0.3 * d$m2 + 0.15 * d$m1 + rnorm(n)
d$m4 <- 0.3 * d$x + 0.35 * d$m3 + rnorm(n)
d$y <- 0.2 * d$x + 0.3 * d$m1 + 0.25 * d$m2 + 0.2 * d$m3 + 0.15 * d$m4 +
  0.2 * d$m1 * d$w + 0.15 * d$x * d$w + 0.1 * d$x * d$w * d$z + 0.1 * d$c1 + rnorm(n)
d <- round(d, 6)
write.csv(d, file.path(root, "data.csv"), row.names = FALSE)

# ---------- the models (current PROCESS numbering) ----------

moderation <- 1:3
parallel <- c(4, 5, 7:22, 28, 29, 58:76)
serial <- c(6, 83:92)
mediators <- function(model) {
  if (model %in% moderation) return(character())
  k <- if (model %in% serial || model %in% 80:81) 3 else if (model == 82) 4 else 2
  paste0("m", seq_len(k))
}

# ---------- parsing PROCESS's printed output ----------

num <- function(s) as.numeric(strsplit(trimws(s), "\\s+")[[1]])
words <- function(s) strsplit(trimws(s), "\\s+")[[1]]

# Rows of a (possibly wrapped) table that starts on the line after `start`:
# the first column block only, which always holds the first value columns.
table_after <- function(lines, start) {
  rows <- list(); i <- start + 1
  header <- words(lines[i]); i <- i + 1
  while (i <= length(lines) && nzchar(trimws(lines[i]))) {
    w <- words(lines[i])
    # A wrapped table continues with its remaining columns: rows of another width.
    if (length(w) < 2 || identical(w, header) || (length(rows) && length(w) != length(rows[[1]]))) break
    rows[[length(rows) + 1]] <- w
    i <- i + 1
  }
  list(header = header, rows = rows)
}

parse_output <- function(out) {
  res <- list(equations = list(), se = list(), summary = list(), interactions = list(), direct = NULL, indirect = list(), indices = list())
  starts <- grep("^Outcome Variable:", out)
  for (s in starts) {
    outcome <- trimws(sub("^Outcome Variable:", "", out[s]))
    m <- grep("^Model:", out); m <- m[m > s][1]
    tab <- table_after(out, m)
    coef <- setNames(lapply(tab$rows, function(r) as.numeric(r[2])), vapply(tab$rows, `[`, "", 1))
    se <- setNames(lapply(tab$rows, function(r) as.numeric(r[3])), names(coef))
    # Model summary: R, R-sq, MSE, F (robust with HC), df1, df2 on the first row.
    ms <- grep("^Model Summary:", out); ms <- ms[ms > s][1]
    summary_row <- num(out[ms + 2])
    # "int_1  :  x  x  w" -> int_1 = x*w
    next_start <- c(starts[starts > s], length(out))[1]
    key <- grep("^Product terms key:", out); key <- key[key > s & key < next_start]
    if (length(key)) {
      i <- key + 1
      while (i <= length(out) && grepl("^int_[0-9]+\\s*:", out[i])) {
        parts <- strsplit(out[i], ":")[[1]]
        # PROCESS writes products as "a  x  b"; a variable called x appears as the first factor.
        f <- words(parts[2]); vars <- f[seq(1, length(f), by = 2)]
        names(coef)[names(coef) == trimws(parts[1])] <- paste(vars, collapse = "*")
        names(se) <- names(coef)
        i <- i + 1
      }
    }
    res$equations[[outcome]] <- coef
    res$se[[outcome]] <- se
    # Tests of the highest-order unconditional interactions: "X*W  R2-chng F df1 df2 p".
    hi <- grep("^Test\\(s\\) of highest order unconditional interaction", out); hi <- hi[hi > s & hi < next_start]
    if (length(hi)) {
      tab <- table_after(out, hi[1])
      res$interactions[[outcome]] <- lapply(tab$rows, function(r) list(label = r[1], r2change = as.numeric(r[2]), f = as.numeric(r[3]),
        df1 = as.numeric(r[4]), df2 = as.numeric(r[5]), p = as.numeric(r[6])))
    }
    res$summary[[outcome]] <- list(r2 = summary_row[2], f = summary_row[4], df1 = summary_row[5], df2 = summary_row[6])
  }
  # Conditional direct effect(s): one row per moderator value combination.
  cd <- grep("^Conditional direct effect\\(s\\) of X on Y:", out)
  if (length(cd)) {
    tab <- table_after(out, cd[1])
    nm <- which(tab$header == "effect") - 1
    res$direct <- lapply(tab$rows, function(r) list(at = as.list(setNames(as.numeric(r[seq_len(nm)]), tab$header[seq_len(nm)])), effect = as.numeric(r[nm + 1]), se = as.numeric(r[nm + 2])))
  }
  dd <- grep("^Direct effect of X on Y:", out)
  if (length(dd)) res$direct <- list(list(at = setNames(list(), character()), effect = num(out[dd[1] + 2])[1]))
  # Unmoderated indirect effects: a table of Ind1, Ind2, ... and a key of their paths.
  ui <- grep("^Indirect effect\\(s\\) of X on Y:", out)
  if (length(ui)) {
    tab <- table_after(out, ui[1])
    eff <- setNames(vapply(tab$rows, function(r) as.numeric(r[2]), 0), vapply(tab$rows, `[`, "", 1))
    if (length(eff) == 1) {
      # One mediator: PROCESS prints the single indirect effect under the mediator's name.
      res$indirect[[1]] <- list(path = c("x", names(eff), "y"), effects = list(list(at = setNames(list(), character()), effect = unname(eff))))
    }
    named <- setdiff(names(eff), c("TOTAL", grep("^Ind[0-9]+$", names(eff), value = TRUE)))
    if (length(eff) > 1) for (m in named) {
      res$indirect[[length(res$indirect) + 1]] <- list(path = c("x", m, "y"), effects = list(list(at = setNames(list(), character()), effect = unname(eff[m]))))
    }
    key <- grep("^Indirect effect key:", out)
    for (k in if (length(key)) grep("^Ind[0-9]+ ", out[-seq_len(key[1])], value = TRUE) else character()) {
      w <- words(k)
      res$indirect[[length(res$indirect) + 1]] <- list(path = setdiff(w[-1], "->"), effects = list(list(at = setNames(list(), character()), effect = unname(eff[w[1]]))))
    }
  }
  for (s in grep("^INDIRECT EFFECT:", out)) {
    path <- setdiff(words(out[s + 2]), "->")
    tab <- table_after(out, s + 3)
    nm <- which(tab$header == "Effect") - 1
    res$indirect[[length(res$indirect) + 1]] <- list(
      path = path,
      effects = lapply(tab$rows, function(r) list(at = as.list(setNames(as.numeric(r[seq_len(nm)]), tab$header[seq_len(nm)])), effect = as.numeric(r[nm + 1]))))
    # Index rows directly below the table belong to this indirect effect.
    j <- s + 4 + length(tab$rows)
    while (j <= length(out) && !grepl("^INDIRECT EFFECT:|^\\*{5}", out[j])) {
      if (grepl("Ind(ex|ices) of", out[j])) {
        kind <- trimws(sub(":$", "", out[j]))
        it <- table_after(out, j)
        k <- which(it$header == "Index") - 1
        for (r in it$rows) {
          # A row is either labelled by its moderator ("w  0.11 ...") or, for conditional
          # indices, starts with the value of the other moderator it is conditional on.
          entry <- if (length(r) == length(it$header) + 1) list(moderator = r[1], index = as.numeric(r[2]))
            else list(at = as.list(setNames(as.numeric(r[seq_len(k)]), it$header[seq_len(k)])), index = as.numeric(r[k + 1]))
          res$indices[[length(res$indices) + 1]] <- c(list(kind = kind, path = path), entry)
        }
      }
      j <- j + 1
    }
  }
  res
}

# ---------- run ----------

run_model <- function(model, hc = 5) {
  ms <- mediators(model)
  number <- if (model == 74) 4 else model
  uses_w <- !(model %in% c(4, 6, 74, 80:82))
  uses_z <- model %in% c(2, 3, 9:13, 16:22, 28, 29, 60:73, 75, 76)
  out <- capture.output(process(
    data = d, y = "y", x = "x", m = if (length(ms)) ms else "xxxxx",
    w = if (uses_w) "w" else "xxxxx", z = if (uses_z) "z" else "xxxxx",
    cov = "c1", model = number, xmint = as.numeric(model == 74), xrefval = if (model == 74) c(0, 1) else 999,
    hc = hc, boot = 1000, seed = 1, decimals = 12.8, progress = 0))
  if (any(grepl("^ERROR", out))) stop(sprintf("model %d: %s", model, paste(grep("^ERROR", out, value = TRUE), collapse = "; ")))
  c(list(model = model, mediators = ms, w = uses_w, z = uses_z, hc = if (hc == 5) "none" else paste0("HC", hc),
         conditioning = "percentiles 16/50/84"), parse_output(out))
}
put <- function(res, file) write(toJSON(res, auto_unbox = TRUE, digits = NA, pretty = TRUE, null = "null"), file)

for (model in c(moderation, parallel, 80:82, serial)) {
  if (!grepl(only, as.character(model))) next
  res <- run_model(model)
  put(res, file.path(root, sprintf("model%02d.json", model)))
  cat(sprintf("model %d: %d equations, %d indirect, %d indices\n", model, length(res$equations), length(res$indirect), length(res$indices)))
}

# Heteroskedasticity-consistent standard errors (PROCESS's hc option).
dir.create(file.path(root, "hc"), showWarnings = FALSE)
for (model in c(1, 3, 7, 14)) for (hc in 0:4) {
  if (!grepl(only, as.character(model))) next
  put(run_model(model, hc), file.path(root, "hc", sprintf("model%02d_hc%d.json", model, hc)))
}
cat("HC references written\n")
