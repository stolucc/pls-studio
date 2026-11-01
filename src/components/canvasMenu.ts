// Right-click menus on the canvas: what can be done with the thing under the
// pointer. Pure, so the choice of items is testable; Canvas performs them.

import { endogenousIds, type Method, type ModelState } from '../model/project';

export type MenuTarget =
  | { kind: 'construct'; id: string }
  | { kind: 'indicator'; construct: string; name: string }
  | { kind: 'disturbance'; id: string }
  | { kind: 'path'; id: string }
  | { kind: 'moderation'; id: string }
  | { kind: 'correlation'; id: string }
  /** A covariance CB-SEM estimates by default (two exogenous constructs), not drawn by the user. */
  | { kind: 'implied'; a: string; b: string }
  | { kind: 'pane'; x: number; y: number };

export type MenuAction =
  | 'edit' | 'make-composite' | 'make-factor' | 'correlate' | 'delete-construct'
  | 'remove-indicator' | 'reverse-path' | 'add-quadratic' | 'delete-path' | 'delete-moderation' | 'delete-correlation'
  | 'add-construct' | 'arrange' | 'figure' | 'make-covariate' | 'unmake-covariate' | 'process-template' | 'fix-zero' | 'fix-value' | 'free-value' | 'toggle-ordinal' | 'set-label' | 'toggle-free-loading' | 'toggle-free-intercept' | 'toggle-free-path' | 'make-esem' | 'leave-esem';

export interface MenuItem { action: MenuAction; label: string; danger?: boolean }

export interface MenuContext { method: Method; readOnly: boolean; /** Constructs selected on the canvas. */ selected?: string[] }

/** Exploratory SEM: make a block of the selected factors, or take this one out of its block. */
function esemItems(model: ModelState, edit: boolean, id: string, selected: string[]): (MenuItem | false)[] {
  if (!edit) return [];
  const inBlock = (x: string) => !!model.esem?.blocks.some((b) => b.constructs.includes(x));
  const candidates = selected.filter((x) => !inBlock(x) && model.constructs.some((c) => c.id === x && !c.covariate && !c.components?.length && c.indicators.length));
  return [
    inBlock(id) && { action: 'leave-esem', label: 'Take out of the ESEM block' },
    !inBlock(id) && selected.includes(id) && candidates.length >= 2 && { action: 'make-esem', label: `Make ESEM block of the ${candidates.length} selected factors` },
  ];
}

/** Partial invariance: free (or hold equal again) an indicator's loading or intercept across groups. */
function groupItems(model: ModelState, edit: boolean, construct: string, indicator: string, isMarker: boolean): (MenuItem | false)[] {
  const mg = model.multigroup;
  if (!edit || !mg || mg.invariance === 'configural') return [];
  const loadingFree = mg.free.some((f) => f.kind === 'loading' && f.construct === construct && f.indicator === indicator);
  const interceptFree = mg.free.some((f) => f.kind === 'intercept' && f.indicator === indicator);
  return [
    !isMarker && { action: 'toggle-free-loading', label: loadingFree ? 'Hold loading equal across groups' : 'Free loading across groups (partial invariance)' },
    (mg.invariance === 'scalar' || mg.invariance === 'strict') && { action: 'toggle-free-intercept', label: interceptFree ? 'Hold intercept equal across groups' : 'Free intercept across groups (partial invariance)' },
  ];
}

