# A chart of the app drawn by ggplot2: the chart describes itself (src/figure/ggplot.ts, a list of layers of
# numbers with their series, colours and line types, the axis titles and the chart style), and ps_ggplot writes
# the ggplot2 code for it. The code runs here and the figure comes back as a file (PDF, SVG or PNG), or comes
# back as a self-contained script (export) that draws the same figure in the user's R.
#
# Everything the request writes into the code is checked first: geoms, line types, themes, fonts and formats
# are looked up from fixed lists, colours must be #rrggbb, numbers numeric, and text (titles, series, labels)
# is quoted by ps_q or embedded as data (ps_embed_frame).

GG_GEOMS <- c("line", "step", "point", "rect", "area", "ribbon", "hline", "vline", "segment", "text")
GG_THEMES <- c(app = "theme_minimal", grey = "theme_grey", bw = "theme_bw", minimal = "theme_minimal", classic = "theme_classic")
GG_FONTS <- c(sans = "sans", serif = "serif", mono = "mono")
GG_LINETYPES <- c("solid", "dashed", "dotted")
# (geoms whose colour is a fill, and those drawn as lines, whose series also get a line type in the legend)
GG_FILLED <- c("rect", "area", "ribbon")
GG_LINES <- c("line", "step", "segment")
# The columns each geom reads, and the aesthetics they map to.
GG_COLUMNS <- list(
  line = c("x", "y"), step = c("x", "y"), point = c("x", "y"), area = c("x", "y"),
  rect = c("xmin", "xmax", "ymin", "ymax"), ribbon = c("x", "ymin", "ymax"),
  hline = "y", vline = "x", segment = c("x", "y", "xend", "yend"), text = c("x", "y", "label")
)
GG_MAX_VALUES <- 500000

#' One R string literal.
gg_q <- function(x) encodeString(x, quote = '"')

gg_text <- function(x, what, max = 300) {
  if (is.null(x)) {
    return("")
  }
  if (!(is.character(x) && length(x) == 1 && !is.na(x) && nchar(x) <= max)) {
    stop(sprintf("Invalid %s in the request.", what))
  }
  gsub("[[:cntrl:]]+", " ", x)
}

gg_pick <- function(x, allowed, what, default) {
  if (is.null(x)) {
    return(default)
  }
  if (!(is.character(x) && length(x) == 1 && x %in% allowed)) stop(sprintf("Invalid %s in the request.", what))
  x
}

gg_colour <- function(x) {
  if (!(is.character(x) && length(x) == 1 && grepl("^#[0-9a-fA-F]{6}$", x))) stop("Invalid colour in the request.")
  x
}

gg_numbers <- function(x, what) {
  x <- unlist(x)
  if (is.null(x)) {
    return(numeric(0))
  }
  # (JSON null becomes NA: a gap in a line)
  if (is.logical(x) && all(is.na(x))) x <- as.numeric(x)
  if (!is.numeric(x)) stop(sprintf("Invalid %s in the request.", what))
  x
}

gg_limits <- function(x, what) {
  x <- gg_numbers(x, what)
  if (!length(x)) {
    return(NULL)
  }
  if (length(x) != 2 || any(!is.finite(x))) stop(sprintf("Invalid %s in the request.", what))
  x
}

