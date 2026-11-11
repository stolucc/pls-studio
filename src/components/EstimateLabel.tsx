import { formatEstimate, significanceText, type FigureStyle } from '../figure/style';

/** An estimate on the canvas with its significance (stars or p, as the figure style asks); `text` replaces the number (a fixed value). */
export function EstimateText({
  figure,
  value,
  p,
  text,
}: {
  figure: FigureStyle;
  value: number;
  p: number | null;
  text?: string;
}) {
  const sig = p === null ? null : significanceText(figure, p);
  return (
    <>
      {text ?? formatEstimate(figure, value)}
      {sig && <span className="p">{sig}</span>}
    </>
  );
}