/** The heading and items of the menu for `target`; null when there is nothing to offer. */
export function menuFor(target: MenuTarget, model: ModelState, ctx: MenuContext): { title: string; items: MenuItem[] } | null {
  const cb = ctx.method === 'cbsem';
  const pls = ctx.method === 'pls';
  const proc = ctx.method === 'process';
  const edit = !ctx.readOnly;
  const nameOf = (id: string) => model.constructs.find((c) => c.id === id)?.name;
  const out = (title: string, items: (MenuItem | false)[]) => {
    const kept = items.filter((i): i is MenuItem => i !== false);
    return kept.length ? { title, items: kept } : null;
  };
  switch (target.kind) {
    case 'construct': {
      const c = model.constructs.find((k) => k.id === target.id);
      if (!c) return null;
      const endogenous = endogenousIds(model).has(c.id);
      return out(c.name, [
        { action: 'edit', label: edit ? 'Edit in inspector' : 'Show in inspector' },
        // PLS and CB-SEM (lavaan's composites) both model common factors and composites.
        edit && (pls || cb) && !c.covariate && c.type === 'factor' && { action: 'make-composite', label: 'Make composite' },
        edit && (pls || cb) && !c.covariate && c.type === 'composite' && { action: 'make-factor', label: 'Make common factor' },
        // Covariates enter every equation of a conditional process model.
        edit && proc && !c.covariate && !model.paths.some((p) => p.from === c.id || p.to === c.id) && !model.moderations.some((m) => m.moderator === c.id) && { action: 'make-covariate', label: 'Use as covariate' },
        edit && proc && !!c.covariate && { action: 'unmake-covariate', label: 'Stop using as covariate' },
        edit && cb && { action: 'correlate', label: endogenous ? 'Correlate disturbance (ζ) with…' : 'Correlate with…' },
        ...esemItems(model, edit && cb, c.id, ctx.selected ?? []),
        edit && { action: 'delete-construct', label: 'Delete construct', danger: true },
      ]);
    }
    case 'indicator': {
      const owner = nameOf(target.construct);
      if (!owner) return null;
      const owner2 = model.constructs.find((c) => c.id === target.construct);
      const held = owner2?.fixedLoadings?.[target.name];
      const isMarker = owner2?.indicators[0] === target.name;
      return out(target.name, [
        edit && cb && !owner2?.covariate && { action: 'fix-value', label: held !== undefined ? `Change fixed loading (${held})…` : isMarker ? 'Fix loading at another value than 1…' : 'Fix loading at a value…' },
        edit && cb && held !== undefined && { action: 'free-value', label: isMarker ? 'Back to the marker’s 1' : 'Free loading (estimate it)' },
        edit && cb && held === undefined && !isMarker && { action: 'set-label', label: owner2?.loadingLabels?.[target.name] ? `Label (${owner2.loadingLabels[target.name]})…` : 'Label (for equality constraints)…' },
        edit && cb && { action: 'correlate', label: 'Correlate error (ε) with…' },
        ...groupItems(model, edit && cb, target.construct, target.name, isMarker),
        edit && cb && !owner2?.covariate && { action: 'toggle-ordinal', label: model.ordered?.includes(target.name) ? 'Treat as continuous' : 'Treat as ordinal (categorical)' },
        edit && { action: 'remove-indicator', label: `Remove from ${owner}`, danger: true },
      ]);
    }
    case 'disturbance': {
      const name = nameOf(target.id);
      return name ? out(`Disturbance of ${name}`, [edit && cb && { action: 'correlate', label: 'Correlate with…' }]) : null;
    }
    case 'path': {
      const p = model.paths.find((q) => q.id === target.id);
      if (!p) return null;
      const hasQuadratic = model.moderations.some((mo) => mo.path === p.id && mo.moderator === p.from);
      // A stacked model (coefficients equal across groups): let this one differ between the groups.
      const mg = model.multigroup;
      const stacked = !!mg?.structural?.includes('regressions');
      const pathFree = !!mg?.free.some((f) => f.kind === 'regression' && f.from === p.from && f.to === p.to);
      return out(`${nameOf(p.from)} → ${nameOf(p.to)}`, [
        edit && cb && stacked && p.fixed === undefined && { action: 'toggle-free-path', label: pathFree ? 'Hold coefficient equal across groups' : 'Free coefficient across groups (differs between groups)' },
        edit && cb && { action: 'fix-value', label: p.fixed !== undefined ? `Change fixed value (${p.fixed})…` : 'Fix coefficient at a value…' },
        edit && cb && p.fixed !== undefined && { action: 'free-value', label: 'Free coefficient (estimate it)' },
        edit && cb && p.fixed === undefined && { action: 'set-label', label: p.label ? `Label (${p.label})…` : 'Label (for constraints and defined parameters)…' },
        edit && !hasQuadratic && !proc && { action: 'add-quadratic', label: `Add quadratic effect (${nameOf(p.from)}²)` },
        edit && { action: 'reverse-path', label: 'Reverse direction' },
        edit && { action: 'delete-path', label: 'Delete path', danger: true },
      ]);
    }
    case 'moderation': {
      const three = model.threeWay?.find((t) => t.id === target.id);
      if (three) return out(`Moderated moderation by ${nameOf(three.moderator)}`, [edit && { action: 'delete-moderation', label: 'Remove moderated moderation', danger: true }]);
      const mo = model.moderations.find((m) => m.id === target.id);
      if (!mo) return null;
      const p = model.paths.find((q) => q.id === mo.path);
      if (p && p.from === mo.moderator) {
        return out(`Quadratic effect ${nameOf(p.from)}² → ${nameOf(p.to)}`, [edit && { action: 'delete-moderation', label: 'Remove quadratic effect', danger: true }]);
      }
      return out(`Moderation by ${nameOf(mo.moderator)}`, [edit && { action: 'delete-moderation', label: 'Delete moderation', danger: true }]);
    }
    case 'correlation': {
      const k = model.correlations?.find((x) => x.id === target.id);
      if (!k) return null;
      const end = (id: string) => (k.kind === 'construct' ? nameOf(id) : id);
      return out(`${end(k.a)} ↔ ${end(k.b)}`, [
        edit && cb && { action: 'fix-value', label: k.fixed !== undefined ? `Change fixed value (${k.fixed})…` : 'Fix covariance at a value…' },
        edit && cb && k.fixed !== undefined && { action: 'free-value', label: 'Free covariance (estimate it)' },
        edit && cb && k.fixed === undefined && { action: 'set-label', label: k.label ? `Label (${k.label})…` : 'Label…' },
        edit && { action: 'delete-correlation', label: 'Delete correlation', danger: true },
      ]);
    }
    case 'implied': {
      const a = model.constructs.find((c) => c.id === target.a), b = model.constructs.find((c) => c.id === target.b);
      // Only implied pairs remain undrawn-but-shown: covariates (fixed at their sample values,
      // fixed.x) and factors of one ESEM block (correlated by the rotation). Nothing to change.
      if (!a || !b || !cb) return null;
      return out(`${a.name} ↔ ${b.name} (${a.covariate ? 'fixed at the sample covariance' : 'correlated by the ESEM rotation'})`, []);
    }
    case 'pane': {
      const any = model.constructs.length > 0;
      return out('Canvas', [
        edit && { action: 'add-construct', label: proc ? 'Add variable here' : 'Add construct here' },
        edit && proc && { action: 'process-template', label: 'PROCESS model templates…' },
        edit && any && { action: 'arrange', label: 'Arrange automatically' },
        any && { action: 'figure', label: 'Figure style and export…' },
      ]);
    }
  }
}
