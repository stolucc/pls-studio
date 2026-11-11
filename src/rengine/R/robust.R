# Robust, bootstrap and permutation alternatives on the basic-statistics and regression cards
# (JASP's robust t-tests and ANOVA, SPSS's Bootstrapping and STATS PERM):
# - trimmed means (WRS2, Mair & Wilcox): Yuen's test for two independent groups (yuen) and
#   for paired samples (yuend), the one-sample trimmed-mean t-test (Tukey & McLaughlin; its
#   standard error by WRS2::trimse), robust one-way (t1way) and two-way (t2way) ANOVA, with
#   WRS2's explanatory effect size;
# - bootstrap confidence intervals, percentile and BCa (boot, Canty & Ripley): mean
#   differences, correlations, regression coefficients (cases resampled);
# - permutation tests (coin, Hothorn et al.), Monte Carlo resampling: two-sample and k-sample
#   (oneway_test), paired and one-sample (symmetry_test: signs of the differences flipped),
#   Pearson (independence_test) and Spearman (spearman_test) correlations.
# All are two-sided. Each card adds the lines below to the script it runs and exports; the
# random draws are seeded by the project's seed.

#' The request's resampling options (`req$resampling`), or NULL when none is asked for.
#' `allow`: the options the card offers ("trimmed", "bootstrap", "permutation").
ps_rs_options <- function(req, allow) {
  o <- req$resampling
  if (is.null(o)) {
    return(NULL)
  }
  if (!is.list(o)) stop("Invalid resampling options in the request.")
  pick <- function(k) isTRUE(o[[k]]) && k %in% allow
  out <- list(
    trimmed = pick("trimmed"),
    bootstrap = pick("bootstrap"),
    permutation = pick("permutation")
  )
  if (!out$trimmed && !out$bootstrap && !out$permutation) {
    return(NULL)
  }
  trim <- ps_number(o$trim %||% 0.2, "trimming proportion")
  if (trim < 0 || trim >= 0.5) stop("The trimming proportion must be at least 0 and below 0.5.")
  resamples <- ps_number(o$resamples %||% 5000, "number of resamples")
  if (resamples < 100 || resamples > 1e5 || resamples != round(resamples)) {
    stop("The number of resamples must be a whole number from 100 to 100000.")
  }
  seed <- ps_number(o$seed %||% 1234, "seed")
  if (seed < 0 || seed > 2^31 || seed != round(seed)) stop("Invalid seed in the request.")
  c(out, list(trim = trim, resamples = as.integer(resamples), seed = as.integer(seed)))
}

#' A number as R code (all digits kept).
ps_rs_num <- function(x) format(x, digits = 15)

#' The R packages a script with these options loads.
ps_rs_packages <- function(o) {
  if (is.null(o)) {
    return(character(0))
  }
  c(if (o$trimmed) "WRS2", if (o$bootstrap) "boot", if (o$permutation) "coin")
}