#' The checked layers: geom, series ("" when it has no legend entry), colour, line type and its data frame.
gg_layers <- function(raw) {
  if (!is.list(raw) || !length(raw) || length(raw) > 200) stop("Invalid layers in the request.")
  total <- 0
  lapply(raw, function(l) {
    geom <- gg_pick(l$geom, GG_GEOMS, "geom", NULL)
    cols <- GG_COLUMNS[[geom]]
    data <- lapply(setNames(cols, cols), function(k) {
      if (k == "label") vapply(unlist(l$label), gg_text, "", what = "label", max = 200) else gg_numbers(l[[k]], k)
    })
    n <- unique(lengths(data))
    if (length(n) != 1 || n == 0) stop("Invalid layer data in the request (columns of different lengths).")
    total <<- total + n * length(cols)
    if (total > GG_MAX_VALUES) stop("The chart has too many values to draw with ggplot2.")
    list(
      geom = geom,
      series = gg_text(l$series, "series", 200),
      colour = gg_colour(l$color),
      linetype = gg_pick(l$linetype, GG_LINETYPES, "line type", "solid"),
      open = isTRUE(l$open),
      alpha = if (is.null(l$alpha)) NULL else min(1, max(0, ps_number(l$alpha, "opacity"))),
      data = as.data.frame(data, stringsAsFactors = FALSE)
    )
  })
}

#' One geom_* line of the code for layer i (its data frame layer_<i>).
gg_geom_line <- function(l, i) {
  cols <- GG_COLUMNS[[l$geom]]
  named <- nzchar(l$series)
  colour_aes <- if (l$geom %in% GG_FILLED) "fill" else "colour"
  aes <- paste(c(
    sprintf("%s = %s", cols[cols != "label"], cols[cols != "label"]),
    if ("label" %in% cols) "label = label",
    if (named) sprintf("%s = series", colour_aes),
    if (named && l$geom %in% GG_LINES) "linetype = series"
  ), collapse = ", ")
  fixed <- c(
    if (!named) sprintf("%s = \"%s\"", colour_aes, l$colour),
    if (!named && l$geom %in% c(GG_LINES, "hline", "vline")) sprintf("linetype = \"%s\"", l$linetype),
    if (l$geom %in% c(GG_LINES, "hline", "vline")) "linewidth = 0.7",
    if (l$geom == "point") sprintf("size = 2, shape = %d", if (l$open) 1L else 16L),
    if (l$geom %in% c("rect", "area", "ribbon")) sprintf("alpha = %s", format(l$alpha %||% if (l$geom == "ribbon") 0.25 else 0.8)),
    if (l$geom == "rect") "colour = NA",
    if (l$geom == "text") "size = 3"
  )
  geom <- switch(l$geom, rect = "geom_rect", hline = "geom_hline", vline = "geom_vline", paste0("geom_", l$geom))
  aes_fn <- if (l$geom %in% c("hline", "vline")) {
    sprintf("aes(%s)", sub("^y = y$", "yintercept = y", sub("^x = x$", "xintercept = x", aes)))
  } else {
    sprintf("aes(%s)", aes)
  }
  sprintf("  %s(data = layer_%d, %s%s) +", geom, i, aes_fn, if (length(fixed)) paste0(", ", paste(fixed, collapse = ", ")) else "")
}

