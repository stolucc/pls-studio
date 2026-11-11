# Reference results for the NCA card's robustness checks, from the NCA package
# (Dul) on its own example (nca.example): the potential outliers of each
# ceiling as nca_outliers() lists them (k = 1), and for every listed case the
# exact effect sizes and permutation p-values (100 permutations) of both
# ceilings with that case removed, from nca_analysis() on the reduced data.
#
# Run it twice, once with each NCA version; each run updates its own part:
#   - NCA 5.x (current): the outlier lists (nca_outliers changed in 5.0: it now
#     also lists CR-FDH corner points that do not move the scope).
#   - NCA 4.0.2: the effect sizes and p-values with a case removed. NCA 5 draws
#     its permutations from a random offset (not reproducible) and counts
#     p = (k + 1) / (R + 1); the card follows NCA 4.0.2's reproducible test
#     (sample i after set.seed(i)), as the card's main fixture reference.json.
#   R_LIBS=/path/to/nca5:/path/to/lib Rscript scripts/validation/nca-outliers.R
#   R_LIBS=/path/to/nca4.0.2:/path/to/lib Rscript scripts/validation/nca-outliers.R

suppressPackageStartupMessages({
  library(jsonlite)
  library(NCA)
})
data(nca.example)

rep <- 100
ceilings <- c("ce_fdh", "cr_fdh")

# Effect sizes and p-values of both ceilings for one condition on (a subset of) the data.
effects <- function(d, j) {
  m <- nca_analysis(d, j, 3, ceilings = ceilings, test.rep = rep)
  p <- m$summaries[[1]]$params
  list(
    n = nrow(d),
    ce = p["Effect size", "ce_fdh"],
    pce = p["p-value", "ce_fdh"],
    cr = p["Effect size", "cr_fdh"],
    pcr = p["p-value", "cr_fdh"]
  )
}

conditions <- lapply(1:2, function(j) {
  lists <- lapply(ceilings, function(ceiling) {
    o <- suppressMessages(nca_outliers(nca.example, j, 3, ceiling = ceiling))
    # The app reads the CSV without row names: cases are row numbers.
    data.frame(
      case = match(o$outliers, rownames(nca.example)),
      d = o$eff.nw,
      change = o$dif.abs,
      percent = o$dif.rel,
      ceiling = o$ceiling == "X",
      scope = o$scope == "X"
    )
  })
  names(lists) <- ceilings
  cases <- unique(unlist(lapply(lists, `[[`, "case")))
  removed <- lapply(cases, function(i) c(list(case = i), effects(nca.example[-i, ], j)))
  list(
    x = names(nca.example)[j],
    all = effects(nca.example, j),
    outliers = lists,
    removed = removed
  )
})

file <- "src/engine/__fixtures__/nca/outliers.json"
out <- if (file.exists(file)) fromJSON(file, simplifyVector = FALSE) else list()
version <- as.character(packageVersion("NCA"))
if (packageVersion("NCA") >= "5.0.0") {
  out$listsVersion <- version
  out$lists <- lapply(conditions, function(k) list(x = k$x, outliers = k$outliers))
} else {
  out$effectsVersion <- version
  out$permutations <- rep
  out$effects <- lapply(conditions, function(k) list(x = k$x, all = k$all, removed = k$removed))
}
write(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), file)
cat("written\n")