#' Script lines for one t-test (`r`: the list the results go in). The data are in the script
#' variables of the t-test card: one sample `y` (test value `mu`); paired `x1`, `x2`, `dif`;
#' independent `y1`, `y2`, `y`, `gg`.
ps_rs_ttest_lines <- function(o, type, r, mu, conf) {
  if (is.null(o)) {
    return(character(0))
  }
  tr <- ps_rs_num(o$trim)
  cl <- ps_rs_num(conf)
  B <- o$resamples
  out <- character(0)
  if (o$trimmed) {
    out <- c(out, switch(type,
      one = c(
        sprintf("# Trimmed mean (%s trimmed from each end) against %s: the Tukey-McLaughlin t-test", tr, ps_rs_num(mu)),
        "tm <- list(n = length(y))",
        sprintf("tm$estimate <- mean(y, trim = %s)", tr),
        sprintf("tm$se <- WRS2::trimse(y, tr = %s)", tr),
        sprintf("tm$df <- tm$n - 2 * floor(%s * tm$n) - 1", tr),
        sprintf("tm$t <- (tm$estimate - %s) / tm$se", ps_rs_num(mu)),
        "tm$p <- 2 * pt(-abs(tm$t), tm$df)",
        sprintf("tm$ci <- tm$estimate + c(-1, 1) * qt((1 + %s) / 2, tm$df) * tm$se", cl),
        sprintf("%s$trimmed <- tm", r)
      ),
      paired = c(
        sprintf("# Yuen's test for paired samples on trimmed means (%s trimmed)", tr),
        sprintf("%s$trimmed <- WRS2::yuend(x1, x2, tr = %s, alpha = %s)", r, tr, ps_rs_num(1 - conf))
      ),
      independent = c(
        sprintf("# Yuen's test on trimmed means (%s trimmed), unequal variances", tr),
        sprintf(
          "%s$trimmed <- WRS2::yuen(y ~ gg, data = data.frame(y = y, gg = gg), tr = %s, alpha = %s)",
          r,
          tr,
          ps_rs_num(1 - conf)
        )
      )
    ))
  }
  if (o$bootstrap) {
    out <- c(
      out,
      sprintf("# Bootstrap interval of the %s (%d resamples; percentile and BCa)", switch(type,
        one = "mean",
        paired = "mean difference",
        independent = "difference of the means"
      ), B),
      sprintf("set.seed(%d)", o$seed),
      switch(type,
        one = sprintf("bt <- boot::boot(y, function(d, i) mean(d[i]), R = %d)", B),
        paired = sprintf("bt <- boot::boot(dif, function(d, i) mean(d[i]), R = %d)", B),
        independent = c(
          "# (cases resampled within each group)",
          "bd <- data.frame(y = y, g = gg)",
          "mean_diff <- function(d, i) {",
          "  m <- tapply(d$y[i], d$g[i], mean)",
          "  m[[1]] - m[[2]]",
          "}",
          sprintf("bt <- boot::boot(bd, mean_diff, R = %d, strata = bd$g)", B)
        )
      ),
      sprintf("%s$boot <- list(t0 = bt$t0, sd = sd(bt$t), ci = boot::boot.ci(bt, conf = %s, type = c(\"perc\", \"bca\")))", r, cl)
    )
  }
  if (o$permutation) {
    out <- c(
      out,
      sprintf("# Permutation test (%d Monte Carlo resamples)", B),
      sprintf("set.seed(%d)", o$seed),
      switch(type,
        one = c(
          "# (one sample: the signs of the differences from the test value flipped at random)",
          sprintf(
            "pd <- data.frame(d = c(y - %s, rep(0, length(y))), side = factor(rep(1:2, each = length(y))), id = factor(rep(seq_along(y), 2)))",
            ps_rs_num(mu)
          ),
          sprintf("ptest <- coin::symmetry_test(d ~ side | id, data = pd, distribution = coin::approximate(nresample = %d))", B)
        ),
        paired = c(
          "# (paired: the two values of each pair swapped at random)",
          "pd <- data.frame(d = c(x1, x2), side = factor(rep(1:2, each = length(x1))), id = factor(rep(seq_along(x1), 2)))",
          sprintf("ptest <- coin::symmetry_test(d ~ side | id, data = pd, distribution = coin::approximate(nresample = %d))", B)
        ),
        independent = sprintf(
          "ptest <- coin::oneway_test(y ~ gg, data = data.frame(y = y, gg = gg), distribution = coin::approximate(nresample = %d))",
          B
        )
      ),
      sprintf("%s$perm <- list(z = as.numeric(coin::statistic(ptest)), p = as.numeric(coin::pvalue(ptest)))", r)
    )
  }
  out
}

#' A boot.ci result as numbers: the estimate, bootstrap SE, percentile and BCa limits.
ps_rs_boot_out <- function(b) {
  if (is.null(b)) {
    return(NULL)
  }
  list(
    estimate = unname(b$t0),
    se = b$sd,
    percLow = b$ci$percent[4],
    percHigh = b$ci$percent[5],
    bcaLow = b$ci$bca[4],
    bcaHigh = b$ci$bca[5]
  )
}

#' The t-test row's robust, bootstrap and permutation results (each NULL when not run).
ps_rs_ttest_out <- function(r, type) {
  tm <- r$trimmed
  trimmed <- if (is.null(tm)) {
    NULL
  } else if (type == "one") {
    list(estimate = tm$estimate, se = tm$se, t = tm$t, df = tm$df, p = tm$p, ciLow = tm$ci[1], ciHigh = tm$ci[2])
  } else {
    list(
      estimate = tm$diff,
      se = if (is.null(tm$se)) abs(tm$diff / tm$test) else tm$se,
      t = tm$test,
      df = tm$df,
      p = tm$p.value,
      ciLow = tm$conf.int[1],
      ciHigh = tm$conf.int[2],
      effsize = tm$effsize
    )
  }
  list(
    trimmed = trimmed,
    bootstrap = ps_rs_boot_out(r$boot),
    permutation = r$perm
  )
}

#' Script lines of the ANOVA card's alternatives: robust one-way (t1way) or two-way (t2way)
#' ANOVA on trimmed means, and the k-sample permutation test of one factor. `y`, `fac`: the
#' R names of the outcome and the factors (columns of `data`, already factors).
ps_rs_anova_lines <- function(o, y, fac, conf) {
  if (is.null(o)) {
    return(character(0))
  }
  tr <- ps_rs_num(o$trim)
  out <- character(0)
  if (o$trimmed) {
    out <- c(
      out,
      if (length(fac) == 1) {
        c(
          sprintf("# Robust one-way ANOVA on trimmed means (%s trimmed; Welch-type, WRS2::t1way)", tr),
          "# (its effect size's interval is a bootstrap: seeded)",
          sprintf("set.seed(%d)", o$seed),
          sprintf(
            "robust <- WRS2::t1way(%s ~ %s, data = data, tr = %s, alpha = %s, nboot = 100)",
            y,
            fac,
            tr,
            ps_rs_num(1 - conf)
          )
        )
      } else {
        c(
          sprintf("# Robust two-way ANOVA on trimmed means (%s trimmed; WRS2::t2way)", tr),
          sprintf("robust <- WRS2::t2way(%s ~ %s * %s, data = data, tr = %s)", y, fac[1], fac[2], tr)
        )
      }
    )
  }
  if (o$permutation) {
    out <- c(
      out,
      sprintf("# Permutation test of %s (%d Monte Carlo resamples)", fac[1], o$resamples),
      sprintf("set.seed(%d)", o$seed),
      sprintf(
        "perm <- coin::oneway_test(%s ~ %s, data = data, distribution = coin::approximate(nresample = %d))",
        y,
        fac[1],
        o$resamples
      ),
      "perm <- list(stat = as.numeric(coin::statistic(perm)), p = as.numeric(coin::pvalue(perm)))"
    )
  }
  out
}

