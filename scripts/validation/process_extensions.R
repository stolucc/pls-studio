# Reference results for PROCESS extensions: a dichotomous outcome (logistic
# regression for Y), a multicategorical X (indicator, sequential, Helmert and
# effect coding), and model 74's counterfactual effects (X by M interaction).
# Like process_reference.R, it runs the user's own copy of PROCESS:
#
#   Rscript scripts/validation/process_extensions.R ~/Downloads/process.R

suppressMessages(library(jsonlite))
args <- commandArgs(TRUE)
if (!length(args) || !file.exists(args[1])) stop("Pass the path of PROCESS's process.R.")
local({
  capture.output(source(args[1], local = TRUE))
  process <<- process
})
root <- "src/process/__fixtures__/reference"
d <- read.csv(file.path(root, "data.csv"))
d$ybin <- as.integer(d$y > median(d$y))
d$xcat <- as.integer(cut(d$x, quantile(d$x, c(0, 1 / 3, 2 / 3, 1)), include.lowest = TRUE))
d$xbin <- as.integer(d$x > 0)
write.csv(d, file.path(root, "data_ext.csv"), row.names = FALSE)
run <- function(...) capture.output(process(data = d, cov = "c1", boot = 1000, seed = 1, decimals = 12.8, progress = 0, ...))
words <- function(s) strsplit(trimws(s), "\\s+")[[1]]

# Coefficients of each outcome's equation (first column block), products named by their variables.
equations <- function(out) {
  res <- list()
  starts <- grep("^Outcome Variable:", out)
  for (s in starts) {
    outcome <- trimws(sub("^Outcome Variable:", "", out[s]))
    m <- grep("^Model:", out)
    m <- m[m > s][1]
    i <- m + 2
    coef <- list()
    while (nzchar(trimws(out[i])) && length(words(out[i])) >= 6) {
      w <- words(out[i])
      coef[[w[1]]] <- as.numeric(w[2])
      i <- i + 1
    }
    nxt <- c(starts[starts > s], length(out))[1]
    key <- grep("^Product terms key:", out)
    key <- key[key > s & key < nxt]
    if (length(key)) {
      j <- key + 1
      while (grepl("^int_[0-9]+\\s*:", out[j])) {
        p <- strsplit(out[j], ":")[[1]]
        f <- words(p[2])
        names(coef)[names(coef) == trimws(p[1])] <- paste(f[seq(1, length(f), by = 2)], collapse = "*")
        j <- j + 1
      }
    }
    summ <- grep("^Model Summary:", out)
    summ <- summ[summ > s][1]
    res[[outcome]] <- list(coef = coef, summaryHeader = words(out[summ + 1]), summary = as.numeric(words(out[summ + 2])))
  }
  res
}
# Effect tables: rows of numbers, optionally led by a dummy label (X1, X2, ...).
effect_rows <- function(out, start) {
  i <- start + 1
  header <- words(out[i])
  i <- i + 1
  rows <- list()
  while (i <= length(out) && nzchar(trimws(out[i]))) {
    w <- words(out[i])
    lab <- if (is.na(suppressWarnings(as.numeric(w[1])))) w[1] else NA
    nums <- as.numeric(if (is.na(lab)) w else w[-1])
    if (any(is.na(nums))) break
    rows[[length(rows) + 1]] <- list(label = lab, values = nums)
    i <- i + 1
  }
  list(header = header, rows = rows)
}

out <- list()
# ---- dichotomous Y ----
for (model in c(4, 7, 14)) {
  o <- run(y = "ybin", x = "x", m = "m1", w = if (model == 4) "xxxxx" else "w", model = model)
  ind <- grep("^INDIRECT EFFECT:", o)
  ui <- grep("^Indirect effect\\(s\\) of X on Y:", o)
  out[[sprintf("binary_model%d", model)]] <- list(
    model = model, y = "ybin", equations = equations(o),
    direct = effect_rows(o, grep("^(Conditional )?[Dd]irect effect", o)[1]),
    indirect = if (length(ind)) effect_rows(o, ind[1] + 3) else effect_rows(o, ui[1]),
    index = {
      j <- grep("Index of moderated mediation", o)
      if (length(j)) effect_rows(o, j[1]) else NULL
    }
  )
}
# ---- multicategorical X ----
for (mcx in 1:4) {
  o <- run(y = "y", x = "xcat", m = "m1", model = 4, mcx = mcx)
  out[[sprintf("mcx%d_model4", mcx)]] <- list(
    model = 4, mcx = mcx, equations = equations(o),
    coding = effect_rows(o, grep("^Coding of categorical X", o)[1]),
    direct = effect_rows(o, grep("^Relative direct effects of X on Y", o)[1]),
    indirect = {
      j <- grep("^Relative indirect effects of X on Y", o)[1]
      h <- grep("^\\s+Effect", o)
      effect_rows(o, h[h > j][1] - 1)
    }
  )
}
o <- run(y = "y", x = "xcat", m = "m1", w = "w", model = 7, mcx = 1)
ind <- grep("^INDIRECT EFFECT:", o)
out$mcx1_model7 <- list(
  model = 7, mcx = 1, equations = equations(o),
  indirect = effect_rows(o, ind[1] + 3),
  index = lapply(grep("Index of moderated mediation", o), function(j) effect_rows(o, j))
)
# ---- model 74: X by M interaction, counterfactual effects ----
o <- run(y = "y", x = "xbin", m = "m1", model = 4, xmint = 1, xrefval = c(0, 1))
num1 <- function(pat, k = 2) as.numeric(words(o[grep(pat, o)[1] + k])[1])
out$model74 <- list(
  model = 74, equations = equations(o), xref = 0, xcf = 1,
  pnde = num1("^\\(Pure\\) Natural direct effect"), cde = num1("^Controlled direct effect"),
  tnie = num1("^ \\(Total\\) Natural indirect effect", 5)
)
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), file.path(root, "extensions.json"))
cat("written:", paste(names(out), collapse = ", "), "\n")
