// The key of a chart with more than one colour: inside the SVG (so an exported
// figure keeps it), one swatch and label per series, in rows that wrap to the
// chart's width. Charts reserve legendHeight above the plot and draw SvgLegend
// there; the swatch shows the series' mark (a line, a dashed line, a box or a
// dot), so identity never rests on colour alone where marks differ.

export type LegendMark = 'line' | 'dash' | 'box' | 'dot';

export interface LegendItem {
  label: string;
  color: string;
  mark?: LegendMark;
  /** A line's own dash pattern (SVG stroke-dasharray), for series told apart by line type. */
  dash?: string;
}

const ROW = 16;
const SWATCH = 22;
const GAP = 14;
/** Width of a label, estimated from its length (the chart font at about 11px). */
const textWidth = (s: string) => s.length * 6.2;

/** Each item's position in rows of at most `width`, from (0, 0). */
export function legendLayout(items: LegendItem[], width: number): { x: number; row: number }[] {
  const out: { x: number; row: number }[] = [];
  let x = 0;
  let row = 0;
  for (const it of items) {
    const w = SWATCH + 5 + textWidth(it.label);
    if (x > 0 && x + w > width) {
      x = 0;
      row++;
    }
    out.push({ x, row });
    x += w + GAP;
  }
  return out;
}

/** The height a legend takes (0 when there is nothing to tell apart: fewer than two items). */
export function legendHeight(items: LegendItem[], width: number): number {
  if (items.length < 2) return 0;
  const rows = Math.max(...legendLayout(items, width).map((p) => p.row)) + 1;
  return rows * ROW + 6;
}

function Swatch({ color, mark = 'line', dash }: Pick<LegendItem, 'color' | 'mark' | 'dash'>) {
  const y = -4;
  if (mark === 'box') return <rect x={0} y={y - 5} width={10} height={10} rx={2} fill={color} />;
  if (mark === 'dot') return <circle cx={5} cy={y} r={4} fill={color} />;
  return (
    <line
      x1={0}
      x2={SWATCH}
      y1={y}
      y2={y}
      stroke={color}
      strokeWidth={2}
      strokeDasharray={dash || (mark === 'dash' ? '4 3' : undefined)}
    />
  );
}

/** The legend with its top-left at (x, y), wrapping at `width`; nothing for fewer than two items. */
export function SvgLegend({
  items,
  x,
  y,
  width,
}: {
  items: LegendItem[];
  x: number;
  y: number;
  width: number;
}) {
  if (items.length < 2) return null;
  const at = legendLayout(items, width);
  return (
    <g className="chart-legend" role="list" aria-label="Legend">
      {items.map((it, i) => (
        <g
          key={`${it.label}-${i}`}
          role="listitem"
          transform={`translate(${x + at[i].x} ${y + at[i].row * ROW + 12})`}
        >
          <Swatch color={it.color} mark={it.mark} dash={it.dash} />
          <text x={SWATCH + 5} y={0}>
            {it.label}
          </text>
        </g>
      ))}
    </g>
  );
}
