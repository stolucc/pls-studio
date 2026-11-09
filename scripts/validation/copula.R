# Reference results for Gaussian copula terms in a PLS-SEM model, from plain
# package calls (independent of PLS Studio's code), on seminr's mobi data:
#   stage 1: estimate_pls without the terms; P* = qnorm(empirical CDF of the
#     predictor's construct scores), as REndo::copulaCorrection (Park & Gupta 2012);
#   stage 2: estimate_pls with each P* as a single-item construct predicting the
#     outcome (Hult et al. 2018).
# And nortest::cvm.test (Cramer-von Mises normality test) on fixed vectors.
#   R_LIBS=/path/to/lib Rscript scripts/validation/copula.R
suppressPackageStartupMessages({ library(seminr); library(nortest); library(jsonlite) })
d <- read.csv("src/engine/__fixtures__/mobi.csv")[, c(paste0("CUEX", 1:3), paste0("PERQ", 1:7), paste0("CUSA", 1:3), paste0("CUSL", 1:3))]
measurement <- function(extra = list()) do.call(constructs, c(list(
  composite("CUEX", multi_items("CUEX", 1:3)), composite("PERQ", multi_items("PERQ", 1:7)),
  composite("CUSA", multi_items("CUSA", 1:3)), composite("CUSL", multi_items("CUSL", 1:3))), extra))
stage1 <- suppressMessages(estimate_pls(d, measurement(), relationships(
  paths(from = c("CUEX", "PERQ"), to = "CUSA"), paths(from = "CUSA", to = "CUSL"))))
pstar <- function(v) { H <- stats::ecdf(v); U <- H(v); n <- length(v); U[U == 1] <- n / (n + 1); s <- stats::qnorm(U); s[s == 0] <- 1 - n / (n + 1); s }
d2 <- d; d2$pCUEX <- pstar(stage1$construct_scores[, "CUEX"]); d2$pPERQ <- pstar(stage1$construct_scores[, "PERQ"])
stage2 <- suppressMessages(estimate_pls(d2, measurement(list(composite("GCCUEX", single_item("pCUEX")), composite("GCPERQ", single_item("pPERQ")))), relationships(
  paths(from = c("CUEX", "PERQ", "GCCUEX", "GCPERQ"), to = "CUSA"), paths(from = "CUSA", to = "CUSL"))))
B <- stage2$path_coef
vectors <- list(a = c(1:10, 20, 40, 80), b = (1:20)^2, c = sin(1:40), d = cos((1:60)^2) + (1:60) / 60, e = stats::qnorm(stats::ppoints(40)))
out <- list(
  n = nrow(d),
  paths = list(CUEX_CUSA = B["CUEX", "CUSA"], PERQ_CUSA = B["PERQ", "CUSA"], GC_CUEX_CUSA = B["GCCUEX", "CUSA"], GC_PERQ_CUSA = B["GCPERQ", "CUSA"], CUSA_CUSL = B["CUSA", "CUSL"]),
  r2 = stage2$rSquared["Rsq", "CUSA"],
  pstarHead = pstar(stage1$construct_scores[, "CUEX"])[1:10],
  cvm = lapply(vectors, function(x) { t <- cvm.test(x); list(x = x, statistic = unname(t$statistic), p = t$p.value) }))
write_json(out, "src/engine/__fixtures__/copula/reference.json", auto_unbox = TRUE, digits = 12, pretty = TRUE)