#' The ANOVA card's robust and permutation results. `fac`: the factors' names as the user sees them.
ps_rs_anova_out <- function(env, o, fac) {
  if (is.null(o)) {
    return(NULL)
  }
  rb <- env$robust
  robust <- if (is.null(rb)) {
    NULL
  } else if (length(fac) == 1) {
    list(list(
      term = fac[1],
      stat = rb$test,
      df1 = rb$df1,
      df2 = rb$df2,
      p = rb$p.value,
      effsize = rb$effsize,
      effsizeLow = rb$effsize_ci[1],
      effsizeHigh = rb$effsize_ci[2]
    ))
  } else {
    list(
      list(term = fac[1], stat = rb$Qa, p = rb$A.p.value),
      list(term = fac[2], stat = rb$Qb, p = rb$B.p.value),
      list(term = paste(fac[1], "×", fac[2]), stat = rb$Qab, p = rb$AB.p.value)
    )
  }
  list(
    trim = o$trim,
    resamples = o$resamples,
    seed = o$seed,
    robust = robust,
    permutation = if (is.null(env$perm)) NULL else c(list(term = fac[1]), env$perm)
  )
}

#' Script lines of the correlation card's alternatives, for every pair (`pairs`, `data` and
#' `method` as the card's script has them): bootstrap intervals of r, permutation tests.
ps_rs_cor_lines <- function(o, method, conf) {
  if (is.null(o)) {
    return(character(0))
  }
  B <- o$resamples
  out <- c("pair_data <- function(p) { ok <- complete.cases(data[[p[1]]], data[[p[2]]]); data.frame(x = data[[p[1]]][ok], y = data[[p[2]]][ok]) }")
  if (o$bootstrap) {
    out <- c(
      out,
      sprintf("# Bootstrap intervals of each correlation (%d resamples of the cases; percentile and BCa)", B),
      sprintf("set.seed(%d)", o$seed),
      "boots <- lapply(pairs, function(p) {",
      "  d <- pair_data(p)",
      sprintf("  bt <- boot::boot(d, function(d, i) cor(d$x[i], d$y[i], method = \"%s\"), R = %d)", method, B),
      sprintf("  list(t0 = bt$t0, sd = sd(bt$t), ci = boot::boot.ci(bt, conf = %s, type = c(\"perc\", \"bca\")))", ps_rs_num(conf)),
      "})"
    )
  }
  if (o$permutation) {
    test <- if (method == "spearman") "spearman_test" else "independence_test"
    out <- c(
      out,
      sprintf("# Permutation tests of each correlation (coin::%s, %d Monte Carlo resamples)", test, B),
      sprintf("set.seed(%d)", o$seed),
      "perms <- lapply(pairs, function(p) {",
      sprintf("  ptest <- coin::%s(x ~ y, data = pair_data(p), distribution = coin::approximate(nresample = %d))", test, B),
      "  list(z = as.numeric(coin::statistic(ptest)), p = as.numeric(coin::pvalue(ptest)))",
      "})"
    )
  }
  out
}

#' Script lines of the regression card's bootstrap: every coefficient of the linear model
#' `fml` refitted on resampled cases (percentile and BCa intervals).
ps_rs_regression_lines <- function(o, fml, conf) {
  if (is.null(o) || !o$bootstrap) {
    return(character(0))
  }
  c(
    sprintf("# Bootstrap intervals of the coefficients (%d resamples of the cases; percentile and BCa)", o$resamples),
    sprintf("set.seed(%d)", o$seed),
    sprintf("bt <- boot::boot(data, function(d, i) coef(lm(%s, data = d[i, ])), R = %d)", fml, o$resamples),
    "boots <- lapply(seq_along(bt$t0), function(j) {",
    sprintf(
      "  list(t0 = bt$t0[j], sd = sd(bt$t[, j], na.rm = TRUE), ci = boot::boot.ci(bt, conf = %s, type = c(\"perc\", \"bca\"), index = j))",
      ps_rs_num(conf)
    ),
    "})",
    "names(boots) <- names(bt$t0)"
  )
}
