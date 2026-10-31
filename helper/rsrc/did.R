# Difference-in-differences. Two designs: a treated group and a post period
# (two-way fixed effects by fixest, with an event study around the first
# treated period and a pre-trend test), or staggered adoption (Callaway &
# Sant'Anna 2021 by did: group-time ATTs aggregated overall and by time since
# treatment, with did's pre-test of parallel trends). Estimation is the
# package's; this file writes the script and shapes the output.

ps_did <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  design <- req$design %||% "twfe"
  if (!design %in% c("twfe", "staggered")) stop("Invalid design in the request.")
  y <- req$outcome; id <- req$unit; tm <- req$time; tr <- req$treated
  post <- req$post %||% ""; covs <- unlist(req$covariates)
  if (!all(nzchar(c(y, id, tm, tr)))) stop("Choose the outcome, the unit, the time and the treatment columns.")
  first <- req$firstPeriod
  control <- req$control %||% "nevertreated"
  if (!control %in% c("nevertreated", "notyettreated")) stop("Invalid control group in the request.")
  event <- isTRUE(req$eventStudy)
  seed <- as.integer(req$seed %||% 1); conf <- ps_number(req$confidence %||% 0.95, "confidence level")
  cols <- unique(c(y, id, tm, tr, if (nzchar(post)) post, covs))
  fr <- ps_long_frame(req, cols)
  v <- fr$v; Y <- v[[y]]; ID <- v[[id]]; TM <- v[[tm]]; TR <- v[[tr]]; X <- unname(v[covs])
  xs <- if (length(X)) paste(X, collapse = " + ") else NULL
  z <- qnorm(1 - (1 - conf) / 2)
  if (design == "twfe") {
    if (!nzchar(post) && (is.null(first) || !is.finite(first))) stop("Give the post-treatment indicator, or the first treated period.")
    P <- if (nzchar(post)) v[[post]] else "post"
    body <- c("suppressPackageStartupMessages(library(fixest))",
      sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(Y, ID, TM, TR, if (nzchar(post)) P, X))),
      sprintf("# Treated group: the higher of the two values of %s.", ps_comment(tr)),
      sprintf("vals <- sort(unique(data$%s)); if (length(vals) != 2) stop(\"The treatment group column must have exactly two values.\")", TR),
      sprintf("data$%s <- as.integer(data$%s == vals[2])", TR, TR),
      if (!nzchar(post)) sprintf("data$post <- as.integer(data$%s >= %s)  # post-treatment periods", TM, ps_num(first)),
      "# Two-way fixed effects (unit and period), standard errors clustered by unit.",
      sprintf("est <- feols(%s ~ %s:%s%s | %s + %s, data = data, cluster = ~%s)", Y, TR, P, if (!is.null(xs)) paste0(" + ", xs) else "", ID, TM, ID),
      if (event) c(
        "# Event study: the treated group's deviation in each period, relative to the last pre-treatment period.",
        sprintf("ref <- %s", if (!is.null(first) && is.finite(first)) ps_num(first - 1) else sprintf("max(data$%s[data$post == 0])", TM)),
        sprintf("es <- feols(%s ~ i(%s, %s, ref)%s | %s + %s, data = data, cluster = ~%s)", Y, TM, TR, if (!is.null(xs)) paste0(" + ", xs) else "", ID, TM, ID),
        "# Pre-trends: are the pre-treatment deviations jointly zero?",
        sprintf("evn <- grep(\"^%s::\", names(coef(es)), value = TRUE)", TM),
        sprintf("pre <- evn[as.numeric(sub(\"^%s::([^:]+):.*$\", \"\\\\1\", evn)) < ref]", TM),
        "pretrend <- if (length(pre)) wald(es, keep = paste0(\"^\", gsub(\"([.|()\\\\^{}+$*?]|\\\\[|\\\\])\", \"\\\\\\\\\\\\1\", pre), \"$\"), print = FALSE) else NULL"))
    inputs <- list(data = fr$data)
    if (export) return(paste(ps_script("Difference-in-differences (fixest, two-way fixed effects)", "fixest", inputs, body, c("summary(est)", if (event) c("summary(es)", "iplot(es)", "pretrend"))), collapse = "\n"))
    env <- ps_run(body, inputs)
    ct <- fixest::coeftable(env$est)
    k <- grep(sprintf("^%s:%s$|^%s:%s$", TR, P, P, TR), rownames(ct))
    if (!length(k)) stop("The treatment-by-post term could not be estimated (is the treatment constant within periods?).")
    att <- list(est = ct[k, 1], se = ct[k, 2], t = ct[k, 3], p = ct[k, 4], ciLow = ct[k, 1] - z * ct[k, 2], ciHigh = ct[k, 1] + z * ct[k, 2])
    ev <- NULL; pt <- NULL
    if (event) {
      ce <- fixest::coeftable(env$es)
      rows <- grep(sprintf("^%s::", TM), rownames(ce))
      times <- as.numeric(sub(sprintf("^%s::([^:]+):.*$", TM), "\\1", rownames(ce)[rows]))
      ev <- lapply(seq_along(rows), function(i) list(time = times[i], rel = times[i] - env$ref - 1, est = ce[rows[i], 1], se = ce[rows[i], 2], ciLow = ce[rows[i], 1] - z * ce[rows[i], 2], ciHigh = ce[rows[i], 1] + z * ce[rows[i], 2]))
      ev <- c(ev, list(list(time = env$ref, rel = -1, est = 0, se = 0, ciLow = 0, ciHigh = 0)))
      ev <- ev[order(vapply(ev, function(e) e$time, 0))]
      if (!is.null(env$pretrend)) pt <- list(stat = unname(env$pretrend$stat), df1 = unname(env$pretrend$df1), df2 = unname(env$pretrend$df2), p = unname(env$pretrend$p))
    }
    d <- env$data
    ps_json(list(design = "twfe", att = att, event = ev, preTrend = pt, n = nrow(d), units = length(unique(d[[ID]])), periods = length(unique(d[[TM]])),
      treatedUnits = length(unique(d[[ID]][d[[TR]] == 1])), warnings = env$.warnings, engine = list(package = "fixest", version = as.character(utils::packageVersion("fixest")))))
  } else {
    body <- c("suppressPackageStartupMessages(library(did))",
      sprintf("data <- data[complete.cases(data[, %s]), ]", ps_q(c(Y, ID, TM, TR, X))),
      sprintf("# %s: the first period in which a unit is treated (0 for never treated).", ps_comment(tr)),
      sprintf("set.seed(%d)  # (did bootstraps its standard errors)", seed),
      "# Group-time average treatment effects (Callaway & Sant'Anna 2021), then aggregated.",
      sprintf("out <- att_gt(yname = \"%s\", tname = \"%s\", idname = \"%s\", gname = \"%s\", xformla = %s, data = data, control_group = \"%s\", alp = %s)",
        Y, TM, ID, TR, if (is.null(xs)) "NULL" else paste0("~", xs), control, ps_num(1 - conf)),
      "overall <- aggte(out, type = \"simple\")   # one ATT over all treated groups and periods",
      if (event) "dynamic <- aggte(out, type = \"dynamic\")  # by length of exposure (event study)")
    inputs <- list(data = fr$data)
    if (export) return(paste(ps_script("Difference-in-differences with staggered adoption (did, Callaway & Sant'Anna)", "did", inputs, body, c("summary(out)", "summary(overall)", if (event) c("summary(dynamic)", "ggdid(dynamic)"))), collapse = "\n"))
    env <- ps_run(body, inputs)
    out <- env$out; ov <- env$overall
    att <- list(est = ov$overall.att, se = ov$overall.se, t = ov$overall.att / ov$overall.se, p = 2 * pnorm(-abs(ov$overall.att / ov$overall.se)),
      ciLow = ov$overall.att - z * ov$overall.se, ciHigh = ov$overall.att + z * ov$overall.se)
    gt <- lapply(seq_along(out$att), function(i) list(group = out$group[i], time = out$t[i], est = out$att[i], se = out$se[i]))
    ev <- NULL
    if (event) { dy <- env$dynamic; cv <- if (is.finite(dy$crit.val.egt)) dy$crit.val.egt else z
      ev <- lapply(seq_along(dy$egt), function(i) list(time = NA, rel = dy$egt[i], est = dy$att.egt[i], se = dy$se.egt[i], ciLow = dy$att.egt[i] - cv * dy$se.egt[i], ciHigh = dy$att.egt[i] + cv * dy$se.egt[i])) }
    pt <- if (!is.null(out$Wpval) && is.finite(out$Wpval)) list(stat = unname(out$W), p = unname(out$Wpval)) else NULL
    d <- env$data
    ps_json(list(design = "staggered", att = att, event = ev, groupTime = gt, preTrend = pt, n = nrow(d), units = length(unique(d[[ID]])), periods = length(unique(d[[TM]])),
      treatedUnits = length(unique(d[[ID]][d[[TR]] > 0])), control = control, warnings = env$.warnings, engine = list(package = "did", version = as.character(utils::packageVersion("did")))))
  }
}
