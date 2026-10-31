# Reference for the regression card (src/rengine/regression.webr.test.ts): the
# packages' documented examples, run natively. Also writes the two datasets
# that the help pages build inline (Dobson's trial from ?glm, the clotting
# times from ?glm) as CSV files shipped with the app.
#   Rscript scripts/validation/regression.R
suppressPackageStartupMessages({ library(MASS); library(nnet); library(jsonlite) })
options(contrasts = c("contr.treatment", "contr.poly"))
counts <- c(18,17,15,20,10,20,25,13,12); outcome <- gl(3,1,9); treatment <- gl(3,3)
write.csv(data.frame(counts, outcome = as.integer(outcome), treatment = as.integer(treatment)), "public/examples/regression/dobson.csv", row.names = FALSE)
clotting <- data.frame(u = c(5,10,15,20,30,40,60,80,100), lot1 = c(118,58,42,35,27,25,21,19,18), lot2 = c(69,35,26,21,18,16,13,12,12))
write.csv(clotting, "public/examples/regression/clotting.csv", row.names = FALSE)
tab <- function(fit) { s <- summary(fit)$coefficients; lapply(seq_len(nrow(s)), function(i) list(term = rownames(s)[i], est = s[i, 1], se = s[i, 2])) }
bwt <- with(birthwt, { race <- factor(race, labels = c("white", "black", "other")); ptd <- factor(ptl > 0); ftv <- factor(ftv); levels(ftv)[-(1:2)] <- "2+"
  data.frame(low = factor(low), age, lwt, race, smoke = (smoke > 0), ptd, ht = (ht > 0), ui = (ui > 0), ftv) })
m <- list(
  dobson = glm(counts ~ outcome + treatment, family = poisson()),
  clotting = glm(lot1 ~ log(u), data = clotting, family = Gamma),
  infert = glm(case ~ spontaneous + induced, data = infert, family = binomial()),
  menarche = glm(cbind(Menarche, Total - Menarche) ~ Age, binomial(link = probit), data = menarche),
  quine = glm.nb(Days ~ Sex/(Age + Eth*Lrn), data = quine),
  housing = polr(Sat ~ Infl + Type + Cont, weights = Freq, data = housing),
  birthwt = glm(low ~ ., binomial, bwt),
  multinom = multinom(low ~ ., bwt, trace = FALSE))
out <- lapply(names(m), function(k) { f <- m[[k]]
  r <- list(coefficients = if (k == "multinom") { s <- summary(f); lapply(seq_along(coef(f)), function(i) list(term = names(coef(f))[i], est = unname(coef(f)[i]), se = unname(s$standard.errors[i]))) } else tab(f),
    logLik = as.numeric(logLik(f)), aic = AIC(f))
  if (k == "quine") r$theta <- f$theta
  if (k == "housing") r$zeta <- as.list(f$zeta)
  if (inherits(f, "glm")) r$deviance <- deviance(f)
  r })
names(out) <- names(m)
out$versions <- list(R = R.version.string, MASS = as.character(packageVersion("MASS")), nnet = as.character(packageVersion("nnet")))
dir.create("src/engine/__fixtures__/regression", showWarnings = FALSE)
writeLines(toJSON(out, auto_unbox = TRUE, digits = NA, pretty = TRUE), "src/engine/__fixtures__/regression/reference.json")
cat("written\n"); for (k in names(m)) cat(k, ":", paste(sprintf("%s=%.4f", names(coef(m[[k]]))[1:min(3, length(coef(m[[k]])))], coef(m[[k]])[1:min(3, length(coef(m[[k]])))]), collapse = " "), "\n")