#' The code: the plot `p` built layer by layer, its scales, titles and theme.
gg_body <- function(req, layers) {
  series <- unique(unlist(lapply(layers, function(l) if (nzchar(l$series)) l$series)))
  colours <- vapply(series, function(s) Find(function(l) l$series == s, layers)$colour, "")
  types <- vapply(series, function(s) {
    lined <- Find(function(l) l$series == s && l$geom %in% GG_LINES, layers)
    if (is.null(lined)) "solid" else lined$linetype
  }, "")
  filled <- any(vapply(layers, function(l) nzchar(l$series) && l$geom %in% GG_FILLED, TRUE))
  lined <- any(vapply(layers, function(l) nzchar(l$series) && l$geom %in% GG_LINES, TRUE))
  stroked <- any(vapply(layers, function(l) nzchar(l$series) && !(l$geom %in% GG_FILLED), TRUE))
  manual <- function(scale, values) {
    sprintf(
      "  %s(values = c(%s), limits = %s, name = NULL) +",
      scale, paste(sprintf("%s = %s", gg_q(series), gg_q(values)), collapse = ", "), ps_q(series)
    )
  }
  x <- req$x %||% list()
  y <- req$y %||% list()
  xlim <- gg_limits(x$limits, "horizontal axis limits")
  ylim <- gg_limits(y$limits, "vertical axis limits")
  theme <- GG_THEMES[[gg_pick(req$theme, names(GG_THEMES), "theme", "app")]]
  font <- GG_FONTS[[gg_pick(req$font, names(GG_FONTS), "font", "sans")]]
  size <- min(30, max(6, ps_number(req$size %||% 11, "font size")))
  legend <- gg_pick(req$legend, c("top", "right", "bottom", "none"), "legend position", "top")
  c(
    "p <- ggplot() +",
    vapply(seq_along(layers), function(i) gg_geom_line(layers[[i]], i), ""),
    if (length(series) && stroked) manual("scale_colour_manual", colours),
    if (length(series) && filled) manual("scale_fill_manual", colours),
    if (length(series) && lined) manual("scale_linetype_manual", types),
    if (isTRUE(y$percent)) "  scale_y_continuous(labels = scales::label_percent()) +",
    if (!is.null(xlim) || !is.null(ylim)) {
      sprintf(
        "  coord_cartesian(%s) +",
        paste(c(
          if (!is.null(xlim)) sprintf("xlim = c(%s)", paste(format(xlim, digits = 15), collapse = ", ")),
          if (!is.null(ylim)) sprintf("ylim = c(%s)", paste(format(ylim, digits = 15), collapse = ", ")),
          "expand = FALSE"
        ), collapse = ", ")
      )
    },
    sprintf(
      "  labs(x = %s, y = %s) +",
      gg_q(gg_text(x$title, "axis title")), gg_q(gg_text(y$title, "axis title"))
    ),
    sprintf("  %s(base_size = %s, base_family = \"%s\") +", theme, format(size), font),
    sprintf("  theme(legend.position = \"%s\")", legend)
  )
}

ps_ggplot <- function(req_json, export = FALSE) {
  req <- ps_parse(req_json)
  layers <- gg_layers(req$layers)
  inputs <- setNames(lapply(layers, function(l) {
    d <- l$data
    if (nzchar(l$series)) d$series <- l$series
    d
  }), sprintf("layer_%d", seq_along(layers)))
  body <- gg_body(req, layers)
  width <- min(20, max(1, ps_number(req$width %||% 6, "width")))
  height <- min(20, max(1, ps_number(req$height %||% 4, "height")))
  format <- gg_pick(req$format, c("pdf", "svg", "png"), "format", "pdf")
  if (export) {
    title <- gg_text(req$title, "title")
    return(ps_script(
      sprintf("%s, drawn by ggplot2", if (nzchar(title)) title else "Chart"), "ggplot2", inputs,
      c("library(ggplot2)", "", body),
      c(
        "print(p)",
        sprintf("# ggsave(\"figure.pdf\", p, width = %s, height = %s)  # inches; .svg or .png as well", format(width), format(height))
      )
    ))
  }
  env <- ps_run(c("library(ggplot2)", body), inputs)
  file <- tempfile(fileext = paste0(".", format))
  on.exit(unlink(file), add = TRUE)
  if (format == "pdf") {
    grDevices::pdf(file, width = width, height = height)
  } else if (format == "svg") {
    if (requireNamespace("svglite", quietly = TRUE)) {
      svglite::svglite(file, width = width, height = height)
    } else if (isTRUE(capabilities("cairo"))) {
      grDevices::svg(file, width = width, height = height)
    } else {
      stop("An SVG from ggplot2 needs the svglite package (or R with cairo); PDF works without it.")
    }
  } else {
    grDevices::png(file, width = width, height = height, units = "in", res = 300)
  }
  tryCatch(print(env$p), finally = grDevices::dev.off())
  ps_json(list(
    format = format,
    data = jsonlite::base64_enc(readBin(file, "raw", file.size(file))),
    warnings = env$.warnings
  ))
}
