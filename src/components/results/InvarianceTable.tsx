// The invariance sequence (configural → metric → scalar → strict) as one table: fit at each level and the difference
// tests against the level before. Shared by the multigroup sequence (CB-SEM tab Groups) and the longitudinal card.

import type { ReactNode } from 'react';
import { fmtP, stars } from '../../format';
import type { InvarianceResult } from '../../rengine/lavaan';
import { c, Table } from './Table';

export function InvarianceTable({
  inv,
  title,
  file,
  constraints,
}: {
  inv: Pick<InvarianceResult, 'robust' | 'levels'>;
  title: string;
  file: string;
  /** What each level holds equal, and across what. */ constraints: ReactNode;
}) {
  const d = (v: number | undefined, digits = 3) => (v === undefined ? c(null) : c(v, '', digits));
  return (
    <Table
      title={title}
      file={file}
      columns={['Model', 'χ²', 'df', 'CFI', 'RMSEA', 'SRMR', 'Δχ²', 'Δdf', 'p', 'ΔCFI', 'ΔRMSEA']}
      rows={inv.levels.map((l) => [
        c(l.level),
        c(l.chisq),
        c(l.df, '', 0),
        c(l.cfi),
        c(l.rmsea),
        c(l.srmr),
        d(l.chisqDiff),
        d(l.dfDiff, 0),
        // A significant difference means the added equalities do not hold: a warning, not a success.
        l.p === undefined
          ? c(null)
          : { v: `${fmtP(l.p)} ${stars(l.p)}`, cls: l.p < 0.05 ? 'bad' : 'dim' },
        l.cfiChange === undefined ? c(null) : c(l.cfiChange, l.cfiChange < -0.01 ? 'bad' : 'good'),
        d(l.rmseaChange),
      ])}
      note={
        <>
          {constraints} Δχ²: difference test
          {inv.robust ? ' (scaled, for the robust estimator)' : ''} against the previous model. A
          drop in CFI of more than .01 (red) suggests non-invariance (Cheung &amp; Rensvold, 2002;
          Chen, 2007).
        </>
      }
    />
  );
}
