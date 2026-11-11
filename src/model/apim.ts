// The dyadic APIM (Kenny, Kashy & Cook 2006) as a CB-SEM diagram: each member's X and Y as an observed
// variable (one column) or a factor (its items), actor paths a1, a2 and partner paths p1, p2 (a and p for
// indistinguishable dyads), the members' X correlated and their Y disturbances correlated, and k := p / a.
// Factors are scaled by their first item; the items' loadings and intercepts are held equal across members
// (labels), and the same item's errors correlated. Indistinguishable dyads also hold equal the items' error
// variances, the X variances and means, and the Y residual variances and intercepts. The same model as the
// APIM card fits (R/apim.R, which scales by fixed factors instead): the same fit and k.

import {
  newId,
  type Construct,
  type Correlation,
  type DefinedParameter,
  type MeanTerm,
  type ModelState,
  type ParameterTerm,
  type Path,
} from './project';

export interface ApimRoles {
  x1: string[];
  x2: string[];
  y1: string[];
  y2: string[];
  dyads: 'distinguishable' | 'indistinguishable';
}

/** Why the roles cannot be drawn, or null. */
export function apimRolesError(o: ApimRoles): string | null {
  if (!o.x1.length || !o.x2.length || !o.y1.length || !o.y2.length)
    return 'Choose the columns of X and Y for both members.';
  if (o.x1.length !== o.x2.length) return 'Both members need the same number of X items.';
  if (o.y1.length !== o.y2.length) return 'Both members need the same number of Y items.';
  const all = [...o.x1, ...o.x2, ...o.y1, ...o.y2];
  if (new Set(all).size !== all.length) return 'Each column can play one role only.';
  if ([o.x1, o.x2, o.y1, o.y2].some((c) => c.length > 20)) return 'At most 20 items per variable.';
  return null;
}

const X_LEFT = 0;
const Y_LEFT = 560;
const TOP = 0;
const BOTTOM = 320;

/** The APIM diagram for the roles (call after apimRolesError passes). */
export function apimModel(o: ApimRoles): ModelState {
  const dist = o.dyads === 'distinguishable';
  const columns = new Set([...o.x1, ...o.x2, ...o.y1, ...o.y2]);
  const constructs: Construct[] = [];
  const parameters: ParameterTerm[] = [];
  const means: MeanTerm[] = [];
  const correlations: Correlation[] = [];

  /** A construct for one member's variable; `which`: "x" or "y", `member`: 1 or 2. */
  const add = (
    cols: string[],
    which: 'x' | 'y',
    member: 1 | 2,
    x: number,
    y: number,
  ): Construct => {
    const latent = cols.length > 1;
    let name = latent ? `${which.toUpperCase()}${member}` : cols[0];
    while (latent && columns.has(name)) name += '_lv';
    const c: Construct = {
      id: newId('c'),
      name,
      type: 'factor',
      mode: 'A',
      indicators: cols,
      x,
      y,
      side: which === 'x' ? 'left' : 'right',
    };
    if (latent) {
      // (items 2…K: loadings and intercepts labelled alike for both members; the first item is the marker)
      const loadings: Record<string, string> = {};
      cols.forEach((item, k) => {
        if (k > 0) loadings[item] = `l${which}${k + 1}`;
      });
      c.loadingLabels = loadings;
      cols.forEach((item, k) => {
        if (k > 0)
          parameters.push({
            id: newId('t'),
            kind: 'intercept',
            target: item,
            indicator: true,
            label: `t${which}${k + 1}`,
          });
        if (!dist)
          parameters.push({
            id: newId('t'),
            kind: 'variance',
            target: item,
            indicator: true,
            label: `th${which}${k + 1}`,
          });
      });
    }
    constructs.push(c);
    return c;
  };

  const x1 = add(o.x1, 'x', 1, X_LEFT, TOP);
  const x2 = add(o.x2, 'x', 2, X_LEFT, BOTTOM);
  const y1 = add(o.y1, 'y', 1, Y_LEFT, TOP);
  const y2 = add(o.y2, 'y', 2, Y_LEFT, BOTTOM);

  // Means (latent means, or intercepts of Y): free per member, or equal for indistinguishable dyads.
  for (const [c, which] of [
    [x1, 'x'],
    [x2, 'x'],
    [y1, 'y'],
    [y2, 'y'],
  ] as const) {
    means.push({ id: newId('m'), target: c.id, ...(dist ? {} : { label: `m${which}` }) });
    if (!dist)
      parameters.push({ id: newId('t'), kind: 'variance', target: c.id, label: `v${which}` });
  }

  const path = (from: Construct, to: Construct, label: string): Path => ({
    id: newId('p'),
    from: from.id,
    to: to.id,
    label,
  });
  const paths: Path[] = dist
    ? [path(x1, y1, 'a1'), path(x2, y2, 'a2'), path(x2, y1, 'p1'), path(x1, y2, 'p2')]
    : [path(x1, y1, 'a'), path(x2, y2, 'a'), path(x2, y1, 'p'), path(x1, y2, 'p')];

  correlations.push({ id: newId('k'), kind: 'construct', a: x1.id, b: x2.id });
  correlations.push({ id: newId('k'), kind: 'construct', a: y1.id, b: y2.id });
  for (const [m1, m2] of [
    [o.x1, o.x2],
    [o.y1, o.y2],
  ]) {
    if (m1.length > 1)
      m1.forEach((item, k) =>
        correlations.push({ id: newId('k'), kind: 'indicator', a: item, b: m2[k] }),
      );
  }

  const defined: DefinedParameter[] = dist
    ? [
        { id: newId('d'), name: 'k1', expr: 'p1/a1' },
        { id: newId('d'), name: 'k2', expr: 'p2/a2' },
      ]
    : [{ id: newId('d'), name: 'k', expr: 'p/a' }];

  return {
    constructs,
    paths,
    moderations: [],
    correlations,
    parameters,
    means,
    defined,
    constant: { x: (X_LEFT + Y_LEFT) / 2, y: BOTTOM + 200 },
  };
}
