// The hover help of the fit tables: an info button beside each fit index's name (HelpTip), with
// the text of reporting/fitHelp.ts.

import { citeText } from '../../reporting/citations';
import { DYNAMIC_TEXT, FIT_HELP, type FitHelpId } from '../../reporting/fitHelp';
import { HelpTip } from '../HelpTip';
import type { Row } from './Table';

/** The tooltip text of one fit index. */
export function FitHelpText({ id }: { id: FitHelpId }) {
  const h = FIT_HELP[id];
  return (
    <>
      <p className="help-tip-title">{h.title}</p>
      <p>{h.measures}</p>
      <p>
        <span className="help-tip-k">How to read: </span>
        {h.read}
      </p>
      {h.cutoff && (
        <p>
          <span className="help-tip-k">Cutoff: </span>
          {h.cutoff}
        </p>
      )}
      {h.caveat && (
        <p>
          <span className="help-tip-k">Caveat: </span>
          {h.caveat}
        </p>
      )}
      {h.dynamic && <p>{DYNAMIC_TEXT}</p>}
      {h.sources.length > 0 && (
        <p className="help-tip-src">Sources: {h.sources.map((k) => citeText(k)).join('; ')}.</p>
      )}
    </>
  );
}

/** The info button of one fit index. */
export function FitHelpTip({ id }: { id: FitHelpId }) {
  return (
    <HelpTip label={FIT_HELP[id].title}>
      <FitHelpText id={id} />
    </HelpTip>
  );
}

/** The rows with an info button beside each first cell whose label has help in `labels`. */
export function withFitHelp(rows: Row[], labels: Record<string, FitHelpId>): Row[] {
  return rows.map((row) => {
    const first = row[0];
    const label = first?.v;
    const id =
      typeof label === 'string' && Object.hasOwn(labels, label) ? labels[label] : undefined;
    if (!id) return row;
    return [{ ...first, tip: <FitHelpTip id={id} /> }, ...row.slice(1)];
  });
}
