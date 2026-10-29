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
  | { kind: 'pane'; x: number; y: number };

export type MenuAction =
  | 'edit' | 'make-composite' | 'make-factor' | 'correlate' | 'delete-construct'
  | 'remove-indicator' | 'reverse-path' | 'add-quadratic' | 'delete-path' | 'delete-moderation' | 'delete-correlation'
  | 'add-construct' | 'arrange' | 'figure' | 'make-covariate' | 'unmake-covariate' | 'process-template';

export interface MenuItem { action: MenuAction; label: string; danger?: boolean }

export interface MenuContext { method: Method; readOnly: boolean }

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
        // CB-SEM models common factors only; the factor / composite choice is PLS's.
        edit && pls && !c.covariate && c.type === 'factor' && { action: 'make-composite', label: 'Make composite' },
        edit && pls && !c.covariate && c.type === 'composite' && { action: 'make-factor', label: 'Make common factor' },
        // Covariates enter every equation of a conditional process model.
        edit && proc && !c.covariate && !model.paths.some((p) => p.from === c.id || p.to === c.id) && !model.moderations.some((m) => m.moderator === c.id) && { action: 'make-covariate', label: 'Use as covariate' },
        edit && proc && !!c.covariate && { action: 'unmake-covariate', label: 'Stop using as covariate' },
        edit && cb && { action: 'correlate', label: endogenous ? 'Correlate disturbance (ζ) with…' : 'Correlate with…' },
        edit && { action: 'delete-construct', label: 'Delete construct', danger: true },
      ]);
    }
    case 'indicator': {
      const owner = nameOf(target.construct);
      if (!owner) return null;
      return out(target.name, [
        edit && cb && { action: 'correlate', label: 'Correlate error (ε) with…' },
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
      return out(`${nameOf(p.from)} → ${nameOf(p.to)}`, [
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
      return out(`${end(k.a)} ↔ ${end(k.b)}`, [edit && { action: 'delete-correlation', label: 'Delete correlation', danger: true }]);
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
