// The plot area behind a chart's marks, for the chart themes (chartStyle.ts): invisible in the app's own
// theme, ggplot2's grey panel in theme_grey, a bordered white panel in theme_bw and the x and y axis lines in
// theme_classic (styles.css, .chart-frame[data-chart-theme]). Charts draw it first, under the grid lines.

export function PlotPanel({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <g className="plot-panel-group" aria-hidden="true">
      <rect
        className="plot-panel"
        x={x}
        y={y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
      />
      <path className="plot-axes" d={`M ${x} ${y} V ${y + height} H ${x + width}`} />
    </g>
  );
}
