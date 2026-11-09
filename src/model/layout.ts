import { indicatorsDrawnElsewhere, type Construct, type ModelState, type Side } from './project';

/** Suggest a construct name from its indicators' common alphabetic prefix (IMAG1..IMAG5 → "IMAG"). */
export function suggestName(indicators: string[], existing: string[], fallbackIndex: number): string {
  const taken = new Set(existing.map((s) => s.toLowerCase()));
  let base = '';
  if (indicators.length > 0) {
    const stems = indicators.map((s) => s.replace(/[\s_.-]*\d+$/, ''));
    let prefix = stems[0];
    for (const s of stems) while (!s.startsWith(prefix)) prefix = prefix.slice(0, -1);
    base = prefix.replace(/[\s_.-]+$/, '');
    if (base.length < 2) base = '';
  }
  if (!base) base = `Construct ${fallbackIndex}`;
  let name = base, k = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${k++}`;
  return name;
}

/**
 * Layered left-to-right layout: each construct's column is the length of the
 * longest path reaching it. Exogenous constructs show indicators on the left,
 * final outcomes on the right, mediators alternate top/bottom.
 */
export function autoLayout(model: ModelState): Construct[] {
  const layer = new Map<string, number>();
  const preds = new Map<string, string[]>();
  for (const c of model.constructs) preds.set(c.id, []);
  for (const p of model.paths) preds.get(p.to)?.push(p.from);
  const visit = (id: string, guard: Set<string>): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (guard.has(id)) return 0;
    guard.add(id);
    const ps = preds.get(id) ?? [];
    const l = ps.length ? Math.max(...ps.map((p) => visit(p, guard))) + 1 : 0;
    layer.set(id, l);
    return l;
  };
  model.constructs.forEach((c) => visit(c.id, new Set()));
  const maxLayer = Math.max(0, ...layer.values());
  const hasSucc = new Set(model.paths.map((p) => p.from));
  const X_GAP = 380, Y_GAP = 250;

  // Barycentric ordering: each layer sits near the mean height of its
  // predecessors, then nodes are pushed apart to keep a minimum gap.
  const y = new Map<string, number>();
  for (let l = 0; l <= maxLayer; l++) {
    const col = model.constructs.filter((c) => layer.get(c.id) === l);
    const want = col.map((c, i) => {
      const ps = (preds.get(c.id) ?? []).filter((p) => y.has(p));
      return ps.length ? ps.reduce((s, p) => s + y.get(p)!, 0) / ps.length : (i - (col.length - 1) / 2) * Y_GAP;
    });
    const order = col.map((c, i) => ({ c, w: want[i] })).sort((a, b) => a.w - b.w);
    const placed: number[] = [];
    order.forEach((o, i) => placed.push(i === 0 ? o.w : Math.max(o.w, placed[i - 1] + Y_GAP)));
    const shift = order.reduce((s, o, i) => s + o.w - placed[i], 0) / Math.max(1, order.length);
    order.forEach((o, i) => y.set(o.c.id, Math.round(placed[i] + shift)));
  }

  // A path that skips a layer must not run through a construct in between
  // (e.g. ind60 → dem65 through dem60): move that construct off the line,
  // pushing its column neighbours to keep the gap.
  for (let l = 1; l < maxLayer; l++) {
    const col = model.constructs.filter((c) => layer.get(c.id) === l);
    for (const p of model.paths) {
      const lf = layer.get(p.from), lt = layer.get(p.to);
      if (lf === undefined || lt === undefined || !(lf < l && l < lt)) continue;
      const yf = y.get(p.from)!, yt = y.get(p.to)!;
      const yLine = yf + ((yt - yf) * (l - lf)) / (lt - lf);
      const hit = col.find((c) => Math.abs(y.get(c.id)! - yLine) < Y_GAP * 0.45);
      if (!hit) continue;
      y.set(hit.id, Math.round(yLine - Y_GAP * 0.6));
      const sorted = [...col].sort((a, b) => y.get(a.id)! - y.get(b.id)!);
      const at = sorted.indexOf(hit);
      for (let i = at - 1; i >= 0; i--) y.set(sorted[i].id, Math.min(y.get(sorted[i].id)!, y.get(sorted[i + 1].id)! - Y_GAP));
      for (let i = at + 1; i < sorted.length; i++) y.set(sorted[i].id, Math.max(y.get(sorted[i].id)!, y.get(sorted[i - 1].id)! + Y_GAP));
    }
  }

  const neighbours = (id: string) => [
    ...(preds.get(id) ?? []),
    ...model.paths.filter((p) => p.from === id).map((p) => p.to),
  ];
  // Factors that share their indicators (a bifactor model): the specific factors in a column with their boxes to the left, each
  // clear of the next, and the general factors further left, so that their arrows reach those boxes from outside.
  const elsewhere = indicatorsDrawnElsewhere(model);
  if (elsewhere.size) {
    const owned = (c: Construct) => c.indicators.filter((i) => !elsewhere.get(c.name)?.has(i)).length;
    const general = model.constructs.filter((c) => elsewhere.has(c.name) && !model.paths.some((p) => p.to === c.id || p.from === c.id));
    const others = model.constructs.filter((c) => !general.includes(c));
    let top = 0;
    const placed = new Map<string, { x: number; y: number }>();
    for (const c of others) {
      const h = Math.max(90, owned(c) * 34);
      placed.set(c.id, { x: 0, y: top + h / 2 });
      top += h + 44;
    }
    general.forEach((c, i) => placed.set(c.id, { x: -560, y: (top - 44) / 2 + (i - (general.length - 1) / 2) * 220 }));
    if (placed.size === model.constructs.length && general.length) return model.constructs.map((c) => ({ ...c, ...placed.get(c.id)!, side: 'left' as const }));
  }
  return model.constructs.map((c) => {
    const l = layer.get(c.id)!;
    const cy = y.get(c.id)!;
    let side: Side;
    if (l === 0) side = 'left';
    else if (!hasSucc.has(c.id) || l === maxLayer) side = 'right';
    else {
      const ns = neighbours(c.id);
      const mean = ns.reduce((s, n) => s + (y.get(n) ?? 0), 0) / Math.max(1, ns.length);
      side = cy <= mean ? 'top' : 'bottom';
    }
    return { ...c, side, x: l * X_GAP, y: cy };
  });
}
